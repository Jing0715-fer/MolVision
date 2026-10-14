// r121 E2E-M：工具契约 + 疏水性方案源级直测（Bun 跑，无浏览器面）：
// ①g1-lib.sh：bash 语法 / source 函数族导出 / PROTOCOL-VIOLATION 拦截 / 纯字符串
//   协议注册表 / wait-toast 依赖引用（r120 建议①②制度化的契约面）
// ②疏水性（Kyte-Doolittle）：KD 表完整性 + 数值级抽查（import 直测——20AA+MSE
//   21 键、ARG/ILE/ALA/GLY/MSE 五点值断言）/ hydropathy 表外 null / HYDRO_STOPS
//   首尾色值 / 五别名族 / store·面板·图例·mock 全链集成锚 / mock 模板顺序
//   不变量（7.5 疏水先于 8 泛色词——防「疏水请求被链染色吞」回归）
// 运行面：bash -n 与 import 直测不需要浏览器会话；G1 浏览器组覆盖渲染/回执/toast。
import { readFileSync } from 'node:fs'
import { KYTE_DOOLITTLE, hydropathy, KD_MIN, KD_MAX } from '../src/lib/molecular/chemistry'
import { HYDRO_STOPS, COLOR_SCHEME_LABELS } from '../src/lib/molecular/colors'

const g1lib = readFileSync('.zscripts/g1-lib.sh', 'utf8')
const colors = readFileSync('src/lib/molecular/colors.ts', 'utf8')
const commands = readFileSync('src/lib/molecular/commands.ts', 'utf8')
const store = readFileSync('src/lib/molecular/store.ts', 'utf8')
const repsPanel = readFileSync('src/components/studio/panels/RepsPanel.tsx', 'utf8')
const colorsPanel = readFileSync('src/components/studio/panels/ColorsPanel.tsx', 'utf8')
const legend = readFileSync('src/components/studio/ColorLegend.tsx', 'utf8')
const mock = readFileSync('mini-services/mock-llm/index.ts', 'utf8')
const chemistry = readFileSync('src/lib/molecular/chemistry.ts', 'utf8')

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) pass++; else fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `—— ${detail ?? ''}`}`)
}

// ---------- T1-T6：g1-lib.sh 工具契约 ----------
const t1 = Bun.spawnSync(['bash', '-n', '.zscripts/g1-lib.sh'])
ok('T1 g1-lib bash 语法（bash -n 退出 0）', t1.exitCode === 0, `exit=${t1.exitCode} stderr=${t1.stderr.toString().slice(0, 120)}`)

// source 后五函数必须全部注入（G1 驱动 source 即用——缺任一则命令族断供）
const t2 = Bun.spawnSync(['bash', '-c', `source .zscripts/g1-lib.sh && declare -F g1_strip g1_eval g1_wait_state g1_click_toast g1_fail | wc -l`])
ok('T2 g1-lib source 函数族导出（5 函数全在）', t2.exitCode === 0 && t2.stdout.toString().trim() === '5', `out=${t2.stdout.toString().trim()}`)

// 探针返回 JSON 必须当场判 PROTOCOL-VIOLATION（r120 JSON 转义层坑的制度化拦截——
// 违规探针须在库层被点名，不是「永不匹配」之后排查）
ok('T3 g1-lib 协议违规拦截（PROTOCOL-VIOLATION 判定 + 诊断双锚）',
  (g1lib.match(/PROTOCOL-VIOLATION/g) ?? []).length >= 2, `命中 ${(g1lib.match(/PROTOCOL-VIOLATION/g) ?? []).length}`)

// 纯字符串协议注册表 = r120 建议②制度化的载体（未来 bash 侧新工具的前缀登记处）
ok('T4 g1-lib 纯字符串协议注册表（制度化载体在场）', g1lib.includes('纯字符串协议注册表') && g1lib.includes('HIT::<文本>'), '注册表段缺失')

// 标准三步：click → 立即 wait-toast → 退出码透传（观察窗错位根修的制度化）
const clickFn = g1lib.split('\n').find(l => l.includes('bash "$G1_TOOLS_DIR/wait-toast.sh"'))
ok('T5 g1-lib 标准三步（click 后立即透传 wait-toast）',
  !!clickFn && clickFn.includes('wait-toast.sh') && clickFn.includes('$pattern'), 'wait-toast 调用行缺失')

// 管线故障哨兵：连续空返回计数与页面故障严格分流（wait-toast 同款三分流）
ok('T6 g1-lib 管线哨兵（G1_PIPE_EMPTY 计数 ≥3 处）', (g1lib.match(/G1_PIPE_EMPTY/g) ?? []).length >= 3, `命中 ${(g1lib.match(/G1_PIPE_EMPTY/g) ?? []).length}`)

// ---------- T7-T11：KD 表数值级直测（import 化学数据） ----------
const kdKeys = Object.keys(KYTE_DOOLITTLE)
ok('T7 KD 表完整性（20 标准氨基酸 + MSE = 21 键）', kdKeys.length === 21, `实际 ${kdKeys.length} 键：${kdKeys.join(',')}`)

// 数值抽查五点（Kyte-Doolittle 1982 原表值——错一个即「标度失真」级回归）
ok('T8 KD 极值与抽查（ARG -4.5 / ILE +4.5 / ALA 1.8 / GLY -0.4 / MSE 1.9）',
  KYTE_DOOLITTLE.ARG === -4.5 && KYTE_DOOLITTLE.ILE === 4.5 && KYTE_DOOLITTLE.ALA === 1.8
  && KYTE_DOOLITTLE.GLY === -0.4 && KYTE_DOOLITTLE.MSE === 1.9,
  `ARG=${KYTE_DOOLITTLE.ARG} ILE=${KYTE_DOOLITTLE.ILE} ALA=${KYTE_DOOLITTLE.ALA} GLY=${KYTE_DOOLITTLE.GLY} MSE=${KYTE_DOOLITTLE.MSE}`)

// 标度界与表值一致（界错则归一化漂移——图例刻度与着色脱同步）
ok('T9 KD 标度界（KD_MIN=-4.5 / KD_MAX=+4.5 与表值一致）',
  KD_MIN === -4.5 && KD_MAX === 4.5 && KD_MIN === Math.min(...Object.values(KYTE_DOOLITTLE)) && KD_MAX === Math.max(...Object.values(KYTE_DOOLITTLE)),
  `KD_MIN=${KD_MIN} KD_MAX=${KD_MAX}`)

// 表外残基必须 null（核酸/配体/水/空串——误染即「灰区污染」）
ok('T10 hydropathy 表外 null（DA/HEM/HOH/空串）',
  hydropathy('DA') === null && hydropathy('HEM') === null && hydropathy('HOH') === null && hydropathy('') === null,
  `DA=${hydropathy('DA')} HEM=${hydropathy('HEM')} HOH=${hydropathy('HOH')}`)

// 大小写不敏感（PDB 残基名惯例小写 het 记录不误判）
ok('T11 hydropathy 大小写归一（arg → -4.5）', hydropathy('arg') === -4.5, `arg=${hydropathy('arg')}`)

// ---------- T12-T16：着色渐变与类型集成 ----------
ok('T12 HYDRO_STOPS 三停靠点（青 → 沙 → 琥珀首尾色值）',
  HYDRO_STOPS.length === 3 && HYDRO_STOPS[0][1] === '#177e91' && HYDRO_STOPS[1][1] === '#ded8c2' && HYDRO_STOPS[2][1] === '#d97e04',
  JSON.stringify(HYDRO_STOPS))

ok('T13 ColorScheme 标签双语（疏水性 (Kyte-Doolittle) / Hydrophobicity (Kyte-Doolittle)）',
  COLOR_SCHEME_LABELS.hydrophobicity.zh.includes('疏水性') && COLOR_SCHEME_LABELS.hydrophobicity.en.startsWith('Hydrophobicity'),
  JSON.stringify(COLOR_SCHEME_LABELS.hydrophobicity))

// computeAtomColors 分支必须只染碳 + 杂原子元素色（项目「杂原子醒目可辨」纪律的方案级贯彻）
const hydroBranch = colors.split("if (scheme === 'hydrophobicity')")[1]?.split('return out')[0] ?? ''
ok('T14 疏水分支只染碳（el === \'C\' 门控在场）',
  hydroBranch.includes("kd != null && el === 'C'") && hydroBranch.includes('elementInfo(el).color'), '分支缺碳门控或元素色兜底')

// ---------- T17-T22：命令与 UI 全链集成锚 ----------
// 五别名族（hydrophobicity/hydropathy/hydrophobic/kd/byhydrophobicity）
const aliasHits = ['hydrophobicity:', 'hydropathy:', 'hydrophobic:', 'kd:', 'byhydrophobicity:'].filter(a => commands.includes(`${a} 'hydrophobicity'`))
ok('T17 命令五别名族（全指向 hydrophobicity）', aliasHits.length === 5, `命中 ${aliasHits.length}/5：${aliasHits.join(',')}`)

// COMMAND_HELP 示例含 color kd（帮助面板可发现性）
ok('T18 COMMAND_HELP 示例含 color kd（可发现性）', commands.includes('color kd') && commands.includes('hydrophobicity=KD 疏水梯度'), 'help 示例或 desc 缺失')

// 回执统计三类计数（疏水/亲水/表外——「有数说话」口径）
ok('T19 回执残基构成统计（三类计数源级）',
  commands.includes('残基构成：疏水') && commands.includes('hydrophobic ·') && commands.includes('off-scale'), '三类计数文案缺失')

// store schemes 数组（applyColor 识别门——漏则 color kd 走 css 解析失败）
ok('T20 store schemes 数组含 hydrophobicity', store.includes("'hydrophobicity', 'uniform'"), 'store schemes 数组缺项')

// 双面板入口（RepsPanel rep 级下拉 + ColorsPanel 全局色卡）
ok('T21 面板双入口（RepsPanel 下拉 + ColorsPanel 色卡）',
  repsPanel.includes("'hydrophobicity', 'sasa'") && colorsPanel.includes("key: 'hydrophobicity'"), '任一面板入口缺失')

// ColorsPanel 五阶色卡 = HYDRO_STOPS 两端 + 三阶中插（渐变语义在色卡上可读）
const swatchLine = colorsPanel.split('\n').find(l => l.includes("key: 'hydrophobicity'")) ?? ''
ok('T22 ColorsPanel 五阶色卡（两端 + 中插一致）',
  swatchLine.includes('#177e91') && swatchLine.includes('#ded8c2') && swatchLine.includes('#d97e04') && (swatchLine.match(/#[0-9a-f]{6}/g) ?? []).length === 5,
  `色卡行：${swatchLine.trim().slice(0, 120)}`)

// ---------- T23-T26：图例卡 + mock 模板 ----------
// 图例优先序：putty > bfactor > hydrophobicity > sasa（源序不变量）
// r122-b 锚同步：单卡互斥改多卡并置后源序载体从 `X) { kind` 变为
// `X) entries.push({ kind` —— 优先序语义不变（现为卡片排序）
const prio = legend.indexOf("puttyRep) entries.push({ kind: 'putty'") < legend.indexOf("bfactorRep) entries.push({ kind: 'bfactor'")
  && legend.indexOf("bfactorRep) entries.push({ kind: 'bfactor'") < legend.indexOf("hydroRep) entries.push({ kind: 'hydrophobicity'")
  && legend.indexOf("hydroRep) entries.push({ kind: 'hydrophobicity'") < legend.indexOf('sasaRep && data?.sasa')
ok('T23 图例优先序（putty > bfactor > hydrophobicity > sasa 源序）', prio, '优先序错乱')

// 图例双语刻度（KD 界 + 端点残基——用户读梯度方向的唯一标尺）
ok('T24 图例双语刻度（亲水 −4.5 (Arg) / +4.5 疏水 (Ile)）',
  legend.includes('亲水 −4.5 (Arg)') && legend.includes('+4.5 疏水 (Ile)') && legend.includes('hydrophilic −4.5 (Arg)') && legend.includes('+4.5 hydrophobic (Ile)'),
  '双语刻度文案缺失')

// hydrophobicity 无数据依赖（固定标度——区别于 sasa 的 data?.sasa 门控）
// r122-b 锚同步：互斥分支改 entries.push 后原 `else if (hydroRep)` 形态不复存在；
// 无数据依赖语义不变（push 无 data?.sasa 条件）
ok('T25 图例 hydro 门控无数据依赖（固定 KD 标度）',
  legend.includes("if (hydroRep) entries.push({ kind: 'hydrophobicity', bRange: null })") && !legend.includes('hydroRep && data?.sasa'), 'hydro 门控带了数据依赖（回退 sasa 语义）')

// mock 模板顺序不变量：7.5 疏水（color kd）必须先于 8 泛色词（链染色）——
// 顺序颠倒则「疏水着色」请求被泛色词模板吞掉（r121 mock 对齐的行为分界）
const mockHydro = mock.indexOf('7.5 r121-c 疏水性着色')
const mockChain = mock.indexOf('// 8. 链染色')
ok('T26 mock 模板顺序（7.5 疏水先于 8 泛色词）',
  mockHydro > 0 && mockChain > mockHydro && mock.slice(mockHydro, mockChain).includes('color kd'),
  `7.5@${mockHydro} 8@${mockChain}——顺序或命令缺失`)

// mock 模板触发词族（疏水/hydrophob/kd/hydropath/亲水——E2E 驱动的入口契约）
const mockTrig = mock.split('7.5 r121-c 疏水性着色')[1]?.split('\n')[3] ?? ''
ok('T27 mock 触发词族（疏水|hydrophob|kd|hydropath|亲水）',
  mockTrig.includes('疏水') && mockTrig.includes('hydrophob') && mockTrig.includes('\\bkd\\b') && mockTrig.includes('亲水'),
  `触发行：${mockTrig.slice(0, 120)}`)

// ---------- T28：chemistry 导出面（跨模块消费契约） ----------
ok('T28 chemistry 导出面（KYTE_DOOLITTLE/hydropathy/KD_MIN/KD_MAX 四导出）',
  chemistry.includes('export const KYTE_DOOLITTLE') && chemistry.includes('export function hydropathy')
  && chemistry.includes('export const KD_MIN') && chemistry.includes('export const KD_MAX'),
  '导出面缺项')

console.log(`\n== r121-M 结果：${pass}/${pass + fail}${fail ? '（存在 FAIL）' : ' 全过'} ==`)
process.exit(fail ? 1 : 0)
