/** Mounted settings regression with isolated DOM and an in-memory owner API; never contacts the live Harness. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const rootRequire = createRequire(new URL('../../../package.json', import.meta.url))
const webRequire = createRequire(new URL('../../../apps/web/package.json', import.meta.url))

// The shipped browser module is JavaScript; its captured Cordis and React callback interfaces are runtime fixtures.
test('saving one inline row preserves another row name, secret and workspace draft', async t => {
  const { JSDOM } = rootRequire('jsdom')
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {url:'http://localhost'})
  const globals = ['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']
  const originals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,IS_REACT_ACT_ENVIRONMENT:true})) {
    Object.defineProperty(globalThis, key, {value, writable:true, configurable:true})
  }
  let root: any // React DOM root belongs to this test and is unmounted before global restoration.
  t.after(async () => {
    try { if (root) await React.act(async () => root.unmount()) }
    finally {
      dom.window.close()
      for (const key of globals) {
        const descriptor = originals.get(key)
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
    }
  })
  const React = webRequire('react')
  const {createRoot} = webRequire('react-dom/client')
  const {Simulate} = webRequire('react-dom/test-utils')
  let module: any // Capture the runtime module-loader protocol rather than altering public exports.
  let Component: any
  const state = {
    connections:[
      {id:'alpha',name:'Alpha',provider:'github',host:'https://github.com',verification:{state:'verified',login:'account',checkedAt:'2026-11-10T12:00:00Z'}},
      {id:'beta',name:'Beta',provider:'gitlab',host:'https://gitlab.com',verification:{state:'failed',checkedAt:'2026-11-10T12:00:00Z'}},
    ],
    workspaces:[{id:'one',title:'Workspace One'},{id:'two',title:'Workspace Two'}],
    workspaceBindings:{} as Record<string,string>, folderBindings:{},
  }
  const writes: Record<string, any>[] = [] // API JSON is external data owned by the fixture.
  dom.window.__ModuleLoader__ = {load(value: any) { module = value }}
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    window:dom.window, AbortController,
    fetch:async (path: string, options: RequestInit = {}) => {
      assert.ok(path === '/api/workain-forge' || path === '/api/workain-forge.mutate')
      assert.equal(options.credentials, 'same-origin')
      if (options.body) {
        const input = JSON.parse(String(options.body))
        writes.push(input)
        if (input.action === 'save') {
          const index = state.connections.findIndex(connection => connection.id === input.connection.id)
          assert.ok(index >= 0)
          state.connections[index] = {...input.connection}
        } else if (input.action === 'bindWorkspace') state.workspaceBindings[input.workspaceId] = input.connectionId
        else if (input.action === 'unbindWorkspace') delete state.workspaceBindings[input.workspaceId]
        else assert.fail('Unexpected mutation')
      }
      return {ok:true,json:async () => structuredClone(state)}
    },
  })
  const primitives = {
    Button: ({children,size,variant,...props}: any) => React.createElement('button',props,children),
    Input: (props: any) => React.createElement('input',props),
    Checkbox: ({label,checked,onChange,disabled,className}: any) => React.createElement('label',{className},React.createElement('input',{type:'checkbox',checked,disabled,onChange:(event: any)=>onChange(event.target.checked)}),label),
    Tag: ({children,tone}: any) => React.createElement('span',{'data-tone':tone},children),
  }
  const plugin = module.factory((id: string) => {assert.ok(['react','@deepseek-ai/dsh-client-ui-primitives'].includes(id));return id==='react'?React:primitives})
  const tKey = (key: string) => key
  plugin.apply({
    effect:(setup: () => unknown) => setup(),
    locale:{register:() => () => {},bind:() => tKey},
    slots:{inject:(_slot: string, setup: () => unknown) => setup(),register:(_options: object, component: any) => {Component=component;return () => {}}},
  })
  root = createRoot(dom.window.document.getElementById('root'))
  await React.act(async () => root.render(React.createElement(Component,{t:tKey})))
  const rows = () => [...dom.window.document.querySelectorAll('tbody tr')]
  const name = (row: Element) => row.querySelector('input[aria-label="name"]') as HTMLInputElement
  const key = (row: Element) => row.querySelector('input[type="password"]') as HTMLInputElement
  const button = (row: Element, label: string) => [...row.querySelectorAll('button')].find(item => item.textContent === label)!
  assert.equal(rows().length,2)
  assert.match(rows()[0]!.textContent!,/verified/)
  assert.match(rows()[1]!.textContent!,/failed/)
  await React.act(async () => {
    Simulate.change(name(rows()[0]!),{target:{value:'Alpha edited'}})
    Simulate.change(name(rows()[1]!),{target:{value:'Beta unsaved'}})
    Simulate.change(key(rows()[1]!),{target:{value:'private-unsaved-key'}})
    Simulate.change(rows()[1]!.querySelectorAll('input[type="checkbox"]')[1],{target:{checked:true}})
  })
  await React.act(async () => button(rows()[0]!,'save').click())
  assert.equal(state.connections[0]!.name,'Alpha edited')
  assert.equal(state.connections[1]!.name,'Beta')
  assert.equal(writes.length,1)
  assert.equal(writes[0]!.connection.id,'alpha')
  assert.equal(name(rows()[1]!).value,'Beta unsaved','another row must not remount after save')
  assert.equal(key(rows()[1]!).value,'private-unsaved-key','saving another row must not discard an unsubmitted key')
  assert.equal((rows()[1]!.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).checked,true)
  assert.equal(button(rows()[1]!,'save').disabled,false)
  assert.equal(name(rows()[0]!).value,'Alpha edited')
  assert.equal(button(rows()[0]!,'save').disabled,true)
  assert.equal(dom.window.document.querySelectorAll('table').length,1)
  assert.deepEqual([...dom.window.document.querySelectorAll('thead th')].map(item => item.textContent),['name','type','key','workspaces'])
  assert.equal(dom.window.document.querySelectorAll('form').length,0)
  state.workspaceBindings.one = 'alpha'
  const refresh = [...dom.window.document.querySelectorAll('button')].find(item => item.textContent === 'refresh')!
  await React.act(async () => refresh.click())
  assert.equal((rows()[0]!.querySelectorAll('input[type="checkbox"]')[0] as HTMLInputElement).checked,true,'Reload must reconcile authoritative bindings for clean rows')
  assert.equal(name(rows()[1]!).value,'Beta unsaved','Reload must preserve another row dirty draft')
  assert.equal(key(rows()[1]!).value,'private-unsaved-key')
  await React.act(async () => button(rows()[1]!,'save').click())
  assert.equal(state.workspaceBindings.two,'beta')
  assert.equal(button(rows()[1]!,'save').disabled,true)
  let moveConfirmations = 0
  dom.window.confirm = () => {moveConfirmations++;return true}
  await React.act(async () => Simulate.change(rows()[0]!.querySelectorAll('input[type="checkbox"]')[1],{target:{checked:true}}))
  await React.act(async () => button(rows()[0]!,'save').click())
  assert.equal(moveConfirmations,1)
  assert.equal(state.workspaceBindings.two,'alpha')
  assert.equal((rows()[0]!.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).checked,true)
  assert.equal((rows()[1]!.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).checked,false,'a clean row must lose a workspace reassigned to another connection')
  assert.equal(key(rows()[1]!).value,'','the submitted key must not be restored from server readback')
  assert.equal(rows()[0]!.querySelectorAll('.forge-chip').length,2)
  assert.equal(rows()[0]!.querySelector('details:last-child')?.hasAttribute('open'),false)
  await React.act(async () => button(rows()[0]!,'clear').click())
  assert.equal(rows()[0]!.querySelectorAll('.forge-chip').length,0)
  await React.act(async () => button(rows()[0]!,'all').click())
  assert.equal(rows()[0]!.querySelectorAll('.forge-chip').length,2)
  assert.match(rows()[0]!.textContent!,/githubHint/)
  assert.match(rows()[1]!.textContent!,/gitlabHint/)
  assert.equal(rows()[0]!.querySelector('a')?.getAttribute('href')?.startsWith('https://docs.github.com/'),true)
})
