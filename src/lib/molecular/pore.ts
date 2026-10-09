// HOLE 式离子通道孔道剖面分析（r72；r100 轴检测根修）
// ─────────────────────────────────────────────────────────────────────────────
// 对标 Smart/Ogden/Wallace 的 HOLE 程序（Biophys J, 1996）核心输出：沿通道轴逐点
// 计算能放入孔道而不与蛋白原子（vdW 半径）碰撞的最大球半径 R(t)，产出：
//  · 孔道剖面曲线（3D 环带 + 2D 剖面卡，红/绿/蓝三分区=HOLE 惯例色）
//  · 收缩点（constriction）位置与半径——通道开关/选择性滤波器的关键读数
//  · 膜蛋白语境：membrane 命令画脂双层板（孔道分析图的标配语境）
//
// 通道轴检测（r100 两级）：
//  ① 同构链对 Kabsch 对称轴投票（优先）：寡聚体通道（C4/C5/C6…）的同构亚基间
//     刚体旋转轴 = 寡聚体对称轴 = 孔道轴。9P6B（全长人 TRPV1，含大 ARD 胞内域）
//     实证：全原子 PCA 主轴歪 18°（特征值 734/728/721 近简并，「蘑菇形」整体
//     近各向同性），对称投票 6/6 票一击命中 C4 轴（|1-z|<0.003）。
//  ② 聚合物主方差轴（PCA 兜底）：单体结构/对称检测失败时与 r72-r99 行为一致
//     （KcsA 1BL8 实证主轴即孔轴）。
//  跨膜腰扫描（r100）：轴确定后沿轴做横向 RMS 半径剖面，跨膜螺旋束是「腰」
//  （横向半径局部最小 + 双向收腰），膜中心/剖面采样区间锚定腰心而非包围盒中点
//  ——9P6B 实证：盒中点偏离跨膜区 31Å（膜插进 ARD），腰心偏差仅 5Å。
//  采样区间 = 腰窗 ± 两端腔延伸（HOLE 语义：跨膜孔+口腔，非全长）：
//  9P6B 实测剖面还原 TRPV1 双门结构（选择性滤波器 r≈0.7Å + 下门 r≈0.9Å）。
//
// 剖面算法（简明球拟合，与 HOLE 同族）：
//  · 轴上采样 N 点：R(t) = min_i(|a_i − p(t)| − vdw_i)，封顶 maxR（封顶=bulk/开口腔）
//  · 采样窗口剪枝：原子按 t 排序 + 二分定位窗口（|t_i − t| < maxR + maxVdw），
//    60K 原子结构也能毫秒级完成（纯计算无 worker 依赖）
// 计入原子 = 聚合物（蛋白/核酸）全部原子；水/配体/离子不计（孔道几何由蛋白壁决定，
// 与 HOLE 惯例一致——通道内的离子会错误地把剖面「压死」在轴上）。
import { tt } from '@/i18n'
import type { StructureData } from './parser'
import { elementInfo } from './chemistry'
import { dataRegistry, engineRef, useMolStore } from './store'
import { usePoreStore, type PoreResult, type PoreSample } from './pore-store'

/** HOLE 三分区阈值（Å）：红=过窄（水合离子难通过）/ 绿=单水合 K⁺ 可过 / 蓝=宽敞 */
export const HOLE_NARROW = 1.15
export const HOLE_MAX_GREEN = 2.3

/** 孔道分区色（HOLE 惯例；数据编码色非 UI 主题色） */
export const PORE_ZONE_COLORS = { narrow: '#dc2626', mid: '#16a34a', wide: '#2563eb' } as const

export function poreZoneColor(r: number): string {
  if (r < HOLE_NARROW) return PORE_ZONE_COLORS.narrow
  if (r < HOLE_MAX_GREEN) return PORE_ZONE_COLORS.mid
  return PORE_ZONE_COLORS.wide
}

/** 3×3 对称阵 Jacobi 特征分解（engine.ts 同款数学，独立副本避免循环依赖） */
function eigenSymmetric3(a: number[]): { vals: number[]; vecs: number[][] } {
  const m = [...a]
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  for (let sweep = 0; sweep < 16; sweep++) {
    let off = 0
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += m[i * 3 + j] * m[i * 3 + j]
    if (off < 1e-12) break
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(m[p * 3 + q]) < 1e-14) continue
        const theta = (m[q * 3 + q] - m[p * 3 + p]) / (2 * m[p * 3 + q])
        const t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < 3; k++) {
          const mkp = m[k * 3 + p]
          const mkq = m[k * 3 + q]
          m[k * 3 + p] = c * mkp - s * mkq
          m[k * 3 + q] = s * mkp + c * mkq
        }
        for (let k = 0; k < 3; k++) {
          const mpk = m[p * 3 + k]
          const mqk = m[q * 3 + k]
          m[p * 3 + k] = c * mpk - s * mqk
          m[q * 3 + k] = s * mpk + c * mqk
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k * 3 + p]
          const vkq = v[k * 3 + q]
          v[k * 3 + p] = c * vkp - s * vkq
          v[k * 3 + q] = s * vkp + c * vkq
        }
      }
    }
  }
  const vals = [m[0], m[4], m[8]]
  const vecs = [[v[0], v[3], v[6]], [v[1], v[4], v[7]], [v[2], v[5], v[8]]]
  return { vals, vecs }
}

/** 聚合物原子集合上的主轴（最大方差方向）+ 质心（r72 起的兜底路径） */
export function principalAxis(data: StructureData): { origin: [number, number, number]; dir: [number, number, number] } {
  const pos = data.atoms.positions
  const residues = data.residues
  // 聚合物残基原子（排除水/配体/离子：膜几何由蛋白壁决定）
  let n = 0
  let cx = 0, cy = 0, cz = 0
  for (let ri = 0; ri < residues.length; ri++) {
    const r = residues[ri]
    if (!r.polymer || r.water) continue
    for (let i = r.start; i < r.end; i++) {
      cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; n++
    }
  }
  if (n === 0) {
    // 退化：非聚合物结构（纯配体）用全部原子
    for (let i = 0; i < data.atoms.count; i++) {
      cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2]; n++
    }
  }
  cx /= n; cy /= n; cz /= n
  // 协方差（聚合物原子；退化时全原子）
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0
  const acc = (i: number) => {
    const dx = pos[i * 3] - cx, dy = pos[i * 3 + 1] - cy, dz = pos[i * 3 + 2] - cz
    xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz
  }
  if (n > 0 && residues.some(r => r.polymer && !r.water)) {
    for (let ri = 0; ri < residues.length; ri++) {
      const r = residues[ri]
      if (!r.polymer || r.water) continue
      for (let i = r.start; i < r.end; i++) acc(i)
    }
  } else {
    for (let i = 0; i < data.atoms.count; i++) acc(i)
  }
  const { vals, vecs } = eigenSymmetric3([xx, xy, xz, xy, yy, yz, xz, yz, zz])
  let best = 0
  for (let i = 1; i < 3; i++) if (vals[i] > vals[best]) best = i
  const d = vecs[best]
  const len = Math.hypot(d[0], d[1], d[2]) || 1
  return { origin: [cx, cy, cz], dir: [d[0] / len, d[1] / len, d[2] / len] }
}

// ─────────────────────────────────────────────────────────────────────────────
// r100：同构链对 Kabsch 对称轴投票（通道轴检测优先路径）
// ─────────────────────────────────────────────────────────────────────────────

/** Kabsch 刚体对齐（3×3，特征分解式 SVD；行向量约定 q' = q·R）
 *  返回最优旋转的不动轴（对称轴）。axis 为 null = 恒等/退化变换（无轴可言）。 */
function kabschAxis(P: number[], Q: number[]): [number, number, number] | null {
  const n = P.length / 3
  // 去质心
  let pcx = 0, pcy = 0, pcz = 0, qcx = 0, qcy = 0, qcz = 0
  for (let k = 0; k < n; k++) {
    pcx += P[k * 3]; pcy += P[k * 3 + 1]; pcz += P[k * 3 + 2]
    qcx += Q[k * 3]; qcy += Q[k * 3 + 1]; qcz += Q[k * 3 + 2]
  }
  pcx /= n; pcy /= n; pcz /= n; qcx /= n; qcy /= n; qcz /= n
  // 协方差 H = Σ p^T q（3×3 行主序）
  const H = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let k = 0; k < n; k++) {
    const px = P[k * 3] - pcx, py = P[k * 3 + 1] - pcy, pz = P[k * 3 + 2] - pcz
    const qx = Q[k * 3] - qcx, qy = Q[k * 3 + 1] - qcy, qz = Q[k * 3 + 2] - qcz
    H[0] += px * qx; H[1] += px * qy; H[2] += px * qz
    H[3] += py * qx; H[4] += py * qy; H[5] += py * qz
    H[6] += pz * qx; H[7] += pz * qy; H[8] += pz * qz
  }
  // H^T H 特征分解 → 右奇异向量 V 与奇异值 S（eigenSymmetric3 不保证有序，手动降序）
  const { vals, vecs } = eigenSymmetric3([
    H[0] * H[0] + H[3] * H[3] + H[6] * H[6], H[0] * H[1] + H[3] * H[4] + H[6] * H[7], H[0] * H[2] + H[3] * H[5] + H[6] * H[8],
    H[0] * H[1] + H[3] * H[4] + H[6] * H[7], H[1] * H[1] + H[4] * H[4] + H[7] * H[7], H[1] * H[2] + H[4] * H[5] + H[7] * H[8],
    H[0] * H[2] + H[3] * H[5] + H[6] * H[8], H[1] * H[2] + H[4] * H[5] + H[7] * H[8], H[2] * H[2] + H[5] * H[5] + H[8] * H[8],
  ])
  const order = [0, 1, 2].sort((a, b) => vals[b] - vals[a])
  const s0 = Math.sqrt(Math.max(0, vals[order[0]])), s1 = Math.sqrt(Math.max(0, vals[order[1]])), s2 = Math.sqrt(Math.max(0, vals[order[2]]))
  if (s2 < 1e-9) return null // 秩亏（共线点集）无轴
  const V0 = vecs[order[0]], V1 = vecs[order[1]], V2 = vecs[order[2]]
  // U_j = H·V_j / s_j（V_j 符号与 U_j 联动，外积 V_j·U_j^T 不受符号翻转影响）
  const hv = (v: number[]) => [H[0] * v[0] + H[1] * v[1] + H[2] * v[2], H[3] * v[0] + H[4] * v[1] + H[5] * v[2], H[6] * v[0] + H[7] * v[1] + H[8] * v[2]]
  const u0 = hv(V0).map(x => x / s0)
  const u1 = hv(V1).map(x => x / s1)
  const u2 = hv(V2).map(x => x / s2)
  // 反射修正：R = V·diag(1,1,d)·U^T，d = sign(det(V·U^T)) = sign(det(H))（prod(S)>0）
  const detH = H[0] * (H[4] * H[8] - H[5] * H[7]) - H[1] * (H[3] * H[8] - H[5] * H[6]) + H[2] * (H[3] * H[7] - H[4] * H[6])
  const d = detH >= 0 ? 1 : -1
  // R = Σ_j V_j ⊗ U_j（行主序；第三项带 d）
  const R = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const terms: [number[], number[], number][] = [[V0, u0, 1], [V1, u1, 1], [V2, u2, d]]
  for (const [vj, uj, w] of terms) {
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) R[r * 3 + c] += w * vj[r] * uj[c]
  }
  // 对齐 RMSD（行向量：|P - Q·R|）＋角度（Rodrigues 反解）
  let sx = 0, sy = 0, sz = 0
  for (let k = 0; k < n; k++) {
    const qx = Q[k * 3] - qcx, qy = Q[k * 3 + 1] - qcy, qz = Q[k * 3 + 2] - qcz
    const rx = qx * R[0] + qy * R[3] + qz * R[6]
    const ry = qx * R[1] + qy * R[4] + qz * R[7]
    const rz = qx * R[2] + qy * R[5] + qz * R[8]
    const dx = P[k * 3] - pcx - rx, dy = P[k * 3 + 1] - pcy - ry, dz = P[k * 3 + 2] - pcz - rz
    sx += dx * dx; sy += dy * dy; sz += dz * dz
  }
  const rmsd = Math.sqrt((sx + sy + sz) / n)
  if (rmsd > 6) return null // 异源链误配（如血红蛋白 α/β 同号残基）——非对称拷贝
  const cosT = Math.min(1, Math.max(-1, (R[0] + R[4] + R[8] - 1) / 2))
  // 旋转轴（Rodrigues 反解）：k ∝ (R₃₂-R₂₃, R₁₃-R₃₁, R₂₁-R₁₂)——0-based 列访问
  // R[r*3+c]：wx=R[2][1]-R[1][2]、wy=R[0][2]-R[2][0]、wz=R[1][0]-R[0][1]。
  // r100 自纠：首版 x/z 分量互换（绕 z 的 C4 轴被报成 x 轴——9P6B 四链质心 z 全等
  // /x-y 四等分的金标准实测揪出；数值实验 rmsd=0 但轴=(1,0,0) 实锤公式位序错）
  const wx = R[7] - R[5], wy = R[2] - R[6], wz = R[3] - R[1]
  const sinT = Math.hypot(wx, wy, wz) / 2
  if (sinT < 1e-6) {
    if (cosT > 0) return null // 恒等变换：无旋转轴
    // 180°：R + I = 2kk^T → 对角最大元 k_i² 对应的列 i 归一化即轴
    const m0 = R[0] + 1, m1 = R[4] + 1, m2 = R[8] + 1
    const i = m0 >= m1 && m0 >= m2 ? 0 : m1 >= m2 ? 1 : 2
    const cx = R[i] + (i === 0 ? 1 : 0), cy = R[3 + i] + (i === 1 ? 1 : 0), cz = R[6 + i] + (i === 2 ? 1 : 0)
    const cl = Math.hypot(cx, cy, cz)
    if (cl < 1e-9) return null
    return [cx / cl, cy / cl, cz / cl]
  }
  const ang = Math.atan2(sinT, cosT) * 180 / Math.PI
  if (ang < 30) return null // 近恒等旋转的轴数值不稳（且非真对称关系）
  const wl = Math.hypot(wx, wy, wz) || 1
  return [wx / wl, wy / wl, wz / wl]
}

/** 同构链对对称轴投票：多数一致轴 = 寡聚体对称轴 = 通道轴。null = 降级 PCA。 */
export function symmetryAxis(data: StructureData): [number, number, number] | null {
  const pos = data.atoms.positions
  const names = data.atoms.names
  const residues = data.residues
  // 每条蛋白链的 CA 坐标：chainId → (resSeq|iCode → [x,y,z])
  const caMaps = new Map<string, Map<string, number[]>>()
  for (const ch of data.chains) {
    if (ch.type !== 'protein') continue
    const m = new Map<string, number[]>()
    for (const ri of ch.residueIdx) {
      const r = residues[ri]
      if (!r.polymer || r.water) continue
      for (let i = r.start; i < r.end; i++) {
        if (names[i] === 'CA') {
          m.set(`${r.resSeq}|${r.iCode}`, [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]])
          break
        }
      }
    }
    if (m.size >= 40) caMaps.set(ch.id, m)
  }
  if (caMaps.size < 2 || caMaps.size > 32) return null // 需 ≥2 条同构候选；>32 链（核糖体级）O(n²) 不值得
  const keys = [...caMaps.keys()]
  const votes: [number, number, number][] = []
  for (let a = 0; a < keys.length; a++) {
    for (let b = a + 1; b < keys.length; b++) {
      const ma = caMaps.get(keys[a])!, mb = caMaps.get(keys[b])!
      const small = ma.size <= mb.size ? ma : mb
      const big = small === ma ? mb : ma
      const common: string[] = []
      for (const k of small.keys()) if (big.has(k)) common.push(k)
      if (common.length < 40 || common.length < 0.8 * Math.min(ma.size, mb.size)) continue
      const P: number[] = [], Q: number[] = []
      for (const k of common) {
        const p = ma.get(k)!, q = mb.get(k)!
        P.push(p[0], p[1], p[2]); Q.push(q[0], q[1], q[2])
      }
      const ax = kabschAxis(P, Q)
      if (ax) votes.push(ax)
    }
  }
  if (votes.length < 2) return null
  // 符号统一到首票 → 主簇（与均值夹角 <25°）迭代精炼
  const ref = votes[0]
  const aligned = votes.map(v => (v[0] * ref[0] + v[1] * ref[1] + v[2] * ref[2] >= 0 ? v : [-v[0], -v[1], -v[2]]))
  let mx = 0, my = 0, mz = 0
  for (const v of aligned) { mx += v[0]; my += v[1]; mz += v[2] }
  let keep = aligned
  for (let it = 0; it < 5; it++) {
    const l = Math.hypot(mx, my, mz) || 1
    keep = aligned.filter(v => (v[0] * mx + v[1] * my + v[2] * mz) / l > Math.cos((25 * Math.PI) / 180))
    if (!keep.length) break
    mx = 0; my = 0; mz = 0
    for (const v of keep) { mx += v[0]; my += v[1]; mz += v[2] }
  }
  if (keep.length < 2 || keep.length < votes.length * 0.4) return null
  const len = Math.hypot(mx, my, mz) || 1
  return [mx / len, my / len, mz / len]
}

/** 跨膜腰：沿给定轴的横向 RMS 半径剖面里「双向收窄」的局部最小窗。
 *  center = 腰心（沿轴 t，相对 origin）；halfWidth = 腰窗半宽。null = 无腰（非膜蛋白
 *  /均匀结构/纯跨膜短蛋白如 KcsA——回落盒中点与全长采样，与 r99 行为一致）。 */
export function membraneWaist(
  data: StructureData,
  origin: [number, number, number],
  dir: [number, number, number],
): { center: number; halfWidth: number } | null {
  const pos = data.atoms.positions
  const residues = data.residues
  const WIN = 30, BIN = 4, FLANK = 24
  // 聚合物原子 → t 投影 + 到轴垂距 r（一次遍历）
  let tMin = Infinity, tMax = -Infinity, n = 0
  for (let ri = 0; ri < residues.length; ri++) {
    const r = residues[ri]
    if (!r.polymer || r.water) continue
    for (let i = r.start; i < r.end; i++) {
      const dx = pos[i * 3] - origin[0], dy = pos[i * 3 + 1] - origin[1], dz = pos[i * 3 + 2] - origin[2]
      const t = dx * dir[0] + dy * dir[1] + dz * dir[2]
      if (t < tMin) tMin = t
      if (t > tMax) tMax = t
      n++
    }
  }
  if (n < 600 || tMax - tMin < WIN + 2 * FLANK + 16) return null // 太小/太扁没有腰可言
  const nbin = Math.ceil((tMax - tMin) / BIN) + 1
  const cnt = new Float64Array(nbin)
  const sumR2 = new Float64Array(nbin)
  for (let ri = 0; ri < residues.length; ri++) {
    const r = residues[ri]
    if (!r.polymer || r.water) continue
    for (let i = r.start; i < r.end; i++) {
      const dx = pos[i * 3] - origin[0], dy = pos[i * 3 + 1] - origin[1], dz = pos[i * 3 + 2] - origin[2]
      const t = dx * dir[0] + dy * dir[1] + dz * dir[2]
      const px = dx - dir[0] * t, py = dy - dir[1] * t, pz = dz - dir[2] * t
      const b = Math.min(nbin - 1, Math.max(0, Math.floor((t - tMin) / BIN)))
      cnt[b]++
      sumR2[b] += px * px + py * py + pz * pz
    }
  }
  // 滑窗（窗宽 30Å、步长 = bin）：窗内 RMS 最小 + 双向收腰（两侧 24Å 均 > 窗内 ×1.08）
  const nWin = Math.max(150, n * 0.015)
  const nFlank = Math.max(50, n * 0.005)
  let best: { rr: number; c: number } | null = null
  for (let b = 0; b < nbin; b++) {
    const c = tMin + b * BIN + BIN / 2
    const wLo = c - WIN / 2, wHi = c + WIN / 2
    if (wLo < tMin + 2 || wHi > tMax - 2) continue
    const bLo = Math.floor((wLo - tMin) / BIN), bHi = Math.min(nbin - 1, Math.floor((wHi - tMin) / BIN))
    let wc = 0, wr = 0
    for (let k = bLo; k <= bHi; k++) { wc += cnt[k]; wr += sumR2[k] }
    if (wc < nWin) continue
    const rr = Math.sqrt(wr / wc)
    const fLoB = Math.max(0, Math.floor((wLo - FLANK - tMin) / BIN)), fLoE = Math.max(0, Math.floor((wLo - tMin) / BIN))
    const fHiB = Math.min(nbin - 1, Math.floor((wHi - tMin) / BIN)), fHiE = Math.min(nbin - 1, Math.floor((wHi + FLANK - tMin) / BIN))
    let lc = 0, lr = 0, rc = 0, rr2s = 0
    for (let k = fLoB; k < fLoE; k++) { lc += cnt[k]; lr += sumR2[k] }
    for (let k = fHiB; k <= fHiE; k++) { rc += cnt[k]; rr2s += sumR2[k] }
    if (lc < nFlank || rc < nFlank) continue
    const rl = Math.sqrt(lr / lc), rrg = Math.sqrt(rr2s / rc)
    if (rl < rr * 1.08 || rrg < rr * 1.08) continue // 双向收腰：膜蛋白腰两侧都更宽
    if (!best || rr < best.rr) best = { rr, c }
  }
  return best ? { center: best.c, halfWidth: WIN / 2 } : null
}

/** 通道轴统一入口（r100）：对称轴优先、PCA 兜底；origin = 聚合物质心（膜/环带/剖面同基准） */
export function poreAxis(data: StructureData): {
  origin: [number, number, number]
  dir: [number, number, number]
  method: 'symmetry' | 'pca'
} {
  const { origin, dir } = principalAxis(data)
  const sym = symmetryAxis(data)
  if (sym) return { origin, dir: sym, method: 'symmetry' }
  return { origin, dir, method: 'pca' }
}

export interface PoreOptions {
  /** 剖面封顶半径（Å；两端开口腔/胞外腔的显示上限） */
  maxR: number
  /** 轴向采样点数 */
  samples: number
}

/** 孔道剖面计算（纯函数；世界坐标，随结构位姿实时）。r100：对称轴优先 + 腰窗聚焦采样 */
export function computePoreProfile(data: StructureData, opts: PoreOptions): PoreResult {
  const t0 = performance.now()
  const { origin, dir, method } = poreAxis(data)
  const pos = data.atoms.positions
  const elements = data.atoms.elements
  const residues = data.residues

  // 聚合物原子（蛋白壁）：t 投影 + vdW 半径，按 t 排序供窗口剪枝
  const idx: number[] = []
  for (let ri = 0; ri < residues.length; ri++) {
    const r = residues[ri]
    if (!r.polymer || r.water) continue
    for (let i = r.start; i < r.end; i++) idx.push(i)
  }
  const K = idx.length
  const ts = new Float64Array(K)
  const vdw = new Float32Array(K)
  let maxVdw = 0
  let tMin = Infinity, tMax = -Infinity
  for (let k = 0; k < K; k++) {
    const i = idx[k]
    const t = (pos[i * 3] - origin[0]) * dir[0] + (pos[i * 3 + 1] - origin[1]) * dir[1] + (pos[i * 3 + 2] - origin[2]) * dir[2]
    ts[k] = t
    const vi = elementInfo(elements[i]).vdw
    vdw[k] = vi
    if (vi > maxVdw) maxVdw = vi
    if (t < tMin) tMin = t
    if (t > tMax) tMax = t
  }
  const order = Array.from({ length: K }, (_, k) => k).sort((a, b) => ts[a] - ts[b])
  const tsSorted = new Float64Array(K)
  for (let k = 0; k < K; k++) tsSorted[k] = ts[order[k]]

  // 采样区间（r100）：跨膜腰窗 ± 两端腔延伸（HOLE 语义——跨膜孔+口腔，非全长），
  // 钳制在蛋白跨度内收 2.5Å（避开轴端点的边界伪影）；无腰回落全长（KcsA 短跨膜蛋白/
  // 非膜蛋白与 r99 行为一致）。
  const margin = 2.5
  const span = tMax - tMin
  const waist = membraneWaist(data, origin, dir)
  const VESTIBULE = 15
  const lo = waist ? Math.max(tMin + margin, waist.center - waist.halfWidth - VESTIBULE) : tMin + margin
  const hi = waist ? Math.min(tMax - margin, waist.center + waist.halfWidth + VESTIBULE) : tMax - margin
  const N = Math.max(24, Math.min(opts.samples, 400))
  const samples: PoreSample[] = []
  const window = opts.maxR + maxVdw + 1
  // 二分：首个 ≥ x 的排序下标
  const lowerBound = (x: number) => {
    let a = 0, b = K
    while (a < b) { const m = (a + b) >> 1; if (tsSorted[m] < x) a = m + 1; else b = m }
    return a
  }
  let cT = lo, cR = Infinity
  for (let s = 0; s < N; s++) {
    const t = lo + ((hi - lo) * s) / (N - 1)
    const px = origin[0] + dir[0] * t, py = origin[1] + dir[1] * t, pz = origin[2] + dir[2] * t
    let r = opts.maxR
    const from = lowerBound(t - window)
    for (let q = from; q < K && tsSorted[q] <= t + window; q++) {
      const k = order[q]
      const ax = pos[idx[k] * 3], ay = pos[idx[k] * 3 + 1], az = pos[idx[k] * 3 + 2]
      const d = Math.hypot(ax - px, ay - py, az - pz) - vdw[k]
      if (d < r) r = d
      if (r <= 0) break // 已被原子覆盖（负半径不再有意义，截断求值）
    }
    if (r < 0) r = 0
    samples.push({ t: +t.toFixed(2), r: +r.toFixed(3) })
    if (r < cR) { cR = r; cT = t }
  }

  const name = useMolStore.getState().structures.find(x => x.id === data.id)?.name ?? data.name
  return {
    structureId: data.id,
    structureName: name,
    origin, dir,
    /** r100：轴检测方法与跨膜腰窗（剖面卡读图语境） */
    method,
    zone: waist ? { center: +waist.center.toFixed(1), halfWidth: waist.halfWidth } : undefined,
    samples,
    maxR: opts.maxR,
    constriction: { t: +cT.toFixed(2), r: +cR.toFixed(3) },
    span: +span.toFixed(1),
    tMin: +tMin.toFixed(2), tMax: +tMax.toFixed(2),
    nAtoms: K,
    ms: +(performance.now() - t0).toFixed(1),
  }
}

export type PoreRunResult = { ok: true; result: PoreResult } | { ok: false; message: string }

/** 命令入口：计算活动结构剖面 + 存 store + 触发引擎环带渲染 */
export function runPore(opts: Partial<PoreOptions> = {}): PoreRunResult {
  const s = useMolStore.getState()
  if (!s.activeId) return { ok: false, message: tt({ zh: '当前没有结构——先加载离子通道（如 load 1bl8 KcsA）', en: 'No structure loaded — load an ion channel first (e.g. load 1bl8 KcsA)' }) }
  const data = dataRegistry.get(s.activeId)
  if (!data) return { ok: false, message: tt({ zh: '结构数据不存在', en: 'Structure data not found' }) }
  // r98-f1：零聚合物残基（纯配体/HETATM-only 文件）——tMin=+Inf/tMax=-Inf 走到底
  // 全部采样 NaN、span=-Infinity 进环带几何与剖面卡（updateMembrane 同款守卫哲学：
  // 诚实报错而非废几何）
  if (!data.residues.some(r => r.polymer && !r.water)) {
    return { ok: false, message: tt({ zh: '该结构没有聚合物链（孔道剖面需要蛋白/核酸聚合物）', en: 'This structure has no polymer chains (pore profiles need protein/nucleic polymers)' }) }
  }
  const maxR = Math.max(3, Math.min(opts.maxR ?? 8, 16))
  const samples = Math.max(60, Math.min(opts.samples ?? 160, 400))
  const result = computePoreProfile(data, { maxR, samples })
  usePoreStore.getState().set(result)
  engineRef.current?.updatePore()
  return { ok: true, result }
}

/** 清除孔道剖面（pore off / 关闭剖面卡共用） */
export function clearPore(): void {
  usePoreStore.getState().clear()
  engineRef.current?.updatePore()
}
