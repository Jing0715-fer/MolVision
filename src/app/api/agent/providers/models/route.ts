// 供应商可用模型自动检测：GET <baseURL>/models（10s 超时）
// - 支持传入临时 apiKey/baseURL（输入 Key 即测，不落盘）；缺省回落到已存配置/环境变量
// - 响应规范化为统一模型列表（chat 类优先、按用途分类）
// - 401/403 = Key 错；404 = 端点活着但不支持 models 列表；HTML = URL 错
// zai 内置通道返回固定目录（无需 Key 检测）。
import { NextRequest, NextResponse } from 'next/server'
import {
  getProviderProfile, resolveApiKey, resolveBaseURL, normalizeModelsResponse, type DiscoveredModel,
} from '@/lib/molecular/agent/providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

interface ProbeBody {
  providerId?: string
  apiKey?: string
  baseURL?: string
}

export async function POST(request: NextRequest) {
  let body: ProbeBody
  try {
    body = await request.json() as ProbeBody
  } catch {
    return NextResponse.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 })
  }
  const providerId = body.providerId ?? ''

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
      note: '内置 SDK 通道，模型固定',
    })
  }

  const profile = getProviderProfile(providerId)
  if (!profile) {
    return NextResponse.json({ ok: false, error: `未知供应商：${providerId}` }, { status: 404 })
  }

  // 凭据优先级：请求携带（临时检测，不落盘）> 存储 > 环境变量
  const apiKey = body.apiKey?.trim() || resolveApiKey(providerId)
  const baseURL = (body.baseURL?.trim() || resolveBaseURL(providerId) || '').replace(/\/$/, '')
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: `未输入 API Key（${profile.displayName}）` })
  }
  if (!baseURL) {
    return NextResponse.json({ ok: false, error: '未配置 Base URL（本地/自定义供应商需填写）' })
  }

  const headers: Record<string, string> = {
    [profile.authHeader ?? 'Authorization']: `${profile.authPrefix ?? 'Bearer '}${apiKey}`,
    ...(profile.extraHeaders ?? {}),
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const res = await fetch(`${baseURL}/models`, { method: 'GET', headers, signal: controller.signal })
    const rawText = await res.text()

    if (res.ok) {
      if (rawText.trimStart().startsWith('<')) {
        return NextResponse.json({ ok: false, error: '端点返回 HTML——Base URL 可能不正确（缺少 /v1 或路径错误）' })
      }
      let models: DiscoveredModel[] = []
      try {
        models = normalizeModelsResponse(JSON.parse(rawText))
      } catch { /* 非 JSON 容错 */ }
      if (models.length === 0) {
        return NextResponse.json({ ok: true, models: [], total: 0, note: '端点连通，但未返回模型列表——请手动填写模型 ID' })
      }
      return NextResponse.json({ ok: true, models, total: models.length })
    }
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ ok: false, error: `认证失败（HTTP ${res.status}）——API Key 无效或无权限` })
    }
    if (res.status === 404) {
      return NextResponse.json({ ok: true, models: [], total: 0, note: '端点连通（/models 不可用），请手动填写模型 ID' })
    }
    return NextResponse.json({ ok: false, error: `HTTP ${res.status}：${rawText.slice(0, 200)}` })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('abort') || controller.signal.aborted) {
      return NextResponse.json({ ok: false, error: '超时（10s）——Base URL 不可达或网络受限' })
    }
    return NextResponse.json({ ok: false, error: `网络错误：${msg.slice(0, 200)}` })
  } finally {
    clearTimeout(timer)
  }
}
