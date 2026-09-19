// 关键帧相机动画 movie（对标 PyMOL movie）：把已保存的视角书签串成序列平滑巡航
// 播放器 = 异步序列循环：逐书签 engine.animateCameraTo(dur) → 等待完成；
// 用户 pointerdown/wheel 接管（camAnimCancelCount 递增）时优雅停止
// 与 record 命令天然组合：record start → movie play → record stop 得到 WebM 视频
//
// r19 新增：时间轴编辑（timeline）——书签关键帧的有序子集 + 每段独立时长 + 轮数，
// localStorage 持久化（molvision-movie-v1），MovieTimeline 组件提供可视编排 UI。
import { create } from 'zustand'
import { engineRef } from './store'
import { useViewsStore, type ViewBookmark } from './views-store'
import { useMolStore } from './store'

/** 时间轴关键帧：指向视角书签 id + 本段时长（ms，含过渡） */
export interface TimelineEntry {
  viewId: string
  duration: number
}

const TL_KEY = 'molvision-movie-v1'
/** 单段时长钳制（ms） */
const clampDur = (ms: number) => Math.max(600, Math.min(20000, Math.round(ms)))

export interface MovieState {
  playing: boolean
  /** 当前段（0 起）：段索引 × 循环轮次 */
  seg: number
  /** 总段数 = 关键帧数 × 轮数 */
  total: number
  /** 当前段时长（含过渡，ms；时间轴模式下每段可不同） */
  duration: number
  /** 轮数 */
  loops: number
  /** 当前段书签（UI 显示名称用） */
  currentName: string | null
  // ---------- 时间轴编辑（持久化） ----------
  timeline: TimelineEntry[]
  timelineOpen: boolean
  /** 时间轴轮数（编辑态；播放时采用） */
  loopsEdit: number
  /** 是否已从 localStorage 装载 */
  hydrated: boolean
  hydrate: () => void
  setTimelineOpen: (open: boolean) => void
  /** 从当前书签重建时间轴（保留已有 viewId 的时长设置） */
  syncTimeline: () => number
  /** 拖拽排序：数组移动（from → to，均为当前数组下标） */
  reorderTimeline: (from: number, to: number) => void
  setEntryDuration: (i: number, ms: number) => void
  removeEntry: (i: number) => void
  setLoopsEdit: (n: number) => void
  clearTimeline: () => void
  /** 用户请求停止 */
  stop: () => void
}

function persistTimeline(timeline: TimelineEntry[], loopsEdit: number) {
  try { localStorage.setItem(TL_KEY, JSON.stringify({ v: 1, timeline, loops: loopsEdit })) } catch { /* 容量满：静默 */ }
}

function loadTimeline(): { timeline: TimelineEntry[]; loopsEdit: number } {
  try {
    const raw = localStorage.getItem(TL_KEY)
    if (!raw) return { timeline: [], loopsEdit: 1 }
    const obj = JSON.parse(raw) as { timeline?: unknown; loops?: unknown }
    const timeline: TimelineEntry[] = []
    if (Array.isArray(obj.timeline)) {
      for (const x of obj.timeline) {
        const e = x as Partial<TimelineEntry>
        if (typeof e?.viewId !== 'string') continue
        timeline.push({ viewId: e.viewId, duration: clampDur(typeof e.duration === 'number' ? e.duration : 2600) })
        if (timeline.length >= 12) break
      }
    }
    const loopsEdit = typeof obj.loops === 'number' ? Math.max(1, Math.min(10, Math.round(obj.loops))) : 1
    return { timeline, loopsEdit }
  } catch {
    return { timeline: [], loopsEdit: 1 }
  }
}

export const useMovieStore = create<MovieState>((set, get) => ({
  playing: false,
  seg: 0,
  total: 0,
  duration: 2600,
  loops: 1,
  currentName: null,
  timeline: [],
  timelineOpen: false,
  loopsEdit: 1,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return
    const { timeline, loopsEdit } = loadTimeline()
    set({ timeline, loopsEdit, hydrated: true })
  },

  setTimelineOpen: open => set({ timelineOpen: open }),

  syncTimeline: () => {
    const bookmarks = useViewsStore.getState().bookmarks
    const prev = new Map(get().timeline.map(e => [e.viewId, e.duration] as const))
    const timeline = bookmarks.map(b => ({ viewId: b.id, duration: clampDur(prev.get(b.id) ?? 2600) }))
    persistTimeline(timeline, get().loopsEdit)
    set({ timeline })
    return timeline.length
  },

  reorderTimeline: (from, to) => {
    const t = get().timeline
    if (from < 0 || from >= t.length || to < 0 || to >= t.length || from === to) return
    const arr = [...t]
    const [it] = arr.splice(from, 1)
    arr.splice(to, 0, it)
    persistTimeline(arr, get().loopsEdit)
    set({ timeline: arr })
  },

  setEntryDuration: (i, ms) => {
    const t = get().timeline
    if (i < 0 || i >= t.length) return
    const timeline = t.map((e, k) => (k === i ? { ...e, duration: clampDur(ms) } : e))
    persistTimeline(timeline, get().loopsEdit)
    set({ timeline })
  },

  removeEntry: i => {
    const t = get().timeline
    if (i < 0 || i >= t.length) return
    const timeline = t.filter((_, k) => k !== i)
    persistTimeline(timeline, get().loopsEdit)
    set({ timeline })
  },

  setLoopsEdit: n => {
    const loopsEdit = Math.max(1, Math.min(10, Math.round(n) || 1))
    persistTimeline(get().timeline, loopsEdit)
    set({ loopsEdit })
  },

  clearTimeline: () => {
    try { localStorage.removeItem(TL_KEY) } catch { /* ignore */ }
    set({ timeline: [] })
  },

  stop: () => set({ playing: false, currentName: null }),
}))

let running = false

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

interface PlaySeg {
  view: ViewBookmark
  duration: number
}

/**
 * 启动 movie 序列播放（异步；重复调用会被运行中守卫拒绝）。
 * @param opts.useTimeline true = 走编辑的时间轴（每段独立时长 + loopsEdit 轮数）；
 *                         false/缺省 = 全部书签 × 统一时长（经典模式）
 */
export async function playMovie(opts: {
  duration?: number
  loops?: number
  useTimeline?: boolean
} = {}): Promise<{ ok: true; views: number; segs: number } | { ok: false; error: string }> {
  if (running) return { ok: false, error: 'movie 已在播放中（movie stop 停止）' }
  const useTimeline = opts.useTimeline === true
  const bookmarks: ViewBookmark[] = useViewsStore.getState().bookmarks

  let segs: PlaySeg[]
  if (useTimeline) {
    const byId = new Map(bookmarks.map(b => [b.id, b] as const))
    segs = useMovieStore.getState().timeline
      .map(e => ({ view: byId.get(e.viewId), duration: clampDur(e.duration) }))
      .filter((s): s is PlaySeg => s.view !== undefined)
    if (segs.length < 2) {
      return { ok: false, error: '时间轴至少需要 2 个有效关键帧（书签可能已被删除——打开时间轴「同步书签」重建）' }
    }
  } else {
    if (bookmarks.length < 2) return { ok: false, error: `至少需要 2 个视角书签（当前 ${bookmarks.length} 个）——用 V 键或 view save 先保存多机位` }
    const dur = clampDur(opts.duration ?? 2600)
    segs = bookmarks.map(b => ({ view: b, duration: dur }))
  }

  const settings = useMolStore.getState().settings
  if (settings.spin || settings.rock) {
    return { ok: false, error: 'spin / rock 开启时无法播放 movie（相机被程序控制）——先 spin off / rock off' }
  }
  const eng = engineRef.current
  if (!eng) return { ok: false, error: '引擎未就绪' }

  const rounds = Math.max(1, Math.min(10, Math.round(opts.loops ?? (useTimeline ? useMovieStore.getState().loopsEdit : 1))))
  const total = segs.length * rounds
  running = true
  useMovieStore.getState().stop() // 清残留态
  useMovieStore.setState({ playing: true, seg: 0, total, duration: segs[0].duration, loops: rounds, currentName: segs[0].view.name ?? null })

  let seg = 0
  try {
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < segs.length; i++) {
        if (!useMovieStore.getState().playing) return { ok: true, views: bookmarks.length, segs: segs.length }
        const { view, duration } = segs[i]
        useMovieStore.setState({ seg, currentName: view.name, duration })
        const cancelBase = eng.cameraCancelCount()
        eng.animateCameraTo(view.camera, duration)
        // 等待本段完成：动画自然结束或用户接管（取消计数递增 → 立即停止 movie）
        const deadline = performance.now() + duration + 260
        while (performance.now() < deadline) {
          if (!useMovieStore.getState().playing) return { ok: true, views: bookmarks.length, segs: segs.length }
          if (eng.cameraCancelCount() > cancelBase) {
            useMovieStore.setState({ playing: false, currentName: null })
            useMolStore.getState().appendLog('out', `movie：用户接管相机，序列播放提前结束（${seg}/${total} 段）`)
            return { ok: true, views: bookmarks.length, segs: segs.length }
          }
          await sleep(90)
        }
        seg++
      }
    }
    useMolStore.getState().appendLog('out', `movie 播放完成：${segs.length} 段 × ${rounds} 轮`)
  } finally {
    running = false
    useMovieStore.setState({ playing: false, currentName: null })
  }
  return { ok: true, views: bookmarks.length, segs: segs.length }
}

/** 停止序列播放（用户 UI / movie stop 命令） */
export function stopMovie() {
  useMovieStore.getState().stop()
}
