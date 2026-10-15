'use client'

// 欢迎页 r124「学术期刊扉页」全面重设计：
// ─────────────────────────────────────────────────────────────────────────────
// 设计概念：MolVision 的灵魂是复现 Cell/Nature/Science 的论文图式——那么欢迎页
// 本身就该被排印成一页期刊。概念驱动（而非装饰驱动）是去「AI 味」的根本：
//   · 刊眉顶栏：六角铭印 + 衬线字标 MolVision + 小写字距副题
//   · 扉页 hero：卷期元数据行（VOL.16 · WEBGL · RCSB LIVE · N STYLES——原遥测
//     板的信息以排印形式保留）+ 衬线大标题（斜体重点词 + 墨线绘入）+ 进样表单
//     （大号等宽字 + 墨色下划线 + 墨块 CTA）+ 右侧「图版 A/B」hero 构图
//     （引擎真实渲染的作品，配期刊溯源图注；点击即演示加载）
//   · §01 经典结构：索引式列表（期刊目次惯例——等宽编号 + PDB 号 + 条目行）
//   · §02 论文图式：下划线过滤页签（坐在发丝基线上）+ Fig. 编号画廊卡
//     （硬角发丝图版框 + 三行图注：名称/图注/溯源）+ 移动端分类横滚行
//   · 诚实脚注（细小学注）+ 素纸页脚（待机 · 快捷键 · 语言）
//
// 去噪清单（r45/r68/r74 时代装饰资产退役）：三轨道电子巡航 / 六角 halo 呼吸 /
// 原子核呼吸 / LED 待机脉冲 / 晶体按键 CTA / 遥测读数板 / 墨色仪表底座 /
// 毛玻璃卡片堆叠 / 取景框角刻度。保留：welcome-in 错峰入场（克制的 460ms 上浮）
// 与 gallery 错峰淡入。
//
// 功能全量保留：PDB 表单校验 / 本地文件（r99 value 清空）/ 全页拖放 /
// 会话恢复 / 分享链接粘贴卡 / 6 经典示例 / 画廊分类过滤 / 移动端分类横滚行
// （r89 去重架构）/ 返回分类锚点（r90）/ 自定义模板行与直编（r85）/
// 从图片创建 / 在库中浏览 / 空态引导 / 诚实版权脚注 / AI 胶囊与面板 /
// 主题 · GitHub · 语言切换 / 精确指针自动聚焦。
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUpRight, BookOpenText, Bot, ChevronRight,
  FileUp, FolderOpen, Github, ImagePlus, Loader2, Moon, Pencil, Play, Sun, Wand2,
} from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { useI18n, tt, type DualText } from '@/i18n'
import { EXAMPLE_STRUCTURES, fetchPdbId, loadFiles } from '@/lib/molecular/loader'
import {
  demoThenApply, FIGURE_CATEGORIES, FIGURE_TEMPLATES,
  type FigureCategory, type FigureTemplate,
} from '@/lib/molecular/figure-templates'
import { useCustomTemplates } from '@/lib/molecular/custom-templates'
import { ACCENT, TPL_ICONS } from './FigureTemplatesDialog'
import { SessionResumeSlot } from './SessionResumeCard'
import { ShareLinkLoadCard } from './ShareLinkLoadCard'
import { AgentPanel } from './AgentPanel'
import { LanguageToggle } from './LanguageToggle'
import { cn } from '@/lib/utils'

/** 欢迎页示例精选（6 个均衡覆盖小蛋白/酶/四聚体/DNA/药物靶点；完整列表在加载对话框） */
const WELCOME_EXAMPLES = EXAMPLE_STRUCTURES.filter(ex => ex.id !== '1D3Z')

/** 扉页图版选目：墨夜封面（深底封面语态）+ 白瓷影棚（单柔光棚拍语态）——明暗两极
 *  的代表作品，且缩略图为引擎真实渲染产物 */
const PLATE_A = 'ink-night-cover'
const PLATE_B = 'porcelain-studio'

// ── 共用缩略图（引擎真实渲染 PNG；缺图 → 强调色渐变占位；自定义模板为 dataURL） ──
function PlateImg({ tpl, alt, className }: { tpl: FigureTemplate; alt: string; className?: string }) {
  const [imgOk, setImgOk] = useState(true)
  const a = ACCENT[tpl.accent]
  if (!imgOk) {
    return (
      <span aria-hidden className={cn('plate-fallback absolute inset-0 flex items-center justify-center bg-gradient-to-br', a.grad)}>
        <BookOpenText className={cn('h-8 w-8 opacity-60', a.text)} />
      </span>
    )
  }
  return (
    // 静态资源缩略图（管线产物，非内容图）
    <img
      src={tpl.custom && tpl.thumb ? tpl.thumb : `/templates/${tpl.id}.png`}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setImgOk(false)}
      className={className}
    />
  )
}

// ── 扉页图版（Plate）：装裱印版（发丝框 + 印刷留白边）+ 期刊图注；点击即演示 ──
function HeroPlate({ tpl, label, aspect, className, delay, busy, onDemo }: {
  tpl: FigureTemplate
  label: DualText
  aspect: string
  className?: string
  delay: string
  busy: boolean
  onDemo: () => void
}) {
  const { t } = useI18n()
  return (
    <figure className={cn('journal-row-in m-0', className)} style={{ animationDelay: delay }}>
      <button
        type="button"
        onClick={onDemo}
        disabled={busy}
        title={t({
          zh: `加载演示结构 ${tpl.demo} 并应用「${t(tpl.name)}」图式`,
          en: `Load demo structure ${tpl.demo} with the "${t(tpl.name)}" style applied`,
        })}
        className="plate-frame group block w-full cursor-pointer text-left disabled:pointer-events-none disabled:opacity-60"
      >
        <span className={cn('relative block w-full overflow-hidden', aspect)}>
          <PlateImg
            tpl={tpl}
            alt={t(tpl.tagline)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          {/* 演示徽章（常显——触屏无 hover；PDB 号即「点会发生什么」的说明） */}
          <span className="absolute bottom-1.5 right-1.5 flex h-5 items-center gap-1 border border-foreground/15 bg-background/85 px-1.5 font-mono text-[9px] font-semibold leading-none backdrop-blur-sm">
            <Play className="h-2 w-2" aria-hidden />
            {tpl.demo}
          </span>
          {tpl.custom && (
            <span className="absolute left-1.5 top-1.5 bg-violet-500/85 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.1em] text-white">
              {t({ zh: '自定义', en: 'CUSTOM' })}
            </span>
          )}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </span>
          )}
        </span>
      </button>
      <figcaption className="mt-2 flex items-baseline gap-2">
        <span className="journal-kicker shrink-0 text-primary">{t(label)}</span>
        <span className="font-serif-editorial truncate text-[12.5px] font-semibold leading-tight">{t(tpl.name)}</span>
        <span className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">
          {tpl.citation.journal} · {tpl.citation.year}
        </span>
      </figcaption>
    </figure>
  )
}

// ── r89 移动端分类横滚行卡片（紧凑图版：缩略图 + 名称行；行内以图像为主角） ──
function RowCard({ tpl, delay, busy, onDemo }: {
  tpl: FigureTemplate
  delay: string
  busy: boolean
  onDemo: () => void
}) {
  const { t } = useI18n()
  const Icon = TPL_ICONS[tpl.id] ?? BookOpenText
  const a = ACCENT[tpl.accent]
  return (
    <button
      type="button"
      data-welcome-row-card={tpl.id}
      onClick={onDemo}
      disabled={busy}
      /* r98：无显式 role——显式 role 会压掉隐式 button 语义；父 list 的条目语义
         由 ARIA 包裹承担（listbox/listitem 在 button 上均非法） */
      title={t({
        zh: `加载演示结构 ${tpl.demo} 并应用「${t(tpl.name)}」图式`,
        en: `Load demo structure ${tpl.demo} with the "${t(tpl.name)}" style applied`,
      })}
      className={cn(
        'journal-row-in group relative w-[124px] shrink-0 cursor-pointer snap-start border border-foreground/12 bg-card text-left transition-[border-color] duration-150 hover:border-primary/45 sm:w-[136px]',
        a.text,
      )}
      style={{ animationDelay: delay }}
    >
      <span className="relative block aspect-[16/10] w-full overflow-hidden bg-muted/40">
        <PlateImg
          tpl={tpl}
          alt={t(tpl.tagline)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        {/* 演示徽章（常显——触屏无 hover） */}
        <span className="absolute bottom-1.5 right-1.5 flex h-5 items-center gap-1 border border-foreground/15 bg-background/85 px-1.5 font-mono text-[9px] font-semibold leading-none backdrop-blur-sm">
          <Play className="h-2 w-2" aria-hidden />
          {tpl.demo}
        </span>
        {tpl.custom && (
          <span className="absolute left-1.5 top-1.5 bg-violet-500/85 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.1em] text-white">
            {t({ zh: '自定义', en: 'CUSTOM' })}
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </span>
        )}
      </span>
      <span className="flex items-center gap-1 px-2 py-1.5">
        <Icon className={cn('h-3 w-3 shrink-0', a.text)} aria-hidden />
        <span className="truncate text-[11px] font-semibold leading-tight text-foreground">{t(tpl.name)}</span>
      </span>
    </button>
  )
}

// ── 画廊图版卡（Fig. 编号 + 三行图注：名称/图注/溯源——期刊图版惯例） ──
function GalleryCard({ tpl, index, busy, onDemo, onEdit }: {
  tpl: FigureTemplate
  index: number
  busy: boolean
  onDemo: () => void
  /** r85：自定义模板编辑入口（仅 custom 卡渲染；直通弹窗编辑视图） */
  onEdit?: () => void
}) {
  const { t } = useI18n()
  const Icon = TPL_ICONS[tpl.id] ?? BookOpenText
  const a = ACCENT[tpl.accent]
  const figLabel = t({ zh: `图 ${String(index + 1).padStart(2, '0')}`, en: `Fig. ${String(index + 1).padStart(2, '0')}` })

  return (
    <article className="journal-row-in group relative" style={{ animationDelay: `${320 + index * 25}ms` }}>
      <button
        type="button"
        onClick={onDemo}
        disabled={busy}
        title={t({
          zh: `加载演示结构 ${tpl.demo} 并应用「${t(tpl.name)}」图式`,
          en: `Load demo structure ${tpl.demo} with the "${t(tpl.name)}" style applied`,
        })}
        className="block w-full cursor-pointer text-left disabled:pointer-events-none"
      >
        {/* 装裱图版：发丝外框 + 印刷留白边 + 发丝内框（悬停态由 .plate-frame 的
            未分层 CSS 直供——Tailwind group-hover 会被其压过） */}
        <span className="plate-frame relative block">
          <span className="relative block aspect-[16/10] w-full overflow-hidden bg-muted/40">
            <PlateImg
              tpl={tpl}
              alt={t(tpl.tagline)}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            />
            {/* 自定义紫印（语义标记保留）；内置卡无角标——图号移至图注行 */}
            {tpl.custom && (
              <span className="absolute left-1.5 top-1.5 bg-violet-500/85 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em] text-white">
                {t({ zh: '自定义', en: 'CUSTOM' })}
              </span>
            )}
            {/* 演示徽章（hover 浮现；触屏恒显） */}
            <span className={cn(
              'absolute bottom-1.5 right-1.5 flex h-6 items-center gap-1 border border-foreground/15 bg-background/85 px-2 font-mono text-[10px] font-semibold backdrop-blur-sm transition-opacity duration-200',
              'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
            )}>
              <Play className="h-2.5 w-2.5" aria-hidden />
              {tpl.demo}
            </span>
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </span>
            )}
          </span>
        </span>

        {/* 图注三行（期刊图版说明） */}
        <span className="mt-2.5 flex items-baseline gap-2">
          <span className="font-serif-editorial truncate text-[15px] font-semibold leading-snug">{t(tpl.name)}</span>
          <span className="ml-auto shrink-0 font-mono text-[10px] font-medium text-muted-foreground">{tpl.demo}</span>
        </span>
        <span className="mt-1 block truncate text-[11px] leading-relaxed text-muted-foreground" title={t(tpl.tagline)}>
          {t(tpl.tagline)}
        </span>
        <span className="mt-1.5 flex items-center gap-1.5">
          <span className="shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">{figLabel}</span>
          <span className="shrink-0 font-mono text-[9px] text-muted-foreground/75">· {tpl.citation.journal} {tpl.citation.year}</span>
          <span className={cn('ml-auto shrink-0 font-mono text-[9px] text-muted-foreground/60', a.text)}>
            {tpl.commands.length} {t({ zh: '条命令', en: 'cmds' })}
          </span>
        </span>
      </button>
      {/* r85：自定义模板管理排（主 button 兄弟节点——嵌套 button 不合法） */}
      {tpl.custom && onEdit && (
        <div
          role="group"
          aria-label={t({ zh: '自定义模板管理', en: 'Custom template management' })}
          className="mt-2 flex items-center gap-1.5 border-t border-foreground/10 pt-2"
        >
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-violet-500/90">UGC</span>
          <span className="truncate text-[10px] text-muted-foreground">{t({ zh: '自定义模板', en: 'Custom template' })}</span>
          <button
            type="button"
            data-welcome-tpl-edit
            onClick={onEdit}
            title={t({ zh: '编辑这张模板的命令序列与元数据', en: 'Edit this template\'s command recipe and metadata' })}
            className="ml-auto inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 text-[10.5px] font-semibold text-violet-600 transition-colors hover:text-violet-500 dark:text-violet-400 dark:hover:text-violet-300"
          >
            <Pencil className="h-3 w-3" aria-hidden />
            {t({ zh: '编辑', en: 'Edit' })}
          </button>
        </div>
      )}
    </article>
  )
}

export function WelcomeScreen() {
  const { t, locale } = useI18n()
  const { resolvedTheme, setTheme } = useTheme()
  const loading = useMolStore(s => s.loading)
  const loadingMsg = useMolStore(s => s.loadingMsg)
  const agentOpen = useMolStore(s => s.ui.agentOpen)
  const setUi = useMolStore(s => s.setUi)
  const customs = useCustomTemplates()
  const [id, setId] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [filter, setFilter] = useState<FigureCategory | 'all' | 'mine'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // r79：画廊 = 内置 + 自定义同源合并（计数/过滤/序号统一口径）
  const allTemplates = [...FIGURE_TEMPLATES, ...customs]
  const shown =
    filter === 'all' ? allTemplates
    : filter === 'mine' ? customs
    : allTemplates.filter(x => x.category === filter)
  // r89：移动端分类横滚行数据（<lg 且 filter='all'——每支模板恰好出现一次）
  const catRows: { key: string; label: DualText; tpls: FigureTemplate[] }[] = [
    ...FIGURE_CATEGORIES.filter(c => c.key !== 'all').map(c => ({
      key: c.key as string,
      label: c.label,
      tpls: allTemplates.filter(x => x.category === c.key),
    })),
    ...(customs.length > 0 ? [{
      key: 'mine',
      label: { zh: '我的模板', en: 'My templates' },
      tpls: customs,
    }] : []),
  ]
  // 扉页图版（缺图时渐变占位兜底）
  const plateA = FIGURE_TEMPLATES.find(x => x.id === PLATE_A) ?? FIGURE_TEMPLATES[0]
  const plateB = FIGURE_TEMPLATES.find(x => x.id === PLATE_B) ?? FIGURE_TEMPLATES[1]

  // 精确指针设备才自动聚焦（触屏避免弹出键盘）
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  const submitId = () => {
    const v = id.trim().toUpperCase()
    if (!v) return
    if (!/^[0-9][A-Z0-9]{3}$/.test(v)) {
      toast.error(tt({ zh: 'PDB 编号为 4 位字符（如 4HHB、1CRN）', en: 'PDB ID is 4 characters (e.g. 4HHB, 1CRN)' }))
      return
    }
    void fetchPdbId(v)
  }

  // 图版/画廊卡 → 演示加载（demoThenApply：加载代表结构 + 应用图式命令序列）
  // r98：返回值感知——失败/超时不弹「演示就绪」假成功
  const demo = async (tpl: FigureTemplate) => {
    if (busyId || loading) return
    setBusyId(tpl.id)
    try {
      const ok = await demoThenApply(tpl)
      if (ok) {
        toast.success(tt({ zh: `演示就绪：「${t(tpl.name)}」on ${tpl.demo}`, en: `Demo ready: "${t(tpl.name)}" on ${tpl.demo}` }))
      }
    } catch {
      toast.error(tt({ zh: '演示加载失败——请稍后重试', en: 'Demo failed to load — please retry' }))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div
      className="relative flex h-full w-full flex-col overflow-hidden bg-background"
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver(false)
      }}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files?.length) loadFiles(e.dataTransfer.files)
      }}
    >
      {/* ── 刊眉顶栏：六角铭印 + 衬线字标 + 小写字距副题；右：主题 · GitHub ── */}
      <header
        data-welcome-topbar
        className="welcome-in relative z-30 flex h-12 shrink-0 items-center gap-3 border-b border-foreground/12 px-4 sm:px-6"
        style={{ animationDelay: '40ms' }}
      >
        <svg viewBox="0 0 28 28" className="h-[18px] w-[18px] shrink-0" aria-hidden>
          <polygon points="14,1 25.1,7.25 25.1,20.75 14,27 2.9,20.75 2.9,7.25" className="fill-primary" />
          <g fill="none" stroke="currentColor" strokeWidth="1" className="text-primary-foreground" opacity="0.9">
            <ellipse cx="14" cy="14" rx="8" ry="3" />
            <ellipse cx="14" cy="14" rx="8" ry="3" transform="rotate(60 14 14)" />
          </g>
        </svg>
        <span className="font-serif-editorial text-[17px] font-semibold leading-none tracking-[-0.01em]">MolVision</span>
        <span className="journal-kicker hidden text-muted-foreground/80 lg:block">Molecular Visualization Studio</span>
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            suppressHydrationWarning
            aria-label={t({ zh: '切换深浅主题', en: 'Toggle light/dark theme' })}
            className="flex h-8 w-8 cursor-pointer items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <Sun className="h-4 w-4 hidden dark:block" />
            <Moon className="h-4 w-4 dark:hidden" />
          </button>
          <a
            href="https://github.com/Jing0715-fer/MolVision"
            target="_blank"
            rel="noreferrer"
            aria-label={t({ zh: 'GitHub 仓库', en: 'GitHub repository' })}
            className="flex h-8 w-8 items-center justify-center text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </header>

      {/* ── 主体：期刊单栏（居中版心 + 发丝章节线；单列滚动） ── */}
      <div className="mol-scroll relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1080px] px-4 pb-16 sm:px-8">

          {/* ══ 扉页 hero：刊眉 + 衬线大标题 + 进样表单 ｜ 图版 A/B ══ */}
          <section className="grid gap-10 pb-14 pt-8 sm:pt-12 lg:grid-cols-12 lg:gap-12">
            {/* 左：排印主体（<lg 单列——进样表单先于图版，核心流程最短路径） */}
            <div className="order-1 flex flex-col lg:col-span-7">
              {/* 卷期元数据行（原遥测板信息的排印化：版本/引擎/数据源/图式数） */}
              <div className="welcome-in journal-kicker text-muted-foreground" style={{ animationDelay: '80ms' }}>
                VOL.16<span className="jk-sep">·</span>WEBGL<span className="jk-sep">·</span>RCSB&nbsp;LIVE<span className="jk-sep">·</span>{allTemplates.length}&nbsp;STYLES
              </div>

              <h1
                className="welcome-in font-serif-editorial mt-5 text-[clamp(28px,4.4vw,50px)] font-medium leading-[1.16] tracking-[-0.012em]"
                style={{ animationDelay: '120ms' }}
              >
                {locale === 'zh' ? (
                  <>把蛋白质、核酸与配体，<br />排成<span className="accent-ink text-primary">值得发表的图</span>。</>
                ) : (
                  <>Proteins, nucleic acids &amp; ligands,<br />set as <span className="accent-ink italic text-primary">publication-worthy</span> figures.</>
                )}
              </h1>
              <p className="welcome-in mt-5 max-w-md text-[13px] leading-relaxed text-muted-foreground" style={{ animationDelay: '160ms' }}>
                {t({
                  zh: '在浏览器中探索蛋白质 · 核酸 · 配体与电子密度——渲染、测量、排版一气呵成。',
                  en: 'Explore proteins · nucleic acids · ligands & electron density in the browser — render, measure, and typeset in one flow.',
                })}
              </p>

              {/* 进样表单：大号等宽字 + 墨色下划线 + 墨块 CTA（期刊语态的「投稿」行） */}
              <form
                onSubmit={e => { e.preventDefault(); submitId() }}
                className="welcome-in mt-9 flex w-full max-w-md items-end gap-3"
                style={{ animationDelay: '200ms' }}
              >
                <label className="min-w-0 flex-1">
                  <span className="journal-kicker block text-muted-foreground">
                    {t({ zh: 'PDB 编号 · RCSB 实时', en: 'PDB ID · RCSB LIVE' })}
                  </span>
                  <input
                    ref={inputRef}
                    value={id}
                    onChange={e => setId(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
                    maxLength={4}
                    placeholder={t({ zh: '如 4HHB', en: 'e.g. 4HHB' })}
                    aria-label={t({ zh: 'PDB 编号', en: 'PDB ID' })}
                    autoComplete="off"
                    spellCheck={false}
                    className="mt-2 h-11 w-full border-0 border-b-2 border-foreground/25 bg-transparent font-mono text-[22px] font-medium uppercase leading-none tracking-[0.3em] text-foreground caret-primary outline-none transition-[border-color] duration-200 placeholder:font-sans placeholder:text-[12px] placeholder:font-normal placeholder:normal-case placeholder:tracking-[0.06em] placeholder:text-muted-foreground/70 hover:border-foreground/45 focus-visible:border-primary dark:border-white/20 dark:hover:border-white/35"
                  />
                </label>
                <button
                  type="submit"
                  disabled={loading || id.length !== 4}
                  className="flex h-[46px] shrink-0 select-none items-center gap-2 bg-foreground px-5 font-mono text-[12.5px] font-semibold uppercase tracking-[0.08em] text-background transition-[background-color,color,translate] duration-150 hover:bg-primary hover:text-primary-foreground active:translate-y-px disabled:pointer-events-none disabled:opacity-35 dark:bg-foreground dark:text-background dark:hover:bg-primary dark:hover:text-primary-foreground"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {t({ zh: '载入', en: 'Load' })}
                  {!loading && <ArrowRight className="h-3.5 w-3.5" aria-hidden />}
                </button>
              </form>

              {/* 状态行：固定高度避免加载态布局位移；r124 终端式就绪反馈——
                  合法 4 位编号即时回显待发目标（期刊排印 × 仪器终端的交叉语态） */}
              <div className="welcome-in mt-3 flex h-4 w-full max-w-md items-center" style={{ animationDelay: '240ms' }}>
                {loading ? (
                  <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-primary">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {loadingMsg || t({ zh: '处理中…', en: 'Processing…' })}
                  </span>
                ) : /^[0-9][A-Z0-9]{3}$/.test(id) ? (
                  <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-primary/90">
                    <span aria-hidden>&gt;</span>
                    {t({ zh: `待发 ${id} · RCSB 实时`, en: `ready: fetch ${id} from RCSB` })}
                  </span>
                ) : (
                  <span className="text-[10.5px] text-muted-foreground">
                    {t({ zh: 'RCSB 实时获取 · 可拖放文件到页面任意位置', en: 'Live from RCSB PDB · drag & drop files anywhere' })}
                  </span>
                )}
              </div>

              {/* 本地文件：排印链接（正字重 + 下划线偏移），格式族等宽小学注 */}
              <div className="welcome-in mt-5 flex w-full max-w-md flex-wrap items-baseline gap-x-4 gap-y-2" style={{ animationDelay: '280ms' }}>
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={loading}
                  className="group inline-flex cursor-pointer items-center gap-1.5 text-[12.5px] font-medium text-foreground/85 underline decoration-foreground/25 underline-offset-4 transition-colors duration-150 hover:text-primary hover:decoration-primary/60 disabled:pointer-events-none disabled:opacity-50"
                >
                  <FolderOpen className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-px" aria-hidden />
                  {t({ zh: '打开本地文件…', en: 'Open local file…' })}
                </button>
                <span className="font-mono text-[9.5px] tracking-wide text-muted-foreground/80">
                  PDB / CIF / CCP4 / .molvision
                </span>
              </div>

              {/* 会话区：恢复卡（有存档时挂载）+ r86 分享链接粘贴卡 */}
              <div className="welcome-in mt-7 flex w-full max-w-md flex-col gap-2.5" style={{ animationDelay: '320ms' }}>
                <SessionResumeSlot />
                <ShareLinkLoadCard />
              </div>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".pdb,.ent,.cif,.mmcif,.txt,.molvision,.json,.ccp4,.map,.mrc"
                className="hidden"
                onChange={e => {
                  if (e.target.files?.length) loadFiles(e.target.files)
                  // r99：清 value——解析失败后重选同一文件不派发 change（重试静默失效）
                  e.target.value = ''
                }}
              />
            </div>

            {/* 右：图版 A/B（引擎真实渲染的代表作品；<lg 移至进样表单之后） */}
            <div className="order-2 lg:col-span-5 lg:pt-1">
              <HeroPlate
                tpl={plateA}
                label={{ zh: '图版 A', en: 'PLATE A' }}
                aspect="aspect-[4/3]"
                delay="360ms"
                busy={busyId === plateA.id || loading}
                onDemo={() => void demo(plateA)}
              />
              <div className="mt-4 flex items-stretch gap-4 lg:mt-5">
                <HeroPlate
                  tpl={plateB}
                  label={{ zh: '图版 B', en: 'PLATE B' }}
                  aspect="aspect-[4/3]"
                  className="w-[72%] shrink-0"
                  delay="400ms"
                  busy={busyId === plateB.id || loading}
                  onDemo={() => void demo(plateB)}
                />
                {/* 图库索引栏（sm+）：计数 + 衬线小标 + 引导至画廊章节 */}
                <a
                  href="#welcome-gallery"
                  className="welcome-in group hidden flex-col items-start gap-1.5 self-st border-l border-foreground/12 pl-4 sm:flex"
                  style={{ animationDelay: '440ms' }}
                >
                  <span className="font-mono text-[11px] font-bold tabular-nums leading-none text-primary">{allTemplates.length}</span>
                  <span className="font-serif-editorial text-[13.5px] font-semibold leading-tight">
                    {t({ zh: '图式全库', en: 'Full library' })}
                  </span>
                  <span className="text-[9.5px] leading-relaxed text-muted-foreground">
                    {t({ zh: '同类多风格 · 可上传你的论文图', en: 'Same-type variants · upload your own figure' })}
                  </span>
                  <ArrowDown className="mt-auto h-3.5 w-3.5 text-muted-foreground transition-[color,translate] duration-200 group-hover:translate-y-0.5 group-hover:text-primary" aria-hidden />
                </a>
              </div>
            </div>
          </section>

          {/* ══ §01 经典结构：索引式列表（期刊目次惯例） ══ */}
          <section aria-label={t({ zh: '经典结构索引', en: 'Classic structures index' })}>
            <header
              className="welcome-in flex items-baseline gap-3 border-b border-foreground/15 pb-3"
              style={{ animationDelay: '380ms' }}
            >
              <span className="font-mono text-[11px] font-semibold tabular-nums text-primary">§01</span>
              <h2 className="font-serif-editorial text-[21px] font-semibold leading-none tracking-[-0.01em]">
                {t({ zh: '经典结构', en: 'Classic structures' })}
              </h2>
              <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
                {WELCOME_EXAMPLES.length} {t({ zh: '条目', en: 'entries' })}
              </span>
            </header>
            <ol className="m-0 list-none p-0" role="list">
              {WELCOME_EXAMPLES.map((ex, i) => (
                <li key={ex.id} role="listitem">
                  <button
                    onClick={() => void fetchPdbId(ex.id)}
                    disabled={loading}
                    className="journal-row-in group grid w-full cursor-pointer grid-cols-[2rem_4rem_1fr_auto] items-baseline gap-x-3 border-b border-foreground/10 py-3.5 text-left transition-colors duration-150 hover:bg-foreground/[0.035] disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-white/[0.04]"
                    style={{ animationDelay: `${400 + i * 35}ms` }}
                  >
                    <span className="font-mono text-[10px] tabular-nums leading-none text-muted-foreground/70">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="font-mono text-[13px] font-bold leading-none tracking-[0.06em] text-primary">{ex.id}</span>
                    <span className="flex min-w-0 items-baseline gap-2.5 leading-none">
                      <span className="truncate text-[14px] font-semibold leading-none" title={t(ex.title)}>{t(ex.title)}</span>
                      <span className="hidden truncate text-[11.5px] leading-none text-muted-foreground sm:inline" title={t(ex.desc)}>{t(ex.desc)}</span>
                    </span>
                    <ArrowRight
                      className="h-3.5 w-3.5 -translate-x-1 text-primary opacity-0 transition-[opacity,translate] duration-200 group-hover:translate-x-0 group-hover:opacity-100"
                      aria-hidden
                    />
                  </button>
                </li>
              ))}
            </ol>
          </section>

          {/* ══ §02 论文图式：过滤页签 + Fig. 编号画廊 ══ */}
          <section id="welcome-gallery" aria-label={t({ zh: '论文图模板画廊', en: 'Paper-figure template gallery' })} className="scroll-mt-2 pt-12">
            <header
              className="welcome-in flex flex-wrap items-baseline gap-x-3 gap-y-2 border-b border-foreground/15 pb-3"
              style={{ animationDelay: '420ms' }}
            >
              <span className="font-mono text-[11px] font-semibold tabular-nums text-primary">§02</span>
              <h2 className="font-serif-editorial text-[21px] font-semibold leading-none tracking-[-0.01em]">
                {t({ zh: '论文图式', en: 'Figure styles' })}
              </h2>
              <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                {allTemplates.length} {t({ zh: '式', en: 'styles' })}
              </span>
              {/* 右：图库动作（排印链接族——主链接 + 次链接） */}
              <div className="ml-auto flex items-center gap-4">
                <button
                  type="button"
                  data-welcome-create-template
                  onClick={() => { setUi({ templateOpen: true }); window.dispatchEvent(new CustomEvent('open-template-upload')) }}
                  className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 text-[11.5px] font-semibold text-primary transition-colors duration-150 hover:text-primary/75"
                  title={t({ zh: '上传论文图，AI 解析图式生成你的自定义模板', en: 'Upload a paper figure — the AI parses it into your custom template' })}
                >
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                  {t({ zh: '从图片创建', en: 'From image' })}
                </button>
                <button
                  type="button"
                  onClick={() => setUi({ templateOpen: true })}
                  className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 text-[11.5px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
                  title={t({ zh: '打开完整模板库（可应用到已加载结构）', en: 'Open the full template library (applies to loaded structures)' })}
                >
                  {t({ zh: '在库中浏览', en: 'Browse library' })}
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </button>
              </div>
            </header>
            <p className="welcome-in mt-2.5 max-w-2xl text-[11px] leading-relaxed text-muted-foreground" style={{ animationDelay: '450ms' }}>
              {t({
                zh: 'Cell / Nature / Science 结构文章的经典图式——缩略图由引擎真实渲染，点击卡片即刻加载演示结构并应用；同类多风格（明暗/键连/立体/剖切/线描/灰度/静电/水合…）与上传你自己的论文图 AI 解析为新模板均可。',
                en: 'Classic figure styles from Cell / Nature / Science papers — thumbnails are genuine engine renders; click a card to load the demo structure with the style applied. Same-type variants (dark / bonding / stereo / cutaway / wire / grayscale / electrostatic / hydration…) and AI-parsed uploads included.',
              })}
            </p>

            {/* 过滤页签（下划线坐发丝基线；sticky 毛玻璃常驻便于长画廊随手过滤） */}
            <div
              role="group"
              aria-label={t({ zh: '画廊分类', en: 'Gallery categories' })}
              className="gallery-head-blur mol-toolbar-scroll sticky top-0 z-10 mt-5 flex items-center gap-5 overflow-x-auto border-b border-foreground/15"
            >
              {FIGURE_CATEGORIES.map(c => {
                const n = c.key === 'all' ? allTemplates.length : allTemplates.filter(x => x.category === c.key).length
                const active = filter === c.key
                return (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setFilter(c.key)}
                    aria-pressed={active}
                    data-active={active}
                    className={cn(
                      'journal-tab cursor-pointer pb-2.5 text-[12.5px] font-medium leading-none transition-colors',
                      active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t(c.label)}
                    <span className="ml-1.5 font-mono text-[9px] tabular-nums opacity-60">{n}</span>
                  </button>
                )
              })}
              {customs.length > 0 && (
                <button
                  type="button"
                  onClick={() => setFilter('mine')}
                  aria-pressed={filter === 'mine'}
                  data-welcome-mine-chip
                  data-active={filter === 'mine'}
                  className={cn(
                    'journal-tab shrink-0 cursor-pointer pb-2.5 text-[12.5px] font-medium leading-none transition-colors',
                    filter === 'mine' ? 'text-violet-600 dark:text-violet-400' : 'text-violet-600/70 hover:text-violet-600 dark:text-violet-400/70 dark:hover:text-violet-400',
                  )}
                  style={filter === 'mine' ? { borderBottomColor: 'var(--color-violet-500, #8b5cf6)' } : undefined}
                >
                  {t({ zh: '我的模板', en: 'My templates' })}
                  <span className="ml-1.5 font-mono text-[9px] tabular-nums opacity-60">{customs.length}</span>
                </button>
              )}
            </div>

            {/* —— r89 移动端分类横滚行（<lg 且 filter='all'）：每支模板恰好出现一次 —— */}
            {filter === 'all' && (
              <div data-welcome-cat-rows className="pb-3 lg:hidden">
                {catRows.map(row => row.tpls.length > 0 && (
                  <div key={row.key} data-welcome-cat-row={row.key}>
                    <div className="flex items-baseline gap-2 pt-5">
                      <h3 className="font-serif-editorial text-[15px] font-semibold leading-none tracking-[-0.01em]">{t(row.label)}</h3>
                      <span className="font-mono text-[9px] font-semibold tabular-nums leading-none text-muted-foreground">{row.tpls.length}</span>
                      <button
                        type="button"
                        data-welcome-row-all={row.key}
                        onClick={() => setFilter(row.key === 'mine' ? 'mine' : row.key as FigureCategory)}
                        className={cn(
                          'ml-auto inline-flex h-6 shrink-0 cursor-pointer items-center gap-0.5 text-[10.5px] font-semibold leading-none',
                          row.key === 'mine'
                            ? 'text-violet-600 hover:text-violet-500 dark:text-violet-400'
                            : 'text-primary hover:text-primary/75',
                        )}
                      >
                        {t({ zh: '查看全部', en: 'See all' })}
                        <ChevronRight className="h-2.5 w-2.5" aria-hidden />
                      </button>
                    </div>
                    <div
                      role="list"
                      aria-label={`${t(row.label)} · ${t({ zh: '横向滑动', en: 'swipe' })}`}
                      className="mol-toolbar-scroll flex snap-x gap-2.5 overflow-x-auto pb-1.5 pt-3"
                    >
                      {row.tpls.map((tpl, i) => (
                        <RowCard
                          key={tpl.id}
                          tpl={tpl}
                          delay={`${360 + i * 25}ms`}
                          busy={busyId === tpl.id || loading}
                          onDemo={() => void demo(tpl)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 画廊网格（过滤切换时 key 变化重播 stagger 入场；r89：<lg 仅特定过滤渲染） */}
            <div className="pb-4 pt-5 lg:pb-8">
              {/* r90：移动端过滤网格的显式返回入口 */}
              {filter !== 'all' && (
                <button
                  type="button"
                  data-welcome-back-rows
                  onClick={() => setFilter('all')}
                  className="mb-4 inline-flex h-7 cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-primary transition-colors hover:text-primary/75 lg:hidden"
                >
                  <ArrowLeft className="h-3 w-3" aria-hidden />
                  {t({ zh: '返回分类浏览', en: 'Back to categories' })}
                </button>
              )}
              <div
                key={filter}
                data-welcome-gallery
                className={cn(
                  'gap-x-6 gap-y-8',
                  filter === 'all'
                    ? 'hidden grid-cols-2 xl:grid-cols-3 lg:grid'
                    : 'grid grid-cols-2 lg:grid-cols-3',
                )}
              >
                {shown.map(tpl => (
                  <GalleryCard
                    key={tpl.id}
                    tpl={tpl}
                    index={allTemplates.indexOf(tpl)}
                    busy={busyId === tpl.id || loading}
                    onDemo={() => void demo(tpl)}
                    onEdit={tpl.custom ? () => {
                      // r85：画廊卡直编入口——先开弹窗，再广播 open-template-edit 直达编辑视图
                      setUi({ templateOpen: true })
                      window.dispatchEvent(new CustomEvent('open-template-edit', { detail: { id: tpl.id } }))
                    } : undefined}
                  />
                ))}
                {filter === 'mine' && customs.length === 0 && (
                  <div className="col-span-full flex flex-col items-center gap-2 border border-dashed border-foreground/20 py-12 text-center">
                    <ImagePlus className="h-7 w-7 text-muted-foreground/50" aria-hidden />
                    <p className="font-serif-editorial text-[15px] font-semibold">{t({ zh: '还没有自定义模板', en: 'No custom templates yet' })}</p>
                    <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                      {t({ zh: '上传一张论文/科研分子图，AI 将解析其图式配方并生成可编辑命令模板', en: 'Upload a paper or scientific molecular figure — the AI parses its style recipe into an editable command template' })}
                    </p>
                    <button
                      type="button"
                      onClick={() => { setUi({ templateOpen: true }); window.dispatchEvent(new CustomEvent('open-template-upload')) }}
                      className="mt-1 inline-flex h-8 cursor-pointer items-center gap-1.5 border border-primary/45 px-3.5 text-[12px] font-semibold text-primary transition-colors hover:bg-primary/10"
                    >
                      <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                      {t({ zh: '上传第一张图', en: 'Upload your first image' })}
                    </button>
                  </div>
                )}
              </div>
              {/* 诚实版权脚注（细小学注；与模板库对话框同口径） */}
              <p className="journal-row-in mt-8 flex max-w-2xl items-start gap-1.5 border-t border-foreground/10 pt-4 text-[10px] leading-relaxed text-muted-foreground" style={{ animationDelay: '700ms' }}>
                <Wand2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                {t({
                  zh: '模板复现的是图式视觉配方（表示法·配色·视角·灯光·轮廓）与分析命令（孔道剖面/脂双层），不含论文原图；缩略图由 MolVision 引擎对代表结构真实渲染。',
                  en: 'Templates reproduce figure-style recipes (representations · coloring · camera · lighting · outlines) and analysis commands (pore profiles / bilayers), not original artwork; thumbnails are genuine MolVision engine renders.',
                })}
              </p>
            </div>
          </section>
        </div>
      </div>

      {/* AI 助手悬浮入口（素雅胶囊：⌘J 快捷键；面板打开时让位隐藏） */}
      {!agentOpen && (
        <button
          onClick={() => setUi({ agentOpen: true })}
          className="welcome-in welcome-float-chip group bottom-5 right-5 z-20 flex h-9 select-none items-center gap-2 border-border bg-background/92 px-3.5 text-foreground/85 shadow-[0_1px_10px_oklch(0.25_0.01_80/0.1)] hover:border-primary/50 hover:text-foreground dark:shadow-[0_1px_10px_oklch(0_0_0/0.4)]"
          style={{ animationDelay: '500ms' }}
          aria-keyshortcuts="Control+J"
        >
          <Bot className="h-3.5 w-3.5 text-primary" aria-hidden />
          <span className="text-[11.5px] font-semibold tracking-wide">{t({ zh: 'AI 助手', en: 'AI Assistant' })}</span>
          <span className="hidden items-center gap-0.5 font-mono text-[9px] font-medium text-muted-foreground/80 sm:flex">
            <kbd className="border border-foreground/15 bg-transparent px-1 py-px leading-none">⌘</kbd>J
          </span>
        </button>
      )}

      {/* 面板打开时背景聚焦遮罩（极淡压暗；不拦截交互） */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-10 bg-background/35 opacity-0 transition-opacity duration-300 motion-reduce:transition-none ${agentOpen ? 'opacity-100' : ''}`}
      />

      {/* AI 助手面板（悬浮变体；加载结构后随工作台重挂载并还原历史） */}
      <AgentPanel float />

      {/* 素纸页脚（待机遥测的排印化：版本 · 状态 · 快捷键 · 语言） */}
      <footer className="relative z-30 flex h-10 shrink-0 items-center gap-3 border-t border-foreground/12 px-4 sm:px-6">
        <span className="font-mono text-[10.5px] font-bold tracking-wide">
          MolVision <span className="font-normal text-muted-foreground">v1.6</span>
        </span>
        <span className="h-3 w-px shrink-0 bg-foreground/15" aria-hidden />
        <span className="truncate text-[11px] text-muted-foreground">
          {t({ zh: '待机 · 等待结构加载', en: 'Standby · awaiting structure' })}
        </span>
        <span className="ml-auto hidden shrink-0 font-mono text-[9.5px] tracking-wide text-muted-foreground/70 md:block">
          {t({ zh: '⌘K 命令面板 · ⌘J AI 助手', en: '⌘K palette · ⌘J AI assistant' })}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 md:ml-3">
          <LanguageToggle variant="default" />
        </div>
      </footer>

      {/* 拖放遮罩（松手提示；期刊语态：虚线墨框 + 学注格式族） */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/[0.94]">
          <div className="border border-dashed border-primary/60 px-10 py-8 text-center">
            <FileUp className="mx-auto h-6 w-6 text-primary" aria-hidden />
            <span className="mt-3 block text-[13px] font-semibold">{t({ zh: '松开以加载文件', en: 'Drop to load files' })}</span>
            <span className="mt-1.5 block font-mono text-[10px] tracking-wide text-muted-foreground">
              {t({ zh: '.pdb / .cif / .ccp4 密度图 / .molvision 会话', en: '.pdb / .cif / .ccp4 maps / .molvision sessions' })}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
