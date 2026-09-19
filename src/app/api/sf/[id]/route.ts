// RCSB 结构因子（SF mmCIF）代理 —— 电子密度图计算的数据源
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
    // SF 文件普遍 >2MB，超出 Next.js data cache 上限会刷警告 —— 显式 no-store（走 OS 级 fetch 缓存语义）
    const res = await fetch(`https://files.rcsb.org/download/${pdbId}-sf.cif`, { headers, cache: 'no-store' })
    if (res.ok) {
      const text = await res.text()
      if (text.length < 200 || !text.includes('_refln')) {
        return NextResponse.json({ error: `PDB ${pdbId} 结构因子文件无反射数据` }, { status: 422 })
      }
      return new NextResponse(text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    if (res.status === 404) {
      return NextResponse.json({ error: `PDB ${pdbId} 未沉积结构因子（老条目或 EM 结构）` }, { status: 404 })
    }
    return NextResponse.json({ error: `RCSB 返回 ${res.status}` }, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: `Upstream error: ${e instanceof Error ? e.message : 'unknown'}` }, { status: 502 })
  }
}
