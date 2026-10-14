// r113-g3：拉马钱德兰纯函数测试（classifyRama 分区判定 + r113 面板依赖的内核行为）
// 运行：bun .zscripts/r113-g3.ts
// 覆盖：通用/Gly/Pro 三容差体系 × favored/allowed/outlier 三区 + 边界量级校验。
// computeRama 的结构级路径由 G1 浏览器端到端覆盖（4HHB 566 点 / 1A2N 416 点 2 离群），
// 此处不重复造合成结构。
import { classifyRama } from '../src/lib/molecular/rama'

let pass = 0
let fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}：got ${JSON.stringify(got)} want ${JSON.stringify(want)}`) }
}

console.log('== T1 通用体系核心区（ALA 代表）——五主区中心均 favored ==')
eq('αR 核心 (-63,-43)', classifyRama(-63, -43, 'ALA'), 0)
eq('β 核心 (-120,130)', classifyRama(-120, 130, 'ALA'), 0)
eq('pPII (-142,92)', classifyRama(-142, 92, 'ALA'), 0)
eq('αL (57,39)', classifyRama(57, 39, 'ALA'), 0)
eq('桥 (-100,5)', classifyRama(-100, 5, 'ALA'), 0)

console.log('== T2 通用体系离群（远离全部区心 >3.5σ）==')
// (30,150)：到最近区 β(-120,130) 的 Mahalanobis d² = (150/34)² + (20/42)² ≈ 19.5+0.23 > 12.25
eq('通用离群 (30,150)', classifyRama(30, 150, 'ALA'), 2)
// (30,-100)：到最近区 αR(-63,-43) d² = (93/24)² + (57/29)² ≈ 15+3.9 = 18.9 > 12.25（其余区更远）
eq('通用离群 (30,-100)', classifyRama(30, -100, 'ALA'), 2)
// wrap 正向：±180 交界处 (170,-170) 与扩展 β 上缘 (-166,161) 经 wrap180 后 dx=-24、dy=29 ——
// 物理上是同一邻域，favored 正确（角度环形拓扑的边界连续性）
eq('wrap 交界 favored (170,-170)', classifyRama(170, -170, 'ALA'), 0)

console.log('== T3 Gly 体系放宽（ε 区 Gly 特有）==')
eq('Gly ε 区 favored (75,-135)', classifyRama(75, -135, 'GLY'), 0)
eq('同点通用体系离群 (75,-135)', classifyRama(75, -135, 'ALA'), 2)
// Gly αL 宽容差（σ 32/38 vs 通用 19/19）：(75,60) 对 Gly 到 αL(57,39) d²=(18/32)²+(21/38)²≈0.32<5.76 favored；
// 通用体系 d²=(18/19)²+(21/19)²≈2.05 <5.76 也 favored——取更外圈 (85,70)：Gly d²=(28/32)²+(31/38)²≈0.77+0.67=1.44 favored；
// 通用 d²=(28/19)²+(31/19)²≈2.17+2.66=4.83 仍 favored……(100,80)：Gly d²=(43/32)²+(41/38)²≈1.81+1.16=2.97 favored；
// 通用 d²=(43/19)²+(41/19)²≈5.13+4.66=9.79 >5.76 且 <12.25 → allowed（分层实证）
eq('Gly 宽容差 favored (100,80)', classifyRama(100, 80, 'GLY'), 0)
eq('同点通用 allowed (100,80)', classifyRama(100, 80, 'ALA'), 1)

console.log('== T4 Pro 体系收紧（φ 锁 -60±13σ）==')
eq('Pro αR (-60,-40)', classifyRama(-60, -40, 'PRO'), 0)
eq('Pro PPII (-60,145)', classifyRama(-60, 145, 'PRO'), 0)
// φ=-120 对 Pro：到任一 Pro 区心 dx=(-60→wrap 60)/13=4.6，d²≥21 远超 12.25 → 离群；
// 通用体系 (-120,130) 是 β 核心 favored——五元环约束的体系差异实证
eq('Pro φ 偏移离群 (-120,130)', classifyRama(-120, 130, 'PRO'), 2)
eq('同点通用 β 核心 favored', classifyRama(-120, 130, 'ALA'), 0)

console.log('== T5 大小写与缺省 resName ==')
eq('小写 resn 通用体系', classifyRama(-63, -43, 'ala'), 0)
eq('小写 gly', classifyRama(75, -135, 'gly'), 0)
eq('缺省 resName 走通用', classifyRama(-63, -43), 0)
eq('缺省 resName Gly 特区不触发', classifyRama(75, -135), 2)

console.log('== T6 角度wrap（±180 等价）==')
// (-180,-43) 与 (180,-43) 是同一物理角度：到 αR 区心 dx=wrap180(180-(-63))=-123→wrap 117? wrap180(243)=243-360=-117 → 117/24=4.875 大；
// 用 β 区验证 wrap：(-179,130) 与 (179,130) 到 β(-120,130) dx 分别 59 与 wrap180(179+120=299)= -61 → |61|——等价 d²
const a = classifyRama(-179, 130, 'ALA')
const b = classifyRama(179, 130, 'ALA')
eq('±180 wrap 等价判定', a, b)

console.log(`\n== r113-g3 结果：${pass} 过 / ${fail} 败 ==`)
process.exit(fail ? 1 : 0)
