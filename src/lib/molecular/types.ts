// 共享类型定义
import type { ColorScheme } from './colors'
import type { ChainType } from './parser'

export type RepType = 'cartoon' | 'ballstick' | 'sticks' | 'spacefill' | 'lines' | 'surface'

export const REP_LABELS: Record<RepType, string> = {
  cartoon: 'Cartoon 带状',
  ballstick: '球棍',
  sticks: '棍状',
  spacefill: '空间填充',
  lines: '线框',
  surface: '分子表面',
}

export interface RepConfig {
  id: string
  type: RepType
  /** 选择表达式 */
  selection: string
  colorScheme: ColorScheme
  uniformColor: string
  visible: boolean
  // 参数
  ballScale: number      // spacefill 半径倍率
  stickRadius: number    // 棍半径 (Å)
  cartoonWidth: number   // cartoon 宽度倍率
  probe: number          // surface 探针半径 (Å)
  opacity: number        // surface 不透明度
  /** 表达式求值错误 */
  error?: string
}

export function defaultRep(type: RepType, selection = 'all', colorScheme: ColorScheme = 'element'): RepConfig {
  return {
    id: Math.random().toString(36).slice(2, 10),
    type,
    selection,
    colorScheme,
    uniformColor: '#c9cdd4',
    visible: true,
    ballScale: 1,
    stickRadius: 0.16,
    cartoonWidth: 1,
    probe: 1.2,
    opacity: 1,
  }
}

export interface ChainSummary {
  id: string
  type: ChainType
  residues: number
  atoms: number
  color: string
}

export interface LigandSummary {
  resName: string
  count: number
  chainIds: string
}

export interface StructureEntry {
  id: string
  name: string
  format: 'pdb' | 'cif'
  visible: boolean
  /** 重建版本号（reps / overrides 变化时递增） */
  rev: number
  reps: RepConfig[]
  /** 原子级颜色覆盖 atomIdx → css color */
  colorOverrides: Record<number, string>
  summary: {
    atoms: number; residues: number; chains: number; bonds: number
    hydrogens: number; waters: number; ligandResidues: number
  }
  chains: ChainSummary[]
  ligands: LigandSummary[]
  meta: { title: string; method: string; resolution: number | null; pdbId: string | null }
  hasSS: boolean
  loadMs: number
}

export interface SelectionState {
  structureId: string | null
  indices: number[]
  rev: number
}

export interface NamedSelection {
  name: string
  structureId: string
  expr: string | null
  indices: number[] | null
  count: number
}

export type MeasureMode = 'off' | 'distance' | 'angle' | 'dihedral'

export interface Measurement {
  id: string
  structureId: string
  type: 'distance' | 'angle' | 'dihedral'
  atoms: number[]
  value: number
}

export interface AtomLabel {
  id: string
  structureId: string
  atomIdx: number
  text: string
}

export interface Settings {
  background: string
  fog: boolean
  fogStrength: number
  fov: number
  ortho: boolean
  spin: boolean
  spinSpeed: number
  /** 相机摇摆（ChimeraX rock）：左右正弦摆动 ±25° */
  rock: boolean
  slab: boolean
  slabThickness: number
  hideHydrogens: boolean
  hideWater: boolean
  quality: 'low' | 'medium' | 'high'
  /** 氢键网络 */
  showHBonds: boolean
  hbondMaxDist: number
  hbondIncludeWater: boolean
  hbondSelOnly: boolean
  /** GTAO 环境光遮蔽（提升立体感） */
  ssao: boolean
  ssaoIntensity: number
  ssaoRadius: number
}

export function defaultSettings(): Settings {
  return {
    background: '#101215',
    fog: false,
    fogStrength: 0.5,
    fov: 45,
    ortho: false,
    spin: false,
    spinSpeed: 2,
    rock: false,
    slab: false,
    slabThickness: 18,
    hideHydrogens: false,
    hideWater: false,
    quality: 'high',
    showHBonds: false,
    hbondMaxDist: 3.5,
    hbondIncludeWater: false,
    hbondSelOnly: false,
    ssao: false,
    ssaoIntensity: 1,
    ssaoRadius: 3,
  }
}
