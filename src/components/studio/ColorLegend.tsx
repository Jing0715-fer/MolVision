'use client'

// 颜色标尺图例（视口左下角浮层）：B 因子/putty 渐变条 + 管径映射；SASA 暴露度条；
// 疏水性 KD 条（r121-c）
// r122-b 多方案并置：同屏多个可见 rep 各持不同色方案（如 cartoon 疏水 + spheres B 因子）
// 时各自渲染一张标尺卡（纵向堆叠、优先序 putty > bfactor > hydrophobicity > sasa）——
// 旧版只显最高优先级一张，其余方案无标尺（r121 视觉债收口）。
// r123-b 折叠收纳：≥3 卡满配时纵向 ~300px 在小屏可能遮挡视口——默认折叠为单卡紧凑
// 色带行（每方案一行 mini 渐变条 + 名称），点击/Enter/Space 展开全卡；≤2 卡保持直显。
import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMolStore, dataRegistry } from '@/lib/molecular/store'
import { useI18n } from '@/i18n'
import { BFACTOR_STOPS, SASA_STOPS, HYDRO_STOPS, stopsToGradient } from '@/lib/molecular/colors'
import type { RepConfig } from '@/lib/molecular/types'

type LegendKind = 'putty' | 'bfactor' | 'hydrophobicity' | 'sasa'

/** 方案短名（折叠行与卡标题共用；单字粒度便于小屏） */
const KIND_SHORT: Record<LegendKind, { zh: string; en: string }> = {
  putty: { zh: 'putty 柔性', en: 'putty flex' },
  bfactor: { zh: 'B 因子', en: 'B-factor' },
  hydrophobicity: { zh: '疏水性', en: 'Hydrophobicity' },
  sasa: { zh: 'SASA 暴露', en: 'SASA' },
}

/** 折叠阈值：≥3 卡时默认折叠（r122 建议③——四卡满配 ~300px 小屏遮挡） */
const COLLAPSE_THRESHOLD = 3

/** 单张图例卡（一个可见色方案一张；bRange 仅 putty/bfactor 需要） */
interface LegendEntry {
  kind: LegendKind
  bRange: { min: number; max: number; cap?: number } | null
}

/** putty 管径 SVG 路径：与 representations.ts 同映射 r = rMin + (rMax−rMin)·sqrt(t)，
 *  半高按 (r−rMin)/(rMax−rMin) = sqrt(t) 归一化到 1.1..5.5px（viewBox 高 12） */
function puttyTubePath(width = 128, height = 12): string {
  const n = 32
  const hMin = 1.1
  const hMax = height / 2 - 0.5
  const mid = height / 2
  const top: string[] = []
  const bottom: string[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = (t * width).toFixed(1)
    const h = (hMin + (hMax - hMin) * Math.sqrt(t)).toFixed(2)
    top.push(`${x},${(mid - Number(h)).toFixed(2)}`)
    bottom.push(`${x},${(mid + Number(h)).toFixed(2)}`)
  }
  return `M${top.join(' L')} L${bottom.reverse().join(' L')} Z`
}

/** 该 kind 的 B 范围（着色用全原子；putty 管径用 CA + puttyRange 钳制）——
 *  hydrophobicity 用固定 KD 标度、sasa 用固定 0-100% 标度，均无逐结构 B 范围需求 */
function computeBRange(kind: LegendKind, rep: RepConfig, structureId: string): LegendEntry['bRange'] {
  if ((kind !== 'putty' && kind !== 'bfactor')) return null
  const data = dataRegistry.get(structureId)
  if (!data) return null
  let min = Infinity, max = -Infinity
  const b = data.atoms.bfactors
  const n = data.atoms.count
  for (let i = 0; i < n; i++) {
    const v = b[i]
    if (!Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!(min <= max && Number.isFinite(min))) return null
  const cap = kind === 'putty' && rep.puttyRange && rep.puttyRange > min ? rep.puttyRange : undefined
  return { min, max, cap }
}

export function ColorLegend() {
  const { t } = useI18n()
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  // 控制台打开时隐藏（底部命令行覆盖层会遮挡图例，避免残缺显示）
  const consoleOpen = useMolStore(s => s.ui.consoleOpen)
  // r123-b 折叠态（本地态：同一次挂载内记忆用户选择；方案数变化重新评估阈值）
  const [expanded, setExpanded] = useState(false)

  const st = structures.find(x => x.id === activeId)

  const legends = useMemo<LegendEntry[]>(() => {
    if (!st) return []
    // 优先级：putty（管径+颜色双映射）> bfactor > hydrophobicity > sasa（需已有 SASA 数据）
    // r122-b：不再互斥取一——每个在场的方案各出一张卡（同屏多 rep 多方案各有标尺）
    const visible = st.reps.filter((r: RepConfig) => r.visible)
    const puttyRep = visible.find(r => r.type === 'putty')
    const bfactorRep = visible.find(r => r.colorScheme === 'bfactor')
    const hydroRep = visible.find(r => r.colorScheme === 'hydrophobicity')
    const sasaRep = visible.find(r => r.colorScheme === 'sasa')
    const data = dataRegistry.get(st.id)

    const entries: LegendEntry[] = []
    if (puttyRep) entries.push({ kind: 'putty', bRange: computeBRange('putty', puttyRep, st.id) })
    if (bfactorRep) entries.push({ kind: 'bfactor', bRange: computeBRange('bfactor', bfactorRep, st.id) })
    // r121-c：疏水性固定标度（KD -4.5..+4.5）——无逐结构数据依赖，静态图例即可
    if (hydroRep) entries.push({ kind: 'hydrophobicity', bRange: null })
    if (sasaRep && data?.sasa) entries.push({ kind: 'sasa', bRange: null })
    return entries
  }, [st])

  if (!legends.length || consoleOpen) return null

  // r123-b：≥3 卡且未手动展开 → 折叠紧凑态；≤2 卡（或已展开）→ 全卡直显
  const collapsible = legends.length >= COLLAPSE_THRESHOLD
  const showFull = !collapsible || expanded

  return (
    <div
      className="pointer-events-none flex w-44 flex-col gap-1.5 select-none"
      aria-label={t({ zh: '颜色标尺图例', en: 'Color scale legend' })}
    >
      {showFull ? (
        <>
      {legends.map(({ kind, bRange }) => (
        <div
          key={kind}
          className="rounded-lg border border-border bg-card p-2 mol-elevate"
          aria-label={kind === 'sasa'
            ? t({ zh: 'SASA 暴露度标尺', en: 'SASA exposure scale' })
            : kind === 'hydrophobicity'
              ? t({ zh: '疏水性标尺', en: 'Hydrophobicity scale' })
              : t({ zh: 'B 因子标尺', en: 'B-factor scale' })}
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-wide text-foreground/80">
              {kind === 'sasa'
                ? t({ zh: 'SASA 暴露度', en: 'SASA exposure' })
                : kind === 'hydrophobicity'
                  ? t({ zh: '疏水性 (KD)', en: 'Hydrophobicity (KD)' })
                  : t({ zh: 'B 因子 (Å²)', en: 'B-factor (Å²)' })}
            </span>
            {kind === 'putty' && (
              <span className="text-[9px] text-muted-foreground/80">{t({ zh: 'putty 管径', en: 'putty tube radius' })}</span>
            )}
          </div>

          {/* 渐变条 */}
          <div
            className="h-2.5 w-full rounded-[3px] border border-border/50"
            style={{ background: stopsToGradient(kind === 'sasa' ? SASA_STOPS : kind === 'hydrophobicity' ? HYDRO_STOPS : BFACTOR_STOPS) }}
          />

          {/* 数值刻度 */}
          <div className="mt-0.5 flex items-baseline justify-between font-mono text-[9px] leading-none text-muted-foreground">
            {kind === 'sasa'
              ? <><span>{t({ zh: '埋藏 0%', en: 'buried 0%' })}</span><span className="text-[8px]">{t({ zh: '暴露分数', en: 'exposure' })}</span><span>{t({ zh: '100% 暴露', en: '100% exposed' })}</span></>
              : kind === 'hydrophobicity'
                ? <>
                <span>{t({ zh: '亲水 −4.5 (Arg)', en: 'hydrophilic −4.5 (Arg)' })}</span>
                <span className="text-[8px]">KD</span>
                <span>{t({ zh: '+4.5 疏水 (Ile)', en: '+4.5 hydrophobic (Ile)' })}</span>
              </>
                : <>
                <span>{bRange ? bRange.min.toFixed(1) : '—'}</span>
                <span>{bRange ? ((bRange.min + (bRange.cap ?? bRange.max)) / 2).toFixed(0) : ''}</span>
                <span>
                  {bRange ? (bRange.cap ?? bRange.max).toFixed(1) : '—'}
                  {bRange?.cap != null && <span className="text-[8px] text-amber-600 dark:text-amber-400" title={t({ zh: `已钳制（实际最大 ${bRange.max.toFixed(0)}+）`, en: `clamped (actual max ${bRange.max.toFixed(0)}+)` })}>*</span>}
                </span>
              </>}
          </div>

          {/* putty 管径可视化（细→粗，与渲染同 sqrt 映射） */}
          {kind === 'putty' && (
            <>
              <svg viewBox="0 0 128 12" className="mt-1.5 h-3 w-full" aria-hidden>
                <defs>
                  <linearGradient id="mv-putty-grad" x1="0" y1="0" x2="1" y2="0">
                    {BFACTOR_STOPS.map(([t, c], i) => (
                      <stop key={i} offset={t} stopColor={c} />
                    ))}
                  </linearGradient>
                </defs>
                <path d={puttyTubePath()} fill="url(#mv-putty-grad)" stroke="rgba(0,0,0,0.18)" strokeWidth="0.4" />
              </svg>
              <div className="mt-0.5 flex items-center justify-between text-[9px] leading-none text-muted-foreground/80">
                <span>{t({ zh: '刚性（细）', en: 'rigid (thin)' })}</span>
                <span>{t({ zh: '柔性（粗）', en: 'flexible (thick)' })}</span>
              </div>
            </>
          )}
        </div>
      ))}
          {/* r123-b 折叠态的「收起」入口（展开态尾部）：容器 pointer-events-none，
              按钮自身 pointer-events-auto 才可点 */}
          {collapsible && (
            <button
              onClick={() => setExpanded(false)}
              className="pointer-events-auto flex h-6 w-full items-center justify-center gap-1 rounded-md border border-border bg-card/90 text-[9px] text-muted-foreground transition hover:bg-accent mol-elevate"
              aria-label={t({ zh: `收起 ${legends.length} 张标尺卡`, en: `Collapse ${legends.length} legend cards` })}
            >
              <ChevronDown className="h-3 w-3" aria-hidden /> {t({ zh: '收起标尺', en: 'Collapse legends' })}
            </button>
          )}
        </>
      ) : (
        /* r123-b 折叠紧凑态：单卡内每方案一行 mini 渐变条——小屏不遮挡视口；
           整卡可点击/Enter/Space 展开全卡（可及性：role=button + aria-expanded） */
        <div
          role="button"
          tabIndex={0}
          onClick={() => setExpanded(true)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(true) } }}
          aria-expanded={false}
          aria-label={t({ zh: `${legends.length} 个颜色标尺已折叠，点击展开`, en: `${legends.length} color scales collapsed, click to expand` })}
          className="pointer-events-auto cursor-pointer rounded-lg border border-border bg-card p-2 mol-elevate transition hover:border-primary/40"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-wide text-foreground/80">
              {t({ zh: `颜色标尺 ×${legends.length}`, en: `Color scales ×${legends.length}` })}
            </span>
            <ChevronUp className="h-3 w-3 text-muted-foreground/70" aria-hidden />
          </div>
          <div className="flex flex-col gap-1">
            {legends.map(({ kind }) => (
              <div key={kind} className="flex items-center gap-1.5">
                <div
                  className="h-1.5 w-14 shrink-0 rounded-full border border-border/40"
                  style={{ background: stopsToGradient(kind === 'sasa' ? SASA_STOPS : kind === 'hydrophobicity' ? HYDRO_STOPS : BFACTOR_STOPS) }}
                  aria-hidden
                />
                <span className="truncate text-[9px] leading-none text-muted-foreground">{t(KIND_SHORT[kind])}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
