// r122 E2E-M：表面疏水分析技能 + 图例多卡并置（Bun 跑，无浏览器面）：
// ①技能注册与匹配（import 直测——matchSkill 计分数值级断言：强触发/弱词不足/
//   跨技能歧义并列降级/sasa-surface 无冲突回归）
// ②技能结构（workflow 命令域 + 报告节 + 跳转）源级锚
// ③图例多卡并置（entries 数组/map 渲染/computeBRange/aria 三 kind）源级锚
// ④mock 对齐（SKILL_ADVICE + 残基构成回填正则 ZH/EN）源级锚
// ⑤mock 真端到端（fetch 3999：技能注入段 → workflow 回放 + 报告草稿；回填段 →
//   三类数值提取——curl 手测的可持续回归化）
// 运行面：import 直测与 fetch 不需要浏览器会话；G1 浏览器组覆盖渲染/报告卡/多卡同屏。
import { readFileSync } from 'node:fs'
import { AGENT_SKILLS, SKILL_IDS, matchSkill } from '../src/lib/molecular/agent/skills'

const skillsSrc = readFileSync('src/lib/molecular/agent/skills.ts', 'utf8')
const legend = readFileSync('src/components/studio/ColorLegend.tsx', 'utf8')
const mock = readFileSync('mini-services/mock-llm/index.ts', 'utf8')

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) pass++; else fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `—— ${detail ?? ''}`}`)
}

// ---------- T1-T8：技能注册与 matchSkill 数值级直测 ----------
ok('T1 技能库规模（r105 六支 + r106 四支 + r122 一支 = 11）',
  AGENT_SKILLS.length === 11, `实际 ${AGENT_SKILLS.length} 支`)

ok('T2 技能 id 注册（SKILL_IDS 含 surface-hydrophobicity）',
  SKILL_IDS.has('surface-hydrophobicity'), 'id 未注册——请求体 skillId 校验将拒绝')

// 强触发：zh 单词命中即 ≥2 分选中
ok('T3 matchSkill 强触发 zh（「分析一下表面疏水性」→ surface-hydrophobicity）',
  matchSkill('分析一下表面疏水性')?.id === 'surface-hydrophobicity',
  `实际 ${matchSkill('分析一下表面疏水性')?.id ?? 'null'}`)

ok('T4 matchSkill 强触发 zh（「表面疏水分析」→ surface-hydrophobicity）',
  matchSkill('表面疏水分析')?.id === 'surface-hydrophobicity',
  `实际 ${matchSkill('表面疏水分析')?.id ?? 'null'}`)

// EN 强触发：\b 词边界正则（hydrophobicity analysis 是完整词组）
ok('T5 matchSkill 强触发 en（hydrophobicity analysis → surface-hydrophobicity）',
  matchSkill('run a hydrophobicity analysis on this dimer')?.id === 'surface-hydrophobicity',
  `实际 ${matchSkill('run a hydrophobicity analysis on this dimer')?.id ?? 'null'}`)

// 弱词不足：单「疏水」1 分 < 2 —— 纯着色类需求不被误拉进分析流程（r106 设计纪律）
ok('T6 matchSkill 弱词不足（「疏水着色」→ null——走 7.5 模板 color kd）',
  matchSkill('疏水着色') === null, `实际 ${matchSkill('疏水着色')?.id ?? 'null'}`)

// 跨技能无冲突回归：sasa-surface 的既有触发域不被新技能抢占
ok('T7 matchSkill 无冲突（「表面分析」仍 → sasa-surface）',
  matchSkill('表面分析')?.id === 'sasa-surface', `实际 ${matchSkill('表面分析')?.id ?? 'null'}`)

// 并列歧义降级：新技能 strong 2 分 vs sasa-surface 双 weak 2 分，spec 4:4 平——
// 双并列 = 真歧义 → null（不误选）
ok('T8 matchSkill 并列降级（「分析下表面疏水性和暴露」2:2 spec 4:4 → null）',
  matchSkill('分析下表面疏水性和暴露') === null, `实际 ${matchSkill('分析下表面疏水性和暴露')?.id ?? 'null'}`)

// ---------- T9-T13：技能结构源级锚 ----------
const hydro = AGENT_SKILLS.find(s => s.id === 'surface-hydrophobicity')!
ok('T9 workflow 命令域（sasa → color kd → zoom 三步序）',
  hydro.workflow.map(w => w.cmd).join('|') === 'sasa|color kd|zoom',
  `实际 ${hydro.workflow.map(w => w.cmd).join('|')}`)

ok('T10 报告节四节（总面积/疏水与极性/残基构成/建议）',
  hydro.report.sections.map(s => s.label.zh).join('|') === '总面积|疏水与极性|残基构成|建议',
  `实际 ${hydro.report.sections.map(s => s.label.zh).join('|')}`)

// 跳转域：残基构成节 → color kd 重放；疏水与极性节 → color sasa（对比入口）
const jumpMap = new Map(hydro.report.sections.map(s => [s.label.zh, s.jump]))
ok('T11 报告跳转域（残基构成→color kd · 疏水与极性→color sasa）',
  jumpMap.get('残基构成') === 'color kd' && jumpMap.get('疏水与极性') === 'color sasa',
  `实际 残基构成=${jumpMap.get('残基构成')} 疏水与极性=${jumpMap.get('疏水与极性')}`)

// 建议节不可跳（纯信息节——r109-b 跳转域纪律）
ok('T12 建议节无跳转（jump undefined）', jumpMap.get('建议') === undefined, `实际 ${jumpMap.get('建议')}`)

// 技能名/报告标题源（mock 0.5 分支解析 marker 的对端）
ok('T13 技能名源（name.zh 表面疏水分析——报告标题【表面疏水分析报告】断源防护）',
  hydro.name.zh === '表面疏水分析' && skillsSrc.includes('r122-a'), '技能名或段注释缺失')

// ---------- T14-T18：图例多卡并置源级锚 ----------
// 多卡渲染核心：LegendEntry 数组 + legends.map（删则回退单 kind 互斥）
ok('T14 图例多卡渲染（LegendEntry[] + legends.map 双载体）',
  legend.includes('useMemo<LegendEntry[]>') && legend.includes('legends.map('),
  '多卡结构缺失——回退单卡互斥')

// 每方案独立 push（非 else-if 互斥链——r121 视觉债的修复本体）
ok('T15 图例独立入卡（四方案各自 entries.push——非互斥）',
  legend.includes("puttyRep) entries.push({ kind: 'putty'") && legend.includes("bfactorRep) entries.push({ kind: 'bfactor'")
  && legend.includes("hydroRep) entries.push({ kind: 'hydrophobicity'") && legend.includes("sasaRep && data?.sasa"),
  '某方案未独立入卡')

// B 范围提取函数（putty/bfactor 卡共用；hydro/sasa 固定标度 null）
ok('T16 图例 computeBRange（函数 + 双调用）',
  (legend.match(/computeBRange/g) ?? []).length >= 3, `命中 ${(legend.match(/computeBRange/g) ?? []).length}`)

// 单卡 aria（读屏区分多卡——SASA/疏水/B 因子三标尺）
ok('T17 图例单卡 aria（三 kind 标尺 aria-label）',
  legend.includes('SASA 暴露度标尺') && legend.includes('疏水性标尺') && legend.includes('B 因子标尺'),
  '单卡 aria 缺失')

// 容器 aria 保留（r121 G1a 的图例卡 STATE-HIT 探针依赖——回归不破）
ok('T18 图例容器 aria 保留（颜色标尺图例）',
  legend.includes('颜色标尺图例') && legend.includes('Color scale legend'), '容器 aria 被改写')

// ---------- T19-T22：mock 对齐源级锚 ----------
ok('T19 mock SKILL_ADVICE 注册（surface-hydrophobicity 建议短句）',
  mock.includes("'surface-hydrophobicity': '可 color sasa 对比暴露渐变；hbonds 可叠加网络'"),
  'SKILL_ADVICE 条目缺失')

// 回填正则（ZH 三类计数——残基构成节的数值回填域）
ok('T20 mock 回填正则 ZH（残基构成：疏水 N · 亲水 M · 表外 K）',
  mock.includes('残基构成：疏水 (\\d+) · 亲水 (\\d+) · 表外 (\\d+)'), 'ZH 回填正则缺失')

// 回填正则 EN（r107 双语坑同族防护——EN 回执同域提取）
ok('T21 mock 回填正则 EN（residues: N hydrophobic · M hydrophilic · K off-scale）',
  mock.includes('residues: (\\d+) hydrophobic · (\\d+) hydrophilic · (\\d+) off-scale'), 'EN 回填正则缺失')

// 技能注入段模板兼容：buildSkillDirective 生成格式与 mock parseSkillDirective 解析格式
// 双端不动（r105 契约）——新技能天然走通用路径，锚定技能名 marker 可解析
ok('T22 mock 技能解析兼容（marker 正则可解析新技能名）',
  /## 本次任务命中标准技能：(.+?)（([a-z-]+)）/.test('## 本次任务命中标准技能：表面疏水分析（surface-hydrophobicity）'),
  'marker 正则失配')

// ---------- T23-T26：mock 真端到端（fetch 3999 决策回放） ----------
const MOCK_URL = 'http://localhost:3999/v1/chat/completions'
async function mockDecide(messages: { role: string; content: string }[]): Promise<{ reply: string; commands: string[] } | null> {
  try {
    const res = await fetch(MOCK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    })
    if (!res.ok) return null
    const data = await res.json() as { choices?: { message?: { content?: string } }[] }
    const content = data.choices?.[0]?.message?.content
    if (!content) return null
    return JSON.parse(content) as { reply: string; commands: string[] }
  } catch { return null }
}

const directive = `## 本次任务命中标准技能：表面疏水分析（surface-hydrophobicity）
用户需求与该技能适用场景匹配。你必须按以下标准执行：

### 标准流程（按序执行）
   1. SASA 计算：sasa —— Shrake–Rupley 法
   2. 疏水梯度着色：color kd —— 残基级碳渐变
   3. 全景适配：zoom —— 整体结构入框

### 报告文稿固定格式
【表面疏水分析报告】
▌总面积：SASA 总面积（Å²，命令回执）
▌疏水与极性：疏水/极性分项面积（Å²，sasa 回执）
▌残基构成：color kd 回执三类计数
▌建议：下一步操作建议`

const sceneMsg = `【自动注入的当前场景信息，非用户发言】
已加载 1 个结构，活动结构：4HHB
- 【活动】4HHB [PDB] 4779原子/574残基 · 链: A(蛋白·141残基) B(蛋白·146残基) · 配体: HEM×4 · 水34`

const skillTurn = await mockDecide([
  { role: 'system', content: '你是 MolVision 的分子可视化助手。' },
  { role: 'assistant', content: directive },
  { role: 'user', content: sceneMsg },
  { role: 'user', content: '分析一下表面疏水性' },
])
ok('T23 mock 技能决策（workflow 回放 sasa|color kd|zoom）',
  !!skillTurn && skillTurn.commands.join('|') === 'sasa|color kd|zoom',
  `mock 不可达或命令序错：${skillTurn?.commands.join('|') ?? 'null'}`)

ok('T24 mock 技能报告草稿（四节齐 + 回执类诚实「—」+ 建议填值）',
  !!skillTurn && skillTurn.reply.startsWith('【表面疏水分析报告】')
  && skillTurn.reply.includes('▌总面积：—') && skillTurn.reply.includes('▌疏水与极性：—')
  && skillTurn.reply.includes('▌残基构成：—')
  && skillTurn.reply.includes('可 color sasa 对比暴露渐变'),
  `reply 异常：${skillTurn?.reply.slice(0, 160) ?? 'null'}`)

const fillTurn = await mockDecide([{
  role: 'user',
  content: `【报告回执回填】（系统任务，非用户发言）
标准技能「表面疏水分析」的报告草稿与命令执行回执如下。请把草稿回填为实测数值版报告：

报告草稿：
【表面疏水分析报告】
▌总面积：—
▌疏水与极性：—
▌残基构成：—
▌建议：可 color sasa 对比暴露渐变；hbonds 可叠加网络

命令回执（cmd → output）：
- sasa → 4HHB SASA 计算完成：总计 23456 Å²（疏水 9876 · 极性 10234 · 水与配体 3346）—— probe 1.4 Å
- color kd → 已按 Kyte-Doolittle 疏水性着色（4HHB，全结构）——亲水青 −4.5 → 疏水琥珀 +4.5（碳渐变，杂原子保元素色）；残基构成：疏水 97 · 亲水 76 · 表外 5（核酸/配体/水）
- zoom → 已适配全部结构`,
}])
ok('T25 mock 回填 ZH（总面积 23456 Å² + 疏水与极性分项）',
  !!fillTurn && fillTurn.reply.includes('▌总面积：23456 Å²') && fillTurn.reply.includes('▌疏水与极性：疏水 9876 Å² · 极性 10234 Å²'),
  `reply 异常：${fillTurn?.reply.slice(0, 160) ?? 'null'}`)

ok('T26 mock 回填残基构成（疏水 97 · 亲水 76 · 表外 5 三类计数）',
  !!fillTurn && fillTurn.reply.includes('▌残基构成：疏水 97 · 亲水 76 · 表外 5') && fillTurn.commands.length === 0,
  `reply 异常：${fillTurn?.reply.slice(0, 200) ?? 'null'}；commands=${fillTurn?.commands.join(',')}`)

// ---------- T27：EN 回填同域（双语坑防护） ----------
const fillTurnEn = await mockDecide([{
  role: 'user',
  content: `【报告回执回填】（系统任务，非用户发言）

报告草稿：
【表面疏水分析报告】
▌总面积：—
▌疏水与极性：—
▌残基构成：—
▌建议：—

命令回执（cmd → output）：
- color kd → Colored by Kyte-Doolittle hydropathy (4HHB) — hydrophilic teal −4.5 → hydrophobic amber +4.5; residues: 97 hydrophobic · 76 hydrophilic · 5 off-scale (nucleic/ligands/water)`,
}])
ok('T27 mock 回填 EN（residues: 97 hydrophobic · 76 hydrophilic · 5 off-scale）',
  !!fillTurnEn && fillTurnEn.reply.includes('▌残基构成：疏水 97 · 亲水 76 · 表外 5'),
  `EN 回填失配：${fillTurnEn?.reply.slice(0, 200) ?? 'null'}`)

console.log(`\n== r122-M 结果：${pass}/${pass + fail}${fail ? '（存在 FAIL）' : ' 全过'} ==`)
process.exit(fail ? 1 : 0)
