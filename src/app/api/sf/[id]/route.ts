// RCSB 结构因子（SF mmCIF）代理 —— 电子密度图计算的数据源
import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { LOCALE_COOKIE, type Locale } from '@/i18n/locales'

/** 请求级语言检测（与 layout 同规则）：cookie > Accept-Language —— 错误文案随界面语言 */
async function detectLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value
  if (stored === 'en' || stored === 'zh') return stored
  const accept = (await headers()).get('accept-language')?.toLowerCase() ?? ''
  return accept.startsWith('en') ? 'en' : 'zh'
}

const errText = (locale: Locale, zh: string, en: string) => (locale === 'en' ? en : zh)

// ---------- 体积护栏（与 /api/pdb 同款：SF mmCIF 大衍射数据集可超 100MB） ----------
const MAX_BYTES = 64 * 1048576

function oversize(locale: Locale, gotBytes: number): NextResponse {
  const mb = (gotBytes / 1048576).toFixed(1)
  return NextResponse.json({ error: errText(locale,
    `结构因子文件过大（${mb} MB，上限 64 MB）——大晶胞高分辨率衍射数据请改用桌面软件下载处理`,
    `Structure-factor file too large (${mb} MB, limit 64 MB) — download large high-resolution datasets with desktop software instead`) }, { status: 413 })
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const locale = await detectLocale()
  const { id } = await params
  const pdbId = id.trim().toUpperCase()
  if (!/^[0-9][A-Z0-9]{3}$/.test(pdbId)) {
    return NextResponse.json({ error: errText(locale, '无效的 PDB 编号', 'Invalid PDB ID') }, { status: 400 })
  }
  const headers_ = { 'User-Agent': 'MolVision/1.0 (molecular viewer)' }
  try {
    // SF 文件普遍 >2MB，超出 Next.js data cache 上限会刷警告 —— 显式 no-store（走 OS 级 fetch 缓存语义）
    const res = await fetch(`https://files.rcsb.org/download/${pdbId}-sf.cif`, { headers: headers_, cache: 'no-store' })
    if (res.ok) {
      // 体积预检：content-length 命中即拒（不读 body）；无头时读完再验
      const cl = Number(res.headers.get('content-length') ?? '0')
      if (cl > MAX_BYTES) {
        if (res.body) void res.body.cancel().catch(() => {})
        return oversize(locale, cl)
      }
      const text = await res.text()
      if (text.length > MAX_BYTES) return oversize(locale, text.length)
      if (text.length < 200 || !text.includes('_refln')) {
        return NextResponse.json({ error: errText(locale, `PDB ${pdbId} 结构因子文件无反射数据`, `PDB ${pdbId} structure-factor file has no reflection data`) }, { status: 422 })
      }
      return new NextResponse(text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      })
    }
    if (res.status === 404) {
      return NextResponse.json({ error: errText(locale, `PDB ${pdbId} 未沉积结构因子（老条目或 EM 结构）`, `PDB ${pdbId} has no deposited structure factors (legacy entry or EM structure)`) }, { status: 404 })
    }
    return NextResponse.json({ error: errText(locale, `RCSB 返回 ${res.status}`, `RCSB returned ${res.status}`) }, { status: res.status })
  } catch (e) {
    return NextResponse.json({ error: errText(locale, `上游错误：${e instanceof Error ? e.message : '未知'}`, `Upstream error: ${e instanceof Error ? e.message : 'unknown'}`) }, { status: 502 })
  }
}
