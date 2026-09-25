// AI 助手协议：前端 ⇄ 后端 LLM ⇄ 命令执行器的消息类型
// 设计原则：LLM 只产出「自然语言回复 + 可执行命令数组」，命令经白名单校验后
// 复用既有 runCommand 执行（与命令行/命令面板完全同一条代码路径，行为一致可审计）。

/** 一轮对话中的单条命令执行记录（前端展示与审计） */
export interface AgentCmdRecord {
  cmd: string
  /** pending=待执行 running=执行中 ok=完成 confirm=等待用户确认 rejected=用户拒绝 error=命令报错 blocked=白名单拒绝 */
  status: 'pending' | 'running' | 'ok' | 'error' | 'confirm' | 'rejected' | 'blocked'
  /** 执行后从控制台捕获的输出摘要（out/err，截断展示） */
  output?: string
}

/** 聊天消息（持久化到 localStorage，上限 AGENT_CHAT_MAX） */
export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  time: string
  /** assistant 消息携带的命令记录（用户消息为空） */
  commands?: AgentCmdRecord[]
  /** visual = 视觉自查消息（VLM 看截图后的评估/修正） */
  kind?: 'chat' | 'visual'
  /** 视觉自查消息附带的视口截图缩略图（JPEG data URL，≤320px 宽；持久化前剥离——体积） */
  image?: string
  /** 流式生成中（打字机光标显示；持久化前剥离——中断重载不再是流式态） */
  streaming?: boolean
}

/** 后端 LLM 返回的决策（严格 JSON） */
export interface AgentDecision {
  /** 给用户的自然语言回复（中文、简短专业） */
  reply: string
  /** 待执行命令（每条完整、可直接进 runCommand） */
  commands: string[]
}

/** POST /api/agent 请求体 */
export interface AgentRequestBody {
  /** 对话历史（含本轮用户消息；系统提示由后端组装） */
  messages: { role: 'user' | 'assistant'; content: string }[]
  /** 前端构建的当前场景上下文（结构/reps/选择/设置摘要） */
  scene: string
  /** 长期对话记忆：最近 12 条之前的早期消息压缩摘要（用户意图 + 已执行命令 + 自查结论）。
   *  后端注入场景上下文尾部——超出滚动窗口的对话仍可被引用（避免重复已完成的工作） */
  memory?: string
  /** 视觉自查模式：执行命令后的视口截图（JPEG data URL，宽 ≤768） */
  image?: string
  /** 视觉自查模式：命令执行前的视口截图（前后对比——让 VLM 能判断「变化是否真的发生」） */
  imageBefore?: string
  /** 视觉自查模式：本轮用户目标（原始自然语言需求） */
  goal?: string
  /** 对话分支流式模式：后端以 NDJSON 增量推送（d 增量 / end 终值 / err 错误） */
  stream?: boolean
}

/** 流式响应的事件行（每行一个 JSON 对象，\n 分隔） */
export type AgentStreamEvent =
  | { t: 'd'; v: string }        // 文本增量（累积拼接）
  | { t: 'end'; decision: AgentDecision } // 完整决策（终值，reply 为完整校验后文本）
  | { t: 'err'; error: string }

/** POST /api/agent 响应体 */
export interface AgentResponseBody {
  ok: boolean
  decision?: AgentDecision
  error?: string
}

/** 会话持久化键与上限 */
export const AGENT_CHAT_KEY = 'molvision-agent-chat'
export const AGENT_CHAT_MAX = 40

/** 视觉自查开关持久化键（'off' = 关闭，缺席 = 默认开启） */
export const AGENT_VISUAL_KEY = 'molvision-agent-visual'

/** 单轮命令条数上限（防止 LLM 失控刷命令） */
export const AGENT_CMDS_MAX = 10

/** 解码 JSON 字符串字面量转义（\n \t \" \\ \uXXXX；流式半截序列安全丢弃） */
function decodeJsonEscapes(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch !== '\\') { out += ch; continue }
    const c = s[i + 1]
    if (c === undefined) break // 尾部孤立反斜杠（增量半截）
    if (c === 'n') { out += '\n'; i++ }
    else if (c === 't') { out += '\t'; i++ }
    else if (c === '"') { out += '"'; i++ }
    else if (c === '\\') { out += '\\'; i++ }
    else if (c === 'u' && i + 6 <= s.length) {
      const hex = s.slice(i + 2, i + 6)
      if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 5 }
      else out += c
    } else out += c
  }
  return out
}

/**
 * 从流式累积文本中渐进提取 reply 字段值（打字机显示用）。
 * - LLM 按 JSON 协议输出：{"reply": "..." — 截取未闭合字符串的已到部分
 * - 降级散文输出（非 { 开头）：整段即回复
 * - 半截转义（尾部孤立 \ 或不完整 \uXXXX）安全截断
 */
export function extractPartialReply(text: string): string {
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('{')) return trimmed
  const m = /"reply"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(trimmed)
  if (!m?.[1]) return ''
  return decodeJsonEscapes(m[1])
}
