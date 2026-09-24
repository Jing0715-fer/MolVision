'use client'

// 信息面板：结构元数据、统计
import { FlaskConical, Info, Ruler, Tag, Dna, Droplets, Zap } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { useI18n, type DualText } from '@/i18n'
import { SectionTitle, PanelHint } from '../LeftPanel'

export function InfoPanel() {
  const { t } = useI18n()
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const st = structures.find(x => x.id === activeId)

  if (!st) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <Info className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">{t({ zh: '加载结构后在此查看详情。', en: 'Load a structure to see its details here.' })}</p>
      </div>
    )
  }

  const rows: { label: DualText; value: string | DualText }[] = [
    { label: { zh: '条目', en: 'Entry' }, value: st.meta.pdbId ?? st.name },
    { label: { zh: '格式', en: 'Format' }, value: st.format.toUpperCase() },
    ...(st.meta.method ? [{ label: { zh: '实验方法', en: 'Experimental method' } as DualText, value: st.meta.method }] : []),
    ...(st.meta.resolution ? [{ label: { zh: '分辨率', en: 'Resolution' } as DualText, value: `${st.meta.resolution} Å` }] : []),
    { label: { zh: '原子数', en: 'Atoms' }, value: st.summary.atoms.toLocaleString() },
    { label: { zh: '残基数', en: 'Residues' }, value: st.summary.residues.toLocaleString() },
    { label: { zh: '化学键', en: 'Bonds' }, value: st.summary.bonds.toLocaleString() },
    { label: { zh: '链数', en: 'Chains' }, value: String(st.summary.chains) },
    ...(st.summary.hydrogens > 0 ? [{ label: { zh: '氢原子', en: 'Hydrogens' } as DualText, value: st.summary.hydrogens.toLocaleString() }] : []),
    ...(st.summary.waters > 0 ? [{ label: { zh: '水分子', en: 'Waters' } as DualText, value: st.summary.waters.toLocaleString() }] : []),
    ...(st.summary.ligandResidues > 0 ? [{ label: { zh: '配体残基', en: 'Ligand residues' } as DualText, value: st.summary.ligandResidues.toLocaleString() }] : []),
    ...(st.summary.ligandMolecules > 0 ? [{ label: { zh: '配体分子', en: 'Ligand molecules' } as DualText, value: st.summary.ligandMolecules.toLocaleString() }] : []),
    { label: { zh: '二级结构', en: 'Secondary structure' }, value: st.hasSS ? { zh: '来自 HELIX/SHEET 注释', en: 'From HELIX/SHEET records' } : { zh: '几何启发式推断', en: 'Inferred geometrically' } },
    { label: { zh: '解析耗时', en: 'Parse time' }, value: `${st.loadMs < 1 ? '<1' : st.loadMs.toFixed(0)} ms` },
  ]

  return (
    <div className="pb-4">
      <SectionTitle>{t({ zh: '结构信息', en: 'Structure info' })}</SectionTitle>
      <div className="panel-card mx-2 p-3">
        <h4 className="text-xs font-semibold leading-snug">{st.meta.title || st.name}</h4>
        <div className="mt-2.5 space-y-1 tabular-nums">
          {rows.map(r => (
            <div key={r.label.zh} className="flex items-baseline justify-between gap-3 text-[11px]">
              <span className="shrink-0 text-muted-foreground">{t(r.label)}</span>
              <span className="truncate text-right font-mono font-medium">{t(r.value)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 图例 */}
      <SectionTitle>{t({ zh: '元素配色（CPK）', en: 'Element colors (CPK)' })}</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5 px-3">
        {[['C', '#909090'], ['N', '#3050f8'], ['O', '#ff0d0d'], ['S', '#ffff30'], ['P', '#ff8000'], ['H', '#f0f0f0'], ['Fe', '#e06633'], ['Zn', '#7d80b0'], ['Mg', '#8aff00']].map(([el, c]) => (
          <div key={el} className="flex items-center gap-1.5 rounded-md border border-border px-1.5 py-1">
            <span className="h-3 w-3 rounded-full border border-black/10 shadow-xs" style={{ background: c }} />
            <span className="font-mono text-[10px] font-semibold">{el}</span>
          </div>
        ))}
      </div>

      <SectionTitle>{t({ zh: '链构成', en: 'Chain composition' })}</SectionTitle>
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
              {c.type === 'protein' ? t({ zh: '蛋白质', en: 'Protein' }) : c.type === 'nucleic' ? t({ zh: '核酸', en: 'Nucleic acid' }) : c.type === 'water' ? t({ zh: '水', en: 'Water' }) : t({ zh: '配体', en: 'Ligand' })}
            </span>
            <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/70">{c.residues} res · {c.atoms} at</span>
          </div>
        ))}
        {st.chains.length > 12 && (
          <p className="text-[10px] tabular-nums text-muted-foreground">{t({ zh: `…共 ${st.chains.length} 条链`, en: `…${st.chains.length} chains in total` })}</p>
        )}
      </div>

      <PanelHint>
        <span className="flex items-center gap-1"><Ruler className="inline h-3 w-3" /> {t({ zh: '工具栏可测量距离/角度/二面角', en: 'Measure distances/angles/dihedrals from the toolbar' })}</span>
        <span className="mt-1 flex items-center gap-1"><Tag className="inline h-3 w-3" /> {t({ zh: '选中原子后按 L 添加标注', en: 'Select atoms, then press L to label them' })}</span>
        <span className="mt-1 flex items-center gap-1"><Zap className="inline h-3 w-3" /> {t({ zh: '按 ` 呼出命令行', en: 'Press ` to open the command line' })}</span>
      </PanelHint>
    </div>
  )
}
