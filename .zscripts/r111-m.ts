// r111 E2E-M：mock 直测（curl 级，Bun fetch）——r111-c 链族扩容（未找到链/Chain not found → chains list）
// + r110 空选择族/ligand 降级回归。注入段用真实 buildSkillDirective 组装（route 真实组装形态纪律）
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

const ifSkill = AGENT_SKILLS.find(s => s.id === 'interface-analysis')!
const lpSkill = AGENT_SKILLS.find(s => s.id === 'ligand-pocket')!
const ifDirective = buildSkillDirective(ifSkill)
const lpDirective = buildSkillDirective(lpSkill)

// 场景消息（route 注入形态）：1UBQ 单链 A（链 Z 不在场的典型场景）
const scene1UBQ = { role: 'user', content: '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1UBQ\n- 【活动】1UBQ [PDB] 1230原子/76残基 · 链: A(蛋白·76残基) · 配体: 无 · 水58' }

// ---- T1：r111-c 链族 ZH——chains hide Z（未找到链 Z——可用链：A，commands.ts:328 实抄文案）→ chains list ----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正（换正确的选择表达式 / 命令写法）后重新给出命令：\n- chains hide Z → 错误：未找到链 Z——可用链：A\n\n只给出修正后需要执行的命令，不要重复已成功的命令。` }])
  eq('T1 chains hide Z → chains list（ZH 链族）', r.commands[0], 'chains list')
  includes('T1 改写文案（rewrote 分支）', r.reply, '已按失败原因修正命令')
}

// ---- T2：r111-c 链族 EN——Chain Z not found — available: A（EN 实抄文案）→ chains list ----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1UBQ, { role: 'user', content: `These commands just failed. Fix them (use a correct selection expression or command form) and reissue the commands:\n- chains hide Z → error: Chain Z not found — available: A\n\nOnly give the corrected commands; do not repeat successful ones.` }])
  eq('T2 chains hide Z → chains list（EN 链族）', r.commands[0], 'chains list')
}

// ---- T3：链族对无 chain 词式命令同样成立（interface A Z 失败报未找到链 → chains list——文案族单列优先于命令形态规则）----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- contacts (chain A) | (chain Z) 4.5 → 错误：未找到链 Z——可用链：A` }])
  eq('T3 interface 链族（无 chain 词式）→ chains list', r.commands[0], 'chains list')
}

// ---- T4：r110 回归——空选择族 ligand 词级降级不受链族分支抢（两族文案互斥）----
{
  const r = await mockReply([{ role: 'assistant', content: lpDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- contacts ligand | polymer 4.5 → 错误：Empty selection (A: 0 atoms, B: 602 atoms)` }])
  eq('T4 空选择族 ligand → polymer（回归）', r.commands[0], 'contacts polymer | polymer 4.5')
}

// ---- T5：r110 回归——view from ligand → orient（空选择 view 族不被链族抢）----
{
  const r = await mockReply([{ role: 'assistant', content: lpDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- view from ligand → 错误：Selection is empty` }])
  eq('T5 view from ligand → orient（回归）', r.commands[0], 'orient')
}

// ---- T6：r110 回归——泛错误（非空选择非链族）不改写走场景替换 ----
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- view from (chain A and chain B) → 错误：未知命令语法错误` }])
  eq('T6 泛错误不改写（场景替换回放）', r.commands[0], 'view from (chain A and chain B)')
}

// ---- T7：链族与空选择混合报文——链族行改 chains list、空选择行 ligand 降级（各按各的文案族）----
{
  const r = await mockReply([{ role: 'assistant', content: lpDirective }, scene1UBQ, { role: 'user', content: `刚才这些命令执行失败了，请修正：\n- chains hide Z → 错误：未找到链 Z——可用链：A\n- contacts ligand | polymer 4.5 → 错误：Empty selection (A: 0 atoms, B: 602 atoms)` }])
  eq('T7a 链族行 → chains list', r.commands[0], 'chains list')
  eq('T7b 空选择行 → polymer 降级', r.commands[1], 'contacts polymer | polymer 4.5')
}

console.log(`\n== M 结果：${pass} PASS / ${fail} FAIL ==`)
process.exit(fail ? 1 : 0)
