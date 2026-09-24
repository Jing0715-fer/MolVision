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

const REP_SHOW_ITEMS: { label: string; cmd: string; hint?: string }[] = [
  { label: 'Cartoon 带状', cmd: 'show cartoon, all' },
  { label: '球棍 Ball&Stick', cmd: 'show ballstick, all' },
  { label: '棍 Sticks', cmd: 'show sticks, all' },
  { label: '线 Lines', cmd: 'show lines, all' },
  { label: '空间填充 Spheres', cmd: 'show spacefill, all' },
  { label: '表面 Surface', cmd: 'show surface, all' },
  { label: 'Putty B 因子管', cmd: 'show putty, all' },
]

const REP_HIDE_ITEMS: { label: string; cmd: string }[] = [
  { label: 'Cartoon', cmd: 'hide cartoon' },
  { label: '球棍', cmd: 'hide ballstick' },
  { label: '棍', cmd: 'hide sticks' },
  { label: '线', cmd: 'hide lines' },
  { label: '空间填充', cmd: 'hide spacefill' },
  { label: '表面', cmd: 'hide surface' },
  { label: '全部表示', cmd: 'hide all' },
]

const COLOR_ITEMS: { label: string; cmd: string }[] = [
  { label: '元素色 CPK', cmd: 'color element' },
  { label: '按链', cmd: 'color chain' },
  { label: '按残基', cmd: 'color residue' },
  { label: '二级结构', cmd: 'color ss' },
  { label: 'B 因子', cmd: 'color bfactor' },
  { label: '链序渐变', cmd: 'color spectrum' },
  { label: '口袋距离渐变', cmd: 'color pocket' },
  { label: 'SASA 暴露度', cmd: 'color sasa' },
]

export function ObjectActionBar({ st, className }: { st: StructureEntry; className?: string }) {
  const setActive = useMolStore(s => s.setActive)
  const setStructureVisible = useMolStore(s => s.setStructureVisible)
  const labelCount = useMolStore(s => s.labels.filter(l => l.structureId === st.id).length)

  // 全部动作先激活目标结构（PyMOL 对象面板语义：动作作用于该对象）
  const act = (cmd: string) => {
    setActive(st.id)
    runCommand(cmd)
  }

  return (
    <div className={cn('flex items-center gap-1', className)} role="toolbar" aria-label={`${st.name} 对象动作（PyMOL 风格）`}>
      <LetterButton letter="A" title={`动作 Actions——取景 / 对齐 / 拆分 / 导出 / 关闭（作用于 ${st.name}）`}>
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Actions · {st.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('zoom')}>聚焦适配 <span className="ml-auto font-mono text-[10px] text-muted-foreground">zoom</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('orient')}>主轴对齐 <span className="ml-auto font-mono text-[10px] text-muted-foreground">orient</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('reset')}>复位视角 <span className="ml-auto font-mono text-[10px] text-muted-foreground">reset</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('split_chains')}>按链拆分对象 <span className="ml-auto font-mono text-[10px] text-muted-foreground">split_chains</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act(`save ${st.name}.pdb`)}>导出 PDB <span className="ml-auto font-mono text-[10px] text-muted-foreground">save</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('session export')}>导出会话文件 <span className="ml-auto font-mono text-[10px] text-muted-foreground">session export</span></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => setStructureVisible(st.id, !st.visible)}
          className={st.visible ? '' : 'text-primary'}
        >
          {st.visible ? <><EyeOff className="mr-1.5 h-3 w-3" />隐藏对象</> : <><Eye className="mr-1.5 h-3 w-3" />显示对象</>}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{st.visible ? 'off' : 'on'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => act(`close ${st.name}`)} className="text-destructive focus:text-destructive">关闭结构 <span className="ml-auto font-mono text-[10px]">close</span></DropdownMenuItem>
      </LetterButton>

      <LetterButton letter="S" title={`显示 Show——为 ${st.name} 添加表示法`}>
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Show 表示法</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {REP_SHOW_ITEMS.map(it => (
          <DropdownMenuItem key={it.cmd} onClick={() => act(it.cmd)}>{it.label}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('show hydrogens')}>氢原子</DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('show waters')}>水分子</DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('show cell')}>晶胞盒</DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('preset publication')}>出版级互作一键组</DropdownMenuItem>
      </LetterButton>

      <LetterButton letter="H" title={`隐藏 Hide——移除 ${st.name} 的表示法`}>
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Hide 表示法</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {REP_HIDE_ITEMS.map(it => (
          <DropdownMenuItem key={it.cmd} onClick={() => act(it.cmd)}>{it.label}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('hide hydrogens')}>氢原子</DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('hide waters')}>水分子</DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('hide cell')}>晶胞盒</DropdownMenuItem>
      </LetterButton>

      <LetterButton letter="L" title={`标注 Label——为 ${st.name} 当前选择添加/清除原子标注`} accent={labelCount > 0 ? 'border-primary/50 text-primary' : undefined}>
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Label 标注{labelCount > 0 ? `（${labelCount} 个）` : ''}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('select all')}>全选原子 <span className="ml-auto font-mono text-[10px] text-muted-foreground">select all</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('label on')}>标注当前选择 <span className="ml-auto font-mono text-[10px] text-muted-foreground">label on</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('label off')} className={labelCount > 0 ? 'text-primary' : ''}>清除全部标注 <span className="ml-auto font-mono text-[10px] text-muted-foreground">label off</span></DropdownMenuItem>
      </LetterButton>

      <LetterButton letter="C" title={`上色 Color——为 ${st.name} 应用配色方案`}>
        <DropdownMenuLabel className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Color 上色</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {COLOR_ITEMS.map(it => (
          <DropdownMenuItem key={it.cmd} onClick={() => act(it.cmd)}>{it.label}</DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => act('util cbss')}>SS 卡通 + 基色 <span className="ml-auto font-mono text-[10px] text-muted-foreground">util cbss</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('util cbaw')}>元素 + 白碳（论文） <span className="ml-auto font-mono text-[10px] text-muted-foreground">util cbaw</span></DropdownMenuItem>
        <DropdownMenuItem onClick={() => act('reset_colors')}>重置颜色 <span className="ml-auto font-mono text-[10px] text-muted-foreground">reset_colors</span></DropdownMenuItem>
      </LetterButton>
    </div>
  )
}
