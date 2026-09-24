'use client'

// 命令历史面板：全量历史（新→旧）+ 搜索过滤 + 置顶星标 + 点击执行 / 填入编辑 / 复制
// 与 ConsoleBar 共享 cmd-history 模块（localStorage + 订阅），Ctrl+R 与箭头历史同步可见
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Copy, History, PencilLine, Play, Search, Star, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useMolStore } from '@/lib/molecular/store'
import { runCommand } from '@/lib/molecular/commands'
import {
  clearCmdHistory, dispatchFillCmd, loadCmdHistory, loadPinnedCmds, subscribeCmdHistory, toggleCmdPin,
} from '@/lib/molecular/cmd-history'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useI18n, tt } from '@/i18n'
import { cn } from '@/lib/utils'

/** 高亮搜索命中片段 */
function Matched({ text, q }: { text: string; q: string }) {
  if (!q) return <span className="break-all">{text}</span>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return <span className="break-all">{text}</span>
  return (
    <span className="break-all">
      {text.slice(0, idx)}
      <span className="rounded-[2px] bg-primary/15 font-bold text-primary">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </span>
  )
}

export function HistoryDialog() {
  const { t } = useI18n()
  const open = useMolStore(s => s.ui.historyOpen)
  const setUi = useMolStore(s => s.setUi)
  const [history, setHistory] = useState<string[]>(() => loadCmdHistory())
  const [pins, setPins] = useState<string[]>(() => loadPinnedCmds())
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // 订阅共享历史（ConsoleBar 执行/清空/置顶 → 面板即时同步；挂载即订阅，状态始终新鲜）
  useEffect(() => subscribeCmdHistory(() => {
    setHistory(loadCmdHistory())
    setPins(loadPinnedCmds())
  }), [])

  // 打开时聚焦搜索框 + 清空上次搜索
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => searchRef.current?.focus(), 60)
    return () => clearTimeout(timer)
  }, [open])

  const q = query.trim().toLowerCase()
  const pinned = useMemo(() => (q ? pins.filter(h => h.toLowerCase().includes(q)) : pins), [pins, q])
  const rest = useMemo(() => {
    const list = history.slice().reverse()
    return q ? list.filter(h => h.toLowerCase().includes(q)) : list
  }, [history, q])

  const run = (cmd: string) => {
    runCommand(cmd)
    setUi({ historyOpen: false, consoleOpen: true })
  }
  const fill = (cmd: string) => {
    setUi({ historyOpen: false, consoleOpen: true })
    // 等控制台挂载后填入
    setTimeout(() => dispatchFillCmd(cmd), 80)
  }
  const copy = async (cmd: string) => {
    try {
      await navigator.clipboard.writeText(cmd)
      toast.success(tt({ zh: '已复制到剪贴板', en: 'Copied to clipboard' }))
    } catch {
      toast.error(tt({ zh: '复制失败（浏览器权限）', en: 'Copy failed (browser permission)' }))
    }
  }

  const Row = ({ cmd, pinnedRow }: { cmd: string; pinnedRow?: boolean }) => {
    const isPinned = pins.includes(cmd)
    return (
      <div className={cn(
        'group flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition',
        pinnedRow
          ? 'border-border bg-muted/40 hover:border-foreground/20'
          : 'border-transparent hover:border-border hover:bg-accent/40',
      )}>
        {pinnedRow && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" />}
        <button
          onClick={() => run(cmd)}
          className="min-w-0 flex-1 text-left font-mono text-[11px] leading-snug tabular-nums text-foreground/85 transition hover:text-foreground"
          title={t({ zh: '点击执行（并打开控制台查看输出）', en: 'Click to run (opens the console to show output)' })}
        >
          <Matched text={cmd} q={q} />
        </button>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={() => toggleCmdPin(cmd)}
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-accent',
              isPinned ? 'text-amber-500' : 'text-muted-foreground/60 hover:text-amber-500',
            )}
            title={isPinned ? t({ zh: '取消置顶', en: 'Unpin' }) : t({ zh: '置顶（常用工作流）', en: 'Pin (frequent workflows)' })}
          >
            <Star className={cn('h-3 w-3', isPinned && 'fill-current')} />
          </button>
          <button
            onClick={() => fill(cmd)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition hover:bg-accent hover:text-foreground"
            title={t({ zh: '填入控制台输入行编辑', en: 'Fill into the console input line for editing' })}
          >
            <PencilLine className="h-3 w-3" />
          </button>
          <button
            onClick={() => copy(cmd)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/60 transition hover:bg-accent hover:text-foreground"
            title={t({ zh: '复制命令', en: 'Copy command' })}
          >
            <Copy className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }

  const total = history.length
  const matchCount = pinned.length + rest.length

  return (
    <Dialog open={open} onOpenChange={v => { setUi({ historyOpen: v }); if (!v) setQuery('') }}>
      <DialogContent className="mol-elevate-lg max-w-2xl gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="gap-1.5 border-b border-border px-4 pb-2.5 pt-3.5">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-muted-foreground" />
            {t({ zh: '命令历史', en: 'Command history' })}
            <span className="font-mono text-[10px] font-normal tabular-nums text-muted-foreground">
              {q ? `${matchCount}/${total}` : t({ zh: `${total} 条`, en: `${total} entries` })}
            </span>
            {pins.length > 0 && (
              <span className="flex items-center gap-1 font-mono text-[10px] font-normal tabular-nums text-muted-foreground">
                <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" />{t({ zh: `${pins.length} 置顶`, en: `${pins.length} pinned` })}
              </span>
            )}
            <span className="mol-micro ml-auto mr-9 text-muted-foreground">HISTORY</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t({ zh: '完整历史（新 → 旧，上限 200 条跨会话保存）——点击', en: 'Full history (newest → oldest, capped at 200 entries, kept across sessions) — click to ' })}<span className="text-foreground/80">{t({ zh: '执行', en: 'run' })}</span>{t({ zh: '、铅笔', en: ', pencil to ' })}<span className="text-foreground/80">{t({ zh: '填入编辑', en: 'fill & edit' })}</span>{t({ zh: '、星标', en: ', star to ' })}<span className="text-foreground/80">{t({ zh: '置顶常用', en: 'pin frequent' })}</span>{t({ zh: '。', en: '.' })}
          </DialogDescription>
        </DialogHeader>

        {/* 搜索 */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 transition focus-within:border-foreground/25">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setQuery('')
                if (e.key === 'Enter' && (pinned[0] ?? rest[0])) run(pinned[0] ?? rest[0])
              }}
              placeholder={t({ zh: '搜索历史命令…（Enter 执行首个匹配）', en: 'Search history… (Enter runs the first match)' })}
              className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted-foreground/40"
              spellCheck={false}
              autoComplete="off"
            />
            {query && (
              <button onClick={() => setQuery('')} className="shrink-0 text-muted-foreground/60 transition hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          {total > 0 && (
            <button
              onClick={() => {
                clearCmdHistory()
                toast.success(tt({ zh: '命令历史已清空', en: 'Command history cleared' }), { description: tt({ zh: '最近命令徽章与 Ctrl+R 搜索同步清除（置顶保留）', en: 'Recent chips and the Ctrl+R search are cleared too (pins kept)' }) })
              }}
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-[10px] font-medium text-muted-foreground transition hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
              title={t({ zh: '清空全部历史（置顶命令保留）', en: 'Clear all history (pinned commands kept)' })}
            >
              <Trash2 className="h-3 w-3" />
              {t({ zh: '清空', en: 'Clear' })}
            </button>
          )}
        </div>

        {/* 列表 */}
        <div className="mol-scroll max-h-[46vh] overflow-y-auto px-2.5 py-2">
          {total === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <History className="h-8 w-8 text-muted-foreground/25" />
              <p className="text-xs text-muted-foreground">{t({ zh: '暂无历史命令——在控制台跑几条命令（load 4hhb / preset cartoon …）后这里会记录', en: 'No history yet — run a few commands in the console (load 4hhb / preset cartoon …) and they will show up here' })}</p>
            </div>
          ) : matchCount === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              {t({ zh: `没有匹配「${query}」的历史命令`, en: `No history matching "${query}"` })}
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <div className="mb-1.5">
                  <div className="mol-micro flex items-center gap-1.5 px-2 pb-1.5 text-muted-foreground">
                    <Star className="h-2.5 w-2.5 fill-amber-500 text-amber-500" /> {t({ zh: '置顶', en: 'Pinned' })}
                  </div>
                  <div className="space-y-0.5">
                    {pinned.map(cmd => <Row key={`p-${cmd}`} cmd={cmd} pinnedRow />)}
                  </div>
                </div>
              )}
              {rest.length > 0 && (
                <div>
                  {pinned.length > 0 && (
                    <div className="mol-micro flex items-center gap-1.5 px-2 pb-1.5 text-muted-foreground/70">
                      <ArrowUpRight className="h-2.5 w-2.5" /> {t({ zh: '全部历史', en: 'All history' })}
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {rest.slice(0, 120).map(cmd => <Row key={cmd} cmd={cmd} />)}
                  </div>
                  {rest.length > 120 && (
                    <p className="px-2 pt-1.5 text-[10px] text-muted-foreground/60">
                      {t({ zh: `仅显示最近 120 条（共 ${rest.length}）——输入关键词精确定位`, en: `Showing the latest 120 of ${rest.length} — type a keyword to narrow down` })}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-row items-center gap-3 border-t border-border px-4 py-2.5">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <Play className="h-2.5 w-2.5" />{t({ zh: '点击行 = 执行', en: 'click a row = run' })}
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <Star className="h-2.5 w-2.5" />{t({ zh: '置顶常用工作流', en: 'pin frequent workflows' })}
          </span>
          <span className="ml-auto hidden text-[10px] text-muted-foreground/60 sm:inline">
            {t({ zh: '控制台内', en: 'Inside the console:' })} <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">Ctrl+R</kbd> {t({ zh: '快速搜索', en: 'quick search' })}
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
