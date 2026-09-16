// 接触分析轻量 store（独立于主 store，避免 visualRev 循环）
import { create } from 'zustand'
import type { ContactPair } from './contacts'

interface ContactStore {
  /** A/B 组选择表达式 */
  aExpr: string
  bExpr: string
  /** 接触距离上限（Å） */
  cutoff: number
  /** 3D 接触连线可见 */
  visible: boolean
  /** 结果归属结构 */
  structureId: string | null
  pairs: ContactPair[]
  residuesA: number[]
  residuesB: number[]
  atomsA: number
  atomsB: number
  /** 表达式求值错误 */
  errors: { a?: string; b?: string }
  /** 是否已按结构填充默认表达式（切换结构后重新默认） */
  defaulted: boolean
  setExpr: (side: 'a' | 'b', expr: string) => void
  setCutoff: (cutoff: number) => void
  setVisible: (visible: boolean) => void
  setResult: (r: {
    structureId: string | null
    pairs: ContactPair[]
    residuesA: number[]
    residuesB: number[]
    atomsA: number
    atomsB: number
    errors?: { a?: string; b?: string }
  }) => void
  clear: () => void
}

export const useContactStore = create<ContactStore>()(set => ({
  aExpr: '',
  bExpr: '',
  cutoff: 4.5,
  visible: true,
  structureId: null,
  pairs: [],
  residuesA: [],
  residuesB: [],
  atomsA: 0,
  atomsB: 0,
  errors: {},
  defaulted: false,
  setExpr: (side, expr) => set(s => ({
    [side === 'a' ? 'aExpr' : 'bExpr']: expr,
    defaulted: true,
    errors: side === 'a' ? { ...s.errors, a: undefined } : { ...s.errors, b: undefined },
  }) as Partial<ContactStore>),
  setCutoff: cutoff => set({ cutoff }),
  setVisible: visible => set({ visible }),
  setResult: r => set({
    structureId: r.structureId,
    pairs: r.pairs,
    residuesA: r.residuesA,
    residuesB: r.residuesB,
    atomsA: r.atomsA,
    atomsB: r.atomsB,
    errors: r.errors ?? {},
  }),
  clear: () => set({
    structureId: null, pairs: [], residuesA: [], residuesB: [],
    atomsA: 0, atomsB: 0, errors: {},
  }),
}))
