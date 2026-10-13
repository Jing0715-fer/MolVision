// r118 E2E-M：mock 直测（curl 级，Bun fetch）——r118-a「同文曾失败」对称守卫矩阵。
// app 侧 r117-b 短路（failedTexts 过滤）后 mock 的「N 条待执行」与 app 实际执行数出现
// 口径差（r117 G1a 实测：mock 说 1 待执行、app 跳过 1 执行 0）——mock 0.46 从失败节提取
// failCmds，重组产物同文即丢弃 + 两类丢弃（ok 重复 / 同文失败）独立计数进 reply。
// 矩阵：主场景（近中心 view from 恒同文）/ 混合三分类 / EN 文案 / 错链重组不误丢 /
// 产物与另一条失败同文 / ok-fail 重叠 ok 优先 / 视觉演练分支回归 / 纯 ok 丢弃零回归。
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

// ---- T1：同文曾失败主场景（r117 G1a 二轮同款）——失败 view from (chain A and chain A)
// 全有效链 → 重组恒同文（近中心几何 error 重跑必再败）→ 丢弃 + 0 待执行 + 诚实计数。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- view from (chain A and chain A) → 错误：选择近似中心，方向无意义\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n- interface A A → 界面残基 689/689\n- zoom chain A, 5 → 已聚焦\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T1a 同文失败产物丢弃（零命令）', r.commands.length, 0)
  includes('T1b 同文跳过计数（1 条）', r.reply, '1 条与既往失败命令同文已跳过')
  includes('T1c 待执行口径与 app 短路后一致（0 条）', r.reply, '0 条待执行')
}

// ---- T2：混合三分类——3 失败各走一条路：interface A B 重组保留 / view from 同文丢 /
// zoom chain B, 5 重组为已成功同名（ok 丢）→ 1 待执行 + 双计数同句诚实上报。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- interface A B → 选择为空（B: 0 原子）\n- view from (chain A and chain A) → 错误：选择近似中心，方向无意义\n- zoom chain B, 5 → 命中 0 个原子\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n- zoom chain A, 5 → 已聚焦\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T2a 混合场景唯一保留产物', r.commands.join('|'), 'interface A A')
  includes('T2b ok 重复计数（1 条）', r.reply, '1 条与已成功命令重复已跳过')
  includes('T2c 同文失败计数（1 条）', r.reply, '1 条与既往失败命令同文已跳过')
}

// ---- T3：EN 同文丢弃文案——与 app 侧 r117-b 文案同款（"N skipped as prior same-text
// failures"），双侧口径对齐的文案锚。
{
  const r = await mockReply([{ role: 'user', content: `The chain list has been probed. Recompose the failed commands per the list and give them again (substitute chain IDs that actually exist):\n- view from (chain A and chain A) → Error: direction is meaningless\n- zoom chain Z, 5 → Error: matched 0 atoms\n\nchains list output:\nChain groups (1 total, 0 hidden):\n  ◉  00  A   protein  690 residues\n\nKey output of already-successful commands (do not repeat them when recomposing):\n- zoom chain A, 5 → focused\n\nOnly give the recomposed commands to run; do not repeat the successful ones.` }])
  eq('T3a EN 同文丢弃（零命令）', r.commands.length, 0)
  includes('T3b EN 同文跳过文案', r.reply, '1 skipped as prior same-text failures')
  includes('T3c EN ok 重复跳过文案', r.reply, '1 skipped as duplicates of already-successful commands')
}

// ---- T4：错链失败重组不同文不误丢（防过度丢弃回归锚）——zoom chain Z, 5 无 ok 节
// → 重组 zoom chain A, 5 与失败文本不同 → 保留执行（救济的本义：错链才需要重组）。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- zoom chain Z, 5 → 命中 0 个原子\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T4 错链重组保留执行', r.commands.join('|'), 'zoom chain A, 5')
  notIncludes('T4b 无丢弃不带跳过文案', r.reply, '已跳过')
}

// ---- T5：重组产物与「另一条」失败同文——failed A: zoom chain B, 5（重组 → zoom chain A, 5）
// + failed B: zoom chain A, 5（以该文本失败过）→ 产物与既往失败同文 → 丢弃
// （app 侧 failedTexts 同款语义：那条命令已经以同样文本失败过）。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- zoom chain B, 5 → 命中 0 个原子\n- zoom chain A, 5 → 错误：距离参数越界\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T5a 产物与他条失败同文丢弃', r.commands.length, 0)
  includes('T5b 同文跳过计数（1 条）', r.reply, '1 条与既往失败命令同文已跳过')
}

// ---- T6：ok 与 fail 重叠时 ok 优先——同一文本先失败（fail 节）后成功（ok 节，结构
// 切换后重执成功的真实序列）→ 重组产物按 ok 丢弃计数（不冒充同文失败——最终态是成功）。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- zoom chain B, 5 → 命中 0 个原子\n- zoom chain A, 5 → 命中 0 个原子\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n- zoom chain A, 5 → 已聚焦\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T6a ok-fail 重叠按 ok 丢弃（零命令）', r.commands.length, 0)
  includes('T6b ok 重复计数口径', r.reply, '1 条与已成功命令重复已跳过')
  notIncludes('T6c 不冒充同文失败口径', r.reply, '与既往失败命令同文')
}

// ---- T7：视觉链域演练回归——0.46 文本分支改动不侵入视觉分支（分支顺序锚；
// 消费救济链的驱动器保持不变）。
{
  const r = await mockVisionReply('fail drill chain: analyze the interface between chain A and chain B')
  eq('T7a 演练修正命令 zoom chain Z, 5 不变', r.commands[0], 'zoom chain Z, 5')
  eq('T7b 演练修正命令 interface A Z 不变', r.commands[1], 'interface A Z')
}

// ---- T8：r115-d 纯 ok 丢弃零回归——无同文失败在场时行为与 r115 完全一致
// （okOuts 防重发防线独立生效，不因新守卫引入额外丢弃）。
{
  const r = await mockReply([{ role: 'assistant', content: ifDirective }, scene1A2N, { role: 'user', content: `链清单已探测，请按清单重组刚才失败的命令后重新给出（链号换成清单中实际存在的链）：\n- color red, chain Z → 未找到链 Z\n- select chain Z → 未找到链 Z\n\nchains list 输出：\n链组（1 个，隐藏 0 个）：\n  ◉  00  A   蛋白  690 残基\n\n已成功命令的关键输出（重组时不要重复这些命令）：\n- color red, chain A → 已着色 3319 原子\n\n只给出重组后需要执行的命令，不要重复已成功的命令。` }])
  eq('T8a 错链重组保留（select chain A）', r.commands.join('|'), 'select chain A')
  includes('T8b ok 重复计数不变', r.reply, '1 条与已成功命令重复已跳过')
  notIncludes('T8c 无同文失败不带走样文案', r.reply, '与既往失败命令同文')
}

console.log(`\n== M 结果：${pass} PASS / ${fail} FAIL ==`)
process.exit(fail ? 1 : 0)
