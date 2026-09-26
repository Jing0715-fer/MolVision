'use client'

// 论文图复现模板库对话框（r71）
// ─────────────────────────────────────────────────────────────────────────────
// 「把 CNS 级别作图带给每个结构」：网格卡片 = 引擎真实渲染缩略图 + 图式说明 +
// 真实文献参考（期刊/年份/DOI 溯源链接）。两动作：
//  · 点卡片主体 → 应用到当前结构（命令序列逐条执行，历史面板可重放）
//  · 卡片右上「演示」→ 加载代表结构再应用（100% 复现缩略图的取材路径）
// 无结构时应用动作给引导 toast（或直接走演示）。
// 缩略图管线：public/templates/{id}.png 由引擎渲染生成（r71 E2E 批量管线）；
// 缺图时以强调色渐变占位，文件生成后无需改码自动浮现。
import { useState } from 'react'
import { toast } from 'sonner'
import {
  BookOpenText, Boxes, Camera, CircleDot, ExternalLink, Film, Grid3x3, Hexagon,
  Layers, Loader2, Network, Palette, Play, Target, Waves, Wand2, Cylinder, type LucideIcon,
} from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { useI18n, tt } from '@/i18n'
import {
  demoThenApply, FIGURE_CATEGORIES, FIGURE_TEMPLATES, runTemplateCommands,
  type FigureCategory, type FigureTemplate,
} from '@/lib/molecular/figure-templates'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** 强调色 → Tailwind 装饰类映射（卡片占位渐变 / hover 边框 / 序号色） */
const ACCENT: Record<FigureTemplate['accent'], { grad: string; border: string; text: string; chip: string }> = {
  rose: { grad: 'from-rose-500/25 via-rose-500/10 to-transparent', border: 'hover:border-rose-500/50', text: 'text-rose-500', chip: 'bg-rose-500/12 text-rose-600 dark:text-rose-400' },
  emerald: { grad: 'from-emerald-500/25 via-emerald-500/10 to-transparent', border: 'hover:border-emerald-500/50', text: 'text-emerald-500', chip: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400' },
  amber: { grad: 'from-amber-500/25 via-amber-500/10 to-transparent', border: 'hover:border-amber-500/50', text: 'text-amber-500', chip: 'bg-amber-500/12 text-amber-600 dark:text-amber-400' },
  sky: { grad: 'from-sky-500/25 via-sky-500/10 to-transparent', border: 'hover:border-sky-500/50', text: 'text-sky-500', chip: 'bg-sky-500/12 text-sky-600 dark:text-sky-400' },
  violet: { grad: 'from-violet-500/25 via-violet-500/10 to-transparent', border: 'hover:border-violet-500/50', text: 'text-violet-500', chip: 'bg-violet-500/12 text-violet-600 dark:text-violet-400' },
  teal: { grad: 'from-teal-500/25 via-teal-500/10 to-transparent', border: 'hover:border-teal-500/50', text: 'text-teal-500', chip: 'bg-teal-500/12 text-teal-600 dark:text-teal-400' },
  orange: { grad: 'from-orange-500/25 via-orange-500/10 to-transparent', border: 'hover:border-orange-500/50', text: 'text-orange-500', chip: 'bg-orange-500/12 text-orange-600 dark:text-orange-400' },
  fuchsia: { grad: 'from-fuchsia-500/25 via-fuchsia-500/10 to-transparent', border: 'hover:border-fuchsia-500/50', text: 'text-fuchsia-500', chip: 'bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400' },
  cyan: { grad: 'from-cyan-500/25 via-cyan-500/10 to-transparent', border: 'hover:border-cyan-500/50', text: 'text-cyan-500', chip: 'bg-cyan-500/12 text-cyan-600 dark:text-cyan-400' },
  lime: { grad: 'from-lime-500/25 via-lime-500/10 to-transparent', border: 'hover:border-lime-500/50', text: 'text-lime-500', chip: 'bg-lime-500/12 text-lime-600 dark:text-lime-400' },
  slate: { grad: 'from-slate-500/25 via-slate-500/10 to-transparent', border: 'hover:border-slate-500/50', text: 'text-slate-500', chip: 'bg-slate-500/12 text-slate-600 dark:text-slate-400' },
}

/** 每模板专属图标（卡片差异化第二层：配色之外再给一个可扫读的形状记号） */
const TPL_ICONS: Record<string, LucideIcon> = {
  'rainbow-overview': Palette,
  'chain-assembly': Boxes,
  'ss-motif': Waves,
  'ligand-pocket': Target,
  'sasa-surface': CircleDot,
  'density-map': Grid3x3,
  'interface-contacts': Network,
  'symmetry-assembly': Hexagon,
  'ensemble-dynamics': Film,
  'publication-ready': Camera,
  'pore-analysis': Cylinder,
  'membrane-embed': Layers,
}

function TemplateCard({ tpl, index, onApply, onDemo, busy }: {
  tpl: FigureTemplate
  index: number
  onApply: () => void
  onDemo: () => void
  busy: boolean
}) {
  const { t } = useI18n()
  const [imgOk, setImgOk] = useState(true)
  const a = ACCENT[tpl.accent]
  const Icon = TPL_ICONS[tpl.id] ?? BookOpenText
  const doiUrl = tpl.citation.doi ? `https://doi.org/${tpl.citation.doi}` : null

  return (
    <div
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-[border-color,transform,box-shadow] duration-200',
        a.border, 'hover:-translate-y-0.5 hover:shadow-[0_6px_20px_oklch(0.25_0.01_80/0.12)] dark:hover:shadow-[0_6px_20px_oklch(0_0_0/0.4)]',
      )}
    >
      {/* 缩略图（引擎真实渲染产物；缺图渐变占位） */}
      <button
        type="button"
        onClick={onApply}
        disabled={busy}
        title={t({ zh: `应用到当前结构（演示请用 ▶ 按钮）`, en: `Apply to the current structure (use ▶ for a demo)` })}
        className="relative block aspect-[16/10] w-full cursor-pointer overflow-hidden bg-muted/40 disabled:pointer-events-none disabled:opacity-60"
      >
        {imgOk ? (
          // 静态资源缩略图（管线产物，非内容图）；next/image 对 public 静态占位无增益
          <img
            src={`/templates/${tpl.id}.png`}
            alt={t(tpl.tagline)}
            loading="lazy"
            onError={() => setImgOk(false)}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <span aria-hidden className={cn('absolute inset-0 flex items-center justify-center bg-gradient-to-br', a.grad)}>
            <BookOpenText className={cn('h-8 w-8 opacity-60', a.text)} />
          </span>
        )}
        {/* 序号角标（仪器簇编号惯例） */}
        <span className={cn('absolute left-2 top-2 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em]', a.chip)}>
          {String(index + 1).padStart(2, '0')}
        </span>
        {/* 演示按钮（hover 浮现；触屏恒显） */}
        <span
          role="button"
          tabIndex={0}
          onClick={e => { e.stopPropagation(); onDemo() }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onDemo() } }}
          title={t({ zh: `加载演示结构 ${tpl.demo} 并应用`, en: `Load demo structure ${tpl.demo} and apply` })}
          className={cn(
            'absolute right-2 top-2 flex h-7 items-center gap-1 rounded-full border border-border bg-background/85 px-2.5 text-[10px] font-semibold backdrop-blur-sm transition-opacity duration-200',
            'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {t({ zh: '演示', en: 'Demo' })}
        </span>
      </button>

      {/* 正文 */}
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <button type="button" onClick={onApply} disabled={busy} className="cursor-pointer text-left disabled:pointer-events-none">
          <span className="flex items-center gap-1.5">
            <Icon className={cn('h-3.5 w-3.5 shrink-0', a.text)} aria-hidden />
            <span className="text-[13px] font-semibold leading-tight">{t(tpl.name)}</span>
            <span className="font-mono text-[9px] font-medium text-muted-foreground">{tpl.demo}</span>
          </span>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t(tpl.tagline)}</p>
        </button>
        <div className="mt-auto flex flex-wrap items-center gap-1">
          {tpl.tags.map((tag, i) => (
            <span key={i} className={cn('rounded px-1.5 py-px text-[9.5px] font-semibold', a.chip)}>{t(tag)}</span>
          ))}
          {tpl.category === 'membrane' && (
            <span className="rounded bg-foreground/[0.06] px-1.5 py-px text-[9.5px] font-semibold text-foreground/70">{t({ zh: '特定类型', en: 'Type-specific' })}</span>
          )}
          <span className="ml-auto text-[9.5px] text-muted-foreground">{t(tpl.purpose)}</span>
        </div>
      </div>

      {/* 文献参考行（可溯源；无 DOI 时仅展示） */}
      <div className="flex items-center gap-1.5 border-t border-border/70 px-3 py-1.5">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', a.text.replace('text-', 'bg-'))} aria-hidden />
        <span className="truncate text-[9.5px] text-muted-foreground">
          {t({ zh: '图式参考', en: 'Style ref.' })} · {tpl.citation.journal} {tpl.citation.year}
        </span>
        {doiUrl && (
          <a
            href={doiUrl}
            target="_blank"
            rel="noreferrer"
            title={tpl.citation.title}
            className="ml-auto flex shrink-0 items-center gap-0.5 text-[9.5px] font-medium text-primary hover:underline"
          >
            DOI <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
      </div>
    </div>
  )
}

export function FigureTemplatesDialog() {
  const { t } = useI18n()
  const open = useMolStore(s => s.ui.templateOpen)
  const setUi = useMolStore(s => s.setUi)
  const loading = useMolStore(s => s.loading)
  const hasStructure = useMolStore(s => s.structures.length > 0)
  const activeName = useMolStore(s => s.structures.find(x => x.id === s.activeId)?.name)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FigureCategory | 'all'>('all')
  const shown = filter === 'all' ? FIGURE_TEMPLATES : FIGURE_TEMPLATES.filter(x => x.category === filter)

  const apply = (tpl: FigureTemplate) => {
    if (!hasStructure) {
      toast.info(tt({
        zh: '当前没有结构——点卡片右上「演示」加载代表结构，或先加载你自己的结构',
        en: 'No structure loaded — use the "Demo" button on a card to load the showcase structure, or load your own first',
      }))
      return
    }
    runTemplateCommands(tpl.commands)
    toast.success(tt({ zh: `已应用「${t(tpl.name)}」`, en: `Applied "${t(tpl.name)}"` }), {
      description: tt({
        zh: `${tpl.commands.length} 条命令已执行 · 主体 ${activeName ?? ''} · 可在历史面板重放`,
        en: `${tpl.commands.length} commands executed on ${activeName ?? ''} — replayable from the history panel`,
      }),
    })
  }

  const demo = async (tpl: FigureTemplate) => {
    setBusyId(tpl.id)
    try {
      await demoThenApply(tpl)
      toast.success(tt({ zh: `演示就绪：「${t(tpl.name)}」on ${tpl.demo}`, en: `Demo ready: "${t(tpl.name)}" on ${tpl.demo}` }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => setUi({ templateOpen: v })}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpenText className="h-4 w-4 text-primary" />
            {t({ zh: '论文图复现模板', en: 'Paper-figure templates' })}
          </DialogTitle>
          <DialogDescription>
            {t({
              zh: 'Cell / Nature / Science 结构文章的经典图式 + 特定蛋白类型分析图（离子通道孔道等）——一键应用，命令序列透明可改',
              en: 'Classic figure styles from Cell / Nature / Science structure papers + type-specific analysis figures (ion-channel pores etc.) — one click; transparent, editable recipes',
            })}
          </DialogDescription>
        </DialogHeader>

        {/* 分类过滤 chips（通用图式 vs 膜蛋白·通道分析） */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t({ zh: '模板分类', en: 'Template categories' })}>
          {FIGURE_CATEGORIES.map(c => {
            const n = c.key === 'all' ? FIGURE_TEMPLATES.length : FIGURE_TEMPLATES.filter(x => x.category === c.key).length
            const active = filter === c.key
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setFilter(c.key)}
                aria-pressed={active}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer',
                  active
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {t(c.label)}
                <span className="ml-1 font-mono text-[9px] opacity-70">{n}</span>
              </button>
            )
          })}
        </div>

        <div className="mol-scroll -mx-1 max-h-[62vh] overflow-y-auto px-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {shown.map(tpl => (
              <TemplateCard
                key={tpl.id}
                tpl={tpl}
                index={FIGURE_TEMPLATES.indexOf(tpl)}
                busy={busyId === tpl.id || loading}
                onApply={() => apply(tpl)}
                onDemo={() => void demo(tpl)}
              />
            ))}
          </div>
        </div>

        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
          <Wand2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {t({
            zh: '模板复现的是图式视觉配方（表示法·配色·视角·灯光·轮廓）与分析命令（孔道剖面/脂双层），不含论文原图；卡片缩略图由 MolVision 引擎对代表结构真实渲染。配体口袋等模板建议在含辅基的结构上使用；孔道/膜板适用于离子通道与膜蛋白。',
            en: 'Templates reproduce figure-style recipes (representations · coloring · camera · lighting · outlines) and analysis commands (pore profiles / bilayers), not original artwork; card thumbnails are genuine engine renders. Pocket-style templates work best on structures with cofactors; pore / membrane templates suit ion channels and membrane proteins.',
          })}
        </p>
      </DialogContent>
    </Dialog>
  )
}
