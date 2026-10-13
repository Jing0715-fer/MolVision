// r115 E2E-M：mock 直测（curl 级，Bun fetch）——r115-d 0.46 防重发三件套（okOuts 节隔离 /
// 同名丢弃 / 重组去重）+ r115-a 视觉链域演练分支（fail drill chain）+ r114 消费闭环回归。
// 注入段用真实 buildSkillDirective 组装（route 真实组装形态纪律）。
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

// 场景消息（route 注入形态）：1PHO 单链 A
const scene1PHO = { role: 'user', content: '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1PHO\n- 【活动】1PHO [PDB] 99原子/99残基 · 链: A(蛋白·99残基) · 配体: 无' }

// ---- T1：r115-d okOuts 节隔离——已成功命令不进失败重组（消费 prompt 尾节同形行式）----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- interface A B → 选择为空（B: 0 原子）\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  99 残基\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n- orient → 已沿主轴定向\n- hbonds on 3.4 → 已开启氢键网络：3 条\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T1a 成功命令不当失败重组（orient 不进 commands）', r.commands.includes('orient'), false)
  eq('T1b 成功命令不当失败重组（hbonds 不进 commands）', r.commands.includes('hbonds on 3.4'), false)
  eq('T1c 失败命令正常重组', r.commands[0], 'interface A A')
}

// ---- T2：r115-d 防重发过滤——重组产物与已成功命令同名 → 丢弃 + 诚实计数 ----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- color red, chain Z → 未找到链 Z\n- select chain Z → 未找到链 Z\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  99 残基\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n- color red, chain A → 已着色 99 原子\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T2a 重组产物同名已成功命令被丢弃（color red, chain A）', r.commands.includes('color red, chain A'), false)
  eq('T2b 未同名产物保留（select chain A）', r.commands.includes('select chain A'), true)
  includes('T2c 丢弃计数诚实口径', r.reply, '1 条与已成功命令重复已跳过')
}

// ---- T3：r115-d 重组精确去重——两条失败重组为同一命令 → 单条（原失败与视觉重发同文场景）----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- interface B C → 选择为空（B: 0 原子）\n- interface B C → 选择为空（B: 0 原子）\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  99 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T3 同文双失败重组去重为单条', r.commands.join('|'), 'interface A A')
}

// ---- T4：r115-d EN 消费 prompt okOuts 节——英文节头切分 + 同名丢弃 ----
{
  const r = await mockReply([{ role: 'user', content: `The chain list has been probed. Recompose the failed commands per the list and give them again (substitute chain IDs that actually exist):\n- color red, chain Z → Chain Z not found\n\nchains list output:\nChain groups (1 total, 0 hidden):\n  ◉  00  A   protein  99 residues\n\nKey output of already-successful commands (do not repeat them when recomposing):\n- color red, chain A → colored 99 atoms\n\nOnly give the recomposed commands to run; do not repeat the successful ones.` }])
  eq('T4a EN 同名丢弃', r.commands.length, 0)
  // r119-c 同步：0 待执行场景改走「Chain-list check complete」新文案——丢弃分类
  // 计数口径不变（1 success duplicates），断言随行为同步。
  includes('T4b EN 丢弃分类计数文案', r.reply, '1 success duplicates')
  includes('T4c EN 无可执行命令口径', r.reply, 'nothing to run')
}

// ---- T5：r115-a 视觉链域演练——fail drill chain → 修正命令带不存在的链 Z（空选择必报错族）----
{
  const r = await mockVisionReply('fail drill chain: analyze the interface between chain A and chain B')
  eq('T5a 演练未达标文案', r.reply.includes('视觉自查未达标'), true)
  eq('T5b 修正命令 zoom chain Z, 5（空选择必报错）', r.commands[0], 'zoom chain Z, 5')
  eq('T5c 修正命令 interface A Z（空选择必报错）', r.commands[1], 'interface A Z')
}

// ---- T6：视觉演练分级——通用 fail drill 不被链域分支抢（具体优先于宽泛的对称面）----
{
  const r = await mockVisionReply('fail drill: make chain A red')
  eq('T6a 通用演练走原分支（select chain A）', r.commands[0], 'select chain A')
  eq('T6b 通用演练文案（目标颜色）', r.reply.includes('目标颜色未生效'), true)
}

// ---- T7：视觉通过路径回归——无演练词 → 通过 + 空命令 ----
{
  const r = await mockVisionReply('show the protein as cartoon')
  eq('T7a 默认通过（空命令）', r.commands.length, 0)
  eq('T7b 通过文案', r.reply.includes('视觉自查通过'), true)
}

// ---- T8：回归——r114 0.46 基础重组（无 okOuts 节时行为不变）----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- interface A B → 选择为空（B: 0 原子）\n- view from (chain A and chain B) → 选择为空\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  99 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T8a interface 重组（B→A）回归', r.commands[0], 'interface A A')
  eq('T8b chain 词式重组回归', r.commands[1], 'view from (chain A and chain A)')
  notIncludes('T8c 无丢弃时不带跳过文案', r.reply, '已跳过')
}

// ---- T9：回归——0.45 修正轮 okOuts 隔离不破坏（r114 T1 同款，0.46 改动的旁路验证）----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `刚才这些命令执行失败了，请修正（换正确的选择表达式 / 命令写法）后重新给出命令：\n- interface A B → 选择为空（B: 0 原子）\n\n已成功命令的关键输出（含系统提示，供参考）：\n- orient → 已沿主轴定向\n\n只给出修正后需要执行的命令，不要重复已成功的命令。` }])
  eq('T9 0.45 okOuts 隔离回归（orient 不重跑）', r.commands.includes('orient'), false)
  eq('T9b 0.45 链域失败仍发探测', r.commands[0], 'chains list')
}

console.log(`\n== M 结果：${pass} PASS / ${fail} FAIL ==`)
process.exit(fail ? 1 : 0)
