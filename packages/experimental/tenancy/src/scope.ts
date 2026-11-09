/**
 * The tenant scope projection: what the control plane says one tenant may see, readable
 * SYNCHRONOUSLY.
 *
 * ## Why a projection exists at all
 *
 * `RemoteAccessPolicy.bindings()` is synchronous — upstream's own `createViewerAccessPolicy` states
 * the same constraint ("Every rule reads in-memory share state synchronously") and keeps every
 * awaited step outside the policy. So the policy CANNOT call the control plane while deciding a
 * request. That is a property of upstream's access framework, not a shortcut taken here.
 *
 * The consequence is the shape of the whole seam, and it is not "dsh decides":
 *
 *   - the control plane is the AUTHORITY: it alone computes which objects a tenant may see, from
 *     membership, roles and quota that live only on its side;
 *   - this projection is a CACHE of that answer, refreshed out-of-band and never computed locally;
 *   - the policy reads the cache synchronously while deciding;
 *   - `invalidate()` is called on every refresh, so open snapshots recompute.
 *
 * A stale projection can only ever be a SUPERSET risk for the window between a revocation and its
 * refresh. That window is the one real weakness of this design and it is named, bounded and
 * measured rather than hidden: see `maxAgeMs`/`isFresh` below and the design document's §6.
 *
 * ## Fail-closed
 *
 * Every read answers "no" for a tenant with no loaded scope, and `isFresh` goes false once the
 * projection is older than `maxAgeMs`. A policy built on a stale projection denies rather than
 * guesses — the opposite of `allows()`'s own fail-OPEN default, which returns true when it cannot
 * find a principal. That asymmetry is deliberate and is the reason this layer never relies on
 * `allows()` alone.
 *
 * @module @deepseek-ai/dsh-experimental-tenancy/src/scope
 */

import type { TenantRole } from './principal.ts'

/** One tenant's permitted object sets, exactly as the control plane returned them. */
export interface TenantScopeSnapshot {
  readonly tenantId: string
  /** Session ids this tenant may see. The control plane returns only permitted ids. */
  readonly sessionIds: readonly string[]
  /** Workspace ids this tenant may see. */
  readonly workspaceIds: readonly string[]
  /** Roles per subject, as the control plane asserted them. */
  readonly roles: Readonly<Record<string, readonly TenantRole[]>>
  /** When the control plane produced this answer, in epoch ms. */
  readonly fetchedAtMs: number
}

/** Synchronous reads the tenant policy performs while deciding one request. */
export interface TenantScopeFacts {
  /** Whether `sessionId` is in this tenant's permitted set; false when no scope is loaded. */
  readonly allowsSession: (tenantId: string, sessionId: string) => boolean
  /** Whether `workspaceId` is in this tenant's permitted set; false when no scope is loaded. */
  readonly allowsWorkspace: (tenantId: string, workspaceId: string) => boolean
  /** Every session id this tenant may see, for binding computation. */
  readonly sessionIds: (tenantId: string) => readonly string[]
  /** Every workspace id this tenant may see, for binding computation. */
  readonly workspaceIds: (tenantId: string) => readonly string[]
  /**
   * Whether this tenant's projection is loaded AND young enough to decide on.
   * A policy that reads false here must deny: an expired projection is not evidence of access.
   */
  readonly isFresh: (tenantId: string, nowMs: number) => boolean
}

/**
 * In-memory store of per-tenant scope projections.
 *
 * Holds one snapshot per tenant. Deliberately has no fetch of its own: whoever owns the transport
 * to the control plane calls `put()`, and `onChange` lets the plugin call
 * `remoteAccess.invalidate()` so open snapshot streams recompute. Keeping the fetch out means this
 * class can be unit-tested with no network and no clock.
 */
export class TenantScopeStore implements TenantScopeFacts {
  private readonly snapshots = new Map<string, TenantScopeSnapshot>()
  private readonly listeners = new Set<(tenantId: string) => void>()

  /** @param maxAgeMs - age past which a projection stops being decidable. */
  constructor(readonly maxAgeMs: number) {
    if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
      throw new Error(`tenancy: maxAgeMs must be a positive finite number, got ${String(maxAgeMs)}`)
    }
  }

  /** Replace one tenant's projection and notify listeners. */
  put(snapshot: TenantScopeSnapshot): void {
    this.snapshots.set(snapshot.tenantId, snapshot)
    this.notify(snapshot.tenantId)
  }

  /**
   * Drop one tenant's projection. The next decision for that tenant denies, which is what a
   * revocation we could not refresh must look like.
   */
  drop(tenantId: string): void {
    if (this.snapshots.delete(tenantId)) this.notify(tenantId)
  }

  /** Observe projection changes; the plugin wires `remoteAccess.invalidate()` to this. */
  onChange(listener: (tenantId: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** The roles the control plane asserted for one subject, empty when unknown. */
  rolesOf(tenantId: string, subjectId: string): readonly TenantRole[] {
    return this.snapshots.get(tenantId)?.roles[subjectId] ?? []
  }

  allowsSession: TenantScopeFacts['allowsSession'] = (tenantId: string, sessionId: string): boolean =>
    this.snapshots.get(tenantId)?.sessionIds.includes(sessionId) ?? false

  allowsWorkspace: TenantScopeFacts['allowsWorkspace'] = (tenantId: string, workspaceId: string): boolean =>
    this.snapshots.get(tenantId)?.workspaceIds.includes(workspaceId) ?? false

  sessionIds: TenantScopeFacts['sessionIds'] = (tenantId: string): readonly string[] => this.snapshots.get(tenantId)?.sessionIds ?? []

  workspaceIds: TenantScopeFacts['workspaceIds'] = (tenantId: string): readonly string[] => this.snapshots.get(tenantId)?.workspaceIds ?? []

  isFresh: TenantScopeFacts['isFresh'] = (tenantId: string, nowMs: number): boolean => {
    const snapshot = this.snapshots.get(tenantId)
    if (snapshot === undefined) return false
    const age = nowMs - snapshot.fetchedAtMs
    // A projection from the future is a clock fault, not freshness.
    return age >= 0 && age <= this.maxAgeMs
  }

  private notify(tenantId: string): void {
    for (const listener of this.listeners) listener(tenantId)
  }
}
