// 会话持久化：结构源文本 + reps + 设置 + 相机 → localStorage 保存/恢复
import { dataRegistry, engineRef, useMolStore } from './store'
import { parseStructure } from './parser'
import { defaultSettings, type RepConfig, type Settings } from './types'
import { textRegistry } from './text-registry'

const KEY = 'molvision-session-v1'
/** 文本总预算（localStorage 通常 5MB） */
const TEXT_BUDGET = 3.2 * 1024 * 1024

interface SessionStructure {
  name: string
  format: 'pdb' | 'cif'
  text: string
  reps: RepConfig[]
  colorOverrides: Record<number, string>
  visible: boolean
}

interface SessionData {
  version: 1
  savedAt: number
  activeIndex: number
  structures: SessionStructure[]
  settings: Settings
  camera: { pos: [number, number, number]; target: [number, number, number] } | null
  namedSelections: { name: string; structureIndex: number; expr: string | null; indices: number[] | null; count: number }[]
}

export function saveSession(): boolean {
  const s = useMolStore.getState()
  if (!s.structures.length) {
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
    return false
  }
  // 序列化结构（预算内）
  const structs: SessionStructure[] = []
  let budget = TEXT_BUDGET
  let skipped = 0
  for (const st of s.structures) {
    const text = textRegistry.get(st.id) ?? ''
    if (!text || text.length > budget) {
      if (text) skipped++
      continue
    }
    budget -= text.length
    structs.push({
      name: st.name,
      format: st.format,
      text,
      reps: st.reps,
      colorOverrides: st.colorOverrides,
      visible: st.visible,
    })
  }
  const eng = engineRef.current
  const cam = eng
    ? {
        pos: eng.camera.position.toArray() as [number, number, number],
        target: eng.controls.target.toArray() as [number, number, number],
      }
    : null
  const activeIndex = s.structures.findIndex(x => x.id === s.activeId)
  const data: SessionData = {
    version: 1,
    savedAt: Date.now(),
    activeIndex,
    structures: structs,
    settings: s.settings,
    camera: cam,
    namedSelections: s.namedSelections.map(ns => ({
      name: ns.name,
      structureIndex: s.structures.findIndex(x => x.id === ns.structureId),
      expr: ns.expr,
      indices: ns.indices,
      count: ns.count,
    })).filter(ns => ns.structureIndex >= 0),
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(data))
    if (skipped > 0) {
      console.warn(`[MolVision] ${skipped} 个结构过大，未包含在会话存档中`)
    }
    return true
  } catch {
    // 超出 localStorage 容量：去掉大文本重试一次
    try {
      const lite: SessionData = { ...data, structures: structs.map(x => ({ ...x, text: '' })) }
      localStorage.setItem(KEY, JSON.stringify(lite))
    } catch { /* ignore */ }
    return false
  }
}

export function hasSession(): boolean {
  try {
    return !!localStorage.getItem(KEY)
  } catch {
    return false
  }
}

/** 恢复会话；返回恢复的结构数量 */
export function restoreSession(): number {
  let data: SessionData | null = null
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) data = JSON.parse(raw) as SessionData
  } catch { /* ignore */ }
  if (!data || data.version !== 1) return 0
  let restored = 0
  const indexToId = new Map<number, string>()
  data.structures.forEach((ss, idx) => {
    if (!ss.text) return
    try {
      const parsed = parseStructure(ss.text, ss.name, ss.format)
      if (parsed.atoms.count === 0) return
      const store = useMolStore.getState()
      const id = store.addStructure(parsed, ss.name, 0)
      indexToId.set(idx, id)
      // 覆盖 reps / overrides / visible
      useMolStore.setState(s => ({
        structures: s.structures.map(x => x.id === id
          ? { ...x, reps: ss.reps, colorOverrides: ss.colorOverrides, visible: ss.visible }
          : x),
      }))
      restored++
    } catch { /* 单结构失败不阻断 */ }
  })
  if (restored === 0) return 0
  // 恢复设置
  useMolStore.setState(s => ({ settings: { ...defaultSettings(), ...data!.settings } }))
  // 恢复活动结构
  const activeId = indexToId.get(Math.max(0, data.activeIndex))
  if (activeId) useMolStore.setState({ activeId })
  // 恢复命名选择
  const named = (data.namedSelections ?? [])
    .map(ns => {
      const sid = indexToId.get(ns.structureIndex)
      return sid ? { name: ns.name, structureId: sid, expr: ns.expr, indices: ns.indices, count: ns.count } : null
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  if (named.length) useMolStore.setState({ namedSelections: named })
  // 恢复相机（下一帧，等引擎 sync 完成后覆盖 fitView）
  if (data.camera) {
    const { pos, target } = data.camera
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const eng = engineRef.current
        if (!eng) return
        eng.camera.position.set(pos[0], pos[1], pos[2])
        eng.controls.target.set(target[0], target[1], target[2])
        eng.controls.update()
        useMolStore.getState().bumpVisual()
      })
    })
  }
  useMolStore.getState().appendLog('out', `已恢复上次会话：${restored} 个结构`)
  return restored
}

export function clearSession() {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

/** 供命令行/调试 */
export function sessionInfo(): string {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return '无会话存档'
    const d = JSON.parse(raw) as SessionData
    const age = Math.round((Date.now() - d.savedAt) / 1000)
    return `存档时间 ${age < 60 ? age + ' 秒前' : Math.round(age / 60) + ' 分钟前'}，${d.structures.length} 个结构${d.camera ? '，含相机' : ''}`
  } catch {
    return '会话存档损坏'
  }
}
