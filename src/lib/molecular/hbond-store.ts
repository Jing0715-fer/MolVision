// 氢键统计轻量 store（独立于主 store，避免 visualRev 循环）
import { create } from 'zustand'

interface HBondStore {
  count: number
  waterCount: number
  visible: boolean
  /** 大结构异步检测中（Web Worker） */
  computing: boolean
  setStats: (count: number, waterCount: number, visible: boolean) => void
  setComputing: (computing: boolean) => void
}

export const useHBondStore = create<HBondStore>()(set => ({
  count: 0,
  waterCount: 0,
  visible: false,
  computing: false,
  setStats: (count, waterCount, visible) => set({ count, waterCount, visible }),
  setComputing: computing => set({ computing }),
}))
