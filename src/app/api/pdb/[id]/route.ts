// RCSB PDB 代理（避免浏览器 CORS 限制）
import { NextResponse } from 'next/server'
import { LOCALE_COOKIE, type Locale } from '@/i18n/locales'

/** 请求级语言检测（cookie > Accept-Language；与 agent 路由同款局部实现，服务端安全零客户端依赖） */
function detectLocale(req: Request): Locale {
  try {
    const cookie = req.headers.get('cookie') ?? ''
    const m = cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`))
    if (m && m[1] === 'en') return 'en'
    const al = req.headers.get('accept-language') ?? ''
    if (/^\s*en\b/i.test(al)) return 'en'
  } catch { /* 沙箱头缺失兜底 */ }
  return 'zh'
}

function errText(locale: Locale, zh: string, en: string): string {
  return locale === 'en' ? en : zh
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const locale = detectLocale(req)
  const pdbId = id.trim().toUpperCase()
  if (!/^[0-9][A-Z0-9]{3}$/.test(pdbId)) {
    return NextResponse.json({ error: errText(locale, '无效的 PDB ID（4 位：数字+字母/数字，如 4HHB）', 'Invalid PDB ID (4 characters: digit + alphanumeric, e.g. 4HHB)') }, { status: 400 })
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
    return NextResponse.json({ error: errText(locale, `RCSB 上未找到 ${pdbId}`, `PDB ${pdbId} not found on RCSB`) }, { status: 404 })
  } catch (e) {
    return NextResponse.json({ error: errText(locale, `上游错误：${e instanceof Error ? e.message : '未知'}`, `Upstream error: ${e instanceof Error ? e.message : 'unknown'}`) }, { status: 502 })
  }
}
