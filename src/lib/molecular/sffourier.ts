// ============================================================================
// sffourier.ts — RCSB 沉积结构因子（SF mmCIF）解析 + 2Fo−Fc 电子密度图 3D FFT 合成
// ============================================================================
// 输入例如 https://files.rcsb.org/download/3EKJ-sf.cif（~3MB，_refln 全反射表）。
// 密度合成采用经典「模型密度 FFT 法」：
//   1) 原子模型按空间群对称（symOpsFor 结果 + 晶格心平移复合、mod-1 去重）展开，
//      栅格化为实空间高斯密度 ρ_model(r) = Σ occ·Z_eff·exp(−|r−r_a|²/(2σ²))，
//      σ² = B/(8π²)（B<2 取 2）；
//   2) 3D FFT → 全部整数 hkl 的 Fcalc(h)；
//   3) 全局最小二乘尺度 k = Σ(Fobs·|Fcalc|)/Σ(|Fcalc|²)；
//   4) 2Fo−Fc 系数 Fmap(h) = (2·Fobs − k·|Fcalc|)·e^{iφcalc}，±h 填共轭对；
//   5) 3D IFFT → 实数密度图。（Fo−Fc 差图只需把第 4 步换成 (Fobs − k|Fcalc|)。）
//
// 坐标 / 矩阵约定（与 PDB / CCP4 一致，几何全部复用 './symmetry'，不重复实现）：
//   · orthoMatrix(cell) → { o, oi }：行主序 3×3（o[i*3+j] 为第 i 行 j 列），
//     cart = O·frac、frac = Oi·cart（列向量约定）；PDB 正交化取 x‖a、z‖c*、y = z×x。
//   · symOpsFor(symbol) → SymOp[] | null：分数坐标 op（行主序旋转 R + 平移 t），
//     f' = R·f + t。本模块将其与晶格心平移（H-M 符号首字母 A/B/C/I/F/R）复合后
//     mod-1 去重 —— 若 symOpsFor 已含心平移则复合幂等；若只给原始格部分 op 则自动补全。
//
// FFT 约定（自洽，见 fft3d）：前向 F[h] = Σ_x ρ[x]·e^{−2πi·h·x/n}（无缩放）；
// 逆向 ρ[x] = (1/n³)·Σ_h F[h]·e^{+2πi·h·x/n}（+ 号蝶形 + 结束统一 ×1/n³）。
// 于是 IFFT(FFT(ρ)) ≡ ρ（自检 ①② 验证）；ρ_map 量级 = Fmap 单位/体素数，
// 与晶体学习惯 ρ(r) = (1/V)·Σ F·e^{−2πi h·r} 一致（体素体积 = V/n³）。
// ============================================================================

import { symOpsFor, orthoMatrix, type CrystalCell, type SymOp } from './symmetry'

// ---------- 公共类型 ----------

/** 单条观测反射（SF mmCIF _refln 行） */
export interface SfRefln {
  h: number
  k: number
  l: number
  fobs: number  // |Fobs|（文件原始尺度，通常 au）
  sigf: number  // σ(Fobs)
}

/** 模型原子（pos/elements/bfactors/occupancies 与 StructureData.atoms 同约定） */
export interface ModelAtoms {
  pos: Float32Array        // 笛卡尔坐标 xyz·count
  elements: string[]       // 元素符号
  bfactors: Float32Array   // B 因子（Å²）
  occupancies: Float32Array
  count: number
}

/** 2Fo−Fc 密度图计算结果 */
export interface DensityMapResult {
  grid: Float32Array              // n³ 实数密度（索引 = (iz*n+iy)*n+ix，ix 沿第一轴/a/h 轴）
  n: number                       // 每轴采样数（2 的幂，clamp [32,256]）
  voxel: [number, number, number] // 体素 Å 尺寸（近似 = 轴长/n，供显示）
  rms: number
  mean: number
  min: number
  max: number
  scale: number  // Fobs→Fcalc 全局最小二乘比例 k
  nRefs: number  // 实际使用的反射数
  cell: CrystalCell
  error?: string
}

// ---------- 元素有效电子数（X 光近似取原子序数） ----------
// 常见生物元素 + 沉积结构常见金属/卤素；未知元素用名字首字符兜底，再不行按 6（碳）。
const ELEMENT_Z: ReadonlyMap<string, number> = new Map<string, number>([
  ['H', 1], ['C', 6], ['N', 7], ['O', 8], ['P', 15], ['S', 16], ['SE', 34],
  ['NA', 11], ['MG', 12], ['K', 19], ['CA', 20], ['MN', 25], ['FE', 26],
  ['NI', 28], ['CU', 29], ['ZN', 30], ['CL', 17], ['BR', 35], ['CD', 48], ['I', 53],
])

function zEff(element: string): number {
  const sym = element.trim().toUpperCase()
  const z = ELEMENT_Z.get(sym)
  if (z !== undefined) return z
  if (sym.length > 1) {
    const zc = ELEMENT_Z.get(sym.charAt(0))
    if (zc !== undefined) return zc
  }
  return 6
}

// ---------- mmCIF 词法（健壮 tokenizer） ----------
// mmCIF 是逐 token 流：值可跨行折行；'…'/"…" 引号字符串（闭合引号须后随空白/行尾）；
// 行首 ';' 开启多行文本块直到下一个行首 ';'；'#' 在 token 起始处开注释；data_/save_
// 为块/帧头，loop_/stop_ 为循环关键字；裸 token 以空白分隔。
const K_VALUE = 0
const K_TAG = 1
const K_LOOP = 2
const K_STOP = 3
const K_DATA = 4
const K_SAVE = 5

interface CifTokens {
  toks: string[]
  kinds: Uint8Array
  count: number
}

function isWsChar(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13
}

function tokenizeCif(text: string): CifTokens {
  const toks: string[] = []
  const kinds: number[] = []
  const len = text.length
  let i = 0
  while (i < len) {
    const c = text.charCodeAt(i)
    if (isWsChar(c)) { i++; continue }
    if (c === 35) { // '#'：token 起始处开注释，读到行尾（token 内部的 '#' 不受影响）
      while (i < len && text.charCodeAt(i) !== 10) i++
      continue
    }
    if (c === 59 && (i === 0 || text.charCodeAt(i - 1) === 10)) {
      // 行首 ';'：多行文本块（值直到下一个行首 ';'）
      i++
      const contentStart = i
      while (i < len && text.charCodeAt(i) !== 10) i++ // 开行 ';' 后的剩余内容
      if (i < len) i++
      let end = -1
      while (i < len) {
        if (text.charCodeAt(i) === 59) { end = i; break }
        while (i < len && text.charCodeAt(i) !== 10) i++
        if (i < len) i++
      }
      toks.push(end >= 0 ? text.slice(contentStart, end) : text.slice(contentStart, len))
      kinds.push(K_VALUE)
      if (end >= 0) {
        i = end + 1
        while (i < len && text.charCodeAt(i) !== 10) i++ // 跳过终止行剩余部分
      }
      continue
    }
    if (c === 39 || c === 34) {
      // 引号字符串：闭合引号必须后随空白/行尾/EOF，否则视为字面字符（CIF 规则）
      const start = i + 1
      i++
      while (i < len) {
        if (text.charCodeAt(i) === c) {
          const nxt = i + 1
          if (nxt >= len || isWsChar(text.charCodeAt(nxt))) break
        }
        i++
      }
      toks.push(text.slice(start, i))
      kinds.push(K_VALUE)
      i++ // 跳过闭合引号
      continue
    }
    // 裸 token（值 / loop_ / stop_ / data_ / save_ / 标签）
    const start = i
    while (i < len && !isWsChar(text.charCodeAt(i))) i++
    const t = text.slice(start, i)
    if (t.length === 0) continue
    const tl = t.toLowerCase()
    if (t.charCodeAt(0) === 95) kinds.push(K_TAG) // '_'
    else if (tl === 'loop_') kinds.push(K_LOOP)
    else if (tl === 'stop_') kinds.push(K_STOP)
    else if (tl.startsWith('data_')) kinds.push(K_DATA)
    else if (tl.startsWith('save_')) kinds.push(K_SAVE)
    else kinds.push(K_VALUE)
    toks.push(t)
  }
  return { toks, kinds: new Uint8Array(kinds), count: toks.length }
}

// ---------- mmCIF 标签 / 数值工具 ----------

function tagKey(tag: string): string {
  return tag.toLowerCase().replace(/^_+/, '')
}
function tagLeaf(tag: string): string {
  const key = tagKey(tag)
  const p = key.lastIndexOf('.')
  return p >= 0 ? key.slice(p + 1) : key
}
function tagCategory(tag: string): string {
  const key = tagKey(tag)
  const p = key.indexOf('.')
  return p >= 0 ? key.slice(0, p) : key
}

/** 数值解析：跳过 '.'/'?'（缺失值）；剥离括号内 esd（如 80.128(4) → 80.128） */
function cifNum(s: string): number | null {
  if (s === '.' || s === '?' || s.length === 0) return null
  let t = s
  const p = t.indexOf('(')
  if (p >= 0) t = t.slice(0, p)
  const v = parseFloat(t)
  return Number.isFinite(v) ? v : null
}

// ---------- SF mmCIF 解析 ----------

/** 解析 RCSB SF mmCIF（如 https://files.rcsb.org/download/3EKJ-sf.cif）。
 * 提取 _refln loop：列名变体 H/H_index、K、L、F_meas_au/FM/FOBS/FP、
 * F_meas_sigma_au/SIGFM/SIGF/SIGFP；提取全局 _cell.length_a/b/c、
 * _cell.angle_alpha/beta/gamma、_symmetry.space_group_name_H-M
 * （SF 文件常见 _symmetry.space_group_name_H-M，另兜底 _space_group 变体）。
 * tokenizer 处理引号字符串、分号文本块、# 注释、data_ 块头与跨行折行。
 * 跳过 fobs≤0 / sigf≤0 / 非数值（'.'/'?'）行。 */
export function parseSfCif(text: string): { reflns: SfRefln[]; cell: CrystalCell | null; spaceGroup: string | null; error?: string } {
  const reflns: SfRefln[] = []
  let a = NaN, b = NaN, c = NaN, al = NaN, be = NaN, ga = NaN
  let spaceGroup: string | null = null

  // _refln 列名变体（叶子、小写；F/σF 列表按优先级降序匹配）
  const H_LEAVES = ['h', 'index_h', 'h_index']
  const K_LEAVES = ['k', 'index_k', 'k_index']
  const L_LEAVES = ['l', 'index_l', 'l_index']
  const F_LEAVES = ['f_meas_au', 'f_meas', 'fm', 'fobs', 'f_obs', 'fp']
  const S_LEAVES = ['f_meas_sigma_au', 'sigma_f_meas_au', 'sigfm', 'sigf', 'sigma_fobs', 'sigfp']

  const tk = tokenizeCif(text)
  const toks = tk.toks
  const kinds = tk.kinds
  const count = tk.count
  let i = 0
  while (i < count) {
    const kd = kinds[i]
    if (kd === K_TAG) {
      // 键值对：_cell.* / _symmetry.*
      const key = tagKey(toks[i])
      i++
      if (i < count && kinds[i] === K_VALUE) {
        const v = toks[i]
        i++
        const num = cifNum(v)
        if (num !== null) {
          if (key === 'cell.length_a') a = num
          else if (key === 'cell.length_b') b = num
          else if (key === 'cell.length_c') c = num
          else if (key === 'cell.angle_alpha') al = num
          else if (key === 'cell.angle_beta') be = num
          else if (key === 'cell.angle_gamma') ga = num
        }
        if (key === 'symmetry.space_group_name_h-m' || key === 'symmetry.space_group_name_h-m_alt'
          || key === 'space_group.name_h-m_alt' || key === 'space_group_name_h-m_alt') {
          const sgv = v.trim()
          if (sgv !== '' && sgv !== '.' && sgv !== '?') spaceGroup = sgv
        }
      }
      continue
    }
    if (kd !== K_LOOP) { i++; continue } // data_/save_/stop_/散值：跳过
    // ---- loop_ ----
    i++
    const tagStart = i
    while (i < count && kinds[i] === K_TAG) i++
    const tagEnd = i
    const valStart = i
    while (i < count && kinds[i] === K_VALUE) i++ // 值流可跨行折行
    const valEnd = i
    if (i < count && kinds[i] === K_STOP) i++
    const nTags = tagEnd - tagStart
    if (nTags === 0) continue
    if (reflns.length > 0) continue // 只取第一个 _refln loop
    let isRefln = false
    for (let t = tagStart; t < tagEnd; t++) {
      if (tagCategory(toks[t]) === 'refln') { isRefln = true; break }
    }
    if (!isRefln) continue
    let hc = -1, kcIdx = -1, lcIdx = -1, fcIdx = -1, scIdx = -1
    for (let t = tagStart; t < tagEnd; t++) {
      const leaf = tagLeaf(toks[t])
      const col = t - tagStart
      if (hc < 0 && H_LEAVES.indexOf(leaf) >= 0) hc = col
      else if (kcIdx < 0 && K_LEAVES.indexOf(leaf) >= 0) kcIdx = col
      else if (lcIdx < 0 && L_LEAVES.indexOf(leaf) >= 0) lcIdx = col
      else if (fcIdx < 0 && F_LEAVES.indexOf(leaf) >= 0) fcIdx = col
      else if (scIdx < 0 && S_LEAVES.indexOf(leaf) >= 0) scIdx = col
    }
    if (hc < 0 || kcIdx < 0 || lcIdx < 0 || fcIdx < 0 || scIdx < 0) continue
    const nRows = Math.floor((valEnd - valStart) / nTags) // 尾部残缺行丢弃
    for (let r = 0; r < nRows; r++) {
      const base = valStart + r * nTags
      const hv = cifNum(toks[base + hc])
      const kv = cifNum(toks[base + kcIdx])
      const lv = cifNum(toks[base + lcIdx])
      const fv = cifNum(toks[base + fcIdx])
      const sv = cifNum(toks[base + scIdx])
      if (hv === null || kv === null || lv === null || fv === null || sv === null) continue
      if (fv <= 0 || sv <= 0) continue // 非观测/无效行
      reflns.push({ h: Math.round(hv), k: Math.round(kv), l: Math.round(lv), fobs: fv, sigf: sv })
    }
  }

  let cell: CrystalCell | null = null
  if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)
    && Number.isFinite(al) && Number.isFinite(be) && Number.isFinite(ga)
    && a > 0 && b > 0 && c > 0
    && al > 0 && al < 180 && be > 0 && be < 180 && ga > 0 && ga < 180) {
    cell = { a, b, c, alpha: al, beta: be, gamma: ga }
  }

  if (reflns.length === 0) {
    return { reflns, cell, spaceGroup, error: '未解析到观测反射（缺 _refln loop 或 h/k/l/Fobs/σF 列均无效）' }
  }
  return { reflns, cell, spaceGroup }
}

// ---------- radix-2 复数 3D FFT（n ≤ 256，2 的幂） ----------
// 约定：前向 F[h] = Σ_x ρ[x]·e^{−2πi·h·x/n}（无缩放）；
//      逆向 ρ[x] = (1/n³)·Σ_h F[h]·e^{+2πi·h·x/n}（+ 号逆蝶形，结束后统一 ×1/n³，
//      n³ 为 2 的幂故乘法无舍入）。因此 IFFT = 共轭意义下的严格逆，FFT→IFFT 往返
//      只剩浮点蝶形累计误差（自检 ①② 验证）。
// 实现：迭代位反转置换 + 蝶形；按 x/y/z 三轴各扫一遍 1D FFT。每条线先 gather 到
//      双缓冲 scratch（tRe/tIm，Float64Array）做连续内存变换再 scatter 回大数组，
//      避免在大数组上跨步访问抖 cache；twiddle 查表 W_len^j = W_n^{j·n/len}
//      （表长 n/2，三轴共用，逆变换用共轭符号）。

function fftLine(re: Float64Array, im: Float64Array, off: number, stride: number,
  n: number, inverse: boolean, cosT: Float64Array, sinT: Float64Array,
  tRe: Float64Array, tIm: Float64Array): void {
  // gather（跨步 → scratch 连续）
  for (let i = 0, p = off; i < n; i++, p += stride) {
    tRe[i] = re[p]
    tIm[i] = im[p]
  }
  // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; (j & bit) !== 0; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      const tr = tRe[i]; tRe[i] = tRe[j]; tRe[j] = tr
      const ti = tIm[i]; tIm[i] = tIm[j]; tIm[j] = ti
    }
  }
  // 蝶形
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const tstep = n / len
    for (let base = 0; base < n; base += len) {
      for (let j = 0; j < half; j++) {
        const tj = j * tstep
        const wr = cosT[tj]
        const wi = inverse ? -sinT[tj] : sinT[tj]
        const aa = base + j
        const bb = aa + half
        const xr = tRe[bb], xi = tIm[bb]
        const ur = tRe[aa], ui = tIm[aa]
        const vr = xr * wr - xi * wi
        const vi = xr * wi + xi * wr
        tRe[bb] = ur - vr; tIm[bb] = ui - vi
        tRe[aa] = ur + vr; tIm[aa] = ui + vi
      }
    }
  }
  // scatter 回原位
  for (let i = 0, p = off; i < n; i++, p += stride) {
    re[p] = tRe[i]
    im[p] = tIm[i]
  }
}

function fft3d(re: Float64Array, im: Float64Array, n: number, inverse: boolean): void {
  const half = n >> 1
  const cosT = new Float64Array(half)
  const sinT = new Float64Array(half) // 存 e^{−2πij/n} 的虚部（前向符号）
  for (let j = 0; j < half; j++) {
    const ang = (2 * Math.PI * j) / n
    cosT[j] = Math.cos(ang)
    sinT[j] = -Math.sin(ang)
  }
  const tRe = new Float64Array(n)
  const tIm = new Float64Array(n)
  const n2 = n * n
  // x 轴（ix 连续）：栅格索引 = (iz*n + iy)*n + ix
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      fftLine(re, im, (z * n + y) * n, 1, n, inverse, cosT, sinT, tRe, tIm)
    }
  }
  // y 轴（iy，stride n）
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      fftLine(re, im, z * n2 + x, n, n, inverse, cosT, sinT, tRe, tIm)
    }
  }
  // z 轴（iz，stride n²）
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      fftLine(re, im, y * n + x, n2, n, inverse, cosT, sinT, tRe, tIm)
    }
  }
  if (inverse) {
    const s = 1 / (n * n2)
    const n3 = n * n2
    for (let q = 0; q < n3; q++) {
      re[q] *= s
      im[q] *= s
    }
  }
}

// ---------- 对称 op 组装（symOpsFor 结果 + 晶格心平移复合，mod-1 去重） ----------

const IDENTITY_OP: SymOp = { rot: [1, 0, 0, 0, 1, 0, 0, 0, 1], trans: [0, 0, 0] }

/** H-M 符号首字母 → 晶格心平移向量（含 (0,0,0)）。R 缺省按六方轴（:H），
 *  显式 :R 后缀为菱方原始格。与 symOpsFor 结果复合后去重：对「已含心平移」的
 *  实现幂等（不引入重复 op），对「只给原始格部分 op」的实现自动补全。 */
function centeringTranslations(symbol: string): number[][] {
  const s = symbol.trim().toUpperCase()
  const letter = s.length > 0 ? s.charAt(0) : 'P'
  switch (letter) {
    case 'A': return [[0, 0, 0], [0, 0.5, 0.5]]
    case 'B': return [[0, 0, 0], [0.5, 0, 0.5]]
    case 'C': return [[0, 0, 0], [0.5, 0.5, 0]]
    case 'I': return [[0, 0, 0], [0.5, 0.5, 0.5]]
    case 'F': return [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]]
    case 'R': return s.includes(':R')
      ? [[0, 0, 0]]
      : [[0, 0, 0], [2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]]
    default: return [[0, 0, 0]] // P / H / 未知 → 原始格
  }
}

function wrap01(x: number): number {
  const w = x - Math.floor(x)
  return w < 1e-9 || w > 1 - 1e-9 ? 0 : w
}

/** 完整 op 列表：base op × 心平移，平移 mod 1，按（旋转精确 + 平移吸附 1/96 格点）
 *  的指纹去重。ops 为 null/空 → 仅恒等。 */
function buildFullOps(symbol: string, ops: SymOp[] | null): SymOp[] {
  const base: SymOp[] = ops !== null && ops.length > 0 ? ops : [IDENTITY_OP]
  const cent = centeringTranslations(symbol)
  const out: SymOp[] = []
  const seen = new Set<string>()
  for (let oi2 = 0; oi2 < base.length; oi2++) {
    const op = base[oi2]
    const rotKey = op.rot.join(',')
    for (let ci = 0; ci < cent.length; ci++) {
      const t = cent[ci]
      const tx = wrap01(op.trans[0] + t[0])
      const ty = wrap01(op.trans[1] + t[1])
      const tz = wrap01(op.trans[2] + t[2])
      // 1/96 格点覆盖全部晶体学平移（1/2、1/3、1/4、1/6、1/8、1/12、1/24…）
      const key = rotKey + '|' + Math.round(tx * 96) + ',' + Math.round(ty * 96) + ',' + Math.round(tz * 96)
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ rot: op.rot, trans: [tx, ty, tz] })
    }
  }
  return out
}

// ---------- 2Fo−Fc 密度合成 ----------

/** 从结构因子 + 模型原子计算 2Fo−Fc 电子密度图（算法见文件头注释）。
 *  栅格 n = 大于 2·max(|h|,|k|,|l|)+2 的最小 2 的幂，clamp [32,256]；
 *  max index > 127（即所需栅格超过 256³）直接报错。反射数 < 10 或
 *  cell/spaceGroup 缺失 → 返回 error。 */
export function computeDensityMap(reflns: SfRefln[], cell: CrystalCell, spaceGroup: string, atoms: ModelAtoms): DensityMapResult {
  const fail = (msg: string): DensityMapResult => ({
    grid: new Float32Array(0), n: 0, voxel: [0, 0, 0],
    rms: 0, mean: 0, min: 0, max: 0, scale: 0, nRefs: 0, cell, error: msg,
  })

  // —— 参数校验（cell / spaceGroup 缺失或非法 → error）——
  if (cell == null || !(cell.a > 0) || !(cell.b > 0) || !(cell.c > 0)
    || !(cell.alpha > 0 && cell.alpha < 180) || !(cell.beta > 0 && cell.beta < 180)
    || !(cell.gamma > 0 && cell.gamma < 180)) {
    return fail('晶胞参数缺失或无效（a/b/c > 0 且 0 < 角度 < 180）')
  }
  const sg = spaceGroup != null ? spaceGroup.trim() : ''
  if (sg === '') return fail('空间群符号缺失')
  if (reflns == null || reflns.length < 10) return fail('反射数 < 10，无法合成密度图')

  // —— 有效反射筛选（fobs/σF > 0，hkl 有限）——
  let nRef = 0
  for (let q = 0; q < reflns.length; q++) {
    const r = reflns[q]
    if (Number.isFinite(r.h) && Number.isFinite(r.k) && Number.isFinite(r.l) && r.fobs > 0 && r.sigf > 0) nRef++
  }
  if (nRef < 10) return fail('有效反射数 < 10（fobs/σF 须 > 0）')
  const hs = new Int32Array(nRef)
  const ks = new Int32Array(nRef)
  const ls = new Int32Array(nRef)
  const fva = new Float64Array(nRef)
  let maxIdx = 0
  let rp = 0
  for (let q = 0; q < reflns.length; q++) {
    const r = reflns[q]
    if (!(Number.isFinite(r.h) && Number.isFinite(r.k) && Number.isFinite(r.l) && r.fobs > 0 && r.sigf > 0)) continue
    const h = Math.round(r.h)
    const kk = Math.round(r.k)
    const ll = Math.round(r.l)
    hs[rp] = h; ks[rp] = kk; ls[rp] = ll; fva[rp] = r.fobs
    const m = Math.max(Math.abs(h), Math.abs(kk), Math.abs(ll))
    if (m > maxIdx) maxIdx = m
    rp++
  }

  // —— 栅格尺寸：n = 大于 2·maxIdx+2 的最小 2 的幂，clamp [32,256] ——
  if (maxIdx > 127) return fail(`最大反射指数 ${maxIdx} > 127，超出可合成范围`)
  let n = 2
  const mreq = 2 * maxIdx + 2
  while (n <= mreq) n <<= 1
  if (n > 256) return fail(`所需 FFT 栅格 ${n}³ 超出 256³ 上限（max|hkl| = ${maxIdx}）`)
  if (n < 32) n = 32
  const n2 = n * n
  const n3 = n2 * n

  // —— 完整对称 op 列表（symOpsFor 缺失 → 仅恒等）——
  const ops = buildFullOps(sg, symOpsFor(sg))

  // —— PDB 正交化 + 实空间度规 G = OᵀO ——
  // |O·Δf|² = Δfᵀ·G·Δf：与「先算笛卡尔偏移 O·(f_vox−f') 再取模」严格等价，
  // 内循环省一次矩阵乘（无对象分配）。
  const om = orthoMatrix(cell)
  const o = om.o
  const oi = om.oi
  const g00 = o[0] * o[0] + o[3] * o[3] + o[6] * o[6]
  const g01 = o[0] * o[1] + o[3] * o[4] + o[6] * o[7]
  const g02 = o[0] * o[2] + o[3] * o[5] + o[6] * o[8]
  const g11 = o[1] * o[1] + o[4] * o[4] + o[7] * o[7]
  const g12 = o[1] * o[2] + o[4] * o[5] + o[7] * o[8]
  const g22 = o[2] * o[2] + o[5] * o[5] + o[8] * o[8]

  // —— 步骤 2：模型密度栅格（对称展开 + 高斯热弥散，体素索引周期回卷 mod n）——
  const re = new Float64Array(n3) // 密度 → Fcalc → Fmap 三阶段复用
  const im = new Float64Array(n3)
  const INV8PI2 = 1 / (8 * Math.PI * Math.PI)
  const cnt = Math.max(0, Math.min(atoms.count, Math.floor(atoms.pos.length / 3)))
  for (let aI = 0; aI < cnt; aI++) {
    const px = atoms.pos[aI * 3]
    const py = atoms.pos[aI * 3 + 1]
    const pz = atoms.pos[aI * 3 + 2]
    // 笛卡尔 → 分数（不取 mod：对称拷贝可落在胞外，写入体素时再 mod n 周期回卷）
    const fx = oi[0] * px + oi[1] * py + oi[2] * pz
    const fy = oi[3] * px + oi[4] * py + oi[5] * pz
    const fz = oi[6] * px + oi[7] * py + oi[8] * pz
    let B = atoms.bfactors[aI]
    if (!Number.isFinite(B) || B < 2) B = 2
    const sigma2 = B * INV8PI2
    const sigma = Math.sqrt(sigma2)
    const inv2s2 = 0.5 / sigma2
    let occ = atoms.occupancies[aI]
    if (!Number.isFinite(occ) || occ <= 0) occ = 1
    const amp = occ * zEff(atoms.elements[aI] ?? '')
    // 每轴窗口半宽（体素）：⌈3σ·n/轴长⌉（各向异性 cell 按轴长近似；限 n/2 防退化）
    const wx = Math.min(n >> 1, Math.max(1, Math.ceil((3 * sigma * n) / cell.a)))
    const wy = Math.min(n >> 1, Math.max(1, Math.ceil((3 * sigma * n) / cell.b)))
    const wz = Math.min(n >> 1, Math.max(1, Math.ceil((3 * sigma * n) / cell.c)))
    for (let opI = 0; opI < ops.length; opI++) {
      const rot = ops[opI].rot
      const tr = ops[opI].trans
      const cx = rot[0] * fx + rot[1] * fy + rot[2] * fz + tr[0]
      const cy = rot[3] * fx + rot[4] * fy + rot[5] * fz + tr[1]
      const cz = rot[6] * fx + rot[7] * fy + rot[8] * fz + tr[2]
      const i0 = Math.round(cx * n)
      const j0 = Math.round(cy * n)
      const k0 = Math.round(cz * n)
      let i0m = i0 % n; if (i0m < 0) i0m += n
      let j0m = j0 % n; if (j0m < 0) j0m += n
      let k0m = k0 % n; if (k0m < 0) k0m += n
      for (let dk = -wz; dk <= wz; dk++) {
        const dvz = (k0 + dk) / n - cz
        const qz = g22 * dvz * dvz
        const pz1 = 2 * g02 * dvz
        const pz2 = 2 * g12 * dvz
        let iz = k0m + dk
        if (iz < 0) iz += n
        else if (iz >= n) iz -= n
        for (let dj = -wy; dj <= wy; dj++) {
          const dvy = (j0 + dj) / n - cy
          const qyz = g11 * dvy * dvy + qz + pz2 * dvy
          const pxy = 2 * g01 * dvy + pz1
          let iy = j0m + dj
          if (iy < 0) iy += n
          else if (iy >= n) iy -= n
          const rowBase = (iz * n + iy) * n
          for (let di = -wx; di <= wx; di++) {
            const dvx = (i0 + di) / n - cx
            const r2 = g00 * dvx * dvx + pxy * dvx + qyz
            if (r2 * inv2s2 > 30) continue // 3σ 球外高斯尾（<1e-13）跳过
            let ix = i0m + di
            if (ix < 0) ix += n
            else if (ix >= n) ix -= n
            re[rowBase + ix] += amp * Math.exp(-r2 * inv2s2)
          }
        }
      }
    }
  }

  // —— 步骤 3：前向 3D FFT → Fcalc（覆盖全部整数 hkl）——
  fft3d(re, im, n, false)

  // —— 步骤 4：全局最小二乘尺度 k = Σ(Fobs·|Fcalc|)/Σ(|Fcalc|²) ——
  const ampArr = new Float64Array(nRef)
  const phArr = new Float64Array(nRef)
  let sfo = 0
  let sff = 0
  for (let q = 0; q < nRef; q++) {
    let ix = hs[q] % n; if (ix < 0) ix += n
    let iy = ks[q] % n; if (iy < 0) iy += n
    let iz = ls[q] % n; if (iz < 0) iz += n
    const idx = (iz * n + iy) * n + ix
    const fr = re[idx]
    const fi = im[idx]
    const a2 = Math.sqrt(fr * fr + fi * fi)
    ampArr[q] = a2
    phArr[q] = Math.atan2(fi, fr)
    sfo += fva[q] * a2
    sff += a2 * a2
  }
  const k = sff > 0 ? sfo / sff : 0

  // —— 步骤 5：2Fo−Fc 系数栅格 Fmap = (2·Fobs − k·|Fcalc|)·e^{iφcalc}，±h 共轭对 ——
  //（未观测槽位保持 0；自共轭槽位（实践中仅 000）只放实部，保证 IFFT 输出为实）
  re.fill(0)
  im.fill(0)
  for (let q = 0; q < nRef; q++) {
    const A = 2 * fva[q] - k * ampArr[q]
    const cr = A * Math.cos(phArr[q])
    const ci = A * Math.sin(phArr[q])
    let ix = hs[q] % n; if (ix < 0) ix += n
    let iy = ks[q] % n; if (iy < 0) iy += n
    let iz = ls[q] % n; if (iz < 0) iz += n
    let nix = -hs[q] % n; if (nix < 0) nix += n
    let niy = -ks[q] % n; if (niy < 0) niy += n
    let niz = -ls[q] % n; if (niz < 0) niz += n
    const idx = (iz * n + iy) * n + ix
    const nidx = (niz * n + niy) * n + nix
    if (idx === nidx) {
      re[idx] += cr
    } else {
      re[idx] += cr; im[idx] += ci
      re[nidx] += cr; im[nidx] -= ci
    }
  }

  // —— 步骤 6：逆 3D FFT → 实密度图（取实部；±h 共轭对保证虚部 ≈ 0）——
  fft3d(re, im, n, true)
  const grid = new Float32Array(n3)
  let mean = 0
  let min = Infinity
  let max = -Infinity
  for (let q = 0; q < n3; q++) {
    const v = re[q]
    grid[q] = v
    mean += v
    if (v < min) min = v
    if (v > max) max = v
  }
  mean /= n3

  // —— 步骤 7：统计 rms ——
  let varSum = 0
  for (let q = 0; q < n3; q++) {
    const d = grid[q] - mean
    varSum += d * d
  }
  const rms = Math.sqrt(varSum / n3)

  return {
    grid,
    n,
    voxel: [cell.a / n, cell.b / n, cell.c / n], // 近似体素尺寸（非正交 cell 为沿轴投影）
    rms,
    mean,
    min,
    max,
    scale: k,
    nRefs: nRef,
    cell,
  }
}

// ---------- 自检 ----------

/** 模块自检（无外部依赖、无网络）：
 *  ① FFT↔IFFT 往返（32³ 随机复数栅格，相对误差 < 1e-8）
 *  ② 单点冲击（原点冲激 → 全部 |F| ≡ 1）
 *  ③ parseSfCif 内嵌合成 CIF（_cell/_symmetry/_refln，F_meas_au 变体 + 折行 +
 *     引号 + esd + 无效行过滤 + fp/sigfp 旧变体）
 *  ④ computeDensityMap 合成小体系（20³ Å 正交 P1、8 原子、10 反射）端到端 */
export function sfSelfTest(): { ok: boolean; details: string } {
  const lines: string[] = []
  let ok = true
  const check = (name: string, pass: boolean, info: string): void => {
    if (!pass) ok = false
    lines.push((pass ? '✓ ' : '✗ ') + name + (info ? ' — ' + info : ''))
  }

  // ① FFT↔IFFT 往返
  {
    const n = 32
    const n3 = n * n * n
    const re = new Float64Array(n3)
    const im = new Float64Array(n3)
    let seed = 20250601
    const rnd = (): number => {
      seed = (seed * 48271) % 2147483647
      return (seed / 2147483647) * 200 - 100
    }
    let maxAbs = 0
    for (let q = 0; q < n3; q++) {
      re[q] = rnd()
      im[q] = rnd()
      const m = Math.max(Math.abs(re[q]), Math.abs(im[q]))
      if (m > maxAbs) maxAbs = m
    }
    const re0 = re.slice()
    const im0 = im.slice()
    fft3d(re, im, n, false)
    fft3d(re, im, n, true)
    let maxDiff = 0
    for (let q = 0; q < n3; q++) {
      const d = Math.max(Math.abs(re[q] - re0[q]), Math.abs(im[q] - im0[q]))
      if (d > maxDiff) maxDiff = d
    }
    const rel = maxDiff / maxAbs
    check('FFT↔IFFT 往返误差', rel < 1e-8, `相对误差 ${rel.toExponential(2)}（阈值 1e-8，32³ 随机复数栅格）`)
  }

  // ② 单点冲击
  {
    const n = 16
    const n3 = n * n * n
    const re = new Float64Array(n3)
    const im = new Float64Array(n3)
    re[0] = 1
    fft3d(re, im, n, false)
    let worst = 0
    for (let q = 0; q < n3; q++) {
      const d = Math.abs(Math.sqrt(re[q] * re[q] + im[q] * im[q]) - 1)
      if (d > worst) worst = d
    }
    check('单点冲击 |F| ≡ 1', worst < 1e-9, `最大偏差 ${worst.toExponential(2)}（16³）`)
  }

  // ③ parseSfCif：内嵌最小合成 SF mmCIF（5 行数据，F_meas_au 变体，含折行/引号/esd/注释）
  {
    const cif = [
      '# MolVision sffourier 自检合成数据（非真实结构）',
      'data_TESTSF',
      '_cell.length_a    20.0',
      '_cell.length_b    21.5(2)',
      '_cell.length_c    30.25',
      '_cell.angle_alpha 90.0',
      '_cell.angle_beta  90.0',
      '_cell.angle_gamma 90.0',
      "_symmetry.space_group_name_H-M   'P 21 21 21'",
      'loop_',
      '_refln.index_h',
      '_refln.index_k',
      '_refln.index_l',
      '_refln.f_meas_au',
      '_refln.f_meas_sigma_au',
      '0 0 2  120.5  6.0',
      '0 1 0   98.3  5.1',
      '1 0 0   88.7  4.7',
      '1 1 1   76.2  4.0',
      '2 2',              // ← 该行值跨行折行（mmCIF token 流）
      '0 55.1  3.2',
      '# 尾注释',
    ].join('\n')
    const r = parseSfCif(cif)
    const cOk = r.cell !== null && Math.abs(r.cell.a - 20) < 1e-9 && Math.abs(r.cell.b - 21.5) < 1e-9
      && Math.abs(r.cell.c - 30.25) < 1e-9 && Math.abs(r.cell.beta - 90) < 1e-9
    const rOk = r.reflns.length === 5
      && r.reflns[0].h === 0 && r.reflns[0].k === 0 && r.reflns[0].l === 2
      && Math.abs(r.reflns[0].fobs - 120.5) < 1e-9 && Math.abs(r.reflns[0].sigf - 6) < 1e-9
      && r.reflns[4].h === 2 && r.reflns[4].k === 2 && r.reflns[4].l === 0
      && Math.abs(r.reflns[4].fobs - 55.1) < 1e-9 && Math.abs(r.reflns[4].sigf - 3.2) < 1e-9
    const sgOk = r.spaceGroup === 'P 21 21 21'
    check('parseSfCif 合成 CIF', cOk && rOk && sgOk && !r.error,
      `${r.reflns.length} 反射（含 1 行跨行折行），cell ${r.cell ? r.cell.a + '/' + r.cell.b + '/' + r.cell.c : 'null'}，`
      + `SG "${r.spaceGroup ?? 'null'}"${r.error ? '，error=' + r.error : ''}`)
    // 无效行过滤 + fp/sigfp 旧列名变体
    const cif2 = [
      'data_T2',
      'loop_',
      '_refln.h',
      '_refln.k',
      '_refln.l',
      '_refln.fp',
      '_refln.sigfp',
      '1 0 0 50.0 2.0',
      '1 0 1 -5.0 1.0',
      '1 1 0 . 1.0',
      '1 1 1 30.0 ?',
      '2 0 0 0.0 0.0',
      '2 0 1 20.0 1.0',
    ].join('\n')
    const r2 = parseSfCif(cif2)
    check('parseSfCif 无效行过滤（fp/sigfp 变体）',
      r2.reflns.length === 2 && r2.reflns[1].h === 2 && r2.reflns[1].l === 1
        && Math.abs(r2.reflns[1].fobs - 20) < 1e-9
        && r2.cell === null && r2.spaceGroup === null,
      `${r2.reflns.length}/6 行保留（fobs≤0 / "." / "?" / 0 过滤 4 行）`)
  }

  // ④ computeDensityMap 端到端（20³ Å 正交 P1、8 原子、10 反射）。
  //    fobs 取解析模型密度幅度：F_d(h) = (n³/V)·(2πσ²)^{3/2}·e^{−2π²σ²·hᵀG⁻¹h}
  //    ·|Σ Z·e^{2πi h·f}|（正交 20³ 时 hᵀG⁻¹h = (h²+k²+l²)/a²）—— 与栅格化+FFT
  //    的 Fcalc 同量级，故结果 scale ≈ 1（绝对尺度链路验证）。B=40 使 σ≈0.71 Å
  //    ≈ 1.1 体素，采样/截断/混叠误差均 < 0.1%。
  {
    const cell: CrystalCell = { a: 20, b: 20, c: 20, alpha: 90, beta: 90, gamma: 90 }
    const pos = new Float32Array(24)
    const coords = [
      [2, 3, 4], [4, 3.5, 5], [3, 5, 6], [5, 5, 4],
      [2.5, 4.5, 5.5], [4.5, 2.5, 4.5], [3.5, 4, 6.5], [6, 4, 5.5],
    ]
    for (let t = 0; t < 8; t++) {
      pos[t * 3] = coords[t][0]
      pos[t * 3 + 1] = coords[t][1]
      pos[t * 3 + 2] = coords[t][2]
    }
    const B = 40
    const atoms: ModelAtoms = {
      pos,
      elements: ['C', 'N', 'O', 'S', 'C', 'N', 'O', 'C'],
      bfactors: new Float32Array(8).fill(B),
      occupancies: new Float32Array(8).fill(1),
      count: 8,
    }
    // 栅格化模型密度 FFT 的解析尺度（n=32 由 maxIdx=2 clamp 得，V=20³）
    const n = 32
    const s2 = B / (8 * Math.PI * Math.PI)          // σ²（Å²）
    const vol = 20 * 20 * 20
    const gaussVol = Math.pow(2 * Math.PI * s2, 1.5) // 高斯体积因子
    const dScale = (n * n * n / vol) * gaussVol      // 离散 DFT vs 连续 FT 的尺度
    const ZS = [6, 7, 8, 16, 6, 7, 8, 6]
    const hkls = [
      [0, 0, 1], [0, 0, 2], [0, 1, 0], [0, 1, 1], [1, 0, 0],
      [1, 0, 1], [1, 1, 0], [1, 1, 1], [2, 0, 0], [0, 2, 2],
    ]
    const reflns: SfRefln[] = hkls.map((hkl) => {
      let sr = 0
      let si = 0
      for (let t = 0; t < 8; t++) {
        const ph = (2 * Math.PI * (hkl[0] * pos[t * 3] + hkl[1] * pos[t * 3 + 1] + hkl[2] * pos[t * 3 + 2])) / 20
        sr += ZS[t] * Math.cos(ph)
        si += ZS[t] * Math.sin(ph)
      }
      const f = dScale * Math.exp(-2 * Math.PI * Math.PI * s2 * (hkl[0] * hkl[0] + hkl[1] * hkl[1] + hkl[2] * hkl[2]) / 400)
        * Math.sqrt(sr * sr + si * si)
      return { h: hkl[0], k: hkl[1], l: hkl[2], fobs: Math.max(f, 1), sigf: Math.max(0.05 * f, 0.5) }
    })
    const res = computeDensityMap(reflns, cell, 'P 1', atoms)
    // 峰位校验：图最大值体素 → 笛卡尔 → 距最近原子（相位正确性端到端验证）
    let dmin = Infinity
    let peakInfo = ''
    if (!res.error) {
      let bi = 0
      for (let q = 1; q < res.grid.length; q++) if (res.grid[q] > res.grid[bi]) bi = q
      const gxn = res.n
      const ix = bi % gxn
      const iy = Math.floor(bi / gxn) % gxn
      const iz = Math.floor(bi / (gxn * gxn))
      const gx = (ix / gxn) * 20
      const gy = (iy / gxn) * 20
      const gz = (iz / gxn) * 20
      for (let t = 0; t < 8; t++) {
        const dx = gx - pos[t * 3]
        const dy = gy - pos[t * 3 + 1]
        const dz = gz - pos[t * 3 + 2]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d < dmin) dmin = d
      }
      peakInfo = `峰距最近原子 ${dmin.toFixed(2)} Å`
    }
    check('computeDensityMap 合成小体系',
      !res.error && res.n === 32 && res.grid.length === 32768 && res.rms > 0 && res.nRefs === 10
        && res.scale > 0.95 && res.scale < 1.05 && dmin < 3.5,
      `n=${res.n}（grid ${res.grid.length}），nRefs=${res.nRefs}，scale=${res.scale.toFixed(4)}（fobs=解析|Fcalc| 时应 ≈1），`
      + `rms=${res.rms.toFixed(3)}，${peakInfo}${res.error ? '，error=' + res.error : ''}`)
  }

  return { ok, details: lines.join('\n') }
}
