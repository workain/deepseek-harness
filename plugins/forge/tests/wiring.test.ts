import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { ConnectionManager, type CredentialStore } from '../connections.ts'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), 'forge-wiring-'))
  const first = join(root, 'first'); const second = join(root, 'second')
  await mkdir(first); await mkdir(second)
  let record: CredentialRecord | undefined
  const credentials: CredentialStore = {
    async readRecord() { return structuredClone(record) },
    async modifyRecord(_key, mutate) { const next = await mutate(structuredClone(record)); if (next) record = next; return record },
  }
  const manager = new ConnectionManager(credentials)
  await manager.saveConnection({ id: 'first', name: 'First', provider: 'github', host: 'github.com' }, 'first-secret')
  await manager.saveConnection({ id: 'second', name: 'Second', provider: 'gitlab', host: 'gitlab.example.test' }, 'second-secret')
  await manager.bindFolder(first, 'first'); await manager.bindFolder(second, 'second')
  const tools = new Map<string, any>() // Test harness captures the plugin's JavaScript tool registrations.
  const routes: any[] = [] // Test harness captures the JavaScript fetch route.
  const dispose: Array<() => unknown> = []
  let folder = first
  let approve: () => Promise<string> = async () => 'rejected'
  let fetches = 0
  const oldFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => { fetches++; return new Response(JSON.stringify({ ok: true, echo: (init?.headers as Record<string, string>)?.Authorization })) }
  t.after(async () => { for (const fn of dispose.reverse()) await fn(); globalThis.fetch = oldFetch; await rm(root, { recursive: true, force: true }) })
  const ctx = {
    credentials,
    effect(fn: () => (() => unknown)) { const cleanup = fn(); dispose.push(cleanup); return cleanup },
    connection: { fetch: { register(route: unknown) { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } } } },
    tools: { register(tool: any) { tools.set(tool.name, tool); return () => { tools.delete(tool.name) } } },
    approval: { request: () => approve() },
    workingDirectory: { ensure: async () => folder },
    workspaceRegistry: { list: () => [{ id: 'workspace', sessionIds: ['session'] }] },
  }
  apply(ctx)
  const exec = { agent: { session: { id: 'session' } }, signal: new AbortController().signal, callId: 'call' }
  return { manager, tools, routes, exec, first, second, dispose, setFolder: (value: string) => { folder = value }, setApproval: (fn: () => Promise<string>) => { approve = fn }, fetches: () => fetches }
}

test('caller cwd chooses connection; tools cannot return or select tokens', async t => {
  const f = await fixture(t)
  const tool = f.tools.get('forge_connection')
  assert.equal(JSON.parse(await tool.execute({}, f.exec)).id, 'first')
  assert.ok(!(await tool.execute({}, f.exec)).includes('first-secret'))
  f.setFolder(f.second)
  assert.equal(JSON.parse(await tool.execute({connectionId: 'first'}, f.exec)).id, 'second')
  assert.equal('connectionId' in f.tools.get('forge_request').parameters.properties, false)
  const response = await f.routes[0].fetch(new Request('http://localhost/api/workain-forge'))
  assert.ok(!(await response.text()).includes('secret'))
})

test('GET accepts an empty schema body but refuses a nonempty request body', async t => {
  const f = await fixture(t)
  const request = f.tools.get('forge_request')
  await request.execute({path:'repos/o/r/branches',method:'GET',body:''},f.exec)
  assert.equal(f.fetches(),1)
  await assert.rejects(request.execute({path:'repos/o/r/branches',method:'GET',body:'{}'},f.exec),/cannot have a body/)
  assert.equal(f.fetches(),1)
})

test('rejected, unavailable or cancelled approval cannot dispatch a write', async t => {
  const f = await fixture(t)
  for (const decision of ['rejected', 'unavailable', 'cancelled']) {
    f.setApproval(async () => decision)
    await assert.rejects(f.tools.get('forge_request').execute({ path: 'repos/o/r/issues', method: 'POST', body: '{}' }, f.exec), /not approved/)
  }
  assert.equal(f.fetches(), 0)
})

test('approval is invalidated by token rotation and folder/connection changes', async t => {
  const f = await fixture(t)
  f.setApproval(async () => {
    await f.manager.saveConnection({ id: 'first', name: 'First', provider: 'github', host: 'github.com' }, 'rotated')
    return 'allowed-once'
  })
  await assert.rejects(f.tools.get('forge_request').execute({ path: 'repos/o/r/issues', method: 'POST' }, f.exec), /Connection changed/)
  f.setApproval(async () => { f.setFolder(f.second); return 'allowed-once' })
  await assert.rejects(f.tools.get('forge_request').execute({ path: 'repos/o/r/issues', method: 'POST' }, f.exec), /Connection changed/)
  assert.equal(f.fetches(), 0)
})

test('only repository APIs dispatch; output redacts token and no response is shared between accounts', async t => {
  const f = await fixture(t)
  const request = f.tools.get('forge_request')
  for (const path of ['user', 'user/keys', 'admin/users', 'https://evil.test', 'repos/o/r/hooks', 'repos/o/r/actions/secrets', 'repos/o/r/actions/%73ecrets', 'repos/o/r/issues/../../hooks']) {
    await assert.rejects(request.execute({path}, f.exec))
  }
  assert.equal(f.fetches(), 0)
  const first = await request.execute({path: 'repos/o/r/issues'}, f.exec)
  assert.ok(first.includes('[REDACTED]')); assert.ok(!first.includes('first-secret'))
  f.setFolder(f.second)
  await assert.rejects(request.execute({path: 'repos/o/r/issues'}, f.exec))
  await request.execute({path: 'projects/group%2Frepo/merge_requests'}, f.exec)
  assert.equal(f.fetches(), 2)
})
