// ============================================================================
// ccp4.ts —— CCP4/MRC 电子密度图（map）解析器（零三方依赖、纯 TypeScript；
// 仅主线程使用——错误文案经 tt() 双语化）
// ----------------------------------------------------------------------------
// 用途：解析 CCP4 MAP / MRC 密度图二进制（1024 字节头 + 体素数据），输出规范化
//       (x,y,z) 晶轴序的 Float32Array 体素场，供 marching-cubes.ts 提取等值面、
//       或上层模块渲染电子密度网格。
//
// 头部布局（CCP4 map 标准，全部字长 32 位，word n 位于字节 (n-1)*4）：
//   word 1-3    NX/NY/NZ      存储「列/行/节」采样数（列最快、节最慢）
//   word 4      MODE          0=int8、1=int16、2=float32（其余不支持）
//   word 5-7    NXSTART..     网格起点，按「列/行/节」即存储轴序（可为负）
//   word 8-10   MX/MY/MZ      晶胞采样数，按晶轴 x/y/z 序
//   word 11-16  CELL          a,b,c（Å）与 α,β,γ（度），晶轴序
//   word 17-19  MAPC/MAPR/MAPS 存储「列/行/节」各自对应的晶轴（1=x,2=y,3=z）
//   word 20-22  DMIN/DMAX/DMEAN 头部统计（本解析器一律重算，不信任头部值）
//   word 23     ISPG          空间群号；word 24 NSYMBT（数据偏移 = 1024+NSYMBT）
//   word 53     "MAP "        4 字节 ASCII 校验；若读作反转形态（" PAM"，或规格
//                            字面的 "PAM "）说明大端文件 → 全字按大端解析
//   word 55     ARMS          密度 RMS（>0 且有限时优先采用，否则重算）
//   （word 50-52 的正交原点、word 54 MACHST 不参与解析：端序由 word53 判别）
//
// 轴序语义（CCP4 标准实现，与 gemmi / cctbx / CCP4 库一致）：
//   · NX/NY/NZ 与 NXSTART/NYSTART/NZSTART 按「存储轴」（列/行/节）计数；
//   · MX/MY/MZ 与 CELL 按晶轴 x/y/z 计数，与 MAPC/MAPR/MAPS 无关。
//   即第 s 个存储轴（列/行/节）对应晶轴 A = MAPs−1：该轴采样数、网格起点取自
//   该存储轴的 NX*/NXSTART*，而体素分数步长恒为 1/M_A（晶轴序）。恒等轴序
//   （MAPC/R/S = 1,2,3）下两者重合，fracOrigin 即 (NXS/MX, NYS/MY, NZS/MZ)。
//   解析输出一律重排为规范 (x,y,z)：data 索引 = (k*ny + j)*nx + i（i 沿 x 最快），
//   dims/fracOrigin 同步重排；fracStep = (1/MX, 1/MY, 1/MZ) 本就是晶轴序。
//   M*=0 或非正时按 M*=N*（该晶轴采样数）兜底。
//
// 正交化矩阵 orthoCcP4（行主序 9 元素，三列 = 格矢，cart = M·frac）：
//   CCP4/PDB 约定 x∥a、z∥c*、y = z×x（右手系），推导如下：
//     a_vec = (a, 0, 0)
//     b_vec = (b·cosγ, b·sinγ, 0)                        （b 落在 xy 面）
//     c_vec = (c·cosβ, c·(cosα−cosβ·cosγ)/sinγ, √(c²−cx²−cy²))
//   验证：c·a = c·cx = ac·cosβ ⇒ cx = c·cosβ（因 x∥a）；
//   c·b = bc·cosα = cx·b·cosγ + cy·b·sinγ ⇒ cy 如上；cz 取正保证右手系；
//   a×b = (0,0,ab·sinγ) ∥ +z ⇒ z∥c*（c* ⊥ a、b 所在平面）。
//
// 校验（失败返回 { error: 中文信息 }）：文件过短、word53 非 "MAP "/"PAM"、MODE
// 不支持、NX/NY/NZ ≤0 或 >4096、轴序非 1/2/3 排列、NSYMBT 为负、数据偏移超界、
// 晶胞参数非法、数据不足（截断）/数据长度不符（多余字节）、体素数组无法分配。
// ============================================================================

import { tt } from '@/i18n'

/** 解析成功的 CCP4/MRC 密度图（全部已规范化为晶轴 (x,y,z) 序） */
export interface Ccp4Map {
  dims: [number, number, number]      // 规范化 (x,y,z) 轴序后采样数
  data: Float32Array                   // 规范化顺序，索引 = (k*ny + j)*nx + i（i 沿 x 最快）
  fracOrigin: [number, number, number] // 第一个体素分数坐标
  fracStep: [number, number, number]   // 每体素分数步长（规范化后各轴）
  cell: [number, number, number, number, number, number] // a,b,c,α,β,γ
  mean: number; rms: number; min: number; max: number
  spaceGroup: number
  /** CCP4 帧的正交化矩阵（x∥a、z∥c*、y=z×x 右手系，行主序 9 元素），用于把分数坐标转 CCP4 帧笛卡尔坐标 */
  orthoCcP4: number[]
}

/** 单轴采样数上限（防损坏头部导致的天文数字分配） */
const MAX_DIM = 4096

/**
 * 解析 CCP4/MRC 密度图二进制。
 * @param buffer 完整文件内容（1024 字节 CCP4 头 + 数据，ArrayBuffer）
 * @returns 成功返回 Ccp4Map；任何校验失败返回 { error: 中文错误信息 }
 */
export function parseCcp4(buffer: ArrayBuffer): Ccp4Map | { error: string } {
  // ── 0) 最小长度：需读到 word55（字节 216..219）──
  if (buffer.byteLength < 224) {
    return { error: tt({ zh: `文件过短：仅 ${buffer.byteLength} 字节（CCP4 头部至少需 224 字节）`, en: `File too short: only ${buffer.byteLength} bytes (CCP4 header requires at least 224 bytes)` }) }
  }

  // ── 1) word53 "MAP " 校验兼字节序判别（字符串不随数值端序变化，反转形态即大端）──
  const u8 = new Uint8Array(buffer)
  const tag = [u8[208], u8[209], u8[210], u8[211]]
  const isMapLe = tag[0] === 0x4d && tag[1] === 0x41 && tag[2] === 0x50 && tag[3] === 0x20 // "MAP "
  const isPamRev = tag[0] === 0x20 && tag[1] === 0x50 && tag[2] === 0x41 && tag[3] === 0x4d // " PAM"（整字反转）
  const isPamLit = tag[0] === 0x50 && tag[1] === 0x41 && tag[2] === 0x4d && tag[3] === 0x20 // "PAM "（字面大端标记）
  if (!isMapLe && !isPamRev && !isPamLit) {
    return { error: tt({ zh: 'word53 校验失败：非 "MAP "（亦非大端 " PAM"/"PAM "），不是 CCP4/MRC 密度图', en: 'word53 check failed: not "MAP " (nor big-endian " PAM"/"PAM ") — not a CCP4/MRC map' }) }
  }
  const le = isMapLe // "MAP " → 小端；反转形态 → 大端（等效于全字字节序转换后继续）

  // ── 2) 头字段（int/float 一律按判别出的端序读取）──
  const dv = new DataView(buffer)
  const i32 = (w: number): number => dv.getInt32((w - 1) * 4, le)
  const f32 = (w: number): number => dv.getFloat32((w - 1) * 4, le)
  const nStor: [number, number, number] = [i32(1), i32(2), i32(3)]  // NX/NY/NZ（存储序）
  const mode = i32(4)
  const startS: [number, number, number] = [i32(5), i32(6), i32(7)] // NXSTART..（存储序，可为负）
  const mCry: [number, number, number] = [i32(8), i32(9), i32(10)]  // MX/MY/MZ（晶轴序）
  const cell: [number, number, number, number, number, number] = [
    f32(11), f32(12), f32(13), f32(14), f32(15), f32(16),
  ]
  const mapc = i32(17)
  const mapr = i32(18)
  const maps = i32(19)
  const ispg = i32(23)
  const nsymbt = i32(24)
  const arms = f32(55) // word55 ARMS

  // ── 3) 逐项校验 ──
  if (mode !== 0 && mode !== 1 && mode !== 2) {
    return { error: tt({ zh: `不支持的 MODE ${mode}（仅支持 0=int8、1=int16、2=float32）`, en: `Unsupported MODE ${mode} (only 0=int8, 1=int16, 2=float32 are supported)` }) }
  }
  for (const n of nStor) {
    if (!(n > 0) || n > MAX_DIM) {
      return { error: tt({ zh: `采样数非法：NX/NY/NZ=${nStor[0]}/${nStor[1]}/${nStor[2]}（各须在 1..${MAX_DIM}）`, en: `Invalid sampling counts: NX/NY/NZ=${nStor[0]}/${nStor[1]}/${nStor[2]} (each must be 1..${MAX_DIM})` }) }
    }
  }
  // 存储轴（列/行/节）→ 晶轴（0=x,1=y,2=z），须为 1/2/3 的排列
  const axOf: [number, number, number] = [mapc - 1, mapr - 1, maps - 1]
  let axisMask = 0
  for (const ax of axOf) {
    if (ax < 0 || ax > 2) {
      return { error: tt({ zh: `轴序非法：MAPC/MAPR/MAPS=${mapc}/${mapr}/${maps}（各须为 1/2/3）`, en: `Invalid axis mapping: MAPC/MAPR/MAPS=${mapc}/${mapr}/${maps} (each must be 1/2/3)` }) }
    }
    axisMask |= 1 << ax
  }
  if (axisMask !== 0b111) {
    return { error: tt({ zh: `轴序非法：MAPC/MAPR/MAPS=${mapc}/${mapr}/${maps}（须为 1/2/3 的排列）`, en: `Invalid axis mapping: MAPC/MAPR/MAPS=${mapc}/${mapr}/${maps} (must be a permutation of 1/2/3)` }) }
  }
  if (nsymbt < 0) {
    return { error: tt({ zh: `NSYMBT=${nsymbt} 为负，文件头损坏`, en: `NSYMBT=${nsymbt} is negative — corrupted file header` }) }
  }
  const dataOffset = 1024 + nsymbt // 数据起始（头 1024 字节 + 附加对称记录）
  if (buffer.byteLength < dataOffset) {
    return { error: tt({ zh: `数据偏移 1024+NSYMBT=${dataOffset} 超出文件长度 ${buffer.byteLength}`, en: `Data offset 1024+NSYMBT=${dataOffset} exceeds file length ${buffer.byteLength}` }) }
  }
  const [a, b, c, alphaD, betaD, gammaD] = cell
  if (!(a > 0) || !(b > 0) || !(c > 0) ||
      !(alphaD > 0 && alphaD < 180) || !(betaD > 0 && betaD < 180) || !(gammaD > 0 && gammaD < 180)) {
    return { error: tt({ zh: `晶胞参数非法：a/b/c=${a}/${b}/${c}，α/β/γ=${alphaD}/${betaD}/${gammaD}`, en: `Invalid unit cell: a/b/c=${a}/${b}/${c}, α/β/γ=${alphaD}/${betaD}/${gammaD}` }) }
  }
  // 正交化基向量（详见文件头推导）
  const rad = Math.PI / 180
  const ca = Math.cos(alphaD * rad)
  const cb = Math.cos(betaD * rad)
  const cg = Math.cos(gammaD * rad)
  const sg = Math.sin(gammaD * rad)
  if (sg < 1e-9) {
    return { error: tt({ zh: `晶胞角 γ=${gammaD} 过于退化（sinγ≈0），无法正交化`, en: `Unit-cell angle γ=${gammaD} is too degenerate (sinγ≈0) — cannot orthogonalize` }) }
  }
  const cX = c * cb
  const cY = (c * (ca - cb * cg)) / sg
  const cZ2 = c * c - cX * cX - cY * cY
  if (cZ2 <= 0) {
    return { error: tt({ zh: '晶胞参数不合理：α/β/γ 无法构成有效晶胞（c 的 z 分量平方为负）', en: 'Implausible unit cell: α/β/γ cannot form a valid cell (negative squared z-component of c)' }) }
  }
  // 数据长度校验（体素数 × 每体素字节数；mode0=1、mode1=2、mode2=4）
  const bps = mode === 0 ? 1 : mode === 1 ? 2 : 4
  const nvox = nStor[0] * nStor[1] * nStor[2]
  const needBytes = nvox * bps
  const remaining = buffer.byteLength - dataOffset
  if (remaining < needBytes) {
    return { error: tt({ zh: `数据不足：需 ${needBytes} 字节（${nvox} 体素 × ${bps} 字节），实际仅剩 ${remaining} 字节——文件被截断`, en: `Insufficient data: need ${needBytes} bytes (${nvox} voxels × ${bps} bytes), only ${remaining} remain — file truncated` }) }
  }
  if (remaining > needBytes) {
    return { error: tt({ zh: `数据长度不符：剩余 ${remaining} 字节 ≠ 预期 ${needBytes} 字节（多出 ${remaining - needBytes} 字节）`, en: `Data length mismatch: ${remaining} bytes remain ≠ expected ${needBytes} bytes (${remaining - needBytes} extra)` }) }
  }

  // ── 4) 存储轴 → 晶轴重排（dims、起点），并求分数原点/步长 ──
  // posOf[晶轴] = 该晶轴所在的存储位置（0=列,1=行,2=节）
  const posOf: [number, number, number] = [-1, -1, -1]
  posOf[axOf[0]] = 0 // 列
  posOf[axOf[1]] = 1 // 行
  posOf[axOf[2]] = 2 // 节
  const dims: [number, number, number] = [nStor[posOf[0]], nStor[posOf[1]], nStor[posOf[2]]]
  const startCry: [number, number, number] = [startS[posOf[0]], startS[posOf[1]], startS[posOf[2]]]
  // 晶胞采样兜底：M*=0 或非正 → M*=N*（该晶轴采样数）
  const m: [number, number, number] = [mCry[0], mCry[1], mCry[2]]
  for (let axI = 0; axI < 3; axI++) {
    if (!(m[axI] > 0)) m[axI] = dims[axI]
  }
  const fracStep: [number, number, number] = [1 / m[0], 1 / m[1], 1 / m[2]]
  const fracOrigin: [number, number, number] = [startCry[0] / m[0], startCry[1] / m[1], startCry[2] / m[2]]

  // ── 5) 体素数据：按存储顺序读入并散写到晶序 (k*ny + j)*nx + i ──
  let out: Float32Array
  try {
    out = new Float32Array(nvox)
  } catch {
    return { error: tt({ zh: `体素数 ${nvox} 过大，无法分配密度数组（${nvox * 4} 字节）`, en: `Voxel count ${nvox} too large to allocate the density array (${nvox * 4} bytes)` }) }
  }
  const outStride = [1, dims[0], dims[0] * dims[1]] // 晶轴 x/y/z 的输出步长（x 最快）
  const isIdentity = axOf[0] === 0 && axOf[1] === 1 && axOf[2] === 2
  if (mode === 2 && le && isIdentity && dataOffset % 4 === 0) {
    // 快路径：小端 float32 + 恒等轴序 + 4 字节对齐 → 视图一次拷贝
    out.set(new Float32Array(buffer, dataOffset, nvox))
  } else {
    // 通用路径：列/行/节乘以各自晶轴的输出步长（非恒等轴序时内层跳步写出）
    const sm = [outStride[axOf[0]], outStride[axOf[1]], outStride[axOf[2]]]
    let inB = dataOffset
    for (let sec = 0; sec < nStor[2]; sec++) {
      const base2 = sec * sm[2]
      for (let row = 0; row < nStor[1]; row++) {
        const base1 = base2 + row * sm[1]
        for (let col = 0; col < nStor[0]; col++) {
          let v: number
          if (mode === 0) v = dv.getInt8(inB)
          else if (mode === 1) v = dv.getInt16(inB, le)
          else v = dv.getFloat32(inB, le)
          out[base1 + col * sm[0]] = v
          inB += bps
        }
      }
    }
  }

  // ── 6) 统计：min/max/mean 一律重算；rms 优先 word55（>0 且有限），否则重算 ──
  let vmin = Infinity
  let vmax = -Infinity
  let sum = 0
  let sumsq = 0
  for (let t = 0; t < nvox; t++) {
    const v = out[t]
    if (v < vmin) vmin = v
    if (v > vmax) vmax = v
    sum += v
    sumsq += v * v
  }
  const mean = sum / nvox
  const rms = Number.isFinite(arms) && arms > 0 ? arms : Math.sqrt(sumsq / nvox)

  return {
    dims,
    data: out,
    fracOrigin,
    fracStep,
    cell,
    mean,
    rms,
    min: vmin,
    max: vmax,
    spaceGroup: ispg,
    // 行主序：M[0..2] = 第一行；三列分别为 a_vec / b_vec / c_vec
    orthoCcP4: [a, b * cg, cX, 0, b * sg, cY, 0, 0, Math.sqrt(cZ2)],
  }
}

// ============================================================================
// 自检专用工具（模块私有、不导出）：合成 CCP4 map 二进制
// ============================================================================

/** 合成图规格（字段语义同 parseCcp4 头字段；统计字段允许故意写错以验证重算） */
interface SynthSpec {
  n: [number, number, number]      // NX/NY/NZ（存储序）
  start: [number, number, number]  // NXSTART/NYSTART/NZSTART（存储序）
  m: [number, number, number]      // MX/MY/MZ（晶轴序）
  axes: [number, number, number]   // MAPC/MAPR/MAPS
  mode: 0 | 1 | 2
  values: Float64Array             // 存储序体素值（按 mode 量化写入）
  cell: [number, number, number, number, number, number]
  ispg: number
  arms: number
  dmin: number
  dmax: number
  dmean: number
}

/** 小端写入一张合成 CCP4 map（NSYMBT=0；word54 写常规 MACHST 字节） */
function buildMap(s: SynthSpec): ArrayBuffer {
  const nvox = s.n[0] * s.n[1] * s.n[2]
  const bps = s.mode === 0 ? 1 : s.mode === 1 ? 2 : 4
  const buf = new ArrayBuffer(1024 + nvox * bps)
  const dv = new DataView(buf)
  const iW = (w: number, v: number): void => dv.setInt32((w - 1) * 4, v, true)
  const fW = (w: number, v: number): void => dv.setFloat32((w - 1) * 4, v, true)
  iW(1, s.n[0])
  iW(2, s.n[1])
  iW(3, s.n[2])
  iW(4, s.mode)
  iW(5, s.start[0])
  iW(6, s.start[1])
  iW(7, s.start[2])
  iW(8, s.m[0])
  iW(9, s.m[1])
  iW(10, s.m[2])
  fW(11, s.cell[0])
  fW(12, s.cell[1])
  fW(13, s.cell[2])
  fW(14, s.cell[3])
  fW(15, s.cell[4])
  fW(16, s.cell[5])
  iW(17, s.axes[0])
  iW(18, s.axes[1])
  iW(19, s.axes[2])
  fW(20, s.dmin)
  fW(21, s.dmax)
  fW(22, s.dmean)
  iW(23, s.ispg)
  iW(24, 0) // NSYMBT：无附加对称记录
  // word53 "MAP "：按小端 u32 0x2050414D 写入，落盘字节恰为 M,A,P,' '
  dv.setUint32(208, 0x2050414d, true)
  // word54 MACHST：常规小端标记 44 41 00 00（解析器不读，仅为仿真真实文件）
  dv.setUint32(212, 0x00004144, true)
  fW(55, s.arms)
  iW(56, 0) // NLABL：无标签
  // 数据区：按存储顺序（列最快）逐一量化写入
  let off = 1024
  for (let t = 0; t < nvox; t++) {
    const v = s.values[t]
    if (s.mode === 2) dv.setFloat32(off, v, true)
    else if (s.mode === 1) dv.setInt16(off, Math.round(v), true)
    else dv.setInt8(off, Math.round(v))
    off += bps
  }
  return buf
}

/** 全字（4 字节）字节序反转 → 模拟大端机器写出的文件（word53 随之反转为 " PAM"） */
function swapWords4(buf: ArrayBuffer): ArrayBuffer {
  const out = new ArrayBuffer(buf.byteLength)
  const src = new Uint8Array(buf)
  const dst = new Uint8Array(out)
  for (let i = 0; i + 4 <= buf.byteLength; i += 4) {
    dst[i] = src[i + 3]
    dst[i + 1] = src[i + 2]
    dst[i + 2] = src[i + 1]
    dst[i + 3] = src[i]
  }
  return out
}

/** 相对容差比较（tol 为相对量级，含绝对下限 1） */
function close(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b))
}

// ============================================================================
// 自检：合成图 → 解析 → 逐项核对
//   ① 16³ mode2 正弦场（恒等轴序）：dims/抽样值/统计重算/fracOrigin/orthoCcP4
//   ② 轴序置换（MAPC=3,MAPR=1,MAPS=2）：同一晶序内容两种存储，解析须完全一致
//   ③ mode1 int16（rms 取 word55）/ mode0 int8 / 大端 " PAM" 与字面 "PAM " 变体
//   ④ 错误路径：截断、word53 错误、MODE/dims/轴序/晶胞非法、多余字节 → { error }
// ============================================================================

export function ccp4SelfTest(): { ok: boolean; details: string } {
  const fails: string[] = []
  const info: string[] = []
  const t0 = performance.now()

  // ── ① 16³ mode2 正弦场：头部统计故意写错（-999/999/-999）、ARMS=0 → 全部重算 ──
  const N = 16
  const vals1 = new Float64Array(N * N * N)
  for (let k = 0; k < N; k++) {
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        vals1[(k * N + j) * N + i] =
          100 * Math.sin(0.41 * i + 0.63 * j + 0.27 * k + 0.7) +
          20 * Math.cos(0.13 * i - 0.29 * j + 0.51 * k)
      }
    }
  }
  const exp1 = new Float32Array(vals1) // 期望值以 float32 落盘后的真值为准
  let eMin = Infinity
  let eMax = -Infinity
  let eSum = 0
  let eSq = 0
  for (let t = 0; t < exp1.length; t++) {
    const v = exp1[t]
    if (v < eMin) eMin = v
    if (v > eMax) eMax = v
    eSum += v
    eSq += v * v
  }
  const eMean = eSum / exp1.length
  const eRms = Math.sqrt(eSq / exp1.length)
  const cell1: [number, number, number, number, number, number] = [30, 25, 20, 80, 110, 70]
  const buf1 = buildMap({
    n: [N, N, N], start: [3, 5, 7], m: [20, 16, 32], axes: [1, 2, 3], mode: 2,
    values: vals1, cell: cell1, ispg: 19, arms: 0, dmin: -999, dmax: 999, dmean: -999,
  })
  const r1 = parseCcp4(buf1)
  if ('error' in r1) {
    fails.push(`①解析失败：${r1.error}`)
  } else {
    if (r1.dims[0] !== N || r1.dims[1] !== N || r1.dims[2] !== N) {
      fails.push(`①dims=[${r1.dims}] 应为 [16,16,16]`)
    }
    if (r1.data.length !== N * N * N) fails.push(`①data 长度 ${r1.data.length} ≠ ${N * N * N}`)
    // fracOrigin = (NXS/MX, NYS/MY, NZS/MZ) = (3/20, 5/16, 7/32)；fracStep = 各轴 1/M
    if (!close(r1.fracOrigin[0], 3 / 20, 1e-12) || !close(r1.fracOrigin[1], 5 / 16, 1e-12) || !close(r1.fracOrigin[2], 7 / 32, 1e-12)) {
      fails.push(`①fracOrigin=[${r1.fracOrigin}] 应为 [${3 / 20},${5 / 16},${7 / 32}]`)
    }
    if (!close(r1.fracStep[0], 1 / 20, 1e-12) || !close(r1.fracStep[1], 1 / 16, 1e-12) || !close(r1.fracStep[2], 1 / 32, 1e-12)) {
      fails.push(`①fracStep=[${r1.fracStep}] 应为 [${1 / 20},${1 / 16},${1 / 32}]`)
    }
    // 抽样点值（角/中心/随机）位级一致；再全量比对
    const spots: Array<[number, number, number]> = [
      [0, 0, 0], [15, 15, 15], [8, 8, 8], [3, 7, 11], [11, 2, 13], [5, 14, 1],
    ]
    let badSpot = 0
    for (const [i, j, k] of spots) {
      if (r1.data[(k * N + j) * N + i] !== exp1[(k * N + j) * N + i]) badSpot++
    }
    let badAll = 0
    for (let t = 0; t < exp1.length; t++) {
      if (r1.data[t] !== exp1[t]) badAll++
    }
    if (badSpot > 0) fails.push(`①抽样点 ${badSpot}/${spots.length} 个值不符`)
    if (badAll > 0) fails.push(`①全量比对 ${badAll}/${exp1.length} 个体素不符`)
    // 统计：min/max/mean 重算（头部写的是 -999/999/-999），ARMS=0 → rms 重算
    if (!close(r1.min, eMin, 1e-9) || !close(r1.max, eMax, 1e-9)) {
      fails.push(`①min/max=${r1.min}/${r1.max} 应为 ${eMin}/${eMax}（须重算而非取头部）`)
    }
    if (!close(r1.mean, eMean, 1e-9)) fails.push(`①mean=${r1.mean} 应为 ${eMean}（须重算）`)
    if (!close(r1.rms, eRms, 1e-9)) fails.push(`①rms=${r1.rms} 应为 ${eRms}（ARMS=0 时须重算）`)
    if (r1.spaceGroup !== 19) fails.push(`①spaceGroup=${r1.spaceGroup} 应为 19`)
    for (let t = 0; t < 6; t++) {
      if (r1.cell[t] !== cell1[t]) fails.push(`①cell[${t}]=${r1.cell[t]} ≠ ${cell1[t]}`)
    }
    // orthoCcP4：三列 = 格矢 → 长度/夹角复现晶胞参数；x∥a；z∥c*；右手系
    const M = r1.orthoCcP4
    if (M.length !== 9) {
      fails.push(`①orthoCcP4 长度 ${M.length} ≠ 9`)
    } else {
      const A = [M[0], M[3], M[6]] // 第一列 = a_vec
      const B = [M[1], M[4], M[7]] // 第二列 = b_vec
      const C = [M[2], M[5], M[8]] // 第三列 = c_vec
      const dot = (u: number[], v: number[]): number => u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
      const norm = (u: number[]): number => Math.sqrt(dot(u, u))
      if (A[1] !== 0 || A[2] !== 0 || A[0] !== 30) fails.push(`①orthoCcP4 第一列 [${A}] 应为 (30,0,0)（x∥a）`)
      if (!close(norm(A), 30, 1e-9) || !close(norm(B), 25, 1e-9) || !close(norm(C), 20, 1e-9)) {
        fails.push(`①orthoCcP4 列模长 ${norm(A)}/${norm(B)}/${norm(C)} ≠ a/b/c`)
      }
      if (!close(dot(A, B) / (norm(A) * norm(B)), Math.cos((70 * Math.PI) / 180), 1e-9)) fails.push('①orthoCcP4 列 A·B 夹角 ≠ γ')
      if (!close(dot(A, C) / (norm(A) * norm(C)), Math.cos((110 * Math.PI) / 180), 1e-9)) fails.push('①orthoCcP4 列 A·C 夹角 ≠ β')
      if (!close(dot(B, C) / (norm(B) * norm(C)), Math.cos((80 * Math.PI) / 180), 1e-9)) fails.push('①orthoCcP4 列 B·C 夹角 ≠ α')
      // z∥c*：A×B 应纯 +z 方向（c* ⊥ a、b 所在平面）
      const crX = A[1] * B[2] - A[2] * B[1]
      const crY = A[2] * B[0] - A[0] * B[2]
      const crZ = A[0] * B[1] - A[1] * B[0]
      if (Math.abs(crX) > 1e-9 || Math.abs(crY) > 1e-9 || crZ <= 0) fails.push('①orthoCcP4 不满足 z∥c*（A×B 应为 +z）')
      // 右手系：det = A·(B×C) > 0
      const det = A[0] * (B[1] * C[2] - B[2] * C[1]) - A[1] * (B[0] * C[2] - B[2] * C[0]) + A[2] * (B[0] * C[1] - B[1] * C[0])
      if (det <= 0) fails.push('①orthoCcP4 非右手系（det ≤ 0）')
    }
    info.push(
      `①mode2 16³：4096 体素位级一致（抽样 ${spots.length - badSpot}/${spots.length}），` +
      `统计重算 min=${r1.min.toFixed(2)} mean=${r1.mean.toFixed(3)} rms=${r1.rms.toFixed(3)}，` +
      `fracOrigin=(${(3 / 20).toFixed(4)},${(5 / 16).toFixed(4)},${(7 / 32).toFixed(4)})，ortho Gram/定向通过`,
    )
  }

  // ── ② 轴序置换（MAPC=3,MAPR=1,MAPS=2）：同一晶序内容两种存储，解析须完全一致 ──
  // 晶序参考场：x/y/z 采样 13/11/17，晶胞采样 26/22/34（各向异性，M≠N 且逐轴不同），
  // 晶序起点 (5,3,9)。置换文件的 NX/NY/NZ 与 NXSTART.. 按存储轴（列=z、行=x、节=y）
  // 写入，而 MX/MY/MZ 仍按晶轴（CCP4 标准语义）。
  const pnx = 13
  const pny = 11
  const pnz = 17
  const pM: [number, number, number] = [26, 22, 34]
  const ps: [number, number, number] = [5, 3, 9]
  const refVal = (x: number, y: number, z: number): number =>
    3.7 * x - 5.1 * y + 7.3 * z + 40 * Math.sin(0.21 * x + 0.35 * y + 0.17 * z)
  const valsId = new Float64Array(pnx * pny * pnz) // 恒等序（列=x,行=y,节=z）
  for (let k = 0; k < pnz; k++) {
    for (let j = 0; j < pny; j++) {
      for (let i = 0; i < pnx; i++) {
        valsId[(k * pny + j) * pnx + i] = refVal(ps[0] + i, ps[1] + j, ps[2] + k)
      }
    }
  }
  const valsPm = new Float64Array(pnz * pnx * pny) // 置换序（列=z,行=x,节=y）
  for (let s = 0; s < pny; s++) {
    for (let r = 0; r < pnx; r++) {
      for (let c = 0; c < pnz; c++) {
        valsPm[(s * pnx + r) * pnz + c] = refVal(ps[0] + r, ps[1] + s, ps[2] + c)
      }
    }
  }
  const cell2: [number, number, number, number, number, number] = [40, 36, 32, 90, 100, 90]
  const bufId = buildMap({
    n: [pnx, pny, pnz], start: [ps[0], ps[1], ps[2]], m: pM, axes: [1, 2, 3], mode: 2,
    values: valsId, cell: cell2, ispg: 4, arms: 0, dmin: 0, dmax: 0, dmean: 0,
  })
  const bufPm = buildMap({
    n: [pnz, pnx, pny], start: [ps[2], ps[0], ps[1]], m: pM, axes: [3, 1, 2], mode: 2,
    values: valsPm, cell: cell2, ispg: 4, arms: 0, dmin: 0, dmax: 0, dmean: 0,
  })
  const rId = parseCcp4(bufId)
  const rPm = parseCcp4(bufPm)
  if ('error' in rId) {
    fails.push(`②恒等序解析失败：${rId.error}`)
  } else if ('error' in rPm) {
    fails.push(`②置换序解析失败：${rPm.error}`)
  } else {
    if (rPm.dims[0] !== pnx || rPm.dims[1] !== pny || rPm.dims[2] !== pnz) {
      fails.push(`②置换 dims=[${rPm.dims}] 应为 [${pnx},${pny},${pnz}]`)
    }
    const wantO = [ps[0] / pM[0], ps[1] / pM[1], ps[2] / pM[2]]
    const wantS = [1 / pM[0], 1 / pM[1], 1 / pM[2]]
    for (let t = 0; t < 3; t++) {
      if (!close(rPm.fracOrigin[t], wantO[t], 1e-12) || !close(rPm.fracStep[t], wantS[t], 1e-12)) {
        fails.push(`②置换 fracOrigin/fracStep 第 ${t} 轴不符（origin=${rPm.fracOrigin} step=${rPm.fracStep}）`)
      }
    }
    if (rPm.spaceGroup !== 4) fails.push(`②置换 spaceGroup=${rPm.spaceGroup} 应为 4`)
    // 与恒等序逐体素位级一致（data/dims/origin/step 重排全部正确的强判据）
    let mism = 0
    for (let t = 0; t < rId.data.length; t++) {
      if (rId.data[t] !== rPm.data[t]) mism++
    }
    if (mism > 0) fails.push(`②置换重排错误：${mism}/${rId.data.length} 个体素与恒等序不一致`)
    // 抽样体素对应参考场（晶格点 = 晶序起点 + 索引）
    const spots2: Array<[number, number, number]> = [
      [0, 0, 0], [12, 10, 16], [6, 5, 8], [1, 9, 3], [11, 0, 15],
    ]
    let bad2 = 0
    for (const [i, j, k] of spots2) {
      if (rPm.data[(k * pny + j) * pnx + i] !== Math.fround(refVal(ps[0] + i, ps[1] + j, ps[2] + k))) bad2++
    }
    if (bad2 > 0) fails.push(`②抽样点 ${bad2}/${spots2.length} 个值不符`)
    info.push(`②轴序置换（3,1,2）：${rId.data.length} 体素位级一致，抽样 ${spots2.length - bad2}/${spots2.length} 正确`)
  }

  // ── ③a mode1 int16：rms 优先 word55；另测 MX=0 兜底（M*=N*）──
  const qn: [number, number, number] = [8, 10, 12]
  const qs: [number, number, number] = [2, 0, 4]
  const qm: [number, number, number] = [16, 20, 24]
  const valsQ = new Float64Array(qn[0] * qn[1] * qn[2])
  for (let k = 0; k < qn[2]; k++) {
    for (let j = 0; j < qn[1]; j++) {
      for (let i = 0; i < qn[0]; i++) {
        valsQ[(k * qn[1] + j) * qn[0] + i] = Math.round(400 * Math.sin(0.5 * i + 0.31 * j + 0.23 * k) + 100 * Math.cos(0.7 * i - 0.4 * j + 0.9 * k))
      }
    }
  }
  const expQ = new Float32Array(valsQ)
  let qMin = Infinity
  let qMax = -Infinity
  let qSum = 0
  for (let t = 0; t < expQ.length; t++) {
    const v = expQ[t]
    if (v < qMin) qMin = v
    if (v > qMax) qMax = v
    qSum += v
  }
  const qMean = qSum / expQ.length
  const bufQ = buildMap({
    n: qn, start: qs, m: qm, axes: [1, 2, 3], mode: 1, values: valsQ,
    cell: [25, 30, 35, 90, 90, 90], ispg: 92, arms: 42.5, dmin: -1, dmax: -1, dmean: -1,
  })
  const rQ = parseCcp4(bufQ)
  if ('error' in rQ) {
    fails.push(`③mode1 解析失败：${rQ.error}`)
  } else {
    // int16 值必须精确还原（均为整数）
    let badQ = 0
    let nonInt = 0
    for (let t = 0; t < expQ.length; t++) {
      if (rQ.data[t] !== expQ[t]) badQ++
      if (rQ.data[t] !== Math.round(rQ.data[t])) nonInt++
    }
    if (badQ > 0) fails.push(`③mode1 ${badQ} 个体素值不符`)
    if (nonInt > 0) fails.push(`③mode1 ${nonInt} 个非整数值`)
    // rms 优先 word55（42.5）；min/max/mean 重算（头部写 -1）
    if (rQ.rms !== 42.5) fails.push(`③mode1 rms=${rQ.rms} 应为 42.5（word55 优先）`)
    if (!close(rQ.min, qMin, 1e-9) || !close(rQ.max, qMax, 1e-9) || !close(rQ.mean, qMean, 1e-9)) {
      fails.push(`③mode1 统计 min/max/mean=${rQ.min}/${rQ.max}/${rQ.mean} 应为 ${qMin}/${qMax}/${qMean}`)
    }
    if (!close(rQ.fracOrigin[0], 2 / 16, 1e-12) || rQ.fracOrigin[1] !== 0 || !close(rQ.fracOrigin[2], 4 / 24, 1e-12)) {
      fails.push(`③mode1 fracOrigin=[${rQ.fracOrigin}] 不符`)
    }
    if (!close(rQ.fracStep[0], 1 / 16, 1e-12) || !close(rQ.fracStep[1], 1 / 20, 1e-12) || !close(rQ.fracStep[2], 1 / 24, 1e-12)) {
      fails.push(`③mode1 fracStep=[${rQ.fracStep}] 不符`)
    }
    if (rQ.spaceGroup !== 92) fails.push(`③mode1 spaceGroup=${rQ.spaceGroup} 应为 92`)
    // MX=0 兜底：fracStep[0] → 1/NX、fracOrigin[0] → NXS/NX
    const bufQ0 = bufQ.slice(0)
    new DataView(bufQ0).setInt32(28, 0, true) // word8 MX=0
    const rQ0 = parseCcp4(bufQ0)
    if ('error' in rQ0) {
      fails.push(`③MX=0 兜底解析失败：${rQ0.error}`)
    } else if (rQ0.fracStep[0] !== 1 / qn[0] || rQ0.fracOrigin[0] !== qs[0] / qn[0]) {
      fails.push('③MX=0 兜底后 fracStep/fracOrigin 不符（应按 M*=N*）')
    }
    info.push(`③mode1 int16：${expQ.length} 体素精确还原，rms=42.5 取 word55，MX=0 兜底通过`)
  }

  // ── ③b mode0 int8（小尺寸，通用散写路径）──
  const valsR = new Float64Array(6 * 7 * 5)
  for (let t = 0; t < valsR.length; t++) {
    valsR[t] = Math.round(60 * Math.sin(t * 0.7) + 30 * Math.cos(t * 1.3)) // ±90，int8 范围内
  }
  const bufR = buildMap({
    n: [6, 7, 5], start: [0, 0, 0], m: [6, 7, 5], axes: [1, 2, 3], mode: 0, values: valsR,
    cell: [12, 14, 10, 90, 90, 90], ispg: 1, arms: 0, dmin: 0, dmax: 0, dmean: 0,
  })
  const rR = parseCcp4(bufR)
  if ('error' in rR) {
    fails.push(`③mode0 解析失败：${rR.error}`)
  } else {
    let badR = 0
    for (let t = 0; t < valsR.length; t++) {
      if (rR.data[t] !== valsR[t]) badR++
    }
    if (badR > 0) fails.push(`③mode0 ${badR} 个体素值不符`)
    if (rR.dims[0] !== 6 || rR.dims[1] !== 7 || rR.dims[2] !== 5) fails.push(`③mode0 dims=[${rR.dims}] 应为 [6,7,5]`)
    info.push(`③mode0 int8：${valsR.length} 体素精确还原`)
  }

  // ── ③c 大端变体：整字交换（word53 → " PAM"）+ 字面 "PAM " 覆写，均须与 ① 一致 ──
  const rBE = parseCcp4(swapWords4(buf1))
  if ('error' in rBE) {
    fails.push(`③大端变体解析失败：${rBE.error}`)
  } else if ('error' in r1) {
    fails.push('③大端对照失败：① 解析已失败')
  } else {
    let beBad = 0
    for (let t = 0; t < r1.data.length; t++) {
      if (rBE.data[t] !== r1.data[t]) beBad++
    }
    if (beBad > 0 || rBE.dims[0] !== N || !close(rBE.fracOrigin[0], 3 / 20, 1e-12) ||
        !close(rBE.rms, r1.rms, 1e-9) || !close(rBE.mean, r1.mean, 1e-9)) {
      fails.push(`③大端变体与 ① 不一致（${beBad} 个体素不符）`)
    }
    // 字面 "PAM "（任务规格措辞）：数值仍按大端，word53 四字节覆写为 P,A,M,' '
    const bufPamLit = swapWords4(buf1)
    const dvP = new DataView(bufPamLit)
    dvP.setUint8(208, 0x50) // 'P'
    dvP.setUint8(209, 0x41) // 'A'
    dvP.setUint8(210, 0x4d) // 'M'
    dvP.setUint8(211, 0x20) // ' '
    const rLit = parseCcp4(bufPamLit)
    if ('error' in rLit) {
      fails.push(`③字面 "PAM " 大端变体解析失败：${rLit.error}`)
    } else {
      let litBad = 0
      for (let t = 0; t < r1.data.length; t++) {
        if (rLit.data[t] !== r1.data[t]) litBad++
      }
      if (litBad > 0) fails.push(`③字面 "PAM " 变体 ${litBad} 个体素与 ① 不一致`)
    }
    info.push(`③大端 " PAM"（整字交换）与字面 "PAM " 变体均与 ① 位级一致`)
  }

  // ── ④ 错误路径：必须返回 { error: 非空中文信息 } ──
  let errTotal = 0
  const expectErr = (buf: ArrayBuffer, label: string): void => {
    errTotal++
    const r = parseCcp4(buf)
    if (!('error' in r)) {
      fails.push(`④${label}：应返回 error，实际解析成功`)
    } else if (typeof r.error !== 'string' || r.error.length === 0) {
      fails.push(`④${label}：error 信息为空`)
    } else if (!/[\u4e00-\u9fff]/.test(r.error)) {
      fails.push(`④${label}：error 信息非中文（${r.error}）`)
    }
  }
  expectErr(buf1.slice(0, 100), '文件过短') // 不足 224 字节
  expectErr(buf1.slice(0, 600), '头区截断') // 数据偏移超出文件长度
  expectErr(buf1.slice(0, buf1.byteLength - 64), '数据截断') // 体素数据不足
  const bufBadTag = buf1.slice(0)
  const dvT = new DataView(bufBadTag)
  dvT.setUint8(208, 0x58) // 'X'
  dvT.setUint8(209, 0x58)
  dvT.setUint8(210, 0x58)
  dvT.setUint8(211, 0x58)
  expectErr(bufBadTag, 'word53 错误')
  const bufBadMode = buf1.slice(0)
  new DataView(bufBadMode).setInt32(12, 6, true) // word4 MODE=6
  expectErr(bufBadMode, 'MODE 不支持')
  const bufBigDim = buf1.slice(0)
  new DataView(bufBigDim).setInt32(0, 5000, true) // word1 NX=5000
  expectErr(bufBigDim, 'NX 超限')
  const bufZeroDim = buf1.slice(0)
  new DataView(bufZeroDim).setInt32(4, 0, true) // word2 NY=0
  expectErr(bufZeroDim, 'NY=0')
  const bufBadAxis = buf1.slice(0)
  new DataView(bufBadAxis).setInt32(64, 2, true) // word17 MAPC=2（与 MAPR=2 重复）
  expectErr(bufBadAxis, '轴序非排列')
  const bufBadCell = buf1.slice(0)
  new DataView(bufBadCell).setFloat32(40, -5, true) // word11 a=-5
  expectErr(bufBadCell, '晶胞长度非法')
  const bufBadGamma = buf1.slice(0)
  new DataView(bufBadGamma).setFloat32(60, 0, true) // word16 γ=0
  expectErr(bufBadGamma, 'γ 退化')
  const bufExtra = new ArrayBuffer(buf1.byteLength + 16)
  new Uint8Array(bufExtra).set(new Uint8Array(buf1))
  expectErr(bufExtra, '多余尾部字节')
  info.push(`④错误路径 ${errTotal}/${errTotal} 返回非空中文 error（截断/word53/MODE/dims/轴序/晶胞/多余字节）`)

  const dt = performance.now() - t0
  info.push(`耗时 ${dt.toFixed(1)}ms`)
  const details = [...info, fails.length > 0 ? `失败项：${fails.join('；')}` : '全部检查通过'].join('；')
  return { ok: fails.length === 0, details }
}
