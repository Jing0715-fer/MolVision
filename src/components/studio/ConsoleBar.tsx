'use client'

// 命令行控制台（PyMOL 风格；日志区高度三档可调；Tab 智能补全 + 参数提示 + Ctrl+R 历史搜索 + 最近命令徽章）
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, ChevronsUpDown, CornerDownRight, Terminal, X, Boxes, Filter, Palette, Shapes, Sparkles, TerminalSquare, Wand2, Trash2, History, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { useMolStore } from '@/lib/molecular/store'
import { runCommand } from '@/lib/molecular/commands'
import { buildCompletions, type CompletionCtx, type CompletionItem, type CompletionKind, type CompletionResult } from '@/lib/molecular/complete'
import { useViewsStore } from '@/lib/molecular/views-store'
import {
  appendCmdHistory, clearCmdHistory, FILL_CMD_EVENT, loadCmdHistory, subscribeCmdHistory, HISTORY_MAX,
} from '@/lib/molecular/cmd-history'
import { cn } from '@/lib/utils'
import { useI18n, tt, type DualText } from '@/i18n'
import { FadeEdge } from './FadeEdge'

/** 最近命令徽章数 */
const CHIPS_MAX = 6
const LOG_HEIGHT_CLASS: Record<string, string> = {
  compact: 'h-24',
  normal: 'h-36',
  tall: 'h-56',
}
const LOG_HEIGHT_LABEL: Record<string, DualText> = {
  compact: { zh: '紧凑', en: 'Compact' },
  normal: { zh: '标准', en: 'Normal' },
  tall: { zh: '加高', en: 'Tall' },
}

const KIND_META: Record<CompletionKind, { icon: typeof Terminal; cls: string; label: DualText }> = {
  cmd: { icon: TerminalSquare, cls: 'text-primary', label: { zh: '命令', en: 'Command' } },
  sub: { icon: CornerDownRight, cls: 'text-muted-foreground', label: { zh: '子命令', en: 'Subcommand' } },
  struct: { icon: Boxes, cls: 'text-muted-foreground', label: { zh: '结构', en: 'Structure' } },
  sel: { icon: Filter, cls: 'text-amber-600 dark:text-amber-400', label: { zh: '选择', en: 'Selection' } },
  rep: { icon: Shapes, cls: 'text-muted-foreground', label: { zh: '表示法', en: 'Representation' } },
  color: { icon: Palette, cls: 'text-rose-600 dark:text-rose-400', label: { zh: '颜色', en: 'Color' } },
  value: { icon: ChevronRight, cls: 'text-muted-foreground', label: { zh: '值', en: 'Value' } },
  preset: { icon: Sparkles, cls: 'text-muted-foreground', label: { zh: '预设', en: 'Preset' } },
  tour: { icon: Wand2, cls: 'text-muted-foreground', label: { zh: '演示', en: 'Tour' } },
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
  const { t } = useI18n()
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)
  const consoleLog = useMolStore(s => s.consoleLog)
  const consoleHeight = useMolStore(s => s.settings.consoleHeight)
  const updateSettings = useMolStore(s => s.updateSettings)
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>(() => loadCmdHistory())
  const [histIdx, setHistIdx] = useState(-1)
  const [completions, setCompletions] = useState<CompletionResult | null>(null)
  const [selIdx, setSelIdx] = useState(0)
  // Ctrl+R 反向历史搜索（输入即查询；匹配预览在提示条，Enter 执行选中项）
  const [rSearch, setRSearch] = useState<{ active: boolean; query: string; idx: number }>({ active: false, query: '', idx: 0 })
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  /** 搜索模式当前匹配列表（新→旧） */
  const rMatches = useMemo(() => {
    if (!rSearch.active) return []
    const q = rSearch.query.trim().toLowerCase()
    return history.slice().reverse().filter(h => h.toLowerCase().includes(q))
  }, [rSearch.active, rSearch.query, history])
  const rCur = rMatches.length ? rMatches[Math.min(rSearch.idx, rMatches.length - 1)] : null

  /** 最近命令徽章：历史尾部去重取前 N 条（点击执行 / 右键填入编辑） */
  const recentChips = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (let i = history.length - 1; i >= 0 && out.length < CHIPS_MAX; i--) {
      const h = history[i]
      if (!h || seen.has(h)) continue
      seen.add(h)
      out.push(h)
    }
    return out
  }, [history])

  const clearHistory = () => {
    clearCmdHistory()
    setHistIdx(-1)
    toast.success(tt({ zh: '命令历史已清空', en: 'Command history cleared' }), { description: tt({ zh: '最近命令徽章与 Ctrl+R 搜索同步清除', en: 'Recent chips and Ctrl+R search history also cleared' }) })
  }

  // 共享历史订阅：HistoryDialog 执行/置顶/清空 → 控制台箭头与 Ctrl+R 即时同步
  useEffect(() => subscribeCmdHistory(() => setHistory(loadCmdHistory())), [])

  // HistoryDialog「填入编辑」事件（自包含：不依赖渲染期闭包函数）
  useEffect(() => {
    const h = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail
      setInput(cmd)
      const s = useMolStore.getState()
      setCompletions(cmd.trim() ? buildCompletions(cmd, {
        structures: s.structures.map(x => x.name),
        namedSelections: s.namedSelections.map(n => n.name),
        viewBookmarks: useViewsStore.getState().bookmarks.map(b => b.name),
      }) : null)
      setSelIdx(0)
      inputRef.current?.focus()
    }
    window.addEventListener(FILL_CMD_EVENT, h)
    return () => window.removeEventListener(FILL_CMD_EVENT, h)
  }, [])

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
    if (rSearch.active) {
      // 搜索模式：输入即查询；输入行展示查询、提示条预览匹配
      setRSearch({ active: true, query: v, idx: 0 })
      setInput(v)
      setCompletions(null)
      return
    }
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

  const submitCmd = (cmd: string) => {
    const c = cmd.trim()
    if (!c) return
    runCommand(c)
    appendCmdHistory(c)
    setHistIdx(-1)
  }

  const submit = () => {
    submitCmd(input)
    setInput('')
    setCompletions(null)
    setRSearch({ active: false, query: '', idx: 0 })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // IME 组合中（中文输入法候选确认的 Enter）不触发命令执行/历史搜索
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    // ` / ~ 关闭命令行（帮助文档宣称的开关；打开方向由 MolViewer 全局键位处理——
    // 其 INPUT 早退分支会跳过聚焦态，故关闭路径必须在输入行这里实现）
    if (e.key === '`' || e.key === '~') {
      e.preventDefault()
      setUi({ consoleOpen: false })
      return
    }
    // Ctrl+R 反向历史搜索：进入 / 循环下一个更早的匹配
    if ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault()
      if (!history.length) return
      if (!rSearch.active) {
        const q = input.trim()
        const ms = history.slice().reverse().filter(h => h.toLowerCase().includes(q.toLowerCase()))
        setRSearch({ active: true, query: q, idx: 0 })
        setInput(q)
        setCompletions(null)
        return
      }
      if (rMatches.length) {
        setRSearch(s => ({ ...s, idx: (s.idx + 1) % rMatches.length }))
      }
      return
    }
    if (e.key === 'Enter') {
      if (rSearch.active) {
        // 搜索模式：Enter 执行当前匹配（无匹配时回退执行查询原文）
        submitCmd(rCur ?? input)
        setInput('')
        setCompletions(null)
        setRSearch({ active: false, query: '', idx: 0 })
        return
      }
      submit()
    } else if (e.key === 'ArrowUp') {
      if (rSearch.active) {
        e.preventDefault()
        if (rMatches.length) setRSearch(s => ({ ...s, idx: (s.idx <= 0 ? rMatches.length - 1 : s.idx - 1) }))
        return
      }
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
      if (rSearch.active) {
        e.preventDefault()
        if (rMatches.length) setRSearch(s => ({ ...s, idx: (s.idx >= rMatches.length - 1 ? 0 : s.idx + 1) }))
        return
      }
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
      if (rSearch.active) {
        // 退出搜索模式保留当前行内容，转入常规补全
        setRSearch({ active: false, query: '', idx: 0 })
        if (rCur) setInput(rCur)
        recompute(rCur ?? input)
        return
      }
      if (completions?.items.length) {
        acceptItem(completions.items[selIdx] ?? completions.items[0], completions)
      }
    } else if (e.key === 'Escape') {
      // 先退搜索模式，再关补全弹层，最后关控制台
      if (rSearch.active) {
        setRSearch({ active: false, query: '', idx: 0 })
        if (rCur) setInput(rCur)
        return
      }
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
  const heightLabel = t(LOG_HEIGHT_LABEL[consoleHeight] ?? LOG_HEIGHT_LABEL.normal)

  return (
    <div className="mol-elevate absolute inset-x-0 bottom-0 z-30 border-t border-border bg-card">
      <div className="flex h-8 items-center gap-2 border-b border-border/60 px-3">
        <Terminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        <span className="mol-micro shrink-0 text-foreground/75">{t({ zh: '命令行', en: 'Command line' })}</span>
        <span className="min-w-0 truncate text-[10px] text-muted-foreground/60">{t({ zh: 'Tab 补全 · ↑↓ 历史 · Ctrl+R 搜索 · 徽章快跑 · help 查看命令', en: 'Tab complete · ↑↓ history · Ctrl+R search · quick chips · help for commands' })}</span>
        <button
          onClick={() => setUi({ historyOpen: true })}
          className="ml-auto flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
          title={t({ zh: `命令历史面板（全量列表 + 搜索 + 置顶，${HISTORY_MAX} 条上限）`, en: `Command history panel (full list + search + pin, max ${HISTORY_MAX})` })}
        >
          <ScrollText className="h-3 w-3" />
          {t({ zh: '历史', en: 'History' })}
        </button>
        <button
          onClick={cycleHeight}
          className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
          title={t({ zh: `控制台高度：${heightLabel}（点击切换）`, en: `Console height: ${heightLabel} (click to cycle)` })}
        >
          <ChevronsUpDown className="h-3 w-3" />
          {heightLabel}
        </button>
        <button
          onClick={() => setUi({ consoleOpen: false })}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div ref={logRef} className={cn('mol-scroll overflow-y-auto px-3 py-1.5 font-mono text-[11px] leading-relaxed transition-[height] duration-200', LOG_HEIGHT_CLASS[consoleHeight] ?? 'h-36')}>
        {consoleLog.map((l, i) => (
          <div key={i} className={cn(
            'whitespace-pre-wrap break-all',
            l.type === 'in' ? 'text-foreground' : l.type === 'err' ? 'text-destructive' : 'text-muted-foreground',
          )}>
            {l.type === 'in' && <span className="font-bold text-primary">mv › </span>}
            {l.text}
          </div>
        ))}
      </div>

      {/* 最近命令徽章：点击执行 · 右键填入编辑（历史去重前 6 条） */}
      {recentChips.length > 0 && (
        <div className="flex items-center gap-1.5 px-2 pt-1">
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground/60" title={t({ zh: '最近命令（点击执行 · 右键填入编辑）', en: 'Recent commands (click to run · right-click to edit)' })}>
            <History className="h-3 w-3" />
          </span>
          <FadeEdge className="gap-1">
            {recentChips.map(h => (
              <button
                key={h}
                onClick={() => {
                  submitCmd(h)
                  setCompletions(null)
                }}
                onContextMenu={e => {
                  e.preventDefault()
                  setInput(h)
                  recompute(h)
                  inputRef.current?.focus()
                }}
                className="max-w-[220px] shrink-0 truncate rounded-md border border-border bg-transparent px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                title={t({ zh: `${h}\n左键执行 · 右键填入输入行编辑`, en: `${h}\nClick to run · right-click to edit in the input line` })}
              >
                {h.length > 26 ? `${h.slice(0, 24)}…` : h}
              </button>
            ))}
          </FadeEdge>
          <button
            onClick={clearHistory}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-destructive/10 hover:text-destructive"
            title={t({ zh: '清空命令历史（最近徽章 + Ctrl+R 搜索记录）', en: 'Clear command history (recent chips + Ctrl+R search)' })}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* 参数提示条（识别到命令时展示用法） */}
      {hint && (
        <div className="mx-2 mb-0.5 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[10px] text-muted-foreground">
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono font-bold text-primary">{hint.cmd}</span>
          <span className="min-w-0 truncate">{hint.desc}</span>
          <span className="ml-auto hidden shrink-0 font-mono text-muted-foreground/60 lg:inline">{hint.example}</span>
        </div>
      )}

      {/* 补全弹层（锚定输入行上方） */}
      {completions && completions.items.length > 0 && (
        <div className="relative mx-2">
          <div className="mol-elevate-lg absolute inset-x-0 bottom-full mb-1 overflow-hidden rounded-lg border border-border bg-popover">
            <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-2.5 py-1.5">
              <span className="mol-micro tabular-nums text-muted-foreground">{t({ zh: `${completions.items.length} 个候选`, en: `${completions.items.length} candidates` })}</span>
              <span className="mol-micro flex items-center gap-1 text-muted-foreground/70">
                <kbd className="rounded border border-border/70 bg-background px-1 font-mono text-[9px]">Tab</kbd>{t({ zh: '补全', en: 'complete' })}
                <kbd className="rounded border border-border/70 bg-background px-1 font-mono text-[9px]">↑↓</kbd>{t({ zh: '切换', en: 'navigate' })}
                <kbd className="rounded border border-border/70 bg-background px-1 font-mono text-[9px]">Esc</kbd>{t({ zh: '关闭', en: 'close' })}
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
                    i === selIdx ? 'bg-accent shadow-[inset_2px_0_0_0_var(--primary)]' : 'hover:bg-accent/40',
                  )}
                >
                  <KindBadge kind={item.kind} />
                  <span className="min-w-0 flex-1 truncate">
                    <MatchedText text={item.insert} frag={frag} />
                  </span>
                  {item.detail && <span className="ml-auto shrink-0 text-[9px] tabular-nums text-muted-foreground/70">{item.detail}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 反向历史搜索提示条（Ctrl+R；输入即查询，预览当前匹配） */}
      {rSearch.active && (
        <div className="mx-2 mb-0.5 flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/[0.07] px-2.5 py-1 text-[10px]">
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono font-bold text-amber-600 dark:text-amber-400">reverse-i-search</span>
          <span className="min-w-0 max-w-[30%] shrink truncate font-mono font-semibold text-foreground/80">{rSearch.query || '·'}</span>
          <span className="shrink-0 text-muted-foreground/50">→</span>
          <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
            {rCur ? <MatchedText text={rCur} frag={rSearch.query.trim()} /> : <span className="italic text-muted-foreground/60">{t({ zh: '无匹配历史', en: 'no matching history' })}</span>}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground/70">{rMatches.length ? `${Math.min(rSearch.idx + 1, rMatches.length)}/${rMatches.length}` : '0'}</span>
          <span className="hidden shrink-0 items-center gap-1 text-muted-foreground/60 lg:flex">
            <kbd className="rounded border border-border/70 bg-muted px-1 font-mono text-[9px]">Ctrl+R</kbd>{t({ zh: '下一条', en: 'next' })}
            <kbd className="rounded border border-border/70 bg-muted px-1 font-mono text-[9px]">↵</kbd>{t({ zh: '执行', en: 'run' })}
            <kbd className="rounded border border-border/70 bg-muted px-1 font-mono text-[9px]">Esc</kbd>{t({ zh: '编辑', en: 'edit' })}
          </span>
        </div>
      )}

      <div className={cn(
        'mx-2 mb-2 flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-2 transition-colors duration-200 focus-within:border-foreground/25',
        rSearch.active
          ? 'border-amber-500/50 bg-amber-500/[0.05] focus-within:bg-amber-500/[0.07]'
          : '',
      )}>
        <span className={cn('shrink-0 select-none font-mono text-xs font-bold', rSearch.active ? 'text-amber-600 dark:text-amber-400' : 'text-primary')}>mv ›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={rSearch.active ? t({ zh: '输入关键词过滤历史…', en: 'Type to filter history…' }) : 'load 4hhb · select site = within 5 of resn HEM · color red site · show cartoon …'}
          className={cn(
            'min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/40',
          )}
          spellCheck={false}
          autoComplete="off"
        />
        <kbd className="hidden shrink-0 rounded border border-border/70 bg-muted px-1 font-mono text-[9px] text-muted-foreground sm:inline">{rSearch.active ? 'Ctrl+R' : '↵'}</kbd>
      </div>
    </div>
  )
}
