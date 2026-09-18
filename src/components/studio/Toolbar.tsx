'use client'

// 顶部工具栏
import { useRef, useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  Atom, Camera, ChevronDown, Crosshair, FolderOpen, FlaskConical, Github, HelpCircle, Video, CircleStop, Film,
  Home, Loader2, MousePointer2, RotateCw, Ruler, Sparkles, Sun, Moon, Terminal, Triangle, Rotate3d, Compass, Glasses, GraduationCap,
  FileDown, FilePlus2, FileUp, Save, HardDriveDownload,
} from 'lucide-react'
import { engineRef, PRESETS, useMolStore } from '@/lib/molecular/store'
import { EXAMPLE_STRUCTURES, fetchPdbId } from '@/lib/molecular/loader'
import { exportSessionFile, importSessionFile, newSession, sessionInfo } from '@/lib/molecular/session'
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
import { Separator } from '@/components/ui/separator'
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

  // 会话菜单：文件导入 + 新建确认
  const sessionFileRef = useRef<HTMLInputElement>(null)
  const [sessionImporting, setSessionImporting] = useState(false)
  const [confirmNewSession, setConfirmNewSession] = useState(false)

  const onImportSession = async (file: File) => {
    setSessionImporting(true)
    try {
      const n = await importSessionFile(file)
      if (n > 0) toast.success('会话已导入', { description: `${n} 个结构 · 表示法与相机视角已还原（来自 ${file.name}）` })
      else toast.error('会话文件中没有可恢复的结构', { description: file.name })
    } catch (e) {
      toast.error('导入会话失败', { description: e instanceof Error ? e.message : String(e) })
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

  // Ray 级静帧：先提示再渲染（同步阻塞数秒，让 toast 先上屏）
  const rayCapture = () => {
    const eng = engineRef.current
    if (!eng) return
    if (!eng.hasStructures) {
      toast.error('场景为空——先加载结构再渲染')
      return
    }
    toast.info('Ray 渲染中…', { description: 'PCF 软阴影 + 1.5× 超采样，大场景可能需要数秒' })
    setTimeout(() => {
      try {
        const r = eng.rayRender({})
        if (!r.url) throw new Error('empty')
        const a = document.createElement('a')
        a.href = r.url
        a.download = `${structures[0]?.name ?? 'molvision'}-ray-${r.w}x${r.h}.png`
        a.click()
        toast.success('Ray 渲染已导出', { description: `${r.w}×${r.h} px · 软阴影 + 超采样 · ${r.ms.toFixed(0)} ms` })
      } catch {
        toast.error('Ray 渲染失败（试试更小尺寸或命令行 ray <宽>）')
      }
    }, 80)
  }

  return (
    <TooltipProvider delayDuration={300}>
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border/70 bg-card/60 px-2 backdrop-blur-sm sm:px-3">
        {/* Logo（固定左端） */}
        <div className="mr-1 flex shrink-0 items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 shadow-sm shadow-emerald-500/25">
            <Atom className="h-4.5 w-4.5 text-white" strokeWidth={1.8} />
          </div>
          <div className="hidden leading-tight md:block">
            <div className="text-sm font-bold tracking-tight">MolVision</div>
            <div className="text-[9px] text-muted-foreground">3D 分子可视化工作台</div>
          </div>
        </div>

        <Separator orientation="vertical" className="mx-1 !h-6 shrink-0" />

        {/* 中间工具区：窄屏可横向滑动（隐藏滚动条），宽屏自然展开 */}
        <div className="mol-toolbar-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">

        {/* 加载 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ loadOpen: true })}
              className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow-sm transition hover:opacity-90 sm:px-3"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">加载结构</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>PDB 编号 / 本地文件 / .molvision 会话</TooltipContent>
        </Tooltip>

        {/* 会话 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 text-xs font-medium transition hover:bg-accent">
              <Save className="h-3.5 w-3.5 text-emerald-500" />
              <span className="hidden md:inline">会话</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
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
              <FileDown className="h-3.5 w-3.5 text-emerald-500" />
              <span className="flex-1">
                <span className="block text-xs">保存会话文件…</span>
                <span className="block text-[10px] text-muted-foreground">导出 .molvision，可跨设备分享</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => sessionFileRef.current?.click()} disabled={sessionImporting} className="gap-2">
              {sessionImporting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                : <FileUp className="h-3.5 w-3.5 text-violet-500" />}
              <span className="flex-1">
                <span className="block text-xs">打开会话文件…</span>
                <span className="block text-[10px] text-muted-foreground">恢复 .molvision（替换当前场景）</span>
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
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) void onImportSession(f)
            e.target.value = ''
          }}
        />

        {/* 示例 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 text-xs font-medium transition hover:bg-accent">
              <FlaskConical className="h-3.5 w-3.5 text-emerald-500" />
              <span className="hidden lg:inline">示例</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
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

        {/* 引导演示 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 text-xs font-medium transition hover:bg-accent">
              <GraduationCap className="h-3.5 w-3.5 text-violet-500" />
              <span className="hidden lg:inline">演示</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
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
                <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{t.steps.length} 步 · ≈{t.minutes} 分</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* 预设 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              disabled={!activeId}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background/60 px-2.5 text-xs font-medium transition hover:bg-accent disabled:opacity-40"
            >
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              <span className="hidden lg:inline">风格预设</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuLabel className="text-xs">一键切换展示风格</DropdownMenuLabel>
            {Object.entries(PRESETS).map(([key, p], i) => (
              <DropdownMenuItem key={key} onClick={() => applyPreset(key)} className="gap-2 text-xs">
                <span className="w-4 text-center text-[10px] text-muted-foreground">{i + 1}</span>
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="mx-1 !h-6" />

        {/* 测量模式 */}
        <div className="flex h-8 items-center rounded-md border border-border/70 bg-background/60 p-0.5">
          {MEASURE_MODES.map(m => (
            <Tooltip key={m.mode}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setMeasureMode(m.mode); if (m.mode !== 'off') toast.info(`${m.hint}`) }}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded transition',
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

        {/* 视角 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => engineRef.current?.fitView()}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-accent',
                settings.spin ? 'bg-primary/15 text-emerald-500' : 'text-muted-foreground hover:text-foreground',
              )}
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
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-accent',
                settings.stereo ? 'bg-rose-500/15 text-rose-500' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Glasses className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>红蓝立体（stereo）</TooltipContent>
        </Tooltip>

        {/* 录制动画（WebM） */}
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
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-accent',
                recording ? 'bg-red-500/15 text-red-500' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {recording ? <CircleStop className="h-4 w-4" /> : <Video className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{recording ? '停止录制（点击 REC 徽章下载）' : '录制动画为 WebM 视频'}</TooltipContent>
        </Tooltip>

        {/* movie：时间轴编排与关键帧巡航 */}
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
                'flex h-8 w-8 items-center justify-center rounded-md transition hover:bg-accent',
                moviePlaying ? 'bg-teal-500/15 text-teal-500' : timelineOpen ? 'bg-teal-500/10 text-teal-600 dark:text-teal-400' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Film className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{moviePlaying ? '停止 movie 序列播放' : 'movie 时间轴：关键帧编排与巡航播放（拖拽排序、逐段时长）'}</TooltipContent>
        </Tooltip>

        {/* 截图 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground">
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
            <DropdownMenuItem onClick={rayCapture} className="gap-1.5 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              Ray 级渲染（软阴影 + 超采样）
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        </div>

        {/* 右侧工具（固定右端） */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ consoleOpen: !ui.consoleOpen })}
              className={cn(
                'flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition hover:bg-accent',
                ui.consoleOpen ? 'bg-primary/15 text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
              )}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">命令行</span>
              <kbd className="hidden rounded border border-border bg-muted px-1 font-mono text-[9px] xl:inline">`</kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent>PyMOL 风格命令行</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              suppressHydrationWarning
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
          className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground sm:flex"
          title="GitHub 仓库"
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
