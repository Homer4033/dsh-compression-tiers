window.__ModuleLoader__.load({
  id: 'homerdsh-compression-tiers',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'compressionTiers'
    const LEVELS = ['gentle', 'light', 'standard', 'aggressive', 'max']
    const API = '/compression-tiers/api/settings'

    const DICTIONARIES = {
      zh: {
        sectionLabel: '上下文压缩',
        title: '上下文压缩',
        intro: '五档自动压缩策略。选中的档位会立即同步到每个已挂载的 Agent 预设压缩引擎；主动压缩由智能体判断，对话里仍可使用 /compact。',
        levelsAria: '压缩档位',
        levelGentle: '极轻',
        levelLight: '轻量',
        levelStandard: '标准',
        levelAggressive: '积极',
        levelMax: '最大',
        summaryGentle: '最贵的一档：对齐官方默认，窗口约用到 80% 才压缩，保留约 20% 原文。',
        summaryLight: '比官方默认更早：约 70% 触发压缩，保留约 18% 原文。',
        summaryStandard: '默认：大约用到窗口的 60% 时压缩，近期约 16% 保持原文，长对话更省。',
        summaryAggressive: '一半窗口就压缩，只把较短的尾部留成原文，进一步压成本。',
        summaryMax: '最省：到窗口 40% 就把旧上下文收成一条摘要。',
        auto: '自动 ',
        retain: '留 ',
        currentLabel: '当前档位',
        proactiveNote: '主动压缩：智能体在需要时调用 compression_compact，本轮结束后执行并自动继续；人类也可以在对话里输入 /compact。',
        applying: '正在切换…',
        applied: '已切换为',
        loadFailed: '读取设置失败：',
        applyFailed: '切换失败：',
        loading: '正在读取…',
        engines: '已同步的压缩引擎',
        lastCompact: '上次压缩',
        never: '暂无',
        settingsPath: '设置文件',
        smallWindow: '五档按 ≥256k tokens 窗口设计；更小的窗口受官方 65,536 输出余量限制，档位主要只剩保留量不同。',
      },
      en: {
        sectionLabel: 'Context compression',
        title: 'Context compression',
        intro: 'Five automatic compaction tiers. The selected tier is pushed immediately into every mounted agent preset compaction engine. Proactive compaction stays agent-driven, and /compact remains available in chat.',
        levelsAria: 'Compression tier',
        levelGentle: 'Gentle',
        levelLight: 'Light',
        levelStandard: 'Standard',
        levelAggressive: 'Aggressive',
        levelMax: 'Max',
        summaryGentle: 'The most expensive tier: matches the official default, compacts around 80% of the window, keeps about 20% verbatim.',
        summaryLight: 'Earlier than the official default: compacts around 70% of the window, keeps about 18% verbatim.',
        summaryStandard: 'Default: compacts around 60% of the window, keeps about 16% verbatim, so long conversations cost less.',
        summaryAggressive: 'Compacts at half the window and keeps a shorter verbatim tail.',
        summaryMax: 'The cheapest tier: folds old context into one summary at 40% of the window.',
        auto: 'Auto ',
        retain: 'keep ',
        currentLabel: 'Current tier',
        proactiveNote: 'Proactive compaction: the agent calls compression_compact when needed; it runs after the turn and continues automatically. You can also type /compact in chat.',
        applying: 'Switching…',
        applied: 'Switched to',
        loadFailed: 'Could not read the settings: ',
        applyFailed: 'Switch failed: ',
        loading: 'Loading…',
        engines: 'Synchronized compaction engines',
        lastCompact: 'Last compaction',
        never: 'none yet',
        settingsPath: 'Settings file',
        smallWindow: 'The tiers are designed for windows of at least 256k tokens. On smaller windows the official 65,536-token reserve caps the trigger, so mostly the retain size differs.',
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

    function Page(props) {
      const t = props.t
      const [state, setState] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const mounted = React.useRef(true)
      const buttons = React.useRef({})

      React.useEffect(function () {
        mounted.current = true
        load()
        return function () {
          mounted.current = false
        }
      }, [])

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

      function readJson(response) {
        return response.json().catch(function () { return null }).then(function (body) {
          if (!response.ok) {
            throw new Error(body && body.error ? body.error : 'HTTP ' + response.status)
          }
          return body
        })
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

      return h('section', { className: 'ct-page' },
        h('style', { key: 'style' }, CSS),
        h('header', { className: 'ct-head' },
          h('h2', null, t('title')),
          h('p', { className: 'ct-intro' }, t('intro'))),
        h('section', { className: 'ct-panel' },
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
          h('p', { className: 'ct-summary' }, state ? t('currentLabel') + '：' + labelOf(t, current) + (currentSummary ? ' — ' + currentSummary : '') : t('loading')),
          h('p', { className: 'ct-note' }, t('proactiveNote')),
          h('p', { className: 'ct-status', role: 'status', 'aria-live': 'polite' }, message)),
        h('div', { className: 'ct-meta' },
          h('span', null, t('engines') + '：' + engineCount),
          h('span', null, t('lastCompact') + '：' + lastText),
          state && state.paths && state.paths.settings
            ? h('span', null, t('settingsPath') + '：' + state.paths.settings)
            : null,
          h('span', null, t('smallWindow'))))
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
