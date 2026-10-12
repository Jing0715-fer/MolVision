// r109 真实 LLM A/B：两段式回填数值质量（r108 建议第 2 项——真实 GLM 的回填数值准确性）
// 报文形态对齐 route 真实组装（r106-parallel 经验①）：skillId 注入 + ZH 用户消息（ZH locale）
// 第二段：buildReportFillPrompt 组回填消息（EN 回执 + ZH 草稿——跨语执行实测）
// （回填 prompt 一律走真实函数组装——手抄 prompt 会与产品代码漂移，本轮实测教训）
import { AGENT_SKILLS, buildReportFillPrompt } from '../src/lib/molecular/agent/skills'

const BASE = 'http://localhost:3000/api/agent'

let pass = 0, fail = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${ok ? '' : `—— 实测 ${JSON.stringify(actual)} 期望 ${JSON.stringify(expected)}`}`)
}
const includes = (name: string, hay: string, needle: string) => {
  const ok = hay.includes(needle)
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `—— 缺「${needle}」`}`)
}

async function call(body: unknown): Promise<{ reply: string; commands: string[] } | null> {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': 'NEXT_LOCALE=zh' },
    body: JSON.stringify(body),
  })
  const data = await res.json() as { ok: boolean; decision?: { reply: string; commands: string[] }; error?: string }
  if (!data.ok || !data.decision) { console.log('  API err:', data.error ?? res.status); return null }
  return data.decision
}

// ---------- 技能样本 1：ligand-pocket（EN 回执 → ZH 报告跨语回填） ----------
{
  console.log('== 样本 1：ligand-pocket（真实 GLM-4.6） ==')
  const scene = '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：4HHB\n- 【活动】4HHB [PDB] 4779原子/574残基 · 链: A(蛋白·141残基) B(蛋白·146残基) C(蛋白·141残基) D(蛋白·146残基) · 配体: HEM×4 PO4×2 · 水56'
  const d1 = await call({
    messages: [{ role: 'user', content: '分析一下配体结合口袋' }],
    scene,
    skillId: 'ligand-pocket',
  })
  if (!d1) { eq('样本1 第一段决策到达', false, true) } else {
    eq('样本1 第一段决策到达', true, true)
    includes('样本1 报告以固定标题开头', d1.reply, '【配体口袋分析报告】')
    includes('样本1 5 节行结构', d1.reply, '▌结构与配体：')
    includes('样本1 回执类节合规占位', d1.reply, '▌口袋残基：')
    eq('样本1 commands 非空', d1.commands.length > 0, true)

    // 第二段：EN 回执（浏览器 G1 实测原值）→ ZH 报告（真实函数组装——与产品代码零漂移）
    const draft = d1.reply
    const receipts = [
      { cmd: 'contacts ligand | polymer 4.5', output: '91 residue-pair contacts (A: 174 ↔ B: 4384 atoms, cutoff 4.5 Å, 5 ms) · nearest D:HEM148 ↔ D:LYS66 2.06 Å' },
      { cmd: 'hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water', output: 'H-bonds baked to scope "byres(within 4.5 of (ligand)) and not water" (within 957 atoms, distance limit 3.4 Å)\nH-bond network: currently 494 bonds (0 water-involved)' },
    ]
    const fillPrompt = buildReportFillPrompt(AGENT_SKILLS.find(s => s.id === 'ligand-pocket')!, draft, receipts, '氢键网络当前 494 条（其中涉水 0）')
    const d2 = await call({ messages: [{ role: 'user', content: fillPrompt }], scene })
    if (!d2) { eq('样本1 第二段回填到达', false, true) } else {
      eq('样本1 第二段回填到达', true, true)
      includes('样本1 回填后标题保持', d2.reply, '【配体口袋分析报告】')
      includes('样本1 口袋残基回填 91（EN 回执→ZH 报告跨语）', d2.reply, '91')
      includes('样本1 氢键回填 494', d2.reply, '494')
      includes('样本1 最近残基对与距离回填', d2.reply, '2.06')
      eq('样本1 回填 commands 恒空', d2.commands.length, 0)
    }
  }
}

// ---------- 技能样本 2：interface-analysis（链场景替换 + bsa 回执） ----------
{
  console.log('== 样本 2：interface-analysis（真实 GLM-4.6） ==')
  const scene = '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：4HHB\n- 【活动】4HHB [PDB] 4779原子/574残基 · 链: A(蛋白·141残基) C(蛋白·141残基) D(蛋白·146残基) · 配体: 无 · 水56'
  const d1 = await call({
    messages: [{ role: 'user', content: '分析 A 链和 C 链的蛋白蛋白互作界面' }],
    scene,
    skillId: 'interface-analysis',
  })
  if (!d1) { eq('样本2 第一段决策到达', false, true) } else {
    eq('样本2 第一段决策到达', true, true)
    includes('样本2 报告标题', d1.reply, '【界面接触分析报告】')
    // 真实 LLM 按 check 提示把 A/B 模板链换成场景链（A/C 在场）——interface 命令应含 A C
    const iface = d1.commands.find(c => /^interface\s/i.test(c.trim()))
    console.log('  样本2 interface 命令实测:', iface)
    eq('样本2 interface 命令含场景链 A C', iface ? /A\s+C|C\s+A/.test(iface) : false, true)
  }
}

console.log(`\n== 真实 LLM A/B 结果：${pass} PASS / ${fail} FAIL ==`)
process.exit(fail ? 1 : 0)
