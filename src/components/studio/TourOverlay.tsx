'use client'

// 演示场景引导卡片：视口顶部居中浮层，逐步讲解并执行动作
import { useState } from 'react'
import {
  ChevronLeft, ChevronRight, Dna, FlaskConical, Layers, Pill, Waves, X, Copy, Check, Loader2, Puzzle,
} from 'lucide-react'
import { useTourStore } from '@/lib/molecular/tour-store'
import type { TourAccent, TourIcon } from '@/lib/molecular/tours'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const ICONS: Record<TourIcon, typeof FlaskConical> = {
  flask: FlaskConical,
  pill: Pill,
  layers: Layers,
  waves: Waves,
  dna: Dna,
  puzzle: Puzzle,
}

const ACCENT: Record<TourAccent, { icon: string; chip: string; bar: string; ring: string }> = {
  emerald: {
    icon: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/15',
    chip: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
    bar: 'bg-emerald-500',
    ring: 'bg-emerald-500',
  },
  rose: {
    icon: 'text-rose-600 dark:text-rose-400 bg-rose-500/15',
    chip: 'text-rose-700 dark:text-rose-300 border-rose-500/40 bg-rose-500/10',
    bar: 'bg-rose-500',
    ring: 'bg-rose-500',
  },
  amber: {
    icon: 'text-amber-600 dark:text-amber-400 bg-amber-500/15',
    chip: 'text-amber-700 dark:text-amber-300 border-amber-500/40 bg-amber-500/10',
    bar: 'bg-amber-500',
    ring: 'bg-amber-500',
  },
  teal: {
    icon: 'text-teal-600 dark:text-teal-400 bg-teal-500/15',
    chip: 'text-teal-700 dark:text-teal-300 border-teal-500/40 bg-teal-500/10',
    bar: 'bg-teal-500',
    ring: 'bg-teal-500',
  },
  violet: {
    icon: 'text-violet-600 dark:text-violet-400 bg-violet-500/15',
    chip: 'text-violet-700 dark:text-violet-300 border-violet-500/40 bg-violet-500/10',
    bar: 'bg-violet-500',
    ring: 'bg-violet-500',
  },
  fuchsia: {
    icon: 'text-fuchsia-600 dark:text-fuchsia-400 bg-fuchsia-500/15',
    chip: 'text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/40 bg-fuchsia-500/10',
    bar: 'bg-fuchsia-500',
    ring: 'bg-fuchsia-500',
  },
}

/** 命令 chip：点击复制（key=步骤索引挂载，切换步骤自动重置内部状态） */
function CmdChip({ cmd, accent }: { cmd: string; accent: TourAccent }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    try {
      void navigator.clipboard.writeText(cmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('复制失败')
    }
  }
  return (
    <button
      onClick={copy}
      className={cn(
        'mt-2.5 flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition hover:brightness-105',
        ACCENT[accent].chip,
      )}
      title="点击复制命令"
    >
      <span className="font-mono text-[10px] font-bold opacity-60">»</span>
      <code className="flex-1 truncate font-mono text-[11px]">{cmd}</code>
      {copied
        ? <Check className="h-3 w-3 shrink-0" />
        : <Copy className="h-3 w-3 shrink-0 opacity-50" />}
    </button>
  )
}

export function TourOverlay() {
  const tour = useTourStore(s => s.tour)
  const stepIdx = useTourStore(s => s.stepIdx)
  const busy = useTourStore(s => s.busy)
  const next = useTourStore(s => s.next)
  const prev = useTourStore(s => s.prev)
  const stop = useTourStore(s => s.stop)

  if (!tour) return null
  const step = tour.steps[stepIdx]
  if (!step) return null
  const accent = ACCENT[tour.accent]
  const Icon = ICONS[tour.icon]
  const isLast = stepIdx >= tour.steps.length - 1

  return (
    <div
      role="region"
      aria-label={`演示引导：${tour.title}`}
      className="tour-in absolute left-1/2 top-3 z-40 w-[min(30rem,calc(100%-1.5rem))] -translate-x-1/2"
    >
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card/95 shadow-lg backdrop-blur-md">
        {/* 章节顶条（单色） */}
        <div className={cn('h-1 w-full', accent.ring)} />

        {/* 头部 */}
        <div className="flex items-center gap-2.5 border-b border-border/60 px-3.5 py-2.5">
          <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg', accent.icon)}>
            <Icon className="h-4 w-4" strokeWidth={1.9} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold tracking-tight">{tour.title}</div>
            <div className="text-[10px] text-muted-foreground">
              第 {stepIdx + 1} / {tour.steps.length} 步{busy ? ' · 执行中…' : ''}
            </div>
          </div>
          <button
            onClick={stop}
            aria-label="结束演示"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* 进度段 */}
        <div className="flex gap-1 px-3.5 pt-2.5">
          {tour.steps.map((_, i) => (
            <button
              key={i}
              onClick={() => void useTourStore.getState().go(i)}
              aria-label={`跳到第 ${i + 1} 步`}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors hover:bg-muted-foreground/50',
                i === stepIdx ? accent.bar : i < stepIdx ? 'bg-muted-foreground/40' : 'bg-muted',
              )}
            />
          ))}
        </div>

        {/* 正文 */}
        <div className="px-3.5 pb-3 pt-2.5">
          <div className="text-sm font-semibold leading-snug">{step.title}</div>
          <p className="mt-1.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
            {step.body}
          </p>
          {step.cmd && <CmdChip key={stepIdx} cmd={step.cmd} accent={tour.accent} />}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center gap-2 border-t border-border/60 bg-muted/30 px-3.5 py-2.5">
          <button
            onClick={prev}
            disabled={stepIdx === 0}
            className="flex h-7 items-center gap-1 rounded-md border border-border/70 px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-35"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">上一步</span>
          </button>
          <div className="flex-1 text-center text-[10px] text-muted-foreground/70">
            <span className="hidden sm:inline">← / → 键切换 · Esc 结束</span>
          </div>
          <button
            onClick={() => void next()}
            disabled={busy}
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60',
              accent.bar,
            )}
          >
            {busy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ChevronRight className="h-3.5 w-3.5" />}
            {isLast ? '完成' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  )
}
