'use client'

// 密度图 σ 控制图例（视口左下角，颜色标尺上方）：把等值面级别调节从左侧面板提到视口内
// —— 差图正/负峰双滑块（绿/红）+ isomesh/isosurface 模式切换 + 可见性开关
// （对标 PyMOL isolevel 滚动条工作流：视线不离结构即可调级）
// 顶部把手可拖拽移位（脱离左下停靠位后 ColorLegend 自动补位）；双击把手归位；位置持久化。
import { Box, Grid3x3, Layers, Eye, EyeOff, GripHorizontal } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
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

/** 拖离停靠位后的自由位置持久化键（视口坐标） */
const POS_KEY = 'molvision-maplegend-pos'

interface FreePos { x: number; y: number }

function loadPos(): FreePos | null {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<FreePos>
    return typeof p?.x === 'number' && typeof p?.y === 'number' ? { x: p.x, y: p.y } : null
  } catch {
    return null
  }
}

function savePos(p: FreePos | null) {
  try {
    if (p) localStorage.setItem(POS_KEY, JSON.stringify(p))
    else localStorage.removeItem(POS_KEY)
  } catch { /* 隐私模式等存储失败忽略 */ }
}

export function MapLegend() {
  const info = useMapStore(s => s.info)
  // 控制台打开时隐藏（底部命令行覆盖层遮挡图例区）
  const consoleOpen = useMolStore(s => s.ui.consoleOpen)
  const pos = useIsoThrottle('iso')
  const neg = useIsoThrottle('isoNeg')

  // ---------- 拖拽移位（fixed 定位脱离左下图例列；null = 停靠模式） ----------
  const cardRef = useRef<HTMLDivElement | null>(null)
  // 惰性恢复上次拖放位置：SSR 时 info 必为 null（组件渲染 null），无 hydration 冲突
  const [free, setFree] = useState<FreePos | null>(() => loadPos())
  const drag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  const clampToViewport = useCallback((x: number, y: number, w: number, h: number): FreePos => ({
    x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)),
    y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8)),
  }), [])
  // 最新自由位置镜像（极快拖放时 React 未必及 flush，pointerup 闭包可能过期）；
  // useRef 初值仅在首挂载求值 → 与 useState 惰性恢复值天然同步，此后由事件处理器维护
  const freeRef = useRef<FreePos | null>(free)

  const onHandlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    drag.current = { startX: e.clientX, startY: e.clientY, baseX: rect.left, baseY: rect.top }
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 合成/无效 pointerId 时降级为窗口级拖拽 */ }
  }
  const onHandlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const card = cardRef.current
    if (!d || !card) return
    const rect = card.getBoundingClientRect()
    const p = clampToViewport(d.baseX + e.clientX - d.startX, d.baseY + e.clientY - d.startY, rect.width, rect.height)
    freeRef.current = p
    setFree(p)
  }
  const onHandlePointerUp = () => {
    if (!drag.current) return
    drag.current = null
    savePos(freeRef.current)
  }
  const onHandleDoubleClick = () => {
    drag.current = null
    freeRef.current = null
    setFree(null)
    savePos(null)
  }

  if (!info || consoleOpen) return null

  const posVal = pos.drag ?? info.iso
  const negVal = neg.drag ?? info.isoNeg

  return (
    <div
      ref={cardRef}
      style={free ? { position: 'fixed', left: free.x, top: free.y, zIndex: 40 } : undefined}
      className={cn(
        'pointer-events-auto w-52 select-none rounded-lg border border-border bg-card p-2 mol-elevate transition-opacity',
        !info.visible && 'opacity-60',
      )}
      aria-label="密度图 σ 控制"
    >
      {/* 拖拽把手：按住拖动移位 · 双击归位 */}
      <div
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onDoubleClick={onHandleDoubleClick}
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖动移动密度图控制卡（双击归位）"
        title="按住拖动移位 · 双击归位"
        className={cn(
          '-mx-2 -mt-2 mb-1 flex h-4 cursor-grab touch-none items-center justify-center rounded-t-lg text-muted-foreground/50 transition-colors hover:bg-accent/60 hover:text-muted-foreground active:cursor-grabbing',
          free && 'text-primary/60',
        )}
      >
        <GripHorizontal className="h-3 w-4" aria-hidden />
      </div>

      {/* 标题行：等值面颜色点 + 名称 + 类型徽章 + 可见性开关 */}
      <div className="mb-1.5 flex items-center gap-1.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full border border-black/20"
          style={{ background: info.color }}
          title={info.difference
            ? `正峰色（模型缺失信号，+σ 滑块绿）· 负峰为 ${info.negColor}（模型多余信号，−σ 滑块红）`
            : `等值面颜色 ${info.color}`}
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
