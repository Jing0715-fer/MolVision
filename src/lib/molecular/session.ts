// 会话持久化：结构源文本 + reps + 设置 + 相机 → localStorage 保存/恢复
import { dataRegistry, engineRef, useMolStore } from './store'
import { parseStructure } from './parser'
import { defaultSettings, type RepConfig, type Settings, type RigidTransform } from './types'
import { textRegistry } from './text-registry'
import { applyRigidTransform } from './superpose'

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
  /** 叠合累计刚体变换（恢复时重放） */
  transform?: RigidTransform
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
    // 仅在本次生命周期确实加载过结构后才清除存档（用户主动清空）；
    // 若从未加载过（如恢复失败），保留存档避免被空自动保存永久抹掉
    if (s.everHadStructures) {
      try { localStorage.removeItem(KEY) } catch { /* ignore */ }
    }
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
      transform: st.transform,
    })
  }
  // 防脱节保护：内存有结构但全部拿不到源文本（HMR 模块替换后 textRegistry 重建、
  // 或 registry 意外丢失）时，拒绝写入空会话覆盖旧档——保留旧存档等下次有效保存
  if (structs.length === 0 && s.structures.length > 0) {
    console.warn('[session] structures have no registered source text (HMR/registry desync) — skip saving to preserve existing archive')
    return false
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
      // 重放叠合变换（在 addStructure 前应用，使摘要/包围盒反映变换后坐标）
      if (ss.transform) {
        applyRigidTransform(parsed, ss.transform.quat, ss.transform.translation)
        useMolStore.getState().appendLog('out', `已重放叠合变换：${ss.name}`)
      }
      const store = useMolStore.getState()
      const id = store.addStructure(parsed, ss.name, 0)
      indexToId.set(idx, id)
      // 登记源文本：恢复后的自动保存 / 会话导出才能包含结构数据
      textRegistry.set(id, ss.text)
      // 覆盖 reps / overrides / visible / transform
      useMolStore.setState(s => ({
        structures: s.structures.map(x => x.id === id
          ? { ...x, reps: ss.reps, colorOverrides: ss.colorOverrides, visible: ss.visible, transform: ss.transform }
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

// ---------- 会话文件导出 / 导入（.molvision） ----------

const SESSION_FILE_FORMAT = 'molvision-session'

function timestampName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `molvision-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.molvision`
}

/** 导出当前会话为 .molvision 文件（含结构源文本/表示法/设置/相机/命名选择） */
export function exportSessionFile(): boolean {
  saveSession()
  let raw: string | null = null
  try { raw = localStorage.getItem(KEY) } catch { /* ignore */ }
  if (!raw) return false
  let data: SessionData
  try { data = JSON.parse(raw) as SessionData } catch { return false }
  if (!data.structures?.length) return false
  const withFormat = { format: SESSION_FILE_FORMAT, ...data }
  const blob = new Blob([JSON.stringify(withFormat)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = timestampName()
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return true
}

/** 从 .molvision 文件恢复会话：替换当前场景。返回恢复的结构数（-1 = 文件无效） */
export async function importSessionFile(file: File): Promise<number> {
  const text = await file.text()
  let data: (SessionData & { format?: string }) | null = null
  try { data = JSON.parse(text) as SessionData & { format?: string } } catch {
    throw new Error('文件不是有效的 JSON')
  }
  if (!data || data.format !== SESSION_FILE_FORMAT || data.version !== 1 || !Array.isArray(data.structures)) {
    throw new Error('不是有效的 MolVision 会话文件（.molvision）')
  }
  if (!data.structures.some(s => s.text)) {
    throw new Error('会话文件中没有包含结构数据（可能导出时被裁剪）')
  }
  // 替换模式：清空现有结构后恢复
  const store = useMolStore.getState()
  for (const st of [...store.structures]) store.removeStructure(st.id)
  try { localStorage.setItem(KEY, JSON.stringify({ ...data, format: undefined, savedAt: Date.now() })) } catch { /* ignore */ }
  return restoreSession()
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
