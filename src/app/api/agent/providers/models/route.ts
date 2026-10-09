// 供应商可用模型自动检测：GET <baseURL>/models（10s 超时）
// - 支持传入临时 apiKey/baseURL（输入 Key 即测，不落盘）；缺省回落到已存配置/环境变量
// - 响应规范化为统一模型列表（chat 类优先、按用途分类）
// - 401/403 = Key 错；404 = 端点活着但不支持 models 列表；HTML = URL 错
// zai 内置通道返回固定目录（无需 Key 检测）。
import { NextRequest, NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import {
  getProviderProfile, resolveApiKey, resolveBaseURL, sanitizeBaseURL, normalizeModelsResponse, type DiscoveredModel,
} from '@/lib/molecular/agent/providers'
import { LOCALE_COOKIE, type Locale } from '@/i18n/locales'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

/** 请求级语言检测（与 layout 同规则）：cookie > Accept-Language —— 错误文案随界面语言 */
async function detectLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value
  if (stored === 'en' || stored === 'zh') return stored
  const accept = (await headers()).get('accept-language')?.toLowerCase() ?? ''
  return accept.startsWith('en') ? 'en' : 'zh'
}

const errText = (locale: Locale, zh: string, en: string) => (locale === 'en' ? en : zh)

interface ProbeBody {
  providerId?: string
  apiKey?: string
  baseURL?: string
}

/** r99-f3：capped 文本读取——上游误配到大体积端点时旧版 res.text() 无上限全量缓冲；
 *  流式累计超 maxBytes 即停止消费（cancel 上游连接）并截断返回，JSON 解析自然容错。
 *  body 为 null（204 等无体状态）时回落 res.text()（无体无体积风险）。*/
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return await res.text()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    received += value.byteLength
    out += decoder.decode(value, { stream: true })
    if (received >= maxBytes) {
      try { await reader.cancel() } catch { /* 已结束 */ }
      break
    }
  }
  return out
}

export async function POST(request: NextRequest) {
  const locale = await detectLocale()
  // r99-f3：体积预检先行（providers 配置面同款）——探测体只收 providerId/apiKey/
  // baseURL 三个短字段，64KB 上限远超合法载荷；旧版 request.json() 全量缓冲任意 body
  const declaredLen = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLen) && declaredLen > 64 * 1024) {
    return NextResponse.json({ ok: false, error: errText(locale, '请求体超过 64KB 上限（模型探测只需 providerId / API Key / Base URL 等短字段）', 'Request body exceeds the 64KB limit (model probing only needs short fields such as providerId / API key / base URL)') }, { status: 413 })
  }
  let body: ProbeBody
  try {
    body = await request.json() as ProbeBody
  } catch {
    return NextResponse.json({ ok: false, error: errText(locale, '请求体不是合法 JSON', 'Request body is not valid JSON') }, { status: 400 })
  }
  const providerId = body.providerId ?? ''
  // r99-main：字符串字段类型白名单——旧版零校验，apiKey: 123 在 .trim() 抛 TypeError →
  // 500 裸异常页（实测复现）。统一 400 双语
  const badStr = (v: unknown) => v !== undefined && v !== null && typeof v !== 'string'
  if (badStr(body.providerId) || badStr(body.apiKey) || badStr(body.baseURL)) {
    return NextResponse.json({ ok: false, error: errText(locale, '字段类型非法（providerId/apiKey/baseURL 须为字符串）', 'Invalid field types (providerId/apiKey/baseURL must be strings)') }, { status: 400 })
  }

  // 内置通道：直接回目录（glm-4.6 等）
  if (providerId === 'zai') {
    const profile = getProviderProfile('zai')
    return NextResponse.json({
      ok: true,
      builtin: true,
      models: profile?.models.map(m => ({
        id: m.id, ownedBy: 'z.ai', contextLength: m.contextWindow, kind: 'chat' as const,
      })),
      total: profile?.models.length ?? 0,
      note: errText(locale, '内置 SDK 通道，模型固定', 'Built-in SDK channel; models are fixed'),
    })
  }

  const profile = getProviderProfile(providerId)
  if (!profile) {
    return NextResponse.json({ ok: false, error: errText(locale, `未知供应商：${providerId}`, `Unknown provider: ${providerId}`) }, { status: 404 })
  }

  // 凭据优先级：请求携带（临时检测，不落盘）> 存储 > 环境变量
  const apiKey = body.apiKey?.trim() || resolveApiKey(providerId)
  const baseURLRaw = body.baseURL?.trim() || resolveBaseURL(providerId) || ''
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: errText(locale, `未输入 API Key（${profile.displayName}）`, `No API Key entered (${profile.displayName})`) })
  }
  if (!baseURLRaw) {
    return NextResponse.json({ ok: false, error: errText(locale, '未配置 Base URL（本地/自定义供应商需填写）', 'Base URL not configured (required for local/custom providers)') })
  }
  // SSRF 卡点：临时传入或存量配置的 URL 统一过 sanitize（仅 http(s)、拒 userinfo/畸形；环回/私网放行——mock 联调合法）
  const san = sanitizeBaseURL(baseURLRaw)
  if (!san.ok) return NextResponse.json({ ok: false, error: errText(locale, san.zh, san.en) })
  const baseURL = san.url

  const headers: Record<string, string> = {
    [profile.authHeader ?? 'Authorization']: `${profile.authPrefix ?? 'Bearer '}${apiKey}`,
    ...(profile.extraHeaders ?? {}),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`${baseURL}/models`, { method: 'GET', headers, signal: controller.signal })
    // r99-f3：capped 读取——合法 /models 列表仅几 KB，1MB 上限远超之；超限截断
    const rawText = await readCapped(res, 1024 * 1024)

    if (res.ok) {
      if (rawText.trimStart().startsWith('<')) {
        return NextResponse.json({ ok: false, error: errText(locale, '端点返回 HTML——Base URL 可能不正确（缺少 /v1 或路径错误）', 'Endpoint returned HTML — the Base URL may be incorrect (missing /v1 or wrong path)') })
      }
      let models: DiscoveredModel[] = []
      try {
        models = normalizeModelsResponse(JSON.parse(rawText))
      } catch { /* 非 JSON 容错 */ }
      if (models.length === 0) {
        return NextResponse.json({ ok: true, models: [], total: 0, note: errText(locale, '端点连通，但未返回模型列表——请手动填写模型 ID', 'Endpoint reachable, but no model list returned — enter model IDs manually') })
      }
      return NextResponse.json({ ok: true, models, total: models.length })
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, error: errText(locale, `认证失败（HTTP ${res.status}）——API Key 无效或无权限`, `Authentication failed (HTTP ${res.status}) — API Key invalid or unauthorized`) })
    }
    if (res.status === 404) {
      return NextResponse.json({ ok: true, models: [], total: 0, note: errText(locale, '端点连通（/models 不可用），请手动填写模型 ID', 'Endpoint reachable (/models unavailable) — enter model IDs manually') })
    }
    // r99-f3：错误文案收敛——只回状态码不回上游 body 原文（上游响应体不可信，
    // 回显即反射面：内部错误页/敏感字段可直达前端）
    return NextResponse.json({ ok: false, error: errText(locale, `HTTP ${res.status}（端点返回异常状态）`, `HTTP ${res.status} (endpoint returned an error status)`) })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('abort') || controller.signal.aborted) {
      return NextResponse.json({ ok: false, error: errText(locale, '超时（10s）——Base URL 不可达或网络受限', 'Timeout (10s) — Base URL unreachable or network restricted') })
    }
    // r99-f3：网络错误同样收敛为固定文案（旧版回显 e.message 截 200 字符——本地错误
    // 信息对用户无价值且可携带内部细节）
    return NextResponse.json({ ok: false, error: errText(locale, '网络错误（Base URL 不可达或连接被拒）', 'Network error (Base URL unreachable or connection refused)') })
  } finally {
    clearTimeout(timer)
  }
}
