// 共享类型定义
import type { ColorScheme } from './colors'
import type { ChainType } from './parser'

export type RepType = 'cartoon' | 'putty' | 'ballstick' | 'sticks' | 'spacefill' | 'lines' | 'surface'

export const REP_LABELS: Record<RepType, string> = {
  cartoon: 'Cartoon 带状',
  putty: 'Putty B 因子管',
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
  /** putty：管径映射 B 因子上限（Å²，仅 putty 用；0=自动取结构分位） */
  puttyRange: number
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
    puttyRange: 0,
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

/** 刚体变换（叠合累计，会话持久化用） */
export interface RigidTransform {
  quat: [number, number, number, number]
  translation: [number, number, number]
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
  /** 累计刚体变换（superpose 应用后记录，会话恢复时重放） */
  transform?: RigidTransform
  /** 晶体对称伴侣（symmetry 命令/面板触发；radius=0 表示关闭） */
  symmetry?: { radius: number; count: number }
  summary: {
    atoms: number; residues: number; chains: number; bonds: number
    hydrogens: number; waters: number; ligandResidues: number
    /** 独立配体分子数（连通分量，多残基配体计为 1） */
    ligandMolecules: number
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
  /** 灯光：环境光倍率（含环境贴图贡献） */
  lightAmbient: number
  /** 灯光：主光（平行光）倍率 */
  lightKey: number
  /** 灯光：补光倍率 */
  lightFill: number
  /** 高光（镜面反射/环境反射）开关 */
  specular: boolean
  /** 红蓝立体（Anaglyph）渲染 */
  stereo: boolean
  /** 视口右上角 3D 坐标轴指示器（朝向罗盘；点击轴可对齐视角） */
  showAxes: boolean
  /** 状态栏 FPS/性能指示器（引擎每 500ms 上报） */
  showFps: boolean
  /** 出版级轮廓线（Sobel 深度+亮度边缘检测后处理） */
  outline: boolean
  /** 轮廓线强度（0-3：线条不透明度倍率） */
  outlineStrength: number
  /** 轮廓线粗细（1-4 px 采样步长） */
  outlineThickness: number
  /** 序列条展开高度档位（紧凑/标准/加高；随会话持久化） */
  sequenceHeight: 'compact' | 'normal' | 'tall'
  /** 控制台日志区高度档位（紧凑/标准/加高；随会话持久化） */
  consoleHeight: 'compact' | 'normal' | 'tall'
}

export function defaultSettings(): Settings {
  return {
    background: '#ffffff',
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
    lightAmbient: 1,
    lightKey: 1,
    lightFill: 1,
    specular: true,
    stereo: false,
    showAxes: true,
    showFps: false,
    outline: false,
    outlineStrength: 1,
    outlineThickness: 1.5,
    sequenceHeight: 'normal',
    consoleHeight: 'normal',
  }
}
