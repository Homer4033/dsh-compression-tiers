import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** Evaluate the browser module without touching a real ModuleLoader. */
function loadClient() {
  const loaded = []
  const sandbox = vm.createContext({
    window: {
      __ModuleLoader__: {
        load(module) {
          loaded.push(module)
        },
      },
    },
    document: { createElement: () => ({ dataset: {} }), head: { appendChild() {} } },
    fetch: () => Promise.resolve({ ok: true, json: async () => ({}) }),
    setTimeout,
    console,
  })
  vm.runInContext(source, sandbox)
  assert.equal(loaded.length, 1)
  return loaded[0]
}

function fakeReact(state) {
  let first = true
  return {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    useState: (initial) => {
      if (first) {
        first = false
        return [state, () => {}]
      }
      return [initial, () => {}]
    },
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
  }
}

function collect(node, out = []) {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) collect(item, out)
    return out
  }
  out.push(node)
  collect(node.props && node.props.children, out)
  return out
}

test('the client factory registers a localized settings section', () => {
  const module = loadClient()
  assert.equal(module.id, 'dsh-compression-tiers')
  const registrations = []
  let dictionaries
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    locale: {
      register(namespace, dicts) {
        dictionaries = { namespace, dicts }
        return () => {}
      },
      bind(namespace) {
        return (key) => `${namespace}:${key}`
      },
    },
    slots: {
      inject(_slot, callback) {
        return callback()
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
  module.factory(() => fakeReact(null)).apply(ctx)

  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'settings.section')
  assert.equal(registrations[0].options.id, 'compression-tiers')
  assert.equal(registrations[0].options.label(), 'compressionTiers:sectionLabel')
  assert.equal(dictionaries.namespace, 'compressionTiers')
  assert.deepEqual(Object.keys(dictionaries.dicts).sort(), ['en', 'zh'])
  for (const locale of ['zh', 'en']) {
    const keys = Object.keys(dictionaries.dicts[locale])
    assert.ok(keys.includes('title'))
    assert.ok(keys.includes('levelGentle'))
    assert.ok(keys.includes('summaryMax'))
  }
})

test('the settings page renders five tier buttons and metadata', () => {
  const module = loadClient()
  const state = {
    level: 'standard',
    levels: ['gentle', 'light', 'standard', 'aggressive', 'max'].map((id) => ({
      id,
      thresholdRatio: 0.6,
      retainRatio: 0.16,
    })),
    engines: 2,
    lastCompact: null,
    paths: { settings: 'C:/dsh/compression-tiers/settings.json' },
  }
  let registration
  const ctx = {
    effect(fn) {
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    locale: {
      register() {
        return () => {}
      },
      bind() {
        return (key) => key
      },
    },
    slots: {
      inject(_slot, callback) {
        return callback()
      },
      register(options, component) {
        registration = { options, component }
        return () => {}
      },
    },
  }
  module.factory(() => fakeReact(state)).apply(ctx)
  const element = registration.component()
  const tree = element.type(element.props)
  const nodes = collect(tree)
  const buttons = nodes.filter((node) => node.type === 'button')
  assert.equal(buttons.length, 5)
  const selected = buttons.filter((node) => node.props['aria-checked'] === 'true')
  assert.equal(selected.length, 1)
  assert.match(String(selected[0].props.className), /ct-level-on/)
  const texts = nodes.filter((node) => typeof node.type === 'string')
  assert.ok(texts.some((node) => node.type === 'style'))
})
