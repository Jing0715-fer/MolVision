// r114 E2E-M：mock 直测（curl 级，Bun fetch）——r114-b 链清单消费闭环（0.46 分支：
// 解析/重组/降级）+ 0.45 三修复（okOuts 隔离 / 探测去重 / interface 形态探测）+ r111 链族回归。
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

const ifSkill = AGENT_SKILLS.find(s => s.id === 'interface-analysis')!
const ifDirective = buildSkillDirective(ifSkill)

// 场景消息（route 注入形态）：1PHO 单链 A（无配体无水——链 B 不在场的最简场景）
const scene1PHO = { role: 'user', content: '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1PHO\n- 【活动】1PHO [PDB] 99原子/99残基 · 链: A(蛋白·99残基) · 配体: 无' }

// ---- T1：0.45 okOuts 隔离——成功命令不进修正命令（修复前 `- X → Y` 全量吞入会重跑）----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `刚才这些命令执行失败了，请修正（换正确的选择表达式 / 命令写法）后重新给出命令：\n- interface A B → 选择为空（B: 0 原子）\n\n已成功命令的关键输出（含系统提示，供参考）：\n- hbonds on 3.4 → 已开启氢键网络：3 条\n- orient → 已沿主轴定向\n\n只给出修正后需要执行的命令，不要重复已成功的命令。` }])
  eq('T1 成功命令不被重跑（okOuts 隔离）', r.commands.includes('hbonds on 3.4') || r.commands.includes('orient'), false)
}

// ---- T2：0.45 探测去重——3 个链域失败各改写 chains list → 精确去重为 1 条 ----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- interface A B → 选择为空（B: 0 原子）\n- contacts (chain A and polymer) | (chain B and polymer) 4.5 → 选择为空（B: 0 原子）\n- view from (chain A and chain B) → 选择为空\n\n只给出修正后需要执行的命令，不要重复已成功的命令。` }])
  eq('T2 三链域失败去重为单条 chains list', r.commands.join('|'), 'chains list')
}

// ---- T3：0.45 interface 形态探测——interface A B [cutoff] 空选择 → chains list（r114-b 新规则）----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- interface A B 4.5 → 选择为空（B: 0 原子）\n\n只给出修正后需要执行的命令，不要重复已成功的命令。` }])
  eq('T3 interface 形态（带 cutoff）→ chains list', r.commands[0], 'chains list')
}

// ---- T4：0.46 ZH 全链——interface A B + view from (chain A and chain B) 按清单重组 ----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- interface A B → 选择为空（B: 0 原子——链 B 不在场景中）\n- view from (chain A and chain B) → 选择为空\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  99 残基\n隐藏：chains hide A+B / chains hide A · 恢复：chains show A / chains show all\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T4a interface 重组（B→A）', r.commands[0], 'interface A A')
  eq('T4b chain 词式重组（chain B→chain A）', r.commands[1], 'view from (chain A and chain A)')
  includes('T4c 重组文案（可用链+替换说明）', r.reply, '可用链：A')
}

// ---- T5：0.46 EN + chains hide 形态——无效链 → 首个蛋白链（跳过水链 W）----
{
  const r = await mockReply([{ role: 'user', content: `The chain list has been probed. Recompose the failed commands per the list and give them again (substitute chain IDs that actually exist):\n- chains hide Z → Chain Z not found — available: H, L, W\n\nchains list output:\nChain groups (3 total, 0 hidden):\n  ◉  00  H   protein  214 residues\n  ◉  01  L   protein  216 residues\n  ◉  02  W   water  130 residues\n\nOnly give the recomposed commands to run; do not repeat the successful ones.` }])
  eq('T5 chains hide Z → chains hide H（首个蛋白链）', r.commands[0], 'chains hide H')
  includes('T5b EN 重组文案', r.reply, 'replaced with H')
}

// ---- T6：0.46 多 token hide——失败的 hide X+Y 必然双双无效（app 侧部分命中即成功）→ 全换 pick 后 token 去重 ----
{
  const r = await mockReply([{ role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- chains hide X+Y → 未找到链 X+Y——可用链：H、L\n\nchains list 输出：\n链组（2 个，隐藏 0 个）：\n  ◉  00  H   蛋白  214 残基\n  ◉  01  L   蛋白  216 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T6 双无效 token 归一（X+Y → H，token 去重）', r.commands[0], 'chains hide H')
}

// ---- T7：0.46 诚实降级——清单解析失败（空清单）→ 空命令 + 降级文案（不编造重组）----
{
  const r = await mockReply([{ role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- contacts (chain A) | (chain Z) → 未找到链 Z\n\nchains list 输出：\n链组（2 个，隐藏 0 个）：\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T7a 空清单 → 空命令（不编造）', r.commands.length, 0)
  includes('T7b 降级文案（人工 chains list 提示）', r.reply, '人工执行 chains list')
}

// ---- T8：0.46 空选择族 chain 词式重组——contacts 管道两侧分别替换 ----
{
  const r = await mockReply([{ role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- contacts (chain A) | (chain Z) 4.5 → 选择为空（Z: 0 原子）\n\nchains list 输出：\n链组（2 个，隐藏 0 个）：\n  ◉  00  A   蛋白  99 残基\n  ◉  01  B   配体  1 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T8 管道两侧分别替换（有效保留 A，无效 Z→A）', r.commands[0], 'contacts (chain A) | (chain A) 4.5')
}

// ---- T9：回归——r111-c 链族（未找到链 → chains list 探测，0.46 不抢 0.45 域）----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- chains hide Z → 错误：未找到链 Z——可用链：A` }])
  eq('T9 链族回归（chains hide Z → chains list）', r.commands[0], 'chains list')
}

// ---- T10：回归——0.45 泛错误不改写（场景替换回放；0.46/去重不影响透传族）----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- view from (chain A and chain B) → 错误：未知命令语法错误` }])
  eq('T10 泛错误不改写（场景替换回放）', r.commands[0], 'view from (chain A and chain B)')
}

// ---- T11：0.46 消费 prompt 与 0.45 判定不串线——消费 prompt（无「执行失败了，请修正」字样）----
{
  // 消费 prompt 不含 0.45 触发词 → 不会误入 0.45 分支（0.46 优先命中并正常返回）
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1PHO, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- interface A B → 选择为空（B: 0 原子）\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  99 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T11 消费 prompt 走 0.46（不被 0.45 抢）', r.commands[0], 'interface A A')
  notIncludes('T11b 不带自动修正前缀文案', r.reply, '已按失败原因修正命令')
}

console.log(`\n== M 结果：${pass} PASS / ${fail} FAIL ==`)
process.exit(fail ? 1 : 0)
