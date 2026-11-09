/** Named code-host connections and explicit workspace/folder selection. Secrets never leave the credential store through list(). */
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { credentialKey, type CredentialProvider, type CredentialRecord } from '@deepseek-ai/dsh-credentials'

export type Provider = 'github' | 'gitlab'
export interface Connection { id: string; name: string; provider: Provider; host: string }
export interface ResolvedConnection extends Connection { token: string }
export interface Configuration {
  connections: Connection[]
  workspaceBindings: Record<string, string>
  folderBindings: Record<string, string>
}
interface Document extends Omit<Configuration, 'connections'> { version: 1; connections: ResolvedConnection[] }
export type CredentialStore = Pick<CredentialProvider, 'readRecord' | 'modifyRecord'>
export type ConnectionFailureCode = 'invalid' | 'missing' | 'ambiguous' | 'unbound' | 'mismatch'
/** Safe diagnostic: never includes credential values or malformed stored input. */
export class ConnectionError extends Error {
  constructor(readonly code: ConnectionFailureCode, message: string) { super(message); this.name = 'ConnectionError' }
}
const KEY = credentialKey('workain-forge', 'configuration')
const ID = /^[a-z][a-z0-9-]{0,63}$/
const fail = (message: string): never => { throw new ConnectionError('invalid', message) }
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Normalize a TLS-only API origin. Paths, userinfo, query strings, and fragments are forbidden. */
export function normalizeHost(host: string): string {
  let url: URL
  try { url = new URL(host.includes('://') ? host : `https://${host}`) }
  catch { return fail('Enter a valid HTTPS code-host origin.') }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    return fail('Code-host connections require an HTTPS origin without a path or credentials.')
  }
  return url.origin
}
function connection(value: unknown): ResolvedConnection {
  if (!object(value) || typeof value.id !== 'string' || !ID.test(value.id)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120
    || (value.provider !== 'github' && value.provider !== 'gitlab')
    || typeof value.host !== 'string' || typeof value.token !== 'string' || !value.token.trim()
    || /[\r\n]/.test(value.token)) return fail('Stored connection is invalid; repair it in integration settings.')
  return { id: value.id, name: value.name.trim(), provider: value.provider, host: normalizeHost(value.host), token: value.token }
}
function bindings(value: unknown): Record<string, string> {
  if (!object(value) || Object.entries(value).some(([key, id]) => !key || typeof id !== 'string' || !ID.test(id))) {
    return fail('Stored connection bindings are invalid.')
  }
  return Object.fromEntries(Object.entries(value)) as Record<string, string>
}
function parse(record: CredentialRecord | undefined): Document {
  if (record === undefined) return { version: 1, connections: [], workspaceBindings: {}, folderBindings: {} }
  if (record.kind !== 'grant' || !object(record.payload) || record.payload.version !== 1 || !Array.isArray(record.payload.connections)) {
    return fail('Integration credential configuration is invalid or unsupported.')
  }
  const connections = record.payload.connections.map(connection)
  if (new Set(connections.map(item => item.id)).size !== connections.length) return fail('Duplicate connection identifiers in credential configuration.')
  return { version: 1, connections, workspaceBindings: bindings(record.payload.workspaceBindings), folderBindings: bindings(record.payload.folderBindings) }
}
function publicConfiguration(document: Document): Configuration {
  return { connections: document.connections.map(({ token: _token, ...metadata }) => metadata),
    workspaceBindings: { ...document.workspaceBindings }, folderBindings: { ...document.folderBindings } }
}
function requireConnection(document: Document, id: string): ResolvedConnection {
  const result = document.connections.find(item => item.id === id)
  if (!result) throw new ConnectionError('missing', 'The selected connection is missing. Update the binding in integration settings.')
  return result
}
function contains(parent: string, child: string): boolean {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}
/** All mutations use one credential grant record so token, metadata and bindings commit atomically across processes. */
export class ConnectionManager {
  constructor(private readonly store: CredentialStore, private readonly canonicalize: (path: string) => Promise<string> = realpath) {}
  private async document(): Promise<Document> { return parse(await this.store.readRecord(KEY)) }
  private async mutate(action: (document: Document) => void): Promise<void> {
    await this.store.modifyRecord(KEY, async current => {
      const document = parse(current)
      action(document)
      return { kind: 'grant', payload: document }
    })
  }
  async list(): Promise<Configuration> { return publicConfiguration(await this.document()) }
  async saveConnection(input: Connection, token?: string): Promise<void> {
    await this.mutate(document => {
      const existing = document.connections.find(item => item.id === input.id)
      const next = connection({ ...input, token: token ?? existing?.token })
      if (existing && (existing.provider !== next.provider || existing.host !== next.host)) {
        fail('Create a new connection identifier when changing provider or host.')
      }
      document.connections = [...document.connections.filter(item => item.id !== next.id), next]
    })
  }
  async removeConnection(id: string): Promise<void> {
    await this.mutate(document => {
      requireConnection(document, id)
      document.connections = document.connections.filter(item => item.id !== id)
      document.workspaceBindings = Object.fromEntries(Object.entries(document.workspaceBindings).filter(([, selected]) => selected !== id))
      document.folderBindings = Object.fromEntries(Object.entries(document.folderBindings).filter(([, selected]) => selected !== id))
    })
  }
  async bindWorkspace(workspaceId: string, connectionId: string): Promise<void> {
    if (!workspaceId.trim()) fail('A workspace identifier is required.')
    await this.mutate(document => { requireConnection(document, connectionId); document.workspaceBindings = { ...document.workspaceBindings, [workspaceId]: connectionId } })
  }
  async bindFolder(folder: string, connectionId: string): Promise<void> {
    const canonical = await this.canonicalize(folder)
    if (!isAbsolute(canonical)) fail('Folder binding must be an absolute canonical path.')
    await this.mutate(document => { requireConnection(document, connectionId); document.folderBindings = { ...document.folderBindings, [canonical]: connectionId } })
  }
  async unbindWorkspace(workspaceId: string): Promise<void> {
    await this.mutate(document => { delete document.workspaceBindings[workspaceId] })
  }
  async unbindFolder(folder: string): Promise<void> {
    const canonical = await this.canonicalize(folder)
    await this.mutate(document => { delete document.folderBindings[canonical] })
  }
  /** Explicit override wins, then the longest canonical folder binding, then the workspace binding; there is no ambient default. */
  async resolve(input: { workspaceId?: string; folder: string; connectionId?: string; provider?: Provider; host?: string }): Promise<ResolvedConnection> {
    const document = await this.document()
    let id = input.connectionId
    if (!id) {
      const folder = await this.canonicalize(input.folder)
      const matching = Object.entries(document.folderBindings).filter(([parent]) => contains(parent, folder)).sort(([a], [b]) => b.length - a.length)
      const first = matching[0]
      if (first && matching[1] && first[0].length === matching[1][0].length && first[1] !== matching[1][1]) {
        throw new ConnectionError('ambiguous', 'Several folder bindings match. Select a connection explicitly.')
      }
      id = first?.[1] ?? (input.workspaceId ? document.workspaceBindings[input.workspaceId] : undefined)
    }
    if (!id) throw new ConnectionError('unbound', 'No connection is selected. Bind this workspace or folder in integration settings.')
    const selected = requireConnection(document, id)
    if ((input.provider && input.provider !== selected.provider) || (input.host && normalizeHost(input.host) !== selected.host)) {
      throw new ConnectionError('mismatch', 'The selected connection does not match the repository provider or host.')
    }
    return { ...selected }
  }
}
