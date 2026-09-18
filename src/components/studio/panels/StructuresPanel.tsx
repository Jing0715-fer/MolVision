'use client'

// 结构面板：结构列表、链、配体、对称伴侣、叠合
import { useState } from 'react'
import { Eye, EyeOff, X, Boxes, Droplets, FlaskConical, Dna, TestTube, Combine, Undo2, ArrowRight, Target, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { engineRef, dataRegistry, useMolStore } from '@/lib/molecular/store'
import { textRegistry } from '@/lib/molecular/text-registry'
import type { StructureEntry } from '@/lib/molecular/types'
import { spaceGroupInfo } from '@/lib/molecular/symmetry'
import { cn } from '@/lib/utils'
import { SectionTitle, PanelHint } from '../LeftPanel'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

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

export function StructuresPanel() {
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const setActive = useMolStore(s => s.setActive)
  const setStructureVisible = useMolStore(s => s.setStructureVisible)
  const setUi = useMolStore(s => s.setUi)
  // 叠合工具状态（≥2 结构显示）
  const [spOpen, setSpOpen] = useState(false)
  const [spMobile, setSpMobile] = useState<string | null>(null)   // 结构 id（null=自动第一个非活动）
  const [spMobChain, setSpMobChain] = useState('')                // ''=自动
  const [spRefChain, setSpRefChain] = useState('')                // ''=自动
  // 对称伴侣半径（本地输入值，生成时才提交）
  const [symRadius, setSymRadius] = useState(20)
  // 全部关闭确认
  const [confirmCloseAll, setConfirmCloseAll] = useState(false)

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
        structures.length >= 2 ? (
          <button
            onClick={() => setConfirmCloseAll(true)}
            className="rounded px-1 text-[10px] text-muted-foreground/80 transition hover:bg-destructive/10 hover:text-destructive"
            title="关闭全部已加载结构（含确认）"
          >
            全部关闭
          </button>
        ) : undefined
      }>
        已加载结构 ({structures.length})
      </SectionTitle>
      <div className="space-y-1.5 px-2">
        {structures.map(st => (
          <div
            key={st.id}
            className={cn(
              'group rounded-lg border p-2.5 transition',
              st.id === activeId
                ? 'mol-elevate border-primary/50 bg-primary/[0.04]'
                : 'border-border/60 hover:border-border hover:bg-accent/40',
            )}
          >
            <div className="flex items-center gap-2">
              <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setActive(st.id)}>
                <span className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide shadow-xs',
                  st.id === activeId
                    ? 'bg-primary text-primary-foreground shadow-emerald-500/20'
                    : 'border border-border/70 bg-background text-foreground/90',
                )}>
                  {st.name.slice(0, 8)}
                </span>
                <span className="flex-1 truncate text-[11px] text-muted-foreground" title={st.meta.title}>
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
                  className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-primary/10 hover:text-primary group-hover:opacity-100"
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
                  className="flex h-6 w-6 items-center justify-center rounded text-violet-500/70 opacity-0 transition hover:bg-violet-500/10 hover:text-violet-500 group-hover:opacity-100"
                  title="撤销叠合变换，回到原始位姿（untransform）"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                onClick={() => setStructureVisible(st.id, !st.visible)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
                title={st.visible ? '隐藏' : '显示'}
              >
                {st.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => closeStructureWithUndo(st)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/70 opacity-70 transition hover:bg-destructive/10 hover:text-destructive hover:opacity-100"
                title={`关闭 ${st.name}（8 秒内可撤销）`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-normal">
                {st.summary.atoms.toLocaleString()} 原子
              </Badge>
              <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-normal tabular-nums">
                {st.summary.residues.toLocaleString()} 残基
              </Badge>
              {st.meta.resolution && (
                <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-normal">
                  {st.meta.resolution} Å
                </Badge>
              )}
              <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-normal">
                {st.loadMs < 1 ? '<1' : st.loadMs.toFixed(0)} ms
              </Badge>
            </div>
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
            <SectionTitle>链 ({st.chains.length})</SectionTitle>
            <div className="mol-scroll max-h-56 space-y-0.5 overflow-y-auto px-2 py-1">
              {rows.map((row, k) => {
                if (row.kind === 'molecule') {
                  const { i, c, m, mi } = row
                  const dupId = st.chains.filter(x => x.id === c.id).length > 1
                  const label = c.id === ' ' ? '—' : c.id
                  return (
                    <button
                      key={`mol-${mi}-${k}`}
                      onClick={() => selectMolecule(m)}
                      onDoubleClick={() => {
                        const idx = selectMolecule(m)
                        if (idx?.length) engineRef.current?.fitView([{ structureId: st.id, indices: idx }])
                      }}
                      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition hover:bg-accent/80 hover:shadow-xs"
                      title={`选择此配体分子 ${m.label}（${m.atoms} 原子）· 双击聚焦${m.residues.length > 1 ? ` · 跨 ${m.residues.length} 个残基` : ''}`}
                    >
                      <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: c.color }} />
                      <span className="w-5 shrink-0 font-mono text-xs font-bold">{label}</span>
                      {dupId && (
                        <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] leading-4 text-muted-foreground">#{i + 1}</span>
                      )}
                      <FlaskConical className="h-3 w-3 shrink-0 text-amber-600/80 dark:text-amber-400/80" />
                      <span className="shrink-0 rounded bg-amber-500/10 px-1.5 font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                        {m.label}
                      </span>
                      <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">{m.atoms} at</span>
                    </button>
                  )
                }
                const { i, c } = row
                const Icon = CHAIN_TYPE_ICON[c.type] ?? TestTube
                // 同一链 ID 可能拆成多个链组（蛋白链 A + 配体链 A + 水链 A）。
                // 用 chainidx 按链组索引选择，避免「点配体链却选中整条链」
                const dupId = st.chains.filter(x => x.id === c.id).length > 1
                const label = c.id === ' ' ? '—' : c.id
                return (
                  <button
                    key={`${c.id}-${i}-${k}`}
                    onClick={() => {
                      const store = useMolStore.getState()
                      const res = store.selectFromExpr(`chainidx ${i}`)
                      if (res.error) toast.error(res.error)
                    }}
                    onDoubleClick={() => {
                      const store = useMolStore.getState()
                      const res = store.selectFromExpr(`chainidx ${i}`)
                      if (!res.error && res.count > 0) {
                        engineRef.current?.fitView([{ structureId: st.id, indices: useMolStore.getState().selection.indices }])
                      }
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-accent/80 hover:shadow-xs"
                    title={`选择此链组（${c.residues} 残基 · ${c.atoms} 原子）· 双击聚焦${dupId ? ' · 同链 ID 含多个链组，已按链组精确选择' : ''}`}
                  >
                    <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="w-6 shrink-0 font-mono text-xs font-bold">{label}</span>
                    {dupId && (
                      <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] leading-4 text-muted-foreground">#{i + 1}</span>
                    )}
                    <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 text-[10px] text-muted-foreground">{CHAIN_TYPE_LABEL[c.type]}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                      {c.residues > 0 && `${c.residues} res`}
                    </span>
                  </button>
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
                  <div className="space-y-2 px-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[9px]" title="空间群（CRYST1）">
                        {crystal.spaceGroup.trim() || 'P 1'}
                      </Badge>
                      {ops != null && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-normal" title="对称操作数（含晶格心平移）">
                          {ops} ops
                        </Badge>
                      )}
                      <Badge variant="secondary" className="px-1.5 py-0 font-mono text-[9px] font-normal" title="晶胞（Å / °）">
                        {crystal.a.toFixed(1)}×{crystal.b.toFixed(1)}×{crystal.c.toFixed(1)}Å
                      </Badge>
                      {sym && (
                        <Badge className="bg-violet-500/15 px-1.5 py-0 text-[9px] font-normal text-violet-600 hover:bg-violet-500/25 dark:text-violet-300">
                          {sym.count} 个伴侣 · {sym.radius} Å
                        </Badge>
                      )}
                    </div>
                    {sym ? (
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>搜索半径</span>
                          <span className="font-mono">{symRadius} Å</span>
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
                            className="flex-1 rounded-md border border-violet-500/30 bg-violet-500/5 px-1.5 py-1 text-[10px] font-medium text-violet-600/90 transition hover:bg-violet-500/15 dark:text-violet-300"
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
                  <span className="text-[10px] text-muted-foreground">{st.ligands.length} 种</span>
                }>
                  <span className="flex items-center gap-1">
                    <FlaskConical className="h-3 w-3" /> 配体
                  </span>
                </SectionTitle>
                <div className="space-y-1 px-2">
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
                        className="rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] font-medium transition hover:border-primary/50 hover:bg-primary/5"
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
                        className="flex h-5 items-center gap-0.5 rounded-md border border-emerald-500/40 bg-emerald-500/5 px-1 text-[9px] font-medium text-emerald-600/80 opacity-80 transition hover:bg-emerald-500/15 hover:opacity-100 dark:text-emerald-400/90"
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
              <div className="space-y-2 px-2">
                <div className="flex items-center gap-1.5">
                  <select
                    value={mobile.id}
                    onChange={e => setSpMobile(e.target.value)}
                    className="min-w-0 flex-1 cursor-pointer rounded-md border border-border/60 bg-card/60 px-1.5 py-1 font-mono text-[10px] text-foreground outline-none"
                    title="移动结构（被变换）"
                  >
                    {structures.filter(x => x.id !== ref.id).map(x => (
                      <option key={x.id} value={x.id}>{x.name.slice(0, 8)}</option>
                    ))}
                  </select>
                  <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span
                    className="min-w-0 flex-1 truncate rounded-md border border-primary/40 bg-primary/5 px-1.5 py-1 font-mono text-[10px] text-primary"
                    title={`参考结构（不动）：${ref.name}`}
                  >
                    {ref.name.slice(0, 8)}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <select
                    value={spMobChain}
                    onChange={e => setSpMobChain(e.target.value)}
                    className="cursor-pointer rounded-md border border-border/60 bg-card/60 px-1.5 py-1 text-[10px] text-foreground outline-none"
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
                    className="cursor-pointer rounded-md border border-border/60 bg-card/60 px-1.5 py-1 text-[10px] text-foreground outline-none"
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
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90"
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
