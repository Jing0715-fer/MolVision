'use client'

// 序列条：PyMOL/Jalview 式专业序列视图
// - 独立刻度行（每 10 位残基号 + 每 5 位小刻度）——字母行永远显示氨基酸缩写，水平垂直居中
// - 紧凑格宽 19px（密度 +37%）；SS 轨道 2px；视口聚焦下划线；选中 ring-inset 不遮邻格
// - 鼠标拖拽批量选取（Shift 追加 / Alt 移除）+ 跟随鼠标的浮动范围提示 + Esc 取消
// - 框选完成浮出「保存选择」条（快照命名保存）；头部选择库 popover 召回/聚焦/删除命名选择
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, BookmarkPlus, ChevronDown, ChevronUp, Dna, FlaskConical, ChevronsUpDown, Eye, EyeOff, Search, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { dataRegistry, engineRef, useMolStore, buildNamedMasks } from '@/lib/molecular/store'
import { useViewportStore } from '@/lib/molecular/viewport-store'
import { residueOneLetter } from '@/lib/molecular/chemistry'
import { readableInk, residueCssColor, ssCssColor } from '@/lib/molecular/colors'
import { evaluateSelection, maskToIndices } from '@/lib/molecular/selection'
import type { NamedSelection } from '@/lib/molecular/types'
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

/** 残基格宽（px）：19px 紧凑密度（原 26px），字母居中 */
const CELL_W = 19

type DragMode = 'replace' | 'add' | 'remove'

/** 拖拽进行态（ref：原始交互数据） */
interface DragState {
  chainIdx: number
  chainRes: number[]
  anchorPos: number
  curPos: number
  mode: DragMode
  sx: number
  sy: number
  moved: boolean
}

/** 拖拽预览渲染态（state：范围高亮 + 浮动提示） */
interface DragView {
  chainIdx: number
  lo: number
  hi: number
  mode: DragMode
  chainRes: number[]
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
  const namedSelections = useMolStore(s => s.namedSelections)
  const saveNamedSelection = useMolStore(s => s.saveNamedSelection)
  const deleteNamedSelection = useMolStore(s => s.deleteNamedSelection)
  const vpStructureId = useViewportStore(s => s.structureId)
  const vpVisible = useViewportStore(s => s.visible)

  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)

  // —— 拖拽批量选取（事件委托 + ref 交互态，state 仅驱动预览/提示）——
  const dragRef = useRef<DragState | null>(null)
  const [dragView, setDragView] = useState<DragView | null>(null)
  const dragTipRef = useRef<HTMLDivElement | null>(null)
  // 拖拽进行中的最近指针坐标（tip 挂载时立即定位，避免左上角闪烁）
  const lastPtRef = useRef({ x: 0, y: 0 })
  /** 拖拽提交后抑制一次原生 click（pointerup 与 click 的目标可能不同，用时间戳兜底） */
  const suppressClickAt = useRef(0)

  // —— 框选保存条（快照 indices，与后续选择变化解耦）——
  const [saveBar, setSaveBar] = useState<null | { chainId: string; from: number; to: number; residues: number; atoms: number; indices: number[] }>(null)
  const [saveName, setSaveName] = useState('')

  // —— 头部选择库 popover ——
  const [libOpen, setLibOpen] = useState(false)
  const [libName, setLibName] = useState('')

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

  // ———— 拖拽批量选取：window 级 pointermove/up + Esc 取消（早退前挂载，内部 null 守卫）————
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      lastPtRef.current = { x: e.clientX, y: e.clientY }
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 3) {
        d.moved = true
        setDragView({ chainIdx: d.chainIdx, lo: Math.min(d.anchorPos, d.curPos), hi: Math.max(d.anchorPos, d.curPos), mode: d.mode, chainRes: d.chainRes })
      }
      if (d.moved && dragTipRef.current) {
        dragTipRef.current.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`
      }
    }
    const finish = (commit: boolean) => {
      const d = dragRef.current
      if (!d) return
      dragRef.current = null
      setDragView(null)
      if (!d.moved || !commit || !activeId || !data) return
      const lo = Math.min(d.anchorPos, d.curPos)
      const hi = Math.max(d.anchorPos, d.curPos)
      const residues = d.chainRes.slice(lo, hi + 1)
      const indices: number[] = []
      for (const ri of residues) {
        const r = data.residues[ri]
        if (!r) continue
        for (let i = r.start; i < r.end; i++) indices.push(i)
      }
      useMolStore.getState().setActive(activeId)
      useMolStore.getState().setSelection(activeId, indices, d.mode)
      suppressClickAt.current = Date.now()
      if (d.mode === 'replace' && residues.length) {
        const first = data.residues[residues[0]]
        const last = data.residues[residues[residues.length - 1]]
        setSaveBar({
          chainId: (first.chainId || ' ').trim() || '?',
          from: first.resSeq,
          to: last.resSeq,
          residues: residues.length,
          atoms: indices.length,
          indices,
        })
      }
    }
    const up = () => finish(true)
    const cancel = () => finish(false)
    // 拖拽进行中按 Esc：仅取消拖拽——capture 阶段拦截，不再触发全局 deselect（MolViewer Esc 语义）等快捷键
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !dragRef.current) return
      cancel()
      e.stopPropagation()
    }
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key, { capture: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key, { capture: true })
    }
  }, [activeId, data])

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

  /** 事件委托：从事件目标解析残基格（data-chain/data-k/data-res） */
  const cellFrom = (e: React.PointerEvent | React.MouseEvent) =>
    (e.target as HTMLElement).closest<HTMLElement>('button[data-res]')

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || e.pointerType !== 'mouse') return
    const cell = cellFrom(e)
    if (!cell) return
    const ci = Number(cell.dataset.chain)
    const k = Number(cell.dataset.k)
    const chainRes = polymerChains[ci]?.chain.residueIdx || []
    if (k < 0 || k >= chainRes.length) return
    dragRef.current = {
      chainIdx: ci,
      chainRes,
      anchorPos: k,
      curPos: k,
      mode: e.shiftKey ? 'add' : e.altKey ? 'remove' : 'replace',
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
    }
  }

  const handlePointerOver = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d || !d.moved) return
    const cell = cellFrom(e)
    if (!cell || Number(cell.dataset.chain) !== d.chainIdx) return
    const k = Number(cell.dataset.k)
    if (k === d.curPos) return
    d.curPos = k
    setDragView({ chainIdx: d.chainIdx, lo: Math.min(d.anchorPos, k), hi: Math.max(d.anchorPos, k), mode: d.mode, chainRes: d.chainRes })
  }

  /** 单格点击（拖拽未成形的落点）：单选 / Shift 追加 / Alt 移除 / 双击聚焦 */
  const handleCellClick = (e: React.MouseEvent) => {
    if (Date.now() - suppressClickAt.current < 350) return
    const cell = cellFrom(e)
    if (!cell || !activeId || !data) return
    const ri = Number(cell.dataset.res)
    const r = data.residues[ri]
    if (!r) return
    useMolStore.getState().setActive(activeId)
    const indices: number[] = []
    for (let i = r.start; i < r.end; i++) indices.push(i)
    if (e.detail >= 2) {
      useMolStore.getState().setSelection(activeId, indices)
      engineRef.current?.fitView([{ structureId: activeId, indices }])
    } else if (e.shiftKey) {
      useMolStore.getState().setSelection(activeId, indices, 'add')
    } else if (e.altKey) {
      useMolStore.getState().setSelection(activeId, indices, 'remove')
    } else {
      useMolStore.getState().setSelection(activeId, indices)
    }
  }

  // ———— 命名选择：保存 / 召回 / 聚焦 ————
  const doSaveBar = () => {
    if (!saveBar || !activeId) return
    const name = saveName.trim()
    if (!name) return toast.error('请输入选择名称')
    saveNamedSelection(name, saveBar.indices, activeId)
    toast.success(`已保存命名选择 "${name}"（${saveBar.residues} 残基 · ${saveBar.atoms} 原子）`)
    setSaveBar(null)
    setSaveName('')
  }

  const doSaveLib = () => {
    const name = libName.trim()
    if (!name) return toast.error('请输入选择名称')
    if (!selection.structureId || !selection.indices.length) return toast.error('当前没有选择')
    saveNamedSelection(name)
    toast.success(`已保存命名选择 "${name}"（${selection.indices.length} 原子）`)
    setLibName('')
  }

  const recallNS = (ns: NamedSelection): boolean => {
    const d = dataRegistry.get(ns.structureId)
    if (!d) {
      toast.error('结构数据缺失，无法召回')
      return false
    }
    useMolStore.getState().setActive(ns.structureId)
    if (ns.indices) {
      useMolStore.getState().setSelection(ns.structureId, ns.indices)
      return true
    }
    if (ns.expr) {
      const res = evaluateSelection(ns.expr, { structure: d, named: buildNamedMasks(ns.structureId, d) })
      if (res.error) {
        toast.error(`召回失败：${res.error}`)
        return false
      }
      useMolStore.getState().setSelection(ns.structureId, maskToIndices(res.mask))
      return true
    }
    return false
  }

  const focusNS = (ns: NamedSelection) => {
    if (!recallNS(ns)) return
    const sel = useMolStore.getState().selection
    if (sel.structureId) engineRef.current?.fitView([{ structureId: sel.structureId, indices: sel.indices }])
  }

  // 拖拽浮动提示内容
  let tipText = ''
  if (dragView && data) {
    const first = data.residues[dragView.chainRes[dragView.lo]]
    const last = data.residues[dragView.chainRes[dragView.hi]]
    if (first && last) {
      const n = dragView.hi - dragView.lo + 1
      tipText = `${(first.chainId || ' ').trim() || '?'} ${first.resSeq}–${last.resSeq} · ${n} 残基${dragView.mode === 'add' ? ' · 追加' : dragView.mode === 'remove' ? ' · 移除' : ''}`
    }
  }

  return (
    <div className="tape-well shrink-0 border-y border-border bg-background">
      {/* 头部：标题 + 结构摘要 + 视野徽章 | 选择库 / 搜索定位 / 聚焦 / 高度 */}
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
            <Popover open={libOpen} onOpenChange={setLibOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    'flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[10px] font-medium transition',
                    libOpen || namedSelections.length > 0
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  title={`选择库：保存/召回命名选择（拖拽序列格框选残基后可保存；类似 PyMOL select name, expr）`}
                  aria-label="打开选择库"
                >
                  <Bookmark className="h-3 w-3" />
                  选择
                  {namedSelections.length > 0 && (
                    <span className="ml-0.5 rounded-full bg-primary px-1 font-mono text-[8px] font-bold leading-[13px] text-primary-foreground">
                      {namedSelections.length}
                    </span>
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-72 p-2" align="end" side="top">
                <div className="flex items-center gap-1.5 px-0.5 text-[10px] font-medium text-muted-foreground">
                  <Bookmark className="h-3 w-3" />
                  选择库
                  <span className="tabular-nums">{namedSelections.length} 个已保存</span>
                </div>
                {/* 保存当前选择 */}
                {selection.structureId === activeId && selection.indices.length > 0 ? (
                  <div className="mt-1.5 flex gap-1">
                    <input
                      value={libName}
                      onChange={e => setLibName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') doSaveLib() }}
                      placeholder={`命名保存当前选择（${selection.indices.length.toLocaleString()} 原子）…`}
                      className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px] outline-none transition focus:border-foreground/30"
                      aria-label="命名保存当前选择"
                    />
                    <button
                      onClick={doSaveLib}
                      className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-primary px-2 text-[10px] font-medium text-primary-foreground transition hover:opacity-90"
                    >
                      <BookmarkPlus className="h-3 w-3" />
                      保存
                    </button>
                  </div>
                ) : (
                  <p className="mt-1 px-0.5 text-[10px] leading-relaxed text-muted-foreground">
                    当前无选择——在序列上按住鼠标拖拽框选残基，或用命令行 select。
                  </p>
                )}
                {/* 已保存列表 */}
                {namedSelections.length > 0 && (
                  <div className="mol-scroll mt-1.5 max-h-64 space-y-0.5 overflow-y-auto">
                    {namedSelections.map(ns => {
                      const stName = structures.find(x => x.id === ns.structureId)?.name
                      return (
                        <div key={ns.name} className="group flex items-center gap-1 rounded-md px-1.5 py-1 transition hover:bg-accent">
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium">{ns.name}</span>
                          <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{ns.count.toLocaleString()} at</span>
                          {stName && ns.structureId !== activeId && (
                            <span className="max-w-14 shrink-0 truncate text-[9px] text-muted-foreground/70" title={`属于结构 ${stName}`}>{stName}</span>
                          )}
                          <button
                            onClick={() => recallNS(ns)}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-primary transition hover:bg-primary/10"
                            title="召回为当前选择"
                          >
                            选中
                          </button>
                          <button
                            onClick={() => focusNS(ns)}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                            title="召回并缩放聚焦"
                          >
                            聚焦
                          </button>
                          <button
                            onClick={() => deleteNamedSelection(ns.name)}
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                            title="删除该命名选择"
                            aria-label={`删除 ${ns.name}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
                {namedSelections.length === 0 && (
                  <p className="mt-1 px-0.5 text-[10px] leading-relaxed text-muted-foreground">
                    暂无已保存选择。拖拽序列格框选残基后保存（类似 PyMOL 的 select name, expr），后续可一键召回或聚焦。
                  </p>
                )}
              </PopoverContent>
            </Popover>
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
          {/* 框选保存条：拖拽框选完成浮出（快照与后续选择变化解耦） */}
          {saveBar && (
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-primary/50 bg-primary/[0.06] px-2 py-1.5 shadow-sm">
              <BookmarkPlus className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="shrink-0 text-[11px] font-medium">
                已框选 <span className="font-mono tabular-nums">{saveBar.chainId} {saveBar.from}–{saveBar.to}</span>
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {saveBar.residues} 残基 · {saveBar.atoms.toLocaleString()} 原子
              </span>
              <input
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doSaveBar() }}
                placeholder="命名保存（如 active_site）…"
                className="h-6.5 min-w-28 flex-1 rounded-md border border-border bg-background px-2 text-[11px] outline-none transition focus:border-foreground/30"
                aria-label="框选范围命名"
              />
              <button
                onClick={doSaveBar}
                className="flex h-6.5 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-[10px] font-medium text-primary-foreground transition hover:opacity-90"
              >
                保存选择
              </button>
              <button
                onClick={() => {
                  if (!activeId) return
                  useMolStore.getState().setSelection(activeId, saveBar.indices)
                  engineRef.current?.fitView([{ structureId: activeId, indices: saveBar.indices }])
                }}
                className="flex h-6.5 shrink-0 items-center rounded-md border border-border bg-background px-2 text-[10px] font-medium transition hover:bg-accent"
                title="重新选中该范围并缩放聚焦"
              >
                聚焦
              </button>
              <button
                onClick={() => setSaveBar(null)}
                className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
                title="关闭（不保存）"
                aria-label="关闭框选保存条"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

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
              <div key={`${chain.id}-${ci}`} className="flex items-start gap-2 pb-1.5 pt-0.5">
                <span className="sticky left-0 z-10 mt-3.5 flex shrink-0 items-center gap-1 border-r border-border/60 bg-background pr-1.5">
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
                <FadeEdge className="pb-0">
                  <div
                    className="select-none"
                    onPointerDown={handlePointerDown}
                    onPointerOver={handlePointerOver}
                    onClick={handleCellClick}
                  >
                    {/* 刻度行：每 10 位显示残基号（对齐该格中心），每 5 位小刻度 */}
                    <div className="flex">
                      {(chain.residueIdx || []).map((ri, k) => (
                        <RulerCell key={ri} position={k + 1} resSeq={data.residues[ri].resSeq} />
                      ))}
                    </div>
                    {/* 序列行：字母永远显示、居中 */}
                    <div className="flex">
                      {(chain.residueIdx || []).map((ri, k) => {
                        const r = data.residues[ri]
                        const isSel = selectedResidues.has(ri)
                        const cellInView = inView(ri)
                        const cellColor = residueCssColor(r.resName)
                        return (
                          <ResidueCell
                            key={ri}
                            resIdx={ri}
                            chainIdx={ci}
                            pos={k}
                            letter={residueOneLetter(r.resName)}
                            color={cellColor}
                            ink={readableInk(cellColor)}
                            ss={r.ss}
                            title={`${r.resName} ${r.resSeq}${r.iCode || ''}（链 ${r.chainId.trim() || '?'} · 序号 ${k + 1}）${r.ss === 'H' ? ' · 螺旋' : r.ss === 'E' ? ' · 折叠' : ''}${visArr ? (cellInView ? ' · 在视野内' : ' · 视野外') : ''}`}
                            selected={isSel}
                            preview={!!dragView && dragView.chainIdx === ci && k >= dragView.lo && k <= dragView.hi}
                            previewRemove={dragView?.mode === 'remove'}
                            inView={cellInView}
                            showInView={!!visArr}
                            noHover={!!dragView}
                          />
                        )
                      })}
                    </div>
                  </div>
                </FadeEdge>
              </div>
            )
          })}
          {polymerChains.length === 0 && (
            <p className="py-2 text-[11px] text-muted-foreground">该结构不含聚合物链（仅配体/小分子）。</p>
          )}
          <p className="pb-0.5 pt-1 text-[9px] leading-relaxed text-muted-foreground/70">
            拖拽字母格批量选取（Shift 追加 / Alt 移除 / Esc 取消）· 点击选残基 · 双击聚焦 · 框选后可命名保存进选择库
          </p>
        </div>
      )}

      {/* 拖拽跟随提示：外层 JS 定位（每帧 transform，无 React 渲染），内层做居中偏移 */}
      {dragView && tipText && (
        <div
          ref={el => {
            dragTipRef.current = el
            if (el) el.style.transform = `translate(${lastPtRef.current.x}px, ${lastPtRef.current.y}px)`
          }}
          className="pointer-events-none fixed left-0 top-0 z-[60]"
        >
          <div className="-translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[10px] font-medium text-popover-foreground shadow-lg">
            {tipText}
            <span className="ml-1.5 text-[9px] text-muted-foreground">松开确认</span>
          </div>
        </div>
      )}
    </div>
  )
}

/** 刻度格：与序列格同宽；每 10 位显示残基号（真实 PDB 编号），每 5 位小刻度线 */
const RulerCell = memo(function RulerCell({ position, resSeq }: { position: number; resSeq: number }) {
  const major = position % 10 === 0
  const minor = !major && position % 5 === 0
  return (
    <div className="relative h-3 shrink-0" style={{ width: CELL_W }}>
      {major ? (
        <span className="absolute inset-x-0 top-[3px] text-center font-mono text-[8px] font-semibold tabular-nums leading-none text-muted-foreground/75">
          {resSeq}
        </span>
      ) : minor ? (
        <span className="absolute left-1/2 top-[6px] h-[4px] w-px -translate-x-1/2 bg-border" />
      ) : null}
    </div>
  )
})

const ResidueCell = memo(function ResidueCell({
  resIdx, chainIdx, pos, letter, color, ink, ss, title, selected, preview, previewRemove, inView, showInView, noHover,
}: {
  resIdx: number
  chainIdx: number
  pos: number
  letter: string
  color: string
  /** 自适应墨色：按格底色亮度选近黑/近白（readableInk） */
  ink: string
  ss: string
  title: string
  selected: boolean
  /** 拖拽预览：处于框选范围内 */
  preview: boolean
  /** 拖拽为移除模式（红色蒙层） */
  previewRemove: boolean
  inView: boolean
  showInView: boolean
  /** 拖拽进行中：禁用 hover 缩放避免跳动 */
  noHover: boolean
}) {
  return (
    <button
      title={title}
      data-res={resIdx}
      data-chain={chainIdx}
      data-k={pos}
      aria-label={title}
      className={cn(
        'relative flex h-6 shrink-0 items-center justify-center rounded-[3px] outline-none transition-[transform,box-shadow] duration-100',
        !noHover && 'hover:z-10 hover:scale-[1.18] hover:shadow-md',
        selected && 'z-10 ring-2 ring-primary ring-inset',
      )}
      style={{ width: CELL_W, background: color }}
    >
      {/* 二级结构轨道（hover 时提亮） */}
      <span
        className="absolute inset-x-[2px] top-0 h-[2px] rounded-full"
        style={{ background: ssCssColor(ss), opacity: ss === 'L' ? 0.3 : 0.85 }}
      />
      {/* 氨基酸缩写：永远显示（刻度移至独立行），水平垂直居中 */}
      <span className="text-[10px] font-bold leading-none" style={{ color: ink }}>
        {letter}
      </span>
      {/* 拖拽框选预览蒙层 */}
      {preview && (
        <span className={cn('pointer-events-none absolute inset-0 rounded-[3px]', previewRemove ? 'bg-destructive/55' : 'bg-primary/55')} />
      )}
      {/* 视口聚焦下划线：残基在当前相机视野内（切层同步感知） */}
      {showInView && inView && (
        <span className="absolute inset-x-[2px] bottom-0 h-[2px] rounded-full bg-primary" />
      )}
    </button>
  )
})
