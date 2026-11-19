import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

/** Evaluate the browser module without touching a real ModuleLoader. */
function loadClient() {
  const loaded = []
  const styles = []
  const sandbox = vm.createContext({
    window: {
      __ModuleLoader__: {
        load(module) {
          loaded.push(module)
        },
      },
    },
    document: {
      createElement: () => ({ dataset: {}, setAttribute() {}, textContent: '', parentNode: null }),
      head: {
        appendChild(element) {
          element.parentNode = this
          styles.push(element)
        },
        removeChild(element) {
          element.parentNode = null
        },
      },
      querySelector: () => null,
    },
    fetch: () => Promise.resolve({ ok: true, json: async () => ({}) }),
    setTimeout,
    console,
  })
  vm.runInContext(source, sandbox)
  assert.equal(loaded.length, 1)
  return { module: loaded[0], styles }
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
    useLayoutEffect: () => {},
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
  const { module } = loadClient()
  const registrations = []
  const dictionaries = {}
  module.factory((specifier) => (specifier === 'react-dom' ? { createPortal: (node) => node } : fakeReact(states))).apply(sectionContext(registrations, dictionaries))
  const section = registrations.find((item) => item.options.name === 'settings.section')
  assert.ok(section, 'the settings section is registered')
  const element = section.component()
  const tree = element.type(element.props)
  return { nodes: collect(tree), dictionaries, options: section.options }
}

/** Render the registered session-header action with the given hook values. */
function renderHeader(states, props) {
  const { module } = loadClient()
  const registrations = []
  module.factory((specifier) => (specifier === 'react-dom' ? { createPortal: (node) => node } : fakeReact(states))).apply(sectionContext(registrations))
  const header = registrations.find((item) => item.options.name === 'conversation.session.header.actions')
  assert.ok(header, 'the session header action is registered')
  return collect(header.component(props))
}

/** The concatenated string children of one element. */
function textOf(node) {
  const children = node && Array.isArray(node.props.children) ? node.props.children : []
  return children.flat(Infinity).filter((child) => typeof child === 'string' || typeof child === 'number').join('')
}

/** Every string inside an element subtree, in order. */
function deepText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  const children = node.props && Array.isArray(node.props.children) ? node.props.children : []
  return children.map(deepText).join('')
}

function optionsOf(select) {
  const children = Array.isArray(select.props.children) ? select.props.children : []
  return children.flat(Infinity).filter((node) => node && node.type === 'option')
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
  const { module, styles } = loadClient()
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

  assert.deepEqual(
    registrations.map((item) => item.options.name).sort(),
    ['conversation.session.header.actions', 'settings.section'],
  )
  const section = registrations.find((item) => item.options.name === 'settings.section')
  assert.equal(section.options.id, 'compression-tiers')
  assert.equal(section.options.label(), 'compressionTiers:sectionLabel')
  const header = registrations.find((item) => item.options.name === 'conversation.session.header.actions')
  assert.equal(header.options.id, 'compression-repo')
  assert.equal(header.options.order, 60)
  assert.equal(header.options.locale, 'compressionTiers')
  // The sheet is injected once, globally: the header pill renders outside the
  // settings page and must not depend on that page having been opened.
  assert.equal(styles.length, 1)
  assert.match(styles[0].textContent, /\.ct-repo-pill \{/)
  assert.match(styles[0].textContent, /\.ct-page \{/)
  assert.equal(dictionaries.namespace, 'compressionTiers')
  assert.deepEqual(Object.keys(dictionaries.dicts).sort(), ['en', 'zh'])
  for (const locale of ['zh', 'en']) {
    const keys = Object.keys(dictionaries.dicts[locale])
    for (const key of [
      'title', 'levelGentle', 'currentLabel', 'rulesTitle', 'rulesSave', 'rulesMissing',
      'toolsPathTitle', 'toolsPathSave', 'toolsPathReset', 'toolsPathRunning',
      'ghTitle', 'ghDownload', 'ghLogin', 'ghCopy', 'ghOpenDevice', 'ghCancel',
      'toolsTitle', 'toolsDownloading', 'toolsUnsupported',
      'repoSelectLabel', 'repoNone', 'repoTitle',
    ]) {
      assert.ok(keys.includes(key), `${locale} is missing ${key}`)
    }
    // The settings page carries controls, state and errors only; teaching copy
    // lives in AGENTS.md, so these keys must stay gone.
    for (const key of ['intro', 'smallWindow', 'summaryMax', 'summaryGentle', 'rulesIntro', 'ghIntro', 'toolsIntro', 'ghToolNote', 'ghLoginNote']) {
      assert.equal(keys.includes(key), false, `${locale} still carries ${key}`)
    }
    // The sidebar repository panel is gone; its copy must not linger.
    assert.equal(keys.filter((key) => key.startsWith('repos')).length, 0)
  }
  assert.deepEqual(
    Object.keys(dictionaries.dicts.zh).sort(),
    Object.keys(dictionaries.dicts.en).sort(),
    'both locales carry the same keys',
  )
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
  assert.equal(nodes.some((node) => node.type === 'style'), false, 'the stylesheet is global, not page-scoped')
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

test('the session header renders a repository pill that opens a listbox', () => {
  const repos = [
    { nameWithOwner: 'Homer4033/dsh-compression-tiers', private: false },
    { nameWithOwner: 'Homer4033/private-notes', private: true },
  ]
  const nodes = renderHeader([repos, 'Homer4033/dsh-compression-tiers', '', false, true, null], {
    sessionId: 'session-a',
    t: (key) => key,
  })
  const pill = nodes.find((node) => String(node.props.className || '') === 'ct-repo-pill')
  assert.ok(pill, 'the header renders a pill button')
  assert.equal(pill.type, 'button')
  assert.equal(pill.props['aria-haspopup'], 'listbox')
  assert.equal(pill.props['aria-expanded'], 'true')
  assert.equal(pill.props['data-bound'], 'true')
  assert.equal(pill.props.disabled, false)
  assert.equal(
    textOf(nodes.find((node) => String(node.props.className || '') === 'ct-repo-value')),
    'Homer4033/dsh-compression-tiers',
  )
  const menu = nodes.find((node) => String(node.props.className || '') === 'ct-repo-menu')
  assert.ok(menu, 'the open pill renders its listbox')
  assert.equal(menu.props.role, 'listbox')
  assert.equal(menu.props.style.width, '240px')
  const options = nodes.filter((node) => String(node.props.className || '').split(' ').includes('ct-repo-option'))
  assert.deepEqual(options.map((option) => option.props['aria-selected']), ['false', 'true', 'false'])
  assert.deepEqual(options.map((option) => deepText(option)), [
    'repoNone',
    '✓Homer4033/dsh-compression-tiers',
    'Homer4033/private-notesrepoPrivate',
  ])
})

test('a retired binding stays selectable; a closed pill renders no listbox', () => {
  const retired = renderHeader([[], 'Homer4033/retired', '', false, true, null], { sessionId: 'session-b', t: (key) => key })
  const options = retired.filter((node) => String(node.props.className || '').split(' ').includes('ct-repo-option'))
  assert.deepEqual(options.map((option) => deepText(option)), ['repoNone', '✓Homer4033/retired'])
  const closed = renderHeader([[], '', '', false, false, null], { sessionId: 'session-b', t: (key) => key })
  assert.equal(closed.some((node) => String(node.props.className || '') === 'ct-repo-menu'), false)
  const disabled = renderHeader([[], '', '', false], { t: (key) => key })
  assert.equal(disabled.find((node) => String(node.props.className || '') === 'ct-repo-pill').props.disabled, true)
})

test('the header explains an unreadable repository list', () => {
  const nodes = renderHeader([[], '', 'repoUnavailable', false], { sessionId: 'session-c', t: (key) => key })
  const note = nodes.find((node) => String(node.props.className || '') === 'ct-repo-note')
  assert.ok(note, 'the header renders a status note')
  assert.equal(note.props.role, 'status')
  assert.equal(textOf(note), 'repoUnavailable')
})
test('the video-tool panel reports both binaries and disables the install button', () => {
  const tools = {
    supported: true,
    platform: 'win32',
    arch: 'x64',
    state: 'installed',
    version: '7.1.1',
    ffmpeg: { path: 'C:/dsh/compression-tiers/ffmpeg/bin/ffmpeg.exe', managed: true, version: '7.1.1' },
    ffprobe: { path: 'C:/dsh/compression-tiers/ffmpeg/bin/ffprobe.exe', managed: true, version: '7.1.1' },
    download: { running: false, received: 0, total: null, percent: null, error: null },
  }
  const { nodes } = render([settingsState, '', false, null, '', '', false, null, null, '', false, null, tools, '', false])
  const rows = nodes.filter((node) => String(node.props.className || '') === 'ct-tool')
  assert.equal(rows.length, 2)
  const names = nodes
    .filter((node) => String(node.props.className || '') === 'ct-tool-name')
    .map((node) => textOf(node))
  assert.deepEqual(names, ['ffmpeg', 'ffprobe'])
  assert.match(deepText(rows[0]), /toolsManaged v7\.1\.1/)
  assert.match(deepText(rows[0]), /ffmpeg\.exe/)
  assert.match(deepText(rows[1]), /ffprobe\.exe/)
  const install = nodes
    .filter((node) => node.type === 'button')
    .find((node) => String(node.props.className || '').includes('ct-save') && textOf(node) === 'toolsInstalled')
  assert.ok(install, 'the panel has an install button')
  assert.equal(install.props.disabled, true)
})

test('a running video-tool download shows its progress and blocks a second start', () => {
  const tools = {
    supported: true,
    platform: 'win32',
    arch: 'x64',
    state: 'missing',
    version: null,
    ffmpeg: null,
    ffprobe: null,
    download: { running: true, received: 55000000, total: 114768076, percent: 47.9, error: null },
  }
  const { nodes } = render([settingsState, '', false, null, '', '', false, null, null, '', false, null, tools, '', false])
  const button = nodes
    .filter((node) => node.type === 'button')
    .find((node) => textOf(node).startsWith('toolsDownloading') && textOf(node).includes('47.9%'))
  assert.ok(button, 'the button reports the running download')
  assert.equal(button.props.disabled, true)
  const bar = nodes.find((node) => String(node.props.className || '') === 'ct-progress')
  assert.ok(bar, 'the panel renders a progress bar')
  const fill = Array.isArray(bar.props.children) ? bar.props.children[0] : bar.props.children
  assert.equal(fill.props.style.width, '47.9%')
})

test('the video-tool button says loading until the status arrives', () => {
  const { nodes } = render([settingsState, '', false, null, '', '', false, null, null, '', false, null, null, '', false])
  const button = nodes
    .filter((node) => node.type === 'button')
    .find((node) => textOf(node) === 'toolsLoading')
  assert.ok(button, 'the panel shows a loading label instead of claiming the platform is unsupported')
  assert.equal(button.props.disabled, true)
})

test('the repository pill shows the bound name and opens a listbox', () => {
  const nodes = renderHeader([[], 'Homer4033/x', '', false], { sessionId: 'session-pill', t: (key) => key })
  const pill = nodes.find((node) => String(node.props.className || '') === 'ct-repo-pill')
  assert.ok(pill, 'the header renders a pill')
  assert.equal(pill.props['data-bound'], 'true')
  const value = nodes.find((node) => String(node.props.className || '') === 'ct-repo-value')
  assert.equal(textOf(value), 'Homer4033/x')
  const caption = nodes.find((node) => String(node.props.className || '') === 'ct-repo-caption')
  assert.equal(textOf(caption), 'repoSelectLabel')
  assert.equal(pill.props['aria-haspopup'], 'listbox')
})

test('an unbound session shows the unbound label inside the pill', () => {
  const nodes = renderHeader([[], '', '', false], { sessionId: 'session-pill', t: (key) => key })
  const pill = nodes.find((node) => String(node.props.className || '') === 'ct-repo-pill')
  assert.equal(pill.props['data-bound'], 'false')
  const value = nodes.find((node) => String(node.props.className || '') === 'ct-repo-value')
  assert.equal(textOf(value), 'repoUnbound')
})

/** The `useState` queue up to the tools-path hooks, all at their initial values. */
const IDLE_PAGE = [settingsState, '', false, null, '', '', false, null, null, '', false, null, null, '', false]

function buttonByText(nodes, text) {
  return nodes.filter((node) => node.type === 'button' && textOf(node) === text)
}

const ghState = (login) => ({
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
  login,
})

const authState = { available: true, authenticated: false, account: null, path: 'C:/dsh/compression-tiers/gh/bin/gh.exe', version: '2.76.2' }

const pathStatus = {
  path: 'D:/tools',
  defaultPath: 'C:/dsh/compression-tiers',
  isDefault: false,
  gh: { path: 'D:/tools/gh', exists: true },
  ffmpeg: { path: 'D:/tools/ffmpeg', exists: true },
  running: { gh: false, ffmpeg: false },
}

test('the sign-in buttons are always rendered and disabled while idle', () => {
  const idle = { active: false, state: 'idle', code: null, url: null, note: '', error: null, startedAt: null }
  const { nodes } = render([...IDLE_PAGE.slice(0, 7), ghState(idle), authState, '', false])
  for (const [key, reason] of [['ghCopy', 'ghLoginInactive'], ['ghOpenDevice', 'ghLoginInactive'], ['ghCancel', 'ghLoginInactive']]) {
    const buttons = buttonByText(nodes, key)
    assert.equal(buttons.length, 1, `${key} must always be rendered`)
    assert.equal(buttons[0].props.disabled, true)
    assert.equal(buttons[0].props.title, reason)
  }
  const code = nodes.find((node) => node.type === 'code')
  assert.ok(code, 'the code slot is always rendered')
  assert.equal(textOf(code), '—')
})

test('a running device flow enables copying the code and cancelling', () => {
  const active = {
    active: true,
    state: 'waiting',
    code: 'ABCD-1234',
    url: 'https://github.com/login/device',
    note: 'copy the one-time code',
    error: null,
    startedAt: 1,
  }
  const { nodes } = render([...IDLE_PAGE.slice(0, 7), ghState(active), authState, '', false])
  assert.equal(textOf(nodes.find((node) => node.type === 'code')), 'ABCD-1234')
  for (const key of ['ghCopy', 'ghOpenDevice', 'ghCancel']) {
    const buttons = buttonByText(nodes, key)
    assert.equal(buttons.length, 1)
    assert.equal(buttons[0].props.disabled, false, `${key} is usable during the flow`)
  }
})

test('the download-location panel moves both tools and resets to the default', () => {
  const unchanged = render([...IDLE_PAGE, pathStatus, null, '', false])
  const input = unchanged.nodes.find((node) => node.type === 'input')
  assert.ok(input, 'the panel always renders the directory field')
  assert.equal(input.props.value, 'D:/tools')
  assert.equal(buttonByText(unchanged.nodes, 'toolsPathSave')[0].props.disabled, true)
  assert.equal(buttonByText(unchanged.nodes, 'toolsPathReset')[0].props.disabled, false)

  const changed = render([...IDLE_PAGE, pathStatus, 'D:/other-tools', '', false])
  assert.equal(buttonByText(changed.nodes, 'toolsPathSave')[0].props.disabled, false)
  assert.equal(changed.nodes.find((node) => node.type === 'input').props.value, 'D:/other-tools')

  const relative = render([...IDLE_PAGE, pathStatus, 'tools', '', false])
  const save = buttonByText(relative.nodes, 'toolsPathSave')[0]
  assert.equal(save.props.disabled, true)
  assert.equal(save.props.title, 'toolsPathInvalid')
})

test('a running download blocks the location buttons and says why', () => {
  const running = { ...pathStatus, running: { gh: true, ffmpeg: false } }
  const { nodes } = render([...IDLE_PAGE, running, null, '', false])
  assert.equal(buttonByText(nodes, 'toolsPathSave')[0].props.disabled, true)
  assert.equal(buttonByText(nodes, 'toolsPathReset')[0].props.disabled, true)
  assert.ok(deepText({ props: { children: nodes } }).includes('toolsPathRunning'))
})

test('the location panel waits for its status instead of showing a wrong path', () => {
  const { nodes } = render([...IDLE_PAGE, null, null, '', false])
  assert.equal(buttonByText(nodes, 'toolsPathSave')[0].props.disabled, true)
  assert.equal(buttonByText(nodes, 'toolsPathReset')[0].props.disabled, true)
  assert.equal(nodes.find((node) => node.type === 'input').props.value, '')
})
