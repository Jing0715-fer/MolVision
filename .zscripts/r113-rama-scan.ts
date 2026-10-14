// r113：批量筛查含拉马钱德兰离群残基的 PDB 候选（离群路径 E2E 用例选型）
// 用法：bun .zscripts/r113-rama-scan.ts 1UBQ 1FDX 2GB1 1A2N ...
import { parseStructure } from '../src/lib/molecular/parser'
import { computeRama } from '../src/lib/molecular/rama'

const ids = process.argv.slice(2)
for (const id of ids) {
  try {
    const res = await fetch(`http://localhost:3000/api/pdb/${id}`)
    if (!res.ok) { console.log(`${id}: FETCH-FAIL ${res.status}`); continue }
    const text = await res.text()
    const data = parseStructure(text, id, 'pdb', id)
    const r = computeRama(data)
    const pctF = r.points.length ? (r.favored / r.points.length * 100).toFixed(1) : '0'
    console.log(`${id}: ${r.points.length} pts · favored ${r.favored} (${pctF}%) · allowed ${r.allowed} · outlier ${r.outlier} · skipped ${r.skipped} · ${r.ms.toFixed(1)}ms`)
  } catch (e) {
    console.log(`${id}: ERROR ${e instanceof Error ? e.message : String(e)}`)
  }
}
