// 场景上下文构建器：把当前工作台状态序列化为 LLM 友好的紧凑文本
// （结构/链/配体/reps/选择/命名选择/关键渲染设置——每轮请求随对话一起送后端）
import { useMolStore, engineRef } from '../store'
import { REP_LABELS } from '../types'
import { useViewsStore } from '../views-store'

/** 视角书签数量（store 在 SSR/首帧前为空——安全读取） */
function countViewBookmarks(): number {
  try {
    return useViewsStore.getState().bookmarks.length
  } catch {
    return 0
  }
}

/** 构建场景上下文（无结构时也返回基本盘，LLM 能引导用户 load） */
export function buildSceneContext(): string {
  const s = useMolStore.getState()
  const lines: string[] = []

  lines.push('## 当前场景')
  if (!s.structures.length) {
    lines.push('- 未加载任何结构（需要时可让用户要求 load <PDB ID>，例如 load 4hhb）')
  } else {
    lines.push(`- 已加载 ${s.structures.length} 个结构，活动结构：${s.structures.find(x => x.id === s.activeId)?.name ?? '—'}`)
    for (const st of s.structures) {
      const active = st.id === s.activeId ? '【活动】' : ''
      const chains = st.chains.map(c => `${c.id.trim() || '?'}(${c.type === 'protein' ? '蛋白' : c.type === 'nucleic' ? '核酸' : '其他'}·${c.residues}残基)`).join(' ')
      const lig = st.ligands.slice(0, 8).map(l => `${l.resName}×${l.count}`).join(' ')
      lines.push(`- ${active}${st.name} [${st.format}] ${st.summary.atoms}原子/${st.summary.residues}残基 · 链: ${chains || '无'}${lig ? ` · 配体: ${lig}` : ''}${st.summary.waters ? ` · 水${st.summary.waters}` : ''}${st.visible ? '' : ' · 已隐藏'}`)
      if (st.reps.length) {
        lines.push(`  表示法: ${st.reps.map(r => `${REP_LABELS[r.type]}(${r.selection}${r.visible ? '' : ',隐藏'}${r.colorScheme !== 'element' ? ',' + r.colorScheme : ''})`).join('；')}`)
      }
    }
  }

  // 当前选择
  if (s.selection.structureId && s.selection.indices.length) {
    const st = s.structures.find(x => x.id === s.selection.structureId)
    lines.push(`- 当前选择：${st?.name ?? '?'} 中 ${s.selection.indices.length} 个原子（可在此基础上 show/hide/color/zoom）`)
  } else {
    lines.push('- 当前无选择（color/show 无选择时作用于活动结构整体）')
  }

  // 命名选择
  if (s.namedSelections.length) {
    lines.push(`- 命名选择: ${s.namedSelections.map(n => `${n.name}(${n.count}原子)`).join('、')}`)
  }

  // 着色覆盖（color 命令烘焙的逐原子色——告知 agent 上次着色是否已生效）
  const activeEntry = s.structures.find(x => x.id === s.activeId)
  if (activeEntry && Object.keys(activeEntry.colorOverrides).length > 0) {
    lines.push(`- 活动结构已烘焙自定义着色（${Object.keys(activeEntry.colorOverrides).length} 原子覆盖；reset_colors 可还原表示法默认色）`)
  }

  // 关键渲染设置（只列影响视觉决策的）
  const v = s.settings
  const on = (b: boolean) => (b ? '开' : '关')
  lines.push(`- 渲染设置：背景${v.background} · spin${on(v.spin)} · slab切层${on(v.slab)}${v.slab ? `(厚度${v.slabThickness}Å)` : ''} · 氢键${on(v.showHBonds)} · SSAO${on(v.ssao)} · 轮廓线${on(v.outline)} · 立体${on(v.stereo)} · 隐藏氢${on(v.hideHydrogens)} · 隐藏水${on(v.hideWater)} · 主题质量${v.quality}`)

  // 数值参数（「再粗一点/再亮一点」类增量调整的基准值）
  lines.push(
    `- 数值参数（增量调整时基于这些当前值计算新值）：outline强度${v.outlineStrength}/粗细${v.outlineThickness}px · SSAO强度${v.ssaoIntensity}/半径${v.ssaoRadius}Å · 灯光 环境${v.lightAmbient}/主光${v.lightKey}/补光${v.lightFill} · FOV${v.fov}° · 雾强度${v.fogStrength} · spin速度${v.spinSpeed} · 高光${on(v.specular)}`,
  )

  // 相机/视角状态（视角决策依据：特写 or 全景、当前朝向）
  try {
    const cam = engineRef.current?.getCameraState()
    if (cam) {
      const dist = Math.hypot(cam.pos[0] - cam.target[0], cam.pos[1] - cam.target[1], cam.pos[2] - cam.target[2])
      const mode = dist < 45 ? '特写' : dist > 140 ? '全景' : '中景'
      lines.push(`- 相机：${mode}（距目标中心 ${dist.toFixed(0)} Å）——可调：zoom <选择> 聚焦 / zoom in|out 推拉 / turn x|y|z ±° 旋转 / move x|y|z ±Å 平移 / view front|top 正交视角`)
    }
  } catch { /* 引擎未就绪时忽略 */ }

  // 测量与书签（agent 可报告/管理）
  if (s.measurements.length) {
    lines.push(`- 已有 ${s.measurements.length} 个测量标注（measure clear 可清除）`)
  }
  const views = countViewBookmarks()
  if (views > 0) lines.push(`- 视角书签 ${views} 个（view list 可列出）`)

  // 最近命令（让 LLM 知道用户刚做过什么）
  const recent = s.consoleLog.filter(l => l.type === 'in').slice(-6).map(l => l.text)
  if (recent.length) lines.push(`- 用户最近执行过的命令: ${recent.join(' | ')}`)

  return lines.join('\n')
}
