// r109 E2E-M：mock 直测（curl 级，Bun fetch）——0.45 修正轮技能上下文 + 链替换 + 0.5/0.4 回归
// 注入段用真实 buildSkillDirective 组装（route 真实组装形态——r106-parallel 经验①纪律）
import { AGENT_SKILLS, buildSkillDirective, REPORT_FILL_MARKER, buildReportFillPrompt } from '../src/lib/molecular/agent/skills'

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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `—— 实测 ${JSON.stringify(String(hay).slice(0, 200))} 缺「${needle}」`}`)
}

async function mockReply(messages: unknown[]): Promise<{ reply: string; commands: string[] }> {
  const res = await fetch(MOCK, { method: 'POST', headers: HDRS, body: JSON.stringify({ messages, max_tokens: 800 }) })
  const data = await res.json() as { choices?: { message?: { content?: string } }[] }
  const content = data.choices?.[0]?.message?.content ?? ''
  try { return JSON.parse(content) } catch { return { reply: content, commands: [] } }
}

const ifSkill = AGENT_SKILLS.find(s => s.id === 'interface-analysis')!
const lpSkill = AGENT_SKILLS.find(s => s.id === 'ligand-pocket')!
const directive = buildSkillDirective(ifSkill)

// 场景消息（route 注入形态）：链 H/L（A/B 均不在场——全量替换条件）
const sceneHL = { role: 'user', content: '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1HLX\n- 【活动】1HLX [PDB] 1200原子/120残基 · 链: H(蛋白·60残基) L(蛋白·60残基) · 配体: 无 · 水12' }
// 场景（A 在场）：chain B → C 的半量替换条件
const sceneAC = { role: 'user', content: '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1ACX\n- 【活动】1ACX [PDB] 900原子/90残基 · 链: A(蛋白·50残基) C(蛋白·40残基) · 配体: 无 · 水5' }

// ---- T1：0.45 修正轮分支（技能上下文在场 + 失败命令行）----
const fixPromptZH = `刚才这些命令执行失败了，请修正（换正确的选择表达式 / 命令写法）后重新给出命令：\n- interface A B → 错误：链不存在\n\n只给出修正后需要执行的命令，不要重复已成功的命令。`
{
  const r = await mockReply([{ role: 'assistant', content: directive }, sceneHL, { role: 'user', content: fixPromptZH }])
  includes('T1 回执为技能上下文修正文案', r.reply, '已按标准技能流程修正失败命令')
  eq('T1 修正命令数 1', r.commands.length, 1)
  eq('T1 interface A B → H L（链全量替换）', r.commands[0], 'interface H L')
}
// ---- T2：0.45 链半量替换（A 在场：chain B → C，interface A B 不动）----
{
  const fixPrompt2 = `刚才这些命令执行失败了，请修正（换正确的选择表达式 / 命令写法）后重新给出命令：\n- contacts (chain A and polymer) | (chain B and polymer) 4.5 → 错误：链不存在\n- view from (chain A and chain B) → 错误：链不存在`
  const r = await mockReply([{ role: 'assistant', content: directive }, sceneAC, { role: 'user', content: fixPrompt2 }])
  eq('T2 chain B → C（A 在场不动）', r.commands[0], 'contacts (chain A and polymer) | (chain C and polymer) 4.5')
  eq('T2 view chain B → C', r.commands[1], 'view from (chain A and chain C)')
}
// ---- T3：0.45 EN 修正 prompt 识别 ----
{
  const fixPromptEN = `These commands just failed. Fix them (correct selection expressions / command syntax) and give the commands again:\n- interface A B → Error: chain not found\n\nOnly give the corrected commands to run; do not repeat the successful ones.`
  const r = await mockReply([{ role: 'assistant', content: directive }, sceneHL, { role: 'user', content: fixPromptEN }])
  includes('T3 EN 修正轮同走 0.45', r.reply, 'corrected within the standard skill workflow')
  eq('T3 链替换同为 H L', r.commands[0], 'interface H L')
}
// ---- T4：无技能注入段的修正 prompt 走旧关键词模板（0.45 零影响回归）----
{
  const r = await mockReply([{ role: 'user', content: '给链 A 上色' }, sceneAC, { role: 'user', content: fixPromptZH }])
  eq('T4 无注入段修正轮不走 0.5 全回放', r.reply.includes('【界面分析报告】'), false)
}
// ---- T5：0.5 workflow 命令链替换（H/L 场景，A/B 均不在场）----
{
  const r = await mockReply([{ role: 'assistant', content: directive }, sceneHL, { role: 'user', content: '分析蛋白蛋白互作界面' }])
  includes('T5 报告标题在', r.reply, '【界面接触分析报告】')
  const iface = r.commands.find((c: string) => c.startsWith('interface '))
  eq('T5 workflow interface A B → H L', iface, 'interface H L')
  const contacts = r.commands.find((c: string) => c.startsWith('contacts '))
  eq('T5 workflow chain A/B → H/L', contacts, 'contacts (chain H and polymer) | (chain L and polymer) 4.5')
  const view = r.commands.find((c: string) => c.startsWith('view from '))
  eq('T5 workflow view 链替换', view, 'view from (chain H and chain L)')
}
// ---- T6：0.5 A 在场场景（部分替换）+ 报告节值回归 ----
{
  const r = await mockReply([{ role: 'assistant', content: directive }, sceneAC, { role: 'user', content: '分析蛋白蛋白互作界面' }])
  const iface = r.commands.find((c: string) => c.startsWith('interface '))
  eq('T6 interface A B 原样（A 在场）', iface, 'interface A B')
  const contacts = r.commands.find((c: string) => c.startsWith('contacts '))
  eq('T6 contacts 半量替换', contacts, 'contacts (chain A and polymer) | (chain C and polymer) 4.5')
  includes('T6 界面链对节填 A-C', r.reply, '▌界面链对：A-C')
}
// ---- T7：0.4 回填分支回归（r107 断言 + statLine 回执双源）----
{
  const lp = buildSkillDirective(lpSkill)
  const draft = `【配体口袋分析报告】\n▌结构与配体：4HHB + HEM×4\n▌口袋残基：—\n▌氢键：—\n▌接触对：—\n▌建议：—`
  const receipts = [
    { cmd: 'contacts ligand | polymer 4.5', output: '91 对残基接触 · 最近 D:HEM148 ↔ D:LYS66 2.06 Å' },
    { cmd: 'hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water', output: 'H-bond network: currently 494 bonds (0 water-involved)' },
  ]
  const fillMsg = buildReportFillPrompt(lpSkill, draft, receipts, '')
  const r = await mockReply([{ role: 'assistant', content: lp }, { role: 'user', content: fillMsg }])
  includes('T7 口袋残基回填 91 对', r.reply, '▌口袋残基：91 对（最近 D:HEM148 ↔ D:LYS66 2.06 Å）')
  includes('T7 氢键从回执 statLine 回填（r109-a 回执源）', r.reply, '▌氢键：494 条')
  includes('T7 草稿已有值不覆盖', r.reply, '▌结构与配体：4HHB + HEM×4')
  eq('T7 回填 commands 恒空', r.commands.length, 0)
}
// ---- T8：无 hbonds 命令的技能（sasa）0.5 正常路径零回归 ----
{
  const sasaSkill = AGENT_SKILLS.find(s => s.id === 'sasa-surface')!
  const r = await mockReply([{ role: 'assistant', content: buildSkillDirective(sasaSkill) }, sceneHL, { role: 'user', content: '分析表面暴露程度' }])
  includes('T8 sasa 报告在', r.reply, '【表面暴露分析报告】')
  includes('T8 总面积占位 —', r.reply, '▌总面积：—')
  eq('T8 sasa 命令 3 条', r.commands.length, 3)
}

console.log(`\n== M 结果：${pass} PASS / ${fail} FAIL ==`)
process.exit(fail ? 1 : 0)
