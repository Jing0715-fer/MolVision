// 电子密度图加载：① RCSB 结构因子 → 模型相位 → 3D FFT 合成 2Fo−Fc；② CCP4/MRC 文件直读
// 引擎持有几何（setDensityMap），本模块负责取数/计算/镜像状态到 map-store
import { toast } from 'sonner'
import { engineRef, useMolStore, dataRegistry } from './store'
import { useMapStore, type MapInfoMirror } from './map-store'
import { parseSfCif, computeDensityMap, type ModelAtoms } from './sffourier'
import { parseCcp4 } from './ccp4'
import { orthoMatrix, type CrystalCell } from './symmetry'

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

/** 同步引擎图层 → map-store 镜像 */
function syncMapMirror(source: MapInfoMirror['source'], ms: number) {
  const eng = engineRef.current
  const info = eng?.getMapInfo()
  if (!info) {
    useMapStore.getState().setInfo(null)
    return null
  }
  const mirror: MapInfoMirror = { ...info, source, ms }
  useMapStore.getState().setInfo(mirror)
  return mirror
}

/** 从 RCSB 拉取结构因子并用当前活动结构计算 2Fo−Fc 电子密度图 */
export async function fetchAndComputeMap(pdbIdRaw: string): Promise<void> {
  const pdbId = pdbIdRaw.trim().toUpperCase()
  const store = useMolStore.getState()
  if (!store.activeId) {
    toast.error('请先加载结构（密度图相位需要原子模型）')
    return
  }
  const data = dataRegistry.get(store.activeId)
  if (!data) return
  if (!/^[0-9][A-Z0-9]{3}$/.test(pdbId)) {
    toast.error(`无效的 PDB 编号: "${pdbId}"`)
    return
  }
  useMapStore.getState().setComputing(true, `正在获取 ${pdbId} 结构因子…`)
  try {
    const res = await fetch(`/api/sf/${pdbId}`)
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error || `获取失败 (${res.status})`)
    }
    const text = await res.text()
    useMapStore.getState().setComputing(true, '解析反射表…')
    await new Promise(r => setTimeout(r, 30)) // 让 UI 先更新
    const t0 = performance.now()
    const sf = parseSfCif(text)
    if (sf.error) throw new Error(sf.error)
    if (sf.reflns.length < 50) throw new Error(`有效反射过少（${sf.reflns.length} 条）`)
    // 晶胞：优先 SF 文件，缺失时用结构 CRYST1
    const cell: CrystalCell | null = sf.cell ?? (data.crystal ? { ...data.crystal } : null)
    if (!cell) throw new Error('结构因子文件与结构均无晶胞信息')
    const spaceGroup = sf.spaceGroup || data.crystal?.spaceGroup || 'P 1'
    useMapStore.getState().setComputing(true, `FFT 合成 2Fo−Fc（${sf.reflns.length.toLocaleString()} 条反射）…`)
    await new Promise(r => setTimeout(r, 30))
    const model: ModelAtoms = {
      pos: data.atoms.positions,
      elements: data.atoms.elements,
      bfactors: data.atoms.bfactors,
      occupancies: data.atoms.occupancies,
      count: data.atoms.count,
    }
    const result = computeDensityMap(sf.reflns, cell, spaceGroup, model)
    if (result.error) throw new Error(result.error)
    const eng = engineRef.current
    if (!eng) throw new Error('渲染引擎未就绪')
    // 裁剪到结构包围盒 ±6 Å（全晶胞栅格 MC 三角形过多且噪声主导；小晶胞自动跳过裁剪）
    let grid = result.grid
    let dims: [number, number, number] = [result.n, result.n, result.n]
    let fracOrigin: [number, number, number] = [0, 0, 0]
    const cropped = cropGrid(result.grid, result.n, cell, data.bbox, 6)
    if (cropped) {
      grid = cropped.grid
      dims = cropped.dims
      // i0 可为负（跨胞界窗口）——分数原点直接取 i0/n，线性矩阵自然处理
      fracOrigin = [cropped.i0[0] / result.n, cropped.i0[1] / result.n, cropped.i0[2] / result.n]
    }
    eng.setDensityMap({
      name: `${pdbId} 2Fo−Fc`,
      grid,
      dims,
      fracOrigin,
      fracStep: [1 / result.n, 1 / result.n, 1 / result.n],
      cell: result.cell,
      mean: result.mean, rms: result.rms, min: result.min, max: result.max,
    })
    const ms = performance.now() - t0
    const mirror = syncMapMirror('sf', ms)
    const log = useMolStore.getState().appendLog
    log('out', `电子密度图就绪（${pdbId} 2Fo−Fc）：${sf.reflns.length.toLocaleString()} 条反射 · 网格 ${cropped ? `${dims.join('×')}（自 ${result.n}³ 裁剪）` : `${result.n}³`} · ${ms.toFixed(0)} ms · 默认 2σ 等值面`)
    toast.success(`电子密度图已合成`, {
      description: `${pdbId} 2Fo−Fc · ${sf.reflns.length.toLocaleString()} 反射 · ${result.n}³ 网格 · ${ms.toFixed(0)} ms`,
    })
    void mirror
    // 视角不强制改动（用户可能在检查局部）；不 fitView
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    useMapStore.getState().setComputing(false)
    useMapStore.getState().setInfo(null)
    toast.error(`密度图计算失败：${msg}`)
    useMolStore.getState().appendLog('err', `密度图计算失败：${msg}`)
  }
}

/** 读取 CCP4/MRC 地图文件（ArrayBuffer）并安装为密度图层 */
export function loadMapBuffer(buffer: ArrayBuffer, name: string): void {
  const parsed = parseCcp4(buffer)
  if ('error' in parsed) {
    toast.error(`地图文件解析失败：${parsed.error}`)
    useMolStore.getState().appendLog('err', `地图文件解析失败：${parsed.error}（${name}）`)
    return
  }
  const eng = engineRef.current
  if (!eng) {
    toast.error('渲染引擎未就绪')
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
  useMolStore.getState().appendLog('out', `已加载密度图 ${name}：${parsed.dims.join('×')} 体素 · 空间群 #${parsed.spaceGroup} · rms ${parsed.rms.toFixed(3)} · ${ms.toFixed(0)} ms`)
  toast.success(`密度图已加载`, { description: `${name} · ${parsed.dims.join('×')} 体素` })
}

/** 移除密度图层 */
export function removeMap(): void {
  engineRef.current?.removeDensityMap()
  useMapStore.getState().setInfo(null)
}

/** 密度图外观调整（面板/命令共用） */
export function setMapLook(patch: { iso?: number; mode?: 'surface' | 'mesh' | 'both'; color?: string; opacity?: number; visible?: boolean }): void {
  engineRef.current?.setMapAppearance(patch)
  const eng = engineRef.current
  const info = eng?.getMapInfo()
  if (!info) return
  const cur = useMapStore.getState().info
  useMapStore.getState().setInfo({
    ...info,
    source: cur?.source ?? 'sf',
    ms: cur?.ms ?? 0,
  })
}
