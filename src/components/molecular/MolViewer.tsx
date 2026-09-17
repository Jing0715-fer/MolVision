'use client'

// 3D 视图容器：引擎挂载、悬停提示、右键菜单、拖放加载、快捷键
import { useCallback, useEffect, useRef, useState } from 'react'
import { MolEngine, type AtomPick, type HoverInfo } from '@/lib/molecular/engine'
import { dataRegistry, engineRef, useMolStore } from '@/lib/molecular/store'
import { useHoverStore } from '@/lib/molecular/hover-store'
import { loadFiles } from '@/lib/molecular/loader'
import { PRESETS } from '@/lib/molecular/store'
import { hasSession, restoreSession, saveSession } from '@/lib/molecular/session'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { EnsembleBar } from '@/components/studio/EnsembleBar'
import { RecordBadge } from '@/components/studio/RecordBadge'
import { useEnsembleStore } from '@/lib/molecular/ensemble-store'

interface HoverState { text: string; x: number; y: number; sub?: string }

export default function MolViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const engine = useRef<MolEngine | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; pick: AtomPick } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const visualRev = useMolStore(s => s.visualRev)
  const { theme, setTheme, resolvedTheme } = useTheme()

  // 原子点击处理（先声明，供引擎回调引用）
  const handlePick = useCallback((pick: AtomPick | null, empty: boolean) => {
    const store = useMolStore.getState()
    if (empty || !pick) {
      if (store.measureMode !== 'off') return
      if (store.selection.structureId || store.selection.indices.length) {
        store.setSelection(null, [])
      }
      return
    }
    const data = dataRegistry.get(pick.structureId)
    if (!data) return

    // 双击 → 聚焦残基
    if (pick.doubleClick) {
      const r = data.residues[pick.residueIdx]
      const indices: number[] = []
      for (let i = r.start; i < r.end; i++) indices.push(i)
      engine.current?.fitView([{ structureId: pick.structureId, indices }])
      return
    }

    // 测量模式
    if (store.measureMode !== 'off') {
      store.measurePick(pick.structureId, pick.atomIdx)
      return
    }

    // 选择：Ctrl=单原子，默认=整个残基；Shift=追加，Alt=移除
    let indices: number[]
    if (pick.ctrlKey) {
      indices = [pick.atomIdx]
    } else {
      const r = data.residues[pick.residueIdx]
      indices = []
      for (let i = r.start; i < r.end; i++) indices.push(i)
    }
    const mode = pick.altKey ? 'remove' : pick.shiftKey ? 'add' : 'replace'
    if (!pick.shiftKey && !pick.altKey) store.setActive(pick.structureId)
    store.setSelection(pick.structureId, indices, mode)
  }, [])

  // 引擎生命周期
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const eng = new MolEngine(el, {
      onHover: (info: HoverInfo | null) => {
        if (!info) { setHover(null); useHoverStore.getState().setText(null); return }
        const data = dataRegistry.get(info.structureId)
        if (!data) { setHover(null); useHoverStore.getState().setText(null); return }
        const a = data.atoms
        const i = info.atomIdx
        const res = data.residues[data.atomResidue[i]]
        const rect = el.getBoundingClientRect()
        setHover({
          text: `${a.names[i]} · ${a.resNames[i]} ${a.resSeqs[i]}${a.iCodes[i] || ''}`,
          sub: `链 ${a.chainIds[i].trim() || '?'} · ${a.elements[i]}${a.hetero[i] ? ' · HET' : ''}${a.bfactors[i] ? ` · B=${a.bfactors[i].toFixed(1)}` : ''}${res.ss === 'H' ? ' · 螺旋' : res.ss === 'E' ? ' · 折叠' : ''}`,
          x: info.x - rect.left + 14,
          y: info.y - rect.top + 14,
        })
        useHoverStore.getState().setText(
          `链 ${a.chainIds[i].trim() || '?'} · ${a.resNames[i]} ${a.resSeqs[i]} · ${a.names[i]} (${a.elements[i]})${a.bfactors[i] ? ` · B=${a.bfactors[i].toFixed(1)}` : ''}`
        )
      },
      onPick: (pick, empty) => handlePick(pick, empty),
      onContext: (pick, x, y) => {
        const rect = el.getBoundingClientRect()
        setCtxMenu(pick ? { x: x - rect.left, y: y - rect.top, pick } : null)
      },
    })
    engineRef.current = eng
    engine.current = eng
    eng.sync(useMolStore.getState())
    // 恢复上次会话（结构/表示法/设置/相机）
    if (hasSession() && useMolStore.getState().structures.length === 0) {
      const n = restoreSession()
      if (n > 0) {
        toast.success(`已恢复上次会话`, { description: `${n} 个结构 · 表示法与相机视角已还原` })
      }
    }
    // 会话自动保存（debounced）：结构/reps/设置/命名选择变化时
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    let lastSig = ''
    const unsub = useMolStore.subscribe((s, prev) => {
      if (prev.structures === s.structures && prev.settings === s.settings && prev.namedSelections === s.namedSelections) return
      const sig = `${s.structures.length}|${s.structures.map(x => x.rev).join(',')}|${s.structures.map(x => x.transform ? x.transform.quat.join(',') + ':' + x.transform.translation.join(',') : '-').join(';')}|${JSON.stringify(s.settings)}|${s.namedSelections.length}`
      if (sig === lastSig) return
      lastSig = sig
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => saveSession(), 900)
    })
    const onBeforeUnload = () => saveSession()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      unsub()
      window.removeEventListener('beforeunload', onBeforeUnload)
      if (saveTimer) clearTimeout(saveTimer)
      eng.dispose()
      engineRef.current = null
      engine.current = null
      useHoverStore.getState().setText(null)
    }
  }, [])

  // 视觉同步
  useEffect(() => {
    engine.current?.sync(useMolStore.getState())
  }, [visualRev])

  // 主题切换时视口背景跟随：仅当背景仍为主题默认值（用户自定义过则尊重用户选择）
  useEffect(() => {
    if (!resolvedTheme) return
    const DARK_DEFAULT = '#101215'
    const LIGHT_DEFAULT = '#ffffff'
    const store = useMolStore.getState()
    const cur = store.settings.background.toLowerCase()
    if (resolvedTheme === 'light' && cur === DARK_DEFAULT) {
      store.updateSettings({ background: LIGHT_DEFAULT })
    } else if (resolvedTheme === 'dark' && cur === LIGHT_DEFAULT) {
      store.updateSettings({ background: DARK_DEFAULT })
    }
  }, [resolvedTheme])

  // 快捷键
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const store = useMolStore.getState()
      switch (e.key) {
        case '1': case '2': case '3': case '4': case '5': case '6': case '7': {
          const keys = ['cartoon', 'ballstick', 'spacefill', 'wireframe', 'surface', 'bindingsite', 'hybrid']
          const preset = keys[Number(e.key) - 1]
          if (preset && store.activeId) store.applyPreset(preset)
          break
        }
        case 'f': case 'F':
          engine.current?.fitView()
          break
        case 's': case 'S':
          store.updateSettings({ spin: !store.settings.spin, ...(store.settings.spin ? {} : { rock: false }) })
          break
        case 'r': case 'R':
          store.updateSettings({ rock: !store.settings.rock, ...(store.settings.rock ? {} : { spin: false }) })
          break
        case 'h': case 'H':
          store.updateSettings({ hideHydrogens: !store.settings.hideHydrogens })
          break
        case 'w': case 'W':
          store.updateSettings({ hideWater: !store.settings.hideWater })
          break
        case 'b': case 'B':
          store.updateSettings({ showHBonds: !store.settings.showHBonds })
          break
        case 'p': case 'P': {
          // ensemble 播放/暂停
          const es = useEnsembleStore.getState()
          const eng = engine.current
          if (eng && es.structureId) {
            if (es.playing) eng.pauseEnsemble()
            else eng.playEnsemble(es.structureId)
          }
          break
        }
        case 'l': case 'L':
          store.addLabelsForSelection()
          break
        case '`': case '~':
          store.setUi({ consoleOpen: !store.ui.consoleOpen })
          break
        case 'Escape':
          if (ctxMenu) setCtxMenu(null)
          else if (store.measureMode !== 'off') { store.setMeasureMode('off'); store.clearMeasurePicks() }
          else if (store.selection.indices.length) store.setSelection(null, [])
          break
        case 'Delete': case 'Backspace':
          if (store.selection.indices.length) store.setSelection(null, [])
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctxMenu])

  // 点击任意处关闭右键菜单
  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [ctxMenu])

  const hoverPos = hover ? { left: hover.x, top: hover.y } : null

  // 右键菜单动作
  const ctxActions = {
    atom: () => { if (ctxMenu) { useMolStore.getState().setActive(ctxMenu.pick.structureId); useMolStore.getState().setSelection(ctxMenu.pick.structureId, [ctxMenu.pick.atomIdx]) } },
    residue: () => {
      if (!ctxMenu) return
      const data = dataRegistry.get(ctxMenu.pick.structureId)
      if (!data) return
      const r = data.residues[ctxMenu.pick.residueIdx]
      const idx: number[] = []
      for (let i = r.start; i < r.end; i++) idx.push(i)
      useMolStore.getState().setActive(ctxMenu.pick.structureId)
      useMolStore.getState().setSelection(ctxMenu.pick.structureId, idx)
    },
    chain: () => {
      if (!ctxMenu) return
      const data = dataRegistry.get(ctxMenu.pick.structureId)
      if (!data) return
      const chainIdx = data.atomChain[ctxMenu.pick.atomIdx]
      const idx: number[] = []
      for (let i = 0; i < data.atoms.count; i++) if (data.atomChain[i] === chainIdx) idx.push(i)
      useMolStore.getState().setActive(ctxMenu.pick.structureId)
      useMolStore.getState().setSelection(ctxMenu.pick.structureId, idx)
    },
    // 周围环境：5Å 内原子扩展到整残基（含自身残基，适合结合口袋检查）
    environment: () => {
      if (!ctxMenu) return
      const data = dataRegistry.get(ctxMenu.pick.structureId)
      if (!data) return
      const ai = ctxMenu.pick.atomIdx
      const pos = data.atoms.positions
      const cand = data.grid.queryRadius(pos[ai * 3], pos[ai * 3 + 1], pos[ai * 3 + 2], 5, pos)
      const resSet = new Set<number>()
      for (const j of cand) resSet.add(data.atomResidue[j])
      const indices: number[] = []
      for (const ri of resSet) {
        const r = data.residues[ri]
        for (let k = r.start; k < r.end; k++) indices.push(k)
      }
      useMolStore.getState().setActive(ctxMenu.pick.structureId)
      useMolStore.getState().setSelection(ctxMenu.pick.structureId, indices)
      useMolStore.getState().appendLog('out', `已选择周围环境：${resSet.size} 个残基（5Å）`)
    },
    sameResidue: () => {
      if (!ctxMenu) return
      const data = dataRegistry.get(ctxMenu.pick.structureId)
      if (!data) return
      const resName = data.atoms.resNames[ctxMenu.pick.atomIdx].toUpperCase()
      const idx: number[] = []
      for (let i = 0; i < data.atoms.count; i++) if (data.atoms.resNames[i].toUpperCase() === resName) idx.push(i)
      useMolStore.getState().setActive(ctxMenu.pick.structureId)
      useMolStore.getState().setSelection(ctxMenu.pick.structureId, idx)
    },
    measure: () => {
      if (!ctxMenu) return
      useMolStore.getState().setActive(ctxMenu.pick.structureId)
      useMolStore.getState().setMeasureMode('distance')
      useMolStore.getState().measurePick(ctxMenu.pick.structureId, ctxMenu.pick.atomIdx)
    },
    label: () => {
      if (!ctxMenu) return
      useMolStore.getState().setActive(ctxMenu.pick.structureId)
      useMolStore.getState().setSelection(ctxMenu.pick.structureId, [ctxMenu.pick.atomIdx])
      useMolStore.getState().addLabelsForSelection()
    },
    focus: () => {
      if (!ctxMenu) return
      const data = dataRegistry.get(ctxMenu.pick.structureId)
      if (!data) return
      const r = data.residues[ctxMenu.pick.residueIdx]
      const idx: number[] = []
      for (let i = r.start; i < r.end; i++) idx.push(i)
      engine.current?.fitView([{ structureId: ctxMenu.pick.structureId, indices: idx }])
    },
  }

  const ctxInfo = (() => {
    if (!ctxMenu) return null
    const data = dataRegistry.get(ctxMenu.pick.structureId)
    if (!data) return null
    const a = data.atoms
    const i = ctxMenu.pick.atomIdx
    return `${a.chainIds[i].trim() || '?'} · ${a.resNames[i]} ${a.resSeqs[i]} · ${a.names[i]}`
  })()

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault()
        setDragOver(false)
        if (e.dataTransfer.files?.length) loadFiles(e.dataTransfer.files)
      }}
    >
      {/* 空状态引导 */}
      <EmptyHint />

      {/* 悬停提示 */}
      {hover && hoverPos && (
        <div
          className="pointer-events-none absolute z-30 rounded-md border border-border/70 bg-popover/95 px-2.5 py-1.5 shadow-xl backdrop-blur-sm"
          style={{ left: hoverPos.left, top: hoverPos.top }}
        >
          <div className="text-xs font-semibold text-popover-foreground">{hover.text}</div>
          {hover.sub && <div className="text-[10px] text-muted-foreground">{hover.sub}</div>}
        </div>
      )}

      {/* 右键菜单：原生按钮实现（Radix DropdownMenuItem 必须在 DropdownMenu 根内使用，
          否则右键即抛异常导致整页崩溃） */}
      {ctxMenu && (
        <div
          className="absolute z-40 min-w-44 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={e => e.stopPropagation()}
          role="menu"
        >
          {ctxInfo && (
            <div className="border-b border-border/60 px-2 py-1.5 text-[10px] font-medium text-muted-foreground">
              {ctxInfo}
            </div>
          )}
          <CtxItem onClick={() => { ctxActions.atom(); setCtxMenu(null) }}>选择此原子</CtxItem>
          <CtxItem onClick={() => { ctxActions.residue(); setCtxMenu(null) }}>选择此残基</CtxItem>
          <CtxItem onClick={() => { ctxActions.chain(); setCtxMenu(null) }}>选择此链（链组）</CtxItem>
          <CtxItem onClick={() => { ctxActions.sameResidue(); setCtxMenu(null) }}>选择全部 {ctxInfo?.split('·')[1]?.trim().split(' ')[0] ?? '同类'} 残基</CtxItem>
          <CtxItem onClick={() => { ctxActions.environment(); setCtxMenu(null) }}
            hint="5Å 内完整残基">选择周围环境</CtxItem>
          <div className="-mx-1 my-1 h-px bg-border" />
          <CtxItem onClick={() => { ctxActions.measure(); setCtxMenu(null) }}>测距：从此原子开始…</CtxItem>
          <CtxItem onClick={() => { ctxActions.label(); setCtxMenu(null) }}>标注此原子</CtxItem>
          <CtxItem onClick={() => { ctxActions.focus(); setCtxMenu(null) }}>聚焦此残基</CtxItem>
          <div className="-mx-1 my-1 h-px bg-border" />
          <CtxItem onClick={() => { setTheme(theme === 'dark' ? 'light' : 'dark'); setCtxMenu(null) }}>
            切换浅色/深色界面
          </CtxItem>
        </div>
      )}

      {/* 拖放遮罩 */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 m-3 flex items-center justify-center rounded-xl border-2 border-dashed border-emerald-500/70 bg-emerald-500/10 backdrop-blur-[2px]">
          <div className="rounded-lg bg-background/90 px-4 py-3 text-sm font-medium text-emerald-600 dark:text-emerald-400 shadow-lg">
            释放以加载 PDB / mmCIF 文件
          </div>
        </div>
      )}

      {/* 快捷预设浮层（右下角） */}
      <QuickPresets />

      {/* 动画录制指示器（录制中显示） */}
      <RecordBadge />

      {/* NMR ensemble 播放条（底部居中，仅有 ensemble 数据时显示） */}
      <EnsembleBar />
    </div>
  )
}

function EmptyHint() {
  const structures = useMolStore(s => s.structures)
  const loading = useMolStore(s => s.loading)
  const setUi = useMolStore(s => s.setUi)
  if (structures.length > 0) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 text-center">
      <div className="pointer-events-auto max-w-md rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl backdrop-blur-md">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 shadow-lg shadow-emerald-500/20">
          <svg viewBox="0 0 24 24" className="h-8 w-8 text-white" fill="none" stroke="currentColor" strokeWidth="1.7">
            <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="4.2" />
            <circle cx="12" cy="12" r="8" opacity="0.5" />
            <line x1="12" y1="4" x2="12" y2="8" opacity="0.5" />
            <line x1="12" y1="16" x2="12" y2="20" opacity="0.5" />
            <line x1="4" y1="12" x2="8" y2="12" opacity="0.5" />
            <line x1="16" y1="12" x2="20" y2="12" opacity="0.5" />
          </svg>
        </div>
        <h2 className="text-lg font-semibold tracking-tight">开始探索分子世界</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          输入 PDB 编号从 RCSB 加载结构，或拖放本地 .pdb / .cif 文件到此处。
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => setUi({ loadOpen: true })}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition hover:opacity-90"
          >
            加载结构
          </button>
          <span className="text-xs text-muted-foreground">试试 4HHB（血红蛋白）</span>
        </div>
      </div>
      {loading && null}
    </div>
  )
}

function QuickPresets() {
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const applyPreset = useMolStore(s => s.applyPreset)
  const loading = useMolStore(s => s.loading)
  if (!structures.length || !activeId) return null
  return (
    <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1">
      {loading && (
        <div className="mr-1 flex items-center gap-2 rounded-full border border-border/60 bg-popover/90 px-3 py-1.5 text-xs shadow-lg backdrop-blur">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
          处理中…
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex h-8 items-center gap-1.5 rounded-full border border-border/60 bg-popover/85 px-3 text-xs font-medium shadow-lg backdrop-blur transition hover:bg-popover">
            快速风格
            <span className="text-[10px] text-muted-foreground">1-7</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top">
          <DropdownMenuLabel className="text-xs">应用预设</DropdownMenuLabel>
          {Object.entries(PRESETS).map(([key, p], i) => (
            <DropdownMenuItem key={key} onClick={() => applyPreset(key)} className="gap-2 text-xs">
              <span className="w-4 text-center text-[10px] text-muted-foreground">{i + 1}</span>
              {p.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** 右键菜单项：原生 button 实现（避免 Radix DropdownMenuItem 脱离 DropdownMenu 根导致的崩溃） */
function CtxItem({ children, hint, onClick }: { children: React.ReactNode; hint?: string; onClick: () => void }) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className="flex w-full cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none transition focus:bg-accent focus:outline-none hover:bg-accent"
    >
      <span className="flex-1">{children}</span>
      {hint && <span className="shrink-0 text-[9px] text-muted-foreground/70">{hint}</span>}
    </button>
  )
}
