'use client'

// 底部状态栏：结构统计 / 悬停信息 / 选择摘要 / 测量模式提示
import { Circle, Ruler, Triangle, Rotate3d, Layers, Zap, Waves } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { useHoverStore } from '@/lib/molecular/hover-store'
import { useHBondStore } from '@/lib/molecular/hbond-store'
import { useEnsembleStore } from '@/lib/molecular/ensemble-store'
import { cn } from '@/lib/utils'

export function StatusBar() {
  const hoverText = useHoverStore(s => s.text)
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const selection = useMolStore(s => s.selection)
  const measureMode = useMolStore(s => s.measureMode)
  const measurePicks = useMolStore(s => s.measurePicks)
  const settings = useMolStore(s => s.settings)
  const hbond = useHBondStore(s => s)
  const ens = useEnsembleStore(s => s)

  const st = structures.find(x => x.id === activeId)
  const need = measureMode === 'distance' ? 2 : measureMode === 'angle' ? 3 : measureMode === 'dihedral' ? 4 : 0

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border/70 bg-card/60 px-3 text-[10px] text-muted-foreground backdrop-blur-sm">
      {/* 结构统计 */}
      {st ? (
        <span className="flex shrink-0 items-center gap-1.5 font-medium">
          <span className="font-mono font-bold text-foreground/80">{st.name}</span>
          <span className="text-muted-foreground/60">
            {st.summary.atoms.toLocaleString()} 原子 · {st.summary.residues.toLocaleString()} 残基 · {st.summary.chains} 链
          </span>
        </span>
      ) : (
        <span className="shrink-0">就绪 — 等待加载结构</span>
      )}

      <span className="hidden h-3 w-px bg-border lg:block" />

      {/* 悬停 */}
      <span className="hidden min-w-0 flex-1 truncate lg:block">
        {hoverText ?? '\u00A0'}
      </span>
      <span className="flex-1 lg:hidden" />

      {/* 选择 */}
      {selection.indices.length > 0 && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
          <Circle className="h-2 w-2 fill-current" />
          已选 {selection.indices.length.toLocaleString()} 原子
        </span>
      )}

      {/* 显示过滤提示 */}
      {(settings.hideHydrogens || settings.hideWater) && (
        <span className="hidden shrink-0 items-center gap-1 text-muted-foreground/70 sm:flex">
          <Layers className="h-3 w-3" />
          {settings.hideHydrogens && 'H'}
          {settings.hideHydrogens && settings.hideWater && '+'}
          {settings.hideWater && 'H₂O'} 已隐藏
        </span>
      )}

      {/* 氢键网络 */}
      {hbond.visible && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 font-medium text-teal-600 dark:text-teal-400">
          <Zap className="h-3 w-3" />
          {hbond.count.toLocaleString()} 氢键
          {hbond.waterCount > 0 && <span className="text-[9px] text-muted-foreground/70">（含水 {hbond.waterCount}）</span>}
        </span>
      )}

      {/* NMR ensemble */}
      {ens.structureId && ens.total >= 2 && (
        <span className={cn(
          'hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium sm:flex',
          ens.playing ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300' : 'text-muted-foreground/70',
        )}>
          <Waves className={cn('h-3 w-3', ens.playing && 'animate-pulse')} />
          {ens.playing ? `构象 ${ens.frame + 1}/${ens.total}` : `ensemble ${ens.total} 帧`}
        </span>
      )}

      {/* 测量模式 */}
      {measureMode !== 'off' && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400">
          {measureMode === 'distance' && <Ruler className="h-3 w-3" />}
          {measureMode === 'angle' && <Triangle className="h-3 w-3" />}
          {measureMode === 'dihedral' && <Rotate3d className="h-3 w-3" />}
          {measureMode === 'distance' ? '测距' : measureMode === 'angle' ? '测角' : '二面角'}
          {measurePicks ? ` ${measurePicks.atoms.length}/${need}` : ` 0/${need}`}
          <span className={cn('text-[9px] text-muted-foreground/70')}>Esc 退出</span>
        </span>
      )}
    </footer>
  )
}
