'use client'

// 底部状态栏：结构统计 / 悬停信息 / 选择摘要 / 测量模式提示
import { Circle, Ruler, Triangle, Rotate3d, Layers, Zap, Waves, SunMedium, Network, Droplets, ArrowLeftRight, Copy, Grid3x3, Glasses } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { useHoverStore } from '@/lib/molecular/hover-store'
import { useHBondStore } from '@/lib/molecular/hbond-store'
import { useEnsembleStore } from '@/lib/molecular/ensemble-store'
import { useContactStore } from '@/lib/molecular/contacts-store'
import { useSasaStore } from '@/lib/molecular/sasa-store'
import { useMapStore } from '@/lib/molecular/map-store'
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
  const contact = useContactStore(s => s)
  const sasa = useSasaStore(s => s)
  const mapInfo = useMapStore(s => s.info)
  const mapComputing = useMapStore(s => s.computing)

  const st = structures.find(x => x.id === activeId)
  const symCount = structures.reduce((acc, x) => acc + (x.symmetry?.count ?? 0), 0)
  const need = measureMode === 'distance' ? 2 : measureMode === 'angle' ? 3 : measureMode === 'dihedral' ? 4 : 0
  // 密度图徽章文案（差图正负独立 σ 时着色 +x/−y）
  const mapLabel = (() => {
    if (!mapInfo) return null
    const trunc = mapInfo.truncated ? '+' : ''
    if (!mapInfo.difference) return <>密度 {mapInfo.iso.toFixed(1)}σ{trunc}</>
    if (Math.abs(mapInfo.iso - mapInfo.isoNeg) < 1e-6) return <>差图 {mapInfo.iso.toFixed(1)}σ{trunc}</>
    return <>差图 <span className="text-emerald-600 dark:text-emerald-400">+{mapInfo.iso.toFixed(1)}</span>/<span className="text-red-600 dark:text-red-400">−{mapInfo.isoNeg.toFixed(1)}</span>σ{trunc}</>
  })()

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-border/70 bg-card/60 px-3 text-[10px] text-muted-foreground backdrop-blur-sm">
      {/* 结构统计 */}
      {st ? (
        <span className="flex shrink-0 items-center gap-1.5 font-medium tabular-nums">
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
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 font-semibold tabular-nums text-primary ring-1 ring-primary/25">
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

      {/* 环境光遮蔽 */}
      {settings.ssao && (
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-600 dark:text-amber-400 md:flex">
          <SunMedium className="h-3 w-3" />
          AO {settings.ssaoRadius.toFixed(0)}Å
        </span>
      )}

      {/* 氢键网络 */}
      {hbond.visible && (
        <span className="flex shrink-0 items-center gap-1 rounded-full bg-teal-500/15 px-2 py-0.5 font-medium text-teal-600 dark:text-teal-400">
          {hbond.computing
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <Zap className="h-3 w-3" />}
          {hbond.computing ? '氢键计算中…' : `${hbond.count.toLocaleString()} 氢键`}
          {!hbond.computing && hbond.waterCount > 0 && <span className="text-[9px] text-muted-foreground/70">（含水 {hbond.waterCount}）</span>}
        </span>
      )}

      {/* 接触界面分析 */}
      {contact.structureId === activeId && contact.pairs.length > 0 && (
        <span
          className={cn(
            'hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium md:flex',
            contact.visible ? 'bg-orange-500/15 text-orange-600 dark:text-orange-400' : 'text-muted-foreground/60',
          )}
        >
          <Network className="h-3 w-3" />
          {contact.pairs.length.toLocaleString()} 接触
          <span className="text-[9px] text-muted-foreground/70">≤{contact.cutoff.toFixed(1)}Å</span>
        </span>
      )}

      {/* 跨结构接触 */}
      {contact.cross && contact.crossPairs.length > 0 && (
        <span
          className={cn(
            'hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 font-medium md:flex',
            contact.visible ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400' : 'text-muted-foreground/60',
          )}
        >
          <ArrowLeftRight className="h-3 w-3" />
          {contact.cross.labelA}↔{contact.cross.labelB} {contact.crossPairs.length.toLocaleString()} 跨接触
          <span className="text-[9px] text-muted-foreground/70">≤{contact.cross.cutoff.toFixed(1)}Å</span>
        </span>
      )}

      {/* SASA 分析结果（结构级） */}
      {sasa.structureId === activeId && (sasa.computing || sasa.total > 0) && (
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-cyan-500/15 px-2 py-0.5 font-medium text-cyan-600 dark:text-cyan-400 md:flex">
          {sasa.computing
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <Droplets className="h-3 w-3" />}
          {sasa.computing ? 'SASA 计算中…' : `SASA ${sasa.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} Å²`}
        </span>
      )}

      {/* 红蓝立体 */}
      {settings.stereo && (
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 font-medium text-rose-600 dark:text-rose-400 sm:flex">
          <Glasses className="h-3 w-3" /> 立体
        </span>
      )}

      {/* 对称伴侣 */}
      {symCount > 0 && (
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 font-medium text-violet-600 dark:text-violet-400 sm:flex">
          <Copy className="h-3 w-3" />
          {symCount} 对称伴侣
        </span>
      )}

      {/* 电子密度图 */}
      {(mapInfo || mapComputing) && (
        <span className="hidden shrink-0 items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 font-medium text-sky-600 dark:text-sky-400 sm:flex">
          {mapComputing
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <Grid3x3 className="h-3 w-3" />}
          {mapComputing
            ? '密度图计算中（Worker）…'
            : mapLabel}
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
