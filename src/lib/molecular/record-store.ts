// 动画录制轻量 store（独立于主 store，避免 visualRev 循环）
import { create } from 'zustand'

interface RecordStore {
  recording: boolean
  /** 已录制秒数（由指示器本地计时，仅供显示） */
  setRecording: (recording: boolean) => void
}

export const useRecordStore = create<RecordStore>()(set => ({
  recording: false,
  setRecording: recording => set({ recording }),
}))
