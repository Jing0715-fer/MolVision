'use client'

// 密度图面板：电子密度 2Fo−Fc 合成（结构因子→FFT）+ CCP4/MRC 文件 + isomesh/isosurface 控制
import { useRef, useState } from 'react'
import { Box, Grid3x3, Layers, Loader2, Trash2, Upload, Zap, Eye, EyeOff } from 'lucide-react'
import { useMapStore } from '@/lib/molecular/map-store'
import { fetchAndComputeMap, removeMap, setMapLook, loadMapBuffer } from '@/lib/molecular/map-load'
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

export function MapsPanel() {
  const info = useMapStore(s => s.info)
  const computing = useMapStore(s => s.computing)
  const computeMsg = useMapStore(s => s.computeMsg)
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const [idInput, setIdInput] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const activeEntry = structures.find(x => x.id === activeId)
  const activePdbId = activeEntry?.meta.pdbId
  const activeHasCrystal = activeId ? !!dataRegistry.get(activeId)?.crystal : false

  const doFetch = (id: string) => {
    const target = (id || activePdbId || '').trim()
    if (!target) return
    void fetchAndComputeMap(target)
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
        <div className="flex gap-1.5">
          <input
            value={idInput}
            onChange={e => setIdInput(e.target.value.toUpperCase())}
            onKeyDown={e => { if (e.key === 'Enter') doFetch(idInput) }}
            placeholder="PDB 编号（如 3EKJ）"
            className="h-8 flex-1 rounded-md border border-border/70 bg-background/60 px-2 font-mono text-xs uppercase tracking-wider outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
            aria-label="PDB 编号"
          />
          <button
            onClick={() => doFetch(idInput)}
            disabled={computing || (!idInput && !activePdbId)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-40"
          >
            {computing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">合成</span>
          </button>
        </div>
        {activePdbId && !idInput && (
          <button
            onClick={() => doFetch(activePdbId)}
            disabled={computing}
            className="w-full rounded-md border border-dashed border-border/80 bg-muted/40 px-2 py-1.5 text-left text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground disabled:opacity-50"
          >
            用当前结构 <span className="font-mono font-semibold text-foreground">{activePdbId}</span> 的结构因子合成 2Fo−Fc 图
          </button>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full rounded-md border border-border/70 bg-background/60 px-2 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
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
          <div className="flex items-center gap-2 rounded-md border border-sky-200 bg-sky-50/70 px-2.5 py-2 text-[11px] text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            <span className="truncate">{computeMsg || '计算中…'}</span>
          </div>
        )}
        {!info && !computing && (
          <PanelHint>
            从 RCSB 沉积的结构因子（SF mmCIF）实时计算 2Fo−Fc 电子密度：原子模型提供相位，观测振幅提供强度，
            3D FFT 合成后以等值面/网格叠加在结构上（对标 PyMOL isomesh / ChimeraX volume）。
            需要结构有沉积结构因子（老条目如 1CRN 无 SF；3EKJ / 1AKI / 5NIT 等均可）。
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
            {/* 信息卡 */}
            <div className="grid grid-cols-2 gap-1 rounded-md border border-border/60 bg-muted/30 p-2 text-[10px] leading-relaxed">
              <div className="text-muted-foreground">来源</div>
              <div className="text-right font-medium">{info.source === 'sf' ? '结构因子 2Fo−Fc' : 'CCP4 文件'}</div>
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

            {/* σ 级别 */}
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">等值面级别（σ）</span>
                <span className="font-mono font-semibold text-sky-600 dark:text-sky-400">{info.iso.toFixed(2)} σ</span>
              </div>
              <Slider
                value={[info.iso]}
                min={0.3} max={5} step={0.05}
                onValueChange={v => setMapLook({ iso: v[0] })}
              />
              <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/70">
                <span>1σ 噪声级</span><span>1.5–2σ 骨架</span><span>3σ+ 强峰</span>
              </div>
            </div>

            {/* 显示模式 */}
            <div className="flex h-8 items-center rounded-md border border-border/70 bg-background/60 p-0.5">
              {MODES.map(m => (
                <button
                  key={m.key}
                  onClick={() => setMapLook({ mode: m.key })}
                  className={cn(
                    'flex h-7 flex-1 items-center justify-center gap-1 rounded text-xs transition',
                    info.mode === m.key
                      ? 'bg-primary text-primary-foreground shadow-sm'
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
                className="h-7 w-10 cursor-pointer rounded-md border border-border/60 bg-background/60 p-0.5"
                title="密度图颜色"
                aria-label="密度图颜色"
              />
              <div className="flex-1">
                <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>不透明度</span><span className="font-mono">{Math.round(info.opacity * 100)}%</span>
                </div>
                <Slider
                  value={[info.opacity]}
                  min={0.05} max={1} step={0.05}
                  onValueChange={v => setMapLook({ opacity: v[0] })}
                />
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border/60 px-2.5 py-2">
              <span className="text-xs text-muted-foreground">可见（map show / hide）</span>
              <Switch checked={info.visible} onCheckedChange={v => setMapLook({ visible: v })} />
            </div>
          </div>
          <PanelHint>
            等值面为绝对级别 mean + σ·rms；建议把表示法切到球棍（预设 2）并降低 σ 到 1.0–1.5 检查局部拟合。
            裁剪（slab）同样作用于密度图。{activeHasCrystal ? '' : '当前结构无 CRYST1 晶胞记录。'}
          </PanelHint>
        </>
      )}
    </div>
  )
}
