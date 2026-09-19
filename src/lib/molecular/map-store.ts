// 电子密度图层 UI 状态（引擎持有几何；本 store 镜像信息供面板渲染）
import { create } from 'zustand'
import type { MapKind } from './sffourier'

export interface MapInfoMirror {
  name: string
  dims: [number, number, number]
  iso: number
  /** 差图负峰独立 σ 级别（非差图 = iso） */
  isoNeg: number
  mode: 'surface' | 'mesh' | 'both'
  /** 差图模式（Fo−Fc ±σ 正绿/负红双等值面） */
  difference: boolean
  color: string
  /** 差图负峰颜色 */
  negColor: string
  opacity: number
  visible: boolean
  triangles: number
  truncated: boolean
  mean: number
  rms: number
  min: number
  max: number
  voxel: [number, number, number]
  /** 来源：'sf'（结构因子计算）或 'file'（CCP4/MRC 上传） */
  source: 'sf' | 'file'
  /** SF 来源的 PDB 编号（会话存档/恢复用；文件来源缺省） */
  pdbId?: string
  /** SF 来源的图类型（会话存档/恢复用） */
  kind?: MapKind
  /** 计算耗时（ms） */
  ms: number
}

interface MapState {
  info: MapInfoMirror | null
  computing: boolean
  computeMsg: string
  setInfo: (info: MapInfoMirror | null) => void
  setComputing: (computing: boolean, msg?: string) => void
}

export const useMapStore = create<MapState>()(set => ({
  info: null,
  computing: false,
  computeMsg: '',
  setInfo: info => set({ info, computing: false, computeMsg: '' }),
  setComputing: (computing, msg = '') => set({ computing, computeMsg: msg }),
}))
