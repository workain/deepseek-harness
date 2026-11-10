import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('browser module registers localized settings and keeps saved tokens out of storage', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  let definition: { factory: (require: (id: string) => object) => { apply: (ctx: object) => void } } | undefined
  vm.runInNewContext(source, {window: {__ModuleLoader__: {load(value: typeof definition) { definition = value }}}})
  assert.ok(definition)
  const plugin = definition.factory(id => { assert.ok(['react','@deepseek-ai/dsh-client-ui-primitives'].includes(id)); return id === 'react' ? { createElement: () => undefined } : {} })
  const dictionaries: Record<string, Record<string, string>>[] = []
  let registration: {id: string; label: () => string} | undefined
  plugin.apply({
    effect: (start: () => unknown) => start(),
    locale: {register: (_ns: string, value: Record<string, Record<string, string>>) => { dictionaries.push(value); return () => undefined }, bind: () => (key: string) => key},
    slots: {inject: (slot: string, start: () => unknown) => {assert.equal(slot, 'plugins.item'); return start()}, register: (value: typeof registration) => { registration=value; return () => undefined }},
  })
  assert.equal(registration?.id, 'workain-forge')
  assert.equal(registration?.label(), 'title')
  assert.deepEqual(Object.keys(dictionaries[0]!.en!).sort(), Object.keys(dictionaries[0]!.ru!).sort())
  assert.match(source, /type:'password'/)
  assert.doesNotMatch(source, /localStorage|sessionStorage|innerHTML/)
  assert.match(source, /h\('table'/)
  assert.match(source, /\['name','type','key','workspaces'\]/)
  assert.doesNotMatch(source, /h\('form'/)
  assert.doesNotMatch(source, /h\('h3',null,t\('bindings'\)\)/)
  assert.match(source, /credentials:'same-origin'/)
})
