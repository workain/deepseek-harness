/** Real Loader, YAML composition, credential persistence and plugin lifecycle; tool/UI consumers are capture fixtures. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import * as Forge from '../index.js'

test('YAML Loader composition commits owner settings and retracts registrations on disposal', async t => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async () => new Response('{"login":"loader-account"}')
  t.after(() => {globalThis.fetch = previousFetch})
  const root = await mkdtemp(join(tmpdir(), 'forge-loader-'))
  const ctx = new Context()
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, {recursive:true, force:true}) })
  const tools = new Map<string, any>() // Capture the public JavaScript tool registration.
  const routes = new Map<string, any>() // Capture the public JavaScript HTTP handler.
  const Captures = {
    name: 'captures',
    apply(scope: any) {
      scope.provide('connection', {fetch: {register(route: any) { routes.set(route.path, route); return () => routes.delete(route.path) }}})
      scope.provide('tools', {register(tool: any) { tools.set(tool.name, tool); return () => tools.delete(tool.name) }})
      scope.provide('approval', {request: async () => 'rejected'})
      scope.provide('workingDirectory', {ensure: async () => root})
      scope.provide('workspaceRegistry', {list: () => [{id:'workspace', sessionIds:['session']}]})
    },
  }
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, `- name: 'cordis:credentials'\n  config:\n    path: ${JSON.stringify(join(root, 'credentials.yaml'))}\n    watch: false\n- name: 'cordis:captures'\n- name: 'cordis:forge'\n`)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.credentials = LocalCredentials
  ctx.loader.builtins.captures = Captures
  ctx.loader.builtins.forge = Forge
  await ctx.loader.create({ name:'cordis:include', config:{path:pathToFileURL(configPath).href} })
  await ctx.loader.await()
  for (const entry of ctx.loader.entries()) await entry.fiber?.await()
  const route = routes.get('/api/workain-forge')
  assert.ok(route, 'Loader mounts the integration route')
  assert.equal(route.requestBody, 'buffered', 'GET must not bridge an incoming body into a Fetch Request')
  assert.deepEqual(route.methods, ['GET'])
  const mutation = routes.get('/api/workain-forge.mutate')
  assert.equal(mutation.requestBody, 'streaming')
  const post = async (input: object) => mutation.fetch(new Request('http://localhost/api/workain-forge.mutate', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(input)}))
  assert.equal((await post({action:'save', connection:{id:'work',name:'Work',provider:'github',host:'github.com'},token:'loader-secret'})).status, 200)
  assert.equal((await post({action:'bindWorkspace',workspaceId:'workspace',connectionId:'work'})).status, 200)
  const output = await tools.get('forge_connection').execute({}, {agent:{session:{id:'session'}}, signal:new AbortController().signal})
  assert.equal(JSON.parse(output).id, 'work')
  assert.ok(!output.includes('loader-secret'))
  assert.ok((await readFile(join(root, 'credentials.yaml'), 'utf8')).includes('loader-secret'))
  await ctx.fiber.dispose()
  assert.equal(tools.size, 0)
  assert.equal(routes.size, 0)
})
