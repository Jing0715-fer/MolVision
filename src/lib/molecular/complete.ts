// 命令行智能补全引擎：按光标前的部分 token 产出候选（命令名/子命令/结构名/选择关键字…）
// 纯函数模块（仅依赖静态注册表），上下文（结构列表/命名选择）由调用方注入
import { COMMAND_HELP } from './commands'
import { COLOR_SCHEME_LABELS } from './colors'
import { REP_LABELS } from './types'
import { useSceneStore } from './scene-store'

/** 补全上下文（调用方从 store 即时读取） */
export interface CompletionCtx {
  structures: string[]
  namedSelections: string[]
  viewBookmarks: string[]
}

export type CompletionKind = 'cmd' | 'sub' | 'struct' | 'sel' | 'rep' | 'color' | 'value' | 'preset' | 'tour'

export interface CompletionItem {
  /** 替换 token 的文本 */
  insert: string
  kind: CompletionKind
  /** 右侧补充说明 */
  detail?: string
}

export interface CompletionResult {
  items: CompletionItem[]
  /** 替换范围（input 字符偏移） */
  from: number
  to: number
  /** 识别到命令时的参数提示（来自 COMMAND_HELP） */
  hint?: { cmd: string; desc: string; example: string } | null
}

/** 选择表达式关键字（chain/resi/…/and/or/not；within 与 byres 后接参数） */
const SEL_KEYWORDS: [string, string][] = [
  ['chain', '链 ID'],
  ['chainidx', '链组序号'],
  ['resi', '残基编号'],
  ['resn', '残基名称'],
  ['name', '原子名'],
  ['elem', '元素'],
  ['molecule', '配体分子编号'],
  ['protein', '蛋白'],
  ['nucleic', '核酸'],
  ['ligand', '配体'],
  ['water', '水'],
  ['backbone', '主链'],
  ['sidechain', '侧链'],
  ['helix', '螺旋'],
  ['sheet', '折叠'],
  ['within', '距离内：within 5 of (…)'],
  ['byres', '按残基扩展'],
  ['bychain', '按链扩展'],
  ['ss', '二级结构：ss h/s/l（PyMOL 字母）'],
  ['id', 'PDB 原子序号：id 100-200'],
  ['b', 'B 因子比较：b > 50'],
  ['q', '占据率比较：q > 0.5'],
  ['hydrogen', '氢原子（not hydrogen 排氢）'],
  ['in', '按残基交集（A in B）'],
  ['like', '按残基+原子交集（A like B）'],
  ['byobject', '扩展到整个对象'],
  ['all', '全部原子'],
  ['none', '空集'],
  ['and', '交集'],
  ['or', '并集'],
  ['not', '补集'],
  ['sele', '当前选择（sel 同义）'],
  ['sel', '当前选择（ChimeraX 关键词）'],
  ['/A', '链说明符（ChimeraX /A）'],
  [':42', '残基号/名（ChimeraX :42/:HEM）'],
  ['@CA', '原子名（ChimeraX @CA）'],
  ['#1', '模型号（ChimeraX #1）'],
  ['zone', '邻域（ChimeraX :HEM zone 5）'],
  ['ions', '金属离子（ChimeraX）'],
]

const COMMON_COLORS: [string, string][] = [
  ['red', '红'], ['blue', '蓝'], ['green', '绿'], ['yellow', '黄'], ['orange', '橙'],
  ['purple', '紫'], ['cyan', '青'], ['magenta', '品红'], ['teal', '鸭绿'], ['pink', '粉'],
  ['lime', '亮绿'], ['brown', '棕'], ['slate', '石板灰'], ['gray', '灰'], ['white', '白'], ['black', '黑'],
]

/** 命令补全注册表：主名 + 别名 + 逐 token 参数规格 */
interface CmdDef {
  names: string[]
  /** 每个参数位的候选（pos=1 为首个参数；返回 null 表示该位不补全） */
  args?: (pos: number, ctx: CompletionCtx, tokens: string[]) => CompletionItem[] | null
  /** 选择表达式类命令（任意位置都可用选择关键字） */
  expr?: boolean
}

const structItems = (ctx: CompletionCtx): CompletionItem[] =>
  ctx.structures.map(n => ({ insert: n, kind: 'struct' as const, detail: '结构' }))

const selItems = (ctx: CompletionCtx): CompletionItem[] => [
  ...SEL_KEYWORDS.map(([k, d]) => ({ insert: k, kind: 'sel' as const, detail: d })),
  ...ctx.namedSelections.map(n => ({ insert: n, kind: 'sel' as const, detail: '命名选择' })),
]

const repItems = (): CompletionItem[] => [
  ...Object.keys(REP_LABELS).map(k => ({ insert: k, kind: 'rep' as const, detail: REP_LABELS[k as keyof typeof REP_LABELS] })),
  { insert: 'hydrogens', kind: 'rep', detail: '显示氢' },
  { insert: 'waters', kind: 'rep', detail: '显示水' },
]

const colorItems = (): CompletionItem[] => [
  ...Object.keys(COLOR_SCHEME_LABELS).map(k => ({ insert: k, kind: 'color' as const, detail: COLOR_SCHEME_LABELS[k as keyof typeof COLOR_SCHEME_LABELS] })),
  ...COMMON_COLORS.map(([c, d]) => ({ insert: c, kind: 'color' as const, detail: d })),
]

const onOff = (): CompletionItem[] => [
  { insert: 'on', kind: 'value', detail: '开' },
  { insert: 'off', kind: 'value', detail: '关' },
]

/** preset 名候选（scene 命令非子命令时仍可作 preset 别名） */
const presetNameItems = (): CompletionItem[] => [
  { insert: 'publication', kind: 'preset', detail: '出版级互作（卡通+口袋球棍）' },
  { insert: 'bindingsite', kind: 'preset', detail: '结合口袋' },
  { insert: 'cartoon', kind: 'preset', detail: 'Cartoon 经典' },
  { insert: 'ballstick', kind: 'preset', detail: '球棍模型' },
  { insert: 'spacefill', kind: 'preset', detail: '空间填充' },
  { insert: 'wireframe', kind: 'preset', detail: '线框' },
  { insert: 'surface', kind: 'preset', detail: '分子表面' },
  { insert: 'hybrid', kind: 'preset', detail: '混合风格' },
  { insert: 'putty', kind: 'preset', detail: 'Putty B 因子管' },
]

/** 已保存场景名候选（scene recall/del/update <名> 补全；SSR 安全） */
const sceneNameItems = (): CompletionItem[] => {
  try {
    return useSceneStore.getState().scenes.map(sc => ({ insert: sc.name, kind: 'sel' as const, detail: '场景快照' }))
  } catch {
    return []
  }
}

const REGISTRY: CmdDef[] = [
  { names: ['load', 'fetch', 'open'], args: () => null },
  { names: ['select', 'sel'], expr: true, args: (pos, ctx) => (pos === 1 ? [{ insert: 'add', kind: 'sub', detail: '追加（ChimeraX）' }, { insert: 'subtract', kind: 'sub', detail: '移除（ChimeraX）' }, { insert: 'zone', kind: 'sub', detail: '邻域扩展（ChimeraX）' }, ...selItems(ctx)] : pos >= 2 ? selItems(ctx) : null) },
  { names: ['deselect', 'desel'], args: () => null },
  // ChimeraX 动词兼容注册（open/focus/bgcolor/silhouettes/rotate/translate/presets/transparency）
  { names: ['focus'], expr: true, args: (pos, ctx) => (pos >= 1 ? selItems(ctx) : null) },
  { names: ['bgcolor'] },
  { names: ['silhouettes', 'silhouette'], args: (pos) => (pos === 1 ? [{ insert: 'on', kind: 'sub', detail: '轮廓线开启' }, { insert: 'off', kind: 'sub', detail: '轮廓线关闭' }] : null) },
  { names: ['rotate'], args: (pos) => (pos === 1 ? ['x', 'y', 'z'].map(a => ({ insert: a, kind: 'value', detail: '旋转轴' })) : null) },
  { names: ['translate'], args: (pos) => (pos === 1 ? ['x', 'y', 'z'].map(a => ({ insert: a, kind: 'value', detail: '平移轴' })) : null) },
  { names: ['presets'], args: (pos) => (pos === 1 ? [
    { insert: 'interactive', kind: 'sub', detail: '交互预设（ChimeraX）→ hybrid' },
    { insert: 'publication', kind: 'sub', detail: '出版预设（ChimeraX）→ publication' },
  ] : null) },
  { names: ['transparency'], args: (pos) => (pos === 1 ? ['0.3', '0.5', '0.7'].map(v => ({ insert: v, kind: 'value', detail: '透明度 0-1（ChimeraX 语义）' })) : null) },
  {
    names: ['spectrum'],
    args: (pos) => (pos === 1
      ? [
          { insert: 'count', kind: 'sub', detail: '链序连续渐变' },
          { insert: 'b', kind: 'sub', detail: 'B 因子渐变（低蓝→高红）' },
        ]
      : pos === 2
        ? [{ insert: 'rainbow', kind: 'value', detail: '彩虹渐变（PyMOL 惯例词）' }]
        : null),
    expr: true,
  },
  {
    names: ['iterate'],
    expr: true,
    args: (pos) => (pos >= 2
      ? ['name', 'resn', 'resi', 'chain', 'ss', 'b', 'q', 'elem', 'index'].map(f => ({ insert: f, kind: 'value', detail: 'iterate 输出字段' }))
      : null),
  },
  { names: ['alter'], expr: true, args: (pos) => (pos >= 2 ? ['b', 'q', 'name'].map(f => ({ insert: `${f}=`, kind: 'value', detail: 'alter 可改属性' })) : null) },
  { names: ['cell'], args: (pos) => (pos === 1 ? [{ insert: 'on', kind: 'sub', detail: '晶胞盒开启' }, { insert: 'off', kind: 'sub', detail: '晶胞盒关闭' }] : null) },
  {
    names: ['create'],
    expr: true,
    args: (pos, ctx) => (pos === 2
      ? [{ insert: '=', kind: 'value', detail: '名 = 选择' }]
      : pos >= 3 ? selItems(ctx) : null),
  },
  { names: ['split_chains'] },
  {
    names: ['isolate'],
    expr: true,
    args: (pos, ctx) => (pos >= 1
      ? [...selItems(ctx), { insert: 'off', kind: 'sub', detail: '恢复全部链' }]
      : null),
  },
  {
    names: ['chains'],
    args: pos => (pos === 1 ? [
      { insert: 'hide', kind: 'sub', detail: '隐藏链：chains hide A+B' },
      { insert: 'show', kind: 'sub', detail: '恢复链：chains show A / all' },
      { insert: 'list', kind: 'sub', detail: '列出全部链组及显隐' },
    ] : null),
  },
  {
    names: ['scene'],
    args: (pos) => (pos === 1 ? [
      { insert: 'save', kind: 'sub', detail: '快照当前完整状态（相机+表示法+链隔离+环境）' },
      { insert: 'recall', kind: 'sub', detail: '召回场景' },
      { insert: 'update', kind: 'sub', detail: '用当前状态覆盖既有场景' },
      { insert: 'next', kind: 'sub', detail: '轮播下一个' },
      { insert: 'prev', kind: 'sub', detail: '轮播上一个' },
      { insert: 'list', kind: 'sub', detail: '列出全部场景' },
      ...presetNameItems(),
    ] : pos >= 2 ? sceneNameItems() : null),
  },
  { names: ['show', 'display'], args: (pos, ctx) => (pos === 1 ? repItems() : pos >= 2 ? selItems(ctx) : null) },
  { names: ['hide', 'undisplay'], args: (pos, ctx) => (pos === 1 ? repItems() : pos >= 2 ? selItems(ctx) : null) },
  { names: ['color', 'colour'], args: (pos, ctx) => (pos === 1 ? colorItems() : pos >= 2 ? selItems(ctx) : null) },
  {
    names: ['util'],
    args: pos => (pos === 1 ? [
      { insert: 'cbc', kind: 'sub', detail: '按链着色' },
      { insert: 'cnc', kind: 'sub', detail: '灰化' },
      { insert: 'ss', kind: 'sub', detail: '二级结构' },
      { insert: 'cbaw', kind: 'sub', detail: '元素+白碳' },
      { insert: 'cbac', kind: 'sub', detail: '元素+灰碳' },
    ] : null),
  },
  {
    names: ['set'],
    args: pos => (pos === 1 ? [
      { insert: 'ambient', kind: 'value', detail: '环境光 0-2' },
      { insert: 'direct', kind: 'value', detail: '主光 0-3' },
      { insert: 'fill', kind: 'value', detail: '补光 0-2' },
      { insert: 'specular', kind: 'value', detail: '高光 on/off' },
      { insert: 'fog', kind: 'value', detail: '雾 on/off' },
      { insert: 'fog_strength', kind: 'value', detail: '雾强度 0-1' },
      { insert: 'fov', kind: 'value', detail: '视场角 10-100' },
      { insert: 'spin_speed', kind: 'value', detail: '转速 0.5-20' },
      { insert: 'transition', kind: 'value', detail: '过渡手感 quick/normal/cinematic' },
      { insert: 'quality', kind: 'value', detail: 'low/medium/high' },
      { insert: 'stereo', kind: 'value', detail: '立体 on/off' },
      { insert: 'axes', kind: 'value', detail: '罗盘 on/off' },
      { insert: 'outline_strength', kind: 'value', detail: '轮廓强度 0-3' },
      { insert: 'outline_thickness', kind: 'value', detail: '轮廓粗细 1-4 px' },
      { insert: 'fps', kind: 'value', detail: 'FPS 指示 on/off' },
      { insert: 'auto_perf', kind: 'value', detail: '自动性能 on/off' },
      { insert: 'cap_color', kind: 'value', detail: '切层封盖色' },
      { insert: 'cap_shading', kind: 'value', detail: '封盖深度明暗' },
      { insert: 'seq_focus', kind: 'value', detail: '序列视口聚焦' },
      { insert: 'transparency', kind: 'value', detail: '表面不透明度' },
      { insert: 'sphere_scale', kind: 'value', detail: '球半径倍率' },
      { insert: 'stick_radius', kind: 'value', detail: '棍半径' },
      { insert: 'cartoon_width', kind: 'value', detail: '带宽度' },
      { insert: 'bg_follow', kind: 'value', detail: '背景主题跟随 on/off' },
    ] : null),
  },
  { names: ['bg', 'background'], args: pos => (pos === 1 ? colorItems() : null) },
  { names: ['zoom'], expr: true, args: (pos, ctx) => (pos >= 1 ? selItems(ctx) : null) },
  {
    names: ['turn', 'move'],
    args: pos => (pos === 1 ? [
      { insert: 'x', kind: 'sub', detail: '屏幕右轴（turn 俯仰 / move 右移）' },
      { insert: 'y', kind: 'sub', detail: '屏幕上轴（turn 水平方位 / move 上移）' },
      { insert: 'z', kind: 'sub', detail: '视线轴（turn 滚转 / move 推拉）' },
    ] : null),
  },
  {
    names: ['view'],
    args: (pos, ctx) => (pos === 1 ? [
      { insert: 'from', kind: 'sub', detail: '从选择方向观察（口袋正对相机）' },
      { insert: 'front', kind: 'sub', detail: '正视（沿 Z）' },
      { insert: 'top', kind: 'sub', detail: '俯视（沿 Y）' },
      { insert: 'left', kind: 'sub', detail: '左视' },
      { insert: 'right', kind: 'sub', detail: '右视（沿 X）' },
      { insert: 'back', kind: 'sub', detail: '后视' },
      { insert: 'bottom', kind: 'sub', detail: '仰视' },
      { insert: 'save', kind: 'sub', detail: '保存当前视角' },
      { insert: 'go', kind: 'sub', detail: '跳转书签' },
      { insert: 'del', kind: 'sub', detail: '删除书签' },
      { insert: 'list', kind: 'sub', detail: '列出书签' },
      ...ctx.viewBookmarks.map(b => ({ insert: b, kind: 'value' as const, detail: '视角书签' })),
    ] : pos === 2 ? [
      { insert: 'ligand', kind: 'sel', detail: '全部配体' },
      { insert: 'protein', kind: 'sel', detail: '蛋白' },
    ] : null),
  },
  { names: ['activate'], args: (pos, ctx) => (pos === 1 ? structItems(ctx) : null) },
  { names: ['orient'], expr: true, args: (pos, ctx) => (pos >= 1 ? selItems(ctx) : null) },
  { names: ['get_view', 'set_view'] },
  {
    names: ['tour'],
    args: pos => (pos === 1 ? [
      { insert: 'quickstart', kind: 'tour', detail: '快速上手' },
      { insert: 'drug-target', kind: 'tour', detail: '药物口袋' },
      { insert: 'crystallography', kind: 'tour', detail: '晶体学' },
      { insert: 'nmr-dynamics', kind: 'tour', detail: 'NMR 动力学' },
      { insert: 'antibody', kind: 'tour', detail: '抗体表位' },
      { insert: 'nucleic', kind: 'tour', detail: '核酸' },
      { insert: 'stop', kind: 'sub', detail: '停止' },
    ] : null),
  },
  { names: ['count_atoms'], expr: true, args: (pos, ctx) => (pos >= 1 ? selItems(ctx) : null) },
  { names: ['spin'], args: pos => (pos === 1 ? onOff() : null) },
  { names: ['rock'], args: pos => (pos === 1 ? onOff() : null) },
  {
    names: ['slab'],
    args: pos => (pos === 1 ? [
      { insert: 'move', kind: 'sub', detail: '沿视线移动 ±Å' },
      { insert: 'center', kind: 'sub', detail: '回中' },
      { insert: 'cap', kind: 'sub', detail: '截面封盖 on/off' },
      { insert: 'off', kind: 'value', detail: '关闭' },
    ] : pos === 2 ? [
      { insert: '-5', kind: 'value', detail: '向相机 5 Å' },
      { insert: '5', kind: 'value', detail: '离相机 5 Å' },
      { insert: '-10', kind: 'value', detail: '向相机 10 Å' },
      { insert: '10', kind: 'value', detail: '离相机 10 Å' },
      { insert: 'on', kind: 'value', detail: '封盖开启' },
      { insert: 'off', kind: 'value', detail: '封盖关闭' },
    ] : null),
  },
  {
    names: ['perf'],
    args: pos => (pos === 1 ? [
      { insert: 'status', kind: 'sub', detail: '当前状态' },
      { insert: 'on', kind: 'value', detail: '开启' },
      { insert: 'off', kind: 'value', detail: '关闭并还原' },
      { insert: 'restore', kind: 'sub', detail: '手动恢复' },
    ] : null),
  },
  { names: ['stereo'], args: pos => (pos === 1 ? onOff() : null) },
  { names: ['symmetry'], args: pos => (pos === 1 ? [{ insert: 'off', kind: 'value', detail: '关闭' }] : null) },
  {
    names: ['map'],
    args: pos => (pos === 1 ? [
      { insert: 'fetch', kind: 'sub', detail: '2Fo-Fc 密度' },
      { insert: 'fofc', kind: 'sub', detail: 'Fo-Fc 差图' },
      { insert: 'isolevel', kind: 'sub', detail: '等值面 σ' },
      { insert: 'off', kind: 'sub', detail: '移除' },
    ] : null),
  },
  {
    names: ['hbonds'],
    args: (pos, ctx) => (pos === 1
      ? [
        { insert: 'on', kind: 'sub', detail: '开（默认 3.5Å）' },
        { insert: 'off', kind: 'sub', detail: '关' },
        { insert: 'in', kind: 'sub', detail: '烘焙独立范围（不随 deselect 清除）' },
      ]
      : pos >= 2
        ? [
          { insert: 'in', kind: 'sub', detail: '烘焙独立范围（不随 deselect 清除）' },
          { insert: '3.2', kind: 'value', detail: '距离上限 Å（2-6）' },
          ...selItems(ctx).slice(0, 4),
        ]
        : null),
  },
  { names: ['ssao', 'ao', 'gtao'], args: pos => (pos === 1 ? onOff() : null) },
  { names: ['outline'], args: pos => (pos === 1 ? onOff() : null) },
  { names: ['fps'], args: pos => (pos === 1 ? onOff() : null) },
  {
    names: ['superpose'],
    args: (pos, ctx) => (pos === 1
      ? [...structItems(ctx), { insert: 'onto', kind: 'sub', detail: '参考结构' }]
      : pos === 2
        ? [{ insert: 'onto', kind: 'sub', detail: '参考结构' }, { insert: 'chain', kind: 'sub', detail: '链对 A to B' }]
        : structItems(ctx)),
  },
  { names: ['dssp'] },
  { names: ['contacts'], expr: true, args: (pos, ctx) => (pos >= 1 ? selItems(ctx) : null) },
  { names: ['interface'] },
  {
    names: ['xcontacts'],
    expr: true,
    args: (pos, ctx) => (pos === 1
      ? ctx.structures.map(n => ({ insert: `${n}:`, kind: 'struct', detail: '结构:选择' }))
      : selItems(ctx)),
  },
  { names: ['sasa'] },
  { names: ['bsa'] },
  { names: ['xbsa'] },
  { names: ['untransform'], args: (pos, ctx) => (pos === 1 ? structItems(ctx) : null) },
  {
    names: ['record'],
    args: pos => (pos === 1 ? [
      { insert: 'start', kind: 'sub', detail: '开始录制' },
      { insert: 'stop', kind: 'sub', detail: '完成并保存' },
    ] : null),
  },
  {
    names: ['morph'],
    args: (pos, ctx, tokens) => {
      const isMulti = tokens[1]?.toLowerCase() === 'multi'
      const eqPos = isMulti ? 3 : 2
      if (pos === 1) return [{ insert: 'multi', kind: 'sub', detail: '多态样条（3+ 构象）' }]
      if (pos === eqPos) return [{ insert: '=', kind: 'value', detail: '名 = 构象 A 构象 B…' }]
      if (pos > eqPos) return structItems(ctx)
      return null // 对象名自由命名
    },
  },
  {
    names: ['movie'],
    args: pos => (pos === 1 ? [
      { insert: 'play', kind: 'sub', detail: '播放 [smooth|hold] [秒 轮]' },
      { insert: 'stop', kind: 'sub', detail: '停止' },
      { insert: 'smooth', kind: 'sub', detail: '默认平滑巡航（录像连贯）' },
      { insert: 'hold', kind: 'sub', detail: '默认逐帧驻留（经典）' },
      { insert: 'edit', kind: 'sub', detail: '时间轴编排' },
    ] : pos === 2 ? [
      { insert: 'smooth', kind: 'value', detail: '平滑巡航：连续路径' },
      { insert: 'hold', kind: 'value', detail: '逐帧驻留：经典' },
    ] : null),
  },
  {
    names: ['ensemble'],
    args: pos => (pos === 1 ? [
      { insert: 'play', kind: 'sub', detail: '播放' },
      { insert: 'stop', kind: 'sub', detail: '停止' },
      { insert: 'frame', kind: 'sub', detail: '跳到帧' },
      { insert: 'fps', kind: 'sub', detail: '帧率' },
      { insert: 'info', kind: 'sub', detail: '信息' },
    ] : null),
  },
  { names: ['save'], args: (pos, ctx) => (pos >= 2 ? selItems(ctx) : null) },
  { names: ['png'] },
  { names: ['ray'] },
  {
    names: ['svg'],
    args: pos => (pos === 1 ? [
      { insert: '1200', kind: 'value', detail: '宽 1200 px' },
      { insert: '1600', kind: 'value', detail: '宽 1600 px（默认）' },
      { insert: '2400', kind: 'value', detail: '宽 2400 px' },
      { insert: '3200', kind: 'value', detail: '宽 3200 px' },
    ] : null),
  },
  { names: ['axes', 'axis', 'gizmo'], args: pos => (pos === 1 ? onOff() : null) },
  {
    names: ['session'],
    args: pos => (pos === 1 ? [
      { insert: 'save', kind: 'sub', detail: '本地存档' },
      { insert: 'export', kind: 'sub', detail: '导出 .molvision' },
      { insert: 'new', kind: 'sub', detail: '新建会话' },
      { insert: 'info', kind: 'sub', detail: '存档信息' },
      { insert: 'clear', kind: 'sub', detail: '清除存档' },
    ] : null),
  },
  {
    names: ['history'],
    args: pos => (pos === 1 ? [
      { insert: 'clear', kind: 'sub', detail: '清空历史（置顶保留）' },
    ] : null),
  },
  { names: ['label'], args: pos => (pos === 1 ? onOff() : null) },
  {
    names: ['preset', 'style'],
    args: pos => (pos === 1 ? presetNameItems() : null),
  },
  { names: ['delete'], args: (pos, ctx) => (pos === 1 ? ctx.namedSelections.map(n => ({ insert: n, kind: 'sel', detail: '命名选择' })) : null) },
  { names: ['close'], args: (pos, ctx) => (pos === 1 ? [...structItems(ctx), { insert: 'all', kind: 'value', detail: '全部结构' }] : null) },
  { names: ['clear'] },
  { names: ['help', '?'] },
]

/** 命令名候选（主名 + 全部别名） */
const CMD_ITEMS: CompletionItem[] = REGISTRY.flatMap(d =>
  d.names.map(n => ({ insert: n, kind: 'cmd' as const })),
)

const HELP_BY_CMD = new Map<string, { cmd: string; desc: string; example: string }>()
for (const h of COMMAND_HELP) HELP_BY_CMD.set(h.cmd.split(' ')[0], h)

function defFor(word: string): CmdDef | null {
  const w = word.toLowerCase()
  return REGISTRY.find(d => d.names.includes(w)) ?? null
}

/** 排序：前缀匹配优先，再按字典序；限制数量 */
function rank(items: CompletionItem[], frag: string, limit = 12): CompletionItem[] {
  const f = frag.toLowerCase()
  const scored = items
    .filter(i => i.insert.toLowerCase().includes(f))
    .map(i => ({ i, prefix: i.insert.toLowerCase().startsWith(f) ? 0 : 1 }))
  scored.sort((a, b) => a.prefix - b.prefix || a.i.insert.localeCompare(b.i.insert))
  return scored.slice(0, limit).map(s => s.i)
}

/**
 * 计算补全：input 为完整命令行（光标默认在末尾）。
 * 规则：按空白切 token；末尾是空格 → 补全新 token；否则补全最后一个部分 token。
 */
export function buildCompletions(input: string, ctx: CompletionCtx): CompletionResult | null {
  // 定位正在输入的 token
  const m = /(\S*)$/.exec(input)
  const frag = m ? m[1] : ''
  const tokenStart = input.length - frag.length
  // 前面的 token（去掉正在输入的 frag）
  const head = input.slice(0, tokenStart).trim()
  const prevTokens = head ? head.split(/\s+/) : []
  const cmdWord = prevTokens[0]?.toLowerCase() ?? ''

  const hint = cmdWord ? HELP_BY_CMD.get(cmdWord) ?? null : null
  const base: CompletionResult = { items: [], from: tokenStart, to: input.length, hint }

  if (!cmdWord) {
    // 正在输入命令名
    const items = rank(CMD_ITEMS, frag)
    return items.length ? { ...base, items } : null
  }

  const def = defFor(cmdWord)
  if (!def) return null

  // 正在输入的 token 序号（0=命令本身；1=第一个参数）
  const tokenIdx = prevTokens.length

  // select 名 = 表达式：第一个参数位提示已有命名（便于覆盖）
  if ((cmdWord === 'select' || cmdWord === 'sel') && tokenIdx === 1 && frag && !head.includes('=')) {
    const named = ctx.namedSelections.map(n => ({ insert: n, kind: 'sel' as const, detail: '覆盖命名选择' }))
    const kw = SEL_KEYWORDS.slice(0, 8).map(([k, d]) => ({ insert: k, kind: 'sel' as const, detail: d }))
    const items = rank([...named, ...kw], frag)
    if (items.length) return { ...base, items }
  }

  // 通用：参数位候选（注册表 args）
  const argItems = def.args?.(tokenIdx, ctx, prevTokens) ?? null
  const items = rank(argItems ?? [], frag)
  if (items.length) return { ...base, items }

  // 选择表达式命令：任意参数位都补全选择关键字
  if (def.expr) {
    const sels = rank(selItems(ctx), frag)
    if (sels.length) return { ...base, items: sels }
  }

  // morph 等长参数命令：后续位继续给结构候选（args 返回函数本身时已在上面处理）
  return null
}
