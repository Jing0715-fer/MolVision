'use client'

// AI 助手面板：自然语言 → MolVision 命令（LLM 决策 + 白名单执行 + 命令卡片审计）
// 浮动于 3D 视图右侧；对话持久化 localStorage；confirm 态命令需用户点确认
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Ban, Bot, Check, ChevronDown, Clock, Loader2, RotateCw, Send, Trash2, X, AlertTriangle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useMolStore } from '@/lib/molecular/store'
import { buildSceneContext } from '@/lib/molecular/agent/context'
import { classifyCmd, execAgentCmd, splitCommands } from '@/lib/molecular/agent/runner'
import {
  AGENT_CHAT_KEY, AGENT_CHAT_MAX, type AgentChatMessage, type AgentCmdRecord, type AgentDecision,
} from '@/lib/molecular/agent/protocol'
import { cn } from '@/lib/utils'

const SUGGESTIONS = [
  '加载血红蛋白 4HHB，展示血红素口袋',
  '给蛋白质上彩虹渐变色',
  '出版级渲染当前视角',
  '只显示螺旋并放大',
]

/** 调后端 LLM：返回决策或 null（错误已 toast） */
async function callAgent(
  apiMessages: { role: 'user' | 'assistant'; content: string }[],
  scene: string,
): Promise<AgentDecision | null> {
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: apiMessages, scene }),
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
    return Array.isArray(arr) ? arr.slice(-AGENT_CHAT_MAX) : []
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

export function AgentPanel() {
  const open = useMolStore(s => s.ui.agentOpen)
  const setUi = useMolStore(s => s.setUi)
  const [msgs, setMsgs] = useState<AgentChatMessage[]>(loadChats)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  // 持久化 + 自动滚底（DOM 副作用，不触碰 setState）
  useEffect(() => {
    try {
      localStorage.setItem(AGENT_CHAT_KEY, JSON.stringify(msgs.slice(-AGENT_CHAT_MAX)))
    } catch { /* 配额满等异常静默 */ }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [msgs, busy])

  // 打开时聚焦输入框
  useEffect(() => {
    if (open) taRef.current?.focus()
  }, [open])

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
   * depth：自动修正轮次——失败命令反馈 LLM 求修正，最多 1 轮（agentic retry）。
   */
  const runTurn = useCallback(async (msgId: string, cmds: string[], depth: number, priorMsgs: AgentChatMessage[]) => {
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
    const fails = records.filter(r => r.status === 'error' && r.output)
    if (fails.length && depth < 1) {
      const fixPrompt = `刚才这些命令执行失败了，请修正（换正确的选择表达式 / 命令写法）后重新给出命令：\n${fails.map(f => `- ${f.cmd} → ${f.output}`).join('\n')}\n只给出修正后需要执行的命令，不要重复已成功的命令。`
      const fix = await callAgent([...buildApiHistory(priorMsgs), { role: 'user', content: fixPrompt }], buildSceneContext())
      if (fix) {
        const fixCmds = splitCommands(fix.commands)
        const fixId = newId()
        const fixMsg: AgentChatMessage = {
          id: fixId, role: 'assistant',
          content: `🔁 自动修正：${fix.reply}`,
          time: nowTime(),
          commands: fixCmds.length ? fixCmds.map(cmd => ({ cmd, status: 'pending' as const })) : undefined,
        }
        setMsgs(m => [...m, fixMsg])
        if (fixCmds.length) await runTurn(fixId, fixCmds, depth + 1, [...priorMsgs, fixMsg])
      }
    }
  }, [patchCmds, buildApiHistory])

  const send = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || busy) return
    setInput('')
    const userMsg: AgentChatMessage = { id: newId(), role: 'user', content: q, time: nowTime() }
    const history = [...msgs, userMsg]
    setMsgs(history)
    setBusy(true)
    try {
      const decision = await callAgent(buildApiHistory(history), buildSceneContext())
      if (!decision) {
        setMsgs(m => [...m, {
          id: newId(), role: 'assistant',
          content: '出错了，请重试或换个说法。', time: nowTime(),
        }])
        return
      }
      const cmds = splitCommands(decision.commands)
      const aiId = newId()
      const aiMsg: AgentChatMessage = {
        id: aiId, role: 'assistant', content: decision.reply, time: nowTime(),
        commands: cmds.length ? cmds.map(cmd => ({ cmd, status: 'pending' as const })) : undefined,
      }
      setMsgs(m => [...m, aiMsg])
      if (cmds.length) await runTurn(aiId, cmds, 0, [...history, aiMsg])
    } finally {
      setBusy(false)
    }
  }, [msgs, busy, runTurn, buildApiHistory])

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

  return (
    <div
      className="absolute inset-y-3 right-3 z-30 flex w-full flex-col rounded-xl border border-border/80 bg-card/95 shadow-2xl backdrop-blur-md sm:w-[356px] agent-panel-in"
      role="complementary"
      aria-label="AI 助手面板"
    >
      {/* 头部 */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/15">
          <Bot className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
        </span>
        <span className="text-xs font-semibold">AI 绘图助手</span>
        <span className="rounded-full bg-muted px-1.5 py-px text-[9px] text-muted-foreground">自然语言 · 自动执行</span>
        <div className="ml-auto flex items-center gap-0.5">
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
      <div ref={scrollRef} className="mol-scroll min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-3">
        {msgs.length === 0 && !busy && (
          <div className="space-y-3 pt-2">
            <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-3 text-center">
              <Bot className="mx-auto h-6 w-6 text-emerald-500/70" />
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                告诉我你想怎么看分子——<br />我会把它翻译成 MolVision 命令并自动执行。
              </p>
            </div>
            <div className="space-y-1.5">
              <p className="px-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">试试这些</p>
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="flex w-full items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition hover:border-emerald-500/50 hover:bg-emerald-500/5 hover:text-foreground"
                >
                  <Send className="h-3 w-3 shrink-0 text-emerald-500/70" />
                  <span className="min-w-0 flex-1">{s}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {msgs.map(m => (
          <div key={m.id} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
            <div
              className={cn(
                'max-w-[92%] rounded-lg px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap break-words',
                m.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border/70 bg-muted/50 text-foreground',
              )}
            >
              {m.content}
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
          <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-muted/50 px-3 py-2">
            <Loader2 className="h-3 w-3 animate-spin text-emerald-500" />
            <span className="text-[11px] text-muted-foreground">正在思考…</span>
            <span className="flex gap-0.5">
              {[0, 1, 2].map(i => (
                <span key={i} className="h-1 w-1 animate-pulse rounded-full bg-emerald-500/60" style={{ animationDelay: `${i * 200}ms` }} />
              ))}
            </span>
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="shrink-0 border-t border-border/70 p-2.5">
        <div className="flex items-end gap-1.5 rounded-lg border border-border bg-background/80 px-2 py-1.5 transition focus-within:border-emerald-500/50">
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
            placeholder="描述你的绘图需求，如：把配体周围 5Å 的残基显示为棍状…"
            aria-label="AI 助手输入"
            className="mol-scroll max-h-24 min-h-[22px] flex-1 resize-none bg-transparent text-[11.5px] leading-relaxed outline-none placeholder:text-muted-foreground/50"
          />
          <button
            onClick={() => void send(input)}
            disabled={busy || !input.trim()}
            aria-label="发送给 AI 助手"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white transition hover:bg-emerald-500 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[9px] text-muted-foreground/60">Enter 发送 · Shift+Enter 换行 · 命令经白名单校验后执行</p>
      </div>
    </div>
  )
}
