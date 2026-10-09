import { NextRequest, NextResponse } from 'next/server'

// API 鉴权门（Next 16 proxy 约定，原 middleware）：设置 MOLVISION_API_TOKEN 环境变量后，所有 /api/* 请求
// 须携带 `Authorization: Bearer <token>` 或 `x-api-token: <token>`，否则 401（双语，
// 按 Accept-Language）。未设置时零影响——本地单机沙箱语义（浏览器内应用不带 token 直连）。
// 部署到多用户/公网环境前务必设置；比较采用常量时间 XOR，防时序侧信道。
// 注：页面路由（/）不受保护，预览面板始终可达；仅数据面（PDB 拉取/Agent 补全/供应商配置）设卡。
export function proxy(request: NextRequest) {
  const token = process.env.MOLVISION_API_TOKEN
  if (!token) return NextResponse.next()

  const auth = request.headers.get('authorization') ?? ''
  const bearer = auth.replace(/^Bearer\s+/i, '').trim()
  const provided = bearer || request.headers.get('x-api-token')?.trim() || ''

  // 长度不等先行拒绝（长度本身不敏感）；等长时逐字符 XOR 聚合比较
  let mismatch = provided.length !== token.length ? 1 : 0
  if (mismatch === 0) {
    for (let i = 0; i < token.length; i++) mismatch |= provided.charCodeAt(i) ^ token.charCodeAt(i)
  }
  if (mismatch !== 0) {
    const en = (request.headers.get('accept-language') ?? '').toLowerCase().startsWith('en')
    return NextResponse.json(
      { error: en ? 'Unauthorized: missing or invalid API token' : '未授权：缺少或错误的 API token' },
      { status: 401 },
    )
  }
  return NextResponse.next()
}

export const config = { matcher: '/api/:path*' }
