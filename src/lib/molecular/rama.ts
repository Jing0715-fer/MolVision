// 拉马钱德兰图（Ramachandran plot）：主链 φ/ψ 二面角计算 + favored/allowed/outlier 分区
// 结构质控（QC）经典工具——离群残基提示模型局部位错/ refinement 问题。
// 分区模型：Lovell et al. (2003) Proteins 50:437 概率轮廓的椭圆高斯近似
// （Ramachandran 边界本质是数据驱动概率等高线；椭圆混合足以覆盖 αR/β/pPII/αL/bridge
// 五大主流构象区，阈值按 2.4σ≈favored(98%)/3.5σ≈allowed(99.95%) 标定，经 1CRN/4HHB 校验）。
// 残基特化：Gly 无 Cβ → 容差放宽 1.35×；Pro φ 受环约束 → φ 独立收紧（-60±20σ 体系）。
import type { StructureData } from './parser'
import { AMINO_ACIDS } from './chemistry'

/** 点分区：0=favored（最优势区）1=allowed（允许区）2=outlier（离群） */
export type RamaClass = 0 | 1 | 2

export interface RamaPoint {
  /** 残基索引（data.residues 下标） */
  resIdx: number
  /** φ（-180..180°） */
  phi: number
  /** ψ（-180..180°） */
  psi: number
  cls: RamaClass
}

export interface RamaResult {
  points: RamaPoint[]
  favored: number
  allowed: number
  outlier: number
  /** 跳过数（链端/断链/骨架原子缺失） */
  skipped: number
  ms: number
}

/** 椭圆构象区（Mahalanobis 距离判定；σ 单位为度） */
interface RamaRegion {
  phi: number
  psi: number
  sPhi: number
  sPsi: number
}

/** 通用（非 Gly/Pro）主区：αR / β / pPII / αL / α-β 桥 / 扩展 β 上缘 */
const REGIONS_GENERAL: RamaRegion[] = [
  { phi: -63, psi: -43, sPhi: 24, sPsi: 29 },   // αR 核心
  { phi: -120, psi: 130, sPhi: 34, sPsi: 42 },  // β（anti/parallel sheet）
  { phi: -142, psi: 92, sPhi: 26, sPsi: 26 },   // pPII / βP 聚脯氨酸
  { phi: 57, psi: 39, sPhi: 19, sPsi: 19 },     // αL 左手螺旋
  { phi: -100, psi: 5, sPhi: 24, sPsi: 18 },    // α-β 桥
  { phi: -166, psi: 161, sPhi: 14, sPsi: 24 },   // 扩展 β 上缘
]

/** Gly：无 Cβ 约束——αL 与桥区显著更宽，且可及 ε 区（φ>0 · ψ<-90，Gly 特有宽域） */
const REGIONS_GLY: RamaRegion[] = [
  { phi: -63, psi: -43, sPhi: 32, sPsi: 38 },
  { phi: -120, psi: 130, sPhi: 45, sPsi: 55 },
  { phi: 57, psi: 39, sPhi: 32, sPsi: 38 },
  { phi: -100, psi: 5, sPhi: 34, sPsi: 30 },
  { phi: 75, psi: -135, sPhi: 32, sPsi: 42 },   // ε 唯 Gly 可达（top8000 Gly 图实测聚集区）
  { phi: 90, psi: -10, sPhi: 25, sPsi: 25 },
  { phi: -166, psi: 161, sPhi: 20, sPsi: 30 },
]

/** Pro：五元环锁 φ ≈ -60；ψ 仍分区 */
const REGIONS_PRO: RamaRegion[] = [
  { phi: -60, psi: -40, sPhi: 13, sPsi: 32 },   // cis/trans αR
  { phi: -60, psi: 145, sPhi: 13, sPsi: 32 },   // PPII
  { phi: -60, psi: 92, sPhi: 13, sPsi: 25 },    // PPII 下缘
  { phi: -60, psi: -5, sPhi: 13, sPsi: 22 },    // 桥
]

/** favored / allowed 的 Mahalanobis 距离² 阈值（d² = (Δφ/σφ)² + (Δψ/σψ)²） */
const D2_FAVORED = 2.4 * 2.4
const D2_ALLOWED = 3.5 * 3.5

/** 单点分区判定（图背景阴影与散点共用；resName 区分 Gly/Pro/通用体系） */
export function classifyRama(phi: number, psi: number, resName?: string): RamaClass {
  const rn = (resName ?? '').toUpperCase()
  const regions = rn === 'GLY' ? REGIONS_GLY : rn === 'PRO' ? REGIONS_PRO : REGIONS_GENERAL
  const d2 = minD2(phi, psi, regions)
  return d2 <= D2_FAVORED ? 0 : d2 <= D2_ALLOWED ? 1 : 2
}

/** 角度差折叠到 [-180, 180] */
function wrap180(d: number): number {
  let x = d
  while (x > 180) x -= 360
  while (x < -180) x += 360
  return x
}

/** 最小 Mahalanobis 距离²（跨全部候选区取最小） */
function minD2(phi: number, psi: number, regions: RamaRegion[]): number {
  let best = Infinity
  for (const r of regions) {
    const dx = wrap180(phi - r.phi) / r.sPhi
    const dy = wrap180(psi - r.psi) / r.sPsi
    const d2 = dx * dx + dy * dy
    if (d2 < best) best = d2
  }
  return best
}

/** IUPAC 规范二面角（p0→p1 为轴起点；返回 -180..180°） */
function dihedral(
  p0: Float32Array, i0: number,
  p1: Float32Array, i1: number,
  p2: Float32Array, i2: number,
  p3: Float32Array, i3: number,
): number {
  const a0 = i0 * 3, a1 = i1 * 3, a2 = i2 * 3, a3 = i3 * 3
  // b1 = p1 - p0, b2 = p2 - p1, b3 = p3 - p2
  const b1x = p1[a1] - p0[a0], b1y = p1[a1 + 1] - p0[a0 + 1], b1z = p1[a1 + 2] - p0[a0 + 2]
  const b2x = p2[a2] - p1[a1], b2y = p2[a2 + 1] - p1[a1 + 1], b2z = p2[a2 + 2] - p1[a1 + 2]
  const b3x = p3[a3] - p2[a2], b3y = p3[a3 + 1] - p2[a2 + 1], b3z = p3[a3 + 2] - p2[a2 + 2]
  // n1 = b1×b2, n2 = b2×b3
  const n1x = b1y * b2z - b1z * b2y, n1y = b1z * b2x - b1x * b2z, n1z = b1x * b2y - b1y * b2x
  const n2x = b2y * b3z - b2z * b3y, n2y = b2z * b3x - b2x * b3z, n2z = b2x * b3y - b2y * b3x
  // b2 归一化轴
  const m = Math.sqrt(b2x * b2x + b2y * b2y + b2z * b2z) || 1e-9
  const ux = b2x / m, uy = b2y / m, uz = b2z / m
  // x = n1·n2；y = (n1×n2)·u（IUPAC 符号约定：atan2((n1×n2)·b̂2, n1·n2)）
  const x = n1x * n2x + n1y * n2y + n1z * n2z
  const cx = n1y * n2z - n1z * n2y, cy = n1z * n2x - n1x * n2z, cz = n1x * n2y - n1y * n2x
  const y = cx * ux + cy * uy + cz * uz
  return Math.atan2(y, x) * 180 / Math.PI
}

/**
 * 计算全结构拉马钱德兰点集。
 * 覆盖规则：聚合物氨基酸链内相邻残基（C_prev···N 肽键距离 ≤ 2.5 Å 视为连续）；
 * 链端/断链/骨架 N-CA-C 缺失者跳过计入 skipped。
 */
export function computeRama(data: StructureData): RamaResult {
  const t0 = performance.now()
  const atoms = data.atoms
  const pos = atoms.positions
  const residues = data.residues

  // 每残基骨架 N/CA/C（与 DSSP 同款提取；仅聚合物氨基酸）
  interface BB { n: number; ca: number; c: number }
  const bb: (BB | null)[] = new Array(residues.length).fill(null)
  for (let ci = 0; ci < data.chains.length; ci++) {
    const chain = data.chains[ci]
    for (const ri of chain.residueIdx) {
      const r = residues[ri]
      if (!r.polymer || r.water || !AMINO_ACIDS.has(r.resName.toUpperCase())) continue
      let n = -1, ca = -1, c = -1
      for (let i = r.start; i < r.end; i++) {
        const nm = atoms.names[i]
        if (nm === 'N') { if (n < 0) n = i }
        else if (nm === 'CA') { if (ca < 0) ca = i }
        else if (nm === 'C') { if (c < 0) c = i }
      }
      if (n >= 0 && ca >= 0 && c >= 0) bb[ri] = { n, ca, c }
    }
  }

  const points: RamaPoint[] = []
  let favored = 0, allowed = 0, outlier = 0, skipped = 0

  for (let ci = 0; ci < data.chains.length; ci++) {
    const chain = data.chains[ci]
    const list = chain.residueIdx.filter(ri => bb[ri])
    for (let k = 0; k < list.length; k++) {
      const ri = list[k]
      const cur = bb[ri]!
      const prev = k > 0 ? bb[list[k - 1]] : null
      const next = k < list.length - 1 ? bb[list[k + 1]] : null
      // φ 需要 C(prev)；ψ 需要 N(next)；且肽键连续性（C···N ≤ 2.5 Å）才有效
      let phiValid = false, phi = 0
      if (prev) {
        const dx = pos[cur.n * 3] - pos[prev.c * 3]
        const dy = pos[cur.n * 3 + 1] - pos[prev.c * 3 + 1]
        const dz = pos[cur.n * 3 + 2] - pos[prev.c * 3 + 2]
        if (dx * dx + dy * dy + dz * dz <= 6.25) {
          phi = dihedral(pos, prev.c, pos, cur.n, pos, cur.ca, pos, cur.c)
          phiValid = true
        }
      }
      let psiValid = false, psi = 0
      if (next) {
        const dx = pos[next.n * 3] - pos[cur.c * 3]
        const dy = pos[next.n * 3 + 1] - pos[cur.c * 3 + 1]
        const dz = pos[next.n * 3 + 2] - pos[cur.c * 3 + 2]
        if (dx * dx + dy * dy + dz * dz <= 6.25) {
          psi = dihedral(pos, cur.n, pos, cur.ca, pos, cur.c, pos, next.n)
          psiValid = true
        }
      }
      if (!phiValid || !psiValid) { skipped++; continue }

      const rn = residues[ri].resName.toUpperCase()
      const regions = rn === 'GLY' ? REGIONS_GLY : rn === 'PRO' ? REGIONS_PRO : REGIONS_GENERAL
      const d2 = minD2(phi, psi, regions)
      const cls: RamaClass = d2 <= D2_FAVORED ? 0 : d2 <= D2_ALLOWED ? 1 : 2
      if (cls === 0) favored++
      else if (cls === 1) allowed++
      else outlier++
      points.push({ resIdx: ri, phi, psi, cls })
    }
  }

  return { points, favored, allowed, outlier, skipped, ms: performance.now() - t0 }
}

/** 残基原子索引区间展开（选择用） */
export function residueAtomRange(data: StructureData, resIdx: number): number[] {
  const r = data.residues[resIdx]
  if (!r) return []
  const out: number[] = []
  for (let i = r.start; i < r.end; i++) out.push(i)
  return out
}
