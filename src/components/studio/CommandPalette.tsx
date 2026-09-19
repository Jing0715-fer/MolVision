'use client'

// Ctrl+K 命令面板：全部命令 + 最近使用 + 置顶的统一快速入口（cmdk 驱动）
// · Enter 直接执行（示例命令，面板内可见将执行的内容——无意外）
// · Tab 填入控制台输入行继续编辑（带补全）
// · 快速动作（帮助/加载结构/历史面板）与结构切换入口
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  Boxes, ChevronRight, Command as CommandIcon, CornerDownLeft, HelpCircle,
  FolderOpen, History, Palette, Sparkles, Star, Terminal, Triangle,
} from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import { COMMAND_HELP, runCommand } from '@/lib/molecular/commands'
import {
  appendCmdHistory, dispatchFillCmd, pinnedCmdsSnapshot, cmdHistorySnapshot, emptyCmdSnapshot, subscribeCmdHistory,
} from '@/lib/molecular/cmd-history'
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

/** 面板项统一模型 */
interface PaletteItem {
  id: string
  /** 显示名 */
  label: string
  /** 描述（过滤关键词兼作用） */
  desc: string
  /** Enter 实际执行的命令（raw） */
  run: string
  /** Tab 填入控制台的编辑起点（默认 = run 的首词） */
  fill?: string
  icon: React.ComponentType<{ className?: string }>
  iconCls: string
}

/** 取示例命令的可执行首段（「·」分隔的多示例取第一段） */
const firstExample = (ex: string) => ex.split('·')[0].trim()

/** 命令分类图标与配色（与 ConsoleBar 补全弹层的分类语义一致） */
function commandIcon(cmd: string): { icon: React.ComponentType<{ className?: string }>; cls: string } {
  const c = cmd.split(/[\s|=]/)[0].toLowerCase()
  if (['load', 'activate', 'close', 'clear', 'split_chains', 'create', 'save', 'session', 'untransform'].includes(c))
    return { icon: Boxes, cls: 'text-emerald-500' }
  if (['select', 'delete', 'count_atoms', 'label', 'preset'].includes(c))
    return { icon: Triangle, cls: 'text-amber-500' }
  if (['show', 'hide', 'set', 'bg', 'color', 'util', 'slab', 'axes', 'outline', 'stereo', 'ssao', 'fps', 'perf', 'hbonds'].includes(c))
    return { icon: Palette, cls: 'text-violet-500' }
  if (['zoom', 'orient', 'get_view', 'set_view', 'view', 'spin', 'rock', 'tour'].includes(c))
    return { icon: Sparkles, cls: 'text-teal-500' }
  if (['superpose', 'morph', 'movie', 'ensemble', 'record', 'symmetry'].includes(c))
    return { icon: ChevronRight, cls: 'text-rose-500' }
  if (['map', 'contacts', 'interface', 'xcontacts', 'sasa', 'bsa', 'xbsa', 'dssp'].includes(c))
    return { icon: CommandIcon, cls: 'text-sky-500' }
  return { icon: Terminal, cls: 'text-muted-foreground' }
}

const QUICK_ACTIONS: PaletteItem[] = [
  {
    id: 'qa-load', label: '加载结构…', desc: '打开加载对话框（PDB ID / 文件 / 示例）',
    run: '', fill: '',
    icon: FolderOpen, iconCls: 'text-emerald-500',
  },
  {
    id: 'qa-help', label: '帮助与快捷键', desc: '打开帮助文档',
    run: '', fill: '',
    icon: HelpCircle, iconCls: 'text-sky-500',
  },
  {
    id: 'qa-history', label: '命令历史面板', desc: '全量历史 · 搜索 · 置顶管理',
    run: 'history', fill: 'history',
    icon: History, iconCls: 'text-amber-500',
  },
]

export function CommandPalette() {
  const open = useMolStore(s => s.ui.paletteOpen)
  const setUi = useMolStore(s => s.setUi)
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  // 历史/置顶：localStorage 外部存储（写入方失效缓存 + notify）——避免 effect 内 setState（React Compiler 约束）
  const history = useSyncExternalStore(subscribeCmdHistory, cmdHistorySnapshot, emptyCmdSnapshot)
  const pinned = useSyncExternalStore(subscribeCmdHistory, pinnedCmdsSnapshot, emptyCmdSnapshot)

  // Ctrl/Cmd+K 全局开关（输入框聚焦时同样生效——浏览器标准快捷键语义）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setUi({ paletteOpen: !useMolStore.getState().ui.paletteOpen })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setUi])

  const setOpen = (v: boolean) => setUi({ paletteOpen: v })

  // ---------- 数据源 ----------
  const allItems = useMemo<PaletteItem[]>(() => {
    // 全部命令（示例命令可直接执行）
    const cmds: PaletteItem[] = COMMAND_HELP.map(h => {
      const { icon, cls } = commandIcon(h.cmd)
      const run = firstExample(h.example) || h.cmd
      return { id: 'cmd:' + h.cmd, label: h.cmd, desc: h.desc, run, fill: h.cmd.split(/[\s|<[]/)[0], icon, iconCls: cls }
    })
    // 快速动作
    return [...QUICK_ACTIONS, ...cmds]
  }, [])

  const recentItems = useMemo<PaletteItem[]>(() => {
    return [...new Set(history.slice().reverse())].slice(0, 8).map((cmd, i) => {
      const { icon, cls } = commandIcon(cmd)
      return { id: `recent:${i}:${cmd}`, label: cmd, desc: '最近使用', run: cmd, icon, iconCls: cls }
    })
  }, [history])

  const pinnedItems = useMemo<PaletteItem[]>(() => {
    return pinned.map(cmd => {
      const { icon, cls } = commandIcon(cmd)
      return { id: `pin:${cmd}`, label: cmd, desc: '已置顶', run: cmd, icon, iconCls: cls }
    })
  }, [pinned])

  const structureItems = useMemo<PaletteItem[]>(() => {
    if (structures.length < 2) return []
    return structures.map(st => ({
      id: `st:${st.id}`,
      label: `切换到 ${st.name}`,
      desc: `${st.summary.atoms.toLocaleString()} 原子 · ${st.summary.chains} 链${st.id === activeId ? ' · 当前活动' : ''}`,
      run: `activate ${st.name}`,
      fill: 'activate ',
      icon: Boxes,
      iconCls: st.id === activeId ? 'text-primary' : 'text-emerald-500',
    }))
  }, [structures, activeId])

  // ---------- 行为 ----------
  const execute = (item: PaletteItem) => {
    setOpen(false)
    if (item.id === 'qa-load') { setUi({ loadOpen: true }); return }
    if (item.id === 'qa-help') { setUi({ helpOpen: true }); return }
    if (!item.run) return
    // 让面板先关闭再执行（runCommand 的输出/ toast 不被对话框遮挡）
    requestAnimationFrame(() => {
      runCommand(item.run)
      appendCmdHistory(item.run)
    })
  }

  const fillConsole = (item: PaletteItem) => {
    setOpen(false)
    if (!item.fill && !item.run) return
    setUi({ consoleOpen: true })
    // ConsoleBar 监听 FILL_CMD_EVENT：填入输入行 + 焦点 + 触发补全
    requestAnimationFrame(() => dispatchFillCmd(item.fill || item.run))
  }

  const renderItem = (item: PaletteItem) => (
    <CommandItem
      key={item.id}
      value={`${item.label} ${item.desc}`}
      onSelect={() => execute(item)}
      data-palette-id={item.id}
      className="gap-2.5"
    >
      <item.icon className={cn('h-4 w-4 shrink-0', item.iconCls)} />
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{item.label}</span>
      <span className="hidden max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground/70 sm:inline">{item.desc}</span>
      <span className="ml-1 hidden shrink-0 items-center gap-1 text-[9px] text-muted-foreground/50 md:flex">
        <CornerDownLeft className="h-3 w-3" />执行
        <kbd className="rounded border border-border bg-muted px-1 font-mono">Tab</kbd>编辑
      </span>
    </CommandItem>
  )

  // Tab 键：把选中项填入控制台（cmdk 不接管 Tab——在 Input 上自行处理；
  // 选中项回查走 data-palette-id 属性，不依赖文本内容拼接）
  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = [...document.querySelectorAll<HTMLElement>('[cmdk-item]')]
      .find(x => x.getAttribute('aria-selected') === 'true')
    const id = el?.dataset.paletteId
    if (!id) return
    const item = [...pinnedItems, ...recentItems, ...structureItems, ...allItems].find(it => it.id === id)
    if (item) fillConsole(item)
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="命令面板"
      description="搜索并执行命令，或填入命令行编辑"
      className="sm:max-w-xl"
    >
      <CommandInput
        placeholder="搜索命令、最近使用或结构…（Enter 执行 · Tab 填入编辑）"
        onKeyDown={onInputKeyDown}
      />
      <CommandList>
        <CommandEmpty>没有匹配的命令</CommandEmpty>
        {pinnedItems.length > 0 && (
          <CommandGroup heading="置顶（常用工作流）">
            {pinnedItems.map(renderItem)}
          </CommandGroup>
        )}
        {recentItems.length > 0 && (
          <CommandGroup heading="最近使用">
            {recentItems.map(renderItem)}
          </CommandGroup>
        )}
        {structureItems.length > 0 && (
          <CommandGroup heading="结构切换">
            {structureItems.map(renderItem)}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading="全部命令（Enter 执行示例 · Tab 进命令行带补全编辑）">
          {allItems.map(renderItem)}
        </CommandGroup>
      </CommandList>
      <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground/60">
        <span className="flex items-center gap-1">
          <Star className="h-3 w-3 text-amber-500/70" />
          在命令历史面板可置顶常用命令（命令行 `` 或 history）
        </span>
        <span className="flex items-center gap-1">
          <kbd className="rounded border border-border bg-muted px-1 font-mono">↑↓</kbd>导航
          <kbd className="rounded border border-border bg-muted px-1 font-mono">Esc</kbd>关闭
        </span>
      </div>
    </CommandDialog>
  )
}
