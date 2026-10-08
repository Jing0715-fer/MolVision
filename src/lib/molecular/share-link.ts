// r85 会话分享链接：轻量会话快照 → URL 片段（#s=base64url）→ 接收端按 PDB ID 重拉结构。
// 设计动机：全量 .molvision 会话含结构源文本（单结构 0.1~2MB），超出任何浏览器 URL
// 上限；分享链接只携带「可复现的视图状态」——结构引用（PDB ID）+ 表示法 + 相机 +
// 设置 + 书签（去缩略图）+ 密度图参数（SF 来源可重算）。
// 诚实边界：本地文件结构无公共 ID 可引用 → 跳过并在快照中计数（接收端提示）；
// 场景快照（含全量结构状态）体积大 → 不入链。
import { toast } from 'sonner'
import { engineRef, useMolStore } from './store'
import { tt } from '@/i18n'
import type { RepConfig, Settings, RigidTransform } from './types'
import { useViewsStore, type ViewBookmark } from './views-store'
import { useMapStore } from './map-store'
import { restoreSessionData, type SessionData, type SessionStructure, type SessionMap } from './session'

const SHARE_FORMAT = 'molvision-share'
/** base64url 编码后的长度上限（跨浏览器保守值：Firefox ~64KB / Safari ~80KB 之上留余量） */
const SHARE_LIMIT = 100_000
/** 命名选择 indices 数组体积护栏：超阈值且无表达式可重算的选择不入链 */
const SEL_INDICES_LIMIT = 2048

export interface SharedStructure {
  name: string
  format: 'pdb' | 'cif'
  /** 结构引用（RCSB PDB ID）——接收端据此重拉源文本 */
  pdbId: string
  reps: RepConfig[]
  colorOverrides: Record<number, string>
  /** r99-f1 E：配色备份随链透传（体积可忽略；接收端 resetColors 可回原始 scheme） */
  colorBackup?: Record<string, { colorScheme: RepConfig['colorScheme']; uniformColor?: string }>
  visible: boolean
  transform?: RigidTransform
  symmetry?: { radius: number; count: number }
  hiddenChains?: number[]
}

export interface ShareSnapshot {
  format: typeof SHARE_FORMAT
  version: 1
  savedAt: number
  activeIndex: number
  structures: SharedStructure[]
  /** 发送端被跳过的本地文件结构数（无公共 PDB ID 可引用）——接收端诚实提示 */
  skippedLocal: number
  settings: Settings
  camera: { pos: [number, number, number]; target: [number, number, number]; up?: [number, number, number]; fov?: number } | null
  namedSelections: { name: string; structureIndex: number; expr: string | null; indices: number[] | null; count: number }[]
  /** 视角书签（缩略图 dataURL 已剥离——接收端按需重生成） */
  views?: ViewBookmark[]
  map?: SessionMap
}

export type ShareLinkOutcome =
  | { ok: true; url: string; shared: number; skippedLocal: number; views: number; bytes: number }
  | { ok: false; reason: string }

// ---------- base64url（Unicode 安全：UTF-8 字节中转；分块防调用栈溢出） ----------

function b64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64UrlDecode(b64: string): string {
  const pad = b64.length % 4 === 2 ? '==' : b64.length % 4 === 1 ? '=' : ''
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

// ---------- 生成侧 ----------

/** 从当前工作区提取轻量快照并编码为分享 URL（#s=base64url）。
 *  无可分享结构（空场景 / 全部为本地文件结构）或快照超限时返回失败原因。 */
export function buildShareLink(): ShareLinkOutcome {
  const s = useMolStore.getState()
  if (!s.structures.length) {
    return { ok: false, reason: tt({ zh: '无可分享的会话（先加载结构）', en: 'Nothing to share (load a structure first)' }) }
  }
  const PDB_ID_RE = /^[0-9][A-Z0-9]{3}$/
  const shareable = s.structures.filter(st => st.meta.pdbId && PDB_ID_RE.test(st.meta.pdbId))
  if (!shareable.length) {
    return {
      ok: false,
      reason: tt({
        zh: '全部结构来自本地文件——分享链接需要 RCSB 结构（PDB ID 引用），可用「保存会话文件」走文件分享',
        en: 'All structures are local files — a share link needs RCSB structures (PDB ID refs); use "Save session file" to share as a file instead',
      }),
    }
  }
  const skippedLocal = s.structures.length - shareable.length
  // 命名选择重映射：仅指向可分享结构的入链；indices 超限且无 expr 可重算的整条跳过
  const idToNewIndex = new Map<string, number>()
  shareable.forEach((st, i) => idToNewIndex.set(st.id, i))
  let droppedSels = 0
  const namedSelections = s.namedSelections
    .map(ns => {
      const ni = idToNewIndex.get(ns.structureId)
      if (ni === undefined) return null
      if (ns.indices && ns.indices.length > SEL_INDICES_LIMIT) {
        if (ns.expr) return { name: ns.name, structureIndex: ni, expr: ns.expr, indices: null, count: ns.count }
        droppedSels++
        return null
      }
      return { name: ns.name, structureIndex: ni, expr: ns.expr, indices: ns.indices, count: ns.count }
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
  // 相机（与 saveSession 同源读取）
  const eng = engineRef.current
  const camera = eng
    ? {
      pos: eng.camera.position.toArray() as [number, number, number],
      target: eng.controls.target.toArray() as [number, number, number],
      up: eng.camera.up.toArray().map(v => +v.toFixed(4)) as [number, number, number],
      fov: +eng.camera.fov.toFixed(2),
    }
    : null
  // 密度图（SF 来源可重算；栅格与文件来源不入链——同 saveSession 语义）
  const mapInfo = useMapStore.getState().info
  const map: SessionMap | undefined = (mapInfo && mapInfo.source === 'sf' && mapInfo.pdbId && mapInfo.kind)
    ? {
      pdbId: mapInfo.pdbId,
      kind: mapInfo.kind,
      iso: mapInfo.iso,
      isoNeg: mapInfo.isoNeg,
      mode: mapInfo.mode,
      color: mapInfo.color,
      negColor: mapInfo.negColor,
      opacity: mapInfo.opacity,
      visible: mapInfo.visible,
    }
    : undefined
  // 视角书签（去 thumb dataURL——几十 KB/张的 JPEG 不入链）
  const vs = useViewsStore.getState()
  if (!vs.hydrated) vs.hydrate()
  const views = useViewsStore.getState().bookmarks.map(v => ({ ...v, thumb: null as null }))
  const activeIndex = s.activeId !== null ? (idToNewIndex.get(s.activeId) ?? 0) : 0
  const snap: ShareSnapshot = {
    format: SHARE_FORMAT,
    version: 1,
    savedAt: Date.now(),
    activeIndex,
    structures: shareable.map(st => ({
      name: st.name,
      format: st.format,
      pdbId: st.meta.pdbId as string,
      reps: st.reps,
      colorOverrides: st.colorOverrides,
      // r99-f1 E：配色备份随链（每 rep 一条，远小于旧版逐原子 overrides）
      colorBackup: st.colorBackup,
      visible: st.visible,
      transform: st.transform,
      symmetry: st.symmetry,
      hiddenChains: st.hiddenChains?.length ? st.hiddenChains : undefined,
    })),
    skippedLocal,
    settings: { ...s.settings, showHBonds: false },
    camera,
    namedSelections,
    ...(views.length ? { views } : {}),
    ...(map ? { map } : {}),
  }
  const b64 = b64UrlEncode(JSON.stringify(snap))
  if (b64.length > SHARE_LIMIT) {
    return {
      ok: false,
      reason: tt({
        zh: `快照过大（${(b64.length / 1024).toFixed(0)} KB 超上限 100 KB）——表示法/选择集过多，可精简后重试，或改用「保存会话文件」`,
        en: `Snapshot too large (${(b64.length / 1024).toFixed(0)} KB over the 100 KB limit) — trim representations/selections, or use "Save session file" instead`,
      }),
    }
  }
  if (droppedSels > 0) {
    useMolStore.getState().appendLog('out', tt({
      zh: `${droppedSels} 个大选择集（无表达式可重算）未包含在分享链接中`,
      en: `${droppedSels} large selection${droppedSels === 1 ? '' : 's'} (no expression to recompute) excluded from the share link`,
    }))
  }
  return { ok: true, url: `${location.origin}${location.pathname}#s=${b64}`, shared: shareable.length, skippedLocal, views: views.length, bytes: b64.length }
}

/** 生成分享链接并复制到剪贴板（Toolbar / ScenePanel / 命令面板 / 命令行统一入口）。 */
export async function copyShareLinkToClipboard(): Promise<boolean> {
  const r = buildShareLink()
  if (!r.ok) {
    toast.error(r.reason)
    return false
  }
  try {
    await navigator.clipboard.writeText(r.url)
    toast.success(tt({ zh: '分享链接已复制到剪贴板', en: 'Share link copied to clipboard' }), {
      description: tt({
        zh: `${r.shared} 个结构 · ${(r.bytes / 1024).toFixed(1)} KB${r.views ? ` · ${r.views} 个书签` : ''}${r.skippedLocal ? ` · 发送端 ${r.skippedLocal} 个本地文件结构未入链` : ''}——接收端打开链接即自动重拉结构`,
        en: `${r.shared} structure${r.shared === 1 ? '' : 's'} · ${(r.bytes / 1024).toFixed(1)} KB${r.views ? ` · ${r.views} bookmark${r.views === 1 ? '' : 's'}` : ''}${r.skippedLocal ? ` · ${r.skippedLocal} local-file structure${r.skippedLocal === 1 ? '' : 's'} not in the link` : ''} — structures re-fetch automatically on open`,
      }),
    })
    return true
  } catch {
    toast.error(tt({ zh: '复制失败（浏览器剪贴板权限）', en: 'Copy failed (browser clipboard permission)' }), {
      description: tt({ zh: '链接已生成——可在「会话」菜单重试，或用 session share 命令', en: 'Link generated — retry from the Session menu, or use the session share command' }),
    })
    return false
  }
}

// ---------- 接收侧 ----------

/** 校验 base64url 载荷并解析为快照；无效返回 null（decodeShareLink / 粘贴文本提取共用核心）。 */
function parseSharePayload(b64: string): ShareSnapshot | null {
  try {
    const snap = JSON.parse(b64UrlDecode(b64)) as ShareSnapshot
    if (!snap || snap.format !== SHARE_FORMAT || snap.version !== 1 || !Array.isArray(snap.structures) || !snap.structures.length) return null
    return snap
  } catch { return null }
}

/** 解析当前（或给定）URL 片段中的分享快照；无有效片段返回 null。 */
export function decodeShareLink(hash: string = typeof location !== 'undefined' ? location.hash : ''): ShareSnapshot | null {
  const m = /^#s=([A-Za-z0-9_-]+)$/.exec(hash)
  if (!m) return null
  return parseSharePayload(m[1])
}

/** 从任意粘贴文本（完整 URL / 裸 #s= 片段 / 带说明文字的混杂内容）中提取分享快照。
 *  非锚定全局匹配：多段命中时取最长且能通过协议校验的一段（载荷本体几乎必是
 *  最长 base64url；短段多为 URL 其他参数的误命中）。{16,} 下限拦意外短串。 */
export function extractShareSnapshotFromText(text: string): ShareSnapshot | null {
  const matches = text.match(/#s=([A-Za-z0-9_-]{16,})/g) ?? []
  let best: ShareSnapshot | null = null
  let bestLen = 0
  for (const m of matches) {
    const b64 = m.slice(3)
    if (b64.length <= bestLen) continue
    const snap = parseSharePayload(b64)
    if (snap) { best = snap; bestLen = b64.length }
  }
  return best
}

/** 从粘贴文本加载分享会话（欢迎页「从分享链接加载」入口）。
 *  与 consumeShareLinkOnBoot 的差异：手动路径无 hash 可清（不触碰地址栏）、
 *  找不到有效载荷时诚实报错而非静默退出（用户明确表达了加载意图）。 */
export async function applyShareLinkFromText(text: string): Promise<boolean> {
  const snap = extractShareSnapshotFromText(text.trim())
  if (!snap) {
    toast.error(tt({
      zh: '未在粘贴内容中找到 MolVision 分享链接',
      en: 'No MolVision share link found in the pasted text',
    }), {
      description: tt({
        zh: '分享链接形如 …#s=…（由「复制分享链接」生成）——请粘贴完整链接',
        en: 'A share link looks like …#s=… (from "Copy share link") — paste the full link',
      }),
    })
    return false
  }
  try {
    await applyShareSnapshot(snap)
    return true
  } catch (e) {
    toast.error(tt({ zh: `分享链接加载失败：${e instanceof Error ? e.message : String(e)}`, en: `Share link failed to load: ${e instanceof Error ? e.message : String(e)}` }), {
      description: tt({ zh: '可重试，或请分享方改用「保存会话文件」', en: 'Retry, or ask the sender to use "Save session file" instead' }),
    })
    return false
  }
}

/** 按快照重拉结构并恢复会话（替换语义——同「打开会话文件」）。
 *  返回恢复的结构数；全部拉取失败时抛错（调用方 toast）。 */
export async function applyShareSnapshot(snap: ShareSnapshot): Promise<number> {
  useMolStore.setState({ loading: true, loadingMsg: tt({ zh: '正在加载分享的会话…', en: 'Loading shared session…' }) })
  try {
    const PDB_ID_RE = /^[0-9][A-Z0-9]{3}$/
    const fetched: SessionStructure[] = []
    const okOrig: number[] = []  // snap.structures 中拉取成功的原始索引（重映射用）
    let failed = 0
    for (let i = 0; i < snap.structures.length; i++) {
      const ss = snap.structures[i]
      if (!ss?.pdbId || !PDB_ID_RE.test(ss.pdbId) || !Array.isArray(ss.reps)) { failed++; continue }
      try {
        const res = await fetch(`/api/pdb/${ss.pdbId}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const format = (res.headers.get('x-mol-format') as 'pdb' | 'cif') ?? ss.format ?? 'pdb'
        const text = await res.text()
        if (!text || text.length < 100) throw new Error('empty')
        fetched.push({
          name: ss.name || ss.pdbId,
          format,
          text,
          reps: ss.reps,
          colorOverrides: ss.colorOverrides ?? {},
          // r99-f1 E：配色备份随链透传（旧链缺省 = 从未改色，undefined 语义一致）
          colorBackup: ss.colorBackup,
          visible: ss.visible !== false,
          transform: ss.transform,
          symmetry: ss.symmetry,
          hiddenChains: ss.hiddenChains,
        })
        okOrig.push(i)
      } catch { failed++ }
    }
    if (!fetched.length) {
      throw new Error(tt({ zh: '分享链接中的结构全部拉取失败（网络离线或 RCSB 不可达）', en: 'All structures in the share link failed to fetch (offline or RCSB unreachable)' }))
    }
    // 命名选择 / 活动结构索引重映射到成功拉取的结构
    const origToNew = new Map(okOrig.map((oi, ni) => [oi, ni]))
    const namedSelections = (snap.namedSelections ?? [])
      .map(ns => {
        const ni = origToNew.get(ns.structureIndex)
        return ni === undefined ? null : { name: ns.name, structureIndex: ni, expr: ns.expr, indices: ns.indices, count: ns.count }
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
    const data: SessionData = {
      version: 1,
      savedAt: Date.now(),
      activeIndex: origToNew.get(Math.max(0, Math.min(snap.activeIndex, snap.structures.length - 1))) ?? 0,
      structures: fetched,
      settings: { ...snap.settings, showHBonds: false },
      camera: snap.camera ?? null,
      namedSelections,
      ...(snap.views?.length ? { views: snap.views } : {}),
      ...(snap.map ? { map: snap.map } : {}),
    }
    // 替换语义：清空现有结构（与 importSessionFile 同款；恢复后的自动存档
    // 自然接管——「点开分享链接 = 拥有这份会话」与「打开会话文件」语义一致）
    const store = useMolStore.getState()
    for (const st of [...store.structures]) store.removeStructure(st.id)
    const restored = restoreSessionData(data)
    if (!restored) throw new Error(tt({ zh: '分享快照恢复失败（结构数据无效）', en: 'Share snapshot restore failed (invalid structure data)' }))
    // 诚实总结：拉取失败数 / 发送端本地结构数 / 书签数
    const bits: string[] = []
    if (failed) bits.push(tt({ zh: `${failed} 个结构拉取失败`, en: `${failed} structure${failed === 1 ? '' : 's'} failed to fetch` }))
    if (snap.skippedLocal) bits.push(tt({ zh: `发送端 ${snap.skippedLocal} 个本地文件结构未入链`, en: `${snap.skippedLocal} local-file structure${snap.skippedLocal === 1 ? '' : 's'} at the sender were not in the link` }))
    if (snap.views?.length) bits.push(tt({ zh: `${snap.views.length} 个视角书签`, en: `${snap.views.length} view bookmark${snap.views.length === 1 ? '' : 's'}` }))
    toast.success(tt({ zh: `已从分享链接加载会话：${restored} 个结构`, en: `Session loaded from share link: ${restored} structure${restored === 1 ? '' : 's'}` }), {
      description: bits.length ? bits.join(' · ') : undefined,
    })
    return restored
  } finally {
    useMolStore.setState({ loading: false, loadingMsg: '' })
  }
}

/** 启动时消费 URL 片段中的分享链接（page.tsx 挂载一次性调用）。
 *  立即清除 hash（history.replaceState——防刷新重复加载/书签污染），再异步重拉恢复。
 *  幂等：StrictMode 双效应下第二次调用 hash 已清 → decode 返回 null 直接退出。 */
export async function consumeShareLinkOnBoot(): Promise<boolean> {
  if (typeof window === 'undefined') return false
  const snap = decodeShareLink()
  if (!snap) return false
  history.replaceState(null, '', location.pathname + location.search)
  try {
    await applyShareSnapshot(snap)
    return true
  } catch (e) {
    toast.error(tt({ zh: `分享链接加载失败：${e instanceof Error ? e.message : String(e)}`, en: `Share link failed to load: ${e instanceof Error ? e.message : String(e)}` }), {
      description: tt({ zh: '可刷新重试，或请分享方改用「保存会话文件」', en: 'Refresh to retry, or ask the sender to use "Save session file" instead' }),
    })
    return false
  }
}
