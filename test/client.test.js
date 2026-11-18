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

/**
 * Feed the page a fixed sequence of `useState` values. A single value becomes
 * the first state, which is the settings payload; everything else keeps its
 * initial value, so a render may start before the fetches resolve.
 */
function fakeReact(states) {
  const queue = Array.isArray(states) ? states.slice() : [states]
  return {
    createElement: (type, props, ...children) => ({ type, props: { ...(props || {}), children } }),
    useState: (initial) => (queue.length ? [queue.shift(), () => {}] : [initial, () => {}]),
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

function sectionContext(registrations, dictionaries) {
  return {
    effect(fn) {
      const dispose = fn()
      return () => {
        if (typeof dispose === 'function') dispose()
      }
    },
    locale: {
      register(namespace, dicts) {
        if (dictionaries) Object.assign(dictionaries, { namespace, dicts })
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
        registrations.push({ options, component })
        return () => {}
      },
    },
  }
}

function render(states) {
  const module = loadClient()
  const registrations = []
  const dictionaries = {}
  module.factory(() => fakeReact(states)).apply(sectionContext(registrations, dictionaries))
  assert.equal(registrations.length, 1)
  const element = registrations[0].component()
  const tree = element.type(element.props)
  return { nodes: collect(tree), dictionaries, options: registrations[0].options }
}

const settingsState = {
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

function rulesState(text) {
  return {
    ok: true,
    path: 'C:/dsh/AGENTS.md',
    exists: true,
    text,
    chars: text.length,
    lines: text.split('\n').length,
    updatedAt: '2026-11-17T12:00:00.000Z',
    maxChars: 100000,
  }
}

test('the client factory registers a localized settings section', () => {
  const module = loadClient()
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
    assert.ok(keys.includes('rulesTitle'))
    assert.ok(keys.includes('rulesSave'))
    assert.ok(keys.includes('rulesMissing'))
    assert.ok(keys.includes('ghTitle'))
    assert.ok(keys.includes('ghDownload'))
    assert.ok(keys.includes('ghLogin'))
  }
})

test('the settings page renders five tier buttons and the global rules editor', () => {
  const { nodes } = render(settingsState)
  const buttons = nodes.filter((node) => node.type === 'button')
  const tiers = buttons.filter((node) => node.props.role === 'radio')
  assert.equal(tiers.length, 5)
  const selected = tiers.filter((node) => node.props['aria-checked'] === 'true')
  assert.equal(selected.length, 1)
  assert.match(String(selected[0].props.className), /ct-level-on/)

  const textareas = nodes.filter((node) => node.type === 'textarea')
  assert.equal(textareas.length, 1)
  // Before the rules fetch resolves there is nothing to save.
  assert.equal(textareas[0].props.disabled, true)
  const save = buttons.find((node) => String(node.props.className || '').includes('ct-save'))
  assert.ok(save, 'the rules panel has a save button')
  assert.equal(save.props.disabled, true)
  assert.ok(nodes.some((node) => node.type === 'style'))
})

test('the rules editor shows the saved text and enables saving an edit', () => {
  const saved = rulesState('Answer in Chinese.\n')
  const { nodes } = render([settingsState, '', false, saved, 'Answer in Chinese.\nBe brief.\n', '', false])
  const buttons = nodes.filter((node) => node.type === 'button')
  const save = buttons.find((node) => String(node.props.className || '').includes('ct-save'))
  assert.ok(save)
  assert.equal(save.props.disabled, false)
  const textareas = nodes.filter((node) => node.type === 'textarea')
  assert.equal(textareas[0].props.value, 'Answer in Chinese.\nBe brief.\n')
  assert.equal(textareas[0].props.disabled, false)
  const path = 'C:/dsh/AGENTS.md'
  const mentionsPath = nodes.some((node) => Array.isArray(node.props.children)
    && node.props.children.some((child) => typeof child === 'string' && child.includes(path)))
  assert.ok(mentionsPath, 'the panel shows the rules file path')
})

test('an unchanged rules draft keeps saving disabled', () => {
  const saved = rulesState('Answer in Chinese.\n')
  const { nodes } = render([settingsState, '', false, saved, 'Answer in Chinese.\n', '', false])
  const save = nodes
    .filter((node) => node.type === 'button')
    .find((node) => String(node.props.className || '').includes('ct-save'))
  assert.equal(save.props.disabled, true)
})

test('the GitHub CLI panel shows the installed binary and the signed-in account', () => {
  const github = {
    gh: {
      id: 'gh',
      name: 'GitHub CLI',
      version: '2.76.2',
      supported: true,
      state: 'installed',
      installed: true,
      system: false,
      systemPath: null,
      binaryPath: 'C:/dsh/compression-tiers/gh/bin/gh.exe',
      sourceKind: 'managed',
      received: 0,
      total: null,
      percent: null,
      error: null,
    },
    login: { active: false, state: 'idle', code: null, url: null, note: '', error: null, startedAt: null },
  }
  const auth = {
    available: true,
    authenticated: true,
    account: 'Homer4033',
    path: 'C:/dsh/compression-tiers/gh/bin/gh.exe',
    version: '2.76.2',
  }
  const { nodes } = render([settingsState, '', false, null, '', '', false, github, auth, '', false])
  const texts = nodes
    .filter((node) => typeof node.type === 'string')
    .flatMap((node) => (Array.isArray(node.props.children) ? node.props.children : []))
    .filter((child) => typeof child === 'string')
  assert.ok(texts.some((text) => text.includes('Homer4033')))
  assert.ok(texts.some((text) => text.includes('2.76.2')))
  assert.ok(texts.some((text) => text.includes(github.gh.binaryPath)))
  // The install button is disabled once a managed binary exists.
  const install = nodes
    .filter((node) => node.type === 'button')
    .find((node) => String(node.props.className || '').includes('ct-save') && String(node.props.children).includes('ghInstalled'))
  assert.ok(install)
  assert.equal(install.props.disabled, true)
})
