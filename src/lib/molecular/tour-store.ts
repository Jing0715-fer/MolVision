// 演示场景运行状态：当前场景 / 步骤索引 / 异步步骤忙碌标志
import { create } from 'zustand'
import { findTour, type TourDef } from './tours'
import { useMolStore } from './store'

interface TourState {
  /** 活动演示（null = 未激活） */
  tour: TourDef | null
  /** 当前步骤索引（0 起） */
  stepIdx: number
  /** 步骤动作执行中（禁用下一步按钮） */
  busy: boolean
  /** 启动演示（从头开始） */
  start: (id: string) => Promise<boolean>
  /** 跳到指定步骤（执行其动作） */
  go: (idx: number) => Promise<void>
  next: () => Promise<void>
  /** 上一步：仅回看文案，不重跑动作（避免重复加载/计算） */
  prev: () => void
  stop: () => void
}

async function runStep(tour: TourDef, idx: number): Promise<void> {
  const step = tour.steps[idx]
  if (!step?.run) return
  try {
    await step.run()
  } catch (e) {
    useMolStore.getState().appendLog('err', `演示步骤执行失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

export const useTourStore = create<TourState>((set, get) => ({
  tour: null,
  stepIdx: 0,
  busy: false,

  start: async id => {
    const tour = findTour(id)
    if (!tour) return false
    set({ tour, stepIdx: 0, busy: true })
    useMolStore.getState().appendLog('out', `▶ 开始演示「${tour.title}」（${tour.steps.length} 步，约 ${tour.minutes} 分钟）——←/→ 切换步骤，Esc 结束`)
    await runStep(tour, 0)
    if (get().tour === tour && get().stepIdx === 0) set({ busy: false })
    return true
  },

  go: async idx => {
    const { tour } = get()
    if (!tour) return
    const clamped = Math.max(0, Math.min(tour.steps.length - 1, idx))
    set({ stepIdx: clamped, busy: true })
    await runStep(tour, clamped)
    if (get().tour === tour && get().stepIdx === clamped) set({ busy: false })
  },

  next: async () => {
    const { tour, stepIdx, busy } = get()
    if (!tour || busy) return
    if (stepIdx >= tour.steps.length - 1) {
      // 最后一步 → 优雅结束
      useMolStore.getState().appendLog('out', '■ 演示结束')
      set({ tour: null, stepIdx: 0, busy: false })
      return
    }
    await get().go(stepIdx + 1)
  },

  prev: () => {
    const { tour, stepIdx } = get()
    if (!tour || stepIdx === 0) return
    set({ stepIdx: stepIdx - 1 })
  },

  stop: () => {
    if (!get().tour) return
    useMolStore.getState().appendLog('out', '■ 演示已结束')
    set({ tour: null, stepIdx: 0, busy: false })
  },
}))
