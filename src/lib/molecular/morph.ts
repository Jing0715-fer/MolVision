// 构象插值 morph（对标 PyMOL morph）：两个结构间生成插值轨迹对象
// 流程：链对贪心配对（NW 得分）→ 残基对内按原子名精确匹配 → B 在内存中自动叠合到 A 位姿
//      → 线性插值生成 N 帧 → subsetStructure 抽取匹配原子并挂 ensemble（复用 NMR 播放机制）
import type { StructureData } from './parser'
import { subsetStructure } from './parser'
import { extractAllSequences, alignSequences, superposeStructures, quatToMatrix } from './superpose'

export interface MorphResult {
  ok: boolean
  error?: string
  /** 新建结构（含 ensemble 帧） */
  data?: StructureData
  /** 匹配原子数 / 残基对数 */
  matchedAtoms: number
  matchedResidues: number
  /** 配对的链（A 链 ID → B 链 ID） */
  matchedChains: [string, string][]
  /** 插值帧数 */
  frames: number
  /** 自动叠合的 CA RMSD（Å）；null = 未做叠合（同源位姿直通或恒等匹配） */
  alignRmsd: number | null
  /** 使用的匹配策略 */
  strategy: 'sequence' | 'identity'
}

/** 原子名精确匹配残基对内的原子（双方都有同名原子才配对） */
function matchResidueAtoms(A: StructureData, B: StructureData, riA: number, riB: number, out: [number, number][]) {
  const rA = A.residues[riA]
  const rB = B.residues[riB]
  if (!rA || !rB) return
  const bByName = new Map<string, number>()
  for (let j = rB.start; j < rB.end; j++) {
    const nm = B.atoms.names[j]
    if (!bByName.has(nm)) bByName.set(nm, j)
  }
  for (let i = rA.start; i < rA.end; i++) {
    const j = bByName.get(A.atoms.names[i])
    if (j !== undefined) out.push([i, j])
  }
}

/** 链对贪心配对：按 NW 比对得分降序取对（每链只用一次，长度差 > 60% 跳过） */
function pairProteinChains(A: StructureData, B: StructureData) {
  const seqsA = extractAllSequences(A)
  const seqsB = extractAllSequences(B)
  type Scored = { sa: (typeof seqsA)[number]; sb: (typeof seqsB)[number]; pairs: [number, number][]; score: number }
  const scored: Scored[] = []
  for (const sa of seqsA) {
    for (const sb of seqsB) {
      if (Math.min(sa.sequence.length, sb.sequence.length) < 0.4 * Math.max(sa.sequence.length, sb.sequence.length)) continue
      const { pairs, score } = alignSequences(sa.sequence, sb.sequence)
      // 只保留全同残基对（morph 插值要求化学等价）
      let identical = 0
      for (const [i, j] of pairs) if (sa.sequence[i] === sb.sequence[j]) identical++
      scored.push({ sa, sb, pairs, score: score + identical })
    }
  }
  scored.sort((x, y) => y.score - x.score)
  const usedA = new Set<string>()
  const usedB = new Set<string>()
  const out: Omit<Scored, 'score'>[] = []
  for (const c of scored) {
    const ka = c.sa.chainId
    const kb = c.sb.chainId
    if (usedA.has(ka) || usedB.has(kb)) continue
    usedA.add(ka)
    usedB.add(kb)
    out.push(c)
  }
  return { pairs: out }
}

/**
 * 构建 morph 轨迹结构。
 * @param A 参考构象（轨迹起点，输出坐标系 = A 的当前世界位姿）
 * @param B 目标构象（会先在内存中自动叠合到 A，不改动 B 本身）
 * @param steps 插值帧数（10–120，含首尾）
 */
export function buildMorph(A: StructureData, B: StructureData, name: string, steps = 30): MorphResult {
  const fail = (msg: string): MorphResult => ({
    ok: false, error: msg, matchedAtoms: 0, matchedResidues: 0, matchedChains: [], frames: 0, alignRmsd: null, strategy: 'sequence',
  })

  const atomPairs: [number, number][] = []
  const matchedChains: [string, string][] = []
  let strategy: 'sequence' | 'identity' = 'sequence'

  // ---------- 策略 1：蛋白链序列比对配对 ----------
  const chainPairs = pairProteinChains(A, B)
  let matchedResidues = 0
  for (const cp of chainPairs.pairs) {
    let chainRes = 0
    for (const [ai, bi] of cp.pairs) {
      if (cp.sa.sequence[ai] !== cp.sb.sequence[bi]) continue // 化学等价才插值
      const riA = cp.sa.residueIdx[ai]
      const riB = cp.sb.residueIdx[bi]
      const before = atomPairs.length
      matchResidueAtoms(A, B, riA, riB, atomPairs)
      if (atomPairs.length > before) chainRes++
    }
    if (chainRes > 0) {
      matchedResidues += chainRes
      matchedChains.push([cp.sa.chainId.trim() || '?', cp.sb.chainId.trim() || '?'])
    }
  }

  // ---------- 策略 2（兜底）：同源结构按索引恒等匹配 ----------
  if (matchedResidues < 3) {
    atomPairs.length = 0
    matchedChains.length = 0
    matchedResidues = 0
    strategy = 'identity'
    if (A.atoms.count === B.atoms.count && A.atoms.count > 0) {
      let same = true
      for (let i = 0; i < A.atoms.count; i++) {
        if (
          A.atoms.names[i] !== B.atoms.names[i] ||
          A.atoms.chainIds[i] !== B.atoms.chainIds[i] ||
          A.atoms.resSeqs[i] !== B.atoms.resSeqs[i] ||
          A.atoms.resNames[i].toUpperCase() !== B.atoms.resNames[i].toUpperCase()
        ) { same = false; break }
      }
      if (same) {
        for (let i = 0; i < A.atoms.count; i++) atomPairs.push([i, i])
        matchedResidues = A.residues.length
        strategy = 'identity'
      }
    }
    if (!atomPairs.length) {
      return fail('两结构没有可匹配的原子：请确认是同源蛋白（序列相似），或完全相同的结构（同 PDB 不同构象）')
    }
  }

  // ---------- B 在内存中叠合到 A（蛋白场景；恒等匹配则跳过） ----------
  const bPos = B.atoms.positions
  let posB: Float32Array
  let alignRmsd: number | null = null
  if (strategy === 'sequence') {
    const res = superposeStructures(B, A)
    if (res.ok) {
      const m = quatToMatrix(res.quat)
      const [tx, ty, tz] = res.translation
      const n = B.atoms.count
      posB = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) {
        const x = bPos[i * 3], y = bPos[i * 3 + 1], z = bPos[i * 3 + 2]
        posB[i * 3] = m[0][0] * x + m[0][1] * y + m[0][2] * z + tx
        posB[i * 3 + 1] = m[1][0] * x + m[1][1] * y + m[1][2] * z + ty
        posB[i * 3 + 2] = m[2][0] * x + m[2][1] * y + m[2][2] * z + tz
      }
      alignRmsd = res.rmsd
    } else {
      // 无法叠合（如非蛋白）——按当前位姿直接插值（用户可能已手动 superpose）
      posB = bPos.slice()
    }
  } else {
    posB = bPos.slice()
  }

  // ---------- 生成插值帧 ----------
  const frames = Math.max(10, Math.min(120, Math.round(steps)))
  const n = atomPairs.length
  // 抽取 A 匹配原子子集（轨迹起点 = A 当前坐标）
  const idxA: number[] = new Array(n)
  for (let k = 0; k < n; k++) idxA[k] = atomPairs[k][0]
  let sub: StructureData
  try {
    sub = subsetStructure(A, idxA, name)
  } catch (e) {
    return fail(`子结构构建失败：${e instanceof Error ? e.message : String(e)}`)
  }
  // subset 的原子序 = idxA 升序；重建 atomPairs → 子结构索引映射
  const sorted = [...idxA].sort((a, b) => a - b)
  const mapAtoSub = new Map<number, number>()
  sorted.forEach((ai, si) => mapAtoSub.set(ai, si))
  // 目标坐标（子结构索引序）
  const target = new Float32Array(n * 3)
  for (let k = 0; k < n; k++) {
    const [ai, bi] = atomPairs[k]
    const si = mapAtoSub.get(ai)!
    target[si * 3] = posB[bi * 3]
    target[si * 3 + 1] = posB[bi * 3 + 1]
    target[si * 3 + 2] = posB[bi * 3 + 2]
  }
  const start = sub.atoms.positions
  const frameList: Float32Array[] = [start.slice()]
  for (let f = 1; f < frames; f++) {
    const t = f / (frames - 1)
    // smoothstep 缓动：首尾速度为零，播放观感更接近 PyMOL morph 的 spline 感
    const e = t * t * (3 - 2 * t)
    const buf = new Float32Array(n * 3)
    for (let i = 0; i < n * 3; i++) buf[i] = start[i] + (target[i] - start[i]) * e
    frameList.push(buf)
  }
  sub.ensemble = { frames: frameList }
  sub.ensembleKind = 'morph'

  return {
    ok: true,
    data: sub,
    matchedAtoms: n,
    matchedResidues: matchedResidues,
    matchedChains,
    frames,
    alignRmsd,
    strategy,
  }
}
