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
import { useI18n, tt, type DualText } from '@/i18n'
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

const MEASURE_MODES: { mode: MeasureMode; label: DualText; icon: typeof Ruler; hint: DualText }[] = [
  { mode: 'off', label: { zh: '选择', en: 'Select' }, icon: MousePointer2, hint: { zh: '选择模式（点击选择残基）', en: 'Select mode (click to pick residues)' } },
  { mode: 'distance', label: { zh: '距离', en: 'Distance' }, icon: Ruler, hint: { zh: '测距：点击 2 个原子', en: 'Distance: click 2 atoms' } },
  { mode: 'angle', label: { zh: '角度', en: 'Angle' }, icon: Triangle, hint: { zh: '角度：点击 3 个原子', en: 'Angle: click 3 atoms' } },
  { mode: 'dihedral', label: { zh: '二面角', en: 'Dihedral' }, icon: Rotate3d, hint: { zh: '二面角：点击 4 个原子', en: 'Dihedral: click 4 atoms' } },
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
  icon: typeof Save; label: DualText; show?: 'md' | 'lg'; disabled?: boolean; hint: DualText
}) {
  const { t } = useI18n()
  return (
    <DropdownMenuTrigger asChild>
      <button
        disabled={disabled}
        aria-label={t(hint)}
        className={cn(
          'flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
          show === 'lg' ? 'hidden lg:flex' : 'hidden md:flex',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        <span>{t(label)}</span>
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
  const { t } = useI18n()
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
        if (n > 0) toast.success(tt({ zh: '会话已合并到当前场景', en: 'Session merged into current scene' }), { description: tt({ zh: `新增 ${n} 个结构 · 名称冲突自动编号 · 书签重名跳过（来自 ${file.name}）`, en: `${n} structures added · name collisions auto-numbered · duplicate bookmarks skipped (from ${file.name})` }) })
        else toast.error(tt({ zh: '会话文件中没有可恢复的结构', en: 'No recoverable structures in the session file' }), { description: file.name })
      } else {
        const n = await importSessionFile(file)
        if (n > 0) toast.success(tt({ zh: '会话已导入', en: 'Session imported' }), { description: tt({ zh: `${n} 个结构 · 表示法与相机视角已还原（来自 ${file.name}）`, en: `${n} structures · representations and camera views restored (from ${file.name})` }) })
        else toast.error(tt({ zh: '会话文件中没有可恢复的结构', en: 'No recoverable structures in the session file' }), { description: file.name })
      }
    } catch (e) {
      toast.error(tt(mode === 'merge' ? { zh: '合并会话失败', en: 'Failed to merge session' } : { zh: '导入会话失败', en: 'Failed to import session' }), { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setSessionImporting(false)
    }
  }

  const doNewSession = () => {
    const closed = newSession()
    toast.success(tt(closed > 0 ? { zh: `已新建会话（关闭 ${closed} 个结构）`, en: `New session started (${closed} structures closed)` } : { zh: '已新建会话', en: 'New session started' }), {
      description: tt({ zh: '结构 / 书签 / 时间轴 / 密度图已清空 · 可随时「保存会话文件」留档分享', en: 'Structures / bookmarks / timeline / maps cleared · use "Save session file…" anytime to archive and share' }),
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
      a.download = `${name}${scale > 1 ? `@${scale}x` : ''}${transparent ? tt({ zh: '-透明', en: '-transparent' }) : ''}.png`
      a.click()
      toast.success(tt({ zh: `截图已导出${scale > 1 ? `（${scale}× 分辨率）` : ''}`, en: `Screenshot exported${scale > 1 ? ` (${scale}× resolution)` : ''}` }))
    } catch {
      toast.error(tt({ zh: '截图失败', en: 'Screenshot failed' }))
    }
  }

  // Ray 级静帧：先提示再渲染（内部高分辨率渲染+降采样可能阻塞数秒，让 toast 先上屏）
  const rayCapture = () => {
    const eng = engineRef.current
    if (!eng) return
    if (!eng.hasStructures) {
      toast.error(tt({ zh: '场景为空——先加载结构再渲染', en: 'Scene is empty — load a structure before rendering' }))
      return
    }
    toast.info(tt({ zh: 'Ray 渲染中…', en: 'Ray rendering…' }), { description: tt({ zh: 'PCF 软阴影 + 1.5× 真超采样抗锯齿，大场景可能需要数秒', en: 'PCF soft shadows + 1.5× true supersampling AA; large scenes may take a few seconds' }) })
    setTimeout(() => {
      void (async () => {
        try {
          const r = await eng.rayRender({})
          if (!r.url) throw new Error('empty')
          const a = document.createElement('a')
          a.href = r.url
          a.download = `${structures[0]?.name ?? 'molvision'}-ray-${r.w}x${r.h}.png`
          a.click()
          toast.success(tt({ zh: 'Ray 渲染已导出', en: 'Ray render exported' }), { description: tt({ zh: `${r.w}×${r.h} px · 软阴影 + 真超采样抗锯齿 · ${r.ms.toFixed(0)} ms`, en: `${r.w}×${r.h} px · soft shadows + supersampling AA · ${r.ms.toFixed(0)} ms` }) })
        } catch {
          toast.error(tt({ zh: 'Ray 渲染失败（试试更小尺寸或命令行 ray <宽>）', en: 'Ray render failed (try a smaller size or ray <width> on the command line)' }))
        }
      })()
    }, 80)
  }

  // SVG 矢量导出：CPU 投影（无限缩放不失真，可入稿 Illustrator/Inkscape）
  const svgCapture = () => {
    const r = buildSvgExport({})
    if (!r.ok || !r.svg) {
      toast.error(tt({ zh: 'SVG 导出失败', en: 'SVG export failed' }), { description: r.error })
      return
    }
    downloadSvg(r.svg, structures[0]?.name ?? 'molvision')
    toast.success(tt({ zh: `矢量图已导出（${r.width}×${r.height}）`, en: `Vector image exported (${r.width}×${r.height})` }), {
      description: tt({ zh: `${r.items.toLocaleString()} 个原语 · ${r.ms.toFixed(0)} ms · 无限缩放不失真${r.skippedSurfaces.length ? ` · 跳过 ${r.skippedSurfaces.length} 个表面表示` : ''}`, en: `${r.items.toLocaleString()} primitives · ${r.ms.toFixed(0)} ms · lossless at any zoom${r.skippedSurfaces.length ? ` · ${r.skippedSurfaces.length} surface representation${r.skippedSurfaces.length > 1 ? 's' : ''} skipped` : ''}` }),
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
              <span className="hidden sm:inline">{t({ zh: '加载结构', en: 'Load structure' })}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: 'PDB 编号 / 本地文件 / .molvision 会话', en: 'PDB ID / local file / .molvision session' })}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropTrigger icon={Save} label={{ zh: '会话', en: 'Session' }} show="md" hint={{ zh: '会话文件与场景管理', en: 'Session file & scene management' }} />
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-xs">{t({ zh: '会话文件（.molvision）与场景管理', en: 'Session files (.molvision) & scene management' })}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                const ok = exportSessionFile()
                if (!ok) toast.error(tt({ zh: '无可导出的会话（先加载结构）', en: 'Nothing to export (load a structure first)' }))
                else toast.success(tt({ zh: '会话已导出为 .molvision 文件', en: 'Session exported as a .molvision file' }), { description: tt({ zh: '含结构源文本 · 表示法 · 设置 · 相机视角 · 书签', en: 'Structure sources · representations · settings · camera views · bookmarks' }) })
              }}
              disabled={!structures.length}
              className="gap-2"
            >
              <FileDown className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="flex-1">
                <span className="block text-xs">{t({ zh: '保存会话文件…', en: 'Save session file…' })}</span>
                <span className="block text-[10px] text-muted-foreground">{t({ zh: '导出 .molvision，可跨设备分享', en: 'Export .molvision, share across devices' })}</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { sessionImportMode.current = 'replace'; sessionFileRef.current?.click() }} disabled={sessionImporting} className="gap-2">
              {sessionImporting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
                : <FileUp className="h-3.5 w-3.5 text-violet-500" />}
              <span className="flex-1">
                <span className="block text-xs">{t({ zh: '打开会话文件…', en: 'Open session file…' })}</span>
                <span className="block text-[10px] text-muted-foreground">{t({ zh: '恢复 .molvision（替换当前场景）', en: 'Restore .molvision (replaces the current scene)' })}</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => { sessionImportMode.current = 'merge'; sessionFileRef.current?.click() }}
              disabled={sessionImporting}
              className="gap-2"
            >
              <GitMerge className="h-3.5 w-3.5 text-sky-500" />
              <span className="flex-1">
                <span className="block text-xs">{t({ zh: '合并会话文件…', en: 'Merge session file…' })}</span>
                <span className="block text-[10px] text-muted-foreground">{t({ zh: '叠加 .molvision 到当前场景（不清空）', en: 'Overlay .molvision onto the current scene (nothing is cleared)' })}</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={e => { e.preventDefault(); setConfirmNewSession(true) }}
              className="gap-2"
            >
              <FilePlus2 className="h-3.5 w-3.5 text-rose-500" />
              <span className="flex-1">
                <span className="block text-xs">{t({ zh: '新建会话', en: 'New session' })}</span>
                <span className="block text-[10px] text-muted-foreground">{t({ zh: '清空全部结构与视图状态，从头开始', en: 'Clear all structures and view state, start fresh' })}</span>
              </span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="flex items-start gap-1.5 px-2 py-1">
              <HardDriveDownload className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {t({ zh: '本地自动存档：', en: 'Local autosave: ' })}{t(sessionInfo())}{t({ zh: '。可拖拽 .molvision 文件到视口直接导入。', en: '. Drag a .molvision file onto the viewport to import it.' })}
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
          <DropTrigger icon={FlaskConical} label={{ zh: '示例', en: 'Examples' }} show="lg" hint={{ zh: '从 RCSB 一键加载示例结构', en: 'One-click example structures from RCSB' }} />
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="text-xs">{t({ zh: '从 RCSB 一键加载', en: 'One-click load from RCSB' })}</DropdownMenuLabel>
            {EXAMPLE_STRUCTURES.map(ex => (
              <DropdownMenuItem key={ex.id} onClick={() => void fetchPdbId(ex.id)} className="gap-2">
                <span className="w-11 shrink-0 rounded bg-muted px-1 py-0.5 text-center font-mono text-[10px] font-semibold">{ex.id}</span>
                <span className="flex-1">
                  <span className="block text-xs font-medium">{t(ex.title)}</span>
                  <span className="block text-[10px] text-muted-foreground">{t(ex.desc)}</span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="mol-sep" />

        {/* ── 风格组 ── */}
        <DropdownMenu>
          <DropTrigger icon={Sparkles} label={{ zh: '风格预设', en: 'Style presets' }} show="lg" disabled={!activeId} hint={{ zh: '一键切换展示风格与场景组合', en: 'One-click style & scene combos' }} />
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel className="mol-micro">{t({ zh: '场景组合 · 一键工作流', en: 'Scene combos · one-click workflows' })}</DropdownMenuLabel>
            {Object.values(SCENE_PRESETS).map(sp => {
              const Icon = SCENE_ICON[sp.icon] ?? Sparkles
              return (
                <DropdownMenuItem
                  key={sp.key}
                  onClick={() => {
                    const r = applyScenePreset(sp.key, runCommand)
                    if (r.ok) toast.success(tt({ zh: `已应用场景：${tt(r.applied)}`, en: `Scene applied: ${tt(r.applied)}` }), sp.after ? { description: tt(sp.after) } : undefined)
                    else toast.error(tt(r.error ?? { zh: '场景应用失败', en: 'Failed to apply scene' }))
                  }}
                  className="scene-item gap-2.5"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="flex-1">
                    <span className="block text-xs font-medium">{t(sp.label)}</span>
                    <span className="block text-[10px] leading-snug text-muted-foreground">{t(sp.desc)}</span>
                  </span>
                  <kbd className="shrink-0 rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground">{sp.commands.length} cmd</kbd>
                </DropdownMenuItem>
              )
            })}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="mol-micro">{t({ zh: '表示法 · 单项切换', en: 'Representations · individual toggles' })}</DropdownMenuLabel>
            {Object.entries(PRESETS).map(([key, p], i) => (
              <DropdownMenuItem key={key} onClick={() => applyPreset(key)} className="gap-2 text-xs">
                <span className="w-4 text-center font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                {t(p.label)}
              </DropdownMenuItem>
            ))}
            <p className="px-2 pb-1.5 pt-1 text-[9px] leading-relaxed text-muted-foreground/70">
              {t({ zh: '命令行同样可用：', en: 'Also available on the command line: ' })}<code className="rounded bg-muted px-1 font-mono">preset publication</code> · <code className="rounded bg-muted px-1 font-mono">scene pocket</code>
            </p>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropTrigger icon={GraduationCap} label={{ zh: '演示', en: 'Tours' }} show="lg" hint={{ zh: '引导式演示场景', en: 'Guided tour scenes' }} />
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="text-xs">{t({ zh: '引导式演示场景（逐步自动操作）', en: 'Guided tours (step-by-step automation)' })}</DropdownMenuLabel>
            {TOURS.map(tour => (
              <DropdownMenuItem
                key={tour.id}
                onClick={() => {
                  const cur = useTourStore.getState()
                  if (cur.tour?.id === tour.id && cur.stepIdx > 0) {
                    // 同一场景重新开始
                    void cur.start(tour.id)
                  } else {
                    void useTourStore.getState().start(tour.id)
                  }
                }}
                className="gap-2.5"
              >
                <TourDot accent={tour.accent} />
                <span className="flex-1">
                  <span className="block text-xs font-medium">{t(tour.title)}</span>
                  <span className="block text-[10px] text-muted-foreground">{t(tour.tagline)}</span>
                </span>
                <span className="shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground">{t({ zh: `${tour.steps.length} 步 · ≈${tour.minutes} 分`, en: `${tour.steps.length} steps · ≈${tour.minutes} min` })}</span>
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
              aria-label={t({ zh: '适配视图', en: 'Fit view' })}
              className="tool-btn shrink-0"
            >
              <Crosshair className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: '适配视图 (F)', en: 'Fit view (F)' })}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => engineRef.current?.resetView()}
              aria-label={t({ zh: '复位视角', en: 'Reset view' })}
              className="tool-btn shrink-0"
            >
              <Home className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: '复位视角', en: 'Reset view' })}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => updateSettings({ spin: !settings.spin })}
              aria-label={t({ zh: '自动旋转', en: 'Auto-rotate' })}
              className={cn('tool-btn shrink-0', settings.spin && 'bg-accent !text-foreground')}
            >
              <RotateCw className={cn('h-4 w-4', settings.spin && 'animate-[spin_3s_linear_infinite]')} />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: '自动旋转 (S)', en: 'Auto-rotate (S)' })}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => engineRef.current?.orient()}
              aria-label={t({ zh: '主轴对齐视角', en: 'Principal-axes view' })}
              className="tool-btn shrink-0"
            >
              <Compass className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: '主轴对齐视角 (PyMOL orient)', en: 'Principal-axes view (PyMOL orient)' })}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => updateSettings({ stereo: !settings.stereo })}
              aria-label={t({ zh: '红蓝立体视图', en: 'Red/blue stereo view' })}
              className={cn('tool-btn shrink-0', settings.stereo && 'bg-rose-500/15 !text-rose-500')}
            >
              <Glasses className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: '红蓝立体（stereo）', en: 'Red/blue stereo (stereo)' })}</TooltipContent>
        </Tooltip>

        <div className="mol-sep" />

        {/* ── 测量组：分段控件（仪器范式） ── */}
        <div className="flex h-7 shrink-0 items-center gap-[2px] rounded-lg border border-border bg-card p-[2px]">
          {MEASURE_MODES.map(m => (
            <Tooltip key={m.mode}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { setMeasureMode(m.mode); if (m.mode !== 'off') toast.info(tt(m.hint)) }}
                  aria-label={t(m.hint)}
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
              <TooltipContent>{t(m.hint)}</TooltipContent>
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
                  toast.success(tt({ zh: '开始录制动画', en: 'Recording started' }), {
                    description: tt({ zh: '可同时播放 ensemble / rock / spin —— 点击左上角 REC 徽章停止并下载 WebM', en: 'Play ensemble / rock / spin while recording — click the REC badge (top-left) to stop and download the WebM' }),
                  })
                } else {
                  toast.error(tt({ zh: '当前浏览器不支持画布录制（MediaRecorder）', en: 'Canvas recording is not supported by this browser (MediaRecorder)' }))
                }
              }}
              className={cn('tool-btn shrink-0', recording && 'bg-red-500/15 !text-red-500')}
              aria-label={recording ? t({ zh: '录制中（REC 徽章停止）', en: 'Recording (stop via the REC badge)' }) : t({ zh: '录制动画为 WebM 视频', en: 'Record animation as WebM video' })}
            >
              {recording ? <CircleStop className="h-4 w-4" /> : <Video className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent>{recording ? t({ zh: '停止录制（点击 REC 徽章下载）', en: 'Stop recording (click the REC badge to download)' }) : t({ zh: '录制动画为 WebM 视频', en: 'Record animation as WebM video' })}</TooltipContent>
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
                  if (n >= 2) toast.info(tt({ zh: '已从视角书签同步时间轴', en: 'Timeline synced from view bookmarks' }), { description: tt({ zh: `${n} 个关键帧——可拖拽排序、逐段调时长，然后点播放`, en: `${n} keyframes — drag to reorder, tune per-segment durations, then press play` }) })
                  else toast.info(tt({ zh: 'movie 时间轴已打开', en: 'movie timeline opened' }), { description: tt({ zh: '先保存 ≥2 个视角书签（V 键或 view save），再「同步书签」', en: 'Save ≥2 view bookmarks first (V key or view save), then "Sync bookmarks"' }) })
                }
              }}
              className={cn(
                'tool-btn shrink-0',
                moviePlaying ? 'bg-teal-500/15 !text-teal-500' : timelineOpen && 'bg-teal-500/10 !text-teal-600 dark:!text-teal-400',
              )}
              aria-label={moviePlaying ? t({ zh: '停止 movie 序列播放', en: 'Stop movie playback' }) : t({ zh: 'movie 时间轴编排与巡航播放', en: 'movie timeline sequencing & playback' })}
            >
              <Film className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{moviePlaying ? t({ zh: '停止 movie 序列播放', en: 'Stop movie playback' }) : t({ zh: 'movie 时间轴：关键帧编排与巡航播放（拖拽排序、逐段时长）', en: 'movie timeline: keyframe sequencing & playback (drag to reorder, per-segment duration)' })}</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={t({ zh: '导出图像（PNG / Ray / SVG）', en: 'Export image (PNG / Ray / SVG)' })}
              className="tool-btn shrink-0"
            >
              <Camera className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">{t({ zh: '导出图像', en: 'Export image' })}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => capture(1, false)} className="text-xs">{t({ zh: '标准分辨率 PNG', en: 'Standard-resolution PNG' })}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => capture(2, false)} className="text-xs">{t({ zh: '2× 高清 PNG', en: '2× high-res PNG' })}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => capture(4, false)} className="text-xs">{t({ zh: '4× 超高清 PNG', en: '4× ultra-res PNG' })}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => capture(2, true)} className="text-xs">{t({ zh: '2× 透明背景 PNG', en: '2× transparent-background PNG' })}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => rayCapture()} className="gap-1.5 text-xs">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              {t({ zh: 'Ray 级渲染（软阴影 + 超采样）', en: 'Ray-quality render (soft shadows + supersampling)' })}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => svgCapture()} className="gap-1.5 text-xs">
              <PenLine className="h-3.5 w-3.5 text-violet-500" />
              {t({ zh: 'SVG 矢量图（可入稿，无限缩放）', en: 'SVG vector graphics (print-ready, infinitely scalable)' })}
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
              aria-label={t({ zh: 'AI 绘图助手', en: 'AI drawing assistant' })}
              className={cn(
                'flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-all duration-150 active:scale-[0.97]',
                ui.agentOpen
                  ? 'border-primary/35 bg-primary/10 text-primary shadow-[inset_0_1px_0_rgb(255_255_255/0.08)]'
                  : 'border-border/70 bg-card text-muted-foreground hover:border-primary/30 hover:text-primary',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', ui.agentOpen ? 'bg-primary' : 'bg-primary/50')} />
              <Bot className="h-3.5 w-3.5" />
              <span className="hidden xl:inline">{t({ zh: 'AI 助手', en: 'AI assistant' })}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: 'AI 绘图助手：自然语言描述需求，自动翻译成命令执行', en: 'AI assistant: describe what you need in natural language and it is translated into commands automatically' })}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ paletteOpen: true })}
              aria-label={t({ zh: '命令面板（Ctrl+K）', en: 'Command palette (Ctrl+K)' })}
              className="tool-btn shrink-0 gap-1.5 !px-2"
            >
              <CommandIcon className="h-3.5 w-3.5" />
              <span className="hidden xl:inline text-xs font-medium">{t({ zh: '命令面板', en: 'Command palette' })}</span>
              <kbd className="hidden rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground md:inline">Ctrl K</kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: '命令面板：搜索并执行命令（Ctrl+K）', en: 'Command palette: search and run commands (Ctrl+K)' })}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ consoleOpen: !ui.consoleOpen })}
              aria-label={t({ zh: 'PyMOL 风格命令行', en: 'PyMOL-style command line' })}
              className={cn('tool-btn shrink-0 gap-1.5 !px-2', ui.consoleOpen && 'bg-accent !text-foreground')}
            >
              <Terminal className="h-3.5 w-3.5" />
              <span className="hidden xl:inline text-xs font-medium">{t({ zh: '命令行', en: 'Command line' })}</span>
              <kbd className="hidden rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground xl:inline">`</kbd>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: 'PyMOL 风格命令行', en: 'PyMOL-style command line' })}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              suppressHydrationWarning
              aria-label={t({ zh: '切换深浅主题', en: 'Toggle light/dark theme' })}
              className="tool-btn shrink-0"
            >
              <Sun className="h-4 w-4 hidden dark:block" />
              <Moon className="h-4 w-4 dark:hidden" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: '切换主题', en: 'Toggle theme' })}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setUi({ helpOpen: true })}
              aria-label={t({ zh: '帮助与快捷键', en: 'Help & shortcuts' })}
              className="tool-btn shrink-0"
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>{t({ zh: '帮助与快捷键', en: 'Help & shortcuts' })}</TooltipContent>
        </Tooltip>

        <a
          href="https://github.com/Jing0715-fer/MolVision"
          target="_blank"
          rel="noreferrer"
          className="tool-btn hidden shrink-0 sm:flex"
          title={t({ zh: 'GitHub 仓库', en: 'GitHub repository' })}
          aria-label={t({ zh: 'GitHub 仓库（新窗口打开）', en: 'GitHub repository (opens in a new window)' })}
        >
          <Github className="h-4 w-4" />
        </a>
      </header>

      {/* 新建会话确认（有结构时二次确认，防误触） */}
      <AlertDialog open={confirmNewSession} onOpenChange={setConfirmNewSession}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {structures.length > 0
                ? t({ zh: `新建会话并关闭 ${structures.length} 个结构？`, en: `Start a new session and close ${structures.length} structure${structures.length > 1 ? 's' : ''}?` })
                : t({ zh: '新建会话？', en: 'Start a new session?' })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  {t({ zh: '将清空全部结构、表示法、选择、测量、标签、命名选择、视角书签、movie 时间轴与电子密度图；本地自动存档同步清除。', en: 'This clears all structures, representations, selections, measurements, labels, named selections, view bookmarks, the movie timeline and electron-density maps; the local autosave is cleared as well.' })}
                </p>
                {recording && (
                  <p className="mt-1.5 font-medium text-amber-600 dark:text-amber-400">
                    {t({ zh: '正在录制动画——新建前会自动保存已录制片段（WebM 自动下载）。', en: 'A recording is in progress — the recorded clip is saved automatically (WebM auto-download) before the session is reset.' })}
                  </p>
                )}
                <p className="mt-1.5 text-muted-foreground">
                  {t({ zh: '此操作不可撤销。如需保留当前场景，可先「保存会话文件」导出 .molvision 留档。', en: 'This action cannot be undone. To keep the current scene, use "Save session file…" to export a .molvision first.' })}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t({ zh: '取消', en: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setConfirmNewSession(false); doNewSession() }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t({ zh: '新建会话', en: 'New session' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  )
}
