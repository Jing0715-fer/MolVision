// AI 供应商目录 + 凭据存储 + OpenAI 兼容直连适配（服务端专用，零客户端依赖）
// 架构参考 pdb-tracker-web-v5 的 ProvidersPanel 体系，按 MolVision 规模精简：
// - 'zai' = 内置 z-ai-web-dev-sdk（免配置，始终可用）
// - 其余 = OpenAI 兼容 /chat/completions 直连 fetch（含 Anthropic 特殊 auth 头）
// - 凭据落盘 .molvision/agent-providers.json（0600），API Key 永不回传前端明文

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface ProviderModel {
  id: string
  name: string
  /** 上下文窗口（token 数，仅展示用） */
  contextWindow?: number
}

export interface ProviderProfile {
  id: string
  displayName: string
  /** 1-2 字符短标签（UI 徽章用） */
  label: string
  baseURL: string
  /** 环境变量回退名（存储键缺失时尝试） */
  apiKeyEnv: string
  /** 认证头名（默认 Authorization） */
  authHeader?: string
  /** 认证前缀（默认 'Bearer '） */
  authPrefix?: string
  defaultModel: string
  models: ProviderModel[]
  /** 附加请求头（如 anthropic-version） */
  extraHeaders?: Record<string, string>
  docsUrl: string
  /** 额外说明（设置页展示） */
  note?: string
}

export const PROVIDER_CATALOG: ProviderProfile[] = [
  {
    id: 'zai',
    displayName: 'Z.ai GLM（内置）',
    label: 'GLM',
    baseURL: '',
    apiKeyEnv: 'ZAI_API_KEY',
    defaultModel: 'glm-4.6',
    models: [
      { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 128000 },
      { id: 'glm-4.5', name: 'GLM-4.5', contextWindow: 128000 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000 },
    ],
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    note: '沙箱内置 SDK 直连，无需 API Key；视觉自查始终走此通道',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    label: 'DS',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3 (Chat)', contextWindow: 64000 },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Reasoner)', contextWindow: 64000 },
    ],
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    label: 'AI',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1047576 },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', contextWindow: 1047576 },
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000 },
    ],
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic Claude',
    label: 'AN',
    baseURL: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    authHeader: 'x-api-key',
    authPrefix: '',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000 },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000 },
    ],
    docsUrl: 'https://console.anthropic.com/settings/keys',
    note: 'OpenAI 兼容端点（/v1/chat/completions）',
  },
  {
    id: 'google',
    displayName: 'Google Gemini',
    label: 'GG',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GOOGLE_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1048576 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1048576 },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1048576 },
    ],
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'qwen',
    displayName: '通义千问 Qwen',
    label: 'QW',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
    models: [
      { id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: 262144 },
      { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072 },
      { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 1000000 },
    ],
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
  },
  {
    id: 'moonshot',
    displayName: '月之暗面 Kimi',
    label: 'MS',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    defaultModel: 'kimi-k2-0905-preview',
    models: [
      { id: 'kimi-k2-0905-preview', name: 'Kimi K2', contextWindow: 131072 },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 (32k)', contextWindow: 32000 },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 (128k)', contextWindow: 128000 },
    ],
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    displayName: '智谱 GLM',
    label: 'ZP',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    defaultModel: 'glm-4-plus',
    models: [
      { id: 'glm-4-plus', name: 'GLM-4 Plus', contextWindow: 128000 },
      { id: 'glm-4-air', name: 'GLM-4 Air', contextWindow: 128000 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000 },
    ],
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    label: 'OR',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'deepseek/deepseek-chat',
    models: [
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: 200000 },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000 },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', contextWindow: 64000 },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1048576 },
    ],
    docsUrl: 'https://openrouter.ai/keys',
    note: '一个 Key 聚合全主流模型',
  },
  {
    id: 'siliconflow',
    displayName: 'SiliconFlow 硅基流动',
    label: 'SF',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 64000 },
      { id: 'Qwen/Qwen3-235B-A22B-Instruct', name: 'Qwen3 235B', contextWindow: 32768 },
    ],
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'custom',
    displayName: '自定义 OpenAI 兼容端点',
    label: '⌘',
    baseURL: '',
    apiKeyEnv: 'CUSTOM_LLM_API_KEY',
    defaultModel: '',
    models: [],
    docsUrl: '',
    note: '任意兼容 /chat/completions 的网关（vLLM / one-api / 内网代理等）',
  },
]

export function getProviderProfile(id: string): ProviderProfile | undefined {
  return PROVIDER_CATALOG.find(p => p.id === id)
}

// ———— 凭据存储（文件落盘 + mtime 失效缓存） ————

export interface ProviderConfig {
  apiKey?: string
  baseURL?: string
  defaultModel?: string
}

interface StoreShape {
  configs: Record<string, ProviderConfig>
  default: string
}

const STORE_DIR = resolve(process.cwd(), '.molvision')
const STORE_FILE = resolve(STORE_DIR, 'agent-providers.json')

let cache: StoreShape | null = null
let cacheMtime = 0

const DEFAULT_STORE: StoreShape = { configs: {}, default: 'zai' }

function loadStore(): StoreShape {
  try {
    if (!existsSync(STORE_FILE)) return DEFAULT_STORE
    const stat = statSync(STORE_FILE)
    if (cache && stat.mtimeMs === cacheMtime) return cache
    const raw = JSON.parse(readFileSync(STORE_FILE, 'utf-8')) as Partial<StoreShape>
    cache = {
      configs: raw.configs && typeof raw.configs === 'object' ? raw.configs : {},
      default: typeof raw.default === 'string' && getProviderProfile(raw.default) ? raw.default : 'zai',
    }
    cacheMtime = stat.mtimeMs
    return cache
  } catch {
    return DEFAULT_STORE
  }
}

function saveStore(next: StoreShape): void {
  try {
    if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 })
    writeFileSync(STORE_FILE, JSON.stringify(next, null, 2), { encoding: 'utf-8', mode: 0o600 })
    cache = next
    cacheMtime = statSync(STORE_FILE).mtimeMs
  } catch (err) {
    console.error('[providers] saveStore failed:', err)
  }
}

/** 解析生效 API Key：存储优先，环境变量回退 */
export function resolveApiKey(id: string): string | undefined {
  const profile = getProviderProfile(id)
  if (!profile) return undefined
  const conf = loadStore().configs[id]
  return conf?.apiKey?.trim() || process.env[profile.apiKeyEnv]?.trim() || undefined
}

/** 解析生效 Base URL：存储覆盖优先，目录默认回退 */
export function resolveBaseURL(id: string): string | undefined {
  const profile = getProviderProfile(id)
  if (!profile) return undefined
  const conf = loadStore().configs[id]
  return conf?.baseURL?.trim() || profile.baseURL || undefined
}

/** 解析生效模型：存储覆盖优先，目录默认回退 */
export function resolveModel(id: string): string | undefined {
  const profile = getProviderProfile(id)
  if (!profile) return undefined
  const conf = loadStore().configs[id]
  return conf?.defaultModel?.trim() || profile.defaultModel || undefined
}

/** 当前默认供应商 id（zai 保底） */
export function getDefaultProviderId(): string {
  return loadStore().default
}

export function setDefaultProviderId(id: string): boolean {
  if (!getProviderProfile(id)) return false
  const store = loadStore()
  saveStore({ ...store, default: id })
  return true
}

export function setProviderConfig(id: string, patch: ProviderConfig): boolean {
  if (!getProviderProfile(id)) return false
  const store = loadStore()
  const prev = store.configs[id] ?? {}
  // apiKey 省略 = 保留原值；显式空串 = 清除
  const next: ProviderConfig = {
    ...prev,
    ...patch,
    apiKey: patch.apiKey === undefined ? prev.apiKey : patch.apiKey.trim() || undefined,
    baseURL: (patch.baseURL ?? prev.baseURL)?.trim() || undefined,
    defaultModel: (patch.defaultModel ?? prev.defaultModel)?.trim() || undefined,
  }
  saveStore({ ...store, configs: { ...store.configs, [id]: next } })
  return true
}

export function deleteProviderConfig(id: string): boolean {
  if (id === 'zai') return false // 内置通道不可删
  const store = loadStore()
  if (!(id in store.configs)) return true
  const configs = { ...store.configs }
  delete configs[id]
  saveStore({ configs, default: store.default === id ? 'zai' : store.default })
  return true
}

// ———— 供应商状态（供 GET 返回；Key 掩码，永不回明文） ————

export interface ProviderStatus extends ProviderProfile {
  hasApiKey: boolean
  hasBaseURLOverride: boolean
  effectiveModel: string
  isDefault: boolean
  maskedKey: string | null
  envKeySource: boolean
}

export function listProviderStatus(): ProviderStatus[] {
  const store = loadStore()
  return PROVIDER_CATALOG.map(p => {
    const conf = store.configs[p.id]
    const envKey = !conf?.apiKey && !!process.env[p.apiKeyEnv]?.trim()
    const key = conf?.apiKey?.trim() || process.env[p.apiKeyEnv]?.trim() || ''
    return {
      ...p,
      hasApiKey: p.id === 'zai' || !!key,
      hasBaseURLOverride: !!(conf?.baseURL?.trim() && conf.baseURL.trim() !== p.baseURL),
      effectiveModel: conf?.defaultModel?.trim() || p.defaultModel,
      isDefault: store.default === p.id,
      maskedKey: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : null,
      envKeySource: envKey,
    }
  })
}

// ———— OpenAI 兼容直连（对话补全；SSE 流式与整段两种形态） ————

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 直连补全（非流式）：返回完整文本 */
export async function chatCompletionOnce(
  providerId: string,
  messages: ChatMessage[],
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<string> {
  const { baseURL, apiKey, headers, model } = prepareRequest(providerId)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)
  try {
    const res = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, stream: false, temperature: 0.3 }),
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`${providerId} HTTP ${res.status}：${body.slice(0, 300)}`)
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/** 直连补全（SSE 流式）：onDelta 收增量，返回完整文本；controller.abort() 中断 */
export async function chatCompletionStream(
  providerId: string,
  messages: ChatMessage[],
  opts: { onDelta?: (piece: string) => void; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const { baseURL, apiKey, headers, model } = prepareRequest(providerId)
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.3 }),
    signal: opts.signal,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`${providerId} HTTP ${res.status}：${body.slice(0, 300)}`)
  }
  if (!res.body) throw new Error(`${providerId} 无响应体`)
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const events = buf.split('\n\n')
    buf = events.pop() ?? ''
    for (const ev of events) {
      for (const line of ev.split('\n')) {
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const j = JSON.parse(payload) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] }
          const piece = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? ''
          if (piece) { full += piece; opts.onDelta?.(piece) }
        } catch { /* 不可解析分片跳过 */ }
      }
    }
  }
  return full
}

/** 组装认证请求头 + 校验配置完备 */
function prepareRequest(providerId: string): { baseURL: string; apiKey: string; headers: Record<string, string>; model: string } {
  const profile = getProviderProfile(providerId)
  if (!profile) throw new Error(`未知供应商：${providerId}`)
  const baseURL = resolveBaseURL(providerId)
  if (!baseURL) throw new Error(`供应商 ${profile.displayName} 未配置 Base URL`)
  const apiKey = resolveApiKey(providerId)
  if (!apiKey) throw new Error(`供应商 ${profile.displayName} 未配置 API Key（设置页或环境变量 ${profile.apiKeyEnv}）`)
  const model = resolveModel(providerId)
  if (!model) throw new Error(`供应商 ${profile.displayName} 未配置模型`)
  const headers: Record<string, string> = {
    [profile.authHeader ?? 'Authorization']: `${profile.authPrefix ?? 'Bearer '}${apiKey}`,
    ...(profile.extraHeaders ?? {}),
  }
  return { baseURL: baseURL.replace(/\/$/, ''), apiKey, headers, model }
}
