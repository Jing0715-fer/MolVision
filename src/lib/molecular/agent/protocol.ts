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
  /** 视觉自查模式：执行命令后的视口截图（JPEG data URL，宽 ≤768） */
  image?: string
  /** 视觉自查模式：命令执行前的视口截图（前后对比——让 VLM 能判断「变化是否真的发生」） */
  imageBefore?: string
  /** 视觉自查模式：本轮用户目标（原始自然语言需求） */
  goal?: string
}

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
