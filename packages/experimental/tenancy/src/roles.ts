/**
 * The roles one tenant user may hold, as action sets over dsh's resource kinds.
 *
 * ## The two rules that make these sets a boundary rather than a menu
 *
 * 1. **Only two resource kinds exist** — `session` and `workspace` (declared in
 *    `core/session/src/types.ts` and `workspace/workspace/src/types.ts`); everything else resolves
 *    to `global`. Upstream states the consequence plainly: "putting an action in a `global` role
 *    lets the principal call it on any resource the call does not name." So an action goes in
 *    `TENANT_GLOBAL_ROLE` only when it is either (a) harmless Host-level metadata, or (b) a LIST
 *    method that filters every item through `allows()` — verified per method, not assumed.
 *
 * 2. **Deny-by-default does the rest.** `decide()` returns `no-allow` for any action no role lists,
 *    so the dangerous surfaces are excluded by SILENCE rather than by a blocklist that must be kept
 *    in step with upstream. Credentials are the worked example: `credentials/describe`, `/set` and
 *    `/unset` declare no resource and so answer on `global` alone — they are listed in NO role
 *    here, and a tenant asking for them is refused `no-allow`. Adding a blocklist would be strictly
 *    worse: a new upstream endpoint would default to reachable.
 *
 * This is why the role sets below are short and why that is the point. Anything absent is refused.
 *
 * @module @deepseek-ai/dsh-experimental-tenancy/src/roles
 */

import type { RemoteAccessAction, RemoteAccessRole } from '@deepseek-ai/dsh-api-remote-access/types'

/**
 * Host-level reads and the two filtered collection methods every tenant user may call.
 *
 * `session/list` and `session/search` are safe to grant globally ONLY because the Session
 * controller filters their results per item: `index.ts:284` filters `list` and `:298` filters
 * `search` through `allows({kind:'session', id})`. `workspace/follow` likewise decides each item
 * inline. If a future upstream change dropped that filtering, this grant would become a leak —
 * which is exactly what the committed `enumeration` check in this package's demo pins.
 */
export const TENANT_GLOBAL_ROLE: RemoteAccessRole<'global'> = {
  name: 'tenancy:global',
  resource: 'global',
  actions: [
    'session/list',
    'session/search',
    'session/control',
    'session/modelCatalog',
    'workspace/follow',
  ],
}

/** Reading one session the tenant may see, and the forwarded notifications about it. */
export const TENANT_SESSION_READ_ROLE: RemoteAccessRole<'session'> = {
  name: 'tenancy:session-read',
  resource: 'session',
  actions: [
    'session/control',
    'session/events',
    'session/follow',
    'session/list',
    'session/observeState',
    'session/page',
    'session/projections',
    'session/state',
    'session/wait',
    'event:api-session/activity',
    'event:api-session/status',
  ],
}

/**
 * Driving one session the tenant may see: prompting it and cancelling its turn.
 *
 * `session/prompt` is "resume" in the acceptance criteria's vocabulary — admitting a prompt resumes
 * a cold Session (`session-controller`'s own wording: "Admit one prompt after explicitly resuming
 * its Session"). A viewer never holds this role.
 */
export const TENANT_SESSION_WRITE_ROLE: RemoteAccessRole<'session'> = {
  name: 'tenancy:session-write',
  resource: 'session',
  actions: ['session/prompt', 'session/cancel', 'session/rename'],
}

/**
 * Workspace lifecycle verbs, on the SESSION resource they also name.
 *
 * `workspace/archiveSession` resolves TWO resources -- the workspace by its `workspaceId` field and
 * the session by its `sessionId` -- and upstream's rule is that a call is allowed only when EVERY
 * resolved resource allows the action ("Resources are independent: a grant on `global` implies
 * nothing on any other resource"). So the action has to be listed on a session-kind role as well,
 * or a tenant admin cannot archive even its own session.
 *
 * This is not a redundant grant: it is the session half of a two-resource call, and it is bound
 * only on sessions already in the tenant's scope and only for `tenant-admin`. It was found by the
 * separation demo's positive control, which refused a legitimate own-tenant archive.
 */
export const TENANT_SESSION_ADMIN_ROLE: RemoteAccessRole<'session'> = {
  name: 'tenancy:session-admin',
  resource: 'session',
  actions: ['workspace/archiveSession', 'workspace/unarchiveSession'],
}

/** Following one workspace that holds a session the tenant may see. */
export const TENANT_WORKSPACE_READ_ROLE: RemoteAccessRole<'workspace'> = {
  name: 'tenancy:workspace-read',
  resource: 'workspace',
  actions: ['workspace/follow'],
}

/**
 * Lifecycle verbs on one workspace: archiving a session out of it, and deleting it.
 *
 * These are "kill" in the acceptance criteria's vocabulary. `tenant-admin` alone holds this role,
 * and only on its OWN tenant's workspaces.
 */
export const TENANT_WORKSPACE_ADMIN_ROLE: RemoteAccessRole<'workspace'> = {
  name: 'tenancy:workspace-admin',
  resource: 'workspace',
  actions: ['workspace/archiveSession', 'workspace/unarchiveSession', 'workspace/delete', 'workspace/rename'],
}

/** Every role this package binds. */
export const TENANT_ROLES = [
  TENANT_GLOBAL_ROLE,
  TENANT_SESSION_READ_ROLE,
  TENANT_SESSION_WRITE_ROLE,
  TENANT_SESSION_ADMIN_ROLE,
  TENANT_WORKSPACE_READ_ROLE,
  TENANT_WORKSPACE_ADMIN_ROLE,
] as const

/**
 * Actions this package's roles decide, for the demo's completeness check.
 *
 * Deliberately NOT a whitelist consulted at decision time — `decide()` already refuses anything no
 * binding lists. It exists so a test can assert that a surface we mean to refuse (credentials,
 * settings, plugin inventory, workspace files) is absent from every role, rather than trusting that
 * nobody added it.
 */
export const TENANT_DECIDED_ACTIONS: ReadonlySet<RemoteAccessAction> = new Set<RemoteAccessAction>(
  TENANT_ROLES.flatMap(role => [...role.actions]),
)
