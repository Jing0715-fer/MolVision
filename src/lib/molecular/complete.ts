// 命令行智能补全引擎：按光标前的部分 token 产出候选（命令名/子命令/结构名/选择关键字…）
// 纯函数模块（仅依赖静态注册表），上下文（结构列表/命名选择）由调用方注入
import { COMMAND_HELP, commandCmd, commandExample } from './commands'
import { COLOR_SCHEME_LABELS } from './colors'
import { REP_LABELS } from './types'
import { useSceneStore } from './scene-store'
import { tt, type DualText } from '@/i18n'

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

/** 选择表达式关键字（chain/resi/…/and/or/not；within 与 byres 后接参数）——提示文本双语，事件时 tt() 求值 */
const SEL_KEYWORDS: [string, DualText][] = [
  ['chain', { zh: '链 ID', en: 'chain ID' }],
  ['chainidx', { zh: '链组序号', en: 'chain-group index' }],
  ['resi', { zh: '残基编号', en: 'residue number' }],
  ['resn', { zh: '残基名称', en: 'residue name' }],
  ['name', { zh: '原子名', en: 'atom name' }],
  ['elem', { zh: '元素', en: 'element' }],
  ['molecule', { zh: '配体分子编号', en: 'ligand molecule number' }],
  ['protein', { zh: '蛋白', en: 'protein' }],
  ['nucleic', { zh: '核酸', en: 'nucleic' }],
  ['ligand', { zh: '配体', en: 'ligand' }],
  ['water', { zh: '水', en: 'water' }],
  ['backbone', { zh: '主链', en: 'backbone' }],
  ['sidechain', { zh: '侧链', en: 'side chain' }],
  ['helix', { zh: '螺旋', en: 'helix' }],
  ['sheet', { zh: '折叠', en: 'sheet' }],
  ['within', { zh: '距离内：within 5 of (…)', en: 'Within distance: within 5 of (…)' }],
  ['byres', { zh: '按残基扩展', en: 'Expand to whole residues' }],
  ['bychain', { zh: '按链扩展', en: 'Expand to whole chains' }],
  ['ss', { zh: '二级结构：ss h/s/l（PyMOL 字母）', en: 'Secondary structure: ss h/s/l (PyMOL letters)' }],
  ['id', { zh: 'PDB 原子序号：id 100-200', en: 'PDB atom serial: id 100-200' }],
  ['b', { zh: 'B 因子比较：b > 50', en: 'B-factor comparison: b > 50' }],
  ['q', { zh: '占据率比较：q > 0.5', en: 'Occupancy comparison: q > 0.5' }],
  ['hydrogen', { zh: '氢原子（not hydrogen 排氢）', en: 'Hydrogen atoms (not hydrogen excludes them)' }],
  ['in', { zh: '按残基交集（A in B）', en: 'Residue-wise intersection (A in B)' }],
  ['like', { zh: '按残基+原子交集（A like B）', en: 'Residue+atom intersection (A like B)' }],
  ['byobject', { zh: '扩展到整个对象', en: 'Expand to the whole object' }],
  ['all', { zh: '全部原子', en: 'All atoms' }],
  ['none', { zh: '空集', en: 'Empty set' }],
  ['and', { zh: '交集', en: 'Intersection' }],
  ['or', { zh: '并集', en: 'Union' }],
  ['not', { zh: '补集', en: 'Complement' }],
  ['sele', { zh: '当前选择（sel 同义）', en: 'Current selection (sel synonym)' }],
  ['sel', { zh: '当前选择（ChimeraX 关键词）', en: 'Current selection (ChimeraX keyword)' }],
  ['/A', { zh: '链说明符（ChimeraX /A）', en: 'Chain specifier (ChimeraX /A)' }],
  [':42', { zh: '残基号/名（ChimeraX :42/:HEM）', en: 'Residue number/name (ChimeraX :42/:HEM)' }],
  ['@CA', { zh: '原子名（ChimeraX @CA）', en: 'Atom name (ChimeraX @CA)' }],
  ['#1', { zh: '模型号（ChimeraX #1）', en: 'Model number (ChimeraX #1)' }],
  ['zone', { zh: '邻域（ChimeraX :HEM zone 5）', en: 'Neighborhood (ChimeraX :HEM zone 5)' }],
  ['ions', { zh: '金属离子（ChimeraX）', en: 'Metal ions (ChimeraX)' }],
]

const COMMON_COLORS: [string, DualText][] = [
  ['red', { zh: '红', en: 'Red' }], ['blue', { zh: '蓝', en: 'Blue' }], ['green', { zh: '绿', en: 'Green' }], ['yellow', { zh: '黄', en: 'Yellow' }], ['orange', { zh: '橙', en: 'Orange' }],
  ['purple', { zh: '紫', en: 'Purple' }], ['cyan', { zh: '青', en: 'Cyan' }], ['magenta', { zh: '品红', en: 'Magenta' }], ['teal', { zh: '鸭绿', en: 'Teal' }], ['pink', { zh: '粉', en: 'Pink' }],
  ['lime', { zh: '亮绿', en: 'Lime' }], ['brown', { zh: '棕', en: 'Brown' }], ['slate', { zh: '石板灰', en: 'Slate' }], ['gray', { zh: '灰', en: 'Gray' }], ['white', { zh: '白', en: 'White' }], ['black', { zh: '黑', en: 'Black' }],
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
  ctx.structures.map(n => ({ insert: n, kind: 'struct' as const, detail: tt({ zh: '结构', en: 'Structure' }) }))

const selItems = (ctx: CompletionCtx): CompletionItem[] => [
  ...SEL_KEYWORDS.map(([k, d]) => ({ insert: k, kind: 'sel' as const, detail: tt(d) })),
  ...ctx.namedSelections.map(n => ({ insert: n, kind: 'sel' as const, detail: tt({ zh: '命名选择', en: 'Named selection' }) })),
]

const repItems = (): CompletionItem[] => [
  ...Object.keys(REP_LABELS).map(k => ({ insert: k, kind: 'rep' as const, detail: tt(REP_LABELS[k as keyof typeof REP_LABELS]) })),
  { insert: 'hydrogens', kind: 'rep', detail: tt({ zh: '显示氢', en: 'Show hydrogens' }) },
  { insert: 'waters', kind: 'rep', detail: tt({ zh: '显示水', en: 'Show waters' }) },
]

const colorItems = (): CompletionItem[] => [
  ...Object.keys(COLOR_SCHEME_LABELS).map(k => ({ insert: k, kind: 'color' as const, detail: tt(COLOR_SCHEME_LABELS[k as keyof typeof COLOR_SCHEME_LABELS]) })),
  ...COMMON_COLORS.map(([c, d]) => ({ insert: c, kind: 'color' as const, detail: tt(d) })),
]

const onOff = (): CompletionItem[] => [
  { insert: 'on', kind: 'value', detail: tt({ zh: '开', en: 'On' }) },
  { insert: 'off', kind: 'value', detail: tt({ zh: '关', en: 'Off' }) },
]

/** preset 名候选（scene 命令非子命令时仍可作 preset 别名） */
const presetNameItems = (): CompletionItem[] => [
  { insert: 'publication', kind: 'preset', detail: tt({ zh: '出版级互作（卡通+口袋球棍）', en: 'Publication-grade interactions (cartoon + pocket ball-stick)' }) },
  { insert: 'bindingsite', kind: 'preset', detail: tt({ zh: '结合口袋', en: 'Binding site' }) },
  { insert: 'cartoon', kind: 'preset', detail: tt({ zh: 'Cartoon 经典', en: 'Classic cartoon' }) },
  { insert: 'ballstick', kind: 'preset', detail: tt({ zh: '球棍模型', en: 'Ball-and-stick' }) },
  { insert: 'spacefill', kind: 'preset', detail: tt({ zh: '空间填充', en: 'Spacefill' }) },
  { insert: 'wireframe', kind: 'preset', detail: tt({ zh: '线框', en: 'Wireframe' }) },
  { insert: 'surface', kind: 'preset', detail: tt({ zh: '分子表面', en: 'Molecular surface' }) },
  { insert: 'hybrid', kind: 'preset', detail: tt({ zh: '混合风格', en: 'Hybrid style' }) },
  { insert: 'putty', kind: 'preset', detail: tt({ zh: 'Putty B 因子管', en: 'Putty B-factor tube' }) },
]

/** 已保存场景名候选（scene recall/del/update <名> 补全；SSR 安全） */
const sceneNameItems = (): CompletionItem[] => {
  try {
    return useSceneStore.getState().scenes.map(sc => ({ insert: sc.name, kind: 'sel' as const, detail: tt({ zh: '场景快照', en: 'Scene snapshot' }) }))
  } catch {
    return []
  }
}

const REGISTRY: CmdDef[] = [
  { names: ['load', 'fetch', 'open'], args: () => null },
  { names: ['select', 'sel'], expr: true, args: (pos, ctx) => (pos === 1 ? [{ insert: 'add', kind: 'sub', detail: tt({ zh: '追加（ChimeraX）', en: 'Add (ChimeraX)' }) }, { insert: 'subtract', kind: 'sub', detail: tt({ zh: '移除（ChimeraX）', en: 'Subtract (ChimeraX)' }) }, { insert: 'zone', kind: 'sub', detail: tt({ zh: '邻域扩展（ChimeraX）', en: 'Zone expand (ChimeraX)' }) }, ...selItems(ctx)] : pos >= 2 ? selItems(ctx) : null) },
  { names: ['deselect', 'desel'], args: () => null },
  // ChimeraX 动词兼容注册（open/focus/bgcolor/silhouettes/rotate/translate/presets/transparency）
  { names: ['focus'], expr: true, args: (pos, ctx) => (pos >= 1 ? selItems(ctx) : null) },
  { names: ['bgcolor'] },
  { names: ['silhouettes', 'silhouette'], args: (pos) => (pos === 1 ? [{ insert: 'on', kind: 'sub', detail: tt({ zh: '轮廓线开启', en: 'Outlines on' }) }, { insert: 'off', kind: 'sub', detail: tt({ zh: '轮廓线关闭', en: 'Outlines off' }) }] : null) },
  { names: ['rotate'], args: (pos) => (pos === 1 ? ['x', 'y', 'z'].map(a => ({ insert: a, kind: 'value', detail: tt({ zh: '旋转轴', en: 'Rotation axis' }) })) : null) },
  { names: ['translate'], args: (pos) => (pos === 1 ? ['x', 'y', 'z'].map(a => ({ insert: a, kind: 'value', detail: tt({ zh: '平移轴', en: 'Translation axis' }) })) : null) },
  { names: ['presets'], args: (pos) => (pos === 1 ? [
    { insert: 'interactive', kind: 'sub', detail: tt({ zh: '交互预设（ChimeraX）→ hybrid', en: 'Interactive preset (ChimeraX) → hybrid' }) },
    { insert: 'publication', kind: 'sub', detail: tt({ zh: '出版预设（ChimeraX）→ publication', en: 'Publication preset (ChimeraX) → publication' }) },
  ] : null) },
  { names: ['transparency'], args: (pos) => (pos === 1 ? ['0.3', '0.5', '0.7'].map(v => ({ insert: v, kind: 'value', detail: tt({ zh: '透明度 0-1（ChimeraX 语义）', en: 'Transparency 0-1 (ChimeraX semantics)' }) })) : null) },
  {
    names: ['spectrum'],
    args: (pos) => (pos === 1
      ? [
          { insert: 'count', kind: 'sub', detail: tt({ zh: '链序连续渐变', en: 'Continuous gradient along chain order' }) },
          { insert: 'b', kind: 'sub', detail: tt({ zh: 'B 因子渐变（低蓝→高红）', en: 'B-factor gradient (low blue → high red)' }) },
        ]
      : pos === 2
        ? [{ insert: 'rainbow', kind: 'value', detail: tt({ zh: '彩虹渐变（PyMOL 惯例词）', en: 'Rainbow gradient (PyMOL convention)' }) }]
        : null),
    expr: true,
  },
  {
    names: ['iterate'],
    expr: true,
    args: (pos) => (pos >= 2
      ? ['name', 'resn', 'resi', 'chain', 'ss', 'b', 'q', 'elem', 'index'].map(f => ({ insert: f, kind: 'value', detail: tt({ zh: 'iterate 输出字段', en: 'iterate output field' }) }))
      : null),
  },
  { names: ['alter'], expr: true, args: (pos) => (pos >= 2 ? ['b', 'q', 'name'].map(f => ({ insert: `${f}=`, kind: 'value', detail: tt({ zh: 'alter 可改属性', en: 'alter modifiable property' }) })) : null) },
  { names: ['cell'], args: (pos) => (pos === 1 ? [{ insert: 'on', kind: 'sub', detail: tt({ zh: '晶胞盒开启', en: 'Unit-cell box on' }) }, { insert: 'off', kind: 'sub', detail: tt({ zh: '晶胞盒关闭', en: 'Unit-cell box off' }) }] : null) },
  {
    names: ['create'],
    expr: true,
    args: (pos, ctx) => (pos === 2
      ? [{ insert: '=', kind: 'value', detail: tt({ zh: '名 = 选择', en: 'name = selection' }) }]
      : pos >= 3 ? selItems(ctx) : null),
  },
  { names: ['split_chains'] },
  {
    names: ['isolate'],
    expr: true,
    args: (pos, ctx) => (pos >= 1
      ? [...selItems(ctx), { insert: 'off', kind: 'sub', detail: tt({ zh: '恢复全部链', en: 'Restore all chains' }) }]
      : null),
  },
  {
    names: ['chains'],
    args: pos => (pos === 1 ? [
      { insert: 'hide', kind: 'sub', detail: tt({ zh: '隐藏链：chains hide A+B', en: 'Hide chains: chains hide A+B' }) },
      { insert: 'show', kind: 'sub', detail: tt({ zh: '恢复链：chains show A / all', en: 'Show chains: chains show A / all' }) },
      { insert: 'list', kind: 'sub', detail: tt({ zh: '列出全部链组及显隐', en: 'List all chain groups and visibility' }) },
    ] : null),
  },
  {
    names: ['scene'],
    args: (pos) => (pos === 1 ? [
      { insert: 'save', kind: 'sub', detail: tt({ zh: '快照当前完整状态（相机+表示法+链隔离+环境）', en: 'Snapshot the full state (camera + representations + chain isolation + environment)' }) },
      { insert: 'recall', kind: 'sub', detail: tt({ zh: '召回场景', en: 'Recall scene' }) },
      { insert: 'update', kind: 'sub', detail: tt({ zh: '用当前状态覆盖既有场景', en: 'Overwrite the existing scene with current state' }) },
      { insert: 'next', kind: 'sub', detail: tt({ zh: '轮播下一个', en: 'Cycle to next' }) },
      { insert: 'prev', kind: 'sub', detail: tt({ zh: '轮播上一个', en: 'Cycle to previous' }) },
      { insert: 'list', kind: 'sub', detail: tt({ zh: '列出全部场景', en: 'List all scenes' }) },
      ...presetNameItems(),
    ] : pos >= 2 ? sceneNameItems() : null),
  },
  { names: ['show', 'display'], args: (pos, ctx) => (pos === 1 ? repItems() : pos >= 2 ? selItems(ctx) : null) },
  { names: ['hide', 'undisplay'], args: (pos, ctx) => (pos === 1 ? repItems() : pos >= 2 ? selItems(ctx) : null) },
  { names: ['color', 'colour'], args: (pos, ctx) => (pos === 1 ? colorItems() : pos >= 2 ? selItems(ctx) : null) },
  {
    names: ['util'],
    args: pos => (pos === 1 ? [
      { insert: 'cbc', kind: 'sub', detail: tt({ zh: '按链着色', en: 'Color by chain' }) },
      { insert: 'cnc', kind: 'sub', detail: tt({ zh: '灰化', en: 'Grayscale' }) },
      { insert: 'ss', kind: 'sub', detail: tt({ zh: '二级结构', en: 'Secondary structure' }) },
      { insert: 'cbaw', kind: 'sub', detail: tt({ zh: '元素+白碳', en: 'Element + white carbon' }) },
      { insert: 'cbac', kind: 'sub', detail: tt({ zh: '元素+灰碳', en: 'Element + gray carbon' }) },
    ] : null),
  },
  {
    names: ['set'],
    args: pos => (pos === 1 ? [
      { insert: 'ambient', kind: 'value', detail: tt({ zh: '环境光 0-2', en: 'Ambient light 0-2' }) },
      { insert: 'direct', kind: 'value', detail: tt({ zh: '主光 0-3', en: 'Key light 0-3' }) },
      { insert: 'fill', kind: 'value', detail: tt({ zh: '补光 0-2', en: 'Fill light 0-2' }) },
      { insert: 'specular', kind: 'value', detail: tt({ zh: '高光 on/off', en: 'Specular on/off' }) },
      { insert: 'fog', kind: 'value', detail: tt({ zh: '雾 on/off', en: 'Fog on/off' }) },
      { insert: 'fog_strength', kind: 'value', detail: tt({ zh: '雾强度 0-1', en: 'Fog strength 0-1' }) },
      { insert: 'fov', kind: 'value', detail: tt({ zh: '视场角 10-100', en: 'Field of view 10-100' }) },
      { insert: 'spin_speed', kind: 'value', detail: tt({ zh: '转速 0.5-20', en: 'Spin speed 0.5-20' }) },
      { insert: 'transition', kind: 'value', detail: tt({ zh: '过渡手感 quick/normal/cinematic', en: 'Transition feel quick/normal/cinematic' }) },
      { insert: 'quality', kind: 'value', detail: tt({ zh: 'low/medium/high', en: 'low/medium/high' }) },
      { insert: 'stereo', kind: 'value', detail: tt({ zh: '立体 on/off', en: 'Stereo on/off' }) },
      { insert: 'axes', kind: 'value', detail: tt({ zh: '罗盘 on/off', en: 'Axis gizmo on/off' }) },
      { insert: 'outline_strength', kind: 'value', detail: tt({ zh: '轮廓强度 0-3', en: 'Outline strength 0-3' }) },
      { insert: 'outline_thickness', kind: 'value', detail: tt({ zh: '轮廓粗细 1-4 px', en: 'Outline thickness 1-4 px' }) },
      { insert: 'fps', kind: 'value', detail: tt({ zh: 'FPS 指示 on/off', en: 'FPS indicator on/off' }) },
      { insert: 'auto_perf', kind: 'value', detail: tt({ zh: '自动性能 on/off', en: 'Auto performance on/off' }) },
      { insert: 'cap_color', kind: 'value', detail: tt({ zh: '切层封盖色', en: 'Slab cap color' }) },
      { insert: 'cap_shading', kind: 'value', detail: tt({ zh: '封盖深度明暗', en: 'Cap depth shading' }) },
      { insert: 'seq_focus', kind: 'value', detail: tt({ zh: '序列视口聚焦', en: 'Sequence viewport focus' }) },
      { insert: 'transparency', kind: 'value', detail: tt({ zh: '表面不透明度', en: 'Surface opacity' }) },
      { insert: 'sphere_scale', kind: 'value', detail: tt({ zh: '球半径倍率', en: 'Sphere radius scale' }) },
      { insert: 'stick_radius', kind: 'value', detail: tt({ zh: '棍半径', en: 'Stick radius' }) },
      { insert: 'cartoon_width', kind: 'value', detail: tt({ zh: '带宽度', en: 'Cartoon width' }) },
      { insert: 'bg_follow', kind: 'value', detail: tt({ zh: '背景主题跟随 on/off', en: 'Background follows theme on/off' }) },
    ] : null),
  },
  { names: ['bg', 'background'], args: pos => (pos === 1 ? colorItems() : null) },
  { names: ['zoom'], expr: true, args: (pos, ctx) => (pos >= 1 ? selItems(ctx) : null) },
  {
    names: ['turn', 'move'],
    args: pos => (pos === 1 ? [
      { insert: 'x', kind: 'sub', detail: tt({ zh: '屏幕右轴（turn 俯仰 / move 右移）', en: 'Screen-right axis (turn pitch / move right)' }) },
      { insert: 'y', kind: 'sub', detail: tt({ zh: '屏幕上轴（turn 水平方位 / move 上移）', en: 'Screen-up axis (turn yaw / move up)' }) },
      { insert: 'z', kind: 'sub', detail: tt({ zh: '视线轴（turn 滚转 / move 推拉）', en: 'View axis (turn roll / move dolly)' }) },
    ] : null),
  },
  {
    names: ['view'],
    args: (pos, ctx) => (pos === 1 ? [
      { insert: 'from', kind: 'sub', detail: tt({ zh: '从选择方向观察（口袋正对相机）', en: 'View from the selection direction (pocket facing the camera)' }) },
      { insert: 'front', kind: 'sub', detail: tt({ zh: '正视（沿 Z）', en: 'Front view (along Z)' }) },
      { insert: 'top', kind: 'sub', detail: tt({ zh: '俯视（沿 Y）', en: 'Top view (along Y)' }) },
      { insert: 'left', kind: 'sub', detail: tt({ zh: '左视', en: 'Left view' }) },
      { insert: 'right', kind: 'sub', detail: tt({ zh: '右视（沿 X）', en: 'Right view (along X)' }) },
      { insert: 'back', kind: 'sub', detail: tt({ zh: '后视', en: 'Back view' }) },
      { insert: 'bottom', kind: 'sub', detail: tt({ zh: '仰视', en: 'Bottom view' }) },
      { insert: 'save', kind: 'sub', detail: tt({ zh: '保存当前视角', en: 'Save the current view' }) },
      { insert: 'go', kind: 'sub', detail: tt({ zh: '跳转书签', en: 'Jump to bookmark' }) },
      { insert: 'del', kind: 'sub', detail: tt({ zh: '删除书签', en: 'Delete bookmark' }) },
      { insert: 'list', kind: 'sub', detail: tt({ zh: '列出书签', en: 'List bookmarks' }) },
      ...ctx.viewBookmarks.map(b => ({ insert: b, kind: 'value' as const, detail: tt({ zh: '视角书签', en: 'View bookmark' }) })),
    ] : pos === 2 ? [
      { insert: 'ligand', kind: 'sel', detail: tt({ zh: '全部配体', en: 'All ligands' }) },
      { insert: 'protein', kind: 'sel', detail: tt({ zh: '蛋白', en: 'Protein' }) },
    ] : null),
  },
  { names: ['activate'], args: (pos, ctx) => (pos === 1 ? structItems(ctx) : null) },
  { names: ['orient'], expr: true, args: (pos, ctx) => (pos >= 1 ? selItems(ctx) : null) },
  { names: ['get_view', 'set_view'] },
  {
    names: ['tour'],
    args: pos => (pos === 1 ? [
      { insert: 'quickstart', kind: 'tour', detail: tt({ zh: '快速上手', en: 'Quick start' }) },
      { insert: 'drug-target', kind: 'tour', detail: tt({ zh: '药物口袋', en: 'Drug pocket' }) },
      { insert: 'crystallography', kind: 'tour', detail: tt({ zh: '晶体学', en: 'Crystallography' }) },
      { insert: 'nmr-dynamics', kind: 'tour', detail: tt({ zh: 'NMR 动力学', en: 'NMR dynamics' }) },
      { insert: 'antibody', kind: 'tour', detail: tt({ zh: '抗体表位', en: 'Antibody epitope' }) },
      { insert: 'nucleic', kind: 'tour', detail: tt({ zh: '核酸', en: 'Nucleic acids' }) },
      { insert: 'stop', kind: 'sub', detail: tt({ zh: '停止', en: 'Stop' }) },
    ] : null),
  },
  { names: ['count_atoms'], expr: true, args: (pos, ctx) => (pos >= 1 ? selItems(ctx) : null) },
  { names: ['spin'], args: pos => (pos === 1 ? onOff() : null) },
  { names: ['rock'], args: pos => (pos === 1 ? onOff() : null) },
  {
    names: ['slab'],
    args: pos => (pos === 1 ? [
      { insert: 'move', kind: 'sub', detail: tt({ zh: '沿视线移动 ±Å', en: 'Move along the view axis ±Å' }) },
      { insert: 'center', kind: 'sub', detail: tt({ zh: '回中', en: 'Recenter' }) },
      { insert: 'cap', kind: 'sub', detail: tt({ zh: '截面封盖 on/off', en: 'Section caps on/off' }) },
      { insert: 'off', kind: 'value', detail: tt({ zh: '关闭', en: 'Turn off' }) },
    ] : pos === 2 ? [
      { insert: '-5', kind: 'value', detail: tt({ zh: '向相机 5 Å', en: '5 Å toward the camera' }) },
      { insert: '5', kind: 'value', detail: tt({ zh: '离相机 5 Å', en: '5 Å away from the camera' }) },
      { insert: '-10', kind: 'value', detail: tt({ zh: '向相机 10 Å', en: '10 Å toward the camera' }) },
      { insert: '10', kind: 'value', detail: tt({ zh: '离相机 10 Å', en: '10 Å away from the camera' }) },
      { insert: 'on', kind: 'value', detail: tt({ zh: '封盖开启', en: 'Caps on' }) },
      { insert: 'off', kind: 'value', detail: tt({ zh: '封盖关闭', en: 'Caps off' }) },
    ] : null),
  },
  {
    names: ['perf'],
    args: pos => (pos === 1 ? [
      { insert: 'status', kind: 'sub', detail: tt({ zh: '当前状态', en: 'Current status' }) },
      { insert: 'on', kind: 'value', detail: tt({ zh: '开启', en: 'On' }) },
      { insert: 'off', kind: 'value', detail: tt({ zh: '关闭并还原', en: 'Off and restore' }) },
      { insert: 'restore', kind: 'sub', detail: tt({ zh: '手动恢复', en: 'Manual restore' }) },
    ] : null),
  },
  { names: ['stereo'], args: pos => (pos === 1 ? onOff() : null) },
  { names: ['symmetry'], args: pos => (pos === 1 ? [{ insert: 'off', kind: 'value', detail: tt({ zh: '关闭', en: 'Turn off' }) }] : null) },
  {
    names: ['map'],
    args: pos => (pos === 1 ? [
      { insert: 'fetch', kind: 'sub', detail: tt({ zh: '2Fo-Fc 密度', en: '2Fo-Fc density' }) },
      { insert: 'fofc', kind: 'sub', detail: tt({ zh: 'Fo-Fc 差图', en: 'Fo-Fc difference map' }) },
      { insert: 'isolevel', kind: 'sub', detail: tt({ zh: '等值面 σ', en: 'Isosurface σ' }) },
      { insert: 'off', kind: 'sub', detail: tt({ zh: '移除', en: 'Remove' }) },
    ] : null),
  },
  {
    names: ['hbonds'],
    args: (pos, ctx) => (pos === 1
      ? [
        { insert: 'on', kind: 'sub', detail: tt({ zh: '开（默认 3.5Å）', en: 'On (default 3.5Å)' }) },
        { insert: 'off', kind: 'sub', detail: tt({ zh: '关', en: 'Off' }) },
        { insert: 'in', kind: 'sub', detail: tt({ zh: '烘焙独立范围（不随 deselect 清除）', en: 'Baked standalone scope (not cleared by deselect)' }) },
      ]
      : pos >= 2
        ? [
          { insert: 'in', kind: 'sub', detail: tt({ zh: '烘焙独立范围（不随 deselect 清除）', en: 'Baked standalone scope (not cleared by deselect)' }) },
          { insert: '3.2', kind: 'value', detail: tt({ zh: '距离上限 Å（2-6）', en: 'Distance cutoff Å (2-6)' }) },
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
      ? [...structItems(ctx), { insert: 'onto', kind: 'sub', detail: tt({ zh: '参考结构', en: 'Reference structure' }) }]
      : pos === 2
        ? [{ insert: 'onto', kind: 'sub', detail: tt({ zh: '参考结构', en: 'Reference structure' }) }, { insert: 'chain', kind: 'sub', detail: tt({ zh: '链对 A to B', en: 'Chain pair A to B' }) }]
        : structItems(ctx)),
  },
  { names: ['dssp'] },
  { names: ['contacts'], expr: true, args: (pos, ctx) => (pos >= 1 ? selItems(ctx) : null) },
  { names: ['interface'] },
  {
    names: ['xcontacts'],
    expr: true,
    args: (pos, ctx) => (pos === 1
      ? ctx.structures.map(n => ({ insert: `${n}:`, kind: 'struct', detail: tt({ zh: '结构:选择', en: 'structure:selection' }) }))
      : selItems(ctx)),
  },
  { names: ['sasa'] },
  { names: ['bsa'] },
  { names: ['xbsa'] },
  { names: ['untransform'], args: (pos, ctx) => (pos === 1 ? structItems(ctx) : null) },
  {
    names: ['record'],
    args: pos => (pos === 1 ? [
      { insert: 'start', kind: 'sub', detail: tt({ zh: '开始录制', en: 'Start recording' }) },
      { insert: 'stop', kind: 'sub', detail: tt({ zh: '完成并保存', en: 'Finish and save' }) },
    ] : null),
  },
  {
    names: ['morph'],
    args: (pos, ctx, tokens) => {
      const isMulti = tokens[1]?.toLowerCase() === 'multi'
      const eqPos = isMulti ? 3 : 2
      if (pos === 1) return [{ insert: 'multi', kind: 'sub', detail: tt({ zh: '多态样条（3+ 构象）', en: 'Multi-state spline (3+ conformers)' }) }]
      if (pos === eqPos) return [{ insert: '=', kind: 'value', detail: tt({ zh: '名 = 构象 A 构象 B…', en: 'name = conformer A conformer B…' }) }]
      if (pos > eqPos) return structItems(ctx)
      return null // 对象名自由命名
    },
  },
  {
    names: ['movie'],
    args: pos => (pos === 1 ? [
      { insert: 'play', kind: 'sub', detail: tt({ zh: '播放 [smooth|hold] [秒 轮]', en: 'Play [smooth|hold] [seconds rounds]' }) },
      { insert: 'stop', kind: 'sub', detail: tt({ zh: '停止', en: 'Stop' }) },
      { insert: 'smooth', kind: 'sub', detail: tt({ zh: '默认平滑巡航（录像连贯）', en: 'Default smooth cruise (silky recordings)' }) },
      { insert: 'hold', kind: 'sub', detail: tt({ zh: '默认逐帧驻留（经典）', en: 'Default per-frame dwell (classic)' }) },
      { insert: 'edit', kind: 'sub', detail: tt({ zh: '时间轴编排', en: 'Timeline editing' }) },
    ] : pos === 2 ? [
      { insert: 'smooth', kind: 'value', detail: tt({ zh: '平滑巡航：连续路径', en: 'Smooth cruise: continuous path' }) },
      { insert: 'hold', kind: 'value', detail: tt({ zh: '逐帧驻留：经典', en: 'Per-frame dwell: classic' }) },
    ] : null),
  },
  {
    names: ['ensemble'],
    args: pos => (pos === 1 ? [
      { insert: 'play', kind: 'sub', detail: tt({ zh: '播放', en: 'Play' }) },
      { insert: 'stop', kind: 'sub', detail: tt({ zh: '停止', en: 'Stop' }) },
      { insert: 'frame', kind: 'sub', detail: tt({ zh: '跳到帧', en: 'Jump to frame' }) },
      { insert: 'fps', kind: 'sub', detail: tt({ zh: '帧率', en: 'Frame rate' }) },
      { insert: 'info', kind: 'sub', detail: tt({ zh: '信息', en: 'Info' }) },
    ] : null),
  },
  { names: ['save'], args: (pos, ctx) => (pos >= 2 ? selItems(ctx) : null) },
  { names: ['png'] },
  { names: ['ray'] },
  {
    names: ['svg'],
    args: pos => (pos === 1 ? [
      { insert: '1200', kind: 'value', detail: tt({ zh: '宽 1200 px', en: 'Width 1200 px' }) },
      { insert: '1600', kind: 'value', detail: tt({ zh: '宽 1600 px（默认）', en: 'Width 1600 px (default)' }) },
      { insert: '2400', kind: 'value', detail: tt({ zh: '宽 2400 px', en: 'Width 2400 px' }) },
      { insert: '3200', kind: 'value', detail: tt({ zh: '宽 3200 px', en: 'Width 3200 px' }) },
    ] : null),
  },
  { names: ['axes', 'axis', 'gizmo'], args: pos => (pos === 1 ? onOff() : null) },
  {
    names: ['session'],
    args: pos => (pos === 1 ? [
      { insert: 'save', kind: 'sub', detail: tt({ zh: '本地存档', en: 'Local archive' }) },
      { insert: 'export', kind: 'sub', detail: tt({ zh: '导出 .molvision', en: 'Export .molvision' }) },
      { insert: 'new', kind: 'sub', detail: tt({ zh: '新建会话', en: 'New session' }) },
      { insert: 'info', kind: 'sub', detail: tt({ zh: '存档信息', en: 'Archive info' }) },
      { insert: 'clear', kind: 'sub', detail: tt({ zh: '清除存档', en: 'Clear archive' }) },
    ] : null),
  },
  {
    names: ['history'],
    args: pos => (pos === 1 ? [
      { insert: 'clear', kind: 'sub', detail: tt({ zh: '清空历史（置顶保留）', en: 'Clear history (pinned kept)' }) },
    ] : null),
  },
  { names: ['label'], args: pos => (pos === 1 ? onOff() : null) },
  {
    names: ['preset', 'style'],
    args: pos => (pos === 1 ? presetNameItems() : null),
  },
  { names: ['delete'], args: (pos, ctx) => (pos === 1 ? ctx.namedSelections.map(n => ({ insert: n, kind: 'sel', detail: tt({ zh: '命名选择', en: 'Named selection' }) })) : null) },
  { names: ['close'], args: (pos, ctx) => (pos === 1 ? [...structItems(ctx), { insert: 'all', kind: 'value', detail: tt({ zh: '全部结构', en: 'All structures' }) }] : null) },
  { names: ['clear'] },
  { names: ['help', '?'] },
]

/** 命令名候选（主名 + 全部别名） */
const CMD_ITEMS: CompletionItem[] = REGISTRY.flatMap(d =>
  d.names.map(n => ({ insert: n, kind: 'cmd' as const })),
)

const HELP_BY_CMD = new Map<string, (typeof COMMAND_HELP)[number]>()
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

  // 参数提示（ConsoleBar 直读 string 字段）——事件时求值，cmd 占位符/desc/example 均随界面语言
  const h = cmdWord ? HELP_BY_CMD.get(cmdWord) ?? null : null
  const hint = h ? { cmd: commandCmd(h), desc: tt(h.desc), example: commandExample(h) } : null
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
    const named = ctx.namedSelections.map(n => ({ insert: n, kind: 'sel' as const, detail: tt({ zh: '覆盖命名选择', en: 'Overwrite named selection' }) }))
    const kw = SEL_KEYWORDS.slice(0, 8).map(([k, d]) => ({ insert: k, kind: 'sel' as const, detail: tt(d) }))
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
