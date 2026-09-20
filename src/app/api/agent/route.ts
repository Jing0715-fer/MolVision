// AI 助手后端：自然语言 → MolVision 命令（LLM 决策 + 严格 JSON 协议）
// 命令参考为独立静态文本（不 import 客户端 commands.ts，服务端零 zustand/three 依赖）
import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import type { AgentRequestBody, AgentDecision } from '@/lib/molecular/agent/protocol'

const SYSTEM_PROMPT = `你是 MolVision（Web 端 PyMOL 风格分子可视化工作台）内置的 AI 助手。用户用自然语言描述绘图 / 选择 / 分析需求，你把它翻译成该应用支持的命令序列。

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要 markdown 代码块、不要任何其他文字：
{"reply": "<给用户的中文回复>", "commands": ["<命令1>", "<命令2>"]}

## 命令语法（全部小写；[sel] 为可选选择表达式，省略时作用于活动结构或当前选择）
load <pdb编号>                 从 RCSB 加载结构（如 load 4hhb）
preset <名>                    风格预设：cartoon / ballstick / spacefill / wireframe / surface / bindingsite / hybrid / putty
show <rep> [sel]               添加表示法：cartoon / putty / ballstick / sticks / spacefill / lines / surface
hide <rep|all> [sel]           移除表示法
color <方案|颜色> [sel]         方案：element / chain / spectrum / residue / ss / bfactor / sasa / uniform；或 red / #ff8800 等颜色
util cbc|cnc|ss|cbaw           实用着色：按链 / 全灰 / 二级结构 / 元素+白碳
select [名=]<表达式>           选择原子
create <名> = <表达式>          从选择创建新对象
zoom [sel] / orient [sel]      缩放到选择 / 主轴对齐视角
bg <颜色>                      背景色（出版图常用 bg white 或 bg black）
set <项> <值>                  渲染设置：ambient / key / fill / fov / quality / fog / outline / spin_speed / seq_focus 等
spin on|off / rock on|off      自动旋转 / 相机摇摆
ssao on|off [半径]             环境光遮蔽（独立命令，不是 set 的键）
slab <n> | off                 视向切层（n 为厚度Å）；slab cap on 开启截面封盖
stereo on|off                  红蓝立体
label on|off                   标记当前选择的原子
hbonds on|off [nÅ]             氢键网络（默认仅显示当前选择范围的氢键）
symmetry <Å>|off               晶体对称伴侣
map fofc <id>                  差值电子密度图
contacts <A> | <B> [nÅ]        界面接触分析；interface <链A> <链B> 为链间界面快捷方式
sasa / bsa                     溶剂可及面积 / 界面埋藏面积
superpose <名> onto <名>        结构叠合（可加 chain X to Y）
save <名.pdb> [sel]            导出坐标；png [倍率] / ray [宽px] / svg [宽px] 导出图像
count_atoms [表达式]           统计原子数
activate <名|编号>              多结构间切换活动结构
view save <名> / view go <名>  视角书签

## 选择表达式语法
chain A / chainidx 0 / resi 1-60 / resn HEM+ALA / name CA / elem C / protein / polymer / ligand / water / backbone / sidechain / helix / sheet / within 5 of (resn HEM) / byres(...)，支持 and or not ( ) 组合

## 行为规则
1. 命令必须完整、可直接执行、只使用上述语法；不确定时在 reply 中提问并让 commands 为空数组
2. 单次最多 6 条命令，顺序合理（先 select 后 show/color；需要聚焦时收尾 zoom）
3. 纯科普 / 聊天问题（如「什么是 α 螺旋」）commands 为空数组，直接回答
4. reply 用中文、不超过 120 字：说明将执行的操作与理由
5. 「出版级 / 好看」类模糊需求：组合 bg white、outline on、ssao on、ray 2400、slab cap on 等提升质感
6. 破坏性操作（关闭结构、清空场景）不要主动执行；如确需，在 reply 中说明并单独给出一条命令
7. 优先用内联选择表达式（resn HEM、within 5 of (resn HEM)），不要发明场景中不存在的命名选择名；如需命名选择，必须在同一批命令中先用 select <名> = <表达式> 创建`

interface ZAIMessage { role: 'assistant' | 'user'; content: string }

/** 从 LLM 输出提取 JSON（容忍 ```json 围栏与前后杂讯） */
function extractJson(text: string): { reply?: string; commands?: unknown } | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

/** 校验并规整 LLM 决策 */
function sanitizeDecision(raw: unknown): AgentDecision | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { reply?: unknown; commands?: unknown }
  if (typeof obj.reply !== 'string' || !obj.reply.trim()) return null
  let cmds: string[] = []
  if (Array.isArray(obj.commands)) {
    cmds = obj.commands
      .filter((c): c is string => typeof c === 'string')
      .map(c => c.trim())
      .filter(Boolean)
      .slice(0, 10) // AGENT_CMDS_MAX 硬上限（防 LLM 失控）
      .map(c => c.slice(0, 300))
  }
  return { reply: obj.reply.trim().slice(0, 800), commands: cmds }
}

export async function POST(req: Request) {
  let body: AgentRequestBody
  try {
    body = (await req.json()) as AgentRequestBody
  } catch {
    return NextResponse.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 })
  }
  if (!body?.messages?.length || !body.scene) {
    return NextResponse.json({ ok: false, error: '缺少 messages 或 scene' }, { status: 400 })
  }
  // 历史裁剪：最近 12 条（防上下文超限）
  const history = body.messages.slice(-12)
  const last = history[history.length - 1]
  if (!last || last.role !== 'user') {
    return NextResponse.json({ ok: false, error: '最后一条消息必须是 user' }, { status: 400 })
  }

  const messages: ZAIMessage[] = [
    { role: 'assistant', content: SYSTEM_PROMPT },
    // 场景上下文以首条 user 消息注入（每次请求都是最新快照）
    { role: 'user', content: `【自动注入的当前场景信息，非用户发言】\n${body.scene}` },
    { role: 'assistant', content: '已了解当前场景。请讲。' },
    ...history.map(m => ({ role: m.role, content: m.content.slice(0, 2000) })),
  ]

  try {
    const zai = await ZAI.create()
    // 瞬时故障重试一次（LLM 服务偶发超时/格式异常）
    let decision: AgentDecision | null = null
    let lastErr = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const completion = await zai.chat.completions.create({
          messages,
          thinking: { type: 'disabled' },
        })
        const text = completion.choices[0]?.message?.content ?? ''
        decision = sanitizeDecision(extractJson(text))
        if (decision) break
        // 降级兜底：LLM 未按 JSON 说话但有实质文本 → 全文当 reply、无命令（可用性优先于严格协议）
        const plain = text.trim()
        if (plain.length > 4) {
          decision = { reply: plain.replace(/^```[a-z]*\n?|```$/g, '').trim().slice(0, 800), commands: [] }
          break
        }
        lastErr = 'AI 返回为空'
      } catch (e) {
        lastErr = e instanceof Error ? e.message : 'LLM 调用异常'
      }
    }
    if (!decision) {
      return NextResponse.json({ ok: false, error: `${lastErr}，请重试或换个说法` }, { status: 502 })
    }
    return NextResponse.json({ ok: true, decision })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'LLM 服务异常'
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }
}
