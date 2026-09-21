'use client'

// 密度图面板：电子密度 2Fo−Fc / Fo−Fc 差图合成（结构因子→FFT，Web Worker）+ CCP4/MRC 文件 + isomesh/isosurface 控制
// 差图正/负峰 σ 独立滑块（对标 PyMOL 双 isolevel 对象工作流）
import { useEffect, useRef, useState } from 'react'
import { Box, Grid3x3, Layers, Loader2, Trash2, Upload, Zap, Eye, EyeOff, Plus, Minus } from 'lucide-react'
import { useMapStore } from '@/lib/molecular/map-store'
import { fetchAndComputeMap, removeMap, setMapLook, loadMapBuffer } from '@/lib/molecular/map-load'
import type { MapKind } from '@/lib/molecular/sffourier'
import { useMolStore, dataRegistry } from '@/lib/molecular/store'
import { SectionTitle, PanelHint } from '../LeftPanel'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const MODES: { key: 'mesh' | 'surface' | 'both'; label: string; icon: typeof Grid3x3 }[] = [
  { key: 'mesh', label: '网格', icon: Grid3x3 },
  { key: 'surface', label: '面', icon: Box },
  { key: 'both', label: '叠加', icon: Layers },
]

const KINDS: { key: MapKind; label: string; hint: string }[] = [
  { key: '2fofc', label: '2Fo−Fc', hint: '常规电子密度（骨架走向）' },
  { key: 'fofc', label: 'Fo−Fc', hint: '差图（模型缺失/错位诊断）' },
]

/** σ 滑块节流 hook：等值面重建需重跑 marching cubes（裁剪网格 ~0.5-2s），
 *  拖动中至多每 250ms 重建一次，尾部值延时补发；drag 本地值让拇指即时跟手
 *  （setMapLook 同步更新镜像 store → 触发后立即清 drag 回落到镜像值，无需 effect 对账）
 *  —— 面板与视口图例卡（MapLegend）共用 */
export function useIsoThrottle(key: 'iso' | 'isoNeg') {
  const last = useRef(0)
  const timer = useRef<number | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const fire = (v: number) => {
    last.current = performance.now()
    setMapLook(key === 'iso' ? { iso: v } : { isoNeg: v })
    setDrag(null)
  }
  const onDrag = (v: number) => {
    setDrag(v)
    const now = performance.now()
    if (now - last.current > 250) {
      fire(v)
    } else {
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => fire(v), 250)
    }
  }
  // 卸载时清理尾部定时器
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  return { drag, onDrag }
}

export function MapsPanel() {
  const info = useMapStore(s => s.info)
  const computing = useMapStore(s => s.computing)
  const computeMsg = useMapStore(s => s.computeMsg)
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const [idInput, setIdInput] = useState('')
  const [kind, setKind] = useState<MapKind>('2fofc')
  const fileRef = useRef<HTMLInputElement>(null)
  const posIso = useIsoThrottle('iso')
  const negIso = useIsoThrottle('isoNeg')

  const activeEntry = structures.find(x => x.id === activeId)
  const activePdbId = activeEntry?.meta.pdbId
  const activeHasCrystal = activeId ? !!dataRegistry.get(activeId)?.crystal : false

  const doFetch = (id: string, k: MapKind) => {
    const target = (id || activePdbId || '').trim()
    if (!target) return
    void fetchAndComputeMap(target, k)
  }

  const onFile = (file: File) => {
    void file.arrayBuffer().then(buf => {
      loadMapBuffer(buf, file.name.replace(/\.[^.]+$/, ''))
    })
  }

  return (
    <div className="pb-4">
      <SectionTitle>电子密度图</SectionTitle>
      <div className="space-y-2.5 px-3">
        {/* 图类型选择 */}
        <div className="flex h-8 items-center rounded-md border border-border bg-background p-0.5">
          {KINDS.map(k => (
            <button
              key={k.key}
              onClick={() => {
                setKind(k.key)
                // 已有图时切换类型 → 直接用当前/输入 ID 重算
                if (idInput || activePdbId) doFetch(idInput || activePdbId || '', k.key)
              }}
              title={k.hint}
              className={cn(
                'flex h-7 flex-1 items-center justify-center gap-1 rounded font-mono text-[11px] font-semibold transition',
                kind === k.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {k.key === 'fofc' && <Plus className="h-3 w-3" />}
              {k.key === 'fofc' && <Minus className="h-3 w-3 -ml-2" />}
              <span>{k.label}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-1.5">
          <input
            value={idInput}
            onChange={e => setIdInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') doFetch(idInput, kind) }}
            placeholder="PDB 编号（如 3EKJ）"
            className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs uppercase tracking-wider outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
            aria-label="PDB 编号"
          />
          <button
            onClick={() => doFetch(idInput, kind)}
            disabled={computing || (!idInput && !activePdbId)}
            className="mol-btn-primary flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-40"
          >
            {computing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">合成</span>
          </button>
        </div>
        {activePdbId && !idInput && (
          <button
            onClick={() => doFetch(activePdbId, kind)}
            disabled={computing}
            className="w-full rounded-md border border-dashed border-border bg-muted/50 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-50"
          >
            用当前结构 <span className="font-mono font-semibold text-foreground">{activePdbId}</span> 的结构因子合成 {kind === 'fofc' ? 'Fo−Fc 差图' : '2Fo−Fc 图'}
          </button>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <Upload className="mr-1.5 inline h-3.5 w-3.5" />
          导入 CCP4 / MRC 地图文件…
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".ccp4,.map,.mrc,.dsn6,.omap"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }}
        />
        {computing && (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-600 dark:text-amber-400">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="truncate">{computeMsg || '计算中…'}</span>
          </div>
        )}
        {!info && !computing && (
          <PanelHint>
            从 RCSB 沉积的结构因子（SF mmCIF）实时计算电子密度：原子模型提供相位，观测振幅提供强度，
            3D FFT 合成后以等值面/网格叠加在结构上（对标 PyMOL isomesh / ChimeraX volume）。
            <span className="mt-1 block">2Fo−Fc 看骨架走向；<span className="font-medium text-primary">Fo−Fc 差图</span>诊断模型问题——绿峰=密度有而模型缺（该建而未建），红峰=模型有而密度无（放错位置）。计算在 Web Worker 中进行，页面不卡顿。</span>
            需要结构有沉积结构因子（3EKJ / 1AKI / 5NIT 等均可）。
          </PanelHint>
        )}
      </div>

      {info && (
        <>
          <SectionTitle right={
            <div className="flex items-center gap-1">
              <button
                onClick={() => setMapLook({ visible: !info.visible })}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
                title={info.visible ? '隐藏密度图' : '显示密度图'}
                aria-label={info.visible ? '隐藏密度图' : '显示密度图'}
              >
                {info.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => removeMap()}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
                title="移除密度图"
                aria-label="移除密度图"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          }>
            {info.name}
          </SectionTitle>
          <div className="space-y-3 px-3">
            {/* 差图图例（正负独立 σ 时显示 +x/−y） */}
            {info.difference && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[10px]">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: info.color }} />正峰 · 模型缺失</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full" style={{ background: info.negColor }} />负峰 · 模型多余</span>
                <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                  {Math.abs(info.iso - info.isoNeg) < 1e-6
                    ? `±${info.iso.toFixed(1)}σ`
                    : `+${info.iso.toFixed(1)}/−${info.isoNeg.toFixed(1)}σ`}
                </span>
              </div>
            )}

            {/* 信息卡 */}
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border bg-muted/40 p-2 text-[10px] tabular-nums leading-relaxed">
              <div className="text-muted-foreground">来源</div>
              <div className="text-right font-medium">{info.source === 'sf' ? (info.difference ? '结构因子 Fo−Fc' : '结构因子 2Fo−Fc') : 'CCP4 文件'}</div>
              <div className="text-muted-foreground">网格</div>
              <div className="text-right font-mono">{info.dims.map(d => d.toLocaleString()).join('×')}</div>
              <div className="text-muted-foreground">体素</div>
              <div className="text-right font-mono">{info.voxel.map(v => v.toFixed(2)).join('×')} Å</div>
              <div className="text-muted-foreground">三角形</div>
              <div className="text-right font-mono">{info.triangles.toLocaleString()}{info.truncated ? '+' : ''}</div>
              <div className="text-muted-foreground">rms</div>
              <div className="text-right font-mono">{info.rms.toFixed(4)}</div>
              <div className="text-muted-foreground">计算耗时</div>
              <div className="text-right font-mono">{info.ms.toFixed(0)} ms</div>
            </div>

            {/* σ 级别（差图：正/负峰独立双滑块；常规：单滑块） */}
            {info.difference ? (
              <div className="space-y-2.5">
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-2 w-2 rounded-full" style={{ background: info.color }} />
                      正峰 σ（模型缺失）
                    </span>
                    <span className="font-mono font-semibold tabular-nums" style={{ color: info.color }}>+{(posIso.drag ?? info.iso).toFixed(2)}</span>
                  </div>
                  <Slider
                    value={[posIso.drag ?? info.iso]}
                    min={1} max={8} step={0.05}
                    onValueChange={v => posIso.onDrag(v[0])}
                    aria-label="正峰 σ 级别"
                  />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className="h-2 w-2 rounded-full" style={{ background: info.negColor }} />
                      负峰 σ（模型多余）
                    </span>
                    <span className="font-mono font-semibold tabular-nums" style={{ color: info.negColor }}>−{(negIso.drag ?? info.isoNeg).toFixed(2)}</span>
                  </div>
                  <Slider
                    value={[negIso.drag ?? info.isoNeg]}
                    min={1} max={8} step={0.05}
                    onValueChange={v => negIso.onDrag(v[0])}
                    aria-label="负峰 σ 级别"
                  />
                </div>
                <div className="flex justify-between text-[9px] text-muted-foreground/70">
                  <span>±2σ 宽松</span><span>±3σ 常规</span><span>±5σ+ 强信号</span>
                </div>
                <p className="text-[9px] leading-relaxed text-muted-foreground/60">
                  拖动已节流（250ms 重建）；正负峰可分开调级（命令 <code className="rounded bg-muted px-1">map isolevel pos 3 / neg 2.5</code>）。
                </p>
              </div>
            ) : (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">等值面级别（σ）</span>
                  <span className="font-mono font-semibold tabular-nums text-foreground">{(posIso.drag ?? info.iso).toFixed(2)} σ</span>
                </div>
                <Slider
                  value={[posIso.drag ?? info.iso]}
                  min={0.3} max={5} step={0.05}
                  onValueChange={v => posIso.onDrag(v[0])}
                />
                <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/70">
                  <span>1σ 噪声级</span><span>1.5–2σ 骨架</span><span>3σ+ 强峰</span>
                </div>
                <p className="mt-0.5 text-[9px] text-muted-foreground/60">拖动已节流（250ms 重建一次等值面）</p>
              </div>
            )}

            {/* 显示模式 */}
            <div className="flex h-8 items-center rounded-md border border-border bg-background p-0.5">
              {MODES.map(m => (
                <button
                  key={m.key}
                  onClick={() => setMapLook({ mode: m.key })}
                  className={cn(
                    'flex h-7 flex-1 items-center justify-center gap-1 rounded text-xs transition',
                    info.mode === m.key
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <m.icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              ))}
            </div>

            {/* 颜色 + 不透明度 */}
            <div className="flex items-center gap-2.5">
              <input
                type="color"
                value={info.color}
                onChange={e => setMapLook({ color: e.target.value })}
                className="h-7 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-background p-0.5"
                title={info.difference ? '正峰颜色（绿）' : '密度图颜色'}
                aria-label={info.difference ? '正峰颜色' : '密度图颜色'}
              />
              {info.difference && (
                <input
                  type="color"
                  value={info.negColor}
                  onChange={e => setMapLook({ negColor: e.target.value })}
                  className="h-7 w-10 shrink-0 cursor-pointer rounded-md border border-border bg-background p-0.5"
                  title="负峰颜色（红）"
                  aria-label="负峰颜色"
                />
              )}
              <div className="flex-1">
                <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>不透明度</span><span className="font-mono tabular-nums">{Math.round(info.opacity * 100)}%</span>
                </div>
                <Slider
                  value={[info.opacity]}
                  min={0.05} max={1} step={0.05}
                  aria-label="不透明度"
                  onValueChange={v => setMapLook({ opacity: v[0] })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border px-2.5 py-2">
              <span className="text-xs text-muted-foreground">可见（map show / hide）</span>
              <Switch checked={info.visible} onCheckedChange={v => setMapLook({ visible: v })} />
            </div>
          </div>
          <PanelHint>
            {info.difference
              ? <>差图等值面为 <span className="font-medium">正/负双面</span>（绿=mean+σ·rms、红=mean−σ·rms），σ 可分别调整——晶体学惯例正 ±3σ、负峰噪声大时常调低到 2-2.5σ 增强错位信号可见性。绿峰处应补建原子、红峰处应删移模型。切换表示法到球棍（预设 2）逐残基检查拟合。
                {activeHasCrystal ? '' : '当前结构无 CRYST1 晶胞记录。'}</>
              : <>等值面为绝对级别 mean + σ·rms；建议把表示法切到球棍（预设 2）并降低 σ 到 1.0–1.5 检查局部拟合。
                裁剪（slab）同样作用于密度图。{activeHasCrystal ? '' : '当前结构无 CRYST1 晶胞记录。'}</>}
          </PanelHint>
        </>
      )}
    </div>
  )
}
