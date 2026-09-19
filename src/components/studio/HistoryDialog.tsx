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
import { cn } from '@/lib/utils'

/** 高亮搜索命中片段 */
function Matched({ text, q }: { text: string; q: string }) {
  if (!q) return <span className="break-all">{text}</span>
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return <span className="break-all">{text}</span>
  return (
    <span className="break-all">
      {text.slice(0, idx)}
      <span className="rounded-[2px] bg-primary/20 font-bold text-primary">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </span>
  )
}

export function HistoryDialog() {
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
    const t = setTimeout(() => searchRef.current?.focus(), 60)
    return () => clearTimeout(t)
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
      toast.success('已复制到剪贴板')
    } catch {
      toast.error('复制失败（浏览器权限）')
    }
  }

  const Row = ({ cmd, pinnedRow }: { cmd: string; pinnedRow?: boolean }) => {
    const isPinned = pins.includes(cmd)
    return (
      <div className={cn(
        'group flex items-center gap-1.5 rounded-md border px-2 py-1.5 transition',
        pinnedRow
          ? 'border-amber-500/30 bg-amber-500/[0.06] hover:border-amber-500/50'
          : 'border-transparent hover:border-border/60 hover:bg-accent/40',
      )}>
        {pinnedRow && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" />}
        <button
          onClick={() => run(cmd)}
          className="min-w-0 flex-1 text-left font-mono text-[11px] leading-snug text-foreground/85 transition hover:text-foreground"
          title="点击执行（并打开控制台查看输出）"
        >
          <Matched text={cmd} q={q} />
        </button>
        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
          <button
            onClick={() => toggleCmdPin(cmd)}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded transition hover:bg-accent',
              isPinned ? 'text-amber-500' : 'text-muted-foreground/60 hover:text-amber-500',
            )}
            title={isPinned ? '取消置顶' : '置顶（常用工作流）'}
          >
            <Star className={cn('h-3 w-3', isPinned && 'fill-current')} />
          </button>
          <button
            onClick={() => fill(cmd)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition hover:bg-accent hover:text-sky-500"
            title="填入控制台输入行编辑"
          >
            <PencilLine className="h-3 w-3" />
          </button>
          <button
            onClick={() => copy(cmd)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/60 transition hover:bg-accent hover:text-emerald-500"
            title="复制命令"
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
      <DialogContent className="max-w-2xl gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b border-border/60 px-4 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4 text-emerald-500" />
            命令历史
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-normal tabular-nums text-muted-foreground">
              {q ? `${matchCount}/${total} 匹配` : `${total} 条`}
            </span>
            {pins.length > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                <Star className="h-2.5 w-2.5 fill-current" />{pins.length} 置顶
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="text-xs">
            完整历史（新 → 旧，上限 200 条跨会话保存）——点击<span className="text-foreground/80">执行</span>、铅笔<span className="text-foreground/80">填入编辑</span>、星标<span className="text-foreground/80">置顶常用</span>。
          </DialogDescription>
        </DialogHeader>

        {/* 搜索 */}
        <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 transition focus-within:border-emerald-500/60 focus-within:bg-emerald-500/[0.05]">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') setQuery('')
                if (e.key === 'Enter' && (pinned[0] ?? rest[0])) run(pinned[0] ?? rest[0])
              }}
              placeholder="搜索历史命令…（Enter 执行首个匹配）"
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
                toast.success('命令历史已清空', { description: '最近命令徽章与 Ctrl+R 搜索同步清除（置顶保留）' })
              }}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[10px] font-medium text-muted-foreground transition hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
              title="清空全部历史（置顶命令保留）"
            >
              <Trash2 className="h-3 w-3" />
              清空
            </button>
          )}
        </div>

        {/* 列表 */}
        <div className="mol-scroll max-h-[46vh] overflow-y-auto px-2.5 py-2">
          {total === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <History className="h-8 w-8 text-muted-foreground/25" />
              <p className="text-xs text-muted-foreground">暂无历史命令——在控制台跑几条命令（load 4hhb / preset cartoon …）后这里会记录</p>
            </div>
          ) : matchCount === 0 ? (
            <div className="py-10 text-center text-xs text-muted-foreground">
              没有匹配「{query}」的历史命令
            </div>
          ) : (
            <>
              {pinned.length > 0 && (
                <div className="mb-1.5">
                  <div className="flex items-center gap-1.5 px-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-amber-600/80 dark:text-amber-400/80">
                    <Star className="h-2.5 w-2.5 fill-current" /> 置顶
                  </div>
                  <div className="space-y-0.5">
                    {pinned.map(cmd => <Row key={`p-${cmd}`} cmd={cmd} pinnedRow />)}
                  </div>
                </div>
              )}
              {rest.length > 0 && (
                <div>
                  {pinned.length > 0 && (
                    <div className="flex items-center gap-1.5 px-2 pb-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      <ArrowUpRight className="h-2.5 w-2.5" /> 全部历史
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {rest.slice(0, 120).map(cmd => <Row key={cmd} cmd={cmd} />)}
                  </div>
                  {rest.length > 120 && (
                    <p className="px-2 pt-1.5 text-[10px] text-muted-foreground/60">
                      仅显示最近 120 条（共 {rest.length}）——输入关键词精确定位
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-row items-center gap-3 border-t border-border/60 px-4 py-2.5">
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <Play className="h-2.5 w-2.5" />点击行 = 执行
          </span>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
            <Star className="h-2.5 w-2.5" />置顶常用工作流
          </span>
          <span className="ml-auto hidden text-[10px] text-muted-foreground/60 sm:inline">
            控制台内 <kbd className="rounded border border-border/60 bg-muted px-1 font-mono">Ctrl+R</kbd> 快速搜索
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
