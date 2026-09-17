// 关键帧相机动画 movie（对标 PyMOL movie）：把已保存的视角书签串成序列平滑巡航
// 播放器 = 异步序列循环：逐书签 engine.animateCameraTo(dur) → 等待完成；
// 用户 pointerdown/wheel 接管（camAnimCancelCount 递增）时优雅停止
// 与 record 命令天然组合：record start → movie play → record stop 得到 WebM 视频
import { create } from 'zustand'
import { engineRef } from './store'
import { useViewsStore, type ViewBookmark } from './views-store'
import { useMolStore } from './store'

export interface MovieState {
  playing: boolean
  /** 当前段（0 起）：书签索引 × 循环轮次 */
  seg: number
  /** 总段数 = 书签数 × 轮数 */
  total: number
  /** 每视角停留时长（含过渡，ms） */
  duration: number
  /** 轮数 */
  loops: number
  /** 当前段书签（UI 显示名称用） */
  currentName: string | null
  /** 用户请求停止 */
  stop: () => void
}

export const useMovieStore = create<MovieState>(set => ({
  playing: false,
  seg: 0,
  total: 0,
  duration: 2600,
  loops: 1,
  currentName: null,
  stop: () => set({ playing: false, currentName: null }),
}))

let running = false

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/** 启动 movie 序列播放（异步；重复调用会被运行中守卫拒绝） */
export async function playMovie(durationMs = 2600, loops = 1): Promise<{ ok: true; views: number } | { ok: false; error: string }> {
  if (running) return { ok: false, error: 'movie 已在播放中（movie stop 停止）' }
  const bookmarks: ViewBookmark[] = useViewsStore.getState().bookmarks
  if (bookmarks.length < 2) return { ok: false, error: `至少需要 2 个视角书签（当前 ${bookmarks.length} 个）——用 V 键或 view save 先保存多机位` }
  const settings = useMolStore.getState().settings
  if (settings.spin || settings.rock) {
    return { ok: false, error: 'spin / rock 开启时无法播放 movie（相机被程序控制）——先 spin off / rock off' }
  }
  const eng = engineRef.current
  if (!eng) return { ok: false, error: '引擎未就绪' }

  const duration = Math.max(600, Math.min(20000, durationMs))
  const rounds = Math.max(1, Math.min(10, Math.round(loops)))
  const total = bookmarks.length * rounds
  running = true
  useMovieStore.getState().stop() // 清残留态
  useMovieStore.setState({ playing: true, seg: 0, total, duration, loops: rounds, currentName: bookmarks[0]?.name ?? null })

  let seg = 0
  try {
    for (let round = 0; round < rounds; round++) {
      for (let i = 0; i < bookmarks.length; i++) {
        if (!useMovieStore.getState().playing) return { ok: true, views: bookmarks.length }
        const b = bookmarks[i]
        useMovieStore.setState({ seg, currentName: b.name })
        const cancelBase = eng.cameraCancelCount()
        eng.animateCameraTo(b.camera, duration)
        // 等待本段完成：动画自然结束或用户接管（取消计数递增 → 立即停止 movie）
        const deadline = performance.now() + duration + 260
        while (performance.now() < deadline) {
          if (!useMovieStore.getState().playing) return { ok: true, views: bookmarks.length }
          if (eng.cameraCancelCount() > cancelBase) {
            useMovieStore.setState({ playing: false, currentName: null })
            useMolStore.getState().appendLog('out', `movie：用户接管相机，序列播放提前结束（${seg}/${total} 段）`)
            return { ok: true, views: bookmarks.length }
          }
          await sleep(90)
        }
        seg++
      }
    }
    useMolStore.getState().appendLog('out', `movie 播放完成：${bookmarks.length} 个视角 × ${rounds} 轮`)
  } finally {
    running = false
    useMovieStore.setState({ playing: false, currentName: null })
  }
  return { ok: true, views: bookmarks.length }
}

/** 停止序列播放（用户 UI / movie stop 命令） */
export function stopMovie() {
  useMovieStore.getState().stop()
}
