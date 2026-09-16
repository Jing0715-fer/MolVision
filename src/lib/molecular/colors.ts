// 颜色方案：element(CPK) / chain / spectrum / residue / ss / bfactor / sasa / uniform
import * as THREE from 'three'
import { elementInfo, residueClass, type ResidueClass } from './chemistry'
import type { StructureData } from './parser'
import { maxAtomSasa } from './sasa'

export type ColorScheme = 'element' | 'chain' | 'spectrum' | 'residue' | 'ss' | 'bfactor' | 'sasa' | 'uniform'

export const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  element: '元素 (CPK)',
  chain: '链',
  spectrum: '光谱 (彩虹)',
  residue: '残基类型',
  ss: '二级结构',
  bfactor: 'B 因子',
  sasa: '溶剂可及 (SASA)',
  uniform: '统一颜色',
}

/** 链调色板：黄金角 HSL，稳定可复现 */
export function chainColor(index: number): THREE.Color {
  const hue = (index * 137.508) % 360
  return new THREE.Color().setHSL(hue / 360, 0.62, 0.55)
}

const RESIDUE_COLORS: Record<ResidueClass, string> = {
  nonpolar: '#f2c46d',
  polar: '#8fd694',
  positive: '#4fb3c6',
  negative: '#e05d5d',
  aromatic: '#c39bd3',
  cysteine: '#ffec8b',
  proline: '#c7b3e5',
  glycine: '#c9cdd4',
  nucleic: '#7ac9c0',
  water: '#7a9cc9',
  ligand: '#e8a0bf',
  unknown: '#b8bcc4',
}

export function residueClassColor(resName: string): THREE.Color {
  return new THREE.Color(RESIDUE_COLORS[residueClass(resName)] ?? '#b8bcc4')
}

const NA_BASE_COLORS: Record<string, string> = {
  A: '#9ad97a', G: '#f2c46d', C: '#4fb3c6', T: '#e05d5d', U: '#e05d5d',
}

export function naBaseColor(resName: string): THREE.Color | null {
  const r = resName.toUpperCase()
  const base = r.startsWith('D') ? r.slice(1) : r
  if (NA_BASE_COLORS[base]) return new THREE.Color(NA_BASE_COLORS[base])
  return null
}

const SS_COLORS = { H: '#ff5e5b', E: '#ffd166', L: '#9aa3ad' } as const

/** B 因子渐变：蓝→青→绿→黄→红 */
function bfactorColor(t: number): THREE.Color {
  const c = new THREE.Color()
  // 简单 4 段渐变
  const stops: [number, string][] = [
    [0.0, '#2c7bb6'], [0.25, '#66c2a5'], [0.5, '#f2c46d'], [0.75, '#e05d5d'], [1.0, '#b61515'],
  ]
  t = Math.max(0, Math.min(1, t))
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i]
    const [t1, c1] = stops[i + 1]
    if (t >= t0 && t <= t1) {
      return c.set(c0).lerp(new THREE.Color(c1), (t - t0) / (t1 - t0))
    }
  }
  return c.set(stops[stops.length - 1][1])
}

export interface ColorContext {
  uniformColor?: string
}

/** 计算整个结构的逐原子颜色（rgb Float32Array，线性空间） */
export function computeAtomColors(
  structure: StructureData,
  scheme: ColorScheme,
  opts: ColorContext = {},
): Float32Array {
  const n = structure.atoms.count
  const out = new Float32Array(n * 3)
  const atoms = structure.atoms
  const tmp = new THREE.Color()

  if (scheme === 'uniform') {
    tmp.set(opts.uniformColor ?? '#cccccc')
    for (let i = 0; i < n; i++) {
      out[i * 3] = tmp.r; out[i * 3 + 1] = tmp.g; out[i * 3 + 2] = tmp.b
    }
    return out
  }

  if (scheme === 'element') {
    const cache = new Map<string, THREE.Color>()
    for (let i = 0; i < n; i++) {
      const el = atoms.elements[i]
      let c = cache.get(el)
      if (!c) { c = new THREE.Color(elementInfo(el).color); cache.set(el, c) }
      out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b
    }
    return out
  }

  if (scheme === 'chain') {
    const chainColors: THREE.Color[] = []
    for (let ci = 0; ci < structure.chains.length; ci++) chainColors.push(chainColor(ci))
    for (let i = 0; i < n; i++) {
      const c = chainColors[structure.atomChain[i]] ?? tmp.set('#b8bcc4')
      out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b
    }
    return out
  }

  if (scheme === 'spectrum') {
    // 每条聚合物链内按残基序做彩虹
    const colorCache = new Map<number, THREE.Color>()
    for (const ch of structure.chains) {
      const rs = ch.residueIdx.length
      ch.residueIdx.forEach((ri, k) => {
        const t = rs > 1 ? k / (rs - 1) : 0
        colorCache.set(ri, new THREE.Color().setHSL((0.66 - 0.66 * t), 0.75, 0.55))
      })
    }
    for (let i = 0; i < n; i++) {
      const c = colorCache.get(structure.atomResidue[i]) ?? tmp.set('#b8bcc4')
      out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b
    }
    return out
  }

  if (scheme === 'residue') {
    const cache = new Map<string, THREE.Color>()
    for (let i = 0; i < n; i++) {
      const rn = atoms.resNames[i]
      let c = cache.get(rn)
      if (!c) {
        c = naBaseColor(rn) ?? residueClassColor(rn)
        if (atoms.hetero[i] && !residueClass(rn).match(/water/)) {
          // 配体保持元素感
          c = new THREE.Color(elementInfo(atoms.elements[i]).color)
        }
        cache.set(rn, c)
      }
      out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b
    }
    return out
  }

  if (scheme === 'ss') {
    const colors = { H: new THREE.Color(SS_COLORS.H), E: new THREE.Color(SS_COLORS.E), L: new THREE.Color(SS_COLORS.L) }
    const na = new THREE.Color('#7ac9c0')
    const het = new THREE.Color('#b8bcc4')
    for (let i = 0; i < n; i++) {
      const r = structure.residues[structure.atomResidue[i]]
      const isNA = structure.chains[structure.atomChain[i]]?.type === 'nucleic'
      const c = r.water ? het : isNA ? na : colors[r.ss]
      out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b
    }
    return out
  }

  if (scheme === 'bfactor') {
    let min = Infinity, max = -Infinity
    for (let i = 0; i < n; i++) {
      const b = atoms.bfactors[i]
      if (b < min) min = b
      if (b > max) max = b
    }
    const span = max - min || 1
    for (let i = 0; i < n; i++) {
      const c = bfactorColor((atoms.bfactors[i] - min) / span)
      out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b
    }
    return out
  }

  if (scheme === 'sasa') {
    // 暴露分数 = 原子 SASA / 扩展球面积：埋藏蓝紫 → 暴露橙红（需先运行 SASA 分析，否则灰色）
    const fallback = new THREE.Color('#b8bcc4')
    const sasa = structure.sasa
    for (let i = 0; i < n; i++) {
      const c = sasa ? sasaExposureColor(sasa[i], atoms.elements[i], 1.4) : fallback
      out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b
    }
    return out
  }

  // uniform 兜底（已被上方分支拦截，不会到达）
  tmp.set(opts.uniformColor ?? '#cccccc')
  for (let i = 0; i < n; i++) {
    out[i * 3] = tmp.r; out[i * 3 + 1] = tmp.g; out[i * 3 + 2] = tmp.b
  }
  return out
}

/** SASA 暴露分数渐变：0 埋藏（深蓝）→ 1 完全暴露（橙红），4 段过渡 */
const SASA_STOPS: [number, string][] = [
  [0.0, '#2e4a8f'], [0.3, '#4fa3c7'], [0.6, '#f2d74c'], [1.0, '#e0563d'],
]
const sasaColorCache = new Map<string, THREE.Color>()

export function sasaExposureColor(atomSasa: number, element: string, probe: number): THREE.Color {
  const maxA = maxAtomSasa(element, probe)
  const f = Math.max(0, Math.min(1, atomSasa / maxA))
  const key = element + '|' + f.toFixed(2)
  const hit = sasaColorCache.get(key)
  if (hit) return hit
  const c = new THREE.Color()
  for (let i = 0; i < SASA_STOPS.length - 1; i++) {
    const [t0, c0] = SASA_STOPS[i]
    const [t1, c1] = SASA_STOPS[i + 1]
    if (f >= t0 && f <= t1) {
      c.set(c0).lerp(new THREE.Color(c1), (f - t0) / (t1 - t0))
      break
    }
  }
  if (sasaColorCache.size > 600) sasaColorCache.clear()
  sasaColorCache.set(key, c)
  return c
}

/** CSS 颜色名 → hex（常用集） */
export const NAMED_COLORS: Record<string, string> = {
  white: '#ffffff', black: '#000000', gray: '#808080', grey: '#808080',
  red: '#e04545', green: '#4caf50', blue: '#4a7fd4', yellow: '#f2d74c',
  orange: '#f28a2e', purple: '#a45ad4', cyan: '#48c8c8', magenta: '#d456b0',
  pink: '#f08fb0', brown: '#a5703c', lime: '#a8e05f', teal: '#3aa9a9',
  silver: '#c0c0c0', gold: '#f0c040', violet: '#9a5fd4', salmon: '#fa8072',
  crimson: '#dc143c', indigo: '#5b4bd4', coral: '#ff7f50', slate: '#708090',
}

export function parseCssColor(s: string): string | null {
  const t = s.trim().toLowerCase()
  if (NAMED_COLORS[t]) return NAMED_COLORS[t]
  if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(t)) return t
  return null
}

/** 序列条残基底色（CSS，用于 UI） */
export function residueCssColor(resName: string): string {
  return naBaseColor(resName)?.getStyle() ?? RESIDUE_COLORS[residueClass(resName)] ?? '#b8bcc4'
}

export function ssCssColor(ss: string): string {
  return SS_COLORS[ss as keyof typeof SS_COLORS] ?? SS_COLORS.L
}
