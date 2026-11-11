/** Bounded HTTPS requests for one explicitly resolved connection; authentication never follows redirects. */
import { normalizeHost, type ResolvedConnection } from './connections.ts'

export type TransportFailureCode = 'invalid-request' | 'unauthenticated' | 'forbidden' | 'not-found' | 'rate-limited' | 'too-large' | 'unavailable' | 'unknown'
/** Safe to display: neither host response bodies nor thrown fetch diagnostics enter messages. */
export class TransportError extends Error {
  constructor(readonly code: TransportFailureCode, message: string, readonly status?: number) { super(message); this.name = 'TransportError' }
}
export interface TransportOptions { timeoutMs: number; maxBodyBytes: number; fetch?: typeof globalThis.fetch }
export interface JsonRequest { path: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; signal?: AbortSignal }
async function discard(response: Response): Promise<void> {
  try { await response.body?.cancel() }
  catch (error) { void error /* Cancellation failure cannot make an untrusted response readable. */ }
}
/** The path is API-relative, never a URL. Redirects are rejected, including same-origin ones. Mutations are never retried. */
export async function requestJson(connection: ResolvedConnection, request: JsonRequest, options: TransportOptions): Promise<unknown> {
  if (typeof request.path !== 'string' || request.path.length > 8192
    || (request.method !== undefined && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method))) {
    throw new TransportError('invalid-request', 'A bounded API path and supported HTTP method are required.')
  }
  const origin = normalizeHost(connection.host)
  const prefix = connection.provider === 'gitlab' ? '/api/v4/' : origin === 'https://github.com' ? '/' : '/api/v3/'
  const apiOrigin = origin === 'https://github.com' && connection.provider === 'github' ? 'https://api.github.com' : origin
  let decodedPath: string
  try { decodedPath = decodeURIComponent(request.path.split('?')[0] ?? '') }
  catch { throw new TransportError('invalid-request', 'The API path contains invalid encoding.') }
  if (!request.path || request.path.startsWith('/') || decodedPath.includes('\\') || /[\r\n#]/.test(request.path)
    || /^[a-z][a-z0-9+.-]*:/i.test(request.path) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodedPath)) {
    throw new TransportError('invalid-request', 'An API-relative request path is required.')
  }
  const url = new URL(prefix + request.path, apiOrigin)
  if (url.origin !== apiOrigin || !url.pathname.startsWith(prefix)
    || url.username || url.password || url.hash || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decodeURIComponent(url.pathname))) {
    throw new TransportError('invalid-request', 'The request path must remain within the configured API.')
  }
  for (const value of [options.timeoutMs, options.maxBodyBytes]) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new TransportError('invalid-request', 'Positive bounded request limits are required.')
  }
  const method = request.method ?? 'GET'
  const mutation = method !== 'GET'
  const signal = request.signal ? AbortSignal.any([request.signal, AbortSignal.timeout(options.timeoutMs)]) : AbortSignal.timeout(options.timeoutMs)
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (connection.provider === 'github') headers.Authorization = `Bearer ${connection.token}`
  else headers['PRIVATE-TOKEN'] = connection.token
  let body: string | undefined
  if (request.body !== undefined) {
    body = JSON.stringify(request.body)
    headers['Content-Type'] = 'application/json'
    if (body === undefined || Buffer.byteLength(body) > options.maxBodyBytes) throw new TransportError('too-large', 'The API request exceeds the configured size limit.')
  }
  signal.throwIfAborted()
  let response: Response
  try {
    response = await (options.fetch ?? globalThis.fetch)(url, { method, headers, body, redirect: 'manual', signal })
  } catch {
    throw new TransportError(mutation ? 'unknown' : 'unavailable', mutation ? 'The write outcome is unknown. Check the code host before repeating it.' : 'The code host could not be reached. Check connectivity and try again.')
  }
  if (response.status >= 300 && response.status < 400) {
    await discard(response)
    throw new TransportError(mutation ? 'unknown' : 'unavailable', 'The code host returned a redirect. Check the configured origin before continuing.', response.status)
  }
  if (!response.ok) {
    await discard(response)
    const status = response.status
    const code: TransportFailureCode = status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : status === 404 ? 'not-found' : status === 429 ? 'rate-limited' : mutation && status >= 500 ? 'unknown' : 'unavailable'
    throw new TransportError(code, code === 'unknown' ? 'The write outcome is unknown. Check the code host before repeating it.' : `The code host rejected this request (HTTP ${status}). Check connection permissions and request details.`, status)
  }
  const reader = response.body?.getReader()
  if (!reader) return undefined
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > options.maxBodyBytes) {
        await reader.cancel()
        throw new TransportError(mutation ? 'unknown' : 'too-large', mutation ? 'The write may have succeeded but its response exceeded the size limit. Check the code host.' : 'The API response exceeds the configured size limit.')
      }
      chunks.push(part.value)
    }
    if (size === 0) return undefined
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch (error) {
    if (error instanceof TransportError) throw error
    throw new TransportError(mutation ? 'unknown' : 'unavailable', mutation ? 'The write outcome is unknown because its response could not be read. Check the code host before repeating it.' : 'The API response could not be read as JSON.')
  } finally { reader.releaseLock() }
}
