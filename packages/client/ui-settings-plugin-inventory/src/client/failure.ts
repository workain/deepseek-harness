/** Why a plugin-inventory read failed, in the terms the page can act on. */

/**
 * The distinct causes behind the one fixed error string the tab used to show
 * for all of them. They need different advice: a call that produced no usable
 * answer is typically transient and Retry fixes it, a retired mount needs the
 * tab reopened, and a Host refusal needs its code so it can be looked up.
 *
 * `unreachable` is named for the ADVICE, not for a proven network state, and
 * its copy says "no usable response" rather than "could not reach the server"
 * on purpose. Everything the Client face folds through `carrierFailure` lands
 * here, and that includes three cases where the server did answer: a non-2xx
 * status, an envelope that could not be read, and — latently — a result that
 * failed the strict codec. The first two are unconditional throw sites inside
 * `rpc.call` and are pinned by
 * `api/gateway/tests/gateway.client.spec.ts` ("a response that arrived and is
 * unusable"); the third needs a generated result `decode`, which
 * `pluginInventory/list` does not carry. Copy that asserted an unreachable
 * server would be false for all three.
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
 * drives the real Gateway and asserts both classifiers agree on **every origin
 * a shipping producer mints** — which is the bound of that guarantee, not
 * "every input": the table is enumerated, so a mirror-only widening that no
 * enumerated row reaches can still pass it. Any divergence on a shape the
 * Gateway actually produces does fail it.
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
