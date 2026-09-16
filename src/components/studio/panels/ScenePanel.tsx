'use client'

// 场景面板：背景/雾/FOV/正交/旋转/裁剪/画质/显示过滤
import { CloudFog, Box, Aperture, Layers, Gauge, EyeOff, Droplets } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { NAMED_COLORS } from '@/lib/molecular/colors'
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
      </div>

      <SectionTitle>交互与动画</SectionTitle>
      <div className="space-y-3 px-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Gauge className="h-3.5 w-3.5" /> 自动旋转
          </span>
          <Switch checked={settings.spin} onCheckedChange={v => updateSettings({ spin: v })} />
        </div>
        {settings.spin && (
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

      <PanelHint>
        常用色名：{Object.keys(NAMED_COLORS).slice(0, 10).join('、')}… 命令行 <code className="text-[10px]">bg black</code> 可快速切换。
      </PanelHint>
    </div>
  )
}
