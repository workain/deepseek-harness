import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { ConnectionManager, type CredentialStore } from '../connections.ts'
import { apply } from '../index.js'

function fixture() {
  let stored: CredentialRecord | undefined
  const store: CredentialStore = {
    readRecord: async () => structuredClone(stored),
    modifyRecord: async (_key, mutate) => { const next = await mutate(structuredClone(stored)); if(next)stored=next;return stored },
  }
  return {store,manager:new ConnectionManager(store,async path=>path)}
}
const input = {id:'work',name:'Work',provider:'github' as const,host:'github.com'}

test('legacy records normalize unverified; rotation cannot carry old verification', async () => {
  const {store,manager}=fixture()
  await store.modifyRecord('ignored' as never,async()=>({kind:'grant',payload:{version:1,connections:[{...input,token:'old'}],workspaceBindings:{},folderBindings:{}}}))
  assert.deepEqual((await manager.list()).connections[0]!.verification,{state:'unverified'})
  await manager.saveConnection(input,undefined,async()=>({state:'verified',checkedAt:'2026-11-10T12:00:00Z',login:'account'}))
  assert.equal((await manager.list()).connections[0]!.verification!.state,'verified')
  await manager.saveConnection(input,'rotated')
  assert.deepEqual((await manager.list()).connections[0]!.verification,{state:'unverified'})
  assert.ok(!JSON.stringify(await manager.list()).includes('rotated'))
})

test('verification runs outside store lock and refuses stale concurrent token commit', async () => {
  const {manager}=fixture()
  await manager.saveConnection(input,'first')
  const entered=Promise.withResolvers<void>(),release=Promise.withResolvers<void>()
  const pending=manager.saveConnection({...input,name:'Slow'},'slow',async()=>{
    entered.resolve();await release.promise
    return {state:'verified',checkedAt:'2026-11-10T12:00:00Z',login:'checked-account'}
  })
  await entered.promise
  await manager.saveConnection(input,'newer')
  release.resolve()
  await assert.rejects(pending,/changed during verification/)
  assert.equal((await manager.resolve({folder:'/repo',connectionId:'work'})).token,'newer')
  assert.equal((await manager.list()).connections[0]!.verification!.state,'unverified')
})

test('owner save verifies GitHub and GitLab identity and persists safe failure warnings', async t => {
  const {store}=fixture()
  const routes=new Map<string,any>() // Capture the JavaScript HTTP route for isolated provider fixtures.
  const stops:Array<()=>unknown>=[]
  const originalFetch=globalThis.fetch
  t.after(async()=>{globalThis.fetch=originalFetch;for(const stop of stops.reverse())await stop()})
  apply({credentials:store,effect:(start:()=>()=>unknown)=>{const stop=start();stops.push(stop);return stop},connection:{fetch:{register:(route:any)=>{routes.set(route.path,route);return ()=>routes.delete(route.path)}}},tools:{register:()=>()=>{}},workspaceRegistry:{list:()=>[]}})
  const post=async(connection:object,token?:string)=>{
    const response=await routes.get('/api/workain-forge.mutate').fetch(new Request('http://localhost/api/workain-forge.mutate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'save',connection,...token?{token}:{}})}))
    assert.equal(response.status,200)
    return response.json()
  }
  let calls=0
  globalThis.fetch=async(url,init)=>{
    calls++;assert.equal(String(url),'https://api.github.com/user');assert.equal(init?.method,'GET')
    assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer github-private-token')
    return new Response('{"login":"github-user"}')
  }
  const github=await post(input,'github-private-token')
  assert.equal(github.connections[0].verification.state,'verified')
  assert.equal(github.connections[0].verification.login,'github-user')
  assert.ok(Number.isFinite(Date.parse(github.connections[0].verification.checkedAt)))
  assert.equal(calls,1)
  globalThis.fetch=async(url,init)=>{
    assert.equal(String(url),'https://gitlab.example.test/api/v4/user')
    assert.equal((init?.headers as Record<string,string>)['PRIVATE-TOKEN'],'gitlab-private-token')
    return new Response('{"username":"gitlab-user"}')
  }
  const gitlab=await post({id:'lab',name:'Lab',provider:'gitlab',host:'gitlab.example.test'},'gitlab-private-token')
  assert.equal(gitlab.connections.find((c:any)=>c.id==='lab').verification.login,'gitlab-user')
  globalThis.fetch=async()=>{throw new Error('rotated-private-token sensitive upstream diagnostic')}
  const failed=await post(input,'rotated-private-token')
  const failedConnection=failed.connections.find((c:any)=>c.id==='work')
  assert.equal(failed.warning,'verification-failed')
  assert.equal(failedConnection.verification.state,'failed')
  assert.equal(failedConnection.verification.login,undefined)
  assert.ok(!JSON.stringify(failed).includes('rotated-private-token'))
  assert.ok(!JSON.stringify(failed).includes('diagnostic'))
  globalThis.fetch=async()=>new Response('{"login":"renamed-user"}')
  const renamed=await post({...input,name:'Renamed'})
  assert.equal(renamed.connections.find((c:any)=>c.id==='work').verification.state,'verified')
  globalThis.fetch=async()=>new Response('{"login":"rotated-private-token"}')
  const reflected=await post(input)
  assert.equal(reflected.connections.find((c:any)=>c.id==='work').verification.state,'failed')
  assert.ok(!JSON.stringify(reflected).includes('rotated-private-token'))
})
