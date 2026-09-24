// SVG 矢量导出：CPU 侧投影分子为出版级矢量图（对标 UCSF Chimera "Copy as SVG"）
// 原理：取引擎当前相机（透视/正交通用）的组合投影矩阵，把 rep 内原子/键投影到 NDC，
// 按视深做画家算法排序后输出 SVG 基元（圆 = 原子、双色圆头线段 = 键、平滑折线 = cartoon 骨架）。
// 颜色与 3D 视图一致：computeAtomColors（线性）→ sRGB hex，叠加 colorOverrides。
// surface 表示法为等值面几何（无原子级对应原语），导出时跳过并在返回值中列出。
import * as THREE from 'three'
import { tt } from '@/i18n'
import { computeAtomColors } from './colors'
import { elementInfo } from './chemistry'
import { evaluateSelection } from './selection'
import { buildNamedMasks, dataRegistry, engineRef, useMolStore } from './store'
import type { RepConfig, StructureEntry } from './types'
import type { StructureData } from './parser'

export interface SvgExportResult {
  ok: boolean
  error?: string
  svg?: string
  width: number
  height: number
  /** 输出的 SVG 基元数量（圆 + 线段） */
  items: number
  /** 跳过的 surface 表示法（结构名/选择集） */
  skippedSurfaces: string[]
  ms: number
}

interface Prim {
  /** 视空间深度（越大越远；画家算法降序绘制） */
  z: number
  svg: string
}

/** 线性 → sRGB（colors 数组为线性工作空间，SVG 需 sRGB 十六进制） */
function linearToHex(r: number, g: number, b: number): string {
  const f = (v: number) => {
    const x = Math.min(1, Math.max(0, v))
    const s = x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
    return Math.round(s * 255).toString(16).padStart(2, '0')
  }
  return '#' + f(r) + f(g) + f(b)
}

const fmt = (v: number) => Math.round(v * 10) / 10

export function buildSvgExport(opts: { width?: number } = {}): SvgExportResult {
  const t0 = performance.now()
  const s = useMolStore.getState()
  const eng = engineRef.current
  if (!eng) return { ok: false, error: tt({ zh: '引擎未就绪', en: 'Engine not ready' }), width: 0, height: 0, items: 0, skippedSurfaces: [], ms: 0 }
  if (!s.structures.length) return { ok: false, error: tt({ zh: '场景为空——先加载结构（load <PDB编号>）', en: 'Scene is empty — load a structure first (load <PDB ID>)' }), width: 0, height: 0, items: 0, skippedSurfaces: [], ms: 0 }

  const width = Math.max(320, Math.min(4096, Math.round(opts.width ?? 1600)))
  // 保持视口纵横比
  const cw = eng.canvas.clientWidth || 1280
  const ch = eng.canvas.clientHeight || 720
  const height = Math.max(240, Math.round((width * ch) / cw))

  const cam = eng.activeCamera
  cam.updateMatrixWorld(true)
  const viewInv = cam.matrixWorldInverse
  const proj = cam.projectionMatrix
  const full = new THREE.Matrix4().multiplyMatrices(proj, viewInv)
  const v3 = new THREE.Vector3()

  /** 世界坐标 → NDC（applyMatrix4 自带透视除法）；调用方需先保证视深 > 0 */
  const toNdc = (x: number, y: number, z: number, out: THREE.Vector3): boolean => {
    out.set(x, y, z).applyMatrix4(full)
    return out.z > -1.02 && out.z < 1.02
  }
  /** 世界坐标 → 视深（沿相机前向的距离，恒为正在相机前） */
  const viewZ = (x: number, y: number, z: number): number => {
    v3.set(x, y, z).applyMatrix4(viewInv)
    return -v3.z
  }
  /** 世界半径 → 像素半径（沿相机右向偏移一点再投影；透视/正交通用） */
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
  const pa = new THREE.Vector3()
  const pb = new THREE.Vector3()
  const worldRadiusPx = (x: number, y: number, z: number, r: number, vz: number): number => {
    if (vz <= 0.01) return 0.01
    pa.set(x, y, z).applyMatrix4(full)
    pb.set(x + right.x * r, y + right.y * r, z + right.z * r).applyMatrix4(full)
    // NDC 位移 → 像素位移（半径只取幅值，y 轴方向翻转不影响 hypot）
    const dx = (pb.x - pa.x) * 0.5 * width
    const dy = (pb.y - pa.y) * 0.5 * height
    return Math.hypot(dx, dy)
  }

  const prims: Prim[] = []
  const skippedSurfaces: string[] = []
  const ndc = new THREE.Vector3()
  const px = (v: number) => (v * 0.5 + 0.5) * width
  const py = (v: number) => (1 - v) * 0.5 * height

  for (const entry of s.structures) {
    if (!entry.visible) continue
    const data = dataRegistry.get(entry.id)
    if (!data) continue
    const named = buildNamedMasks(entry.id, data)
    const atoms = data.atoms

    for (const rep of entry.reps) {
      if (!rep.visible) continue
      if (rep.type === 'surface') {
        skippedSurfaces.push(`${entry.name}:${rep.selection}`)
        continue
      }
      const res = evaluateSelection(rep.selection, { structure: data, named })
      if (res.error) continue
      const mask = res.mask
      // 与引擎 buildRep 相同的氢/水过滤
      if (s.settings.hideHydrogens || s.settings.hideWater) {
        for (let i = 0; i < mask.length; i++) {
          if (!mask[i]) continue
          if (s.settings.hideHydrogens && (atoms.elements[i] === 'H' || atoms.elements[i] === 'D')) { mask[i] = 0; continue }
          if (s.settings.hideWater && data.residues[data.atomResidue[i]]?.water) mask[i] = 0
        }
      }
      // 颜色（含覆盖）
      const colors = computeAtomColors(data, rep.colorScheme, { uniformColor: rep.uniformColor })
      const overrides = Object.keys(entry.colorOverrides)
      if (overrides.length) {
        const c = new THREE.Color()
        for (const k of overrides) {
          const i = Number(k)
          if (i >= atoms.count) continue
          c.set(entry.colorOverrides[i])
          colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
        }
      }
      const hexOf = (i: number) => linearToHex(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2])

      if (rep.type === 'cartoon' || rep.type === 'putty') {
        drawTrace(data, entry, rep, mask, colors, prims, { toNdc, viewZ, px, py })
        continue
      }

      // 原子类表示：圆
      const atomRadius = rep.type === 'spacefill'
        ? (r: number, el: string) => elementInfo(el).vdw * r
        : rep.type === 'ballstick'
          ? () => 0.22 * rep.ballScale
          : rep.type === 'sticks'
            ? () => rep.stickRadius
            : () => 0 // lines：无原子圆
      if (rep.type !== 'lines') {
        const rf = atomRadius as (r: number, el: string) => number
        for (let i = 0; i < mask.length; i++) {
          if (!mask[i]) continue
          const vz = viewZ(atoms.positions[i * 3], atoms.positions[i * 3 + 1], atoms.positions[i * 3 + 2])
          if (vz <= 0.1) continue
          if (!toNdc(atoms.positions[i * 3], atoms.positions[i * 3 + 1], atoms.positions[i * 3 + 2], ndc)) continue
          if (ndc.x < -1.15 || ndc.x > 1.15 || ndc.y < -1.15 || ndc.y > 1.15) continue
          const cx = fmt(px(ndc.x)), cy = fmt(py(ndc.y))
          const r = worldRadiusPx(atoms.positions[i * 3], atoms.positions[i * 3 + 1], atoms.positions[i * 3 + 2], rf(rep.ballScale, atoms.elements[i]), vz)
          prims.push({
            z: vz,
            svg: `<circle cx="${cx}" cy="${cy}" r="${fmt(Math.max(0.6, r))}" fill="${hexOf(i)}"/>`,
          })
        }
      }

      // 键：双色圆头线段（原子色 → 中点 / 中点 → 原子色）
      if (rep.type === 'ballstick' || rep.type === 'sticks' || rep.type === 'lines') {
        for (let b = 0; b < data.bonds.count; b++) {
          const a1 = data.bonds.a[b], a2 = data.bonds.b[b]
          if (!mask[a1] || !mask[a2]) continue
          const x1 = atoms.positions[a1 * 3], y1 = atoms.positions[a1 * 3 + 1], z1 = atoms.positions[a1 * 3 + 2]
          const x2 = atoms.positions[a2 * 3], y2 = atoms.positions[a2 * 3 + 1], z2 = atoms.positions[a2 * 3 + 2]
          const vz1 = viewZ(x1, y1, z1), vz2 = viewZ(x2, y2, z2)
          const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, mz = (z1 + z2) / 2
          const vz = (vz1 + vz2) / 2
          if (vz1 <= 0.1 || vz2 <= 0.1 || vz <= 0.1) continue
          if (!toNdc(x1, y1, z1, pa) || !toNdc(x2, y2, z2, pb)) continue
          if (!toNdc(mx, my, mz, ndc)) continue
          // 视口外整体剔除（留 12% 余量容纳半径）
          if (Math.max(pa.x, pb.x) < -1.12 || Math.min(pa.x, pb.x) > 1.12 || Math.max(pa.y, pb.y) < -1.12 || Math.min(pa.y, pb.y) > 1.12) continue
          // 先取屏幕坐标（worldRadiusPx 会覆写临时向量）
          const x1p = fmt(px(pa.x)), y1p = fmt(py(pa.y))
          const xmp = fmt(px(ndc.x)), ymp = fmt(py(ndc.y))
          const x2p = fmt(px(pb.x)), y2p = fmt(py(pb.y))
          const wpx = rep.type === 'lines' ? 1 : Math.max(0.7, worldRadiusPx(mx, my, mz, 2 * rep.stickRadius, vz) * 2)
          const c1 = hexOf(a1), c2 = hexOf(a2)
          prims.push({
            z: vz,
            svg: `<path d="M${x1p} ${y1p}L${xmp} ${ymp}" stroke="${c1}" stroke-width="${fmt(wpx)}" fill="none" stroke-linecap="round"/><path d="M${xmp} ${ymp}L${x2p} ${y2p}" stroke="${c2}" stroke-width="${fmt(wpx)}" fill="none" stroke-linecap="round"/>`,
          })
        }
      }
    }
  }

  if (!prims.length) {
    return { ok: false, error: tt({ zh: '没有可导出的内容（表面表示法不支持矢量导出，试试 cartoon/球棍/线框）', en: 'Nothing to export (surface representations do not support vector export — try cartoon / ball-and-stick / wireframe)' }), width, height, items: 0, skippedSurfaces, ms: performance.now() - t0 }
  }

  prims.sort((a, b) => b.z - a.z)

  // 页脚：结构名 + 原子数 + 署名（出版友好）
  const names = s.structures.filter(x => x.visible).map(x => tt({ zh: `${x.name}（${x.summary.atoms.toLocaleString()} 原子）`, en: `${x.name} (${x.summary.atoms.toLocaleString()} atoms)` })).join(' · ')
  const now = new Date()
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const bg = s.settings.background || '#ffffff'
  // 页脚文字色：按背景亮度自适应
  const bgLum = (() => {
    const c = new THREE.Color(bg)
    return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  })()
  const footerColor = bgLum > 0.45 ? '#8a8f98' : '#b8bcc4'
  const footerY = height - 14

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<title>${escapeXml(names)}</title>`,
    `<desc>${tt({ zh: 'MolVision 矢量导出', en: 'MolVision vector export' })} · ${escapeXml(names)} · ${dateStr}</desc>`,
    `<rect width="${width}" height="${height}" fill="${bg}"/>`,
    `<g stroke-linejoin="round">`,
    ...prims.map(p => p.svg),
    `</g>`,
    `<text x="${width - 12}" y="${footerY}" text-anchor="end" font-family="ui-sans-serif,system-ui,sans-serif" font-size="11" fill="${footerColor}">${escapeXml(names)} · MolVision · ${dateStr}</text>`,
    `</svg>`,
  ].join('\n')

  return { ok: true, svg, width, height, items: prims.length, skippedSurfaces, ms: performance.now() - t0 }
}

/** cartoon/putty：CA/P 骨架平滑折线（Catmull-Rom 细分），逐段着色 + 圆头描边 */
function drawTrace(
  data: StructureData, entry: StructureEntry, rep: RepConfig, mask: Uint8Array, colors: Float32Array,
  prims: Prim[],
  helpers: {
    toNdc: (x: number, y: number, z: number, out: THREE.Vector3) => boolean
    viewZ: (x: number, y: number, z: number) => number
    px: (v: number) => number; py: (v: number) => number
  },
) {
  const { toNdc, viewZ, px, py } = helpers
  const atoms = data.atoms
  const pa = new THREE.Vector3()
  const hexOf = (i: number) => linearToHex(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2])

  // 逐链收集代表原子（蛋白 CA / 核酸 P / 其他首原子）
  type Node = { i: number; ri: number }
  const chainNodes = new Map<string, Node[]>()
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue
    const name = atoms.names[i]
    if (name !== 'CA' && name !== 'P') continue
    const ri = data.atomResidue[i]
    const res = data.residues[ri]
    if (!res.polymer) continue
    const key = atoms.chainIds[i]
    let arr = chainNodes.get(key)
    if (!arr) { arr = []; chainNodes.set(key, arr) }
    arr.push({ i, ri })
  }

  // putty：B 因子分位宽度映射
  let bmin = Infinity, bmax = -Infinity
  if (rep.type === 'putty') {
    for (const arr of chainNodes.values()) for (const n of arr) {
      const b = atoms.bfactors[n.i]
      if (b < bmin) bmin = b
      if (b > bmax) bmax = b
    }
    if (!isFinite(bmin)) { bmin = 0; bmax = 1 }
  }
  const bspan = bmax - bmin || 1
  const puttyW = (b: number) => 2 + 7 * Math.min(1, Math.max(0, (b - bmin) / bspan))
  const baseW = 3.2 * rep.cartoonWidth * (rep.type === 'putty' ? 1 : 1.6)

  for (const arr of chainNodes.values()) {
    if (arr.length < 2) continue
    // Catmull-Rom 细分：相邻代表原子间插 3 个点
    const pts: { x: number; y: number; z: number; c: string; w: number; vz: number }[] = []
    for (let k = 0; k < arr.length - 1; k++) {
      const p0 = arr[Math.max(0, k - 1)].i, p1 = arr[k].i, p2 = arr[k + 1].i, p3 = arr[Math.min(arr.length - 1, k + 2)].i
      const P = (idx: number, j: number) => atoms.positions[idx * 3 + j]
      const c1 = hexOf(p1), c2 = hexOf(p2)
      const w1 = rep.type === 'putty' ? puttyW(atoms.bfactors[p1]) : baseW
      const w2 = rep.type === 'putty' ? puttyW(atoms.bfactors[p2]) : baseW
      const seg = 4 // 每段 4 子段
      for (let t = 0; t < seg; t++) {
        const tt = t / seg
        // Catmull-Rom 基矩阵
        const tt2 = tt * tt, tt3 = tt2 * tt
        const f0 = -0.5 * tt3 + tt2 - 0.5 * tt
        const f1 = 1.5 * tt3 - 2.5 * tt2 + 1
        const f2 = -1.5 * tt3 + 2 * tt2 + 0.5 * tt
        const f3 = 0.5 * tt3 - 0.5 * tt2
        const x = f0 * P(p0, 0) + f1 * P(p1, 0) + f2 * P(p2, 0) + f3 * P(p3, 0)
        const y = f0 * P(p0, 1) + f1 * P(p1, 1) + f2 * P(p2, 1) + f3 * P(p3, 1)
        const z = f0 * P(p0, 2) + f1 * P(p1, 2) + f2 * P(p2, 2) + f3 * P(p3, 2)
        pts.push({ x, y, z, c: tt < 0.5 ? c1 : c2, w: tt < 0.5 ? w1 : w2, vz: viewZ(x, y, z) })
      }
    }
    // 末端补最后一点
    const last = arr[arr.length - 1].i
    pts.push({
      x: atoms.positions[last * 3], y: atoms.positions[last * 3 + 1], z: atoms.positions[last * 3 + 2],
      c: hexOf(last), w: rep.type === 'putty' ? puttyW(atoms.bfactors[last]) : baseW, vz: viewZ(atoms.positions[last * 3], atoms.positions[last * 3 + 1], atoms.positions[last * 3 + 2]),
    })
    // 投影并逐子段输出
    const proj: { x: number; y: number; c: string; w: number; vz: number }[] = []
    for (const p of pts) {
      if (p.vz <= 0.1) { proj.push({ x: NaN, y: NaN, c: p.c, w: p.w, vz: p.vz }); continue }
      if (!toNdc(p.x, p.y, p.z, pa)) { proj.push({ x: NaN, y: NaN, c: p.c, w: p.w, vz: p.vz }); continue }
      proj.push({ x: px(pa.x), y: py(pa.y), c: p.c, w: p.w, vz: p.vz })
    }
    for (let k = 0; k < proj.length - 1; k++) {
      const a = proj[k], b = proj[k + 1]
      if (isNaN(a.x) || isNaN(b.x)) continue
      prims.push({
        z: (a.vz + b.vz) / 2,
        svg: `<path d="M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}" stroke="${a.c}" stroke-width="${fmt(Math.max(1, (a.w + b.w) / 2))}" fill="none" stroke-linecap="round"/>`,
      })
    }
  }
  void entry
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch))
}

/** 触发下载 .svg 文件 */
export function downloadSvg(svg: string, name: string): void {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name}.svg`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
