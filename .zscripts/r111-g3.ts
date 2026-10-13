// r111 E2E-G3：纯函数直测——previewExprFromJumpCmd（r111-b 报告节 hover 预览选择子）
// + reportSectionJumpCmd/buildReportFillPrompt 回归抽样（r109-g3.ts 同款断言保持）
import { AGENT_SKILLS, reportSectionJumpCmd, previewExprFromJumpCmd, buildReportFillPrompt, REPORT_FILL_MARKER } from '../src/lib/molecular/agent/skills'

let pass = 0, fail = 0
const eq = (name: string, actual: unknown, expected: unknown) => {
  const ok = actual === expected
  if (ok) pass++; else fail++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${ok ? '' : `—— 实测 ${JSON.stringify(actual)} 期望 ${JSON.stringify(expected)}`}`)
}

// ---- 1. previewExprFromJumpCmd：view from 形态 ----
eq('view from 裸词', previewExprFromJumpCmd('view from ligand'), 'ligand')
eq('view from 包裹括号剥一层', previewExprFromJumpCmd('view from (chain A and chain B)'), 'chain A and chain B')
eq('view from 单包裹括号', previewExprFromJumpCmd('view from (ligand)'), 'ligand')
eq('view from 嵌套包裹剥外层', previewExprFromJumpCmd('view from ((chain A) and (chain B))'), '(chain A) and (chain B)')
eq('view from 非包裹并列不剥', previewExprFromJumpCmd('view from (chain A) or (chain B)'), '(chain A) or (chain B)')
eq('view from 前后空白', previewExprFromJumpCmd('  view from ligand  '), 'ligand')
eq('VIEW FROM 大小写不敏感', previewExprFromJumpCmd('VIEW FROM ligand'), 'ligand')

// ---- 2. previewExprFromJumpCmd：zoom within 形态 ----
eq('zoom within 括号目标', previewExprFromJumpCmd('zoom within 6 of (ligand)'), 'ligand')
eq('zoom within 复杂括号目标', previewExprFromJumpCmd('zoom within 8 of (resi 100 around 4)'), 'resi 100 around 4')
eq('zoom within 裸词目标', previewExprFromJumpCmd('zoom within 6 of ligand'), 'ligand')
eq('zoom within 包裹链对', previewExprFromJumpCmd('zoom within 6 of (chain A and chain C)'), 'chain A and chain C')

// ---- 3. previewExprFromJumpCmd：结构级/静态命令 → null（不预览）----
eq('裸 zoom 不预览', previewExprFromJumpCmd('zoom'), null)
eq('orient 不预览', previewExprFromJumpCmd('orient'), null)
eq('ray 不预览', previewExprFromJumpCmd('ray 2400'), null)
eq('preset 不预览', previewExprFromJumpCmd('preset publication'), null)
eq('color sasa 不预览', previewExprFromJumpCmd('color sasa'), null)
eq('ensemble play 不预览', previewExprFromJumpCmd('ensemble play'), null)
eq('空串不预览', previewExprFromJumpCmd(''), null)
eq('链组命令不预览', previewExprFromJumpCmd('chains list'), null)

// ---- 4. reportSectionJumpCmd 回归抽样（r109-b 既有行为不退化）----
eq('口袋残基 view 回放命中', reportSectionJumpCmd('ligand-pocket', '口袋残基', ['contacts ligand | polymer 4.5', 'view from ligand']), 'view from ligand')
eq('带▌前缀 ZH 标签（G1 形态）', reportSectionJumpCmd('ligand-pocket', '▌口袋残基', ['view from ligand']), 'view from ligand')
eq('EN 标签匹配', reportSectionJumpCmd('interface-analysis', 'Interface chains', ['view from (chain A and chain C)']), 'view from (chain A and chain C)')
eq('静态 zoom 兜底', reportSectionJumpCmd('hbond-network', 'H-bond count', []), 'zoom')
eq('无 jump 节不跳', reportSectionJumpCmd('structure-survey', '链组成', []), null)

// ---- 5. buildReportFillPrompt 回归抽样（r107 两段式回填不退化）----
const fp = buildReportFillPrompt(AGENT_SKILLS[0], '【配体口袋分析报告】\n▌接触对：—', [{ cmd: 'contacts ligand | polymer 4.5', output: '91 residue-pair contacts' }], 'H-bond network: currently 494 bonds')
eq('回填 prompt 标记开头', fp.startsWith(REPORT_FILL_MARKER), true)
eq('回填 prompt 含回执行', fp.includes('contacts ligand | polymer 4.5 → 91 residue-pair contacts'), true)
eq('回填 prompt 含运行时补充', fp.includes('运行时补充：H-bond network: currently 494 bonds'), true)

console.log(`\n== G3 结果：${pass} PASS / ${fail} FAIL ==`)
process.exit(fail ? 1 : 0)
