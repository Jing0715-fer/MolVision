'use client'

// AI 助手面板：自然语言 → MolVision 命令（LLM 决策 + 白名单执行 + 命令卡片审计 + VLM 视觉自查）
// 浮动于 3D 视图右侧；对话持久化 localStorage；confirm 态命令需用户点确认；
// 视觉自查：命令执行完毕后截图送 VLM 审视渲染结果，未达标自动给出修正命令，
// 修正命令本身还会被再自查一轮（有界双轮：修到效果理想为止，不无限循环）
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Ban, Bot, Check, ChevronDown, Clock, Eye, EyeOff, Loader2, MessageSquarePlus, Pencil, RotateCw, Send, Sparkles, Square, Trash2, X, AlertTriangle, Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMolStore, engineRef } from '@/lib/molecular/store'
import { buildSceneContext } from '@/lib/molecular/agent/context'
import { classifyCmd, execAgentCmd, splitCommands } from '@/lib/molecular/agent/runner'
import { SESSIONS_MAX, sessionTimeLabel, useAgentChatStore } from '@/lib/molecular/agent/chat-store'
import {
  AGENT_VISUAL_KEY, extractPartialReply, type AgentChatMessage, type AgentCmdRecord, type AgentDecision, type AgentStreamEvent,
} from '@/lib/molecular/agent/protocol'
import { ProviderSettingsDialog, type ProviderInfo } from './ProviderSettingsDialog'
import { cn } from '@/lib/utils'
import { useI18n, tt, type DualText } from '@/i18n'

/** 分类建议（空状态展示——覆盖渲染 / 聚焦 / 分析 / 构象四类工作流） */
const SUGGESTION_GROUPS: { label: DualText; items: DualText[] }[] = [
  { label: { zh: '渲染质感', en: 'Rendering' }, items: [{ zh: '出版级渲染当前视角', en: 'Render the current view in publication quality' }, { zh: '加轮廓线和环境光遮蔽，彩虹渐变上色', en: 'Add outline and ambient occlusion, color with a rainbow gradient' }] },
  { label: { zh: '加载聚焦', en: 'Load & focus' }, items: [{ zh: '加载血红蛋白 4HHB，展示血红素口袋', en: 'Load hemoglobin 4HHB and show the heme pocket' }, { zh: '只显示螺旋并放大', en: 'Show only the helices and zoom in' }] },
  { label: { zh: '分析测量', en: 'Analyze & measure' }, items: [{ zh: '测一下血红素和最近残基的距离', en: 'Measure the distance from the heme to the nearest residue' }, { zh: '链 A 和链 B 的界面接触分析', en: 'Analyze interface contacts between chain A and chain B' }] },
  { label: { zh: '构象动画', en: 'Conformations & animation' }, items: [{ zh: '加载两个构象生成插值动画', en: 'Load two conformations and generate a morph animation' }, { zh: '轮廓线再粗一点，亮度再高一些', en: 'Make the outline a bit thicker and brighter' }] },
]

/** 非视觉命令（执行后无需视觉自查） */
const NON_VISUAL_HEADS = new Set(['count_atoms', 'count', 'help', 'history', 'get_view', 'perf', 'session', 'save'])
function isVisualCmd(cmd: string): boolean {
  const head = cmd.trim().toLowerCase().split(/\s+/)[0] ?? ''
  return !NON_VISUAL_HEADS.has(head)
}

/** 截图压缩到 ≤maxW 宽的 JPEG data URL（VLM 载荷瘦身） */
async function shrinkImage(dataUrl: string, maxW: number): Promise<string> {
  const img = new Image()
  img.src = dataUrl
  await new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error(tt({ zh: '截图加载失败', en: 'Failed to load screenshot' })))
  })
  const scale = Math.min(1, maxW / img.width)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.width * scale))
  c.height = Math.max(1, Math.round(img.height * scale))
  const ctx = c.getContext('2d')
  if (!ctx) return dataUrl
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.72)
}

/** 从消息序列提取最近的用户目标（视觉自查的判断基准） */
function lastGoalText(list: AgentChatMessage[]): string {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'user') return list[i].content
  }
  return tt({ zh: '优化当前视图的渲染效果', en: 'Improve the rendering of the current view' })
}

/** 调后端 LLM：返回决策或 null（错误已 toast）。带 image 时走 VLM 视觉自查分支（可选前后对比）；memory 为长期对话记忆摘要 */
async function callAgent(
  apiMessages: { role: 'user' | 'assistant'; content: string }[],
  scene: string,
  visual?: { image: string; goal: string; imageBefore?: string },
  memory?: string,
): Promise<AgentDecision | null> {
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(visual ? { messages: apiMessages, scene, memory, image: visual.image, goal: visual.goal, imageBefore: visual.imageBefore } : { messages: apiMessages, scene, memory }),
    })
    const data = await res.json() as { ok: boolean; decision?: AgentDecision; error?: string }
    if (!data.ok || !data.decision) {
      toast.error(`${tt({ zh: 'AI 助手出错：', en: 'AI assistant error: ' })}${data.error ?? res.statusText}`)
      return null
    }
    return data.decision
  } catch (e) {
    toast.error(`${tt({ zh: 'AI 助手网络异常：', en: 'AI assistant network error: ' })}${e instanceof Error ? e.message : tt({ zh: '未知错误', en: 'unknown error' })}`)
    return null
  }
}

/** 流式调用结果：决策 / 用户中止（携带已生成的部分文本）/ 错误（携带具体原因） */
type StreamResult =
  | { kind: 'decision'; decision: AgentDecision }
  | { kind: 'aborted'; partial: string }
  | { kind: 'error'; partial: string; err?: string }

/** 调后端流式 LLM：onDelta 收累积原文，返回最终决策；signal 中断返回 aborted */
async function callAgentStream(
  apiMessages: { role: 'user' | 'assistant'; content: string }[],
  scene: string,
  opts: { signal?: AbortSignal; onFirstDelta?: () => void; onDelta?: (acc: string) => void; memory?: string },
): Promise<StreamResult> {
  let acc = ''
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMessages, scene, memory: opts.memory, stream: true }),
      signal: opts.signal,
    })
    if (!res.ok || !res.body) {
      let msg = res.statusText
      try {
        const data = await res.json() as { error?: string }
        if (data.error) msg = data.error
      } catch { /* 非 JSON 错误体 */ }
      toast.error(`${tt({ zh: 'AI 助手出错：', en: 'AI assistant error: ' })}${msg}`)
      return { kind: 'error', partial: acc, err: msg }
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        let ev: AgentStreamEvent
        try { ev = JSON.parse(line) as AgentStreamEvent } catch { continue }
        if (ev.t === 'd') {
          const first = acc === ''
          acc += ev.v
          if (first) opts.onFirstDelta?.()
          opts.onDelta?.(acc)
        } else if (ev.t === 'end') {
          return { kind: 'decision', decision: ev.decision }
        } else if (ev.t === 'err') {
          toast.error(`${tt({ zh: 'AI 助手出错：', en: 'AI assistant error: ' })}${ev.error}`)
          return { kind: 'error', partial: acc, err: ev.error }
        }
      }
    }
    // 流意外结束（无 end 事件）：用累积文本打捞纯文本决策
    if (acc.trim().length > 4) {
      return { kind: 'decision', decision: { reply: acc.replace(/^```[a-z]*\n?|```$/g, '').trim().slice(0, 800), commands: [] } }
    }
    toast.error(tt({ zh: 'AI 助手连接中断，请重试', en: 'AI assistant connection lost, please retry' }))
    return { kind: 'error', partial: acc, err: tt({ zh: '连接中断', en: 'connection lost' }) }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { kind: 'aborted', partial: acc }
    toast.error(`${tt({ zh: 'AI 助手网络异常：', en: 'AI assistant network error: ' })}${e instanceof Error ? e.message : tt({ zh: '未知错误', en: 'unknown error' })}`)
    return { kind: 'error', partial: acc, err: e instanceof Error ? e.message : tt({ zh: '网络异常', en: 'network error' }) }
  }
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function nowTime(): string {
  const d = new Date()
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** 命令状态 → 图标与配色 */
function CmdStatusIcon({ status }: { status: AgentCmdRecord['status'] }) {
  switch (status) {
    case 'running': return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
    case 'ok': return <Check className="h-3 w-3 shrink-0 text-emerald-500" />
    case 'error': return <X className="h-3 w-3 shrink-0 text-red-500" />
    case 'confirm': return <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
    case 'blocked': return <Ban className="h-3 w-3 shrink-0 text-muted-foreground" />
    default: return <Clock className="h-3 w-3 shrink-0 text-muted-foreground/60" />
  }
}

/** 会话列表浮层（r55 多会话管理）：切换 / 新建 / 重命名（行内输入）/ 删除（两击确认）。
 *  busy 期间切换与新建由 store 层拒绝（保护执行链），浮层内非活动条目仍可删除 */
function SessionListPopover({
  open, onOpenChange, busy,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  busy: boolean
}) {
  const { t: tr } = useI18n()
  const sessions = useAgentChatStore(s => s.sessions)
  const activeId = useAgentChatStore(s => s.activeId)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 关闭浮层时清理行内编辑/删除确认态（事件回调而非 effect——避免 setState-in-effect）
  const handleOpenChange = (o: boolean) => {
    if (!o) {
      setEditingId(null)
      setConfirmDel(null)
      if (resetTimer.current) clearTimeout(resetTimer.current)
    }
    onOpenChange(o)
  }

  const armDelete = (id: string, title: string) => {
    if (confirmDel === id) {
      if (resetTimer.current) clearTimeout(resetTimer.current)
      setConfirmDel(null)
      if (useAgentChatStore.getState().deleteSession(id)) toast.success(tt({ zh: `已删除会话「${title}」`, en: `Session "${title}" deleted` }))
      else toast.info(tt({ zh: '生成中——结束后再删除当前会话', en: 'Generating — delete the current session after it finishes' }))
      return
    }
    setConfirmDel(id)
    if (resetTimer.current) clearTimeout(resetTimer.current)
    resetTimer.current = setTimeout(() => setConfirmDel(null), 2600)
  }

  const commitRename = () => {
    if (!editingId) return
    const t = draft.trim()
    if (t) useAgentChatStore.getState().renameSession(editingId, t)
    setEditingId(null)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          disabled={busy}
          title={busy ? tr({ zh: '生成中——结束后可切换会话', en: 'Generating — switch sessions after it finishes' }) : tr({ zh: '会话历史（切换 / 新建 / 重命名 / 删除）', en: 'Session history (switch / new / rename / delete)' })}
          aria-label={tr({ zh: '打开会话历史', en: 'Open session history' })}
          className={cn(
            'flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left transition',
            busy ? 'cursor-not-allowed opacity-60' : 'hover:bg-accent',
          )}
        >
          <span className="truncate text-xs font-medium">{sessions.find(s => s.id === activeId)?.title ?? tr({ zh: '新会话', en: 'New session' })}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground/70" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="bottom" className="w-64 rounded-lg border-border p-0 mol-elevate-lg">
        <div className="flex items-center justify-between border-b border-border px-2.5 py-2">
          <span className="mol-micro text-muted-foreground">{tr({ zh: `会话 ${sessions.length}/${SESSIONS_MAX}`, en: `Sessions ${sessions.length}/${SESSIONS_MAX}` })}</span>
          <button
            onClick={() => {
              const id = useAgentChatStore.getState().newSession()
              if (id) { onOpenChange(false); toast.info(tt({ zh: '已新建会话（上下文已清零）', en: 'New session created (context cleared)' })) }
              else toast.info(tt({ zh: '生成中——结束后再新建会话', en: 'Generating — create a new session after it finishes' }))
            }}
            className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-primary transition hover:bg-primary/10"
            title={tr({ zh: '新建会话（清空上下文重新开始）', en: 'New session (clear context and start over)' })}
          >
            <MessageSquarePlus className="h-3 w-3" />
            {tr({ zh: '新建', en: 'New' })}
          </button>
        </div>
        <div className="mol-scroll max-h-72 overflow-y-auto p-1.5">
          {sessions.length === 0 && (
            <p className="px-2 py-3 text-center text-[10px] text-muted-foreground">{tr({ zh: '暂无历史会话', en: 'No saved sessions yet' })}</p>
          )}
          {sessions.map(s => {
            const isActive = s.id === activeId
            const editing = editingId === s.id
            return (
              <div
                key={s.id}
                className={cn(
                  'group relative flex items-center gap-1 rounded-md px-1.5 py-1.5 transition',
                  isActive ? 'bg-accent' : 'hover:bg-accent/60',
                  busy && !isActive && 'pointer-events-none opacity-45',
                )}
              >
                {/* 活动会话左缘刻线（与图标栏 notch 同族） */}
                {isActive && <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-sm bg-primary" />}
                {editing ? (
                  <input
                    value={draft}
                    autoFocus
                    onChange={e => setDraft(e.target.value)}
                    onKeyDown={e => {
                      // IME 组合中（候选确认的 Enter）不触发重命名提交
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return
                      if (e.key === 'Enter') commitRename()
                      if (e.key === 'Escape') setEditingId(null)
                      e.stopPropagation()
                    }}
                    onBlur={commitRename}
                    aria-label={tr({ zh: '会话重命名', en: 'Rename session' })}
                    className="h-6 min-w-0 flex-1 rounded border border-primary/50 bg-background px-1.5 text-[11px] outline-none"
                  />
                ) : (
                  <button
                    onClick={() => {
                      if (useAgentChatStore.getState().switchSession(s.id)) onOpenChange(false)
                      else toast.info(tt({ zh: '生成中——结束后可切换会话', en: 'Generating — switch sessions after it finishes' }))
                    }}
                    className="min-w-0 flex-1 text-left"
                    title={tr({ zh: `切换到「${s.title}」（${s.messages.length} 条消息 · ${sessionTimeLabel(s.updatedAt)}）`, en: `Switch to "${s.title}" (${s.messages.length} messages · ${sessionTimeLabel(s.updatedAt)})` })}
                  >
                    <span className={cn('block truncate text-[11px]', isActive ? 'font-semibold text-foreground' : 'text-foreground/90')}>
                      {s.title}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[9px] tabular-nums text-muted-foreground/70">
                      {tr({ zh: `${s.messages.length} 条 · ${sessionTimeLabel(s.updatedAt)}`, en: `${s.messages.length} msgs · ${sessionTimeLabel(s.updatedAt)}` })}
                    </span>
                  </button>
                )}
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  {!editing && (
                    <button
                      onClick={() => { setEditingId(s.id); setDraft(s.autoTitle ? '' : s.title) }}
                      aria-label={tr({ zh: '重命名会话', en: 'Rename session' })}
                      title={tr({ zh: '重命名', en: 'Rename' })}
                      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/70 transition hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="h-2.5 w-2.5" />
                    </button>
                  )}
                  <button
                    onClick={() => armDelete(s.id, s.title)}
                    aria-label={confirmDel === s.id ? tr({ zh: '再次点击确认删除', en: 'Click again to confirm' }) : tr({ zh: '删除会话', en: 'Delete session' })}
                    title={confirmDel === s.id ? tr({ zh: '再次点击确认删除', en: 'Click again to confirm' }) : tr({ zh: '删除', en: 'Delete' })}
                    className={cn(
                      'flex h-5 w-5 items-center justify-center rounded transition',
                      confirmDel === s.id
                        ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                        : 'text-muted-foreground/70 hover:bg-accent hover:text-red-600 dark:hover:text-red-400',
                    )}
                  >
                    {confirmDel === s.id ? <Check className="h-3 w-3" /> : <Trash2 className="h-2.5 w-2.5" />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function AgentPanel({ float = false }: { float?: boolean }) {
  const { t } = useI18n()
  const open = useMolStore(s => s.ui.agentOpen)
  const setUi = useMolStore(s => s.setUi)
  // 对话状态存于模块级 store（而非组件 useState）：欢迎页 load <PDB> 触发视图切换时
  // AgentPanel 卸载重挂，执行链与命令进度跨面板实例无缝延续（修复「被界面切换中断」误报）
  const msgs = useAgentChatStore(s => s.msgs)
  const setMsgs = useAgentChatStore(s => s.setMsgs)
  const busy = useAgentChatStore(s => s.busy)
  const setBusy = useAgentChatStore(s => s.setBusy)
  const phase = useAgentChatStore(s => s.phase)
  const setPhase = useAgentChatStore(s => s.setPhase)
  const visualOn = useAgentChatStore(s => s.visualOn)
  const setVisualOn = useAgentChatStore(s => s.setVisualOn)
  const patchCmds = useAgentChatStore(s => s.patchCmds)
  const [input, setInput] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sessionListOpen, setSessionListOpen] = useState(false)
  const [providerOpen, setProviderOpen] = useState(false)
  /** 当前默认供应商（头部徽章 + 设置页保存后刷新） */
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  /** 当前流式请求的中断器（停止生成按钮） */
  const abortRef = useRef<AbortController | null>(null)

  // Ctrl/Cmd+J 全局开关（欢迎页与工作台通用——与 Ctrl+K 命令面板同族的互斥修饰键规范）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        setUi({ agentOpen: !useMolStore.getState().ui.agentOpen })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setUi])

  // 面板打开时拉取当前默认供应商（徽章展示模型名；失败静默降级为内置文案）
  useEffect(() => {
    if (!open || provider) return
    void (async () => {
      try {
        const res = await fetch('/api/agent/providers')
        if (!res.ok) return
        const data = (await res.json()) as { providers: ProviderInfo[] }
        setProvider(data.providers?.find(p => p.isDefault) ?? data.providers?.[0] ?? null)
      } catch { /* 静默 */ }
    })()
  }, [open, provider])

  // 持久化已迁至 chat-store 模块级订阅（独立于组件生命周期）：面板卸载/重挂不再丢失写入时机

  // 自动滚底：仅当用户已在底部附近（距底 < 80px）或 busy 刚开始（用户刚发出消息）时跟随——
  // 上翻阅读历史时不被新内容拽回底部
  const nearBottomRef = useRef(true)
  const prevBusyRef = useRef(false)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (nearBottomRef.current || (!prevBusyRef.current && busy)) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    }
    prevBusyRef.current = busy
  }, [msgs, busy])

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) taRef.current?.focus()
  }, [open])

  const toggleVisual = useCallback(() => {
    const next = !useAgentChatStore.getState().visualOn
    setVisualOn(next)
    try { localStorage.setItem(AGENT_VISUAL_KEY, next ? 'on' : 'off') } catch { /* 忽略 */ }
    toast.info(next ? tt({ zh: '视觉自查已开启：命令执行后助手会审视渲染结果并自动修正', en: 'Visual self-check on: after commands run, the assistant reviews the render and auto-corrects' }) : tt({ zh: '视觉自查已关闭', en: 'Visual self-check off' }))
  }, [setVisualOn])

  /**
   * 组装发送给后端的对话历史。
   * 注意：不在此附带命令执行摘要——scene 上下文已含「最近执行过的命令」，
   * 且历史里的伪命令格式会诱导 LLM 模仿输出（破坏 JSON 协议，实测捕获）。
   */
  const buildApiHistory = useCallback((list: AgentChatMessage[]) => list.slice(-12).map(m => ({
    role: m.role,
    content: m.content,
  })), [])

  /**
   * 长期对话记忆：最近 12 条之前的早期消息压缩为结构化摘要（用户意图 + 已执行命令 + 自查结论）。
   * 服务端注入场景上下文尾部——超出滚动窗口的对话仍被「记得」：用户引用早期轮次、
   * 避免重复已完成的工作、多步工作流跨窗口衔接（如「再加点之前那个效果」）。
   * 摘要是启发式压缩（无额外 LLM 调用）：用户消息取意图片段，助手消息取成功命令。
   */
  const buildMemoryDigest = useCallback((list: AgentChatMessage[]): string => {
    const early = list.slice(0, -12)
    if (!early.length) return ''
    const lines: string[] = []
    for (const m of early) {
      if (m.role === 'user') {
        const txt = m.content.replace(/\s+/g, ' ').trim()
        if (txt) lines.push(tt({ zh: `- 用户：「${txt.slice(0, 48)}」`, en: `- User: "${txt.slice(0, 48)}"` }))
      } else if (m.kind === 'visual') {
        const txt = m.content.replace(/\s+/g, ' ').trim()
        if (txt) lines.push(tt({ zh: `- 视觉自查：${txt.slice(0, 36)}`, en: `- Visual check: ${txt.slice(0, 36)}` }))
      } else {
        const okCmds = (m.commands ?? []).filter(c => c.status === 'ok').map(c => c.cmd)
        if (okCmds.length) lines.push(tt({ zh: `- 助手执行：${okCmds.slice(0, 5).join('；')}${okCmds.length > 5 ? ` 等 ${okCmds.length} 条` : ''}`, en: `- Assistant ran: ${okCmds.slice(0, 5).join('; ')}${okCmds.length > 5 ? ` and ${okCmds.length} more` : ''}` }))
      }
    }
    return lines.slice(-30).join('\n').slice(0, 1400)
  }, [])

  /**
   * 逐条执行命令（白名单分类；confirm 留给用户；间隔 120ms 给引擎喘息）。
   * depth：命令报错自动修正轮次（失败反馈 LLM 求修正，最多 1 轮 agentic retry）。
   * visualBudget：剩余视觉自查次数（主轮 2 → 修正后再自查 1 次 → 二次修正不再查：
   *   有界防循环，同时保证「修正 → 复查 → 直到效果理想」的闭环；修正轮的 imageBefore
   *   传入上一轮自查截图，VLM 可验证修正是否真实生效）。
   * imageBefore：本轮命令执行前的视口截图（视觉自查前后对比——判断变化是否真实发生）。
   */
  const runTurn = useCallback(async (msgId: string, cmds: string[], depth: number, priorMsgs: AgentChatMessage[], visualBudget: number, imageBefore?: string) => {
    const records: AgentCmdRecord[] = cmds.map(cmd => ({ cmd, status: 'pending' as const }))
    patchCmds(msgId, records)
    for (let i = 0; i < records.length; i++) {
      const cls = classifyCmd(records[i].cmd)
      if (cls === 'blocked') {
        records[i] = { ...records[i], status: 'blocked', output: tt({ zh: '该命令不在助手可执行白名单内（请在命令行手动执行）', en: 'This command is not in the assistant whitelist (run it manually in the command line)' }) }
      } else if (cls === 'confirm') {
        records[i] = { ...records[i], status: 'confirm', output: tt({ zh: '影响较大，请确认后执行', en: 'High impact — confirm to run' }) }
      } else {
        // 视图切换窗口兑底：load 刚落地（activeId 已设）而 MolViewer（dynamic）仍在挂载——
        // 引擎依赖命令（view from/orient/ray…）此刻会失败或入队静默。有结构但引擎缺席 →
        // 等就位再执行（≤8s；常规工作台引擎恒在场，此检查零开销）。修正轮走同一 runTurn 同样受益
        if (useMolStore.getState().activeId && !engineRef.current) {
          for (let w = 0; w < 40 && !engineRef.current; w++) await sleep(200)
        }
        records[i] = { ...records[i], status: 'running' }
        patchCmds(msgId, records)
        records[i] = await execAgentCmd(records[i].cmd)
      }
      patchCmds(msgId, records)
      await sleep(120)
    }
    // 自动修正：有失败命令且未到深度上限 → 把失败信息反馈 LLM 求修正命令
    // （附带成功命令的关键输出——多实例均布提示/加载摘要等对修正同样有价值）
    let fixTurnRan = false
    const fails = records.filter(r => r.status === 'error' && r.output)
    if (fails.length && depth < 1) {
      setPhase('think')
      const okOuts = records.filter(r => r.status === 'ok' && r.output)
        .slice(-6).map(r => `- ${r.cmd} → ${(r.output ?? '').replace(/\s+/g, ' ').slice(0, 110)}`)
      const fixPrompt = tt({ zh: `刚才这些命令执行失败了，请修正（换正确的选择表达式 / 命令写法）后重新给出命令：\n${fails.map(f => `- ${f.cmd} → ${f.output}`).join('\n')}${okOuts.length ? `\n\n已成功命令的关键输出（含系统提示，供参考）：\n${okOuts.join('\n')}` : ''}\n只给出修正后需要执行的命令，不要重复已成功的命令。`, en: `These commands just failed. Fix them (correct selection expressions / command syntax) and give the commands again:\n${fails.map(f => `- ${f.cmd} → ${f.output}`).join('\n')}${okOuts.length ? `\n\nKey output of already-successful commands (system hints included, for reference):\n${okOuts.join('\n')}` : ''}\nOnly give the corrected commands to run; do not repeat the successful ones.` })
      const fix = await callAgent([...buildApiHistory(priorMsgs), { role: 'user', content: fixPrompt }], buildSceneContext(), undefined, buildMemoryDigest(priorMsgs))
      if (fix) {
        const fixCmds = splitCommands(fix.commands)
        const fixId = newId()
        const fixMsg: AgentChatMessage = {
          id: fixId, role: 'assistant',
          content: `${tt({ zh: '自动修正：', en: 'Auto-fix: ' })}${fix.reply}`,
          time: nowTime(),
          commands: fixCmds.length ? fixCmds.map(cmd => ({ cmd, status: 'pending' as const })) : undefined,
        }
        setMsgs(m => [...m, fixMsg])
        if (fixCmds.length) { await runTurn(fixId, fixCmds, depth + 1, [...priorMsgs, fixMsg], visualBudget, imageBefore); fixTurnRan = true }
      }
    }
    // 视觉自查：修正轮已自带自查（同一画面不再重复检查，节省一次 VLM 调用）
    if (!fixTurnRan && visualBudget > 0 && visualOn && records.some(r => r.status === 'ok' && isVisualCmd(r.cmd))) {
      setPhase('visual')
      await sleep(800) // 让引擎渲染稳定（ray/异步命令落地）
      // 视图切换后引擎（MolViewer dynamic）可能仍在挂载中：等待就位再截图，自查不落空
      // （大结构 4HHB + 出版预设挂载可达 5s+，与命令前等待同款 8s 预算）
      for (let i = 0; i < 40 && !engineRef.current; i++) await sleep(200)
      // ray 阻塞期间相机 tween 被冻结（过期定时器先行触发）——等渲染循环追上、动画落位再截图
      for (let i = 0; i < 15 && engineRef.current?.isCameraAnimating(); i++) await sleep(100)
      const eng = engineRef.current
      if (eng) {
        try {
          const shot = await shrinkImage(eng.capture({ scale: 1 }), 768)
          const goal = lastGoalText(priorMsgs)
          const review = await callAgent([], buildSceneContext(), { image: shot, goal, imageBefore })
          if (review) {
            const revCmds = splitCommands(review.commands)
            const revId = newId()
            // 缩略图瘦身（≤320px，纯展示用；768 版仅送 VLM）
            let thumb: string | undefined
            try { thumb = await shrinkImage(shot, 320) } catch { thumb = undefined }
            const revMsg: AgentChatMessage = {
              id: revId, role: 'assistant', kind: 'visual',
              content: review.reply, time: nowTime(), image: thumb,
              commands: revCmds.length ? revCmds.map(cmd => ({ cmd, status: 'pending' as const })) : undefined,
            }
            setMsgs(m => [...m, revMsg])
            if (revCmds.length) {
              setPhase('exec')
              // 修正轮消耗一次自查预算；上轮截图作为 before，VLM 可验证修正真实生效
              await runTurn(revId, revCmds, depth, [...priorMsgs, revMsg], visualBudget - 1, shot)
            }
          }
        } catch { /* 截图/VLM 失败不影响主流程 */ }
      }
    }
  }, [patchCmds, buildApiHistory, buildMemoryDigest, visualOn])

  const send = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    setInput('')
    const userMsg: AgentChatMessage = { id: newId(), role: 'user', content: q, time: nowTime() }
    const history = [...msgs, userMsg]
    setMsgs(history)
    setBusy(true)
    setPhase('think')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // 占位 assistant 消息：首个增量到达时插入（避免长时间空白气泡）
    const aiId = newId()
    let inserted = false
    const ensureMsg = () => {
      if (inserted) return
      inserted = true
      setMsgs(m => [...m, { id: aiId, role: 'assistant', content: '', time: nowTime(), streaming: true }])
    }
    const patchAi = (patch: Partial<AgentChatMessage>) => {
      setMsgs(m => m.map(x => (x.id === aiId ? { ...x, ...patch } : x)))
    }
    try {
      const r = await callAgentStream(buildApiHistory(history), buildSceneContext(), {
        signal: ctrl.signal,
        memory: buildMemoryDigest(history),
        onFirstDelta: () => { ensureMsg(); setPhase('stream') },
        // 增量原文 → 渐进提取 reply 字段（JSON 半截/散文降级两态都安全）
        onDelta: acc => patchAi({ content: extractPartialReply(acc) }),
      })
      if (r.kind === 'decision') {
        const cmds = splitCommands(r.decision.commands)
        ensureMsg()
        const aiMsg: AgentChatMessage = {
          id: aiId, role: 'assistant',
          content: r.decision.reply, time: nowTime(),
          commands: cmds.length ? cmds.map(cmd => ({ cmd, status: 'pending' as const })) : undefined,
        }
        patchAi({ content: aiMsg.content, streaming: false, commands: aiMsg.commands })
        if (cmds.length) {
          setPhase('exec')
          // 执行前抓基线截图（视觉自查前后对比；结构未加载或截图失败时静默跳过）
          let before: string | undefined
          if (visualOn && cmds.some(isVisualCmd)) {
            try {
              before = await shrinkImage(engineRef.current?.capture({ scale: 1 }) ?? '', 768)
            } catch { before = undefined }
            if (!before) before = undefined
          }
          await runTurn(aiId, cmds, 0, [...history, aiMsg], 2, before)
        }
      } else if (r.kind === 'aborted') {
        ensureMsg()
        patchAi({ content: (extractPartialReply(r.partial) || '…') + tt({ zh: '（已停止）', en: ' (stopped)' }), streaming: false })
        toast.info(tt({ zh: '已停止生成', en: 'Generation stopped' }))
      } else {
        // 错误：保留已流出的部分文本；无产出时气泡携带具体原因（限流/网络等可操作信息）
        if (inserted) patchAi({ content: (extractPartialReply(r.partial) || '…') + tt({ zh: '（生成中断，请重试）', en: ' (generation interrupted, please retry)' }), streaming: false })
        else setMsgs(m => [...m, { id: newId(), role: 'assistant', content: r.err ? `${tt({ zh: '出错了：', en: 'Error: ' })}${r.err}` : tt({ zh: '出错了，请重试或换个说法。', en: 'Something went wrong. Please retry or rephrase.' }), time: nowTime() }])
      }
    } finally {
      setBusy(false)
      setPhase('think')
      if (abortRef.current === ctrl) abortRef.current = null
    }
  }, [msgs, busy, runTurn, buildApiHistory, buildMemoryDigest, visualOn])

  /** confirm 卡片的「执行 / 跳过」与「重跑」（生成中禁止——并发执行会打架） */
  const act = useCallback(async (msgId: string, idx: number, mode: 'confirm-run' | 'confirm-skip' | 'rerun') => {
    if (busy) return
    const msg = msgs.find(x => x.id === msgId)
    if (!msg?.commands?.[idx]) return
    if (mode === 'confirm-skip') {
      patchCmds(msgId, msg.commands.map((c, i) => i === idx ? { ...c, status: 'rejected' as const } : c))
      return
    }
    const next = msg.commands.map((c, i) => (i === idx ? { ...c, status: 'running' as const } : c))
    patchCmds(msgId, next)
    const r = await execAgentCmd(next[idx].cmd)
    patchCmds(msgId, next.map((c, i) => (i === idx ? r : c)))
  }, [msgs, patchCmds, busy])

  const clearChat = useCallback(() => {
    useAgentChatStore.getState().clearMsgs()
    toast.info(tt({ zh: '当前会话已清空（历史会话不受影响）', en: 'Current session cleared (other sessions untouched)' }))
  }, [])

  const startNewSession = useCallback(() => {
    if (useAgentChatStore.getState().newSession()) toast.info(tt({ zh: '已新建会话（上下文已清零）', en: 'New session created (context cleared)' }))
    else toast.info(tt({ zh: '生成中——结束后再新建会话', en: 'Generating — create a new session after it finishes' }))
  }, [])

  const onTaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }

  if (!open) return null

  const phaseLabel = phase === 'think' ? t({ zh: '正在思考', en: 'Thinking' }) : phase === 'stream' ? t({ zh: '回复生成中', en: 'Generating reply' }) : phase === 'exec' ? t({ zh: '正在执行命令', en: 'Running commands' }) : t({ zh: '视觉自查中', en: 'Visual self-check' })
  const phaseHint = phase === 'visual' ? t({ zh: '审视渲染结果', en: 'Reviewing the render' }) : phase === 'exec' ? t({ zh: '命令将自动执行', en: 'Commands run automatically' }) : phase === 'stream' ? t({ zh: '逐字生成，可随时停止', en: 'Streaming — stop anytime' }) : t({ zh: '理解你的需求', en: 'Understanding your request' })
  // 思考/流式阶段 LLM 请求可中断；命令执行与视觉自查阶段不可（停止无意义）
  const canAbort = busy && (phase === 'think' || phase === 'stream')

  return (
    <div
      className={cn(
        'agent-panel-in absolute z-30 flex flex-col rounded-lg border border-border bg-card mol-elevate',
        float
          ? 'inset-y-16 left-4 right-4 sm:left-auto sm:right-6 sm:w-[356px] sm:shadow-[0_8px_32px_oklch(0.25_0.01_80/0.14)] dark:sm:shadow-[0_8px_32px_oklch(0_0_0/0.45)]'
          : 'inset-y-3 left-3 right-3 sm:left-auto sm:w-[356px]',
      )}
      role="complementary"
      aria-label={t({ zh: 'AI 助手面板', en: 'AI assistant panel' })}
    >
      {/* 头部：会话切换器（r55 多会话）+ 供应商徽章 + 长期记忆徽章 + 工具组 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Bot className="h-3.5 w-3.5" />
        </span>
        <SessionListPopover open={sessionListOpen} onOpenChange={setSessionListOpen} busy={busy} />
        {/* 当前供应商徽章：品牌色点 + 模型名（点击打开设置） */}
        <button
          onClick={() => setProviderOpen(true)}
          title={provider ? `${provider.displayName}${provider.effectiveModel ? ` · ${provider.effectiveModel}` : ''}${t({ zh: '（点击配置供应商）', en: ' — click to configure provider' })}` : t({ zh: 'AI 供应商设置', en: 'AI provider settings' })}
          className="hidden min-w-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-px font-mono text-[9px] font-medium text-muted-foreground transition hover:border-border hover:text-foreground sm:flex"
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: provider?.brand ?? '#0e9f6e' }}
          />
          <span className="max-w-24 truncate">{provider?.effectiveModel || provider?.label || 'GLM-4.6'}</span>
          <Settings2 className="h-2.5 w-2.5 shrink-0 opacity-60" />
        </button>
        {/* 长期记忆徽章：对话超出滚动窗口（12 条）后亮起——早期轮次已压缩为记忆摘要随每轮请求携带 */}
        {msgs.length > 12 && (
          <span
            title={t({ zh: `长期记忆已激活：更早的 ${msgs.length - 12} 条消息压缩为摘要随每轮请求携带（引用早期轮次 / 避免重复已完成的工作）`, en: `Long-term memory active: the earlier ${msgs.length - 12} messages are compressed into a summary carried with every request (recall early turns / avoid repeating finished work)` })}
            className="hidden min-w-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-px font-mono text-[9px] font-medium tabular-nums text-muted-foreground lg:flex"
          >
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70 led-dot" />
            {t({ zh: '记忆', en: 'Memory' })} {msgs.length - 12}
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={startNewSession}
            disabled={busy}
            aria-label={t({ zh: '新建会话', en: 'New session' })}
            title={busy ? t({ zh: '生成中——结束后可新建', en: 'Generating — available after it finishes' }) : t({ zh: '新建会话（清空上下文重新开始）', en: 'New session (clear context and start over)' })}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition hover:bg-accent hover:text-foreground',
              busy ? 'cursor-not-allowed text-muted-foreground/40' : 'text-muted-foreground',
            )}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setProviderOpen(true)}
            aria-label={t({ zh: 'AI 供应商设置', en: 'AI provider settings' })}
            title={t({ zh: '供应商与 API Key 设置', en: 'Provider & API key settings' })}
            className="flex h-6 w-6 items-center justify-center rounded transition hover:bg-accent hover:text-foreground text-muted-foreground/70"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={toggleVisual}
            aria-label={visualOn ? t({ zh: '关闭视觉自查', en: 'Turn off visual self-check' }) : t({ zh: '开启视觉自查', en: 'Turn on visual self-check' })}
            aria-pressed={visualOn}
            title={visualOn ? t({ zh: '视觉自查已开：命令执行后审视渲染结果并自动修正', en: 'Visual self-check on: reviews the render after commands and auto-corrects' }) : t({ zh: '视觉自查已关（点击开启）', en: 'Visual self-check off (click to enable)' })}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition hover:bg-accent',
              visualOn ? 'text-primary' : 'text-muted-foreground/50',
            )}
          >
            {visualOn ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          {msgs.length > 0 && (
            <button
              onClick={clearChat}
              aria-label={t({ zh: '清空当前会话', en: 'Clear current session' })}
              title={t({ zh: '清空当前会话（历史会话不受影响）', en: 'Clear current session (other sessions untouched)' })}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setUi({ agentOpen: false })}
            aria-label={t({ zh: '关闭 AI 助手', en: 'Close AI assistant' })}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div
        ref={scrollRef}
        onScroll={() => {
          const el = scrollRef.current
          if (!el) return
          nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
        }}
        className="mol-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
      >
        {msgs.length === 0 && !busy && (
          <div className="space-y-3.5 pt-2">
            <div className="rounded-lg border border-dashed border-border bg-muted/40 px-3 py-3.5 text-center">
              <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-4.5 w-4.5" />
              </span>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {t({ zh: '用自然语言指挥整个工作台——加载、表示、着色、测量、分析、动画，我会翻译成命令自动执行。', en: 'Drive the whole workbench in natural language — load, represent, color, measure, analyze, animate. I translate it into commands and run them for you.' })}
              </p>
              {visualOn && (
                <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] text-primary">
                  <Eye className="h-2.5 w-2.5" /> {t({ zh: '执行后自动审视渲染结果', en: 'Reviews the render after every execution' })}
                </p>
              )}
            </div>
            {SUGGESTION_GROUPS.map(grp => (
              <div key={grp.label.zh} className="space-y-1.5">
                <p className="px-1 mol-micro text-muted-foreground/60">{t(grp.label)}</p>
                {grp.items.map(s => (
                  <button
                    key={s.zh}
                    onClick={() => void send(t(s))}
                    className="panel-card flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-all duration-150 hover:text-foreground hover:translate-x-0.5"
                  >
                    <Send className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                    <span className="min-w-0 flex-1">{t(s)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {msgs.map(m => (
          <div key={m.id} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
            {m.kind === 'visual' && (
              <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary">
                <Eye className="h-2.5 w-2.5" /> {t({ zh: '视觉自查', en: 'Visual check' })}
              </span>
            )}
            <div
              className={cn(
                'max-w-[92%] px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words',
                m.role === 'user'
                  ? 'rounded-lg rounded-br-sm bg-primary text-primary-foreground'
                  : cn(
                    'rounded-lg rounded-bl-sm border border-border bg-card text-foreground',
                    m.kind === 'visual' && 'border-l-2 border-l-primary/70',
                  ),
              )}
            >
              {m.content}
              {m.streaming && (
                <span aria-hidden className="ml-0.5 inline-block h-3 w-[5px] animate-pulse rounded-[1px] bg-primary align-middle" />
              )}
              {m.streaming && !m.content && <span className="sr-only">{t({ zh: '正在生成回复', en: 'Generating reply' })}</span>}
            </div>
            {/* 视觉自查附带的视口截图缩略图（自检透明化：直观看到助手「看」到了什么） */}
            {m.kind === 'visual' && m.image && (
              <img
                src={m.image}
                alt={t({ zh: '视觉自查时的视口截图', en: 'Viewport screenshot during visual self-check' })}
                className="mt-1.5 max-w-[92%] rounded-md border border-border bg-background"
                loading="lazy"
              />
            )}
            {/* 命令卡片组 */}
            {m.commands && m.commands.length > 0 && (
              <div className="mt-1.5 w-full space-y-1.5">
                {m.commands.map((c, ci) => {
                  const msgKey = `${m.id}:${ci}`
                  const isOpen = expanded[msgKey]
                  return (
                    <div
                      key={msgKey}
                      className={cn(
                        'rounded-md border bg-background px-2 py-1.5 text-[10px] transition',
                        c.status === 'ok' && 'border-emerald-500/30',
                        c.status === 'error' && 'border-red-500/40',
                        c.status === 'confirm' && 'border-amber-500/50 bg-amber-500/5',
                        c.status === 'blocked' && 'border-border opacity-70',
                        c.status === 'rejected' && 'border-border opacity-55',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <CmdStatusIcon status={c.status} />
                        <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-snug">{c.cmd}</code>
                        {(c.status === 'ok' || c.status === 'error') && (
                          <button
                            onClick={() => void act(m.id, ci, 'rerun')}
                            aria-label={t({ zh: '重新执行此命令', en: 'Re-run this command' })}
                            title={t({ zh: '重新执行', en: 'Re-run' })}
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition hover:bg-accent hover:text-foreground"
                          >
                            <RotateCw className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {c.status === 'confirm' && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <button
                            onClick={() => void act(m.id, ci, 'confirm-run')}
                            className="rounded bg-amber-600 px-2 py-0.5 text-[10px] font-medium text-white transition hover:bg-amber-500"
                          >
                            {t({ zh: '确认执行', en: 'Confirm run' })}
                          </button>
                          <button
                            onClick={() => void act(m.id, ci, 'confirm-skip')}
                            className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition hover:bg-accent"
                          >
                            {t({ zh: '跳过', en: 'Skip' })}
                          </button>
                        </div>
                      )}
                      {c.output && (
                        <button
                          onClick={() => setExpanded(x => ({ ...x, [msgKey]: !x[msgKey] }))}
                          className="mt-1 flex w-full items-start gap-1 text-left text-[9.5px] leading-snug text-muted-foreground/80"
                          aria-expanded={isOpen}
                        >
                          <ChevronDown className={cn('mt-0.5 h-2.5 w-2.5 shrink-0 transition-transform', isOpen && 'rotate-180')} />
                          <span className={cn('min-w-0 flex-1 break-all', !isOpen && 'line-clamp-2')}>{c.output}</span>
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
            <span className="mt-0.5 px-1 font-mono text-[9px] tabular-nums text-muted-foreground/50">{m.time}</span>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-1.5 rounded-lg rounded-bl-sm border border-border bg-card px-3 py-2">
            {phase === 'visual'
              ? <Sparkles className="h-3 w-3 animate-pulse text-primary" />
              : <Loader2 className={cn('h-3 w-3 animate-spin text-primary')} />}
            <span className="text-[11px] text-muted-foreground">{phaseLabel}…</span>
            <span className="flex gap-0.5">
              {[0, 1, 2].map(i => (
                <span key={i} className="h-1 w-1 animate-pulse rounded-full bg-primary/60" style={{ animationDelay: `${i * 200}ms` }} />
              ))}
            </span>
            <span className="ml-auto text-[9px] text-muted-foreground/50">{phaseHint}</span>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-border p-2.5">
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 transition focus-within:border-primary/50">
          <textarea
            ref={taRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onInput={onTaInput}
            onKeyDown={e => {
              // IME 组合中（中文输入法候选确认的 Enter）不发送
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
              e.stopPropagation()
            }}
            rows={1}
            placeholder={t({ zh: '描述需求：测量、上色、聚焦、动画…全部功能皆可自然语言下达', en: 'Describe what you need: measure, color, focus, animate… everything works in natural language' })}
            aria-label={t({ zh: 'AI 助手输入', en: 'AI assistant input' })}
            className="mol-scroll max-h-24 min-h-[22px] flex-1 resize-none bg-transparent text-[11.5px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
          />
          <button
            onClick={() => { if (canAbort) abortRef.current?.abort(); else void send(input) }}
            disabled={!canAbort && (busy || !input.trim())}
            aria-label={canAbort ? t({ zh: '停止生成', en: 'Stop generating' }) : t({ zh: '发送给 AI 助手', en: 'Send to AI assistant' })}
            title={canAbort ? t({ zh: '停止生成（保留已生成部分）', en: 'Stop generating (keep partial output)' }) : t({ zh: '发送（Enter）', en: 'Send (Enter)' })}
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white transition disabled:opacity-40',
              canAbort ? 'bg-rose-600 hover:bg-rose-500' : 'bg-primary hover:bg-primary/90',
            )}
          >
            {busy
              ? (canAbort ? <Square className="h-3 w-3" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />)
              : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[9px] text-muted-foreground/60">
          {t({ zh: 'Enter 发送 · Shift+Enter 换行 · 生成中可点 ■ 停止', en: 'Enter to send · Shift+Enter for a new line · ■ stops generation' })}
          {visualOn ? t({ zh: ' · 视觉自查开（Eye 可关）', en: ' · Visual check on (Eye toggles)' }) : t({ zh: ' · 视觉自查关', en: ' · Visual check off' })}
        </p>
      </div>

      {/* 供应商设置页（保存/切换默认后徽章即时刷新） */}
      <ProviderSettingsDialog
        open={providerOpen}
        onOpenChange={o => {
          setProviderOpen(o)
          if (!o) setProvider(null) // 关闭时置空 → 上方 effect 重拉最新默认供应商
        }}
      />
    </div>
  )
}
