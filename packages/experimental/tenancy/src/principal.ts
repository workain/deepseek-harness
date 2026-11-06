/**
 * Caller identity of one tenant user on a shared DSH Host.
 *
 * Every Remote call a tenant user makes speaks for a Peer whose principal is this value, so the
 * Gateway, the `tenant` remote-access policy, and durable Session logs name the caller the same way.
 * The shape follows `share-viewer` (the one non-owner principal upstream already ships): a JSON value
 * with a unique literal `kind`, carrying identity and attribution only — never a credential.
 *
 * The principal is built by Host code at Peer creation from a verified control-plane token. No wire
 * field can set it, which is the property `PeerScope.principal` already promises upstream and the
 * reason this layer can be a boundary rather than a filter.
 *
 * @module @deepseek-ai/dsh-experimental-tenancy/src/principal
 */

import type { Principal } from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PrincipalMap {
    /** One user of one tenant, as the control plane asserted it. */
    tenant: TenantPrincipal
  }
}

/**
 * A role inside one tenant. Roles are granted by the control plane alone; dsh never grants one.
 *
 * `tenant-admin` is deliberately NOT installation-admin: it is scoped to its own tenant and can
 * never reach another tenant's objects or the Host's own owner surface. Collapsing those two tiers
 * is the specific mistake `memberships_store.py`'s own docstring warns against, so the two are
 * different words here and there is no value of this type that means installation-admin.
 */
export type TenantRole = 'tenant-admin' | 'tenant-member' | 'tenant-viewer'

/** One user of one tenant, identified by the tenant and the control-plane-asserted subject. */
export interface TenantPrincipal {
  readonly kind: 'tenant'
  /** The tenant whose objects this caller may be granted on; our `workspace_id`, as a string. */
  readonly tenantId: string
  /** Control-plane-asserted user identity within that tenant. */
  readonly subjectId: string
  /** Roles the control plane asserted for this subject in this tenant. */
  readonly roles: readonly TenantRole[]
  /** Attribution only, never authority. */
  readonly displayName?: string
}

/** The tenant caller one principal names, when it names one. */
export function tenantOf(principal: Principal): TenantPrincipal | undefined {
  return principal.kind === 'tenant' ? principal : undefined
}

/**
 * Identity key of one tenant caller.
 *
 * Readers compare by tenant AND subject: the same `subjectId` in two tenants is two different
 * callers. This mirrors `identityKeyOf` in liveshare, for the same reason — a subject id that is
 * unique only within its issuer must never collide across issuers.
 */
export function tenantIdentityKey(principal: TenantPrincipal): string {
  return `${encodeURIComponent(principal.tenantId)}:${encodeURIComponent(principal.subjectId)}`
}

/** Whether one principal holds `role` in its own tenant. */
export function hasRole(principal: TenantPrincipal, role: TenantRole): boolean {
  return principal.roles.includes(role)
}
