'use client'

// 左侧面板：图标栏 + 分页面板（结构/表示/颜色/选择/测量/分析/场景/信息）
import { useState } from 'react'
import {
  Boxes, Info, Palette, Ruler, Settings2, Shapes, Target, ChevronLeft, FlaskConical,
} from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { cn } from '@/lib/utils'
import { StructuresPanel } from './panels/StructuresPanel'
import { RepsPanel } from './panels/RepsPanel'
import { ColorsPanel } from './panels/ColorsPanel'
import { SelectionPanel } from './panels/SelectionPanel'
import { MeasurePanel } from './panels/MeasurePanel'
import { AnalysisPanel } from './panels/AnalysisPanel'
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
  { key: 'scene', label: '场景', icon: Settings2 },
  { key: 'info', label: '信息', icon: Info },
] as const

export function LeftPanel() {
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)
  const [mobileOpen, setMobileOpen] = useState(false)

  const content = (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <span className="text-xs font-semibold tracking-wide text-foreground/90">
          {PANELS.find(p => p.key === ui.panel)?.label}
        </span>
        <button
          onClick={() => setUi({ panelOpen: false })}
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
                    'flex h-9 w-9 items-center justify-center rounded-lg transition',
                    ui.panel === p.key && ui.panelOpen
                      ? 'bg-primary/15 text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <p.icon className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">{p.label}</TooltipContent>
            </Tooltip>
          ))}
        </nav>
        {/* 面板内容 */}
        {ui.panelOpen && (
          <div className="w-[292px] shrink-0 border-r border-border/70 bg-background/80 backdrop-blur-sm">
            {content}
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
