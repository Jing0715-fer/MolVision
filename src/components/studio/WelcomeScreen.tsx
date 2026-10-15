'use client'

// MolVision 欢迎页 r128「Hero → 画廊」直落式重构（用户指令：欢迎 + PDB 加载
// 之后直接接模板列表，中间内容全部删除，继续优化美观度）：
// ─────────────────────────────────────────────────────────────────────────────
// 结构（自上而下，一屏直达）：
//   顶栏（品牌 + 主题 · GitHub）
//   Hero：蓝图网格 + 顶部辉光 + LIVE 胶囊 + 负字距大标题 + 智能命令条
//         （同一输入框识别 4 位 PDB 编号 / #s= 分享链接）+ 状态行
//         + 会话恢复窄幅条（无存档自动隐藏，不留空洞）
//   模板画廊（页面主体）：分类胶囊（sticky 毛玻璃）+ 图版卡网格；
//         移动端分类横滚行架构保留（r89）
//   页脚（待机遥测）+ AI 浮动入口 + 全页拖放遮罩
// r127 → r128 删除：
//   · 展示 bento（图版 A/B + 全库入口卡）
//   · 会话带两列卡（会话恢复改窄幅条；分享链接粘贴卡并入智能命令条）
//   · §01 经典结构 3 列索引（完整示例列表仍在 Ctrl+K 加载对话框）
//   · hero 遥测统计三等分行
// 新增：
//   · 智能命令条双语义：4 位 PDB 编号 → 主色「载入」；粘贴含 #s= 的
//     URL / 裸片段 → 翡翠「恢复」（applyShareLinkFromText 复用——混杂文本
//     自动提取最长合法载荷）；图标 / 边框 / CTA / 状态行四态联动
// 功能保留（r85-r127 语义零回退）：PDB 校验 / 本地文件（r99 value 清空）/
//   全页拖放 / 会话恢复 / 分享链接加载 / 画廊分类过滤 / 移动端分类横滚行 /
//   返回分类锚点（r90）/ 自定义模板行与直编（r85）/ 从图片创建 / 在库中浏览 /
//   诚实版权脚注 / AI 胶囊与面板 / 主题 · GitHub · 语言切换 / 精确指针自动
//   聚焦 / demoThenApply 感知回执。
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  ArrowLeft, ArrowRight, ArrowUpRight, BookOpenText, ChevronRight,
  FileUp, FolderOpen, Github, ImagePlus, Link2, Loader2, Moon, Pencil, Play,
  Search, Sun, Wand2,
} from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { useI18n, tt, type DualText } from '@/i18n'
import { fetchPdbId, loadFiles } from '@/lib/molecular/loader'
import {
  demoThenApply, FIGURE_CATEGORIES, FIGURE_TEMPLATES,
  type FigureCategory, type FigureTemplate,
} from '@/lib/molecular/figure-templates'
import { useCustomTemplates } from '@/lib/molecular/custom-templates'
import { applyShareLinkFromText } from '@/lib/molecular/share-link'
import { ACCENT, TPL_ICONS } from './FigureTemplatesDialog'
import { SessionResumeSlot } from './SessionResumeCard'
import { AgentPanel } from './AgentPanel'
import { LanguageToggle } from './LanguageToggle'
import { cn } from '@/lib/utils'

// ── 共用缩略图（引擎真实渲染 PNG；缺图 → 强调色渐变占位；自定义模板为 dataURL） ──
function PlateImg({ tpl, alt, className }: { tpl: FigureTemplate; alt: string; className?: string }) {
  const [imgOk, setImgOk] = useState(true)
  const a = ACCENT[tpl.accent]
  if (!imgOk) {
    return (
      <span aria-hidden className={cn('absolute inset-0 flex items-center justify-center bg-gradient-to-br', a.grad)}>
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

// ── 演示徽章（常显——触屏无 hover；PDB 号即「点会发生什么」的说明） ──
function DemoBadge({ demo, compact }: { demo: string; compact?: boolean }) {
  return (
    <span
      className={cn(
        'absolute bottom-2 right-2 flex items-center gap-1 rounded-md border border-foreground/15 bg-background/80 px-1.5 font-mono text-[9px] font-semibold leading-none backdrop-blur-sm',
        compact ? 'h-5' : 'h-5.5 py-0.5 text-[9.5px]',
      )}
    >
      <Play className="h-2 w-2" aria-hidden />
      {demo}
    </span>
  )
}

// ── r89 移动端分类横滚行卡片（紧凑图版：缩略图 + 名称行；surface 卡语态） ──
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
        'rise-in group relative w-[128px] shrink-0 cursor-pointer snap-start overflow-hidden rounded-xl border border-foreground/10 bg-card text-left transition-[border-color] duration-150 hover:border-primary/45 sm:w-[140px]',
        a.text,
      )}
      style={{ animationDelay: delay }}
    >
      <span className="relative block aspect-[16/10] w-full overflow-hidden bg-muted/30">
        <PlateImg
          tpl={tpl}
          alt={t(tpl.tagline)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        <DemoBadge demo={tpl.demo} compact />
        {tpl.custom && (
          <span className="absolute left-1.5 top-1.5 rounded bg-violet-500/85 px-1.5 py-0.5 font-mono text-[8px] font-bold tracking-[0.1em] text-white">
            {t({ zh: '自定义', en: 'CUSTOM' })}
          </span>
        )}
        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </span>
        )}
      </span>
      <span className="flex items-center gap-1.5 px-2.5 py-2">
        <Icon className={cn('h-3 w-3 shrink-0', a.text)} aria-hidden />
        <span className="truncate text-[11px] font-medium leading-tight text-foreground">{t(tpl.name)}</span>
      </span>
    </button>
  )
}

// ── 画廊图版卡（边到边图面 + 卡内三行元数据——mono 图号/名称/tagline/溯源） ──
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
    <article className="rise-in group relative" style={{ animationDelay: `${340 + index * 25}ms` }}>
      <button
        type="button"
        onClick={onDemo}
        disabled={busy}
        title={t({
          zh: `加载演示结构 ${tpl.demo} 并应用「${t(tpl.name)}」图式`,
          en: `Load demo structure ${tpl.demo} with the "${t(tpl.name)}" style applied`,
        })}
        className="block w-full cursor-pointer overflow-hidden rounded-xl border border-foreground/10 bg-card text-left transition-[border-color,translate] duration-200 ease-out hover:border-primary/45 hover:-translate-y-0.5 focus-visible:border-primary/60 disabled:pointer-events-none disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      >
        <span className="relative block aspect-[16/10] w-full overflow-hidden bg-muted/30">
          <PlateImg
            tpl={tpl}
            alt={t(tpl.tagline)}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
          {/* 自定义紫印（语义标记保留）；内置卡无角标——图号移至图注行 */}
          {tpl.custom && (
            <span className="absolute left-1.5 top-1.5 rounded bg-violet-500/85 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em] text-white">
              {t({ zh: '自定义', en: 'CUSTOM' })}
            </span>
          )}
          {/* 演示徽章（hover 浮现；触屏恒显） */}
          <span className={cn(
            'absolute bottom-1.5 right-1.5 flex h-6 items-center gap-1 rounded-md border border-foreground/15 bg-background/80 px-2 font-mono text-[10px] font-semibold backdrop-blur-sm transition-opacity duration-200',
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

        {/* 卡内元数据三行（名称 / tagline / 溯源+命令数） */}
        <span className="block px-3 pb-2.5 pt-2.5">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[13.5px] font-medium leading-tight">{t(tpl.name)}</span>
            <span className="ml-auto shrink-0 font-mono text-[9.5px] font-semibold tabular-nums text-primary">{tpl.demo}</span>
          </span>
          {/* r128：描述两行截断（VLM 评审——桌面端单行截断信息损失；
              line-clamp-2 给足风格关键词上下文，行内网格仍对齐） */}
          <span className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground" title={t(tpl.tagline)}>
            {t(tpl.tagline)}
          </span>
          <span className="mt-1.5 flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground/75">
            <span className="shrink-0 font-semibold uppercase tracking-[0.12em]">{figLabel}</span>
            <span className="shrink-0">· {tpl.citation.journal} {tpl.citation.year}</span>
            <span className={cn('ml-auto shrink-0', a.text)}>
              {tpl.commands.length} {t({ zh: '条命令', en: 'cmds' })}
            </span>
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

/** 章节眉（Linear eyebrow 惯例：等宽大写正字距 + 主色编号） */
function SectionEyebrow({ code, children }: { code: string; children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-primary">
      {code} · {children}
    </div>
  )
}

export function WelcomeScreen() {
  const { t } = useI18n()
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

  // r128 智能命令条识别：同一输入框双语义——4 位 PDB 编号（大小写宽容）；
  // 含 #s= 的任意粘贴文本 → 分享会话恢复。URL / 长文本不误判为 PDB。
  const trimmed = id.trim()
  const shareDetected = /#s=/.test(trimmed)
  const pdbDetected = !shareDetected && /^[0-9][A-Za-z0-9]{3}$/.test(trimmed)
  const canSubmit = (shareDetected || pdbDetected) && !loading

  // 精确指针设备才自动聚焦（触屏避免弹出键盘）
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  const submitId = () => {
    const v = id.trim()
    if (!v || loading) return
    // 1) 分享链接（完整 URL / 裸 #s= 片段 / 混杂文本——applyShareLinkFromText
    //    自动提取最长合法载荷）
    if (/#s=/.test(v)) {
      void applyShareLinkFromText(v)
      return
    }
    // 2) 纯 4 位 PDB 编号（大小写宽容）
    const up = v.toUpperCase()
    if (/^[0-9][A-Z0-9]{3}$/.test(up)) {
      void fetchPdbId(up)
      return
    }
    toast.error(tt({
      zh: '请输入 4 位 PDB 编号（如 4HHB），或粘贴 MolVision 分享链接',
      en: 'Enter a 4-character PDB ID (e.g. 4HHB) or paste a MolVision share link',
    }))
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
      {/* ── 顶栏（Linear top-nav 语态）：品牌标 + 版本胶囊；右：主题 · GitHub ── */}
      <header
        data-welcome-topbar
        className="welcome-in relative z-30 flex h-14 shrink-0 items-center gap-2.5 border-b border-foreground/10 px-4 sm:px-6"
        style={{ animationDelay: '40ms' }}
      >
        <svg viewBox="0 0 28 28" className="h-[19px] w-[19px] shrink-0" aria-hidden>
          <polygon points="14,1 25.1,7.25 25.1,20.75 14,27 2.9,20.75 2.9,7.25" className="fill-primary" />
          <g fill="none" stroke="currentColor" strokeWidth="1" className="text-primary-foreground" opacity="0.9">
            <ellipse cx="14" cy="14" rx="8" ry="3" />
            <ellipse cx="14" cy="14" rx="8" ry="3" transform="rotate(60 14 14)" />
          </g>
        </svg>
        <span className="text-[15px] font-semibold leading-none tracking-[-0.01em]">MolVision</span>
        <span className="hidden rounded-full border border-foreground/[0.12] px-2 py-0.5 font-mono text-[9.5px] leading-none text-muted-foreground sm:inline">
          v1.7
        </span>
        <div className="flex-1" />
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            suppressHydrationWarning
            aria-label={t({ zh: '切换深浅主题', en: 'Toggle light/dark theme' })}
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <Sun className="h-4 w-4 hidden dark:block" />
            <Moon className="h-4 w-4 dark:hidden" />
          </button>
          <a
            href="https://github.com/Jing0715-fer/MolVision"
            target="_blank"
            rel="noreferrer"
            aria-label={t({ zh: 'GitHub 仓库', en: 'GitHub repository' })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </header>

      {/* ── 主体：单列直落（hero → 模板画廊） ── */}
      <div className="mol-scroll relative z-10 min-h-0 flex-1 overflow-y-auto">

        {/* ══ Hero：蓝图网格 + 顶部辉光 + 状态胶囊 + 大标题 + 智能命令条 ══ */}
        <section className="relative">
          {/* 蓝图网格（Vercel 语态：细线网格 + 径向渐隐蒙版）与顶部主色辉光
              （均不拦截交互；color-mix 主题化——浅色自动降档为灰网格/淡绿晕） */}
          <div aria-hidden className="hero-grid-bg pointer-events-none absolute inset-0" />
          <div aria-hidden className="hero-grid-glow pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
          <div className="relative mx-auto w-full max-w-[1040px] px-4 pb-12 pt-12 text-center sm:px-8 sm:pt-16">

            {/* 状态胶囊（Linear status-badge）：RCSB LIVE + ping 点 */}
            <div
              className="welcome-in mx-auto inline-flex h-7 items-center gap-2 rounded-full border border-foreground/[0.12] bg-card px-3.5"
              style={{ animationDelay: '60ms' }}
            >
              <span aria-hidden className="relative flex h-1.5 w-1.5 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50 motion-reduce:hidden" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
              </span>
              <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-foreground/75">
                RCSB LIVE · {t({ zh: '结构档案实时可达', en: '250K+ structures on tap' })}
              </span>
            </div>

            {/* 显示大标题（Linear display：600 字重 + 负字距 + 紧行高） */}
            <h1
              className="welcome-in mt-6 text-balance font-semibold tracking-[-0.035em] text-[clamp(34px,6vw,58px)] leading-[1.06]"
              style={{ animationDelay: '110ms' }}
            >
              {t({ zh: '看清每一个原子。', en: 'Every atom, in focus.' })}
            </h1>

            {/* 导语：单行语态，克制 */}
            <p
              className="welcome-in mx-auto mt-5 max-w-[580px] text-[15px] leading-[1.8] text-muted-foreground sm:text-[15.5px]"
              style={{ animationDelay: '150ms' }}
            >
              {t({
                zh: '在浏览器里渲染、测量并排版蛋白质与核酸结构——输入 PDB 编号、粘贴分享链接或拖入文件，即刻开始。',
                en: 'Render, measure, and typeset proteins & nucleic acids right in the browser — enter a PDB ID, paste a share link, or drop a file to begin.',
              })}
            </p>

            {/* 智能命令条（r128 双语义）：surface 卡 + 焦点 ring；
                · 4 位 PDB 编号 → 主色语态（Search 图标 + n/4 计数 + 载入 CTA）
                · 粘贴 #s= 分享链接 → 翡翠语态（Link2 图标 + 恢复 CTA） */}
            <form
              onSubmit={e => { e.preventDefault(); submitId() }}
              className={cn(
                'welcome-in group mx-auto mt-9 flex w-full max-w-[560px] items-center gap-2 rounded-xl border bg-card py-1.5 pl-4 pr-1.5 transition-[border-color,box-shadow] duration-200 sm:mt-10',
                shareDetected
                  ? 'border-emerald-500/45 focus-within:border-emerald-500/65 focus-within:ring-[3px] focus-within:ring-emerald-500/20'
                  : 'border-foreground/[0.12] focus-within:border-primary/55 focus-within:ring-[3px] focus-within:ring-primary/25',
              )}
              style={{ animationDelay: '190ms' }}
            >
              {shareDetected ? (
                <Link2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <Search className="h-4 w-4 shrink-0 text-muted-foreground/80" aria-hidden />
              )}
              <input
                ref={inputRef}
                value={id}
                onChange={e => {
                  const v = e.target.value
                  // PDB 输入流（短且纯字母数字）→ 大写化；分享链接/URL 原样保留
                  //（base64url 载荷大小写敏感——显示层不可改写）
                  setId(/^[0-9A-Za-z]{0,4}$/.test(v) ? v.toUpperCase() : v)
                }}
                maxLength={2048}
                placeholder={t({ zh: '输入 PDB 编号（如 4HHB）或粘贴分享链接', en: 'Enter a PDB ID (e.g. 4HHB) or paste a share link' })}
                aria-label={t({ zh: 'PDB 编号或分享链接', en: 'PDB ID or share link' })}
                autoComplete="off"
                spellCheck={false}
                className="h-11 min-w-0 flex-1 bg-transparent font-mono text-[15px] font-medium leading-none tracking-[0.06em] text-foreground caret-primary outline-none placeholder:font-sans placeholder:text-[13px] placeholder:font-normal placeholder:normal-case placeholder:tracking-[0.01em] placeholder:text-muted-foreground/70"
              />
              {/* n/4 即时计数（仅 PDB 输入流；合法 → 主色确认） */}
              {id.length > 0 && !shareDetected && /^[0-9A-Za-z]+$/.test(id) && id.length <= 4 && (
                <span
                  aria-hidden
                  className={cn(
                    'hidden shrink-0 font-mono text-[10.5px] tabular-nums transition-colors duration-200 sm:inline',
                    pdbDetected ? 'text-primary' : 'text-muted-foreground/60',
                  )}
                >
                  {id.length}/4
                </span>
              )}
              {/* CTA 三态：分享链接 → 翡翠「恢复」；PDB → 主色墨块；否则休眠描边 */}
              <button
                type="submit"
                disabled={!canSubmit}
                className={cn(
                  'flex h-11 shrink-0 select-none items-center gap-2 rounded-lg px-4 text-[13px] font-semibold transition-[background-color,border-color,color,translate] duration-150 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none',
                  shareDetected
                    ? 'bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:text-emerald-950'
                    : pdbDetected
                      ? 'bg-primary text-primary-foreground hover:brightness-110'
                      : 'border border-foreground/[0.12] bg-foreground/[0.04] text-muted-foreground',
                )}
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
                {shareDetected
                  ? t({ zh: '恢复', en: 'Restore' })
                  : t({ zh: '载入', en: 'Load' })}
                {!loading && <ArrowRight className="h-3.5 w-3.5" aria-hidden />}
              </button>
            </form>

            {/* 状态行（固定高度防布局位移）+ 本地文件入口 */}
            <div className="welcome-in mx-auto mt-3.5 flex h-9 w-full max-w-[560px] flex-wrap items-center justify-center gap-x-3 gap-y-1.5" style={{ animationDelay: '230ms' }}>
              {loading ? (
                <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                  {loadingMsg || t({ zh: '处理中…', en: 'Processing…' })}
                </span>
              ) : shareDetected ? (
                <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-emerald-600 dark:text-emerald-400">
                  <span aria-hidden>&gt;</span>
                  {t({ zh: '检测到分享链接 · 点击「恢复」加载会话', en: 'share link detected · press Restore to load' })}
                </span>
              ) : pdbDetected ? (
                <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-primary/90">
                  <span aria-hidden>&gt;</span>
                  {t({ zh: `待发 ${trimmed.toUpperCase()} · RCSB 实时`, en: `ready: fetch ${trimmed.toUpperCase()} from RCSB` })}
                </span>
              ) : (
                <>
                  <span className="font-mono text-[9.5px] tracking-wide text-muted-foreground/80">
                    PDB / CIF / CCP4 / .molvision · {t({ zh: '整页可拖放', en: 'drag & drop anywhere' })}
                  </span>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={loading}
                    className="inline-flex h-8 cursor-pointer items-center gap-1.5 px-1 text-[12.5px] font-medium text-foreground/80 transition-colors duration-150 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
                  >
                    <FolderOpen className="h-3.5 w-3.5" aria-hidden />
                    {t({ zh: '打开本地文件…', en: 'Open local file…' })}
                  </button>
                </>
              )}
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

            {/* 会话恢复窄幅条（有存档才渲染；与命令条同宽——空场景不留空洞） */}
            <div className="mx-auto mt-2 w-full max-w-[560px] text-left">
              <SessionResumeSlot />
            </div>
          </div>
        </section>

        {/* ══ 模板画廊（hero 后直落衔接——页面主体） ══ */}
        <section id="welcome-gallery" aria-label={t({ zh: '论文图模板画廊', en: 'Paper-figure template gallery' })} className="relative scroll-mt-2 border-t border-foreground/[0.07]">
          <div className="mx-auto w-full max-w-[1160px] px-4 sm:px-8">
            <header
              className="welcome-in flex flex-wrap items-end justify-between gap-x-4 gap-y-3 pb-1 pt-9"
              style={{ animationDelay: '300ms' }}
            >
              <div>
                <SectionEyebrow code="TPL">{t({ zh: '论文图式模板', en: 'paper figure templates' })}</SectionEyebrow>
                <h2 className="mt-1.5 text-[24px] font-semibold leading-tight tracking-[-0.02em]">
                  {t({ zh: '一键复现论文图', en: 'Recreate paper figures in one click' })}
                </h2>
              </div>
              {/* 图库动作（Linear button-secondary 族） */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-welcome-create-template
                  onClick={() => { setUi({ templateOpen: true }); window.dispatchEvent(new CustomEvent('open-template-upload')) }}
                  className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-foreground/[0.12] bg-card px-3.5 text-[12.5px] font-medium text-foreground/85 transition-[border-color,color] duration-150 hover:border-primary/45 hover:text-foreground"
                  title={t({ zh: '上传论文图，AI 解析图式生成你的自定义模板', en: 'Upload a paper figure — the AI parses it into your custom template' })}
                >
                  <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                  {t({ zh: '从图片创建', en: 'From image' })}
                </button>
                <button
                  type="button"
                  onClick={() => setUi({ templateOpen: true })}
                  className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
                  title={t({ zh: '打开完整模板库（可应用到已加载结构）', en: 'Open the full template library (applies to loaded structures)' })}
                >
                  {t({ zh: '在库中浏览', en: 'Browse library' })}
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </button>
              </div>
            </header>
            <p className="welcome-in mt-2.5 max-w-2xl text-[11.5px] leading-relaxed text-muted-foreground" style={{ animationDelay: '330ms' }}>
              {t({
                zh: 'Cell / Nature / Science 结构文章的经典图式——缩略图由引擎真实渲染，点击卡片即刻加载演示结构并应用；同类多风格（明暗/键连/立体/剖切/线描/灰度/静电/水合…）与上传你自己的论文图 AI 解析为新模板均可。',
                en: 'Classic figure styles from Cell / Nature / Science papers — thumbnails are genuine engine renders; click a card to load the demo structure with the style applied. Same-type variants (dark / bonding / stereo / cutaway / wire / grayscale / electrostatic / hydration…) and AI-parsed uploads included.',
              })}
            </p>

            {/* 过滤胶囊（Linear pricing-tab 族：激活 = surface 抬升；sticky 常驻） */}
            <div
              role="group"
              aria-label={t({ zh: '画廊分类', en: 'Gallery categories' })}
              className="gallery-head-blur mol-toolbar-scroll sticky top-0 z-10 mt-4 flex items-center gap-2 overflow-x-auto border-b border-foreground/10 py-3"
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
                    className="cat-pill cursor-pointer"
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
                  className="cat-pill cursor-pointer"
                  style={filter === 'mine' ? { color: 'var(--color-violet-500, #8b5cf6)' } : undefined}
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
                      <h3 className="text-[15px] font-semibold leading-none tracking-[-0.01em]">{t(row.label)}</h3>
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
                          delay={`${380 + i * 25}ms`}
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
                  'gap-x-5 gap-y-7',
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
                  <div className="col-span-full flex flex-col items-center gap-2 rounded-xl border border-dashed border-foreground/20 py-12 text-center">
                    <ImagePlus className="h-7 w-7 text-muted-foreground/50" aria-hidden />
                    <p className="text-[15px] font-medium">{t({ zh: '还没有自定义模板', en: 'No custom templates yet' })}</p>
                    <p className="max-w-sm text-[11px] leading-relaxed text-muted-foreground">
                      {t({ zh: '上传一张论文/科研分子图，AI 将解析其图式配方并生成可编辑命令模板', en: 'Upload a paper or scientific molecular figure — the AI parses its style recipe into an editable command template' })}
                    </p>
                    <button
                      type="button"
                      onClick={() => { setUi({ templateOpen: true }); window.dispatchEvent(new CustomEvent('open-template-upload')) }}
                      className="mt-1 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-primary/45 px-3.5 text-[12px] font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      <ImagePlus className="h-3.5 w-3.5" aria-hidden />
                      {t({ zh: '上传第一张图', en: 'Upload your first image' })}
                    </button>
                  </div>
                )}
              </div>
              {/* 诚实版权脚注（细小学注；与模板库对话框同口径） */}
              <p className="rise-in mt-8 flex max-w-2xl items-start gap-1.5 border-t border-foreground/10 pt-4 text-[10px] leading-relaxed text-muted-foreground" style={{ animationDelay: '640ms' }}>
                <Wand2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                {t({
                  zh: '模板复现的是图式视觉配方（表示法·配色·视角·灯光·轮廓）与分析命令（孔道剖面/脂双层），不含论文原图；缩略图由 MolVision 引擎对代表结构真实渲染。',
                  en: 'Templates reproduce figure-style recipes (representations · coloring · camera · lighting · outlines) and analysis commands (pore profiles / bilayers), not original artwork; thumbnails are genuine MolVision engine renders.',
                })}
              </p>
            </div>
          </div>
        </section>

        {/* 底部呼吸（最后 section 与页脚之间的留白节奏） */}
        <div className="h-12" aria-hidden />
      </div>

      {/* AI 助手悬浮入口（滚动全程可达的入口价值保留；ping 点 + backdrop blur；
          面板打开时让位隐藏） */}
      {!agentOpen && (
        <button
          onClick={() => setUi({ agentOpen: true })}
          className="welcome-in welcome-float-chip group bottom-5 right-5 z-20 flex h-8 select-none items-center gap-1.5 rounded-full border border-foreground/10 bg-card/85 px-3 text-foreground/75 shadow-sm backdrop-blur-sm transition-colors duration-200 hover:border-primary/45 hover:text-foreground dark:border-white/[0.14] dark:bg-card/85"
          style={{ animationDelay: '520ms' }}
          aria-keyshortcuts="Control+J"
        >
          <span aria-hidden className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50 motion-reduce:hidden" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em]">{t({ zh: 'AI 助手', en: 'AI Assistant' })}</span>
        </button>
      )}

      {/* 面板打开时背景聚焦遮罩（极淡压暗；不拦截交互） */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-0 z-10 bg-background/35 opacity-0 transition-opacity duration-300 motion-reduce:transition-none ${agentOpen ? 'opacity-100' : ''}`}
      />

      {/* AI 助手面板（悬浮变体；加载结构后随工作台重挂载并还原历史） */}
      <AgentPanel float />

      {/* 状态页脚（待机遥测：版本 · 状态 · 快捷键 · 语言） */}
      <footer className="relative z-30 flex h-10 shrink-0 items-center gap-3 border-t border-foreground/10 px-4 sm:px-6">
        <span className="font-mono text-[10.5px] font-bold tracking-wide">
          MolVision <span className="font-normal text-muted-foreground">v1.7</span>
        </span>
        <span className="h-3 w-px shrink-0 bg-foreground/15" aria-hidden />
        <span className="hidden truncate text-[11px] text-foreground/60 sm:inline">
          {t({ zh: '待机 · 等待结构加载', en: 'Standby · awaiting structure' })}
        </span>
        <span className="ml-auto hidden shrink-0 font-mono text-[9.5px] tracking-wide text-muted-foreground/70 md:block">
          {t({ zh: '⌘K 命令面板 · ⌘J AI 助手', en: '⌘K palette · ⌘J AI assistant' })}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 md:ml-3">
          <LanguageToggle variant="default" />
        </div>
      </footer>

      {/* 拖放遮罩（松手提示；圆角虚线面板 + backdrop blur） */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/85 backdrop-blur-sm">
          <div className="mx-4 rounded-2xl border-2 border-dashed border-primary/50 px-12 py-10 text-center">
            <FileUp className="mx-auto h-8 w-8 text-primary" aria-hidden />
            <span className="mt-4 block text-[15px] font-semibold">{t({ zh: '松开以加载文件', en: 'Drop to load files' })}</span>
            <span className="mt-2 block font-mono text-[10px] tracking-wide text-muted-foreground">
              {t({ zh: '.pdb / .cif / .ccp4 密度图 / .molvision 会话', en: '.pdb / .cif / .ccp4 maps / .molvision sessions' })}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
