// 演示场景运行状态：当前场景 / 步骤索引 / 异步步骤忙碌标志
// 开始演示时快照设置；结束/中止时还原演示期间被改动的键——
// 避免 tour 中的 hbonds on / slab 等演示态泄漏到用户工作区（「一加载结构就冒绿色虚线」根因）
import { create } from 'zustand'
import { tt } from '@/i18n'
import { findTour, type TourDef } from './tours'
import { useMolStore } from './store'
import type { Settings } from './types'

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

/** 演示开始时的设置快照 */
let settingsSnapshot: Settings | null = null
/** 演示期间改动的设置键（订阅持续追踪——tour 步骤多为 void exec 发射后不管，命令落地是异步的） */
let touchedKeys = new Set<string>()
/** 设置订阅退订函数（演示存活期间挂载） */
let unsubSettings: (() => void) | null = null

function watchSettings() {
  settingsSnapshot = { ...useMolStore.getState().settings }
  touchedKeys = new Set()
  unsubSettings?.()
  // 追踪演示期间（含异步命令延迟落地）的设置键变化；与快照对比而非前后帧——
  // 即使命令多帧后才写入 store 也能记录，用户手动改动的键同样会回到演示前值（可预期的「还原现场」）
  unsubSettings = useMolStore.subscribe((state, prev) => {
    if (state.settings === prev.settings || !settingsSnapshot) return
    for (const k of Object.keys(state.settings) as (keyof Settings)[]) {
      if (state.settings[k] !== settingsSnapshot[k]) touchedKeys.add(k as string)
    }
  })
}

/** 还原演示改动的设置键；返回被还原的键名（用于日志） */
function restoreTouched(): string[] {
  const restored: string[] = []
  if (!settingsSnapshot) return restored
  const cur = useMolStore.getState().settings
  const patch: Partial<Settings> = {}
  for (const k of touchedKeys) {
    const key = k as keyof Settings
    if (cur[key] !== settingsSnapshot[key]) {
      ;(patch as Record<string, unknown>)[k] = settingsSnapshot[key]
      restored.push(k)
    }
  }
  if (restored.length) useMolStore.getState().updateSettings(patch)
  return restored
}

function endTour(set: (partial: Partial<TourState>) => void) {
  const restored = restoreTouched()
  useMolStore.getState().appendLog('out', restored.length
    ? tt({ zh: `■ 演示已结束，已还原演示前设置（${restored.join('、')}）`, en: `■ Tour ended, settings restored to pre-tour state (${restored.join(', ')})` })
    : tt({ zh: '■ 演示已结束', en: '■ Tour ended' }))
  settingsSnapshot = null
  touchedKeys = new Set()
  unsubSettings?.()
  unsubSettings = null
  set({ tour: null, stepIdx: 0, busy: false })
}

async function runStep(tour: TourDef, idx: number): Promise<void> {
  const step = tour.steps[idx]
  if (!step?.run) return
  try {
    await step.run()
    // 部分步骤发射后不管（void exec）；命令落地由订阅捕获，无需在此 diff
  } catch (e) {
    useMolStore.getState().appendLog('err', tt({ zh: `演示步骤执行失败：${e instanceof Error ? e.message : String(e)}`, en: `Tour step failed: ${e instanceof Error ? e.message : String(e)}` }))
  }
}

export const useTourStore = create<TourState>((set, get) => ({
  tour: null,
  stepIdx: 0,
  busy: false,

  start: async id => {
    const tour = findTour(id)
    if (!tour) return false
    watchSettings()
    set({ tour, stepIdx: 0, busy: true })
    useMolStore.getState().appendLog('out', tt({
      zh: `▶ 开始演示「${tt(tour.title)}」（${tour.steps.length} 步，约 ${tour.minutes} 分钟）——←/→ 切换步骤，Esc 结束（结束后自动还原演示前设置）`,
      en: `▶ Tour "${tt(tour.title)}" started (${tour.steps.length} steps, about ${tour.minutes} min) — ←/→ to step, Esc to end (settings restored automatically afterwards)`,
    }))
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
      // 最后一步 → 优雅结束并还原设置
      endTour(set)
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
    endTour(set)
  },
}))
