'use client'

// 结构面板：结构列表（卡片可折叠）、链、配体、对称伴侣、叠合
import { useEffect, useState } from 'react'
import { Eye, EyeOff, X, Boxes, Droplets, FlaskConical, Dna, TestTube, Combine, Undo2, ArrowRight, Target, Copy, ChevronDown, ChevronRight, ChevronsUpDown, Paintbrush, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { engineRef, dataRegistry, useMolStore } from '@/lib/molecular/store'
import { textRegistry } from '@/lib/molecular/text-registry'
import type { StructureEntry } from '@/lib/molecular/types'
import { spaceGroupInfo } from '@/lib/molecular/symmetry'
import { cn } from '@/lib/utils'
import { SectionTitle, PanelHint } from '../LeftPanel'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/** 行内快速上色色板（链间可区分性优先；避免蓝紫主色干扰主题） */
const QUICK_PALETTE = [
  '#e35d5d', '#e8a13a', '#e8d17a', '#8fd694', '#4fb3c6', '#5da5e0', '#7d8fe0', '#a06bd8',
  '#d870b0', '#c98d6b', '#9aa3ad', '#7a8a99', '#ef8a5a', '#6bc5b8', '#b5cc4e', '#8a79c9',
]

/** 行内快速上色弹层：色板 + 自定义色 + 重置——免去「结构选链 → 颜色面板上色」跨标签切换 */
function QuickColorPopover({
  label, fallback, overrides, sampleAtom, onApply, onReset, dualColor,
}: {
  label: string
  /** 未覆盖时的默认色（链调色板色） */
  fallback: string
  /** 结构级颜色覆盖表 */
  overrides: Record<number, string>
  /** 取代表原子（展示当前生效色；-1 = 无样本） */
  sampleAtom: number
  onApply: (hex: string) => void
  onReset: () => void
  /** 双色棋盘格提示（如配体双色） */
  dualColor?: string
}) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('#e35d5d')
  const overridden = sampleAtom >= 0 && !!overrides[sampleAtom]
  const effective = (sampleAtom >= 0 && overrides[sampleAtom]) || fallback
  const apply = (hex: string) => {
    onApply(hex)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            // h-8 视觉 + after 负外扩伪元素 = 44px 触控热区（移动端可点性，r29 遗留）
            'group/dot relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition hover:bg-accent',
            'after:absolute after:-inset-1.5 after:rounded-lg after:content-[""]',
            overridden && 'ring-1 ring-primary/50',
          )}
          title={`为${label}上色（色板/自定义/重置）${overridden ? '\n已有自定义色，环高亮标记' : ''}`}
          aria-label={`为${label}上色`}
        >
          {dualColor ? (
            <span
              className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-xs"
              style={{ background: `linear-gradient(135deg, ${effective} 50%, ${dualColor} 50%)` }}
            />
          ) : (
            <span className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-xs" style={{ background: effective }} />
          )}
          <Paintbrush className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-[3px] bg-background text-muted-foreground opacity-0 transition group-hover/dot:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="end" side="left">
        <p className="mb-1.5 flex items-center gap-1 px-0.5 text-[10px] font-medium text-muted-foreground">
          <Paintbrush className="h-3 w-3" /> {label} 上色
        </p>
        <div className="grid grid-cols-8 gap-1">
          {QUICK_PALETTE.map(hex => (
            <button
              key={hex}
              onClick={() => apply(hex)}
              className="h-4 w-4 rounded-[4px] border border-black/10 shadow-xs transition hover:scale-125 hover:ring-2 hover:ring-primary/50"
              style={{ background: hex }}
              title={hex}
              aria-label={`上色 ${hex}`}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <input
            type="color"
            value={custom}
            onChange={e => setCustom(e.target.value)}
            className="h-6 w-7 cursor-pointer rounded border border-border bg-background p-0.5"
            aria-label="自定义颜色"
          />
          <button
            onClick={() => apply(custom)}
            className="flex h-6 flex-1 items-center justify-center gap-1 rounded-md bg-primary px-2 text-[10px] font-medium text-primary-foreground transition hover:opacity-90"
          >
            应用自定义
          </button>
        </div>
        <button
          onClick={() => { onReset(); setOpen(false) }}
          disabled={!overridden}
          className={cn(
            'mt-1.5 flex h-6 w-full items-center justify-center gap-1 rounded-md border border-border text-[10px] transition',
            overridden ? 'hover:bg-accent hover:text-foreground' : 'opacity-40',
          )}
        >
          <RotateCcw className="h-3 w-3" /> 重置此范围颜色
        </button>
      </PopoverContent>
    </Popover>
  )
}

const CHAIN_TYPE_ICON: Record<string, typeof Dna> = {
  protein: Dna, nucleic: Dna, water: Droplets, ligand: FlaskConical,
}
const CHAIN_TYPE_LABEL: Record<string, string> = {
  protein: '蛋白质', nucleic: '核酸', water: '水', ligand: '配体',
}

/** 关闭单个结构：快照全部状态，toast 8 秒内可撤销（表示法/着色/叠合变换/对称伴侣均还原） */
function closeStructureWithUndo(st: StructureEntry) {
  const data = dataRegistry.get(st.id)
  const text = textRegistry.get(st.id)
  useMolStore.getState().removeStructure(st.id)
  if (!data || !text) {
    toast.success(`已关闭 ${st.name}`)
    return
  }
  toast.success(`已关闭 ${st.name}`, {
    description: `${st.summary.atoms.toLocaleString()} 原子 · 表示法与着色已快照，可撤销`,
    action: {
      label: '撤销',
      onClick: () => {
        const newId = useMolStore.getState().addStructure(data, st.name, 0)
        textRegistry.set(newId, text)
        useMolStore.setState(s => ({
          structures: s.structures.map(x => x.id === newId
            ? { ...x, reps: st.reps, colorOverrides: st.colorOverrides, visible: st.visible, transform: st.transform, symmetry: st.symmetry, hasSS: st.hasSS }
            : x),
        }))
        if (st.symmetry?.radius) engineRef.current?.updateSymmetry(newId, st.symmetry.radius)
        toast.success(`已恢复 ${st.name}`, { description: '表示法 / 着色 / 叠合变换 / 对称伴侣均已还原' })
      },
    },
    duration: 8000,
  })
}

/** 折叠结构卡片状态（按结构名持久化到 localStorage） */
const COLLAPSED_KEY = 'molvision-collapsed-structures'

function loadCollapsed(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const saved = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]')
    if (Array.isArray(saved)) return new Set(saved)
  } catch { /* ignore */ }
  return new Set()
}

export function StructuresPanel() {
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const setActive = useMolStore(s => s.setActive)
  const setStructureVisible = useMolStore(s => s.setStructureVisible)
  const setUi = useMolStore(s => s.setUi)
  // 链/分子行选中态判定用：当前选择落在哪个链组（见下方 selChainIdx）
  const selection = useMolStore(s => s.selection)
  // 叠合工具状态（≥2 结构显示）
  const [spOpen, setSpOpen] = useState(false)
  const [spMobile, setSpMobile] = useState<string | null>(null)   // 结构 id（null=自动第一个非活动）
  const [spMobChain, setSpMobChain] = useState('')                // ''=自动
  const [spRefChain, setSpRefChain] = useState('')                // ''=自动
  // 对称伴侣半径（本地输入值，生成时才提交）
  const [symRadius, setSymRadius] = useState(20)
  // 全部关闭确认
  const [confirmCloseAll, setConfirmCloseAll] = useState(false)
  // 折叠的结构名集合（按名持久化：会话恢复/合并后仍生效）
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed())

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed])) } catch { /* ignore */ }
  }, [collapsed])

  const toggleCollapse = (name: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const allCollapsed = structures.length > 0 && structures.every(st => collapsed.has(st.name))
  const toggleCollapseAll = () => {
    setCollapsed(allCollapsed ? new Set() : new Set(structures.map(st => st.name)))
  }

  if (!structures.length) {
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
        <Boxes className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">暂无结构。点击顶部「加载结构」或拖入文件。</p>
        <button
          onClick={() => setUi({ loadOpen: true })}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
        >
          加载结构
        </button>
      </div>
    )
  }

  return (
    <div className="pb-4">
      <SectionTitle right={
        <span className="flex items-center gap-1.5">
          {structures.length >= 4 && (
            <button
              onClick={toggleCollapseAll}
              className="flex items-center gap-0.5 rounded px-1 text-[10px] text-muted-foreground/80 transition hover:bg-accent hover:text-foreground"
              title={allCollapsed ? '展开全部卡片（显示统计徽章）' : '折叠全部卡片（多结构时减少滚动）'}
            >
              <ChevronsUpDown className="h-3 w-3" />
              {allCollapsed ? '全部展开' : '全部折叠'}
            </button>
          )}
          {structures.length >= 2 ? (
            <button
              onClick={() => setConfirmCloseAll(true)}
              className="rounded px-1 text-[10px] text-muted-foreground/80 transition hover:bg-destructive/10 hover:text-destructive"
              title="关闭全部已加载结构（含确认）"
            >
              全部关闭
            </button>
          ) : undefined}
        </span>
      }>
        已加载结构 ({structures.length})
      </SectionTitle>
      <div className="space-y-1.5 px-3">
        {structures.map(st => (
          <div
            key={st.id}
            className={cn(
              // `!` 提权：panel-card 为未分层自定义规则，压过 @layer utilities 的状态类
              'group panel-card relative p-2.5',
              st.id === activeId && 'mol-elevate border-primary/45! bg-primary/[0.04]!',
              !st.visible && 'opacity-60 saturate-50',
            )}
          >
            {/* 活动结构：翡翠左轨锚点（仪器标记，替代任意感绿边） */}
            {st.id === activeId && <span aria-hidden className="absolute -left-px top-2 bottom-2 w-[2px] rounded-r-full bg-primary/85" />}
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleCollapse(st.name)}
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition hover:bg-accent hover:text-foreground',
                  collapsed.has(st.name) && 'text-muted-foreground',
                )}
                title={collapsed.has(st.name) ? '展开卡片（显示原子/残基/分辨率统计）' : '折叠卡片（隐藏统计徽章）'}
                aria-label={collapsed.has(st.name) ? `展开 ${st.name}` : `折叠 ${st.name}`}
              >
                {collapsed.has(st.name) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setActive(st.id)}>
                <span className={cn(
                  'shrink-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums tracking-wide shadow-xs',
                  st.id === activeId
                    ? 'bg-primary text-primary-foreground'
                    : 'border border-border bg-background text-foreground/90',
                )}>
                  {st.name.slice(0, 8)}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={st.meta.title}>
                  {st.meta.title?.slice(0, 40) || st.format.toUpperCase()}
                </span>
              </button>
              {structures.length >= 2 && st.id !== activeId && (
                <button
                  onClick={() => {
                    const eng = engineRef.current
                    const store = useMolStore.getState()
                    const ref = store.structures.find(x => x.id === activeId)
                    if (!eng || !ref) return
                    const res = eng.superpose(st.id, ref.id)
                    if (!res.ok) {
                      toast.error('叠合失败', { description: res.error })
                      return
                    }
                    toast.success(`叠合完成：${st.name} → ${ref.name}`, {
                      description: `链 ${res.mobileChain} ↔ 链 ${res.refChain} · 匹配 ${res.matched} 对 CA · RMSD ${res.rmsd.toFixed(2)} Å`,
                    })
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
                  title={`叠合到 ${structures.find(x => x.id === activeId)?.name ?? '活动结构'}（序列比对 + 刚体拟合）`}
                >
                  <Combine className="h-3.5 w-3.5" />
                </button>
              )}
              {st.transform && (
                <button
                  onClick={() => {
                    const r = engineRef.current?.resetTransform(st.id)
                    if (!r) return
                    if (!r.ok) return toast.error('重置失败', { description: r.message })
                    toast.success(r.message, { description: 'untransform 命令可撤销指定结构的叠合' })
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
                  title="撤销叠合变换，回到原始位姿（untransform）"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setStructureVisible(st.id, !st.visible)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
                title={st.visible ? '隐藏' : '显示'}
              >
                {st.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => closeStructureWithUndo(st)}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                title={`关闭 ${st.name}（8 秒内可撤销）`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {!collapsed.has(st.name) && (
              /* r56：统计行从散落徽章改为单条仪器读数带（点分隔 + 统一 tabular-nums，消除「数据飘在空中」） */
              <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-md bg-muted/45 px-2 py-[5px] font-mono text-[9.5px] leading-none tabular-nums text-muted-foreground dark:bg-white/[0.04]">
                <span>{st.summary.atoms.toLocaleString()} 原子</span>
                <span aria-hidden className="text-muted-foreground/30">·</span>
                <span>{st.summary.residues.toLocaleString()} 残基</span>
                <span aria-hidden className="text-muted-foreground/30">·</span>
                <span>{st.summary.chains} 链</span>
                {st.meta.resolution && (
                  <>
                    <span aria-hidden className="text-muted-foreground/30">·</span>
                    <span>{st.meta.resolution} Å</span>
                  </>
                )}
                <span aria-hidden className="text-muted-foreground/30">·</span>
                <span className="text-muted-foreground/75">{st.loadMs < 1 ? '<1' : st.loadMs.toFixed(0)} ms</span>
              </div>
            )}
            {collapsed.has(st.name) && st.summary.atoms > 0 && (
              <div className="mt-0.5 pl-7 font-mono text-[9px] tabular-nums text-muted-foreground/60">
                {st.summary.atoms.toLocaleString()} at · {st.summary.chains} 链{st.meta.resolution ? ` · ${st.meta.resolution} Å` : ''}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 活动结构的链 */}
      {(() => {
        const st = structures.find(x => x.id === activeId)
        if (!st) return null
        const data = dataRegistry.get(st.id)
        // 配体链组展开为「分子行」：同一链组常含多个独立小分子（如 PO4+HEM 同链），
        // 点行选分子而非整组——修复「点配体却选中整条链」
        const resChain: number[] = []
        if (data) data.chains.forEach((c, k) => c.residueIdx.forEach(ri => { resChain[ri] = k }))
        // 选中链组判定：当前选择全部落在同一链组 → 该行显示选中态（仪器 tick 反馈）
        // 注意 selection.indices 是原子索引，需经 atomResidue 映射到残基再查 resChain
        const selChainIdx = new Set<number>()
        const selRes = new Set<number>()
        if (data && selection.structureId === st.id && selection.indices.length) {
          for (const ai of selection.indices) {
            const ri = data.atomResidue[ai]
            if (ri === undefined) continue
            selRes.add(ri)
            const ci = resChain[ri]
            if (ci !== undefined) selChainIdx.add(ci)
          }
        }
        const isChainSelected = selChainIdx.size === 1
        type Row =
          | { kind: 'chain'; i: number; c: typeof st.chains[number] }
          | { kind: 'molecule'; i: number; c: typeof st.chains[number]; m: NonNullable<typeof data>['molecules'][number]; mi: number }
        const rows: Row[] = []
        st.chains.forEach((c, i) => {
          if (data && c.type === 'ligand' && data.molecules.length > 0) {
            const mols = data.molecules.map((m, mi) => ({ m, mi })).filter(({ m }) => resChain[m.residues[0]] === i)
            if (mols.length > 0) {
              for (const { m, mi } of mols) rows.push({ kind: 'molecule', i, c, m, mi })
              return
            }
          }
          rows.push({ kind: 'chain', i, c })
        })
        const selectMolecule = (m: NonNullable<typeof data>['molecules'][number]) => {
          if (!data) return
          const idx: number[] = []
          for (const ri of m.residues) {
            const r = data.residues[ri]
            for (let i = r.start; i < r.end; i++) idx.push(i)
          }
          useMolStore.getState().setActive(st.id)
          useMolStore.getState().setSelection(st.id, idx)
          return idx
        }
        return (
          <>
            <SectionTitle right={
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70" title="点击行选中链 · 右侧色点可直接上色（无需切到颜色标签） · 眼睛图标隐藏/恢复单链">
                {st.hiddenChains?.length ? (
                  <button
                    onClick={() => { useMolStore.getState().setChainHidden(st.id, null); toast.success('已恢复显示全部链', { description: 'isolate off 亦可解除隔离' }) }}
                    className="rounded bg-amber-500/15 px-1.5 py-px font-medium text-amber-600 transition hover:bg-amber-500/25 dark:text-amber-400"
                    title="当前隔离中：部分链已隐藏，点击全部恢复"
                  >
                    隔离中 {st.hiddenChains.length} 链 ⊠
                  </button>
                ) : null}
                点击选链 · 色点上色
              </span>
            }>链 ({st.chains.length})</SectionTitle>
            <div className="mol-scroll max-h-56 space-y-0.5 overflow-y-auto px-3 py-1">
              {rows.map((row, k) => {
                if (row.kind === 'molecule') {
                  const { i, c, m, mi } = row
                  const dupId = st.chains.filter(x => x.id === c.id).length > 1
                  const label = c.id === ' ' ? '—' : c.id
                  return (
                    <div key={`mol-${mi}-${k}`} className="flex items-center gap-0.5">
                      <button
                        onClick={() => selectMolecule(m)}
                        onDoubleClick={() => {
                          const idx = selectMolecule(m)
                          if (idx?.length) engineRef.current?.fitView([{ structureId: st.id, indices: idx }])
                        }}
                        className={cn(
                          'flex min-h-8 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition',
                          isChainSelected && m.residues.some(ri => selRes.has(ri))
                            ? 'bg-primary/[0.07] shadow-[inset_2px_0_0_0_var(--primary)]'
                            : 'hover:bg-accent/80',
                        )}
                        title={`选择此配体分子 ${m.label}（${m.atoms} 原子）· 双击聚焦${m.residues.length > 1 ? ` · 跨 ${m.residues.length} 个残基` : ''}`}
                      >
                        <span className="h-3.5 w-1 shrink-0 rounded-full opacity-80" style={{ background: c.color }} />
                        <span className="w-6 shrink-0 font-mono text-xs font-bold">{label}</span>
                        {dupId && (
                          <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] leading-4 text-muted-foreground">#{i + 1}</span>
                        )}
                        <FlaskConical className="h-3 w-3 shrink-0 text-amber-600/80 dark:text-amber-400/80" />
                        <span className="min-w-0 truncate rounded border border-border bg-transparent px-1.5 font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-400" title={`${m.label}（${m.atoms} 原子）`}>
                          {m.label}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] font-semibold tabular-nums text-foreground/75">{m.atoms} at</span>
                      </button>
                      <QuickColorPopover
                        label={`配体 ${m.label}`}
                        fallback={c.color}
                        overrides={st.colorOverrides}
                        sampleAtom={data ? data.residues[m.residues[0]].start : -1}
                        onApply={hex => {
                          const idx = selectMolecule(m)
                          if (idx?.length) {
                            useMolStore.getState().applyColor(hex)
                            toast.success(`配体 ${m.label} 已上色`, { description: `${idx.length} 个原子 · 双色点可重置` })
                          }
                        }}
                        onReset={() => {
                          const idx = selectMolecule(m)
                          if (idx?.length) {
                            useMolStore.getState().resetColors('selection')
                            toast.success(`配体 ${m.label} 颜色已重置`)
                          }
                        }}
                      />
                    </div>
                  )
                }
                const { i, c } = row
                const Icon = CHAIN_TYPE_ICON[c.type] ?? TestTube
                // 同一链 ID 可能拆成多个链组（蛋白链 A + 配体链 A + 水链 A）。
                // 用 chainidx 按链组索引选择，避免「点配体链却选中整条链」
                const dupId = st.chains.filter(x => x.id === c.id).length > 1
                const label = c.id === ' ' ? '—' : c.id
                const chainHidden = !!st.hiddenChains?.includes(i)
                const selectChain = () => {
                  const store = useMolStore.getState()
                  store.setActive(st.id)
                  const res = store.selectFromExpr(`chainidx ${i}`)
                  if (res.error) toast.error(res.error)
                  return res
                }
                return (
                  <div key={`${c.id}-${i}-${k}`} className={cn('flex items-center gap-0.5', chainHidden && 'opacity-55')}>
                    <button
                      onClick={() => { selectChain() }}
                      onDoubleClick={() => {
                        const res = selectChain()
                        if (!res.error && res.count > 0) {
                          engineRef.current?.fitView([{ structureId: st.id, indices: useMolStore.getState().selection.indices }])
                        }
                      }}
                      className={cn(
                        'flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition',
                        isChainSelected && selChainIdx.has(i)
                          ? 'bg-primary/[0.07] shadow-[inset_2px_0_0_0_var(--primary)]'
                          : 'hover:bg-accent/80',
                      )}
                      title={`选择此链组（${c.residues} 残基 · ${c.atoms} 原子）· 双击聚焦${dupId ? ' · 同链 ID 含多个链组，已按链组精确选择' : ''}`}
                    >
                      <span className="h-3.5 w-1 shrink-0 rounded-full opacity-80" style={{ background: c.color }} />
                      <span className="w-6 shrink-0 font-mono text-xs font-bold">{label}</span>
                      {dupId && (
                        <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] leading-4 text-muted-foreground">#{i + 1}</span>
                      )}
                      <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="shrink-0 text-[10px] text-muted-foreground">{CHAIN_TYPE_LABEL[c.type]}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] font-semibold tabular-nums text-foreground/75">
                        {c.residues > 0 && `${c.residues} res`}
                      </span>
                    </button>
                    {/* 链组眼睛开关（isolate/chains hide 同一状态源）：隐藏单链分析单链配体 */}
                    <button
                      onClick={() => {
                        const store = useMolStore.getState()
                        store.setActive(st.id)
                        store.toggleChainHidden(st.id, i)
                      }}
                      aria-label={chainHidden ? `恢复显示链 ${label}` : `隐藏链 ${label}`}
                      title={chainHidden ? `恢复显示链 ${label}（chains show ${label} 同效）` : `隐藏链 ${label}——多链蛋白只看单链时用（isolate <选择> 一键隔离到选择所在链；chains hide ${label} 同效）`}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-accent hover:text-foreground active:scale-95"
                    >
                      {chainHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <QuickColorPopover
                      label={`链 ${label}`}
                      fallback={c.color}
                      overrides={st.colorOverrides}
                      sampleAtom={data ? data.chains[i].start : -1}
                      onApply={hex => {
                        const res = selectChain()
                        if (!res.error && res.count > 0) {
                          useMolStore.getState().applyColor(hex)
                          toast.success(`链 ${label} 已上色`, { description: `${res.count.toLocaleString()} 个原子 · 再点色点可换色或重置` })
                        }
                      }}
                      onReset={() => {
                        const res = selectChain()
                        if (!res.error && res.count > 0) {
                          useMolStore.getState().resetColors('selection')
                          toast.success(`链 ${label} 颜色已重置`)
                        }
                      }}
                    />
                  </div>
                )
              })}
            </div>

            {/* 晶体对称伴侣（CRYST1 存在时显示） */}
            {(() => {
              const data = dataRegistry.get(st.id)
              const crystal = data?.crystal
              if (!crystal) return null
              const sym = st.symmetry
              const ops = spaceGroupInfo(crystal.spaceGroup)?.ops
              const apply = (r: number) => {
                const eng = engineRef.current
                if (!eng) return
                const res = eng.updateSymmetry(st.id, r)
                if (!res.ok) toast.error('对称伴侣', { description: res.message })
                else if (r > 0) toast.success(res.message)
              }
              return (
                <>
                  <SectionTitle right={
                    sym ? (
                      <button onClick={() => apply(0)} className="text-[10px] text-muted-foreground transition hover:text-destructive">
                        关闭
                      </button>
                    ) : undefined
                  }>
                    <span className="flex items-center gap-1">
                      <Copy className="h-3 w-3" /> 对称伴侣
                    </span>
                  </SectionTitle>
                  <div className="space-y-2 px-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[9px] tabular-nums" title="空间群（CRYST1）">
                        {crystal.spaceGroup.trim() || 'P 1'}
                      </Badge>
                      {ops != null && (
                        <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[9px] font-normal tabular-nums" title="对称操作数（含晶格心平移）">
                          {ops} ops
                        </Badge>
                      )}
                      <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[9px] font-normal tabular-nums" title="晶胞（Å / °）">
                        {crystal.a.toFixed(1)}×{crystal.b.toFixed(1)}×{crystal.c.toFixed(1)}Å
                      </Badge>
                      {sym && (
                        <Badge className="bg-primary/10 px-1.5 py-0 font-mono text-[9px] font-normal tabular-nums text-primary hover:bg-primary/20">
                          {sym.count} 个伴侣 · {sym.radius} Å
                        </Badge>
                      )}
                    </div>
                    {sym ? (
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>搜索半径</span>
                          <span className="font-mono tabular-nums">{symRadius} Å</span>
                        </div>
                        <Slider
                          value={[symRadius]}
                          min={5} max={80} step={1}
                          onValueChange={v => { setSymRadius(v[0]); apply(v[0]) }}
                        />
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        {[12, 20, 30].map(r => (
                          <button
                            key={r}
                            onClick={() => { setSymRadius(r); apply(r) }}
                            className="flex-1 rounded-md border border-border px-1.5 py-1 font-mono text-[10px] font-medium tabular-nums text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                          >
                            {r} Å
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="text-[9px] leading-relaxed text-muted-foreground/70">
                      按 CRYST1 空间群生成晶格邻居（视觉副本，不参与拾取）；命令行：symmetry 20 / symmetry off。设置随会话保存。
                    </p>
                  </div>
                </>
              )
            })()}

            {st.ligands.length > 0 && (
              <>
                <SectionTitle right={
                  <span className="text-[10px] tabular-nums text-muted-foreground">{st.ligands.length} 种</span>
                }>
                  <span className="flex items-center gap-1">
                    <FlaskConical className="h-3 w-3" /> 配体
                  </span>
                </SectionTitle>
                <div className="space-y-1 px-3">
                  {st.ligands.slice(0, 24).map(lg => (
                    <div key={lg.resName} className="group/lg flex items-center gap-1">
                      <button
                        onClick={() => {
                          const store = useMolStore.getState()
                          const res = store.selectFromExpr(`resn ${lg.resName}`)
                          if (!res.error && res.count > 0) {
                            engineRef.current?.fitView([{ structureId: st.id, indices: useMolStore.getState().selection.indices }])
                          }
                        }}
                        onDoubleClick={() => {
                          // 双击：仅选中首个拷贝所在的完整配体分子（连通分量，多残基配体不截断）
                          const data = dataRegistry.get(st.id)
                          if (!data) return
                          const mol = data.molecules.find(m => m.resNames.includes(lg.resName.toUpperCase()))
                          if (!mol) return
                          const idx: number[] = []
                          for (const ri of mol.residues) {
                            const r = data.residues[ri]
                            for (let i = r.start; i < r.end; i++) idx.push(i)
                          }
                          useMolStore.getState().setActive(st.id)
                          useMolStore.getState().setSelection(st.id, idx)
                          toast.success(`已选中首个 ${lg.resName} 分子拷贝`, { description: `${mol.label} · ${mol.atoms} 原子 · 双击聚焦在序列条配体行` })
                        }}
                        className="rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums transition hover:border-primary/50 hover:bg-primary/5"
                        title={`选择全部 ${lg.resName}（链 ${lg.chainIds}）· 双击仅选首个分子拷贝`}
                      >
                        {lg.resName}
                        {lg.count > 1 && <span className="ml-0.5 text-muted-foreground">×{lg.count}</span>}
                      </button>
                      {/* 口袋环境：一键选中该配体 4.5Å 内的完整残基（结合位点） */}
                      <button
                        onClick={() => {
                          const store = useMolStore.getState()
                          const res = store.selectFromExpr(`byres (within 4.5 of resn ${lg.resName})`)
                          if (res.error) { toast.error(res.error); return }
                          toast.success(`${lg.resName} 结合口袋`, { description: `${res.count.toLocaleString()} 个原子（含周围残基）· 可直接着色/新建表示法` })
                        }}
                        className="flex h-5 items-center gap-0.5 rounded-md border border-primary/40 bg-primary/5 px-1 text-[9px] font-medium text-primary opacity-80 transition hover:bg-primary/15 hover:opacity-100"
                        title={`选择 ${lg.resName} 周围 4.5Å 结合口袋（含完整残基）`}
                      >
                        <Target className="h-2.5 w-2.5" /> 口袋
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )
      })()}
      {/* 叠合工具（≥2 结构） */}
      {structures.length >= 2 && (() => {
        const ref = structures.find(x => x.id === activeId) ?? structures[0]
        const mobile = structures.find(x => x.id === spMobile && x.id !== ref.id) ?? structures.find(x => x.id !== ref.id)
        if (!mobile || !ref) return null
        const mobChains = mobile.chains.filter(c => c.type === 'protein' || c.type === 'nucleic')
        const refChains = ref.chains.filter(c => c.type === 'protein' || c.type === 'nucleic')
        return (
          <>
            <SectionTitle right={
              <button onClick={() => setSpOpen(o => !o)} className="text-[10px] text-muted-foreground transition hover:text-foreground">
                {spOpen ? '收起' : '展开'}
              </button>
            }>
              <span className="flex items-center gap-1">
                <Combine className="h-3 w-3" /> 叠合 (matchmaker)
              </span>
            </SectionTitle>
            {spOpen && (
              <div className="space-y-2 px-3">
                <div className="flex items-center gap-1.5">
                  <select
                    value={mobile.id}
                    onChange={e => setSpMobile(e.target.value)}
                    className="min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-background px-1.5 py-1 font-mono text-[10px] text-foreground outline-none"
                    title="移动结构（被变换）"
                  >
                    {structures.filter(x => x.id !== ref.id).map(x => (
                      <option key={x.id} value={x.id}>{x.name.slice(0, 8)}</option>
                    ))}
                  </select>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span
                    className="min-w-0 flex-1 truncate rounded-md border border-primary/40 bg-primary/5 px-1.5 py-1 font-mono text-[10px] tabular-nums text-primary"
                    title={`参考结构（不动）：${ref.name}`}
                  >
                    {ref.name.slice(0, 8)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={spMobChain}
                    onChange={e => setSpMobChain(e.target.value)}
                    className="cursor-pointer rounded-md border border-border bg-background px-1.5 py-1 text-[10px] text-foreground outline-none"
                    title="移动链（空 = 自动选最长蛋白链）"
                  >
                    <option value="">移动链：自动</option>
                    {mobChains.map((c, i) => (
                      <option key={`${c.id}-${i}`} value={c.id.trim()}>链 {c.id.trim() || '—'}</option>
                    ))}
                  </select>
                  <select
                    value={spRefChain}
                    onChange={e => setSpRefChain(e.target.value)}
                    className="cursor-pointer rounded-md border border-border bg-background px-1.5 py-1 text-[10px] text-foreground outline-none"
                    title="参考链（空 = 自动最佳比对）"
                  >
                    <option value="">参考链：自动</option>
                    {refChains.map((c, i) => (
                      <option key={`${c.id}-${i}`} value={c.id.trim()}>链 {c.id.trim() || '—'}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => {
                    const eng = engineRef.current
                    if (!eng) return
                    const res = eng.superpose(mobile.id, ref.id, spMobChain || undefined, spRefChain || undefined)
                    if (!res.ok) {
                      toast.error('叠合失败', { description: res.error })
                      return
                    }
                    toast.success(`叠合完成：${mobile.name} → ${ref.name}`, {
                      description: `链 ${res.mobileChain} ↔ 链 ${res.refChain} · 匹配 ${res.matched} 对 CA · RMSD ${res.rmsd.toFixed(2)} Å`,
                    })
                  }}
                  className="mol-btn-primary flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90"
                >
                  <Combine className="h-3.5 w-3.5" />
                  开始叠合
                </button>
              </div>
            )}
          </>
        )
      })()}
      <PanelHint>点击链选择（配体行按<b>分子</b>精确选择，双击聚焦）；结构卡片点击切换活动结构；{structures.length >= 2 ? '「叠合」按钮将此结构叠合到活动结构（superpose）。' : ''}</PanelHint>

      {/* 全部关闭确认 */}
      <AlertDialog open={confirmCloseAll} onOpenChange={setConfirmCloseAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关闭全部 {structures.length} 个结构？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>将移除全部已加载结构及关联的标签、测量、命名选择；视角书签与 movie 时间轴保留。</p>
                <p className="mt-1.5 text-muted-foreground">如需连书签/时间轴一并清空，请用工具栏「会话 → 新建会话」。每个结构单独关闭时 toast 内可撤销，批量关闭不可撤销。</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const n = structures.length
                for (const st of [...structures]) useMolStore.getState().removeStructure(st.id)
                setConfirmCloseAll(false)
                toast.success(`已关闭 ${n} 个结构`, { description: '场景已清空——书签与时间轴保留（彻底重置用「新建会话」）' })
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              全部关闭
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
