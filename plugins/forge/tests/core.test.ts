import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { ConnectionManager, normalizeHost, type CredentialStore } from '../connections.ts'
import { requestJson } from '../transport.ts'

function fixture() {
  let current: CredentialRecord | undefined
  const store: CredentialStore = {
    async readRecord() { return structuredClone(current) },
    async modifyRecord(_key, mutate) { const next = await mutate(structuredClone(current)); if (next) current = next; return current },
  }
  return { manager: new ConnectionManager(store, async path => path), store }
}
const a = { id: 'personal', name: 'Personal', provider: 'github' as const, host: 'github.com' }
const b = { id: 'work', name: 'Work', provider: 'gitlab' as const, host: 'git.example.test' }

test('atomic credential configuration hides tokens and requires explicit binding', async () => {
  const { manager } = fixture()
  await manager.saveConnection(a, 'secret-a')
  await assert.rejects(manager.resolve({ folder: '/repo' }), { code: 'unbound' })
  await manager.bindWorkspace('workspace-one', a.id)
  assert.equal((await manager.resolve({ workspaceId: 'workspace-one', folder: '/repo' })).token, 'secret-a')
  assert.ok(!JSON.stringify(await manager.list()).includes('secret-a'))
  await assert.rejects(manager.resolve({ workspaceId: 'workspace-two', folder: '/repo' }), { code: 'unbound' })
  await manager.saveConnection(a, 'rotated')
  assert.equal((await manager.resolve({ workspaceId: 'workspace-one', folder: '/repo' })).token, 'rotated')
})

test('longest canonical folder wins; sibling prefix cannot inherit authority', async () => {
  const { manager } = fixture()
  await manager.saveConnection(a, 'secret-a'); await manager.saveConnection(b, 'secret-b')
  await manager.bindWorkspace('one', a.id)
  await manager.bindFolder('/repos/work', a.id)
  await manager.bindFolder('/repos/work/private', b.id)
  assert.equal((await manager.resolve({ workspaceId: 'one', folder: '/repos/work/private/sub' })).id, b.id)
  await assert.rejects(manager.resolve({ folder: '/repos/work-other' }), { code: 'unbound' })
  await assert.rejects(manager.resolve({ folder: '/repos/work/private', provider: 'github' }), { code: 'mismatch' })
  await assert.rejects(manager.resolve({ folder: '/repos/work/private', host: 'evil.test' }), { code: 'mismatch' })
})

test('removal atomically removes token and every binding; host changes cannot carry old token', async () => {
  const { manager, store } = fixture()
  await manager.saveConnection(a, 'secret-a')
  await manager.bindWorkspace('one', a.id); await manager.bindFolder('/repo', a.id)
  await assert.rejects(manager.saveConnection({ ...a, host: 'other.test' }), { code: 'invalid' })
  await manager.removeConnection(a.id)
  assert.deepEqual(await manager.list(), { connections: [], workspaceBindings: {}, folderBindings: {} })
  await assert.rejects(manager.resolve({ folder: '/repo' }), { code: 'unbound' })
  await store.modifyRecord('ignored' as never, async () => ({ kind: 'grant', payload: { version: 1, connections: [], workspaceBindings: { one: 'missing' }, folderBindings: {} } }))
  await assert.rejects(manager.resolve({ workspaceId: 'one', folder: '/repo' }), { code: 'missing' })
})

test('malformed stored configuration fails closed without quoting secrets', async () => {
  const { manager, store } = fixture()
  await store.modifyRecord('ignored' as never, async () => ({ kind: 'grant', payload: 'secret malformed payload' }))
  await assert.rejects(manager.list(), error => error instanceof Error && !error.message.includes('secret'))
  for (const host of ['http://host.test', 'https://user:secret@host.test', 'https://host.test/path', 'https://host.test?token=secret']) {
    assert.throws(() => normalizeHost(host), { code: 'invalid' })
  }
})

const resolved = { ...a, host: 'https://github.com', token: 'never-print-this' }
const options = { timeoutMs: 1000, maxBodyBytes: 1024 }
test('fixed API origin and authentication with redirects disabled', async () => {
  const fetch: typeof globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.github.com/repos/owner/repo')
    assert.equal(init?.redirect, 'manual')
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer never-print-this')
    return new Response('{"ok":true}')
  }
  await assert.rejects(requestJson(resolved, { path: 5 as never }, { ...options, fetch }), { code: 'invalid-request' })
  await assert.rejects(requestJson(resolved, { path: 'user', method: 'TRACE' as never }, { ...options, fetch }), { code: 'invalid-request' })
  assert.deepEqual(await requestJson(resolved, { path: 'repos/owner/repo' }, { ...options, fetch }), { ok: true })
  for (const path of ['//evil.test', 'https://evil.test', '../escape', 'repos\\evil']) {
    await assert.rejects(requestJson({ ...resolved, host: 'https://enterprise.test' }, { path }, { ...options, fetch }), { code: 'invalid-request' })
  }
})
test('redirects, oversized responses and sensitive failures are safely contained', async () => {
  await assert.rejects(requestJson(resolved, { path: 'user' }, { ...options, fetch: async () => new Response('', { status: 302, headers: { Location: 'https://evil.test' } }) }), { code: 'unavailable' })
  await assert.rejects(requestJson(resolved, { path: 'user' }, { ...options, maxBodyBytes: 1, fetch: async () => new Response('é') }), { code: 'too-large' })
  await assert.rejects(requestJson(resolved, { path: 'user', method: 'POST' }, { ...options, fetch: async () => { throw new Error('never-print-this') } }), error => error instanceof Error && !error.message.includes('never-print-this') && 'code' in error && error.code === 'unknown')
  await assert.rejects(requestJson(resolved, { path: 'user', method: 'POST' }, { ...options, fetch: async () => new Response('secret body', { status: 500 }) }), { code: 'unknown' })
})
