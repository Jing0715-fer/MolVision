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
// r82：UGC 三件套补齐「编辑」（卡片编辑钮 → 复用审核表单预填 → 保存即更新，
// 命令重过闸）+ 导入导出 JSON（跨设备迁移/团队共享——命令序列天然可移植）。
// 缩略图管线：public/templates/{id}.png 由引擎渲染生成（r71/r72 E2E 批量管线）；
// 缺图时以强调色渐变占位，文件生成后无需改码自动浮现。
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft, Aperture, Atom, BookOpenText, Boxes, Camera, Candy, CircleDot, Component, Contrast, Disc, Dna, Download, Drama, ExternalLink, Fingerprint, Film,
  FlaskConical, Gauge, Gem, Ghost, GitCompareArrows, Glasses, GraduationCap, Grid3x3, Hexagon, History, ImagePlus, Layers, Lightbulb, Link2, Loader2, Magnet, MapPin, Moon, Network, Orbit, Paintbrush, Palette,
  Pencil, Play, Ruler, ScanSearch, Scissors, Shapes, Shield, Sparkles, Spline, SunDim, SwatchBook, Target, Torus, Trash2, Upload, Waves, Wand2, Waypoints, Cylinder, Droplets, Box, Zap, Check, XCircle, type LucideIcon,
} from 'lucide-react'
import { useMolStore, engineRef } from '@/lib/molecular/store'
import { useI18n, tt, type DualText } from '@/i18n'
import {
  demoThenApply, explainCommand, FIGURE_CATEGORIES, FIGURE_TEMPLATES, runTemplateCommands,
  adaptTemplateCommands, logAdaptNotes, isStructureInStore, waitForCameraIdle, waitForStructureInStore,
  type FigureCategory, type FigureTemplate,
} from '@/lib/molecular/figure-templates'
import { fetchPdbId } from '@/lib/molecular/loader'
import { whenEngineReady } from '@/lib/molecular/engine-ready'
import {
  addCustomTemplate, exportCustomTemplates, importCustomTemplates, removeCustomTemplate,
  updateCustomTemplate, useCustomTemplates, type CustomTemplate,
} from '@/lib/molecular/custom-templates'
import { validateTemplateCommand, type TemplateDraft } from '@/lib/molecular/template-command-guard'
import { TemplatePreview } from '@/components/studio/TemplatePreview'
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
  // r78 四新模板：Orbit（构象轨迹环绕）/ GitCompareArrows（两态对比）/ Ghost（幽灵表面）/ Ruler（几何测量）
  'conformational-morph': Orbit,
  'two-state-comparison': GitCompareArrows,
  'ghost-surface': Ghost,
  'catalytic-residues': Ruler,
  // r87 五新模板（同类异风变体）：Moon（墨夜深底）/ Atom（球棍化学——与 metal-center
  // 同为原子语义，卡片语境可区分）/ Glasses（红蓝眼镜——立体对图式的观看器具）/ Spline
  // （胖瘦管——样条曲线语义，与 Gauge 的仪表盘语义区分）/ Scissors（切层剖开）
  'ink-night-cover': Moon,
  'ballstick-chemistry': Atom,
  'stereo-anaglyph': Glasses,
  'putty-flexibility': Spline,
  'slab-cutaway': Scissors,
  // r89 五新模板（多风格再五连）：Waypoints（线描骨架——节点与连线网络）/ Contrast
  // （黑白制版——明度对比）/ Zap（红蓝静电——与盐桥网络同源静电语义，复用判例）/
  // Droplets（水合壳层——水滴）/ Box（晶胞语境——立方盒）
  'wire-skeleton': Waypoints,
  'grayscale-print': Contrast,
  'electrostatic-surface': Zap,
  'hydration-shell': Droplets,
  'unit-cell-context': Box,
  // r97 九新模板：Drama（影院聚光——舞台剧面具）/ Pencil（黑板粉笔——板书笔）/ Candy
  // （马卡龙——糖果）/ SwatchBook（双色海报——色板书）/ History（复古棕印——历史）/ Disc
  // （核小体——盘面形状）/ GraduationCap（教科书——学位帽）/ Lightbulb（赛博霓虹——灯泡）/ FlaskConical（GFP 荧光——烧瓶）
  'cinematic-spotlight': Drama,
  'chalk-wireframe': Pencil,
  'pastel-macaron': Candy,
  'duotone-poster': SwatchBook,
  'sepia-vintage': History,
  'neon-night': Lightbulb,
  'textbook-annotated': GraduationCap,
  'nucleosome-dna': Disc,
  'gfp-chromophore': FlaskConical,
  // r99 六新模板：Aperture（底片负像——相机光圈/暗房）/ SunDim（白瓷影棚——柔
  // 光）/ Paintbrush（波普漫画——画笔）/ Fingerprint（锌指–DNA 识别——指纹识
  // 别语义）/ Torus（B 型 DNA 双链——双螺旋环面）/ Shield（抗体 Y 型架构——免
  // 疫盾牌）
  'xray-film': Aperture,
  'porcelain-studio': SunDim,
  'comic-pop': Paintbrush,
  'zn-finger-dna': Fingerprint,
  'bdna-dodecamer': Torus,
  'antibody-architecture': Shield,
}

function TemplateCard({ tpl, index, onApply, onDemo, onCompare, busy, onDelete, onEdit }: {
  tpl: FigureTemplate
  index: number
  onApply: () => void
  onDemo: () => void
  onCompare: () => void
  busy: boolean
  onDelete?: () => void
  onEdit?: () => void
}) {
  const { t } = useI18n()
  const [imgOk, setImgOk] = useState(true)
  const a = ACCENT[tpl.accent]
  const Icon = TPL_ICONS[tpl.id] ?? BookOpenText
  const doiUrl = tpl.citation.doi ? `https://doi.org/${tpl.citation.doi}` : null
  // r79：自定义模板缩略图 = 用户上传图缩存 dataURL；内置模板 = 管线 PNG；两者缺图都退强调色渐变
  const thumbSrc = tpl.custom && tpl.thumb ? tpl.thumb : `/templates/${tpl.id}.png`

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
          // 静态资源缩略图（管线产物，非内容图）；next/image 对 public 静态占位无增益。
          // r79：自定义模板为 dataURL（同一 img 元素直接消费）
          <img
            src={thumbSrc}
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
        {/* 序号角标（仪器簇编号惯例）；自定义模板换「自定义」印记 */}
        {tpl.custom ? (
          <span className="absolute left-2 top-2 rounded bg-violet-500/85 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em] text-white">
            {t({ zh: '自定义', en: 'CUSTOM' })}
          </span>
        ) : (
          <span className={cn('absolute left-2 top-2 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em]', a.chip)}>
            {String(index + 1).padStart(2, '0')}
          </span>
        )}
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
        {/* 自定义模板管理排（r82 编辑 + r79 删除——hover 浮现；左下镜像位） */}
        {(onDelete || onEdit) && (
          <span
            className={cn(
              'absolute bottom-2 left-2 flex items-center gap-1 transition-opacity duration-200',
              'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
            )}
          >
            {onEdit && (
              <span
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); onEdit() }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onEdit() } }}
                title={t({ zh: '编辑名称/分类/命令序列', en: 'Edit name / category / commands' })}
                data-open-edit
                className="flex h-7 cursor-pointer items-center gap-1 rounded-full border border-violet-500/40 bg-background/85 px-2.5 text-[10px] font-semibold text-violet-600 backdrop-blur-sm dark:text-violet-400"
              >
                <Pencil className="h-3 w-3" aria-hidden />
                {t({ zh: '编辑', en: 'Edit' })}
              </span>
            )}
            {onDelete && (
              <span
                role="button"
                tabIndex={0}
                onClick={e => { e.stopPropagation(); onDelete() }}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onDelete() } }}
                title={t({ zh: '删除这个自定义模板', en: 'Delete this custom template' })}
                className="flex h-7 cursor-pointer items-center gap-1 rounded-full border border-red-500/40 bg-background/85 px-2.5 text-[10px] font-semibold text-red-600 backdrop-blur-sm dark:text-red-400"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
                {t({ zh: '删除', en: 'Delete' })}
              </span>
            )}
          </span>
        )}
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
          {tpl.custom && (
            <span className="rounded bg-violet-500/12 px-1.5 py-px text-[9.5px] font-semibold text-violet-600 dark:text-violet-400">{t({ zh: '图片解析', en: 'From image' })}</span>
          )}
          <span className="ml-auto text-[9.5px] text-muted-foreground">{t(tpl.purpose)}</span>
        </div>
      </div>

      {/* 文献参考行（可溯源；无 DOI 时仅展示；自定义模板显示创建时间替代 DOI） */}
      <div className="flex items-center gap-1.5 border-t border-border/70 px-3 py-1.5">
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', a.text.replace('text-', 'bg-'))} aria-hidden />
        <span className="truncate text-[9.5px] text-muted-foreground">
          {t({ zh: '图式参考', en: 'Style ref.' })} · {tpl.citation.journal} {tpl.citation.year}
        </span>
        {tpl.custom ? (
          <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">
            {new Date((tpl as CustomTemplate).createdAt).toLocaleDateString()}
          </span>
        ) : doiUrl ? (
          <a
            href={doiUrl}
            target="_blank"
            rel="noreferrer"
            title={tpl.citation.title}
            className="ml-auto flex shrink-0 items-center gap-0.5 text-[9.5px] font-medium text-primary hover:underline"
          >
            DOI <ExternalLink className="h-2.5 w-2.5" />
          </a>
        ) : null}
      </div>
    </div>
  )
}

// ── r79：从图片创建模板（上传 → VLM 解析 → 审核表单 → 入库） ──────────────────
// 三态流：idle（拖/点/粘贴选图）→ picked（预览 + AI 解析按钮）→ parsing（阶段
// 提示文案轮播）→ review（左原图 + AI 视觉判读 / 右可编辑表单：名称/描述/分类/
// 演示结构/命令逐行实时校验）→ 保存入 localStorage 自定义模板层。
// 图片前端缩放：≤1280px JPEG 送解析（省流量/防超限）+ ≤384px 缩存做卡片缩略图。

/** 图片文件 → { 解析用 dataURL（≤1280px）, 卡片缩略图 dataURL（≤384px）, 宽高 }。
 *  PNG 透明通道先铺白底（分子图惯例——JPEG 无 alpha，避免黑底事故） */
async function fileToImages(file: File): Promise<{ dataUrl: string; thumb: string; w: number; h: number }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1280 / bitmap.width)
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const paint = (width: number, height: number, source: ImageBitmap) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('canvas 2d unavailable')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(source, 0, 0, width, height)
    return canvas
  }
  const dataUrl = paint(w, h, bitmap).toDataURL('image/jpeg', 0.85)
  const tw = Math.min(384, w)
  const th = Math.max(1, Math.round(tw * (h / w)))
  const thumb = paint(tw, th, bitmap).toDataURL('image/jpeg', 0.72)
  bitmap.close()
  return { dataUrl, thumb, w, h }
}

/** r97：客观色彩证据提取（送 VLM 的「采样锚」——bg/主题色不再靠目测）。
 *  · 背景：四角 + 四边中点 8 个 patch 采样，量子化（每通道 >>4）众数簇均值
 *  · 主色板：降采样（长边≤96px）后全像素量子化 top 簇（剔离背景色 <ΔRGB 30）取 top5
 *  · 亮度：背景色相对亮度（深/浅底语境判读）——全部纯客户端 canvas，零网络成本 */
export interface ParseImageHints {
  background: string
  backgroundLuma: number
  palette: { hex: string; share: number }[]
  width: number
  height: number
}

async function extractImageHints(dataUrl: string): Promise<ParseImageHints> {
  const el = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('decode failed'))
    img.src = dataUrl
  })
  const W = el.naturalWidth || 1
  const H = el.naturalHeight || 1
  const s = Math.min(1, 96 / Math.max(W, H))
  const cw = Math.max(8, Math.round(W * s))
  const ch = Math.max(8, Math.round(H * s))
  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas 2d unavailable')
  ctx.drawImage(el, 0, 0, cw, ch)
  const data = ctx.getImageData(0, 0, cw, ch).data
  const hex = (r: number, g: number, b: number) =>
    '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
  const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

  // 背景采样：四角 + 四边中点 patch（4×4 窗口）→ 量子化众数簇
  const patches: [number, number][] = [
    [0, 0], [cw - 4, 0], [0, ch - 4], [cw - 4, ch - 4],
    [(cw >> 1) - 2, 0], [(cw >> 1) - 2, ch - 4], [0, (ch >> 1) - 2], [cw - 4, (ch >> 1) - 2],
  ]
  type Cluster = { n: number; r: number; g: number; b: number }
  const bgClusters = new Map<string, Cluster>()
  const px = (x: number, y: number) => {
    const i = (y * cw + x) * 4
    return [data[i], data[i + 1], data[i + 2]] as const
  }
  for (const [ox, oy] of patches) {
    for (let dy = 0; dy < 4; dy++) {
      for (let dx = 0; dx < 4; dx++) {
        const [r, g, b] = px(Math.min(cw - 1, ox + dx), Math.min(ch - 1, oy + dy))
        const key = `${r >> 4}:${g >> 4}:${b >> 4}`
        const c = bgClusters.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
        c.n++; c.r += r; c.g += g; c.b += b
        bgClusters.set(key, c)
      }
    }
  }
  let bgBest: Cluster | null = null
  for (const c of bgClusters.values()) if (!bgBest || c.n > bgBest.n) bgBest = c
  const bgR = bgBest ? bgBest.r / bgBest.n : 255
  const bgG = bgBest ? bgBest.g / bgBest.n : 255
  const bgB = bgBest ? bgBest.b / bgBest.n : 255

  // 主色板：全像素量子化（剔背景色），top5 簇均值
  const pal = new Map<string, Cluster>()
  let total = 0
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2]
    // 剔除背景色（±30/通道均值），半透明边缘像素也会被剔除——足够近似
    if (Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB) < 90) continue
    const key = `${r >> 4}:${g >> 4}:${b >> 4}`
    const c = pal.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    c.n++; c.r += r; c.g += g; c.b += b
    pal.set(key, c)
    total++
  }
  const palette = [...pal.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map(c => ({ hex: hex(c.r / c.n, c.g / c.n, c.b / c.n), share: total ? c.n / total : 0 }))

  return {
    background: hex(bgR, bgG, bgB),
    backgroundLuma: luma(bgR, bgG, bgB),
    palette,
    width: W,
    height: H,
  }
}

/** 解析阶段提示轮播（进度剧场——VLM 实需 10-60s，静态转轮无信息量；
 *  r97 两段式：末段新增复检精修） */
const PARSING_STAGES: DualText[] = [
  { zh: '识别表示法（卡通带 / 球棍 / 表面 / CPK 球）…', en: 'Identifying representations (cartoon / sticks / surface / CPK)…' },
  { zh: '还原配色方案（彩虹 / 逐链 / 元素色 / SASA 渐变）…', en: 'Recovering the color scheme (rainbow / per-chain / element / SASA)…' },
  { zh: '估读视角与景别（全景 / 位点特写 / 正交）…', en: 'Reading camera & framing (overview / site close-up / orthogonal)…' },
  { zh: '翻译为命令序列并过白名单校验…', en: 'Translating to a command sequence and validating…' },
  { zh: '复检精修：逐维对照原图修正命令…', en: 'Self-check refinement: verifying each dimension against the image…' },
]

/** r82：CustomTemplate → TemplateDraft（编辑模式复用审核表单——analysis 换编辑说明） */
function templateToDraft(tpl: CustomTemplate): TemplateDraft {
  return {
    name: tpl.name,
    tagline: tpl.tagline,
    purpose: tpl.purpose,
    tags: tpl.tags,
    category: tpl.category,
    demo: tpl.demo,
    accent: tpl.accent,
    analysis: {
      zh: '你创建的模板——可修改名称、描述、分类、演示结构与命令序列，保存即更新。',
      en: 'Your template — edit the name, description, category, demo structure or commands; saving updates it in place.',
    },
    commands: tpl.commands,
  }
}

// ── r97：渲染校准回路（原图 vs 引擎渲染 → AI 逐维比对 → 采纳修正命令） ──────────
// 「准确还原」闭环：r84 对照预览让人眼看差距，本面板让 AI 自己看——按当前表单
// 命令真实渲染（TemplatePreview 同款管线：demo 入 store → 引擎就绪 → 相机落地
// → runTemplateCommands → capture）→ 截图与原图一起送 /api/templates/calibrate
// → 展示六维比对结论与修正序列（行级差异高亮）→ 一键采纳回写命令表单。
const CALIB_STAGES: DualText[] = [
  { zh: '加载演示结构并应用当前命令…', en: 'Loading the demo & applying current commands…' },
  { zh: '截取引擎渲染…', en: 'Capturing the engine render…' },
  { zh: 'AI 逐维比对原图与渲染…', en: 'The AI compares source vs render…' },
]
/** r98-f5：自动复验轮数上限（采纳→回写→复验直至 close 或达上限） */
const CALIB_MAX_ROUNDS = 3

/** dataURL → ≤maxW 像素 JPEG（VLM 上行省流——与 AgentPanel shrinkImage 同模式） */
async function shrinkDataUrl(dataUrl: string, maxW: number): Promise<string> {
  const el = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('decode failed'))
    img.src = dataUrl
  })
  const s = Math.min(1, maxW / Math.max(1, el.naturalWidth))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(el.naturalWidth * s))
  canvas.height = Math.max(1, Math.round(el.naturalHeight * s))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d unavailable')
  ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.72)
}

function CalibrationPanel({ sourceUrl, commands, demo, onAccept }: {
  sourceUrl: string
  /** 当前表单的「有效」命令行（逐行过闸后的） */
  commands: string[]
  demo: string
  /** 采纳修正序列 → 回写命令表单 */
  onAccept: (next: string[]) => void
}) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [stage, setStage] = useState(0)
  const [errMsg, setErrMsg] = useState('')
  const [renderShot, setRenderShot] = useState<string | null>(null)
  const [result, setResult] = useState<{ verdict: 'close' | 'adjusted'; critique: DualText; suggested: string[] | null } | null>(null)
  const [accepted, setAccepted] = useState(false)
  // r98-f5：多轮迭代状态——round 当前轮次（1 起）、history 每轮结论时间线、
  // autoNext 采纳后自动复验开关、autoPending 采纳→命令回写→自动续轮的中间态
  const [round, setRound] = useState(0)
  const [history, setHistory] = useState<{ round: number; verdict: 'close' | 'adjusted'; added: number; removed: number }[]>([])
  const [autoNext, setAutoNext] = useState(true)
  const [autoPending, setAutoPending] = useState(false)

  // r98-f3：卸载守卫——run 内多 await 点后检查，卸载后不再回写组件状态；
  // 校准 fetch 挂 AbortController，卸载时一并中止（对话框关闭/视图切走时请求不悬挂）
  const disposedRef = useRef(false)
  const calibAbortRef = useRef<AbortController | null>(null)
  useEffect(() => () => { disposedRef.current = true; calibAbortRef.current?.abort() }, [])

  useEffect(() => {
    if (phase !== 'running') return
    const iv = setInterval(() => setStage(s => Math.min(s + 1, CALIB_STAGES.length - 1)), 5000)
    return () => clearInterval(iv)
  }, [phase])

  // r98-f5：采纳后自动复验——onAccept 回写表单后 commands prop 更新，此处触发下一轮
  // （收敛条件：verdict close / 达到 MAX 轮 / 用户关掉自动开关；定时器起步避开
  // set-state-in-effect 同步路径，与 react-hooks 新规则兼容）
  const lastCmdsRef = useRef(commands)
  useEffect(() => {
    if (!autoPending) return
    if (commands === lastCmdsRef.current) return
    lastCmdsRef.current = commands
    setAutoPending(false)
    if (commands.length < 2 || disposedRef.current) return
    const tm = setTimeout(() => { if (!disposedRef.current) void run() }, 150)
    return () => clearTimeout(tm)
  }, [commands, autoPending])

  const run = async () => {
    if (phase === 'running' || commands.length < 2) return
    const myRound = round + 1 // r98-f5：本轮序号（历史时间线用；setRound 异步不可靠）
    setRound(myRound)
    setPhase('running')
    setStage(0)
    setErrMsg('')
    setAccepted(false)
    // r98-f3：本轮回写句柄——重跑/重试时先中止旧轮，迟到响应不再覆盖新轮状态
    calibAbortRef.current?.abort()
    const ac = new AbortController()
    calibAbortRef.current = ac
    try {
      // ① 演示结构落地（TemplatePreview 同拍——已入 store 免拉取）
      if (!isStructureInStore(demo)) {
        await fetchPdbId(demo)
        if (disposedRef.current) return
        const ok = await waitForStructureInStore(demo, 9000)
        if (disposedRef.current) return
        if (!ok) throw new Error('LOAD_TIMEOUT')
      }
      await new Promise<void>(res => whenEngineReady(() => res()))
      if (disposedRef.current) return
      await new Promise(r => setTimeout(r, 80))
      await waitForCameraIdle(2600)
      if (disposedRef.current) return
      await new Promise(r => setTimeout(r, 100))
      // ② 应用当前命令（表单实况——含用户手改）
      await runTemplateCommands(commands)
      if (disposedRef.current) return
      // r98：旧版固定 450ms < 序列收尾相机飞行时长（normal 650ms / cinematic 1200ms）
      // ——capture 拿到半途构图，VLM 六维比对失真。等引擎动画真正落地再截
      await waitForCameraIdle(1800)
      await new Promise(r => setTimeout(r, 120))
      // ③ 截取视口 + 缩流送 VLM
      const eng = engineRef.current
      if (!eng) throw new Error('NO_ENGINE')
      if (eng.isCameraAnimating()) {
        // 兑底：极端长动画（cinematic 1200ms）后仍在飞——再等一轮
        await waitForCameraIdle(1800)
      }
      if (disposedRef.current) return
      setStage(1)
      await new Promise(r => setTimeout(r, 60))
      const shot = eng.capture({ scale: 1.5 })
      if (disposedRef.current) return
      setRenderShot(shot)
      setStage(2)
      const [targetJ, renderJ] = await Promise.all([
        shrinkDataUrl(sourceUrl, 768),
        shrinkDataUrl(shot, 768),
      ])
      if (disposedRef.current) return
      const res = await fetch('/api/templates/calibrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: targetJ, render: renderJ, commands }),
        signal: ac.signal,
      })
      if (disposedRef.current) return
      const data = (await res.json()) as {
        ok?: boolean
        verdict?: 'close' | 'adjusted'
        critique?: DualText
        commands?: string[] | null
        error?: string
      }
      if (!res.ok || !data.ok || !data.verdict || !data.critique) {
        throw new Error(data.error ?? 'CALIB_FAILED')
      }
      const suggested = data.commands ?? null
      const verdict = data.verdict
      setResult({ verdict, critique: data.critique, suggested })
      // r98-f5：时间线记录——added = 建议序列相对当前命令的新增数，removed = 移除数
      setHistory(h => [...h.slice(-4), {
        round: myRound,
        verdict,
        added: suggested ? suggested.filter(c => !commands.includes(c)).length : 0,
        removed: suggested ? commands.filter(c => !suggested.includes(c)).length : 0,
      }])
      setPhase('done')
    } catch (e) {
      // r98-f3：卸载触发的 AbortError 静默吞掉——已卸载组件不回写错误态
      if (disposedRef.current) return
      setPhase('error')
      setErrMsg(e instanceof Error ? e.message : String(e))
    }
  }

  const currentSet = new Set(commands)
  const changedLines = result?.suggested?.filter(c => !currentSet.has(c)) ?? []
  const removedCount = result ? commands.filter(c => !result.suggested?.includes(c)).length : 0

  return (
    <div data-calibration-panel className="relative overflow-hidden rounded-lg border border-border bg-muted/30">
      {/* idle：CTA */}
      {phase === 'idle' && (
        <button
          type="button"
          onClick={() => void run()}
          disabled={commands.length < 2}
          data-calibration-cta
          className="group flex w-full cursor-pointer flex-col items-center justify-center gap-2 px-4 py-4 text-center transition-colors hover:bg-primary/[0.05] disabled:pointer-events-none disabled:opacity-55"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
            <ScanSearch className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-[12px] font-semibold">{t({ zh: '渲染校准 · AI 比对原图', en: 'Render calibration · AI vs source' })}</span>
          <span className="max-w-[40ch] text-[10.5px] leading-relaxed text-muted-foreground">
            {commands.length < 2
              ? t({ zh: '命令不足 2 条——先让解析产出或手写至少两条有效命令', en: 'Fewer than 2 commands — parse an image or write at least two valid ones first' })
              : t({
                  zh: `将按当前 ${commands.length} 条命令真实渲染（结构 ${demo}），截屏后由 AI 与原图逐维比对（景别/视角/配色/背景），自动修正命令序列`,
                  en: `Renders with the current ${commands.length} commands (${demo}), then the AI compares against the source (framing / camera / colors / background) and proposes corrections`,
                })}
          </span>
        </button>
      )}

      {/* running：阶段剧场 */}
      {phase === 'running' && (
        <div className="flex w-full flex-col items-center justify-center gap-2.5 px-4 py-5">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
          <span className="text-[11.5px] font-medium text-foreground/85">
            {t(CALIB_STAGES[stage])}
            {round > 1 && (
              <span className="ml-1.5 rounded bg-primary/10 px-1.5 py-px font-mono text-[9px] font-semibold text-primary" data-calibration-round>
                {t({ zh: `第 ${round}/${CALIB_MAX_ROUNDS} 轮`, en: `Round ${round}/${CALIB_MAX_ROUNDS}` })}
              </span>
            )}
          </span>
          <span className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground">
            {CALIB_STAGES.map((_, i) => (
              <span key={i} className={`h-1 w-5 rounded-full transition-colors ${i <= stage ? 'bg-primary/70' : 'bg-border'}`} />
            ))}
          </span>
        </div>
      )}

      {/* done：渲染快照 + 比对结论 + 修正序列（行级差异高亮） */}
      {phase === 'done' && result && (
        <div className="flex flex-col gap-2.5 p-2.5">
          {/* r98-f5：校准历史时间线——每轮 verdict 与增删计数一目了然（收敛可视化） */}
          {history.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" data-calibration-history>
              <span className="text-[9.5px] font-semibold text-muted-foreground">{t({ zh: '校准历史', en: 'Rounds' })}</span>
              {history.map(h => (
                <span key={h.round} className={cn(
                  'rounded px-1.5 py-px font-mono text-[9px] font-semibold',
                  h.verdict === 'close'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                )} title={h.verdict === 'close' ? t({ zh: '收敛：比对通过', en: 'Converged: close match' }) : t({ zh: `第 ${h.round} 轮修正：+${h.added} 新增 / -${h.removed} 移除`, en: `Round ${h.round}: +${h.added} new / -${h.removed} removed` })}>
                  {h.verdict === 'close' ? `R${h.round} ✓` : `R${h.round} +${h.added}/-${h.removed}`}
                </span>
              ))}
              {result.verdict !== 'close' && round >= CALIB_MAX_ROUNDS && (
                <span className="text-[9px] text-muted-foreground">{t({ zh: '已达轮数上限', en: 'round cap reached' })}</span>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <figure className="relative overflow-hidden rounded-md border border-border">
              <img src={sourceUrl} alt={t({ zh: '目标原图', en: 'Target source' })} className="aspect-[16/10] w-full object-contain" />
              <figcaption className="absolute bottom-1 left-1 rounded bg-background/85 px-1 py-px font-mono text-[8.5px] font-semibold text-muted-foreground backdrop-blur-sm">
                {t({ zh: '原图', en: 'SOURCE' })}
              </figcaption>
            </figure>
            <figure className="relative overflow-hidden rounded-md border border-border">
              {renderShot && <img src={renderShot} alt={t({ zh: '引擎渲染快照', en: 'Engine render' })} className="aspect-[16/10] w-full object-contain" />}
              <figcaption className="absolute bottom-1 left-1 rounded bg-background/85 px-1 py-px font-mono text-[8.5px] font-semibold text-muted-foreground backdrop-blur-sm">
                {t({ zh: '渲染', en: 'RENDER' })}
              </figcaption>
            </figure>
          </div>
          <div className={cn(
            'rounded-md border p-2',
            result.verdict === 'close' ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-amber-500/40 bg-amber-500/[0.07]',
          )}>
            <span className={cn(
              'rounded px-1.5 py-px text-[9.5px] font-semibold',
              result.verdict === 'close'
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
            )}>
              {result.verdict === 'close'
                ? t({ zh: '比对通过 · 已高度还原', en: 'Close match · well reproduced' })
                : t({ zh: '发现差距 · 建议修正', en: 'Gaps found · corrections proposed' })}
            </span>
            <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/85">{t(result.critique)}</p>
          </div>
          {result.suggested && (
            <div className="rounded-md border border-border bg-background/60 p-2">
              <span className="mol-micro text-muted-foreground">
                {t({ zh: `修正序列（${changedLines.length} 条新命令 · ${removedCount} 条移除）`, en: `Proposed sequence (${changedLines.length} new · ${removedCount} removed)` })}
              </span>
              <ol className="mt-1.5 flex flex-col gap-0.5">
                {result.suggested.map((c, i) => (
                  <li key={i} className={cn(
                    'rounded px-1.5 py-px font-mono text-[9.5px] leading-snug',
                    currentSet.has(c) ? 'text-foreground/70' : 'bg-emerald-500/10 font-semibold text-emerald-700 dark:text-emerald-400',
                  )} title={currentSet.has(c) ? undefined : t({ zh: '新命令', en: 'New command' })}>
                    {currentSet.has(c) ? c : `+ ${c}`}
                  </li>
                ))}
              </ol>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {accepted ? (
                  <span className="flex items-center gap-1 text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" aria-hidden />
                    {autoPending
                      ? t({ zh: '已采纳——自动复验下一轮…', en: 'Adopted — auto re-verifying…' })
                      : t({ zh: '已采纳——命令表单已更新', en: 'Adopted — commands updated' })}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      onAccept(result.suggested!)
                      setAccepted(true)
                      // r98-f5：自动续轮条件——verdict 有差距 + 未达轮数上限 + 开关开。
                      // 命令回写后 commands prop 更新→autoPending effect 触发下一轮
                      setAutoPending(autoNext && result.verdict === 'adjusted' && round < CALIB_MAX_ROUNDS)
                    }}
                    data-calibration-accept
                    className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-primary/45 bg-primary/10 px-3 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15"
                  >
                    <Check className="h-3 w-3" aria-hidden />
                    {t({ zh: '采纳修正序列', en: 'Adopt corrections' })}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void run()}
                  data-calibration-rerun
                  className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border bg-muted/40 px-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title={t({ zh: '按当前命令重新校准（采纳后可复验）', en: 'Re-calibrate with current commands (re-verify after adopting)' })}
                >
                  {t({ zh: '重新校准', en: 'Re-calibrate' })}
                </button>
                {/* r98-f5：采纳后自动复验开关（≤CALIB_MAX_ROUNDS 轮直至 close） */}
                <label className="ml-auto flex cursor-pointer select-none items-center gap-1.5 text-[10px] font-medium text-muted-foreground" data-calibration-auto>
                  <input
                    type="checkbox"
                    checked={autoNext}
                    onChange={e => setAutoNext(e.target.checked)}
                    className="h-3 w-3 cursor-pointer accent-primary"
                  />
                  {t({ zh: '采纳后自动复验', en: 'Auto re-verify' })}
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      {/* error：诚实归因 + 重试 */}
      {phase === 'error' && (
        <div className="flex w-full flex-col items-center justify-center gap-2 px-6 py-4 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <ScanSearch className="h-4.5 w-4.5" aria-hidden />
          </span>
          <p className="text-[11px] leading-relaxed text-red-600 dark:text-red-400" role="alert">
            {errMsg === 'LOAD_TIMEOUT'
              ? t({ zh: `演示结构 ${demo} 加载超时——检查网络后重试`, en: `Timed out loading demo ${demo} — check the network and retry` })
              : errMsg === 'NO_ENGINE'
                ? t({ zh: '渲染引擎尚未就绪——稍候重试', en: 'Render engine not ready yet — retry shortly' })
                : t({ zh: `校准失败：${errMsg || '请重试'}`, en: `Calibration failed: ${errMsg || 'please retry'}` })}
          </p>
          <button
            type="button"
            onClick={() => void run()}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/40 px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Play className="h-3 w-3" aria-hidden />
            {t({ zh: '重试', en: 'Retry' })}
          </button>
        </div>
      )}
    </div>
  )
}

function UploadPanel({ onBack, onSaved, onPreviewApply, editTarget }: {
  onBack: () => void
  onSaved: (tplId: string) => void
  onPreviewApply: (tpl: FigureTemplate) => void
  /** r82 编辑模式：非空时直接进入预填的审核态（无重解析/换图） */
  editTarget?: CustomTemplate | null
}) {
  const { t, locale } = useI18n()
  const hasStructure = useMolStore(s => s.structures.length > 0)
  const fileRef = useRef<HTMLInputElement>(null)
  const editMode = !!editTarget
  // 状态机：idle → picked → parsing → review；error 就地展示不独占态。
  // r82 编辑模式：直接落 review（表单预填自 editTarget）
  const [phase, setPhase] = useState<'idle' | 'picked' | 'parsing' | 'review'>(editMode ? 'review' : 'idle')
  // 编辑模式左栏用缩存缩略图展示（无原图高分辨版本）；无缩略图退紫系占位
  const [img, setImg] = useState<{ dataUrl: string; thumb: string; w: number; h: number } | null>(
    editTarget?.thumb ? { dataUrl: editTarget.thumb, thumb: editTarget.thumb, w: 0, h: 0 } : null,
  )
  const [dragOver, setDragOver] = useState(false)
  const [stage, setStage] = useState(0)
  const [error, setError] = useState('')
  const [dropped, setDropped] = useState<{ cmd: string; reason: string }[]>([])
  // r97：复检精修产物（两段式第二轮）：applied = 是否采纳了修正序列
  const [refine, setRefine] = useState<{ applied: boolean; verdict: 'accurate' | 'adjusted'; critique: { zh: string; en: string } } | null>(null)
  // 审核表单（当前语言值可改；另一语言保留 AI 原稿）
  const [draft, setDraft] = useState<TemplateDraft | null>(editTarget ? templateToDraft(editTarget) : null)
  const [nameVal, setNameVal] = useState(editTarget ? (locale === 'en' ? editTarget.name.en : editTarget.name.zh) : '')
  const [taglineVal, setTaglineVal] = useState(editTarget ? (locale === 'en' ? editTarget.tagline.en : editTarget.tagline.zh) : '')
  const [categoryVal, setCategoryVal] = useState<TemplateDraft['category']>(editTarget?.category ?? 'basic')
  const [demoVal, setDemoVal] = useState(editTarget?.demo ?? '4HHB')
  const [commandsVal, setCommandsVal] = useState(editTarget?.commands.join('\n') ?? '')

  // 解析中阶段文案轮播（stage 归零在 parse() 入口同步完成——effect 内 setState 触发 set-state-in-effect）
  useEffect(() => {
    if (phase !== 'parsing') return
    const iv = setInterval(() => setStage(s => Math.min(s + 1, PARSING_STAGES.length - 1)), 6000)
    return () => clearInterval(iv)
  }, [phase])

  // r98：解析请求中止句柄（取消按钮/换图/重置时 abort——服务端已接 req.signal，
  // 中止链路现成；旧版 AbortError 分支是不可达死代码，fetch 从未接 signal）
  const abortRef = useRef<AbortController | null>(null)
  // r98-f3：卸载守卫——对话框关闭/视图切走时中止在途解析：旧版只在按钮路径
  //（取消/重置）abort，卸载路径无按钮可达，请求悬挂直至超时
  useEffect(() => () => { abortRef.current?.abort() }, [])


  const acceptFile = async (f: File) => {
    if (!/^image\/(png|jpe?g|webp)$/.test(f.type)) {
      toast.error(tt({ zh: '仅支持 PNG / JPG / WebP 图片', en: 'Only PNG / JPG / WebP images are supported' }))
      return
    }
    if (f.size > 10 * 1024 * 1024) {
      toast.error(tt({ zh: '图片超过 10MB——请先裁剪或压缩', en: 'Image exceeds 10MB — crop or compress it first' }))
      return
    }
    try {
      const images = await fileToImages(f)
      setImg(images)
      setError('')
      setDraft(null)
      setPhase('picked')
    } catch {
      toast.error(tt({ zh: '图片解码失败（文件可能损坏）', en: 'Failed to decode the image (file may be corrupt)' }))
    }
  }

  // 粘贴通道（Ctrl+V 论文截图直入；编辑模式不注册——粘贴新图会打断编辑流）。
  // r98：parsing/review 态同样不接管——误贴一张截图会静默清掉 draft 与手改的
  // 命令表单退回 picked（review 态），或与在途 fetch 的旧图闭包产生状态错位（parsing 态）
  useEffect(() => {
    if (editMode || phase !== 'idle' && phase !== 'picked') return
    const onPaste = (e: ClipboardEvent) => {
      const f = e.clipboardData?.files?.[0]
      if (f && f.type.startsWith('image/')) {
        e.preventDefault()
        void acceptFile(f)
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [editMode, phase])

  const reset = () => {
    abortRef.current?.abort() // r98：在途解析随重置中止
    setPhase('idle')
    setImg(null)
    setError('')
    setDropped([])
    setDraft(null)
    setRefine(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  // r98：取消在途解析（parsing 态唯一逃生口——旧版挂起请求 = 无限转轮）
  const cancelParse = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase(img ? 'picked' : 'idle')
    setError('')
  }

  const parse = async () => {
    if (!img) return
    setStage(0)
    setPhase('parsing')
    setError('')
    // r98：挂 AbortController（取消按钮/重置/换图可中止；服务端 req.signal 联动）
    const ac = new AbortController()
    abortRef.current = ac
    try {
      // r97：客观色彩证据（客户端采样——失败退纯目测，不阻断解析）
      const hints = await extractImageHints(img.dataUrl).catch(() => null)
      const res = await fetch('/api/templates/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: img.dataUrl, hints }),
        signal: ac.signal,
      })
      const data = (await res.json()) as {
        ok?: boolean
        draft?: TemplateDraft
        dropped?: { cmd: string; reason: string }[]
        refine?: { applied: boolean; verdict: 'accurate' | 'adjusted'; critique: { zh: string; en: string } } | null
        error?: string
      }
      if (!res.ok || !data.ok || !data.draft) {
        setError(data.error ?? tt({ zh: '解析失败，请稍后重试或换一张图', en: 'Parsing failed — retry later or try another image' }))
        setPhase('picked')
        return
      }
      const d = data.draft
      setDraft(d)
      setDropped(data.dropped ?? [])
      setRefine(data.refine ?? null)
      setNameVal(locale === 'en' ? d.name.en : d.name.zh)
      setTaglineVal(locale === 'en' ? d.tagline.en : d.tagline.zh)
      setCategoryVal(d.category)
      setDemoVal(d.demo)
      setCommandsVal(d.commands.join('\n'))
      setPhase('review')
      // r97：两段式结果反馈（精修采纳 / 已核实 / 仅首轮）
      const refineNotePair = data.refine
        ? (data.refine.applied
          ? { zh: '复检精修已采纳：命令序列经第二轮逐维对照修正', en: 'Refinement adopted: commands corrected in a second pass against the image' }
          : { zh: '复检通过：第二轮逐维对照确认命令序列准确', en: 'Re-check passed: the command sequence was verified dimension by dimension' })
        : { zh: '单轮解析（复检不可用，不影响入库）', en: 'Single-pass parse (re-check unavailable; still saveable)' }
      toast.success(tt({ zh: `图式解析完成：${d.commands.length} 条命令`, en: `Figure style parsed: ${d.commands.length} commands` }), {
        description: data.dropped?.length
          ? tt({
            zh: `${data.dropped.length} 条不受支持的命令已剔除（详见表单下方）· ${refineNotePair.zh}`,
            en: `${data.dropped.length} unsupported commands dropped (see below the form) · ${refineNotePair.en}`,
          })
          : tt(refineNotePair),
      })
    } catch (e) {
      // r98：AbortError 分支现在可达（fetch 已接 signal）
      const msg = e instanceof Error && e.name === 'AbortError' ? tt({ zh: '请求已取消', en: 'Request aborted' }) : ''
      setError(msg || tt({ zh: '网络异常——解析请求失败', en: 'Network error — the parse request failed' }))
      setPhase(img ? 'picked' : 'idle')
    } finally {
      if (abortRef.current === ac) abortRef.current = null
    }
  }

  // 表单实时校验：命令逐行过闸（保存时再全量过一道——双保险）
  const commandLines = commandsVal.split('\n').map(x => x.trim()).filter(Boolean)
  const invalidLines = commandLines.filter(x => !validateTemplateCommand(x).ok)
  const demoOk = /^[0-9][A-Z0-9]{3}$/.test(demoVal.trim().toUpperCase())
  const canSave = !!draft && (editMode || !!img) && nameVal.trim().length > 0 && commandLines.length >= 2 && invalidLines.length === 0 && demoOk

  const save = () => {
    if (!draft || !canSave) return
    const name = { ...draft.name, ...(locale === 'en' ? { en: nameVal.trim().slice(0, 30) } : { zh: nameVal.trim().slice(0, 10) }) }
    const tagline = { ...draft.tagline, ...(locale === 'en' ? { en: taglineVal.trim().slice(0, 80) } : { zh: taglineVal.trim().slice(0, 40) }) }
    try {
      // r82：编辑模式 → updateCustomTemplate（命令重过闸，保留 id/createdAt/缩略图）；
      // 否则 addCustomTemplate 新建入库
      const saved = editTarget
        ? updateCustomTemplate(editTarget.id, {
            name, tagline,
            purpose: draft.purpose,
            tags: draft.tags,
            category: categoryVal,
            demo: demoVal.trim().toUpperCase(),
            accent: draft.accent,
            commands: commandLines,
            thumb: img?.thumb,
          })
        : addCustomTemplate({
            name, tagline,
            purpose: draft.purpose,
            tags: draft.tags,
            category: categoryVal,
            demo: demoVal.trim().toUpperCase(),
            accent: draft.accent,
            commands: commandLines,
            thumb: img?.thumb,
          })
      toast.success(
        editTarget
          ? tt({ zh: `已保存对「${locale === 'en' ? name.en : name.zh}」的修改`, en: `Saved changes to "${locale === 'en' ? name.en : name.zh}"` })
          : tt({ zh: `自定义模板「${locale === 'en' ? name.en : name.zh}」已入库`, en: `Custom template "${locale === 'en' ? name.en : name.zh}" saved` }),
        {
          description: tt({
            zh: editTarget ? '修改即时生效于「我的模板」分区与画廊' : '在「我的模板」分区查看——与内置模板同权应用/演示',
            en: editTarget ? 'Changes apply immediately under "My templates" and in the gallery' : 'Find it under "My templates" — applies and demos like a built-in',
          }),
        },
      )
      onSaved(saved.id)
    } catch (e) {
      // r83：三分支归因（r82 遗漏 NOT_FOUND——他端标签页并发删除时误报「存储写入失败」）
      const msg = e instanceof Error ? e.message : ''
      const reason = msg === 'INVALID_COMMANDS'
        ? tt({ zh: '命令校验未通过（请修正表单中标红的行）', en: 'Command validation failed (fix the flagged lines)' })
        : msg === 'NOT_FOUND'
          ? tt({ zh: '模板已被删除（可能在其他窗口）——返回图库后可将其另存为新模板', en: 'The template was deleted (perhaps in another window) — go back and save it as a new template' })
          : tt({ zh: '本地存储写入失败（可能配额不足）', en: 'Local storage write failed (quota may be full)' })
      toast.error(reason)
    }
  }

  // 试效果：以当前表单值组装临时模板走标准应用管线（与入库后行为一致）
  const previewTpl: FigureTemplate | null = draft ? {
    id: '__preview__',
    name: locale === 'en' ? { zh: draft.name.zh, en: nameVal || draft.name.en } : { zh: nameVal || draft.name.zh, en: draft.name.en },
    tagline: locale === 'en' ? { zh: draft.tagline.zh, en: taglineVal || draft.tagline.en } : { zh: taglineVal || draft.tagline.zh, en: draft.tagline.en },
    purpose: draft.purpose,
    tags: draft.tags,
    category: categoryVal,
    citation: { journal: '自定义 · 预览', year: new Date().getFullYear(), title: '预览未入库' },
    demo: demoVal.trim().toUpperCase(),
    accent: draft.accent,
    commands: commandLines,
    custom: true,
  } : null

  return (
    <div data-template-upload className="flex flex-col gap-3">
      {/* 头：返回 + 标题（r82：编辑模式换文案与徽记） */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="flex h-7 cursor-pointer items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden />
          {t({ zh: '返回图库', en: 'Back to library' })}
        </button>
        {editMode ? (
          <Pencil className="h-4 w-4 shrink-0 text-violet-500" aria-hidden />
        ) : (
          <ImagePlus className="h-4 w-4 shrink-0 text-primary" aria-hidden />
        )}
        <span className="text-[13.5px] font-bold leading-none">
          {editMode
            ? t({ zh: '编辑自定义模板', en: 'Edit custom template' })
            : t({ zh: '从图片创建模板', en: 'Create a template from an image' })}
        </span>
        <span className={cn(
          'ml-auto rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em]',
          editMode ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400' : 'bg-primary/10 text-primary',
        )}>
          {editMode ? t({ zh: '编辑', en: 'EDIT' }) : <>AI {t({ zh: '图式解析', en: 'STYLE PARSE' })}</>}
        </span>
      </div>

      {/* idle：投放区 */}
      {phase === 'idle' && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileRef.current?.click() } }}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void acceptFile(f) }}
          className={cn(
            'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
            dragOver ? 'border-primary/70 bg-primary/[0.06]' : 'border-border bg-muted/30 hover:border-primary/40 hover:bg-muted/50',
          )}
        >
          <span className={cn('flex h-12 w-12 items-center justify-center rounded-full', dragOver ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground')}>
            <ImagePlus className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <p className="text-[13px] font-semibold">{t({ zh: '拖入论文图 · 点击选择 · Ctrl+V 粘贴截图', en: 'Drop a paper figure · click to browse · Ctrl+V to paste' })}</p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
              {t({
                zh: 'PNG / JPG / WebP ≤ 10MB。AI 将判读表示法 · 配色 · 视角 · 专业元素，生成可编辑的图式命令模板',
                en: 'PNG / JPG / WebP ≤ 10MB. The AI reads representations · colors · camera · motifs and produces an editable style-command template',
              })}
            </p>
          </div>
          <span className="text-[10px] text-muted-foreground">{t({ zh: '解析在你的默认 AI 供应商上完成（可在设置中更换）', en: 'Parsing runs on your default AI provider (changeable in settings)' })}</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void acceptFile(f) }}
          />
        </div>
      )}

      {/* picked / parsing：预览 + 动作 */}
      {(phase === 'picked' || phase === 'parsing') && img && (
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative overflow-hidden rounded-lg border border-border bg-muted/40 sm:w-[46%]">
            <img src={img.dataUrl} alt={t({ zh: '待解析的图片', en: 'Image to parse' })} className="aspect-[16/10] w-full object-contain" />
            {phase === 'parsing' && (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/80 backdrop-blur-[2px]">
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
                <span className="max-w-[80%] text-center text-[11px] font-medium text-foreground/80">{t(PARSING_STAGES[stage])}</span>
              </span>
            )}
            <span className="absolute bottom-2 left-2 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground backdrop-blur-sm">
              {img.w}×{img.h}
            </span>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-2.5">
            {error && (
              <p className="rounded-md border border-red-500/40 bg-red-500/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-red-600 dark:text-red-400" role="alert">
                {error}
              </p>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {t({
                zh: 'AI 将判读这张图的分子图式——表示法（卡通/球棍/表面）、着色（彩虹/逐链/元素色）、背景与描边、景别（全景/特写）与专业元素（氢键虚线/距离标注），并翻译成可执行的命令序列。解析通常需要 10-60 秒。',
                en: 'The AI reads the molecular figure style — representations (cartoon / sticks / surface), coloring (rainbow / per-chain / element), background & outlines, framing (overview / close-up) and motifs (H-bond dashes / distance labels) — then translates it into executable commands. Typically 10-60 seconds.',
              })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void parse()}
                disabled={phase === 'parsing'}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-primary/45 bg-primary/10 px-3.5 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/15 disabled:pointer-events-none disabled:opacity-60"
              >
                {phase === 'parsing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                {phase === 'parsing' ? t({ zh: '解析中…', en: 'Parsing…' }) : t({ zh: 'AI 解析图式', en: 'Parse figure style' })}
              </button>
              {/* r98：parsing 态取消口——旧版两个按钮全 disabled，挂起请求 = 无限转轮 */}
              {phase === 'parsing' ? (
                <button
                  type="button"
                  onClick={cancelParse}
                  className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-muted/40 px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden />
                  {t({ zh: '取消解析', en: 'Cancel' })}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={reset}
                  className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-muted/40 px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
                >
                  {t({ zh: '换一张图', en: 'Another image' })}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* review：左原图 + AI 判读 / 右编辑表单（r82：编辑模式无原图时退紫系占位） */}
      {phase === 'review' && draft && (img || editMode) && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {/* 左：原图 + AI 视觉判读 */}
            <div className="flex flex-col gap-2.5">
              <div className="relative overflow-hidden rounded-lg border border-border bg-muted/40">
                {img ? (
                  <img src={img.dataUrl} alt={t({ zh: '解析原图', en: 'Parsed image' })} className="aspect-[16/10] w-full object-contain" />
                ) : (
                  <span className="flex aspect-[16/10] w-full items-center justify-center bg-gradient-to-br from-violet-500/20 via-violet-500/[0.08] to-transparent">
                    <ImagePlus className="h-8 w-8 text-violet-500/60" aria-hidden />
                  </span>
                )}
                <span className="absolute left-2 top-2 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted-foreground backdrop-blur-sm">
                  {editMode ? t({ zh: '缩略图', en: 'THUMB' }) : t({ zh: '原图', en: 'SOURCE' })}
                </span>
              </div>
              {/* r84 对照预览分屏：按当前命令真实渲染并截取视口——「读命令」升级为「看效果」 */}
              {previewTpl && <TemplatePreview tpl={previewTpl} />}
              <div className="rounded-lg border border-border bg-muted/30 p-2.5">
                <span className="mol-micro text-muted-foreground">{t({ zh: 'AI 视觉判读', en: 'AI VISUAL READ' })}</span>
                <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/85">{t(draft.analysis)}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {draft.tags.map((tag, i) => (
                    <span key={i} className="rounded bg-primary/10 px-1.5 py-px text-[9.5px] font-semibold text-primary">{t(tag)}</span>
                  ))}
                  <span className="rounded bg-foreground/[0.06] px-1.5 py-px font-mono text-[9.5px] font-semibold text-foreground/70">{draft.demo}</span>
                </div>
              </div>
              {/* r97 复检精修卡：两段式第二轮结论（采纳修正 / 复核通过）——用户看得到改了什么 */}
              {refine && !editMode && (
                <div className={cn(
                  'rounded-lg border p-2.5',
                  refine.applied
                    ? 'border-emerald-500/40 bg-emerald-500/[0.06]'
                    : 'border-primary/35 bg-primary/[0.05]',
                )}>
                  <span className="flex items-center gap-1.5">
                    {refine.applied ? (
                      <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[9.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                        {t({ zh: '复检精修 · 已采纳修正', en: 'Refined · corrections adopted' })}
                      </span>
                    ) : (
                      <span className="rounded bg-primary/12 px-1.5 py-px text-[9.5px] font-semibold text-primary">
                        {t({ zh: '复检通过 · 逐维已核实', en: 'Verified · dimension-checked' })}
                      </span>
                    )}
                  </span>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/85">{t(refine.critique)}</p>
                </div>
              )}
              {/* r97 渲染校准回路：AI 比对原图 vs 引擎渲染 → 修正命令序列（编辑模式
                  无高分辨原图，不开放——缩略图比对会误导；命令只送有效行——
                  无效行在 runCommand 里只会报错干扰渲染） */}
              {img && !editMode && (
                <CalibrationPanel
                  sourceUrl={img.dataUrl}
                  commands={commandLines.filter(x => validateTemplateCommand(x).ok)}
                  demo={demoVal.trim().toUpperCase()}
                  onAccept={next => setCommandsVal(next.join('\n'))}
                />
              )}
              {dropped.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/[0.07] p-2.5">
                  <span className="mol-micro text-amber-600 dark:text-amber-400">{t({ zh: `已剔除 ${dropped.length} 条不受支持的命令`, en: `${dropped.length} unsupported commands dropped` })}</span>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {dropped.map((d, i) => (
                      <li key={i} className="font-mono text-[9.5px] leading-snug text-amber-700 dark:text-amber-400/90" title={d.reason}>
                        <span className="line-through">{d.cmd}</span> — {d.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* 右：编辑表单 */}
            <div className="mol-scroll flex max-h-[52vh] flex-col gap-2.5 overflow-y-auto pr-0.5">
              <label className="flex flex-col gap-1">
                <span className="mol-micro text-muted-foreground">{t({ zh: '模板名称', en: 'Template name' })}</span>
                <input
                  value={nameVal}
                  onChange={e => setNameVal(e.target.value)}
                  maxLength={30}
                  className="h-8 rounded-md border border-border bg-background px-2.5 text-[12px] font-semibold outline-none focus:border-primary/60"
                  data-upload-name
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="mol-micro text-muted-foreground">{t({ zh: '图式描述', en: 'Style description' })}</span>
                <textarea
                  value={taglineVal}
                  onChange={e => setTaglineVal(e.target.value)}
                  maxLength={80}
                  rows={2}
                  className="resize-none rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] leading-relaxed outline-none focus:border-primary/60"
                  data-upload-tagline
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="mol-micro text-muted-foreground">{t({ zh: '分类', en: 'Category' })}</span>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t({ zh: '模板分类', en: 'Template category' })}>
                  {FIGURE_CATEGORIES.filter(c => c.key !== 'all').map(c => {
                    const active = categoryVal === c.key
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setCategoryVal(c.key as TemplateDraft['category'])}
                        aria-pressed={active}
                        className={cn(
                          'rounded-full border px-2 py-0.5 text-[10.5px] font-semibold transition-colors cursor-pointer',
                          active ? 'border-primary/60 bg-primary/10 text-primary' : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                        )}
                      >
                        {t(c.label)}
                      </button>
                    )
                  })}
                </div>
              </div>
              <label className="flex flex-col gap-1">
                <span className="mol-micro text-muted-foreground">
                  {t({ zh: '演示结构（PDB 编号）', en: 'Demo structure (PDB ID)' })}
                </span>
                <input
                  value={demoVal}
                  onChange={e => setDemoVal(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 4))}
                  placeholder="4HHB"
                  className={cn('h-8 w-28 rounded-md border bg-background px-2.5 font-mono text-[12px] outline-none', demoOk ? 'border-border focus:border-primary/60' : 'border-red-500/60')}
                  data-upload-demo
                />
                {!demoOk && (
                  <span className="text-[10px] text-red-600 dark:text-red-400">{t({ zh: 'PDB 编号为 4 位（首字符数字）', en: 'A PDB ID is 4 characters (leading digit)' })}</span>
                )}
              </label>
              <label className="flex flex-col gap-1">
                <span className="mol-micro text-muted-foreground">
                  {t({ zh: `命令序列（每行一条${invalidLines.length ? ` · ${invalidLines.length} 行不合法` : ''}）`, en: `Command sequence (one per line${invalidLines.length ? ` · ${invalidLines.length} invalid` : ''})` })}
                </span>
                <textarea
                  value={commandsVal}
                  onChange={e => setCommandsVal(e.target.value)}
                  rows={Math.min(10, Math.max(5, commandLines.length + 1))}
                  spellCheck={false}
                  className="mol-scroll resize-y rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed outline-none focus:border-primary/60"
                  data-upload-commands
                />
                <span className={cn('text-[10px]', invalidLines.length ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                  {invalidLines.length
                    ? t({ zh: `不合法的行保存时将被剔除：${invalidLines.join(' · ')}`, en: `Invalid lines will be dropped on save: ${invalidLines.join(' · ')}` })
                    : t({ zh: `${commandLines.length} 条命令 · 白名单校验全绿`, en: `${commandLines.length} commands · all pass the whitelist` })}
                </span>
              </label>
            </div>
          </div>

          {/* 动作排（r82：编辑模式隐藏重解析/换图——无原图可换；保存文案换「保存修改」） */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/70 pt-2.5">
            <button
              type="button"
              onClick={save}
              disabled={!canSave}
              title={!canSave ? t({ zh: '修正表单中标红项后可保存', en: 'Fix the flagged fields to save' }) : undefined}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-primary/45 bg-primary/10 px-3.5 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/15 disabled:pointer-events-none disabled:opacity-50"
              data-upload-save
            >
              {editMode ? <Pencil className="h-3.5 w-3.5" aria-hidden /> : <Wand2 className="h-3.5 w-3.5" aria-hidden />}
              {editMode
                ? t({ zh: '保存修改', en: 'Save changes' })
                : t({ zh: '保存为我的模板', en: 'Save as my template' })}
            </button>
            <button
              type="button"
              onClick={() => previewTpl && onPreviewApply(previewTpl)}
              disabled={!previewTpl || !hasStructure || invalidLines.length > 0 || !demoOk}
              title={hasStructure ? undefined : t({ zh: '先加载一个结构再预览', en: 'Load a structure first to preview' })}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/40 px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              {t({ zh: '先试效果', en: 'Try it first' })}
            </button>
            {!editMode && (
              <>
                <button
                  type="button"
                  onClick={() => void parse()}
                  className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border bg-muted/40 px-3 text-[12px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {t({ zh: '重新解析', en: 'Re-parse' })}
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="ml-auto flex h-8 cursor-pointer items-center gap-1 rounded-md px-2.5 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
                >
                  {t({ zh: '换一张图', en: 'New image' })}
                </button>
              </>
            )}
          </div>
        </>
      )}
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
                /* r98：自定义模板 id 必 404 于 /templates/*.png——复用卡片本体的
                   thumbSrc 三元（custom && thumb 走 dataURL），否则左栏恒占位渐变 */
                src={tpl.custom && tpl.thumb ? tpl.thumb : `/templates/${tpl.id}.png`}
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
  const customs = useCustomTemplates()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FigureCategory | 'all' | 'mine'>('all')
  // r75：对比视图状态（非空 = 对比模式，替换网格与过滤 chips）；
  // r79：上传视图（grid 网格 / upload 上传创建）；
  // r82：编辑视图（edit——复用上传面板的审核表单，editTarget 预填）；
  // 弹窗关闭时重置回图库（重开落在网格而非残留对比/编辑页——库的浏览语义）
  const [compareId, setCompareId] = useState<string | null>(null)
  const [view, setView] = useState<'grid' | 'upload' | 'edit'>('grid')
  const [editId, setEditId] = useState<string | null>(null)
  const importRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!open) { setCompareId(null); setView('grid'); setEditId(null) } }, [open])
  // 欢迎页画廊「＋ 从图片创建」入口：广播事件直达上传视图
  useEffect(() => {
    const onOpenUpload = () => { setCompareId(null); setView('upload'); setEditId(null) }
    window.addEventListener('open-template-upload', onOpenUpload)
    return () => window.removeEventListener('open-template-upload', onOpenUpload)
  }, [])
  // r85：欢迎页画廊卡「编辑」入口：广播事件直达编辑视图（detail.id = 自定义模板 id）；
  // 同时切到「我的模板」分区——关闭弹窗后回落到模板所属分区（浏览语义）
  useEffect(() => {
    const onOpenEdit = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id
      if (!id) return
      setCompareId(null)
      setView('edit')
      setEditId(id)
      setFilter('mine')
    }
    window.addEventListener('open-template-edit', onOpenEdit)
    return () => window.removeEventListener('open-template-edit', onOpenEdit)
  }, [])
  const allTemplates = [...FIGURE_TEMPLATES, ...customs]
  const compareTpl = allTemplates.find(x => x.id === compareId) ?? null
  const editTpl = view === 'edit' ? (customs.find(x => x.id === editId) ?? null) : null
  const shown =
    filter === 'all' ? allTemplates
    : filter === 'mine' ? customs
    : allTemplates.filter(x => x.category === filter)

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
      // r98：返回值感知——失败/超时不再弹「演示就绪」假成功
      // （fetch 失败已由 fetchPdbId 内部 toast，此处沉默不重复报错）
      const ok = await demoThenApply(tpl)
      if (ok) {
        toast.success(tt({ zh: `演示就绪：「${t(tpl.name)}」on ${tpl.demo}`, en: `Demo ready: "${t(tpl.name)}" on ${tpl.demo}` }))
      }
    } finally {
      // r98-f3：仅当 busyId 仍指向本模板时才清空——A 卡 demo 未完成时用户点 B 卡，
      // setBusyId(B) 后 A 的 finally 会连 B 的 spinner 一起误清（闭包比较防竞态）
      setBusyId(prev => (prev === tpl.id ? null : prev))
    }
  }

  const removeCustom = (tpl: FigureTemplate) => {
    const name = t(tpl.name)
    toast(tt({ zh: `删除自定义模板「${name}」？`, en: `Delete custom template "${name}"?` }), {
      action: {
        label: tt({ zh: '删除', en: 'Delete' }),
        onClick: () => {
          removeCustomTemplate(tpl.id)
          toast.success(tt({ zh: '已删除', en: 'Deleted' }))
        },
      },
      duration: 8000,
    })
  }

  // r82：导出——全量自定义模板 → JSON 文件下载（bundle 协议，跨设备迁移/团队共享）
  const exportCustoms = () => {
    if (customs.length === 0) return
    const blob = new Blob([exportCustomTemplates()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `molvision-templates-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(tt({ zh: `已导出 ${customs.length} 张自定义模板`, en: `Exported ${customs.length} custom templates` }), {
      description: tt({ zh: 'JSON 文件含命令序列与缩略图——导入到另一台设备即可复现', en: 'The JSON file carries commands & thumbnails — import it on another device to reproduce' }),
    })
  }

  // r82：导入——JSON 文件 → 逐张过存储侧防线 → 与现有按 id 合并（同 id 更新/新 id 追加）
  const onImportFile = async (f: File) => {
    if (f.size > 4 * 1024 * 1024) {
      toast.error(tt({ zh: '文件超过 4MB——不是常规模板导出（缩略图过多过大）', en: 'File exceeds 4MB — not a usual template export (too many/large thumbnails)' }))
      return
    }
    try {
      const text = await f.text()
      const { imported, updated, skipped } = importCustomTemplates(text)
      if (imported + updated === 0) {
        toast.error(tt({ zh: `没有可导入的模板（${skipped} 条无效——命令未过白名单或字段缺失）`, en: `No importable templates (${skipped} invalid — commands failed the whitelist or fields missing)` }))
        return
      }
      toast.success(tt({ zh: `导入完成：新增 ${imported} · 更新 ${updated}`, en: `Import done: ${imported} new · ${updated} updated` }), {
        description: skipped
          ? tt({ zh: `${skipped} 条无效条目已跳过（命令未过白名单或字段缺失）`, en: `${skipped} invalid entries skipped (whitelist or field failures)` })
          : tt({ zh: '在「我的模板」分区查看', en: 'Find them under "My templates"' }),
      })
      setFilter('mine')
    } catch (e) {
      toast.error(e instanceof Error && e.message === 'BAD_FILE'
        ? tt({ zh: '不是有效的模板 JSON 文件（需 MolVision 导出格式或模板数组）', en: 'Not a valid template JSON (MolVision export format or template array expected)' })
        : tt({ zh: '导入失败——文件读取异常', en: 'Import failed — file read error' }))
    } finally {
      if (importRef.current) importRef.current.value = ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={v => setUi({ templateOpen: v })}>
      {/* r98：高度约束——审核视图（原图+预览+精修卡+校准面板 ≈ 700-950px，移动端
          单列再叠表单 ≈ 1300px+）此前无任何滚动路径，Radix 锁 body 滚动后保存
          按钮在手机/矮桌面视口下不可达。max-h + overflow-y-auto 让对话框自身可滚
          （网格视图 62vh 内滚不受影响——外层永不超限） */}
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpenText className="h-4 w-4 text-primary" />
            {t({ zh: '论文图复现模板', en: 'Paper-figure templates' })}
          </DialogTitle>
          <DialogDescription>
            {t({
              zh: 'Cell / Nature / Science 结构文章的经典图式 + 互作分析（盐桥/氢键/DNA/阳离子-π）+ 位点特写（辅因子/金属/二硫键）+ 特定类型分析图（离子通道孔道等）——一键应用，命令透明可改，可对照原文图式；上传论文图可 AI 解析为你的自定义模板',
              en: 'Classic figure styles from Cell / Nature / Science papers + interaction analysis (salt bridges / H-bonds / DNA / cation–π) + site close-ups (cofactors / metals / disulfides) + type-specific figures (ion-channel pores etc.) — one click; transparent recipes, comparable against the originals. Upload a paper figure to parse it into your own custom template',
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
        ) : view === 'upload' ? (
          /* r79：从图片创建模板（上传 → AI 解析 → 审核入库） */
          <UploadPanel
            onBack={() => setView('grid')}
            onSaved={() => { setView('grid'); setFilter('mine') }}
            onPreviewApply={tpl => apply(tpl)}
          />
        ) : view === 'edit' && editTpl ? (
          /* r82：编辑自定义模板（复用审核表单预填；保存即更新，命令重过闸） */
          <UploadPanel
            editTarget={editTpl}
            onBack={() => setView('grid')}
            onSaved={() => { setView('grid'); setFilter('mine') }}
            onPreviewApply={tpl => apply(tpl)}
          />
        ) : (
          <>
            {/* 分类过滤 chips（六分类 + 我的模板）+ 上传创建入口 */}
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t({ zh: '模板分类', en: 'Template categories' })}>
              {FIGURE_CATEGORIES.map(c => {
                const n = c.key === 'all' ? allTemplates.length : allTemplates.filter(x => x.category === c.key).length
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
              {customs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilter('mine')}
                  aria-pressed={filter === 'mine'}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer',
                    filter === 'mine'
                      ? 'border-violet-500/60 bg-violet-500/10 text-violet-600 dark:text-violet-400'
                      : 'border-violet-500/30 bg-violet-500/[0.06] text-violet-600/80 hover:bg-violet-500/12 dark:text-violet-400/80',
                  )}
                >
                  {t({ zh: '我的模板', en: 'My templates' })}
                  <span className="ml-1 font-mono text-[9px] opacity-70">{customs.length}</span>
                </button>
              )}
              {/* r79 上传创建入口 + r82 导入导出（库的一等公民入口；导出无模板时置灰） */}
              <button
                type="button"
                onClick={() => setView('upload')}
                data-open-upload
                className="ml-auto flex items-center gap-1 rounded-full border border-primary/45 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/15 cursor-pointer"
                title={t({ zh: '上传论文图，AI 解析图式生成自定义模板', en: 'Upload a paper figure — the AI parses the style into a custom template' })}
              >
                <ImagePlus className="h-3 w-3" aria-hidden />
                {t({ zh: '从图片创建', en: 'From image' })}
              </button>
              <button
                type="button"
                onClick={() => importRef.current?.click()}
                data-import-templates
                className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground cursor-pointer"
                title={t({ zh: '导入模板 JSON 文件（与现有模板合并，命令重新校验）', en: 'Import a template JSON file (merged with existing; commands re-validated)' })}
              >
                <Upload className="h-3 w-3" aria-hidden />
                {t({ zh: '导入', en: 'Import' })}
              </button>
              <button
                type="button"
                onClick={exportCustoms}
                disabled={customs.length === 0}
                data-export-templates
                className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
                title={customs.length
                  ? t({ zh: `导出 ${customs.length} 张自定义模板为 JSON（跨设备迁移/分享）`, en: `Export ${customs.length} custom templates as JSON (migrate / share)` })
                  : t({ zh: '还没有可导出的自定义模板', en: 'No custom templates to export yet' })}
              >
                <Download className="h-3 w-3" aria-hidden />
                {t({ zh: '导出', en: 'Export' })}
              </button>
              <input
                ref={importRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) void onImportFile(f) }}
              />
            </div>

            <div className="mol-scroll -mx-1 max-h-[62vh] overflow-y-auto px-1">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {shown.map(tpl => (
                  <TemplateCard
                    key={tpl.id}
                    tpl={tpl}
                    index={allTemplates.indexOf(tpl)}
                    busy={busyId === tpl.id || loading}
                    onApply={() => apply(tpl)}
                    onDemo={() => void demo(tpl)}
                    onCompare={() => setCompareId(tpl.id)}
                    onDelete={tpl.custom ? () => removeCustom(tpl) : undefined}
                    onEdit={tpl.custom ? () => { setCompareId(null); setEditId(tpl.id); setView('edit') } : undefined}
                  />
                ))}
              </div>
              {filter === 'mine' && customs.length === 0 && (
                <div className="flex flex-col items-center gap-2.5 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
                  <ImagePlus className="h-8 w-8 text-muted-foreground/60" aria-hidden />
                  <p className="text-[12px] font-semibold">{t({ zh: '还没有自定义模板', en: 'No custom templates yet' })}</p>
                  <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                    {t({ zh: '上传一张论文/科研分子图，AI 将解析其图式配方（表示法·配色·视角）并生成可编辑命令模板', en: 'Upload a paper or scientific molecular figure — the AI parses its style recipe (representations · colors · camera) into an editable command template' })}
                  </p>
                  <button
                    type="button"
                    onClick={() => setView('upload')}
                    className="mt-1 flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-primary/45 bg-primary/10 px-3.5 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/15"
                  >
                    <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                    {t({ zh: '上传第一张图', en: 'Upload your first image' })}
                  </button>
                </div>
              )}
            </div>

            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
              <Wand2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {t({
                zh: '模板复现的是图式视觉配方（表示法·配色·视角·灯光·轮廓）与分析命令（孔道剖面/脂双层/盐桥/氢键），不含论文原图；卡片缩略图由 MolVision 引擎对代表结构真实渲染。点卡片右下「对比」可与原论文图式逐项对照；点右上「从图片创建」用 AI 把你自己的论文图变成新模板。',
                en: 'Templates reproduce figure-style recipes (representations · coloring · camera · lighting · outlines) and analysis commands (pore profiles / bilayers / salt bridges / H-bonds), not original artwork; card thumbnails are genuine engine renders. Use "Compare" on a card to check the recipe against the original paper figure — or "From image" to turn your own figure into a new template with AI.',
              })}
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
