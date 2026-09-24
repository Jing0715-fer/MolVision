'use client'

// 底部状态栏 —— 墨色仪表读数条（精密仪器设计语言）
// 墨底 + 等宽数字读数 + 大写微标签分区；语义色只保留高亮点与真警示（性能降级/低帧率/测量进行中）
import { Ruler, Triangle, Rotate3d, Layers, Gauge, Cpu, X } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { useHoverStore } from '@/lib/molecular/hover-store'
import { useHBondStore } from '@/lib/molecular/hbond-store'
import { useEnsembleStore } from '@/lib/molecular/ensemble-store'
import { useContactStore } from '@/lib/molecular/contacts-store'
import { useSasaStore } from '@/lib/molecular/sasa-store'
import { useMapStore } from '@/lib/molecular/map-store'
import { usePerfStore } from '@/lib/molecular/perf-store'
import { useI18n } from '@/i18n'
import { LanguageToggle } from './LanguageToggle'
import { cn } from '@/lib/utils'

/** 语义色小圆点（仪表高亮：在墨底上用 400 级亮度；led-dot 顶部内高光 = 硬件 LED 质感） */
function Dot({ tone, pulse }: { tone: string; pulse?: boolean }) {
  return <span className={cn('led-dot h-1.5 w-1.5 shrink-0 rounded-full', tone, pulse && 'animate-pulse')} aria-hidden />
}

/** 仪表分区：微标签 + 读数 */
function Readout({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {label && <span className="status-micro hidden xl:inline">{label}</span>}
      {children}
    </span>
  )
}

export function StatusBar() {
  const { t } = useI18n()
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
    if (!mapInfo.difference) return <>{t({ zh: '密度', en: 'Map' })} {mapInfo.iso.toFixed(1)}σ{trunc}</>
    if (Math.abs(mapInfo.iso - mapInfo.isoNeg) < 1e-6) return <>{t({ zh: '差图', en: 'Diff' })} {mapInfo.iso.toFixed(1)}σ{trunc}</>
    return <>{t({ zh: '差图', en: 'Diff' })} <span className="text-emerald-400">+{mapInfo.iso.toFixed(1)}</span>/<span className="text-red-400">−{mapInfo.isoNeg.toFixed(1)}</span>σ{trunc}</>
  })()

  return (
    <footer className="instrument-bar flex h-7 shrink-0 items-center gap-2.5 px-3">
      {/* 结构读数（主分区：名称等宽加粗 + 统计） */}
      {st ? (
        <Readout label="structure">
          <span className="status-val font-bold tracking-tight" style={{ color: 'var(--status-hot)' }}>{st.name}</span>
          <span className="status-val opacity-80" style={{ color: 'var(--status-dim)' }}>
            {st.summary.atoms.toLocaleString()} atoms · {st.summary.residues.toLocaleString()} res · {st.summary.chains} ch
          </span>
        </Readout>
      ) : (
        <Readout label="status">
          <span className="status-val" style={{ color: 'var(--status-dim)' }}>{t({ zh: 'READY — 等待加载结构', en: 'READY — awaiting structure' })}</span>
        </Readout>
      )}

      <span className="status-sep" />

      {/* 悬停读数（坐标仪：等宽） */}
      <span className="status-val hidden min-w-0 flex-1 truncate lg:block" style={{ color: 'var(--status-dim)' }}>
        {hoverText ?? '\u00A0'}
      </span>
      <span className="flex-1 lg:hidden" />

      {/* 选择读数（核心状态：高亮 + 语义点） */}
      {selection.indices.length > 0 && (
        <Readout label="selection">
          <Dot tone="bg-primary" />
          <span className="status-val font-semibold" style={{ color: 'var(--status-hot)' }}>
            {selection.indices.length.toLocaleString()} selected
          </span>
        </Readout>
      )}

      {/* 显示过滤提示 */}
      {(settings.hideHydrogens || settings.hideWater) && (
        <span className="status-val hidden shrink-0 items-center gap-1.5 sm:flex" style={{ color: 'var(--status-dim)' }}>
          <Layers className="h-3 w-3" />
          {settings.hideHydrogens && 'H'}
          {settings.hideHydrogens && settings.hideWater && '+'}
          {settings.hideWater && 'H₂O'} hidden
        </span>
      )}

      {/* 环境光遮蔽 */}
      {settings.ssao && (
        <span className="status-val hidden shrink-0 items-center gap-1.5 md:flex" title={t({ zh: `环境光遮蔽半径 ${settings.ssaoRadius.toFixed(0)}Å`, en: `Ambient occlusion radius ${settings.ssaoRadius.toFixed(0)}Å` })} style={{ color: 'var(--status-dim)' }}>
          <Dot tone="bg-amber-400" />
          AO {settings.ssaoRadius.toFixed(0)}Å
        </span>
      )}

      {/* 氢键网络（可点击关闭：就地取消途径——用户反馈「取消不掉」后补充的最短路径） */}
      {hbond.visible && (
        <button
          type="button"
          onClick={() => useMolStore.getState().updateSettings({ showHBonds: false })}
          title={t({ zh: '氢键网络显示中 · 点击关闭（按 B 重新开启）', en: 'H-bond network shown · click to hide (press B to re-enable)' })}
          aria-label={t({ zh: '关闭氢键网络', en: 'Hide H-bond network' })}
          className="status-val flex shrink-0 cursor-pointer items-center gap-1.5 transition-opacity hover:opacity-80"
        >
          {hbond.computing
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <Dot tone="bg-teal-400" />}
          <span style={{ color: 'var(--status-fg)' }}>{hbond.computing ? t({ zh: '氢键计算中…', en: 'Computing H-bonds…' }) : t({ zh: `${hbond.count.toLocaleString()} 氢键`, en: `${hbond.count.toLocaleString()} H-bonds` })}</span>
          {!hbond.computing && hbond.waterCount > 0 && <span style={{ color: 'var(--status-dim)' }}>{t({ zh: `（含水 ${hbond.waterCount}）`, en: `(${hbond.waterCount} via water)` })}</span>}
          <X className="h-2.5 w-2.5 opacity-50" aria-hidden />
        </button>
      )}

      {/* 接触界面分析 */}
      {contact.structureId === activeId && contact.pairs.length > 0 && (
        <span className="status-val hidden shrink-0 items-center gap-1.5 md:flex" style={{ color: 'var(--status-dim)' }}>
          <Dot tone={contact.visible ? 'bg-orange-400' : 'bg-white/20'} />
          {contact.pairs.length.toLocaleString()} {t({ zh: '接触', en: 'contacts' })}
          <span className="text-[9px]">≤{contact.cutoff.toFixed(1)}Å</span>
        </span>
      )}

      {/* 跨结构接触 */}
      {contact.cross && contact.crossPairs.length > 0 && (
        <span className="status-val hidden shrink-0 items-center gap-1.5 md:flex" style={{ color: 'var(--status-dim)' }}>
          <Dot tone={contact.visible ? 'bg-violet-400' : 'bg-white/20'} />
          {contact.cross.labelA}↔{contact.cross.labelB} {contact.crossPairs.length.toLocaleString()}
          <span className="text-[9px]">≤{contact.cross.cutoff.toFixed(1)}Å</span>
        </span>
      )}

      {/* SASA 分析结果（结构级） */}
      {sasa.structureId === activeId && (sasa.computing || sasa.total > 0) && (
        <span className="status-val hidden shrink-0 items-center gap-1.5 md:flex" style={{ color: 'var(--status-dim)' }}>
          {sasa.computing
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <Dot tone="bg-cyan-400" />}
          {sasa.computing ? t({ zh: 'SASA 计算中…', en: 'Computing SASA…' }) : `SASA ${sasa.total.toLocaleString(undefined, { maximumFractionDigits: 0 })} Å²`}
        </span>
      )}

      {/* 红蓝立体 */}
      {settings.stereo && (
        <span className="status-val hidden shrink-0 items-center gap-1.5 sm:flex" style={{ color: 'var(--status-dim)' }}>
          <Dot tone="bg-rose-400" />
          {t({ zh: '立体', en: 'Stereo' })}
        </span>
      )}

      {/* 对称伴侣 */}
      {symCount > 0 && (
        <span className="status-val hidden shrink-0 items-center gap-1.5 sm:flex" style={{ color: 'var(--status-dim)' }}>
          <Dot tone="bg-violet-400" />
          {t({ zh: `${symCount} 对称伴侣`, en: `${symCount} symmetry mates` })}
        </span>
      )}

      {/* 电子密度图 */}
      {(mapInfo || mapComputing) && (
        <span className="status-val hidden shrink-0 items-center gap-1.5 sm:flex" style={{ color: 'var(--status-dim)' }}>
          {mapComputing
            ? <span className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            : <Dot tone="bg-sky-400" />}
          {mapComputing ? t({ zh: '密度图计算中…', en: 'Computing map…' }) : mapLabel}
        </span>
      )}

      {/* NMR ensemble */}
      {ens.structureId && ens.total >= 2 && (
        <span className="status-val hidden shrink-0 items-center gap-1.5 sm:flex" style={{ color: 'var(--status-dim)' }}>
          <Dot tone="bg-violet-400" pulse={ens.playing} />
          {ens.playing ? t({ zh: `构象 ${ens.frame + 1}/${ens.total}`, en: `Frame ${ens.frame + 1}/${ens.total}` }) : t({ zh: `ensemble ${ens.total} 帧`, en: `ensemble ${ens.total} frames` })}
        </span>
      )}

      {/* 轮廓线开启提示（与 FPS 指示互斥位置：均在测量模式前） */}
      {outlineOn && !showFps && (
        <span className="status-val hidden shrink-0 items-center gap-1.5 md:flex" title={t({ zh: '轮廓描边开启（outline on/off）', en: 'Outline shading on (outline on/off)' })} style={{ color: 'var(--status-dim)' }}>
          <Dot tone="bg-fuchsia-400" />
          {t({ zh: '描边', en: 'Outline' })}
        </span>
      )}

      {/* 自动性能模式降级徽章（琥珀警示：后处理已临时关闭、像素比 ×0.6） */}
      {perf.degraded && (
        <span
          className="status-val hidden shrink-0 items-center gap-1.5 font-semibold text-amber-400 md:flex"
          title={t({ zh: '自动性能模式：帧率持续偏低，后处理已临时关闭、分辨率已降低；帧率恢复或 perf off 时自动还原（perf status 查看）', en: 'Auto performance mode: sustained low FPS — post-processing temporarily disabled and resolution reduced; restores automatically when FPS recovers or perf off (see perf status)' })}
        >
          <Cpu className="h-3 w-3" /> {t({ zh: '性能', en: 'Perf' })}
        </span>
      )}

      {/* 性能指示器（FPS 分级配色：≥55 绿 / ≥30 琥珀 / <30 红 —— 真实仪表语义，保留分级色） */}
      {showFps && perf.fps > 0 && (
        <span
          className={cn(
            'status-val hidden shrink-0 items-center gap-1.5 font-semibold md:flex',
            perf.fps >= 55 ? 'text-emerald-400'
              : perf.fps >= 30 ? 'text-amber-400'
                : 'text-red-400',
          )}
          title={t({ zh: `帧耗时 ${perf.frameMs.toFixed(1)}ms · 几何体 ${perf.geometries} · 纹理 ${perf.textures}（fps on|off 切换）`, en: `Frame time ${perf.frameMs.toFixed(1)}ms · ${perf.geometries} geometries · ${perf.textures} textures (toggle with fps on|off)` })}
        >
          <Gauge className="h-3 w-3" />
          {perf.fps < 10 ? perf.fps.toFixed(1) : perf.fps.toFixed(0)} fps
          <span className="font-normal opacity-60">{perf.drawCalls.toFixed(0)} calls</span>
          <span className="hidden font-normal opacity-60 lg:inline">
            {perf.triangles >= 1e6 ? `${(perf.triangles / 1e6).toFixed(1)}M` : `${(perf.triangles / 1e3).toFixed(0)}k`} tri
          </span>
        </span>
      )}

      {/* 测量模式（进行中操作：保留琥珀提示 + Esc 退出） */}
      {measureMode !== 'off' && (
        <span className="status-val flex shrink-0 items-center gap-1.5 font-semibold text-amber-400">
          {measureMode === 'distance' && <Ruler className="h-3 w-3" />}
          {measureMode === 'angle' && <Triangle className="h-3 w-3" />}
          {measureMode === 'dihedral' && <Rotate3d className="h-3 w-3" />}
          {measureMode === 'distance' ? t({ zh: '测距', en: 'Distance' }) : measureMode === 'angle' ? t({ zh: '测角', en: 'Angle' }) : t({ zh: '二面角', en: 'Dihedral' })}
          {measurePicks ? ` ${measurePicks.atoms.length}/${need}` : ` 0/${need}`}
          <span className="font-normal opacity-60">{t({ zh: 'Esc 退出', en: 'Esc to exit' })}</span>
        </span>
      )}

      {/* 语言切换（国际化）：尾部常驻入口 */}
      <LanguageToggle variant="status" />
    </footer>
  )
}
