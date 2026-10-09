// API 请求体流式限长读取（r101-b，r99 建议③前半落地）
// ─────────────────────────────────────────────────────────────────────────────
// 背景：五条 POST 路由（providers / providers/models / agent / templates/parse /
// templates/calibrate）的 content-length 体积预检可被 chunked 传输绕过——该编码
// 不发送 content-length 头，`Number(hdr ?? '0')` = 0 → 预检恒放行 → 旧版
// `await request.json()` 把任意大小 body 全量缓冲进内存后才做字段校验（App Router
// route handler 无框架级 body 上限）。本函数是权威上限：getReader 逐块累计字节数，
// 超限即 cancel 上流（停止消费，不再为拒绝的请求继续买单）并返回 null。
// 模式照搬 providers/models 路由的 readCapped（响应体版，r99-f3）。
// 刻意不做 JSON 解析（调用方各自 JSON.parse + 400 处理），不 import Next 类型
// （标准 Request 签名，保持纯 Web 标准库）。

/**
 * 读取 POST 请求体并施加权威字节上限。
 *
 * - `request.body` 非空：getReader 逐块累计，received 严格大于 maxBytes 才
 *   `try { await reader.cancel() } catch {}` 并返回 null（超限）；
 *   正常读完 decode 返回全文。边界语义「超过才拒」与 content-length 预检的
 *   `declaredLen > LIMIT` 及 body-null 回落的 `bytes > maxBytes` 三闸统一
 *   （r101-rev-c：旧 `>=` 使恰在上限的诚实请求被拒、413 文案「超过上限」失真，
 *   且与预检在同一边界字节上自相矛盾）。
 * - `request.body` 为 null（空体 / 同域内存流）：回落 `request.text()`，
 *   但仍须限长——text() 后按 UTF-8 字节数检查，超限返回 null。注意此路径
 *   无法中途 cancel 只能事后判定：64KB 级小限下 text() 本身缓冲量可忽略；
 *   16MB 级（agent 路由）text() 全读也已在内存里，与旧版 request.json() 的
 *   缓冲代价同级，可接受（该路径实际只出现在非网络构造的请求上）。
 *
 * 返回 null = 超限（调用方回 413）；流读取中途出错（客户端断开等）则原样
 * 抛出（调用方按既有 5xx 语义处理）。
 */
export async function readRequestCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) {
    const text = await request.text()
    // 字节级判定（多字节字符下 string.length 偏小）；TextEncoder 为 Web 标准
    const bytes = new TextEncoder().encode(text).length
    return bytes > maxBytes ? null : text
  }
  const reader = request.body.getReader()
  const decoder = new TextDecoder()
  let out = ''
  let received = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    received += value.byteLength
    if (received > maxBytes) {
      // 超限：cancel 上游（尽力而为——流已自然结束则吞掉），丢弃已读内容
      try { await reader.cancel() } catch { /* 已结束 */ }
      return null
    }
    out += decoder.decode(value, { stream: true })
  }
  // 终局 flush：多字节字符恰好被分块边界截断时，stream:true 的尾段残留在
  // decoder 内部缓冲，不 flush 会丢最后一个字符 → 下游 JSON.parse 误报 400
  out += decoder.decode()
  return out
}
