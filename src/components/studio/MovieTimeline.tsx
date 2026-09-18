'use client'

// movie 时间轴编排面板（视口底部）：视角书签关键帧的可视化编排
// - 关键帧卡片（缩略图 + 名称 + 时长徽章）横向排列，箭头连接
// - 拖拽排序（pointer capture + 插入指示条）；点选卡片 → 底部控制行编辑时长/预览/删除
// - 播放走时间轴模式（逐段独立时长）；轮数可调；localStorage 持久化（molvision-movie-v1）
// 打开时 EnsembleBar / 快速风格按钮上移让位（MolViewer 按 bottom-[196px] 处理）
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Eye, Film, Minus, Pause, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { playMovie, stopMovie, useMovieStore, type TimelineEntry } from '@/lib/molecular/movie'
import { useViewsStore, type ViewBookmark } from '@/lib/molecular/views-store'
import { cn } from '@/lib/utils'
import { FadeEdge } from './FadeEdge'

/** 时长步进（ms） */
const DUR_STEP = 200
/** 拖拽位移超过该值（px）才视为排序操作（否则当作点击选择） */
const DRAG_THRESHOLD = 5

export function MovieTimeline() {
  const open = useMovieStore(s => s.timelineOpen)
  const timeline = useMovieStore(s => s.timeline)
  const loopsEdit = useMovieStore(s => s.loopsEdit)
  const playing = useMovieStore(s => s.playing)
  const seg = useMovieStore(s => s.seg)
  const hydrate = useMovieStore(s => s.hydrate)
  const setTimelineOpen = useMovieStore(s => s.setTimelineOpen)
  const syncTimeline = useMovieStore(s => s.syncTimeline)
  const reorderTimeline = useMovieStore(s => s.reorderTimeline)
  const setEntryDuration = useMovieStore(s => s.setEntryDuration)
  const removeEntry = useMovieStore(s => s.removeEntry)
  const setLoopsEdit = useMovieStore(s => s.setLoopsEdit)
  const clearTimeline = useMovieStore(s => s.clearTimeline)
  const bookmarks = useViewsStore(s => s.bookmarks)

  const [selected, setSelected] = useState<number | null>(null)
  // 拖拽状态：from = 拖起卡片下标；dx = 位移；insert = 插入槽位（0..n，n = 追加到末尾）
  const [drag, setDrag] = useState<{ from: number; dx: number; insert: number } | null>(null)
  const dragStartX = useRef(0)
  const dragMoved = useRef(false)
  const nodeRefs = useRef<(HTMLDivElement | null)[]>([])
  const rectsAtDrag = useRef<DOMRect[]>([])

  // 客户端装载 localStorage 时间轴存档
  useEffect(() => { hydrate() }, [hydrate])

  /** 插入指示条是否画在卡片 i 之前（原位/相邻无操作时隐藏） */
  const insertBeforeSlot = (i: number): boolean => {
    if (!drag) return false
    if (drag.insert === drag.from || drag.insert === drag.from + 1) return false
    return drag.insert === i
  }
  /** 末尾追加指示条 */
  const insertAtEnd = (): boolean => {
    if (!drag) return false
    if (drag.insert === drag.from || drag.insert === drag.from + 1) return false
    return drag.insert === timeline.length
  }

  if (!open) return null

  const byId = new Map(bookmarks.map(b => [b.id, b] as const))
  const entries = timeline.map(e => ({ e, view: byId.get(e.viewId) }))
  const validCount = entries.filter(x => x.view).length
  const totalMs = timeline.reduce((s, e) => s + e.duration, 0)

  // ---------- 拖拽排序 ----------
  const onNodePointerDown = (ev: React.PointerEvent, i: number) => {
    if (ev.button !== 0) return
    ev.stopPropagation()
    const el = nodeRefs.current[i]
    if (!el) return
    try { el.setPointerCapture(ev.pointerId) } catch { /* 合成事件/非活动指针：直接走元素级事件即可 */ }
    dragStartX.current = ev.clientX
    dragMoved.current = false
    rectsAtDrag.current = nodeRefs.current.map(n => n?.getBoundingClientRect() ?? new DOMRect())
    setSelected(i)
    setDrag({ from: i, dx: 0, insert: i })
  }
  const onNodePointerMove = (ev: React.PointerEvent) => {
    if (!drag) return
    ev.stopPropagation()
    const dx = ev.clientX - dragStartX.current
    if (Math.abs(dx) > DRAG_THRESHOLD) dragMoved.current = true
    // 计算插入槽位：指针越过哪些卡片中点（0 = 最前，n = 追加末尾）
    const rects = rectsAtDrag.current
    let insert = 0
    for (let k = 0; k < rects.length; k++) {
      const mid = rects[k].left + rects[k].width / 2
      if (ev.clientX > mid) insert = Math.min(k + 1, rects.length)
    }
    setDrag({ ...drag, dx, insert })
  }
  const onNodePointerUp = () => {
    if (!drag) return
    const { from, insert } = drag
    setDrag(null)
    if (dragMoved.current && insert !== from && insert !== from + 1) {
      // insert 语义 = 插入到当前数组下标 insert 之前；先移除 from 后目标 = insert > from ? insert-1 : insert
      const to = insert > from ? insert - 1 : insert
      reorderTimeline(from, to)
      setSelected(to)
    }
  }

  // ---------- 动作 ----------
  const doSync = () => {
    const n = syncTimeline()
    setSelected(null)
    if (n === 0) toast.info('当前没有视角书签', { description: '先在 3D 视口中按 V 键保存机位（或 view save 名称）' })
    else toast.success(`已同步 ${n} 个书签为关键帧`, { description: '拖拽卡片排序 · 点选后调时长 · 播放按时间轴巡航' })
  }
  const doPlay = () => {
    if (playing) { stopMovie(); return }
    void playMovie({ useTimeline: true }).then(r => {
      if (!r.ok) toast.error(r.error)
      else toast.success('movie 时间轴播放中', { description: `${r.segs} 段逐段巡航 · 拖动/滚轮接管或 Esc 停止 · record start 可同步录制` })
    })
  }
  const previewView = (view: ViewBookmark) => {
    useViewsStore.getState().restoreBookmark(view.id, true)
  }

  const sel = selected !== null && selected < entries.length ? entries[selected] : null
  const canPlay = validCount >= 2

  return (
    <div
      className={cn(
        'absolute bottom-3 left-1/2 z-20 w-max -translate-x-1/2',
        'flex max-w-[calc(100%-24px)] flex-col gap-1.5 rounded-2xl border border-teal-500/30 bg-popover/95 p-2.5 shadow-2xl backdrop-blur-md',
        'sm:max-w-[min(720px,calc(100%-260px))]',
      )}
      onPointerDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
    >
      {/* 头部：标题 + 统计 + 操作 */}
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-teal-500/15 text-teal-600 dark:text-teal-400">
          <Film className="h-3 w-3" />
        </span>
        <span className="text-[11px] font-semibold text-foreground">movie 时间轴</span>
        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {validCount}/{timeline.length} 关键帧 · {(totalMs / 1000).toFixed(1)}s/轮
        </span>
        <div className="flex-1" />
        <button
          onClick={doSync}
          className="flex h-6 items-center gap-1 rounded-md border border-border/60 bg-background/60 px-2 text-[10px] font-medium text-foreground transition hover:bg-accent"
          title="用当前视角书签重建关键帧（保留已有时长设置）"
        >
          <RefreshCw className="h-3 w-3" /> 同步书签
        </button>
        {timeline.length > 0 && (
          <button
            onClick={() => { clearTimeline(); setSelected(null) }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-red-500/10 hover:text-red-500"
            title="清空时间轴（不影响书签本体）"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        )}
        <button
          onClick={() => setTimelineOpen(false)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          title="关闭时间轴（工具栏 Film 按钮可重新打开）"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 关键帧卡片带（横向滚动） */}
      {timeline.length === 0 ? (
        <div className="flex h-[76px] w-[min(560px,70vw)] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/70 bg-muted/30 text-center">
          <span className="text-[11px] text-muted-foreground">时间轴为空——「同步书签」把视角书签导入为关键帧</span>
          <span className="text-[10px] text-muted-foreground/70">V 键保存机位 · view save 名称 · 上限 12 帧</span>
        </div>
      ) : (
        <FadeEdge className="max-w-full items-center py-1">
          {entries.map(({ e, view }, i) => {
            const isDragging = drag?.from === i
            return (
              <div key={e.viewId} className="flex items-center">
                {/* 插入指示条 */}
                {insertBeforeSlot(i) && <div data-insert-slot={i} className="mx-0.5 h-14 w-[3px] shrink-0 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.7)]" />}
                <div
                  ref={el => { nodeRefs.current[i] = el }}
                  onPointerDown={ev => onNodePointerDown(ev, i)}
                  onPointerMove={onNodePointerMove}
                  onPointerUp={onNodePointerUp}
                  onPointerCancel={onNodePointerUp}
                  onClick={() => { if (!dragMoved.current) setSelected(i) }}
                  className={cn(
                    'relative w-[68px] shrink-0 cursor-grab touch-none select-none rounded-lg border bg-card/90 p-1 transition',
                    selected === i ? 'border-teal-400/80 ring-1 ring-teal-400/40' : 'border-border/60 hover:border-teal-400/40',
                    isDragging && 'z-10 cursor-grabbing border-teal-400 opacity-90 shadow-xl',
                  )}
                  style={isDragging ? { transform: `translateX(${drag!.dx}px) scale(1.05)` } : undefined}
                  title={`${view?.name ?? '书签已删除'} · ${(e.duration / 1000).toFixed(1)}s（拖拽排序 · 点击选中）`}
                >
                  {view?.thumb ? (
                    <img src={view.thumb} alt={view.name} className="h-9 w-full rounded-md object-cover" draggable={false} />
                  ) : (
                    <div className={cn(
                      'flex h-9 w-full items-center justify-center rounded-md text-[9px]',
                      view ? 'bg-muted/70 text-muted-foreground' : 'bg-red-500/10 text-red-500',
                    )}>
                      {view ? '无缩略图' : '已失效'}
                    </div>
                  )}
                  <div className="mt-0.5 truncate text-center text-[9px] font-medium leading-tight text-foreground/90">
                    {view?.name ?? '（失效书签）'}
                  </div>
                  <div className="text-center font-mono text-[9px] tabular-nums leading-tight text-teal-600 dark:text-teal-400">
                    {(e.duration / 1000).toFixed(1)}s
                  </div>
                  {/* 播放中当前段脉冲点 */}
                  {playing && validCount > 0 && seg % validCount === i && (
                    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 animate-pulse rounded-full bg-teal-400 shadow" />
                  )}
                </div>
                {/* 连接箭头（末尾不画） */}
                {i < entries.length - 1 && (
                  <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" />
                )}
              </div>
            )
          })}
          {/* 末尾追加槽位指示条 */}
          {insertAtEnd() && <div data-insert-end className="mx-0.5 h-14 w-[3px] shrink-0 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.7)]" />}
        </FadeEdge>
      )}

      {/* 控制行：播放 + 轮数 + 选中卡片编辑 */}
      <div className="flex h-8 items-center gap-2">
        <button
          onClick={doPlay}
          disabled={!canPlay}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded-full px-3 text-[11px] font-semibold text-white shadow-md transition active:scale-95',
            playing
              ? 'bg-gradient-to-r from-amber-500 to-orange-600 hover:brightness-110'
              : canPlay ? 'bg-gradient-to-r from-teal-500 to-emerald-600 hover:brightness-110' : 'cursor-not-allowed from-muted to-muted text-muted-foreground shadow-none',
          )}
        >
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}
          {playing ? '停止' : `播放 ${validCount} 帧`}
        </button>
        {/* 轮数 stepper */}
        <div className="flex h-7 shrink-0 items-center rounded-full border border-border/60 bg-background/60 pl-2 pr-1">
          <span className="text-[10px] text-muted-foreground">轮数</span>
          <button
            onClick={() => setLoopsEdit(loopsEdit - 1)}
            className="mx-0.5 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="减少循环轮数"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="w-4 text-center font-mono text-[11px] font-bold tabular-nums text-foreground">{loopsEdit}</span>
          <button
            onClick={() => setLoopsEdit(loopsEdit + 1)}
            className="mx-0.5 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="增加循环轮数"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
        {/* 选中卡片编辑 */}
        {sel && sel.view ? (
          <div className="flex h-7 min-w-0 items-center gap-1 overflow-x-auto rounded-full border border-border/60 bg-background/60 px-2">
            <span className="max-w-24 shrink-0 truncate text-[10px] font-medium text-foreground/90">{sel.view.name}</span>
            <span className="shrink-0 text-[9px] text-muted-foreground">时长</span>
            <button
              onClick={() => setEntryDuration(selected!, timeline[selected!].duration - DUR_STEP)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
              title="减少 0.2s"
            >
              <Minus className="h-3 w-3" />
            </button>
            <span className="w-10 shrink-0 text-center font-mono text-[10px] font-bold tabular-nums text-teal-600 dark:text-teal-400">
              {(timeline[selected!].duration / 1000).toFixed(1)}s
            </span>
            <button
              onClick={() => setEntryDuration(selected!, timeline[selected!].duration + DUR_STEP)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
              title="增加 0.2s"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              onClick={() => previewView(sel.view!)}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-accent hover:text-foreground"
              title="预览此机位（平滑过渡）"
            >
              <Eye className="h-3 w-3" />
            </button>
            <button
              onClick={() => { removeEntry(selected!); setSelected(null) }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-red-500/10 hover:text-red-500"
              title="从时间轴移除此关键帧"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ) : (
          <span className="truncate text-[10px] text-muted-foreground/80">
            {timeline.length ? '点击卡片编辑时长 · 拖拽排序 · 「预览」查看机位' : '同步后可拖拽排序、逐段调时长'}
          </span>
        )}
      </div>
    </div>
  )
}

// TimelineEntry 类型仅作 re-export 便利（供调用侧 typing）
export type { TimelineEntry }
