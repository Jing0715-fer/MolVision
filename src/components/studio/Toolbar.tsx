'use client'

// 顶部工具栏
import { useState } from 'react'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  Atom, Camera, ChevronDown, Crosshair, FolderOpen, FlaskConical, Github, HelpCircle, Video, CircleStop,
  Home, Loader2, MousePointer2, RotateCw, Ruler, Sparkles, Sun, Moon, Terminal, Triangle, Rotate3d, Compass, Glasses, GraduationCap,
} from 'lucide-react'
import { engineRef, PRESETS, useMolStore } from '@/lib/molecular/store'
import { EXAMPLE_STRUCTURES, fetchPdbId } from '@/lib/molecular/loader'
import { TOURS } from '@/lib/molecular/tours'
import { useTourStore } from '@/lib/molecular/tour-store'
import { useRecordStore } from '@/lib/molecular/record-store'
import type { MeasureMode } from '@/lib/molecular/types'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
        {/* Logo */}
        <div className="mr-1 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400 to-teal-600 shadow-sm shadow-emerald-500/25">
            <Atom className="h-4.5 w-4.5 text-white" strokeWidth={1.8} />
          </div>
          <div className="hidden leading-tight md:block">
            <div className="text-sm font-bold tracking-tight">MolVision</div>
            <div className="text-[9px] text-muted-foreground">3D 分子可视化工作台</div>
          </div>
        </div>

        <Separator orientation="vertical" className="mx-1 !h-6" />

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
          <TooltipContent>PDB 编号 / 本地文件</TooltipContent>
        </Tooltip>

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

        <div className="flex-1" />

        {/* 右侧工具 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ consoleOpen: !ui.consoleOpen })}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition hover:bg-accent',
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
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
    </TooltipProvider>
  )
}
