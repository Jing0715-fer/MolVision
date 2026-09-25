// AI 供应商配置 API
// GET    /api/agent/providers                     → 供应商状态列表（含 availableModels）+ 当前默认
// POST   /api/agent/providers                     → 保存配置 { providerId, apiKey?, baseURL?, defaultModel?, discoveredModels?, setDefault? }
// DELETE /api/agent/providers?providerId=xxx      → 删除某供应商配置（zai 内置不可删）
import { NextRequest, NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import {
  listProviderStatus, getDefaultProviderId, setDefaultProviderId,
  setProviderConfig, deleteProviderConfig, PROVIDER_CATALOG, sanitizeBaseURL, type DiscoveredModel,
} from '@/lib/molecular/agent/providers'
import { LOCALE_COOKIE, type Locale } from '@/i18n/locales'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 请求级语言检测（与 layout 同规则）：cookie > Accept-Language —— 错误文案随界面语言 */
async function detectLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value
  if (stored === 'en' || stored === 'zh') return stored
  const accept = (await headers()).get('accept-language')?.toLowerCase() ?? ''
  return accept.startsWith('en') ? 'en' : 'zh'
}

const errText = (locale: Locale, zh: string, en: string) => (locale === 'en' ? en : zh)

function sanitizeDiscovered(input: unknown): DiscoveredModel[] | undefined {
  if (!Array.isArray(input)) return undefined
  const out: DiscoveredModel[] = []
  for (const item of input.slice(0, 300)) {
    if (!item || typeof item !== 'object') continue
    const m = item as Record<string, unknown>
    if (typeof m.id !== 'string' || !m.id.trim()) continue
    out.push({
      id: m.id.trim().slice(0, 200),
      ownedBy: typeof m.ownedBy === 'string' ? m.ownedBy.slice(0, 100) : undefined,
      contextLength: typeof m.contextLength === 'number' && m.contextLength > 0 ? m.contextLength : undefined,
      kind: typeof m.kind === 'string' ? (m.kind as DiscoveredModel['kind']) : undefined,
    })
  }
  return out
}

export async function GET() {
  return NextResponse.json({
    providers: listProviderStatus(),
    defaultProvider: getDefaultProviderId(),
  })
}

export async function POST(request: NextRequest) {
  const locale = await detectLocale()
  let body: { providerId?: string; apiKey?: string; baseURL?: string; defaultModel?: string; timeoutMs?: number; discoveredModels?: unknown; setDefault?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: errText(locale, '请求体不是合法 JSON', 'Request body is not valid JSON') }, { status: 400 })
  }

  // providerId 白名单校验（防任意字符串写脏存储）
  if (body.providerId !== undefined && !PROVIDER_CATALOG.some(p => p.id === body.providerId)) {
    return NextResponse.json({ error: errText(locale, `providerId 必须是：${PROVIDER_CATALOG.map(p => p.id).join(', ')}`, `providerId must be one of: ${PROVIDER_CATALOG.map(p => p.id).join(', ')}`) }, { status: 400 })
  }

  if (body.setDefault && body.providerId) {
    const ok = setDefaultProviderId(body.providerId)
    if (!ok) return NextResponse.json({ error: errText(locale, '未知供应商', 'Unknown provider') }, { status: 404 })
    return NextResponse.json({ ok: true, defaultProvider: body.providerId })
  }

  if (!body.providerId) {
    return NextResponse.json({ error: errText(locale, 'providerId 必填', 'providerId is required') }, { status: 400 })
  }
  // baseURL 入库前卡点（SSRF 反射面收敛：仅 http(s)、拒 userinfo/畸形 URL；环回/私网放行——本地单机语义）
  if (body.baseURL !== undefined && body.baseURL.trim() !== '') {
    const san = sanitizeBaseURL(body.baseURL)
    if (!san.ok) return NextResponse.json({ error: errText(locale, san.zh, san.en) }, { status: 400 })
    body.baseURL = san.url
  }
  // timeoutMs 类型卡点（非数值拒绝，防字符串注入存储）
  if (body.timeoutMs !== undefined && (typeof body.timeoutMs !== 'number' || !Number.isFinite(body.timeoutMs))) {
    return NextResponse.json({ error: errText(locale, 'timeoutMs 必须是数字（毫秒）', 'timeoutMs must be a number (milliseconds)') }, { status: 400 })
  }

  const discoveredModels = sanitizeDiscovered(body.discoveredModels)
  const ok = setProviderConfig(body.providerId, {
    apiKey: body.apiKey,
    baseURL: body.baseURL,
    defaultModel: body.defaultModel,
    ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
    ...(discoveredModels !== undefined ? { discoveredModels } : {}),
  })
  if (!ok) return NextResponse.json({ error: errText(locale, '未知供应商', 'Unknown provider') }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const locale = await detectLocale()
  const providerId = request.nextUrl.searchParams.get('providerId')
  if (!providerId) {
    return NextResponse.json({ error: errText(locale, '缺少 providerId 查询参数', 'Missing providerId query parameter') }, { status: 400 })
  }
  if (providerId === 'zai') {
    return NextResponse.json({ error: errText(locale, '内置通道不可删除', 'The built-in channel cannot be deleted') }, { status: 400 })
  }
  const ok = deleteProviderConfig(providerId)
  if (!ok) return NextResponse.json({ error: errText(locale, '未知供应商', 'Unknown provider') }, { status: 404 })
  return NextResponse.json({ ok: true })
}
