// 电子密度图加载：① RCSB 结构因子 → 模型相位 → 3D FFT 合成 2Fo−Fc / Fo−Fc 差图（Web Worker）；
// ② CCP4/MRC 文件直读。引擎持有几何（setDensityMap），本模块负责取数/计算/镜像状态到 map-store。
import { toast } from 'sonner'
import { tt, loc, useI18nStore } from '@/i18n'
import { engineRef, useMolStore, dataRegistry } from './store'
import { useMapStore, type MapInfoMirror } from './map-store'
import { parseSfCif, computeDensityMap, type ModelAtoms, type MapKind } from './sffourier'
import type { MapWorkerRequest, MapWorkerResponse } from './map-worker'
import { SlotLane } from './heavy-queue'
import { parseCcp4 } from './ccp4'
import { orthoMatrix, type CrystalCell } from './symmetry'
import type { StructureData } from './parser'

/** 结构包围盒（Å，含边距）对应的分数范围与体素索引窗口（允许跨胞界——密度周期回绕采样） */
function cropBounds(
  n: number,
  cell: CrystalCell,
  bboxMin: readonly [number, number, number],
  bboxMax: readonly [number, number, number],
  margin: number,
): { i0: [number, number, number]; i1: [number, number, number] } {
  const oi = orthoMatrix(cell).oi
  const fmin: [number, number, number] = [0, 0, 0]
  const fmax: [number, number, number] = [0, 0, 0]
  // 8 个角点变换到分数坐标取范围（非矩形包围盒在分数空间可能倾斜）
  for (let c = 0; c < 8; c++) {
    const px = (c & 1 ? bboxMax[0] : bboxMin[0]) + (c & 1 ? margin : -margin)
    const py = (c & 2 ? bboxMax[1] : bboxMin[1]) + (c & 2 ? margin : -margin)
    const pz = (c & 4 ? bboxMax[2] : bboxMin[2]) + (c & 4 ? margin : -margin)
    const fx = oi[0] * px + oi[1] * py + oi[2] * pz
    const fy = oi[3] * px + oi[4] * py + oi[5] * pz
    const fz = oi[6] * px + oi[7] * py + oi[8] * pz
    const fc = [fx, fy, fz]
    for (let d = 0; d < 3; d++) {
      if (c === 0 || fc[d] < fmin[d]) fmin[d] = fc[d]
      if (c === 0 || fc[d] > fmax[d]) fmax[d] = fc[d]
    }
  }
  const i0 = [0, 0, 0] as [number, number, number]
  const i1 = [0, 0, 0] as [number, number, number]
  for (let d = 0; d < 3; d++) {
    const span = Math.ceil((fmax[d] - fmin[d]) * n)
    if (span >= n) {
      // 结构+边距跨满一个周期 → 取整周期窗口（任意起点，密度周期性覆盖全部）
      i0[d] = Math.floor(fmin[d] * n)
      i1[d] = i0[d] + n
    } else {
      i0[d] = Math.floor(fmin[d] * n)
      i1[d] = Math.ceil(fmax[d] * n)
    }
  }
  return { i0, i1 }
}

/** 从全晶胞密度栅格裁出结构包围盒附近子网格（周期回绕采样；跨胞界结构正确处理；无需裁剪返回 null） */
function cropGrid(
  grid: Float32Array,
  n: number,
  cell: CrystalCell,
  bbox: { min: readonly [number, number, number]; max: readonly [number, number, number] },
  margin = 6,
): { grid: Float32Array; i0: [number, number, number]; dims: [number, number, number] } | null {
  const { i0, i1 } = cropBounds(n, cell, bbox.min, bbox.max, margin)
  const dims: [number, number, number] = [i1[0] - i0[0], i1[1] - i0[1], i1[2] - i0[2]]
  // 至少裁掉 25% 才值得复制（小晶胞/满周期场景跳过）
  if (dims[0] * dims[1] * dims[2] > n * n * n * 0.75) return null
  const out = new Float32Array(dims[0] * dims[1] * dims[2])
  const wrap = (v: number) => ((v % n) + n) % n
  for (let k = 0; k < dims[2]; k++) {
    const sk = wrap(i0[2] + k)
    for (let j = 0; j < dims[1]; j++) {
      const sj = wrap(i0[1] + j)
      const srcBase = (sk * n + sj) * n
      const dstBase = (k * dims[1] + j) * dims[0]
      for (let i = 0; i < dims[0]; i++) {
        out[dstBase + i] = grid[srcBase + wrap(i0[0] + i)]
      }
    }
  }
  return { grid: out, i0, dims }
}

/** 密度图外观参数（面板/命令/会话恢复共用；差图正负峰 σ 可独立） */
export interface MapLook {
  iso?: number
  isoNeg?: number
  mode?: 'surface' | 'mesh' | 'both'
  color?: string
  negColor?: string
  opacity?: number
  visible?: boolean
}

/** 同步引擎图层 → map-store 镜像 */
function syncMapMirror(
  source: MapInfoMirror['source'],
  ms: number,
  meta?: { pdbId?: string; kind?: MapKind },
) {
  const eng = engineRef.current
  const info = eng?.getMapInfo()
  if (!info) {
    useMapStore.getState().setInfo(null)
    return null
  }
  const mirror: MapInfoMirror = { ...info, source, ms, ...meta }
  useMapStore.getState().setInfo(mirror)
  return mirror
}

// ---------- 密度合成 Worker（单例；构造失败回退主线程） ----------

let mapWorker: Worker | null = null
let workerBroken = false
let workerReqId = 1
// 重计算并发闸：与其他 Worker 任务共享最多 2 个并发槽（防多任务满载）
const mapSlots = new SlotLane()

function ensureMapWorker(): Worker | null {
  if (workerBroken) return null
  if (mapWorker) return mapWorker
  try {
    mapWorker = new Worker(new URL('./map-worker.ts', import.meta.url))
    return mapWorker
  } catch {
    workerBroken = true
    return null
  }
}

/** Worker 内完成 文本解析 → FFT 合成（不阻塞主线程）；worker 不可用时 reject 由调用方回退 */
function computeDensityViaWorker(
  cifText: string,
  kind: MapKind,
  fallbackCell: CrystalCell | null,
  fallbackSpaceGroup: string,
  atoms: ModelAtoms,
): Promise<MapWorkerResponse> {
  return new Promise((resolve, reject) => {
    const w = ensureMapWorker()
    if (!w) {
      reject(new Error('worker-unavailable'))
      return
    }
    // 并发闸：槽位空出后再投递（排队期间用户可继续操作）
    void mapSlots.acquire(tt({ zh: '密度图合成', en: 'Density map synthesis' })).then(release => {
      const reqId = workerReqId++
      const cleanup = () => {
        w.removeEventListener('message', onMsg)
        w.removeEventListener('error', onFail)
        release()
      }
      const onMsg = (ev: MessageEvent<MapWorkerResponse>) => {
        if (!ev.data || ev.data.reqId !== reqId) return
        cleanup()
        if (ev.data.error || !ev.data.grid) reject(new Error(ev.data.error ?? tt({ zh: '空结果', en: 'Empty result' })))
        else resolve(ev.data)
      }
      const onFail = () => {
        cleanup()
        reject(new Error('worker-error'))
      }
      w.addEventListener('message', onMsg)
      w.addEventListener('error', onFail)
      const req: MapWorkerRequest = {
        type: 'compute', reqId, cifText, kind, fallbackCell, fallbackSpaceGroup, atoms,
        // 界面语言随请求线程化——worker 内错误文案用它选择双语
        locale: useI18nStore.getState().locale,
      }
      w.postMessage(req)
    })
  })
}

/**
 * 解析相位模型来源结构：① 显式 structureId（会话恢复路径）→ ② 已加载结构按 PDB 编号匹配
 * （优先活动结构）→ ③ 自动从 RCSB 加载并等待就绪（修复会话恢复缺结构时差图被跳过的问题）。
 * 返回 null = 无法获得相位模型（自动加载失败/超时）。
 */
async function resolvePhaseModel(pdbId: string, structureId?: string): Promise<{ id: string; data: StructureData } | null> {
  // ① 显式指定（会话恢复路径）
  if (structureId) {
    const d = dataRegistry.get(structureId)
    if (d) return { id: structureId, data: d }
  }
  // ② 已加载结构按编号匹配（活动结构优先，其次同名上传文件）
  const s1 = useMolStore.getState()
  const byPdb = s1.structures.find(x => x.id === s1.activeId && x.meta.pdbId?.toUpperCase() === pdbId)
    ?? s1.structures.find(x => x.meta.pdbId?.toUpperCase() === pdbId || x.name.toUpperCase() === pdbId)
  if (byPdb) {
    const d = dataRegistry.get(byPdb.id)
    if (d) return { id: byPdb.id, data: d }
  }
  // ③ 自动加载（loader ↔ map-load 有循环依赖，动态 import 解开）
  useMolStore.getState().appendLog('out', tt({ zh: `相位模型来源 ${pdbId} 未加载——自动从 RCSB 获取（密度图工作流）…`, en: `Phase-model source ${pdbId} not loaded — fetching from RCSB automatically (density map workflow)…` }))
  toast.info(tt({ zh: `正在自动加载结构 ${pdbId}`, en: `Auto-loading structure ${pdbId}` }), { description: tt({ zh: '密度图相位模型需要原子坐标，加载后自动继续计算', en: 'The density map phase model needs atomic coordinates; computation continues automatically after loading' }) })
  try {
    const { fetchPdbId } = await import('./loader')
    void fetchPdbId(pdbId)
  } catch {
    return null
  }
  const started = Date.now()
  const TIMEOUT = 45_000
  while (Date.now() - started < TIMEOUT) {
    await new Promise(r => setTimeout(r, 150))
    const st = useMolStore.getState()
    const hit = st.structures.find(x => x.meta.pdbId?.toUpperCase() === pdbId || x.name.toUpperCase() === pdbId)
    const d = hit ? dataRegistry.get(hit.id) : undefined
    if (hit && d) return { id: hit.id, data: d }
    // 加载已结束（成功/失败）但没有匹配结构 → 提前退出
    if (Date.now() - started > 1200 && !st.loading) break
  }
  return null
}

/** 从 RCSB 拉取结构因子并计算电子密度图（kind：2Fo−Fc 常规 / Fo−Fc 差图；look：会话恢复时的外观；structureId：相位模型来源，缺省活动结构） */
export async function fetchAndComputeMap(
  pdbIdRaw: string,
  kind: MapKind = '2fofc',
  look?: MapLook,
  structureId?: string,
): Promise<void> {
  const pdbId = pdbIdRaw.trim().toUpperCase()
  if (!/^[0-9][A-Z0-9]{3}$/.test(pdbId)) {
    toast.error(tt({ zh: `无效的 PDB 编号: "${pdbId}"`, en: `Invalid PDB ID: "${pdbId}"` }))
    return
  }
  const kindLabel = kind === 'fofc' ? tt({ zh: 'Fo−Fc 差图', en: 'Fo−Fc difference map' }) : '2Fo−Fc'
  useMapStore.getState().setComputing(true, tt({ zh: `正在获取 ${pdbId} 结构因子…`, en: `Fetching structure factors for ${pdbId}…` }))
  // 相位模型：显式指定 → 按编号匹配 → 自动加载（等待就绪）
  const phase = await resolvePhaseModel(pdbId, structureId)
  if (!phase) {
    useMapStore.getState().setComputing(false)
    toast.error(tt({ zh: `无法获得 ${pdbId} 的原子模型（相位来源）——自动加载失败，请先用 load ${pdbId} 加载后再试`, en: `Could not obtain the atomic model for ${pdbId} (phase source) — auto-load failed. Run load ${pdbId} first, then retry` }))
    useMolStore.getState().appendLog('err', tt({ zh: `密度图计算中止：无法获得 ${pdbId} 的原子模型（相位来源）`, en: `Density map computation aborted: could not obtain the atomic model for ${pdbId} (phase source)` }))
    return
  }
  const data = phase.data
  try {
    const res = await fetch(`/api/sf/${pdbId}`)
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error || tt({ zh: `获取失败 (${res.status})`, en: `Fetch failed (${res.status})` }))
    }
    const text = await res.text()
    const t0 = performance.now()
    const model: ModelAtoms = {
      pos: data.atoms.positions,
      elements: data.atoms.elements,
      bfactors: data.atoms.bfactors,
      occupancies: data.atoms.occupancies,
      count: data.atoms.count,
    }
    const fallbackCell: CrystalCell | null = data.crystal ? { ...data.crystal } : null
    const fallbackSg = data.crystal?.spaceGroup ?? ''

    // —— Worker 路径（不阻塞 UI）；worker 不可用 → 主线程同步回退 ——
    let result: {
      grid: Float32Array; n: number; cell: CrystalCell; reflnCount: number
      mean: number; rms: number; min: number; max: number
    }
    let usedWorker = true
    useMapStore.getState().setComputing(true, tt({ zh: `FFT 合成 ${kindLabel}（Web Worker，页面可继续交互）…`, en: `FFT synthesis of ${kindLabel} (Web Worker — the page stays interactive)…` }))
    try {
      const r = await computeDensityViaWorker(text, kind, fallbackCell, fallbackSg, model)
      if (!r.grid || !r.cell) throw new Error(tt({ zh: '空结果', en: 'Empty result' }))
      result = { grid: r.grid, n: r.n, cell: r.cell, reflnCount: r.reflnCount, mean: r.mean, rms: r.rms, min: r.min, max: r.max }
    } catch (werr) {
      if (werr instanceof Error && (werr.message === 'worker-unavailable' || werr.message === 'worker-error')) {
        usedWorker = false
        // 主线程回退（罕见环境无 Worker；同步阻塞但结果一致）
        useMapStore.getState().setComputing(true, tt({ zh: `FFT 合成 ${kindLabel}（主线程回退）…`, en: `FFT synthesis of ${kindLabel} (main-thread fallback)…` }))
        await new Promise(r => setTimeout(r, 30))
        const sf = parseSfCif(text, useI18nStore.getState().locale)
        if (sf.error) throw new Error(sf.error)
        if (sf.reflns.length < 50) throw new Error(tt({ zh: `有效反射过少（${sf.reflns.length} 条）`, en: `Too few valid reflections (${sf.reflns.length})` }))
        const cell: CrystalCell | null = sf.cell ?? fallbackCell
        if (!cell) throw new Error(tt({ zh: '结构因子文件与结构均无晶胞信息', en: 'No unit-cell info in either the structure-factor file or the structure' }))
        const spaceGroup = sf.spaceGroup || fallbackSg || 'P 1'
        const r = computeDensityMap(sf.reflns, cell, spaceGroup, model, kind, useI18nStore.getState().locale)
        if (r.error) throw new Error(r.error)
        result = { grid: r.grid, n: r.n, cell: r.cell, reflnCount: sf.reflns.length, mean: r.mean, rms: r.rms, min: r.min, max: r.max }
      } else {
        throw werr
      }
    }
    const eng = engineRef.current
    if (!eng) throw new Error(tt({ zh: '渲染引擎未就绪', en: 'Render engine not ready' }))
    // 裁剪到结构包围盒 ±6 Å（全晶胞栅格 MC 三角形过多且噪声主导；小晶胞自动跳过裁剪）
    let grid = result.grid
    let dims: [number, number, number] = [result.n, result.n, result.n]
    let fracOrigin: [number, number, number] = [0, 0, 0]
    const cropped = cropGrid(result.grid, result.n, result.cell, data.bbox, 6)
    if (cropped) {
      grid = cropped.grid
      dims = cropped.dims
      // i0 可为负（跨胞界窗口）——分数原点直接取 i0/n，线性矩阵自然处理
      fracOrigin = [cropped.i0[0] / result.n, cropped.i0[1] / result.n, cropped.i0[2] / result.n]
    }
    eng.setDensityMap({
      name: `${pdbId} ${kindLabel}`,
      grid,
      dims,
      fracOrigin,
      fracStep: [1 / result.n, 1 / result.n, 1 / result.n],
      cell: result.cell,
      mean: result.mean, rms: result.rms, min: result.min, max: result.max,
      difference: kind === 'fofc',
      iso: look?.iso,
      isoNeg: look?.isoNeg,
      mode: look?.mode,
      color: look?.color,
      negColor: look?.negColor,
      opacity: look?.opacity,
      visible: look?.visible ?? true,
    })
    const ms = performance.now() - t0
    syncMapMirror('sf', ms, { pdbId, kind })
    const log = useMolStore.getState().appendLog
    if (kind === 'fofc') {
      log('out', tt({ zh: `Fo−Fc 差图就绪（${pdbId}）：${result.reflnCount.toLocaleString(loc())} 条反射 · 网格 ${cropped ? `${dims.join('×')}（自 ${result.n}³ 裁剪）` : `${result.n}³`} · ${ms.toFixed(0)} ms · 默认 ±3σ（绿=正峰 模型缺失 / 红=负峰 模型多余）`, en: `Fo−Fc difference map ready (${pdbId}): ${result.reflnCount.toLocaleString(loc())} reflections · grid ${cropped ? `${dims.join('×')} (cropped from ${result.n}³)` : `${result.n}³`} · ${ms.toFixed(0)} ms · default ±3σ (green = positive peak, model missing / red = negative peak, model redundant)` }))
    } else {
      log('out', tt({ zh: `电子密度图就绪（${pdbId} 2Fo−Fc）：${result.reflnCount.toLocaleString(loc())} 条反射 · 网格 ${cropped ? `${dims.join('×')}（自 ${result.n}³ 裁剪）` : `${result.n}³`} · ${ms.toFixed(0)} ms · 默认 2σ 等值面`, en: `Electron density map ready (${pdbId} 2Fo−Fc): ${result.reflnCount.toLocaleString(loc())} reflections · grid ${cropped ? `${dims.join('×')} (cropped from ${result.n}³)` : `${result.n}³`} · ${ms.toFixed(0)} ms · default 2σ isosurface` }))
    }
    log('out', tt({ zh: `密度合成于 ${usedWorker ? 'Web Worker（主线程零阻塞）' : '主线程回退'} 完成`, en: `Density synthesis completed on ${usedWorker ? 'Web Worker (zero main-thread blocking)' : 'main-thread fallback'}` }))
    toast.success(kind === 'fofc' ? tt({ zh: 'Fo−Fc 差图已合成', en: 'Fo−Fc difference map synthesized' }) : tt({ zh: '电子密度图已合成', en: 'Electron density map synthesized' }), {
      description: tt({ zh: `${pdbId} ${kindLabel} · ${result.reflnCount.toLocaleString(loc())} 反射 · ${result.n}³ 网格 · ${ms.toFixed(0)} ms${usedWorker ? ' · Worker' : ' · 主线程'}`, en: `${pdbId} ${kindLabel} · ${result.reflnCount.toLocaleString(loc())} reflections · ${result.n}³ grid · ${ms.toFixed(0)} ms${usedWorker ? ' · Worker' : ' · main thread'}` }),
    })
    // 视角不强制改动（用户可能在检查局部）；不 fitView
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    useMapStore.getState().setComputing(false)
    useMapStore.getState().setInfo(null)
    toast.error(tt({ zh: `密度图计算失败：${msg}`, en: `Density map computation failed: ${msg}` }))
    useMolStore.getState().appendLog('err', tt({ zh: `密度图计算失败：${msg}`, en: `Density map computation failed: ${msg}` }))
  }
}

/** 读取 CCP4/MRC 地图文件（ArrayBuffer）并安装为密度图层 */
export function loadMapBuffer(buffer: ArrayBuffer, name: string): void {
  const parsed = parseCcp4(buffer)
  if ('error' in parsed) {
    toast.error(tt({ zh: `地图文件解析失败：${parsed.error}`, en: `Map file parsing failed: ${parsed.error}` }))
    useMolStore.getState().appendLog('err', tt({ zh: `地图文件解析失败：${parsed.error}（${name}）`, en: `Map file parsing failed: ${parsed.error} (${name})` }))
    return
  }
  const eng = engineRef.current
  if (!eng) {
    toast.error(tt({ zh: '渲染引擎未就绪', en: 'Render engine not ready' }))
    return
  }
  const t0 = performance.now()
  eng.setDensityMap({
    name,
    grid: parsed.data,
    dims: parsed.dims,
    fracOrigin: parsed.fracOrigin,
    fracStep: parsed.fracStep,
    cell: { a: parsed.cell[0], b: parsed.cell[1], c: parsed.cell[2], alpha: parsed.cell[3], beta: parsed.cell[4], gamma: parsed.cell[5] },
    mean: parsed.mean, rms: parsed.rms, min: parsed.min, max: parsed.max,
  })
  const ms = performance.now() - t0
  syncMapMirror('file', ms)
  useMolStore.getState().appendLog('out', tt({ zh: `已加载密度图 ${name}：${parsed.dims.join('×')} 体素 · 空间群 #${parsed.spaceGroup} · rms ${parsed.rms.toFixed(3)} · ${ms.toFixed(0)} ms`, en: `Density map loaded: ${name} · ${parsed.dims.join('×')} voxels · space group #${parsed.spaceGroup} · rms ${parsed.rms.toFixed(3)} · ${ms.toFixed(0)} ms` }))
  toast.success(tt({ zh: '密度图已加载', en: 'Density map loaded' }), { description: tt({ zh: `${name} · ${parsed.dims.join('×')} 体素`, en: `${name} · ${parsed.dims.join('×')} voxels` }) })
}

/** 移除密度图层 */
export function removeMap(): void {
  engineRef.current?.removeDensityMap()
  useMapStore.getState().setInfo(null)
}

/** 密度图外观调整（面板/命令共用；差图模式 color=正峰色 negColor=负峰色，isoNeg=负峰独立 σ） */
export function setMapLook(patch: MapLook): void {
  engineRef.current?.setMapAppearance(patch)
  const eng = engineRef.current
  const info = eng?.getMapInfo()
  if (!info) return
  const cur = useMapStore.getState().info
  useMapStore.getState().setInfo({
    ...info,
    source: cur?.source ?? 'sf',
    ms: cur?.ms ?? 0,
    // 引擎不持有 SF 来源元信息——从当前镜像带过去（会话存档依赖）
    pdbId: cur?.pdbId,
    kind: cur?.kind,
  })
}
