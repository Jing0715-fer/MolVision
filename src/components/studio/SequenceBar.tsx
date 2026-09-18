'use client'

// 序列条：链序列 + 二级结构轨道 + 点击选择/聚焦
import { memo, useMemo } from 'react'
import { ChevronDown, ChevronUp, Dna, FlaskConical } from 'lucide-react'
import { dataRegistry, engineRef, useMolStore } from '@/lib/molecular/store'
import { residueOneLetter } from '@/lib/molecular/chemistry'
import { residueCssColor, ssCssColor } from '@/lib/molecular/colors'
import { cn } from '@/lib/utils'
import { FadeEdge } from './FadeEdge'

export function SequenceBar() {
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const selection = useMolStore(s => s.selection)

  const st = structures.find(x => x.id === activeId)
  const data = activeId ? dataRegistry.get(activeId) : null

  const selectedResidues = useMemo(() => {
    const out = new Set<number>()
    if (!selection.structureId || !data || selection.structureId !== activeId) return out
    for (const i of selection.indices) out.add(data.atomResidue[i])
    return out
     
  }, [selection, data, activeId])

  if (!st || !data) return null

  // 从结构数据取链（含 residueIdx），颜色沿用摘要链调色板（顺序一致）
  // 保留原始索引 origIdx：data.chains 与 st.chains 顺序一致，可直接映射 chainidx 表达式
  const chainEntries = (data.chains || [])
    .map((c, i) => ({ chain: c, color: st.chains[i]?.color ?? '#9aa3ad', origIdx: i }))
  const polymerChains = chainEntries.filter(({ chain }) => chain.type === 'protein' || chain.type === 'nucleic')

  // 配体分子（连通分量）：每个 chip = 一个完整小分子——多残基配体（多糖/肽类）合并为一，
  // 点击选择整个分子、双击聚焦；不再按残基拆开
  const ligandMolecules = (data.molecules || []).slice(0, 60)

  return (
    <div className="shrink-0 border-t border-border/70 bg-card/40 backdrop-blur-sm">
      <button
        onClick={() => setUi({ sequenceOpen: !ui.sequenceOpen })}
        className="flex h-7 w-full items-center gap-2 px-3 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground transition hover:text-foreground"
      >
        <Dna className="h-3 w-3 text-emerald-500" />
        序列
        <span className="font-mono text-[9px] normal-case tracking-normal text-muted-foreground/60">
          {st.name} · {polymerChains.length} 条聚合物链
        </span>
        <span className="ml-auto">{ui.sequenceOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}</span>
      </button>

      {ui.sequenceOpen && (
        <div className="mol-scroll max-h-40 overflow-y-auto px-3 pb-2">
          {/* 配体行（置顶免滚动）：每个 chip = 一个完整分子，点击选择、双击聚焦 */}
          {ligandMolecules.length > 0 && (
            <div className="flex items-center gap-2 pb-2 pt-1">
              <span className="sticky left-0 z-10 flex shrink-0 items-center gap-1 bg-card/40 pr-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                <FlaskConical className="h-3 w-3" /> 配体
              </span>
              <FadeEdge className="gap-1 pb-0.5">
                {ligandMolecules.map(m => {
                  const r0 = data.residues[m.residues[0]]
                  const isSel = m.residues.some(ri => selectedResidues.has(ri))
                  const molIndices: number[] = []
                  for (const ri of m.residues) {
                    const rr = data.residues[ri]
                    for (let i = rr.start; i < rr.end; i++) molIndices.push(i)
                  }
                  return (
                    <button
                      key={m.residues[0]}
                      onClick={() => {
                        useMolStore.getState().setActive(activeId!)
                        useMolStore.getState().setSelection(activeId!, molIndices)
                      }}
                      onDoubleClick={() => {
                        useMolStore.getState().setActive(activeId!)
                        useMolStore.getState().setSelection(activeId!, molIndices)
                        engineRef.current?.fitView([{ structureId: activeId!, indices: molIndices }])
                      }}
                      className={cn(
                        'shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold transition',
                        isSel
                          ? 'border-primary bg-primary/15 text-primary ring-1 ring-primary/50'
                          : 'border-amber-500/30 bg-amber-500/5 text-amber-700 hover:border-amber-500/60 hover:bg-amber-500/15 dark:text-amber-400',
                      )}
                      title={`${m.label}（链 ${m.chainIds.map(c => c.trim() || '?').join('/')}）· ${m.atoms} 原子${m.residues.length > 1 ? ` · ${m.residues.length} 个残基` : ''} · 点击选择 · 双击聚焦`}
                    >
                      {m.resNames.length > 1 ? m.label : m.resNames[0]}
                      <span className="ml-0.5 text-[8px] font-normal opacity-60">{r0.chainId.trim()}{r0.resSeq}{m.residues.length > 1 && m.resNames.length === 1 ? '+' : ''}</span>
                    </button>
                  )
                })}
              </FadeEdge>
            </div>
          )}

          {polymerChains.map(({ chain, color, origIdx }, ci) => {
            const selectChain = () => {
              useMolStore.getState().setActive(activeId!)
              useMolStore.getState().selectFromExpr(`chainidx ${origIdx}`)
            }
            return (
              <div key={`${chain.id}-${ci}`} className="flex items-center gap-2 pt-1 pb-4">
                <span className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 bg-card/40 pr-1">
                  <button
                    onClick={selectChain}
                    onDoubleClick={() => {
                      selectChain()
                      engineRef.current?.fitView([{ structureId: activeId!, indices: useMolStore.getState().selection.indices }])
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded px-0.5 py-0.5 transition hover:bg-accent"
                    title={`点击选择链 ${chain.id.trim() || '—'}（链组）· 双击聚焦`}
                  >
                    <span className="h-3 w-1 rounded-full" style={{ background: color }} />
                    <span className="font-mono text-[11px] font-bold">{chain.id === ' ' ? '—' : chain.id}</span>
                  </button>
                </span>
                <FadeEdge className="pb-0.5">
                  {(chain.residueIdx || []).map((ri, k) => {
                    const r = data.residues[ri]
                    const isSel = selectedResidues.has(ri)
                    return (
                      <ResidueCell
                        key={ri}
                        resIdx={ri}
                        letter={residueOneLetter(r.resName)}
                        color={residueCssColor(r.resName)}
                        ss={r.ss}
                        title={`${r.resName} ${r.resSeq}${r.iCode || ''}（链 ${r.chainId.trim() || '?'}）${r.ss === 'H' ? ' · 螺旋' : r.ss === 'E' ? ' · 折叠' : ''}`}
                        selected={isSel}
                        position={k + 1}
                        onClick={e => {
                          useMolStore.getState().setActive(activeId!)
                          const indices: number[] = []
                          for (let i = r.start; i < r.end; i++) indices.push(i)
                          if (e.detail === 2) {
                            engineRef.current?.fitView([{ structureId: activeId!, indices }])
                          } else if (e.shiftKey) {
                            useMolStore.getState().setSelection(activeId!, indices, 'add')
                          } else if (e.altKey) {
                            useMolStore.getState().setSelection(activeId!, indices, 'remove')
                          } else {
                            useMolStore.getState().setSelection(activeId!, indices)
                          }
                        }}
                      />
                    )
                  })}
                </FadeEdge>
              </div>
            )
          })}
          {polymerChains.length === 0 && (
            <p className="py-2 text-[11px] text-muted-foreground">该结构不含聚合物链（仅配体/小分子）。</p>
          )}
        </div>
      )}
    </div>
  )
}

const ResidueCell = memo(function ResidueCell({
  letter, color, ss, title, selected, position, onClick,
}: {
  resIdx: number
  letter: string
  color: string
  ss: string
  title: string
  selected: boolean
  position: number
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'group relative flex h-7 w-6 shrink-0 flex-col items-center justify-end rounded-[3px] transition-all',
        selected ? 'ring-2 ring-primary ring-offset-1 ring-offset-card' : 'hover:scale-110 hover:z-10 hover:shadow-md',
      )}
      style={{ background: color }}
    >
      {/* 二级结构轨道 */}
      <span
        className="absolute inset-x-0.5 top-0.5 h-[3px] rounded-[1px]"
        style={{ background: ssCssColor(ss), opacity: ss === 'L' ? 0.35 : 0.9 }}
      />
      <span className="text-[10px] font-bold leading-none text-black/90 [text-shadow:0_0_1px_rgba(255,255,255,0.35)]">{letter}</span>
      {position % 10 === 0 && (
        <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 font-mono text-[8px] text-muted-foreground/70">{position}</span>
      )}
    </button>
  )
})
