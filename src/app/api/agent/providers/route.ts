// AI 供应商配置 API
// GET    /api/agent/providers                     → 供应商状态列表（含 availableModels）+ 当前默认
// POST   /api/agent/providers                     → 保存配置 { providerId, apiKey?, baseURL?, defaultModel?, discoveredModels?, setDefault? }
// DELETE /api/agent/providers?providerId=xxx      → 删除某供应商配置（zai 内置不可删）
import { NextRequest, NextResponse } from 'next/server'
import {
  listProviderStatus, getDefaultProviderId, setDefaultProviderId,
  setProviderConfig, deleteProviderConfig, PROVIDER_CATALOG, type DiscoveredModel,
} from '@/lib/molecular/agent/providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
  let body: { providerId?: string; apiKey?: string; baseURL?: string; defaultModel?: string; discoveredModels?: unknown; setDefault?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  // providerId 白名单校验（防任意字符串写脏存储）
  if (body.providerId !== undefined && !PROVIDER_CATALOG.some(p => p.id === body.providerId)) {
    return NextResponse.json({ error: `providerId 必须是：${PROVIDER_CATALOG.map(p => p.id).join(', ')}` }, { status: 400 })
  }

  if (body.setDefault && body.providerId) {
    const ok = setDefaultProviderId(body.providerId)
    if (!ok) return NextResponse.json({ error: '未知供应商' }, { status: 404 })
    return NextResponse.json({ ok: true, defaultProvider: body.providerId })
  }

  if (!body.providerId) {
    return NextResponse.json({ error: 'providerId 必填' }, { status: 400 })
  }
  const discoveredModels = sanitizeDiscovered(body.discoveredModels)
  const ok = setProviderConfig(body.providerId, {
    apiKey: body.apiKey,
    baseURL: body.baseURL,
    defaultModel: body.defaultModel,
    ...(discoveredModels !== undefined ? { discoveredModels } : {}),
  })
  if (!ok) return NextResponse.json({ error: '未知供应商' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const providerId = request.nextUrl.searchParams.get('providerId')
  if (!providerId) {
    return NextResponse.json({ error: '缺少 providerId 查询参数' }, { status: 400 })
  }
  if (providerId === 'zai') {
    return NextResponse.json({ error: '内置通道不可删除' }, { status: 400 })
  }
  const ok = deleteProviderConfig(providerId)
  if (!ok) return NextResponse.json({ error: '未知供应商' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
