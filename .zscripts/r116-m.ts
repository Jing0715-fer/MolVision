// r116 E2E-M：mock 直测（curl 级，Bun fetch）——r116-a 有界二次消费的 mock 侧矩阵。
// 应用侧二轮 consumePrompt2 与首轮同形（「链清单已探测」开头——mock 0.46 同分支处理），
// 差异在内容：失败来自消费轮自身（视觉自查重发的新错链/同文重发）、okOuts 含首轮
// 重组成功命令、探测可为结构切换后的新清单（probe2）。注入段用真实 buildSkillDirective。
import { AGENT_SKILLS, buildSkillDirective } from '../src/lib/molecular/agent/skills'

const MOCK = 'http://localhost:3999/v1/chat/completions'
const HDRS = { 'Content-Type': 'application/json', Authorization: 'Bearer test-key-12345' }

let pass = 0, fail = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${ok ? '' : `—— 实测 ${JSON.stringify(actual)} 期望 ${JSON.stringify(expected)}`}`)
}
const includes = (name: string, hay: unknown, needle: string) => {
  const ok = typeof hay === 'string' && hay.includes(needle)
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `—— 实测 ${JSON.stringify(String(hay).slice(0, 220))} 缺「${needle}」`}`)
}
const notIncludes = (name: string, hay: unknown, needle: string) => {
  const ok = typeof hay === 'string' && !hay.includes(needle)
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `—— 实测 ${JSON.stringify(String(hay).slice(0, 220))} 不应含「${needle}」`}`)
}

async function mockReply(messages: unknown[]): Promise<{ reply: string; commands: string[] }> {
  const res = await fetch(MOCK, { method: 'POST', headers: HDRS, body: JSON.stringify({ messages, max_tokens: 800 }) })
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content ?? ''
  try { return JSON.parse(content) } catch { return { reply: content, commands: [] } }
}

/** 视觉分支直测：多模态 content（image_url 片 + goal 文本片）——route 视觉自查的真实请求形态 */
async function mockVisionReply(goal: string): Promise<{ reply: string; commands: string[] }> {
  const res = await fetch(MOCK, { method: 'POST', headers: HDRS, body: JSON.stringify({
    model: 'mock-vision',
    messages: [{ role: 'user', content: [
      { type: 'text', text: `用户目标：${goal}\n\n【自动注入的当前场景信息】\n已加载 1 个结构，活动结构：1A2N` },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg' } },
    ] }],
  }) })
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content ?? ''
  try { return JSON.parse(content) } catch { return { reply: content, commands: [] } }
}

const ifSkill = AGENT_SKILLS.find(s => s.id === 'interface-analysis')!
const ifDirective = buildSkillDirective(ifSkill)

// 场景消息（route 注入形态）：1A2N 单链 A（G1 消费救济同款场景）
const scene1A2N = { role: 'user', content: '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1A2N\n- 【活动】1A2N [PDB] 3319原子/690残基 · 链: A(蛋白·690残基) · 配体: 无' }

// ---- T1：二轮新鲜失败重组（成功路径）——VLM 视觉自查发新错链 Q（view from chain Q），
// okOuts 含首轮重组成功（interface A A / view from (chain A and chain A)）——重组产物
// view from chain A 与两者文本不同 → 不丢弃、正常执行（G1 同文演练覆盖不到的路径）。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- view from chain Q → 选择为空\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n- interface A A → 界面残基 689/689\n- view from (chain A and chain A) → 已对准界面\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T1a 二轮新鲜失败重组（view from chain Q → A）', r.commands.join('|'), 'view from chain A')
  notIncludes('T1b 重组产物与首轮成功文本不同不误丢', r.reply, '已跳过')
}

// ---- T2：二轮同文重发（G1 演练同款路径）——视觉自查重发 zoom chain Z, 5 / interface A Z
// （首轮已重组成功 zoom chain A, 5 / interface A A）→ 重组产物全同名 → 全丢弃 + 诚实计数。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- zoom chain Z, 5 → 命中 0 个原子\n- interface A Z → 选择为空\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n- interface A A → 界面残基 689/689\n- view from (chain A and chain A) → 已对准界面\n- zoom chain A, 5 → 已聚焦\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T2a 同文重发重组产物全丢弃（零命令）', r.commands.length, 0)
  // r119-c 同步：0 待执行场景改走「链清单核对完成」新文案（r118 建议③收口）——
  // 丢弃分类计数口径不变（2 成功重复、0 失败同文），断言随行为同步。
  includes('T2b 丢弃分类计数诚实口径（2 成功重复）', r.reply, '2 条成功重复')
  includes('T2c 无可执行命令口径', r.reply, '无可执行命令')
}

// ---- T3：结构切换后的新探测（probe2 语义）——首轮后结构换成 1PRC（链 C/H/L/M），
// 二轮失败 view from chain Q 按新清单重组为首个蛋白链 C。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, { role: 'user', content: '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1PRC\n- 【活动】1PRC [PDB] 6832原子/1160残基 · 链: C(蛋白·283残基) H(蛋白·258残基) L(蛋白·224残基) M(蛋白·32残基)' }, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- view from chain Q → 选择为空\n\nchains list 输出：\n链组（4 个，隐藏 0 个）：\n  ◉  00  C   蛋白  283 残基\n  ◉  01  H   蛋白  258 残基\n  ◉  02  L   蛋白  224 残基\n  ◉  03  M   蛋白  32 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T3 新清单重组（首个蛋白链 C）', r.commands.join('|'), 'view from chain C')
}

// ---- T4：EN 二轮 prompt（Chain-list consumption 2nd 同形）——fresh failure 重组。
{
  const r = await mockReply([{ role: 'user', content: `The chain list has been probed. Recompose the failed commands per the list and give them again (substitute chain IDs that actually exist):\n- zoom chain Q, 8 → matched 0 atoms\n\nchains list output:\nChain groups (1 total, 0 hidden):\n  ◉  00  A   protein  690 residues\n\nKey output of already-successful commands (do not repeat them when recomposing):\n- orient → oriented along principal axes\n\nOnly give the recomposed commands to run; do not repeat the successful ones.` }])
  eq('T4 EN 二轮新鲜失败重组', r.commands.join('|'), 'zoom chain A, 8')
}

// ---- T5：历史含首轮消费消息（recompMsg assistant）不干扰——mock 只看 lastUser，
// 二轮重组与无历史等价（buildApiHistory 透传形态回归）。
{
  const r = await mockReply([
    { role: 'user', content: 'fail drill chain: analyze the interface between chain A and chain B' },
    { role: 'assistant', content: '链清单消费：已按链清单重组命令（场景可用链：A；无效链已替换为 A——4 条待执行）。' },
    { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- view from chain Q → 选择为空\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` },
  ])
  eq('T5 历史含首轮消费消息不干扰二轮重组', r.commands.join('|'), 'view from chain A')
}

// ---- T6：视觉链域演练回归——r116 mock 零改动，锚定 fail drill chain 分支行为不变
// （二轮救济链路的驱动器：消费轮视觉自查 → 同文重发 → chainFails2）。
{
  const r = await mockVisionReply('fail drill chain: analyze the interface between chain A and chain B')
  eq('T6a 演练修正命令 zoom chain Z, 5 不变', r.commands[0], 'zoom chain Z, 5')
  eq('T6b 演练修正命令 interface A Z 不变', r.commands[1], 'interface A Z')
}

// ---- T7：二轮诚实降级回归——清单解析失败（空 probe）不编造重组（首轮/二轮同款防线）。
{
  const r = await mockReply([{ role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- view from chain Q → 选择为空\n\nchains list 输出：\n（截断的清单输出）\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T7 二轮清单解析失败诚实降级（零命令）', r.commands.length, 0)
  includes('T7b 降级文案引导人工', r.reply, 'chains list')
}

console.log(`\n== M 结果：${pass} PASS / ${fail} FAIL ==`)
process.exit(fail ? 1 : 0)
