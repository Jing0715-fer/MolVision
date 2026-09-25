// AI 助手对话状态（模块级 zustand 单例）：独立于任何组件生命周期。
// 关键动机：欢迎页首发「load <PDB>」会在结构落地瞬间切换到工作台（AgentPanel 卸载重挂），
// 旧实现 msgs 为组件 useState —— 执行链随卸载断裂（新实例 loadChats 把 running/pending
// 全部误标为「被界面切换中断」，实际正在执行的命令与后续队列全部丢失展示）。
// 迁入模块级 store 后：视图切换零丢失，执行链跨面板实例无缝延续；
// running/pending → error 规范化仅在页面刷新（模块重新初始化）时执行一次。
//
// r55：多会话管理——msgs 收口为「活动会话的消息」（派生字段，引用与活动会话 messages 一致），
// setMsgs/patchCmds 等 API 语义不变（作用于活动会话；无活动会话时自动开一个），
// AgentPanel / 欢迎页浮层等既有消费零改动。会话切换/新建/删除在 busy 期间拒绝——
// 保护执行链完整性（与模块级 store 的动机同源）。
import { create } from 'zustand'
import { tt } from '@/i18n'
import { AGENT_CHAT_KEY, AGENT_CHAT_MAX, AGENT_VISUAL_KEY, type AgentChatMessage, type AgentCmdRecord } from './protocol'

/** 忙碌阶段（思考 → 流式生成 → 执行 → 视觉自查） */
export type BusyPhase = 'think' | 'stream' | 'exec' | 'visual'

/** localStorage 键（多会话 v1；旧单会话键 molvision-agent-chat 自动迁移为首个会话） */
const SESSIONS_KEY = 'molvision-agent-sessions-v1'
/** 会话数上限（控制 localStorage 占用） */
export const SESSIONS_MAX = 20
/** 单会话消息上限（超出裁最旧的一半，保留近期上下文 + 记忆摘要覆盖更早内容） */
export const SESSION_MSGS_MAX = 80

export interface AgentSession {
  id: string
  title: string
  /** 自动定题标记（用户尚未重命名——首个用户消息到达时自动取题） */
  autoTitle: boolean
  createdAt: number
  updatedAt: number
  messages: AgentChatMessage[]
}

function sid(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** 标题清洗：截 18 字，压空白 */
function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length > 18 ? `${t.slice(0, 18)}…` : t
}

/** 页面刷新时被中断的命令 → error 态（带重试按钮）；streaming/image 剥离（体积与态规范） */
function normalizeMsgs(list: AgentChatMessage[]): AgentChatMessage[] {
  return list.map(m => ({
    ...m,
    streaming: undefined,
    image: undefined,
    commands: m.commands?.map(c =>
      c.status === 'running' || c.status === 'pending'
        ? { ...c, status: 'error' as const, output: tt({ zh: '页面刷新时被中断，可重新执行', en: 'Interrupted by page refresh — you can re-run it' }) }
        : c,
    ),
  }))
}

function validMsg(x: unknown): x is AgentChatMessage {
  const m = x as Partial<AgentChatMessage>
  return typeof m?.id === 'string' && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
}

function validSession(x: unknown): AgentSession | null {
  const s = x as Partial<AgentSession>
  if (typeof s?.id !== 'string' || typeof s?.title !== 'string' || !Array.isArray(s.messages)) return null
  return {
    id: s.id,
    title: s.title || tt({ zh: '未命名会话', en: 'Untitled session' }),
    autoTitle: s.autoTitle !== false,
    createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
    updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : Date.now(),
    messages: normalizeMsgs(s.messages.filter(validMsg)),
  }
}

/** 装载：v1 多会话键优先；否则迁移旧单会话键为首个会话 */
function loadSessions(): AgentSession[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (raw) {
      const arr = JSON.parse(raw) as unknown
      if (Array.isArray(arr)) {
        const sessions = arr.map(validSession).filter((x): x is AgentSession => !!x)
        if (sessions.length) return sessions.slice(0, SESSIONS_MAX)
      }
    }
    // 旧单会话迁移（一次性）：有消息则成为第一个会话
    const legacyRaw = localStorage.getItem(AGENT_CHAT_KEY)
    if (legacyRaw) {
      try {
        const legacy = JSON.parse(legacyRaw) as unknown
        if (Array.isArray(legacy) && legacy.length) {
          const msgs = normalizeMsgs((legacy as AgentChatMessage[]).filter(validMsg).slice(-AGENT_CHAT_MAX))
          if (msgs.length) {
            const first = msgs.find(m => m.role === 'user')
            return [{
              id: sid(),
              title: first ? titleFrom(first.content) : tt({ zh: '导入的历史对话', en: 'Imported chat history' }),
              autoTitle: true,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messages: msgs,
            }]
          }
        }
      } catch { /* 旧数据损坏：视为无历史 */ }
    }
  } catch { /* localStorage 不可用：内存态 */ }
  return []
}

/** 落盘：sessions 引用变化时写 v1 键（流式进行中跳过——终值到达时统一写入；
 *  image/streaming 剥离；超限裁最旧会话）；迁移成功后清旧键 */
function persistSessions(sessions: AgentSession[]) {
  if (sessions.some(s => s.messages.some(m => m.streaming))) return
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.slice(0, SESSIONS_MAX).map(s => ({
      ...s,
      messages: s.messages.slice(-SESSION_MSGS_MAX).map(({ image: _img, streaming: _st, ...rest }) => rest),
    }))))
    if (localStorage.getItem(AGENT_CHAT_KEY) !== null) localStorage.removeItem(AGENT_CHAT_KEY)
  } catch { /* 配额满等异常静默 */ }
}

/** 消息超限裁最旧的一半 */
function capMessages(msgs: AgentChatMessage[]): AgentChatMessage[] {
  return msgs.length > SESSION_MSGS_MAX ? msgs.slice(-Math.ceil(SESSION_MSGS_MAX / 2)) : msgs
}

/** 自动定题：自动标题会话收到首个用户消息时取题 */
function retitle(s: AgentSession): AgentSession {
  if (!s.autoTitle) return s
  const first = s.messages.find(m => m.role === 'user')
  if (!first) return s
  return { ...s, title: titleFrom(first.content) }
}

function newSessionObj(): AgentSession {
  return { id: sid(), title: tt({ zh: '新会话', en: 'New session' }), autoTitle: true, createdAt: Date.now(), updatedAt: Date.now(), messages: [] }
}

interface AgentChatState {
  sessions: AgentSession[]
  activeId: string | null
  /** 活动会话的消息（派生字段——与活动会话 messages 同引用；无活动会话为 []） */
  msgs: AgentChatMessage[]
  busy: boolean
  phase: BusyPhase
  visualOn: boolean
  setMsgs: (update: AgentChatMessage[] | ((prev: AgentChatMessage[]) => AgentChatMessage[])) => void
  patchCmds: (msgId: string, cmds: AgentCmdRecord[]) => void
  setBusy: (busy: boolean) => void
  setPhase: (phase: BusyPhase) => void
  setVisualOn: (on: boolean) => void
  clearMsgs: () => void
  /** 新建会话并激活（busy 期间拒绝返回 null）；返回会话 id */
  newSession: () => string | null
  /** 切换活动会话（busy 期间拒绝返回 false） */
  switchSession: (id: string) => boolean
  renameSession: (id: string, title: string) => void
  /** 删除会话（活动会话删除在 busy 期间拒绝；删除活动会话后活动切到最新剩余） */
  deleteSession: (id: string) => boolean
  /** 会话列表（供 UI 选择器消费） */
}

const initial = loadSessions()

export const useAgentChatStore = create<AgentChatState>((set, get) => ({
  sessions: initial,
  activeId: initial[0]?.id ?? null,
  msgs: initial[0]?.messages ?? [],
  busy: false,
  phase: 'think',
  visualOn: (typeof window !== 'undefined' && (() => { try { return localStorage.getItem(AGENT_VISUAL_KEY) !== 'off' } catch { return true } })()),

  setMsgs: (update) => set(s => {
    // 无活动会话：自动开一个（首条消息即会话标题）
    let sessions = s.sessions
    let activeId = s.activeId
    let sess = sessions.find(x => x.id === activeId) ?? null
    if (!sess) {
      sess = newSessionObj()
      activeId = sess.id
      sessions = [sess, ...sessions]
    }
    const msgs = capMessages(typeof update === 'function' ? update(sess.messages) : update)
    const next = retitle({ ...sess, messages: msgs, updatedAt: Date.now() })
    return {
      sessions: sessions.map(x => (x.id === next.id ? next : x)),
      activeId,
      msgs: next.messages,
    }
  }),

  patchCmds: (msgId, cmds) => set(s => {
    const sess = s.sessions.find(x => x.id === s.activeId)
    if (!sess) return {}
    const messages = sess.messages.map(x => (x.id === msgId ? { ...x, commands: [...cmds] } : x))
    const next = { ...sess, messages, updatedAt: Date.now() }
    return {
      sessions: s.sessions.map(x => (x.id === next.id ? next : x)),
      msgs: next.messages,
    }
  }),

  setBusy: (busy) => set({ busy }),
  setPhase: (phase) => set({ phase }),
  setVisualOn: (on) => set({ visualOn: on }),

  clearMsgs: () => set(s => {
    const sess = s.sessions.find(x => x.id === s.activeId)
    if (!sess) return {}
    const next = { ...sess, messages: [], title: tt({ zh: '新会话', en: 'New session' }), autoTitle: true, updatedAt: Date.now() }
    return {
      sessions: s.sessions.map(x => (x.id === next.id ? next : x)),
      msgs: next.messages,
    }
  }),

  newSession: () => {
    if (get().busy) return null
    const sess = newSessionObj()
    set(s => {
      const sessions = [sess, ...s.sessions].slice(0, SESSIONS_MAX)
      return { sessions, activeId: sess.id, msgs: sess.messages }
    })
    return sess.id
  },

  switchSession: (id) => {
    if (get().busy) return false
    const sess = get().sessions.find(x => x.id === id)
    if (!sess) return false
    set({ activeId: id, msgs: sess.messages })
    return true
  },

  renameSession: (id, title) => {
    const t = title.trim().slice(0, 30)
    if (!t) return
    set(s => ({
      sessions: s.sessions.map(x => (x.id === id ? { ...x, title: t, autoTitle: false } : x)),
    }))
  },

  deleteSession: (id) => {
    const s = get()
    if (s.busy && id === s.activeId) return false
    if (!s.sessions.some(x => x.id === id)) return false
    const sessions = s.sessions.filter(x => x.id !== id)
    const activeId = s.activeId === id ? (sessions[0]?.id ?? null) : s.activeId
    const msgs = sessions.find(x => x.id === activeId)?.messages ?? []
    set({ sessions, activeId, msgs })
    return true
  },
}))

// 持久化（模块级订阅，独立于组件生命周期）：sessions 引用变化时写盘；
// 视图切换（面板卸载）不影响本订阅。
if (typeof window !== 'undefined') {
  useAgentChatStore.subscribe((s, prev) => {
    if (s.sessions === prev.sessions) return
    persistSessions(s.sessions)
  })
}

/** 相对时间（会话列表用）：刚刚 / N 分钟前 / HH:mm / MM-DD HH:mm */
export function sessionTimeLabel(ts: number): string {
  const d = Date.now() - ts
  if (d < 60_000) return tt({ zh: '刚刚', en: 'just now' })
  if (d < 3_600_000) return tt({ zh: `${Math.floor(d / 60_000)} 分钟前`, en: `${Math.floor(d / 60_000)} min ago` })
  const now = new Date()
  const t = new Date(ts)
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`
  if (now.toDateString() === t.toDateString()) return hm
  return `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${hm}`
}
