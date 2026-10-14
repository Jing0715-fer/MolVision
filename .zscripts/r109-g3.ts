// r109 E2E-G3：纯函数直测（bun 直跑）——reportSectionJumpCmd 全分支 + 既有函数回归
import { AGENT_SKILLS, matchSkill, reportSectionJumpCmd, isSkillReport, buildReportFillPrompt, REPORT_FILL_MARKER } from '../src/lib/molecular/agent/skills'

let pass = 0, fail = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${ok ? '' : `—— 实测 ${JSON.stringify(actual)} 期望 ${JSON.stringify(expected)}`}`)
}

// ---- 1. 技能总数与 jump 覆盖回归 ----
eq('技能总数 10', AGENT_SKILLS.length, 10)
const jumpCount = AGENT_SKILLS.flatMap(s => s.report.sections).filter(s => s.jump).length
eq('jump 值总数 27', jumpCount, 27)
const jumpSkills = new Set(AGENT_SKILLS.flatMap(s => s.report.sections.some(x => x.jump) ? [s.id] : []))
eq('带跳转技能数 9（survey 无跳转）', jumpSkills.size, 9)

// ---- 2. reportSectionJumpCmd：回放类 ----
// view 回放：okCmds 含 view from ligand → 原样回放（场景实参已在其中）
eq('view 回放命中', reportSectionJumpCmd('ligand-pocket', '口袋残基', ['contacts ligand | polymer 4.5', 'view from ligand', 'deselect']), 'view from ligand')
// view 回放源缺失 → orient 静态兜底
eq('view 回放缺失兜底', reportSectionJumpCmd('ligand-pocket', '口袋残基', []), 'orient')
// orient 本身也是 view 类：workflow 只有 orient 时回放 orient
eq('orient 回放命中', reportSectionJumpCmd('membrane-context', '主轴方位', ['orient', 'membrane']), 'orient')
// zoom 回放：hbond-network workflow 的 zoom within 6 of (ligand)
eq('zoom 回放命中', reportSectionJumpCmd('hbond-network', '氢键条数', ['hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water', 'zoom within 6 of (ligand)']), 'zoom within 6 of (ligand)')
// zoom 回放源缺失 → bare zoom 兜底
eq('zoom 回放缺失兜底', reportSectionJumpCmd('hbond-network', '氢键条数', []), 'zoom')
// ray 回放：pub-figure 导出规格
eq('ray 回放命中', reportSectionJumpCmd('pub-figure', '导出规格', ['preset publication', 'ray 2400']), 'ray 2400')
// ray 回放源缺失 → null（无兜底不跳）
eq('ray 回放缺失不跳', reportSectionJumpCmd('pub-figure', '导出规格', ['preset publication']), null)
// preset 回放
eq('preset 回放命中', reportSectionJumpCmd('pub-figure', '表示与配色', ['preset publication', 'bg white']), 'preset publication')

// ---- 3. reportSectionJumpCmd：静态类 ----
eq('静态命令原样', reportSectionJumpCmd('ligand-pocket', '氢键', []), 'zoom within 6 of (ligand)')
eq('静态 color sasa', reportSectionJumpCmd('sasa-surface', '疏水与极性', []), 'color sasa')
eq('静态 ensemble play', reportSectionJumpCmd('morph-conformations', '构象对', []), 'ensemble play')

// ---- 4. reportSectionJumpCmd：不跳分支 ----
eq('无 jump 节不跳', reportSectionJumpCmd('structure-survey', '链组成', []), null)
eq('advice 节不跳', reportSectionJumpCmd('ligand-pocket', '建议', []), null)
eq('无 skillId 不跳', reportSectionJumpCmd(undefined, '口袋残基', ['view from ligand']), null)
eq('非法 skillId 不跳', reportSectionJumpCmd('not-a-skill', '口袋残基', []), null)
eq('未注册标签不跳', reportSectionJumpCmd('ligand-pocket', '不存在的节', []), null)

// ---- 5. EN 标签双语匹配 ----
eq('EN 标签匹配', reportSectionJumpCmd('interface-analysis', 'Interface chains', ['view from (chain A and chain C)']), 'view from (chain A and chain C)')
eq('EN H-bond count', reportSectionJumpCmd('hbond-network', 'H-bond count', []), 'zoom')
eq('EN Top exposed', reportSectionJumpCmd('sasa-surface', 'Top exposed', ['sasa', 'color sasa', 'zoom']), 'zoom')

// ---- 5b. 带 ▌ 前缀的真实调用形态（G1 实测暴露的形态——函数单点剥离）----
eq('带▌前缀 ZH 标签', reportSectionJumpCmd('ligand-pocket', '▌口袋残基', ['view from ligand']), 'view from ligand')
eq('带▌前缀 EN 标签', reportSectionJumpCmd('hbond-network', '▌H-bond count', []), 'zoom')
eq('带▌前缀不跳节', reportSectionJumpCmd('ligand-pocket', '▌建议', []), null)

// ---- 6. 既有函数回归（r105-r107 断言抽样） ----
eq('matchSkill 口袋命中', matchSkill('分析一下配体结合口袋')?.id, 'ligand-pocket')
eq('matchSkill 界面命中', matchSkill('蛋白蛋白互作分析')?.id, 'interface-analysis')
eq('matchSkill 单弱词不触发', matchSkill('蛋白'), null)
eq('isSkillReport 认报告', isSkillReport('【配体口袋分析报告】\n▌结构与配体：—'), true)
eq('isSkillReport 不认散文', isSkillReport('好的，我来分析。'), false)
const fp = buildReportFillPrompt(AGENT_SKILLS[0], '【配体口袋分析报告】\n▌接触对：—', [{ cmd: 'contacts ligand | polymer 4.5', output: '91 对残基接触' }], '氢键网络当前 8 条')
eq('回填 prompt 标记开头', fp.startsWith(REPORT_FILL_MARKER), true)
eq('回填 prompt 含回执行', fp.includes('contacts ligand | polymer 4.5 → 91 对残基接触'), true)
eq('回填 prompt 含运行时补充', fp.includes('运行时补充：氢键网络当前 8 条'), true)

console.log(`\n== G3 结果：${pass} PASS / ${fail} FAIL ==`)
process.exit(fail ? 1 : 0)
