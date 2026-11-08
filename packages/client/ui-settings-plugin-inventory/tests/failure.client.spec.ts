import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { carrierFailure, remoteFailureOrigin, RemoteWithdrawnError } from '@deepseek-ai/dsh-api-gateway/client'
import { failureOf, inventoryFailure, PluginInventoryReadError } from '../src/client/failure.ts'

const ENDPOINT = 'pluginInventory/list'

/** What the Host's own encoder delivers: a code, a message, and no cause at all. */
function rebuilt(code: string, message: string): RemoteError {
  return new RemoteError(code as never, message, {} as never)
}

/** A real carrier fold, built by the Gateway's own exported constructor. */
function carrier(thrown: unknown): RemoteError {
  const result = carrierFailure(ENDPOINT, thrown)
  return result.error
}

/** A real withdrawal cause, using the Gateway's own exported marker class. */
function withdrawn(): RemoteError {
  return new RemoteError(
    'gateway/internal',
    `client api: Remote method ${ENDPOINT} is no longer mounted`,
    {},
    { cause: new RemoteWithdrawnError(ENDPOINT) },
  )
}

/** A local cause carrying an arbitrary value under the withdrawal marker key. */
function markedCause(marker: unknown): RemoteError {
  return new RemoteError(
    'gateway/internal',
    `client api: ${ENDPOINT} failed: fixture`,
    {},
    { cause: { isDSHRemoteWithdrawn: marker } },
  )
}

describe('plugin inventory failure classification', () => {
  it('classifies a Host refusal as server, carrying the Host code and not the wrapper chain', () => {
    const error = rebuilt('plugin/unavailable', 'inventory offline')
    expect(Object.hasOwn(error, 'cause')).toBe(false)
    expect(inventoryFailure(error)).toEqual({ kind: 'server', code: 'plugin/unavailable' })
  })

  it('classifies a Host-folded internal fault as server, not as unreachable', () => {
    // The Host folds any non-RemoteError throw onto `gateway/internal`, the
    // same code a transport fault gets. Only the absent cause separates them.
    const error = rebuilt('gateway/internal', 'Cannot read properties of undefined')
    expect(inventoryFailure(error)).toEqual({ kind: 'server', code: 'gateway/internal' })
  })

  it('classifies a transport fault as unreachable', () => {
    expect(inventoryFailure(carrier(new TypeError('Failed to fetch')))).toEqual({ kind: 'unreachable' })
  })

  it('classifies a transport fault as unreachable even when the carrier threw undefined', () => {
    // A value comparison against undefined would misread this as a Host answer.
    const error = carrier(undefined)
    expect(error.cause).toBeUndefined()
    expect(Object.hasOwn(error, 'cause')).toBe(true)
    expect(inventoryFailure(error)).toEqual({ kind: 'unreachable' })
  })

  it('classifies a retired mount as withdrawn, distinctly from an unreachable carrier', () => {
    expect(inventoryFailure(withdrawn())).toEqual({ kind: 'withdrawn' })
  })

  it('agrees with the Gateway own origin classifier on every origin', () => {
    const cases = [
      { error: rebuilt('plugin/unavailable', 'inventory offline'), origin: 'host', kind: 'server' },
      { error: rebuilt('gateway/internal', 'host exploded'), origin: 'host', kind: 'server' },
      { error: carrier(new TypeError('Failed to fetch')), origin: 'carrier', kind: 'unreachable' },
      { error: carrier(undefined), origin: 'carrier', kind: 'unreachable' },
      { error: withdrawn(), origin: 'withdrawn', kind: 'withdrawn' },
      // A truthy-but-not-`true` marker is NOT a withdrawal. Both classifiers
      // test `=== true`; this row is what fails a mirror-only widening to a
      // loose check, which the enumerated rows above would otherwise let pass.
      { error: markedCause('yes'), origin: 'carrier', kind: 'unreachable' },
      { error: markedCause(true), origin: 'withdrawn', kind: 'withdrawn' },
    ] as const
    // This is the anti-drift gate for deriving the same facts locally rather
    // than importing the Gateway classifier into a shipped Client bundle.
    for (const { error, origin, kind } of cases) {
      expect(remoteFailureOrigin(error)).toBe(origin)
      expect(inventoryFailure(error).kind).toBe(kind)
    }
  })
})

describe('plugin inventory rejection carrier', () => {
  it('carries the classification and keeps the full diagnostic in message and cause', () => {
    const remote = carrier(new TypeError('Failed to fetch'))
    const error = new PluginInventoryReadError(
      `pluginInventory.list failed: ${remote.code}: ${remote.message}`,
      inventoryFailure(remote),
      { cause: remote },
    )
    expect(failureOf(error)).toEqual({ kind: 'unreachable' })
    expect(error.message)
      .toBe('pluginInventory.list failed: gateway/internal: '
        + 'client api: pluginInventory/list failed: Failed to fetch')
    expect(error.cause).toBe(remote)
    expect(error.name).toBe('PluginInventoryReadError')
  })

  it('identifies the rejection structurally, so a separate module copy still classifies', () => {
    const foreign = { isDSHPluginInventoryReadError: true, failure: { kind: 'withdrawn' } }
    expect(foreign).not.toBeInstanceOf(PluginInventoryReadError)
    expect(failureOf(foreign)).toEqual({ kind: 'withdrawn' })
  })

  it('reports no classification for a rejection that carries none', () => {
    // An assembly fault rejects without folding, so the tab shows its generic
    // line rather than inventing a cause for it.
    expect(failureOf(new Error('client api: pluginInventory/list has no active Connection'))).toBeUndefined()
    expect(failureOf(null)).toBeUndefined()
    expect(failureOf(undefined)).toBeUndefined()
    expect(failureOf('Remote method is no longer mounted')).toBeUndefined()
    expect(failureOf({ isDSHPluginInventoryReadError: false })).toBeUndefined()
  })
})
