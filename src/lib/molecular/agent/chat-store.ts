// AI 助手对话状态（模块级 zustand 单例）：独立于任何组件生命周期。
// 关键动机：欢迎页首发「load <PDB>」会在结构落地瞬间切换到工作台（AgentPanel 卸载重挂），
// 旧实现 msgs 为组件 useState —— 执行链随卸载断裂（新实例 loadChats 把 running/pending
// 全部误标为「被界面切换中断」，实际正在执行的命令与后续队列全部丢失展示）。
// 迁入模块级 store 后：视图切换零丢失，执行链跨面板实例无缝延续；
// running/pending → error 规范化仅在页面刷新（模块重新初始化）时执行一次。
import { create } from 'zustand'
import { AGENT_CHAT_KEY, AGENT_CHAT_MAX, AGENT_VISUAL_KEY, type AgentChatMessage, type AgentCmdRecord } from './protocol'

/** 忙碌阶段（思考 → 流式生成 → 执行 → 视觉自查） */
export type BusyPhase = 'think' | 'stream' | 'exec' | 'visual'

function loadChats(): AgentChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(AGENT_CHAT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as AgentChatMessage[]
    // streaming 标志与视觉截图缩略图不持久化（体积；重载后视觉消息降级为纯文字评估）；
    // 页面刷新/关闭时被中断的命令 → error 态（带重试按钮，用户可一键重跑）
    return Array.isArray(arr) ? arr.slice(-AGENT_CHAT_MAX).map(m => ({
      ...m,
      streaming: undefined,
      image: undefined,
      commands: m.commands?.map(c =>
        c.status === 'running' || c.status === 'pending'
          ? { ...c, status: 'error' as const, output: '页面刷新时被中断，可重新执行' }
          : c,
      ),
    })) : []
  } catch {
    return []
  }
}

function loadVisualPref(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(AGENT_VISUAL_KEY) !== 'off'
  } catch {
    return true
  }
}

interface AgentChatState {
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
}

export const useAgentChatStore = create<AgentChatState>((set) => ({
  msgs: loadChats(),
  busy: false,
  phase: 'think',
  visualOn: loadVisualPref(),
  setMsgs: (update) => set(s => ({ msgs: typeof update === 'function' ? update(s.msgs) : update })),
  patchCmds: (msgId, cmds) => set(s => ({ msgs: s.msgs.map(x => (x.id === msgId ? { ...x, commands: [...cmds] } : x)) })),
  setBusy: (busy) => set({ busy }),
  setPhase: (phase) => set({ phase }),
  setVisualOn: (on) => set({ visualOn: on }),
  clearMsgs: () => set({ msgs: [] }),
}))

// 持久化（模块级订阅，独立于组件生命周期）：流式进行中跳过（终值到达时统一落盘）；
// 仅 msgs 引用变化时写盘；缩略图剥离。视图切换（面板卸载）不影响本订阅。
if (typeof window !== 'undefined') {
  useAgentChatStore.subscribe((s, prev) => {
    if (s.msgs === prev.msgs) return
    if (s.msgs.some(m => m.streaming)) return
    try {
      localStorage.setItem(AGENT_CHAT_KEY, JSON.stringify(s.msgs.slice(-AGENT_CHAT_MAX).map(({ image: _img, ...rest }) => rest)))
    } catch { /* 配额满等异常静默 */ }
  })
}
