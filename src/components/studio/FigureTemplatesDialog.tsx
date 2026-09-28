'use client'

// 论文图复现模板库对话框（r71 · r75 增加原文图式对比视图）
// ─────────────────────────────────────────────────────────────────────────────
// 「把 CNS 级别作图带给每个结构」：网格卡片 = 引擎真实渲染缩略图 + 图式说明 +
// 真实文献参考（期刊/年份/DOI 溯源链接）。三动作：
//  · 点卡片主体 → 应用到当前结构（命令序列逐条执行，历史面板可重放）
//  · 卡片右上「演示」→ 加载代表结构再应用（100% 复现缩略图取材路径）
//  · 卡片右下「对比」→ 原文图式对比视图（r75）：左 = 本引擎渲染缩略图，
//    右 = 原文图式解剖卡（图版位置 + 原图内容 + 配方逐步分解 + DOI 直达原图）
//    ——版权诚实：不存原图，对比的是「图式配方」；DOI 链到出版社原文对照
// 无结构时应用动作给引导 toast（或直接走演示）。
// 缩略图管线：public/templates/{id}.png 由引擎渲染生成（r71/r72 E2E 批量管线）；
// 缺图时以强调色渐变占位，文件生成后无需改码自动浮现。
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft, Atom, BookOpenText, Boxes, Camera, CircleDot, Component, Dna, ExternalLink, Film,
  Gauge, Gem, GitCompareArrows, Grid3x3, Hexagon, Layers, Link2, Loader2, Magnet, MapPin, Network, Palette,
  Play, Shapes, Sparkles, Target, Waves, Wand2, Cylinder, Zap, type LucideIcon,
} from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { useI18n, tt } from '@/i18n'
import {
  demoThenApply, explainCommand, FIGURE_CATEGORIES, FIGURE_TEMPLATES, runTemplateCommands,
  adaptTemplateCommands, logAdaptNotes,
  type FigureCategory, type FigureTemplate,
} from '@/lib/molecular/figure-templates'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** 强调色 → Tailwind 装饰类映射（卡片占位渐变 / hover 边框 / 序号色）。
 *  r74 导出：欢迎页模板画廊（WelcomeScreen）同源复用——十二色系一致 */
export const ACCENT: Record<FigureTemplate['accent'], { grad: string; border: string; text: string; chip: string }> = {
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

/** 每模板专属图标（卡片差异化第二层：配色之外再给一个可扫读的形状记号）。
 *  r74 导出：欢迎页模板画廊同源复用 */
export const TPL_ICONS: Record<string, LucideIcon> = {
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
  // r75 新增五模板（互作分析三 + 通用两）：Zap（静电）/ Magnet（氢键吸引）/
  // Dna / Component（域块）/ MapPin（热点定位）
  'salt-bridge-network': Zap,
  'hbond-network': Magnet,
  'dna-protein-complex': Dna,
  'domain-coloring': Component,
  'mutation-hotspots': MapPin,
  // r76 位点特写两新模板：Link2（共价交联）/ Atom（金属离子）
  'disulfide-bonds': Link2,
  'metal-center': Atom,
  // r77 四新模板：Shapes（全原子球堆积）/ Gauge（B 因子仪表）/ Gem（辅因子宝石）/ Sparkles（π 电子云）
  'cpk-spacefill': Shapes,
  'mobility-bfactor': Gauge,
  'heme-pocket': Gem,
  'cation-pi': Sparkles,
}

function TemplateCard({ tpl, index, onApply, onDemo, onCompare, busy }: {
  tpl: FigureTemplate
  index: number
  onApply: () => void
  onDemo: () => void
  onCompare: () => void
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
            decoding="async"
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
            'absolute right-2 top-2 flex h-7 items-center gap-1 rounded-full border border-border bg-background/85 px-2.5 text-[10px] font-semibold backdrop-blur-sm transition-opacity duration-200 cursor-pointer',
            'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
            busy && 'pointer-events-none opacity-60',
          )}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          {t({ zh: '演示', en: 'Demo' })}
        </span>
        {/* 对比按钮（r75：原文图式对比视图——hover 浮现；触屏恒显；与演示钮镜像排布） */}
        <span
          role="button"
          tabIndex={0}
          onClick={e => { e.stopPropagation(); onCompare() }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onCompare() } }}
          title={t({ zh: '与原论文图式对比（左渲染右解剖）', en: 'Compare with the original paper figure style' })}
          className={cn(
            'absolute bottom-2 right-2 flex h-7 cursor-pointer items-center gap-1 rounded-full border border-border bg-background/85 px-2.5 text-[10px] font-semibold backdrop-blur-sm transition-opacity duration-200',
            'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
          )}
        >
          <GitCompareArrows className="h-3 w-3" aria-hidden />
          {t({ zh: '对比', en: 'Compare' })}
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

// ── r75：原文图式对比视图（左 = 本引擎真实渲染，右 = 原文图式解剖卡） ──────────
// 版权诚实架构：不保存任何论文原图——右侧是「图式解剖」（图版位置 + 原图内容 +
// 配方逐步分解 + DOI 直达出版社原文）；用户拿着解剖清单去原文对照，比存图更
// 有教学价值（知道每一步对应原图的哪个视觉元素）。
function ComparePanel({ tpl, onBack, onApply, onDemo, busy, hasStructure }: {
  tpl: FigureTemplate
  onBack: () => void
  onApply: () => void
  onDemo: () => void
  busy: boolean
  hasStructure: boolean
}) {
  const { t } = useI18n()
  const [imgOk, setImgOk] = useState(true)
  const a = ACCENT[tpl.accent]
  const Icon = TPL_ICONS[tpl.id] ?? BookOpenText
  const doiUrl = tpl.citation.doi ? `https://doi.org/${tpl.citation.doi}` : null
  // 配方解剖：命令 → 图鉴标签（未命中退回原命令 mono 展示——透明可查）
  const steps = tpl.commands.map(cmd => ({ cmd, label: explainCommand(cmd) }))

  return (
    <div data-template-compare className="flex flex-col gap-3">
      {/* 头：返回 + 模板名 + 标签 */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-7 cursor-pointer items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {t({ zh: '返回图库', en: 'Back to library' })}
        </button>
        <Icon className={cn('h-4 w-4 shrink-0', a.text)} aria-hidden />
        <span className="text-[13.5px] font-bold leading-none">{t(tpl.name)}</span>
        <span className="font-mono text-[9px] font-medium text-muted-foreground">{tpl.demo}</span>
        <span className={cn('ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em]', a.chip)}>
          {t({ zh: '图式对比', en: 'FIGURE COMPARE' })}
        </span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {/* 左：本引擎渲染（缩略图 + 动作排） */}
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
          <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted/40">
            {imgOk ? (
              <img
                src={`/templates/${tpl.id}.png`}
                alt={t(tpl.tagline)}
                loading="lazy"
                decoding="async"
                onError={() => setImgOk(false)}
                className="h-full w-full object-cover"
              />
            ) : (
              <span aria-hidden className={cn('absolute inset-0 flex items-center justify-center bg-gradient-to-br', a.grad)}>
                <BookOpenText className={cn('h-10 w-10 opacity-60', a.text)} />
              </span>
            )}
            <span className={cn('absolute left-2 top-2 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em]', a.chip)}>
              {t({ zh: '本引擎渲染', en: 'ENGINE RENDER' })}
            </span>
          </div>
          <div className="flex items-center gap-2 border-t border-border/70 p-2.5">
            <button
              type="button"
              onClick={onDemo}
              disabled={busy}
              className="flex h-7 cursor-pointer items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 text-[11px] font-semibold transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {t({ zh: '演示', en: 'Demo' })} {tpl.demo}
            </button>
            <button
              type="button"
              onClick={onApply}
              disabled={busy || !hasStructure}
              title={hasStructure ? undefined : t({ zh: '先加载一个结构再应用', en: 'Load a structure first' })}
              className="flex h-7 cursor-pointer items-center gap-1 rounded-full border border-primary/45 bg-primary/10 px-2.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15 disabled:pointer-events-none disabled:opacity-50"
            >
              <Wand2 className="h-3 w-3" aria-hidden />
              {t({ zh: '应用到当前结构', en: 'Apply to current' })}
            </button>
            <span className="ml-auto font-mono text-[9px] font-semibold text-muted-foreground">
              {tpl.commands.length} {t({ zh: '条命令', en: 'cmds' })}
            </span>
          </div>
        </div>

        {/* 右：原文图式解剖卡 */}
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
          {/* 文献块 */}
          <div className="border-b border-border/70 p-3">
            <div className="flex items-center gap-1.5">
              <GitCompareArrows className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              <span className="text-[11.5px] font-bold leading-none">{t({ zh: '原论文图式', en: 'Original paper figure' })}</span>
              {tpl.figure?.ref && (
                <span className="ml-auto rounded bg-foreground/[0.06] px-1.5 py-px font-mono text-[9px] font-semibold text-foreground/70">
                  {tpl.figure.ref}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-foreground/85">
              <span className="font-semibold">{tpl.citation.journal} {tpl.citation.year}</span>
              <span className="text-muted-foreground"> · {tpl.citation.title}</span>
            </p>
            {tpl.figure && (
              <p className="mt-1.5 rounded bg-muted/50 px-2 py-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
                {t({ zh: '原图展示：', en: 'The figure shows: ' })}
                {t(tpl.figure.shows)}
              </p>
            )}
          </div>
          {/* 配方解剖（命令图鉴逐步分解——本栏即「对照清单」） */}
          <div className="mol-scroll min-h-0 flex-1 overflow-y-auto p-3">
            <span className="mol-micro text-muted-foreground">{t({ zh: '图式配方 · 逐步分解', en: 'STYLE RECIPE · STEP BY STEP' })}</span>
            <ol className="mt-2 flex flex-col gap-1">
              {steps.map((s, i) => (
                <li key={i} className="flex items-baseline gap-2" title={s.cmd}>
                  <span className="font-mono text-[9px] font-bold tabular-nums text-muted-foreground/70">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-[11px] leading-snug">{s.label ? t(s.label) : <span className="font-mono text-[10px] text-muted-foreground">{s.cmd}</span>}</span>
                </li>
              ))}
            </ol>
          </div>
          {/* DOI 直达原图 */}
          <div className="border-t border-border/70 p-2.5">
            {doiUrl ? (
              <a
                href={doiUrl}
                target="_blank"
                rel="noreferrer"
                title={tpl.citation.title}
                className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/[0.08] text-[11.5px] font-semibold text-primary transition-colors hover:bg-primary/15"
              >
                {t({ zh: '在原文中查看原图', en: 'View the original figure' })}
                <ExternalLink className="h-3 w-3" aria-hidden />
                <span className="font-mono text-[9px] font-normal opacity-70">doi.org/{tpl.citation.doi}</span>
              </a>
            ) : (
              <p className="text-center text-[10px] text-muted-foreground">{t({ zh: '本文无 DOI 链接——可按标题检索原文对照', en: 'No DOI link — search the title to find the original' })}</p>
            )}
          </div>
        </div>
      </div>

      {/* 诚实差异说明 */}
      <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
        <Wand2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        {t({
          zh: '左侧为 MolVision 引擎对演示结构的单视口实时渲染（缩略图管线产物）；原图的多面板排版、字体、标注与像素细节不在图式配方范围内——上列逐步分解即对照清单，点 DOI 可携清单到出版社原文逐项核对。',
          en: 'Left: a single-viewport live render of the demo structure by the MolVision engine (thumbnail pipeline output). Multi-panel layout, typography, annotations and pixel detail of the original are outside the style recipe — the step list above is your checklist; open the DOI to check each item against the publisher original.',
        })}
      </p>
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
  // r75：对比视图状态（非空 = 对比模式，替换网格与过滤 chips）；
  // 弹窗关闭时重置回图库（重开落在网格而非残留对比页——库的浏览语义）
  const [compareId, setCompareId] = useState<string | null>(null)
  useEffect(() => { if (!open) setCompareId(null) }, [open])
  const compareTpl = FIGURE_TEMPLATES.find(x => x.id === compareId) ?? null
  const shown = filter === 'all' ? FIGURE_TEMPLATES : FIGURE_TEMPLATES.filter(x => x.category === filter)

  const apply = (tpl: FigureTemplate) => {
    if (!hasStructure) {
      toast.info(tt({
        zh: '当前没有结构——点卡片右上「演示」加载代表结构，或先加载你自己的结构',
        en: 'No structure loaded — use the "Demo" button on a card to load the showcase structure, or load your own first',
      }))
      return
    }
    // r73：应用前结构特征探测——链重映射/密度图来源切换/无配体降级/无晶胞跳过（诚实降级入日志）
    const { commands, notes } = adaptTemplateCommands(tpl)
    runTemplateCommands(commands)
    logAdaptNotes(notes)
    toast.success(tt({ zh: `已应用「${t(tpl.name)}」`, en: `Applied "${t(tpl.name)}"` }), {
      description: tt({
        zh: `${commands.length} 条命令已执行${notes.length ? ` · 智能适配 ${notes.length} 项` : ''} · 主体 ${activeName ?? ''} · 可在历史面板重放`,
        en: `${commands.length} commands executed${notes.length ? ` · ${notes.length} smart adaptation${notes.length === 1 ? '' : 's'}` : ''} on ${activeName ?? ''} — replayable from the history panel`,
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
              zh: 'Cell / Nature / Science 结构文章的经典图式 + 互作分析（盐桥/氢键/DNA/阳离子-π）+ 位点特写（辅因子/金属/二硫键）+ 特定类型分析图（离子通道孔道等）——一键应用，命令透明可改，可对照原文图式',
              en: 'Classic figure styles from Cell / Nature / Science papers + interaction analysis (salt bridges / H-bonds / DNA / cation–π) + site close-ups (cofactors / metals / disulfides) + type-specific figures (ion-channel pores etc.) — one click; transparent recipes, comparable against the originals',
            })}
          </DialogDescription>
        </DialogHeader>

        {compareTpl ? (
          /* r75：原文图式对比视图（左引擎渲染/右解剖卡 + DOI 直达原图） */
          <ComparePanel
            tpl={compareTpl}
            onBack={() => setCompareId(null)}
            onApply={() => apply(compareTpl)}
            onDemo={() => void demo(compareTpl)}
            busy={busyId === compareTpl.id || loading}
            hasStructure={hasStructure}
          />
        ) : (
          <>
            {/* 分类过滤 chips（通用 / 互作分析 / 膜蛋白·通道） */}
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
                    onCompare={() => setCompareId(tpl.id)}
                  />
                ))}
              </div>
            </div>

            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
              <Wand2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {t({
                zh: '模板复现的是图式视觉配方（表示法·配色·视角·灯光·轮廓）与分析命令（孔道剖面/脂双层/盐桥/氢键），不含论文原图；卡片缩略图由 MolVision 引擎对代表结构真实渲染。点卡片右下「对比」可与原论文图式逐项对照。',
                en: 'Templates reproduce figure-style recipes (representations · coloring · camera · lighting · outlines) and analysis commands (pore profiles / bilayers / salt bridges / H-bonds), not original artwork; card thumbnails are genuine engine renders. Use "Compare" on a card to check the recipe against the original paper figure.',
              })}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
