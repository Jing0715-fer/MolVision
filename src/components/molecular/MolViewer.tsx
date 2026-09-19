'use client'

// 3D 视图容器：引擎挂载、悬停提示、右键菜单、拖放加载、快捷键
import { useCallback, useEffect, useRef, useState } from 'react'
import { MolEngine, AXIS_GIZMO, type AtomPick, type HoverInfo } from '@/lib/molecular/engine'
import { dataRegistry, engineRef, useMolStore } from '@/lib/molecular/store'
import { useHoverStore } from '@/lib/molecular/hover-store'
import { loadFiles, fetchPdbId } from '@/lib/molecular/loader'
import { PRESETS } from '@/lib/molecular/store'
import { hasSession, restoreSession, saveSession } from '@/lib/molecular/session'
import { useMapStore } from '@/lib/molecular/map-store'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import { GraduationCap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { EnsembleBar } from '@/components/studio/EnsembleBar'
import { RecordBadge } from '@/components/studio/RecordBadge'
import { ColorLegend } from '@/components/studio/ColorLegend'
import { MapLegend } from '@/components/studio/MapLegend'
import { ViewBar } from '@/components/studio/ViewBar'
import { TourOverlay } from '@/components/studio/TourOverlay'
import { useEnsembleStore } from '@/lib/molecular/ensemble-store'
import { useViewsStore } from '@/lib/molecular/views-store'
import { useTourStore } from '@/lib/molecular/tour-store'
import { useMovieStore, stopMovie } from '@/lib/molecular/movie'
import { MovieBadge } from '@/components/studio/MovieBadge'
import { MovieTimeline } from '@/components/studio/MovieTimeline'

interface HoverState { text: string; x: number; y: number; sub?: string }

export default function MolViewer() {
  const containerRef = useRef<HTMLDivElement>(null)
  const engine = useRef<MolEngine | null>(null)
  const [hover, setHover] = useState<HoverState | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; pick: AtomPick } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const visualRev = useMolStore(s => s.visualRev)
  const timelineOpen = useMovieStore(s => s.timelineOpen)
  const showAxes = useMolStore(s => s.settings.showAxes)
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

    // 选择：Ctrl=单原子，默认=整残基（配体原子扩展到整个配体分子）；Shift=追加，Alt=移除
    let indices: number[]
    if (pick.ctrlKey) {
      indices = [pick.atomIdx]
    } else {
      // 配体分子粒度：多残基配体（多糖/肽类抑制剂/多个小分子共链）作为整体选中，
      // 不波及同链组的其它分子——修复「点配体却选中整条链」
      const molIdx = data.atomMolecule[pick.atomIdx] ?? -1
      const mol = molIdx >= 0 ? data.molecules[molIdx] : null
      indices = []
      if (mol) {
        for (const ri of mol.residues) {
          const rr = data.residues[ri]
          for (let i = rr.start; i < rr.end; i++) indices.push(i)
        }
      } else {
        const r = data.residues[pick.residueIdx]
        for (let i = r.start; i < r.end; i++) indices.push(i)
      }
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
        const molIdx = data.atomMolecule[i] ?? -1
        const mol = molIdx >= 0 ? data.molecules[molIdx] : null
        setHover({
          text: `${a.names[i]} · ${a.resNames[i]} ${a.resSeqs[i]}${a.iCodes[i] || ''}`,
          sub: `链 ${a.chainIds[i].trim() || '?'} · ${a.elements[i]}${a.hetero[i] ? ' · HET' : ''}${a.bfactors[i] ? ` · B=${a.bfactors[i].toFixed(1)}` : ''}${res.ss === 'H' ? ' · 螺旋' : res.ss === 'E' ? ' · 折叠' : ''}${mol ? ` · 分子 ${mol.label}（${mol.atoms} 原子）` : ''}`,
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
    // 会话自动保存（debounced）：结构/reps/设置/命名选择/密度图设置变化时
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    let lastSig = ''
    let lastMapSig = ''
    const scheduleSave = () => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => saveSession(), 900)
    }
    const unsub = useMolStore.subscribe((s, prev) => {
      if (prev.structures === s.structures && prev.settings === s.settings && prev.namedSelections === s.namedSelections) return
      const sig = `${s.structures.length}|${s.structures.map(x => x.rev).join(',')}|${s.structures.map(x => x.transform ? x.transform.quat.join(',') + ':' + x.transform.translation.join(',') : '-').join(';')}|${JSON.stringify(s.settings)}|${s.namedSelections.length}`
      if (sig === lastSig) return
      lastSig = sig
      scheduleSave()
    })
    // 密度图设置变化（σ/模式/颜色/移除）也入档
    const unsubMap = useMapStore.subscribe((s, prev) => {
      if (prev.info === s.info && prev.computing === s.computing) return
      const sig = s.info ? `${s.info.pdbId}|${s.info.kind}|${s.info.iso}|${s.info.isoNeg}|${s.info.mode}|${s.info.color}|${s.info.negColor}|${s.info.opacity}|${s.info.visible}` : 'none'
      if (sig === lastMapSig) return
      lastMapSig = sig
      scheduleSave()
    })
    const onBeforeUnload = () => saveSession()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      unsub()
      unsubMap()
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
      // 演示引导优先接管方向键 / Esc（输入框聚焦时上面已提前 return）
      const ts = useTourStore.getState()
      if (ts.tour) {
        if (e.key === 'ArrowRight' && !e.ctrlKey && !e.metaKey && !e.altKey) { void ts.next(); e.preventDefault(); return }
        if (e.key === 'ArrowLeft' && !e.ctrlKey && !e.metaKey && !e.altKey) { ts.prev(); e.preventDefault(); return }
        if (e.key === 'Escape') { ts.stop(); return }
      }
      // movie 序列播放中 Esc 停止；否则时间轴打开时 Esc 关闭时间轴
      if (e.key === 'Escape' && useMovieStore.getState().playing) {
        stopMovie()
        store.appendLog('out', 'movie 序列播放已停止（Esc）')
        return
      }
      if (e.key === 'Escape' && useMovieStore.getState().timelineOpen) {
        useMovieStore.getState().setTimelineOpen(false)
        return
      }
      // Shift+数字 → 跳转视角书签（数字键无 Shift 仍是风格预设）
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const idx = Number(e.code.slice(5)) - 1
        const vs = useViewsStore.getState()
        const b = vs.bookmarks[idx]
        if (b) {
          vs.restoreBookmark(b.id)
          store.appendLog('out', `已跳转到视角书签「${b.name}」`)
        } else {
          toast.error(`视角书签 ${idx + 1} 不存在`, { description: '按 V 保存当前视角后再跳转' })
        }
        return
      }
      switch (e.key) {
        case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': {
          const keys = ['cartoon', 'ballstick', 'spacefill', 'wireframe', 'surface', 'bindingsite', 'hybrid', 'putty']
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
        case 'h': case 'H': {
          const on = !store.settings.hideHydrogens
          store.updateSettings({ hideHydrogens: on })
          toast.info(on ? '氢原子已隐藏' : '氢原子已显示', { description: '快捷键 H · 场景面板可再切换' })
          break
        }
        case 'w': case 'W': {
          const on = !store.settings.hideWater
          store.updateSettings({ hideWater: on })
          toast.info(on ? '水分子已隐藏' : '水分子已显示', { description: '快捷键 W · 场景面板可再切换' })
          break
        }
        case 'b': case 'B': {
          const on = !store.settings.showHBonds
          store.updateSettings({ showHBonds: on })
          if (!on) {
            toast.info('氢键网络已关闭', { description: '快捷键 B · 场景面板可再开启' })
          } else if (store.settings.hbondSelOnly && store.selection.indices.length === 0) {
            toast.info('氢键网络已开启（仅选择集）', {
              description: '点击残基/链建立选择后显示其氢键（带端点球）——全局网络对大结构过于密集；场景面板「氢键仅选择集」可切换全局模式',
            })
          } else {
            toast.info('氢键网络已开启', {
              description: store.settings.hbondSelOnly
                ? '当前选择集范围内显示虚线与端点球 · 快捷键 B 关闭'
                : '全结构网络（大结构较密）· 快捷键 B 关闭',
            })
          }
          break
        }
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
        case 'v': case 'V': {
          // 保存视角书签（排除 Ctrl/Cmd+V 粘贴与 Alt 组合）
          if (e.ctrlKey || e.metaKey || e.altKey) break
          const bm = useViewsStore.getState().addBookmark()
          if (bm) {
            toast.success(`已保存视角书签「${bm.name}」`, { description: 'Shift+数字键快速跳转 · 视口右缘可管理' })
          } else if (useViewsStore.getState().bookmarks.length >= 12) {
            toast.error('书签已达上限（12）', { description: '在视口右缘删除不再需要的书签' })
          }
          break
        }
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
    // 整个配体分子（连通分量：多残基配体/共链多个小分子时只选所属分子）
    molecule: () => {
      if (!ctxMenu) return
      const data = dataRegistry.get(ctxMenu.pick.structureId)
      if (!data) return
      const molIdx = data.atomMolecule[ctxMenu.pick.atomIdx] ?? -1
      const mol = molIdx >= 0 ? data.molecules[molIdx] : null
      if (!mol) return
      const idx: number[] = []
      for (const ri of mol.residues) {
        const r = data.residues[ri]
        for (let i = r.start; i < r.end; i++) idx.push(i)
      }
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

  // 右键目标是否为配体分子（显示「选择此分子」项）
  const ctxMolInfo = (() => {
    if (!ctxMenu) return null
    const data = dataRegistry.get(ctxMenu.pick.structureId)
    if (!data) return null
    const molIdx = data.atomMolecule[ctxMenu.pick.atomIdx] ?? -1
    return molIdx >= 0 ? data.molecules[molIdx] : null
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
          {ctxMolInfo && (
            <CtxItem onClick={() => { ctxActions.molecule(); setCtxMenu(null) }}
              hint={`${ctxMolInfo.atoms} 原子`}>选择此分子（{ctxMolInfo.label}）</CtxItem>
          )}
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

      {/* 坐标轴指示器点击层（与引擎 AXIS_GIZMO 视口对齐；hover 轴端发光反馈，点击平滑对齐视角） */}
      {showAxes && (
        <div
          className="absolute right-3 top-3 z-10 cursor-pointer rounded-full transition hover:bg-foreground/[0.04] active:bg-foreground/[0.08]"
          style={{ width: AXIS_GIZMO.size, height: AXIS_GIZMO.size }}
          title="坐标轴指示器（点击轴端对齐视角；场景面板可关闭）"
          onMouseMove={e => {
            engine.current?.setGizmoHover(engine.current?.gizmoAxisFromPoint(e.clientX, e.clientY) ?? null)
          }}
          onMouseLeave={() => {
            engine.current?.setGizmoHover(null)
          }}
          onClick={e => {
            const eng = engine.current
            const dir = eng?.gizmoAxisFromPoint(e.clientX, e.clientY)
            if (!eng || !dir) return
            eng.setGizmoHover(null)
            eng.orientAlongAxis(dir)
            const name = Math.abs(dir.x) > 0.5 ? (dir.x > 0 ? '+X' : '-X')
              : Math.abs(dir.y) > 0.5 ? (dir.y > 0 ? '+Y' : '-Y')
              : (dir.z > 0 ? '+Z' : '-Z')
            useMolStore.getState().appendLog('out', `视角已对齐 ${name} 轴（保持目标点与距离）`)
          }}
        />
      )}

      {/* 快捷预设浮层（右下角） */}
      <QuickPresets />

      {/* 引导演示卡片（顶部居中，演示激活时显示） */}
      <TourOverlay />

      {/* movie 序列播放指示器（顶部居中，播放时显示；演示中自动下移） */}
      <MovieBadge />

      {/* movie 时间轴编排面板（底部居中，工具栏 Film 按钮 / movie edit 开关） */}
      <MovieTimeline />

      {/* 视角书签浮层（右缘竖排，保存/跳转相机视角） */}
      <ViewBar />

      {/* 左下角图例列：密度图 σ 控制（交互）+ 颜色标尺（putty/B 因子/SASA 着色时显示）；时间轴打开时上移让位 */}
      <div className={cn(
        'pointer-events-none absolute left-3 z-10 flex flex-col items-start gap-2 transition-all duration-300',
        timelineOpen ? 'bottom-[196px]' : 'bottom-3',
      )}>
        <MapLegend />
        <ColorLegend />
      </div>

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
  const startTour = useTourStore(s => s.start)
  if (structures.length > 0) return null
  const QUICK: { id: string; label: string; hint: string }[] = [
    { id: '4HHB', label: '4HHB', hint: '血红蛋白' },
    { id: '1BNA', label: '1BNA', hint: 'B-DNA' },
    { id: '6LU7', label: '6LU7', hint: 'Mpro 药靶' },
    { id: '1D3Z', label: '1D3Z', hint: 'NMR 系综' },
  ]
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 overflow-y-auto py-6 text-center">
      <div className="pointer-events-auto my-auto max-w-md rounded-2xl border border-border/60 bg-card/70 p-8 shadow-2xl backdrop-blur-md">
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

        {/* 一键示例 */}
        <div className="mt-4 flex flex-wrap items-stretch justify-center gap-1.5">
          {QUICK.map(q => (
            <button
              key={q.id}
              onClick={() => void fetchPdbId(q.id)}
              className="group flex min-w-[4.6rem] flex-col items-center rounded-lg border border-border/60 bg-background/60 px-2.5 py-1.5 transition hover:border-emerald-500/50 hover:bg-emerald-500/10"
              title={`加载 ${q.hint}`}
            >
              <span className="font-mono text-[11px] font-semibold tracking-wide group-hover:text-emerald-600 dark:group-hover:text-emerald-400">{q.label}</span>
              <span className="text-[9px] text-muted-foreground">{q.hint}</span>
            </button>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => setUi({ loadOpen: true })}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition hover:opacity-90"
          >
            加载结构
          </button>
          <button
            onClick={() => void startTour('quickstart')}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-violet-500/40 bg-violet-500/10 px-3.5 text-sm font-medium text-violet-600 shadow-sm transition hover:bg-violet-500/20 dark:text-violet-400"
          >
            <GraduationCap className="h-4 w-4" />
            跟随演示上手
          </button>
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground/70">
          演示场景会自动加载结构并逐步讲解操作 —— 也可从工具栏「演示」菜单选择 5 个主题场景
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 border-t border-border/50 pt-3 text-[10px] text-muted-foreground/80">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border/70 bg-muted/70 px-1 font-mono text-[9px]">Ctrl</kbd>+<kbd className="rounded border border-border/70 bg-muted/70 px-1 font-mono text-[9px]">K</kbd> 命令面板
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border/70 bg-muted/70 px-1 font-mono text-[9px]">1</kbd>–<kbd className="rounded border border-border/70 bg-muted/70 px-1 font-mono text-[9px]">8</kbd> 表示法预设
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border/70 bg-muted/70 px-1 font-mono text-[9px]">`</kbd> 命令行
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border/70 bg-muted/70 px-1 font-mono text-[9px]">V</kbd> 存视角
          </span>
          <span className="flex items-center gap-1">右键 · 原子级操作</span>
        </div>
      </div>
    </div>
  )
}

function QuickPresets() {
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const applyPreset = useMolStore(s => s.applyPreset)
  const loading = useMolStore(s => s.loading)
  // movie 时间轴打开时上移让位（底部右角与时间轴面板重叠）
  const timelineOpen = useMovieStore(s => s.timelineOpen)
  if (!structures.length || !activeId) return null
  return (
    <div className={cn('absolute right-3 z-10 flex items-center gap-1 transition-all duration-300', timelineOpen ? 'bottom-[196px]' : 'bottom-3')}>
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
            <span className="text-[10px] text-muted-foreground">1-8</span>
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
