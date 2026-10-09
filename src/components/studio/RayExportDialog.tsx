'use client'

// Ray 渲染设置对话框（r101-a）：engine.rayRender 早已支持 width / supersample / transparent
// 三参数，但 UI 从不传（Toolbar 旧版恒 rayRender({}) 空参）——本对话框把「视口 2× 自适应 +
// 1.5× 超采样 + 不透明背景」的隐含默认升为可见可调参数面；选项持久化 localStorage（mv-ray-opts）。
// 开始渲染回调 Toolbar.rayCapture（空场景守卫在彼处出 toast 引导加载结构）；命令行等价：
// ray [宽px] [超采样] [transparent]（commands.ts r101-a 同步扩展，向后兼容）。
import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { useI18n, type DualText } from '@/i18n'

/** 选项持久化键（与 MapLegend 位置键 / LeftPanel 宽度键同族：读写均 try/catch 静默兜底） */
const OPTS_KEY = 'mv-ray-opts'

/** Ray 导出参数面选项（width=null 即自适应：视口宽 × 2，引擎侧推导高度） */
export interface RayExportOpts {
  /** 目标宽度 px；null = 自适应（视口宽 × 2） */
  width: number | null
  /** 抗锯齿超采样倍率（1 / 1.5 / 2；内部高分辨率渲染后高质量降采样） */
  supersample: number
  /** 透明背景（出版合成用；软阴影仍作用于分子自身） */
  transparent: boolean
}

/** 与引擎/命令行缺省一致：视口 2× + 1.5× 超采样 + 不透明（Toolbar 快捷「Ray 级渲染」项沿用） */
export const DEFAULT_RAY_OPTS: RayExportOpts = { width: null, supersample: 1.5, transparent: false }

const WIDTH_CHOICES: { v: number | null; label: DualText }[] = [
  { v: null, label: { zh: '自适应（视口 2×）', en: 'Auto (2×)' } },
  { v: 1280, label: { zh: '1280', en: '1280' } },
  { v: 1920, label: { zh: '1920', en: '1920' } },
  { v: 2560, label: { zh: '2560', en: '2560' } },
  { v: 3840, label: { zh: '3840（4K）', en: '3840 (4K)' } },
]

const SS_CHOICES: { v: number; label: DualText }[] = [
  { v: 1, label: { zh: '1×（快）', en: '1× (fast)' } },
  { v: 1.5, label: { zh: '1.5×（默认）', en: '1.5× (default)' } },
  { v: 2, label: { zh: '2×（最精细）', en: '2× (finest)' } },
]

const widthKey = (v: number | null) => (v === null ? 'auto' : String(v))

/** 手工改档/旧档值吸附到最近可选项（防 ToggleGroup 无选中态的中间值悬挂——MapLegend clamp 同哲学） */
function snapWidth(v: number): number | null {
  let best: number | null = null
  let bestD = Infinity
  for (const c of WIDTH_CHOICES) {
    if (c.v === null) continue
    const d = Math.abs(c.v - v)
    if (d < bestD) { bestD = d; best = c.v }
  }
  return best
}

function snapSupersample(v: number): number {
  let best = SS_CHOICES[0].v
  let bestD = Infinity
  for (const c of SS_CHOICES) {
    const d = Math.abs(c.v - v)
    if (d < bestD) { bestD = d; best = c.v }
  }
  return best
}

/** localStorage 读取：字段逐一校验 + 越界/异型回落默认（隐私模式 JSON 不可用等静默兜底） */
function loadOpts(): RayExportOpts {
  try {
    const raw = localStorage.getItem(OPTS_KEY)
    if (!raw) return DEFAULT_RAY_OPTS
    const p = JSON.parse(raw) as Partial<RayExportOpts>
    const w = p.width
    return {
      width: w === null ? null : typeof w === 'number' && w >= 320 && w <= 4096 ? snapWidth(w) : null,
      supersample: typeof p.supersample === 'number' && p.supersample >= 1 && p.supersample <= 2 ? snapSupersample(p.supersample) : 1.5,
      transparent: typeof p.transparent === 'boolean' ? p.transparent : false,
    }
  } catch {
    return DEFAULT_RAY_OPTS
  }
}

/** 表单体挂 DialogContent 内：Radix 关闭即卸载 → useState 惰性读 localStorage 只在客户端真正打开时执行 */
function RayExportForm({ onOpenChange, onRender }: {
  onOpenChange: (v: boolean) => void
  onRender: (opts: RayExportOpts) => void
}) {
  const { t } = useI18n()
  const [opts, setOpts] = useState<RayExportOpts>(() => loadOpts())

  // 每次变更即持久化（存储失败静默——本会话内选项仍生效）
  useEffect(() => {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(opts)) } catch { /* 隐私模式等忽略 */ }
  }, [opts])

  return (
    <>
      <DialogHeader className="gap-1.5 border-b border-border px-4 pb-2.5 pt-3.5">
        <DialogTitle className="flex items-center gap-2 text-sm">
          <Sparkles className="h-4 w-4 text-amber-500" aria-hidden />
          {t({ zh: 'Ray 渲染设置', en: 'Ray render settings' })}
          <span className="mol-micro ml-auto mr-9 text-muted-foreground">RAY</span>
        </DialogTitle>
        <DialogDescription className="text-xs">
          {t({ zh: '软阴影静帧导出参数：宽度 / 抗锯齿超采样 / 透明背景；选项自动记忆。', en: 'Soft-shadow still-render parameters: width / supersampling AA / transparency; choices are remembered.' })}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 px-4 py-4 text-xs">
        {/* 宽度：自适应（视口 2×）/ 定值四档 */}
        <section className="space-y-1.5">
          <div className="mol-micro text-muted-foreground">{t({ zh: '目标宽度', en: 'Target width' })}</div>
          <ToggleGroup
            type="single"
            variant="outline"
            value={widthKey(opts.width)}
            onValueChange={v => { if (v) setOpts(o => ({ ...o, width: v === 'auto' ? null : parseInt(v, 10) })) }}
            aria-label={t({ zh: '目标宽度', en: 'Target width' })}
            className="flex w-full flex-wrap"
          >
            {WIDTH_CHOICES.map(w => (
              <ToggleGroupItem key={widthKey(w.v)} value={widthKey(w.v)} className="text-xs">
                {t(w.label)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {t({ zh: '自适应 = 视口宽 × 2；高度按视口纵横比自动推导。', en: 'Auto = viewport width × 2; the height follows the viewport aspect ratio.' })}
          </p>
        </section>

        {/* 抗锯齿超采样：1× / 1.5× / 2× */}
        <section className="space-y-1.5">
          <div className="mol-micro text-muted-foreground">{t({ zh: '抗锯齿超采样', en: 'Supersampling AA' })}</div>
          <ToggleGroup
            type="single"
            variant="outline"
            value={String(opts.supersample)}
            onValueChange={v => { if (v) setOpts(o => ({ ...o, supersample: parseFloat(v) })) }}
            aria-label={t({ zh: '抗锯齿超采样倍率', en: 'Supersampling factor' })}
            className="flex w-full"
          >
            {SS_CHOICES.map(s => (
              <ToggleGroupItem key={s.v} value={String(s.v)} className="text-xs">{t(s.label)}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {t({ zh: '内部以该倍率超采样渲染后高质量降采样——全场景抗锯齿；倍率越高越精细也越慢。', en: 'Renders internally at this factor, then downsamples with high quality — full-scene antialiasing; higher is finer but slower.' })}
          </p>
        </section>

        {/* 透明背景 */}
        <section className="flex items-start gap-2.5">
          <Switch
            aria-label={t({ zh: '透明背景', en: 'Transparent background' })}
            checked={opts.transparent}
            onCheckedChange={v => setOpts(o => ({ ...o, transparent: v }))}
            className="mt-0.5"
          />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">{t({ zh: '透明背景', en: 'Transparent background' })}</div>
            <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
              {t({ zh: '出版合成用（PNG alpha 通道）；软阴影仍作用于分子自身。', en: 'For publication compositing (PNG alpha); soft shadows still apply to the molecule itself.' })}
            </p>
          </div>
        </section>

        {/* 目标分辨率预估（不读视口：自适应给语义描述，定值给宽度语义——高度随纵横比） */}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          <Sparkles className="mt-px h-3 w-3 shrink-0 text-amber-500" aria-hidden />
          <span>
            {opts.width === null
              ? t({ zh: '目标：按视口自适应（视口宽 × 2，上限 4096），高度随纵横比', en: 'Target: viewport-adaptive (viewport width × 2, capped at 4096); height follows the aspect' })
              : t({ zh: `目标：${opts.width} px 宽（高度随视口纵横比）`, en: `Target: ${opts.width} px wide (height follows the viewport aspect)` })}
            {` · ${t({ zh: `内部 ${opts.supersample}× 超采样`, en: `internal ${opts.supersample}× supersample` })}`}
            {opts.transparent ? ` · ${t({ zh: '透明背景', en: 'transparent background' })}` : ''}
            {` · ${t({ zh: '超采样画布受 GPU maxTextureSize 护栏自动收缩（防 context lost）', en: 'supersampled canvas auto-clamped by the GPU maxTextureSize guard (prevents context loss)' })}`}
          </span>
        </div>
      </div>

      <DialogFooter className="flex-row items-center gap-3 border-t border-border px-4 py-2.5">
        <span className="hidden text-[10px] text-muted-foreground/70 sm:inline">
          {t({ zh: '命令行等价：', en: 'CLI: ' })}
          <code className="rounded bg-muted px-1 font-mono">ray 1920 2 transparent</code>
        </span>
        <Button
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => { onOpenChange(false); onRender(opts) }}
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          {t({ zh: '开始 Ray 渲染', en: 'Start Ray render' })}
        </Button>
      </DialogFooter>
    </>
  )
}

export function RayExportDialog({ open, onOpenChange, onRender }: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onRender: (opts: RayExportOpts) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mol-elevate-lg gap-0 p-0 sm:max-w-md">
        <RayExportForm onOpenChange={onOpenChange} onRender={onRender} />
      </DialogContent>
    </Dialog>
  )
}
