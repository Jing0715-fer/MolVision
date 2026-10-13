'use client'

// AI 助手面板：自然语言 → MolVision 命令（LLM 决策 + 白名单执行 + 命令卡片审计 + VLM 视觉自查）
// 浮动于 3D 视图右侧；对话持久化 localStorage；confirm 态命令需用户点确认；
// 视觉自查：命令执行完毕后截图送 VLM 审视渲染结果，未达标自动给出修正命令，
// 修正命令本身还会被再自查一轮（有界双轮：修到效果理想为止，不无限循环）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Ban, Bot, Check, ChevronDown, Clock, CornerDownRight, Eye, EyeOff, HardDriveDownload, Loader2, MessageSquarePlus, MousePointerClick, Pencil, Pin, RotateCw, Send, Sparkles, Square, Trash2, X, AlertTriangle, Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useMolStore, engineRef } from '@/lib/molecular/store'
// r117-c：待恢复态「一键载入最近结构」——复用会话恢复同一代码路径（restoreSession）
import { restoreSession, sessionSnapshot } from '@/lib/molecular/session'
import { buildSceneContext } from '@/lib/molecular/agent/context'
import { classifyCmd, execAgentCmd, splitCommands } from '@/lib/molecular/agent/runner'
import { SESSIONS_MAX, sessionTimeLabel, useAgentChatStore } from '@/lib/molecular/agent/chat-store'
import {
  AGENT_VISUAL_KEY, extractPartialReply, type AgentChatMessage, type AgentCmdRecord, type AgentDecision, type AgentPinnedJump, type AgentStreamEvent,
} from '@/lib/molecular/agent/protocol'
// r105 标准技能：发送前本地匹配（matchSkill），报告文稿标记检测（isSkillReport）驱动卡片渲染；
// r107-b 两段式：buildReportFillPrompt 组回填消息（命令回执 → 实测数值）
// r109-b 报告节跳转：reportSectionJumpCmd 解析节点击命令（回放该消息成功命令 + 静态兜底）
import { AGENT_SKILLS, matchSkill, isSkillReport, buildReportFillPrompt, reportSectionJumpCmd, previewExprFromJumpCmd, type AgentSkill } from '@/lib/molecular/agent/skills'
// r107-b 运行时补充数值源：氢键网络实时计数（状态徽章同源——回执文本之外的数值补充）
import { useHBondStore } from '@/lib/molecular/hbond-store'
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

/** r115-a 链域命令判定（与 mock 侧 fixRewrite/recomposeByChainList 的命令域三族对称——
 *  app/mock 两侧同一规则族防单侧漏判）：chains hide/show 形态 + chain X 词式 +
 *  interface 裸链字母形态。覆盖「未找到链」文案族与空选择族两类失败。 */
function isChainDomainCmd(cmd: string): boolean {
  return /\bchain\s+[A-Za-z0-9]\b/i.test(cmd) || /^(chains|chain)\s+(hide|show)\b/i.test(cmd) || /^interface\s+[A-Za-z0-9]/i.test(cmd)
}

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

/** 调后端 LLM：返回决策或 null（错误已 toast）。带 image 时走 VLM 视觉自查分支（可选前后对比）；memory 为长期对话记忆摘要；skillId 为 r105 标准技能（视觉自查分支忽略） */
async function callAgent(
  apiMessages: { role: 'user' | 'assistant'; content: string }[],
  scene: string,
  visual?: { image: string; goal: string; imageBefore?: string },
  memory?: string,
  skillId?: string,
): Promise<AgentDecision | null> {
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(visual ? { messages: apiMessages, scene, memory, image: visual.image, goal: visual.goal, imageBefore: visual.imageBefore } : { messages: apiMessages, scene, memory, skillId }),
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
  opts: { signal?: AbortSignal; onFirstDelta?: () => void; onDelta?: (acc: string) => void; memory?: string; skillId?: string },
): Promise<StreamResult> {
  let acc = ''
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMessages, scene, memory: opts.memory, skillId: opts.skillId, stream: true }),
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
  // r106 技能选择器：点选芯片强制绑定 skillId（优先于自然语言匹配——不依赖措辞也能
  // 走标准流程）；面板局部态（不持久化：面板重挂即回自然语言匹配的默认行为）
  const [pinnedSkill, setPinnedSkill] = useState<string | null>(null)
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  // r108-d 技能使用计数（会话内派生值—— msgs 中 skillId 出现次数；弹层项右侧徽章展示，
  // key 变化复用 probe-pop 弹跳——计数增加时新徽章弹入；必须在 early return 之前调用）
  const skillCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const x of msgs) if (x.skillId) m[x.skillId] = (m[x.skillId] ?? 0) + 1
    return m
  }, [msgs])
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  /** 当前流式请求的中断器（停止生成按钮） */
  const abortRef = useRef<AbortController | null>(null)
  // r99-f2：卸载即中止在飞的流式请求（与 r98-f3 UploadPanel 同款）——旧版只有停止
  // 按钮路径可达 abort：面板随视图切换卸载后停止钮不可达，在飞请求悬挂到流自然结束；
  // 且重挂实例的 abortRef 为 null，旧流彻底失控（busy 卡亮但按停止无响应）
  useEffect(() => () => abortRef.current?.abort(), [])

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
   * skillId：r109-c 本轮命中的标准技能——自动修正轮随请求上送（后端重注入标准流程，
   *   修正命令不偏离该技能的 workflow 命令域；mock 侧 0.45 分支按失败命令回放修正）。
   * 返回：本轮（含修正/视觉修正子轮递归合并）全部命令的执行记录——r107-b 两段式回填的
   * 回执来源（回执文本里的接触对数/ΔSASA 等实测数值）。
   */
  const runTurn = useCallback(async (msgId: string, cmds: string[], depth: number, priorMsgs: AgentChatMessage[], visualBudget: number, imageBefore?: string, skillId?: string): Promise<AgentCmdRecord[]> => {
    const records: AgentCmdRecord[] = cmds.map(cmd => ({ cmd, status: 'pending' as const }))
    patchCmds(msgId, records)
    for (let i = 0; i < records.length; i++) {
      const cls = classifyCmd(records[i].cmd)
      if (cls === 'blocked') {
        records[i] = { ...records[i], status: 'blocked', output: tt({ zh: '该命令不在助手可执行白名单内（请在命令行手动执行）', en: 'This command is not in the assistant whitelist (run it manually in the command line)' }) }
      } else if (cls === 'confirm') {
        records[i] = { ...records[i], status: 'confirm', output: tt({ zh: '影响较大，请确认后执行', en: 'High impact — confirm to run' }) }
      } else {
        // 视图切换窗口兜底：load 刚落地（activeId 已设）而 MolViewer（dynamic）仍在挂载——
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
      // r109-c：修正轮携带技能上下文（skillId 上送 → 后端重注入标准流程，修正命令不偏离
      // workflow 命令域——r106-parallel 遗留①「fix-turn 不注入，替换建议可能偏离标准流程」）
      const fix = await callAgent([...buildApiHistory(priorMsgs), { role: 'user', content: fixPrompt }], buildSceneContext(), undefined, buildMemoryDigest(priorMsgs), skillId)
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
        if (fixCmds.length) {
          const fixRecords = await runTurn(fixId, fixCmds, depth + 1, [...priorMsgs, fixMsg], visualBudget, imageBefore, skillId)
          records.push(...fixRecords)
          fixTurnRan = true
          // r114-b 链清单探测结果消费（r110/r111 持续挂起项收口）：修正轮跑过 chains list
          // 探测且原始失败中含链域命令时，把「原始失败 + 链清单输出」再送一轮 LLM——
          // 「看清单再重组」的真闭环（旧链路止步于探测，原命令永远无人重组）。
          // 链域判定与 fixRewrite/recomposeByChainList 的命令域三族对称（app/mock 两侧
          // 同一规则族防单侧漏判）：chains hide/show 形态 + chain X 词式 + interface 裸链
          // 字母形态——覆盖「未找到链」文案族与空选择族两类（均发出 chains list 探测）。
          // depth+2 执行：不再有后续修正轮（depth < 1 上限），有界防循环。
          const probe = fixRecords.find(r => /^chains\s+(list|ls)\s*$/i.test(r.cmd.trim()) && r.status === 'ok' && r.output)
          // r115-a：视觉修正轮失败并入 chainFails 候选（r114 建议①：深度 1 视觉自查的
          // 修正命令失败后无救济——旧 chainFails 只看 depth-0 原始失败 fails）。records
          // 此时已含修正轮与视觉自查子轮的全部记录（runTurn 返回值递归合并——fixRecords
          // 含视觉子轮），全量扫描链域错误一次消费：单次消费轮覆盖全部失败来源，不为
          // 视觉失败单独再开一轮（有界纪律不变：depth+2 仍无后续救济）。cmd 文本去重
          // （首次出现优先保留——原始失败先于视觉重发）：VLM 修正命令常与原始失败同文
          // 重发，重复列出会让 mock 重组出双份命令。
          const chainFails: AgentCmdRecord[] = []
          const seenFail = new Set<string>()
          for (const r of records) {
            if (r.status !== 'error' || !r.output || !isChainDomainCmd(r.cmd) || seenFail.has(r.cmd)) continue
            seenFail.add(r.cmd)
            chainFails.push(r)
          }
          if (probe && chainFails.length) {
            setPhase('think')
            // r115-d：消费 prompt 附带已成功命令的关键输出（与 fixPrompt 的 okOuts 同款）——
            // 供 LLM/mock 防重发：重组产物与已成功命令同名时不再执行（mock 0.46 侧过滤）。
            // 典型场景：视觉修正命令 color red, chain A 已成功 → 原始 color red, chain B
            // 重组为 color red, chain A → 重复执行无意义且淹没审计。
            const okOuts = records.filter(r => r.status === 'ok' && r.output)
              .slice(-6).map(r => `- ${r.cmd} → ${(r.output ?? '').replace(/\s+/g, ' ').slice(0, 110)}`)
            const consumePrompt = tt({
              zh: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n${chainFails.map(f => `- ${f.cmd} → ${f.output}`).join('\n')}\n\nchains list 输出：\n${probe.output}${okOuts.length ? `\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n${okOuts.join('\n')}` : ''}\n只给出重组后需要执行的命令，不要重复已成功的命令。`,
              en: `The chain list has been probed. Recompose the failed commands per the list and give them again (substitute chain IDs that actually exist):\n${chainFails.map(f => `- ${f.cmd} → ${f.output}`).join('\n')}\n\nchains list output:\n${probe.output}${okOuts.length ? `\n\nKey output of already-successful commands (do not repeat them when recomposing):\n${okOuts.join('\n')}` : ''}\nOnly give the recomposed commands to run; do not repeat the successful ones.`,
            })
            const recomp = await callAgent([...buildApiHistory(priorMsgs), fixMsg, { role: 'user', content: consumePrompt }], buildSceneContext(), undefined, buildMemoryDigest(priorMsgs), skillId)
            if (recomp) {
              // r117-b 同文曾失败短路（r116 建议②）：重组产物与既往失败命令同文时，重跑
              // 必然以同样方式再败（链域错误族均为结构/几何性——错链/空选择/近中心方向，
              // 同选择同几何同错，与命令顺序无关；r116 G1 实证：view from (chain A and
              // chain A) 近中心几何 error 的重组产物同文重跑再败，白耗一轮幂等执行）。
              // 与 r115-d 的 okOuts 防重发互补：那管「同成功」（prompt 上下文 + mock 0.46
              // 侧过滤），本短路管「同失败」（app 侧记录直判——真实 LLM 侧同样生效，
              // 不依赖 mock 配合）。极端角落（轮内结构被 load 切换后同文命令恰好成功）
              // 接受保守跳过：消费链重组产物本就锚定探测时结构，跨结构重执不在语义内。
              const failedTexts = new Set(records.filter(r => r.status === 'error').map(r => r.cmd.trim()))
              const recompAll = splitCommands(recomp.commands)
              const recompFresh = recompAll.filter(c => !failedTexts.has(c.trim()))
              const recompDropped = recompAll.length - recompFresh.length
              const recompCmds = recompFresh
              const recompId = newId()
              const recompMsg: AgentChatMessage = {
                id: recompId, role: 'assistant',
                content: `${tt({ zh: '链清单消费：', en: 'Chain-list consumption: ' })}${recomp.reply}${recompDropped > 0 ? tt({ zh: `（另有 ${recompDropped} 条与既往失败命令同文，已跳过）`, en: ` (${recompDropped} skipped as prior same-text failures)` }) : ''}`,
                time: nowTime(),
                commands: recompCmds.length ? recompCmds.map(cmd => ({ cmd, status: 'pending' as const })) : undefined,
              }
              setMsgs(m => [...m, recompMsg])
              if (recompCmds.length) {
                const recompRecords = await runTurn(recompId, recompCmds, depth + 2, [...priorMsgs, recompMsg], visualBudget, imageBefore, skillId)
                records.push(...recompRecords)
                // r116-a 消费轮救济对称（r115 建议①收口）：消费轮（含其视觉自查子轮——
                // runTurn 返回值递归合并）自己的链域失败此前无救济（消费站点只在
                // depth-0 修正轮后，r115 实测：消费轮命令成功 → 视觉自查触发 → VLM 重发
                // 带错链的修正命令失败即终，depth 2 无修正轮）。把消费轮返回记录再做
                // 一次链域消费判定——有界二次消费：代码结构线性恰两轮（第三轮不存在），
                // 二轮自身仍 depth+2 无修正轮，循环不可能成形。
                // 探测源：消费轮记录里的新 chains list 优先（其间结构被换的场景），否则
                // 复用首轮探测（chains list 幂等——结构未换时链清单不变，重跑同义）。
                const probe2 = recompRecords.find(r => /^chains\s+(list|ls)\s*$/i.test(r.cmd.trim()) && r.status === 'ok' && r.output) ?? probe
                // 二轮扫描只看消费轮自身记录；不做跨轮 cmd 文本去重——视觉自查重发同文
                // 失败（首轮已重组过）属「再次失败」如实上报：重组产物与已成功命令同名
                // 时由 okOuts 上下文 + mock 0.46 防重发丢弃（诚实跳过口径），不为省一次
                // 轮询牺牲新失败（VLM 每轮可发不同错链）的救济。
                const chainFails2: AgentCmdRecord[] = []
                const seen2 = new Set<string>()
                for (const r of recompRecords) {
                  if (r.status !== 'error' || !r.output || !isChainDomainCmd(r.cmd) || seen2.has(r.cmd)) continue
                  seen2.add(r.cmd)
                  chainFails2.push(r)
                }
                if (chainFails2.length && probe2) {
                  setPhase('think')
                  // okOuts2 在首轮消费并入 records 之后取（含首轮重组成功命令——防重发
                  // 上下文覆盖二轮重组产物）；与首轮 consumePrompt 的 okOuts 同款构造。
                  const okOuts2 = records.filter(r => r.status === 'ok' && r.output)
                    .slice(-6).map(r => `- ${r.cmd} → ${(r.output ?? '').replace(/\s+/g, ' ').slice(0, 110)}`)
                  const consumePrompt2 = tt({
                    zh: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n${chainFails2.map(f => `- ${f.cmd} → ${f.output}`).join('\n')}\n\nchains list 输出：\n${probe2.output}${okOuts2.length ? `\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n${okOuts2.join('\n')}` : ''}\n只给出重组后需要执行的命令，不要重复已成功的命令。`,
                    en: `The chain list has been probed. Recompose the failed commands per the list and give them again (substitute chain IDs that actually exist):\n${chainFails2.map(f => `- ${f.cmd} → ${f.output}`).join('\n')}\n\nchains list output:\n${probe2.output}${okOuts2.length ? `\n\nKey output of already-successful commands (do not repeat them when recomposing):\n${okOuts2.join('\n')}` : ''}\nOnly give the recomposed commands to run; do not repeat the successful ones.`,
                  })
                  // 历史含首轮消费消息（recompMsg）——LLM 可见「上轮已重组过什么」
                  const recomp2 = await callAgent([...buildApiHistory(priorMsgs), fixMsg, recompMsg, { role: 'user', content: consumePrompt2 }], buildSceneContext(), undefined, buildMemoryDigest(priorMsgs), skillId)
                  if (recomp2) {
                    // r117-b 同文曾失败短路（二轮同款，r116 建议②主场景）：records 此刻已含
                    // 首轮消费记录——r116 G1 实证的「近中心 view from 几何 error 同文重组再
                    // 执行再败」在此处被拦下（重组产物与自身失败同文 → 必然幂等再败 → 跳过
                    // 省一轮执行；r116 旧行为是把同文产物执行一遍再留一条重复 error 记录）。
                    const failedTexts2 = new Set(records.filter(r => r.status === 'error').map(r => r.cmd.trim()))
                    const recomp2All = splitCommands(recomp2.commands)
                    const recomp2Fresh = recomp2All.filter(c => !failedTexts2.has(c.trim()))
                    const recomp2Dropped = recomp2All.length - recomp2Fresh.length
                    const recomp2Cmds = recomp2Fresh
                    const recomp2Id = newId()
                    const recomp2Msg: AgentChatMessage = {
                      id: recomp2Id, role: 'assistant',
                      content: `${tt({ zh: '链清单消费（二轮）：', en: 'Chain-list consumption (2nd): ' })}${recomp2.reply}${recomp2Dropped > 0 ? tt({ zh: `（另有 ${recomp2Dropped} 条与既往失败命令同文，已跳过）`, en: ` (${recomp2Dropped} skipped as prior same-text failures)` }) : ''}`,
                      time: nowTime(),
                      commands: recomp2Cmds.length ? recomp2Cmds.map(cmd => ({ cmd, status: 'pending' as const })) : undefined,
                    }
                    setMsgs(m => [...m, recomp2Msg])
                    if (recomp2Cmds.length) records.push(...(await runTurn(recomp2Id, recomp2Cmds, depth + 2, [...priorMsgs, recomp2Msg], visualBudget, imageBefore, skillId)))
                  }
                }
              }
            }
          }
        }
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
              records.push(...(await runTurn(revId, revCmds, depth, [...priorMsgs, revMsg], visualBudget - 1, shot, skillId)))
            }
          }
        } catch { /* 截图/VLM 失败不影响主流程 */ }
      }
    }
    // r107-b：返回本轮全部执行记录（含递归子轮）——两段式回填的回执来源
    return records
  }, [patchCmds, buildApiHistory, buildMemoryDigest, visualOn])

  const send = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    setInput('')
    // r99-main：发送后输入框高度复位——高度由 onTaInput 指令式管理，值清空不受 React
    // 管控，多行输入发送后保持撑高直到下次键入才缩回
    if (taRef.current) taRef.current.style.height = 'auto'
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
      // r105 标准技能：发送前本地匹配用户意图（strong×2/weak×1 计分 + r106 重叠去重与
      // 特异性决胜，唯一最高 ≥2 才选中）；命中后 skillId 随请求上送 → 后端把「标准流程 +
      // 固定报告格式」注入系统提示。r106 技能选择器：点选固定的技能优先于自然语言匹配
      // （强制绑定——不依赖措辞也能走标准流程）；未固定/未命中/歧义 → undefined 走普通
      // 对话（行为与旧版完全一致，零回归面）
      const skill: AgentSkill | null = pinnedSkill
        ? (AGENT_SKILLS.find(s => s.id === pinnedSkill) ?? null)
        : matchSkill(q)
      const r = await callAgentStream(buildApiHistory(history), buildSceneContext(), {
        signal: ctrl.signal,
        memory: buildMemoryDigest(history),
        skillId: skill?.id,
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
          skillId: skill?.id,
          commands: cmds.length ? cmds.map(cmd => ({ cmd, status: 'pending' as const })) : undefined,
        }
        patchAi({ content: aiMsg.content, streaming: false, commands: aiMsg.commands, skillId: aiMsg.skillId })
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
          const records = await runTurn(aiId, cmds, 0, [...history, aiMsg], 2, before, skill?.id)
          // r107-b 技能报告两段式：命令回执落地后二次回填。第一段报告以「—」占位流式呈现
          //（用户立刻看到结构），此处把「草稿 + 命令回执 + 运行时补充」送 LLM 回填实测数值
          //（接触对数/ΔSASA/氢键条数等——报告从「格式合规」升级到「数值真实」）。回填走普通
          // 对话路径（不带 skillId——不重注技能流程与命令回放）；回填失败或格式不合规保留
          // 草稿（isSkillReport 卡点——填错不破坏原报告）。
          if (skill && isSkillReport(r.decision.reply) && records.some(x => x.status === 'ok' && x.output)) {
            setPhase('fill')
            try {
              // r109-a UI 层补抓（r108 G1 实测根修·方案 B）：技能轮渲染负载下 hbonds statLine
              // 可能超 runner 5.25s 有界轮询未入回执。回填前 hbond-store 若已就绪，把键数
              // 补进该命令回执——records 本地副本（回填 prompt 的回执源）与可见命令卡 output
              // 同步更新（patchCmds 整组替换）；已含 statLine 或无 hbonds 命令时零改动。
              let fillRecords = records
              const hbNow = useHBondStore.getState()
              if (hbNow.visible && !hbNow.computing) {
                const statLine = tt({ zh: `氢键网络当前 ${hbNow.count} 条（其中涉水 ${hbNow.waterCount}）`, en: `H-bond network: currently ${hbNow.count} bonds (${hbNow.waterCount} water-involved)` })
                const patched = records.map(rec => (
                  /^(hbonds?|hbon)\b/i.test(rec.cmd.trim()) && !/^(off|0)$/i.test((rec.cmd.trim().split(/\s+/)[1] ?? '').toLowerCase())
                    && rec.status === 'ok' && rec.output && !/氢键网络当前|H-bond network: currently/.test(rec.output)
                ) ? { ...rec, output: `${rec.output}\n${statLine}`.slice(0, 300) } : rec)
                // map 恒产新数组——逐项比较判定真实补抓（无 hbonds 命令/已含 statLine 时零改动）
                if (patched.some((rec, i) => rec !== records[i])) { fillRecords = patched; patchCmds(aiId, patched) }
              }
              const hb = useHBondStore.getState()
              const runtime = hb.visible ? `氢键网络当前 ${hb.count} 条（其中涉水 ${hb.waterCount}）` : ''
              const fill = await callAgent(
                [{ role: 'user', content: buildReportFillPrompt(skill, r.decision.reply, fillRecords, runtime) }],
                buildSceneContext(),
              )
              if (fill && isSkillReport(fill.reply)) {
                // r108-c：filled 标记驱动报告卡闪高亮（数值真实化的可感知反馈）+ toast
                patchAi({ content: fill.reply, filled: true })
                toast.success(tt({ zh: '报告数值已按命令回执回填', en: 'Report values filled from command receipts' }))
              }
            } catch { /* 回填失败保留草稿 */ }
          }
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
  }, [msgs, busy, runTurn, patchCmds, buildApiHistory, buildMemoryDigest, visualOn, pinnedSkill])

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
    // G1 实测根修（与 jumpTo 同款）：r 整体替换抹掉 sourceJump——rerun 溯源也须保留
    patchCmds(msgId, next.map((c, i) => (i === idx ? { ...r, sourceJump: c.sourceJump } : c)))
  }, [msgs, patchCmds, busy])

  const clearChat = useCallback(() => {
    useAgentChatStore.getState().clearMsgs()
    // r114-c 清钉防孤儿薄纱 + r115-c 迁入 store：clearMsgs 内统一清零（含持久化）
    toast.info(tt({ zh: '当前会话已清空（历史会话不受影响）', en: 'Current session cleared (other sessions untouched)' }))
  }, [])

  /** r112-b 预览态 ARIA 文案：hover 预览开始时写入（目标节标签 + 原子数），清屏静默
   *  （清屏不播报——hover 往返刷屏噪音；下次预览开始即覆盖）。 */
  const [previewAria, setPreviewAria] = useState('')

  /** r114-c 报告节预览钉住（r113 建议③：hover 即换 → 钉住叠加比对）：key = msgId#行号
   *  （同一节重复点击取消）；cmd/label 与 hover 预览同源。钉住集变更时统一重建薄纱
   *  （并集求值——多节叠加为一个薄纱集）；hover 仍为瞬态（覆盖钉住集，离开后恢复）。
   *  r115-c 迁入 chat-store + localStorage 持久化：刷新不丢（比对工作不因页面刷新中断），
   *  会话切换/新建/清空由 store 统一清零（钉的取消入口在消息行上——防孤儿薄纱语义与
   *  r114-c 一致）。跨会话比对的取舍：钉按会话语境清零而非跨会话保留——报告节属于
   *  具体会话的技能报告，跨会话叠加会让薄纱标签失去「哪条报告哪个节」的溯源；需要
   *  比对时切回来重钉两下即可（UI 成本低于孤儿风险）。 */
  const pinnedJumps = useAgentChatStore(s => s.pinnedJumps)
  const setPinnedJumps = useAgentChatStore(s => s.setPinnedJumps)

  /** r114-c：把当前钉住集重建为薄纱（并集求值；跨结构取首个非空组——previewHighlight
   *  单结构通道的诚实降级，注释写明不静默丢弃）。空集 = 清除薄纱 + 清空 ARIA（E2E
   *  实测抓出：取消最后一钉后 live region 残留「Pinned previews: …」——屏幕阅读器
   *  误以为仍有钉住态）。 */
  const applyPinned = useCallback((list: AgentPinnedJump[]) => {
    if (!list.length) { engineRef.current?.clearPreviewHighlight(); setPreviewAria(''); return }
    const union = new Map<string, { set: Set<number>; labels: string[] }>()
    for (const p of list) {
      const expr = previewExprFromJumpCmd(p.cmd)
      if (!expr) continue
      const res = useMolStore.getState().previewExpr(expr)
      if (res.error || !res.structureId || !res.indices.length) continue // 求值失败/结构已关——该钉静默失效
      const u = union.get(res.structureId) ?? { set: new Set<number>(), labels: [] }
      for (const i of res.indices) u.set.add(i) // Set 去重：多节覆盖同一原子域时不重复罩亮
      u.labels.push(p.label)
      union.set(res.structureId, u)
    }
    const first = [...union.entries()][0]
    if (!first) { engineRef.current?.clearPreviewHighlight(); setPreviewAria(''); return }
    engineRef.current?.previewHighlight(first[0], [...first[1].set])
    setPreviewAria(tt({
      zh: `已钉住预览：${first[1].labels.join('、')}（${first[1].set.size} 个原子）`,
      en: `Pinned previews: ${first[1].labels.join(', ')} (${first[1].set.size} atoms)`,
    }))
  }, [])

  // r114-c：钉住集变更 → 重建薄纱（含清空——取消最后一个钉即恢复无薄纱态）。
  // r115-c：依赖增 molActiveId（结构 id）——刷新后结构未加载时求值失败只清薄纱不清钉
  //  数据（持久化保留）；结构重载/切换时 effect 重跑，持久化的钉自动恢复薄纱（持久化
  //  闭环的最后一环——钉的生命周期 = 会话而非页面）。
  const molActiveId = useMolStore(s => s.activeId)
  useEffect(() => { applyPinned(pinnedJumps) }, [pinnedJumps, applyPinned, molActiveId])

  /** r114-c：报告节钉住切换（再次点击取消）。key 稳定于 msgId#行号。 */
  const togglePin = useCallback((key: string, cmd: string, label: string) => {
    setPinnedJumps(list => list.some(p => p.key === key) ? list.filter(p => p.key !== key) : [...list, { key, cmd, label }])
  }, [setPinnedJumps])

  /** r115-c：一键清全部钉（头部汇总徽章的点击动作——多钉时逐个取消繁琐）；
   *  toast + ARIA 双反馈（薄纱清除即时可见，徽章随 store 消失）。 */
  const clearAllPins = useCallback(() => {
    if (!pinnedJumps.length) return
    setPinnedJumps([])
    engineRef.current?.clearPreviewHighlight()
    setPreviewAria('')
    toast.info(tt({ zh: `已取消全部 ${pinnedJumps.length} 个钉住的预览`, en: `Unpinned all ${pinnedJumps.length} pinned previews` }))
  }, [pinnedJumps, setPinnedJumps])

  /** r117-c：待恢复态「一键载入最近结构」（r116 建议③收口）——琥珀徽章只提示「薄纱
   *  何时回来」，用户还得自己去欢迎页找恢复卡；此入口把「提示 → 路径」补全为一步。
   *  复用 SessionResumeCard 同一 restoreSession 代码路径（结构/reps/相机全量还原），
   *  结构落地后 molActiveId effect 重跑 → 钉住薄纱自动重建（r115-c 闭环顺带兑现）。
   *  快照 useMemo 单读：面板开关不持久化（水合时恒关——本组件客户端态无水合面）；
   *  恢复失败自隐藏（存档损坏/为空——与恢复卡同款诚实降级）。 */
  const [resumeGone, setResumeGone] = useState(false)
  const sessionSnap = useMemo(() => sessionSnapshot(), [])
  const restoringRef = useRef(false)
  const molLoading = useMolStore(s => s.loading)
  const quickResume = useCallback(() => {
    if (restoringRef.current || molLoading) return
    restoringRef.current = true
    const n = restoreSession()
    if (n > 0) {
      toast.success(tt({ zh: '已恢复上次会话', en: 'Previous session restored' }), { description: tt({ zh: `${n} 个结构 · 钉住预览的薄纱将自动恢复`, en: `${n} structures · pinned-preview veils will restore automatically` }) })
    } else {
      restoringRef.current = false
      setResumeGone(true)
      toast.error(tt({ zh: '会话恢复失败', en: 'Session restore failed' }), { description: tt({ zh: '本地存档中没有可恢复的结构，已忽略', en: 'No recoverable structures in the local autosave; ignored' }) })
    }
  }, [molLoading])

  /** r111-b 报告节 hover/focus 预览：跳转命令携带的选择子无副作用求值 → engine 青色
   *  薄纱罩亮（点击前的「先看一眼」）。previewExpr 不落全局选择（不碰用户当前选中态）；
   *  无表达式 / 求值失败 / 原子数为 0 时零动作（静默降级，不报错不打断 hover）。
   *  r112-b：①engine 侧同步 dim 视口外原子（聚焦通道）；②label 入参 → ARIA live
   *  region 文案（屏幕阅读器感知预览态：预览目标 + 原子数，tt 即时取双语文案）。 */
  const previewJump = useCallback((cmd: string, label?: string) => {
    const expr = previewExprFromJumpCmd(cmd)
    if (!expr) return
    const res = useMolStore.getState().previewExpr(expr)
    if (res.error || !res.structureId || !res.indices.length) return
    engineRef.current?.previewHighlight(res.structureId, res.indices)
    setPreviewAria(label
      ? tt({ zh: `正在预览：${label}（${res.count} 个原子）`, en: `Previewing: ${label} (${res.count} atoms)` })
      : tt({ zh: `正在预览（${res.count} 个原子）`, en: `Previewing (${res.count} atoms)` }))
  }, [])

  /** r111-b：清除 hover 预览（mouseleave/blur/点击跳转/组件卸载）。
   *  r112-b：同步清空 ARIA live region（清屏静默）与 engine 侧 rep dim 复位。
   *  r114-c：有钉住节时不清到底——hover 离开后恢复钉住集薄纱（钉住语义：固定预览，
   *  hover 只是临时覆盖；无钉时行为与旧版完全一致）。 */
  const clearPreviewJump = useCallback(() => {
    engineRef.current?.clearPreviewHighlight()
    if (pinnedJumps.length) applyPinned(pinnedJumps)
    else setPreviewAria('')
  }, [pinnedJumps, applyPinned])

  // r111-b：卸载时清预览（面板收起时视口不留残影——preview 无 store 通道，须显式清）
  useEffect(() => () => { engineRef.current?.clearPreviewHighlight() }, [])

  /** r109-b 报告节点击跳转：执行解析出的命令并把命令卡追加到同一消息（复用既有命令卡
   *  UI——状态/输出/展开全链审计）；生成中拒绝（并发执行打架，与 act 同口径）。
   *  r110-b 溯源：label（节标签）写入命令记录 sourceJump——命令卡头部「跳转自报告节」
   *  徽章的数据源，审计链可读（为什么突然多了一条 view 命令）。
   *  r111-b：点击时先清 hover 预览薄纱（真实跳转命令即将改视角/改选择，残影会叠加
   *  在新视角上误导）。 */
  const jumpTo = useCallback(async (msgId: string, cmd: string, label: string) => {
    if (useAgentChatStore.getState().busy) return
    engineRef.current?.clearPreviewHighlight()
    const prev = useAgentChatStore.getState().msgs.find(x => x.id === msgId)?.commands ?? []
    const next: AgentCmdRecord[] = [...prev, { cmd, status: 'running', sourceJump: label }]
    patchCmds(msgId, next)
    const rec = await execAgentCmd(cmd)
    // G1 实测根修：rec 整体替换会抹掉 sourceJump（写入 → 执行 → 替换丢失）——合并保留溯源
    patchCmds(msgId, next.map((c, i) => (i === next.length - 1 ? { ...rec, sourceJump: label } : c)))
  }, [patchCmds])

  const startNewSession = useCallback(() => {
    if (useAgentChatStore.getState().newSession()) {
      // r114-c 同 clearChat + r115-c 迁入 store：newSession 内统一清零（含持久化）
      toast.info(tt({ zh: '已新建会话（上下文已清零）', en: 'New session created (context cleared)' }))
    }
    else toast.info(tt({ zh: '生成中——结束后再新建会话', en: 'Generating — create a new session after it finishes' }))
  }, [])

  const onTaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }

  if (!open) return null

  const phaseLabel = phase === 'think' ? t({ zh: '正在思考', en: 'Thinking' }) : phase === 'stream' ? t({ zh: '回复生成中', en: 'Generating reply' }) : phase === 'exec' ? t({ zh: '正在执行命令', en: 'Running commands' }) : phase === 'fill' ? t({ zh: '回填报告数值', en: 'Filling report values' }) : t({ zh: '视觉自查中', en: 'Visual self-check' })
  const phaseHint = phase === 'visual' ? t({ zh: '审视渲染结果', en: 'Reviewing the render' }) : phase === 'exec' ? t({ zh: '命令将自动执行', en: 'Commands run automatically' }) : phase === 'fill' ? t({ zh: '命令回执 → 实测数值', en: 'Command receipts → measured values' }) : phase === 'stream' ? t({ zh: '逐字生成，可随时停止', en: 'Streaming — stop anytime' }) : t({ zh: '理解你的需求', en: 'Understanding your request' })
  // 思考/流式阶段 LLM 请求可中断；命令执行与视觉自查阶段不可（停止无意义）
  const canAbort = busy && (phase === 'think' || phase === 'stream')
  // r106 技能选择器：输入预览所见的技能 = 固定技能优先，否则自然语言匹配（与发送时同一
  // 决策链——所见即所得）；固定中状态在预览徽章上额外标注
  const previewSkill: AgentSkill | null = pinnedSkill
    ? (AGENT_SKILLS.find(s => s.id === pinnedSkill) ?? null)
    : matchSkill(input)

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
        {/* r115-c 钉住汇总徽章：钉住的报告节跨滚动可见（取消入口在消息行上，钉多了滚走
            就找不到）；计数 + 点击一键清全部。与记忆徽章同格（顶栏信息徽章族）。
            r116-b 待恢复态（r115 建议②收口）：刷新后钉恢复但结构未载时薄纱无法求值
            （ARIA 静默——恢复是隐式的），徽章转琥珀色 + title 提示「结构加载后自动恢复」
            ——隐式行为显式化，用户不再困惑薄纱为何没出现。 */}
        {pinnedJumps.length > 0 && (
          <>
          <button
            onClick={clearAllPins}
            aria-label={molActiveId
              ? t({ zh: `取消全部 ${pinnedJumps.length} 个钉住的预览`, en: `Unpin all ${pinnedJumps.length} pinned previews` })
              : t({ zh: `已钉住 ${pinnedJumps.length} 个报告节预览——当前无活动结构，加载结构后薄纱自动恢复；点击全部取消`, en: `${pinnedJumps.length} report-section previews pinned — no active structure; the teal veils will restore automatically once one is loaded. Click to unpin all` })}
            title={molActiveId
              ? t({ zh: `已钉住 ${pinnedJumps.length} 个报告节预览（青色薄纱叠加中）——点击全部取消`, en: `${pinnedJumps.length} report-section previews pinned (teal veils active) — click to unpin all` })
              : t({ zh: `已钉住 ${pinnedJumps.length} 个报告节预览——当前无活动结构，加载结构后青色薄纱将自动恢复；点击全部取消`, en: `${pinnedJumps.length} report-section previews pinned — no active structure yet; the teal veils will restore automatically once a structure is loaded. Click to unpin all` })}
            className={cn(
              'hidden min-w-0 items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-px font-mono text-[9px] font-medium tabular-nums text-primary transition hover:border-primary/50 hover:bg-primary/15 sm:flex',
              // 待恢复态：琥珀色系（与主色青区分——「在场但暂缺载体」的语义色）
              !molActiveId && 'border-amber-500/40 bg-amber-500/10 text-amber-600 hover:border-amber-500/60 hover:bg-amber-500/15 dark:text-amber-400',
            )}
          >
            <Pin className="h-2.5 w-2.5 shrink-0" aria-hidden />
            {t({ zh: '钉', en: 'Pin' })} {pinnedJumps.length}
            {!molActiveId && (
              <span className="shrink-0 opacity-80">· {t({ zh: '待结构恢复', en: 'pending' })}</span>
            )}
          </button>
          {/* r117-c 待恢复态快捷入口（r116 建议③收口）：琥珀徽章只说「薄纱何时回来」，
              这里给一步到位的「载入最近结构」——复用会话恢复同一路径（结构/reps/相机
              全量还原 + molActiveId effect 驱动薄纱自动重建）。与徽章同族样式（琥珀
              实底强调「可点动作」vs 徽章琥珀弱底「状态展示」）；仅待恢复态且有可用
              存档时渲染；恢复失败自隐藏（诚实降级）。 */}
          {!molActiveId && sessionSnap && !resumeGone && (
            <button
              onClick={quickResume}
              disabled={molLoading}
              aria-label={t({ zh: `载入最近结构（${sessionSnap.count} 个：${sessionSnap.names.join('、') || '—'}），恢复后钉住预览的薄纱自动重建`, en: `Load recent structures (${sessionSnap.count}: ${sessionSnap.names.join(', ') || '—'}); pinned-preview veils rebuild automatically after restore` })}
              title={t({ zh: `载入最近结构：${sessionSnap.count} 个 · ${sessionSnap.names.join('、') || '—'}——恢复会话后薄纱自动重建`, en: `Load recent structures: ${sessionSnap.count} · ${sessionSnap.names.join(', ') || '—'} — veils rebuild automatically after the session restores` })}
              className="hidden shrink-0 items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/20 px-2 py-px font-mono text-[9px] font-medium text-amber-700 transition hover:border-amber-500/70 hover:bg-amber-500/30 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-300 sm:flex"
            >
              <HardDriveDownload className="h-2.5 w-2.5 shrink-0" aria-hidden />
              {molLoading
                ? t({ zh: '载入中…', en: 'Loading…' })
                : t({ zh: '载入最近结构', en: 'Load recent' })}
            </button>
          )}
          </>
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
        {/* r118-b 小屏补偿入口（r117 建议②收口）：顶栏快捷恢复按钮 hidden sm:flex——
            移动端顶栏空间约束下不可见，待恢复态的小屏用户此前仍须绕道欢迎页恢复卡。
            正文区顶部提示条补齐这一步（sm:hidden——与顶栏按钮互斥成对，桌面端不重复
            渲染）；同款门控与恢复路径（quickResume 复用 restoreSession + 薄纱自动重建），
            主行是动作、副行给上下文（结构数 + 名称 + 钉住薄纱恢复语义）。 */}
        {pinnedJumps.length > 0 && !molActiveId && sessionSnap && !resumeGone && (
          <button
            onClick={quickResume}
            disabled={molLoading}
            aria-label={t({ zh: `载入最近结构（${sessionSnap.count} 个：${sessionSnap.names.join('、') || '—'}），恢复后钉住预览的薄纱自动重建`, en: `Load recent structures (${sessionSnap.count}: ${sessionSnap.names.join(', ') || '—'}); pinned-preview veils rebuild automatically after restore` })}
            className="flex w-full items-center gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-left transition hover:border-amber-500/60 hover:bg-amber-500/15 disabled:cursor-not-allowed disabled:opacity-50 sm:hidden"
          >
            <HardDriveDownload className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-medium text-amber-700 dark:text-amber-300">
                {molLoading
                  ? t({ zh: '载入中…', en: 'Loading…' })
                  : t({ zh: `载入最近结构（钉 ${pinnedJumps.length} 待恢复）`, en: `Load recent structures (${pinnedJumps.length} pins pending)` })}
              </span>
              <span className="block truncate text-[10px] text-amber-700/75 dark:text-amber-400/75">
                {t({ zh: `${sessionSnap.count} 个 · ${sessionSnap.names.join('、') || '—'}——恢复后薄纱自动重建`, en: `${sessionSnap.count} · ${sessionSnap.names.join(', ') || '—'} — veils rebuild after restore` })}
              </span>
            </span>
          </button>
        )}
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

        {/* r112-b 预览态 ARIA live region：屏幕阅读器感知 hover 预览（目标节标签 + 原子数）；
            常驻 DOM（live region 须先于内容更新存在）；role=status polite——不打断当前
            播报，预览切换时自然覆盖上一条 */}
        <div role="status" aria-live="polite" className="sr-only">{previewAria}</div>

        {msgs.map(m => {
          // r105 标准技能：assistant 消息命中技能时的徽章（名字取注册表——skillId 为持久化字段）
          const msgSkill = m.role === 'assistant' && m.skillId ? AGENT_SKILLS.find(s => s.id === m.skillId) : undefined
          // 报告文稿检测：reply 以「【…报告】」开头 → 结构化报告卡片渲染（标题行/▌ 节行分级）
          const isReport = m.role === 'assistant' && !m.streaming && isSkillReport(m.content)
          // r109-b 报告节跳转回放源：该消息已成功执行的命令（场景实参已在其中——
          // view from ligand / view from (chain A and chain B) / zoom 系 / ray 系 / preset 系）
          const okCmds = (m.commands ?? []).filter(c => c.status === 'ok').map(c => c.cmd)
          return (
          <div key={m.id} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
            {m.kind === 'visual' && (
              <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary">
                <Eye className="h-2.5 w-2.5" /> {t({ zh: '视觉自查', en: 'Visual check' })}
              </span>
            )}
            {msgSkill && (
              <span
                className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-600/10 px-1.5 py-px text-[9px] font-medium text-emerald-700 dark:text-emerald-400"
                title={t(msgSkill.description)}
              >
                <Sparkles className="h-2.5 w-2.5" /> {t({ zh: `标准技能 · ${msgSkill.name.zh}`, en: `Skill · ${msgSkill.name.en}` })}
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
                    // 报告卡片：左主色边 + 浅主色底（与普通聊天气泡视觉分级）
                    isReport && 'border-l-2 border-l-primary bg-primary/[0.04]',
                    // r108 回填完成闪高亮：数值从「—」占位变实测值的一次性可感知反馈（1.6s 淡出）
                    isReport && m.filled && 'fill-flash',
                  ),
              )}
            >
              {isReport ? (
                // 报告文稿分级渲染：标题行（【…报告】）主色加粗；▌ 节行标签与数值分色
                <div className="space-y-0.5">
                  {m.content.split('\n').map((line, li) => {
                    const t2 = line.trim()
                    if (/^【[^】]{2,20}报告】$/.test(t2)) {
                      return <p key={li} className="mb-1 font-semibold text-primary">{t2}</p>
                    }
                    if (t2.startsWith('▌')) {
                      const sep = t2.indexOf('：')
                      // r109-b 报告节点击跳转：节标签在技能注册表带 jump 定义时整行可点（回放
                      // 该消息成功命令的视角/聚焦动作 + 静态兜底）；纯信息节保持只读文本行
                      const jump = sep > 0 && m.role === 'assistant' ? reportSectionJumpCmd(m.skillId, t2.slice(0, sep), okCmds) : null
                      // r112-b：跳转节标签（剰▌前缀）提取一次三用——onClick 溯源 / hover
                      // 预览 ARIA / focus 预览 ARIA（同一文本源，避免三处手抄漂移）
                      const jumpLabel = t2.slice(0, sep).replace(/^▌/, '')
                      // r114-c：可预览的节（选择子非结构级）才给钉住按钮——钉住 = 固定薄纱
                      // 叠加比对；结构级命令（orient/ray/preset）无局部选择子不可钉
                      const pinKey = `${m.id}#${li}`
                      const pinned = pinnedJumps.some(p => p.key === pinKey)
                      const pinnable = jump !== null && previewExprFromJumpCmd(jump) !== null
                      if (jump) {
                        return (
                          // r114-c 行重组：外层 div + 双按钮（嵌套 button 非法 HTML）——主按钮
                          // 跳转（flex-1，与旧版视觉等价）；钉钮钉住薄纱（aria-pressed 表达
                          // 开关态；钉住时 fill-current 实心图标 + 主色）。group/jump 上移到
                          // 行容器：钉钮是主按钮的兄弟而非后代，留在主按钮上则钉钮的
                          // group-hover 永不生效。
                          <div key={li} className="group/jump flex w-full items-center gap-0.5">
                            <button
                              type="button"
                              onClick={() => void jumpTo(m.id, jump, jumpLabel)}
                              onMouseEnter={() => previewJump(jump, jumpLabel)}
                              onMouseLeave={clearPreviewJump}
                              onFocus={() => previewJump(jump, jumpLabel)}
                              onBlur={clearPreviewJump}
                              title={t({ zh: `点击跳转：${jump}`, en: `Click to jump: ${jump}` })}
                              aria-label={t({ zh: `跳转：${t2.slice(0, sep)}`, en: `Jump: ${t2.slice(0, sep)}` })}
                              className="-mx-1 flex min-w-0 flex-1 gap-1.5 rounded px-1 py-px text-left transition-colors duration-150 hover:bg-primary/[0.08]"
                            >
                              <span className="shrink-0 font-medium text-foreground/85 transition-colors duration-150 group-hover/jump:text-primary">{t2.slice(0, sep + 1)}</span>
                              <span className="min-w-0 flex-1 text-foreground/75 transition-colors group-hover/jump:text-foreground">{t2.slice(sep + 1)}</span>
                              <CornerDownRight aria-hidden className="h-3 w-3 shrink-0 self-center text-primary/0 transition-colors duration-150 group-hover/jump:text-primary/80" />
                            </button>
                            {pinnable && (
                              <button
                                type="button"
                                onClick={() => togglePin(pinKey, jump, jumpLabel)}
                                title={pinned
                                  ? t({ zh: '取消钉住预览', en: 'Unpin preview' })
                                  : t({ zh: '钉住预览：固定青色薄纱，可多节叠加比对（再点取消）', en: 'Pin preview: keep the teal veil, stack multiple sections for comparison (click again to unpin)' })}
                                aria-label={pinned
                                  ? t({ zh: `取消钉住预览：${jumpLabel}`, en: `Unpin preview: ${jumpLabel}` })
                                  : t({ zh: `钉住预览：${jumpLabel}`, en: `Pin preview: ${jumpLabel}` })}
                                aria-pressed={pinned}
                                className={cn(
                                  'shrink-0 rounded p-0.5 transition-colors',
                                  pinned
                                    ? 'text-primary hover:text-primary/80'
                                    : 'text-muted-foreground/0 group-hover/jump:text-muted-foreground/70 hover:!text-primary',
                                )}
                              >
                                <Pin aria-hidden className={cn('h-3 w-3', pinned && 'fill-current')} />
                              </button>
                            )}
                          </div>
                        )
                      }
                      return (
                        <p key={li} className="flex gap-1.5">
                          <span className="shrink-0 font-medium text-foreground/85">{sep > 0 ? t2.slice(0, sep + 1) : ''}</span>
                          <span className="min-w-0 flex-1 text-foreground/75">{sep > 0 ? t2.slice(sep + 1) : t2}</span>
                        </p>
                      )
                    }
                    return t2 ? <p key={li} className="text-foreground/75">{t2}</p> : null
                  })}
                </div>
              ) : (
                m.content
              )}
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
                      {/* r110-b 跳转命令溯源徽章：报告节点击触发的命令卡头部标注来源节——
                          审计链可读（报告节 → 跳转 → 该命令卡），与视觉自查消息的 kind 标记同思路 */}
                      {c.sourceJump && (
                        <div className="mt-1 flex items-center gap-1 text-[9px] leading-none text-primary/75">
                          <MousePointerClick aria-hidden className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">
                            {t({ zh: `跳转自报告节 · ${c.sourceJump}`, en: `Jumped from report section · ${c.sourceJump}` })}
                          </span>
                        </div>
                      )}
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
          )
        })}

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
        {/* r106 技能选择器：标准技能芯片栏。点选强制绑定 skillId（不依赖自然语言匹配——
            措辞不含触发词也能走标准流程）；固定后预览徽章与发送共用同一决策链；弹层列表
            展示技能名与适用场景（向上弹出——输入区位于面板底部） */}
        <div className="mb-1.5 flex items-center gap-1.5">
          <Popover open={skillPickerOpen} onOpenChange={setSkillPickerOpen}>
            <PopoverTrigger asChild>
              <button
                aria-label={t({ zh: '选择标准技能', en: 'Pick a standard skill' })}
                aria-expanded={skillPickerOpen}
                title={t({ zh: '标准技能库：点选后强制按标准流程执行并输出固定格式报告', en: 'Standard skill library: pick one to force the standard workflow and fixed-format report' })}
                className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <Sparkles className="h-3 w-3 shrink-0 text-primary" />
                {t({ zh: '标准技能', en: 'Skills' })}
                <ChevronDown className={cn('h-2.5 w-2.5 shrink-0 transition-transform', skillPickerOpen && 'rotate-180')} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-72 rounded-lg border-border p-1.5 mol-elevate-lg">
              <p className="px-1.5 pb-1 mol-micro text-muted-foreground">
                {t({ zh: `${AGENT_SKILLS.length} 支标准技能 · 点选强制按标准流程执行；再次点选取消固定`, en: `${AGENT_SKILLS.length} standard skills · click to force the standard workflow; click again to unpin` })}
              </p>
              <div className="mol-scroll max-h-64 overflow-y-auto">
                {AGENT_SKILLS.map(s => {
                  const pinned = pinnedSkill === s.id
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setPinnedSkill(p => (p === s.id ? null : s.id))
                        setSkillPickerOpen(false)
                        toast.info(tt({
                          zh: pinned ? `已取消固定「${s.name.zh}」（回到自然语言识别）` : `已固定「${s.name.zh}」——本轮起按标准流程执行`,
                          en: pinned ? `Unpinned "${s.name.en}" (back to natural-language detection)` : `Pinned "${s.name.en}" — the standard workflow will run from now on`,
                        }))
                      }}
                      aria-pressed={pinned}
                      title={t(s.description)}
                      className={cn(
                        'flex w-full items-start gap-1.5 rounded-md px-1.5 py-1.5 text-left transition',
                        pinned ? 'bg-accent' : 'hover:bg-accent/60',
                      )}
                    >
                      <span className="mt-px flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                        {pinned
                          ? <Check className="h-3 w-3 text-primary" />
                          : <Sparkles className="h-2.5 w-2.5 text-muted-foreground/50" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium">{t(s.name)}</span>
                        <span className="mt-0.5 block text-[9.5px] leading-snug text-muted-foreground line-clamp-2">{t(s.description)}</span>
                      </span>
                      {(skillCounts[s.id] ?? 0) > 0 && (
                        <span key={skillCounts[s.id]} className="probe-pop mt-px shrink-0 rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-semibold text-primary" title={t({ zh: '本会话已使用次数', en: 'Times used in this session' })}>
                          ×{skillCounts[s.id]}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
          {/* 固定中的技能芯片（常态可见的强制绑定指示 + 一键取消） */}
          {previewSkill && pinnedSkill && (
            <div className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-md border border-primary/30 bg-primary/[0.06] px-1.5 text-[10px] font-medium text-primary">
              <span className="min-w-0 truncate">{t(previewSkill.name)}</span>
              <button
                onClick={() => setPinnedSkill(null)}
                aria-label={t({ zh: '取消固定技能', en: 'Unpin skill' })}
                title={t({ zh: '取消固定（回到自然语言识别）', en: 'Unpin (back to natural-language detection)' })}
                className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded transition hover:bg-primary/15"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </div>
          )}
        </div>
        {/* r105 标准技能实时识别预览：输入即匹配（与发送时同一决策链——所见即所得）；
            r106 升级：固定技能优先于自然语言匹配，固定中额外标注「已固定」。
            命中显示技能徽章，用户提前知道本轮将按标准流程执行并产出固定格式报告 */}
        {!busy && input.trim() && previewSkill && (
          <div className="mb-1.5 flex items-center gap-1.5 rounded-md border border-emerald-600/25 bg-emerald-600/[0.06] px-2 py-1 text-[9.5px] text-emerald-700 dark:text-emerald-400">
            <Sparkles className="h-3 w-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              {pinnedSkill === previewSkill.id
                ? t({
                    zh: `已固定标准技能：${previewSkill.name.zh} —— 本轮起按标准流程执行并输出固定格式报告`,
                    en: `Skill pinned: ${previewSkill.name.en} — the standard workflow and fixed-format report apply from now on`,
                  })
                : t({
                    zh: `已识别标准技能：${previewSkill.name.zh} —— 将按标准流程执行并输出固定格式报告`,
                    en: `Skill detected: ${previewSkill.name.en} — runs a standard workflow and outputs a fixed-format report`,
                  })}
            </span>
          </div>
        )}
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
