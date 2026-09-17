'use client'

// 密度图 σ 控制图例（视口左下角，颜色标尺上方）：把等值面级别调节从左侧面板提到视口内
// —— 差图正/负峰双滑块（绿/红）+ isomesh/isosurface 模式切换 + 可见性开关
// （对标 PyMOL isolevel 滚动条工作流：视线不离结构即可调级）
import { Box, Grid3x3, Layers, Eye, EyeOff } from 'lucide-react'
import { useMapStore } from '@/lib/molecular/map-store'
import { setMapLook } from '@/lib/molecular/map-load'
import { useMolStore } from '@/lib/molecular/store'
import { useIsoThrottle } from './panels/MapsPanel'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'

const MODES: { key: 'mesh' | 'surface' | 'both'; label: string; icon: typeof Grid3x3 }[] = [
  { key: 'mesh', label: '网格', icon: Grid3x3 },
  { key: 'surface', label: '面', icon: Box },
  { key: 'both', label: '叠加', icon: Layers },
]

export function MapLegend() {
  const info = useMapStore(s => s.info)
  // 控制台打开时隐藏（底部命令行覆盖层遮挡图例区）
  const consoleOpen = useMolStore(s => s.ui.consoleOpen)
  const pos = useIsoThrottle('iso')
  const neg = useIsoThrottle('isoNeg')

  if (!info || consoleOpen) return null

  const posVal = pos.drag ?? info.iso
  const negVal = neg.drag ?? info.isoNeg

  return (
    <div
      className={cn(
        'pointer-events-auto w-52 select-none rounded-lg border border-border/60 bg-card/90 p-2 shadow-lg backdrop-blur-sm transition-opacity',
        !info.visible && 'opacity-60',
      )}
      aria-label="密度图 σ 控制"
    >
      {/* 标题行：等值面颜色点 + 名称 + 类型徽章 + 可见性开关 */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full border border-black/20"
          style={{ background: info.color }}
          aria-hidden
        />
        <span
          className="min-w-0 flex-1 truncate text-[10px] font-semibold tracking-wide text-foreground/80"
          title={info.name}
        >
          {info.name}
        </span>
        <span className="shrink-0 rounded bg-muted/80 px-1 font-mono text-[9px] leading-4 text-muted-foreground">
          {info.source === 'sf' ? (info.difference ? 'Fo−Fc' : '2Fo−Fc') : '文件'}
        </span>
        <button
          onClick={() => setMapLook({ visible: !info.visible })}
          aria-label={info.visible ? '隐藏密度图（map hide）' : '显示密度图（map show）'}
          title={info.visible ? '隐藏等值面（map hide）' : '显示等值面（map show）'}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          {info.visible
            ? <Eye className="h-3 w-3" />
            : <EyeOff className="h-3 w-3" />}
        </button>
      </div>

      {/* σ 级别：差图正/负峰独立双滑块；常规图单滑块 */}
      <div className={cn('space-y-1.5', !info.visible && 'pointer-events-none opacity-70')}>
        <div className="flex items-center gap-1.5">
          <span className="w-6 shrink-0 text-[9px] font-semibold text-muted-foreground">
            {info.difference ? '+σ' : 'σ'}
          </span>
          <Slider
            value={[posVal]}
            min={info.difference ? 1 : 0.5}
            max={8}
            step={0.05}
            onValueChange={v => pos.onDrag(v[0])}
            className={cn(
              'flex-1',
              info.difference && '[&_[data-slot=slider-range]]:bg-emerald-500 [&_[data-slot=slider-thumb]]:border-emerald-500',
            )}
            aria-label={info.difference ? '正峰 σ 级别（模型缺失信号）' : '等值面 σ 级别'}
          />
          <span
            className={cn(
              'w-11 shrink-0 text-right font-mono text-[9px] font-semibold tabular-nums',
              info.difference ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
            )}
          >
            {info.difference ? '+' : ''}
            {posVal.toFixed(2)}
          </span>
        </div>
        {info.difference && (
          <div className="flex items-center gap-1.5">
            <span className="w-6 shrink-0 text-[9px] font-semibold text-muted-foreground">−σ</span>
            <Slider
              value={[negVal]}
              min={1}
              max={8}
              step={0.05}
              onValueChange={v => neg.onDrag(v[0])}
              className="flex-1 [&_[data-slot=slider-range]]:bg-rose-500 [&_[data-slot=slider-thumb]]:border-rose-500"
              aria-label="负峰 σ 级别（模型多余信号）"
            />
            <span className="w-11 shrink-0 text-right font-mono text-[9px] font-semibold tabular-nums text-rose-600 dark:text-rose-400">
              −{negVal.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* 模式切换 + 三角形计数 */}
      <div className="mt-1.5 flex items-center gap-1">
        {MODES.map(m => (
          <button
            key={m.key}
            onClick={() => setMapLook({ mode: m.key })}
            aria-pressed={info.mode === m.key}
            className={cn(
              'flex h-6 items-center gap-1 rounded-md border px-1.5 text-[9px] font-medium transition',
              info.mode === m.key
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-border/50 text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            <m.icon className="h-2.5 w-2.5" />
            {m.label}
          </button>
        ))}
        <span
          className="ml-auto shrink-0 font-mono text-[9px] tabular-nums text-muted-foreground/80"
          title={`等值面三角形${info.truncated ? '（已截断）' : ''}`}
        >
          {info.triangles.toLocaleString()}△{info.truncated ? '+' : ''}
        </span>
      </div>
    </div>
  )
}
