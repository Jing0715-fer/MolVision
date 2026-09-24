// PyMOL 式场景快照（Scene）：相机 + 表示法 + 链隔离 + 环境设置一起保存/召回。
// 与视角书签（views-store，仅相机）互补——书签回答「从哪看」，场景回答「看什么、怎么显示」。
// 召回时按结构名匹配恢复 reps/显隐/链隔离；结构未加载则跳过并在结果中报告。
// localStorage 独立持久化（molvision-scenes-v1），跨刷新/跨会话保留。
import { create } from 'zustand'
import { tt } from '@/i18n'
import { engineRef, useMolStore } from './store'
import { whenEngineReady } from './engine-ready'
import type { RepConfig } from './types'
import { makeThumb, type ViewCamera } from './views-store'

const KEY = 'molvision-scenes-v1'
/** 场景上限（含缩略图 ~10KB/张，控制 localStorage 占用） */
export const MAX_SCENES = 10

/** 单结构快照：reps / 显隐 / 链隔离 / 烘焙色（按结构名召回） */
export interface SceneStructSnap {
  name: string
  visible: boolean
  reps: RepConfig[]
  hiddenChains: number[] | null
  colorOverrides: Record<number, string>
}

/** 环境设置子集（召回时整体恢复——这些项决定「显示风格」的全局观感） */
export interface SceneEnv {
  background: string
  fog: boolean
  outline: boolean
  outlineStrength: number
  outlineThickness: number
  ssao: boolean
  hideWater: boolean
  hideHydrogens: boolean
  showHBonds: boolean
  hbondMaxDist: number
  hbondIncludeWater: boolean
  hbondSelOnly: boolean
}

export interface MolScene {
  id: string
  name: string
  createdAt: number
  /** 相机快照（保存时引擎缺席则为 null——仅样式召回） */
  camera: ViewCamera | null
  /** 视口缩略图（JPEG dataURL；生成异步，可能短暂为 null） */
  thumb: string | null
  structures: SceneStructSnap[]
  env: SceneEnv
  /** 氢键烘焙范围快照（按结构名映射；null = 无范围） */
  hbondScope: { structureName: string; indices: number[] } | null
  /** 保存时的活动结构名（召回时恢复活动态） */
  activeName: string | null
}

export type SceneSaveResult =
  | { ok: true; scene: MolScene; updated: boolean }
  | { ok: false; error: string }

export type SceneRecallResult =
  | { ok: true; scene: MolScene; restored: number; missing: string[]; cameraApplied: boolean }
  | { ok: false; error: string }

interface ScenesState {
  scenes: MolScene[]
  /** 最近召回/保存的场景 id（next/prev 循环基准） */
  activeSceneId: string | null
  /** 缩略图异步回填后的渲染版本号 */
  rev: number
  hydrated: boolean
  hydrate: () => void
  /** 保存当前完整状态为新场景（重名则更新——PyMOL scene update 语义合并进 save） */
  saveScene: (name?: string) => SceneSaveResult
  /** 用当前状态覆盖既有场景内容（保 id/名/时间） */
  updateScene: (idOrIndex: string | number) => SceneSaveResult
  /** 召回场景（相机平滑过渡；引擎缺席入队等待——欢迎页 load 窗口不失败） */
  recallScene: (idOrIndex: string | number, animated?: boolean) => SceneRecallResult
  deleteScene: (idOrIndex: string | number) => boolean
  renameScene: (idOrIndex: string | number, name: string) => boolean
  clearScenes: () => void
  /** 循环切换（step=1 下一个 / -1 上一个；无场景或全部不可召回返回 false） */
  cycleScene: (step: 1 | -1) => boolean
}

/** 当前工作台状态 → 快照体（不含 id/名/缩略图） */
function snapshotCurrent(): Pick<MolScene, 'camera' | 'structures' | 'env' | 'hbondScope' | 'activeName'> {
  const s = useMolStore.getState()
  const cam = engineRef.current?.getCameraState()
  const camera: ViewCamera | null = cam
    ? {
        pos: [cam.pos[0], cam.pos[1], cam.pos[2]],
        target: [cam.target[0], cam.target[1], cam.target[2]],
        up: [cam.up[0], cam.up[1], cam.up[2]],
        fov: cam.fov,
        ortho: cam.ortho,
      }
    : null
  const structures: SceneStructSnap[] = s.structures.map(st => ({
    name: st.name,
    visible: st.visible,
    reps: JSON.parse(JSON.stringify(st.reps)) as RepConfig[],
    hiddenChains: st.hiddenChains?.length ? [...st.hiddenChains] : null,
    colorOverrides: { ...st.colorOverrides },
  }))
  const v = s.settings
  const env: SceneEnv = {
    background: v.background, fog: v.fog,
    outline: v.outline, outlineStrength: v.outlineStrength, outlineThickness: v.outlineThickness,
    ssao: v.ssao, hideWater: v.hideWater, hideHydrogens: v.hideHydrogens,
    showHBonds: v.showHBonds, hbondMaxDist: v.hbondMaxDist,
    hbondIncludeWater: v.hbondIncludeWater, hbondSelOnly: v.hbondSelOnly,
  }
  const hbondScope = s.hbondScope && s.hbondScope.indices.length
    ? {
        structureName: s.structures.find(x => x.id === s.hbondScope!.structureId)?.name ?? '',
        indices: [...s.hbondScope.indices],
      }
    : null
  const activeName = s.structures.find(x => x.id === s.activeId)?.name ?? null
  return { camera, structures, env, hbondScope, activeName }
}

function persist(scenes: MolScene[]) {
  try { localStorage.setItem(KEY, JSON.stringify(scenes)) } catch { /* 容量满：场景仍在本会话可用 */ }
}

/** 单条场景校验（localStorage 装载用；字段缺失/类型错误的条目丢弃） */
function validScene(x: unknown): MolScene | null {
  const sc = x as Partial<MolScene> & { env?: Partial<SceneEnv> }
  if (typeof sc?.id !== 'string' || typeof sc?.name !== 'string' || typeof sc?.createdAt !== 'number') return null
  if (!Array.isArray(sc.structures) || !sc.env || typeof sc.env.background !== 'string') return null
  const e = sc.env
  return {
    id: sc.id, name: sc.name, createdAt: sc.createdAt,
    camera: sc.camera ?? null,
    thumb: typeof sc.thumb === 'string' ? sc.thumb : null,
    structures: sc.structures.map(sp => ({
      name: String(sp.name ?? ''), visible: sp.visible !== false,
      reps: Array.isArray(sp.reps) ? sp.reps : [],
      hiddenChains: Array.isArray(sp.hiddenChains) ? sp.hiddenChains : null,
      colorOverrides: sp.colorOverrides && typeof sp.colorOverrides === 'object' ? sp.colorOverrides : {},
    })),
    env: {
      background: e.background, fog: !!e.fog,
      outline: !!e.outline,
      outlineStrength: typeof e.outlineStrength === 'number' ? e.outlineStrength : 1,
      outlineThickness: typeof e.outlineThickness === 'number' ? e.outlineThickness : 1.5,
      ssao: !!e.ssao, hideWater: !!e.hideWater, hideHydrogens: !!e.hideHydrogens,
      showHBonds: !!e.showHBonds,
      hbondMaxDist: typeof e.hbondMaxDist === 'number' ? e.hbondMaxDist : 3.5,
      hbondIncludeWater: !!e.hbondIncludeWater, hbondSelOnly: e.hbondSelOnly !== false,
    },
    hbondScope: sc.hbondScope && Array.isArray(sc.hbondScope.indices)
      ? { structureName: String(sc.hbondScope.structureName ?? ''), indices: sc.hbondScope.indices }
      : null,
    activeName: typeof sc.activeName === 'string' ? sc.activeName : null,
  }
}

function loadScenes(): MolScene[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    const out: MolScene[] = []
    for (const x of arr) {
      const sc = validScene(x)
      if (sc) out.push(sc)
      if (out.length >= MAX_SCENES) break
    }
    return out
  } catch {
    return []
  }
}

export const useSceneStore = create<ScenesState>((set, get) => ({
  scenes: [],
  activeSceneId: null,
  rev: 0,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === 'undefined') return
    set({ scenes: loadScenes(), hydrated: true })
  },

  saveScene: name => {
    const s = get()
    if (!s.hydrated) s.hydrate()
    const st = useMolStore.getState()
    if (!st.structures.length) return { ok: false, error: tt({ zh: '当前没有结构——场景快照需要可保存的显示状态', en: 'No structures loaded — a scene snapshot needs display state to save' }) }
    const trimmed = (name ?? '').trim().slice(0, 40)
    const body = snapshotCurrent()
    // 重名 → 原位更新（保留 id/时间；PyMOL scene update 语义）
    const existing = trimmed ? get().scenes.find(x => x.name.toLowerCase() === trimmed.toLowerCase()) : undefined
    if (existing) {
      const scene: MolScene = { ...existing, ...body }
      set(state => ({
        scenes: state.scenes.map(x => (x.id === existing.id ? scene : x)),
        activeSceneId: existing.id,
      }))
      persist(get().scenes)
      void fillThumb(existing.id, set)
      return { ok: true, scene, updated: true }
    }
    if (get().scenes.length >= MAX_SCENES) {
      return { ok: false, error: tt({ zh: `场景已达上限（${MAX_SCENES}）——先 scene del 删除不再需要的场景`, en: `Scene limit reached (${MAX_SCENES}) — use scene del to remove scenes you no longer need` }) }
    }
    const scene: MolScene = {
      id: `sc${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: trimmed || tt({ zh: `场景 ${get().scenes.length + 1}`, en: `Scene ${get().scenes.length + 1}` }),
      createdAt: Date.now(),
      thumb: null,
      ...body,
    }
    set(state => ({ scenes: [...state.scenes, scene], activeSceneId: scene.id }))
    persist(get().scenes)
    void fillThumb(scene.id, set)
    return { ok: true, scene, updated: false }
  },

  updateScene: idOrIndex => {
    const list = get().scenes
    const target = typeof idOrIndex === 'number' ? list[idOrIndex] : list.find(x => x.id === idOrIndex)
    if (!target) return { ok: false, error: tt({ zh: '找不到场景', en: 'Scene not found' }) }
    const st = useMolStore.getState()
    if (!st.structures.length) return { ok: false, error: tt({ zh: '当前没有结构——无法更新场景', en: 'No structures loaded — cannot update the scene' }) }
    const body = snapshotCurrent()
    const scene: MolScene = { ...target, ...body }
    set(state => ({ scenes: state.scenes.map(x => (x.id === target.id ? scene : x)), activeSceneId: target.id }))
    persist(get().scenes)
    void fillThumb(target.id, set)
    return { ok: true, scene, updated: true }
  },

  recallScene: (idOrIndex, animated = true) => {
    const list = get().scenes
    const sc = typeof idOrIndex === 'number' ? list[idOrIndex] : list.find(x => x.id === idOrIndex)
    if (!sc) return { ok: false, error: tt({ zh: '找不到场景', en: 'Scene not found' }) }
    const store = useMolStore.getState()
    if (!store.structures.length) {
      return { ok: false, error: tt({ zh: '当前没有结构——场景按结构名恢复（先 load 对应结构）', en: 'No structures loaded — scenes restore by structure name (load the structure first)' }) }
    }
    // ① 环境设置（一次性 patch，一次 visualRev bump）
    store.updateSettings({
      background: sc.env.background, backgroundPinned: true,
      fog: sc.env.fog,
      outline: sc.env.outline, outlineStrength: sc.env.outlineStrength, outlineThickness: sc.env.outlineThickness,
      ssao: sc.env.ssao, hideWater: sc.env.hideWater, hideHydrogens: sc.env.hideHydrogens,
      showHBonds: sc.env.showHBonds, hbondMaxDist: sc.env.hbondMaxDist,
      hbondIncludeWater: sc.env.hbondIncludeWater, hbondSelOnly: sc.env.hbondSelOnly,
    })
    // ② 结构快照按名恢复（reps 深拷贝，rev bump 触发引擎重建）
    let restored = 0
    useMolStore.setState(s => ({
      structures: s.structures.map(x => {
        const snap = sc.structures.find(sp => sp.name === x.name)
        if (!snap) return x
        restored++
        return {
          ...x,
          visible: snap.visible,
          reps: JSON.parse(JSON.stringify(snap.reps)) as RepConfig[],
          colorOverrides: { ...snap.colorOverrides },
          hiddenChains: snap.hiddenChains?.length ? [...snap.hiddenChains] : undefined,
          rev: x.rev + 1,
        }
      }),
      visualRev: s.visualRev + 1,
    }))
    const after = useMolStore.getState()
    const missing = sc.structures
      .map(sp => sp.name)
      .filter(nm => !after.structures.some(x => x.name === nm))
    // ③ 活动结构 + ④ 氢键烘焙范围（按名映射；快照无范围则清除——忠实还原显示状态）
    if (sc.activeName) {
      const act = after.structures.find(x => x.name === sc.activeName)
      if (act) after.setActive(act.id)
    }
    if (sc.hbondScope) {
      const target = after.structures.find(x => x.name === sc.hbondScope!.structureName)
      if (target && sc.hbondScope.indices.length) {
        after.setHBondScope({ structureId: target.id, indices: [...sc.hbondScope.indices] })
      } else {
        after.setHBondScope(null)
      }
    } else {
      after.setHBondScope(null)
    }
    // ⑤ 相机（引擎缺席 → whenEngineReady 入队，欢迎页 load 窗口内召回不失败）
    let cameraApplied = false
    if (sc.camera) {
      const cam = sc.camera
      const eng = engineRef.current
      if (eng) {
        if (animated) eng.animateCameraTo(cam)
        else eng.setCameraState(cam)
        cameraApplied = true
      } else if (after.structures.length) {
        whenEngineReady(() => {
          const e = engineRef.current
          if (!e) return
          if (animated) e.animateCameraTo(cam)
          else e.setCameraState(cam)
        })
        cameraApplied = true
      }
    }
    set({ activeSceneId: sc.id })
    return { ok: true, scene: sc, restored, missing, cameraApplied }
  },

  deleteScene: idOrIndex => {
    const list = get().scenes
    const sc = typeof idOrIndex === 'number' ? list[idOrIndex] : list.find(x => x.id === idOrIndex)
    if (!sc) return false
    const scenes = list.filter(x => x.id !== sc.id)
    persist(scenes)
    set(s => ({ scenes, activeSceneId: s.activeSceneId === sc.id ? null : s.activeSceneId }))
    return true
  },

  renameScene: (idOrIndex, name) => {
    const trimmed = name.trim().slice(0, 40)
    if (!trimmed) return false
    const list = get().scenes
    const sc = typeof idOrIndex === 'number' ? list[idOrIndex] : list.find(x => x.id === idOrIndex)
    if (!sc) return false
    const scenes = list.map(x => (x.id === sc.id ? { ...x, name: trimmed } : x))
    persist(scenes)
    set({ scenes })
    return true
  },

  clearScenes: () => {
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
    set({ scenes: [], activeSceneId: null })
  },

  cycleScene: step => {
    const { scenes, activeSceneId } = get()
    if (!scenes.length) return false
    const idx = scenes.findIndex(x => x.id === activeSceneId)
    const next = idx < 0 ? (step > 0 ? 0 : scenes.length - 1) : (idx + step + scenes.length) % scenes.length
    return get().recallScene(scenes[next].id).ok
  },
}))

/** 异步回填缩略图（截图 + Image 解码；完成后 bump rev 触发 UI 刷新） */
async function fillThumb(sceneId: string, set: (fn: (s: ScenesState) => Partial<ScenesState>) => void) {
  try {
    const eng = engineRef.current
    if (!eng) return
    const full = eng.capture()
    const thumb = await makeThumb(full)
    if (!thumb) return
    set(s => {
      if (!s.scenes.some(x => x.id === sceneId)) return {}
      const scenes = s.scenes.map(x => (x.id === sceneId ? { ...x, thumb } : x))
      persist(scenes)
      return { scenes, rev: s.rev + 1 }
    })
  } catch { /* 截图失败：场景仍可用（无缩略图） */ }
}
