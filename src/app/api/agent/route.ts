// AI 助手后端：自然语言 → MolVision 命令（LLM 决策 + 严格 JSON 协议）
// 两种模式：① 对话决策（文本）② 视觉自查（截图 → VLM 审视 → 修正命令）
// 命令参考为独立静态文本（不 import 客户端 commands.ts，服务端零 zustand/three 依赖）
import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import type { AgentRequestBody, AgentDecision } from '@/lib/molecular/agent/protocol'

/** 命令语法速查（对话与视觉自查两份提示词共用——覆盖应用全部功能） */
const COMMAND_REF = `## 命令速查（全部小写；[sel] 为可选选择表达式，省略时作用于活动结构或当前选择）

加载/对象：load <pdb编号>（从 RCSB 加载，如 load 4hhb） · create <名> = <表达式> · split_chains · activate <名|编号>（切换活动结构）
表示法：preset <cartoon|ballstick|spacefill|wireframe|surface|bindingsite|hybrid|putty> · show <rep> [sel]（rep: cartoon/putty/ballstick/sticks/lines/spacefill/surface） · hide <rep|all> [sel] · show hydrogens / hide hydrogens / show waters / hide waters
着色：color <方案|颜色> [sel]（方案: element/chain/spectrum/residue/ss/bfactor/sasa/uniform；或 red/#ff8800） · util cbc|cnc|ss|cbaw · reset_colors · bg <颜色>
选择/统计：select [名=]<表达式> · count_atoms [表达式]
视角：zoom [sel] · orient [sel] · view save <名> / view go <名> / view list（视角书签）
视觉：set <项> <值>（项: ambient direct fill specular fog fog_strength fov spin_speed quality low|medium|high axes fps seq_focus cap_color cap_shading auto_perf outline outline_strength outline_thickness transparency sphere_scale stick_radius cartoon_width） · spin on|off · rock on|off · slab <nÅ>|off|move <±Å>|center|cap on|off · stereo on|off · ssao on|off [半径]（独立命令，非 set 键） · outline on|off [强度 粗细] · axes on|off · fps on|off · label on|off（标记当前选择） · hbonds on|off [nÅ] · symmetry <Å>|off · map fofc <id>（差值电子密度）
分析：contacts <A> | <B> [nÅ] · interface <链A> <链B> · xcontacts <A>:<expr> | <B>:<expr>（跨结构） · sasa · bsa · xbsa · dssp（重算二级结构） · superpose <名> onto <名> [chain X to Y] · untransform [名]
测量：measure dist (exprA) (exprB) · measure angle (A) (B) (C) · measure dihedral (A) (B) (C) (D) · measure clear（多原子选择距离取最近原子对，角度/二面角取质心最近原子；例：measure dist (resn HEM) (within 5 of resn HEM and protein)）
构象/媒体：morph <名> = <结构A> <结构B> [帧数] · morph multi <名> = <A> <B> <C>… [帧数]（构象插值轨迹） · ensemble play|stop|frame <n> · movie play|stop [秒 轮] · record start|stop（录制 WebM）
导出/会话：save <名.pdb> [sel] · png [倍率] · ray [宽px]（Ray 级静帧） · svg [宽px] · session save|export|info
其他：help · history · perf on|off|status · tour stop

## 选择表达式语法
chain A / chainidx 0 / resi 1-60 / resn HEM+ALA / name CA / elem C / protein / polymer / ligand / water / backbone / sidechain / helix / sheet / within 5 of (resn HEM) / byres(...)，支持 and or not ( ) 组合`

const SYSTEM_PROMPT = `你是 MolVision（Web 端 PyMOL 风格分子可视化工作台）内置的 AI 绘图助手。用户用自然语言描述绘图 / 选择 / 分析 / 测量需求，你把它翻译成该应用支持的命令序列。应用的全部功能都可用命令触达（上方速查即全集）。

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要 markdown 代码块、不要任何其他文字：
{"reply": "<给用户的中文回复>", "commands": ["<命令1>", "<命令2>"]}

${COMMAND_REF}

## 行为规则
1. 命令必须完整、可直接执行、只使用上述语法；不确定时在 reply 中提问并让 commands 为空数组
2. 单次最多 6 条命令，顺序合理（先 select 后 show/color；需要聚焦时收尾 zoom）
3. 纯科普 / 聊天问题（如「什么是 α 螺旋」）commands 为空数组，直接回答
4. reply 用中文、不超过 120 字：说明将执行的操作与理由
5. 「出版级 / 好看」类模糊需求：组合 bg white、outline on、ssao on、ray 2400、slab cap on 等提升质感
6. 破坏性操作（关闭结构、清空场景）不要主动执行；如确需，在 reply 中说明并单独给出一条命令
7. 优先用内联选择表达式（resn HEM、within 5 of (resn HEM)），不要发明场景中不存在的命名选择名；如需命名选择，必须在同一批命令中先用 select <名> = <表达式> 创建
8. 增量调整（「再粗一点 / 再亮一点 / 转慢一点」）：基于场景信息中的「数值参数」当前值计算新值，命令给绝对值（如 outline_thickness 当前 1 → set outline_thickness 2）；幅度适度：单次变化 ≤50%，且灯光类（ambient/direct/fill）不超过 1.5、outline_strength 不超过 3、outline_thickness 不超过 4——过曝比偏暗更糟
9. 测量距离/角度/二面角 → measure 命令；测量结果会在 reply 之后由系统展示，无需再解释数值
10. 构象动画（morph/ensemble/movie/record）与叠合（superpose）等多结构工作流照常支持：先用 load 加载所需构象再执行`

/** 视觉自查提示词（VLM 分支）：审视执行后截图，判断目标达成度 */
const REVIEW_PROMPT = `你是 MolVision（Web 端 PyMOL 风格分子可视化工作台）的视觉自查模块。用户提出绘图目标，助手已执行若干命令；随消息附上命令执行后的视口截图。请审视截图判断目标是否达成并给出结论。

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要 markdown 代码块：
{"reply": "<给用户的中文结论>", "commands": ["<可选的修正命令>"]}

判断标准：
- 已达成：reply 简述你在截图中看到了什么、确认目标达成（≤80 字），commands 为空数组
- 未达成 / 明显可优化：reply 指出具体问题（如结构未聚焦、颜色未生效、配体不可见、背景未变），commands 给出 1-3 条修正命令（必须使用下方命令语法，给绝对值）
- 截图为空场景 / 渲染异常：如实说明并给修复建议
- 不要吹毛求疵：审美层面的微小瑕疵不构成「未达成」；只在目标明确未实现时给修正命令
- 修正幅度适度：单次变化 ≤50%；灯光 ambient/direct/fill 正常值均为 1，上限 1.5；outline_strength 上限 3、outline_thickness 上限 4
- 症状速查（看图 → 根因 → 修正，只调最可能的根因参数，1-2 条命令为宜）：
  · 白色过曝、细节丢失 → 灯光过高 → set ambient 1 · set direct 1
  · 黑色线条噪感、边缘刺目、卡通面丢失 → outline_thickness 过大 → set outline_thickness 2 或 outline off
  · 场景过暗发灰 → 灯光过低 → set ambient 1 · set direct 1.2
  · 层次感不足、扁平 → set ssao 无效（ssao 是独立命令）→ ssao on
  · 「恢复正常」类目标 → 灯光回默认（ambient 1 / direct 1 / fill 1），outline_thickness ≤ 2

${COMMAND_REF}`

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

/** 命令头全集（打捞/白名单用——与服务端命令参考同源静态维护） */
const KNOWN_CMD_HEADS = new Set([
  'load', 'fetch', 'create', 'split_chains', 'splitchains', 'activate', 'use',
  'select', 'sel', 'show', 'display', 'hide', 'undisplay', 'preset', 'style',
  'color', 'colour', 'util', 'reset_colors', 'recolor', 'bg', 'background',
  'zoom', 'fit', 'orient', 'get_view', 'set_view', 'view', 'views', 'bookmark',
  'set', 'spin', 'rock', 'slab', 'stereo', 'axes', 'axis', 'gizmo', 'fps',
  'outline', 'edge', 'ssao', 'ao', 'gtao', 'label',
  'hbonds', 'hbond', 'hbon', 'count_atoms', 'count', 'symmetry', 'symmates',
  'contacts', 'contact', 'clash', 'interface', 'iface',
  'xcontacts', 'xcontact', 'xiface', 'sasa', 'area', 'bsa', 'buried',
  'xbsa', 'xburied', 'dssp', 'secstr',
  'superpose', 'match', 'align', 'mm', 'untransform', 'unpose',
  'measure', 'dist', 'morph', 'movie', 'ensemble', 'ens', 'record', 'rec',
  'map', 'save', 'png', 'ray', 'svg',
  'help', 'history', 'perf', 'session', 'tour', 'demo',
  'close', 'clear', 'reset', 'delete',
])

/** commands 字段兼容：数组或字符串（"set a 1; set b 2" 形式——实测 LLM 偶发用字符串） */
function normalizeCommands(v: unknown): string[] {
  let list: string[] = []
  if (Array.isArray(v)) {
    list = v.filter((c): c is string => typeof c === 'string')
  } else if (typeof v === 'string') {
    list = v.split(/[\n;；]+/)
  } else {
    return []
  }
  return list
    .map(c => c.trim())
    .filter(Boolean)
    .slice(0, 10) // AGENT_CMDS_MAX 硬上限（防 LLM 失控）
    .map(c => c.slice(0, 300))
}

/** 降级兜底：从纯文本回复中打捞命令行（以已知命令头开头的短行） */
function salvageCommands(text: string): string[] {
  const out: string[] = []
  for (const rawLine of text.split(/[\n;；]+/)) {
    const t = rawLine
      .trim()
      .replace(/^[•\-*\d.、)\]]+\s*/, '')
      .replace(/[`*_"'“”]+/g, '')
      .replace(/[.。,，!！?？]+$/, '')
      .trim()
    if (!t || t.length > 120) continue
    const head = t.toLowerCase().split(/\s+/)[0] ?? ''
    if (KNOWN_CMD_HEADS.has(head)) out.push(t)
  }
  return [...new Set(out)].slice(0, 10)
}

/** 校验并规整 LLM 决策 */
function sanitizeDecision(raw: unknown): AgentDecision | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { reply?: unknown; commands?: unknown }
  if (typeof obj.reply !== 'string' || !obj.reply.trim()) return null
  return { reply: obj.reply.trim().slice(0, 800), commands: normalizeCommands(obj.commands) }
}

export async function POST(req: Request) {
  let body: AgentRequestBody
  try {
    body = (await req.json()) as AgentRequestBody
  } catch {
    return NextResponse.json({ ok: false, error: '请求体不是合法 JSON' }, { status: 400 })
  }
  if (!body?.scene) {
    return NextResponse.json({ ok: false, error: '缺少 scene' }, { status: 400 })
  }

  // ---------- 视觉自查分支（VLM 看截图） ----------
  if (body.image && body.goal) {
    try {
      const zai = await ZAI.create()
      let decision: AgentDecision | null = null
      let lastErr = ''
      for (let attempt = 0; attempt < 2 && !decision; attempt++) {
        try {
          const completion = await zai.chat.completions.createVision({
            model: 'glm-4.6v',
            messages: [
              { role: 'assistant', content: REVIEW_PROMPT },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `用户目标：${body.goal.slice(0, 500)}\n\n【自动注入的当前场景信息】\n${body.scene.slice(0, 3000)}`,
                  },
                  { type: 'image_url', image_url: { url: body.image } },
                ],
              },
            ],
            thinking: { type: 'disabled' },
          })
          const text = completion.choices[0]?.message?.content ?? ''
          decision = sanitizeDecision(extractJson(text))
          if (decision) break
          const plain = text.trim()
          if (plain.length > 4) {
            // 降级兜底：纯文本当 reply + 从中打捞命令行（可用性优先于严格协议）
            decision = {
              reply: plain.replace(/^```[a-z]*\n?|```$/g, '').trim().slice(0, 800),
              commands: salvageCommands(plain),
            }
            break
          }
          lastErr = 'AI 返回为空'
        } catch (e) {
          lastErr = e instanceof Error ? e.message : 'VLM 调用异常'
        }
      }
      if (!decision) {
        return NextResponse.json({ ok: false, error: `视觉自查失败：${lastErr}` }, { status: 502 })
      }
      return NextResponse.json({ ok: true, decision })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'VLM 服务异常'
      return NextResponse.json({ ok: false, error: msg }, { status: 502 })
    }
  }

  // ---------- 对话决策分支（文本 LLM） ----------
  if (!body?.messages?.length) {
    return NextResponse.json({ ok: false, error: '缺少 messages' }, { status: 400 })
  }
  // 历史裁剪：最近 12 条（防上下文超限）
  const history = body.messages.slice(-12)
  const last = history[history.length - 1]
  if (!last || last.role !== 'user') {
    return NextResponse.json({ ok: false, error: '最后一条消息必须是 user' }, { status: 400 })
  }

  // 协议提醒附加在最后一条用户消息（recency 加固——长历史下 LLM 会模仿历史的散文格式而丢掉 JSON 协议，实测捕获）
  const PROTOCOL_SUFFIX = '\n\n【系统提醒】你的下一条回复必须只是一个 JSON 对象：{"reply":"<中文回复>","commands":["<命令>",...]}。commands 是字符串数组（无可执行命令时为 []），不要输出 JSON 以外的任何文字。'

  const messages: ZAIMessage[] = [
    { role: 'assistant', content: SYSTEM_PROMPT },
    // 场景上下文以首条 user 消息注入（每次请求都是最新快照）
    { role: 'user', content: `【自动注入的当前场景信息，非用户发言】\n${body.scene}` },
    { role: 'assistant', content: '已了解当前场景。请讲。' },
    ...history.map((m, i) => ({
      role: m.role,
      content: (i === history.length - 1 ? m.content + PROTOCOL_SUFFIX : m.content).slice(0, 2400),
    })),
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
        // 降级兜底：LLM 未按 JSON 说话但有实质文本 → 全文当 reply + 打捞命令行（可用性优先于严格协议）
        const plain = text.trim()
        if (plain.length > 4) {
          decision = {
            reply: plain.replace(/^```[a-z]*\n?|```$/g, '').trim().slice(0, 800),
            commands: salvageCommands(plain),
          }
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
