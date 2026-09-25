// QA 用 OpenAI 兼容 mock：GET /v1/models + POST /v1/chat/completions
// 鉴权：Bearer test-key-12345
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
const server = Bun.serve({
  port: 3999,
  idleTimeout: 30,
  async fetch(req) {
    const url = new URL(req.url)
    const auth = req.headers.get('authorization') ?? ''
    if (auth !== 'Bearer test-key-12345') {
      return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.pathname.endsWith('/models')) {
      return new Response(JSON.stringify(models), { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname.endsWith('/chat/completions')) {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'mock-ok' }, finish_reason: 'stop' }],
      }), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  },
})
console.log(`mock-llm listening on ${server.url}`)
