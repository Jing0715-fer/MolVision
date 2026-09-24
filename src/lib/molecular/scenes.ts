// 场景组合预设（Scene Presets）：多命令链一键组合
// 与 PRESETS（单表示法切换）互补——场景预设 = 表示法 + 环境 + 相机 + 后处理的完整工作流组合
// 实现为命令链（runCommand 逐条执行），复用现有命令系统的全部能力与错误处理
import { tt, type DualText } from '@/i18n'

export interface ScenePreset {
  key: string
  label: DualText
  /** 一句话说明（下拉菜单副标题） */
  desc: DualText
  /** lucide 图标名（消费方自行映射） */
  icon: 'award' | 'sparkles' | 'target' | 'minimize'
  /** 命令链（按序执行；全部走 runCommand，自动获得日志/错误处理） */
  commands: string[]
  /** 执行后追加的提示（进 toast description） */
  after?: DualText
}

export const SCENE_PRESETS: Record<string, ScenePreset> = {
  publication: {
    key: 'publication',
    label: { zh: '出版级渲染', en: 'Publication render' },
    desc: { zh: '白底 + 轮廓描边 + 主轴对齐，论文图直接截取', en: 'White background + outline + principal-axis aligned, ready for paper figures' },
    icon: 'award',
    commands: [
      'preset cartoon',
      'bg white',
      'outline on 0.5 1',
      'set fog off',
      'orient',
    ],
    after: { zh: '导出图像 → Ray 级渲染可获得软阴影出版图；描边 0.5/1 为 VLM 实测最优值', en: 'Export image → ray-quality render gives soft-shadow publication figures; outline 0.5/1 is the VLM-verified optimum' },
  },
  popular: {
    key: 'popular',
    label: { zh: '科普风格', en: 'Popular-science style' },
    desc: { zh: '表面 + 环境光遮蔽 + 链配色，教学演示友好', en: 'Surface + ambient occlusion + chain coloring, teaching-friendly' },
    icon: 'sparkles',
    commands: [
      'preset surface',
      'bg white',
      'ssao on 2',
      'orient',
    ],
    after: { zh: '表面按链着色；可开启自动旋转（S 键）做演示', en: 'Surface colored by chain; enable auto-rotate (S key) for demos' },
  },
  pocket: {
    key: 'pocket',
    label: { zh: '口袋特写', en: 'Pocket close-up' },
    desc: { zh: '口袋完整残基棍棒 + 晶体水，镜头推入并正对开口', en: 'Full pocket residues as sticks + crystal waters, camera zoomed onto the opening' },
    icon: 'target',
    commands: [
      'preset bindingsite',
      'view from ligand',
    ],
    after: { zh: 'preset bindingsite 已自动聚焦口袋（多配体挑最近实例），view from ligand 把开口转向相机；可继续「show surface, within 6 of (ligand)」叠加口袋表面', en: 'preset bindingsite already focuses the pocket (nearest instance picked when multiple ligands), view from ligand turns the opening toward the camera; follow up with "show surface, within 6 of (ligand)" to add a pocket surface' },
  },
  clean: {
    key: 'clean',
    label: { zh: '极简展示', en: 'Minimal showcase' },
    desc: { zh: '白底无雾纯卡通，汇报截图最干净', en: 'White background, no fog, pure cartoon — cleanest report screenshots' },
    icon: 'minimize',
    commands: [
      'preset cartoon',
      'bg white',
      'set fog off',
      'orient',
    ],
    after: { zh: '如需更素可「color uniform, #9aa0a6」统一灰色', en: 'For an even plainer look, "color uniform, #9aa0a6" applies uniform gray' },
  },
}

/** 应用场景预设：逐条执行命令链（runCommand 内部自带日志/错误处理，不抛异常） */
export function applyScenePreset(
  key: string,
  runCommand: (raw: string) => void,
): { ok: boolean; applied: string; error?: string } {
  const scene = SCENE_PRESETS[key]
  if (!scene) {
    return { ok: false, applied: '', error: tt({ zh: `未知场景 "${key}"。可用: ${Object.keys(SCENE_PRESETS).join(', ')}`, en: `Unknown scene "${key}". Available: ${Object.keys(SCENE_PRESETS).join(', ')}` }) }
  }
  for (const cmd of scene.commands) {
    runCommand(cmd)
  }
  return { ok: true, applied: tt(scene.label), error: undefined }
}
