'use client'

// 结构面板：结构列表、链、配体、叠合
import { Eye, EyeOff, Trash2, Boxes, Droplets, FlaskConical, Dna, TestTube, Combine } from 'lucide-react'
import { toast } from 'sonner'
import { engineRef, useMolStore } from '@/lib/molecular/store'
import { cn } from '@/lib/utils'
import { SectionTitle, PanelHint } from '../LeftPanel'
import { Badge } from '@/components/ui/badge'

const CHAIN_TYPE_ICON: Record<string, typeof Dna> = {
  protein: Dna, nucleic: Dna, water: Droplets, ligand: FlaskConical,
}
const CHAIN_TYPE_LABEL: Record<string, string> = {
  protein: '蛋白质', nucleic: '核酸', water: '水', ligand: '配体',
}

export function StructuresPanel() {
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const setActive = useMolStore(s => s.setActive)
  const setStructureVisible = useMolStore(s => s.setStructureVisible)
  const removeStructure = useMolStore(s => s.removeStructure)
  const setUi = useMolStore(s => s.setUi)

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
      <SectionTitle>已加载结构 ({structures.length})</SectionTitle>
      <div className="space-y-1.5 px-2">
        {structures.map(st => (
          <div
            key={st.id}
            className={cn(
              'group rounded-lg border p-2.5 transition',
              st.id === activeId ? 'border-primary/50 bg-primary/5' : 'border-border/60 hover:border-border',
            )}
          >
            <div className="flex items-center gap-2">
              <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setActive(st.id)}>
                <span className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wide',
                  st.id === activeId ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground/80',
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
              <button
                onClick={() => setStructureVisible(st.id, !st.visible)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
                title={st.visible ? '隐藏' : '显示'}
              >
                {st.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => { removeStructure(st.id); toast.success(`已移除 ${st.name}`) }}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                title="移除"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-normal">
                {st.summary.atoms.toLocaleString()} 原子
              </Badge>
              <Badge variant="secondary" className="px-1.5 py-0 text-[9px] font-normal">
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
        return (
          <>
            <SectionTitle>链 ({st.chains.length})</SectionTitle>
            <div className="mol-scroll max-h-56 space-y-0.5 overflow-y-auto px-2">
              {st.chains.map((c, i) => {
                const Icon = CHAIN_TYPE_ICON[c.type] ?? TestTube
                return (
                  <button
                    key={`${c.id}-${i}`}
                    onClick={() => {
                      const store = useMolStore.getState()
                      const res = store.selectFromExpr(`chain ${JSON.stringify(c.id)}`)
                      if (res.error) toast.error(res.error)
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition hover:bg-accent"
                  >
                    <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="w-6 shrink-0 font-mono text-xs font-bold">{c.id === ' ' ? '—' : c.id}</span>
                    <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 text-[10px] text-muted-foreground">{CHAIN_TYPE_LABEL[c.type]}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70">
                      {c.residues > 0 && `${c.residues} res`}
                    </span>
                  </button>
                )
              })}
            </div>

            {st.ligands.length > 0 && (
              <>
                <SectionTitle right={
                  <span className="text-[10px] text-muted-foreground">{st.ligands.length} 种</span>
                }>
                  <span className="flex items-center gap-1">
                    <FlaskConical className="h-3 w-3" /> 配体
                  </span>
                </SectionTitle>
                <div className="flex flex-wrap gap-1 px-2">
                  {st.ligands.slice(0, 24).map(lg => (
                    <button
                      key={lg.resName}
                      onClick={() => {
                        const store = useMolStore.getState()
                        const res = store.selectFromExpr(`resn ${lg.resName}`)
                        if (!res.error && res.count > 0) {
                          engineRef.current?.fitView([{ structureId: st.id, indices: useMolStore.getState().selection.indices }])
                        }
                      }}
                      className="rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[10px] font-medium transition hover:border-primary/50 hover:bg-primary/5"
                      title={`选择全部 ${lg.resName}（链 ${lg.chainIds}）`}
                    >
                      {lg.resName}
                      {lg.count > 1 && <span className="ml-0.5 text-muted-foreground">×{lg.count}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )
      })()}
      <PanelHint>点击链/配体可选择并聚焦；结构卡片点击切换活动结构；{structures.length >= 2 ? '⧉ 按钮将此结构叠合到活动结构（superpose）。' : ''}</PanelHint>
    </div>
  )
}
