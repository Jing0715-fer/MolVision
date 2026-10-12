// r110 E2E-M：mock 直测（curl 级，Bun fetch）——0.45 真修正（r110-c 命令语义改写）+ r109 行为回归
// 注入段用真实 buildSkillDirective 组装（route 真实组装形态——r106-parallel 经验①纪律）
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

async function mockReply(messages: unknown[]): Promise<{ reply: string; commands: string[] }> {
  const res = await fetch(MOCK, { method: 'POST', headers: HDRS, body: JSON.stringify({ messages, max_tokens: 800 }) })
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content ?? ''
  try { return JSON.parse(content) } catch { return { reply: content, commands: [] } }
}

const lpSkill = AGENT_SKILLS.find(s => s.id === 'ligand-pocket')!
const ifSkill = AGENT_SKILLS.find(s => s.id === 'interface-analysis')!
const lpDirective = buildSkillDirective(lpSkill)
const ifDirective = buildSkillDirective(ifSkill)

// 场景消息（route 注入形态）：1UBQ 单链 A、无配体（ligand-pocket 失败的典型场景）
const scene1UBQ = { role: 'user', content: '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1UBQ\n- 【活动】1UBQ [PDB] 1230原子/76残基 · 链: A(蛋白·76残基) · 配体: 无 · 水58' }
// 场景：链 H/L（chain A/B 占位符不在场——场景替换可动）
const sceneHL = { role: 'user', content: '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1HLX\n- 【活动】1HLX [PDB] 1200原子/120残基 · 链: H(蛋白·60残基) L(蛋白·60残基) · 配体: 无 · 水12' }

// ---- T1：ligand 词级降级——contacts ligand | polymer 4.5（空选择 output）→ contacts polymer | polymer 4.5 ----
// G1 实测对齐：contacts 系真实文案是「Empty selection (A: 0 atoms, B: 602 atoms)」（contacts.ts:276）
// ——测试报文须与产品代码文案一致（r109 坑②的 output 变体：手写「命中 0 个原子」曾致判据漏 contacts 族）
const fixLigand = `刚才这些命令执行失败了，请修正（换正确的选择表达式 / 命令写法）后重新给出命令：\n- contacts ligand | polymer 4.5 → 错误：Empty selection (A: 0 atoms, B: 602 atoms)\n\n只给出修正后需要执行的命令，不要重复已成功的命令。`
{
  const r = await mockReply([{ role: 'assistant', content: lpDirective }, scene1UBQ, { role: 'user', content: fixLigand }])
  includes('T1 改写发生时新文案', r.reply, '已按失败原因修正命令')
  eq('T1 ligand → polymer 词级降级', r.commands[0], 'contacts polymer | polymer 4.5')
}
// ---- T1b：ZH 文案「选择为空（A: 0 原子…）」同触发（contacts.ts:276 中文形态）----
{
  const r = await mockReply([{ role: 'assistant', content: lpDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- contacts ligand | polymer 4.5 → 错误：选择为空（A: 0 原子，B: 602 原子）` }])
  eq('T1b ZH 选择为空 → polymer 降级', r.commands[0], 'contacts polymer | polymer 4.5')
}
// ---- T2：view from ligand → orient（G1 实测文案：Selection is empty——parser.ts:777/commands.ts:270 族）----
{
  const r = await mockReply([{ role: 'assistant', content: lpDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- view from ligand → 错误：Selection is empty` }])
  eq('T2 view from ligand → orient', r.commands[0], 'orient')
}
// ---- T3：zoom within 6 of (ligand) → zoom（整框兜底；文案 zoom 族「matched 0 atoms」）----
{
  const r = await mockReply([{ role: 'assistant', content: lpDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- zoom within 6 of (ligand) → 错误：Selection "ligand" matched 0 atoms (zoom needs a non-empty selection)` }])
  eq('T3 zoom within → zoom', r.commands[0], 'zoom')
}
// ---- T4：hbonds 烘焙 scope ligand → polymer（G1 实测文案：Scope selection is empty——commands.ts:2025 族）----
{
  const r = await mockReply([{ role: 'assistant', content: lpDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water → 错误：Scope selection is empty` }])
  eq('T4 hbonds scope ligand → polymer', r.commands[0], 'hbonds on 3.4 in byres(within 4.5 of (polymer)) and not water')
}
// ---- T5：链不存在（空选择 output + chain X、无 ligand）→ chains list 探测 ----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- contacts (chain A and polymer) | (chain Z and polymer) 4.5 → 错误：选择 "chain Z and polymer" 命中 0 个原子` }])
  eq('T5 链不存在 → chains list 探测', r.commands[0], 'chains list')
  includes('T5 改写文案（探测说明）', r.reply, '已按失败原因修正命令')
}
// ---- T6：非空选择错误（「链不存在」泛错误）→ 不改写保持 r109 场景替换行为 ----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, sceneHL, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- interface A B → 错误：链不存在` }])
  eq('T6 泛错误不改写（场景替换后原样）', r.commands[0], 'interface H L')
  includes('T6 未改写走 r109 文案', r.reply, '已按标准技能流程修正失败命令')
}
// ---- T7：EN output（matched 0 atoms）同触发改写 ----
{
  const r = await mockReply([{ role: 'assistant', content: lpDirective }, scene1UBQ, { role: 'user', content: `These commands just failed. Fix them:\n- view from ligand → Error: Selection "ligand" matched 0 atoms` }])
  eq('T7 EN 空选择 → orient', r.commands[0], 'orient')
  includes('T7 EN 改写文案', r.reply, 'fixed by failure cause')
}
// ---- T8：多命令混合——改写与场景替换并存（部分改写部分保留）----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, sceneHL, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- contacts ligand | polymer 4.5 → 错误：选择 "ligand" 命中 0 个原子\n- interface A B → 错误：链不存在` }])
  eq('T8a contacts ligand 降级 polymer', r.commands[0], 'contacts polymer | polymer 4.5')
  eq('T8b interface 场景替换（无改写）', r.commands[1], 'interface H L')
  includes('T8 混合改写文案', r.reply, '已按失败原因修正命令')
}
// ---- T9：无技能注入段的修正 prompt 不走 0.45（回归）----
{
  const r = await mockReply([{ role: 'user', content: '给链 A 上色' }, scene1UBQ, { role: 'user', content: fixLigand }])
  eq('T9 无注入段不走 0.45', r.reply.includes('已按失败原因修正命令'), false)
}

console.log(`\n== r110-M 结果：${fail === 0 ? 'PASS' : 'FAIL'}（${pass}/${pass + fail}） ==`)
if (fail > 0) process.exit(1)
