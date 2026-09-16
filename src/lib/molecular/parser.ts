// PDB / mmCIF 解析器 → StructureData（原子、残基、链、键、二级结构）
import {
  AMINO_ACIDS, NUCLEIC_ACIDS, WATERS, SUGAR_LIKE, elementFromAtomName, elementInfo,
} from './chemistry'

export type SSType = 'H' | 'E' | 'L' // helix / sheet / loop

export interface AtomData {
  count: number
  positions: Float32Array      // xyz * count
  serial: Int32Array
  names: string[]
  elements: string[]
  resNames: string[]
  resSeqs: Int32Array
  iCodes: string[]
  chainIds: string[]
  bfactors: Float32Array
  occupancies: Float32Array
  hetero: Uint8Array
}

export interface Residue {
  chainId: string
  resSeq: number
  iCode: string
  resName: string
  start: number // 起始原子索引（含）
  end: number   // 结束原子索引（不含）
  ss: SSType
  polymer: boolean
  water: boolean
  hetero: boolean
}

export type ChainType = 'protein' | 'nucleic' | 'water' | 'ligand'

export interface Chain {
  id: string
  type: ChainType
  start: number
  end: number
  residueIdx: number[] // 残基索引列表
}

export interface StructureData {
  id: string
  name: string
  format: 'pdb' | 'cif'
  atoms: AtomData
  residues: Residue[]
  chains: Chain[]
  bonds: { a: Int32Array; b: Int32Array; count: number }
  atomResidue: Int32Array // 原子 → 残基索引
  atomChain: Int32Array   // 原子 → 链索引
  meta: { title: string; method: string; resolution: number | null; pdbId: string | null }
  ssFromRecords: boolean
  hasHydrogens: boolean
  /** 空间哈希网格（用于 within 选择、近邻查询） */
  grid: SpatialGrid
  bbox: { min: [number, number, number]; max: [number, number, number]; center: [number, number, number]; radius: number }
}

// ---------- 空间哈希网格 ----------

export class SpatialGrid {
  cell: number
  private map = new Map<number, number[]>()
  private minIx = 0; private minIy = 0; private minIz = 0
  private maxIx = 0; private maxIy = 0; private maxIz = 0

  constructor(positions: Float32Array, count: number, cell = 6) {
    this.cell = cell
    if (count > 0) {
      this.minIx = this.maxIx = this.ix(positions[0])
      this.minIy = this.maxIy = this.ix(positions[1])
      this.minIz = this.maxIz = this.ix(positions[2])
    }
    for (let i = 0; i < count; i++) {
      const ix = this.ix(positions[i * 3]), iy = this.ix(positions[i * 3 + 1]), iz = this.ix(positions[i * 3 + 2])
      if (ix < this.minIx) this.minIx = ix; if (ix > this.maxIx) this.maxIx = ix
      if (iy < this.minIy) this.minIy = iy; if (iy > this.maxIy) this.maxIy = iy
      if (iz < this.minIz) this.minIz = iz; if (iz > this.maxIz) this.maxIz = iz
      const key = this.key(ix, iy, iz)
      let arr = this.map.get(key)
      if (!arr) { arr = []; this.map.set(key, arr) }
      arr.push(i)
    }
  }

  private ix(v: number) { return Math.floor(v / this.cell) + 2048 }
  private key(ix: number, iy: number, iz: number) { return (ix << 20) | (iy << 10) | iz }

  /** 返回半径 r 内的原子索引（不保证排序） */
  query(x: number, y: number, z: number, r: number): number[] {
    const out: number[] = []
    const r2 = r * r
    const cx = this.ix(x), cy = this.ix(y), cz = this.ix(z)
    const span = Math.ceil(r / this.cell)
    for (let ix = cx - span; ix <= cx + span; ix++) {
      if (ix < this.minIx - 1 || ix > this.maxIx + 1) continue
      for (let iy = cy - span; iy <= cy + span; iy++) {
        if (iy < this.minIy - 1 || iy > this.maxIy + 1) continue
        for (let iz = cz - span; iz <= cz + span; iz++) {
          if (iz < this.minIz - 1 || iz > this.maxIz + 1) continue
          const arr = this.map.get(this.key(ix, iy, iz))
          if (!arr) continue
          out.push(...arr)
        }
      }
    }
    return out
  }

  /** query + 距离过滤（需要 positions） */
  queryRadius(x: number, y: number, z: number, r: number, positions: Float32Array): number[] {
    const cand = this.query(x, y, z, r)
    const out: number[] = []
    const r2 = r * r
    for (const i of cand) {
      const dx = positions[i * 3] - x, dy = positions[i * 3 + 1] - y, dz = positions[i * 3 + 2] - z
      if (dx * dx + dy * dy + dz * dz <= r2) out.push(i)
    }
    return out
  }
}

// ---------- 解析入口 ----------

export function detectFormat(text: string, filename = ''): 'pdb' | 'cif' {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.cif') || lower.endsWith('.mmcif')) return 'cif'
  if (lower.endsWith('.pdb') || lower.endsWith('.ent')) return 'pdb'
  if (/^\s*(data_|#\w+_\w+.*\n.*_atom_site|loop_)/m.test(text) && !/^ATOM/m.test(text)) return 'cif'
  if (/^\s*data_/m.test(text)) return 'cif'
  return 'pdb'
}

export function parseStructure(text: string, name: string, format: 'pdb' | 'cif', id = ''): StructureData {
  return format === 'cif' ? parseCIF(text, name, id) : parsePDB(text, name, id)
}

// ---------- PDB 解析 ----------

function parsePDB(text: string, name: string, id = ''): StructureData {
  const lines = text.split(/\r?\n/)
  const x: number[] = [], y: number[] = [], z: number[] = []
  const serial: number[] = [], names: string[] = [], elements: string[] = [], resNames: string[] = []
  const resSeqs: number[] = [], iCodes: string[] = [], chainIds: string[] = []
  const bfactors: number[] = [], occupancies: number[] = [], heteroFlags: number[] = []
  const conects: number[][] = []
  const helixRanges: { chain: string; start: number; end: number; ic1: string; ic2: string }[] = []
  const sheetRanges: { chain: string; start: number; end: number; ic1: string; ic2: string }[] = []
  let title = ''
  let method = ''
  let resolution: number | null = null
  let pdbId: string | null = id || null
  let inFirstModel = true
  let seenModel = false

  for (const line of lines) {
    const rec = line.slice(0, 6)
    if (rec === 'ATOM  ' || rec === 'HETATM') {
      if (!inFirstModel) continue
      const het = rec === 'HETATM' ? 1 : 0
      const altLoc = line[16]
      if (altLoc !== ' ' && altLoc !== 'A' && altLoc !== '0') continue
      const atomName = line.slice(12, 16)
      const resName = line.slice(17, 20).trim()
      const chainId = line[21] || ' '
      const resSeq = parseInt(line.slice(22, 26), 10) || 0
      const iCode = line[26] || ' '
      let el = line.slice(76, 78).trim().toUpperCase()
      if (!el) el = elementFromAtomName(atomName, het === 1)
      x.push(parseFloat(line.slice(30, 38)) || 0)
      y.push(parseFloat(line.slice(38, 46)) || 0)
      z.push(parseFloat(line.slice(46, 54)) || 0)
      serial.push(parseInt(line.slice(6, 11), 10) || 0)
      names.push(atomName.trim())
      elements.push(el)
      resNames.push(resName)
      resSeqs.push(resSeq)
      iCodes.push(iCode.trim())
      chainIds.push(chainId)
      occupancies.push(parseFloat(line.slice(54, 60)) || 1)
      bfactors.push(parseFloat(line.slice(60, 66)) || 0)
      heteroFlags.push(het)
    } else if (rec === 'MODEL ') {
      if (seenModel) inFirstModel = false
      seenModel = true
    } else if (rec === 'ENDMDL') {
      if (seenModel) inFirstModel = false
    } else if (rec === 'TITLE ') {
      title += (title ? ' ' : '') + line.slice(10, 80).trim()
    } else if (rec === 'HEADER') {
      const cid = line.slice(62, 66).trim()
      if (cid && !pdbId) pdbId = cid
    } else if (rec === 'EXPDTA') {
      method += (method ? ' ' : '') + line.slice(10, 80).trim()
    } else if (rec === 'REMARK' && line.slice(6, 10) === '   2') {
      const m = line.match(/RESOLUTION\.\s+([0-9.]+)/)
      if (m) {
        const v = parseFloat(m[1])
        if (!isNaN(v)) resolution = v
      }
    } else if (rec === 'HELIX ') {
      helixRanges.push({
        chain: line[20] || ' ',
        start: parseInt(line.slice(21, 25), 10) || 0,
        end: parseInt(line.slice(33, 37), 10) || 0,
        ic1: (line[25] || ' ').trim(),
        ic2: (line[37] || ' ').trim(),
      })
    } else if (rec === 'SHEET ') {
      sheetRanges.push({
        chain: line[19] || ' ',
        start: parseInt(line.slice(20, 24), 10) || 0,
        end: parseInt(line.slice(31, 35), 10) || 0,
        ic1: (line[24] || ' ').trim(),
        ic2: (line[35] || ' ').trim(),
      })
    } else if (rec === 'CONECT') {
      const from = parseInt(line.slice(6, 11), 10)
      if (!from) continue
      for (let c = 11; c + 5 <= 80; c += 5) {
        const to = parseInt(line.slice(c, c + 5), 10)
        if (to) conects.push([from, to])
      }
    }
  }

  return buildStructure({
    name, format: 'pdb', pdbId, title: title || name, method, resolution,
    x, y, z, serial, names, elements, resNames, resSeqs, iCodes, chainIds,
    bfactors, occupancies, heteroFlags, conects, helixRanges, sheetRanges,
  })
}

// ---------- mmCIF 解析 ----------

function cifTokenizeLine(line: string): string[] | null {
  // 返回 token 列表；若行以 ';' 开头返回 null（多行文本）
  if (line.startsWith(';')) return null
  const tokens: string[] = []
  let i = 0
  const n = line.length
  while (i < n) {
    while (i < n && /\s/.test(line[i])) i++
    if (i >= n) break
    const ch = line[i]
    if (ch === "'" || ch === '"') {
      const end = line.indexOf(ch, i + 1)
      if (end === -1) { tokens.push(line.slice(i + 1)); break }
      tokens.push(line.slice(i + 1, end))
      i = end + 1
    } else {
      let j = i
      while (j < n && !/\s/.test(line[j])) j++
      tokens.push(line.slice(i, j))
      i = j
    }
  }
  return tokens
}

function parseCIF(text: string, name: string, id = ''): StructureData {
  const lines = text.split(/\r?\n/)
  const simple = new Map<string, string>()
  let title = '', method = '', resolution: number | null = null

  // 先扫非 loop 的简单键值
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    if (!line.startsWith('_')) continue
    if (line.startsWith('_atom_site')) continue
    const toks = cifTokenizeLine(line)
    if (!toks || toks.length < 2) continue
    const key = toks[0]
    let val = toks.slice(1).join(' ')
    if (val === '.' || val === '?') val = ''
    if (!simple.has(key)) simple.set(key, val)
  }
  title = simple.get('_struct.title') || ''
  method = simple.get('_exptl.method') || ''
  const resHigh = parseFloat(simple.get('_refine.ls_d_res_high') || '')
  if (!isNaN(resHigh) && resHigh > 0) resolution = resHigh
  if (resolution === null) {
    const em = parseFloat(simple.get('_em_3d_reconstruction.resolution') || '')
    if (!isNaN(em) && em > 0) resolution = em
  }

  // 找 _atom_site loop
  const x: number[] = [], y: number[] = [], z: number[] = []
  const serial: number[] = [], names: string[] = [], elements: string[] = [], resNames: string[] = []
  const resSeqs: number[] = [], iCodes: string[] = [], chainIds: string[] = []
  const bfactors: number[] = [], occupancies: number[] = [], heteroFlags: number[] = []
  const conects: number[][] = []

  for (let li = 0; li < lines.length; li++) {
    if (lines[li].trim() !== 'loop_') continue
    // 收集 tag 名
    const tags: string[] = []
    let lj = li + 1
    while (lj < lines.length && lines[lj].trim().startsWith('_')) {
      tags.push(lines[lj].trim().split(/\s+/)[0])
      lj++
    }
    if (!tags.includes('_atom_site.Cartn_x')) continue
    const col = (t: string) => tags.indexOf(t)
    const iGroup = col('_atom_site.group_PDB'), iName = col('_atom_site.label_atom_id')
    const iAlt = col('_atom_site.label_alt_id'), iResName = col('_atom_site.label_comp_id')
    const iAuthAsym = col('_atom_site.auth_asym_id'), iLabelAsym = col('_atom_site.label_asym_id')
    const iAuthSeq = col('_atom_site.auth_seq_id'), iLabelSeq = col('_atom_site.label_seq_id')
    const iIns = col('_atom_site.pdbx_PDB_ins_code')
    const iX = col('_atom_site.Cartn_x'), iY = col('_atom_site.Cartn_y'), iZ = col('_atom_site.Cartn_z')
    const iOcc = col('_atom_site.occupancy'), iB = col('_atom_site.B_iso_or_equiv')
    const iEl = col('_atom_site.type_symbol'), iModel = col('_atom_site.pdbx_PDB_model_num')
    const iSerial = col('_atom_site.id')
    const nCol = tags.length
    let rowIdx = 0
    while (lj < lines.length) {
      const line = lines[lj]
      const t = line.trim()
      if (t === '' || t.startsWith('#') || t.startsWith('loop_') || t.startsWith('data_') || t.startsWith('stop_') || t.startsWith('save_') || t.startsWith('_')) break
      const toks = cifTokenizeLine(line)
      if (!toks || toks.length < nCol) { lj++; break }
      const alt = iAlt >= 0 ? toks[iAlt] : '.'
      if (alt !== '.' && alt !== '?' && alt !== 'A') { lj++; rowIdx++; continue }
      const model = iModel >= 0 ? toks[iModel] : '1'
      const isModel1 = model === '.' || model === '?' || parseInt(model, 10) === 1
      if (!isModel1) { lj++; rowIdx++; continue }
      const group = iGroup >= 0 ? toks[iGroup] : 'ATOM'
      const het = group.toUpperCase().startsWith('HETATM') ? 1 : 0
      const atomName = (iName >= 0 ? toks[iName] : '').replace(/"/g, '')
      const resName = (iResName >= 0 ? toks[iResName] : '').replace(/"/g, '')
      const chainId = (iAuthAsym >= 0 && toks[iAuthAsym] !== '.' && toks[iAuthAsym] !== '?'
        ? toks[iAuthAsym] : (iLabelAsym >= 0 ? toks[iLabelAsym] : ' ')).replace(/"/g, '') || ' '
      let resSeq = iAuthSeq >= 0 ? parseInt(toks[iAuthSeq], 10) : NaN
      if (isNaN(resSeq)) resSeq = iLabelSeq >= 0 ? (parseInt(toks[iLabelSeq], 10) || 0) : 0
      let iCode = iIns >= 0 ? toks[iIns] : '?'
      if (iCode === '.' || iCode === '?') iCode = ''
      let el = (iEl >= 0 ? toks[iEl] : '').replace(/"/g, '').toUpperCase()
      if (!el) el = elementFromAtomName(atomName, het === 1)
      x.push(parseFloat(toks[iX]) || 0)
      y.push(parseFloat(toks[iY]) || 0)
      z.push(parseFloat(toks[iZ]) || 0)
      serial.push(iSerial >= 0 ? (parseInt(toks[iSerial], 10) || 0) : rowIdx + 1)
      names.push(atomName)
      elements.push(el)
      resNames.push(resName)
      resSeqs.push(resSeq)
      iCodes.push(iCode)
      chainIds.push(chainId)
      occupancies.push(iOcc >= 0 ? (parseFloat(toks[iOcc]) || 1) : 1)
      bfactors.push(iB >= 0 ? (parseFloat(toks[iB]) || 0) : 0)
      heteroFlags.push(het)
      lj++; rowIdx++
    }
    // 跳到 loop 之后
    li = lj - 1
  }

  return buildStructure({
    name, format: 'cif', pdbId: id || null, title: title || name, method, resolution,
    x, y, z, serial, names, elements, resNames, resSeqs, iCodes, chainIds,
    bfactors, occupancies, heteroFlags, conects: [], helixRanges: [], sheetRanges: [],
  })
}

// ---------- 通用组装：残基/链/键/SS ----------

interface RawAtoms {
  name: string; format: 'pdb' | 'cif'; pdbId: string | null; title: string; method: string
  resolution: number | null
  x: number[]; y: number[]; z: number[]; serial: number[]; names: string[]; elements: string[]
  resNames: string[]; resSeqs: number[]; iCodes: string[]; chainIds: string[]
  bfactors: number[]; occupancies: number[]; heteroFlags: number[]
  conects: number[][]
  helixRanges: { chain: string; start: number; end: number; ic1: string; ic2: string }[]
  sheetRanges: { chain: string; start: number; end: number; ic1: string; ic2: string }[]
}

function buildStructure(raw: RawAtoms): StructureData {
  const count = raw.x.length
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    positions[i * 3] = raw.x[i]; positions[i * 3 + 1] = raw.y[i]; positions[i * 3 + 2] = raw.z[i]
  }
  const atoms: AtomData = {
    count,
    positions,
    serial: Int32Array.from(raw.serial),
    names: raw.names,
    elements: raw.elements,
    resNames: raw.resNames,
    resSeqs: Int32Array.from(raw.resSeqs),
    iCodes: raw.iCodes,
    chainIds: raw.chainIds,
    bfactors: Float32Array.from(raw.bfactors),
    occupancies: Float32Array.from(raw.occupancies),
    hetero: Uint8Array.from(raw.heteroFlags),
  }

  // ---- 残基分组（连续相同 chain/resSeq/iCode/resName）----
  const residues: Residue[] = []
  const atomResidue = new Int32Array(count)
  let cur: Residue | null = null
  for (let i = 0; i < count; i++) {
    const chainId = atoms.chainIds[i]
    const resSeq = atoms.resSeqs[i]
    const iCode = atoms.iCodes[i]
    const resName = atoms.resNames[i]
    if (!cur || cur.chainId !== chainId || cur.resSeq !== resSeq || cur.iCode !== iCode || cur.resName !== resName) {
      const upper = resName.toUpperCase()
      const isAA = AMINO_ACIDS.has(upper)
      const isNA = NUCLEIC_ACIDS.has(upper)
      const isWater = WATERS.has(upper)
      cur = {
        chainId, resSeq, iCode, resName,
        start: i, end: i + 1,
        ss: 'L',
        polymer: isAA || isNA || (!atoms.hetero[i] && !isWater),
        water: isWater,
        hetero: atoms.hetero[i] === 1,
      }
      residues.push(cur)
    } else {
      cur.end = i + 1
    }
    atomResidue[i] = residues.length - 1
  }

  // ---- 链分组（连续相同 chainId 的残基） ----
  const chains: Chain[] = []
  const atomChain = new Int32Array(count)
  let curChain: Chain | null = null
  for (let ri = 0; ri < residues.length; ri++) {
    const r = residues[ri]
    if (!curChain || curChain.id !== r.chainId) {
      curChain = { id: r.chainId, type: 'ligand', start: r.start, end: r.end, residueIdx: [] }
      chains.push(curChain)
    }
    curChain.end = r.end
    curChain.residueIdx.push(ri)
  }
  // 链类型判定
  for (const ch of chains) {
    let aa = 0, na = 0, water = 0, other = 0
    for (const ri of ch.residueIdx) {
      const r = residues[ri]
      if (AMINO_ACIDS.has(r.resName.toUpperCase())) aa++
      else if (NUCLEIC_ACIDS.has(r.resName.toUpperCase())) na++
      else if (r.water) water++
      else other++
    }
    const total = aa + na + water + other
    if (water > 0 && water === total) ch.type = 'water'
    else if (aa >= na && aa / Math.max(1, total) > 0.5) ch.type = 'protein'
    else if (na > aa && na / Math.max(1, total) > 0.3) ch.type = 'nucleic'
    else ch.type = 'ligand'
  }
  // 原子 → 链索引（残基按链顺序分布）
  {
    const resChain = new Int32Array(residues.length)
    for (let k = 0; k < chains.length; k++) {
      for (const ri of chains[k].residueIdx) resChain[ri] = k
    }
    for (let i = 0; i < count; i++) atomChain[i] = resChain[atomResidue[i]]
  }

  // ---- 二级结构 ----
  const ssFromRecords = raw.helixRanges.length + raw.sheetRanges.length > 0
  if (ssFromRecords) {
    const mark = (ranges: { chain: string; start: number; end: number; ic1: string; ic2: string }[], type: SSType) => {
      for (const rg of ranges) {
        for (const r of residues) {
          if (r.chainId !== rg.chain) continue
          const sameIc = (a: string, b: string) => (a || '') === (b || '')
          if (r.resSeq >= rg.start && r.resSeq <= rg.end) {
            // 插入码粗匹配：首末残基容忍
            r.ss = type
          } else if (r.resSeq === rg.start && sameIc(r.iCode, rg.ic1)) {
            r.ss = type
          }
        }
      }
    }
    mark(raw.helixRanges, 'H')
    mark(raw.sheetRanges, 'E')
  } else {
    // CA 间距启发式：α螺旋 CA(i)-CA(i+4) ≈ 6.2 Å
    for (const ch of chains) {
      if (ch.type !== 'protein') continue
      const cas: number[] = []
      for (const ri of ch.residueIdx) {
        const r = residues[ri]
        let ca = -1
        for (let i = r.start; i < r.end; i++) if (atoms.names[i] === 'CA') { ca = i; break }
        cas.push(ca)
      }
      const n = cas.length
      const isHelix = new Uint8Array(n)
      for (let i = 0; i + 4 < n; i++) {
        if (cas[i] < 0 || cas[i + 4] < 0) continue
        const dx = atoms.positions[cas[i] * 3] - atoms.positions[cas[i + 4] * 3]
        const dy = atoms.positions[cas[i] * 3 + 1] - atoms.positions[cas[i + 4] * 3 + 1]
        const dz = atoms.positions[cas[i] * 3 + 2] - atoms.positions[cas[i + 4] * 3 + 2]
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
        if (d > 5.4 && d < 6.9) {
          isHelix[i] = 1; isHelix[i + 1] = 1; isHelix[i + 2] = 1; isHelix[i + 3] = 1; isHelix[i + 4] = 1
        }
      }
      let runStart = -1
      for (let i = 0; i <= n; i++) {
        if (i < n && isHelix[i]) { if (runStart < 0) runStart = i }
        else {
          if (runStart >= 0 && i - runStart >= 5) {
            for (let k = runStart; k < i; k++) residues[ch.residueIdx[k]].ss = 'H'
          }
          runStart = -1
        }
      }
    }
  }

  // ---- 化学键 ----
  const bonds = computeBonds(atoms, residues, atomResidue, chains, raw.conects)

  // ---- 网格 & 包围盒 ----
  const grid = new SpatialGrid(positions, count, 6)
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < count; i++) {
    for (let d = 0; d < 3; d++) {
      const v = positions[i * 3 + d]
      if (v < min[d]) min[d] = v
      if (v > max[d]) max[d] = v
    }
  }
  if (count === 0) { min[0] = min[1] = min[2] = -1; max[0] = max[1] = max[2] = 1 }
  const center: [number, number, number] = [
    (min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2,
  ]
  const radius = Math.max(1, 0.5 * Math.sqrt(
    (max[0] - min[0]) ** 2 + (max[1] - min[1]) ** 2 + (max[2] - min[2]) ** 2,
  ))

  let hasHydrogens = false
  for (let i = 0; i < count; i++) {
    const e = atoms.elements[i]
    if (e === 'H' || e === 'D') { hasHydrogens = true; break }
  }

  return {
    id: '',
    name: raw.name,
    format: raw.format,
    atoms,
    residues,
    chains,
    bonds,
    atomResidue,
    atomChain,
    meta: {
      title: raw.title || raw.name,
      method: raw.method,
      resolution: raw.resolution,
      pdbId: raw.pdbId,
    },
    ssFromRecords,
    hasHydrogens,
    grid,
    bbox: { min, max, center, radius },
  }
}

function computeBonds(
  atoms: AtomData, residues: Residue[], atomResidue: Int32Array, chains: Chain[],
  conects: number[][],
): { a: Int32Array; b: Int32Array; count: number } {
  const n = atoms.count
  const positions = atoms.positions
  const cov = new Float32Array(n)
  const isH = new Uint8Array(n)
  const isWaterAtom = new Uint8Array(n)
  const bondable = new Uint8Array(n) // 允许距离成键的原子（非水）
  for (let i = 0; i < n; i++) {
    cov[i] = elementInfo(atoms.elements[i]).cov
    const e = atoms.elements[i]
    if (e === 'H' || e === 'D') isH[i] = 1
    const resName = atoms.resNames[i].toUpperCase()
    isWaterAtom[i] = WATERS.has(resName) ? 1 : 0
    // 键合资格：聚合物残基 或 糖类 或 普通非水 HETATM（配体内成键）
    const ri = atomResidue[i]
    const r = residues[ri]
    const sugar = SUGAR_LIKE.has(resName)
    bondable[i] = (!isWaterAtom[i] && (r.polymer || sugar || r.hetero)) ? 1 : 0
  }

  const grid = new SpatialGrid(positions, n, 5)
  const pairsA: number[] = []
  const pairsB: number[] = []
  const added = new Set<number>() // key = a*n+b (a<b)

  const addBond = (a: number, b: number) => {
    if (a === b) return
    const lo = Math.min(a, b), hi = Math.max(a, b)
    const key = lo * n + hi
    if (added.has(key)) return
    added.add(key)
    pairsA.push(lo); pairsB.push(hi)
  }

  for (let i = 0; i < n; i++) {
    if (!bondable[i]) continue
    const xi = positions[i * 3], yi = positions[i * 3 + 1], zi = positions[i * 3 + 2]
    const maxR = cov[i] + 1.1 + 0.45
    const cand = grid.queryRadius(xi, yi, zi, Math.min(maxR + 1.2, 5), positions)
    for (const j of cand) {
      if (j <= i || !bondable[j]) continue
      const dx = positions[j * 3] - xi, dy = positions[j * 3 + 1] - yi, dz = positions[j * 3 + 2] - zi
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 < 0.16) continue // 0.4 Å 以内视为重合
      const cutoff = cov[i] + cov[j] + 0.45
      if (d2 > cutoff * cutoff) {
        // 二硫键特例：S-S < 2.5
        const bothS = atoms.elements[i] === 'S' && atoms.elements[j] === 'S'
        if (bothS && d2 < 6.25 && atoms.resNames[i] === 'CYS' && atoms.resNames[j] === 'CYS') {
          addBond(i, j)
        }
        continue
      }
      // 氢只与其最近的重原子成键
      if (isH[i] || isH[j]) {
        if (isH[i] && isH[j]) continue
        if (d2 > 1.35 * 1.35) continue
        addBond(i, j)
        continue
      }
      // 跨残基限制：同残基 or 同链且均为聚合物
      const ri = atomResidue[i], rj = atomResidue[j]
      if (ri === rj) { addBond(i, j); continue }
      const sameChain = atoms.chainIds[i] === atoms.chainIds[j]
      const bothPoly = residues[ri].polymer && residues[rj].polymer
      const bothSugarOrPoly = (residues[ri].polymer || SUGAR_LIKE.has(atoms.resNames[i].toUpperCase())) &&
        (residues[rj].polymer || SUGAR_LIKE.has(atoms.resNames[j].toUpperCase()))
      if (sameChain && (bothPoly || bothSugarOrPoly)) {
        // 相邻残基编号才允许（避免远距离误连）
        const seqDiff = Math.abs(atoms.resSeqs[i] - atoms.resSeqs[j])
        if (seqDiff <= 1 || bothSugarOrPoly) addBond(i, j)
      }
    }
  }

  // CONECT 补充（含金属配位、二硫键等注释键）
  if (conects.length) {
    const serialMap = new Map<number, number>()
    for (let i = 0; i < n; i++) serialMap.set(atoms.serial[i], i)
    for (const [from, to] of conects) {
      const a = serialMap.get(from), b = serialMap.get(to)
      if (a !== undefined && b !== undefined) {
        const dx = positions[a * 3] - positions[b * 3]
        const dy = positions[a * 3 + 1] - positions[b * 3 + 1]
        const dz = positions[a * 3 + 2] - positions[b * 3 + 2]
        if (dx * dx + dy * dy + dz * dz < 64) addBond(a, b) // 8 Å 内才有效
      }
    }
  }

  return {
    a: Int32Array.from(pairsA),
    b: Int32Array.from(pairsB),
    count: pairsA.length,
  }
}
