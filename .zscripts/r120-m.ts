// r120 E2E-M：工具契约直测（spawn + fs 级，Bun 跑）——r120 三线的无浏览器可测面：
// ①wait-toast.sh：bash 语法 / 无参用法契约 / 退出码文档 0-1-2 / 探针目标
//   [data-sonner-toast]（非 body.innerText——按钮面板同文案假阳性防线）
// ②smoke.sh：bash 语法 / 语言 aria 探针双语覆盖 / 断言 4 共条件结构
// ③CommandPalette：quickActions deps 跨变量一致性（resumeSnap/activeId/resumeGone
//   三引用全入 deps——React exhaustive-deps 不变量，guards 单串锚表达不了）/
//   门控三条件 / execute 分支成败双路径 / 图标 import。
// 运行面：bash -n 与无参 spawn 不需要浏览器会话；G1 浏览器组覆盖运行时行为
//（toast 命中窗口 / 面板恢复全链 / aria 主探针）。
import { readFileSync } from 'node:fs'

const toastSh = readFileSync('.zscripts/wait-toast.sh', 'utf8')
const smokeSh = readFileSync('scripts/smoke.sh', 'utf8')
const palette = readFileSync('src/components/studio/CommandPalette.tsx', 'utf8')

let pass = 0, fail = 0
const ok = (name: string, cond: boolean, detail?: string) => {
  if (cond) pass++; else fail++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `—— ${detail ?? ''}`}`)
}
const includes = (hay: string, needle: string) => hay.includes(needle)

// ---------- T1-T4：wait-toast.sh 工具契约 ----------
const t1 = Bun.spawnSync(['bash', '-n', '.zscripts/wait-toast.sh'])
ok('T1 wait-toast bash 语法（bash -n 退出 0）', t1.exitCode === 0, `exit=${t1.exitCode} stderr=${t1.stderr.toString().slice(0, 120)}`)

const t2 = Bun.spawnSync(['bash', '.zscripts/wait-toast.sh'])
ok('T2 wait-toast 无参用法契约（非零退出 + 用法提示）', t2.exitCode !== 0 && t2.stderr.toString().includes('用法'), `exit=${t2.exitCode} stderr=${t2.stderr.toString().slice(0, 120)}`)

ok('T3 wait-toast 退出码文档（0/1/2 三分流注释在场）', includes(toastSh, '= FOUND') && includes(toastSh, '= NOTFOUND') && includes(toastSh, '= 管线故障'), '退出码三分流文档缺失')

// 探针目标必须是 [data-sonner-toast] 元素族——body.innerText 会命中按钮/面板
// 同文案（「恢复」在 UI 里到处都是）→ 假阳性；probe JS 里不得出现 body.innerText
const probeLine = toastSh.split('\n').find(l => l.startsWith('PROBE_JS='))
ok('T4 wait-toast 探针目标（[data-sonner-toast] 非 body.innerText）',
  !!probeLine && probeLine.includes('data-sonner-toast') && !probeLine.includes('body.innerText'),
  probeLine ? `probe 行含 body.innerText 或缺 data-sonner-toast: ${probeLine.slice(0, 160)}` : 'PROBE_JS 行缺失')

// ---------- T5-T7：smoke.sh 探针升级契约 ----------
const t5 = Bun.spawnSync(['bash', '-n', 'scripts/smoke.sh'])
ok('T5 smoke bash 语法（bash -n 退出 0）', t5.exitCode === 0, `exit=${t5.exitCode} stderr=${t5.stderr.toString().slice(0, 120)}`)

// 语言 aria 探针必须双语同测（zh 语言 / en Language——locale 状态无关的确定性锚）
const ariaProbe = smokeSh.split('\n').find(l => l.includes('has_lang_aria=$(agent-browser eval'))
ok('T6 smoke 语言 aria 探针双语覆盖（语言|Language 同一正则）',
  !!ariaProbe && /语言\|Language/.test(ariaProbe) && ariaProbe.includes('[aria-label]'),
  ariaProbe ? `探针行缺双语或全元素选择器: ${ariaProbe.slice(0, 160)}` : 'has_lang_aria 探针行缺失')

// 断言 4 共条件：文本标志与 PDB 结构锚必须同时判定（任一缺失即 FAIL——非回退语义）
const skelCond = smokeSh.split('\n').find(l => l.includes('if [ "$skel" = "true" ] && [ "$pdb_input" = "true" ]'))
ok('T7 smoke 断言4共条件（文本标志 ∧ PDB 结构锚同判）', !!skelCond, '共条件行缺失——骨架断言退回单条件')

// ---------- T8-T11：CommandPalette 恢复命令源级不变量 ----------
// deps 跨变量一致性：门控引用 resumeSnap/activeId/resumeGone → 三者必须全在
// quickActions deps 数组（漏任一 = 状态陈旧——面板项与实际状态脱节的经典坑）
const depsLine = palette.split('\n').find(l => l.trim().startsWith('], [settings.showHBonds, settings.showMembrane,'))
ok('T8 面板恢复 deps 一致性（三引用全入 deps）',
  !!depsLine && depsLine.includes('activeId') && depsLine.includes('resumeGone') && depsLine.includes('resumeSnap'),
  depsLine ? `deps 缺引用: ${depsLine.trim()}` : 'quickActions deps 行未找到')

ok('T9 面板恢复门控三条件（快照 ∧ 无活动结构 ∧ 未失效）',
  includes(palette, 'resumeSnap && !activeId && !resumeGone'), '门控条件不完整')

// execute 分支成败双路径：成功 toast.success / 失败 setResumeGone + toast.error
const resumeBranch = palette.slice(palette.indexOf("item.id === 'qa-session-resume'"), palette.indexOf("item.id === 'qa-session-new'"))
ok('T10 面板恢复执行分支（成功 toast + 失败降级双路径）',
  resumeBranch.includes('restoreSession()') && resumeBranch.includes('toast.success') && resumeBranch.includes('setResumeGone(true)') && resumeBranch.includes('toast.error'),
  `分支不完整: ${resumeBranch.slice(0, 200)}`)

// 图标 import（lucide ArchiveRestore——缺名即编译错，import 在场性独立锚）
ok('T11 面板恢复图标 import（ArchiveRestore 在 lucide 导入清单）',
  /ArchiveRestore,?\s*\n?\s*\} from 'lucide-react'/.test(palette) || palette.includes('ArchiveRestore,'), 'ArchiveRestore 未在 lucide 导入清单')

console.log(`\n== r120-m：${pass}/${pass + fail} ==`)
process.exit(fail === 0 ? 0 : 1)
