// 模板命令白名单校验器（r79 创立）
// ─────────────────────────────────────────────────────────────────────────────
// 用途：AI 图片解析（/api/templates/parse）产出的命令在入库前必须过这道闸；
// 自定义模板编辑表单（textarea 逐行）也复用同一校验做实时高亮——服务端与
// 客户端共用同一份纯函数（零 next/zustand/three 依赖，两端皆可 import）。
//
// 设计原则（与 agent 协议的「命令经白名单校验后复用 runCommand」一脉相承）：
//  · 模板是「可一键重放的持久命令序列」——比对话命令更严格：每条必须完整、
//    可独立执行、限定在图式配方相关动词面（表示法/着色/视角/灯光/轮廓/分析/
//    测量/双结构 load·morph·superpose/disable·enable）
//  · 校验失败不抛错而是「剔除 + 说明」（dropped 列表回传 UI 透明展示——用户
//    看得到 AI 想执行什么、为什么被拦）；有效命令 < 2 条时调用方判 422
//  · 三层防线：①字符集（拦控制字符/注入符号）②动词白名单（首 token）③
//    逐动词参数形状（anchored 正则——与 commands.ts 注册表语法逐条对照）

/** 单条校验结果 */
export interface CommandCheck {
  ok: boolean
  /** 不通过的原因（UI dropped 列表展示用，双语由调用方 t() 包装；这里给稳定的 key 级中文短语） */
  reason?: string
}

/** 图片解析模板草案协议（/api/templates/parse 响应 ↔ 前端审核表单；r79 共用类型） */
export interface TemplateDraft {
  name: { zh: string; en: string }
  tagline: { zh: string; en: string }
  purpose: { zh: string; en: string }
  tags: { zh: string; en: string }[]
  category: 'basic' | 'surface' | 'conform' | 'site' | 'interaction' | 'membrane'
  demo: string
  accent: 'rose' | 'emerald' | 'amber' | 'sky' | 'violet' | 'teal' | 'orange' | 'fuchsia' | 'lime' | 'cyan' | 'slate'
  analysis: { zh: string; en: string }
  commands: string[]
}

/** 选择表达式安全字符集：字母数字 + PyMOL/ChimeraX 说明符符号（# @ : / & | ~ + - = < > % *）+
 *  标点（, . ( ) ' " 空格）。显式排除：分号/反引号/$/大括号/中括号/反斜杠/!/?
 *  ——模板命令用不到它们，出现即按注入/垃圾拦截 */
const SEL_CHARS = /^[a-zA-Z0-9+#\-_,.()|:/&~'="<>%*\s]+$/

/** 图式配方相关的动词白名单（commands.ts 注册表的模板子集；大小写不敏感）。
 *  刻意排除：save/session/png/svg/record/movie（导出与录制类——ray 例外收录：内置
 *  publication-ready 模板即以 ray 1920 收尾，静帧导出是出版图式的一部分）、
 *  perf/help/history/tour（UI 态） */
const TEMPLATE_VERBS = new Set([
  'load', 'create', 'activate',
  'preset', 'show', 'hide', 'isolate', 'chains',
  'color', 'spectrum', 'util', 'bg', 'reset_colors',
  'select', 'deselect', 'count_atoms', 'iterate', 'alter', 'label',
  'zoom', 'orient', 'view', 'turn', 'move',
  'set', 'spin', 'rock', 'slab', 'stereo', 'ssao', 'outline', 'axes', 'fps', 'fog',
  'hbonds', 'contacts', 'xcontacts', 'interface', 'sasa', 'bsa', 'xbsa', 'dssp',
  'measure', 'superpose', 'untransform',
  'morph', 'ensemble',
  'disable', 'enable',
  'map', 'symmetry',
  'scene', 'split_chains',
  'membrane', 'pore', 'ray', 'use',
])

/** 逐动词参数形状（anchored 全匹配；多行 i 标志；命中任一即过）。
 *  覆盖 27 个内置模板的全部命令 + 图式配方合理变体（LLM 产出面） */
const VERB_SHAPES: { verb: string; res: RegExp[] }[] = [
  { verb: 'load', res: [/^load\s+[0-9a-z]{4}$/i] },
  { verb: 'preset', res: [/^preset\s+(cartoon|ballstick|spacefill|wireframe|surface|bindingsite|publication|hybrid|putty|interactive)$/i] },
  { verb: 'show', res: [
    /^(show|display)\s+(cartoon|putty|ballstick|sticks|lines|spacefill|surface|spheres|ribbons|hydrogens|waters|cell|everything|all)\b[^;]*$/i,
    /^~display\b[^;]*$/i,
  ] },
  { verb: 'hide', res: [
    /^hide\s+(cartoon|putty|ballstick|sticks|lines|spacefill|surface|spheres|ribbons|hydrogens|waters|cell|everything|all)\b[^;]*$/i,
    /^~show\b[^;]*$/i,
  ] },
  { verb: 'color', res: [/^colou?r\s+[a-z0-9#][^;]*$/i] },
  { verb: 'spectrum', res: [/^spectrum\s+(count|b|residue|ss)\s*,\s*(rainbow|blue_red|red_blue|cyan_maroon|greyscale|gray|blue_white_red|rainbow2|ramp)\b[^;]*$/i] },
  { verb: 'util', res: [/^util\s+(cbc|cnc|ss|cbss|cbao|cbaw)$/i] },
  { verb: 'bg', res: [/^(bg|bgcolor)\s+[a-z][a-z0-9_]*$|^bg\s+#[0-9a-f]{3,8}$/i] },
  { verb: 'outline', res: [/^(outline|silhouettes)\s+(on|off)(\s+[0-9.]+\s+[0-9.]+)?$/i] },
  { verb: 'orient', res: [/^orient\b[^;]*$/i] },
  { verb: 'view', res: [
    /^view\s+(front|back|top|bottom|left|right|x|y|z)$/i,
    /^view\s+(from|save|go)\b[^;]*$/i,
    /^view\s+[a-z0-9_]+$/i,
  ] },
  { verb: 'turn', res: [/^(turn|rotate)\s+[xyz]\s+[+-]?\d+(\.\d+)?$/i] },
  { verb: 'move', res: [/^(move|translate)\s+[xyz]\s+[+-]?\d+(\.\d+)?$/i] },
  { verb: 'zoom', res: [
    /^zoom\s+(in|out)$/i,
    /^zoom\s+[0-9]+(\.\d+)?$/i,
    /^zoom\b[^;]*$/i, // 选择 + 可选缓冲（zoom sele, 5 / zoom (resn HEM and chain A), 6）
  ] },
  { verb: 'select', res: [/^select\b[^;]*$/i, /^(select add|select subtract)\b[^;]*$/i] },
  { verb: 'deselect', res: [/^deselect$/i] },
  { verb: 'label', res: [/^label\s+(on|off)\b[^;]*$/i, /^~label\b[^;]*$/i] },
  { verb: 'set', res: [/^set\s+[a-z_]+\s+[^;]+$/i] },
  { verb: 'spin', res: [/^spin\s+(on|off)$/i] },
  { verb: 'rock', res: [/^rock\s+(on|off)$/i] },
  { verb: 'slab', res: [/^slab\s+(off|center|cap on|cap off|[+-]?\d+(\.\d+)?|move [+-]?\d+(\.\d+)?)$/i] },
  { verb: 'stereo', res: [/^stereo\s+(on|off)$/i] },
  { verb: 'ssao', res: [/^ssao\s+(on|off)(\s+[0-9.]+)?(\s+[0-9.]+)?$/i] },
  { verb: 'axes', res: [/^axes\s+(on|off)$/i] },
  { verb: 'fps', res: [/^fps\s+(on|off)$/i] },
  { verb: 'fog', res: [/^fog\s+(on|off)$/i] },
  { verb: 'hbonds', res: [/^hbonds\s+(on|off)\b[^;]*$/i] },
  { verb: 'contacts', res: [/^contacts\b[^;]*$/i] },
  { verb: 'xcontacts', res: [/^xcontacts\b[^;]*$/i] },
  { verb: 'interface', res: [/^interface\b[^;]*$/i] },
  { verb: 'sasa', res: [/^sasa$/i] },
  { verb: 'bsa', res: [/^bsa$/i] },
  { verb: 'xbsa', res: [/^xbsa$/i] },
  { verb: 'dssp', res: [/^dssp$/i] },
  { verb: 'measure', res: [/^measure\s+(dist|distance|angle|dihedral|clear)\b[^;]*$/i] },
  { verb: 'superpose', res: [/^(superpose|align|match)\s+[a-z0-9_]+\s*(onto\s+[a-z0-9_]+\s*)?(chain\s+\S+\s+to\s+\S+)?$/i] },
  { verb: 'untransform', res: [/^untransform\b[^;]*$/i] },
  { verb: 'morph', res: [/^morph\s+(multi\s+)?[a-z_][a-z0-9_]*\s*=\s*[a-z0-9_][a-z0-9_ ]*\s+(\d+)$/i] },
  { verb: 'ensemble', res: [/^ensemble\s+(play|stop|frame\s+\d+)$/i] },
  { verb: 'disable', res: [/^disable\b[^;]*$/i] },
  { verb: 'enable', res: [/^enable\b[^;]*$/i] },
  { verb: 'map', res: [/^map\s+(fetch|fofc)\s+[0-9a-z]{4}$/i] },
  { verb: 'symmetry', res: [/^symmetry\s+(off|[0-9]+(\.[0-9]+)?)$/i] },
  { verb: 'isolate', res: [/^isolate(\s+off|\s+\S+.*)?$/i] },
  { verb: 'chains', res: [/^chains\s+(hide|show|list)\b[^;]*$/i] },
  { verb: 'create', res: [/^create\s+[a-z_][a-z0-9_]*\s*=\s*[^;]+$/i] },
  { verb: 'activate', res: [/^activate\s+\S+$/i] },
  { verb: 'split_chains', res: [/^split_chains$/i] },
  { verb: 'count_atoms', res: [/^count_atoms\b[^;]*$/i] },
  { verb: 'iterate', res: [/^iterate\s*\([^)]*\)\s*,\s*[^;]+$/i] },
  { verb: 'alter', res: [/^alter\s*\([^)]*\)\s*,\s*[^;]+$/i] },
  { verb: 'reset_colors', res: [/^reset_colors$/i] },
  { verb: 'scene', res: [/^scene\s+(save|update|del|next|prev|recall)\b[^;]*$|^scene\s+[a-z0-9_]+$/i] },
  { verb: 'membrane', res: [/^(membrane|lipid|bilayer)\s+(off|0|[0-9]{1,2}(\.[0-9]+)?)$/i, /^(membrane|lipid|bilayer)$/i] },
  { verb: 'pore', res: [/^(pore|hole)$/i] },
  { verb: 'ray', res: [/^ray(\s+[0-9]{3,4})?$/i] },
  { verb: 'use', res: [/^use\s+[a-z0-9_]+$/i] },
]

/** 单条模板命令校验（三层防线依次过） */
export function validateTemplateCommand(rawCmd: string): CommandCheck {
  const cmd = rawCmd.trim().replace(/\s+/g, ' ')
  if (!cmd) return { ok: false, reason: '空命令' }
  if (cmd.length > 200) return { ok: false, reason: '命令超长（>200 字符）' }
  if (!SEL_CHARS.test(cmd)) return { ok: false, reason: '含不受支持的字符（分号/反引号/$/花括号等）' }
  // ChimeraX 取反前缀（~display → hide）在 VERB_SHAPES 里按别名处理——先归一化首词
  const firstRaw = cmd.split(/\s+/)[0]?.toLowerCase() ?? ''
  const verb =
    firstRaw === '~display' ? 'hide'
    : firstRaw === '~show' ? 'hide'
    : firstRaw === '~label' ? 'label'
    : /^(display|bgcolor|silhouettes|rotate|translate|distance|align|match)$/.test(firstRaw) && VERB_SHAPES.some(v => v.verb === ({
      display: 'show', bgcolor: 'bg', silhouettes: 'outline', rotate: 'turn', translate: 'move', distance: 'measure', align: 'superpose', match: 'superpose',
    } as Record<string, string>)[firstRaw])
      ? ({
        display: 'show', bgcolor: 'bg', silhouettes: 'outline', rotate: 'turn', translate: 'move', distance: 'measure', align: 'superpose', match: 'superpose',
      } as Record<string, string>)[firstRaw]
      : firstRaw
  if (!TEMPLATE_VERBS.has(verb)) return { ok: false, reason: `动词不在图式模板白名单（${firstRaw}）` }
  const shapes = VERB_SHAPES.find(v => v.verb === verb)
  if (shapes && !shapes.res.some(re => re.test(cmd))) {
    return { ok: false, reason: `参数形状不符合「${verb}」的命令语法` }
  }
  return { ok: true }
}

/** PyMOL 用户习惯归一：set 键值间的裸「=」剥离（set ambient = 0.4 → set ambient 0.4——
 *  实测 glm-4.6v 解析产出此形态，commands.ts 的 set 解析按空白切分不识别等号） */
function normalizeCommand(cmd: string): string {
  const setEq = /^set\s+([a-z_]+)\s*=\s*(.+)$/i.exec(cmd)
  if (setEq) return `set ${setEq[1].toLowerCase()} ${setEq[2].trim()}`
  return cmd
}

/** 批量校验：有效命令保留（trim + 空白归一 + set 等号归一），无效命令进 dropped（附原因） */
export function sanitizeTemplateCommands(
  list: unknown,
): { commands: string[]; dropped: { cmd: string; reason: string }[] } {
  const commands: string[] = []
  const dropped: { cmd: string; reason: string }[] = []
  if (!Array.isArray(list)) return { commands, dropped }
  for (const item of list) {
    if (typeof item !== 'string') {
      dropped.push({ cmd: String(item).slice(0, 80), reason: '命令必须是字符串' })
      continue
    }
    const norm = normalizeCommand(item.trim().replace(/\s+/g, ' '))
    const check = validateTemplateCommand(norm)
    if (check.ok) commands.push(norm)
    else dropped.push({ cmd: norm.slice(0, 80) || '(空)', reason: check.reason ?? '未知原因' })
  }
  return { commands, dropped }
}
