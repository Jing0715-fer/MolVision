'use client'
// NMR ensemble 多构象动画播放条（仅当活动结构含 ensemble 数据时显示）
import { useEffect, useRef, useState } from 'react'
import { Pause, Play, Repeat, RotateCcw, Spline, Layers } from 'lucide-react'
import { useMolStore, dataRegistry } from '@/lib/molecular/store'
import { useEnsembleStore } from '@/lib/molecular/ensemble-store'
import { useMovieStore } from '@/lib/molecular/movie'
import { engineRef } from '@/lib/molecular/store'
import { cn } from '@/lib/utils'

const FPS_CHOICES = [2, 4, 8, 15, 30]

export function EnsembleBar() {
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const playing = useEnsembleStore(s => s.playing)
  const frame = useEnsembleStore(s => s.frame)
  const total = useEnsembleStore(s => s.total)
  const fps = useEnsembleStore(s => s.fps)
  const interp = useEnsembleStore(s => s.interp)
  const loop = useEnsembleStore(s => s.loop)
  const setTarget = useEnsembleStore(s => s.setTarget)
  // movie 时间轴打开时上移让位（底部中心重叠）
  const timelineOpen = useMovieStore(s => s.timelineOpen)

  // 本地拖动状态（拖动中不受引擎帧号回写干扰）
  const [dragging, setDragging] = useState(false)
  const [dragVal, setDragVal] = useState(0)
  const prevPlaying = useRef(false)

  // 活动/已加载结构变化时同步目标（活动结构无 ensemble 则找任一有 ensemble 的可见结构）
  useEffect(() => {
    if (!structures.length) {
      if (useEnsembleStore.getState().structureId !== null) setTarget(null, 0)
      return
    }
    const active = structures.find(s => s.id === activeId)
    const pick =
      (active && dataRegistry.get(active.id)?.ensemble ? active : null) ??
      structures.find(s => s.visible && dataRegistry.get(s.id)?.ensemble) ??
      null
    if (pick) {
      const n = dataRegistry.get(pick.id)!.ensemble!.frames.length
      const cur = useEnsembleStore.getState()
      if (cur.structureId !== pick.id) {
        engineRef.current?.pauseEnsemble()
        setTarget(pick.id, n)
      } else if (cur.total !== n) {
        setTarget(pick.id, n)
      }
    } else if (useEnsembleStore.getState().structureId !== null) {
      engineRef.current?.pauseEnsemble()
      setTarget(null, 0)
    }
  }, [structures, activeId, setTarget])

  if (!structures.length || total < 2 || !useEnsembleStore.getState().structureId) return null

  const sid = useEnsembleStore.getState().structureId!
  const entry = structures.find(s => s.id === sid)
  const ensData = entry ? dataRegistry.get(entry.id) : undefined
  const ensKind = ensData?.ensembleKind
  const isMorph = ensKind === 'morph' || ensKind === 'multimorph'
  const knots = ensData?.ensembleKnots ?? 0
  const shown = dragging ? dragVal : frame

  const togglePlay = () => {
    const eng = engineRef.current
    if (!eng) return
    if (playing) {
      eng.pauseEnsemble()
    } else {
      eng.playEnsemble(sid)
      // 从头播放若已到末帧
      if (!loop && frame >= total - 1) eng.setEnsembleFrame(sid, 0)
    }
  }

  const commitFrame = (v: number) => {
    setDragging(false)
    engineRef.current?.setEnsembleFrame(sid, v)
  }

  return (
    <div
      className={cn(
        'absolute left-1/2 z-10 -translate-x-1/2 transition-all duration-300',
        timelineOpen ? 'bottom-[196px]' : 'bottom-3',
        'flex items-center gap-2.5 rounded-lg border border-border/60 bg-popover/95 px-3 py-2 shadow-lg backdrop-blur-md',
      )}
      onPointerDown={e => e.stopPropagation()}
    >
      {/* 结构标识 */}
      <div className="hidden items-center gap-1.5 sm:flex">
        <Layers className="h-3.5 w-3.5 text-muted-foreground/70" />
        <span className="max-w-28 truncate text-[11px] font-semibold text-popover-foreground">{entry?.name ?? sid}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground">
          {isMorph ? (ensKind === 'multimorph' ? `多态 morph · ${knots} 态 · ` : 'morph · ') : 'NMR · '}{total}{isMorph ? ' 帧' : ' 构象'}
        </span>
      </div>

      {/* 播放/暂停 */}
      <button
        onClick={togglePlay}
        aria-label={playing ? '暂停构象动画' : '播放构象动画'}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-primary-foreground shadow-md transition',
          'bg-primary hover:opacity-90 active:scale-95',
          playing && 'bg-amber-600 hover:opacity-90',
        )}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>

      {/* 帧滑块 + 帧号 */}
      <div className="flex min-w-36 items-center gap-2 sm:min-w-48">
        <input
          type="range"
          min={0}
          max={total - 1}
          step={1}
          value={shown}
          aria-label="构象帧"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:transition hover:[&::-webkit-slider-thumb]:scale-110"
          onPointerDown={() => { prevPlaying.current = playing; if (playing) engineRef.current?.pauseEnsemble(); setDragging(true); setDragVal(frame) }}
          onChange={e => {
            const v = Number(e.target.value)
            if (dragging) setDragVal(v)
          }}
          onPointerUp={e => {
            const v = Number((e.target as HTMLInputElement).value)
            commitFrame(v)
          }}
          onKeyUp={e => {
            const v = Number((e.target as HTMLInputElement).value)
            commitFrame(v)
          }}
        />
        <span className="w-14 shrink-0 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
          {shown + 1} / {total}
        </span>
      </div>

      {/* FPS 选择 */}
      <div className="hidden items-center gap-0.5 rounded-md bg-muted/70 p-0.5 md:flex">
        {FPS_CHOICES.map(f => (
          <button
            key={f}
            onClick={() => useEnsembleStore.getState().setFps(f)}
            aria-label={`播放速度 ${f} 帧/秒`}
            className={cn(
              'rounded px-2 py-0.5 text-[10px] font-bold tabular-nums transition',
              fps === f ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {/* 插值开关 */}
      <button
        onClick={() => useEnsembleStore.getState().setInterp(!interp)}
        aria-label={interp ? '关闭帧间插值' : '开启帧间插值'}
        title={interp ? '插值：开（平滑过渡）' : '插值：关（逐帧跳变）'}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md transition',
          interp ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Spline className="h-3.5 w-3.5" />
      </button>

      {/* 循环开关 */}
      <button
        onClick={() => useEnsembleStore.getState().setLoop(!loop)}
        aria-label={loop ? '关闭循环播放' : '开启循环播放'}
        title={loop ? '循环：开' : '循环：关'}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md transition',
          loop ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <Repeat className="h-3.5 w-3.5" />
      </button>

      {/* 重置 */}
      <button
        onClick={() => engineRef.current?.resetEnsemble(sid)}
        aria-label="回到第 1 帧"
        title="回到第 1 帧"
        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
      >
        <RotateCcw className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
