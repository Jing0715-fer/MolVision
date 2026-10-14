// r111 真实 LLM 全量抽样：10 技能各 1 轮第一段实测（r108 建议第 2 项收口）
// 断言四维：决策到达 / 报告固定标题 / ▌节行结构 / 命令域（首命令族匹配）
// 第二段回填遵循在 r109 已双技能 14/14 验证（buildReportFillPrompt 本轮未改）不重跑
// 产出：遵循率矩阵（stdout + worklog 转录）
import { AGENT_SKILLS } from '../src/lib/molecular/agent/skills'

const BASE = 'http://localhost:3000/api/agent'

// 各技能的适测场景（场景事实驱动 LLM 报告填值与命令参数）
const SCENE_4HHB = '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：4HHB\n- 【活动】4HHB [PDB] 4779原子/574残基 · 链: A(蛋白·141残基) B(蛋白·146残基) C(蛋白·141残基) D(蛋白·146残基) · 配体: HEM×4 PO4×2 · 水56'
const SCENE_4HHB_AC = '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：4HHB\n- 【活动】4HHB [PDB] 4779原子/574残基 · 链: A(蛋白·141残基) C(蛋白·141残基) D(蛋白·146残基) · 配体: 无 · 水56'
const SCENE_1UBQ = '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1UBQ\n- 【活动】1UBQ [PDB] 1230原子/76残基 · 链: A(蛋白·76残基) · 配体: 无 · 水58'
const SCENE_1K4C = '【自动注入的当前场景信息，非用户发言】\n已加载 1 个结构，活动结构：1K4C\n- 【活动】1K4C [PDB] 跨膜蛋白 · 链: A(蛋白·跨膜区) · 配体: 无 · 水20'
const SCENE_TWO = '【自动注入的当前场景信息，非用户发言】\n已加载 2 个结构，活动结构：1UBQ\n- 【活动】1UBQ [PDB] 1230原子/76残基 · 链: A(蛋白·76残基) · 配体: 无 · 水58\n- 1D3Z [PDB] 602原子/57残基 · 链: A(蛋白·57残基) · 配体: 无 · 水0'
const SCENE_1BQL_2LYZ = '【自动注入的当前场景信息，非用户发言】\n已加载 2 个结构，活动结构：1BQL\n- 【活动】1BQL [PDB] 2100原子/130残基 · 链: A(蛋白·130残基) · 配体: 无 · 水10\n- 2LYZ [PDB] 1000原子/129残基 · 链: A(蛋白·129残基) · 配体: 无 · 水0'

interface Row { id: string; title: string; okArrive: boolean; okTitle: boolean; okSections: boolean; okCmds: boolean; note?: string }
const rows: Row[] = []

async function call(body: unknown, timeoutS = 75): Promise<{ reply: string; commands: string[] } | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutS * 1000)
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': 'NEXT_LOCALE=zh' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    const data = await res.json() as { ok: boolean; decision?: { reply: string; commands: string[] }; error?: string }
    if (!data.ok || !data.decision) { console.log('  API err:', data.error ?? res.status); return null }
    return data.decision
  } catch (e) {
    console.log('  fetch err:', (e as Error).message.slice(0, 80))
    return null
  } finally { clearTimeout(t) }
}

// 技能 → 触发消息 + 场景 + 首命令族断言（commands[0] 前缀）
const PLAN: { id: string; msg: string; scene: string; firstCmdRe: RegExp }[] = [
  { id: 'ligand-pocket', msg: '分析一下配体结合口袋', scene: SCENE_4HHB, firstCmdRe: /^(contacts|preset)\b/i },
  { id: 'hbond-network', msg: '分析氢键网络', scene: SCENE_4HHB, firstCmdRe: /^(hbonds|preset)\b/i },
  { id: 'interface-analysis', msg: '分析 A 链和 C 链的互作界面', scene: SCENE_4HHB_AC, firstCmdRe: /^(interface|contacts)\b/i },
  { id: 'pub-figure', msg: '导出一张出版级配图', scene: SCENE_4HHB, firstCmdRe: /^(preset|contacts)\b/i },
  { id: 'structure-survey', msg: '普查一下结构组分', scene: SCENE_4HHB, firstCmdRe: /^(chains|count)\b/i },
  { id: 'membrane-context', msg: '给这个膜蛋白做语境配图', scene: SCENE_1K4C, firstCmdRe: /^(orient|pca)\b/i },
  { id: 'sasa-surface', msg: '分析表面暴露', scene: SCENE_4HHB, firstCmdRe: /^(sasa|preset)\b/i },
  { id: 'xcontact-analysis', msg: '分析两个结构的跨结构互作', scene: SCENE_TWO, firstCmdRe: /^(superpose|xcontacts)\b/i },
  { id: 'morph-conformations', msg: '做两个构象的插值对比', scene: SCENE_1BQL_2LYZ, firstCmdRe: /^(morph|superpose)\b/i },
  { id: 'symmetry-assembly', msg: '展示晶格对称组装', scene: SCENE_1UBQ, firstCmdRe: /^(symmetry|orient)\b/i },
]

for (const p of PLAN) {
  const skill = AGENT_SKILLS.find(s => s.id === p.id)!
  const row: Row = { id: p.id, title: skill.name.zh, okArrive: false, okTitle: false, okSections: false, okCmds: false }
  rows.push(row)
  console.log(`\n== ${p.id}（${skill.name.zh}） ==`)
  const t0 = Date.now()
  const d = await call({ messages: [{ role: 'user', content: p.msg }], scene: p.scene, skillId: p.id })
  const ms = Date.now() - t0
  row.note = `${ms}ms`
  if (!d) { console.log(`  FAIL 决策未到达（${ms}ms）`); continue }
  row.okArrive = true
  const wantTitle = `【${skill.name.zh}报告】`
  row.okTitle = d.reply.trim().startsWith(wantTitle)
  const secLines = d.reply.split('\n').filter((l: string) => l.trim().startsWith('▌')).length
  const wantSecs = skill.report.sections.length
  row.okSections = secLines >= Math.max(3, wantSecs - 1)
  row.okCmds = d.commands.length > 0 && p.firstCmdRe.test(d.commands[0].trim())
  console.log(`  arrive=${row.okArrive} title=${row.okTitle}（${wantTitle} vs ${d.reply.trim().slice(0, 20)}…） sections=${secLines}/${wantSecs} cmds=${row.okCmds}（${d.commands[0]?.slice(0, 40)}） ${ms}ms`)
}

// ---- 遵循率矩阵 ----
console.log('\n========== 遵循率矩阵（真实 GLM-4.6 · 10 技能全量第一段） ==========')
console.log('技能\t\t\t到达\t标题\t节行\t命令域\t时延')
for (const r of rows) {
  console.log(`${r.id.padEnd(20)}\t${r.okArrive ? '✓' : '✗'}\t${r.okTitle ? '✓' : '✗'}\t${r.okSections ? '✓' : '✗'}\t${r.okCmds ? '✓' : '✗'}\t${r.note ?? ''}`)
}
const total = rows.length
const full = rows.filter(r => r.okArrive && r.okTitle && r.okSections && r.okCmds).length
const arrive = rows.filter(r => r.okArrive).length
console.log(`\n汇总：决策到达 ${arrive}/${total}；四维全过 ${full}/${total}（${(full / total * 100).toFixed(0)}%）`)
process.exit(full === total ? 0 : 1)
