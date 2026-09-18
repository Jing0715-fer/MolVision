// 视角书签：相机状态 + 视口缩略图，localStorage 独立持久化（molvision-views-v1）
// 与会话存档（结构/reps/密度图）解耦——清空结构不清空书签，跨刷新/跨会话保留
import { create } from 'zustand'
import { engineRef } from './store'

const KEY = 'molvision-views-v1'
/** 书签上限（缩略图 ~10KB/张，控制 localStorage 占用） */
export const MAX_BOOKMARKS = 12
/** 缩略图宽度（px）；高度按视口宽高比推导 */
const THUMB_W = 192

export interface ViewCamera {
  pos: [number, number, number]
  target: [number, number, number]
  up: [number, number, number]
  fov: number
  ortho: boolean
}

export interface ViewBookmark {
  id: string
  name: string
  camera: ViewCamera
  /** 视口缩略图（JPEG dataURL；生成异步，可能短暂为 null） */
  thumb: string | null
  createdAt: number
}

interface ViewsState {
  bookmarks: ViewBookmark[]
  /** 缩略图异步回填后的渲染版本号 */
  rev: number
  /** 是否已从 localStorage 装载（避免 SSR/首帧重复读取） */
  hydrated: boolean
  hydrate: () => void
  /** 保存当前引擎相机为新书签（返回 null = 无引擎/超上限） */
  addBookmark: (name?: string) => ViewBookmark | null
  /** 跳转书签（id 或 0 起序号；默认平滑过渡动画） */
  restoreBookmark: (idOrIndex: string | number, animated?: boolean) => boolean
  removeBookmark: (idOrIndex: string | number) => boolean
  renameBookmark: (id: string, name: string) => void
  clearBookmarks: () => void
  /** 从会话文件导入书签（替换当前全部，校验+截断；返回导入数） */
  importBookmarks: (list: unknown) => number
  /** 合并导入书签（追加到现有，重名跳过；返回新增数） */
  mergeBookmarks: (list: unknown) => number
}

/** localStorage → 书签数组（容错：字段校验失败的条目丢弃） */
function loadBookmarks(): ViewBookmark[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const out: ViewBookmark[] = []
    for (const x of arr) {
      const b = validBookmark(x)
      if (!b) continue
      out.push(b)
      if (out.length >= MAX_BOOKMARKS) break
    }
    return out
  } catch {
    return []
  }
}

/** 单条书签字段校验（会话导入与 localStorage 装载共用） */
function validBookmark(x: unknown): ViewBookmark | null {
  const b = x as Partial<ViewBookmark> & { camera?: Partial<ViewCamera> }
  if (typeof b?.id !== 'string' || typeof b?.name !== 'string' || typeof b?.createdAt !== 'number') return null
  const c = b.camera
  if (
    !c || !Array.isArray(c.pos) || c.pos.length !== 3 || !Array.isArray(c.target) || c.target.length !== 3 ||
    !Array.isArray(c.up) || c.up.length !== 3 || typeof c.fov !== 'number' || typeof c.ortho !== 'boolean'
  ) return null
  return {
    id: b.id, name: b.name, createdAt: b.createdAt,
    thumb: typeof b.thumb === 'string' ? b.thumb : null,
    camera: { pos: c.pos as [number, number, number], target: c.target as [number, number, number], up: c.up as [number, number, number], fov: c.fov, ortho: c.ortho },
  }
}

function persist(bookmarks: ViewBookmark[]) {
  try { localStorage.setItem(KEY, JSON.stringify(bookmarks)) } catch { /* 容量满：静默（书签仍在本会话可用） */ }
}

/** 视口截图 → 小尺寸 JPEG dataURL（Image 解码异步） */
function makeThumb(full: string): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => {
      try {
        const h = Math.max(1, Math.round((THUMB_W * img.height) / img.width))
        const c = document.createElement('canvas')
        c.width = THUMB_W
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, THUMB_W, h)
        resolve(c.toDataURL('image/jpeg', 0.72))
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = full
  })
}

export const useViewsStore = create<ViewsState>((set, get) => ({
  bookmarks: [],
  rev: 0,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return
    set({ bookmarks: loadBookmarks(), hydrated: true })
  },

  addBookmark: name => {
    const eng = engineRef.current
    if (!eng) return null
    if (get().bookmarks.length >= MAX_BOOKMARKS) return null
    const st = eng.getCameraState()
    const bm: ViewBookmark = {
      id: `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: (name ?? '').trim() || `视角 ${get().bookmarks.length + 1}`,
      camera: {
        pos: [st.pos[0], st.pos[1], st.pos[2]],
        target: [st.target[0], st.target[1], st.target[2]],
        up: [st.up[0], st.up[1], st.up[2]],
        fov: st.fov,
        ortho: st.ortho,
      },
      thumb: null,
      createdAt: Date.now(),
    }
    set(s => ({ bookmarks: [...s.bookmarks, bm] }))
    persist(get().bookmarks)
    // 缩略图异步回填（截图 + Image 解码均异步；完成后 bump rev 触发 UI 刷新）
    void (async () => {
      try {
        const full = eng.capture()
        const thumb = await makeThumb(full)
        if (!thumb) return
        set(s => {
          if (!s.bookmarks.some(b => b.id === bm.id)) return {}  // 已被删除
          const bookmarks = s.bookmarks.map(b => (b.id === bm.id ? { ...b, thumb } : b))
          persist(bookmarks)
          return { bookmarks, rev: s.rev + 1 }
        })
      } catch { /* 截图失败：书签仍可用（无缩略图） */ }
    })()
    return bm
  },

  restoreBookmark: (idOrIndex, animated = true) => {
    const list = get().bookmarks
    const b = typeof idOrIndex === 'number' ? list[idOrIndex] : list.find(x => x.id === idOrIndex)
    if (!b) return false
    const eng = engineRef.current
    if (!eng) return false
    if (animated) eng.animateCameraTo(b.camera)
    else eng.setCameraState(b.camera)
    return true
  },

  removeBookmark: idOrIndex => {
    const list = get().bookmarks
    const b = typeof idOrIndex === 'number' ? list[idOrIndex] : list.find(x => x.id === idOrIndex)
    if (!b) return false
    const bookmarks = list.filter(x => x.id !== b.id)
    persist(bookmarks)
    set({ bookmarks })
    return true
  },

  renameBookmark: (id, name) => {
    const trimmed = name.trim().slice(0, 40)
    if (!trimmed) return
    const bookmarks = get().bookmarks.map(b => (b.id === id ? { ...b, name: trimmed } : b))
    persist(bookmarks)
    set({ bookmarks })
  },

  clearBookmarks: () => {
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
    set({ bookmarks: [] })
  },

  importBookmarks: list => {
    if (!Array.isArray(list)) return 0
    const bookmarks: ViewBookmark[] = []
    for (const x of list) {
      const b = validBookmark(x)
      if (!b) continue
      bookmarks.push(b)
      if (bookmarks.length >= MAX_BOOKMARKS) break
    }
    persist(bookmarks)
    set({ bookmarks, hydrated: true })
    return bookmarks.length
  },

  mergeBookmarks: list => {
    if (!Array.isArray(list)) return 0
    if (!get().hydrated) get().hydrate()
    const existing = get().bookmarks
    const names = new Set(existing.map(b => b.name))
    const ids = new Set(existing.map(b => b.id))
    const added: ViewBookmark[] = []
    for (const x of list) {
      const b = validBookmark(x)
      if (!b) continue
      if (existing.length + added.length >= MAX_BOOKMARKS) break
      // 重名/重 id 跳过（同名书签大概率是同一视角；重新生成 id 避免冲突）
      if (names.has(b.name) || ids.has(b.id)) continue
      let id = b.id
      while (ids.has(id)) id = `${b.id}-${Math.random().toString(36).slice(2, 6)}`
      ids.add(id)
      names.add(b.name)
      added.push({ ...b, id })
    }
    if (added.length) {
      const next = [...existing, ...added]
      persist(next)
      set({ bookmarks: next })
    }
    return added.length
  },
}))
