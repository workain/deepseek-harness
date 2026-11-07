/**
 * Tenant separation for a shared DSH Host.
 *
 * Mounts one `tenant` remote-access policy and keeps it in step with the control plane's scope
 * projection. The plugin itself is deliberately tiny: every decision mechanism it uses already
 * exists upstream, so this file is wiring, not machinery.
 *
 * ## What this plugin does NOT do, on purpose
 *
 * - It is not the identity authority. It never derives a tenant from a request field; the principal
 *   arrives on `PeerScope.principal`, which upstream fixes at Peer creation from in-process Host
 *   code and which no wire field can set.
 * - It does not compute who may see what. The control plane does, and `TenantScopeStore` caches the
 *   answer because `bindings()` is synchronous.
 * - It does not grant roles. Roles arrive asserted on the principal.
 *
 * @module @deepseek-ai/dsh-experimental-tenancy
 */

import type { Context } from '@deepseek-ai/cordis'
// Loaded for its `Context.remoteAccess` declaration merge; the `/types` subpath this package
// imports elsewhere does not carry it.
import type {} from '@deepseek-ai/dsh-api-remote-access'
import { createTenantAccessPolicy, type TenantClock } from './access-policy.ts'
import { TenantScopeStore } from './scope.ts'

export type * from './principal.ts'
export type * from './scope.ts'
export { TenantScopeStore } from './scope.ts'
export { createTenantAccessPolicy } from './access-policy.ts'
export type { TenantRefusal, TenantClock } from './access-policy.ts'
export * from './roles.ts'
export { tenantOf, tenantIdentityKey, hasRole } from './principal.ts'

/** Deployment policy for tenant separation. */
export interface Config {
  /**
   * Age past which a tenant's scope projection stops being decidable, in ms.
   *
   * This is the revocation window: the longest a just-revoked object can still be reachable if a
   * refresh is missed. Short enough to bound the exposure, long enough that a control-plane blip
   * does not black out every tenant. Stated as config because the right value is a deployment
   * decision, not a constant we should pretend to know.
   */
  readonly scopeMaxAgeMs?: number
}

const DEFAULT_SCOPE_MAX_AGE_MS = 30_000

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Per-tenant scope projections, as the control plane last reported them. */
    tenantScope: TenantScopeStore
  }
}

/**
 * Mount tenant separation.
 *
 * @param ctx - owning Host plugin Context; must already provide `remoteAccess`.
 * @param config - deployment policy.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const store = new TenantScopeStore(config.scopeMaxAgeMs ?? DEFAULT_SCOPE_MAX_AGE_MS)
  const clock: TenantClock = { nowMs: () => Date.now() }

  // No availability predicate: cordis's third parameter is `check?: () => boolean`, and a
  // non-callable value is worse than none -- `Fiber._checkImpl` throws on `check.call(...)`,
  // swallows it, and DELETES the service from the dependent's store, so `tenantScope` reads as
  // absent to every injector. Omitting it is what `true` meant: always available.
  ctx.provide('tenantScope', store)

  ctx.inject(['remoteAccess'], (scope) => {
    scope.remoteAccess.registerPolicy('tenant', createTenantAccessPolicy(store, clock))
    // Every refresh, drop and revocation must reach open snapshot streams, which recompute only
    // after `invalidate()`. Without this, a revoked object keeps its grant on an open page until
    // something unrelated changes -- the same latency upstream documents for `workspace/follow`.
    scope.effect(() => store.onChange((tenantId) => {
      scope.remoteAccess.invalidate()
      scope.logger.debug(`tenancy: scope projection changed for tenant ${JSON.stringify(tenantId)}`)
    }), 'tenancy: scope invalidation')
  })
}

export const name = 'tenancy'
export const inject = ['remoteAccess'] as const
