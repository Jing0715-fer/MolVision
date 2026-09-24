// 密度合成 Web Worker：SF mmCIF 文本 → parseSfCif → computeDensityMap（2Fo−Fc / Fo−Fc 差图）。
// 3D FFT 双程（256³）在主线程需 6–14s 且阻塞交互，全部移入本 Worker；
// 文本解析（~3MB）也在 worker 完成，主线程只负责 fetch。
// 与 hbond-worker / sasa-worker 同构：globalThis cast 的 postMessage/onmessage 协议。

import { parseSfCif, computeDensityMap, type ModelAtoms, type MapKind } from './sffourier'
import type { CrystalCell } from './symmetry'
import type { Locale } from '@/i18n/locales'

export interface MapWorkerRequest {
  type: 'compute'
  reqId: number
  /** 界面语言（主线程随请求线程化；worker 内错误文案双语选择，缺省 zh） */
  locale?: Locale
  /** SF mmCIF 全文（结构化克隆字符串，~3MB 可接受） */
  cifText: string
  /** 合成类型：2Fo−Fc 常规 / Fo−Fc 差图 */
  kind: MapKind
  /** SF 文件缺晶胞/空间群时的兜底（结构 CRYST1） */
  fallbackCell: CrystalCell | null
  fallbackSpaceGroup: string
  /** 模型原子（相位来源；坐标/元素/B/占据数） */
  atoms: ModelAtoms
}

export interface MapWorkerResponse {
  type: 'result'
  reqId: number
  kind: MapKind
  error?: string
  /** 合成密度栅格（n³，transfer） */
  grid?: Float32Array
  n: number
  /** 实际使用的晶胞/空间群（回传主线程用于裁剪矩阵） */
  cell: CrystalCell | null
  spaceGroup: string
  reflnCount: number
  mean: number
  rms: number
  min: number
  max: number
  scale: number
  ms: number
}

const ctx = globalThis as unknown as {
  postMessage: (message: unknown, transfer?: Transferable[]) => void
  onmessage: ((event: MessageEvent<MapWorkerRequest>) => void) | null
}

// worker 侧语言（请求到达时更新；store 无法跨线程同步，经请求载荷线程化）
let workerLocale: Locale = 'zh'

/** worker 内双语文案选择 */
function wt(zh: string, en: string): string {
  return workerLocale === 'en' ? en : zh
}

ctx.onmessage = (e: MessageEvent<MapWorkerRequest>) => {
  const msg = e.data
  if (!msg || msg.type !== 'compute') return
  workerLocale = msg.locale === 'en' ? 'en' : 'zh'
  const t0 = performance.now()
  const base = {
    type: 'result' as const,
    reqId: msg.reqId,
    kind: msg.kind,
    n: 0,
    cell: null as CrystalCell | null,
    spaceGroup: '',
    reflnCount: 0,
    mean: 0,
    rms: 0,
    min: 0,
    max: 0,
    scale: 0,
    ms: performance.now() - t0,
  }
  try {
    const sf = parseSfCif(msg.cifText, workerLocale)
    if (sf.error) {
      ctx.postMessage({ ...base, error: sf.error })
      return
    }
    if (sf.reflns.length < 50) {
      ctx.postMessage({ ...base, error: wt(`有效反射过少（${sf.reflns.length} 条）`, `Too few valid reflections (${sf.reflns.length})`) })
      return
    }
    const cell = sf.cell ?? msg.fallbackCell
    if (!cell) {
      ctx.postMessage({ ...base, error: wt('结构因子文件与结构均无晶胞信息', 'No unit-cell info in either the structure-factor file or the structure') })
      return
    }
    const spaceGroup = sf.spaceGroup || msg.fallbackSpaceGroup || 'P 1'
    const result = computeDensityMap(sf.reflns, cell, spaceGroup, msg.atoms, msg.kind, workerLocale)
    if (result.error) {
      ctx.postMessage({ ...base, error: result.error })
      return
    }
    const resp: MapWorkerResponse = {
      ...base,
      grid: result.grid,
      n: result.n,
      cell: result.cell,
      spaceGroup,
      reflnCount: sf.reflns.length,
      mean: result.mean,
      rms: result.rms,
      min: result.min,
      max: result.max,
      scale: result.scale,
      ms: performance.now() - t0,
    }
    ctx.postMessage(resp, [result.grid.buffer])
  } catch (err) {
    ctx.postMessage({ ...base, error: err instanceof Error ? err.message : String(err) })
  }
}
