'use client'

// 欢迎页：未加载结构时的「仪器待机」大屏（整屏接管，替代工作台界面）
// 精密仪器语言：六角原子 monogram + 缓转轨道线稿背景 + 取景框刻度线 + 墨色仪表底座
// 仅保留必要入口：继续上次会话 / PDB 编号加载 / 本地文件（含 .molvision 会话）/ 经典示例
import { useEffect, useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  FileUp, FolderOpen, Github, Loader2, Moon, Sun,
} from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { EXAMPLE_STRUCTURES, fetchPdbId, loadFiles } from '@/lib/molecular/loader'
import { SessionResumeSlot } from './SessionResumeCard'

/** 欢迎页示例精选（6 个均衡覆盖小蛋白/酶/四聚体/DNA/药物靶点；完整列表在加载对话框） */
const WELCOME_EXAMPLES = EXAMPLE_STRUCTURES.filter(ex => ex.id !== '1D3Z')

export function WelcomeScreen() {
  const { resolvedTheme, setTheme } = useTheme()
  const loading = useMolStore(s => s.loading)
  const loadingMsg = useMolStore(s => s.loadingMsg)
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
      {/* 背景：三轨道原子线稿缓慢旋转（呼应 monogram）+ 六角晶格虚线外框 + 轨道电子；
          晕影遮罩：中心（让位品牌 hero）与外缘淡出，注意力收敛到中央 */}
      <div aria-hidden className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
        <svg
          viewBox="0 0 480 480"
          className="welcome-orbit h-[min(76vh,600px,92vw)] w-[min(76vh,600px,92vw)] text-foreground/[0.055] [mask-image:radial-gradient(circle,transparent_18%,black_52%,black_64%,transparent_86%)]"
        >
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <ellipse cx="240" cy="240" rx="232" ry="88" />
            <ellipse cx="240" cy="240" rx="232" ry="88" transform="rotate(60 240 240)" />
            <ellipse cx="240" cy="240" rx="232" ry="88" transform="rotate(120 240 240)" />
            <polygon points="240,12 437.5,126 437.5,354 240,468 42.5,354 42.5,126" strokeDasharray="3 5" />
          </g>
          <circle cx="472" cy="240" r="2.5" className="fill-primary" opacity="0.5" />
        </svg>
      </div>

      {/* 取景框四角刻度线（仪器签名细节） */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <span className="corner-tick tl" />
        <span className="corner-tick tr" />
        <span className="corner-tick bl" />
        <span className="corner-tick br" />
      </div>

      {/* 主体（m-auto 居中，视口过矮时滚动不裁切） */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-10">
        <div className="m-auto flex w-full max-w-[420px] flex-col items-center [&:has(.panel-card)_.load-sep]:mt-6">

          {/* —— 品牌 hero（六角芯片带柔和电源光晕） —— */}
          <div className="welcome-in relative flex h-[76px] w-[76px] items-center justify-center" aria-hidden>
            <svg
              viewBox="0 0 28 28"
              className="absolute inset-0 h-full w-full"
              style={{ filter: 'drop-shadow(0 0 18px color-mix(in oklab, var(--primary) 26%, transparent))' }}
            >
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
              <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
            </svg>
          </div>
          <h1 className="welcome-in mt-5 text-[32px] font-extrabold leading-none tracking-[-0.02em]" style={{ animationDelay: '60ms' }}>
            MolVision
          </h1>
          <div
            className="welcome-in mol-micro mt-4 text-muted-foreground"
            style={{ animationDelay: '110ms', letterSpacing: '0.24em' }}
          >
            Molecular Visualization Studio
          </div>
          <p className="welcome-in mt-2.5 text-[11px] leading-relaxed text-muted-foreground/90" style={{ animationDelay: '150ms' }}>
            在浏览器中探索蛋白质 · 核酸 · 配体与电子密度
          </p>

          {/* —— 继续上次会话（dynamic ssr:false 客户端挂载：水合安全 + 存档读取） —— */}
          <SessionResumeSlot />

          {/* —— 加载结构（fieldset 式图例分隔；:has 自适应——恢复卡挂载后收紧间距） —— */}
          <div
            className="load-sep welcome-in flex w-full items-center gap-2.5 mt-10"
            style={{ animationDelay: '240ms' }}
          >
            <span className="h-px flex-1 bg-border/80" />
            <span className="h-[3px] w-[3px] rotate-45 bg-muted-foreground/45" />
            <span className="mol-micro text-muted-foreground">加载结构</span>
            <span className="h-[3px] w-[3px] rotate-45 bg-muted-foreground/45" />
            <span className="h-px flex-1 bg-border/80" />
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
              className="h-11 w-full min-w-0 flex-1 rounded-md border border-input bg-secondary/45 text-center font-mono text-[15px] font-medium uppercase tracking-[0.28em] text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:font-sans placeholder:text-[11.5px] placeholder:font-normal placeholder:tracking-[0.1em] placeholder:text-muted-foreground/85 focus-visible:border-ring/80 focus-visible:ring-[3px] focus-visible:ring-ring/35"
            />
            <button
              type="submit"
              disabled={loading || id.length !== 4}
              className="mol-btn-primary flex h-11 shrink-0 select-none items-center gap-2 rounded-md bg-primary px-5 text-[13px] font-medium text-primary-foreground transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
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
              <span className="text-[10px] text-muted-foreground/80">
                RCSB Protein Data Bank 实时获取 · 可拖放文件到页面
              </span>
            )}
          </div>

          {/* —— 本地文件（含 .molvision 会话） —— */}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={loading}
            className="welcome-in mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-border bg-transparent text-xs font-medium text-foreground/85 transition-[border-color,background-color] duration-150 hover:border-foreground/25 hover:bg-accent/60 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50"
            style={{ animationDelay: '340ms' }}
          >
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
            打开本地文件…
            <span className="font-mono text-[9.5px] font-normal tracking-wide text-muted-foreground/70">
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

          {/* —— 经典示例 —— */}
          <div className="welcome-in mt-8 flex w-full items-center gap-2.5" style={{ animationDelay: '380ms' }}>
            <span className="h-px flex-1 bg-border/80" />
            <span className="mol-micro text-muted-foreground">经典示例</span>
            <span className="h-px flex-1 bg-border/80" />
          </div>
          <div className="welcome-in mt-3.5 flex flex-wrap justify-center gap-1.5" style={{ animationDelay: '420ms' }}>
            {WELCOME_EXAMPLES.map(ex => (
              <button
                key={ex.id}
                onClick={() => void fetchPdbId(ex.id)}
                disabled={loading}
                className="group flex items-center gap-2 rounded-md border border-border bg-transparent px-2.5 py-[7px] transition-[border-color,background-color] duration-150 hover:border-primary/50 hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="font-mono text-[11px] font-bold leading-none tracking-[0.08em] text-foreground/75 transition-colors duration-150 group-hover:text-primary">
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

      {/* 墨色仪表底座（待机遥测读数 + 主题/GitHub） */}
      <footer className="instrument-bar relative z-10 flex h-9 shrink-0 items-center gap-3 px-4">
        <span className="status-micro">MolVision</span>
        <span className="status-sep" />
        <span className="status-val flex items-center gap-1.5">
          <span className="led-dot h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
          待机 STANDBY
        </span>
        <span className="status-sep" />
        <span className="status-val hidden sm:block">SYS OK</span>
        <span className="status-sep hidden sm:block" />
        <span className="status-val hidden md:block">ENGINE WEBGL</span>
        <span className="status-sep hidden md:block" />
        <span className="status-val hidden lg:block">SRC RCSB</span>
        <span className="status-sep hidden lg:block" />
        <span className="status-val hidden truncate text-[color:var(--status-dim)] xl:block">
          拖放 PDB / CIF / .molvision 文件即可加载 · Ctrl+K 打开命令面板
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
