'use client'

// 表示法面板：rep 列表卡片（类型/选择/配色/参数）
import { Eye, EyeOff, Plus, SlidersHorizontal, Trash2, Shapes, AlertCircle, Ribbon, Worm, CircleDot, Minus, Circle, Spline, Shell } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { COLOR_SCHEME_LABELS, type ColorScheme } from '@/lib/molecular/colors'
import { REP_LABELS, type RepConfig, type RepType } from '@/lib/molecular/types'
import { PRESET_SELECTIONS } from '@/lib/molecular/selection'
import { cn } from '@/lib/utils'
import { SectionTitle, PanelHint } from '../LeftPanel'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover'

const REP_TYPES: RepType[] = ['cartoon', 'putty', 'ballstick', 'sticks', 'spacefill', 'lines', 'surface']
const SCHEMES: ColorScheme[] = ['element', 'chain', 'spectrum', 'residue', 'ss', 'bfactor', 'uniform']

/** 表示法类型 → lucide 图标（中性色：单一强调色纪律，类型识别靠图标形状不靠彩虹色） */
const TYPE_ICON: Record<RepType, { icon: typeof Ribbon; className?: string }> = {
  cartoon: { icon: Ribbon },
  putty: { icon: Worm },
  ballstick: { icon: CircleDot },
  sticks: { icon: Minus },
  spacefill: { icon: Circle },
  lines: { icon: Spline },
  surface: { icon: Shell },
}

function TypeIcon({ type, className }: { type: RepType; className?: string }) {
  const t = TYPE_ICON[type] ?? { icon: Shapes }
  return <t.icon className={cn('h-3.5 w-3.5 shrink-0 text-primary', t.className, className)} />
}

export function RepsPanel() {
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const addRep = useMolStore(s => s.addRep)
  const updateRep = useMolStore(s => s.updateRep)
  const removeRep = useMolStore(s => s.removeRep)

  const st = structures.find(x => x.id === activeId)
  if (!st) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <Shapes className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-xs text-muted-foreground">加载结构后在此管理表示法。</p>
      </div>
    )
  }

  return (
    <div className="pb-4">
      <SectionTitle right={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground transition hover:opacity-90">
              <Plus className="h-3 w-3" /> 添加
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {REP_TYPES.map(t => (
              <DropdownMenuItem key={t} onClick={() => addRep(st.id, { type: t, selection: 'all' })} className="gap-2 text-xs">
                <TypeIcon type={t} />{REP_LABELS[t]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      }>
        表示法 ({st.reps.length})
      </SectionTitle>

      <div className="space-y-2 px-2">
        {st.reps.map(rep => (
          <RepCard key={rep.id} rep={rep} structureId={st.id} onUpdate={updateRep} onRemove={removeRep} />
        ))}
        {st.reps.length === 0 && (
          <p className="rounded-lg border border-dashed border-border/70 p-3 text-center text-[11px] text-muted-foreground">
            没有表示法。点击「添加」或用命令行 <code className="rounded bg-muted px-1">show cartoon</code>。
          </p>
        )}
      </div>
      <PanelHint>
        每种表示法可指定独立的原子范围与配色。选择语法：<code className="text-[10px]">chain A</code>、<code className="text-[10px]">resi 1-60</code>、<code className="text-[10px]">within 5 of (ligand)</code>…
      </PanelHint>
    </div>
  )
}

function RepCard({
  rep, structureId, onUpdate, onRemove,
}: {
  rep: RepConfig
  structureId: string
  onUpdate: (structureId: string, repId: string, patch: Partial<RepConfig>) => void
  onRemove: (structureId: string, repId: string) => void
}) {
  return (
    <div className={cn(
      // `!` 提权：panel-card 为未分层自定义规则，压过 @layer utilities 的状态类
      'panel-card p-2',
      rep.error && 'border-destructive/60! bg-destructive/5!',
      !rep.visible && 'opacity-60 saturate-50',
    )}>
      {/* 行 1：类型 + 参数/可见/删除 */}
      <div className="flex items-center gap-1.5">
        <TypeIcon type={rep.type} className="h-4 w-4 shrink-0" />
        <Select value={rep.type} onValueChange={v => onUpdate(structureId, rep.id, { type: v as RepType })}>
          <SelectTrigger className="h-7 min-w-0 flex-1 border-border bg-background text-[11px] font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REP_TYPES.map(t => (
              <SelectItem key={t} value={t} className="text-xs">
                <span className="flex items-center gap-1.5">
                  <TypeIcon type={t} className="h-3 w-3" />{REP_LABELS[t]}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 参数 */}
        <Popover>
          <PopoverTrigger asChild>
            <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:bg-accent hover:text-foreground active:scale-95" title="参数">
              <SlidersHorizontal className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="right" className="w-56 p-3" align="start">
            <div className="space-y-3">
              {(rep.type === 'spacefill' || rep.type === 'ballstick') && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                    <span>{rep.type === 'spacefill' ? '原子半径倍率' : '球半径倍率'}</span>
                    <span className="font-mono">{rep.ballScale.toFixed(2)}×</span>
                  </div>
                  <Slider
                    value={[rep.ballScale]} min={0.1} max={2} step={0.05}
                    onValueChange={v => onUpdate(structureId, rep.id, { ballScale: v[0] })}
                  />
                </div>
              )}
              {(rep.type === 'ballstick' || rep.type === 'sticks') && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                    <span>棍半径</span><span className="font-mono">{rep.stickRadius.toFixed(2)} Å</span>
                  </div>
                  <Slider
                    value={[rep.stickRadius]} min={0.05} max={0.35} step={0.01}
                    onValueChange={v => onUpdate(structureId, rep.id, { stickRadius: v[0] })}
                  />
                </div>
              )}
              {(rep.type === 'cartoon' || rep.type === 'putty') && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                    <span>{rep.type === 'putty' ? '管径整体倍率' : '带状宽度'}</span><span className="font-mono">{rep.cartoonWidth.toFixed(2)}×</span>
                  </div>
                  <Slider
                    value={[rep.cartoonWidth]} min={0.3} max={2.5} step={0.05}
                    onValueChange={v => onUpdate(structureId, rep.id, { cartoonWidth: v[0] })}
                  />
                </div>
              )}
              {rep.type === 'putty' && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                    <span>B 因子上限</span><span className="font-mono">{rep.puttyRange > 0 ? `${rep.puttyRange.toFixed(0)} Å²` : '自动'}</span>
                  </div>
                  <Slider
                    value={[rep.puttyRange > 0 ? rep.puttyRange : 100]} min={0} max={200} step={5}
                    onValueChange={v => onUpdate(structureId, rep.id, { puttyRange: v[0] })}
                  />
                  <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground/80">0 = 按结构实际 B 范围；调低可抑制高 B 离群值拉伸管径。</p>
                </div>
              )}
              {rep.type === 'surface' && (
                <>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                      <span>探针半径</span><span className="font-mono">{rep.probe.toFixed(1)} Å</span>
                    </div>
                    <Slider
                      value={[rep.probe]} min={0} max={3} step={0.1}
                      onValueChange={v => onUpdate(structureId, rep.id, { probe: v[0] })}
                    />
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                      <span>不透明度</span><span className="font-mono">{Math.round(rep.opacity * 100)}%</span>
                    </div>
                    <Slider
                      value={[rep.opacity]} min={0.15} max={1} step={0.05}
                      onValueChange={v => onUpdate(structureId, rep.id, { opacity: v[0] })}
                    />
                  </div>
                </>
              )}
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground">可见</span>
                <Switch checked={rep.visible} onCheckedChange={v => onUpdate(structureId, rep.id, { visible: v })} />
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <button
          onClick={() => onUpdate(structureId, rep.id, { visible: !rep.visible })}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
          title={rep.visible ? '隐藏' : '显示'}
        >
          {rep.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
        <button
          onClick={() => onRemove(structureId, rep.id)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          title="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 行 2（自适应折行）：选择表达式 + 预设 + 配色 + 自定义色 */}
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <Input
          value={rep.selection}
          onChange={e => onUpdate(structureId, rep.id, { selection: e.target.value })}
          placeholder="选择表达式"
          className={cn(
            'h-7 min-w-[96px] flex-1 basis-[96px] grow border-border bg-background font-mono text-[10px]',
            rep.error && 'border-destructive focus-visible:ring-destructive/30',
          )}
        />
        <Select
          value={PRESET_SELECTIONS.some(p => p.value === rep.selection) ? rep.selection : undefined}
          onValueChange={v => onUpdate(structureId, rep.id, { selection: v })}
        >
          <SelectTrigger className="h-7 w-7 shrink-0 border-border bg-background px-1 text-[10px] [&_svg]:hidden" title="预设选择">
            <span className="text-muted-foreground" aria-hidden>≡</span>
            <span className="sr-only">预设选择</span>
          </SelectTrigger>
          <SelectContent>
            {PRESET_SELECTIONS.map(p => (
              <SelectItem key={p.value} value={p.value} className="font-mono text-[10px]">{p.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={rep.colorScheme} onValueChange={v => onUpdate(structureId, rep.id, { colorScheme: v as ColorScheme })}>
          <SelectTrigger className="h-7 w-[92px] shrink-0 border-border bg-background text-[10px]" title="配色方案">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCHEMES.map(sc => (
              <SelectItem key={sc} value={sc} className="text-xs">{COLOR_SCHEME_LABELS[sc]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {rep.colorScheme === 'uniform' && (
          <input
            type="color"
            value={rep.uniformColor}
            onChange={e => onUpdate(structureId, rep.id, { uniformColor: e.target.value })}
            className="h-7 w-8 shrink-0 cursor-pointer rounded border border-border bg-background p-0.5"
            title="统一颜色"
          />
        )}
      </div>
      {rep.error && (
        <p className="mt-1 flex items-center gap-1 text-[10px] text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" /> {rep.error}
        </p>
      )}
    </div>
  )
}
