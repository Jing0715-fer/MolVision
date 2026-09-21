'use client'

// AI 助手面板：自然语言 → MolVision 命令（LLM 决策 + 白名单执行 + 命令卡片审计 + VLM 视觉自查）
// 浮动于 3D 视图右侧；对话持久化 localStorage；confirm 态命令需用户点确认；
// 视觉自查：命令执行完毕后截图送 VLM 审视渲染结果，未达标自动给出修正命令，
// 修正命令本身还会被再自查一轮（有界双轮：修到效果理想为止，不无限循环）
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Ban, Bot, Check, ChevronDown, Clock, Eye, EyeOff, Loader2, RotateCw, Send, Sparkles, Square, Trash2, X, AlertTriangle, Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { useMolStore, engineRef } from '@/lib/molecular/store'
import { buildSceneContext } from '@/lib/molecular/agent/context'
import { classifyCmd, execAgentCmd, splitCommands } from '@/lib/molecular/agent/runner'
import {
  AGENT_CHAT_KEY, AGENT_CHAT_MAX, AGENT_VISUAL_KEY, extractPartialReply, type AgentChatMessage, type AgentCmdRecord, type AgentDecision, type AgentStreamEvent,
} from '@/lib/molecular/agent/protocol'
import { ProviderSettingsDialog, type ProviderInfo } from './ProviderSettingsDialog'
import { cn } from '@/lib/utils'

/** 分类建议（空状态展示——覆盖渲染 / 聚焦 / 分析 / 构象四类工作流） */
const SUGGESTION_GROUPS: { label: string; items: string[] }[] = [
  { label: '渲染质感', items: ['出版级渲染当前视角', '加轮廓线和环境光遮蔽，彩虹渐变上色'] },
  { label: '加载聚焦', items: ['加载血红蛋白 4HHB，展示血红素口袋', '只显示螺旋并放大'] },
  { label: '分析测量', items: ['测一下血红素和最近残基的距离', '链 A 和链 B 的界面接触分析'] },
  { label: '构象动画', items: ['加载两个构象生成插值动画', '轮廓线再粗一点，亮度再高一些'] },
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
    img.onerror = () => rej(new Error('截图加载失败'))
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
  return '优化当前视图的渲染效果'
}

function loadVisualPref(): boolean {
  if (typeof window === 'undefined') return true
  try {
    return localStorage.getItem(AGENT_VISUAL_KEY) !== 'off'
  } catch {
    return true
  }
}

/** 调后端 LLM：返回决策或 null（错误已 toast）。带 image 时走 VLM 视觉自查分支（可选前后对比） */
async function callAgent(
  apiMessages: { role: 'user' | 'assistant'; content: string }[],
  scene: string,
  visual?: { image: string; goal: string; imageBefore?: string },
): Promise<AgentDecision | null> {
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(visual ? { messages: apiMessages, scene, image: visual.image, goal: visual.goal, imageBefore: visual.imageBefore } : { messages: apiMessages, scene }),
    })
    const data = await res.json() as { ok: boolean; decision?: AgentDecision; error?: string }
    if (!data.ok || !data.decision) {
      toast.error(`AI 助手出错：${data.error ?? res.statusText}`)
      return null
    }
    return data.decision
  } catch (e) {
    toast.error(`AI 助手网络异常：${e instanceof Error ? e.message : '未知错误'}`)
    return null
  }
}

/** 流式调用结果：决策 / 用户中止（携带已生成的部分文本）/ 错误 */
type StreamResult =
  | { kind: 'decision'; decision: AgentDecision }
  | { kind: 'aborted'; partial: string }
  | { kind: 'error'; partial: string }

/** 调后端流式 LLM：onDelta 收累积原文，返回最终决策；signal 中断返回 aborted */
async function callAgentStream(
  apiMessages: { role: 'user' | 'assistant'; content: string }[],
  scene: string,
  opts: { signal?: AbortSignal; onFirstDelta?: () => void; onDelta?: (acc: string) => void },
): Promise<StreamResult> {
  let acc = ''
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMessages, scene, stream: true }),
      signal: opts.signal,
    })
    if (!res.ok || !res.body) {
      let msg = res.statusText
      try {
        const data = await res.json() as { error?: string }
        if (data.error) msg = data.error
      } catch { /* 非 JSON 错误体 */ }
      toast.error(`AI 助手出错：${msg}`)
      return { kind: 'error', partial: acc }
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
          toast.error(`AI 助手出错：${ev.error}`)
          return { kind: 'error', partial: acc }
        }
      }
    }
    // 流意外结束（无 end 事件）：用累积文本打捞纯文本决策
    if (acc.trim().length > 4) {
      return { kind: 'decision', decision: { reply: acc.replace(/^```[a-z]*\n?|```$/g, '').trim().slice(0, 800), commands: [] } }
    }
    toast.error('AI 助手连接中断，请重试')
    return { kind: 'error', partial: acc }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return { kind: 'aborted', partial: acc }
    toast.error(`AI 助手网络异常：${e instanceof Error ? e.message : '未知错误'}`)
    return { kind: 'error', partial: acc }
  }
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function nowTime(): string {
  const d = new Date()
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
}

function loadChats(): AgentChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(AGENT_CHAT_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as AgentChatMessage[]
    // streaming 标志不持久化（中断重载后不再处于流式态）
    return Array.isArray(arr) ? arr.slice(-AGENT_CHAT_MAX).map(m => ({ ...m, streaming: undefined })) : []
  } catch {
    return []
  }
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

/** 忙碌阶段（思考 → 流式生成 → 执行 → 视觉自查） */
type BusyPhase = 'think' | 'stream' | 'exec' | 'visual'

export function AgentPanel() {
  const open = useMolStore(s => s.ui.agentOpen)
  const setUi = useMolStore(s => s.setUi)
  const [msgs, setMsgs] = useState<AgentChatMessage[]>(loadChats)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [phase, setPhase] = useState<BusyPhase>('think')
  const [visualOn, setVisualOn] = useState<boolean>(loadVisualPref)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [providerOpen, setProviderOpen] = useState(false)
  /** 当前默认供应商（头部徽章 + 设置页保存后刷新） */
  const [provider, setProvider] = useState<ProviderInfo | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  /** 当前流式请求的中断器（停止生成按钮） */
  const abortRef = useRef<AbortController | null>(null)

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

  // 持久化（流式进行中跳过——终值到达时统一落盘，避免逐增量 stringify 开销）
  useEffect(() => {
    if (msgs.some(m => m.streaming)) return
    try {
      localStorage.setItem(AGENT_CHAT_KEY, JSON.stringify(msgs.slice(-AGENT_CHAT_MAX)))
    } catch { /* 配额满等异常静默 */ }
  }, [msgs])

  // 自动滚底（每个增量都跟随）
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) taRef.current?.focus()
  }, [open])

  const toggleVisual = useCallback(() => {
    setVisualOn(v => {
      const next = !v
      try { localStorage.setItem(AGENT_VISUAL_KEY, next ? 'on' : 'off') } catch { /* 忽略 */ }
      toast.info(next ? '视觉自查已开启：命令执行后助手会审视渲染结果并自动修正' : '视觉自查已关闭')
      return next
    })
  }, [])

  /** 更新某条消息的命令记录 */
  const patchCmds = useCallback((msgId: string, cmds: AgentCmdRecord[]) => {
    setMsgs(m => m.map(x => (x.id === msgId ? { ...x, commands: [...cmds] } : x)))
  }, [])

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
        records[i] = { ...records[i], status: 'blocked', output: '该命令不在助手可执行白名单内（请在命令行手动执行）' }
      } else if (cls === 'confirm') {
        records[i] = { ...records[i], status: 'confirm', output: '影响较大，请确认后执行' }
      } else {
        records[i] = { ...records[i], status: 'running' }
        patchCmds(msgId, records)
        records[i] = await execAgentCmd(records[i].cmd)
      }
      patchCmds(msgId, records)
      await sleep(120)
    }
    // 自动修正：有失败命令且未到深度上限 → 把失败信息反馈 LLM 求修正命令
    let fixTurnRan = false
    const fails = records.filter(r => r.status === 'error' && r.output)
    if (fails.length && depth < 1) {
      setPhase('think')
      const fixPrompt = `刚才这些命令执行失败了，请修正（换正确的选择表达式 / 命令写法）后重新给出命令：\n${fails.map(f => `- ${f.cmd} → ${f.output}`).join('\n')}\n只给出修正后需要执行的命令，不要重复已成功的命令。`
      const fix = await callAgent([...buildApiHistory(priorMsgs), { role: 'user', content: fixPrompt }], buildSceneContext())
      if (fix) {
        const fixCmds = splitCommands(fix.commands)
        const fixId = newId()
        const fixMsg: AgentChatMessage = {
          id: fixId, role: 'assistant',
          content: `自动修正：${fix.reply}`,
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
            const revMsg: AgentChatMessage = {
              id: revId, role: 'assistant', kind: 'visual',
              content: review.reply, time: nowTime(),
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
  }, [patchCmds, buildApiHistory, visualOn])

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
        patchAi({ content: (extractPartialReply(r.partial) || '…') + '（已停止）', streaming: false })
        toast.info('已停止生成')
      } else {
        // 错误：保留已流出的部分文本并标记中断
        if (inserted) patchAi({ content: (extractPartialReply(r.partial) || '…') + '（生成中断，请重试）', streaming: false })
        else setMsgs(m => [...m, { id: newId(), role: 'assistant', content: '出错了，请重试或换个说法。', time: nowTime() }])
      }
    } finally {
      setBusy(false)
      setPhase('think')
      if (abortRef.current === ctrl) abortRef.current = null
    }
  }, [msgs, busy, runTurn, buildApiHistory, visualOn])

  /** confirm 卡片的「执行 / 跳过」与「重跑」 */
  const act = useCallback(async (msgId: string, idx: number, mode: 'confirm-run' | 'confirm-skip' | 'rerun') => {
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
  }, [msgs, patchCmds])

  const clearChat = useCallback(() => {
    setMsgs([])
    try { localStorage.removeItem(AGENT_CHAT_KEY) } catch { /* 忽略 */ }
    toast.info('助手对话已清空')
  }, [])

  const onTaInput = (e: React.FormEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`
  }

  if (!open) return null

  const phaseLabel = phase === 'think' ? '正在思考' : phase === 'stream' ? '回复生成中' : phase === 'exec' ? '正在执行命令' : '视觉自查中'
  const phaseHint = phase === 'visual' ? '审视渲染结果' : phase === 'exec' ? '命令将自动执行' : phase === 'stream' ? '逐字生成，可随时停止' : '理解你的需求'
  // 思考/流式阶段 LLM 请求可中断；命令执行与视觉自查阶段不可（停止无意义）
  const canAbort = busy && (phase === 'think' || phase === 'stream')

  return (
    <div
      className="absolute inset-y-3 right-3 z-30 flex w-full flex-col rounded-xl border border-border/70 bg-card/95 mol-elevate backdrop-blur-md sm:w-[356px] agent-panel-in"
      role="complementary"
      aria-label="AI 助手面板"
    >
      {/* 头部 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 bg-gradient-to-b from-muted/40 to-transparent px-3">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Bot className="h-3.5 w-3.5" />
        </span>
        <span className="text-xs font-semibold">AI 绘图助手</span>
        {/* 当前供应商徽章：模型名（点击打开设置） */}
        <button
          onClick={() => setProviderOpen(true)}
          title={provider ? `${provider.displayName}${provider.effectiveModel ? ` · ${provider.effectiveModel}` : ''}（点击配置供应商）` : 'AI 供应商设置'}
          className="hidden min-w-0 items-center gap-1 rounded-full border border-border/60 bg-background/70 px-2 py-px font-mono text-[9px] font-medium text-muted-foreground transition hover:border-border hover:text-foreground sm:flex"
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', provider?.id === 'zai' ? 'bg-emerald-500' : 'bg-primary')} />
          <span className="max-w-24 truncate">{provider?.effectiveModel || provider?.label || 'GLM-4.6'}</span>
          <Settings2 className="h-2.5 w-2.5 shrink-0 opacity-60" />
        </button>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => setProviderOpen(true)}
            aria-label="AI 供应商设置"
            title="供应商与 API Key 设置"
            className="flex h-6 w-6 items-center justify-center rounded transition hover:bg-accent hover:text-foreground text-muted-foreground/70"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={toggleVisual}
            aria-label={visualOn ? '关闭视觉自查' : '开启视觉自查'}
            aria-pressed={visualOn}
            title={visualOn ? '视觉自查已开：命令执行后审视渲染结果并自动修正' : '视觉自查已关（点击开启）'}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition hover:bg-accent',
              visualOn ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/50',
            )}
          >
            {visualOn ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          {msgs.length > 0 && (
            <button
              onClick={clearChat}
              aria-label="清空助手对话"
              title="清空对话记录"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={() => setUi({ agentOpen: false })}
            aria-label="关闭 AI 助手"
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 消息区 */}
      <div ref={scrollRef} className="mol-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {msgs.length === 0 && !busy && (
          <div className="space-y-3.5 pt-2">
            <div className="rounded-xl border border-dashed border-border/70 bg-muted/25 px-3 py-3.5 text-center">
              <span className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-4.5 w-4.5" />
              </span>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                用自然语言指挥整个工作台——加载、表示、着色、<br />测量、分析、动画，我会翻译成命令自动执行。
              </p>
              {visualOn && (
                <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] text-emerald-600 dark:text-emerald-400">
                  <Eye className="h-2.5 w-2.5" /> 执行后自动审视渲染结果
                </p>
              )}
            </div>
            {SUGGESTION_GROUPS.map(grp => (
              <div key={grp.label} className="space-y-1.5">
                <p className="px-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">{grp.label}</p>
                {grp.items.map(s => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="flex w-full items-center gap-1.5 rounded-lg border border-border/60 bg-card/70 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-all duration-150 hover:border-border hover:bg-accent/60 hover:text-foreground hover:translate-x-0.5"
                  >
                    <Send className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                    <span className="min-w-0 flex-1">{s}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {msgs.map(m => (
          <div key={m.id} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
            {m.kind === 'visual' && (
              <span className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-px text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
                <Eye className="h-2.5 w-2.5" /> 视觉自查
              </span>
            )}
            <div
              className={cn(
                'max-w-[92%] px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words',
                m.role === 'user'
                  ? 'rounded-2xl rounded-br-md bg-primary text-primary-foreground shadow-sm'
                  : cn(
                    'rounded-2xl rounded-bl-md border border-border/60 bg-card/80 text-foreground shadow-xs',
                    m.kind === 'visual' && 'border-l-2 border-l-emerald-500/70',
                  ),
              )}
            >
              {m.content}
              {m.streaming && (
                <span aria-hidden className="ml-0.5 inline-block h-3 w-[5px] animate-pulse rounded-[1px] bg-emerald-500 align-middle" />
              )}
              {m.streaming && !m.content && <span className="sr-only">正在生成回复</span>}
            </div>
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
                        'rounded-md border bg-background/85 px-2 py-1.5 text-[10px] transition',
                        c.status === 'ok' && 'border-emerald-500/30',
                        c.status === 'error' && 'border-red-500/40',
                        c.status === 'confirm' && 'border-amber-500/50 bg-amber-500/5',
                        c.status === 'blocked' && 'border-border/60 opacity-70',
                        c.status === 'rejected' && 'border-border/60 opacity-55',
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <CmdStatusIcon status={c.status} />
                        <code className="min-w-0 flex-1 break-all font-mono text-[10px] leading-snug">{c.cmd}</code>
                        {(c.status === 'ok' || c.status === 'error') && (
                          <button
                            onClick={() => void act(m.id, ci, 'rerun')}
                            aria-label="重新执行此命令"
                            title="重新执行"
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
                            确认执行
                          </button>
                          <button
                            onClick={() => void act(m.id, ci, 'confirm-skip')}
                            className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground transition hover:bg-accent"
                          >
                            跳过
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
            <span className="mt-0.5 px-1 text-[8.5px] text-muted-foreground/50">{m.time}</span>
          </div>
        ))}

        {busy && (
          <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-border/60 bg-card/80 px-3 py-2 shadow-xs">
            {phase === 'visual'
              ? <Sparkles className="h-3 w-3 animate-pulse text-emerald-500" />
              : <Loader2 className={cn('h-3 w-3 animate-spin text-emerald-500')} />}
            <span className="text-[11px] text-muted-foreground">{phaseLabel}…</span>
            <span className="flex gap-0.5">
              {[0, 1, 2].map(i => (
                <span key={i} className="h-1 w-1 animate-pulse rounded-full bg-emerald-500/60" style={{ animationDelay: `${i * 200}ms` }} />
              ))}
            </span>
            <span className="ml-auto text-[9px] text-muted-foreground/50">{phaseHint}</span>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-border/70 bg-gradient-to-b from-transparent to-muted/25 p-2.5">
        <div className="flex items-end gap-1.5 rounded-xl border border-border bg-background px-2 py-1.5 shadow-xs transition focus-within:border-primary/50">
          <textarea
            ref={taRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onInput={onTaInput}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
              e.stopPropagation()
            }}
            rows={1}
            placeholder="描述需求：测量、上色、聚焦、动画…全部功能皆可自然语言下达"
            aria-label="AI 助手输入"
            className="mol-scroll max-h-24 min-h-[22px] flex-1 resize-none bg-transparent text-[11.5px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
          />
          <button
            onClick={() => { if (canAbort) abortRef.current?.abort(); else void send(input) }}
            disabled={!canAbort && (busy || !input.trim())}
            aria-label={canAbort ? '停止生成' : '发送给 AI 助手'}
            title={canAbort ? '停止生成（保留已生成部分）' : '发送（Enter）'}
            className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white transition disabled:opacity-40',
              canAbort ? 'bg-rose-600 hover:bg-rose-500' : 'bg-emerald-600 hover:bg-emerald-500',
            )}
          >
            {busy
              ? (canAbort ? <Square className="h-3 w-3" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />)
              : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[9px] text-muted-foreground/60">
          Enter 发送 · Shift+Enter 换行 · 生成中可点 ■ 停止
          {visualOn ? ' · 视觉自查开（Eye 可关）' : ' · 视觉自查关'}
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
