'use client'

// movie 序列播放指示器：胶片图标 + 当段视角名 + 段进度条 + 停止按钮
// 演示引导进行中隐藏（引导卡可占满短视口；movie 仍可用——Esc 停止 / 工具栏 Film 按钮有状态）
import { Film, Square, Waves } from 'lucide-react'
import { useMovieStore, stopMovie } from '@/lib/molecular/movie'
import { useTourStore } from '@/lib/molecular/tour-store'
import { cn } from '@/lib/utils'

export function MovieBadge() {
  const playing = useMovieStore(s => s.playing)
  const seg = useMovieStore(s => s.seg)
  const total = useMovieStore(s => s.total)
  const name = useMovieStore(s => s.currentName)
  const loops = useMovieStore(s => s.loops)
  const duration = useMovieStore(s => s.duration)
  const smooth = useMovieStore(s => s.playingSmooth)
  const tourActive = useTourStore(s => s.tour !== null)

  if (!playing || tourActive) return null
  const pct = total > 0 ? Math.min(100, ((seg + 1) / total) * 100) : 0
  const round = total > 0 ? Math.floor(seg / Math.max(1, total / loops)) + 1 : 1

  return (
    <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 flex-col items-center">
      <div className="flex items-center gap-2.5 rounded-full border border-border/60 bg-popover/95 py-1.5 pl-3 pr-1.5 shadow-lg backdrop-blur">
        <span className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full',
          smooth ? 'bg-teal-500/15 text-teal-600 dark:text-teal-400' : 'bg-muted text-muted-foreground',
        )}>
          {smooth ? <Waves className="h-3 w-3" /> : <Film className="h-3 w-3" />}
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] font-semibold text-foreground">
            movie{smooth ? ' · 平滑巡航' : ''} · {name ?? `视角 ${seg + 1}`}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            段 {seg + 1}/{total} · 第 {round}/{loops} 轮 · {(duration / 1000).toFixed(1)}s/视角
          </span>
        </div>
        <button
          onClick={stopMovie}
          className="flex h-6 items-center gap-1 rounded-full bg-primary px-2 text-[10px] font-semibold text-primary-foreground transition hover:opacity-90"
          title="停止序列播放（Esc）"
        >
          <Square className="h-3 w-3 fill-current" /> 停止
        </button>
      </div>
      {/* 段进度条 */}
      <div className="mx-auto mt-1 h-1 w-[80%] overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
