'use client'

// 信息面板：结构元数据、统计
import { FlaskConical, Info, Ruler, Tag, Dna, Droplets, Zap } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { SectionTitle, PanelHint } from '../LeftPanel'

export function InfoPanel() {
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const st = structures.find(x => x.id === activeId)

  if (!st) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <Info className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">加载结构后在此查看详情。</p>
      </div>
    )
  }

  const rows: { label: string; value: string }[] = [
    { label: '条目', value: st.meta.pdbId ?? st.name },
    { label: '格式', value: st.format.toUpperCase() },
    ...(st.meta.method ? [{ label: '实验方法', value: st.meta.method }] : []),
    ...(st.meta.resolution ? [{ label: '分辨率', value: `${st.meta.resolution} Å` }] : []),
    { label: '原子数', value: st.summary.atoms.toLocaleString() },
    { label: '残基数', value: st.summary.residues.toLocaleString() },
    { label: '化学键', value: st.summary.bonds.toLocaleString() },
    { label: '链数', value: String(st.summary.chains) },
    ...(st.summary.hydrogens > 0 ? [{ label: '氢原子', value: st.summary.hydrogens.toLocaleString() }] : []),
    ...(st.summary.waters > 0 ? [{ label: '水分子', value: st.summary.waters.toLocaleString() }] : []),
    ...(st.summary.ligandResidues > 0 ? [{ label: '配体残基', value: st.summary.ligandResidues.toLocaleString() }] : []),
    { label: '二级结构', value: st.hasSS ? '来自 HELIX/SHEET 注释' : '几何启发式推断' },
    { label: '解析耗时', value: `${st.loadMs < 1 ? '<1' : st.loadMs.toFixed(0)} ms` },
  ]

  return (
    <div className="pb-4">
      <SectionTitle>结构信息</SectionTitle>
      <div className="mx-2 rounded-lg border border-border/60 bg-gradient-to-b from-background/80 to-transparent p-3">
        <h4 className="text-xs font-semibold leading-snug">{st.meta.title || st.name}</h4>
        <div className="mt-2.5 space-y-1">
          {rows.map(r => (
            <div key={r.label} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="shrink-0 text-muted-foreground">{r.label}</span>
              <span className="truncate text-right font-mono font-medium">{r.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 图例 */}
      <SectionTitle>元素配色（CPK）</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5 px-3">
        {[['C', '#909090'], ['N', '#3050f8'], ['O', '#ff0d0d'], ['S', '#ffff30'], ['P', '#ff8000'], ['H', '#f0f0f0'], ['Fe', '#e06633'], ['Zn', '#7d80b0'], ['Mg', '#8aff00']].map(([el, c]) => (
          <div key={el} className="flex items-center gap-1.5 rounded-md border border-border/50 px-1.5 py-1">
            <span className="h-3 w-3 rounded-full border border-black/10 shadow-sm" style={{ background: c }} />
            <span className="font-mono text-[10px] font-semibold">{el}</span>
          </div>
        ))}
      </div>

      <SectionTitle>链构成</SectionTitle>
      <div className="space-y-1 px-3">
        {st.chains.slice(0, 12).map((c, i) => (
          <div key={`${c.id}-${i}`} className="flex items-center gap-2 text-[11px]">
            <span className="h-3 w-1 rounded-full" style={{ background: c.color }} />
            <span className="w-5 font-mono font-bold">{c.id === ' ' ? '—' : c.id}</span>
            <span className="flex items-center gap-1 text-muted-foreground">
              {c.type === 'protein' && <Dna className="h-3 w-3" />}
              {c.type === 'water' && <Droplets className="h-3 w-3" />}
              {c.type === 'ligand' && <FlaskConical className="h-3 w-3" />}
              {c.type === 'nucleic' && <Dna className="h-3 w-3" />}
              {c.type === 'protein' ? '蛋白质' : c.type === 'nucleic' ? '核酸' : c.type === 'water' ? '水' : '配体'}
            </span>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground/70">{c.residues} res · {c.atoms} at</span>
          </div>
        ))}
        {st.chains.length > 12 && (
          <p className="text-[10px] text-muted-foreground">…共 {st.chains.length} 条链</p>
        )}
      </div>

      <PanelHint>
        <span className="flex items-center gap-1"><Ruler className="inline h-3 w-3" /> 工具栏可测量距离/角度/二面角</span>
        <span className="mt-1 flex items-center gap-1"><Tag className="inline h-3 w-3" /> 选中原子后按 L 添加标注</span>
        <span className="mt-1 flex items-center gap-1"><Zap className="inline h-3 w-3" /> 按 ` 呼出命令行</span>
      </PanelHint>
    </div>
  )
}
