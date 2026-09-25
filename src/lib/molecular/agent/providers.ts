// AI 供应商目录 + 凭据存储 + OpenAI 兼容直连适配（服务端专用，零客户端依赖）
// 架构：
// - 'zai' = 内置 z-ai-web-dev-sdk（免配置，始终可用）
// - 其余 = OpenAI 兼容 /chat/completions 直连 fetch（含 Anthropic 特殊 auth 头）
// - 凭据落盘 .molvision/agent-providers.json（0600），API Key 永不回传前端明文
// - 目录按 category 分组（builtin/global/cn/aggregator/local/custom），每家带品牌色与官网
// - discoveredModels：输入 Key 后经 /models 探测到的真实可用模型（存 config，前端合并展示）

import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cookies, headers } from 'next/headers'
import { LOCALE_COOKIE, type DualText, type Locale } from '@/i18n/locales'

/** 请求级语言检测（与 api 路由同规则）：cookie > Accept-Language —— 仅在请求上下文内有效
 *  （本模块只被 API 路由 import）；无请求上下文（工具脚本）时回退 zh */
async function reqLocale(): Promise<Locale> {
  try {
    const stored = (await cookies()).get(LOCALE_COOKIE)?.value
    if (stored === 'en' || stored === 'zh') return stored
    const accept = (await headers()).get('accept-language')?.toLowerCase() ?? ''
    return accept.startsWith('en') ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

/** 服务端双语文案选择（错误消息等） */
function bt(locale: Locale, zh: string, en: string): string {
  return locale === 'en' ? en : zh
}

export type ProviderCategory = 'builtin' | 'global' | 'cn' | 'aggregator' | 'local' | 'custom'

export interface ProviderModel {
  id: string
  name: string
  /** 上下文窗口（token 数，仅展示用） */
  contextWindow?: number
}

export interface ProviderProfile {
  id: string
  displayName: string
  /** 英文界面显示名（缺省回落 displayName） */
  displayNameEn?: string
  /** 1-2 字符短标签（UI 徽章用） */
  label: string
  /** 分类：builtin 内置 | global 国际 | cn 国内 | aggregator 聚合 | local 本地 | custom 自定义 */
  category: ProviderCategory
  /** 品牌主色（hex，前端 monogram 用） */
  brand: string
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
  /** 官网（设置页品牌链接） */
  website: string
  /** 额外说明（设置页展示，双语；服务端仅透传对象，展示语言由客户端决定） */
  note?: DualText
}

export const CATEGORY_META: Record<ProviderCategory, { name: DualText; hint: DualText }> = {
  builtin: { name: { zh: '内置', en: 'Built-in' }, hint: { zh: '沙箱自带，免配置', en: 'Bundled with the sandbox, zero config' } },
  global: { name: { zh: '国际平台', en: 'Global platforms' }, hint: { zh: 'OpenAI / Anthropic / Google 等', en: 'OpenAI / Anthropic / Google, etc.' } },
  cn: { name: { zh: '国内平台', en: 'CN platforms' }, hint: { zh: 'DeepSeek / 通义 / Kimi 等', en: 'DeepSeek / Qwen / Kimi, etc.' } },
  aggregator: { name: { zh: '聚合网关', en: 'Aggregators' }, hint: { zh: '一个 Key 通达多家模型', en: 'One key reaches many providers' } },
  local: { name: { zh: '本地推理', en: 'Local inference' }, hint: { zh: 'Ollama / LM Studio 等', en: 'Ollama / LM Studio, etc.' } },
  custom: { name: { zh: '自定义端点', en: 'Custom endpoints' }, hint: { zh: '任意 OpenAI 兼容网关', en: 'Any OpenAI-compatible gateway' } },
}

export const PROVIDER_CATALOG: ProviderProfile[] = [
  // ———— 内置 ————
  {
    id: 'zai',
    displayName: 'Z.ai GLM',
    label: 'GLM',
    category: 'builtin',
    brand: '#0e9f6e',
    baseURL: '',
    apiKeyEnv: 'ZAI_API_KEY',
    defaultModel: 'glm-4.6',
    models: [
      { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 128000 },
      { id: 'glm-4.5', name: 'GLM-4.5', contextWindow: 128000 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000 },
    ],
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    website: 'https://z.ai',
    note: { zh: '沙箱内置 SDK 直连，无需 API Key；视觉自查始终走此通道', en: 'Built-in sandbox SDK direct connection — no API Key needed; visual self-review always goes through this channel' },
  },
  // ———— 国际平台 ————
  {
    id: 'openai',
    displayName: 'OpenAI',
    label: 'OA',
    category: 'global',
    brand: '#0d8069',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1047576 },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', contextWindow: 1047576 },
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000 },
      { id: 'o4-mini', name: 'o4-mini', contextWindow: 200000 },
    ],
    docsUrl: 'https://platform.openai.com/api-keys',
    website: 'https://openai.com',
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic Claude',
    label: 'CL',
    category: 'global',
    brand: '#c2603d',
    baseURL: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    authHeader: 'x-api-key',
    authPrefix: '',
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    defaultModel: 'claude-sonnet-4-5-20250929',
    models: [
      { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5', contextWindow: 200000 },
      { id: 'claude-opus-4-1-20250805', name: 'Claude Opus 4.1', contextWindow: 200000 },
      { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', contextWindow: 200000 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000 },
    ],
    docsUrl: 'https://console.anthropic.com/settings/keys',
    website: 'https://anthropic.com',
    note: { zh: '原生 /v1/models 列表可自动检测；走 OpenAI 兼容 /chat/completions', en: 'Native /v1/models list can be auto-detected; chat goes through the OpenAI-compatible /chat/completions' },
  },
  {
    id: 'google',
    displayName: 'Google Gemini',
    label: 'GM',
    category: 'global',
    brand: '#3b7ddd',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GOOGLE_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1048576 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1048576 },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1048576 },
    ],
    docsUrl: 'https://aistudio.google.com/apikey',
    website: 'https://ai.google.dev',
    note: { zh: 'AI Studio 免费额度可观，Flash 系列适合高频调用', en: 'AI Studio free tier is generous; the Flash series suits high-frequency calls' },
  },
  {
    id: 'xai',
    displayName: 'xAI Grok',
    label: 'X',
    category: 'global',
    brand: '#2f2f33',
    baseURL: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
    defaultModel: 'grok-4',
    models: [
      { id: 'grok-4', name: 'Grok 4', contextWindow: 256000 },
      { id: 'grok-3', name: 'Grok 3', contextWindow: 131072 },
      { id: 'grok-3-mini', name: 'Grok 3 mini', contextWindow: 131072 },
    ],
    docsUrl: 'https://console.x.ai',
    website: 'https://x.ai',
  },
  {
    id: 'mistral',
    displayName: 'Mistral AI',
    label: 'MI',
    category: 'global',
    brand: '#e8650c',
    baseURL: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', contextWindow: 131072 },
      { id: 'mistral-small-latest', name: 'Mistral Small', contextWindow: 131072 },
      { id: 'codestral-latest', name: 'Codestral', contextWindow: 262144 },
      { id: 'magistral-medium-latest', name: 'Magistral（推理）', contextWindow: 40000 },
    ],
    docsUrl: 'https://console.mistral.ai/api-keys',
    website: 'https://mistral.ai',
  },
  {
    id: 'groq',
    displayName: 'Groq',
    label: 'GQ',
    category: 'global',
    brand: '#e5482b',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextWindow: 131072 },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B（即时）', contextWindow: 131072 },
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', contextWindow: 131072 },
      { id: 'qwen/qwen3-32b', name: 'Qwen3 32B', contextWindow: 131072 },
    ],
    docsUrl: 'https://console.groq.com/keys',
    website: 'https://groq.com',
    note: { zh: 'LPU 推理芯片——生成速度业界第一梯队，免费额度慷慨', en: 'LPU inference chips — top-tier generation speed with a generous free tier' },
  },
  {
    id: 'cohere',
    displayName: 'Cohere',
    label: 'CO',
    category: 'global',
    brand: '#34564e',
    baseURL: 'https://api.cohere.ai/compatibility/v1',
    apiKeyEnv: 'COHERE_API_KEY',
    defaultModel: 'command-a-03-2025',
    models: [
      { id: 'command-a-03-2025', name: 'Command A', contextWindow: 256000 },
      { id: 'command-r-plus-08-2024', name: 'Command R+', contextWindow: 128000 },
      { id: 'command-r-08-2024', name: 'Command R', contextWindow: 128000 },
    ],
    docsUrl: 'https://dashboard.cohere.com/api-keys',
    website: 'https://cohere.com',
    note: { zh: 'OpenAI 兼容层（/compatibility/v1）', en: 'OpenAI compatibility layer (/compatibility/v1)' },
  },
  {
    id: 'perplexity',
    displayName: 'Perplexity',
    label: 'PX',
    category: 'global',
    brand: '#1f7a86',
    baseURL: 'https://api.perplexity.ai',
    apiKeyEnv: 'PERPLEXITY_API_KEY',
    defaultModel: 'sonar',
    models: [
      { id: 'sonar', name: 'Sonar', contextWindow: 127072 },
      { id: 'sonar-pro', name: 'Sonar Pro', contextWindow: 200000 },
      { id: 'sonar-reasoning-pro', name: 'Sonar Reasoning Pro', contextWindow: 127072 },
      { id: 'sonar-deep-research', name: 'Sonar Deep Research', contextWindow: 127072 },
    ],
    docsUrl: 'https://www.perplexity.ai/settings/api',
    website: 'https://perplexity.ai',
    note: { zh: '带联网检索的在线模型', en: 'Online models with built-in web search' },
  },
  {
    id: 'together',
    displayName: 'Together AI',
    label: 'TG',
    category: 'global',
    brand: '#2456d6',
    baseURL: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B Turbo', contextWindow: 131072 },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 131072 },
      { id: 'Qwen/Qwen2.5-72B-Instruct-Turbo', name: 'Qwen2.5 72B Turbo', contextWindow: 32768 },
    ],
    docsUrl: 'https://api.together.ai/settings/api-keys',
    website: 'https://together.ai',
  },
  {
    id: 'fireworks',
    displayName: 'Fireworks AI',
    label: 'FW',
    category: 'global',
    brand: '#d9550c',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    defaultModel: 'accounts/fireworks/models/deepseek-v3',
    models: [
      { id: 'accounts/fireworks/models/deepseek-v3', name: 'DeepSeek V3', contextWindow: 131072 },
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B', contextWindow: 131072 },
      { id: 'accounts/fireworks/models/kimi-k2-instruct', name: 'Kimi K2', contextWindow: 131072 },
    ],
    docsUrl: 'https://fireworks.ai/account/api-keys',
    website: 'https://fireworks.ai',
  },
  {
    id: 'deepinfra',
    displayName: 'DeepInfra',
    label: 'DI',
    category: 'global',
    brand: '#4f5ec9',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    apiKeyEnv: 'DEEPINFRA_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-V3-0324',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3-0324', name: 'DeepSeek V3', contextWindow: 163840 },
      { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextWindow: 131072 },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B', contextWindow: 32768 },
    ],
    docsUrl: 'https://deepinfra.com/dashboard/tokens',
    website: 'https://deepinfra.com',
  },
  {
    id: 'cerebras',
    displayName: 'Cerebras',
    label: 'CB',
    category: 'global',
    brand: '#e05c2e',
    baseURL: 'https://api.cerebras.ai/v1',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    defaultModel: 'llama-3.3-70b',
    models: [
      { id: 'llama-3.3-70b', name: 'Llama 3.3 70B', contextWindow: 128000 },
      { id: 'llama3.1-8b', name: 'Llama 3.1 8B', contextWindow: 128000 },
      { id: 'qwen-3-235b-a22b-instruct', name: 'Qwen3 235B A22B', contextWindow: 131072 },
    ],
    docsUrl: 'https://cloud.cerebras.ai',
    website: 'https://cerebras.ai',
    note: { zh: '晶圆级引擎（WSE）推理，tokens/s 极高', en: 'Wafer-scale engine (WSE) inference with very high tokens/s' },
  },
  {
    id: 'nvidia',
    displayName: 'NVIDIA NIM',
    label: 'NV',
    category: 'global',
    brand: '#5f8f1f',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    apiKeyEnv: 'NVIDIA_API_KEY',
    defaultModel: 'deepseek-ai/deepseek-r1',
    models: [
      { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1', contextWindow: 163840 },
      { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextWindow: 131072 },
      { id: 'qwen/qwen2.5-coder-32b-instruct', name: 'Qwen2.5 Coder 32B', contextWindow: 32768 },
    ],
    docsUrl: 'https://build.nvidia.com',
    website: 'https://build.nvidia.com',
    note: { zh: 'build.nvidia.com 每模型每小时有免费额度', en: 'build.nvidia.com offers a free per-model hourly quota' },
  },
  {
    id: 'githubmodels',
    displayName: 'GitHub Models',
    label: 'GH',
    category: 'global',
    brand: '#3a3f46',
    baseURL: 'https://models.github.ai/inference',
    apiKeyEnv: 'GITHUB_TOKEN',
    defaultModel: 'openai/gpt-4o-mini',
    models: [
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000 },
      { id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'meta/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextWindow: 128000 },
      { id: 'deepseek/DeepSeek-V3-0324', name: 'DeepSeek V3', contextWindow: 128000 },
    ],
    docsUrl: 'https://github.com/marketplace/models',
    website: 'https://github.com/marketplace/models',
    note: { zh: 'API Key 填 GitHub PAT（fine-grained，无需任何权限勾选）', en: 'Use a GitHub PAT as the API Key (fine-grained, no permission scopes needed)' },
  },
  // ———— 国内平台 ————
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    label: 'DS',
    category: 'cn',
    brand: '#4a6bf0',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek V3（Chat）', contextWindow: 64000 },
      { id: 'deepseek-reasoner', name: 'DeepSeek R1（Reasoner）', contextWindow: 64000 },
    ],
    docsUrl: 'https://platform.deepseek.com/api_keys',
    website: 'https://deepseek.com',
    note: { zh: '国内性价比标杆，结构生物学知识扎实', en: 'Best value among CN providers; solid structural-biology knowledge' },
  },
  {
    id: 'qwen',
    displayName: '通义千问 Qwen', displayNameEn: 'Qwen (Alibaba Tongyi)',
    label: 'QW',
    category: 'cn',
    brand: '#6b4fd8',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
    models: [
      { id: 'qwen3-max', name: 'Qwen3 Max', contextWindow: 262144 },
      { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072 },
      { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 1000000 },
      { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768 },
    ],
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
    website: 'https://tongyi.aliyun.com',
  },
  {
    id: 'moonshot',
    displayName: '月之暗面 Kimi', displayNameEn: 'Moonshot Kimi',
    label: 'KI',
    category: 'cn',
    brand: '#0e9c8f',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    defaultModel: 'kimi-k2-0905-preview',
    models: [
      { id: 'kimi-k2-0905-preview', name: 'Kimi K2', contextWindow: 131072 },
      { id: 'kimi-k2-turbo-preview', name: 'Kimi K2 Turbo', contextWindow: 131072 },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1（128k）', contextWindow: 128000 },
    ],
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
    website: 'https://platform.moonshot.cn',
  },
  {
    id: 'zhipu',
    displayName: '智谱 GLM', displayNameEn: 'Zhipu GLM',
    label: 'ZP',
    category: 'cn',
    brand: '#2f56d9',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    defaultModel: 'glm-4.5',
    models: [
      { id: 'glm-4.5', name: 'GLM-4.5', contextWindow: 128000 },
      { id: 'glm-4.5-air', name: 'GLM-4.5 Air', contextWindow: 128000 },
      { id: 'glm-4-plus', name: 'GLM-4 Plus', contextWindow: 128000 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash（免费）', contextWindow: 128000 },
    ],
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    website: 'https://bigmodel.cn',
  },
  {
    id: 'doubao',
    displayName: '火山方舟 豆包', displayNameEn: 'Volcano Ark Doubao',
    label: 'DB',
    category: 'cn',
    brand: '#1f6ff0',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnv: 'ARK_API_KEY',
    defaultModel: 'doubao-seed-1-6-250615',
    models: [
      { id: 'doubao-seed-1-6-250615', name: 'Doubao Seed 1.6', contextWindow: 256000 },
      { id: 'doubao-1-5-pro-32k-250115', name: 'Doubao 1.5 Pro', contextWindow: 32000 },
      { id: 'doubao-1-5-lite-32k-250115', name: 'Doubao 1.5 Lite', contextWindow: 32000 },
    ],
    docsUrl: 'https://console.volcengine.com/ark',
    website: 'https://www.volcengine.com/product/doubao',
    note: { zh: '字节系；新用户每模型有免费额度', en: 'ByteDance; free per-model quota for new users' },
  },
  {
    id: 'minimax',
    displayName: 'MiniMax',
    label: 'MX',
    category: 'cn',
    brand: '#e0425f',
    baseURL: 'https://api.minimaxi.com/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
    defaultModel: 'MiniMax-M1',
    models: [
      { id: 'MiniMax-M1', name: 'MiniMax M1', contextWindow: 1000000 },
      { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', contextWindow: 1000000 },
      { id: 'abab6.5s-chat', name: 'abab 6.5s', contextWindow: 245760 },
    ],
    docsUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
    website: 'https://www.minimaxi.com',
  },
  {
    id: 'hunyuan',
    displayName: '腾讯混元', displayNameEn: 'Tencent Hunyuan',
    label: 'HY',
    category: 'cn',
    brand: '#1a52c4',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    apiKeyEnv: 'HUNYUAN_API_KEY',
    defaultModel: 'hunyuan-turbos-latest',
    models: [
      { id: 'hunyuan-turbos-latest', name: 'Hunyuan Turbos', contextWindow: 28000 },
      { id: 'hunyuan-t1-latest', name: 'Hunyuan T1（推理）', contextWindow: 28000 },
      { id: 'hunyuan-standard', name: 'Hunyuan Standard', contextWindow: 28000 },
    ],
    docsUrl: 'https://console.cloud.tencent.com/hunyuan/api-key',
    website: 'https://cloud.tencent.com/product/hunyuan',
  },
  {
    id: 'baichuan',
    displayName: '百川智能', displayNameEn: 'Baichuan',
    label: 'BC',
    category: 'cn',
    brand: '#e5623a',
    baseURL: 'https://api.baichuan-ai.com/v1',
    apiKeyEnv: 'BAICHUAN_API_KEY',
    defaultModel: 'Baichuan4-Turbo',
    models: [
      { id: 'Baichuan4-Turbo', name: 'Baichuan4 Turbo', contextWindow: 32768 },
      { id: 'Baichuan4', name: 'Baichuan4', contextWindow: 32768 },
      { id: 'Baichuan4-Air', name: 'Baichuan4 Air', contextWindow: 32768 },
    ],
    docsUrl: 'https://platform.baichuan-ai.com/console/apikey',
    website: 'https://www.baichuan-ai.com',
  },
  {
    id: 'stepfun',
    displayName: '阶跃星辰', displayNameEn: 'StepFun',
    label: 'SF',
    category: 'cn',
    brand: '#dd4a41',
    baseURL: 'https://api.stepfun.com/v1',
    apiKeyEnv: 'STEPFUN_API_KEY',
    defaultModel: 'step-2-16k',
    models: [
      { id: 'step-2-16k', name: 'Step-2 16k', contextWindow: 16384 },
      { id: 'step-2-mini', name: 'Step-2 Mini', contextWindow: 8192 },
      { id: 'step-1v-8k', name: 'Step-1V（视觉）', contextWindow: 8192 },
    ],
    docsUrl: 'https://platform.stepfun.com/interface-key',
    website: 'https://www.stepfun.com',
  },
  {
    id: 'lingyi',
    displayName: '零一万物 Yi', displayNameEn: '01.AI Yi',
    label: 'YI',
    category: 'cn',
    brand: '#2c3138',
    baseURL: 'https://api.lingyiwanwu.com/v1',
    apiKeyEnv: 'LINGYI_API_KEY',
    defaultModel: 'yi-lightning',
    models: [
      { id: 'yi-lightning', name: 'Yi Lightning', contextWindow: 16384 },
      { id: 'yi-large', name: 'Yi Large', contextWindow: 32768 },
      { id: 'yi-medium', name: 'Yi Medium', contextWindow: 16384 },
    ],
    docsUrl: 'https://platform.lingyiwanwu.com/apikeys',
    website: 'https://www.lingyiwanwu.com',
  },
  {
    id: 'baidu',
    displayName: '百度千帆', displayNameEn: 'Baidu Qianfan',
    label: 'QF',
    category: 'cn',
    brand: '#2736c4',
    baseURL: 'https://qianfan.baidubce.com/v2',
    apiKeyEnv: 'QIANFAN_API_KEY',
    defaultModel: 'ernie-4.5-turbo-128k',
    models: [
      { id: 'ernie-4.5-turbo-128k', name: 'ERNIE 4.5 Turbo', contextWindow: 128000 },
      { id: 'ernie-4.0-8k-latest', name: 'ERNIE 4.0', contextWindow: 8000 },
      { id: 'deepseek-v3', name: 'DeepSeek V3（千帆托管）', contextWindow: 64000 },
    ],
    docsUrl: 'https://console.bce.baidu.com/iam/#/iam/apikey/list',
    website: 'https://cloud.baidu.com/product/wentinxingchen',
  },
  {
    id: 'spark',
    displayName: '讯飞星火', displayNameEn: 'iFlytek Spark',
    label: 'SP',
    category: 'cn',
    brand: '#1266d8',
    baseURL: 'https://spark-api-open.xf-yun.com/v1',
    apiKeyEnv: 'SPARK_API_KEY',
    defaultModel: '4.0Ultra',
    models: [
      { id: '4.0Ultra', name: '星火 4.0 Ultra', contextWindow: 8000 },
      { id: 'generalv3.5', name: '星火 V3.5', contextWindow: 8000 },
      { id: 'generalv3', name: '星火 V3', contextWindow: 8000 },
    ],
    docsUrl: 'https://console.xfyun.cn/services/bm4',
    website: 'https://xinghuo.xfyun.cn',
  },
  {
    id: 'modelscope',
    displayName: '魔搭 ModelScope', displayNameEn: 'ModelScope',
    label: 'MS',
    category: 'cn',
    brand: '#6d4ae0',
    baseURL: 'https://api-inference.modelscope.cn/v1',
    apiKeyEnv: 'MODELSCOPE_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 64000 },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B', contextWindow: 32768 },
      { id: 'ZhipuAI/glm-4-9b-chat', name: 'GLM-4 9B（免费）', contextWindow: 128000 },
    ],
    docsUrl: 'https://modelscope.cn/my/myaccesstoken',
    website: 'https://modelscope.cn',
    note: { zh: '阿里达摩院开源社区，多数开源模型免费推理额度', en: 'Alibaba DAMO open-source community; free inference quota for most open models' },
  },
  {
    id: 'gitee',
    displayName: 'Gitee AI',
    label: 'GT',
    category: 'cn',
    brand: '#c3272b',
    baseURL: 'https://ai.gitee.com/v1',
    apiKeyEnv: 'GITEE_API_KEY',
    defaultModel: 'DeepSeek-R1-Distill-Qwen-32B',
    models: [
      { id: 'DeepSeek-R1-Distill-Qwen-32B', name: 'DeepSeek R1 蒸馏 32B', contextWindow: 32768 },
      { id: 'Qwen2.5-72B-Instruct', name: 'Qwen2.5 72B', contextWindow: 32768 },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 64000 },
    ],
    docsUrl: 'https://ai.gitee.com/dashboard/settings/tokens',
    website: 'https://ai.gitee.com',
    note: { zh: '开源中国出品，大量模型免费调用', en: 'By OSChina; many models free to call' },
  },
  // ———— 聚合网关 ————
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    label: 'OR',
    category: 'aggregator',
    brand: '#6165d8',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'deepseek/deepseek-chat',
    models: [
      { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', contextWindow: 1000000 },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000 },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', contextWindow: 64000 },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1048576 },
      { id: 'qwen/qwen3-coder', name: 'Qwen3 Coder', contextWindow: 262144 },
    ],
    docsUrl: 'https://openrouter.ai/keys',
    website: 'https://openrouter.ai',
    note: { zh: '一个 Key 聚合全主流模型（含免费款 :free）', en: 'One key aggregates all mainstream models (including :free variants)' },
  },
  {
    id: 'siliconflow',
    displayName: '硅基流动 SiliconFlow', displayNameEn: 'SiliconFlow',
    label: 'SI',
    category: 'aggregator',
    brand: '#2749d0',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 64000 },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', contextWindow: 64000 },
      { id: 'Qwen/Qwen3-235B-A22B-Instruct', name: 'Qwen3 235B A22B', contextWindow: 32768 },
      { id: 'THUDM/GLM-4-9B-0414-Chat', name: 'GLM-4 9B（免费）', contextWindow: 128000 },
    ],
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
    website: 'https://siliconflow.cn',
    note: { zh: '聚合国内主流开源模型，注册送额度', en: 'Aggregates mainstream CN open-source models; signup bonus credits' },
  },
  // ———— 本地推理 ————
  {
    id: 'ollama',
    displayName: 'Ollama（本地）', displayNameEn: 'Ollama (local)',
    label: 'OL',
    category: 'local',
    brand: '#2b2b2e',
    baseURL: 'http://localhost:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    defaultModel: '',
    models: [],
    docsUrl: 'https://ollama.com',
    website: 'https://ollama.com',
    note: { zh: '本机运行 Ollama 后可用；API Key 随意填（如 ollama）。模型列表自动检测', en: 'Available once Ollama runs locally; fill in any API Key (e.g. ollama). Model list auto-detected' },
  },
  {
    id: 'lmstudio',
    displayName: 'LM Studio（本地）', displayNameEn: 'LM Studio (local)',
    label: 'LM',
    category: 'local',
    brand: '#0f6f6b',
    baseURL: 'http://localhost:1234/v1',
    apiKeyEnv: 'LMSTUDIO_API_KEY',
    defaultModel: '',
    models: [],
    docsUrl: 'https://lmstudio.ai',
    website: 'https://lmstudio.ai',
    note: { zh: '本地桌面版；API Key 随意填。模型列表自动检测', en: 'Local desktop app; fill in any API Key. Model list auto-detected' },
  },
  // ———— 自定义 ————
  {
    id: 'custom',
    displayName: '自定义兼容端点', displayNameEn: 'Custom compatible endpoint',
    label: '⌘',
    category: 'custom',
    brand: '#6f6f76',
    baseURL: '',
    apiKeyEnv: 'CUSTOM_LLM_API_KEY',
    defaultModel: '',
    models: [],
    docsUrl: '',
    website: '',
    note: { zh: '任意兼容 /chat/completions 的网关（vLLM / one-api / 内网代理等）', en: 'Any /chat/completions-compatible gateway (vLLM / one-api / intranet proxy, etc.)' },
  },
]

export function getProviderProfile(id: string): ProviderProfile | undefined {
  return PROVIDER_CATALOG.find(p => p.id === id)
}

// ———— 凭据存储（文件落盘 + mtime 失效缓存） ————

/** /models 探测到的模型条目 */
export interface DiscoveredModel {
  id: string
  ownedBy?: string
  contextLength?: number
  kind?: 'chat' | 'embedding' | 'image' | 'audio' | 'video' | 'other'
}

export interface ProviderConfig {
  apiKey?: string
  baseURL?: string
  defaultModel?: string
  /** 最近一次 /models 探测结果（前端合并目录展示） */
  discoveredModels?: DiscoveredModel[]
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
    // 已存在的旧文件权限可能过宽（mode 仅首次创建生效）——每写前强制收欀 600
    try { if (existsSync(STORE_FILE)) chmodSync(STORE_FILE, 0o600) } catch { /* 最佳努力 */ }
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
    discoveredModels: patch.discoveredModels === undefined ? prev.discoveredModels : patch.discoveredModels,
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

export interface AvailableModel {
  id: string
  name: string
  contextWindow?: number
  ownedBy?: string
  kind?: string
  /** 来源：catalog 目录静态 | probe /models 探测 */
  source: 'catalog' | 'probe'
}

export interface ProviderStatus extends ProviderProfile {
  hasApiKey: boolean
  hasBaseURLOverride: boolean
  effectiveModel: string
  isDefault: boolean
  maskedKey: string | null
  envKeySource: boolean
  /** 目录模型 + 探测模型（去重合并，探测优先） */
  availableModels: AvailableModel[]
}

/** 目录 + 探测合并（同 id 探测版优先，保留目录命名） */
function mergeAvailableModels(profile: ProviderProfile, discovered?: DiscoveredModel[]): AvailableModel[] {
  const out: AvailableModel[] = profile.models.map(m => ({
    id: m.id, name: m.name, contextWindow: m.contextWindow, source: 'catalog',
  }))
  if (!discovered?.length) return out
  const seen = new Set(out.map(m => m.id))
  for (const d of discovered) {
    if (!d.id) continue
    if (seen.has(d.id)) continue
    seen.add(d.id)
    out.push({
      id: d.id,
      name: d.id,
      contextWindow: d.contextLength,
      ownedBy: d.ownedBy,
      kind: d.kind,
      source: 'probe',
    })
  }
  return out
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
      availableModels: mergeAvailableModels(p, conf?.discoveredModels),
    }
  })
}

// ———— /models 探测规范化（供 API 路由使用） ————

/** 按模型 id 粗分用途（前端默认只显示 chat 类） */
export function classifyModelKind(id: string): DiscoveredModel['kind'] {
  const s = id.toLowerCase()
  if (/embed|bge-|gte-|jina-|rerank|retriev|conan|text-embedding/.test(s)) return 'embedding'
  if (/dall-e|image|flux|sdxl|stable-diff|cogview|wanx|seedream|ideogram|recraft/.test(s)) return 'image'
  if (/tts|whisper|audio|speech|cosyvoice|f5-tts|voice|speech/.test(s)) return 'audio'
  if (/video|cogvideo|wan2|vidu|kling|seaweed|hailuo|ltx|animatediff/.test(s)) return 'video'
  if (/moderation|guard|shield|safety/.test(s)) return 'other'
  return 'chat'
}

/** 解析各家 /models 响应 → 统一 DiscoveredModel[]（chat 优先、字母序） */
export function normalizeModelsResponse(raw: unknown): DiscoveredModel[] {
  const out: DiscoveredModel[] = []
  const push = (id: unknown, ownedBy?: unknown, ctx?: unknown) => {
    if (typeof id !== 'string' || !id.trim()) return
    const contextLength = typeof ctx === 'number' && ctx > 0 ? ctx : undefined
    out.push({
      id: id.trim(),
      ownedBy: typeof ownedBy === 'string' && ownedBy ? ownedBy : undefined,
      contextLength,
      kind: classifyModelKind(id),
    })
  }
  // 形态 1（OpenAI 标准）：{ object:"list", data:[{ id, owned_by, context_length? }] }
  // 形态 2（Anthropic）：{ data:[{ type:"model", id, display_name }] }
  // 形态 3（Ollama tags）：{ models:[{ name }] }
  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const arr = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : Array.isArray(raw) ? raw : null
    if (arr) {
      for (const item of arr) {
        if (typeof item === 'string') { push(item); continue }
        if (item && typeof item === 'object') {
          const m = item as Record<string, unknown>
          push(m.id ?? m.name ?? m.model, m.owned_by ?? m.ownedBy ?? m.owner, m.context_length ?? m.max_model_len ?? m.max_tokens ?? m.contextWindow)
        }
      }
    }
  }
  // 去重
  const seen = new Set<string>()
  const uniq = out.filter(m => (seen.has(m.id) ? false : (seen.add(m.id), true)))
  // chat 优先，其次字母序
  const order: Record<string, number> = { chat: 0, embedding: 1, image: 2, audio: 3, video: 4, other: 5 }
  return uniq.sort((a, b) => (order[a.kind ?? 'chat'] - order[b.kind ?? 'chat']) || a.id.localeCompare(b.id))
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
  const { baseURL, apiKey, headers, model, locale } = await prepareRequest(providerId)
  const controller = new AbortController()
  // 超时中止带 TimeoutError reason（controller.abort(reason)）：与外部 signal 的 AbortError
  // （客户端取消）区分——调用方对前者可重试、对后者应立即放弃
  const timer = setTimeout(() => controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), opts.timeoutMs ?? 60_000)
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
      throw new Error(bt(locale, `${providerId} HTTP ${res.status}：${body.slice(0, 300)}`, `${providerId} HTTP ${res.status}: ${body.slice(0, 300)}`))
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return data.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

/** 直连补全（SSE 流式）：onDelta 收增量，返回完整文本；signal 中止（客户端取消 / 超时兜底） */
export async function chatCompletionStream(
  providerId: string,
  messages: ChatMessage[],
  opts: { onDelta?: (piece: string) => void; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const { baseURL, apiKey, headers, model, locale } = await prepareRequest(providerId)
  // 上游 fetch 兜底超时：外部 signal（客户端取消传播）与 60s 超时合并——任一触发即中止连接，
  // 上游挂起时不再占着连接等自然结束（与非流式 chatCompletionOnce 的 60s 兜底对齐；
  // Node 20+ 的 AbortSignal.any 直接可用——超时帧经 any 合并后 fetch 以 TimeoutError 拒绝，
  // 与客户端取消的 AbortError 可区分：前者按上游瞬时故障重试，后者视为主动取消不重试）
  const timeoutSignal = AbortSignal.timeout(opts.timeoutMs ?? 60_000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ model, messages, stream: true, temperature: 0.3 }),
    signal,
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(bt(locale, `${providerId} HTTP ${res.status}：${body.slice(0, 300)}`, `${providerId} HTTP ${res.status}: ${body.slice(0, 300)}`))
  }
  if (!res.body) throw new Error(bt(locale, `${providerId} 无响应体`, `${providerId} returned no response body`))
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  try {
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
  } catch (e) {
    // 中止/网络错误路径：主动取消上游 reader，尽快释放连接（多数场景 fetch signal 已代劳）
    try { await reader.cancel() } catch { /* 已关闭 */ }
    throw e
  }
  return full
}

/** 组装认证请求头 + 校验配置完备（async：错误文案需请求级 locale） */
async function prepareRequest(providerId: string): Promise<{ baseURL: string; apiKey: string; headers: Record<string, string>; model: string; locale: Locale }> {
  const locale = await reqLocale()
  const profile = getProviderProfile(providerId)
  if (!profile) throw new Error(bt(locale, `未知供应商：${providerId}`, `Unknown provider: ${providerId}`))
  const baseURL = resolveBaseURL(providerId)
  if (!baseURL) throw new Error(bt(locale, `供应商 ${profile.displayName} 未配置 Base URL`, `Provider ${profile.displayNameEn ?? profile.displayName} has no Base URL configured`))
  const apiKey = resolveApiKey(providerId)
  if (!apiKey) throw new Error(bt(locale, `供应商 ${profile.displayName} 未配置 API Key（设置页或环境变量 ${profile.apiKeyEnv}）`, `Provider ${profile.displayNameEn ?? profile.displayName} has no API Key configured (settings page or env var ${profile.apiKeyEnv})`))
  const model = resolveModel(providerId)
  if (!model) throw new Error(bt(locale, `供应商 ${profile.displayName} 未配置模型`, `Provider ${profile.displayNameEn ?? profile.displayName} has no model configured`))
  const headers: Record<string, string> = {
    [profile.authHeader ?? 'Authorization']: `${profile.authPrefix ?? 'Bearer '}${apiKey}`,
    ...(profile.extraHeaders ?? {}),
  }
  return { baseURL: baseURL.replace(/\/$/, ''), apiKey, headers, model, locale }
}
