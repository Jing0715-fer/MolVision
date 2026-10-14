// r119 E2E-M：mock 直测（curl 级，Bun fetch）——r119-c「0 待执行」文案切换矩阵
// （r118 建议③收口）：mock 0.46 链清单消费分支在重组产物全部被丢弃（commands.length
// === 0）时改走「链清单核对完成 / Chain-list check complete」新文案——旧文案「无效链
// 已替换为 A——0 条待执行」在产物全丢弃时是伪陈述（没有任何命令真的被替换后执行）。
// 矩阵：ZH 新文案全锚 / EN 新文案全锚 / 1+ 待执行旧文案边界回归（恰 1 条保留）/
// 纯 ok 丢弃 0 待执行 / 视觉分支正交回归（0.46 文本分支改动不侵入视觉演练）。
// 旧 M 组（r110/r111/r114/r115/r116/r118）中 6 块 0 待执行场景断言已随行为同步
// （口径锚意图不变——r118 段「旧锚随单一来源重构同步」同款惯例）。
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

// ---- T1：ZH 0 待执行新文案全锚——近中心 view from 恒同文（全有效链重组无变化 →
// failCmds 丢弃）→ 零命令 + 「链清单核对完成」+ 分类计数 + 下一步建议；旧文案签名
// 「待执行 / 已替换为」在该路径整体退场（伪陈述防线）。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- view from (chain A and chain A) → 错误：选择近似中心，方向无意义\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T1a 同文失败零命令', r.commands.length, 0)
  includes('T1b 新文案标题（链清单核对完成）', r.reply, '链清单核对完成')
  includes('T1c 候选总数口径（1 条）', r.reply, '1 条候选命令')
  includes('T1d 分类计数（0 成功重复、1 失败同文）', r.reply, '（0 条成功重复、1 条失败同文）')
  includes('T1e 无可执行命令口径', r.reply, '无可执行命令')
  includes('T1f 下一步建议（人工核验链清单）', r.reply, '人工执行 chains list 核验后重试')
  notIncludes('T1g 旧文案签名退场（待执行）', r.reply, '待执行')
  notIncludes('T1h 伪陈述替换语退场', r.reply, '已替换为')
}

// ---- T2：EN 0 待执行新文案全锚——同场景英文消费 prompt（Chain-list consumption
// 同形）→ nothing to run + 分类计数 + 建议；EN 旧签名 replaced with 退场。
{
  const r = await mockReply([{ role: 'user', content: `The chain list has been probed. Recompose the failed commands per the list and give them again (substitute chain IDs that actually exist):\n- view from (chain A and chain A) → Error: direction is meaningless\n\nchains list output:\nChain groups (1 total, 0 hidden):\n  ◉  00  A   protein  690 residues\n\nOnly give the recomposed commands to run; do not repeat the successful ones.` }])
  eq('T2a EN 同文失败零命令', r.commands.length, 0)
  includes('T2b EN 新文案标题', r.reply, 'Chain-list check complete')
  includes('T2c EN 分类计数', r.reply, '(0 success duplicates, 1 failure same-text)')
  includes('T2d EN 无可执行命令口径', r.reply, 'nothing to run')
  includes('T2e EN 下一步建议', r.reply, 'run chains list manually and retry')
  notIncludes('T2f EN 伪陈述替换语退场', r.reply, 'replaced with')
}

// ---- T3：1+ 待执行旧文案边界回归——恰 1 条保留 0 丢弃（错链重组保留：救济本义）：
// 旧句式「已按链清单重组命令（…N 条待执行）」原样在场，新文案标题不出现（分支边界
// 锚：commands.length >= 1 走旧路径，0 走新路径——切换是精确的）。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- zoom chain Z, 5 → 命中 0 个原子\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T3a 错链重组保留执行', r.commands.join('|'), 'zoom chain A, 5')
  includes('T3b 旧文案标题在场（1+ 待执行路径）', r.reply, '已按链清单重组命令')
  includes('T3c 待执行计数（1 条）', r.reply, '1 条待执行')
  notIncludes('T3d 新文案标题不出现', r.reply, '链清单核对完成')
}

// ---- T4：纯 ok 丢弃 0 待执行——产物全部与已成功命令同名（r115-d okOuts 防重发
// 单独触发）→ 新文案 okDrop 分类计数（成功重复口径，非同文失败）。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- color red, chain Z → 未找到链 Z\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n- color red, chain A → 已着色 3319 原子\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T4a 纯 ok 丢弃零命令', r.commands.length, 0)
  includes('T4b ok 分类计数（1 成功重复、0 失败同文）', r.reply, '（1 条成功重复、0 条失败同文）')
}

// ---- T5：视觉分支正交回归——0.46 文本分支改动不侵入视觉演练分支（分支顺序锚；
// 消费救济链的驱动器保持不变，r118-m T7 同款防线）。
{
  const r = await mockVisionReply('fail drill chain: analyze the interface between chain A and chain B')
  eq('T5a 演练修正命令 zoom chain Z, 5 不变', r.commands[0], 'zoom chain Z, 5')
  eq('T5b 演练修正命令 interface A Z 不变', r.commands[1], 'interface A Z')
}

console.log(`\n== M 结果：${pass} PASS / ${fail} FAIL ==`)
process.exit(fail ? 1 : 0)
