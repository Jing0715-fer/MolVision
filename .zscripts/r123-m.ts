// r123 E2E-M：putty 柔性分析技能 + hover 试穿 + 图例折叠（Bun 跑，无浏览器面）：
// ①技能注册与匹配（matchSkill 数值级直测：强触发 zh/en/弱词不足/跨技能无冲突回归）
// ②技能结构（workflow 三步序 + 报告四节 + 跳转域）源级锚
// ③hover 试穿基建（store previewScheme/setPreviewScheme/engine 接线与门控/面板
//   hover+focus+防抖+卸载恢复）源级锚
// ④图例折叠收纳（阈值/aria/键盘/短名）源级锚
// ⑤mock 对齐（SKILL_ADVICE + B 因子范围/高柔性回填正则 ZH+EN + 7.6 模板）源级锚
// ⑥mock 真端到端（fetch 3999：技能注入段 → workflow 回放 + 草稿；回填段 →
//   B 因子范围 + 高柔性双数值提取；弱词模板 → show putty + color bfactor）
// 运行面：import 直测与 fetch 不需要浏览器会话；G1 浏览器组覆盖渲染/试穿/报告卡。
import { readFileSync } from 'node:fs'
import { AGENT_SKILLS, SKILL_IDS, matchSkill } from '../src/lib/molecular/agent/skills'

const skillsSrc = readFileSync('src/lib/molecular/agent/skills.ts', 'utf8')
const storeSrc = readFileSync('src/lib/molecular/store.ts', 'utf8')
const engineSrc = readFileSync('src/lib/molecular/engine.ts', 'utf8')
const colorsPanelSrc = readFileSync('src/components/studio/panels/ColorsPanel.tsx', 'utf8')
const legendSrc = readFileSync('src/components/studio/ColorLegend.tsx', 'utf8')
const commandsSrc = readFileSync('src/lib/molecular/commands.ts', 'utf8')
const mock = readFileSync('mini-services/mock-llm/index.ts', 'utf8')

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) pass++; else fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `—— ${detail ?? ''}`}`)
}

// ---------- T1-T7：技能注册与 matchSkill 数值级直测 ----------
ok('T1 技能库规模（r105 六支 + r106 四支 + r122 一支 + r123 一支 = 12）',
  AGENT_SKILLS.length === 12, `实际 ${AGENT_SKILLS.length} 支`)

ok('T2 技能 id 注册（SKILL_IDS 含 flexibility-putty）',
  SKILL_IDS.has('flexibility-putty'), 'id 未注册——请求体 skillId 校验将拒绝')

// 强触发 zh：柔性分布（4 分——「柔性」弱词是其子串被去重，单强词命中即选中）
ok('T3 matchSkill 强触发 zh（「分析一下柔性分布」→ flexibility-putty）',
  matchSkill('分析一下柔性分布')?.id === 'flexibility-putty',
  `实际 ${matchSkill('分析一下柔性分布')?.id ?? 'null'}`)

// 强触发 zh：b因子分析（无空格形态——词形覆盖两种写法）
ok('T4 matchSkill 强触发 zh（「B因子分析」→ flexibility-putty）',
  matchSkill('B因子分析')?.id === 'flexibility-putty',
  `实际 ${matchSkill('B因子分析')?.id ?? 'null'}`)

// 强触发 en：\b 词边界（putty analysis 完整词组）
ok('T5 matchSkill 强触发 en（putty analysis → flexibility-putty）',
  matchSkill('run a putty analysis on this kinase')?.id === 'flexibility-putty',
  `实际 ${matchSkill('run a putty analysis on this kinase')?.id ?? 'null'}`)

// 强触发 en：b-factor analysis（连字符词组）
ok('T6 matchSkill 强触发 en（b-factor analysis → flexibility-putty）',
  matchSkill('do a b-factor analysis please')?.id === 'flexibility-putty',
  `实际 ${matchSkill('do a b-factor analysis please')?.id ?? 'null'}`)

// 弱词不足：单「柔性」1 分 < 2——纯表示需求不被误拉进分析流程（r106 设计纪律，
// 弱词场景落 mock 7.6 模板 show putty + color bfactor）
ok('T7 matchSkill 弱词不足（「用 putty 显示」→ null——走 7.6 模板）',
  matchSkill('用 putty 显示') === null, `实际 ${matchSkill('用 putty 显示')?.id ?? 'null'}`)

// ---------- T8-T9：跨技能无冲突回归 ----------
// sasa-surface 的「表面分析」触发域不被新技能抢占
ok('T8 matchSkill 无冲突（「表面分析」仍 → sasa-surface）',
  matchSkill('表面分析')?.id === 'sasa-surface', `实际 ${matchSkill('表面分析')?.id ?? 'null'}`)

// surface-hydrophobicity 的「疏水分析」触发域不被新技能抢占
ok('T9 matchSkill 无冲突（「疏水分析」仍 → surface-hydrophobicity）',
  matchSkill('疏水分析')?.id === 'surface-hydrophobicity', `实际 ${matchSkill('疏水分析')?.id ?? 'null'}`)

// ---------- T10-T14：技能结构源级锚 ----------
const flex = AGENT_SKILLS.find(s => s.id === 'flexibility-putty')!
ok('T10 workflow 命令域（show putty → color bfactor → zoom 三步序）',
  flex.workflow.map(w => w.cmd).join('|') === 'show putty|color bfactor|zoom',
  `实际 ${flex.workflow.map(w => w.cmd).join('|')}`)

ok('T11 报告节四节（B 因子范围/高柔性残基/管径映射/建议）',
  flex.report.sections.map(s => s.label.zh).join('|') === 'B 因子范围|高柔性残基|管径映射|建议',
  `实际 ${flex.report.sections.map(s => s.label.zh).join('|')}`)

// 跳转域：B 因子范围节 → color bfactor 静态重放；高柔性残基节 → zoom
const jumpMap = new Map(flex.report.sections.map(s => [s.label.zh, s.jump]))
ok('T12 报告跳转域（B因子范围→color bfactor · 高柔性残基→zoom）',
  jumpMap.get('B 因子范围') === 'color bfactor' && jumpMap.get('高柔性残基') === 'zoom',
  `实际 B因子范围=${jumpMap.get('B 因子范围')} 高柔性残基=${jumpMap.get('高柔性残基')}`)

// 建议节不可跳（纯信息节——r109-b 跳转域纪律）
ok('T13 建议节无跳转（jump undefined）', jumpMap.get('建议') === undefined, `实际 ${jumpMap.get('建议')}`)

// 技能名源（mock 0.5 分支解析 marker 的对端 + 报告标题【柔性分析报告】断源）
ok('T14 技能名源（name.zh 柔性分析——报告标题断源防护）',
  flex.name.zh === '柔性分析' && skillsSrc.includes('r123-c'), '技能名或段注释缺失')

// ---------- T15-T18：hover 试穿基建源级锚 ----------
// store：试穿态 + setter（colorRev 复用——着色级失效链触发引擎重建）
ok('T15 store 试穿态（ui.previewScheme 类型 + 默认 null）',
  storeSrc.includes('previewScheme: ColorScheme | null') && storeSrc.includes('previewScheme: null,'),
  '试穿态类型或默认值缺失')

ok('T16 store 试穿 setter（setPreviewScheme 声明 + colorRev bump 实现）',
  storeSrc.includes('setPreviewScheme: (scheme: ColorScheme | null) => void')
  && storeSrc.includes('setPreviewScheme: (scheme) => {'),
  'setter 声明或实现缺失')

// engine：试穿方案替代 + 活动结构门控（非活动结构不受试穿影响）
ok('T17 engine 试穿接线（previewing 三元 + activeId 门控）',
  engineSrc.includes('previewing ? uiState.previewScheme! : rep.colorScheme')
  && engineSrc.includes('entry.id === store.getState().activeId'),
  'engine 接线或门控缺失')

// 面板：hover 进入 + focus 键盘试穿 + 卸载恢复（防试穿态卡死）
ok('T18 面板试穿交互（hover + focus + 卸载恢复三件套）',
  colorsPanelSrc.includes('onMouseEnter={() => enterPreview(sc.key)}')
  && colorsPanelSrc.includes('onFocus={() =>')
  && colorsPanelSrc.includes('useMolStore.getState().setPreviewScheme(null)'),
  'hover/focus/卸载恢复缺失')

// ---------- T19-T21：图例折叠源级锚 ----------
ok('T19 折叠阈值（COLLAPSE_THRESHOLD 定义 ≥3 + 使用）',
  legendSrc.includes('COLLAPSE_THRESHOLD = 3') && (legendSrc.match(/COLLAPSE_THRESHOLD/g) ?? []).length >= 2,
  '阈值常量缺失')

ok('T20 折叠可及性（aria-expanded + Enter/Space 键盘展开）',
  legendSrc.includes('aria-expanded') && legendSrc.includes("e.key === 'Enter' || e.key === ' '"),
  'aria 或键盘展开缺失')

ok('T21 折叠短名映射（KIND_SHORT 四 kind——折叠行可读）',
  legendSrc.includes('KIND_SHORT') && legendSrc.includes("putty: { zh: 'putty 柔性'"),
  '短名映射缺失')

// ---------- T22-T24：commands 回执统计 + mock 源级锚 ----------
// bfactor 回执增强（B 因子范围 + 高柔性——报告数值域的源）
ok('T22 commands 回执统计（B 因子范围 min–max + 高柔性 flex/ca 模板串）',
  commandsSrc.includes('B 因子范围 ${min.toFixed(1)}–${max.toFixed(1)}')
  && commandsSrc.includes('高柔性残基（>80% 分位）${flex}/${ca}'),
  'bfactor 回执统计缺失')

ok('T23 mock SKILL_ADVICE 注册（flexibility-putty 建议短句）',
  mock.includes("'flexibility-putty': 'Reps 面板可调 puttyRange 钳制离群高 B；色卡可 hover 试穿'"),
  'SKILL_ADVICE 条目缺失')

ok('T24 mock 回填正则（B 因子范围 ZH + EN 双语域）',
  mock.includes('B 因子范围 ([\\d.]+)–([\\d.]+)') && mock.includes('B-factor range ([\\d.]+)–([\\d.]+)'),
  '回填正则 ZH 或 EN 缺失')

// ---------- T25-T30：mock 真端到端（fetch 3999 决策回放） ----------
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

const directive = `## 本次任务命中标准技能：柔性分析（flexibility-putty）
用户需求与该技能适用场景匹配。你必须按以下标准执行：

### 标准流程（按序执行）
   1. putty 表示法：show putty —— 管径按 B 因子 sqrt 映射
   2. B 因子着色：color bfactor —— 低蓝 → 高红连续渐变
   3. 全景适配：zoom —— 整体结构入框

### 报告文稿固定格式
【柔性分析报告】
▌B 因子范围：min–max 范围（color bfactor 回执）
▌高柔性残基：B > 80% 分位的 CA 残基占比（回执）
▌管径映射：putty 管径按 B 因子 sqrt 映射（rMin→rMax，puttyRange 可钳制高值端）
▌建议：下一步操作建议`

const sceneMsg = `【自动注入的当前场景信息，非用户发言】
已加载 1 个结构，活动结构：4HHB
- 【活动】4HHB [PDB] 4779原子/574残基 · 链: A(蛋白·141残基) B(蛋白·146残基) · 配体: HEM×4 · 水34`

const skillTurn = await mockDecide([
  { role: 'system', content: '你是 MolVision 的分子可视化助手。' },
  { role: 'assistant', content: directive },
  { role: 'user', content: sceneMsg },
  { role: 'user', content: '分析一下柔性分布' },
])
ok('T25 mock 技能决策（workflow 回放 show putty|color bfactor|zoom）',
  !!skillTurn && skillTurn.commands.join('|') === 'show putty|color bfactor|zoom',
  `mock 不可达或命令序错：${skillTurn?.commands.join('|') ?? 'null'}`)

ok('T26 mock 技能报告草稿（四节齐 + 回执类诚实「—」+ 管径映射静态 + 建议填值）',
  !!skillTurn && skillTurn.reply.startsWith('【柔性分析报告】')
  && skillTurn.reply.includes('▌B 因子范围：—') && skillTurn.reply.includes('▌高柔性残基：—')
  && skillTurn.reply.includes('▌管径映射：putty 管径 sqrt(B) 映射')
  && skillTurn.reply.includes('puttyRange 钳制离群高 B'),
  `reply 异常：${skillTurn?.reply.slice(0, 200) ?? 'null'}`)

const fillTurn = await mockDecide([{
  role: 'user',
  content: `【报告回执回填】（系统任务，非用户发言）
标准技能「柔性分析」的报告草稿与命令执行回执如下。请把草稿回填为实测数值版报告：

报告草稿：
【柔性分析报告】
▌B 因子范围：—
▌高柔性残基：—
▌管径映射：putty 管径按 B 因子 sqrt 映射
▌建议：—

命令回执（cmd → output）：
- show putty → 已添加 putty 表示 (protein)
- color bfactor → 已上色: B 因子 ——低蓝 → 高红连续渐变；B 因子范围 12.3–88.7 · 高柔性残基（>80% 分位）97/574
- zoom → 已适配全部结构`,
}])
ok('T27 mock 回填 ZH（B 因子范围 12.3–88.7 + 高柔性 97/574 双数值域）',
  !!fillTurn && fillTurn.reply.includes('▌B 因子范围：12.3–88.7 Å²') && fillTurn.reply.includes('▌高柔性残基：97/574 CA（>80% 分位）'),
  `reply 异常：${fillTurn?.reply.slice(0, 200) ?? 'null'}`)

ok('T28 mock 回填 commands 恒空（回填只改文稿）',
  !!fillTurn && fillTurn.commands.length === 0,
  `commands=${fillTurn?.commands.join(',')}`)

// EN 回执同域（r107 双语坑同族防护——EN 语言下回执为英文文案）
const fillTurnEn = await mockDecide([{
  role: 'user',
  content: `【报告回执回填】（系统任务，非用户发言）

报告草稿：
【柔性分析报告】
▌B 因子范围：—
▌高柔性残基：—
▌管径映射：—
▌建议：—

命令回执（cmd → output）：
- color bfactor → Colored: B-factor — low blue → high red continuous gradient; B-factor range 12.3–88.7 · high-flexibility residues (>80th pct) 97/574`,
}])
ok('T29 mock 回填 EN（B-factor range 12.3–88.7 + 97/574 同域提取）',
  !!fillTurnEn && fillTurnEn.reply.includes('▌B 因子范围：12.3–88.7 Å²') && fillTurnEn.reply.includes('▌高柔性残基：97/574 CA'),
  `EN 回填失配：${fillTurnEn?.reply.slice(0, 200) ?? 'null'}`)

// 弱词模板（7.6：纯表示需求「用 putty 显示」——matchSkill 1 分不选中走关键词模板）
const puttyTurn = await mockDecide([
  { role: 'user', content: '用 putty 表示看看柔性' },
])
ok('T30 mock 7.6 弱词模板（show putty + color bfactor 双命令）',
  !!puttyTurn && puttyTurn.commands.join('|') === 'show putty|color bfactor'
  && puttyTurn.reply.includes('putty 表示'),
  `模板未命中：${puttyTurn?.commands.join('|') ?? 'null'}`)

console.log(`\n== r123-M 结果：${pass}/${pass + fail}${fail ? '（存在 FAIL）' : ' 全过'} ==`)
process.exit(fail ? 1 : 0)
