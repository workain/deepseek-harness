import { test } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../index.js'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'

test('invalid operation limits reject plugin load before any effect registers', () => {
  for (const config of [{timeoutMs:0},{timeoutMs:2147483648},{maxBodyBytes:-1},{maxBodyBytes:1.5}]) {
    assert.throws(() => apply({},config), /positive bounded integer/)
  }
})

function fixture(approval: (request: any) => Promise<string> = async () => 'rejected') {
  let stored: CredentialRecord | undefined
  const tools = new Map<string, any>() // Capture public JavaScript registrations for request/result assertions.
  const effects: Array<() => unknown> = []
  const routes = new Map<string, any>() // Capture read and mutation routes separately.
  apply({
    credentials: {
      readRecord: async () => structuredClone(stored),
      modifyRecord: async (_key: string, mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord>) => { stored = await mutate(stored); return stored },
    },
    effect: (fn: () => (() => unknown)) => { const stop = fn(); effects.push(stop); return stop },
    connection: {fetch:{register(value: any) {routes.set(value.path,value);return () => {} }}},
    tools: {register(value: any) {tools.set(value.name, value);return () => tools.delete(value.name)}},
    workingDirectory: {ensure:async () => process.cwd()},
    workspaceRegistry: {list:() => [{id:'workspace',title:'Workspace',sessionIds:['session']}]},
    approval: {request:approval},
  })
  const route = routes.get('/api/workain-forge.mutate')
  const post = (input: object) => route.fetch(new Request('http://localhost/api/workain-forge.mutate', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}))
  return {tools, effects, route, post}
}

test('JSON-escaped quotes and backslashes in tokens are redacted from API and test-account results', async t => {
  const previous = globalThis.fetch
  globalThis.fetch = async () => new Response('{"login":"test-account"}')
  t.after(() => {globalThis.fetch = previous})
  const f = fixture()
  t.after(async () => { for (const stop of [...f.effects].reverse()) await stop() })
  const token = 'test-quote"and-backslash\\token'
  assert.equal((await f.post({action:'save',connection:{id:'special',name:'Special',provider:'github',host:'github.com'},token})).status, 200)
  assert.equal((await f.post({action:'bindWorkspace',workspaceId:'workspace',connectionId:'special'})).status, 200)
  globalThis.fetch = async () => new Response(JSON.stringify({login:token,echo:token,[token]:{deep:token}}))
  const raw = await f.tools.get('forge_request').execute({path:'repos/o/r/issues'}, {agent:{session:{id:'session'}}, signal:new AbortController().signal})
  assert.ok(!raw.includes(token)); assert.ok(!raw.includes(JSON.stringify(token).slice(1,-1)))
  assert.deepEqual(JSON.parse(raw), {login:'[REDACTED]',echo:'[REDACTED]','[REDACTED]':{deep:'[REDACTED]'}})
  const account = await f.post({action:'test',id:'special'})
  assert.deepEqual(await account.json(), {login:'[REDACTED]'})
})

test('settings rejects oversized, malformed and non-JSON bodies without echoing submitted values', async t => {
  const f = fixture()
  t.after(async () => { for (const stop of [...f.effects].reverse()) await stop() })
  const oversized = await f.route.fetch(new Request('http://localhost/api/workain-forge', {method:'POST',headers:{'content-type':'application/json'},body:'s'.repeat(65537)}))
  assert.equal(oversized.status, 413)
  const malformed = await f.route.fetch(new Request('http://localhost/api/workain-forge', {method:'POST',headers:{'content-type':'application/json'},body:'{"token":"sensitive-invalid-json'}))
  assert.equal(malformed.status, 400)
  assert.ok(!(await malformed.text()).includes('sensitive-invalid-json'))
  const wrong = await f.route.fetch(new Request('http://localhost/api/workain-forge', {method:'POST',headers:{'content-type':'text/plain'},body:'secret'}))
  assert.equal(wrong.status, 415)
})

test('plugin disposal cancels a stalled incoming body and waits for the request to settle', {timeout:1000}, async t => {
  const f = fixture()
  let cancelled = false
  let controller: ReadableStreamDefaultController<Uint8Array>
  const reading = Promise.withResolvers<void>()
  const body = new ReadableStream<Uint8Array>({
    start(value) { controller = value },
    pull() { reading.resolve() },
    cancel() { cancelled = true },
  })
  t.after(async () => { if (!cancelled) controller.close(); for (const stop of [...f.effects].reverse()) await stop() })
  const request = new Request('http://localhost/api/workain-forge.mutate', {method:'POST', headers:{'content-type':'application/json'},body,duplex:'half'} as RequestInit)
  const active = f.route.fetch(request)
  await reading.promise
  await Promise.resolve()
  await f.effects[0]()
  assert.equal(cancelled, true)
  assert.equal((await active).status, 400)
})

test('plugin disposal aborts pending write approval before draining admitted requests', {timeout:1000}, async t => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"login":"approval-account"}')
  t.after(() => {globalThis.fetch = previousFetch})
  const entered = Promise.withResolvers<void>()
  const caller = new AbortController()
  let aborted = false
  const f = fixture(async request => {
    entered.resolve()
    return await new Promise(resolve => request.signal.addEventListener('abort', () => {aborted = true;resolve('cancelled')}, {once:true}))
  })
  t.after(async () => {caller.abort();for (const stop of [...f.effects].reverse()) await stop()})
  await f.post({action:'save',connection:{id:'approval',name:'Approval',provider:'github',host:'github.com'},token:'approval-secret'})
  await f.post({action:'bindWorkspace',workspaceId:'workspace',connectionId:'approval'})
  const pending = f.tools.get('forge_request').execute({path:'repos/o/r/issues',method:'POST'}, {agent:{session:{id:'session'}},signal:caller.signal})
  const rejected = assert.rejects(pending, /not approved/)
  await entered.promise
  await f.effects[0]()
  assert.equal(aborted,true)
  await rejected
})
