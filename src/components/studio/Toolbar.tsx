'use client'

// 顶部工具栏 —— 精密仪器设计语言
// 结构：品牌区（六角原子 monogram + 字标）｜功能分组发丝线分隔｜分段测量控件｜右侧 AI/⌘K/主题集群
import { useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  Camera, ChevronDown, Crosshair, FolderOpen, FlaskConical, Github, HelpCircle, Video, CircleStop, Film,
  Home, Loader2, MousePointer2, RotateCw, Ruler, Sun, Moon, Terminal, Triangle, Rotate3d, Compass, Glasses, GraduationCap,
  FileDown, FilePlus2, FileUp, Save, HardDriveDownload, GitMerge, PenLine, Command as CommandIcon, Bot, Sparkles,
  Award, Target, Minimize2,
} from 'lucide-react'
import { engineRef, PRESETS, useMolStore } from '@/lib/molecular/store'
import { SCENE_PRESETS, applyScenePreset } from '@/lib/molecular/scenes'
import { runCommand } from '@/lib/molecular/commands'
import { EXAMPLE_STRUCTURES, fetchPdbId } from '@/lib/molecular/loader'
import { exportSessionFile, importSessionFile, mergeSessionFile, newSession, sessionInfo } from '@/lib/molecular/session'
import { buildSvgExport, downloadSvg } from '@/lib/molecular/svg-export'
import { TOURS } from '@/lib/molecular/tours'
import { useTourStore } from '@/lib/molecular/tour-store'
import { useRecordStore } from '@/lib/molecular/record-store'
import { stopMovie, useMovieStore } from '@/lib/molecular/movie'
import type { MeasureMode } from '@/lib/molecular/types'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const MEASURE_MODES: { mode: MeasureMode; label: string; icon: typeof Ruler; hint: string }[] = [
  { mode: 'off', label: '选择', icon: MousePointer2, hint: '选择模式（点击选择残基）' },
  { mode: 'distance', label: '距离', icon: Ruler, hint: '测距：点击 2 个原子' },
  { mode: 'angle', label: '角度', icon: Triangle, hint: '角度：点击 3 个原子' },
  { mode: 'dihedral', label: '二面角', icon: Rotate3d, hint: '二面角：点击 4 个原子' },
]

const TOUR_DOT: Record<string, string> = {
  emerald: 'bg-emerald-500', rose: 'bg-rose-500', amber: 'bg-amber-500', teal: 'bg-teal-500', violet: 'bg-violet-500',
  fuchsia: 'bg-fuchsia-500',
}

function TourDot({ accent }: { accent: string }) {
  return <span className={cn('mt-0.5 h-2 w-2 shrink-0 rounded-full', TOUR_DOT[accent] ?? 'bg-muted-foreground')} />
}

/** 品牌标识：六角晶格芯片 + 原子轨道线稿（MolVision monogram） */
function BrandMark() {
  return (
    <div className="relative flex h-7 w-7 shrink-0 items-center justify-center" aria-hidden>
      <svg viewBox="0 0 28 28" className="absolute inset-0 h-full w-full">
        <polygon points="14,1 25.1,7.25 25.1,20.75 14,27 2.9,20.75 2.9,7.25" className="fill-primary" />
      </svg>
      <svg viewBox="0 0 20 20" className="relative h-[17px] w-[17px] text-primary-foreground" fill="none" stroke="currentColor" strokeWidth="1.3">
        <ellipse cx="10" cy="10" rx="8.2" ry="3.1" />
        <ellipse cx="10" cy="10" rx="8.2" ry="3.1" transform="rotate(60 10 10)" />
        <ellipse cx="10" cy="10" rx="8.2" ry="3.1" transform="rotate(120 10 10)" />
        <circle cx="10" cy="10" r="1.3" fill="currentColor" stroke="none" />
      </svg>
    </div>
  )
}

/** 工具栏下拉触发器（幽灵样式：无边框，悬停浮起） */
function DropTrigger({ icon: Icon, label, show = 'lg', disabled, hint }: {
  icon: typeof Save; label: string; show?: 'md' | 'lg'; disabled?: boolean; hint: string
}) {
  return (
    <DropdownMenuTrigger asChild>
      <button
        disabled={disabled}
        aria-label={hint}
        className={cn(
          'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
          show === 'lg' ? 'hidden lg:flex' : 'hidden md:flex',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
        <ChevronDown className="h-3 w-3 opacity-50" />
      </button>
    </DropdownMenuTrigger>
  )
}

/** 场景预设图标映射 */
const SCENE_ICON: Record<string, typeof Award> = {
  award: Award, sparkles: Sparkles, target: Target, minimize: Minimize2,
}

export function Toolbar() {
  const { resolvedTheme, setTheme } = useTheme()
  const measureMode = useMolStore(s => s.measureMode)
  const setMeasureMode = useMolStore(s => s.setMeasureMode)
  const settings = useMolStore(s => s.settings)
  const updateSettings = useMolStore(s => s.updateSettings)
  const applyPreset = useMolStore(s => s.applyPreset)
  const activeId = useMolStore(s => s.activeId)
  const loading = useMolStore(s => s.loading)
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)
  const structures = useMolStore(s => s.structures)
  const recording = useRecordStore(s => s.recording)
  const moviePlaying = useMovieStore(s => s.playing)
  const timelineOpen = useMovieStore(s => s.timelineOpen)

  // 会话菜单：文件导入（替换/合并两种模式） + 新建确认
  const sessionFileRef = useRef<HTMLInputElement>(null)
  const [sessionImporting, setSessionImporting] = useState(false)
  const [confirmNewSession, setConfirmNewSession] = useState(false)
  /** 待导入模式：'replace' = 清空后恢复；'merge' = 追加到当前场景 */
  const sessionImportMode = useRef<'replace' | 'merge'>('replace')

  const onImportSession = async (file: File) => {
    setSessionImporting(true)
    const mode = sessionImportMode.current
    try {
      if (mode === 'merge') {
        const n = await mergeSessionFile(file)
        if (n > 0) toast.success('会话已合并到当前场景', { description: `新增 ${n} 个结构 · 名称冲突自动编号 · 书签重名跳过（来自 ${file.name}）` })
        else toast.error('会话文件中没有可恢复的结构', { description: file.name })
      } else {
        const n = await importSessionFile(file)
        if (n > 0) toast.success('会话已导入', { description: `${n} 个结构 · 表示法与相机视角已还原（来自 ${file.name}）` })
        else toast.error('会话文件中没有可恢复的结构', { description: file.name })
      }
    } catch (e) {
      toast.error(mode === 'merge' ? '合并会话失败' : '导入会话失败', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSessionImporting(false)
    }
  }

  const doNewSession = () => {
    const closed = newSession()
    toast.success(closed > 0 ? `已新建会话（关闭 ${closed} 个结构）` : '已新建会话', {
      description: '结构 / 书签 / 时间轴 / 密度图已清空 · 可随时「保存会话文件」留档分享',
    })
  }

  const capture = (scale: number, transparent: boolean) => {
    const eng = engineRef.current
    if (!eng) return
    try {
      const url = eng.capture({ scale, transparent })
      const a = document.createElement('a')
      a.href = url
      const name = structures[0]?.name ?? 'molvision'
      a.download = `${name}${scale > 1 ? `@${scale}x` : ''}${transparent ? '-透明' : ''}.png`
      a.click()
      toast.success(`截图已导出${scale > 1 ? `（${scale}× 分辨率）` : ''}`)
    } catch {
      toast.error('截图失败')
    }
  }

  // Ray 级静帧：先提示再渲染（内部高分辨率渲染+降采样可能阻塞数秒，让 toast 先上屏）
  const rayCapture = () => {
    const eng = engineRef.current
    if (!eng) return
    if (!eng.hasStructures) {
      toast.error('场景为空——先加载结构再渲染')
      return
    }
    toast.info('Ray 渲染中…', { description: 'PCF 软阴影 + 1.5× 真超采样抗锯齿，大场景可能需要数秒' })
    setTimeout(() => {
      void (async () => {
        try {
          const r = await eng.rayRender({})
          if (!r.url) throw new Error('empty')
          const a = document.createElement('a')
          a.href = r.url
          a.download = `${structures[0]?.name ?? 'molvision'}-ray-${r.w}x${r.h}.png`
          a.click()
          toast.success('Ray 渲染已导出', { description: `${r.w}×${r.h} px · 软阴影 + 真超采样抗锯齿 · ${r.ms.toFixed(0)} ms` })
        } catch {
          toast.error('Ray 渲染失败（试试更小尺寸或命令行 ray <宽>）')
        }
      })()
    }, 80)
  }

  // SVG 矢量导出：CPU 投影（无限缩放不失真，可入稿 Illustrator/Inkscape）
  const svgCapture = () => {
    const r = buildSvgExport({})
    if (!r.ok || !r.svg) {
      toast.error('SVG 导出失败', { description: r.error })
      return
    }
    downloadSvg(r.svg, structures[0]?.name ?? 'molvision')
    toast.success(`矢量图已导出（${r.width}×${r.height}）`, {
      description: `${r.items.toLocaleString()} 个原语 · ${r.ms.toFixed(0)} ms · 无限缩放不失真${r.skippedSurfaces.length ? ` · 跳过 ${r.skippedSurfaces.length} 个表面表示` : ''}`,
    })
  }

  return (
    <TooltipProvider delayDuration={300}>
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-background px-2 sm:px-2.5">
        {/* ── 品牌区 ── */}
        <div className="mr-1.5 flex shrink-0 items-center gap-2.5">
          <BrandMark />
          <div className="hidden leading-none md:block">
            <div className="text-[13px] font-extrabold tracking-[-0.02em]">MolVision</div>
            <div className="mol-micro mt-[3px] text-muted-foreground">Molecular Studio</div>
          </div>
        </div>

        <div className="mol-sep" />

        {/* 中间工具区：分组发丝线分隔；窄屏可横向滑动 */}
        <div className="mol-toolbar-scroll flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">

        {/* ── 文件组 ── */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ loadOpen: true })}
              className="mol-btn-primary flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-semibold text-primary-foreground transition hover:opacity-90 active:scale-[0.97] sm:px-3"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">加载结构</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>PDB 编号 / 本地文件 / .molvision 会话</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropTrigger icon={Save} label="会话" show="md" hint="会话文件与场景管理" />
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-xs">会话文件（.molvision）与场景管理</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                const ok = exportSessionFile()
                if (!ok) toast.error('无可导出的会话（先加载结构）')
                else toast.success('会话已导出为 .molvision 文件', { description: '含结构源文本 · 表示法 · 设置 · 相机视角 · 书签' })
              }}
              disabled={!structures.length}
              className="gap-2"
            >
              <FileDown className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">
                <span className="block text-xs">保存会话文件…</span>
                <span className="block text-[10px] text-muted-foreground">导出 .molvision，可跨设备分享</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { sessionImportMode.current = 'replace'; sessionFileRef.current?.click() }} disabled={sessionImporting} className="gap-2">
              {sessionImporting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                : <FileUp className="h-3.5 w-3.5 text-violet-500" />}
              <span className="flex-1">
                <span className="block text-xs">打开会话文件…</span>
                <span className="block text-[10px] text-muted-foreground">恢复 .molvision（替换当前场景）</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => { sessionImportMode.current = 'merge'; sessionFileRef.current?.click() }}
              disabled={sessionImporting}
              className="gap-2"
            >
              <GitMerge className="h-3.5 w-3.5 text-sky-500" />
              <span className="flex-1">
                <span className="block text-xs">合并会话文件…</span>
                <span className="block text-[10px] text-muted-foreground">叠加 .molvision 到当前场景（不清空）</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={e => { e.preventDefault(); setConfirmNewSession(true) }}
              className="gap-2"
            >
              <FilePlus2 className="h-3.5 w-3.5 text-rose-500" />
              <span className="flex-1">
                <span className="block text-xs">新建会话</span>
                <span className="block text-[10px] text-muted-foreground">清空全部结构与视图状态，从头开始</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="flex items-start gap-1.5 px-2 py-1">
              <HardDriveDownload className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                本地自动存档：{sessionInfo()}。可拖拽 .molvision 文件到视口直接导入。
              </p>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <input
          ref={sessionFileRef}
          type="file"
          accept=".molvision,.json"
          className="hidden"
          onClick={() => { /* 点击时机设定模式：菜单项点击时已写入 ref */ }}
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) void onImportSession(f)
            e.target.value = ''
          }}
        />

        <DropdownMenu>
          <DropTrigger icon={FlaskConical} label="示例" show="lg" hint="从 RCSB 一键加载示例结构" />
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs">从 RCSB 一键加载</DropdownMenuLabel>
            {EXAMPLE_STRUCTURES.map(ex => (
              <DropdownMenuItem key={ex.id} onClick={() => void fetchPdbId(ex.id)} className="gap-2">
                <span className="w-11 shrink-0 rounded bg-muted px-1 py-0.5 text-center font-mono text-[10px] font-semibold">{ex.id}</span>
                <span className="flex-1">
                  <span className="block text-xs font-medium">{ex.title}</span>
                  <span className="block text-[10px] text-muted-foreground">{ex.desc}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mol-sep" />

        {/* ── 风格组 ── */}
        <DropdownMenu>
          <DropTrigger icon={Sparkles} label="风格预设" show="lg" disabled={!activeId} hint="一键切换展示风格与场景组合" />
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="mol-micro">场景组合 · 一键工作流</DropdownMenuLabel>
            {Object.values(SCENE_PRESETS).map(sp => {
              const Icon = SCENE_ICON[sp.icon] ?? Sparkles
              return (
                <DropdownMenuItem
                  key={sp.key}
                  onClick={() => {
                    const r = applyScenePreset(sp.key, runCommand)
                    if (r.ok) toast.success(`已应用场景：${r.applied}`, { description: sp.after })
                    else toast.error(r.error ?? '场景应用失败')
                  }}
                  className="scene-item gap-2.5"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="flex-1">
                    <span className="block text-xs font-medium">{sp.label}</span>
                    <span className="block text-[10px] leading-snug text-muted-foreground">{sp.desc}</span>
                  </span>
                  <kbd className="shrink-0 rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground">{sp.commands.length} cmd</kbd>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="mol-micro">表示法 · 单项切换</DropdownMenuLabel>
            {Object.entries(PRESETS).map(([key, p], i) => (
              <DropdownMenuItem key={key} onClick={() => applyPreset(key)} className="gap-2 text-xs">
                <span className="w-4 text-center font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                {p.label}
              </DropdownMenuItem>
            ))}
            <p className="px-2 pb-1.5 pt-1 text-[9px] leading-relaxed text-muted-foreground/70">
              命令行同样可用：<code className="rounded bg-muted px-1 font-mono">preset publication</code> · <code className="rounded bg-muted px-1 font-mono">scene pocket</code>
            </p>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropTrigger icon={GraduationCap} label="演示" show="lg" hint="引导式演示场景" />
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-xs">引导式演示场景（逐步自动操作）</DropdownMenuLabel>
            {TOURS.map(t => (
              <DropdownMenuItem
                key={t.id}
                onClick={() => {
                  const cur = useTourStore.getState()
                  if (cur.tour?.id === t.id && cur.stepIdx > 0) {
                    // 同一场景重新开始
                    void cur.start(t.id)
                  } else {
                    void useTourStore.getState().start(t.id)
                  }
                }}
                className="gap-2.5"
              >
                <TourDot accent={t.accent} />
                <span className="flex-1">
                  <span className="block text-xs font-medium">{t.title}</span>
                  <span className="block text-[10px] text-muted-foreground">{t.tagline}</span>
                </span>
                <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">{t.steps.length} 步 · ≈{t.minutes} 分</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mol-sep" />

        {/* ── 视角组（图标按钮） ── */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => engineRef.current?.fitView()}
              aria-label="适配视图"
              className="tool-btn shrink-0"
            >
              <Crosshair className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>适配视图 (F)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => engineRef.current?.resetView()}
              aria-label="复位视角"
              className="tool-btn shrink-0"
            >
              <Home className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>复位视角</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => updateSettings({ spin: !settings.spin })}
              aria-label="自动旋转"
              className={cn('tool-btn shrink-0', settings.spin && 'bg-accent !text-foreground')}
            >
              <RotateCw className={cn('h-4 w-4', settings.spin && 'animate-[spin_3s_linear_infinite]')} />
            </button>
          </TooltipTrigger>
          <TooltipContent>自动旋转 (S)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => engineRef.current?.orient()}
              aria-label="主轴对齐视角"
              className="tool-btn shrink-0"
            >
              <Compass className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>主轴对齐视角 (PyMOL orient)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => updateSettings({ stereo: !settings.stereo })}
              aria-label="红蓝立体视图"
              className={cn('tool-btn shrink-0', settings.stereo && 'bg-rose-500/15 !text-rose-500')}
            >
              <Glasses className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>红蓝立体（stereo）</TooltipContent>
        </Tooltip>

        <div className="mol-sep" />

        {/* ── 测量组：分段控件（仪器范式） ── */}
        <div className="flex h-7 shrink-0 items-center gap-[2px] rounded-lg border border-border bg-card p-[2px]">
          {MEASURE_MODES.map(m => (
            <Tooltip key={m.mode}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setMeasureMode(m.mode); if (m.mode !== 'off') toast.info(`${m.hint}`) }}
                  aria-label={m.hint}
                  className={cn(
                    'flex h-[22px] w-[27px] items-center justify-center rounded-[5px] transition-all duration-150',
                    measureMode === m.mode
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <m.icon className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{m.hint}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="mol-sep" />

        {/* ── 媒体组 ── */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => {
                const eng = engineRef.current
                if (!eng) return
                if (eng.isRecording) return // 停止由 REC 徽章负责（带下载逻辑）
                const okStart = eng.startRecording()
                if (okStart) {
                  useRecordStore.getState().setRecording(true)
                  toast.success('开始录制动画', {
                    description: '可同时播放 ensemble / rock / spin —— 点击左上角 REC 徽章停止并下载 WebM',
                  })
                } else {
                  toast.error('当前浏览器不支持画布录制（MediaRecorder）')
                }
              }}
              className={cn('tool-btn shrink-0', recording && 'bg-red-500/15 !text-red-500')}
              aria-label={recording ? '录制中（REC 徽章停止）' : '录制动画为 WebM 视频'}
            >
              {recording ? <CircleStop className="h-4 w-4" /> : <Video className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{recording ? '停止录制（点击 REC 徽章下载）' : '录制动画为 WebM 视频'}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => {
                const ms = useMovieStore.getState()
                if (ms.playing) { stopMovie(); return }
                ms.setTimelineOpen(!ms.timelineOpen)
                if (!ms.timelineOpen && ms.timeline.length < 2) {
                  const n = ms.syncTimeline()
                  if (n >= 2) toast.info('已从视角书签同步时间轴', { description: `${n} 个关键帧——可拖拽排序、逐段调时长，然后点播放` })
                  else toast.info('movie 时间轴已打开', { description: '先保存 ≥2 个视角书签（V 键或 view save），再「同步书签」' })
                }
              }}
              className={cn(
                'tool-btn shrink-0',
                moviePlaying ? 'bg-teal-500/15 !text-teal-500' : timelineOpen && 'bg-teal-500/10 !text-teal-600 dark:!text-teal-400',
              )}
              aria-label={moviePlaying ? '停止 movie 序列播放' : 'movie 时间轴编排与巡航播放'}
            >
              <Film className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{moviePlaying ? '停止 movie 序列播放' : 'movie 时间轴：关键帧编排与巡航播放（拖拽排序、逐段时长）'}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="导出图像（PNG / Ray / SVG）"
              className="tool-btn shrink-0"
            >
              <Camera className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">导出图像</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => capture(1, false)} className="text-xs">标准分辨率 PNG</DropdownMenuItem>
            <DropdownMenuItem onClick={() => capture(2, false)} className="text-xs">2× 高清 PNG</DropdownMenuItem>
            <DropdownMenuItem onClick={() => capture(4, false)} className="text-xs">4× 超高清 PNG</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => capture(2, true)} className="text-xs">2× 透明背景 PNG</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => rayCapture()} className="gap-1.5 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              Ray 级渲染（软阴影 + 超采样）
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => svgCapture()} className="gap-1.5 text-xs">
              <PenLine className="h-3.5 w-3.5 text-violet-500" />
              SVG 矢量图（可入稿，无限缩放）
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>

        <div className="mol-sep" />

        {/* ── 右侧集群 ── */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ agentOpen: !ui.agentOpen })}
              aria-label="AI 绘图助手"
              className={cn(
                'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-all duration-150 active:scale-[0.97]',
                ui.agentOpen
                  ? 'border-primary/35 bg-primary/10 text-primary shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]'
                  : 'border-border/70 bg-card text-muted-foreground hover:border-primary/30 hover:text-primary',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', ui.agentOpen ? 'bg-primary' : 'bg-primary/50')} />
              <Bot className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">AI 助手</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>AI 绘图助手：自然语言描述需求，自动翻译成命令执行</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ paletteOpen: true })}
              aria-label="命令面板（Ctrl+K）"
              className="tool-btn shrink-0 gap-1.5 !px-2"
            >
              <CommandIcon className="h-3.5 w-3.5" />
              <span className="hidden xl:inline text-xs font-medium">命令面板</span>
              <kbd className="hidden rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground md:inline">Ctrl K</kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent>命令面板：搜索并执行命令（Ctrl+K）</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ consoleOpen: !ui.consoleOpen })}
              aria-label="PyMOL 风格命令行"
              className={cn('tool-btn shrink-0 gap-1.5 !px-2', ui.consoleOpen && 'bg-accent !text-foreground')}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span className="hidden xl:inline text-xs font-medium">命令行</span>
              <kbd className="hidden rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground xl:inline">`</kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent>PyMOL 风格命令行</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              suppressHydrationWarning
              aria-label="切换深浅主题"
              className="tool-btn shrink-0"
            >
              <Sun className="h-4 w-4 hidden dark:block" />
              <Moon className="h-4 w-4 dark:hidden" />
            </button>
          </TooltipTrigger>
          <TooltipContent>切换主题</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ helpOpen: true })}
              aria-label="帮助与快捷键"
              className="tool-btn shrink-0"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>帮助与快捷键</TooltipContent>
        </Tooltip>

        <a
          href="https://github.com/Jing0715-fer/MolVision"
          target="_blank"
          rel="noreferrer"
          className="tool-btn hidden shrink-0 sm:flex"
          title="GitHub 仓库"
          aria-label="GitHub 仓库（新窗口打开）"
        >
          <Github className="h-4 w-4" />
        </a>
      </header>

      {/* 新建会话确认（有结构时二次确认，防误触） */}
      <AlertDialog open={confirmNewSession} onOpenChange={setConfirmNewSession}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {structures.length > 0 ? `新建会话并关闭 ${structures.length} 个结构？` : '新建会话？'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  将清空全部结构、表示法、选择、测量、标签、命名选择、视角书签、movie 时间轴与电子密度图；本地自动存档同步清除。
                </p>
                {recording && (
                  <p className="mt-1.5 font-medium text-amber-600 dark:text-amber-400">
                    正在录制动画——新建前会自动保存已录制片段（WebM 自动下载）。
                  </p>
                )}
                <p className="mt-1.5 text-muted-foreground">
                  此操作不可撤销。如需保留当前场景，可先「保存会话文件」导出 .molvision 留档。
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmNewSession(false); doNewSession() }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              新建会话
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}
