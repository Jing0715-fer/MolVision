'use client'

// 命令行控制台（PyMOL 风格；日志区高度三档可调；Tab 智能补全 + 参数提示）
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, ChevronsUpDown, CornerDownRight, Terminal, X, Boxes, Filter, Palette, Shapes, Sparkles, TerminalSquare, Wand2 } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { runCommand } from '@/lib/molecular/commands'
import { buildCompletions, type CompletionCtx, type CompletionItem, type CompletionKind, type CompletionResult } from '@/lib/molecular/complete'
import { useViewsStore } from '@/lib/molecular/views-store'
import { cn } from '@/lib/utils'

const HISTORY_KEY = 'molvision-cmd-history'
const LOG_HEIGHT_CLASS: Record<string, string> = {
  compact: 'h-24',
  normal: 'h-36',
  tall: 'h-56',
}
const LOG_HEIGHT_LABEL: Record<string, string> = {
  compact: '紧凑',
  normal: '标准',
  tall: '加高',
}

const KIND_META: Record<CompletionKind, { icon: typeof Terminal; cls: string; label: string }> = {
  cmd: { icon: TerminalSquare, cls: 'text-emerald-600 dark:text-emerald-400', label: '命令' },
  sub: { icon: CornerDownRight, cls: 'text-sky-600 dark:text-sky-400', label: '子命令' },
  struct: { icon: Boxes, cls: 'text-violet-600 dark:text-violet-400', label: '结构' },
  sel: { icon: Filter, cls: 'text-amber-600 dark:text-amber-400', label: '选择' },
  rep: { icon: Shapes, cls: 'text-teal-600 dark:text-teal-400', label: '表示法' },
  color: { icon: Palette, cls: 'text-rose-600 dark:text-rose-400', label: '颜色' },
  value: { icon: ChevronRight, cls: 'text-muted-foreground', label: '值' },
  preset: { icon: Sparkles, cls: 'text-fuchsia-600 dark:text-fuchsia-400', label: '预设' },
  tour: { icon: Wand2, cls: 'text-purple-600 dark:text-purple-400', label: '演示' },
}

function KindBadge({ kind }: { kind: CompletionKind }) {
  const meta = KIND_META[kind]
  const Icon = meta.icon
  return <Icon className={cn('h-3 w-3 shrink-0', meta.cls)} />
}

/** 候选文本：命中片段加粗高亮 */
function MatchedText({ text, frag }: { text: string; frag: string }) {
  if (!frag) return <span>{text}</span>
  const idx = text.toLowerCase().indexOf(frag.toLowerCase())
  if (idx < 0) return <span>{text}</span>
  return (
    <span>
      {text.slice(0, idx)}
      <span className="rounded-[2px] bg-primary/15 font-bold text-primary">{text.slice(idx, idx + frag.length)}</span>
      {text.slice(idx + frag.length)}
    </span>
  )
}

export function ConsoleBar() {
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)
  const consoleLog = useMolStore(s => s.consoleLog)
  const consoleHeight = useMolStore(s => s.settings.consoleHeight)
  const updateSettings = useMolStore(s => s.updateSettings)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const saved = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
      if (Array.isArray(saved)) return saved
    } catch { /* ignore */ }
    return []
  })
  const [histIdx, setHistIdx] = useState(-1)
  const [completions, setCompletions] = useState<CompletionResult | null>(null)
  const [selIdx, setSelIdx] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [consoleLog, ui.consoleOpen])

  useEffect(() => {
    if (ui.consoleOpen) inputRef.current?.focus()
  }, [ui.consoleOpen])

  // 选中项滚入可视区
  useEffect(() => {
    const el = listRef.current?.children[selIdx] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selIdx, completions])

  /** 即时收集补全上下文（命令面板输入频繁，避免 store 订阅抖动） */
  const gatherCtx = (): CompletionCtx => {
    const s = useMolStore.getState()
    return {
      structures: s.structures.map(x => x.name),
      namedSelections: s.namedSelections.map(n => n.name),
      viewBookmarks: useViewsStore.getState().bookmarks.map(b => b.name),
    }
  }

  const recompute = (v: string) => {
    const res = v.trim() ? buildCompletions(v, gatherCtx()) : null
    setCompletions(res)
    setSelIdx(0)
  }

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setInput(v)
    recompute(v)
  }

  const acceptItem = (item: CompletionItem, res: CompletionResult) => {
    const next = input.slice(0, res.from) + item.insert + ' ' + input.slice(res.to)
    const trimmed = next.replace(/\s+$/, '')
    setInput(trimmed.endsWith(' ') ? trimmed : next)
    // 补全后继续提示下一参数
    const v = next
    const r2 = buildCompletions(v, gatherCtx())
    setCompletions(r2)
    setSelIdx(0)
    inputRef.current?.focus()
  }

  const submit = () => {
    const cmd = input.trim()
    if (!cmd) return
    runCommand(cmd)
    const next = [...history.filter(h => h !== cmd), cmd].slice(-50)
    setHistory(next)
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    setHistIdx(-1)
    setInput('')
    setCompletions(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      submit()
    } else if (e.key === 'ArrowUp') {
      // 补全弹层开启时优先导航候选
      if (completions && completions.items.length > 1) {
        e.preventDefault()
        setSelIdx(i => (i <= 0 ? completions.items.length - 1 : i - 1))
        return
      }
      e.preventDefault()
      if (!history.length) return
      const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(idx)
      setInput(history[idx] ?? '')
      recompute(history[idx] ?? '')
    } else if (e.key === 'ArrowDown') {
      if (completions && completions.items.length > 1) {
        e.preventDefault()
        setSelIdx(i => (i >= completions.items.length - 1 ? 0 : i + 1))
        return
      }
      e.preventDefault()
      if (histIdx < 0) return
      const idx = histIdx + 1
      if (idx >= history.length) { setHistIdx(-1); setInput(''); setCompletions(null) }
      else { setHistIdx(idx); setInput(history[idx]); recompute(history[idx]) }
    } else if (e.key === 'Tab') {
      e.preventDefault()
      if (completions?.items.length) {
        acceptItem(completions.items[selIdx] ?? completions.items[0], completions)
      }
    } else if (e.key === 'Escape') {
      // 先关补全弹层，再关控制台
      if (completions) { setCompletions(null); return }
      setUi({ consoleOpen: false })
    }
  }

  if (!ui.consoleOpen) return null

  const cycleHeight = () => {
    const next = consoleHeight === 'compact' ? 'normal' : consoleHeight === 'normal' ? 'tall' : 'compact'
    updateSettings({ consoleHeight: next })
  }

  const frag = completions ? input.slice(completions.from, completions.to) : ''
  const hint = completions?.hint ?? null

  return (
    <div className="absolute inset-x-0 bottom-0 z-30 border-t border-border/70 bg-popover/95 shadow-2xl backdrop-blur-md">
      <div className="flex h-8 items-center gap-2 border-b border-border/50 px-3">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">命令行</span>
        <span className="min-w-0 truncate text-[10px] text-muted-foreground/60">Tab 补全 · ↑↓ 历史/候选 · help 查看命令</span>
        <button
          onClick={cycleHeight}
          className="ml-auto flex h-5 shrink-0 items-center gap-1 rounded border border-border/60 bg-background/60 px-1.5 text-[9px] font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
          title={`控制台高度：${LOG_HEIGHT_LABEL[consoleHeight] ?? '标准'}（点击切换）`}
        >
          <ChevronsUpDown className="h-3 w-3" />
          {LOG_HEIGHT_LABEL[consoleHeight] ?? '标准'}
        </button>
        <button
          onClick={() => setUi({ consoleOpen: false })}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div ref={logRef} className={cn('mol-scroll overflow-y-auto px-3 py-1.5 font-mono text-[11px] leading-relaxed transition-[height] duration-200', LOG_HEIGHT_CLASS[consoleHeight] ?? 'h-36')}>
        {consoleLog.map((l, i) => (
          <div key={i} className={cn(
            'whitespace-pre-wrap break-all',
            l.type === 'in' ? 'text-emerald-600 dark:text-emerald-400' : l.type === 'err' ? 'text-destructive' : 'text-foreground/80',
          )}>
            {l.type === 'in' && <span className="text-muted-foreground/50">» </span>}
            {l.text}
          </div>
        ))}
      </div>

      {/* 参数提示条（识别到命令时展示用法） */}
      {hint && (
        <div className="mx-2 mb-0.5 flex items-center gap-2 rounded-md border border-border/50 bg-muted/30 px-2.5 py-1 text-[10px] text-muted-foreground">
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono font-bold text-primary">{hint.cmd}</span>
          <span className="min-w-0 truncate">{hint.desc}</span>
          <span className="ml-auto hidden shrink-0 font-mono text-muted-foreground/60 lg:inline">{hint.example}</span>
        </div>
      )}

      {/* 补全弹层（锚定输入行上方） */}
      {completions && completions.items.length > 0 && (
        <div className="relative mx-2">
          <div className="absolute inset-x-0 bottom-full mb-1 overflow-hidden rounded-lg border border-border/80 bg-popover shadow-xl">
            <div className="flex items-center justify-between border-b border-border/50 bg-muted/40 px-2.5 py-1 text-[9px] uppercase tracking-wider text-muted-foreground/80">
              <span>{completions.items.length} 个候选</span>
              <span className="flex items-center gap-1">
                <kbd className="rounded border border-border/60 bg-background px-1 font-mono">Tab</kbd>补全
                <kbd className="rounded border border-border/60 bg-background px-1 font-mono">↑↓</kbd>切换
                <kbd className="rounded border border-border/60 bg-background px-1 font-mono">Esc</kbd>关闭
              </span>
            </div>
            <div ref={listRef} className="mol-scroll max-h-44 overflow-y-auto py-1">
              {completions.items.map((item, i) => (
                <button
                  key={`${item.kind}-${item.insert}`}
                  onMouseDown={e => { e.preventDefault(); acceptItem(item, completions) }}
                  onMouseEnter={() => setSelIdx(i)}
                  className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11px] transition',
                    i === selIdx ? 'bg-accent/80' : 'hover:bg-accent/40',
                  )}
                >
                  <KindBadge kind={item.kind} />
                  <span className="min-w-0 flex-1 truncate">
                    <MatchedText text={item.insert} frag={frag} />
                  </span>
                  {item.detail && <span className="ml-auto shrink-0 text-[9px] text-muted-foreground/70">{item.detail}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-2 transition-colors duration-200 focus-within:border-emerald-500/60 focus-within:bg-emerald-500/[0.05] focus-within:shadow-[inset_0_0_0_1px_rgba(16,185,129,0.25)]">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <input
          ref={inputRef}
          value={input}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="load 4hhb · select site = within 5 of resn HEM · color red site · show cartoon …"
          className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none caret-emerald-600 placeholder:text-muted-foreground/40 dark:caret-emerald-400"
          spellCheck={false}
          autoComplete="off"
        />
        <kbd className="hidden shrink-0 rounded border border-border/60 bg-muted/60 px-1 font-mono text-[9px] text-muted-foreground/70 sm:inline">↵</kbd>
      </div>
    </div>
  )
}
