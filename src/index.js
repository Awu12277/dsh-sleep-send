/**
 * dsh-sleep-send
 * ─────────────────────────────────────────────────────────────────────────────
 * DSH Web 定时发送 Cordis Client 插件。
 *
 * 运行环境：DSH Web 的 client runner（浏览器页面）。其中 `ctx`、`React`
 * （createElement/useState/useEffect）、`styles` 等由 DSH client runner 注入，
 * `timer` / `slots` 通过 `ctx.get()` 获取。
 *
 * 功能：
 *   - 输入框右侧（conversation.input.right 槽位）的「定时发送」按钮与配置入口；
 *   - 智能时段：12:00–14:00、18:00–次日 08:00 内自动选取最近的可发送时间；
 *   - 自定义时间：支持选择具体日期（今天/明天/后天快捷 + 原生日期选择器），
 *     已过时间自动顺延一天；
 *   - 多个定时任务：确认后追加任务并清空输入框，可逐个删除；
 *   - localStorage 持久化（`dsh.sched-send.v1`）：刷新/重启后自动恢复未到期
 *     任务，15 分钟内过期的任务自动补发，更早的过期任务丢弃。
 *
 * 使用方式（在 DSH 中加载此包时）：
 *   import dshSleepSend, { apply, meta } from 'dsh-sleep-send'
 *   将 `apply` 作为 Cordis 插件的 client half 注册到会话上下文。
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const meta = {
  id: 'dsh-sleep-send',
  name: '定时发送',
  version: '1.0.0',
  description: '在输入框旁提供定时发送按钮与配置：智能时段（12:00–14:00 / 18:00–次日 08:00）最近时间、自定义日期时间、多任务、localStorage 持久化。',
}

const MIN_MS = 60 * 1000
const LS_KEY = 'dsh.sched-send.v1'
const LS_GRACE = 15 * 60 * 1000 // 恢复时：早于该阈值过期的任务直接丢弃

// ---- localStorage helpers（浏览器全局，带守卫） ----
function readLS(key) {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null
    return raw ? JSON.parse(raw) : null
  } catch (err) {
    return null
  }
}
function writeLS(key, value) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    /* 配额 / 隐私模式 */
  }
}

// ---- 时间工具 ----
const pad2 = (n) => String(n).padStart(2, '0')
const fmtHM = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
// 日期字符串必须补零（YYYY-MM-DD），同时满足原生 <input type=date> 与正则校验
const toDateStr = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
const dayKey = (d) => toDateStr(d)
const DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const fmtWhen = (t) => {
  const d = new Date(t)
  const now = new Date()
  const kd = dayKey(d), kt = dayKey(now), ktm = dayKey(new Date(now.getTime() + 86400000))
  const day = kd === kt ? '今天' : kd === ktm ? '明天' : (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + DAY_NAMES[d.getDay()]
  return day + ' ' + fmtHM(t)
}
const fmtLeft = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60
  if (h > 0) return h + ' 小时 ' + m + ' 分'
  if (m > 0) return m + ' 分 ' + x + ' 秒'
  return x + ' 秒'
}
// 可用发送时段：12:00–14:00、18:00–次日 08:00（含端点）
const inWindow = (m) => (m >= 12 * 60 && m <= 14 * 60) || (m >= 18 * 60 || m <= 8 * 60)
const nextAutoTarget = (now) => {
  const floor = new Date(now + 2 * MIN_MS) // 至少 2 分钟后
  floor.setSeconds(0, 0)
  const m = floor.getHours() * 60 + floor.getMinutes()
  if (inWindow(m)) return floor.getTime()
  const d = new Date(floor)
  if (m < 12 * 60) d.setHours(12, 0, 0, 0)
  else if (m < 18 * 60) d.setHours(18, 0, 0, 0)
  else d.setHours(12, 0, 0, 0)
  return d.getTime()
}
const CUSTOM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const nextCustomTarget = (now, dateStr, hhmm) => {
  const parts = String(hhmm).split(':')
  let t
  if (typeof dateStr === 'string' && DATE_RE.test(dateStr)) {
    const ymd = dateStr.split('-').map(Number)
    t = new Date(ymd[0], ymd[1] - 1, ymd[2])
  } else {
    t = new Date(now)
  }
  t.setHours(Number(parts[0]), Number(parts[1]), 0, 0)
  if (t.getTime() <= now + MIN_MS) t.setDate(t.getDate() + 1)
  return t.getTime()
}

export function apply(ctx) {
  const slots = ctx.get('slots')
  const timer = ctx.get('timer')
  if (slots === undefined || timer === undefined) return

  // ---- 共享内存 store（模块生命周期内） ----
  const store = {
    mode: 'auto', // 'auto' | 'custom'
    custom: { time: '12:30', date: '' }, // date: 'YYYY-MM-DD' 或 ''（自动 → 今天，已过顺延明天）
    schedules: new Map(), // sessionId -> Array<{ text, target, mode }>
    actions: new Map(), // sessionId -> InputActions
    inputs: new Map(), // sessionId -> 最近一次 InputState 快照
    open: null, // 当前打开弹窗的 sessionId
    recent: new Map(), // sessionId -> { ok, text, at }
    persisted: {}, // 从 localStorage 恢复、等待各会话认领的任务
    listeners: new Set(),
    notify() { for (const fn of this.listeners) { try { fn() } catch (err) { /* noop */ } } },
    subscribe(fn) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } },
  }

  // ---- 持久化 ----
  const persist = () => {
    const data = { mode: store.mode, custom: store.custom }
    const sched = {}
    store.schedules.forEach((list, sid) => { if (list.length > 0) sched[sid] = list.map((t) => ({ text: t.text, target: t.target, mode: t.mode })) })
    data.schedules = sched
    writeLS(LS_KEY, data)
  }
  const saved = readLS(LS_KEY)
  if (saved) {
    if (saved.mode === 'auto' || saved.mode === 'custom') store.mode = saved.mode
    if (saved.custom && typeof saved.custom === 'object' && typeof saved.custom.time === 'string') {
      store.custom = { time: saved.custom.time, date: typeof saved.custom.date === 'string' ? saved.custom.date : '' }
    }
    if (saved.schedules && typeof saved.schedules === 'object') store.persisted = saved.schedules
  }

  const listOf = (sid) => store.schedules.get(sid) || []
  const nextTaskOf = (sid) => {
    const list = listOf(sid)
    if (list.length === 0) return null
    return list.slice().sort((a, b) => a.target - b.target)[0]
  }

  // ---- 发送 ----
  const markRecent = (sid, ok, text) => {
    store.recent.set(sid, { ok, text, at: Date.now() })
    store.notify()
    timer.timeout(() => {
      const r = store.recent.get(sid)
      if (r && Date.now() - r.at >= 6000) { store.recent.delete(sid); store.notify() }
    }, 6000)
  }
  const fire = (sid, s) => {
    const actions = store.actions.get(sid)
    const snapshot = store.inputs.get(sid)
    if (!actions || typeof actions.submit !== 'function' || typeof actions.setDraft !== 'function') {
      markRecent(sid, false, '发送通道不可用，定时发送未执行')
      return
    }
    const current = snapshot ? snapshot.draft : ''
    // 绝不覆盖用户正在输入的内容：草稿已变化则取消本次发送
    if (current !== '' && current !== s.text) { markRecent(sid, false, '输入框内容已变更，本次定时发送已取消'); return }
    actions.setDraft(s.text)
    actions.submit()
    markRecent(sid, true, s.text)
  }
  // 1s 心跳：到期任务逐个发送，并驱动倒计时 UI
  timer.interval(() => {
    const now = Date.now()
    let changed = false
    store.schedules.forEach((list, sid) => {
      const due = list.filter((s) => now >= s.target)
      if (due.length > 0) {
        store.schedules.set(sid, list.filter((s) => now < s.target))
        for (const s of due) fire(sid, s)
        changed = true
      }
    })
    if (changed) persist()
    if (changed || [...store.schedules.values()].some((l) => l.length > 0)) store.notify()
  }, 1000)

  // ---- 图标 ----
  const clockIcon = React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
    React.createElement('circle', { cx: 8, cy: 8, r: 6.25 }),
    React.createElement('path', { d: 'M8 4.6V8l2.3 1.5' }))
  const gearIcon = React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
    React.createElement('circle', { cx: 8, cy: 8, r: 2.1 }),
    React.createElement('path', { d: 'M8 1.9v1.8M8 12.3v1.8M14.1 8h-1.8M3.7 8H1.9M12.3 3.7l-1.27 1.27M4.97 11.03 3.7 12.3M12.3 12.3l-1.27-1.27M4.97 4.97 3.7 3.7' }))

  // ---- 工具行按钮 + 武装芯片 ----
  // 仅使用 owner props：input.right 槽位提供实时的 { session, input } 快照；
  // standard-kit 的 useInput hook 对动态条目不可用，故不调用。
  function SchedButton(props) {
    const sessionId = props.sessionId
    const input = props.input
    const inputActions = props.inputActions
    const [, force] = React.useState(0)
    React.useEffect(() => {
      if (inputActions && typeof inputActions.submit === 'function') {
        store.actions.set(sessionId, inputActions)
      }
      return store.subscribe(() => force((x) => x + 1))
    }, [sessionId])
    React.useEffect(() => {
      if (input) store.inputs.set(sessionId, input)
      store.notify()
    }, [sessionId, input])
    // 认领本会话持久化的任务（仅一次）；近期过期的自动补发
    React.useEffect(() => {
      const savedList = store.persisted[sessionId]
      if (Array.isArray(savedList) && savedList.length > 0) {
        delete store.persisted[sessionId]
        const now = Date.now()
        const alive = savedList.filter((t) => typeof t === 'object' && t && typeof t.target === 'number' && typeof t.text === 'string' && t.target > now - LS_GRACE)
        const due = alive.filter((t) => t.target <= now)
        const future = alive.filter((t) => t.target > now)
        if (future.length > 0) store.schedules.set(sessionId, future)
        for (const t of due) fire(sessionId, t)
        if (future.length > 0 || due.length > 0) { persist(); store.notify() }
      }
    }, [sessionId])

    const draft = input ? input.draft : ''
    const list = listOf(sessionId)
    const next = nextTaskOf(sessionId)
    const rec = store.recent.get(sessionId)
    const armed = list.length > 0
    const canArm = draft.trim() !== ''
    const actionsOk = !!inputActions && typeof inputActions.submit === 'function'

    const open = () => { store.open = sessionId; store.notify() }
    const cancelAll = (e) => { e.stopPropagation(); store.schedules.delete(sessionId); persist(); store.notify() }

    const children = []
    children.push(React.createElement('button', {
      key: 'main',
      className: 'ssx-pill' + (armed ? ' ssx-armed' : '') + (!actionsOk ? ' ssx-nosend' : ''),
      disabled: (!canArm && !armed) || !actionsOk,
      onClick: open,
      title: !actionsOk ? '发送通道不可用，请刷新页面后重试' : (armed ? '已设定 ' + list.length + ' 个定时任务 · 下次 ' + fmtWhen(next.target) : (canArm ? '定时发送' : '请先输入消息内容')),
    }, [
      armed ? React.createElement('span', { key: 'dot', className: 'ssx-dot' }) : clockIcon,
      React.createElement('span', { key: 'l', className: 'ssx-pill-label' }, armed ? fmtHM(next.target) : '定时'),
      armed ? React.createElement('span', { key: 's', className: 'ssx-pill-sub' }, fmtLeft(next.target - Date.now())) : null,
      armed && list.length > 1 ? React.createElement('span', { key: 'c', className: 'ssx-cnt' }, String(list.length)) : null,
    ]))
    children.push(React.createElement('button', {
      key: 'cfg',
      className: 'ssx-cfg',
      title: '定时发送配置',
      disabled: (!canArm && !armed) || !actionsOk,
      onClick: open,
    }, gearIcon))
    if (armed) {
      children.push(React.createElement('button', { key: 'x', className: 'ssx-cancel', title: '取消全部定时任务', onClick: cancelAll }, React.createElement('span', null, '✕')))
    }
    if (rec) {
      children.push(React.createElement('div', { key: 'r', className: 'ssx-recent' + (rec.ok ? ' ssx-ok' : ' ssx-fail'), title: rec.text },
        rec.ok ? '✓ 已发送' : '✕ 未发送'))
    }
    return React.createElement('div', { className: 'ssx-control' }, children)
  }

  // ---- 配置弹窗（overlay 槽位） ----
  // overlay 槽位不提供 owner props 且 standard-kit hook 不可用，
  // 草稿从 SchedButton 维护的共享快照读取。
  function SchedPopover(props) {
    const sessionId = props.sessionId
    const [, force] = React.useState(0)
    React.useEffect(() => store.subscribe(() => force((x) => x + 1)), [sessionId])
    if (sessionId === undefined || store.open !== sessionId) return null

    const snapshot = store.inputs.get(sessionId)
    const draft = snapshot ? snapshot.draft : ''
    const empty = draft.trim() === ''
    const timeValid = CUSTOM_RE.test(store.custom.time)
    const todayStr = toDateStr(new Date())
    const pickedDate = store.custom.date || todayStr
    const dateValid = DATE_RE.test(pickedDate) && pickedDate >= todayStr
    const customValid = timeValid && dateValid
    const target = store.mode === 'auto' ? nextAutoTarget(Date.now()) : (customValid ? nextCustomTarget(Date.now(), store.custom.date, store.custom.time) : nextAutoTarget(Date.now()))
    const presets = ['12:00', '13:00', '18:00', '20:00', '22:00', '08:00']
    const list = listOf(sessionId)

    const setMode = (m) => { store.mode = m; persist(); store.notify() }
    const pickPreset = (p) => { store.custom.time = p; persist(); store.notify() }
    const setTime = (v) => { store.custom.time = v; persist(); store.notify() }
    const pickDate = (offset) => {
      const d = new Date()
      d.setDate(d.getDate() + offset)
      store.custom.date = toDateStr(d)
      persist()
      store.notify()
    }
    const setDateInput = (v) => { if (v) { store.custom.date = v; persist(); store.notify() } }
    const confirm = () => {
      if (empty) return
      const t = store.mode === 'auto' ? nextAutoTarget(Date.now()) : (customValid ? nextCustomTarget(Date.now(), store.custom.date, store.custom.time) : nextAutoTarget(Date.now()))
      const task = { text: draft.trim(), target: t, mode: store.mode }
      store.schedules.set(sessionId, [...listOf(sessionId), task])
      persist()
      store.open = null
      store.notify()
      // 释放输入框，便于继续输入下一条消息
      const actions = store.actions.get(sessionId)
      if (actions && typeof actions.setDraft === 'function') actions.setDraft('')
    }
    const close = () => { store.open = null; store.notify() }
    const removeTask = (idx) => {
      const next = listOf(sessionId).filter((_, i) => i !== idx)
      if (next.length > 0) store.schedules.set(sessionId, next)
      else store.schedules.delete(sessionId)
      persist()
      store.notify()
    }
    const confirmDisabled = empty || (store.mode === 'custom' && !customValid)

    const seg = React.createElement('div', { className: 'ssx-seg' }, [
      React.createElement('button', { key: 'auto', className: store.mode === 'auto' ? 'ssx-on' : '', onClick: () => setMode('auto') }, '智能时段'),
      React.createElement('button', { key: 'custom', className: store.mode === 'custom' ? 'ssx-on' : '', onClick: () => setMode('custom') }, '自定义时间'),
    ])

    const modeBody = store.mode === 'auto'
      ? React.createElement('div', { key: 'auto', className: 'ssx-window' }, [
          React.createElement('div', { key: 't', className: 'ssx-window-title' }, '可用发送时段'),
          React.createElement('div', { key: 'w', className: 'ssx-window-range' }, [
            React.createElement('span', { key: 'a', className: 'ssx-range' }, React.createElement('b', null, '12:00'), ' – ', React.createElement('b', null, '14:00')),
            React.createElement('span', { key: 'b', className: 'ssx-range' }, React.createElement('b', null, '18:00'), ' – 次日 ', React.createElement('b', null, '08:00')),
          ]),
          React.createElement('div', { key: 'h', className: 'ssx-window-hint' }, '自动选取两个时段内最近的可发送时间'),
        ])
      : React.createElement('div', { key: 'custom', className: 'ssx-custom' }, [
          React.createElement('input', { key: 'i', className: 'ssx-timeinput', type: 'time', value: store.custom.time, onChange: (e) => setTime(e.target.value) }),
          React.createElement('div', { key: 'd', className: 'ssx-daterow' }, [
            React.createElement('button', { key: 'd0', className: 'ssx-preset' + (pickedDate === todayStr ? ' ssx-on' : ''), onClick: () => pickDate(0) }, '今天'),
            React.createElement('button', { key: 'd1', className: 'ssx-preset' + (pickedDate === toDateStr(new Date(Date.now() + 86400000)) ? ' ssx-on' : ''), onClick: () => pickDate(1) }, '明天'),
            React.createElement('button', { key: 'd2', className: 'ssx-preset' + (pickedDate === toDateStr(new Date(Date.now() + 2 * 86400000)) ? ' ssx-on' : ''), onClick: () => pickDate(2) }, '后天'),
            React.createElement('input', { key: 'di', className: 'ssx-dateinput', type: 'date', min: todayStr, value: pickedDate, onChange: (e) => setDateInput(e.target.value) }),
          ]),
          React.createElement('div', { key: 'p', className: 'ssx-presets' }, presets.map((p) =>
            React.createElement('button', { key: p, className: 'ssx-preset' + (store.custom.time === p ? ' ssx-on' : ''), onClick: () => pickPreset(p) }, p))),
        ])

    const timeBlock = React.createElement('div', { className: 'ssx-time' }, [
      React.createElement('span', { key: 'c', className: 'ssx-time-cap' }, '发送时间'),
      React.createElement('span', { key: 'b', className: 'ssx-time-big' }, fmtWhen(target)),
      React.createElement('span', { key: 'l', className: 'ssx-time-left' }, '约 ' + fmtLeft(target - Date.now()) + ' 后'),
    ])

    const preview = React.createElement('div', { className: 'ssx-preview' }, [
      React.createElement('span', { key: 'c', className: 'ssx-preview-cap' }, '消息预览'),
      React.createElement('div', { key: 't', className: empty ? 'ssx-preview-empty' : 'ssx-preview-text' }, empty ? '请先输入要发送的消息' : draft),
    ])

    const taskList = list.length > 0
      ? React.createElement('div', { key: 'tl', className: 'ssx-list' }, [
          React.createElement('div', { key: 'h', className: 'ssx-list-head' }, '已设定 ' + list.length + ' 个定时任务'),
          list.map((t, i) => ({ t, i })).sort((a, b) => a.t.target - b.t.target).map((e) =>
            React.createElement('div', { key: e.i, className: 'ssx-item' }, [
              React.createElement('span', { key: 'tm', className: 'ssx-item-time' }, fmtWhen(e.t.target)),
              React.createElement('span', { key: 'tx', className: 'ssx-item-text', title: e.t.text }, e.t.text),
              React.createElement('button', { key: 'd', className: 'ssx-item-del', title: '删除此任务', onClick: () => removeTask(e.i) }, '✕'),
            ])),
        ])
      : null

    const foot = React.createElement('div', { className: 'ssx-foot' }, [
      React.createElement('span', { key: 'h', className: 'ssx-hint' }, '确认后输入框将清空；发送前若修改了草稿，该任务会自动取消'),
      React.createElement('button', { key: 'c', className: 'ssx-confirm', disabled: confirmDisabled, onClick: confirm }, '加入 · ' + fmtHM(target) + ' 发送'),
    ])

    return React.createElement('div', { className: 'ssx-pop-wrap' }, [
      React.createElement('div', { key: 'bk', className: 'ssx-pop-backdrop', onClick: close }),
      React.createElement('div', { key: 'panel', className: 'ssx-pop', role: 'dialog', 'aria-label': '定时发送' }, [
        React.createElement('div', { key: 'head', className: 'ssx-pop-head' }, [
          React.createElement('span', { key: 't', className: 'ssx-pop-title' }, '定时发送'),
          React.createElement('button', { key: 'c', className: 'ssx-pop-close', onClick: close }, '✕'),
        ]),
        seg,
        modeBody,
        timeBlock,
        preview,
        taskList,
        foot,
      ]),
    ])
  }

  // ---- 样式（深色精密仪器风格；含 :focus-visible / prefers-reduced-motion） ----
  styles.insert('.ssx-control{display:flex;align-items:center;gap:6px}.ssx-pill{display:inline-flex;flex:none;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1,#333a46);background:transparent;color:var(--dsw-alias-label-secondary,#97a0b0);font-size:12px;cursor:pointer;user-select:none;transition:background .15s ease,color .15s ease,border-color .15s ease;white-space:nowrap}.ssx-pill:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary,#e8ebf1) 8%,transparent);color:var(--dsw-alias-label-primary,#e8ebf1)}.ssx-pill:disabled{opacity:.38;cursor:not-allowed}.ssx-pill svg{flex:none}.ssx-pill-label{font-family:ui-monospace,"SF Mono","Cascadia Mono",Consolas,"PingFang SC",sans-serif;font-weight:600;letter-spacing:.03em}.ssx-pill-sub{font-size:11px;color:var(--dsw-alias-state-warn-primary,#f0a13a)}.ssx-armed{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f0a13a) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#f0a13a) 12%,transparent);color:var(--dsw-alias-label-primary,#e8ebf1)}.ssx-nosend{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef6d6d) 45%,transparent);color:var(--dsw-alias-state-error-primary,#ef6d6d)}.ssx-cnt{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:15px;height:14px;padding:0 4px;border-radius:8px;background:var(--dsw-alias-state-warn-primary,#f0a13a);color:#151920;font-size:10px;font-weight:700;line-height:1;text-align:center}.ssx-dot{position:relative;flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#f0a13a)}.ssx-dot::after{content:"";position:absolute;inset:-4px;border-radius:50%;background:var(--dsw-alias-state-warn-primary,#f0a13a);opacity:.55;animation:ssx-pulse 1.5s ease-in-out infinite}@keyframes ssx-pulse{0%,100%{transform:scale(.6);opacity:.7}50%{transform:scale(1.2);opacity:0}}.ssx-cfg{display:inline-flex;flex:none;align-items:center;justify-content:center;width:26px;height:26px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#97a0b0);cursor:pointer;transition:background .15s ease,color .15s ease}.ssx-cfg:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-label-primary,#e8ebf1) 8%,transparent);color:var(--dsw-alias-label-primary,#e8ebf1)}.ssx-cfg:disabled{opacity:.38;cursor:not-allowed}.ssx-cancel{display:inline-flex;flex:none;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-state-error-primary,#ef6d6d);font-size:11px;cursor:pointer;transition:background .15s ease}.ssx-cancel:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef6d6d) 14%,transparent)}.ssx-recent{display:inline-flex;align-items:center;height:24px;padding:0 8px;border-radius:8px;font-size:11px;animation:ssx-in .25s ease}.ssx-ok{color:var(--dsw-alias-state-success-primary,#3ecf8e)}.ssx-fail{color:var(--dsw-alias-state-error-primary,#ef6d6d)}.ssx-pop-wrap{position:absolute;bottom:calc(100% + 12px);right:10px;width:352px;max-width:calc(100vw - 40px)}.ssx-pop-backdrop{position:fixed;inset:-60px;z-index:1198}.ssx-pop{position:relative;z-index:1199;box-sizing:border-box;width:100%;background:var(--dsw-alias-bg-overlay,#1c2028);border:1px solid var(--dsw-alias-border-l2,#3a414e);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.5),0 4px 18px rgba(0,0,0,.35);padding:16px;color:var(--dsw-alias-label-primary,#e8ebf1);color-scheme:dark;animation:ssx-in .18s cubic-bezier(.2,.85,.25,1)}.ssx-pop::after{content:"";position:absolute;bottom:-6px;right:36px;width:11px;height:11px;background:var(--dsw-alias-bg-overlay,#1c2028);border-right:1px solid var(--dsw-alias-border-l2,#3a414e);border-bottom:1px solid var(--dsw-alias-border-l2,#3a414e);transform:rotate(45deg)}@keyframes ssx-in{from{opacity:0;transform:translateY(6px) scale(.98)}to{opacity:1;transform:none}}.ssx-pop-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}.ssx-pop-title{font-size:14px;font-weight:600;letter-spacing:.01em}.ssx-pop-close{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#97a0b0);font-size:13px;cursor:pointer}.ssx-pop-close:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary,#e8ebf1) 8%,transparent);color:var(--dsw-alias-label-primary,#e8ebf1)}.ssx-seg{display:flex;gap:3px;padding:3px;background:var(--dsw-alias-bg-layer-2,#151920);border:1px solid var(--dsw-alias-border-l1,#333a46);border-radius:11px}.ssx-seg button{flex:1;height:30px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#97a0b0);font-size:12.5px;cursor:pointer;transition:background .15s ease,color .15s ease,box-shadow .15s ease}.ssx-seg button:hover{color:var(--dsw-alias-label-primary,#e8ebf1)}.ssx-seg button.ssx-on{background:var(--dsw-alias-bg-layer-1,#262b35);color:var(--dsw-alias-label-primary,#e8ebf1);box-shadow:0 1px 4px rgba(0,0,0,.4)}.ssx-window{margin-top:12px;padding:12px 14px;background:var(--dsw-alias-bg-layer-2,#151920);border:1px solid var(--dsw-alias-border-l1,#333a46);border-radius:11px}.ssx-window-title{font-size:11px;color:var(--dsw-alias-label-secondary,#97a0b0);margin-bottom:8px;letter-spacing:.06em}.ssx-window-range{display:flex;gap:16px;align-items:center}.ssx-range{font-size:12.5px;color:var(--dsw-alias-label-secondary,#97a0b0)}.ssx-range b{color:var(--dsw-alias-label-primary,#e8ebf1);font-family:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;font-weight:600}.ssx-window-hint{margin-top:9px;font-size:11px;color:var(--dsw-alias-label-secondary,#97a0b0)}.ssx-custom{margin-top:12px;display:flex;flex-direction:column;gap:9px}.ssx-timeinput{color-scheme:dark;height:38px;padding:0 12px;border-radius:11px;border:1px solid var(--dsw-alias-border-l2,#3a414e);background:var(--dsw-alias-bg-layer-2,#151920);color:var(--dsw-alias-label-primary,#e8ebf1);font-family:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;font-size:15px;outline:none}.ssx-timeinput:focus{border-color:#3b6ef5}.ssx-timeinput:focus-visible{border-color:#5b8cff;outline:none}.ssx-daterow{display:flex;gap:6px;align-items:center}.ssx-daterow .ssx-preset{flex:none}.ssx-dateinput{color-scheme:dark;flex:1;min-width:0;height:25px;padding:0 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,#333a46);background:var(--dsw-alias-bg-layer-2,#151920);color:var(--dsw-alias-label-primary,#e8ebf1);font-family:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;font-size:12px;outline:none}.ssx-dateinput:focus-visible{border-color:#5b8cff}.ssx-presets{display:flex;flex-wrap:wrap;gap:6px}.ssx-preset{height:25px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,#333a46);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#97a0b0);font-family:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;font-size:12px;cursor:pointer;transition:all .15s ease}.ssx-preset:hover{color:var(--dsw-alias-label-primary,#e8ebf1);border-color:var(--dsw-alias-border-l2,#3a414e)}.ssx-preset.ssx-on{border-color:#3b6ef5;color:#7aa2ff;background:color-mix(in srgb,#3b6ef5 12%,transparent)}.ssx-time{display:flex;align-items:baseline;gap:10px;margin:14px 0 12px}.ssx-time-cap{font-size:11px;color:var(--dsw-alias-label-secondary,#97a0b0);letter-spacing:.06em}.ssx-time-big{font-family:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;font-size:26px;font-weight:700;letter-spacing:.01em;line-height:1.1}.ssx-time-left{font-size:12px;color:var(--dsw-alias-state-warn-primary,#f0a13a)}.ssx-preview{border-top:1px dashed var(--dsw-alias-border-l1,#333a46);padding-top:12px}.ssx-preview-cap{font-size:11px;color:var(--dsw-alias-label-secondary,#97a0b0);letter-spacing:.06em}.ssx-preview-text{margin-top:7px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#e8ebf1);max-height:40px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;white-space:pre-wrap}.ssx-preview-empty{margin-top:7px;font-size:12.5px;color:var(--dsw-alias-state-warn-primary,#f0a13a)}.ssx-list{margin-top:12px;border-top:1px dashed var(--dsw-alias-border-l1,#333a46);padding-top:10px;display:flex;flex-direction:column;gap:6px;max-height:132px;overflow:auto}.ssx-list-head{font-size:11px;color:var(--dsw-alias-label-secondary,#97a0b0);letter-spacing:.06em}.ssx-item{display:flex;align-items:center;gap:8px;background:var(--dsw-alias-bg-layer-2,#151920);border:1px solid var(--dsw-alias-border-l1,#333a46);border-radius:9px;padding:6px 9px}.ssx-item-time{flex:none;font-family:ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#e8ebf1)}.ssx-item-text{flex:1;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary,#97a0b0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.ssx-item-del{flex:none;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-state-error-primary,#ef6d6d);font-size:11px;cursor:pointer}.ssx-item-del:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef6d6d) 14%,transparent)}.ssx-foot{display:flex;align-items:center;gap:12px;margin-top:15px}.ssx-hint{flex:1;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary,#97a0b0)}.ssx-confirm{flex:none;height:32px;padding:0 15px;border:none;border-radius:9px;background:#3b6ef5;color:#fff;font-size:12.5px;font-weight:600;letter-spacing:.02em;cursor:pointer;transition:filter .15s ease,transform .05s ease}.ssx-confirm:hover:not(:disabled){filter:brightness(1.12)}.ssx-confirm:active:not(:disabled){transform:scale(.98)}.ssx-confirm:disabled{opacity:.45;cursor:not-allowed}.ssx-pill:focus-visible,.ssx-cfg:focus-visible,.ssx-cancel:focus-visible,.ssx-pop-close:focus-visible,.ssx-seg button:focus-visible,.ssx-preset:focus-visible,.ssx-confirm:focus-visible,.ssx-item-del:focus-visible{outline:2px solid #5b8cff;outline-offset:2px}.ssx-dateinput:focus-visible{border-color:#5b8cff;outline:none}@media (prefers-reduced-motion: reduce){.ssx-pop,.ssx-recent,.ssx-dot::after{animation:none}.ssx-pill,.ssx-cfg,.ssx-cancel,.ssx-pop-close,.ssx-seg button,.ssx-preset,.ssx-confirm,.ssx-item-del{transition:none}}')

  slots.inject('conversation.input.right', () => slots.register(
    { name: 'conversation.input.right', id: 'sched-send', order: 50, label: () => '定时发送' },
    SchedButton,
  ))
  slots.inject('conversation.input.overlay', () => slots.register(
    { name: 'conversation.input.overlay', id: 'sched-send-pop', order: 3, label: () => '定时发送配置' },
    SchedPopover,
  ))
}

export default { meta, apply }
