// 场景组合预设（Scene Presets）：多命令链一键组合
// 与 PRESETS（单表示法切换）互补——场景预设 = 表示法 + 环境 + 相机 + 后处理的完整工作流组合
// 实现为命令链（runCommand 逐条执行），复用现有命令系统的全部能力与错误处理
export interface ScenePreset {
  key: string
  label: string
  /** 一句话说明（下拉菜单副标题） */
  desc: string
  /** lucide 图标名（消费方自行映射） */
  icon: 'award' | 'sparkles' | 'target' | 'minimize'
  /** 命令链（按序执行；全部走 runCommand，自动获得日志/错误处理） */
  commands: string[]
  /** 执行后追加的提示（进 toast description） */
  after?: string
}

export const SCENE_PRESETS: Record<string, ScenePreset> = {
  publication: {
    key: 'publication',
    label: '出版级渲染',
    desc: '白底 + 轮廓描边 + 主轴对齐，论文图直接截取',
    icon: 'award',
    commands: [
      'preset cartoon',
      'bg white',
      'outline on 0.5 1',
      'set fog off',
      'orient',
    ],
    after: '导出图像 → Ray 级渲染可获得软阴影出版图；描边 0.5/1 为 VLM 实测最优值',
  },
  popular: {
    key: 'popular',
    label: '科普风格',
    desc: '表面 + 环境光遮蔽 + 链配色，教学演示友好',
    icon: 'sparkles',
    commands: [
      'preset surface',
      'bg white',
      'ssao on 2',
      'orient',
    ],
    after: '表面按链着色；可开启自动旋转（S 键）做演示',
  },
  pocket: {
    key: 'pocket',
    label: '口袋特写',
    desc: '口袋完整残基棍棒 + 晶体水，镜头推入并正对开口',
    icon: 'target',
    commands: [
      'preset bindingsite',
      'view from ligand',
    ],
    after: 'preset bindingsite 已自动聚焦口袋（多配体挑最近实例），view from ligand 把开口转向相机；可继续「show surface, within 6 of (ligand)」叠加口袋表面',
  },
  clean: {
    key: 'clean',
    label: '极简展示',
    desc: '白底无雾纯卡通，汇报截图最干净',
    icon: 'minimize',
    commands: [
      'preset cartoon',
      'bg white',
      'set fog off',
      'orient',
    ],
    after: '如需更素可「color uniform, #9aa0a6」统一灰色',
  },
}

/** 应用场景预设：逐条执行命令链（runCommand 内部自带日志/错误处理，不抛异常） */
export function applyScenePreset(
  key: string,
  runCommand: (raw: string) => void,
): { ok: boolean; applied: string; error?: string } {
  const scene = SCENE_PRESETS[key]
  if (!scene) {
    return { ok: false, applied: '', error: `未知场景 "${key}"。可用: ${Object.keys(SCENE_PRESETS).join(', ')}` }
  }
  for (const cmd of scene.commands) {
    runCommand(cmd)
  }
  return { ok: true, applied: scene.label, error: undefined }
}
