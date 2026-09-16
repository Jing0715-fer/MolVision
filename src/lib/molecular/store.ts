// Zustand 全局状态：结构、表示法、选择、测量、标签、设置、UI
import { create } from 'zustand'
import { chainColor, computeAtomColors, parseCssColor, type ColorScheme } from './colors'
import { parseStructure, type StructureData } from './parser'
import { evaluateSelection, maskToIndices } from './selection'
import { textRegistry } from './text-registry'
import { computeDSSP } from './dssp'
import {
  defaultRep, defaultSettings, type AtomLabel, type ChainSummary, type LigandSummary,
  type MeasureMode, type Measurement, type NamedSelection, type RepConfig, type RepType,
  type SelectionState, type Settings, type StructureEntry,
} from './types'

/** 重型结构数据（typed arrays）放在非响应式注册表中 */
export const dataRegistry = new Map<string, StructureData>()

/** 引擎引用（非响应式） */
export const engineRef: { current: import('./engine').MolEngine | null } = { current: null }

let uid = 0
const nextId = () => `s${Date.now().toString(36)}${(uid++).toString(36)}`

export interface MolState {
  structures: StructureEntry[]
  activeId: string | null
  selection: SelectionState
  namedSelections: NamedSelection[]
  measureMode: MeasureMode
  measurePicks: { structureId: string; atoms: number[] } | null
  measurements: Measurement[]
  labels: AtomLabel[]
  settings: Settings
  /** 视觉同步版本号 */
  visualRev: number
  loading: boolean
  loadingMsg: string
  ui: {
    panel: 'structures' | 'reps' | 'colors' | 'selection' | 'measure' | 'analysis' | 'scene' | 'info'
    panelOpen: boolean
    sequenceOpen: boolean
    consoleOpen: boolean
    helpOpen: boolean
    loadOpen: boolean
  }
  consoleLog: { type: 'in' | 'out' | 'err'; text: string; time: string }[]
  /** 本次页面生命周期内是否加载过结构（防止恢复失败后被空自动保存抹掉存档） */
  everHadStructures: boolean

  // ---------- actions ----------
  addStructure: (data: StructureData, name: string, loadMs: number) => string
  removeStructure: (id: string) => void
  setStructureVisible: (id: string, visible: boolean) => void
  setActive: (id: string) => void
  addRep: (structureId: string, rep: Partial<RepConfig> & { type: RepType }) => void
  updateRep: (structureId: string, repId: string, patch: Partial<RepConfig>) => void
  removeRep: (structureId: string, repId: string) => void
  applyPreset: (preset: string) => void
  applyColor: (target: ColorScheme | string) => void
  resetColors: (scope: 'selection' | 'structure') => void
  setSelection: (structureId: string | null, indices: number[], mode?: 'replace' | 'add' | 'remove') => void
  selectFromExpr: (expr: string) => { count: number; error?: string }
  invertSelection: () => void
  saveNamedSelection: (name: string) => void
  deleteNamedSelection: (name: string) => void
  setMeasureMode: (mode: MeasureMode) => void
  measurePick: (structureId: string, atomIdx: number) => void
  clearMeasurePicks: () => void
  removeMeasurement: (id: string) => void
  clearMeasurements: () => void
  addLabelsForSelection: () => void
  removeLabel: (id: string) => void
  clearLabels: (structureId?: string) => void
  updateSettings: (patch: Partial<Settings>) => void
  /** 用 DSSP 重算指定结构的二级结构（无记录结构或强制重算） */
  recomputeSS: (structureId: string) => { helix: number; strand: number; loop: number; error?: string }
  setUi: (patch: Partial<MolState['ui']>) => void
  appendLog: (type: 'in' | 'out' | 'err', text: string) => void
  bumpVisual: () => void
}

function summarize(data: StructureData): { entry: Omit<StructureEntry, 'id' | 'reps' | 'colorOverrides' | 'rev' | 'visible'>; chains: ChainSummary[]; ligands: LigandSummary[] } {
  const chains: ChainSummary[] = data.chains.map((c, i) => ({
    id: c.id,
    type: c.type,
    residues: c.residueIdx.length,
    atoms: c.end - c.start,
    color: chainColor(i).getStyle(),
  }))
  const ligMap = new Map<string, { count: number; chains: Set<string> }>()
  let hydrogens = 0, waters = 0
  for (let i = 0; i < data.atoms.count; i++) {
    const e = data.atoms.elements[i]
    if (e === 'H' || e === 'D') hydrogens++
  }
  for (const r of data.residues) {
    if (r.water) waters++
    else if (r.hetero && !r.polymer) {
      const k = r.resName.toUpperCase()
      const rec = ligMap.get(k) ?? { count: 0, chains: new Set<string>() }
      rec.count++
      rec.chains.add(r.chainId)
      ligMap.set(k, rec)
    }
  }
  const ligands: LigandSummary[] = [...ligMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .map(([resName, v]) => ({ resName, count: v.count, chainIds: [...v.chains].join(',') }))
  return {
    entry: {
      name: data.name,
      format: data.format,
      summary: {
        atoms: data.atoms.count,
        residues: data.residues.length,
        chains: data.chains.length,
        bonds: data.bonds.count,
        hydrogens,
        waters,
        ligandResidues: ligands.reduce((s, l) => s + l.count, 0),
      },
      chains,
      ligands,
      meta: data.meta,
      hasSS: data.ssFromRecords,
      loadMs: 0,
    },
    chains,
    ligands,
  }
}

function defaultRepsFor(data: StructureData): RepConfig[] {
  const hasPolymer = data.chains.some(c => c.type === 'protein' || c.type === 'nucleic')
  if (hasPolymer) {
    return [
      { ...defaultRep('cartoon', 'polymer', 'chain') },
      { ...defaultRep('ballstick', 'ligand', 'element') },
      { ...defaultRep('lines', 'water', 'element') },
    ]
  }
  return [{ ...defaultRep('ballstick', 'all', 'element') }]
}

export const PRESETS: Record<string, { label: string; reps: () => RepConfig[] }> = {
  cartoon: {
    label: 'Cartoon 经典',
    reps: () => [
      { ...defaultRep('cartoon', 'polymer', 'chain') },
      { ...defaultRep('ballstick', 'ligand', 'element') },
      { ...defaultRep('lines', 'water', 'element') },
    ],
  },
  ballstick: {
    label: '球棍模型',
    reps: () => [{ ...defaultRep('ballstick', 'all', 'element') }],
  },
  spacefill: {
    label: '空间填充',
    reps: () => [{ ...defaultRep('spacefill', 'all', 'element') }],
  },
  wireframe: {
    label: '线框',
    reps: () => [{ ...defaultRep('lines', 'all', 'element') }],
  },
  surface: {
    label: '分子表面',
    reps: () => [{ ...defaultRep('surface', 'all', 'chain') }],
  },
  bindingsite: {
    label: '结合口袋',
    reps: () => [
      { ...defaultRep('cartoon', 'polymer', 'chain') },
      { ...defaultRep('ballstick', 'within 4.5 of (ligand)', 'element') },
    ],
  },
  hybrid: {
    label: '混合风格',
    reps: () => [
      { ...defaultRep('cartoon', 'polymer', 'ss') },
      { ...defaultRep('sticks', 'backbone', 'residue') },
    ],
  },
}

export const useMolStore = create<MolState>()((set, get) => ({
  structures: [],
  activeId: null,
  selection: { structureId: null, indices: [], rev: 0 },
  namedSelections: [],
  measureMode: 'off',
  measurePicks: null,
  measurements: [],
  labels: [],
  settings: defaultSettings(),
  visualRev: 0,
  loading: false,
  loadingMsg: '',
  ui: {
    panel: 'structures',
    panelOpen: true,
    sequenceOpen: true,
    consoleOpen: false,
    helpOpen: false,
    loadOpen: false,
  },
  consoleLog: [{ type: 'out', text: 'MolVision 命令行就绪。输入 help 查看命令列表。', time: '' }],
  everHadStructures: false,

  addStructure: (data, name, loadMs) => {
    const id = nextId()
    data.id = id
    data.name = name
    dataRegistry.set(id, data)
    const { entry } = summarize(data)
    const newEntry: StructureEntry = {
      id,
      name,
      format: entry.format,
      visible: true,
      rev: 1,
      reps: defaultRepsFor(data),
      colorOverrides: {},
      summary: entry.summary,
      chains: entry.chains,
      ligands: entry.ligands,
      meta: entry.meta,
      hasSS: entry.hasSS,
      loadMs,
    }
    set(s => ({
      structures: [...s.structures, newEntry],
      activeId: id,
      everHadStructures: true,
      visualRev: s.visualRev + 1,
      selection: { structureId: null, indices: [], rev: s.selection.rev + 1 },
    }))
    return id
  },

  removeStructure: (id) => {
    dataRegistry.delete(id)
    textRegistry.delete(id)
    set(s => {
      const structures = s.structures.filter(x => x.id !== id)
      const activeId = s.activeId === id ? (structures[0]?.id ?? null) : s.activeId
      return {
        structures,
        activeId,
        labels: s.labels.filter(l => l.structureId !== id),
        measurements: s.measurements.filter(m => m.structureId !== id),
        namedSelections: s.namedSelections.filter(n => n.structureId !== id),
        selection: s.selection.structureId === id
          ? { structureId: null, indices: [], rev: s.selection.rev + 1 }
          : s.selection,
        visualRev: s.visualRev + 1,
      }
    })
  },

  setStructureVisible: (id, visible) => {
    set(s => ({
      structures: s.structures.map(x => x.id === id ? { ...x, visible } : x),
      visualRev: s.visualRev + 1,
    }))
  },

  setActive: (id) => set(s => ({ activeId: id })),

  addRep: (structureId, rep) => {
    set(s => ({
      structures: s.structures.map(x => x.id === structureId
        ? { ...x, reps: [...x.reps, { ...defaultRep(rep.type), colorScheme: 'element', ...rep, id: Math.random().toString(36).slice(2, 10) }], rev: x.rev + 1 }
        : x),
      visualRev: s.visualRev + 1,
    }))
  },

  updateRep: (structureId, repId, patch) => {
    set(s => ({
      structures: s.structures.map(x => x.id === structureId
        ? { ...x, reps: x.reps.map(r => r.id === repId ? { ...r, ...patch } : r), rev: x.rev + 1 }
        : x),
      visualRev: s.visualRev + 1,
    }))
  },

  removeRep: (structureId, repId) => {
    set(s => ({
      structures: s.structures.map(x => x.id === structureId
        ? { ...x, reps: x.reps.filter(r => r.id !== repId), rev: x.rev + 1 }
        : x),
      visualRev: s.visualRev + 1,
    }))
  },

  applyPreset: (preset) => {
    const s = get()
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!entry) return
    const p = PRESETS[preset]
    if (!p) return
    const data = dataRegistry.get(entry.id)
    set({
      structures: s.structures.map(x => x.id === entry.id ? { ...x, reps: p.reps(), rev: x.rev + 1 } : x),
      visualRev: s.visualRev + 1,
    })
    // 预设同时清理颜色覆盖
    void data
  },

  applyColor: (target) => {
    const s = get()
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!entry) return
    const data = dataRegistry.get(entry.id)
    if (!data) return
    const scope = s.selection.structureId === entry.id && s.selection.indices.length
      ? new Set(s.selection.indices)
      : null // null = 全结构
    // 目标可能是 scheme 名或 css 颜色
    const schemes: ColorScheme[] = ['element', 'chain', 'spectrum', 'residue', 'ss', 'bfactor', 'sasa', 'uniform']
    const isScheme = schemes.includes(target as ColorScheme)
    let colors: Float32Array
    if (isScheme) {
      // SASA 需先有逐原子数据：小结构同步补算后直接烘焙；大结构触发 worker，本轮返回（命令行提示稍后再执行）
      if (target === 'sasa' && !data.sasa) {
        const r = engineRef.current?.requestSasa(entry.id)
        if (!r?.done || !data.sasa) return
      }
      colors = computeAtomColors(data, target as ColorScheme, { uniformColor: '#c9cdd4' })
    } else {
      const hex = parseCssColor(String(target))
      if (!hex) return
      colors = computeAtomColors(data, 'uniform', { uniformColor: hex })
    }
    const overrides: Record<number, string> = { ...entry.colorOverrides }
    const c = [0, 0, 0]
    const apply = (i: number) => {
      c[0] = Math.round(colors[i * 3] * 255)
      c[1] = Math.round(colors[i * 3 + 1] * 255)
      c[2] = Math.round(colors[i * 3 + 2] * 255)
      // sRGB hex（颜色数组为线性，需转回 sRGB 近似：用 gamma）
      const lin = (v: number) => {
        const x = Math.min(1, Math.max(0, v))
        return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
      }
      const r = Math.round(lin(c[0] / 255) * 255)
      const g = Math.round(lin(c[1] / 255) * 255)
      const b = Math.round(lin(c[2] / 255) * 255)
      overrides[i] = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
    }
    if (scope) scope.forEach(apply)
    else for (let i = 0; i < data.atoms.count; i++) apply(i)
    set({
      structures: s.structures.map(x => x.id === entry.id ? { ...x, colorOverrides: overrides, rev: x.rev + 1 } : x),
      visualRev: s.visualRev + 1,
    })
  },

  resetColors: (scope) => {
    const s = get()
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!entry) return
    let overrides = entry.colorOverrides
    if (scope === 'structure') {
      overrides = {}
    } else if (s.selection.structureId === entry.id && s.selection.indices.length) {
      const sel = new Set(s.selection.indices)
      overrides = Object.fromEntries(Object.entries(entry.colorOverrides).filter(([k]) => !sel.has(Number(k))))
    }
    set({
      structures: s.structures.map(x => x.id === entry.id ? { ...x, colorOverrides: overrides, rev: x.rev + 1 } : x),
      visualRev: s.visualRev + 1,
    })
  },

  setSelection: (structureId, indices, mode = 'replace') => {
    set(s => {
      let next: number[]
      if (mode === 'replace' || s.selection.structureId !== structureId) {
        next = [...new Set(indices)].sort((a, b) => a - b)
      } else if (mode === 'add') {
        next = [...new Set([...s.selection.indices, ...indices])].sort((a, b) => a - b)
      } else {
        const rm = new Set(indices)
        next = s.selection.indices.filter(i => !rm.has(i))
      }
      return {
        selection: { structureId: structureId && next.length ? structureId : (structureId ?? null), indices: next, rev: s.selection.rev + 1 },
        visualRev: s.visualRev + 1,
      }
    })
  },

  selectFromExpr: (expr) => {
    const s = get()
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!entry) return { count: 0, error: '没有加载结构' }
    const data = dataRegistry.get(entry.id)
    if (!data) return { count: 0, error: '结构数据缺失' }
    const named = buildNamedMasks(entry.id, data)
    const res = evaluateSelection(expr, { structure: data, named })
    if (res.error) return { count: 0, error: res.error }
    get().setSelection(entry.id, maskToIndices(res.mask))
    return { count: res.count }
  },

  invertSelection: () => {
    const s = get()
    if (!s.selection.structureId) return
    const data = dataRegistry.get(s.selection.structureId)
    if (!data) return
    const cur = new Set(s.selection.indices)
    const inv: number[] = []
    for (let i = 0; i < data.atoms.count; i++) if (!cur.has(i)) inv.push(i)
    set(s => ({ selection: { structureId: s.selection.structureId, indices: inv, rev: s.selection.rev + 1 }, visualRev: s.visualRev + 1 }))
  },

  saveNamedSelection: (name) => {
    const s = get()
    if (!s.selection.structureId || !s.selection.indices.length) return
    set({
      namedSelections: [...s.namedSelections.filter(n => n.name !== name), {
        name,
        structureId: s.selection.structureId,
        expr: null,
        indices: s.selection.indices,
        count: s.selection.indices.length,
      }],
    })
  },

  deleteNamedSelection: (name) => {
    set(s => ({ namedSelections: s.namedSelections.filter(n => n.name !== name) }))
  },

  setMeasureMode: (mode) => set(s => ({ measureMode: mode, measurePicks: null, visualRev: s.visualRev + 1 })),

  measurePick: (structureId, atomIdx) => {
    const s = get()
    const mode = s.measureMode
    if (mode === 'off') return
    const data = dataRegistry.get(structureId)
    if (!data) return
    let picks = s.measurePicks
    if (!picks || picks.structureId !== structureId) picks = { structureId, atoms: [] }
    const atoms = [...picks.atoms, atomIdx]
    const need = mode === 'distance' ? 2 : mode === 'angle' ? 3 : 4
    if (atoms.length < need) {
      set(s => ({ measurePicks: { structureId, atoms }, visualRev: s.visualRev + 1 }))
      return
    }
    const sel = atoms.slice(0, need)
    const pos = (i: number) => [
      data.atoms.positions[i * 3], data.atoms.positions[i * 3 + 1], data.atoms.positions[i * 3 + 2],
    ]
    let value = 0
    if (mode === 'distance') {
      const a = pos(sel[0]), b = pos(sel[1])
      value = Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
    } else if (mode === 'angle') {
      const a = pos(sel[0]), b = pos(sel[1]), c = pos(sel[2])
      const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
      const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]
      const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]
      const n1 = Math.hypot(...v1), n2 = Math.hypot(...v2)
      value = Math.acos(Math.max(-1, Math.min(1, dot / (n1 * n2)))) * 180 / Math.PI
    } else {
      // 二面角
      const p = sel.map(i => pos(i))
      const b1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]]
      const b2 = [p[2][0] - p[1][0], p[2][1] - p[1][1], p[2][2] - p[1][2]]
      const b3 = [p[3][0] - p[2][0], p[3][1] - p[2][1], p[3][2] - p[2][2]]
      const n1 = [b1[1] * b2[2] - b1[2] * b2[1], b1[2] * b2[0] - b1[0] * b2[2], b1[0] * b2[1] - b1[1] * b2[0]]
      const n2 = [b2[1] * b3[2] - b2[2] * b3[1], b2[2] * b3[0] - b2[0] * b3[2], b2[0] * b3[1] - b2[1] * b3[0]]
      const m = [b2[1] * n1[2] - b2[2] * n1[1], b2[2] * n1[0] - b2[0] * n1[2], b2[0] * n1[1] - b2[1] * n1[0]]
      const x = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
      const y = m[0] * n2[0] + m[1] * n2[1] + m[2] * n2[2]
      value = Math.atan2(y, x) * 180 / Math.PI
    }
    set(s => ({
      measurements: [...s.measurements, {
        id: Math.random().toString(36).slice(2, 10),
        structureId,
        type: mode,
        atoms: sel,
        value,
      }],
      measurePicks: null,
      visualRev: s.visualRev + 1,
    }))
  },

  clearMeasurePicks: () => set(s => ({ measurePicks: null, visualRev: s.visualRev + 1 })),

  removeMeasurement: (id) => {
    set(s => ({ measurements: s.measurements.filter(m => m.id !== id), visualRev: s.visualRev + 1 }))
  },

  clearMeasurements: () => set(s => ({ measurements: [], measurePicks: null, visualRev: s.visualRev + 1 })),

  addLabelsForSelection: () => {
    const s = get()
    if (!s.selection.structureId || !s.selection.indices.length) return
    const structureId = s.selection.structureId
    const data = dataRegistry.get(structureId)
    if (!data) return
    const exists = new Set(s.labels.filter(l => l.structureId === structureId).map(l => l.atomIdx))
    const newLabels: AtomLabel[] = []
    for (const i of s.selection.indices) {
      if (exists.has(i)) continue
      newLabels.push({
        id: Math.random().toString(36).slice(2, 10),
        structureId,
        atomIdx: i,
        text: labelForAtom(data, i),
      })
    }
    set(s => ({ labels: [...s.labels, ...newLabels], visualRev: s.visualRev + 1 }))
  },

  removeLabel: (id) => set(s => ({ labels: s.labels.filter(l => l.id !== id), visualRev: s.visualRev + 1 })),

  clearLabels: (structureId) => {
    set(s => ({
      labels: structureId ? s.labels.filter(l => l.structureId !== structureId) : [],
      visualRev: s.visualRev + 1,
    }))
  },

  updateSettings: (patch) => {
    // bump visualRev：引擎仅在 visualRev 变化时重新 sync（applySettings），
    // 否则背景/雾/FOV/正交/旋转/显隐水氢等设置改动不会传导到渲染器
    set(s => ({ settings: { ...s.settings, ...patch }, visualRev: s.visualRev + 1 }))
  },

  recomputeSS: (structureId) => {
    const data = dataRegistry.get(structureId)
    const entry = get().structures.find(x => x.id === structureId)
    if (!data || !entry) return { helix: 0, strand: 0, loop: 0, error: '结构不存在' }
    let dssp: import('./dssp').DSSPResult
    try {
      dssp = computeDSSP(data)
    } catch (e) {
      return { helix: 0, strand: 0, loop: 0, error: e instanceof Error ? e.message : 'DSSP 计算失败' }
    }
    for (let ri = 0; ri < data.residues.length; ri++) {
      data.residues[ri].ss = dssp.ss[ri] === 1 ? 'H' : dssp.ss[ri] === 2 ? 'E' : 'L'
    }
    // bump entry.rev → rep hash 变化 → cartoon 重建
    set(s => ({
      structures: s.structures.map(x => x.id === structureId ? { ...x, hasSS: true, rev: x.rev + 1 } : x),
      visualRev: s.visualRev + 1,
    }))
    return { helix: dssp.helixResidues, strand: dssp.strandResidues, loop: dssp.loopResidues }
  },

  setUi: (patch) => set(s => ({ ui: { ...s.ui, ...patch } })),

  appendLog: (type, text) => {
    const now = new Date()
    const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`
    set(s => ({ consoleLog: [...s.consoleLog.slice(-200), { type, text, time }] }))
  },

  bumpVisual: () => set(s => ({ visualRev: s.visualRev + 1 })),
}))

function labelForAtom(data: StructureData, i: number): string {
  const a = data.atoms
  return `${a.chainIds[i].trim() || '?'} ${a.resNames[i]}${a.resSeqs[i]}:${a.names[i]}`
}

/** 构建命名选择掩码表（供表达式求值） */
export function buildNamedMasks(structureId: string, data: StructureData): Map<string, Uint8Array> {
  const store = useMolStore.getState()
  const out = new Map<string, Uint8Array>()
  for (const ns of store.namedSelections) {
    if (ns.structureId !== structureId) continue
    if (ns.indices) {
      const m = new Uint8Array(data.atoms.count)
      for (const i of ns.indices) m[i] = 1
      out.set(ns.name, m)
    } else if (ns.expr) {
      const res = evaluateSelection(ns.expr, { structure: data, named: out })
      if (!res.error) out.set(ns.name, res.mask)
    }
  }
  return out
}

/** 解析并注册结构（供加载器调用） */
export function registerStructure(text: string, name: string, format: 'pdb' | 'cif', id = ''): StructureData {
  return parseStructure(text, name, format, id)
}
