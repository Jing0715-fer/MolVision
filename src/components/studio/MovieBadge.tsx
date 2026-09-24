'use client'

// movie 序列播放指示器：胶片图标 + 当段视角名 + 段进度条 + 停止按钮
// 演示引导进行中隐藏（引导卡可占满短视口；movie 仍可用——Esc 停止 / 工具栏 Film 按钮有状态）
import { Film, Square } from 'lucide-react'
import { useMovieStore, stopMovie } from '@/lib/molecular/movie'
import { useTourStore } from '@/lib/molecular/tour-store'
import { useI18n } from '@/i18n'

export function MovieBadge() {
  const { t } = useI18n()
  const playing = useMovieStore(s => s.playing)
  const seg = useMovieStore(s => s.seg)
  const total = useMovieStore(s => s.total)
  const name = useMovieStore(s => s.currentName)
  const loops = useMovieStore(s => s.loops)
  const duration = useMovieStore(s => s.duration)
  const tourActive = useTourStore(s => s.tour !== null)

  if (!playing || tourActive) return null
  const pct = total > 0 ? Math.min(100, ((seg + 1) / total) * 100) : 0
  const round = total > 0 ? Math.floor(seg / Math.max(1, total / loops)) + 1 : 1

  return (
    <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 flex-col items-center">
      <div className="flex items-center gap-2.5 rounded-full border border-border bg-popover py-1.5 pl-3 pr-1.5 mol-elevate">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Film className="h-3 w-3" />
        </span>
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] font-semibold text-foreground">
            movie · {name ?? t({ zh: `视角 ${seg + 1}`, en: `View ${seg + 1}` })}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {t({ zh: `段 ${seg + 1}/${total} · 第 ${round}/${loops} 轮 · ${(duration / 1000).toFixed(1)}s/视角`, en: `Seg ${seg + 1}/${total} · round ${round}/${loops} · ${(duration / 1000).toFixed(1)}s/view` })}
          </span>
        </div>
        <button
          onClick={stopMovie}
          className="flex h-6 items-center gap-1 rounded-full bg-primary px-2 text-[10px] font-semibold text-primary-foreground transition hover:opacity-90"
          title={t({ zh: '停止序列播放（Esc）', en: 'Stop playback (Esc)' })}
        >
          <Square className="h-3 w-3 fill-current" /> {t({ zh: '停止', en: 'Stop' })}
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
