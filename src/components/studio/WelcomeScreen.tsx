'use client'

// 欢迎页（r74 Open-design 风格重设计）：未加载结构时的「仪器待机 + 作品橱窗」大屏
// ─────────────────────────────────────────────────────────────────────────────
// r74 用户需求：「首页也需要展示模板加载示例等，优化欢迎页美观度，做成类似
// open design 那种风格」——现代设计工具官网（open design / gallery showcase）
// 的经典布局语言落位：
//   · 顶栏：品牌 monogram + 版本徽章 + 右侧语言轨道 / 主题 / GitHub
//     （语言入口由右上浮动位迁入顶栏——LanguageToggle welcome 变体内联化）
//   · 大屏分栏（lg+）：左 hero 加载舱（仪器语义全保留：轨道背景 / 晶体按键
//     CTA / 会话恢复 / 示例芯片）｜右模板画廊（12 张引擎真实渲染缩略图，
//     点击卡片即刻「演示加载」——未加载结构时模板库的最短体验路径）
//   · 移动端（<lg）：垂直堆叠整页滚动（hero → 画廊 → 仪表条）
//   · 双栏各自独立滚动（lg+）：作品橱窗的应用分栏感；画廊 sticky 区头
//     毛玻璃常驻（gallery-head-blur）
//
// 历史资产保留（r45/r68/r69 打磨成果）：轨道电子巡航 / 六角 halo 呼吸 /
// 原子核呼吸 / LED 待机脉冲 / CTA 晶体按键 / welcome-in 错峰入场 /
// welcome-float-chip（右下 AI 胶囊）/ 取景框四角刻度 / 墨色仪表底座
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  ArrowUpRight, BookOpenText, Bot, FileUp, FolderOpen, Github, Loader2, Moon,
  Play, Sun, Wand2,
} from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { useI18n, tt } from '@/i18n'
import { EXAMPLE_STRUCTURES, fetchPdbId, loadFiles } from '@/lib/molecular/loader'
import {
  demoThenApply, FIGURE_CATEGORIES, FIGURE_TEMPLATES,
  type FigureCategory, type FigureTemplate,
} from '@/lib/molecular/figure-templates'
import { ACCENT, TPL_ICONS } from './FigureTemplatesDialog'
import { SessionResumeSlot } from './SessionResumeCard'
import { AgentPanel } from './AgentPanel'
import { LanguageToggle } from './LanguageToggle'
import { cn } from '@/lib/utils'

/** 欢迎页示例精选（6 个均衡覆盖小蛋白/酶/四聚体/DNA/药物靶点；完整列表在加载对话框） */
const WELCOME_EXAMPLES = EXAMPLE_STRUCTURES.filter(ex => ex.id !== '1D3Z')

/** 背景大轨道电子巡航路径（椭圆 cx240 cy240 rx232 ry88） */
const ORBIT_PATH = 'M 472 240 A 232 88 0 1 1 8 240 A 232 88 0 1 1 472 240'
/** 品牌 monogram 内电子巡航路径（20×20 视图，rx8.2 ry3.1；一条原始角 + 一条 60° 角） */
const MINI_ORBIT_A = 'M 18.2 10 A 8.2 3.1 0 1 1 1.8 10 A 8.2 3.1 0 1 1 18.2 10'
const MINI_ORBIT_B = 'M 14.1 17.1 A 8.2 3.1 60 1 1 5.9 2.9 A 8.2 3.1 60 1 1 14.1 17.1'

// ── 画廊卡片（作品橱窗形态：点击整卡 = 演示加载——欢迎页无结构语境下
//    模板库的最短体验路径；hover 浮起 + 缩略图轻放大 + 演示徽章浮现） ──────────
function GalleryCard({ tpl, index, busy, onDemo }: {
  tpl: FigureTemplate
  index: number
  busy: boolean
  onDemo: () => void
}) {
  const { t } = useI18n()
  const [imgOk, setImgOk] = useState(true)
  const a = ACCENT[tpl.accent]
  const Icon = TPL_ICONS[tpl.id] ?? BookOpenText

  return (
    <article
      className={cn(
        'gallery-card-in group relative overflow-hidden rounded-xl border border-border bg-card transition-[border-color,translate,box-shadow] duration-200',
        a.border, 'hover:-translate-y-0.5 hover:shadow-[0_8px_24px_oklch(0.25_0.01_80/0.14)] dark:hover:shadow-[0_8px_24px_oklch(0_0_0/0.45)]',
        busy && 'pointer-events-none',
      )}
      style={{ animationDelay: `${320 + index * 25}ms` }}
    >
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
        {/* 缩略图（引擎真实渲染产物；缺图渐变占位） */}
        <span className="relative block aspect-[16/10] w-full overflow-hidden bg-muted/40">
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
          {/* r75 hover 信息浮层（open-design 作品揭示惯例）：顶部渐变显用途 + 命令数
              ——与底部演示徽章上下分置不冲突；触屏不依赖 hover（tap 即演示）。
              r77 重叠修复：浮层文字 pl-10 起排——为左上序号角标（右缘≈33px）清出
              同排空间，标题与序号各居其位不再叠压（用户点名 hover 重叠问题） */}
          <span
            data-welcome-tpl-purpose
            className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-background/92 via-background/55 to-transparent pl-10 pr-3 pb-9 pt-2.5 opacity-0 transition-opacity duration-200 sm:group-hover:opacity-100"
          >
            <span className="mol-micro truncate text-foreground/80">{t(tpl.purpose)}</span>
            <span className="ml-auto shrink-0 rounded-full border border-border bg-background/85 px-1.5 py-px font-mono text-[9px] font-semibold text-muted-foreground">
              {tpl.commands.length} {t({ zh: '条命令', en: 'cmds' })}
            </span>
          </span>
          {/* 序号角标（仪器簇编号惯例，与模板库对话框同源） */}
          <span className={cn('absolute left-2 top-2 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-[0.1em]', a.chip)}>
            {String(index + 1).padStart(2, '0')}
          </span>
          {/* 演示徽章（hover 浮现；触屏恒显——作品集 hover 提示惯例） */}
          <span className={cn(
            'absolute bottom-2 right-2 flex h-6 items-center gap-1 rounded-full border border-border bg-background/85 px-2 text-[10px] font-semibold backdrop-blur-sm transition-opacity duration-200',
            'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
          )}>
            <Play className="h-2.5 w-2.5" aria-hidden />
            {t({ zh: '演示', en: 'Demo' })}
            <span className="font-mono text-[9px] font-medium text-muted-foreground">{tpl.demo}</span>
          </span>
          {/* busy 覆盖（fetch + 应用期间） */}
          {busy && (
            <span className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </span>
          )}
        </span>

        {/* 信息条：名称 + 期刊溯源（open-design 作品说明行） */}
        <span className="block px-3 py-2.5">
          <span className="flex items-center gap-1.5">
            <Icon className={cn('h-3.5 w-3.5 shrink-0', a.text)} aria-hidden />
            <span className="truncate text-[13px] font-semibold leading-tight">{t(tpl.name)}</span>
            <span className="ml-auto shrink-0 font-mono text-[9px] font-medium text-muted-foreground">{tpl.demo}</span>
          </span>
          <span className="mt-1 block truncate text-[10.5px] leading-relaxed text-muted-foreground" title={t(tpl.tagline)}>
            {t(tpl.tagline)}
          </span>
          <span className="mt-1.5 flex items-center gap-1.5">
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', a.text.replace('text-', 'bg-'))} aria-hidden />
            <span className="truncate text-[9.5px] text-muted-foreground">
              {t({ zh: '图式参考', en: 'Style ref.' })} · {tpl.citation.journal} {tpl.citation.year}
            </span>
            {tpl.category === 'membrane' && (
              <span className="ml-auto shrink-0 rounded bg-foreground/[0.06] px-1.5 py-px text-[9px] font-semibold text-foreground/70">
                {t({ zh: '特定类型', en: 'Type-specific' })}
              </span>
            )}
          </span>
        </span>
      </button>
    </article>
  )
}

export function WelcomeScreen() {
  const { t } = useI18n()
  const { resolvedTheme, setTheme } = useTheme()
  const loading = useMolStore(s => s.loading)
  const loadingMsg = useMolStore(s => s.loadingMsg)
  const agentOpen = useMolStore(s => s.ui.agentOpen)
  const setUi = useMolStore(s => s.setUi)
  const [id, setId] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [filter, setFilter] = useState<FigureCategory | 'all'>('all')
  const [busyId, setBusyId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const shown = filter === 'all' ? FIGURE_TEMPLATES : FIGURE_TEMPLATES.filter(x => x.category === filter)

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

  // 画廊卡片 → 演示加载（demoThenApply：加载代表结构 + 应用图式命令序列；
  // 成功后结构就位，欢迎页整体卸载交棒工作台）
  const demo = async (tpl: FigureTemplate) => {
    if (busyId || loading) return
    setBusyId(tpl.id)
    try {
      await demoThenApply(tpl)
      toast.success(tt({ zh: `演示就绪：「${t(tpl.name)}」on ${tpl.demo}`, en: `Demo ready: "${t(tpl.name)}" on ${tpl.demo}` }))
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
      {/* 背景：三轨道原子线稿缓慢旋转（电子沿轨巡航）+ 径向晕影；
          深入两栏之下若隐若现（栏背景透明，卡片后轨道可见） */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        {/* 径向晕影（浅色专属：边缘极淡冷灰，中心让位 hero） */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_65%_at_38%_40%,transparent_38%,color-mix(in_oklab,var(--foreground)_3.5%,transparent)_100%)] dark:hidden" />
        <svg
          viewBox="0 0 480 480"
          className="welcome-orbit h-[min(76vh,600px,92vw)] w-[min(76vh,600px,92vw)] text-foreground/[0.075] dark:text-foreground/[0.055] [mask-image:radial-gradient(circle,transparent_18%,black_52%,black_64%,transparent_86%)]"
        >
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <ellipse cx="240" cy="240" rx="232" ry="88" />
            <ellipse cx="240" cy="240" rx="232" ry="88" transform="rotate(60 240 240)" />
            <ellipse cx="240" cy="240" rx="232" ry="88" transform="rotate(120 240 240)" />
            <polygon points="240,12 437.5,126 437.5,354 240,468 42.5,354 42.5,126" strokeOpacity="0.55" />
          </g>
          {/* 轨道电子：沿最外椭圆巡航（SVG 原生 animateMotion；reduced-motion 由 UA 策略停用） */}
          <circle r="2.5" className="fill-primary">
            <animateMotion dur="16s" repeatCount="indefinite" path={ORBIT_PATH} />
          </circle>
          <circle r="1.8" className="fill-primary" opacity="0.65">
            <animateMotion dur="16s" begin="-8s" repeatCount="indefinite" path={ORBIT_PATH} />
          </circle>
        </svg>
      </div>

      {/* ── 顶栏（r74：品牌 + 全局动作——open-design 导航惯例；语言浮动位迁入） ── */}
      <header
        data-welcome-topbar
        className="welcome-in relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-border/60 bg-background/70 px-4 backdrop-blur-sm sm:px-5"
        style={{ animationDelay: '40ms' }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {/* 品牌 monogram（静态小六角 + 双轨道线——hero 大徽章的缩影） */}
          <svg viewBox="0 0 28 28" className="h-[22px] w-[22px] shrink-0" aria-hidden>
            <polygon points="14,1 25.1,7.25 25.1,20.75 14,27 2.9,20.75 2.9,7.25" className="fill-primary" />
            <g fill="none" stroke="currentColor" strokeWidth="1" className="text-primary-foreground" opacity="0.9">
              <ellipse cx="14" cy="14" rx="8" ry="3" />
              <ellipse cx="14" cy="14" rx="8" ry="3" transform="rotate(60 14 14)" />
            </g>
          </svg>
          <span className="text-[15px] font-bold leading-none tracking-[-0.01em]">MolVision</span>
          <span className="hidden rounded-full border border-foreground/[0.16] px-1.5 py-px font-mono text-[9px] font-semibold tracking-wide text-muted-foreground sm:inline dark:border-white/15">
            v1.4
          </span>
        </div>
        <span className="mol-micro ml-1 hidden truncate text-muted-foreground/70 lg:inline">
          Molecular Visualization Studio
        </span>
        <div className="flex-1" />
        {/* 右侧动作：语言轨道（welcome 内联胶囊）· 主题 · GitHub */}
        <div className="flex shrink-0 items-center gap-1.5">
          <LanguageToggle variant="welcome" />
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            suppressHydrationWarning
            aria-label={t({ zh: '切换深浅主题', en: 'Toggle light/dark theme' })}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            <Sun className="h-4 w-4 hidden dark:block" />
            <Moon className="h-4 w-4 dark:hidden" />
          </button>
          <a
            href="https://github.com/Jing0715-fer/MolVision"
            target="_blank"
            rel="noreferrer"
            aria-label={t({ zh: 'GitHub 仓库', en: 'GitHub repository' })}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
          >
            <Github className="h-4 w-4" />
          </a>
        </div>
      </header>

      {/* ── 主体：lg+ 左右分栏各自独立滚动；<lg 垂直堆叠整页滚动 ── */}
      <div className="mol-scroll relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">

        {/* 取景框四角刻度线（仪器签名细节；锚在主体区——顶栏/仪表条之外） */}
        <div aria-hidden className="pointer-events-none absolute inset-0 z-10">
          <span className="corner-tick tl" />
          <span className="corner-tick tr" />
          <span className="corner-tick bl" />
          <span className="corner-tick br" />
        </div>

        {/* —— 左栏：hero 加载舱（仪器语义原样；lg+ 垂直居中，矮视口可滚） —— */}
        <div className="mol-scroll flex w-full flex-col lg:w-[400px] lg:shrink-0 lg:overflow-y-auto lg:border-r lg:border-border/60 xl:w-[448px]">
          <div className="m-auto flex w-full max-w-[368px] flex-col items-center px-6 py-10 lg:px-7 [&:has(.panel-card)_.load-sep]:mt-7">

            {/* —— 品牌 hero（六角芯片：弹性入场 + halo 呼吸 + 双电子巡航 + 原子核呼吸） —— */}
            <div className="hero-badge-in relative flex h-[76px] w-[76px] items-center justify-center" aria-hidden>
              <svg viewBox="0 0 28 28" className="hero-halo absolute inset-0 h-full w-full">
                <polygon points="14,1 25.1,7.25 25.1,20.75 14,27 2.9,20.75 2.9,7.25" className="fill-primary" />
              </svg>
              <svg
                viewBox="0 0 20 20"
                className="relative h-[46px] w-[46px] text-primary-foreground"
                fill="none" stroke="currentColor" strokeWidth="1.1"
              >
                <ellipse cx="10" cy="10" rx="8.2" ry="3.1" />
                <ellipse cx="10" cy="10" rx="8.2" ry="3.1" transform="rotate(60 10 10)" />
                <ellipse cx="10" cy="10" rx="8.2" ry="3.1" transform="rotate(120 10 10)" />
                <circle className="nucleus-breathe" cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
                <circle r="0.95" fill="#fff" stroke="none">
                  <animateMotion dur="7s" repeatCount="indefinite" path={MINI_ORBIT_A} />
                </circle>
                <circle r="0.75" fill="#fff" stroke="none" opacity="0.75">
                  <animateMotion dur="10.5s" begin="-3.5s" repeatCount="indefinite" path={MINI_ORBIT_B} />
                </circle>
              </svg>
            </div>
            <h1 className="welcome-in mt-5 text-[34px] font-extrabold leading-none tracking-[-0.022em] lg:text-[38px]" style={{ animationDelay: '60ms' }}>
              MolVision
            </h1>
            <div
              className="welcome-in mol-micro mt-4 text-muted-foreground"
              style={{ animationDelay: '110ms', letterSpacing: '0.24em' }}
            >
              Molecular Visualization Studio
            </div>
            <p className="welcome-in mt-2.5 text-center text-[11px] leading-relaxed text-muted-foreground" style={{ animationDelay: '150ms' }}>
              {t({ zh: '在浏览器中探索蛋白质 · 核酸 · 配体与电子密度', en: 'Explore proteins · nucleic acids · ligands & electron density in the browser' })}
            </p>

            {/* 版本徽章（正式产品可信度：版本 + 引擎就绪读数） */}
            <div className="welcome-in mt-5 flex items-center gap-2" style={{ animationDelay: '185ms' }}>
              <span className="flex items-center gap-1.5 rounded-full border border-foreground/[0.16] dark:border-white/15 px-2.5 py-[3.5px]">
                <span className="led-pulse h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
                <span className="font-mono text-[9px] font-semibold tracking-[0.12em] text-muted-foreground">
                  v1.4 · {t({ zh: 'WebGL 引擎就绪', en: 'WebGL engine ready' })}
                </span>
              </span>
            </div>

            {/* —— 继续上次会话（dynamic ssr:false 客户端挂载：水合安全 + 存档读取） —— */}
            <SessionResumeSlot />

            {/* —— 加载结构（fieldset 式图例分隔；:has 自适应——恢复卡挂载后收紧间距） —— */}
            <div
              className="load-sep welcome-in mt-10 flex w-full items-center gap-2.5"
              style={{ animationDelay: '240ms' }}
            >
              <span className="h-px flex-1 bg-foreground/[0.14] dark:bg-foreground/[0.13]" />
              <span className="mol-micro text-muted-foreground">{t({ zh: '加载结构', en: 'Load structure' })}</span>
              <span className="h-px flex-1 bg-foreground/[0.14] dark:bg-foreground/[0.13]" />
            </div>

            <form
              onSubmit={e => { e.preventDefault(); submitId() }}
              className="welcome-in mt-4 flex w-full gap-2"
              style={{ animationDelay: '280ms' }}
            >
              <input
                ref={inputRef}
                value={id}
                onChange={e => setId(e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''))}
                maxLength={4}
                placeholder={t({ zh: 'PDB 编号 · 如 4HHB', en: 'PDB ID · e.g. 4HHB' })}
                aria-label={t({ zh: 'PDB 编号', en: 'PDB ID' })}
                autoComplete="off"
                spellCheck={false}
                className="h-12 w-full min-w-0 flex-1 rounded-md border border-foreground/20 bg-card text-center font-mono text-[15px] font-medium uppercase tracking-[0.28em] text-foreground shadow-[inset_0_1px_2px_oklch(0.25_0.01_80/0.07)] outline-none transition-[border-color,box-shadow] duration-150 placeholder:font-sans placeholder:text-[11.5px] placeholder:font-normal placeholder:tracking-[0.1em] placeholder:text-muted-foreground hover:border-foreground/35 focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_24%,transparent),inset_0_1px_2px_oklch(0.25_0.01_80/0.04)] dark:border-white/[0.16] dark:bg-white/[0.045] dark:shadow-none dark:hover:border-white/25 dark:focus-visible:border-primary dark:focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--primary)_26%,transparent)]"
              />
              <button
                type="submit"
                disabled={loading || id.length !== 4}
                className="welcome-cta flex h-12 shrink-0 select-none items-center gap-2 rounded-md bg-primary px-5 text-[13px] font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t({ zh: '获取结构', en: 'Fetch' })}
              </button>
            </form>

            {/* 状态行：固定高度避免加载态布局位移 */}
            <div className="welcome-in mt-2.5 flex h-4 w-full items-center justify-center" style={{ animationDelay: '300ms' }}>
              {loading ? (
                <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-primary">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {loadingMsg || t({ zh: '处理中…', en: 'Processing…' })}
                </span>
              ) : (
                <span className="text-center text-[10px] text-muted-foreground">
                  {t({ zh: 'RCSB 实时获取 · 可拖放文件到页面', en: 'Live from RCSB PDB · drag & drop files anywhere' })}
                </span>
              )}
            </div>

            {/* —— 本地文件（含 .molvision 会话）：容器化底座提升可点击暗示 —— */}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={loading}
              className="welcome-in group mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-md border border-foreground/[0.16] bg-secondary/50 text-xs font-medium text-foreground/85 shadow-[inset_0_1px_0_oklch(1_0_0/0.5)] transition-[border-color,background-color,transform] duration-150 hover:border-foreground/30 hover:bg-secondary/80 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 dark:border-white/[0.13] dark:bg-white/[0.035] dark:shadow-none dark:hover:border-white/25 dark:hover:bg-white/[0.06]"
              style={{ animationDelay: '340ms' }}
            >
              <FolderOpen className="h-3.5 w-3.5 text-primary/80 transition-transform duration-200 group-hover:-translate-y-px" />
              {t({ zh: '打开本地文件…', en: 'Open local file…' })}
              <span className="font-mono text-[9.5px] font-normal tracking-wide text-muted-foreground/85">
                PDB / CIF / CCP4 / .molvision
              </span>
            </button>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdb,.ent,.cif,.mmcif,.txt,.molvision,.json,.ccp4,.map,.mrc"
              className="hidden"
              onChange={e => {
                if (e.target.files?.length) loadFiles(e.target.files)
              }}
            />

            {/* —— 经典示例（卡片化芯片：ID 主色等宽 + 名称灰阶，悬停浮起） —— */}
            <div className="welcome-in mt-8 flex w-full items-center gap-2.5" style={{ animationDelay: '380ms' }}>
              <span className="h-px flex-1 bg-foreground/[0.18] dark:bg-foreground/[0.16]" />
              <span className="mol-micro text-muted-foreground">{t({ zh: '经典示例', en: 'Classic examples' })}</span>
              <span className="h-px flex-1 bg-foreground/[0.18] dark:bg-foreground/[0.16]" />
            </div>
            <div className="welcome-in mt-3.5 flex flex-wrap justify-center gap-2" style={{ animationDelay: '420ms' }}>
              {WELCOME_EXAMPLES.map(ex => (
                <button
                  key={ex.id}
                  onClick={() => void fetchPdbId(ex.id)}
                  disabled={loading}
                  className="group flex items-center gap-2 rounded-md border border-foreground/[0.16] bg-secondary/55 px-3 py-2 transition-[border-color,background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:border-primary/45 hover:bg-primary/[0.06] hover:shadow-[0_2px_10px_color-mix(in_oklab,var(--primary)_13%,transparent)] active:translate-y-0 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 dark:border-white/[0.11] dark:bg-white/[0.03] dark:hover:border-primary/50 dark:hover:bg-primary/[0.09]"
                >
                  <span className="font-mono text-[11px] font-bold leading-none tracking-[0.08em] text-primary/90 transition-colors duration-150 group-hover:text-primary">
                    {ex.id}
                  </span>
                  <span className="text-[11px] leading-none text-muted-foreground transition-colors duration-150 group-hover:text-foreground/85">
                    {t(ex.title)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* —— 右栏：论文图模板画廊（open-design 作品橱窗；lg+ 独立滚动） —— */}
        <section
          aria-label={t({ zh: '论文图模板画廊', en: 'Paper-figure template gallery' })}
          className="mol-scroll flex min-h-0 w-full flex-1 flex-col lg:overflow-y-auto"
        >
          {/* 区头（sticky 毛玻璃常驻）：标题 + 计数 + 分类过滤 + 库入口 */}
          <div className="gallery-head-blur welcome-in sticky top-0 z-10 border-b border-border/50 px-5 py-3.5 sm:px-7" style={{ animationDelay: '260ms' }}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <BookOpenText className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <h2 className="text-[15px] font-bold leading-none tracking-[-0.01em]">
                {t({ zh: '论文图模板', en: 'Paper-figure styles' })}
              </h2>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[9.5px] font-bold text-primary">
                {FIGURE_TEMPLATES.length}
              </span>
              <div className="ml-auto flex items-center gap-1.5" role="group" aria-label={t({ zh: '画廊分类', en: 'Gallery categories' })}>
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
                        'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
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
              <button
                type="button"
                onClick={() => setUi({ templateOpen: true })}
                className="flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full border border-border bg-card px-3 text-[11px] font-semibold text-foreground/85 transition-[border-color,background-color] duration-150 hover:border-primary/45 hover:bg-primary/[0.06] hover:text-foreground"
                title={t({ zh: '打开完整模板库（可应用到已加载结构）', en: 'Open the full template library (applies to loaded structures)' })}
              >
                {t({ zh: '在库中浏览', en: 'Browse library' })}
                <ArrowUpRight className="h-3 w-3 text-primary" aria-hidden />
              </button>
            </div>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
              {t({
                zh: 'Cell / Nature / Science 结构文章的经典图式——缩略图由引擎真实渲染，点击卡片即刻加载演示结构并应用',
                en: 'Classic figure styles from Cell / Nature / Science papers — thumbnails are genuine engine renders; click a card to load the demo structure with the style applied',
              })}
            </p>
          </div>

          {/* 画廊网格（过滤切换时 key 变化重播 stagger 入场） */}
          <div className="px-5 pb-24 pt-4 sm:px-7 lg:pb-20">
            <div
              key={filter}
              data-welcome-gallery
              className="grid grid-cols-1 gap-3.5 min-[420px]:grid-cols-2 xl:grid-cols-3"
            >
              {shown.map(tpl => (
                <GalleryCard
                  key={tpl.id}
                  tpl={tpl}
                  index={FIGURE_TEMPLATES.indexOf(tpl)}
                  busy={busyId === tpl.id || loading}
                  onDemo={() => void demo(tpl)}
                />
              ))}
            </div>
            {/* 诚实版权脚注（与模板库对话框同口径） */}
            <p className="gallery-card-in mt-5 flex max-w-xl items-start gap-1.5 text-[10px] leading-relaxed text-muted-foreground" style={{ animationDelay: '700ms' }}>
              <Wand2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              {t({
                zh: '模板复现的是图式视觉配方（表示法·配色·视角·灯光·轮廓）与分析命令（孔道剖面/脂双层），不含论文原图；缩略图由 MolVision 引擎对代表结构真实渲染。',
                en: 'Templates reproduce figure-style recipes (representations · coloring · camera · lighting · outlines) and analysis commands (pore profiles / bilayers), not original artwork; thumbnails are genuine MolVision engine renders.',
              })}
            </p>
          </div>
        </section>
      </div>

      {/* AI 助手悬浮入口（仪器胶囊：LED 待机 + ⌘J 快捷键；面板打开时让位隐藏）
          r74：锚在根级非滚动层（曾嵌在滚动主体内——移动端会随内容滚走） */}
      {!agentOpen && (
          <button
            onClick={() => setUi({ agentOpen: true })}
            className="welcome-in welcome-float-chip group bottom-5 right-5 z-20 flex h-10 select-none items-center gap-2.5 border-primary/30 bg-card/92 pl-3 pr-3.5 shadow-[0_2px_14px_color-mix(in_oklab,var(--primary)_22%,transparent)] hover:border-primary/55 hover:shadow-[0_5px_20px_color-mix(in_oklab,var(--primary)_36%,transparent)] active:scale-[0.97]"
            style={{ animationDelay: '460ms' }}
            aria-keyshortcuts="Control+J"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/12 text-primary transition-transform duration-200 group-hover:scale-105">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-semibold tracking-wide">{t({ zh: 'AI 助手', en: 'AI Assistant' })}</span>
            <span className="hidden items-center gap-0.5 font-mono text-[9px] font-medium text-muted-foreground/80 sm:flex">
              <kbd className="rounded border border-border bg-background px-1 py-px leading-none">⌘</kbd>J
            </span>
            <span className="led-dot led-pulse h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
          </button>
        )}

      {/* 面板打开时背景聚焦遮罩（极淡压暗：视觉重心让位 AI 对话；不拦截交互） */}
      <div
          aria-hidden
          className={`pointer-events-none absolute inset-0 z-10 bg-background/35 opacity-0 transition-opacity duration-300 motion-reduce:transition-none ${agentOpen ? 'opacity-100' : ''}`}
        />

      {/* AI 助手面板（悬浮变体：与右下胶囊同一悬浮语言；加载结构后随工作台重挂载并还原历史） */}
      <AgentPanel float />

      {/* 墨色仪表底座（待机遥测读数；语言次入口保留——顶栏为主入口）
          主题/GitHub 已上移顶栏（r74 去重） */}
      <footer className="instrument-bar relative z-30 flex h-9 shrink-0 items-center gap-3 px-4">
        <span className="status-val font-bold tracking-wide" style={{ color: 'var(--status-hot)' }}>MolVision <span className="opacity-70">v1.4</span></span>
        <span className="status-sep" />
        <span className="status-val flex items-center gap-1.5">
          <span className="led-dot led-pulse h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
          {t({ zh: '待机 · 等待结构加载', en: 'Standby · awaiting structure' })}
        </span>
        <span className="status-sep hidden md:block" />
        <span className="status-val hidden md:block">{t({ zh: 'WebGL 引擎', en: 'WebGL engine' })}</span>
        <span className="status-sep hidden lg:block" />
        <span className="status-val hidden lg:block">© 2026</span>
        <span className="status-sep hidden xl:block" />
        <span className="status-val hidden truncate text-[color:var(--status-dim)] xl:block">
          {t({ zh: '拖放 PDB / CIF / .molvision 文件即可加载 · ⌘K 命令面板 · ⌘J AI 助手', en: 'Drop PDB / CIF / .molvision files to load · ⌘K command palette · ⌘J AI assistant' })}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <LanguageToggle variant="default" />
        </div>
      </footer>

      {/* 拖放遮罩（松手提示；pointer-events-none 让 drop 落到根元素） */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-background/[0.92] ring-1 ring-primary/45 ring-inset">
          <div className="flex flex-col items-center gap-2">
            <FileUp className="h-6 w-6 text-primary" />
            <span className="text-[13px] font-medium">{t({ zh: '松开以加载文件', en: 'Drop to load files' })}</span>
            <span className="font-mono text-[10px] tracking-wide text-muted-foreground">
              {t({ zh: '.pdb / .cif / .ccp4 密度图 / .molvision 会话', en: '.pdb / .cif / .ccp4 maps / .molvision sessions' })}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
