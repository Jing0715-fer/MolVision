'use client'

// Ctrl+K 命令面板：全部命令 + 最近使用 + 置顶的统一快速入口（cmdk 驱动）
// · Enter 直接执行（示例命令，面板内可见将执行的内容——无意外）
// · Tab 填入控制台输入行继续编辑（带补全）
// · 快速动作（帮助/加载结构/历史面板）与结构切换入口
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import {
  Boxes, Bot, ChevronRight, Command as CommandIcon, HelpCircle,
  FolderOpen, History, Palette, Sparkles, Star, Terminal, Triangle,
  Maximize, RotateCcw, Zap, Camera, Download, Save, FilePlus2,
} from 'lucide-react'
import { useMolStore, engineRef } from '@/lib/molecular/store'
import { COMMAND_HELP, commandCmd, runCommand } from '@/lib/molecular/commands'
import { exportSessionFile, newSession, saveSession } from '@/lib/molecular/session'
import {
  appendCmdHistory, dispatchFillCmd, pinnedCmdsSnapshot, cmdHistorySnapshot, emptyCmdSnapshot, subscribeCmdHistory,
} from '@/lib/molecular/cmd-history'
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useI18n, tt, type TranslateInput } from '@/i18n'
import { cn } from '@/lib/utils'

/** 面板项统一模型 */
interface PaletteItem {
  id: string
  /** 显示名 */
  label: TranslateInput
  /** 描述（过滤关键词兼作用） */
  desc: TranslateInput
  /** Enter 实际执行的命令（raw） */
  run: string
  /** Tab 填入控制台的编辑起点（默认 = run 的首词） */
  fill?: string
  icon: React.ComponentType<{ className?: string }>
  iconCls: string
}

/** 取示例命令的可执行首段（「·」分隔的多示例取第一段） */
const firstExample = (ex: string) => ex.split('·')[0].trim()

/** cmdk 过滤 value 扁平化：DualText 两种语言都参与搜索（命令名本身是英文） */
const flat = (x: TranslateInput): string => (typeof x === 'string' ? x : `${x.zh} ${x.en}`)

/** 命令分类图标与配色（与 ConsoleBar 补全弹层同构：primary=结构域 · amber=选择语义 · 其余 muted） */
function commandIcon(cmd: string): { icon: React.ComponentType<{ className?: string }>; cls: string } {
  const c = cmd.split(/[\s|=]/)[0].toLowerCase()
  if (['load', 'activate', 'close', 'clear', 'split_chains', 'create', 'save', 'session', 'untransform'].includes(c))
    return { icon: Boxes, cls: 'text-primary' }
  if (['select', 'delete', 'count_atoms', 'label', 'preset'].includes(c))
    return { icon: Triangle, cls: 'text-amber-600 dark:text-amber-400' }
  if (['show', 'hide', 'set', 'bg', 'color', 'util', 'slab', 'axes', 'outline', 'stereo', 'ssao', 'fps', 'perf', 'hbonds'].includes(c))
    return { icon: Palette, cls: 'text-muted-foreground' }
  if (['zoom', 'orient', 'get_view', 'set_view', 'view', 'spin', 'rock', 'tour'].includes(c))
    return { icon: Sparkles, cls: 'text-muted-foreground' }
  if (['superpose', 'morph', 'movie', 'ensemble', 'record', 'symmetry'].includes(c))
    return { icon: ChevronRight, cls: 'text-muted-foreground' }
  if (['map', 'contacts', 'interface', 'xcontacts', 'sasa', 'bsa', 'xbsa', 'dssp'].includes(c))
    return { icon: CommandIcon, cls: 'text-muted-foreground' }
  return { icon: Terminal, cls: 'text-muted-foreground' }
}

/** 静态快速动作（对话框/面板入口） */
const QUICK_ACTIONS_STATIC: PaletteItem[] = [
  {
    id: 'qa-agent', label: { zh: 'AI 助手', en: 'AI assistant' }, desc: { zh: '自然语言指挥工作台 · Ctrl+J', en: 'Natural-language control · Ctrl+J' },
    run: '', fill: '',
    icon: Bot, iconCls: 'text-primary',
  },
  {
    id: 'qa-load', label: { zh: '加载结构…', en: 'Load structure…' }, desc: { zh: '打开加载对话框（PDB ID / 文件 / 示例）', en: 'Open the load dialog (PDB ID / file / examples)' },
    run: '', fill: '',
    icon: FolderOpen, iconCls: 'text-primary',
  },
  {
    id: 'qa-help', label: { zh: '帮助与快捷键', en: 'Help & shortcuts' }, desc: { zh: '打开帮助文档', en: 'Open the help documentation' },
    run: '', fill: '',
    icon: HelpCircle, iconCls: 'text-muted-foreground',
  },
  {
    id: 'qa-history', label: { zh: '命令历史面板', en: 'Command history panel' }, desc: { zh: '全量历史 · 搜索 · 置顶管理', en: 'Full history · search · pinning' },
    run: 'history', fill: 'history',
    icon: History, iconCls: 'text-muted-foreground',
  },
]

export function CommandPalette() {
  const { t, locale } = useI18n()
  const open = useMolStore(s => s.ui.paletteOpen)
  const setUi = useMolStore(s => s.setUi)
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const settings = useMolStore(s => s.settings)
  // 历史/置顶：localStorage 外部存储（写入方失效缓存 + notify）——避免 effect 内 setState（React Compiler 约束）
  const history = useSyncExternalStore(subscribeCmdHistory, cmdHistorySnapshot, emptyCmdSnapshot)
  const pinned = useSyncExternalStore(subscribeCmdHistory, pinnedCmdsSnapshot, emptyCmdSnapshot)

  const [confirmNewSession, setConfirmNewSession] = useState(false)

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
  // 动态快速动作（视图/视觉/导出/会话——带状态感知标签）
  const quickActions = useMemo<PaletteItem[]>(() => [
    ...QUICK_ACTIONS_STATIC,
    {
      id: 'qa-fit', label: { zh: '适配视图', en: 'Fit view' }, desc: { zh: '缩放到整个分子 · 快捷键 F', en: 'Zoom to the whole molecule · shortcut F' },
      run: '', fill: 'zoom ',
      icon: Maximize, iconCls: 'text-muted-foreground',
    },
    {
      id: 'qa-reset', label: { zh: '复位视角', en: 'Reset view' }, desc: { zh: '回到默认正视图', en: 'Return to the default front view' },
      run: '', fill: 'orient ',
      icon: RotateCcw, iconCls: 'text-muted-foreground',
    },
    {
      id: 'qa-hbond',
      label: settings.showHBonds ? { zh: '隐藏氢键网络', en: 'Hide H-bond network' } : { zh: '显示氢键网络', en: 'Show H-bond network' },
      desc: settings.showHBonds
        ? { zh: '青色虚线叠加 · 快捷键 B', en: 'Teal dashed overlay · shortcut B' }
        : { zh: '青色虚线叠加 · 快捷键 B · 默认仅选集相关', en: 'Teal dashed overlay · shortcut B · selection-only by default' },
      run: '', fill: 'hbonds ',
      icon: Zap, iconCls: 'text-muted-foreground',
    },
    {
      id: 'qa-shot', label: { zh: '导出截图 PNG', en: 'Export PNG snapshot' }, desc: { zh: '当前视口 · 2× 分辨率 · 透明可后接 bg', en: 'Current viewport · 2× resolution · pair with bg for transparency' },
      run: '', fill: 'png ',
      icon: Camera, iconCls: 'text-muted-foreground',
    },
    {
      id: 'qa-session-save', label: { zh: '保存会话', en: 'Save session' }, desc: { zh: '结构/表示法/设置入档（刷新恢复）', en: 'Structures/reps/settings persisted (restored on refresh)' },
      run: '', fill: 'session ',
      icon: Save, iconCls: 'text-muted-foreground',
    },
    {
      id: 'qa-session-export', label: { zh: '导出会话文件', en: 'Export session file' }, desc: { zh: '.molvision 归档 · 可分享', en: '.molvision archive · shareable' },
      run: '', fill: 'session ',
      icon: Download, iconCls: 'text-muted-foreground',
    },
    {
      id: 'qa-session-new', label: { zh: '新建会话', en: 'New session' }, desc: { zh: '清空全部结构与状态', en: 'Clear all structures and state' },
      run: '', fill: 'session ',
      icon: FilePlus2, iconCls: 'text-muted-foreground',
    },
  ], [settings.showHBonds])

  const allItems = useMemo<PaletteItem[]>(() => {
    // 全部命令（示例命令可直接执行；label 随界面语言取 cmd/cmdEn）
    const cmds: PaletteItem[] = COMMAND_HELP.map(h => {
      const { icon, cls } = commandIcon(h.cmd)
      const run = firstExample(h.example) || h.cmd
      return { id: 'cmd:' + h.cmd, label: commandCmd(h), desc: h.desc, run, fill: h.cmd.split(/[\s|<[]/)[0], icon, iconCls: cls }
    })
    // 快速动作
    return [...quickActions, ...cmds]
  }, [quickActions, locale])

  const recentItems = useMemo<PaletteItem[]>(() => {
    return [...new Set(history.slice().reverse())].slice(0, 8).map((cmd, i) => {
      const { icon, cls } = commandIcon(cmd)
      return { id: `recent:${i}:${cmd}`, label: cmd, desc: { zh: '最近使用', en: 'Recent' }, run: cmd, icon, iconCls: cls }
    })
  }, [history])

  const pinnedItems = useMemo<PaletteItem[]>(() => {
    return pinned.map(cmd => {
      const { icon, cls } = commandIcon(cmd)
      return { id: `pin:${cmd}`, label: cmd, desc: { zh: '已置顶', en: 'Pinned' }, run: cmd, icon, iconCls: cls }
    })
  }, [pinned])

  const structureItems = useMemo<PaletteItem[]>(() => {
    if (structures.length < 2) return []
    return structures.map(st => ({
      id: `st:${st.id}`,
      label: { zh: `切换到 ${st.name}`, en: `Switch to ${st.name}` },
      desc: { zh: `${st.summary.atoms.toLocaleString(locale)} 原子 · ${st.summary.chains} 链${st.id === activeId ? ' · 当前活动' : ''}`, en: `${st.summary.atoms.toLocaleString(locale)} atoms · ${st.summary.chains} chains${st.id === activeId ? ' · active' : ''}` },
      run: `activate ${st.name}`,
      fill: 'activate ',
      icon: Boxes,
      iconCls: st.id === activeId ? 'text-primary' : 'text-muted-foreground',
    }))
  }, [structures, activeId, locale])

  // ---------- 行为 ----------
  const execute = (item: PaletteItem) => {
    setOpen(false)
    if (item.id === 'qa-agent') { setUi({ agentOpen: true }); return }
    if (item.id === 'qa-load') { setUi({ loadOpen: true }); return }
    if (item.id === 'qa-help') { setUi({ helpOpen: true }); return }
    // 视觉/会话快捷动作（引擎/会话层直接调用，不走命令解析）
    if (item.id === 'qa-fit') { requestAnimationFrame(() => engineRef.current?.fitView()); return }
    if (item.id === 'qa-reset') { requestAnimationFrame(() => engineRef.current?.resetView()); return }
    if (item.id === 'qa-hbond') {
      const next = !useMolStore.getState().settings.showHBonds
      requestAnimationFrame(() => {
        useMolStore.getState().updateSettings({ showHBonds: next })
        appendCmdHistory(`hbonds ${next ? 'on' : 'off'}`)
      })
      return
    }
    if (item.id === 'qa-shot') {
      requestAnimationFrame(() => {
        const eng = engineRef.current
        if (!eng) return
        try {
          const url = eng.capture({ scale: 2, transparent: false })
          const a = document.createElement('a')
          a.href = url
          a.download = `${structures[0]?.name ?? 'molvision'}@2x.png`
          a.click()
          toast.success(tt({ zh: '截图已导出（2× 分辨率）', en: 'Snapshot exported (2× resolution)' }))
          appendCmdHistory('png 2')
        } catch { toast.error(tt({ zh: '截图失败', en: 'Snapshot failed' })) }
      })
      return
    }
    if (item.id === 'qa-session-save') {
      requestAnimationFrame(() => {
        if (saveSession()) toast.success(tt({ zh: '会话已保存', en: 'Session saved' }), { description: tt({ zh: '刷新后自动恢复', en: 'Restores automatically on refresh' }) })
        else toast.error(tt({ zh: '保存失败——场景为空', en: 'Save failed — empty scene' }))
      })
      return
    }
    if (item.id === 'qa-session-export') {
      requestAnimationFrame(() => {
        if (exportSessionFile()) toast.success(tt({ zh: '会话已导出', en: 'Session exported' }), { description: tt({ zh: '文件已开始下载', en: 'File download started' }) })
        else toast.error(tt({ zh: '导出失败——场景为空或结构过大', en: 'Export failed — empty scene or structure too large' }))
      })
      return
    }
    if (item.id === 'qa-session-new') {
      // 有结构时先确认（防误触清空——与 Toolbar 新建会话同款 AlertDialog）；
      // palette 先关，确认框延迟一帧弹出（避免两个弹层叠在一起）
      if (structures.length) requestAnimationFrame(() => setConfirmNewSession(true))
      else requestAnimationFrame(() => toast.info(tt({ zh: '当前就是空会话', en: 'Already an empty session' })))
      return
    }
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
      value={`${flat(item.label)} ${flat(item.desc)}`}
      onSelect={() => execute(item)}
      data-palette-id={item.id}
      className="gap-2.5"
    >
      <item.icon className={cn('h-4 w-4 shrink-0', item.iconCls)} />
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{t(item.label)}</span>
      <span className="hidden max-w-[45%] shrink-0 truncate text-[11px] text-muted-foreground/70 sm:inline">{t(item.desc)}</span>
      <span className="ml-1 hidden shrink-0 items-center gap-1.5 md:flex">
        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground" title={t({ zh: '执行', en: 'Run' })}>↵</kbd>
        <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground" title={t({ zh: '填入命令行编辑', en: 'Fill into the command line to edit' })}>Tab</kbd>
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
    <>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t({ zh: '命令面板', en: 'Command palette' })}
        description={t({ zh: '搜索并执行命令，或填入命令行编辑', en: 'Search and run commands, or fill into the command line to edit' })}
        className="mol-elevate-lg sm:max-w-xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="text-xs font-semibold">{t({ zh: '命令面板', en: 'Command palette' })}</span>
          <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px] text-muted-foreground">Ctrl+K</kbd>
          <span className="mol-micro ml-auto mr-9 text-muted-foreground">COMMAND PALETTE</span>
        </div>
        <CommandInput
          placeholder={t({ zh: '搜索命令、最近使用或结构…（Enter 执行 · Tab 填入编辑）', en: 'Search commands, recent items, or structures… (Enter to run · Tab to edit)' })}
          onKeyDown={onInputKeyDown}
          className="font-mono text-[13px]"
        />
        <CommandList className="mol-scroll max-h-[380px]">
          <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">{t({ zh: '没有匹配的命令', en: 'No matching commands' })}</CommandEmpty>
          {pinnedItems.length > 0 && (
            <CommandGroup heading={t({ zh: '置顶（常用工作流）', en: 'Pinned (common workflows)' })}>
              {pinnedItems.map(renderItem)}
            </CommandGroup>
          )}
          {recentItems.length > 0 && (
            <CommandGroup heading={t({ zh: '最近使用', en: 'Recent' })}>
              {recentItems.map(renderItem)}
            </CommandGroup>
          )}
          {structureItems.length > 0 && (
            <CommandGroup heading={t({ zh: '结构切换', en: 'Switch structure' })}>
              {structureItems.map(renderItem)}
            </CommandGroup>
          )}
          <CommandSeparator />
          <CommandGroup heading={t({ zh: '全部命令（Enter 执行示例 · Tab 进命令行带补全编辑）', en: 'All commands (Enter runs the example · Tab opens in the command line with completion)' })}>
            {allItems.map(renderItem)}
          </CommandGroup>
        </CommandList>
        <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-[10px] text-muted-foreground/70">
          <span className="flex min-w-0 items-center gap-1 truncate">
            <Star className="h-3 w-3 shrink-0 text-amber-500/70" />
            {t({ zh: '在命令历史面板可置顶常用命令（命令行 `` 或 history）', en: 'Pin frequently used commands in the history panel (`` or history in the command line)' })}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">↑↓</kbd>{t({ zh: '导航', en: 'navigate' })}
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">↵</kbd>{t({ zh: '执行', en: 'run' })}
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">Tab</kbd>{t({ zh: '编辑', en: 'edit' })}
            <kbd className="rounded border border-border bg-muted px-1 font-mono text-[9px]">Esc</kbd>{t({ zh: '关闭', en: 'close' })}
          </span>
        </div>
      </CommandDialog>

      {/* 新建会话确认（有结构时二次确认，防误触——文案与 Toolbar 同源） */}
      <AlertDialog open={confirmNewSession} onOpenChange={setConfirmNewSession}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {structures.length > 0
                ? t({ zh: `新建会话并关闭 ${structures.length} 个结构？`, en: `Start a new session and close ${structures.length} structure${structures.length > 1 ? 's' : ''}?` })
                : t({ zh: '新建会话？', en: 'Start a new session?' })}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <p>
                  {t({ zh: '将清空全部结构、表示法、选择、测量、标签、命名选择、视角书签、movie 时间轴与电子密度图；本地自动存档同步清除。', en: 'This clears all structures, representations, selections, measurements, labels, named selections, view bookmarks, the movie timeline and electron-density maps; the local autosave is cleared as well.' })}
                </p>
                <p className="mt-1.5 text-muted-foreground">
                  {t({ zh: '此操作不可撤销。如需保留当前场景，可先「保存会话文件」导出 .molvision 留档。', en: 'This action cannot be undone. To keep the current scene, use "Save session file…" to export a .molvision first.' })}
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t({ zh: '取消', en: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmNewSession(false)
                const closed = newSession()
                toast.success(tt(closed > 0
                  ? { zh: `已新建会话（关闭 ${closed} 个结构）`, en: `New session started (${closed} structures closed)` }
                  : { zh: '已新建会话', en: 'New session started' }), {
                  description: tt({ zh: '结构 / 书签 / 时间轴 / 密度图已清空 · 可随时「保存会话文件」留档分享', en: 'Structures / bookmarks / timeline / maps cleared · use "Save session file…" anytime to archive and share' }),
                })
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t({ zh: '新建会话', en: 'New session' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
