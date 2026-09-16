// 接触界面分析：两组原子选择间的重原子接触检测（对标 ChimeraX contacts / findclash）
// 判据：A 组与 B 组重原子距离 ≤ cutoff（默认 4.5 Å，ChimeraX contact 默认 6.0 / clash 0.9+0.9）
// 排除：同残基、氢/氘（重原子接触）、直接成键原子对
// 输出：残基对级聚合（最小距离 + 最近原子对 + 接触原子数），供 3D 连线与 2D 接触图谱使用
import type { StructureData } from './parser'
import { dataRegistry, engineRef, useMolStore, buildNamedMasks } from './store'
import { evaluateSelection } from './selection'
import { useContactStore } from './contacts-store'

export interface ContactPair {
  /** A 侧残基索引 */
  resA: number
  /** B 侧残基索引 */
  resB: number
  /** 最小重原子距离（Å） */
  minDist: number
  /** 最近原子对（A 侧 / B 侧原子索引） */
  atomA: number
  atomB: number
  /** 接触原子对计数 */
  count: number
}

export interface ContactOptions {
  cutoff?: number
}

export interface ContactResult {
  pairs: ContactPair[]
  /** A/B 侧界面残基索引（去重升序） */
  residuesA: number[]
  residuesB: number[]
  /** 参与检测的原子数 */
  atomsA: number
  atomsB: number
  ms: number
}

/** 检测两组选择间的接触（mask 为原子掩码） */
export function detectContacts(
  data: StructureData,
  aMask: Uint8Array,
  bMask: Uint8Array,
  opts: ContactOptions = {},
): ContactResult {
  const t0 = performance.now()
  const { cutoff = 4.5 } = opts
  const atoms = data.atoms
  const pos = atoms.positions
  const n = atoms.count
  const empty: ContactResult = { pairs: [], residuesA: [], residuesB: [], atomsA: 0, atomsB: 0, ms: performance.now() - t0 }

  // 直连键排除表
  const bonded = new Set<number>()
  for (let b = 0; b < data.bonds.count; b++) {
    const a1 = data.bonds.a[b], b1 = data.bonds.b[b]
    bonded.add(a1 * n + b1)
    bonded.add(b1 * n + a1)
  }

  // 重原子索引列表
  const listA: number[] = [], listB: number[] = []
  for (let i = 0; i < n; i++) {
    if (aMask[i]) listA.push(i)
    if (bMask[i]) listB.push(i)
  }
  if (!listA.length || !listB.length) return { ...empty, atomsA: listA.length, atomsB: listB.length }

  // 残基对聚合
  const nR = data.residues.length
  const pairMap = new Map<number, ContactPair>()
  const cut2 = cutoff * cutoff
  for (const a of listA) {
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2]
    const cand = data.grid.queryRadius(ax, ay, az, cutoff, pos)
    const resA = data.atomResidue[a]
    for (const b of cand) {
      if (!bMask[b]) continue
      const resB = data.atomResidue[b]
      if (resA === resB) continue
      if (bonded.has(a * n + b)) continue
      const dx = pos[b * 3] - ax, dy = pos[b * 3 + 1] - ay, dz = pos[b * 3 + 2] - az
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > cut2) continue
      const dist = Math.sqrt(d2)
      const key = resA * nR + resB
      const existing = pairMap.get(key)
      if (existing) {
        existing.count++
        if (dist < existing.minDist) {
          existing.minDist = dist
          existing.atomA = a
          existing.atomB = b
        }
      } else {
        pairMap.set(key, { resA, resB, minDist: dist, atomA: a, atomB: b, count: 1 })
      }
    }
  }

  const pairs = [...pairMap.values()].sort((p, q) => p.minDist - q.minDist)
  const setA = new Set<number>(), setB = new Set<number>()
  for (const p of pairs) {
    setA.add(p.resA)
    setB.add(p.resB)
  }
  return {
    pairs,
    residuesA: [...setA].sort((x, y) => x - y),
    residuesB: [...setB].sort((x, y) => x - y),
    atomsA: listA.length,
    atomsB: listB.length,
    ms: performance.now() - t0,
  }
}

/** 距离 → 接触线颜色（近 = 红 #ef4444，远 = 琥珀 #f59e0b；t∈[0,1]） */
export function contactColor(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t))
  // 线性插值 red(239,68,68) → amber(245,158,11)
  return [
    (239 + (245 - 239) * c) / 255,
    (68 + (158 - 68) * c) / 255,
    (68 + (11 - 68) * c) / 255,
  ]
}

// ---------- 分析运行器（面板 / 命令行共用） ----------

export interface RunContactOutcome {
  ok: boolean
  message: string
}

/** 求值两组表达式 → 检测接触 → 更新 store + 引擎连线渲染 */
export function runContactAnalysis(aExpr?: string, bExpr?: string, cutoff?: number): RunContactOutcome {
  const store = useMolStore.getState()
  const cs = useContactStore.getState()
  if (!store.activeId) return { ok: false, message: '没有活动结构' }
  const data = dataRegistry.get(store.activeId)
  if (!data) return { ok: false, message: '结构数据不存在' }
  const A = (aExpr ?? cs.aExpr).trim()
  const B = (bExpr ?? cs.bExpr).trim()
  const cut = cutoff ?? cs.cutoff
  if (!A || !B) return { ok: false, message: '请提供 A/B 两组选择表达式' }

  const named = buildNamedMasks(store.activeId, data)
  const ra = evaluateSelection(A, { structure: data, named })
  const rb = evaluateSelection(B, { structure: data, named })
  const errors: { a?: string; b?: string } = {}
  if (ra.error) errors.a = ra.error
  if (rb.error) errors.b = rb.error
  // 同步表达式与参数到 store（面板反映命令行调用）
  useContactStore.setState({ aExpr: A, bExpr: B, cutoff: cut, defaulted: true })
  if (ra.error || rb.error) {
    useContactStore.getState().setResult({ structureId: store.activeId, pairs: [], residuesA: [], residuesB: [], atomsA: ra.count, atomsB: rb.count, errors })
    engineRef.current?.updateContacts()
    return { ok: false, message: `表达式错误：${[errors.a, errors.b].filter(Boolean).join('；')}` }
  }
  if (ra.count === 0 || rb.count === 0) {
    useContactStore.getState().setResult({ structureId: store.activeId, pairs: [], residuesA: [], residuesB: [], atomsA: ra.count, atomsB: rb.count })
    engineRef.current?.updateContacts()
    return { ok: false, message: `选择为空（A: ${ra.count} 原子，B: ${rb.count} 原子）` }
  }

  const result = detectContacts(data, ra.mask, rb.mask, { cutoff: cut })
  useContactStore.getState().setResult({
    structureId: store.activeId,
    pairs: result.pairs,
    residuesA: result.residuesA,
    residuesB: result.residuesB,
    atomsA: result.atomsA,
    atomsB: result.atomsB,
  })
  engineRef.current?.updateContacts()
  if (!result.pairs.length) {
    return { ok: true, message: `未发现接触（A: ${ra.count} 原子 ↔ B: ${rb.count} 原子，截断 ${cut} Å，${result.ms.toFixed(0)} ms）——两组可能不相邻或距离超过截断值` }
  }
  const nearest = result.pairs[0]
  const fmtRes = (ri: number) => {
    const r = data.residues[ri]
    return `${r.chainId.trim() || '?'}:${r.resName}${r.resSeq}`
  }
  return {
    ok: true,
    message: `${result.pairs.length} 对残基接触（A: ${ra.count} ↔ B: ${rb.count} 原子，截断 ${cut} Å，${result.ms.toFixed(0)} ms）· 界面残基 A ${result.residuesA.length} / B ${result.residuesB.length} · 最近 ${fmtRes(nearest.resA)} ↔ ${fmtRes(nearest.resB)} ${nearest.minDist.toFixed(2)} Å`,
  }
}

/** 界面残基 → 原子索引列表（供选择/高亮） */
export function interfaceAtomIndices(data: StructureData, residues: number[]): number[] {
  const out: number[] = []
  for (const ri of residues) {
    const r = data.residues[ri]
    for (let i = r.start; i < r.end; i++) out.push(i)
  }
  return out
}
