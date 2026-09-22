'use client'

// 欢迎页：未加载结构时的「仪器待机」大屏（整屏接管，替代工作台界面）
// r45 VLM 评审驱动打磨：
//   · 注入生命力——轨道电子 animateMotion 巡航、六角 halo 呼吸、原子核呼吸、LED 待机脉冲
//   · CTA 晶体按键（顶部晶面高光 + 底部厚度内阴影 + 主色柔光）
//   · 浅色主题对比度危机修复——轨道线加深、径向晕影聚焦、分割线可见化
//   · 版本徽章 + © 信息（专业软件可信度）；示例芯片卡片化（ID/名称视觉分层）
// 仅保留必要入口：继续上次会话 / PDB 编号加载 / 本地文件（含 .molvision 会话）/ 经典示例
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  Bot, FileUp, FolderOpen, Github, Loader2, Moon, Sun,
} from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { EXAMPLE_STRUCTURES, fetchPdbId, loadFiles } from '@/lib/molecular/loader'
import { SessionResumeSlot } from './SessionResumeCard'
import { AgentPanel } from './AgentPanel'

/** 欢迎页示例精选（6 个均衡覆盖小蛋白/酶/四聚体/DNA/药物靶点；完整列表在加载对话框） */
const WELCOME_EXAMPLES = EXAMPLE_STRUCTURES.filter(ex => ex.id !== '1D3Z')

/** 背景大轨道电子巡航路径（椭圆 cx240 cy240 rx232 ry88） */
const ORBIT_PATH = 'M 472 240 A 232 88 0 1 1 8 240 A 232 88 0 1 1 472 240'
/** 品牌 monogram 内电子巡航路径（20×20 视图，rx8.2 ry3.1；一条原始角 + 一条 60° 角） */
const MINI_ORBIT_A = 'M 18.2 10 A 8.2 3.1 0 1 1 1.8 10 A 8.2 3.1 0 1 1 18.2 10'
const MINI_ORBIT_B = 'M 14.1 17.1 A 8.2 3.1 60 1 1 5.9 2.9 A 8.2 3.1 60 1 1 14.1 17.1'

export function WelcomeScreen() {
  const { resolvedTheme, setTheme } = useTheme()
  const loading = useMolStore(s => s.loading)
  const loadingMsg = useMolStore(s => s.loadingMsg)
  const agentOpen = useMolStore(s => s.ui.agentOpen)
  const setUi = useMolStore(s => s.setUi)
  const [id, setId] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 精确指针设备才自动聚焦（触屏避免弹出键盘）
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) inputRef.current?.focus()
  }, [])

  const submitId = () => {
    const v = id.trim().toUpperCase()
    if (!v) return
    if (!/^[0-9][A-Z0-9]{3}$/.test(v)) {
      toast.error('PDB 编号为 4 位字符（如 4HHB、1CRN）')
      return
    }
    void fetchPdbId(v)
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
      {/* 背景：三轨道原子线稿缓慢旋转（电子沿轨巡航）+ 六角晶格虚线外框；
          浅色主题轨道线加深一档（对比度危机修复），并叠径向晕影把视线收拢到中央 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        {/* 径向晕影（浅色专属：边缘极淡冷灰，中心让位 hero） */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_75%_65%_at_50%_42%,transparent_38%,color-mix(in_oklab,var(--foreground)_3.5%,transparent)_100%)] dark:hidden" />
        <svg
          viewBox="0 0 480 480"
          className="welcome-orbit h-[min(76vh,600px,92vw)] w-[min(76vh,600px,92vw)] text-foreground/[0.095] dark:text-foreground/[0.06] [mask-image:radial-gradient(circle,transparent_18%,black_52%,black_64%,transparent_86%)]"
        >
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <ellipse cx="240" cy="240" rx="232" ry="88" />
            <ellipse cx="240" cy="240" rx="232" ry="88" transform="rotate(60 240 240)" />
            <ellipse cx="240" cy="240" rx="232" ry="88" transform="rotate(120 240 240)" />
            <polygon points="240,12 437.5,126 437.5,354 240,468 42.5,354 42.5,126" strokeDasharray="3 5" />
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

      {/* 取景框四角刻度线（仪器签名细节） */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="corner-tick tl" />
        <span className="corner-tick tr" />
        <span className="corner-tick bl" />
        <span className="corner-tick br" />
      </div>

      {/* 主体（m-auto 居中，视口过矮时滚动不裁切）；外层 relative 锚定 AI 助手面板与悬浮入口 */}
      <div className="relative z-10 flex min-h-0 flex-1">
        <div className="mol-scroll flex w-full flex-col overflow-y-auto px-6 py-10">
        <div className="m-auto flex w-full max-w-[448px] flex-col items-center [&:has(.panel-card)_.load-sep]:mt-7">

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
          <h1 className="welcome-in mt-5 text-[34px] font-extrabold leading-none tracking-[-0.022em]" style={{ animationDelay: '60ms' }}>
            MolVision
          </h1>
          <div
            className="welcome-in mol-micro mt-4 text-muted-foreground"
            style={{ animationDelay: '110ms', letterSpacing: '0.24em' }}
          >
            Molecular Visualization Studio
          </div>
          <p className="welcome-in mt-2.5 text-[11px] leading-relaxed text-muted-foreground" style={{ animationDelay: '150ms' }}>
            在浏览器中探索蛋白质 · 核酸 · 配体与电子密度
          </p>

          {/* 版本徽章（正式产品可信度：版本 + 引擎就绪读数） */}
          <div className="welcome-in mt-5 flex items-center gap-2" style={{ animationDelay: '185ms' }}>
            <span className="flex items-center gap-1.5 rounded-full border border-foreground/[0.16] dark:border-white/15 px-2.5 py-[3.5px]">
              <span className="led-pulse h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                v1.4 · Engine Ready
              </span>
            </span>
          </div>

          {/* —— 继续上次会话（dynamic ssr:false 客户端挂载：水合安全 + 存档读取） —— */}
          <SessionResumeSlot />

          {/* —— 加载结构（fieldset 式图例分隔；:has 自适应——恢复卡挂载后收紧间距） —— */}
          <div
            className="load-sep welcome-in flex w-full items-center gap-2.5 mt-10"
            style={{ animationDelay: '240ms' }}
          >
            <span className="h-px flex-1 bg-foreground/[0.18] dark:bg-foreground/[0.16]" />
            <span className="h-[3px] w-[3px] rotate-45 bg-muted-foreground/60" />
            <span className="mol-micro text-muted-foreground">加载结构</span>
            <span className="h-[3px] w-[3px] rotate-45 bg-muted-foreground/60" />
            <span className="h-px flex-1 bg-foreground/[0.18] dark:bg-foreground/[0.16]" />
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
              placeholder="PDB 编号 · 如 4HHB"
              aria-label="PDB 编号"
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
              获取结构
            </button>
          </form>

          {/* 状态行：固定高度避免加载态布局位移 */}
          <div className="welcome-in mt-2.5 flex h-4 w-full items-center justify-center" style={{ animationDelay: '300ms' }}>
            {loading ? (
              <span className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                {loadingMsg || '处理中…'}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground">
                RCSB Protein Data Bank 实时获取 · 可拖放文件到页面
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
            打开本地文件…
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
            <span className="mol-micro text-muted-foreground">经典示例</span>
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
                  {ex.title}
                </span>
              </button>
            ))}
          </div>
        </div>
        </div>

        {/* AI 助手悬浮入口（仪器胶囊：LED 待机 + ⌘J 快捷键；面板打开时让位隐藏） */}
        {!agentOpen && (
          <button
            onClick={() => setUi({ agentOpen: true })}
            className="welcome-in group absolute bottom-5 right-5 z-20 flex h-10 select-none items-center gap-2.5 rounded-full border border-primary/30 bg-card/92 pl-3 pr-3.5 shadow-[0_2px_14px_color-mix(in_oklab,var(--primary)_22%,transparent)] backdrop-blur-sm transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/55 hover:shadow-[0_5px_20px_color-mix(in_oklab,var(--primary)_36%,transparent)] active:translate-y-0 active:scale-[0.97]"
            style={{ animationDelay: '460ms' }}
            aria-keyshortcuts="Control+J"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/12 text-primary transition-transform duration-200 group-hover:scale-105">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <span className="text-xs font-semibold tracking-wide">AI 助手</span>
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
      </div>

      {/* 墨色仪表底座（待机遥测读数 + 版本/版权 + 主题/GitHub） */}
      <footer className="instrument-bar relative z-10 flex h-9 shrink-0 items-center gap-3 px-4">
        <span className="status-micro">MolVision v1.4</span>
        <span className="status-sep" />
        <span className="status-val flex items-center gap-1.5">
          <span className="led-dot led-pulse h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
          待机 STANDBY
        </span>
        <span className="status-sep" />
        <span className="status-val hidden sm:block">SYS OK</span>
        <span className="status-sep hidden sm:block" />
        <span className="status-val hidden md:block">ENGINE WEBGL</span>
        <span className="status-sep hidden md:block" />
        <span className="status-val hidden lg:block">© 2026</span>
        <span className="status-sep hidden lg:block" />
        <span className="status-val hidden truncate text-[color:var(--status-dim)] xl:block">
          拖放 PDB / CIF / .molvision 文件即可加载 · ⌘K 命令面板 · ⌘J AI 助手
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            suppressHydrationWarning
            aria-label="切换深浅主题"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--status-dim)] transition-colors duration-150 hover:bg-white/10 hover:text-[color:var(--status-fg)]"
          >
            <Sun className="h-[15px] w-[15px] hidden dark:block" />
            <Moon className="h-[15px] w-[15px] dark:hidden" />
          </button>
          <a
            href="https://github.com/Jing0715-fer/MolVision"
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub 仓库"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[color:var(--status-dim)] transition-colors duration-150 hover:bg-white/10 hover:text-[color:var(--status-fg)]"
          >
            <Github className="h-[15px] w-[15px]" />
          </a>
        </div>
      </footer>

      {/* 拖放遮罩（松手提示；pointer-events-none 让 drop 落到根元素） */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/[0.92] ring-1 ring-primary/45 ring-inset">
          <div className="flex flex-col items-center gap-2">
            <FileUp className="h-6 w-6 text-primary" />
            <span className="text-[13px] font-medium">松开以加载文件</span>
            <span className="font-mono text-[10px] tracking-wide text-muted-foreground">
              .pdb / .cif / .ccp4 密度图 / .molvision 会话
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
