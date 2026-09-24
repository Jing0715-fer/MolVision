'use client'

// PyMOL 式对象动作条：结构卡上的 A/S/H/L/C 五字母按钮（对象面板标志性交互）。
// A=Actions（取景/叠合/导出等）· S=Show（添加表示法）· H=Hide（移除表示法）·
// L=Label（原子标注）· C=Color（上色方案）——全部走 runCommand 保证与命令行行为一致。
import { Eye, EyeOff } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { runCommand } from '@/lib/molecular/commands'
import { useMolStore } from '@/lib/molecular/store'
import { useI18n, type DualText } from '@/i18n'
import type { StructureEntry } from '@/lib/molecular/types'
import { cn } from '@/lib/utils'

/** PyMOL 字母按钮统一规格：22×22px 方形平面（含 44px 负外扩热区）· mono 大写字母 */
function LetterButton({ letter, title, children, accent }: {
  letter: string
  title: string
  children: React.ReactNode
  accent?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={title}
          title={title}
          className={cn(
            'relative flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[3px] border border-border/70 bg-muted/40',
            'font-mono text-[10px] font-bold uppercase leading-none text-muted-foreground transition',
            'after:absolute after:-inset-[9px] after:content-[""]', // 44px 热区（负外扩）
            'hover:border-foreground/30 hover:bg-accent hover:text-foreground active:scale-90',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary data-[state=open]:border-primary/60 data-[state=open]:bg-primary/10 data-[state=open]:text-primary',
            accent,
          )}
        >
          {letter}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="min-w-44">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const REP_SHOW_ITEMS: { label: DualText; cmd: string; hint?: string }[] = [
  { label: { zh: 'Cartoon 带状', en: 'Cartoon' }, cmd: 'show cartoon, all' },
  { label: { zh: '球棍 Ball&Stick', en: 'Ball & stick' }, cmd: 'show ballstick, all' },
  { label: { zh: '棍 Sticks', en: 'Sticks' }, cmd: 'show sticks, all' },
  { label: { zh: '线 Lines', en: 'Lines' }, cmd: 'show lines, all' },
  { label: { zh: '空间填充 Spheres', en: 'Spacefill' }, cmd: 'show spacefill, all' },
  { label: { zh: '表面 Surface', en: 'Surface' }, cmd: 'show surface, all' },
  { label: { zh: 'Putty B 因子管', en: 'Putty B-factor tube' }, cmd: 'show putty, all' },
]

const REP_HIDE_ITEMS: { label: DualText; cmd: string }[] = [
  { label: { zh: 'Cartoon', en: 'Cartoon' }, cmd: 'hide cartoon' },
  { label: { zh: '球棍', en: 'Ball & stick' }, cmd: 'hide ballstick' },
  { label: { zh: '棍', en: 'Sticks' }, cmd: 'hide sticks' },
  { label: { zh: '线', en: 'Lines' }, cmd: 'hide lines' },
  { label: { zh: '空间填充', en: 'Spacefill' }, cmd: 'hide spacefill' },
  { label: { zh: '表面', en: 'Surface' }, cmd: 'hide surface' },
  { label: { zh: '全部表示', en: 'All representations' }, cmd: 'hide all' },
]

const COLOR_ITEMS: { label: DualText; cmd: string }[] = [
  { label: { zh: '元素色 CPK', en: 'Element (CPK)' }, cmd: 'color element' },
  { label: { zh: '按链', en: 'By chain' }, cmd: 'color chain' },
  { label: { zh: '按残基', en: 'By residue' }, cmd: 'color residue' },
  { label: { zh: '二级结构', en: 'Secondary structure' }, cmd: 'color ss' },
  { label: { zh: 'B 因子', en: 'B-factor' }, cmd: 'color bfactor' },
  { label: { zh: '链序渐变', en: 'Chain-order spectrum' }, cmd: 'color spectrum' },
  { label: { zh: '口袋距离渐变', en: 'Pocket distance gradient' }, cmd: 'color pocket' },
  { label: { zh: 'SASA 暴露度', en: 'SASA exposure' }, cmd: 'color sasa' },
]

export function ObjectActionBar({ st, className }: { st: StructureEntry; className?: string }) {
  const { t } = useI18n()
  const setActive = useMolStore(s => s.setActive)
  const setStructureVisible = useMolStore(s => s.setStructureVisible)
  const labelCount = useMolStore(s => s.labels.filter(l => l.structureId === st.id).length)

  // 全部动作先激活目标结构（PyMOL 对象面板语义：动作作用于该对象）
  const act = (cmd: string) => {
    setActive(st.id)
    runCommand(cmd)
  }

  return (
    <div className={cn('flex items-center gap-1', className)} role="toolbar" aria-label={t({ zh: `${st.name} 对象动作（PyMOL 风格）`, en: `${st.name} object actions (PyMOL style)` })}>
      <LetterButton letter="A" title={t({ zh: `动作 Actions——取景 / 对齐 / 拆分 / 导出 / 关闭（作用于 ${st.name}）`, en: `Actions — view / align / split / export / close (applies to ${st.name})` })}>
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Actions · {st.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('zoom')}>{t({ zh: '聚焦适配', en: 'Fit to view' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">zoom</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('orient')}>{t({ zh: '主轴对齐', en: 'Align principal axes' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">orient</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('reset')}>{t({ zh: '复位视角', en: 'Reset view' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">reset</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('split_chains')}>{t({ zh: '按链拆分对象', en: 'Split by chain' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">split_chains</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act(`save ${st.name}.pdb`)}>{t({ zh: '导出 PDB', en: 'Export PDB' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">save</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('session export')}>{t({ zh: '导出会话文件', en: 'Export session file' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">session export</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setStructureVisible(st.id, !st.visible)}
          className={st.visible ? '' : 'text-primary'}
        >
          {st.visible ? <><EyeOff className="mr-1.5 h-3 w-3" />{t({ zh: '隐藏对象', en: 'Hide object' })}</> : <><Eye className="mr-1.5 h-3 w-3" />{t({ zh: '显示对象', en: 'Show object' })}</>}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{st.visible ? 'off' : 'on'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => act(`close ${st.name}`)} className="text-destructive focus:text-destructive">{t({ zh: '关闭结构', en: 'Close structure' })} <span className="ml-auto font-mono text-[10px]">close</span></DropdownMenuItem>
      </LetterButton>

      <LetterButton letter="S" title={t({ zh: `显示 Show——为 ${st.name} 添加表示法`, en: `Show — add representations to ${st.name}` })}>
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{t({ zh: 'Show 表示法', en: 'Show representations' })}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {REP_SHOW_ITEMS.map(it => (
          <DropdownMenuItem key={it.cmd} onClick={() => act(it.cmd)}>{t(it.label)}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('show hydrogens')}>{t({ zh: '氢原子', en: 'Hydrogens' })}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('show waters')}>{t({ zh: '水分子', en: 'Waters' })}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('show cell')}>{t({ zh: '晶胞盒', en: 'Unit cell' })}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('preset publication')}>{t({ zh: '出版级互作一键组', en: 'Publication preset' })}</DropdownMenuItem>
      </LetterButton>

      <LetterButton letter="H" title={t({ zh: `隐藏 Hide——移除 ${st.name} 的表示法`, en: `Hide — remove representations from ${st.name}` })}>
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{t({ zh: 'Hide 表示法', en: 'Hide representations' })}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {REP_HIDE_ITEMS.map(it => (
          <DropdownMenuItem key={it.cmd} onClick={() => act(it.cmd)}>{t(it.label)}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('hide hydrogens')}>{t({ zh: '氢原子', en: 'Hydrogens' })}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('hide waters')}>{t({ zh: '水分子', en: 'Waters' })}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('hide cell')}>{t({ zh: '晶胞盒', en: 'Unit cell' })}</DropdownMenuItem>
      </LetterButton>

      <LetterButton letter="L" title={t({ zh: `标注 Label——为 ${st.name} 当前选择添加/清除原子标注`, en: `Label — add/clear atom labels for the current selection in ${st.name}` })} accent={labelCount > 0 ? 'border-primary/50 text-primary' : undefined}>
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{t({ zh: `Label 标注${labelCount > 0 ? `（${labelCount} 个）` : ''}`, en: `Label${labelCount > 0 ? ` (${labelCount})` : ''}` })}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('select all')}>{t({ zh: '全选原子', en: 'Select all atoms' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">select all</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('label on')}>{t({ zh: '标注当前选择', en: 'Label current selection' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">label on</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('label off')} className={labelCount > 0 ? 'text-primary' : ''}>{t({ zh: '清除全部标注', en: 'Clear all labels' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">label off</span></DropdownMenuItem>
      </LetterButton>

      <LetterButton letter="C" title={t({ zh: `上色 Color——为 ${st.name} 应用配色方案`, en: `Color — apply a color scheme to ${st.name}` })}>
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{t({ zh: 'Color 上色', en: 'Color' })}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {COLOR_ITEMS.map(it => (
          <DropdownMenuItem key={it.cmd} onClick={() => act(it.cmd)}>{t(it.label)}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('util cbss')}>{t({ zh: 'SS 卡通 + 基色', en: 'SS cartoon + base colors' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">util cbss</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('util cbaw')}>{t({ zh: '元素 + 白碳（论文）', en: 'Element + white carbons (publication)' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">util cbaw</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('reset_colors')}>{t({ zh: '重置颜色', en: 'Reset colors' })} <span className="ml-auto font-mono text-[10px] text-muted-foreground">reset_colors</span></DropdownMenuItem>
      </LetterButton>
    </div>
  )
}
