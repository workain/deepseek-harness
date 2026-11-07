/**
 * The `tenant` remote-access policy: what one tenant user may call on a shared DSH Host.
 *
 * The Gateway decides every call that speaks for a `tenant` Peer — and every Session notification it
 * forwards to one — from the bindings this policy lists. The Session and Workspace controllers
 * filter their list results through the same bindings via `allows()`, and each tenant page opens
 * with the snapshot computed from them. This is the same integration upstream's own `share-viewer`
 * policy uses; nothing here is a new mechanism.
 *
 * ## What this policy is, in one sentence
 *
 * It grants a tenant user roles ONLY on the objects the control plane put in that tenant's scope
 * projection, so a request naming any other object has no binding and is refused `no-allow`.
 *
 * ## Why the refusal is a boundary and not a hidden button
 *
 * `decide()` runs on the HOST, inside the Gateway, before it resolves lookups or decodes arguments.
 * The client-side snapshot (which hides UI the Host would refuse) is a convenience computed from the
 * same bindings; removing it changes what is drawn and nothing about what is permitted. So the
 * refusals this policy produces answer "can the API be asked", which is the question that matters.
 *
 * @module @deepseek-ai/dsh-experimental-tenancy/src/access-policy
 */

import type {
  RemoteAccessBinding,
  RemoteAccessDecision,
  RemoteAccessPolicy,
  RemoteAccessRequest,
} from '@deepseek-ai/dsh-api-remote-access/types'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { hasRole, type TenantPrincipal } from './principal.ts'
import type { TenantScopeFacts } from './scope.ts'
import {
  TENANT_GLOBAL_ROLE,
  TENANT_SESSION_ADMIN_ROLE,
  TENANT_SESSION_READ_ROLE,
  TENANT_SESSION_WRITE_ROLE,
  TENANT_WORKSPACE_ADMIN_ROLE,
  TENANT_WORKSPACE_READ_ROLE,
  TENANT_WORKSPACE_SPAWN_ROLE,
} from './roles.ts'

/** Refusal codes this policy produces; each names one cause, so a client can classify it. */
export type TenantRefusal =
  /** The tenant has no loaded scope projection, or it is older than the store's `maxAgeMs`. */
  | 'tenant-scope-stale'
  /** The named object is not in this tenant's scope: the cross-tenant refusal. */
  | 'tenant-object-not-in-scope'
  /** In scope, but this subject's roles carry no write verb. */
  | 'tenant-read-only'
  /** In scope, but workspace lifecycle needs `tenant-admin`. */
  | 'tenant-admin-required'

const ALLOW: RemoteAccessDecision = Object.freeze({ kind: 'allow' })

function deny(reason: TenantRefusal): RemoteAccessDecision {
  return { kind: 'deny', reason }
}

/** A clock, injected so the freshness rule is testable without waiting. */
export interface TenantClock {
  readonly nowMs: () => number
}

/**
 * Build the `tenant` policy.
 *
 * @param facts - the synchronous scope projection; the control plane is its authority.
 * @param clock - reads the current time for the freshness rule.
 * @returns the policy to register for the `tenant` principal kind.
 */
export function createTenantAccessPolicy(
  facts: TenantScopeFacts,
  clock: TenantClock,
): RemoteAccessPolicy<TenantPrincipal> {
  return {
    bindings(principal): readonly RemoteAccessBinding[] {
      // Fail closed: an unloaded or expired projection is not evidence of access, so the tenant
      // gets NO bindings at all and every call -- including the global list methods -- is refused.
      if (!facts.isFresh(principal.tenantId, clock.nowMs())) return []

      const writes = hasRole(principal, 'tenant-admin') || hasRole(principal, 'tenant-member')
      const admin = hasRole(principal, 'tenant-admin')
      const bindings: RemoteAccessBinding[] = [
        { role: TENANT_GLOBAL_ROLE, resource: { kind: 'global' } },
      ]

      // One binding per object the control plane put in scope. Nothing else is named, so any other
      // object has no binding and `decide()` refuses it without this policy being consulted again.
      for (const sessionId of facts.sessionIds(principal.tenantId)) {
        // `TenantScopeFacts` keys objects by opaque string; the framework's resource ids are
        // branded (`SessionId`/`WorkspaceId`). Brand at this boundary -- re-typing the public
        // store is a wider change than making this package compile.
        const resource = { kind: 'session', id: sessionId as SessionId } as const
        bindings.push({ role: TENANT_SESSION_READ_ROLE, resource })
        bindings.push({
          role: TENANT_SESSION_WRITE_ROLE,
          resource,
          condition: () => (writes ? ALLOW : deny('tenant-read-only')),
        })
        // The session half of the two-resource workspace lifecycle calls; see the role's own note.
        bindings.push({
          role: TENANT_SESSION_ADMIN_ROLE,
          resource,
          condition: () => (admin ? ALLOW : deny('tenant-admin-required')),
        })
      }
      for (const workspaceId of facts.workspaceIds(principal.tenantId)) {
        // Branded at the boundary, same reason as the session resource above.
        const resource = { kind: 'workspace', id: workspaceId as WorkspaceId } as const
        bindings.push({ role: TENANT_WORKSPACE_READ_ROLE, resource })
        // "spawn": creating a Session inside a workspace the tenant already owns. A member may
        // do this, so it carries the same write condition as `session/prompt` rather than the
        // admin one -- creating work inside your own workspace is not a lifecycle-admin act.
        //
        // Bound on the WORKSPACE resource deliberately. See TENANT_WORKSPACE_SPAWN_ROLE's own note:
        // a `create` naming a workspace is decided against that workspace and takes its `cwd` from
        // `workspace.path`, while a `create` naming a raw `cwd` resolves no resource, falls to
        // `global`, and is refused because this action is absent there. Moving it to the global
        // role would let any tenant own any absolute path on the Host (hc#1955).
        bindings.push({
          role: TENANT_WORKSPACE_SPAWN_ROLE,
          resource,
          condition: () => (writes ? ALLOW : deny('tenant-read-only')),
        })
        bindings.push({
          role: TENANT_WORKSPACE_ADMIN_ROLE,
          resource,
          condition: () => (admin ? ALLOW : deny('tenant-admin-required')),
        })
      }
      return bindings
    },

    /**
     * Name the cause when no binding allowed the request.
     *
     * Order matters: staleness is reported before scope, because a stale projection cannot
     * distinguish "not yours" from "we do not currently know what is yours", and reporting the
     * second as the first would be a lie about why the request failed.
     */
    explain(request: RemoteAccessRequest<TenantPrincipal>): string {
      const { principal } = request
      if (!facts.isFresh(principal.tenantId, clock.nowMs())) return 'tenant-scope-stale'
      for (const resource of request.resources) {
        if (resource.kind === 'session' && !facts.allowsSession(principal.tenantId, resource.id)) {
          return 'tenant-object-not-in-scope'
        }
        if (resource.kind === 'workspace' && !facts.allowsWorkspace(principal.tenantId, resource.id)) {
          return 'tenant-object-not-in-scope'
        }
      }
      // Every named resource is in scope, so the refusal is about the verb, not the object. A
      // global-only action that no tenant role lists (credentials, settings, files) lands here.
      return 'tenant-action-not-granted'
    },
  }
}
