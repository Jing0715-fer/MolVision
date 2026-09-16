'use client'

// 序列条：链序列 + 二级结构轨道 + 点击选择/聚焦
import { memo, useMemo } from 'react'
import { ChevronDown, ChevronUp, Dna } from 'lucide-react'
import { dataRegistry, engineRef, useMolStore } from '@/lib/molecular/store'
import { residueOneLetter } from '@/lib/molecular/chemistry'
import { residueCssColor, ssCssColor } from '@/lib/molecular/colors'
import { cn } from '@/lib/utils'

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
  const polymerChains = (data.chains || [])
    .map((c, i) => ({ chain: c, color: st.chains[i]?.color ?? '#9aa3ad' }))
    .filter(({ chain }) => chain.type === 'protein' || chain.type === 'nucleic')

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
          {polymerChains.map(({ chain, color }, ci) => {
            return (
              <div key={`${chain.id}-${ci}`} className="flex items-center gap-2 pt-1 pb-4">
                <span className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 bg-card/40 pr-1">
                  <span className="h-3 w-1 rounded-full" style={{ background: color }} />
                  <span className="font-mono text-[11px] font-bold">{chain.id === ' ' ? '—' : chain.id}</span>
                </span>
                <div className="mol-scroll-x flex overflow-x-auto pb-0.5">
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
                </div>
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
      <span className="text-[10px] font-bold leading-none text-black/80">{letter}</span>
      {position % 10 === 0 && (
        <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 font-mono text-[8px] text-muted-foreground/70">{position}</span>
      )}
    </button>
  )
})
