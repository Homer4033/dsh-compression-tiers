window.__ModuleLoader__.load({
  id: 'dsh-compression-tiers',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'compressionTiers'
    const LEVELS = ['gentle', 'light', 'standard', 'aggressive', 'max']
    const API = '/compression-tiers/api/settings'
    const RULES_API = '/compression-tiers/api/rules'
    const GH_API = '/compression-tiers/api/github'
    const GH_AUTH_API = '/compression-tiers/api/github/auth'

    const DICTIONARIES = {
      zh: {
        sectionLabel: '上下文压缩',
        title: '上下文压缩',
        intro: '五档自动压缩，切换即同步到所有预设引擎；下方还有全局规则与 GitHub CLI。',
        levelsAria: '压缩档位',
        levelGentle: '极轻',
        levelLight: '轻量',
        levelStandard: '标准',
        levelAggressive: '积极',
        levelMax: '最大',
        summaryGentle: '最晚触发，与官方默认一致。',
        summaryLight: '比官方默认早一档。',
        summaryStandard: '默认：长对话更省。',
        summaryAggressive: '更早压缩，成本优先。',
        summaryMax: '最省：40% 就压缩。',
        auto: '自动 ',
        retain: '留 ',
        sep: '：',
        currentLabel: '当前档位',
        applying: '正在切换…',
        applied: '已切换为',
        loadFailed: '读取设置失败：',
        applyFailed: '切换失败：',
        loading: '正在读取…',
        engines: '压缩引擎',
        lastCompact: '上次压缩',
        never: '暂无',
        settingsPath: '设置文件',
        smallWindow: '按 ≥256k 窗口设计；更小的窗口主要差在保留量。',
        rulesTitle: '全局规则',
        rulesIntro: '编辑官方 AGENTS.md，下次会话生效。',
        rulesLabel: '规则内容',
        rulesPlaceholder: '例如：回答用中文；改动前先读 AGENTS.md。',
        rulesSave: '保存',
        rulesSaving: '保存中…',
        rulesSaved: '已保存。',
        rulesLoadFailed: '读取失败：',
        rulesSaveFailed: '保存失败：',
        rulesChars: '字符',
        rulesPathLabel: '文件',
        rulesLoading: '读取中…',
        rulesMissing: '不存在，保存后创建。',
        ghTitle: 'GitHub CLI',
        ghIntro: '官方变更请求面板需要。系统 PATH 里已有会自动使用，也可下载托管版（v2.76.2，可断点续传）。',
        ghProbe: '重新检测',
        ghInstalled: '已安装',
        ghSystem: '系统已安装（PATH）',
        ghDownloading: '下载中 ',
        ghPartial: '未完成，可续传',
        ghFailed: '下载失败',
        ghMissing: '未安装',
        ghDownload: '下载',
        ghKeepDownload: '仍要下载',
        ghContinue: '继续下载',
        ghRetry: '重试',
        ghUnsupported: '当前系统不可用',
        ghPathLabel: '路径',
        ghAuthUnknown: '正在读取登录状态…',
        ghAuthUnavailable: '下载 GitHub CLI 后可登录。',
        ghLoggedIn: '已登录：',
        ghNotLoggedIn: '未登录',
        ghLogin: '登录 GitHub',
        ghRelogin: '重新登录',
        ghLoginStarting: '正在启动 gh 登录…',
        ghLoginNote: '在浏览器里粘贴一次性验证码并授权，完成后这里会自动更新。',
        ghLoginDone: '授权完成，凭据已由 gh 保存。',
        ghLoginFailed: '登录没有完成，可以重试。',
        ghCopy: '复制验证码',
        ghCopied: '已复制验证码',
        ghCopyFailed: '浏览器不允许复制，请手动选中验证码。',
        ghOpenDevice: '打开授权页',
        ghCancel: '取消登录',
        ghLoadFailed: '读取 GitHub CLI 状态失败：',
        ghActionFailed: '操作失败：',
      },
      en: {
        sectionLabel: 'Context compression',
        title: 'Context compression',
        intro: 'Five automatic tiers: switching syncs every preset engine. Global rules and GitHub CLI are below.',
        levelsAria: 'Compression tier',
        levelGentle: 'Gentle',
        levelLight: 'Light',
        levelStandard: 'Standard',
        levelAggressive: 'Aggressive',
        levelMax: 'Max',
        summaryGentle: 'Latest trigger, matches the official default.',
        summaryLight: 'One step earlier than the default.',
        summaryStandard: 'Default: cheaper long conversations.',
        summaryAggressive: 'Compacts sooner, cost first.',
        summaryMax: 'Cheapest: compacts at 40% of the window.',
        auto: 'Auto ',
        retain: 'keep ',
        sep: ': ',
        currentLabel: 'Current tier',
        applying: 'Switching…',
        applied: 'Switched to',
        loadFailed: 'Could not read the settings: ',
        applyFailed: 'Switch failed: ',
        loading: 'Loading…',
        engines: 'Compaction engines',
        lastCompact: 'Last compaction',
        never: 'none yet',
        settingsPath: 'Settings file',
        smallWindow: 'Designed for windows of at least 256k tokens; smaller windows mostly differ in retain size.',
        rulesTitle: 'Global rules',
        rulesIntro: 'Edits the official AGENTS.md; applies from the next session.',
        rulesLabel: 'Rules',
        rulesPlaceholder: 'For example: answer in Chinese; read AGENTS.md before a change.',
        rulesSave: 'Save',
        rulesSaving: 'Saving…',
        rulesSaved: 'Saved.',
        rulesLoadFailed: 'Could not read: ',
        rulesSaveFailed: 'Could not save: ',
        rulesChars: 'Characters',
        rulesPathLabel: 'File',
        rulesLoading: 'Loading…',
        rulesMissing: 'missing; saving creates it.',
        ghTitle: 'GitHub CLI',
        ghIntro: 'Needed by the official change-request panel. A gh on PATH is used first; the managed build (v2.76.2) can be downloaded here and resumes after an interruption.',
        ghProbe: 'Re-check',
        ghInstalled: 'Installed',
        ghSystem: 'System install (PATH)',
        ghDownloading: 'Downloading ',
        ghPartial: 'Incomplete, can resume',
        ghFailed: 'Download failed',
        ghMissing: 'Not installed',
        ghDownload: 'Download',
        ghKeepDownload: 'Download anyway',
        ghContinue: 'Resume download',
        ghRetry: 'Retry',
        ghUnsupported: 'Unavailable on this system',
        ghPathLabel: 'Path',
        ghAuthUnknown: 'Reading the sign-in state…',
        ghAuthUnavailable: 'Download GitHub CLI to sign in.',
        ghLoggedIn: 'Signed in: ',
        ghNotLoggedIn: 'Not signed in',
        ghLogin: 'Sign in to GitHub',
        ghRelogin: 'Sign in again',
        ghLoginStarting: 'Starting gh sign-in…',
        ghLoginNote: 'Paste the one-time code on the GitHub page and authorize; this panel updates by itself.',
        ghLoginDone: 'Authorization finished; gh stored the credential.',
        ghLoginFailed: 'Sign-in did not finish; you can retry.',
        ghCopy: 'Copy code',
        ghCopied: 'Code copied',
        ghCopyFailed: 'The browser would not copy; select the code manually.',
        ghOpenDevice: 'Open authorization page',
        ghCancel: 'Cancel sign-in',
        ghLoadFailed: 'Could not read the GitHub CLI state: ',
        ghActionFailed: 'Action failed: ',
      },
    }

    const CSS = `
.ct-page {
  display: grid;
  gap: 14px;
  max-width: 760px;
  padding: 8px 4px 48px;
  color: var(--dsw-alias-label-primary);
}
.ct-head {
  display: grid;
  gap: 4px;
}
.ct-head h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.02em;
}
.ct-intro {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-tertiary);
}
.ct-panel {
  display: grid;
  gap: 12px;
  padding: 16px 18px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  background: var(--dsw-alias-bg-layer-2);
}
.ct-levels {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}
@media (max-width: 640px) {
  .ct-levels {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
.ct-level {
  display: grid;
  gap: 2px;
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  margin: 0;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  padding: 10px 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ct-level strong {
  font-size: 14px;
  font-weight: 500;
}
.ct-level span {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
@media (hover: hover) {
  .ct-level:hover {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.ct-level-on,
.ct-level-on:hover {
  border-color: var(--dsw-alias-border-selected);
  background: var(--dsw-alias-bg-module-platform);
}
.ct-level:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.ct-summary {
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
.ct-note {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.ct-status {
  margin: 0;
  min-height: 18px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.ct-meta {
  display: grid;
  gap: 2px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
  word-break: break-all;
}
.ct-rules-head {
  display: grid;
  gap: 4px;
}
.ct-rules-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.ct-field {
  display: grid;
  gap: 6px;
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-secondary);
}
.ct-textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 148px;
  margin: 0;
  padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  resize: vertical;
}
.ct-textarea::placeholder {
  color: var(--dsw-alias-label-tertiary);
}
.ct-textarea:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.ct-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}
.ct-save {
  margin: 0;
  border: 1px solid var(--dsw-alias-border-selected);
  border-radius: 10px;
  padding: 6px 14px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
@media (hover: hover) {
  .ct-save:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
  }
}
.ct-save:disabled {
  border-color: var(--dsw-alias-border-l2);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}
.ct-save:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.ct-code {
  margin: 0;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
  letter-spacing: 0.08em;
}
.ct-progress {
  height: 4px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--dsw-alias-border-l2);
}
.ct-progress span {
  display: block;
  height: 100%;
  background: var(--dsw-alias-state-business-primary);
}
`

    function percent(value) {
      return Math.round((Number(value) || 0) * 100) + '%'
    }

    function labelOf(t, id) {
      const key = 'level' + id.charAt(0).toUpperCase() + id.slice(1)
      return t(key)
    }

    function summaryOf(t, id) {
      const key = 'summary' + id.charAt(0).toUpperCase() + id.slice(1)
      return t(key)
    }

    function timeLabel(value) {
      if (!value) return ''
      const date = new Date(value)
      return isNaN(date.getTime()) ? String(value) : date.toLocaleString()
    }

    function readJson(response) {
      return response.json().catch(function () { return null }).then(function (body) {
        if (!response.ok) {
          throw new Error(body && body.error ? body.error : 'HTTP ' + response.status)
        }
        return body
      })
    }

    function Page(props) {
      const t = props.t
      const [state, setState] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [rules, setRules] = React.useState(null)
      const [rulesText, setRulesText] = React.useState('')
      const [rulesMessage, setRulesMessage] = React.useState('')
      const [rulesBusy, setRulesBusy] = React.useState(false)
      const [gh, setGh] = React.useState(null)
      const [auth, setAuth] = React.useState(null)
      const [ghMessage, setGhMessage] = React.useState('')
      const [ghBusy, setGhBusy] = React.useState(false)
      const mounted = React.useRef(true)
      const buttons = React.useRef({})

      React.useEffect(function () {
        mounted.current = true
        load()
        loadRules()
        loadGithub()
        loadAuth()
        return function () {
          mounted.current = false
        }
      }, [])

      const downloading = gh && gh.gh ? gh.gh.state === 'downloading' : false
      const loggingIn = gh && gh.login ? gh.login.active === true : false
      React.useEffect(function () {
        if (!downloading) return undefined
        const timer = window.setInterval(function () { loadGithub() }, 900)
        return function () { window.clearInterval(timer) }
      }, [downloading])
      React.useEffect(function () {
        if (!loggingIn) return undefined
        const timer = window.setInterval(function () { loadGithub() }, 1500)
        return function () { window.clearInterval(timer) }
      }, [loggingIn])

      function load() {
        fetch(API, { credentials: 'same-origin' })
          .then(readJson)
          .then(function (body) {
            if (!mounted.current) return
            setState(body)
            setMessage('')
          })
          .catch(function (error) {
            if (!mounted.current) return
            setMessage(t('loadFailed') + (error && error.message ? error.message : String(error)))
          })
      }

      function applyRules(body) {
        setRules(body || null)
        setRulesText(body && typeof body.text === 'string' ? body.text : '')
      }

      function loadRules() {
        fetch(RULES_API, { credentials: 'same-origin' })
          .then(readJson)
          .then(function (body) {
            if (!mounted.current) return
            applyRules(body)
            setRulesMessage('')
          })
          .catch(function (error) {
            if (!mounted.current) return
            setRulesMessage(t('rulesLoadFailed') + (error && error.message ? error.message : String(error)))
          })
      }

      function applyGithub(body) {
        setGh({ gh: body && body.gh ? body.gh : null, login: body && body.login ? body.login : null })
      }

      function loadGithub() {
        return fetch(GH_API, { credentials: 'same-origin' })
          .then(readJson)
          .then(function (body) {
            if (!mounted.current) return
            applyGithub(body)
            if (body && body.login && body.login.state === 'success') loadAuth()
          })
          .catch(function (error) {
            if (!mounted.current) return
            setGhMessage(t('ghLoadFailed') + (error && error.message ? error.message : String(error)))
          })
      }

      function loadAuth() {
        return fetch(GH_AUTH_API, { credentials: 'same-origin' })
          .then(readJson)
          .then(function (body) {
            if (!mounted.current) return
            setAuth(body && body.auth ? body.auth : null)
          })
          .catch(function () {
            if (!mounted.current) return
            setAuth(null)
          })
      }

      function githubAction(payload) {
        return fetch(GH_API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(readJson)
      }

      function applyLogin(body) {
        setGh(function (current) { return { gh: current ? current.gh : null, login: body } })
      }

      function downloadGh() {
        if (ghBusy) return
        setGhBusy(true)
        setGhMessage('')
        githubAction({ action: 'download' })
          .then(function (body) {
            if (!mounted.current) return
            setGh(function (current) { return { gh: body.gh || null, login: current ? current.login : null } })
          })
          .catch(function (error) {
            if (!mounted.current) return
            setGhMessage(t('ghActionFailed') + (error && error.message ? error.message : String(error)))
          })
          .then(function () {
            if (mounted.current) setGhBusy(false)
          })
      }

      function loginGh() {
        if (ghBusy) return
        setGhBusy(true)
        setGhMessage('')
        githubAction({ action: 'login' })
          .then(function (body) {
            if (!mounted.current) return
            applyLogin(body)
          })
          .catch(function (error) {
            if (!mounted.current) return
            setGhMessage(t('ghActionFailed') + (error && error.message ? error.message : String(error)))
          })
          .then(function () {
            if (mounted.current) setGhBusy(false)
          })
      }

      function cancelLogin() {
        if (ghBusy) return
        setGhBusy(true)
        githubAction({ action: 'cancel' })
          .then(function (body) {
            if (!mounted.current) return
            applyLogin(body)
            setGhMessage('')
          })
          .catch(function (error) {
            if (!mounted.current) return
            setGhMessage(t('ghActionFailed') + (error && error.message ? error.message : String(error)))
          })
          .then(function () {
            if (mounted.current) setGhBusy(false)
          })
      }

      function copyCode() {
        const login = gh && gh.login
        if (!login || !login.code) return
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            navigator.clipboard.writeText(login.code).then(
              function () { if (mounted.current) setGhMessage(t('ghCopied')) },
              function () { if (mounted.current) setGhMessage(t('ghCopyFailed')) },
            )
            return
          }
        } catch {
          // Fall through to the manual-copy hint.
        }
        setGhMessage(t('ghCopyFailed'))
      }

      function openDevice() {
        const login = gh && gh.login
        const url = login && login.url ? login.url : 'https://github.com/login/device'
        window.open(url, '_blank', 'noopener,noreferrer')
      }

      function select(id) {
        if (busy || !state || state.level === id) return
        setBusy(true)
        setMessage(t('applying'))
        fetch(API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ level: id }),
        })
          .then(readJson)
          .then(function (body) {
            if (!mounted.current) return
            setState(body)
            setMessage(t('applied') + ' ' + labelOf(t, id))
          })
          .catch(function (error) {
            if (!mounted.current) return
            setMessage(t('applyFailed') + (error && error.message ? error.message : String(error)))
          })
          .then(function () {
            if (mounted.current) setBusy(false)
          })
      }

      function saveRules() {
        if (rulesBusy || !rules || rulesText === rules.text) return
        setRulesBusy(true)
        setRulesMessage(t('rulesSaving'))
        fetch(RULES_API, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ rules: rulesText }),
        })
          .then(readJson)
          .then(function (body) {
            if (!mounted.current) return
            applyRules(body)
            setRulesMessage(t('rulesSaved'))
          })
          .catch(function (error) {
            if (!mounted.current) return
            setRulesMessage(t('rulesSaveFailed') + (error && error.message ? error.message : String(error)))
          })
          .then(function () {
            if (mounted.current) setRulesBusy(false)
          })
      }

      function onKeyDown(event) {
        if (!state) return
        const at = LEVELS.indexOf(state.level)
        let target = -1
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (at + 1) % LEVELS.length
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (at - 1 + LEVELS.length) % LEVELS.length
        else if (event.key === 'Home') target = 0
        else if (event.key === 'End') target = LEVELS.length - 1
        if (target < 0) return
        event.preventDefault()
        const id = LEVELS[target]
        select(id)
        const node = buttons.current[id]
        if (node && typeof node.focus === 'function') node.focus()
      }

      const levels = state && Array.isArray(state.levels) && state.levels.length ? state.levels : LEVELS.map(function (id) {
        return { id: id }
      })
      const current = state ? state.level : ''
      const currentSummary = current ? summaryOf(t, current) : ''
      const engineCount = state && typeof state.engines === 'number' ? state.engines : 0
      const last = state && state.lastCompact
      const lastText = last && last.at
        ? timeLabel(last.at) + (last.compacted === false ? ' (' + (last.note || last.error || 'skipped') + ')' : '')
        : t('never')

      const panel = state
        ? h('section', { className: 'ct-panel' },
          h('div', { className: 'ct-levels', role: 'radiogroup', 'aria-label': t('levelsAria') },
            levels.map(function (level) {
              const id = level.id
              const selected = id === current
              return h('button', {
                key: id,
                type: 'button',
                role: 'radio',
                'aria-checked': selected ? 'true' : 'false',
                tabIndex: selected ? 0 : -1,
                disabled: busy,
                title: summaryOf(t, id),
                ref: function (node) { buttons.current[id] = node },
                className: 'ct-level' + (selected ? ' ct-level-on' : ''),
                onClick: function () { select(id) },
                onKeyDown: onKeyDown,
              },
              h('strong', null, labelOf(t, id)),
              h('span', null, t('auto') + percent(level.thresholdRatio) + ' · ' + t('retain') + percent(level.retainRatio)))
            })),
          h('p', { className: 'ct-summary' }, t('currentLabel') + t('sep') + labelOf(t, current) + (currentSummary ? ' — ' + currentSummary : '')),
          h('p', { className: 'ct-status', role: 'status', 'aria-live': 'polite' }, message))
        : h('p', { className: 'ct-intro', role: 'status' }, message || t('loading'))

      const dirty = rules ? rulesText !== rules.text : false
      const rulesCount = rules && typeof rules.chars === 'number' ? rules.chars : 0
      const rulesLimit = rules && typeof rules.maxChars === 'number' ? rules.maxChars : 0
      const rulesPanel = h('section', { className: 'ct-panel' },
        h('div', { className: 'ct-rules-head' },
          h('h3', null, t('rulesTitle')),
          h('p', { className: 'ct-note' }, t('rulesIntro'))),
        h('label', { className: 'ct-field' },
          h('span', null, t('rulesLabel')),
          h('textarea', {
            className: 'ct-textarea',
            rows: 8,
            spellCheck: false,
            value: rulesText,
            placeholder: t('rulesPlaceholder'),
            disabled: rulesBusy || !rules,
            onChange: function (event) { setRulesText(event.target.value) },
          })),
        h('div', { className: 'ct-row' },
          h('button', {
            type: 'button',
            className: 'ct-save',
            disabled: rulesBusy || !rules || !dirty,
            onClick: saveRules,
          }, rulesBusy ? t('rulesSaving') : t('rulesSave')),
          h('span', { className: 'ct-note' }, rules
            ? t('rulesChars') + ' ' + rulesCount + ' / ' + rulesLimit
            : (rulesMessage ? '' : t('rulesLoading')))),
        h('p', { className: 'ct-status', role: 'status', 'aria-live': 'polite' }, rulesMessage),
        rules && rules.path
          ? h('p', { className: 'ct-note' }, t('rulesPathLabel') + t('sep') + rules.path + (rules.exists === false ? ' — ' + t('rulesMissing') : ''))
          : null)

      const ghItem = gh && gh.gh ? gh.gh : null
      const login = gh && gh.login ? gh.login : null
      const ghSupported = ghItem ? ghItem.supported !== false : false
      const ghBusyNow = ghBusy || (ghItem ? ghItem.state === 'downloading' : false)
      const ghStateText = !ghItem
        ? t('loading')
        : ghItem.state === 'installed'
          ? t('ghInstalled')
          : ghItem.state === 'system'
            ? t('ghSystem')
            : ghItem.state === 'downloading'
              ? t('ghDownloading') + (ghItem.percent == null ? '' : ghItem.percent + '%')
              : ghItem.state === 'partial'
                ? t('ghPartial')
                : ghItem.state === 'error'
                  ? t('ghFailed')
                  : t('ghMissing')
      const downloadLabel = !ghItem || ghItem.supported === false
        ? t('ghUnsupported')
        : ghItem.state === 'installed'
          ? t('ghInstalled')
          : ghItem.state === 'system'
            ? t('ghKeepDownload')
            : ghItem.state === 'downloading'
              ? t('ghDownloading')
              : ghItem.state === 'partial'
                ? t('ghContinue')
                : ghItem.state === 'error'
                  ? t('ghRetry')
                  : t('ghDownload')
      const authText = auth === null
        ? t('ghAuthUnknown')
        : !auth.available
          ? t('ghAuthUnavailable')
          : auth.authenticated
            ? t('ghLoggedIn') + (auth.account || 'GitHub')
            : t('ghNotLoggedIn')
      const ghLoginVisible = Boolean(login && (login.active || login.state === 'success' || login.state === 'error'))
      const ghLoginLead = !login
        ? ''
        : login.active
          ? (login.code ? t('ghLoginNote') : (login.note || t('ghLoginStarting')))
          : login.state === 'success' ? t('ghLoginDone') : t('ghLoginFailed')
      const ghLoginBlock = ghLoginVisible
        ? h('div', { className: 'ct-rules-head' },
          h('p', { className: 'ct-note' }, ghLoginLead),
          login.active && login.code
            ? h('div', { className: 'ct-row' },
              h('code', { className: 'ct-code' }, login.code),
              h('button', { type: 'button', className: 'ct-save', onClick: copyCode }, t('ghCopy')))
            : null,
          login.active
            ? h('div', { className: 'ct-row' },
              h('button', { type: 'button', className: 'ct-save', onClick: openDevice }, t('ghOpenDevice')),
              h('button', { type: 'button', className: 'ct-save', disabled: ghBusy, onClick: cancelLogin }, t('ghCancel')))
            : null,
          login.error ? h('p', { className: 'ct-status', role: 'alert' }, login.error) : null)
        : null
      const ghPanel = h('section', { className: 'ct-panel' },
        h('div', { className: 'ct-rules-head' },
          h('h3', null, t('ghTitle')),
          h('p', { className: 'ct-note' }, t('ghIntro'))),
        h('div', { className: 'ct-row' },
          h('span', { className: 'ct-note' }, ghStateText),
          ghItem && ghItem.version ? h('span', { className: 'ct-note' }, 'v' + ghItem.version) : null,
          h('button', {
            type: 'button',
            className: 'ct-save',
            disabled: ghBusyNow || !ghItem || ghItem.state === 'installed' || !ghSupported,
            onClick: downloadGh,
          }, downloadLabel),
          h('button', {
            type: 'button',
            className: 'ct-save',
            onClick: function () { loadGithub(); loadAuth() },
          }, t('ghProbe'))),
        ghItem && (ghItem.state === 'downloading' || ghItem.state === 'partial') && ghItem.percent != null
          ? h('div', { className: 'ct-progress' }, h('span', { style: { width: ghItem.percent + '%' } }))
          : null,
        ghItem && ghItem.binaryPath
          ? h('p', { className: 'ct-note' }, t('ghPathLabel') + t('sep') + ghItem.binaryPath)
          : null,
        ghItem && ghItem.error ? h('p', { className: 'ct-status', role: 'alert' }, ghItem.error) : null,
        h('div', { className: 'ct-row' },
          h('span', { className: 'ct-note' }, authText),
          h('button', {
            type: 'button',
            className: 'ct-save',
            disabled: ghBusy || loggingIn || !auth || !auth.available,
            onClick: loginGh,
          }, auth && auth.authenticated ? t('ghRelogin') : t('ghLogin'))),
        ghLoginBlock,
        ghMessage ? h('p', { className: 'ct-status', role: 'status', 'aria-live': 'polite' }, ghMessage) : null)

      return h('section', { className: 'ct-page' },
        h('style', { key: 'style' }, CSS),
        h('header', { className: 'ct-head' },
          h('h2', null, t('title')),
          h('p', { className: 'ct-intro' }, t('intro'))),
        panel,
        rulesPanel,
        ghPanel,
        state
          ? h('div', { className: 'ct-meta' },
            h('span', null, t('engines') + t('sep') + engineCount),
            h('span', null, t('lastCompact') + t('sep') + lastText),
            state.paths && state.paths.settings
              ? h('span', null, t('settingsPath') + t('sep') + state.paths.settings)
              : null,
            h('span', null, t('smallWindow')))
          : null)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, DICTIONARIES)
        }, 'compression-tiers: locale')
        const t = ctx.locale.bind(NS)
        function SettingsPage() {
          return h(Page, { t: t })
        }
        ctx.slots.inject('settings.section', function () {
          return ctx.slots.register({
            name: 'settings.section',
            id: 'compression-tiers',
            order: 47,
            label: function () { return t('sectionLabel') },
          }, SettingsPage)
        })
      },
    }
  },
})
