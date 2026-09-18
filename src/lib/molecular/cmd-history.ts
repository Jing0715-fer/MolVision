// 命令历史共享模块：localStorage 持久化 + 订阅通知（ConsoleBar 箭头/Ctrl+R 与 HistoryDialog 面板共享同一份）
const HISTORY_KEY = 'molvision-cmd-history'
const PIN_KEY = 'molvision-pinned-cmds'
/** 历史上限（Ctrl+R 搜索覆盖更多长命令；localStorage 持久化） */
export const HISTORY_MAX = 200
/** 置顶命令上限（防面板被刷屏） */
export const PIN_MAX = 24

const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

/** 订阅历史/置顶变化（返回取消函数） */
export function subscribeCmdHistory(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function loadCmdHistory(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    if (Array.isArray(saved)) return saved.filter(x => typeof x === 'string')
  } catch { /* ignore */ }
  return []
}

export function loadPinnedCmds(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const saved = JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]')
    if (Array.isArray(saved)) return saved.filter(x => typeof x === 'string')
  } catch { /* ignore */ }
  return []
}

/** 追加命令（去重保序，尾部为最新；超限裁剪）；通知订阅者 */
export function appendCmdHistory(cmd: string): void {
  const c = cmd.trim()
  if (!c) return
  const next = [...loadCmdHistory().filter(h => h !== c), c].slice(-HISTORY_MAX)
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  notify()
}

/** 清空历史（置顶保留）；通知订阅者 */
export function clearCmdHistory(): void {
  try { localStorage.removeItem(HISTORY_KEY) } catch { /* ignore */ }
  notify()
}

/** 置顶/取消置顶（置顶即常见工作流快跑）；通知订阅者 */
export function toggleCmdPin(cmd: string): boolean {
  const c = cmd.trim()
  if (!c) return false
  const cur = loadPinnedCmds()
  const idx = cur.indexOf(c)
  let pinned: boolean
  if (idx >= 0) {
    cur.splice(idx, 1)
    pinned = false
  } else {
    if (cur.length >= PIN_MAX) return false
    cur.push(c)
    pinned = true
  }
  try { localStorage.setItem(PIN_KEY, JSON.stringify(cur)) } catch { /* ignore */ }
  notify()
  return pinned
}

/** 触发「填入控制台输入行」事件（HistoryDialog → ConsoleBar） */
export const FILL_CMD_EVENT = 'molvision:fill-cmd'

export function dispatchFillCmd(cmd: string): void {
  window.dispatchEvent(new CustomEvent<string>(FILL_CMD_EVENT, { detail: cmd }))
}
