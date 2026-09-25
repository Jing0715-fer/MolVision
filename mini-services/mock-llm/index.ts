// QA 用 OpenAI 兼容 mock：GET /v1/models + POST /v1/chat/completions
// 两种形态：非流式（整段 JSON）与 stream:true（OpenAI SSE 分片流）
// 鉴权：携带错误 Authorization 返回 401；省略头放行（裸 curl 冒烟用——应用侧总会带 Bearer test-key-12345）
// 流式内容为「可配置协议 JSON」：按最后一条 user 消息关键词（颜色/显示/隐藏/选择）
// 生成对应 AgentDecision——主应用 Agent 面板端到端联调（用户输入 → 流式回复 → 命令出现在面板）
const models = {
  object: 'list',
  data: [
    { id: 'mock-ultra-128k', owned_by: 'mock-labs', context_length: 131072 },
    { id: 'mock-pro', owned_by: 'mock-labs', context_length: 64000 },
    { id: 'mock-mini', owned_by: 'mock-labs', context_length: 32000 },
    { id: 'text-embedding-mock-3', owned_by: 'mock-labs' },
    { id: 'dall-e-mock-x', owned_by: 'mock-labs' },
    { id: 'whisper-mock', owned_by: 'mock-labs' },
  ],
}

interface MockMessage { role?: string; content?: string }

/** 从文本提取链 ID（「A 链」「A链」「链 A」「chain A」皆可），缺省 A */
function extractChain(text: string): string {
  const m = /(?:链\s*([A-Za-z0-9])|([A-Za-z0-9])\s*链|chain\s+([A-Za-z0-9]))/i.exec(text)
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? 'A').toUpperCase()
}

/** 关键词 → AgentDecision 协议模板（commands 覆盖 color / select / show / hide 四类命令） */
function buildDecision(messages: MockMessage[]): { reply: string; commands: string[] } {
  const lastUser = [...messages].reverse().find(m => m?.role === 'user')?.content ?? ''
  const t = lastUser.toLowerCase()
  const chain = extractChain(lastUser)
  const colors: [RegExp, string, string][] = [
    [/红|red/, 'red', '红色'],
    [/蓝|blue/, 'blue', '蓝色'],
    [/绿|green/, 'green', '绿色'],
    [/黄|yellow/, 'yellow', '黄色'],
  ]
  let colorEn = 'red'
  let colorZh = '红色'
  let colorHit = false
  for (const [re, en, zh] of colors) if (re.test(t)) { colorEn = en; colorZh = zh; colorHit = true; break }
  // 颜色意图：显式上色动词，或消息本身就带颜色词（如「B 链蓝色」）
  if (/颜色|染色|染|上色|color|colour/.test(t) || colorHit) {
    return { reply: `已将 ${chain} 链染为${colorZh}。`, commands: [`select chain ${chain}`, `color ${colorEn}, chain ${chain}`] }
  }
  if (/显示|展示|show|cartoon|卡通/.test(t)) {
    return { reply: `已将 ${chain} 链切换为卡通展示。`, commands: [`select chain ${chain}`, `show cartoon, chain ${chain}`] }
  }
  if (/隐藏|藏|hide/.test(t)) {
    return { reply: `已隐藏 ${chain} 链的线条表示。`, commands: [`hide lines, chain ${chain}`] }
  }
  // 默认 / 选择类
  return { reply: `已选择 ${chain} 链并适配视图。`, commands: [`select chain ${chain}`, `zoom chain ${chain}`] }
}

/** 均分文本为 n 段（流式内容分片用；拼接还原原文） */
function splitChunks(s: string, n: number): string[] {
  const size = Math.max(1, Math.ceil(s.length / n))
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out
}

/** OpenAI SSE chunk 帧 */
function sseChunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: 'mock',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

const server = Bun.serve({
  port: 3999,
  idleTimeout: 30,
  async fetch(req) {
    const url = new URL(req.url)
    const auth = req.headers.get('authorization') ?? ''
    if (auth && auth !== 'Bearer test-key-12345') {
      return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.pathname.endsWith('/models')) {
      return new Response(JSON.stringify(models), { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname.endsWith('/chat/completions')) {
      const body = (await req.json().catch(() => ({}))) as { stream?: boolean; messages?: MockMessage[] }
      const decision = buildDecision(body.messages ?? [])

      // ---- 流式分支：OpenAI SSE 协议（首帧 role、3 个内容增量帧、末帧 finish_reason + [DONE]） ----
      if (body.stream) {
        const parts = splitChunks(JSON.stringify(decision), 3)
        return new Response(
          new ReadableStream({
            async start(controller) {
              const enc = new TextEncoder()
              let clientGone = false
              // 客户端断开（取消传播测试）：吞掉 enqueue 异常并停止后续分片
              const write = (chunk: string) => {
                try { controller.enqueue(enc.encode(chunk)) } catch { clientGone = true }
              }
              write(sseChunk({ role: 'assistant' })) // 首 chunk：role 帧（OpenAI 惯例）
              for (const piece of parts) {
                if (clientGone) break
                write(sseChunk({ content: piece }))
                await new Promise(r => setTimeout(r, 40)) // 模拟生成间隔（联调流式 UI）
              }
              if (!clientGone) {
                write(sseChunk({}, 'stop')) // 末 chunk：finish_reason stop
                write('data: [DONE]\n\n')
                try { controller.close() } catch { /* 已取消 */ }
              }
            },
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
            },
          },
        )
      }

      // ---- 非流式：整段返回协议 JSON（联调 callAgent 非流式路径） ----
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify(decision) }, finish_reason: 'stop' }],
      }), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  },
})
console.log(`mock-llm listening on ${server.url}`)
