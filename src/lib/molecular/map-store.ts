// 电子密度图层 UI 状态（引擎持有几何；本 store 镜像信息供面板渲染）
import { create } from 'zustand'

export interface MapInfoMirror {
  name: string
  dims: [number, number, number]
  iso: number
  mode: 'surface' | 'mesh' | 'both'
  color: string
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
