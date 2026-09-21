'use client'

// 底部状态栏：结构统计 / 悬停信息 / 选择摘要 / 测量模式提示 / 性能指示
// 设计：VS Code 状态栏风格 —— 无彩色胶囊墙，中性文字 + 图标；语义色只保留小色点与真警示（性能降级/低帧率/测量进行中）
import { Ruler, Triangle, Rotate3d, Layers, Gauge, Cpu, X } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { useHoverStore } from '@/lib/molecular/hover-store'
import { useHBondStore } from '@/lib/molecular/hbond-store'
import { useEnsembleStore } from '@/lib/molecular/ensemble-store'
import { useContactStore } from '@/lib/molecular/contacts-store'
import { useSasaStore } from '@/lib/molecular/sasa-store'
import { useMapStore } from '@/lib/molecular/map-store'
import { usePerfStore } from '@/lib/molecular/perf-store'
import { cn } from '@/lib/utils'

/** 语义色小圆点（1.5px 级别；替代原彩色胶囊背景，保留色彩语义但不刷屏） */
function Dot({ tone, pulse }: { tone: string; pulse?: boolean }) {
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', tone, pulse && 'animate-pulse')} aria-hidden />
}

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
  // 性能指示（引擎仅在开启时上报 → 关闭时无重渲染；开启时 500ms 一次受控刷新）
  const showFps = useMolStore(s => s.settings.showFps)
  const outlineOn = useMolStore(s => s.settings.outline)
  const perf = usePerfStore(s => s)

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

      {/* 选择（核心状态：前景色加粗 + 语义点） */}
      {selection.indices.length > 0 && (
        <span className="flex shrink-0 items-center gap-1.5 rounded bg-accent px-1.5 py-0.5 font-semibold tabular-nums text-foreground">
          <Dot tone="bg-primary" />
          已选 {selection.indices.length.toLocaleString()} 原子
        </span>
      )}

      {/* 显示过滤提示 */}
      {(settings.hideHydrogens || settings.hideWater) && (
        <span className="hidden shrink-0 items-center gap-1 text-muted-foreground/70 sm:flex">
          <Layers className="h-3 w-3 text-muted-foreground/60" />
          {settings.hideHydrogens && 'H'}
          {settings.hideHydrogens && settings.hideWater && '+'}
          {settings.hideWater && 'H₂O'} 已隐藏
        </span>
      )}

      {/* 环境光遮蔽 */}
      {settings.ssao && (
        <span className="hidden shrink-0 items-center gap-1.5 tabular-nums md:flex" title={`环境光遮蔽半径 ${settings.ssaoRadius.toFixed(0)}Å`}>
          <Dot tone="bg-amber-500" />
          AO {settings.ssaoRadius.toFixed(0)}Å
        </span>
      )}

      {/* 氢键网络（可点击关闭：就地取消途径——用户反馈「取消不掉」后补充的最短路径） */}
      {hbond.visible && (
        <button
          type="button"
          onClick={() => useMolStore.getState().updateSettings({ showHBonds: false })}
          title="氢键网络显示中 · 点击关闭（按 B 重新开启）"
          aria-label="关闭氢键网络"
          className="flex shrink-0 cursor-pointer items-center gap-1.5 tabular-nums transition-colors hover:text-foreground"
        >
          {hbond.computing
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <Dot tone="bg-teal-500" />}
          <span>{hbond.computing ? '氢键计算中…' : `${hbond.count.toLocaleString()} 氢键`}</span>
          {!hbond.computing && hbond.waterCount > 0 && <span className="text-[9px] text-muted-foreground/70">（含水 {hbond.waterCount}）</span>}
          <X className="h-2.5 w-2.5 opacity-50" aria-hidden />
        </button>
      )}

      {/* 接触界面分析 */}
      {contact.structureId === activeId && contact.pairs.length > 0 && (
        <span className="hidden shrink-0 items-center gap-1.5 tabular-nums md:flex">
          <Dot tone={contact.visible ? 'bg-orange-500' : 'bg-muted-foreground/30'} />
          {contact.pairs.length.toLocaleString()} 接触
          <span className="text-[9px] text-muted-foreground/70">≤{contact.cutoff.toFixed(1)}Å</span>
        </span>
      )}

      {/* 跨结构接触 */}
      {contact.cross && contact.crossPairs.length > 0 && (
        <span className="hidden shrink-0 items-center gap-1.5 tabular-nums md:flex">
          <Dot tone={contact.visible ? 'bg-violet-500' : 'bg-muted-foreground/30'} />
          {contact.cross.labelA}↔{contact.cross.labelB} {contact.crossPairs.length.toLocaleString()}
          <span className="text-[9px] text-muted-foreground/70">≤{contact.cross.cutoff.toFixed(1)}Å</span>
        </span>
      )}

      {/* SASA 分析结果（结构级） */}
      {sasa.structureId === activeId && (sasa.computing || sasa.total > 0) && (
        <span className="hidden shrink-0 items-center gap-1.5 tabular-nums md:flex">
          {sasa.computing
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <Dot tone="bg-cyan-500" />}
          {sasa.computing ? 'SASA 计算中…' : `SASA ${sasa.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} Å²`}
        </span>
      )}

      {/* 红蓝立体 */}
      {settings.stereo && (
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <Dot tone="bg-rose-500" />
          立体
        </span>
      )}

      {/* 对称伴侣 */}
      {symCount > 0 && (
        <span className="hidden shrink-0 items-center gap-1.5 tabular-nums sm:flex">
          <Dot tone="bg-violet-500" />
          {symCount} 对称伴侣
        </span>
      )}

      {/* 电子密度图 */}
      {(mapInfo || mapComputing) && (
        <span className="hidden shrink-0 items-center gap-1.5 tabular-nums sm:flex">
          {mapComputing
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <Dot tone="bg-sky-500" />}
          {mapComputing ? '密度图计算中…' : mapLabel}
        </span>
      )}

      {/* NMR ensemble */}
      {ens.structureId && ens.total >= 2 && (
        <span className="hidden shrink-0 items-center gap-1.5 tabular-nums sm:flex">
          <Dot tone="bg-violet-500" pulse={ens.playing} />
          {ens.playing ? `构象 ${ens.frame + 1}/${ens.total}` : `ensemble ${ens.total} 帧`}
        </span>
      )}

      {/* 轮廓线开启提示（与 FPS 指示互斥位罝：均在测量模式前） */}
      {outlineOn && !showFps && (
        <span className="hidden shrink-0 items-center gap-1.5 md:flex" title="轮廓描边开启（outline on/off）">
          <Dot tone="bg-fuchsia-500" />
          描边
        </span>
      )}

      {/* 自动性能模式降级徽章（琥珀警示：后处理已临时关闭、像素比 ×0.6） */}
      {perf.degraded && (
        <span
          className="hidden shrink-0 items-center gap-1.5 font-medium text-amber-600 md:flex dark:text-amber-400"
          title="自动性能模式：帧率持续偏低，后处理已临时关闭、分辨率已降低；帧率恢复或 perf off 时自动还原（perf status 查看）"
        >
          <Cpu className="h-3 w-3" /> 性能
        </span>
      )}

      {/* 性能指示器（FPS 分级配色：≥55 绿 / ≥30 琥珀 / <30 红 —— 真实仪表语义，保留分级色） */}
      {showFps && perf.fps > 0 && (
        <span
          className={cn(
            'hidden shrink-0 items-center gap-1.5 font-semibold tabular-nums md:flex',
            perf.fps >= 55 ? 'text-emerald-600 dark:text-emerald-400'
              : perf.fps >= 30 ? 'text-amber-600 dark:text-amber-400'
                : 'text-red-600 dark:text-red-400',
          )}
          title={`帧耗时 ${perf.frameMs.toFixed(1)}ms · 几何体 ${perf.geometries} · 纹理 ${perf.textures}（fps on|off 切换）`}
        >
          <Gauge className="h-3 w-3" />
          {perf.fps < 10 ? perf.fps.toFixed(1) : perf.fps.toFixed(0)} fps
          <span className="font-normal text-muted-foreground/70">{perf.drawCalls.toFixed(0)} calls</span>
          <span className="hidden font-normal text-muted-foreground/70 lg:inline">
            {perf.triangles >= 1e6 ? `${(perf.triangles / 1e6).toFixed(1)}M` : `${(perf.triangles / 1e3).toFixed(0)}k`} tri
          </span>
        </span>
      )}

      {/* 测量模式（进行中操作：保留琥珀提示 + Esc 退出） */}
      {measureMode !== 'off' && (
        <span className="flex shrink-0 items-center gap-1.5 font-medium tabular-nums text-amber-600 dark:text-amber-400">
          {measureMode === 'distance' && <Ruler className="h-3 w-3" />}
          {measureMode === 'angle' && <Triangle className="h-3 w-3" />}
          {measureMode === 'dihedral' && <Rotate3d className="h-3 w-3" />}
          {measureMode === 'distance' ? '测距' : measureMode === 'angle' ? '测角' : '二面角'}
          {measurePicks ? ` ${measurePicks.atoms.length}/${need}` : ` 0/${need}`}
          <span className="font-normal text-muted-foreground/70">Esc 退出</span>
        </span>
      )}
    </footer>
  )
}
