'use client'

// 场景面板：背景/雾/FOV/正交/旋转/裁剪/画质/显示过滤/会话管理
import { useRef, useState } from 'react'
import { CloudFog, Box, Aperture, Layers, Gauge, EyeOff, Droplets, Zap, Download, Upload, FileJson, Waves, SunMedium, Sun, Sparkle, Gem, Glasses, Axis3d, Activity, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { useMolStore } from '@/lib/molecular/store'
import { NAMED_COLORS } from '@/lib/molecular/colors'
import { exportSessionFile, importSessionFile } from '@/lib/molecular/session'
import { SectionTitle, PanelHint } from '../LeftPanel'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const BG_PRESETS = ['#101215', '#000000', '#ffffff', '#f5f2ea', '#1a2b32', '#2d2d3f', '#0e1f18']

export function ScenePanel() {
  const settings = useMolStore(s => s.settings)
  const updateSettings = useMolStore(s => s.updateSettings)
  const structures = useMolStore(s => s.structures)
  const fileRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const onImport = async (file: File) => {
    setImporting(true)
    try {
      const n = await importSessionFile(file)
      if (n > 0) {
        toast.success(`会话已导入`, { description: `${n} 个结构 · 表示法与相机视角已还原` })
      } else {
        toast.error('会话文件中没有可恢复的结构')
      }
    } catch (e) {
      toast.error('导入失败', { description: e instanceof Error ? e.message : String(e) })
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="pb-4">
      <SectionTitle>背景</SectionTitle>
      <div className="flex flex-wrap items-center gap-1.5 px-3">
        {BG_PRESETS.map(bg => (
          <button
            key={bg}
            onClick={() => updateSettings({ background: bg })}
            className={cn(
              'h-7 w-7 rounded-md border-2 shadow-inner transition',
              settings.background === bg ? 'border-primary scale-110' : 'border-border hover:border-muted-foreground/50',
            )}
            style={{ background: bg }}
            title={bg}
          />
        ))}
        <input
          type="color"
          value={settings.background}
          onChange={e => updateSettings({ background: e.target.value })}
          className="h-7 w-9 cursor-pointer rounded-md border border-border/60 bg-background/60 p-0.5"
          title="自定义背景色"
        />
      </div>

      <SectionTitle>景深与透视</SectionTitle>
      <div className="space-y-3 px-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CloudFog className="h-3.5 w-3.5" /> 景深雾化（depth cue）
          </span>
          <Switch checked={settings.fog} onCheckedChange={v => updateSettings({ fog: v })} />
        </div>
        {settings.fog && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>雾强度</span><span className="font-mono">{Math.round(settings.fogStrength * 100)}%</span>
            </div>
            <Slider
              value={[settings.fogStrength]} min={0.05} max={1} step={0.05}
              onValueChange={v => updateSettings({ fogStrength: v[0] })}
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Box className="h-3.5 w-3.5" /> 正交投影
          </span>
          <Switch checked={settings.ortho} onCheckedChange={v => updateSettings({ ortho: v })} />
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><Aperture className="h-3 w-3" /> 视场角</span>
            <span className="font-mono">{settings.fov}°</span>
          </div>
          <Slider
            value={[settings.fov]} min={10} max={90} step={1}
            onValueChange={v => updateSettings({ fov: v[0] })}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Axis3d className="h-3.5 w-3.5 text-teal-500" /> 坐标轴指示器
          </span>
          <Switch checked={settings.showAxes} onCheckedChange={v => updateSettings({ showAxes: v })} />
        </div>
        {settings.showAxes && (
          <p className="text-[10px] leading-relaxed text-muted-foreground/70">
            视口右上角显示朝向罗盘（X 红 / Y 绿 / Z 蓝）；点击轴端可平滑对齐视角，暗点为负方向。命令行等价：axes on / axes off。
          </p>
        )}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Activity className="h-3.5 w-3.5 text-emerald-500" /> 性能指示器 (FPS)
          </span>
          <Switch checked={settings.showFps} onCheckedChange={v => updateSettings({ showFps: v })} />
        </div>
        {settings.showFps && (
          <p className="text-[10px] leading-relaxed text-muted-foreground/70">
            状态栏实时显示帧率 / 绘制调用 / 三角形数（500ms 刷新，≥55 绿 · ≥30 琥珀 · &lt;30 红）。多结构大场景排查卡顿用。命令行等价：fps on / fps off。
          </p>
        )}
      </div>

      <SectionTitle>交互与动画</SectionTitle>
      <div className="space-y-3 px-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" /> 自动旋转 (S)
          </span>
          <Switch checked={settings.spin} onCheckedChange={v => updateSettings({ spin: v, ...(v ? { rock: false } : {}) })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Waves className="h-3.5 w-3.5 text-violet-400" /> 相机摇摆 (R)
          </span>
          <Switch checked={settings.rock} onCheckedChange={v => updateSettings({ rock: v, ...(v ? { spin: false } : {}) })} />
        </div>
        {(settings.spin || settings.rock) && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>速度</span><span className="font-mono">{settings.spinSpeed.toFixed(1)}</span>
            </div>
            <Slider
              value={[settings.spinSpeed]} min={0.5} max={12} step={0.5}
              onValueChange={v => updateSettings({ spinSpeed: v[0] })}
            />
          </div>
        )}
        {settings.rock && (
          <p className="text-[10px] leading-relaxed text-muted-foreground/70">
            摇摆模式：相机绕目标 ±26° 往复摆动，适合观察凹槽与结合口袋的深度。拖动视角后以新视角为基准。
          </p>
        )}
      </div>

      <SectionTitle>灯光与渲染</SectionTitle>
      <div className="space-y-3 px-3">
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><Sun className="h-3 w-3" /> 环境光</span>
            <span className="font-mono">{settings.lightAmbient.toFixed(2)}</span>
          </div>
          <Slider
            value={[settings.lightAmbient]} min={0} max={2} step={0.05}
            onValueChange={v => updateSettings({ lightAmbient: v[0] })}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><SunMedium className="h-3 w-3" /> 主光</span>
            <span className="font-mono">{settings.lightKey.toFixed(2)}</span>
          </div>
          <Slider
            value={[settings.lightKey]} min={0} max={3} step={0.05}
            onValueChange={v => updateSettings({ lightKey: v[0] })}
          />
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1"><Sparkle className="h-3 w-3" /> 补光</span>
            <span className="font-mono">{settings.lightFill.toFixed(2)}</span>
          </div>
          <Slider
            value={[settings.lightFill]} min={0} max={2} step={0.05}
            onValueChange={v => updateSettings({ lightFill: v[0] })}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gem className="h-3.5 w-3.5" /> 高光（镜面反射）
          </span>
          <Switch checked={settings.specular} onCheckedChange={v => updateSettings({ specular: v })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Glasses className="h-3.5 w-3.5 text-rose-500" /> 红蓝立体（3D 眼镜）
          </span>
          <Switch checked={settings.stereo} onCheckedChange={v => updateSettings({ stereo: v })} />
        </div>
        {settings.stereo && (
          <p className="text-[10px] leading-relaxed text-muted-foreground/70">
            佩戴红（左眼）蓝（右眼）立体眼镜观看；立体模式下 GTAO 遮蔽暂停以保证双目渲染性能。
          </p>
        )}
        <p className="text-[10px] leading-relaxed text-muted-foreground/70">
          关闭高光可得到哑光/论文图风格；命令行等价：set ambient 0.5 / set specular off / stereo on。
        </p>
      </div>

      <SectionTitle>切层（slab 裁剪）</SectionTitle>
      <div className="space-y-3 px-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Layers className="h-3.5 w-3.5" /> 启用切层
          </span>
          <Switch checked={settings.slab} onCheckedChange={v => updateSettings({ slab: v })} />
        </div>
        {settings.slab && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>厚度</span><span className="font-mono">{settings.slabThickness.toFixed(0)} Å</span>
            </div>
            <Slider
              value={[settings.slabThickness]} min={2} max={80} step={1}
              onValueChange={v => updateSettings({ slabThickness: v[0] })}
            />
            <p className="mt-1 text-[10px] text-muted-foreground/70">沿视线方向仅显示厚度内的分子区域。</p>
          </div>
        )}
      </div>

      <SectionTitle>显示过滤</SectionTitle>
      <div className="space-y-3 px-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <EyeOff className="h-3.5 w-3.5" /> 隐藏氢原子 (H)
          </span>
          <Switch checked={settings.hideHydrogens} onCheckedChange={v => updateSettings({ hideHydrogens: v })} />
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Droplets className="h-3.5 w-3.5" /> 隐藏水分子
          </span>
          <Switch checked={settings.hideWater} onCheckedChange={v => updateSettings({ hideWater: v })} />
        </div>
      </div>

      <SectionTitle>氢键网络</SectionTitle>
      <div className="space-y-3 px-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-teal-400" /> 显示氢键 (B)
          </span>
          <Switch checked={settings.showHBonds} onCheckedChange={v => updateSettings({ showHBonds: v })} />
        </div>
        {settings.showHBonds && (
          <>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>重原子距离上限</span>
                <span className="font-mono">{settings.hbondMaxDist.toFixed(1)} Å</span>
              </div>
              <Slider
                value={[settings.hbondMaxDist]} min={2.5} max={5} step={0.1}
                onValueChange={v => updateSettings({ hbondMaxDist: v[0] })}
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">包含水介氢键</span>
              <Switch checked={settings.hbondIncludeWater} onCheckedChange={v => updateSettings({ hbondIncludeWater: v })} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">仅显示与选择相关的</span>
              <Switch checked={settings.hbondSelOnly} onCheckedChange={v => updateSettings({ hbondSelOnly: v })} />
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground/70">
              判据：有氢结构用 D-H…A 几何（H…A ≤ 2.5Å 且角度 ≥ 120°），无氢结构用 D…A ≤ 距离上限。虚线 + 端点标记为青色（浅色背景自动加深）。大结构（≥ 2000 原子）自动在后台线程计算，不卡交互。
            </p>
          </>
        )}
      </div>

      <SectionTitle>环境光遮蔽</SectionTitle>
      <div className="space-y-3 px-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <SunMedium className="h-3.5 w-3.5 text-amber-500" /> GTAO 遮蔽（AO）
          </span>
          <Switch checked={settings.ssao} onCheckedChange={v => updateSettings({ ssao: v })} />
        </div>
        {settings.ssao && (
          <>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>遮蔽强度</span>
                <span className="font-mono">{settings.ssaoIntensity.toFixed(1)}×</span>
              </div>
              <Slider
                value={[settings.ssaoIntensity]} min={0.2} max={2} step={0.1}
                onValueChange={v => updateSettings({ ssaoIntensity: v[0] })}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>采样半径</span>
                <span className="font-mono">{settings.ssaoRadius.toFixed(1)} Å</span>
              </div>
              <Slider
                value={[settings.ssaoRadius]} min={1} max={8} step={0.5}
                onValueChange={v => updateSettings({ ssaoRadius: v[0] })}
              />
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground/70">
              环境光遮蔽加深缝隙与口袋的阴影（GTAO 算法），大幅增强立体感与深度感知。建议蛋白质用 2–4 Å 半径，大复合物可增大。
            </p>
          </>
        )}
      </div>

      <SectionTitle>轮廓线（描边）</SectionTitle>
      <div className="space-y-3 px-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <PenLine className="h-3.5 w-3.5 text-fuchsia-500" /> 出版级轮廓线
          </span>
          <Switch checked={settings.outline} onCheckedChange={v => updateSettings({ outline: v })} />
        </div>
        {settings.outline && (
          <>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>线条强度</span>
                <span className="font-mono">{settings.outlineStrength.toFixed(1)}×</span>
              </div>
              <Slider
                value={[settings.outlineStrength]} min={0.2} max={3} step={0.1}
                onValueChange={v => updateSettings({ outlineStrength: v[0] })}
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>线条粗细</span>
                <span className="font-mono">{settings.outlineThickness.toFixed(1)} px</span>
              </div>
              <Slider
                value={[settings.outlineThickness]} min={1} max={4} step={0.5}
                onValueChange={v => updateSettings({ outlineThickness: v[0] })}
              />
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground/70">
              Sobel 深度+亮度双信号检测边缘，剪影与层叠结构描出细线（线色随背景亮度自适应）。ray 静帧渲染同样生效；开启后每帧多一次全屏后处理，交互卡顿时可关闭。命令行等价：outline on 2 2.5。
            </p>
          </>
        )}
      </div>

      <SectionTitle>渲染画质</SectionTitle>
      <div className="px-3">
        <Select value={settings.quality} onValueChange={v => updateSettings({ quality: v as 'low' | 'medium' | 'high' })}>
          <SelectTrigger className="h-8 border-border/60 bg-background/60 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="high" className="text-xs">高（2× 像素密度）</SelectItem>
            <SelectItem value="medium" className="text-xs">中（1.5×）</SelectItem>
            <SelectItem value="low" className="text-xs">低（大结构流畅）</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <SectionTitle>会话</SectionTitle>
      <div className="space-y-2 px-3">
        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => {
              const ok = exportSessionFile()
              if (!ok) toast.error('无可导出的会话（先加载结构）')
              else toast.success('会话已导出为 .molvision 文件', { description: '含结构源文本 · 表示法 · 设置 · 相机视角' })
            }}
            disabled={!structures.length}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/60 text-[11px] font-medium transition',
              structures.length ? 'hover:border-primary/40 hover:bg-primary/5' : 'cursor-not-allowed opacity-40',
            )}
          >
            <Download className="h-3.5 w-3.5 text-emerald-500" /> 导出会话
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/60 bg-background/60 text-[11px] font-medium transition',
              !importing && 'hover:border-primary/40 hover:bg-primary/5',
            )}
          >
            {importing
              ? <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              : <Upload className="h-3.5 w-3.5 text-violet-500" />}
            {importing ? '导入中…' : '导入会话'}
          </button>
        </div>
        <p className="flex items-start gap-1 text-[10px] leading-relaxed text-muted-foreground/70">
          <FileJson className="mt-0.5 h-3 w-3 shrink-0" />
          .molvision 文件包含完整结构源文本与全部视图状态，可跨设备分享（导入将替换当前场景）。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".molvision,.json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0]
            if (f) void onImport(f)
            e.target.value = ''
          }}
        />
      </div>

      <PanelHint>
        常用色名：{Object.keys(NAMED_COLORS).slice(0, 10).join('、')}… 命令行 <code className="text-[10px]">bg black</code> 可快速切换。
      </PanelHint>
    </div>
  )
}
