// PyMOL 风格原子选择表达式：chain A and (resi 50-60 or resn HEM) | within 4 of (ligand) | byres(...)
import { AMINO_ACIDS, NUCLEIC_ACIDS, WATERS, elementInfo, BACKBONE_ATOMS } from './chemistry'
import type { StructureData } from './parser'

export interface EvalContext {
  structure: StructureData
  named: Map<string, Uint8Array>
}

export interface EvalResult {
  mask: Uint8Array
  count: number
  error?: string
}

// ---------- 词法 ----------

type Tok = { t: 'word'; v: string } | { t: 'num'; v: number } | { t: 'punct'; v: string }

function tokenize(src: string): Tok[] | { error: string } {
  const toks: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '(' || ch === ')' || ch === '&' || ch === '|' || ch === '!' || ch === '+' || ch === '-' || ch === '<' || ch === '>' || ch === '=') {
      toks.push({ t: 'punct', v: ch })
      i++
      continue
    }
    if (ch === '"' || ch === "'") {
      const end = src.indexOf(ch, i + 1)
      if (end === -1) return { error: '未闭合的引号' }
      toks.push({ t: 'word', v: src.slice(i + 1, end) })
      i = end + 1
      continue
    }
    let j = i
    while (j < n && !/[\s()&|!+\-<>="']/.test(src[j])) j++
    const w = src.slice(i, j)
    if (/^[0-9]*\.?[0-9]+$/.test(w)) toks.push({ t: 'num', v: parseFloat(w) })
    else toks.push({ t: 'word', v: w })
    i = j
  }
  return toks
}

// ---------- 语法解析 + 求值（直接融合，简单清晰） ----------

class Evaluator {
  toks: Tok[]
  pos = 0
  ctx: EvalContext

  constructor(toks: Tok[], ctx: EvalContext) {
    this.toks = toks
    this.ctx = ctx
  }

  peek(): Tok | null { return this.toks[this.pos] ?? null }
  next(): Tok | null { return this.toks[this.pos++] ?? null }
  isWord(...vs: string[]): boolean {
    const t = this.peek()
    return !!t && t.t === 'word' && vs.includes(t.v.toLowerCase())
  }
  expectPunct(v: string): boolean {
    const t = this.next()
    return !!t && t.t === 'punct' && t.v === v
  }

  parse(): Uint8Array | { error: string } {
    const r = this.parseOr()
    if (r && 'error' in r) return r
    if (this.pos < this.toks.length) return { error: `无法解析的多余内容：${JSON.stringify(this.toks[this.pos])}` }
    return r
  }

  parseOr(): Uint8Array | { error: string } {
    let left = this.parseAnd()
    if (left && 'error' in left) return left
    while (this.isWord('or') || (this.peek()?.t === 'punct' && (this.peek() as { v: string }).v === '|')) {
      this.next()
      const right = this.parseAnd()
      if (right && 'error' in right) return right
      for (let i = 0; i < left.length; i++) if (right[i]) left[i] = 1
    }
    return left
  }

  parseAnd(): Uint8Array | { error: string } {
    let left = this.parseUnary()
    if (left && 'error' in left) return left
    while (this.isWord('and') || (this.peek()?.t === 'punct' && (this.peek() as { v: string }).v === '&')) {
      this.next()
      const right = this.parseUnary()
      if (right && 'error' in right) return right
      for (let i = 0; i < left.length; i++) left[i] = left[i] && right[i] ? 1 : 0
    }
    return left
  }

  parseUnary(): Uint8Array | { error: string } {
    if (this.isWord('not') || (this.peek()?.t === 'punct' && (this.peek() as { v: string }).v === '!')) {
      this.next()
      const inner = this.parseUnary()
      if (inner && 'error' in inner) return inner
      for (let i = 0; i < inner.length; i++) inner[i] = inner[i] ? 0 : 1
      return inner
    }
    return this.parsePrimary()
  }

  parsePrimary(): Uint8Array | { error: string } {
    const t = this.peek()
    if (!t) return { error: '表达式意外结束' }
    if (t.t === 'punct' && t.v === '(') {
      this.next()
      const inner = this.parseOr()
      if (inner && 'error' in inner) return inner
      if (!this.expectPunct(')')) return { error: '缺少右括号 )' }
      return inner
    }
    if (t.t !== 'word') return { error: `意外的符号 ${t.v}` }
    const kw = t.v.toLowerCase()

    // 零参数谓词
    const zero = zeroPredicates[kw]
    if (zero) {
      this.next()
      return zero(this.ctx)
    }
    if (kw === 'within' || kw === 'within5' || kw === 'near') {
      this.next()
      const num = this.next()
      if (!num || num.t !== 'num') return { error: 'within 需要距离数值，如 within 5 of (...)' }
      if (!this.isWord('of')) return { error: 'within 语法：within <距离> of (<表达式>)' }
      this.next()
      const inner = this.parsePrimary()
      if (inner && 'error' in inner) return inner
      return withinOf(this.ctx, inner, num.v)
    }
    if (kw === 'byres' || kw === 'byresi') {
      this.next()
      const inner = this.parsePrimary()
      if (inner && 'error' in inner) return inner
      return expandResidues(this.ctx, inner)
    }
    if (kw === 'bychain') {
      this.next()
      const inner = this.parsePrimary()
      if (inner && 'error' in inner) return inner
      return expandChains(this.ctx, inner)
    }
    if (kw === 'bfactor' || kw === 'b') {
      this.next()
      const op = this.next()
      if (!op || op.t !== 'punct' || !['<', '>', '='].includes(op.v)) return { error: 'bfactor 需要比较符 < > =' }
      const val = this.next()
      if (!val || val.t !== 'num') return { error: 'bfactor 需要数值' }
      return bfactorCmp(this.ctx, op.v, val.v)
    }
    // 单参数谓词
    const one = onePredicates[kw]
    if (one) {
      this.next()
      const values = this.parseValueList()
      if (values instanceof Array === false) return values as { error: string }
      if (!values.length) return { error: `${t.v} 需要参数值` }
      return one(this.ctx, values)
    }
    // 命名选择
    const namedMask = this.ctx.named.get(t.v)
    if (namedMask) {
      this.next()
      return namedMask.slice()
    }
    return { error: `无法识别的选择词 "${t.v}"` }
  }

  parseValueList(): string[] | { error: string } {
    const values: string[] = []
    const first = this.next()
    if (!first) return { error: '缺少参数值' }
    // 负数首值：'-5'（'-' 是独立 punct）
    if (first.t === 'punct' && first.v === '-') {
      const v = this.next()
      if (!v) return { error: '缺少参数值' }
      values.push(`-${(v as { v: number | string }).v}`)
    } else {
      values.push(String((first as { v: string | number }).v))
    }
    // 支持 a+b+c 列表与 a-b 范围：'-' 与前一个数值组合成范围串（'60-120'），
    // 非数值前项则视为负数列表项（'-5'）
    for (;;) {
      const p = this.peek()
      if (!p || p.t !== 'punct' || (p.v !== '+' && p.v !== '-')) break
      this.next()
      const v = this.next()
      if (!v) return { error: '列表/范围不完整' }
      const val = String((v as { v: string | number }).v)
      if (p.v === '+') {
        values.push(val)
      } else {
        const last = values[values.length - 1]
        if (/^-?\d+$/.test(last)) {
          // 范围：60-120（允许负端点 -5--1）
          values[values.length - 1] = `${last}-${val}`
        } else {
          values.push(`-${val}`)
        }
      }
    }
    return values
  }
}

// ---------- 谓词实现 ----------

type ZeroPred = (ctx: EvalContext) => Uint8Array
type OnePred = (ctx: EvalContext, values: string[]) => Uint8Array

function newMask(ctx: EvalContext): Uint8Array {
  return new Uint8Array(ctx.structure.atoms.count)
}

const zeroPredicates: Record<string, ZeroPred> = {
  all: (ctx) => newMask(ctx).fill(1),
  none: (ctx) => newMask(ctx),
  protein: (ctx) => predRes(ctx, (r) => AMINO_ACIDS.has(r.resName.toUpperCase())),
  amino: (ctx) => predRes(ctx, (r) => AMINO_ACIDS.has(r.resName.toUpperCase())),
  nucleic: (ctx) => predRes(ctx, (r) => NUCLEIC_ACIDS.has(r.resName.toUpperCase())),
  polymer: (ctx) => predRes(ctx, (r) => r.polymer),
  hetero: (ctx) => predRes(ctx, (r) => r.hetero && !r.water),
  het: (ctx) => predRes(ctx, (r) => r.hetero && !r.water),
  water: (ctx) => predRes(ctx, (r) => r.water),
  ligand: (ctx) => predRes(ctx, (r) => r.hetero && !r.water && !r.polymer),
  metal: (ctx) => predAtom(ctx, (i) => elementInfo(ctx.structure.atoms.elements[i]).metal),
  backbone: (ctx) => predAtom(ctx, (i) => BACKBONE_ATOMS.has(ctx.structure.atoms.names[i]) && ctx.structure.residues[ctx.structure.atomResidue[i]].polymer),
  sidechain: (ctx) => predAtom(ctx, (i) => !BACKBONE_ATOMS.has(ctx.structure.atoms.names[i]) && ctx.structure.residues[ctx.structure.atomResidue[i]].polymer),
  helix: (ctx) => predRes(ctx, (r) => r.ss === 'H'),
  sheet: (ctx) => predRes(ctx, (r) => r.ss === 'E'),
  coil: (ctx) => predRes(ctx, (r) => r.ss === 'L' && r.polymer && AMINO_ACIDS.has(r.resName.toUpperCase())),
  turn: (ctx) => predRes(ctx, (r) => r.ss === 'L'),
}

const onePredicates: Record<string, OnePred> = {
  chain: (ctx, vs) => predAtom(ctx, (i) => vs.map(v => v.toUpperCase()).includes(ctx.structure.atoms.chainIds[i].toUpperCase())),
  // 按链组索引选择：同一链 ID 可能拆成多个不连续链组（蛋白链 A 与其 HETATM 配体/水各自成组）。
  // chainidx 4 = 第 5 个链组（与结构面板「链」列表行号一致），能精确选中「链 A 的配体」而不波及整条链。
  chainidx: (ctx, vs) => {
    const set = new Set<number>()
    for (const v of vs) {
      const n = parseInt(v, 10)
      if (!isNaN(n)) set.add(n)
    }
    return predAtom(ctx, (i) => set.has(ctx.structure.atomChain[i]))
  },
  // 按配体分子索引选择（0 基，与链面板配体行/序列条配体 chip 编号一致）：
  // molecule 2 = 第 3 个配体分子——多残基配体（多糖/肽类）整体选中，不波及同链其它分子
  molecule: (ctx, vs) => {
    const set = new Set<number>()
    for (const v of vs) {
      const n = parseInt(v, 10)
      if (!isNaN(n)) set.add(n)
    }
    return predAtom(ctx, (i) => {
      const m = ctx.structure.atomMolecule[i]
      return m >= 0 && set.has(m)
    })
  },
  mol: (ctx, vs) => onePredicates.molecule(ctx, vs),
  resn: (ctx, vs) => {
    const set = new Set(vs.map(v => v.toUpperCase()))
    return predAtom(ctx, (i) => set.has(ctx.structure.atoms.resNames[i].toUpperCase()))
  },
  name: (ctx, vs) => {
    const set = new Set(vs.map(v => v.toUpperCase()))
    return predAtom(ctx, (i) => set.has(ctx.structure.atoms.names[i].toUpperCase()))
  },
  elem: (ctx, vs) => {
    const set = new Set(vs.map(v => v.toUpperCase()))
    return predAtom(ctx, (i) => set.has(ctx.structure.atoms.elements[i].toUpperCase()))
  },
  element: (ctx, vs) => onePredicates.elem(ctx, vs),
  resi: (ctx, vs) => {
    // 解析范围列表：45, 45-60, -5
    const ranges: [number, number][] = []
    for (const v of vs) {
      const m = v.match(/^(-?\d+)-(-?\d+)$/)
      if (m) { ranges.push([parseInt(m[1], 10), parseInt(m[2], 10)]); continue }
      const num = parseInt(v, 10)
      if (!isNaN(num)) ranges.push([num, num])
    }
    return predAtom(ctx, (i) => {
      const s = ctx.structure.atoms.resSeqs[i]
      return ranges.some(([a, b]) => s >= a && s <= b)
    })
  },
}

function predRes(ctx: EvalContext, fn: (r: StructureData['residues'][number]) => boolean): Uint8Array {
  const m = newMask(ctx)
  const st = ctx.structure
  for (let ri = 0; ri < st.residues.length; ri++) {
    const r = st.residues[ri]
    if (fn(r)) for (let i = r.start; i < r.end; i++) m[i] = 1
  }
  return m
}

function predAtom(ctx: EvalContext, fn: (i: number) => boolean): Uint8Array {
  const m = newMask(ctx)
  for (let i = 0; i < m.length; i++) if (fn(i)) m[i] = 1
  return m
}

function withinOf(ctx: EvalContext, inner: Uint8Array, radius: number): Uint8Array {
  const st = ctx.structure
  const m = newMask(ctx)
  const seeds: number[] = []
  for (let i = 0; i < inner.length; i++) if (inner[i]) seeds.push(i)
  const r2 = radius * radius
  const pos = st.atoms.positions
  for (let s = 0; s < seeds.length; s++) {
    const si = seeds[s]
    const sx = pos[si * 3], sy = pos[si * 3 + 1], sz = pos[si * 3 + 2]
    const cand = st.grid.queryRadius(sx, sy, sz, radius, pos)
    for (const j of cand) {
      const dx = pos[j * 3] - sx, dy = pos[j * 3 + 1] - sy, dz = pos[j * 3 + 2] - sz
      if (dx * dx + dy * dy + dz * dz <= r2) m[j] = 1
    }
  }
  return m
}

function expandResidues(ctx: EvalContext, inner: Uint8Array): Uint8Array {
  const st = ctx.structure
  const m = new Uint8Array(inner.length)
  for (let i = 0; i < inner.length; i++) {
    if (inner[i]) {
      const r = st.residues[st.atomResidue[i]]
      for (let k = r.start; k < r.end; k++) m[k] = 1
    }
  }
  return m
}

function expandChains(ctx: EvalContext, inner: Uint8Array): Uint8Array {
  const st = ctx.structure
  const m = new Uint8Array(inner.length)
  const chainSet = new Set<number>()
  for (let i = 0; i < inner.length; i++) if (inner[i]) chainSet.add(st.atomChain[i])
  for (let i = 0; i < inner.length; i++) if (chainSet.has(st.atomChain[i])) m[i] = 1
  return m
}

function bfactorCmp(ctx: EvalContext, op: string, val: number): Uint8Array {
  const m = newMask(ctx)
  const b = ctx.structure.atoms.bfactors
  for (let i = 0; i < m.length; i++) {
    const ok = op === '<' ? b[i] < val : op === '>' ? b[i] > val : Math.abs(b[i] - val) < 0.01
    if (ok) m[i] = 1
  }
  return m
}

// ---------- 预设选择 ----------

export const PRESET_SELECTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'all — 全部原子' },
  { value: 'polymer', label: 'polymer — 聚合物(蛋白+核酸)' },
  { value: 'protein', label: 'protein — 氨基酸' },
  { value: 'nucleic', label: 'nucleic — 核酸' },
  { value: 'ligand', label: 'ligand — 配体' },
  { value: 'molecule 0', label: 'molecule N — 第 N 个配体分子（0 基）' },
  { value: 'hetero', label: 'hetero — 非聚合物' },
  { value: 'water', label: 'water — 水' },
  { value: 'metal', label: 'metal — 金属离子' },
  { value: 'backbone', label: 'backbone — 主链' },
  { value: 'sidechain', label: 'sidechain — 侧链' },
  { value: 'helix', label: 'helix — 螺旋' },
  { value: 'sheet', label: 'sheet — β折叠' },
]

// ---------- 求值入口 ----------

export function evaluateSelection(expr: string, ctx: EvalContext): EvalResult {
  const trimmed = expr.trim()
  if (!trimmed || trimmed.toLowerCase() === 'all' || trimmed === '*') {
    const m = new Uint8Array(ctx.structure.atoms.count).fill(1)
    return { mask: m, count: m.length }
  }
  const toks = tokenize(trimmed)
  if (toks && 'error' in toks) return { mask: new Uint8Array(ctx.structure.atoms.count), count: 0, error: toks.error }
  const ev = new Evaluator(toks as Tok[], ctx)
  const r = ev.parse()
  if (r && 'error' in r) return { mask: new Uint8Array(ctx.structure.atoms.count), count: 0, error: r.error }
  let c = 0
  for (let i = 0; i < r.length; i++) if (r[i]) c++
  return { mask: r, count: c }
}

export function maskToIndices(mask: Uint8Array): number[] {
  const out: number[] = []
  for (let i = 0; i < mask.length; i++) if (mask[i]) out.push(i)
  return out
}
