/** Why a plugin-inventory read failed, in the terms the page can act on. */

/**
 * The distinct causes behind the one fixed error string the tab used to show
 * for all of them. They need different advice: an unreachable carrier heals by
 * itself and Retry fixes it, a retired mount needs the tab reopened, and a
 * Host refusal needs its code so it can be looked up.
 */
export type PluginInventoryFailure =
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'withdrawn' }
  | { readonly kind: 'server'; readonly code: string }

/**
 * Classify one delivered Remote failure by ORIGIN, structurally — never by
 * matching its message, which is prose and may be reworded or localized.
 *
 * The code alone cannot decide this. `gateway/internal` is minted by the
 * Client face for a transport fault AND for a retired mount, and the Host
 * folds any non-RemoteError throw onto that same code. The discriminator is
 * the PRESENCE of an own `cause` key: the Host encoder carries only
 * `code`/`message`/`details`, so a wire-rebuilt failure has no `cause` at all,
 * while a locally minted one always does — even when the carrier threw
 * `undefined`, which is why this tests presence rather than value.
 *
 * This deliberately mirrors `remoteFailureOrigin` in
 * `@deepseek-ai/dsh-api-gateway/client` instead of importing it: no Client
 * plugin imports that package at runtime today, and this one cannot be bundled
 * in isolation to prove such an edge is safe. `tests/failure.client.spec.ts`
 * drives the real Gateway and fails if the two ever disagree, so the
 * duplication cannot drift silently.
 * @param error - the failure delivered on a `RemoteResult` error branch.
 * @returns what the page should tell the operator.
 */
export function inventoryFailure(
  error: { readonly code: string; readonly cause?: unknown },
): PluginInventoryFailure {
  if (!Object.hasOwn(error, 'cause')) return { kind: 'server', code: error.code }
  const cause = error.cause
  // Structural, not instanceof: the marker may cross module or realm copies.
  return typeof cause === 'object' && cause !== null
    && (cause as { isDSHRemoteWithdrawn?: unknown }).isDSHRemoteWithdrawn === true
    ? { kind: 'withdrawn' }
    : { kind: 'unreachable' }
}

/**
 * The rejection the tab receives, carrying the classified cause so the page
 * can name it. The full diagnostic stays in `message` and `cause`, which is
 * what the injection site logs.
 */
export class PluginInventoryReadError extends Error {
  /** Structural marker: cross-realm/bundle identification never uses instanceof. */
  readonly isDSHPluginInventoryReadError: true = true

  /**
   * @param message - the full diagnostic, including the wrapper chain.
   * @param failure - the classified cause the page renders.
   * @param options - standard Error options; `cause` carries the Remote failure.
   */
  constructor(message: string, readonly failure: PluginInventoryFailure, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PluginInventoryReadError'
  }
}

/**
 * Read the classification off a rejection, when it carries one. A rejection
 * from anywhere else — an assembly fault, a missing Connection — carries none,
 * and the tab then shows its generic line rather than guessing a cause.
 * @param error - a caught rejection value.
 * @returns the classification, or undefined when the value carries none.
 */
export function failureOf(error: unknown): PluginInventoryFailure | undefined {
  // Structural, not instanceof: the rejection may cross module or realm copies.
  return typeof error === 'object' && error !== null
    && (error as { isDSHPluginInventoryReadError?: unknown }).isDSHPluginInventoryReadError === true
    ? (error as PluginInventoryReadError).failure
    : undefined
}
