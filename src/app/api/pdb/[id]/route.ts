// RCSB PDB 代理（避免浏览器 CORS 限制）
import { NextResponse } from 'next/server'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const pdbId = id.trim().toUpperCase()
  if (!/^[0-9][A-Z0-9]{3}$/.test(pdbId)) {
    return NextResponse.json({ error: 'Invalid PDB ID' }, { status: 400 })
  }
  const headers = { 'User-Agent': 'MolVision/1.0 (molecular viewer)' }
  try {
    // 优先 PDB 传统格式（含 HELIX/SHEET 二级结构记录）
    let res = await fetch(`https://files.rcsb.org/download/${pdbId}.pdb`, { headers, next: { revalidate: 604800 } })
    if (res.ok) {
      const text = await res.text()
      return new NextResponse(text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'x-mol-format': 'pdb',
        },
      })
    }
    // 回退 mmCIF（超大结构）
    res = await fetch(`https://files.rcsb.org/download/${pdbId}.cif`, { headers, next: { revalidate: 604800 } })
    if (res.ok) {
      const text = await res.text()
      return new NextResponse(text, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'x-mol-format': 'cif',
        },
      })
    }
    return NextResponse.json({ error: `PDB ${pdbId} not found on RCSB` }, { status: 404 })
  } catch (e) {
    return NextResponse.json({ error: `Upstream error: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }
}
