'use client'

// 左侧面板：图标栏 + 分页面板（结构/表示/颜色/选择/测量/分析/密度图/场景/信息）
// 面板宽度可拖拽调整（右缘把手，持久化 + 双击复位）
import { useRef, useState, useSyncExternalStore } from 'react'
import {
  Boxes, Info, Palette, Ruler, Settings2, Shapes, Target, ChevronLeft, FlaskConical, Grid3x3,
} from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { cn } from '@/lib/utils'
import { StructuresPanel } from './panels/StructuresPanel'
import { RepsPanel } from './panels/RepsPanel'
import { ColorsPanel } from './panels/ColorsPanel'
import { SelectionPanel } from './panels/SelectionPanel'
import { MeasurePanel } from './panels/MeasurePanel'
import { AnalysisPanel } from './panels/AnalysisPanel'
import { MapsPanel } from './panels/MapsPanel'
import { ScenePanel } from './panels/ScenePanel'
import { InfoPanel } from './panels/InfoPanel'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'

const PANELS = [
  { key: 'structures', label: '结构', icon: Boxes },
  { key: 'reps', label: '表示法', icon: Shapes },
  { key: 'colors', label: '颜色', icon: Palette },
  { key: 'selection', label: '选择', icon: Target },
  { key: 'measure', label: '测量', icon: Ruler },
  { key: 'analysis', label: '分析', icon: FlaskConical },
  { key: 'maps', label: '密度图', icon: Grid3x3 },
  { key: 'scene', label: '场景', icon: Settings2 },
  { key: 'info', label: '信息', icon: Info },
] as const

// —— 面板宽度拖拽（持久化） ——
const PANEL_W_KEY = 'molvision-panel-w'
const PANEL_W_MIN = 232
const PANEL_W_MAX = 460
const PANEL_W_DEFAULT = 292

function loadPanelWidth(): number {
  try {
    const v = parseFloat(localStorage.getItem(PANEL_W_KEY) ?? '')
    if (isNaN(v)) return PANEL_W_DEFAULT
    return Math.min(PANEL_W_MAX, Math.max(PANEL_W_MIN, v))
  } catch {
    return PANEL_W_DEFAULT
  }
}

function clampPanelWidth(w: number): number {
  return Math.min(PANEL_W_MAX, Math.max(PANEL_W_MIN, Math.round(w)))
}

/** 水合安全挂载标志（SSR/hydration 渲染用服务端快照 false，避免 localStorage 读取造成水合不一致） */
function useMounted(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )
}

export function LeftPanel() {
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)
  const [mobileOpen, setMobileOpen] = useState(false)
  // 面板宽度：拖拽中用户值优先；否则恢复持久化宽度（水合后；首帧用默认值避免 SSR 不一致）
  const mounted = useMounted()
  const [userW, setUserW] = useState<number | null>(null)
  const panelW = userW ?? (mounted ? loadPanelWidth() : PANEL_W_DEFAULT)
  const drag = useRef<{ startX: number; startW: number } | null>(null)

  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault() // 防止拖拽中选中文本
    drag.current = { startX: e.clientX, startW: panelW }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  const onHandleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const w = clampPanelWidth(drag.current.startW + (e.clientX - drag.current.startX))
    setUserW(w)
    try { localStorage.setItem(PANEL_W_KEY, String(w)) } catch { /* ignore */ }
  }
  const onHandleUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
  }
  const resetWidth = () => {
    setUserW(null)
    try { localStorage.removeItem(PANEL_W_KEY) } catch { /* ignore */ }
  }

  const content = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <span className="text-xs font-semibold tracking-wide text-foreground/90">
          {PANELS.find(p => p.key === ui.panel)?.label}
        </span>
        <button
          onClick={() => setUi({ panelOpen: false })}
          aria-label="折叠面板（点击左侧图标恢复）"
          title="折叠面板"
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mol-scroll flex-1 overflow-y-auto">
        {ui.panel === 'structures' && <StructuresPanel />}
        {ui.panel === 'reps' && <RepsPanel />}
        {ui.panel === 'colors' && <ColorsPanel />}
        {ui.panel === 'selection' && <SelectionPanel />}
        {ui.panel === 'measure' && <MeasurePanel />}
        {ui.panel === 'analysis' && <AnalysisPanel />}
        {ui.panel === 'maps' && <MapsPanel />}
        {ui.panel === 'scene' && <ScenePanel />}
        {ui.panel === 'info' && <InfoPanel />}
      </div>
    </div>
  )

  return (
    <>
      {/* 桌面端 */}
      <aside className="hidden md:flex">
        {/* 图标栏 */}
        <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/70 bg-card/40 py-2">
          {PANELS.map(p => (
            <Tooltip key={p.key}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setUi({ panel: p.key, panelOpen: ui.panel === p.key ? !ui.panelOpen : true })}
                  aria-label={p.label}
                  title={p.label}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg transition-all duration-150',
                    ui.panel === p.key && ui.panelOpen
                      ? 'bg-primary/12 text-primary shadow-[inset_0_0_0_1px_rgb(0_0_0/0.04)]'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground active:scale-95',
                  )}
                >
                  <p.icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{p.label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>
        {/* 面板内容（宽度可拖拽） */}
        {ui.panelOpen && (
          <div className="relative shrink-0 border-r border-border/70 bg-background/80 backdrop-blur-sm" style={{ width: panelW }}>
            {content}
            {/* 拖拽把手：悬停/拖拽时高亮 */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="拖拽调整面板宽度（双击复位）"
              title="拖拽调整宽度 · 双击复位"
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onDoubleClick={resetWidth}
              className={cn(
                'group absolute right-0 top-0 z-10 h-full w-1.5 cursor-col-resize select-none',
                'after:absolute after:right-0 after:top-1/2 after:h-10 after:w-[3px] after:-translate-y-1/2 after:rounded-full after:bg-transparent after:transition-colors',
                'hover:after:bg-primary/60 active:after:bg-primary',
              )}
            />
          </div>
        )}
      </aside>

      {/* 移动端抽屉 */}
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="打开控制面板"
          className="absolute left-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/90 shadow-lg backdrop-blur transition md:hidden"
        >
          <Boxes className="h-4 w-4" />
        </button>
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[300px] p-0">
          <SheetTitle className="sr-only">控制面板</SheetTitle>
          {content}
        </SheetContent>
      </Sheet>
    </>
  )
}

export function PanelHint({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">{children}</p>
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
      <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/80">{children}</h3>
      {right}
    </div>
  )
}

export { }
