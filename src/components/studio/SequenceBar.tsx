'use client'

// 序列条：链序列 + 二级结构轨道 + 点击选择/聚焦（高度三档；视口聚焦指示；
// 残基搜索定位 A57/57/HEM；选中自动滚动居中；Jalview 式序号刻度格）
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Dna, FlaskConical, ChevronsUpDown, Eye, EyeOff, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dataRegistry, engineRef, useMolStore } from '@/lib/molecular/store'
import { useViewportStore } from '@/lib/molecular/viewport-store'
import { residueOneLetter } from '@/lib/molecular/chemistry'
import { readableInk, residueCssColor, ssCssColor } from '@/lib/molecular/colors'
import { cn } from '@/lib/utils'
import { FadeEdge } from './FadeEdge'

const SEQ_HEIGHT_CLASS: Record<string, string> = {
  compact: 'max-h-20',
  normal: 'max-h-40',
  tall: 'max-h-72',
}
const SEQ_HEIGHT_LABEL: Record<string, string> = {
  compact: '紧凑',
  normal: '标准',
  tall: '加高',
}

export function SequenceBar() {
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const selection = useMolStore(s => s.selection)
  const sequenceHeight = useMolStore(s => s.settings.sequenceHeight)
  const seqFocus = useMolStore(s => s.settings.seqFocus)
  const updateSettings = useMolStore(s => s.updateSettings)
  const vpStructureId = useViewportStore(s => s.structureId)
  const vpVisible = useViewportStore(s => s.visible)

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)

  const st = structures.find(x => x.id === activeId)
  const data = activeId ? dataRegistry.get(activeId) : null

  const selectedResidues = useMemo(() => {
    const out = new Set<number>()
    if (!selection.structureId || !data || selection.structureId !== activeId) return out
    for (const i of selection.indices) out.add(data.atomResidue[i])
    return out
  }, [selection, data, activeId])

  /** 视口聚焦：残基是否在当前相机视野内（结构匹配且引擎已算出时；否则视为可见） */
  const visArr = seqFocus && vpStructureId === activeId ? vpVisible : null
  const inView = (ri: number) => (visArr ? visArr[ri] === 1 : true)

  /** 选中变化 → 首个选中残基滚动居中（外部命令/序列条点击/搜索定位统一生效） */
  const selRev = selection.rev
  useEffect(() => {
    if (!ui.sequenceOpen || !data || !selection.structureId || selection.structureId !== activeId) return
    const first = selection.indices[0]
    if (first === undefined) return
    const ri = data.atomResidue[first]
    const el = bodyRef.current?.querySelector<HTMLElement>(`[data-res="${ri}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [selRev, ui.sequenceOpen, activeId, data, selection.structureId, selection.indices])

  /** 残基搜索定位：A57（链+号）/ 57（任意链同号）/ HEM（配体名） */
  const doSearch = () => {
    const q = query.trim()
    if (!q || !data || !activeId) return
    const uq = q.toUpperCase()
    const m = q.match(/^\s*([A-Za-z])?\s*(\d+)\s*([A-Za-z])?\s*$/)
    const resHits: number[] = []
    const ligHits: number[] = []
    for (let ri = 0; ri < data.residues.length; ri++) {
      const r = data.residues[ri]
      if (r.hetero && !r.polymer && !r.water && r.resName.toUpperCase() === uq) ligHits.push(ri)
      if (m) {
        const chainOk = m[1] ? r.chainId.trim().toUpperCase() === m[1].toUpperCase() : true
        const numOk = String(r.resSeq) === m[2] && (m[3] ? (r.iCode || '').toUpperCase() === m[3].toUpperCase() : !r.iCode)
        if (chainOk && numOk) resHits.push(ri)
      }
    }
    const hits = resHits.length ? resHits : ligHits
    if (!hits.length) {
      toast.warning(`未找到「${q}」：试试 残基号（57）、链+号（A57）或配体名（HEM）`)
      return
    }
    const indices: number[] = []
    for (const ri of hits) {
      const r = data.residues[ri]
      for (let i = r.start; i < r.end; i++) indices.push(i)
    }
    useMolStore.getState().setActive(activeId)
    useMolStore.getState().setSelection(activeId, indices)
    setSearchOpen(false)
    const desc = resHits.length
      ? `${data.residues[hits[0]].resName}${data.residues[hits[0]].resSeq}（链 ${data.residues[hits[0]].chainId.trim() || '?'}）等 ${hits.length} 个残基`
      : `${hits.length} 个 ${uq} 残基`
    toast.success(`已定位并选中 ${desc}`)
  }

  if (!st || !data) return null

  // 从结构数据取链（含 residueIdx），颜色沿用摘要链调色板（顺序一致）
  const chainEntries = (data.chains || [])
    .map((c, i) => ({ chain: c, color: st.chains[i]?.color ?? '#9aa3ad', origIdx: i }))
  const polymerChains = chainEntries.filter(({ chain }) => chain.type === 'protein' || chain.type === 'nucleic')

  // 配体分子（连通分量）：每个 chip = 一个完整小分子
  const ligandMolecules = (data.molecules || []).slice(0, 60)

  // 视野内统计（聚合物残基；显示在头部副标题）
  let polymerTotal = 0
  let polymerInView = 0
  if (visArr) {
    for (const { chain } of polymerChains) {
      for (const ri of chain.residueIdx || []) {
        polymerTotal++
        if (visArr[ri] === 1) polymerInView++
      }
    }
  }

  const cycleHeight = () => {
    const next = sequenceHeight === 'compact' ? 'normal' : sequenceHeight === 'normal' ? 'tall' : 'compact'
    updateSettings({ sequenceHeight: next })
  }

  return (
    <div className="tape-well shrink-0 border-y border-border bg-background">
      {/* 头部：标题 + 结构摘要 + 视野徽章 | 搜索定位 / 聚焦 / 高度 */}
      <div className="flex h-8 items-center gap-1 pr-2">
        <button
          onClick={() => setUi({ sequenceOpen: !ui.sequenceOpen })}
          className="flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left text-muted-foreground transition hover:text-foreground"
        >
          <Dna className="h-3 w-3 shrink-0 text-muted-foreground/70" />
          <span className="mol-micro shrink-0">序列</span>
          <span className="min-w-0 truncate font-mono text-[9px] tabular-nums text-muted-foreground/60">
            {st.name} · {polymerChains.length} 条链 · {(data.residues.length).toLocaleString()} 残基
          </span>
          {visArr && polymerTotal > 0 && (
            <span
              className={cn(
                'ml-1 flex shrink-0 items-center gap-1 font-mono text-[9px] font-medium tabular-nums',
                polymerInView === polymerTotal ? 'text-primary' : 'text-muted-foreground',
              )}
              title={`视野内 ${polymerInView} / 共 ${polymerTotal} 个聚合物残基（相机移动实时更新）`}
            >
              <span className={cn('h-1 w-1 shrink-0 rounded-full', polymerInView === polymerTotal ? 'bg-primary' : 'bg-muted-foreground/50')} />
              {polymerInView}/{polymerTotal} 视野
            </span>
          )}
          <span className="ml-auto shrink-0 text-muted-foreground/70">{ui.sequenceOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}</span>
        </button>

        {ui.sequenceOpen && (
          <>
            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  title="搜索定位残基：残基号（57）、链+号（A57）或配体名（HEM）"
                  aria-label="搜索定位残基"
                >
                  <Search className="h-3 w-3" />
                  定位
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-60 p-2" align="end" side="top">
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') doSearch() }}
                  placeholder="57 · A57 · HEM…"
                  autoFocus
                  aria-label="残基搜索词"
                  className="h-7 w-full rounded-md border border-border bg-background px-2 font-mono text-[11px] outline-none transition focus:border-foreground/30"
                />
                <p className="mt-1.5 px-0.5 text-[9px] leading-relaxed text-muted-foreground">
                  Enter 定位：残基号（任意链同号并选）、链字母+号（精确到链）、配体名（如 HEM）。选中后自动滚动到可见位置。
                </p>
              </PopoverContent>
            </Popover>
            <button
              onClick={() => updateSettings({ seqFocus: !seqFocus })}
              className={cn(
                'flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition',
                seqFocus
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
              title={`视口聚焦指示：${seqFocus ? '开（下划线 = 残基在当前相机视野内，切层裁剪同步感知）' : '关（set seq_focus on 开启）'}`}
              aria-pressed={seqFocus}
            >
              {seqFocus ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              聚焦
            </button>
            <button
              onClick={cycleHeight}
              className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
              title={`序列条高度：${SEQ_HEIGHT_LABEL[sequenceHeight] ?? '标准'}（点击切换）`}
            >
              <ChevronsUpDown className="h-3 w-3" />
              {SEQ_HEIGHT_LABEL[sequenceHeight] ?? '标准'}
            </button>
          </>
        )}
      </div>

      {ui.sequenceOpen && (
        <div ref={bodyRef} className={cn('mol-scroll overflow-y-auto px-3 pb-2 transition-[max-height] duration-200', SEQ_HEIGHT_CLASS[sequenceHeight] ?? 'max-h-40')}>
          {/* 配体行（置顶免滚动）：每个 chip = 一个完整分子，点击选择、双击聚焦 */}
          {ligandMolecules.length > 0 && (
            <div className="mb-1 flex items-center gap-2 border-b border-dashed border-border/60 pb-2.5 pt-1">
              <span className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-border/60 bg-background pr-1">
                <FlaskConical className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                <span className="mol-micro text-muted-foreground">配体</span>
              </span>
              <FadeEdge className="gap-1 pb-0.5">
                {ligandMolecules.map(m => {
                  const r0 = data.residues[m.residues[0]]
                  const isSel = m.residues.some(ri => selectedResidues.has(ri))
                  const molInView = visArr ? m.residues.some(ri => visArr[ri] === 1) : true
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
                        'shrink-0 rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold transition',
                        isSel
                          ? 'border-primary/60 bg-primary/10 text-primary'
                          : 'border-border bg-transparent text-amber-700 hover:-translate-y-px hover:border-amber-500/50 hover:bg-amber-500/10 dark:text-amber-400',
                        visArr && !molInView && 'opacity-45',
                      )}
                      title={`${m.label}（链 ${m.chainIds.map(c => c.trim() || '?').join('/')}）· ${m.atoms} 原子${m.residues.length > 1 ? ` · ${m.residues.length} 个残基` : ''}${visArr ? (molInView ? ' · 在视野内' : ' · 视野外') : ''} · 点击选择 · 双击聚焦`}
                    >
                      {m.resNames.length > 1 ? m.label : m.resNames[0]}
                      <span className="ml-0.5 text-[9px] font-normal tabular-nums opacity-60">{r0.chainId.trim()}{r0.resSeq}{m.residues.length > 1 && m.resNames.length === 1 ? '+' : ''}</span>
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
              <div key={`${chain.id}-${ci}`} className="flex items-center gap-2 pb-2.5 pt-0.5">
                <span className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-border/60 bg-background pr-1.5">
                  <button
                    onClick={selectChain}
                    onDoubleClick={() => {
                      selectChain()
                      engineRef.current?.fitView([{ structureId: activeId!, indices: useMolStore.getState().selection.indices }])
                    }}
                    className="group flex shrink-0 items-center gap-1 rounded px-0.5 py-0.5 transition hover:bg-accent"
                    title={`点击选择链 ${chain.id.trim() || '—'}（${(chain.residueIdx || []).length} 残基）· 双击聚焦`}
                  >
                    <span className="h-3.5 w-1 rounded-full opacity-80 transition group-hover:h-4" style={{ background: color }} />
                    <span className="font-mono text-[11px] font-bold leading-none">{chain.id === ' ' ? '—' : chain.id}</span>
                    <span className="font-mono text-[9px] tabular-nums leading-none text-muted-foreground/70">{(chain.residueIdx || []).length}</span>
                  </button>
                </span>
                <FadeEdge className="pb-1">
                  {(chain.residueIdx || []).map((ri, k) => {
                    const r = data.residues[ri]
                    const isSel = selectedResidues.has(ri)
                    const cellInView = inView(ri)
                    const cellColor = residueCssColor(r.resName)
                    return (
                      <ResidueCell
                        key={ri}
                        resIdx={ri}
                        letter={residueOneLetter(r.resName)}
                        color={cellColor}
                        ink={readableInk(cellColor)}
                        ss={r.ss}
                        title={`${r.resName} ${r.resSeq}${r.iCode || ''}（链 ${r.chainId.trim() || '?'}）${r.ss === 'H' ? ' · 螺旋' : r.ss === 'E' ? ' · 折叠' : ''}${visArr ? (cellInView ? ' · 在视野内' : ' · 视野外') : ''}`}
                        selected={isSel}
                        inView={cellInView}
                        showInView={!!visArr}
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
  letter, color, ink, ss, title, selected, position, inView, showInView, resIdx, onClick,
}: {
  resIdx: number
  letter: string
  color: string
  /** 自适应墨色：按格底色亮度选近黑/近白（readableInk） */
  ink: string
  ss: string
  title: string
  selected: boolean
  inView: boolean
  showInView: boolean
  position: number
  onClick: (e: React.MouseEvent) => void
}) {
  const isMarker = position % 10 === 0
  return (
    <button
      onClick={onClick}
      title={title}
      data-res={resIdx}
      aria-label={title}
      className={cn(
        'group relative flex h-7 w-[26px] shrink-0 flex-col items-center justify-end rounded-[2px] outline-none transition-all duration-100',
        selected
          ? 'z-10 ring-2 ring-primary ring-offset-1 ring-offset-background'
          : 'hover:-translate-y-0.5 hover:z-10 hover:scale-[1.08] hover:shadow-md',
      )}
      style={{ background: color }}
    >
      {/* 二级结构轨道（hover 时提亮） */}
      <span
        className="absolute inset-x-0.5 top-0.5 h-[3px] rounded-[1px] transition-opacity group-hover:opacity-100"
        style={{ background: ssCssColor(ss), opacity: ss === 'L' ? 0.3 : 0.85 }}
      />
      {/* Jalview 式序号刻度：每 10 位显示位置数字，字母让位（墨色按格底自适应） */}
      <span
        className={cn('leading-none', isMarker ? 'font-mono text-[9px] font-extrabold tabular-nums' : 'text-[10px] font-bold')}
        style={isMarker ? { color: ink, opacity: 0.7 } : { color: ink }}
      >
        {isMarker ? position : letter}
      </span>
      {/* 视口聚焦下划线：残基在当前相机视野内（切层同步感知） */}
      {showInView && inView && (
        <span className="absolute inset-x-0.5 bottom-0 h-[2px] rounded-full bg-primary" />
      )}
    </button>
  )
})
