/**
 * The one link that activates tenant admission: a principal resolver reading the front door's
 * server-asserted identity header.
 *
 * ## What this is, and the scope line it deliberately stops at
 *
 * `admit()` consults a registered resolver before every owner path and has no fall-through
 * (`client/connection/src/rpc-host.ts:161-162`), but **nobody registers one**, so every request is
 * admitted as `{kind:'owner'}` and `decide()` returns `allow` on its first line
 * (`api/remote-access/src/index.ts:202`) before any policy is consulted. This package registers
 * one. That is its whole job.
 *
 * **What it buys is BINARY, and saying so is part of shipping it.** With a resolver registered and
 * no policy for the principal kind it mints, `decide()` returns `no-allow`
 * (`remote-access/src/index.ts:204`) and `requestRejection()` returns `403`
 * (`connection/src/rpc-host.ts:148`) — both fail CLOSED, which is the right direction, but the
 * result is one privileged seat and a wall for everyone else. It is **not** per-account isolation:
 * two non-owner accounts are refused identically and see the same nothing.
 *
 * Turning that wall into "each account sees its own objects" needs two further links that are
 * deliberately NOT here: the `tenancy` package's `tenant` policy actually mounted, and something
 * feeding `TenantScopeStore.put()` with an authority's answer — which `tenancy/src/scope.ts:70-78`
 * states is someone else's job, and for which harness-control has no subject kind yet
 * (harness-control#1949). This package stops at the link it can honestly close.
 *
 * ## The trust boundary, stated at the place that depends on it
 *
 * `PeerPrincipalResolver` receives `ConnectionTrustRequest`, and that type carries exactly one
 * field: `headers` (`connection/src/rpc.ts:98-101`). No socket, no URL, no body. So on this seam
 * identity CAN only be a header, and the only question that matters is whether a caller can set it.
 *
 * It cannot, when `trustedHeader` names a header the reverse proxy overwrites unconditionally. The
 * front door (harness-control#1950) does exactly that: it strips every client-supplied copy
 * *before* consulting its gate, then sets the header itself from the verified session
 * (`request_header -X-Frontdoor-User` … `forward_auth … copy_headers X-Frontdoor-User …`).
 *
 * **Two consequences, neither of them hidden:**
 *
 *  1. A Host reachable on a port that bypasses that proxy has no boundary here at all — anything
 *     able to connect directly names itself whatever it likes. Bind the Host to loopback and let
 *     the proxy own the public port. This is `workain/infra#119`'s L2 co-resident limit with a
 *     sharper edge: here it is spoofable identity, not merely a readable process.
 *  2. `config.users` is a DEPLOYMENT-LOCAL map, not an authority. It is the right shape for one
 *     shared navigation Host whose user list the operator owns, and the wrong shape for a real
 *     multi-tenant product, which needs a credential asserting tenant, subject and roles that this
 *     layer verifies. This map is where that plugs in — it does not compete with it.
 *
 * @module @deepseek-ai/dsh-experimental-frontdoor-identity
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionTrustRequest, PeerPrincipalResolver } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-client-connection'
import { tenantIdentityKey, type TenantPrincipal, type TenantRole } from '@deepseek-ai/dsh-experimental-tenancy/types'

/** One front-door user, as the deployment maps it onto a tenant identity. */
export interface UserMapping {
  /** The tenant this user belongs to; our `workspace_id`, as a string. */
  readonly tenantId: string
  /** Subject id inside that tenant; defaults to the front-door username. */
  readonly subjectId?: string
  /** Roles this user holds in that tenant. Decided by a policy this package does not mount. */
  readonly roles: readonly TenantRole[]
  /** Attribution only, never authority. */
  readonly displayName?: string
}

/** Deployment policy for front-door identity. */
export interface Config {
  /**
   * Header the reverse proxy sets and a client cannot. Lower-cased on read.
   *
   * Pointing this at a header the proxy does NOT overwrite turns this plugin from a boundary into
   * an open door, which is why it is configuration rather than a constant: a deployment that fronts
   * dsh differently has to say so explicitly instead of inheriting a guarantee it does not have.
   */
  readonly trustedHeader?: string
  /** Front-door username to tenant identity. A name absent from this map is refused. */
  readonly users?: Readonly<Record<string, UserMapping>>
  /**
   * Usernames admitted as the Host's own owner, bypassing every tenant check.
   *
   * Empty is the correct value for a shared Host. A name here holds the HOST, not a tenant: it
   * skips `decide()` entirely (`remote-access/src/index.ts:202`). It exists because a deployment
   * may keep one administrative seat, and because a demonstration of a refusal needs a positive
   * control — a refusal table with no admitted case cannot be distinguished from a broken Host.
   */
  readonly ownerUsers?: readonly string[]
}

const DEFAULT_HEADER = 'x-frontdoor-user'

/** Read one header from either representation `ConnectionTrustRequest` allows. */
function header(headers: ConnectionTrustRequest['headers'], name: string): string | undefined {
  if (typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined
  }
  const record = headers as Readonly<Record<string, string | readonly string[] | undefined>>
  const value = record[name] ?? record[name.toLowerCase()]
  // A duplicated header is ambiguous about who the caller is, and a proxy that overwrites cannot
  // produce one. Taking the first silently would pick a client-supplied value if a future proxy
  // ever appended instead of replacing, so refuse by returning nothing.
  if (Array.isArray(value)) return value.length === 1 ? value[0] : undefined
  return typeof value === 'string' ? value : undefined
}

/**
 * Mount front-door identity.
 *
 * @param ctx - owning Host plugin Context; must provide `connection`.
 * @param config - deployment policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const headerName = (config.trustedHeader ?? DEFAULT_HEADER).toLowerCase()
  const users = config.users ?? {}
  const owners = new Set(config.ownerUsers ?? [])

  ctx.inject(['connection'], (scope) => {
    const resolver: PeerPrincipalResolver = (request) => {
      const name = header(request.headers, headerName)
      // No identity is 401, never "the owner". This is the whole point of the resolver having no
      // fall-through: the single-user default would hand an unidentified caller every object.
      if (name === undefined || name === '') return { rejection: 401 }
      if (owners.has(name)) return { principal: { kind: 'owner' }, peerKey: `owner:${name}` }
      const mapping = users[name]
      // Authenticated at the door but not provisioned here: 403, not 401. Re-authenticating cannot
      // help, and sending a real user back to the login form for a provisioning gap wastes an hour.
      if (mapping === undefined) return { rejection: 403 }
      const principal: TenantPrincipal = {
        kind: 'tenant',
        tenantId: mapping.tenantId,
        subjectId: mapping.subjectId ?? name,
        roles: mapping.roles,
        ...mapping.displayName === undefined ? {} : { displayName: mapping.displayName },
      }
      // Reused rather than re-derived: the same subject id in two tenants must be two callers, and
      // `tenancy` already owns that rule. Importing one pure function is not mounting that plugin.
      return { principal, peerKey: tenantIdentityKey(principal) }
    }
    scope.effect(() => scope.connection.registerPrincipalResolver(resolver), 'frontdoor-identity: principal resolver')
  })
}

export const name = 'frontdoor-identity'
export const inject = ['connection'] as const
