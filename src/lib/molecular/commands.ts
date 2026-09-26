// PyMOL 风格命令行：select / show / hide / color / bg / zoom / spin / slab / label / create / map / symmetry / stereo ...
import { PRESETS, useMolStore, engineRef, dataRegistry, buildNamedMasks } from './store'
import { SCENE_PRESETS } from './scenes'
import { FIGURE_TEMPLATES, runTemplateCommands } from './figure-templates'
import { saveSession, clearSession, sessionInfo, exportSessionFile, newSession } from './session'
import { parseCssColor, COLOR_SCHEME_LABELS, type ColorScheme } from './colors'
import { REP_LABELS, type RepType } from './types'
import { useEnsembleStore } from './ensemble-store'
import { useRecordStore } from './record-store'
import { runContactAnalysis, runBuriedSasa, runCrossContactAnalysis, runCrossBuriedSasa } from './contacts'
import { useContactStore } from './contacts-store'
import { useSasaStore } from './sasa-store'
import { subsetStructure } from './parser'
import type { StructureData } from './parser'
import { structureToPdbText } from './pdbwriter'
import { textRegistry } from './text-registry'
import { evaluateSelection, maskToIndices } from './selection'
import { fetchAndComputeMap, removeMap, setMapLook } from './map-load'
import { useMapStore } from './map-store'
import { MAX_BOOKMARKS, useViewsStore } from './views-store'
import { useSceneStore } from './scene-store'
import { useTourStore } from './tour-store'
import { TOURS, findTour } from './tours'
import { buildMorph, buildMultiMorph } from './morph'
import { playMovie, stopMovie, useMovieStore } from './movie'
import { buildSvgExport, downloadSvg } from './svg-export'
import { clearCmdHistory } from './cmd-history'
import { whenEngineReady } from './engine-ready'
import { toast } from 'sonner'
import { tt, loc, type DualText } from '@/i18n'

/** 数值裁剪（NaN 时取默认值） */
function clampNum(v: number, min: number, max: number, dflt: number): number {
  if (isNaN(v)) return dflt
  return Math.max(min, Math.min(max, v))
}

/** PyMOL 逗号语法拆分：`show ballstick, ligand` → head='ballstick' tail='ligand'。
 *  选择表达式语法本身不含顶层逗号，首个逗号必是 <参数>, <选择> 分隔（LLM 的 PyMOL 惯性写法，实测高频）。 */
function commaSplit(rest: string): { head: string; tail: string } {
  const i = rest.indexOf(',')
  if (i === -1) return { head: rest.trim(), tail: '' }
  return { head: rest.slice(0, i).trim(), tail: rest.slice(i + 1).replace(/\s*,\s*/g, ' ').trim() }
}

/** <head> 与 <tail> 里的空格式选择拼接（空格语法与逗号语法统一后的选择表达式） */
function joinSel(head: string, tail: string): string {
  return [head, tail].filter(Boolean).join(' ').trim()
}

const REP_ALIASES: Record<string, RepType> = {
  cartoon: 'cartoon', ribbon: 'cartoon', ribbons: 'cartoon',
  putty: 'putty', 'b-factor': 'putty', bfactor: 'putty',
  ballstick: 'ballstick', 'ball&stick': 'ballstick', bs: 'ballstick',
  // ChimeraX 风格表示名兼容（atoms/ball/balls/stick/surfaces/wires）
  atoms: 'ballstick', ball: 'ballstick', balls: 'ballstick',
  sticks: 'sticks', stick: 'sticks', lines: 'lines', wire: 'lines', wires: 'lines', wireframe: 'lines',
  spacefill: 'spacefill', sphere: 'spacefill', spheres: 'spacefill', cpk: 'spacefill',
  surface: 'surface', surf: 'surface', surfaces: 'surface',
}

const SCHEME_ALIASES: Record<string, ColorScheme> = {
  element: 'element', cpk: 'element',
  // ChimeraX color byX 双词方案兼容
  byelement: 'element', bychain: 'chain', byhetero: 'element', byhet: 'element',
  chain: 'chain', spectrum: 'spectrum', rainbow: 'spectrum',
  residue: 'residue', resn: 'residue', byresidue: 'residue',
  ss: 'ss', secondary: 'ss', secstr: 'ss',
  bfactor: 'bfactor', b: 'bfactor', temp: 'bfactor',
  sasa: 'sasa', sas: 'sasa', accessibility: 'sasa',
  uniform: 'uniform',
  pocket: 'pocket', liganddist: 'pocket',
}

/** 按残基实例分组（同一残基编号的原子归为一实例——如 4 个 HEM 各为一实例）*/
function groupInstances(data: StructureData, indices: number[]): { indices: number[]; label: string }[] {
  const byRes = new Map<number, number[]>()
  for (const i of indices) {
    const ri = data.atomResidue[i]
    const arr = byRes.get(ri)
    if (arr) arr.push(i)
    else byRes.set(ri, [i])
  }
  const out: { indices: number[]; label: string }[] = []
  for (const [ri, idxs] of byRes) {
    const res = data.residues[ri]
    out.push({ indices: idxs, label: `${res.resName}${res.resSeq}${res.chainId.trim() ? '·' + res.chainId.trim() : ''}` })
  }
  return out
}

/** 多配体兑底：挑离相机目标最近的残基实例（view from 失败时的自动单配体聚焦） */
function nearestInstance(data: StructureData, indices: number[], eng: NonNullable<typeof engineRef.current>): { indices: number[]; label: string } | null {
  const insts = groupInstances(data, indices)
  if (insts.length < 2) return insts[0] ?? null
  const t = eng.getCameraState().target
  let best: { indices: number[]; label: string } | null = null
  let bestD = Infinity
  for (const inst of insts) {
    let cx = 0, cy = 0, cz = 0
    for (const i of inst.indices) {
      cx += data.atoms.positions[i * 3]; cy += data.atoms.positions[i * 3 + 1]; cz += data.atoms.positions[i * 3 + 2]
    }
    cx /= inst.indices.length; cy /= inst.indices.length; cz /= inst.indices.length
    const d = Math.hypot(cx - t[0], cy - t[1], cz - t[2])
    if (d < bestD) { bestD = d; best = inst }
  }
  return best
}

export const COMMAND_HELP: { cmd: string; cmdEn?: string; desc: DualText; example: string; exampleEn?: string }[] = [
  { cmd: 'load|open <id>', desc: { zh: '从 RCSB 加载 PDB 结构（ChimeraX open 同义）', en: 'Load PDB structure from RCSB (ChimeraX open synonym)' }, example: 'load 4hhb · open 4hhb' },
  { cmd: 'create <名> = <选择>', cmdEn: 'create <name> = <selection>', desc: { zh: '从选择创建新对象', en: 'Create a new object from a selection' }, example: 'create pocket = within 5 of resn HEM' },
  { cmd: 'split_chains', desc: { zh: '按链组拆分为多个对象', en: 'Split into one object per chain group' }, example: 'split_chains' },
  { cmd: 'select [name=]expr', desc: { zh: '选择原子（可命名；sele=当前选择）', en: 'Select atoms (optionally named; sele = current selection)' }, example: 'select site = within 5 of resn HEM' },
  { cmd: 'spectrum count|b, [彩虹] [选择]', cmdEn: 'spectrum count|b, [rainbow] [selection]', desc: { zh: '按属性连续渐变着色（PyMOL 兼容）', en: 'Continuous property-based coloring (PyMOL compatible)' }, example: 'spectrum b, rainbow · spectrum count' },
  { cmd: 'iterate (选择), 字段…', cmdEn: 'iterate (selection), fields…', desc: { zh: '遍历选择打印原子属性（只读）', en: 'Iterate over a selection printing atom properties (read-only)' }, example: 'iterate (chain A and name CA), name resn resi b' },
  { cmd: 'alter (选择), 属性=值', cmdEn: 'alter (selection), property=value', desc: { zh: '修改原子属性（b/q/name）', en: 'Modify atom properties (b/q/name)' }, example: 'alter (resi 100-110), b=b+10' },
  { cmd: 'show <rep> [sel]', desc: { zh: '添加表示法（逗号/空格分隔皆可）', en: 'Add a representation (comma or space separated)' }, example: 'show ballstick, ligand · show cartoon protein' },
  { cmd: 'hide <rep> [sel]', desc: { zh: '移除匹配的表示法', en: 'Remove matching representations' }, example: 'hide lines' },
  { cmd: 'color <方案|颜色> [sel]', cmdEn: 'color <scheme|color> [sel]', desc: { zh: '给选择上色（pocket=配体距离渐变）', en: 'Color a selection (pocket = ligand-distance gradient)' }, example: 'color red chain A · color pocket' },
  { cmd: 'util cbc|cnc|ss|cbss|cbao|cbaw', desc: { zh: '实用着色（链/灰/SS卡通/元素+AO/元素+白碳）', en: 'Utility coloring (by-chain / gray / SS cartoon / element+AO / element+white-C)' }, example: 'util cbc · util cbss' },
  { cmd: 'set <项> <值>', cmdEn: 'set <setting> <value>', desc: { zh: '渲染设置（灯光/fov/质量/过渡手感 transition…）', en: 'Render settings (lighting / fov / quality / transition feel…)' }, example: 'set ambient 0.5 · set transition cinematic' },
  { cmd: 'bg <颜色>', cmdEn: 'bg <color>', desc: { zh: '设置背景色', en: 'Set background color' }, example: 'bg black' },
  { cmd: 'zoom [sel|in|out|N]', desc: { zh: '聚焦选择/推拉镜头（纯数字=ChimeraX 倍率；focus 同义）', en: 'Focus selection / dolly camera (bare number = ChimeraX magnification; focus synonym)' }, example: 'zoom ligand · zoom 2 · focus :HEM' },
  { cmd: 'turn <x|y|z> <±°>', desc: { zh: '旋转视角（x俯仰 y水平 z滚转）', en: 'Rotate view (x pitch, y yaw, z roll)' }, example: 'turn y 30 · turn x -15' },
  { cmd: 'move <x|y|z> <±Å>', desc: { zh: '平移视角（x右 y上 z推拉）', en: 'Translate view (x right, y up, z dolly)' }, example: 'move z -10 · move x 5' },
  { cmd: 'view <front|top|left|right|back|bottom|x|y|z>', desc: { zh: '正交视角预设（保持距离平滑转）', en: 'Orthographic view presets (smooth, distance preserved)' }, example: 'view top · view front' },
  { cmd: 'activate <名|编号>', cmdEn: 'activate <name|index>', desc: { zh: '切换活动结构（多结构工作流）', en: 'Switch active structure (multi-structure workflows)' }, example: 'activate 1BQL' },
  { cmd: 'orient [sel]', desc: { zh: '主轴对齐视角（PCA）', en: 'Principal-axis aligned view (PCA)' }, example: 'orient chain A' },
  { cmd: 'get_view / set_view', desc: { zh: '视角导出/恢复（JSON）', en: 'Export/restore camera view (JSON)' }, example: 'get_view' },
  { cmd: 'view save|go|del|list…', desc: { zh: '视角书签（缩略图+平滑跳转，Shift+数字）', en: 'View bookmarks (thumbnails + smooth jumps, Shift+number)' }, example: 'view save 口袋', exampleEn: 'view save pocket' },
  { cmd: 'tour [id]|stop', desc: { zh: '引导式演示场景（逐步自动操作）', en: 'Guided demo scenes (stepwise auto-operation)' }, example: 'tour quickstart' },
  { cmd: 'measure dist|angle|dihedral (选择A) (选择B)…', cmdEn: 'measure dist|angle|dihedral (selectionA) (selectionB)…', desc: { zh: '选择表达式测量（距离取最近原子对，角度/二面角取质心；3D 标注入测量面板）', en: 'Selection-expression measurements (nearest atom pair for distance, centroids for angle/dihedral; 3D labels + measurement panel)' }, example: 'measure dist (resn HEM) (within 5 of resn HEM and protein) · measure clear' },
  { cmd: 'count_atoms [expr]', desc: { zh: '统计原子数', en: 'Count atoms' }, example: 'count_atoms chain A' },
  { cmd: 'spin on|off', desc: { zh: '自动旋转', en: 'Auto rotation' }, example: 'spin on' },
  { cmd: 'rock on|off', desc: { zh: '相机摇摆（±26°）', en: 'Camera rocking (±26°)' }, example: 'rock on' },
  { cmd: 'slab <n>|move <±Å>|center|cap|off', desc: { zh: '视向切层（厚度/位置/截面封盖）', en: 'Depth clipping (thickness / position / section caps)' }, example: 'slab 20 · slab move -5 · slab cap off' },
  { cmd: 'stereo on|off', desc: { zh: '红蓝立体渲染', en: 'Red-cyan stereo rendering' }, example: 'stereo on' },
  { cmd: 'symmetry <半径Å>|off', cmdEn: 'symmetry <radius Å>|off', desc: { zh: '晶体对称伴侣（CRYST1）', en: 'Crystallographic symmetry mates (CRYST1)' }, example: 'symmetry 25' },
  { cmd: 'map fetch <id>|fofc|isolevel pos/neg', desc: { zh: '电子密度图（SF→FFT，Worker 零阻塞；结构未加载时自动获取；差图双 σ）', en: 'Electron density maps (SF→FFT in a worker, zero blocking; auto-fetch if not loaded; difference map dual σ)' }, example: 'map fofc 3ekj' },
  { cmd: 'hbonds on|off [n]', desc: { zh: '氢键网络开关/距离', en: 'H-bond network toggle / distance' }, example: 'hbonds on 3.2' },
  { cmd: 'ssao on|off [r]', desc: { zh: '环境光遮蔽开关/半径', en: 'Ambient occlusion toggle / radius' }, example: 'ssao on 3' },
  { cmd: 'superpose <名> [onto <名>] [chain X to Y]', cmdEn: 'superpose <name> [onto <name>] [chain X to Y]', desc: { zh: '结构叠合（序列比对+刚体拟合，可选链对）', en: 'Structure superposition (sequence alignment + rigid-body fit, optional chain pair)' }, example: 'superpose 4HHB onto 1A3N chain A to A' },
  { cmd: 'dssp', desc: { zh: 'DSSP 重算二级结构（含无记录结构）', en: 'DSSP secondary-structure reassignment (incl. structures without records)' }, example: 'dssp' },
  { cmd: 'contacts <exprA> | <exprB> [n]', desc: { zh: '界面接触检测（残基对+连线）', en: 'Interface contact detection (residue pairs + lines)' }, example: 'contacts chain A | chain B 4.0' },
  { cmd: 'interface <链A> <链B> [n]', cmdEn: 'interface <chainA> <chainB> [n]', desc: { zh: '链间界面快捷命令', en: 'Inter-chain interface shortcut' }, example: 'interface A B' },
  { cmd: 'xcontacts <A>:<expr> | <B>:<expr> [n]', desc: { zh: '跨结构接触（复合物界面，建议先 superpose）', en: 'Cross-structure contacts (complex interface; superpose first recommended)' }, example: 'xcontacts 1UBQ:chain A | 1D3Z:chain A 5.0' },
  { cmd: 'sasa [probe] [点数]', cmdEn: 'sasa [probe] [points]', desc: { zh: '溶剂可及面积计算（Shrake–Rupley）', en: 'Solvent-accessible surface area (Shrake–Rupley)' }, example: 'sasa 1.4 92' },
  { cmd: 'bsa', desc: { zh: '界面埋藏面积 ΔSASA（需 contacts A/B）', en: 'Interface buried area ΔSASA (requires contacts A/B)' }, example: 'bsa' },
  { cmd: 'xbsa', desc: { zh: '跨结构界面埋藏面积（需 xcontacts，两结构联合三路 SASA）', en: 'Cross-structure buried area (requires xcontacts; joint 3-way SASA of both structures)' }, example: 'xbsa' },
  { cmd: 'untransform [名]', cmdEn: 'untransform [name]', desc: { zh: '撤销叠合变换回原始位姿', en: 'Undo superposition transform, restore original pose' }, example: 'untransform 1D3Z' },
  { cmd: 'record start|stop', desc: { zh: '录制动画为 WebM 视频', en: 'Record animation as WebM video' }, example: 'record start' },
  { cmd: 'morph <名> = <A> <B> [帧] [norefine]', cmdEn: 'morph <name> = <A> <B> [frames] [norefine]', desc: { zh: '构象插值轨迹（自动叠合 + 键长约束/去碰撞精修）', en: 'Conformational interpolation trajectory (auto superpose + bond-length/clash refinement)' }, example: 'morph m1 = 1BQL 2LYZ 40 · morph m = 1BQL 2LYZ norefine' },
  { cmd: 'morph multi <名> = <A> <B> <C>… [帧]', cmdEn: 'morph multi <name> = <A> <B> <C>… [frames]', desc: { zh: '多态构象样条插值（Catmull-Rom 过 3+ 构象）', en: 'Multi-state conformational spline (Catmull-Rom through 3+ conformers)' }, example: 'morph multi m = 1BQL 2LYZ 2VB1 60' },
  { cmd: 'movie play|stop|smooth|hold|edit [秒 轮]', cmdEn: 'movie play|stop|smooth|hold|edit [seconds rounds]', desc: { zh: '关键帧巡航（smooth=平滑连续路径录像丝滑 · hold=逐帧驻留 · 无秒数走时间轴；edit 编排）', en: 'Keyframe cruise (smooth = continuous path, silky recordings · hold = per-frame dwell · no seconds uses the timeline; edit arranges)' }, example: 'movie play smooth 4 2 · movie smooth' },
  { cmd: 'ensemble play|frame|fps…', desc: { zh: 'NMR 构象动画控制', en: 'NMR ensemble animation control' }, example: 'ensemble play' },
  { cmd: 'save <名>.pdb [选择]', cmdEn: 'save <name>.pdb [selection]', desc: { zh: '导出坐标为 PDB 文件', en: 'Export coordinates as a PDB file' }, example: 'save myprot.pdb chain A' },
  { cmd: 'png [倍率]', cmdEn: 'png [scale]', desc: { zh: '截图导出 PNG', en: 'Screenshot export as PNG' }, example: 'png 2' },
  { cmd: 'ray [宽px]', cmdEn: 'ray [width px]', desc: { zh: 'Ray 级静帧渲染（软阴影+1.5× 真超采样抗锯齿：内部高分辨率渲染后高质量降采样）', en: 'Ray-quality still render (soft shadows + 1.5× true supersampling AA: internal hi-res render then quality downsample)' }, example: 'ray 1920' },
  { cmd: 'svg [宽px]', cmdEn: 'svg [width px]', desc: { zh: '矢量图导出（CPU 投影，无限缩放不失真；可入稿 Illustrator/Inkscape）', en: 'Vector export (CPU projection, infinitely scalable; ready for Illustrator/Inkscape)' }, example: 'svg 2400' },
  { cmd: 'show cell / hide cell', desc: { zh: '晶胞盒线框（CRYST1，a红 b绿 c蓝）', en: 'Unit-cell wireframe (CRYST1, a red b green c blue)' }, example: 'show cell' },
  { cmd: 'axes on|off', desc: { zh: '视口坐标轴指示器（点击轴端对齐视角）', en: 'Viewport axis gizmo (click an axis tip to align the view)' }, example: 'axes off' },
  { cmd: 'fps on|off', desc: { zh: '状态栏性能指示器（FPS/绘制调用/三角形）', en: 'Status-bar performance indicator (FPS / draw calls / triangles)' }, example: 'fps on' },
  { cmd: 'perf on|off|status|restore', desc: { zh: '自动性能模式（低帧率降级/恢复）', en: 'Auto performance mode (degrade on low fps / restore)' }, example: 'perf status · perf off' },
  { cmd: 'outline on|off [强度 粗细]', cmdEn: 'outline on|off [strength thickness]', desc: { zh: '出版级轮廓线（Sobel 深度+亮度描边；ray 同样生效）', en: 'Publication-grade outlines (Sobel depth+brightness edges; applies to ray stills too)' }, example: 'outline on · outline on 2 2.5' },
  { cmd: 'session save|export|new|info|clear', desc: { zh: '会话存档 / 文件导出 / 新建', en: 'Session archive / file export / new session' }, example: 'session export · session new' },
  { cmd: 'history [clear]', desc: { zh: '命令历史面板（搜索/置顶/执行；clear 清空）', en: 'Command history panel (search / pin / run; clear empties)' }, example: 'history · history clear' },
  { cmd: 'label on|off', desc: { zh: '标记当前选择 / 清除标签', en: 'Label current selection / clear labels' }, example: 'label on' },
  { cmd: 'preset <名>', cmdEn: 'preset <name>', desc: { zh: '应用风格预设（含出版级互作）', en: 'Apply a style preset (incl. publication-grade interactions)' }, example: 'preset publication' },
  { cmd: 'isolate <选择>|off', cmdEn: 'isolate <selection>|off', desc: { zh: '链隔离：保留选择所在链隐藏其余（多链蛋白单链配体分析）', en: 'Chain isolation: keep chains touched by the selection, hide the rest (single-chain ligand analysis in multi-chain proteins)' }, example: 'isolate (resn HEM and chain A) · isolate off' },
  { cmd: 'chains hide|show|list', desc: { zh: '链显隐手动控制（同链 ID 多链组全匹配）', en: 'Manual chain visibility control (all groups of a same chain ID matched)' }, example: 'chains hide B+C · chains show all' },
  { cmd: 'scene save|recall|next|list', desc: { zh: '场景快照：相机+表示法+链隔离+环境一体保存切换', en: 'Scene snapshots: camera + representations + chain isolation + environment saved and restored as one' }, example: 'scene save A链口袋 · scene recall A链口袋 · scene next', exampleEn: 'scene save pocket · scene recall pocket · scene next' },
  { cmd: 'delete <名>', cmdEn: 'delete <name>', desc: { zh: '删除命名选择', en: 'Delete a named selection' }, example: 'delete site' },
  { cmd: 'close [名|all]', cmdEn: 'close [name|all]', desc: { zh: '关闭结构（默认活动结构）', en: 'Close structures (active by default)' }, example: 'close · close all · close 4HHB' },
  { cmd: 'clear', desc: { zh: '移除所有结构（同 close all）', en: 'Remove all structures (same as close all)' }, example: 'clear' },
  { cmd: 'figure [id] | templates', desc: { zh: '论文图复现模板库（CNS 图式一键应用；figure rainbow 直接应用）', en: 'Paper-figure template library (CNS styles; figure rainbow applies directly)' }, example: 'figure · templates · figure rainbow' },
  { cmd: 'help', desc: { zh: '显示帮助', en: 'Show help' }, example: 'help' },
]

/** 命令语法/示例的当前语言文本（事件时求值）。cmd 与 example 保持 string 类型——CommandPalette
 *  以其拼接 id、切分图标/填充键、提取可执行示例，翻转 DualText 会破坏跨文件契约；中文占位符与
 *  含中文的示例名经可选 cmdEn / exampleEn 字段平行携带。desc 为 DualText，消费端 t()/tt() 双态兼容。 */
export function commandCmd(h: { cmd: string; cmdEn?: string }): string {
  return tt({ zh: h.cmd, en: h.cmdEn ?? h.cmd })
}

export function commandExample(h: { example: string; exampleEn?: string }): string {
  return tt({ zh: h.example, en: h.exampleEn ?? h.example })
}

/** scene 快照子命令集合（其余词仍是 preset 别名，向后兼容） */
const SCENE_SUBS = new Set(['save', 'add', 'recall', 'go', 'restore', 'update', 'list', 'ls', 'del', 'rm', 'delete', 'clear', 'next', 'prev'])

/** 求值选择表达式并返回原子索引（活动结构；共用路径） */
function evalActiveSelection(expr: string): { indices: number[]; error?: string } {
  const s = useMolStore.getState()
  if (!s.activeId) return { indices: [], error: tt({ zh: '没有活动结构', en: 'No active structure' }) }
  const data = dataRegistry.get(s.activeId)
  if (!data) return { indices: [], error: tt({ zh: '结构数据不存在', en: 'Structure data not found' }) }
  const named = buildNamedMasks(s.activeId, data)
  const r = evaluateSelection(expr, { structure: data, named })
  if (r.error) return { indices: [], error: tt({ zh: `选择错误: ${r.error}`, en: `Selection error: ${r.error}` }) }
  return { indices: maskToIndices(r.mask) }
}

/** 原子索引 → 覆盖链组集合（链隔离判定用） */
function chainGroupsOf(data: StructureData, indices: number[]): Set<number> {
  const groups = new Set<number>()
  for (const i of indices) {
    for (let ci = 0; ci < data.chains.length; ci++) {
      const c = data.chains[ci]
      if (i >= c.start && i < c.end) { groups.add(ci); break }
    }
  }
  return groups
}

/** 链组索引 → 人类可读标签（A（蛋白）· B（配体链）…） */
function chainGroupLabels(entry: { chains: { id: string; type: string }[] }, groups: Iterable<number>): string[] {
  const TYPE_LABEL: Record<string, { zh: string; en: string }> = { protein: { zh: '蛋白', en: 'protein' }, nucleic: { zh: '核酸', en: 'nucleic' }, ligand: { zh: '配体', en: 'ligand' }, water: { zh: '水', en: 'water' }, other: { zh: '其他', en: 'other' } }
  return [...groups].map(g => {
    const c = entry.chains[g]
    return tt({ zh: `${c.id.trim() || '?'}（${(TYPE_LABEL[c.type] ?? TYPE_LABEL.other).zh}）`, en: `${c.id.trim() || '?'} (${(TYPE_LABEL[c.type] ?? TYPE_LABEL.other).en})` })
  })
}

/** isolate / chains / scene 命令实现（commands.ts 内部共用） */
function runIsolateCommand(raw: string, parts: string[], ok: (m: string) => void, err: (m: string) => void): void {
  const rest = raw.slice(parts[0].length).trim().replace(/,/g, ' ').trim()
  const s = useMolStore.getState()

  // isolate off / isolate reset：恢复全部链
  if (!rest) {
    return err(tt({ zh: '用法: isolate <选择表达式>（保留选择所在链，隐藏其余链）/ isolate off（恢复全部链）', en: 'Usage: isolate <selection expression> (keep chains of the selection, hide the rest) / isolate off (show all chains)' }))
  }
  if (rest.toLowerCase() === 'off' || rest.toLowerCase() === 'reset' || rest.toLowerCase() === 'show') {
    if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    s.setChainHidden(s.activeId, null)
    return ok(tt({ zh: '已恢复显示全部链（隔离解除）', en: 'All chains shown (isolation cleared)' }))
  }

  if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
  const data = dataRegistry.get(s.activeId)
  const entry = s.structures.find(x => x.id === s.activeId)
  if (!data || !entry) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))

  const ev = evalActiveSelection(rest)
  if (ev.error) return err(ev.error)
  const keep = chainGroupsOf(data, ev.indices)
  if (!keep.size) return err(tt({ zh: '选择为空', en: 'Selection is empty' }))
  // 同链 ID 连带保留：选择命中配体链组（如 chain A 的 HEM）时，同 ID 的蛋白链组（chain A 聚合部分）
  // 与水链组（chain A 晶体水——口袋环境的组成部分，配体附近常有介导互作的结合水）自动并入保留集
  // ——「分析链 A 的配体」应该看到链 A 蛋白 + 配体 + 链 A 的水，而不是孤零零一个 HEM，
  // 也不是把四聚体全部链的水都留着（r58：口袋分析时水分子必须跟随链隔离收缩到单链）。
  const keepIds = new Set([...keep].map(g => data.chains[g].id.trim().toUpperCase()))
  const linked: number[] = []
  for (let g = 0; g < data.chains.length; g++) {
    if (keep.has(g)) continue
    const c = data.chains[g]
    const isPolymer = c.type === 'protein' || c.type === 'nucleic'
    const isWater = c.type === 'water'
    if ((isPolymer || isWater) && keepIds.has(c.id.trim().toUpperCase())) { keep.add(g); linked.push(g) }
  }
  const hidden: number[] = []
  for (let g = 0; g < data.chains.length; g++) if (!keep.has(g)) hidden.push(g)
  if (!hidden.length) return ok(tt({ zh: '选择已覆盖全部链——无需隔离（所有链都在显示中）', en: 'Selection covers all chains — no isolation needed (all chains already shown)' }))
  s.setChainHidden(s.activeId, hidden)
  const total = data.chains.length
  const waterKept = [...keep].filter(g => data.chains[g].type === 'water').length
  const linkedNote = linked.length ? tt({ zh: `（含同链 ID 连带：${chainGroupLabels(entry, linked).join('、')}——配体所在链的聚合部分与晶体水自动保留）`, en: ` (incl. same-ID linked: ${chainGroupLabels(entry, linked).join(', ')} — polymer part and crystal waters of the ligand chain kept automatically)` }) : ''
  const waterNote = waterKept ? tt({ zh: `；保留 ${waterKept} 个同链水组（口袋结合水跟随隔离）`, en: `; kept ${waterKept} same-chain water group(s) (pocket waters follow isolation)` }) : ''
  return ok(tt({
    zh: `已隔离：保留 ${chainGroupLabels(entry, keep).join('、')}${linkedNote}，隐藏其余 ${hidden.length}/${total} 个链组${waterNote}——多链蛋白分析单链配体时非常实用（isolate off 恢复）`,
    en: `Isolated: kept ${chainGroupLabels(entry, keep).join(', ')}${linkedNote}, hid the other ${hidden.length}/${total} chain groups${waterNote} — handy for single-chain ligand analysis in multi-chain proteins (isolate off to restore)`,
  }))
}

function runChainsCommand(raw: string, parts: string[], ok: (m: string) => void, err: (m: string) => void): void {
  const sub = (parts[1] ?? '').toLowerCase()
  const s = useMolStore.getState()
  if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
  const data = dataRegistry.get(s.activeId)
  const entry = s.structures.find(x => x.id === s.activeId)
  if (!data || !entry) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
  const hidden = entry.hiddenChains ?? []

  if (sub === 'list' || sub === 'ls' || !sub) {
    ok(tt({ zh: `链组（${data.chains.length} 个，隐藏 ${hidden.length} 个）：`, en: `Chain groups (${data.chains.length} total, ${hidden.length} hidden):` }))
    data.chains.forEach((c, i) => {
      const hid = hidden.includes(i)
      ok(`  ${hid ? '⊘' : '◉'}  ${String(i).padStart(2)}  ${(c.id.trim() || '?').padEnd(3)} ${tt({ zh: c.type === 'protein' ? '蛋白' : c.type === 'nucleic' ? '核酸' : c.type === 'ligand' ? '配体' : c.type === 'water' ? '水' : '其他', en: c.type })}  ${tt({ zh: `${c.residueIdx.length} 残基`, en: `${c.residueIdx.length} residues` })}`)
    })
    return ok(tt({ zh: '隐藏：chains hide A+B / chains hide A · 恢复：chains show A / chains show all · 隔离到选择：isolate <选择>', en: 'Hide: chains hide A+B / chains hide A · Show: chains show A / chains show all · Isolate to a selection: isolate <selection>' }))
  }
  if (sub === 'show' || sub === 'hide') {
    // chains hide A+B+C / chains show A / chains show all
    const arg = raw.slice(parts[0].length).trim()
    const subLower = arg.toLowerCase()
    const argRest = subLower.startsWith('show') ? arg.slice(4).trim() : subLower.startsWith('hide') ? arg.slice(4).trim() : ''
    if (sub === 'show' && (argRest === 'all' || argRest === '*')) {
      s.setChainHidden(s.activeId, null)
      return ok(tt({ zh: '已恢复显示全部链', en: 'All chains shown' }))
    }
    const ids = argRest.toUpperCase().split(/[+\s,]+/).map(x => x.trim()).filter(Boolean)
    if (!ids.length) return err(tt({ zh: '用法: chains hide A+B / chains show A / chains show all（链 ID 不分大小写）', en: 'Usage: chains hide A+B / chains show A / chains show all (chain IDs case-insensitive)' }))
    // 同一链 ID 可能对应多个链组（蛋白链 A + 配体链 A）——按 ID 匹配全部组
    const groups = data.chains.map((c, i) => ({ id: c.id.trim().toUpperCase(), i })).filter(c => ids.includes(c.id))
    if (!groups.length) return err(tt({ zh: `未找到链 ${ids.join('+')}——可用链：${[...new Set(data.chains.map(c => c.id.trim() || '?'))].join('、')}`, en: `Chain ${ids.join('+')} not found — available: ${[...new Set(data.chains.map(c => c.id.trim() || '?'))].join(', ')}` }))
    const cur = new Set(hidden)
    if (sub === 'hide') groups.forEach(g => cur.add(g.i))
    else groups.forEach(g => cur.delete(g.i))
    s.setChainHidden(s.activeId, cur.size ? [...cur] : null)
    return ok(tt({
      zh: `已${sub === 'hide' ? '隐藏' : '恢复'}链 ${ids.join('+')}（${groups.length} 个链组）——当前隐藏 ${cur.size}/${data.chains.length} 个链组`,
      en: `Chains ${ids.join('+')} ${sub === 'hide' ? 'hidden' : 'shown'} (${groups.length} chain groups) — now ${cur.size}/${data.chains.length} groups hidden`,
    }))
  }
  return err(tt({ zh: '用法: chains list / chains hide <A+B> / chains show <A|all> / chains reset（同 isolate off）', en: 'Usage: chains list / chains hide <A+B> / chains show <A|all> / chains reset (same as isolate off)' }))
}

function runSceneCommand(parts: string[], ok: (m: string) => void, err: (m: string) => void): void {
  const sc = useSceneStore.getState()
  if (!sc.hydrated) sc.hydrate()
  const sub = (parts[1] ?? '').toLowerCase()
  const rest = parts.slice(2).join(' ').trim()

  if (sub === 'save' || sub === 'add') {
    const r = sc.saveScene(rest || undefined)
    if (!r.ok) return err(r.error)
    return ok(r.updated
      ? tt({ zh: `已更新场景「${r.scene.name}」——相机/表示法/链隔离/环境整体覆盖（结构卡片下方场景条同步刷新）`, en: `Scene "${r.scene.name}" updated — camera/representations/chain isolation/environment overwritten (scene strip under structure cards refreshes)` })
      : tt({ zh: `已保存场景「${r.scene.name}」——相机 + 表示法 + 链隔离 + 环境一体快照（缩略图稍后回填；重名再 save 会更新而非新增）`, en: `Scene "${r.scene.name}" saved — one-shot snapshot of camera + representations + chain isolation + environment (thumbnail backfilled later; saving an existing name updates instead of adding)` }))
  }
  if (sub === 'update') {
    const target = rest ? findScene(rest) : undefined
    if (rest && !target) return err(tt({ zh: `找不到场景「${rest}」——scene list 查看`, en: `Scene "${rest}" not found — see scene list` }))
    const r = sc.updateScene(target ? target.id : sc.activeSceneId ?? (sc.scenes.length - 1))
    if (!r.ok) return err(r.error)
    return ok(tt({ zh: `已用当前状态更新场景「${r.scene.name}」`, en: `Scene "${r.scene.name}" updated with the current state` }))
  }
  if (!sub || sub === 'list' || sub === 'ls') {
    if (!sc.scenes.length) return ok(tt({ zh: '暂无场景快照——scene save [名称] 保存当前完整状态（相机+表示法+链隔离+环境；对比 view save 仅存相机）', en: 'No scene snapshots yet — scene save [name] stores the full state (camera + representations + chain isolation + environment; view save stores the camera only)' }))
    ok(tt({ zh: `场景快照（${sc.scenes.length}/${10}）：`, en: `Scene snapshots (${sc.scenes.length}/10):` }))
    sc.scenes.forEach((x, i) => {
      const t = new Date(x.createdAt).toLocaleTimeString(tt({ zh: 'zh-CN', en: 'en-US' }), { hour: '2-digit', minute: '2-digit' })
      const n = x.structures.length
      ok(`  ${String(i + 1).padEnd(2)}  ${x.name.padEnd(14)} ${t} · ${tt({ zh: `${n} 结构`, en: `${n} structure(s)` })}${x.hbondScope ? tt({ zh: ' · 氢键范围', en: ' · H-bond scope' }) : ''}${x.camera ? tt({ zh: ' · 相机', en: ' · camera' }) : tt({ zh: ' · 无相机', en: ' · no camera' })}${sc.activeSceneId === x.id ? tt({ zh: ' ← 当前', en: ' ← current' }) : ''}`)
    })
    return ok(tt({ zh: '召回：scene <序号|名称>（或 scene recall）；更新：scene update；删除：scene del；轮播：scene next/prev', en: 'Recall: scene <number|name> (or scene recall); update: scene update; delete: scene del; cycle: scene next/prev' }))
  }
  if (sub === 'del' || sub === 'rm' || sub === 'delete') {
    if (!rest) return err(tt({ zh: '用法: scene del <序号|名称>', en: 'Usage: scene del <number|name>' }))
    const target = findScene(rest)
    if (!target) return err(tt({ zh: `找不到场景「${rest}」——scene list 查看`, en: `Scene "${rest}" not found — see scene list` }))
    sc.deleteScene(target.id)
    return ok(tt({ zh: `已删除场景「${target.name}」`, en: `Scene "${target.name}" deleted` }))
  }
  if (sub === 'clear') {
    sc.clearScenes()
    return ok(tt({ zh: '已清空所有场景快照', en: 'All scene snapshots cleared' }))
  }
  if (sub === 'next' || sub === 'prev') {
    if (!sc.scenes.length) return err(tt({ zh: '暂无场景——先 scene save 保存', en: 'No scenes yet — save one with scene save first' }))
    if (!sc.cycleScene(sub === 'next' ? 1 : -1)) return err(tt({ zh: '召回失败（结构未加载？）——场景按结构名恢复，先 load 对应结构', en: 'Recall failed (structure not loaded?) — scenes restore by structure name, load the structure first' }))
    return ok(tt({ zh: `已切换到「${useSceneStore.getState().activeSceneId ? findSceneById(useSceneStore.getState().activeSceneId!)?.name : ''}」`, en: `Switched to "${useSceneStore.getState().activeSceneId ? findSceneById(useSceneStore.getState().activeSceneId!)?.name : ''}"` }))
  }
  // scene <序号|名称> / scene recall <序号|名称>
  const arg = sub === 'recall' || sub === 'go' || sub === 'restore' ? rest : parts.slice(1).join(' ').trim()
  if (!arg) return err(tt({ zh: '用法: scene save [名] | scene <序号|名> | scene update | scene del <名> | scene next/prev | scene list', en: 'Usage: scene save [name] | scene <number|name> | scene update | scene del <name> | scene next/prev | scene list' }))
  const target = findScene(arg)
  if (!target) return err(tt({ zh: `找不到场景「${arg}」——scene list 查看`, en: `Scene "${arg}" not found — see scene list` }))
  const r = sc.recallScene(target.id)
  if (!r.ok) return err(r.error)
  const missing = r.missing.length ? tt({ zh: `；未加载跳过：${r.missing.join('、')}`, en: `; skipped (not loaded): ${r.missing.join(', ')}` }) : ''
  return ok(tt({
    zh: `已召回场景「${target.name}」——恢复 ${r.restored} 个结构的表示法/链隔离/环境${r.cameraApplied ? ' + 相机平滑过渡' : ''}${missing}（scene save 同名可快照当前状态）`,
    en: `Scene "${target.name}" recalled — restored representations/chain isolation/environment for ${r.restored} structure(s)${r.cameraApplied ? ' + smooth camera transition' : ''}${missing} (scene save with the same name snapshots the current state)`,
  }))
}

function findScene(arg: string): { id: string; name: string } | undefined {
  const scenes = useSceneStore.getState().scenes
  const n = Number(arg)
  return Number.isInteger(n) && n >= 1 ? scenes[n - 1] : scenes.find(x => x.name.toLowerCase() === arg.toLowerCase())
}

function findSceneById(id: string): { id: string; name: string } | undefined {
  return useSceneStore.getState().scenes.find(x => x.id === id)
}

export function runCommand(raw: string): void {
  const store = useMolStore.getState()
  const input = raw.trim()
  if (!input) return
  store.appendLog('in', input)
  let lower = input.toLowerCase()
  let parts = input.split(/\s+/)
  let cmd = parts[0].toLowerCase()

  const ok = (msg: string) => store.appendLog('out', msg)
  const err = (msg: string) => store.appendLog('err', msg)

  // ---------- ChimeraX 动词/取反前缀兼容（进入各分支前统一改写） ----------
  // ~display / ~show / ~label → hide 类语义（ChimeraX 波浪号否定命令）
  if (cmd.startsWith('~')) {
    const negated = cmd.slice(1)
    if (negated === 'display' || negated === 'show') return runCommand(`hide ${input.slice(cmd.length).trim() || 'all'}`)
    if (negated === 'label') { useMolStore.getState().clearLabels(); return ok(tt({ zh: '标签已清除（~label）', en: 'Labels cleared (~label)' })) }
  }
  // open → load（ChimeraX 加载动词）
  if (cmd === 'open') cmd = 'load'
  // focus → zoom 拟合（ChimeraX focus）
  if (cmd === 'focus') cmd = 'zoom'
  // bgcolor → bg（ChimeraX）
  if (cmd === 'bgcolor') cmd = 'bg'
  // silhouettes → outline（ChimeraX 轮廓线）
  if (cmd === 'silhouettes' || cmd === 'silhouette') cmd = 'outline'
  // rotate/translate → turn/move（ChimeraX 同义词）
  if (cmd === 'rotate') cmd = 'turn'
  if (cmd === 'translate') cmd = 'move'
  // save image → png（ChimeraX 截图保存）
  if (cmd === 'save' && (parts[1] ?? '').toLowerCase() === 'image') {
    return runCommand(`png ${parts[2] ?? '2'}`)
  }
  // presets <名> → preset <名>（ChimeraX presets；interactive→hybrid 近似、publication 直通）
  if (cmd === 'presets') {
    const p = (parts[1] ?? '').toLowerCase()
    const mapped = p === 'interactive' ? 'hybrid' : p === 'publication' ? 'publication' : p === 'simple' ? 'cartoon' : p === 'hairball' ? 'spacefill' : p
    return runCommand(`preset ${mapped}`)
  }
  // transparency <n> [target] → set transparency（ChimeraX 透明度）
  if (cmd === 'transparency') {
    const v = parseFloat(parts[1] ?? '')
    if (isNaN(v) || v < 0 || v > 1) return err(tt({ zh: '用法：transparency <0-1>（ChimeraX 语义；0=不透明）——等效 set transparency', en: 'Usage: transparency <0-1> (ChimeraX semantics; 0 = opaque) — equivalent to set transparency' }))
    return runCommand(`set transparency ${(1 - v).toFixed(2)}`)
  }
  // 重新计算改写后的分词（open/focus 等改写 cmd 后 parts[0] 保持原词——各分支用 input.slice(parts[0].length) 取参数，
  // cmd 比较已用改写值，参数切取基于首个 token 长度不受影响；但 zoom 数字语义需在此先行拦截）
  if (cmd === 'zoom') {
    const rest0 = input.slice(parts[0].length).trim()
    const zoomNum = parseFloat(rest0.split(/\s+/)[0] ?? '')
    // ChimeraX zoom <倍率>：zoom 2 = 放大 2 倍（纯数字参数；PyMOL zoom 无数字语义——选择表达式不可能以纯数字开头）
    if (rest0 && !isNaN(zoomNum) && /^[\d.]+\s*$/.test(rest0)) {
      const factor = Math.max(0.05, Math.min(20, zoomNum))
      whenEngineReady(() => engineRef.current?.dollyCamera(1 / factor))
      return ok(tt({ zh: `ChimeraX 式缩放 ×${factor}（zoom <倍率>；聚焦选择用 zoom <选择> 或 focus <选择>）`, en: `ChimeraX-style zoom ×${factor} (zoom <factor>; use zoom <selection> or focus <selection> to focus)` }))
    }
  }
  // select add|subtract|intersect <expr>（ChimeraX 选择修饰动词）
  if (cmd === 'select' && ['add', 'subtract', 'intersect'].includes((parts[1] ?? '').toLowerCase())) {
    const mode = (parts[1] ?? '').toLowerCase()
    const expr = input.slice(parts[0].length).trim().slice(mode.length).trim()
    if (!expr) return err(tt({ zh: '用法：select add|subtract|intersect <表达式>（ChimeraX 兼容）', en: 'Usage: select add|subtract|intersect <expression> (ChimeraX compatible)' }))
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有加载结构', en: 'No structure loaded' }))
    const data = dataRegistry.get(s.activeId)
    if (!data) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    const named = buildNamedMasks(s.activeId, data)
    const r = evaluateSelection(expr, { structure: data, named })
    if (r.error) return err(tt({ zh: `选择错误: ${r.error}`, en: `Selection error: ${r.error}` }))
    const idxs = maskToIndices(r.mask)
    if (mode === 'add') {
      s.setSelection(s.activeId, idxs, 'add')
      const total = useMolStore.getState().selection.indices.length
      return ok(tt({ zh: `已追加 ${r.count.toLocaleString(loc())} 原子（select add）→ 当前共 ${total.toLocaleString(loc())}`, en: `Added ${r.count.toLocaleString(loc())} atoms (select add) → ${total.toLocaleString(loc())} now selected` }))
    }
    if (mode === 'subtract') {
      s.setSelection(s.activeId, idxs, 'remove')
      const total = useMolStore.getState().selection.indices.length
      return ok(tt({ zh: `已移除 ${r.count.toLocaleString(loc())} 原子（select subtract）→ 当前共 ${total.toLocaleString(loc())}`, en: `Removed ${r.count.toLocaleString(loc())} atoms (select subtract) → ${total.toLocaleString(loc())} now selected` }))
    }
    // intersect：当前选择 ∩ 新表达式（手动求交）
    const cur = new Set(s.selection.structureId === s.activeId ? s.selection.indices : [])
    const inter = idxs.filter(i => cur.has(i))
    s.setSelection(s.activeId, inter)
    return ok(tt({ zh: `交集 ${inter.length.toLocaleString(loc())} 原子（select intersect）`, en: `Intersection: ${inter.length.toLocaleString(loc())} atoms (select intersect)` }))
  }
  // measure distance/angle/dihedral 无括号 ChimeraX 形式：measure distance @CA :42 → 自动包括号
  if ((cmd === 'measure' || cmd === 'dist' || cmd === 'distance') && input.indexOf('(') < 0) {
    const words = input.split(/\s+/).filter(Boolean)
    const head = words[0].toLowerCase()
    // 剥掉动词与模式词，剩余每个空白 token 视为一个选择组（ChimeraX 习惯：空格分隔即不同原子组）
    const MODES = ['dist', 'distance', 'angle', 'dihedral', 'torsion', 'dihe', 'ang']
    let argStart = 1
    if (head === 'measure' && MODES.includes(words[1]?.toLowerCase() ?? '')) argStart = 2
    const args = words.slice(argStart)
    if (args.length >= 2) {
      const groups = args.map(a => `(${a})`).join(' ')
      return runCommand(`measure ${head === 'distance' ? 'dist' : head === 'measure' ? words[1].toLowerCase() : 'dist'} ${groups}`)
    }
  }
  if (cmd === 'distance' && input.indexOf('(') >= 0) {
    return runCommand(`measure dist ${input.slice(cmd.length).trim()}`)
  }
  parts = input.split(/\s+/)
  lower = input.toLowerCase()

  // ── 论文图复现模板（r71）：figure / templates 开库；figure <id> 直接应用 ──
  if (cmd === 'figure' || cmd === 'templates') {
    useMolStore.getState().setUi({ templateOpen: true })
    return ok(tt({ zh: '论文图复现模板库已打开（近 5 年 CNS 图式）', en: 'Paper-figure template library opened (recent CNS styles)' }))
  }
  if (cmd.startsWith('figure ')) {
    const id = (parts[1] ?? '').toLowerCase()
    const tpl = FIGURE_TEMPLATES.find(x => x.id === id)
    if (!tpl) {
      return err(tt({ zh: `未知模板 "${id}"。可用: ${FIGURE_TEMPLATES.map(x => x.id).join(', ')}`, en: `Unknown template "${id}". Available: ${FIGURE_TEMPLATES.map(x => x.id).join(', ')}` }))
    }
    const s = useMolStore.getState()
    if (!s.structures.length) {
      return err(tt({ zh: '当前没有结构——先 load 一个（如 load 4hhb），或用 templates 面板里的「演示」按钮', en: 'No structure loaded — load one first (e.g. load 4hhb) or use the "Demo" button in the templates panel' }))
    }
    runTemplateCommands(tpl.commands)
    return ok(tt({ zh: `已应用「${tt(tpl.name)}」：${tpl.commands.length} 条命令`, en: `Applied "${tt(tpl.name)}": ${tpl.commands.length} commands` }))
  }

  if (cmd === 'help' || cmd === '?') {
    ok(tt({ zh: '可用命令：', en: 'Available commands:' }))
    for (const h of COMMAND_HELP) ok(`  ${commandCmd(h).padEnd(22)} ${tt(h.desc)}  ${tt({ zh: '例: ', en: 'e.g. ' })}${commandExample(h)}`)
    ok(tt({ zh: '选择语法（PyMOL 风格）：chain A / resi 1-60 / resn ALA / name CA / protein / within 5 of (...) / byres(...) / and or not ( )；sele = 当前选择', en: 'Selection syntax (PyMOL style): chain A / resi 1-60 / resn ALA / name CA / protein / within 5 of (...) / byres(...) / and or not ( ); sele = current selection' }))
    ok(tt({ zh: '选择语法（ChimeraX 风格）：/A 链 · :42 残基号 · :HEM 残基名 · @CA 原子 · #1 模型 · & | ~ 与或非 · X zone 5 邻域（如 select #1/A:42@CA zone 5）——两种语法可混用', en: 'Selection syntax (ChimeraX style): /A chain · :42 residue number · :HEM residue name · @CA atom · #1 model · & | ~ and/or/not · X zone 5 neighborhood (e.g. select #1/A:42@CA zone 5) — the two syntaxes can be mixed' }))
    return
  }

  if (cmd === 'history') {
    // 打开命令历史面板（全量列表 + 搜索 + 置顶；clear 子命令直接清空）
    const sub = (parts[1] ?? '').toLowerCase()
    if (sub === 'clear') {
      clearCmdHistory()
      return ok(tt({ zh: '命令历史已清空（最近命令徽章与 Ctrl+R 搜索同步清除；置顶命令保留）', en: 'Command history cleared (recent-command badge and Ctrl+R search cleared too; pinned commands kept)' }))
    }
    useMolStore.getState().setUi({ historyOpen: true })
    return ok(tt({ zh: '已打开命令历史面板（搜索过滤 · 星标置顶 · 点击执行 · 铅笔填入编辑）', en: 'Command history panel opened (search filter · star pin · click to run · pencil to fill the input)' }))
  }

  if (cmd === 'load' || cmd === 'fetch') {
    const id = parts[1]
    if (!id || !/^[0-9][a-z0-9]{3}$/i.test(id)) return err(tt({ zh: '用法: load <4位PDB编号>，如 load 4hhb', en: 'Usage: load <4-char PDB ID>, e.g. load 4hhb' }))
    void import('./loader').then(m => m.fetchPdbId(id))
    return
  }

  if (cmd === 'select' || cmd === 'sel') {
    const rest = input.slice(parts[0].length).trim()
    // PyMOL 宽容：裸等号写法（resn = HEM / chain = A）——左侧是选择谓词时把「谓词 = 值」
    // 规整为「谓词 值」（否则 assign 正则会把 resn = HEM 误判成命名选择「resn」=「HEM」）；
    // 左侧不是谓词（如 site = within …）仍按命名选择处理
    const PRED_WORDS = new Set(['chain', 'chainidx', 'resi', 'resn', 'name', 'elem', 'element', 'molecule', 'mol', 'id', 'ss', 'b', 'q', 'bfactor', 'occupancy'])
    const eqMatch = rest.match(/^([a-zA-Z_][\w]*)\s*=\s*(.+)$/)
    const normalized = eqMatch && PRED_WORDS.has(eqMatch[1].toLowerCase())
      ? rest.replace(/^([a-zA-Z_][\w]*)\s*=\s*/, '$1 ')
      : rest
    const assign = normalized.match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/)
    if (assign) {
      const name = assign[1]
      const expr = assign[2]
      const res = store.selectFromExpr(expr)
      if (res.error) return err(tt({ zh: `选择错误: ${res.error}`, en: `Selection error: ${res.error}` }))
      if (name.toLowerCase() !== 'sele') {
        useMolStore.setState(s => ({
          namedSelections: [...s.namedSelections.filter(n => n.name !== name), {
            name, structureId: s.activeId!, expr, indices: null, count: res.count,
          }],
        }))
      }
      ok(tt({ zh: `已选择 ${res.count.toLocaleString(loc())} 个原子 → ${name === 'sele' ? '当前选择' : name}`, en: `${res.count.toLocaleString(loc())} atoms selected → ${name === 'sele' ? 'current selection' : name}` }))
    } else {
      if (!rest) return err(tt({ zh: '用法: select <表达式> 或 select <名> = <表达式>', en: 'Usage: select <expression> or select <name> = <expression>' }))
      const res = store.selectFromExpr(normalized)
      if (res.error) return err(tt({ zh: `选择错误: ${res.error}`, en: `Selection error: ${res.error}` }))
      ok(tt({ zh: `已选择 ${res.count.toLocaleString(loc())} 个原子`, en: `${res.count.toLocaleString(loc())} atoms selected` }))
    }
    return
  }

  if (cmd === 'show' || cmd === 'display') {
    // 逗号语法（PyMOL 惯例）：show ballstick, ligand —— 与空格语法 show ballstick ligand 等价
    const { head, tail } = commaSplit(input.slice(parts[0].length).trim())
    const headWords = head.split(/\s+/)
    const repAlias = (headWords[0] ?? '').toLowerCase()
    if (repAlias === 'hydrogens' || repAlias === 'h') {
      useMolStore.getState().updateSettings({ hideHydrogens: false })
      return ok(tt({ zh: '已显示氢原子', en: 'Hydrogens shown' }))
    }
    if (repAlias === 'waters' || repAlias === 'water') {
      const st = useMolStore.getState()
      st.updateSettings({ hideWater: false })
      // 默认 water rep 是 lines——而晶体水的孤立氧无键可画（lines 渲染不出任何几何），
      // 直接切 hideWater 开关什么都看不见（旧版“已显示水分子”实则无视觉变化）。
      // 转为小球显示（0.33Å 氧球，ChimeraX/PyMOL nonbonded 风格）：看得见、可拾取、可 hide。
      // 口袋预设的受限水 rep（water and within N of (ligand)）也在这里扩为全水——
      // show waters 的语义就是“显示所有水”，不与受限范围叠加重复几何。
      let converted = 0
      let added = 0
      for (const entry of st.structures) {
        const waterRep = entry.reps.find(r => r.selection === 'water' || /^resn\s+HOH$/i.test(r.selection) || /^water\s+and\b/i.test(r.selection))
        if (waterRep) {
          if (waterRep.type === 'lines' || waterRep.selection !== 'water') {
            st.updateRep(entry.id, waterRep.id, { type: 'ballstick', selection: 'water', ballScale: 1.5 })
            converted++
          }
        } else {
          st.addRep(entry.id, { type: 'ballstick', selection: 'water', ballScale: 1.5 })
          added++
        }
      }
      return ok(tt({ zh: `已显示水分子${converted ? `（${converted} 个结构的水 rep 已转为小球显示）` : added ? `（新增小球 rep）` : ''}——hide waters 隐藏`, en: `Waters shown${converted ? ` (water rep switched to small spheres in ${converted} structure(s))` : added ? ' (sphere rep added)' : ''} — hide waters to hide` }))
    }
    // PyMOL show cell：晶胞盒线框
    if (repAlias === 'cell') {
      const st = useMolStore.getState()
      st.updateSettings({ showCell: true })
      const data = st.activeId ? dataRegistry.get(st.activeId) : null
      const info = data?.crystal ? tt({ zh: `（${data.crystal.a.toFixed(1)}×${data.crystal.b.toFixed(1)}×${data.crystal.c.toFixed(1)}Å · ${data.crystal.spaceGroup.trim()}）`, en: ` (${data.crystal.a.toFixed(1)}×${data.crystal.b.toFixed(1)}×${data.crystal.c.toFixed(1)} Å · ${data.crystal.spaceGroup.trim()})` }) : tt({ zh: '（当前结构无 CRYST1 晶胞信息——线框不显示）', en: ' (no CRYST1 unit-cell info in this structure — wireframe not shown)' })
      return ok(tt({ zh: `晶胞盒开启 ${info}——a 红 / b 绿 / c 蓝 · hide cell 关闭 · symmetry 20 可生成晶格邻居`, en: `Unit cell shown ${info} — a red / b green / c blue · hide cell to hide · symmetry 20 generates lattice neighbors` }))
    }
    const repType = REP_ALIASES[repAlias]
    if (!repType) return err(tt({ zh: `未知表示法 "${headWords[0]}"。可用: ${Object.keys(REP_ALIASES).slice(0, 7).join(', ')}…`, en: `Unknown representation "${headWords[0]}". Available: ${Object.keys(REP_ALIASES).slice(0, 7).join(', ')}…` }))
    const selExpr = joinSel(headWords.slice(1).join(' '), tail) || 'all'
    if (!useMolStore.getState().activeId) return err(tt({ zh: '没有加载结构', en: 'No structure loaded' }))
    {
      // 选择表达式即时校验（命令行 / agent 失败可感知；面板 UI 添加 rep 不走此路径）
      const s = useMolStore.getState()
      const data = dataRegistry.get(s.activeId!)
      if (data) {
        const named = buildNamedMasks(s.activeId!, data)
        const probe = evaluateSelection(selExpr, { structure: data, named })
        if (probe.error) return err(tt({ zh: `选择表达式无效: ${probe.error}（"${selExpr}"）`, en: `Invalid selection expression: ${probe.error} ("${selExpr}")` }))
      }
    }
    useMolStore.getState().addRep(useMolStore.getState().activeId!, { type: repType, selection: selExpr })
    ok(tt({ zh: `已添加 ${tt(REP_LABELS[repType])} 表示 (${selExpr})`, en: `${tt(REP_LABELS[repType])} representation added (${selExpr})` }))
    return
  }

  if (cmd === 'hide' || cmd === 'undisplay') {
    // 逗号语法：hide cartoon, chain A —— 与空格语法等价
    const { head, tail } = commaSplit(input.slice(parts[0].length).trim())
    const headWords = head.split(/\s+/)
    const arg = (headWords[0] ?? '').toLowerCase()
    if (arg === 'hydrogens' || arg === 'h') {
      useMolStore.getState().updateSettings({ hideHydrogens: true })
      return ok(tt({ zh: '已隐藏氢原子', en: 'Hydrogens hidden' }))
    }
    if (arg === 'waters' || arg === 'water') {
      useMolStore.getState().updateSettings({ hideWater: true })
      return ok(tt({ zh: '已隐藏水分子', en: 'Waters hidden' }))
    }
    if (arg === 'cell') {
      useMolStore.getState().updateSettings({ showCell: false })
      return ok(tt({ zh: '晶胞盒已关闭（show cell 开启）', en: 'Unit cell hidden (show cell to show)' }))
    }
    const repType = REP_ALIASES[arg]
    const s = useMolStore.getState()
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!entry) return err(tt({ zh: '没有加载结构', en: 'No structure loaded' }))
    const selExpr = joinSel(headWords.slice(1).join(' '), tail)
    if (repType) {
      const reps = entry.reps.filter(r => r.type === repType && (!selExpr || r.selection === selExpr))
      for (const r of reps) s.removeRep(entry.id, r.id)
      return ok(tt({ zh: `已移除 ${reps.length} 个 ${tt(REP_LABELS[repType])} 表示`, en: `Removed ${reps.length} ${tt(REP_LABELS[repType])} representation(s)` }))
    }
    // hide 全部
    for (const r of [...entry.reps]) s.removeRep(entry.id, r.id)
    return ok(tt({ zh: '已移除全部表示法', en: 'All representations removed' }))
  }

  if (cmd === 'color' || cmd === 'colour') {
    // 逗号语法（PyMOL 惯例）：color element, ligand / color red, chain A —— 与空格语法等价
    const { head, tail } = commaSplit(input.slice(parts[0].length).trim())
    const headWords = head.split(/\s+/)
    const target = (headWords[0] ?? '').toLowerCase()
    const selExpr = joinSel(headWords.slice(1).join(' '), tail)
    const scheme = SCHEME_ALIASES[target]
    const css = parseCssColor(target)
    if (!scheme && !css) return err(tt({ zh: `未知颜色 "${headWords[0]}"。可用方案: ${Object.keys(SCHEME_ALIASES).join(', ')} 或 #hex / 颜色名`, en: `Unknown color "${headWords[0]}". Available schemes: ${Object.keys(SCHEME_ALIASES).join(', ')} or #hex / color names` }))
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有加载结构', en: 'No structure loaded' }))
    if (selExpr) {
      const res = s.selectFromExpr(selExpr)
      if (res.error) return err(tt({ zh: `选择错误: ${res.error}`, en: `Selection error: ${res.error}` }))
    }
    if (scheme === 'sasa') {
      const data = dataRegistry.get(s.activeId)
      if (data && !data.sasa) {
        // 触发计算（小结构同步完成；大结构 worker，完成后自动烘焙上色）
        const eng = engineRef.current
        const r = eng?.requestSasa(s.activeId)
        if (!r?.done) {
          // r59-a2 #2 修复：命令路径也要登记烘焙回调（旧版漏掉——worker 完成后从不自动上色）
          eng?.queueSasaBake(s.activeId)
          return ok(tt({ zh: 'SASA 后台计算中（Web Worker）——完成后将自动按暴露度着色（埋藏蓝紫 → 暴露橙红）', en: 'SASA computing in background (Web Worker) — will auto-color by exposure when done (buried blue-violet → exposed orange-red)' }))
        }
      }
    }
    s.applyColor(scheme ?? css!)
    ok(tt({ zh: `已上色: ${scheme ? tt(COLOR_SCHEME_LABELS[scheme]) : css}${selExpr ? ` (${selExpr})` : ''}`, en: `Colored: ${scheme ? tt(COLOR_SCHEME_LABELS[scheme]) : css}${selExpr ? ` (${selExpr})` : ''}` }))
    return
  }

  if (cmd === 'reset_colors' || cmd === 'recolor') {
    useMolStore.getState().resetColors(parts[1] ? 'selection' : 'structure')
    return ok(tt({ zh: '已重置颜色', en: 'Colors reset' }))
  }

  if (cmd === 'bg' || cmd === 'background') {
    const css = parseCssColor((parts[1] ?? '').toLowerCase())
    if (!css) return err(tt({ zh: '用法: bg <#hex 或颜色名>', en: 'Usage: bg <#hex or color name>' }))
    useMolStore.getState().updateSettings({ background: css, backgroundPinned: true })
    return ok(tt({ zh: `背景色 → ${css}`, en: `Background color → ${css}` }))
  }

  if (cmd === 'zoom' || cmd === 'fit') {
    const rest = input.slice(parts[0].length).trim()
    // 推拉镜头：zoom in / zoom out（拉近 / 拉远一步）
    const zoomArg = rest.toLowerCase()
    if (zoomArg === 'in') {
      // 引擎可能尚未挂载（欢迎页首发 load 后立即 zoom 的命令链）——入队等待，不静默丢失
      whenEngineReady(() => engineRef.current?.dollyCamera(0.72))
      return ok(tt({ zh: '已拉近（可连按；zoom <选择> 可聚焦特定部分）', en: 'Zoomed in (repeatable; zoom <selection> focuses a specific part)' }))
    }
    if (zoomArg === 'out') {
      whenEngineReady(() => engineRef.current?.dollyCamera(1.38))
      return ok(tt({ zh: '已拉远（可连按；zoom 无参数回到全量适配）', en: 'Zoomed out (repeatable; bare zoom re-fits everything)' }))
    }
    // 逗号语法 + 可选缓冲距离（PyMOL：zoom ligand, 5 → 聚焦后退 5 Å）
    const { head, tail } = commaSplit(rest)
    const buffer = parseFloat(tail)
    const selExpr = head.trim()
    const s = useMolStore.getState()
    if (selExpr) {
      // r59-a2 #6 修复：zoom 是纯取景命令（PyMOL 语义），不该改写「当前选择」——
      // 旧版走 selectFromExpr 落 setSelection，其后裸 color/util cbc 作用域被静默缩小
      const evalRes = evalActiveSelection(selExpr)
      if (evalRes.error) return err(evalRes.error)
      if (!evalRes.indices.length) return err(tt({ zh: `选择 "${selExpr}" 命中 0 个原子（zoom 需要非空选择）`, en: `Selection "${selExpr}" matched 0 atoms (zoom needs a non-empty selection)` }))
      const sid = s.activeId!
      const sel = { structureId: sid, indices: evalRes.indices }
      // 多实例均布提示（纯数据层计算，不依赖引擎）：选择覆盖 2~12 个彼此远离的残基拷贝
      // （如血红蛋白 4×HEM）时全部入框会拉远到全景——输出单实例聚焦写法供用户/修正轮参考
      let spreadNote = ''
      const zdata = sel.structureId ? dataRegistry.get(sel.structureId) : null
      if (zdata && sel.indices.length >= 2) {
        const insts = groupInstances(zdata, sel.indices)
        if (insts.length >= 2 && insts.length <= 12) {
          const cents = insts.map(inst => {
            let cx = 0, cy = 0, cz = 0
            for (const i of inst.indices) { cx += zdata.atoms.positions[i * 3]; cy += zdata.atoms.positions[i * 3 + 1]; cz += zdata.atoms.positions[i * 3 + 2] }
            return [cx / inst.indices.length, cy / inst.indices.length, cz / inst.indices.length] as const
          })
          let minPair = Infinity
          for (let a = 0; a < cents.length; a++) for (let b = a + 1; b < cents.length; b++) {
            minPair = Math.min(minPair, Math.hypot(cents[a][0] - cents[b][0], cents[a][1] - cents[b][1], cents[a][2] - cents[b][2]))
          }
          if (minPair > 25) {
            const r0 = zdata.residues[zdata.atomResidue[insts[0].indices[0]]]
            const c0 = r0.chainId.trim() || 'A'
            spreadNote = tt({ zh: `——选择横跨 ${insts.length} 个远距拷贝（${insts.map(i => i.label).slice(0, 4).join('、')}${insts.length > 4 ? '…' : ''}）已全部入框；单拷贝特写：zoom (resn ${r0.resName} and chain ${c0}), 6`, en: ` — selection spans ${insts.length} distant copies (${insts.map(i => i.label).slice(0, 4).join(', ')}${insts.length > 4 ? '…' : ''}), all framed; single-copy close-up: zoom (resn ${r0.resName} and chain ${c0}), 6` })
          }
        }
      }
      // whenEngineReady：欢迎页→工作台切换瞬间引擎（MolViewer dynamic）可能仍在挂载中，
      // 直接 engineRef.current?.… 会静默落空（相机不动、命令链白跑）——入队，引擎就位后统一冲刷
      // r55：缓冲并入缓动终点（fitView opts.buffer）——旧「动画后瞬时 moveCamera」会互相覆盖
      whenEngineReady(() => {
        if (sel.structureId) engineRef.current?.fitView([{ structureId: sel.structureId, indices: sel.indices }], { buffer: isNaN(buffer) ? 0 : buffer })
      })
      return ok(tt({ zh: `缩放到 ${selExpr}${!isNaN(buffer) && buffer !== 0 ? `（缓冲 ${buffer > 0 ? '+' : ''}${buffer} Å）` : ''}${spreadNote}（平滑过渡）`, en: `Zoomed to ${selExpr}${!isNaN(buffer) && buffer !== 0 ? ` (buffer ${buffer > 0 ? '+' : ''}${buffer} Å)` : ''}${spreadNote} (smooth transition)` }))
    }
    whenEngineReady(() => engineRef.current?.fitView())
    return ok(tt({ zh: '缩放到全部结构（平滑过渡）', en: 'Zoomed to all structures (smooth transition)' }))
  }

  if (cmd === 'activate' || cmd === 'use') {
    const s = useMolStore.getState()
    const nameArg = parts[1]
    if (!nameArg) return err(tt({ zh: `用法：activate <结构名或PDB编号>（可用：${s.structures.map(x => x.name).join('、') || '无'}）`, en: `Usage: activate <structure name or PDB ID> (available: ${s.structures.map(x => x.name).join(', ') || 'none'})` }))
    const q = nameArg.toLowerCase()
    const found = s.structures.find(x =>
      x.name.toLowerCase() === q ||
      x.name.toLowerCase().startsWith(q) ||
      x.meta.pdbId?.toLowerCase() === q)
    if (!found) return err(tt({ zh: `未找到结构 "${nameArg}"（可用：${s.structures.map(x => x.name).join('、') || '无'}）`, en: `Structure "${nameArg}" not found (available: ${s.structures.map(x => x.name).join(', ') || 'none'})` }))
    if (found.id !== s.activeId) {
      useMolStore.getState().setActive(found.id)
      return ok(tt({ zh: `活动结构 → ${found.name}（show/hide/color/preset 等命令均作用于它）`, en: `Active structure → ${found.name} (show/hide/color/preset etc. act on it)` }))
    }
    return ok(tt({ zh: `${found.name} 已是活动结构`, en: `${found.name} is already the active structure` }))
  }

  if (cmd === 'spin') {
    const arg = (parts[1] ?? 'on').toLowerCase()
    const on = arg === 'on' || arg === '1' || arg === 'true'
    useMolStore.getState().updateSettings({ spin: on, ...(on ? { rock: false } : {}) })
    return ok(on ? tt({ zh: '自动旋转开启（S 切换）', en: 'Auto rotation on (S toggles)' }) : tt({ zh: '自动旋转关闭', en: 'Auto rotation off' }))
  }

  if (cmd === 'rock') {
    const arg = (parts[1] ?? 'on').toLowerCase()
    const on = arg === 'on' || arg === '1' || arg === 'true'
    useMolStore.getState().updateSettings({ rock: on, ...(on ? { spin: false } : {}) })
    return ok(on ? tt({ zh: '相机摇摆开启（±26°，R 切换）', en: 'Camera rocking on (±26°, R toggles)' }) : tt({ zh: '相机摇摆关闭', en: 'Camera rocking off' }))
  }

  if (cmd === 'slab') {
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg === 'off' || arg === '0') {
      useMolStore.getState().updateSettings({ slab: false })
      return ok(tt({ zh: '裁剪关闭', en: 'Clipping off' }))
    }
    if (arg === 'cap') {
      const sub = (parts[2] ?? '').toLowerCase()
      const cur = useMolStore.getState().settings
      // 无参数 = 切换；显式 on/off = 设定
      const on = sub === 'on' || sub === '1' || sub === 'true' ? true
        : sub === 'off' || sub === '0' || sub === 'false' ? false
        : !cur.slabCap
      useMolStore.getState().updateSettings({ slab: true, slabCap: on })
      return ok(on
        ? tt({ zh: `切层截面封盖开启：剖面以平面色填充呈实心（set cap_color 可改色，当前 ${cur.capColor}）`, en: `Slab caps on: cross-sections filled solid with the cap color (set cap_color to change; currently ${cur.capColor})` })
        : tt({ zh: '切层截面封盖关闭（剖面为开放式空壳）', en: 'Slab caps off (open cross-sections)' }))
    }
    if (arg === 'center' || arg === 'reset') {
      useMolStore.getState().updateSettings({ slab: true, slabOffset: 0 })
      return ok(tt({ zh: '切层已回到环绕目标中心（偏移 0 Å）', en: 'Slab recentered on the orbit target (offset 0 Å)' }))
    }
    if (arg === 'move') {
      const d = parseFloat(parts[2] ?? '')
      if (isNaN(d) || d === 0) return err(tt({ zh: '用法：slab move <±Å>（沿视线移动切层中心；正 = 远离相机）', en: 'Usage: slab move <±Å> (moves the slab center along the view axis; positive = away from camera)' }))
      const cur = useMolStore.getState().settings
      const off = Math.max(-80, Math.min(80, (cur.slabOffset ?? 0) + d))
      useMolStore.getState().updateSettings({ slab: true, slabOffset: off })
      return ok(tt({ zh: `切层位置 → ${off > 0 ? '+' : ''}${off.toFixed(1)} Å（slab move ${d > 0 ? '+' : ''}${d}）`, en: `Slab position → ${off > 0 ? '+' : ''}${off.toFixed(1)} Å (slab move ${d > 0 ? '+' : ''}${d})` }))
    }
    const n = parseFloat(arg)
    if (isNaN(n) || n <= 0) return err(tt({ zh: '用法：slab <厚度Å> | slab off | slab move <±Å> | slab center | slab cap on|off', en: 'Usage: slab <thickness Å> | slab off | slab move <±Å> | slab center | slab cap on|off' }))
    useMolStore.getState().updateSettings({ slab: true, slabThickness: n })
    return ok(tt({ zh: `裁剪厚度 → ${n} Å（切层中心在环绕目标处；slab move ± 调整位置）`, en: `Slab thickness → ${n} Å (centered on the orbit target; slab move ± adjusts position)` }))
  }

  if (cmd === 'perf') {
    const arg = (parts[1] ?? 'status').toLowerCase()
    const s = useMolStore.getState()
    if (arg === 'on') {
      s.updateSettings({ autoPerf: true })
      return ok(tt({ zh: '自动性能模式已开启：帧率持续偏低（<15 fps 约 3 秒）时自动关闭后处理并降低分辨率，恢复后自动还原', en: 'Auto performance mode on: when fps stays low (<15 fps for ~3 s), post-processing is disabled and resolution lowered automatically, restored on recovery' }))
    }
    if (arg === 'off') {
      s.updateSettings({ autoPerf: false })
      return ok(tt({ zh: '自动性能模式已关闭（若处于降级状态将立即还原画质设置）', en: 'Auto performance mode off (quality settings restored immediately if degraded)' }))
    }
    if (arg === 'restore') {
      const restored = engineRef.current?.perfManualRestore()
      return restored ? ok(tt({ zh: '已恢复降级前的画质设置（后处理 / 像素比）', en: 'Quality restored to pre-degrade values (post-processing / pixel ratio)' })) : ok(tt({ zh: '当前无降级基线，画质保持现状', en: 'No degrade baseline — quality unchanged' }))
    }
    if (arg === 'status') {
      const st = engineRef.current?.perfStatus()
      if (!st) return err(tt({ zh: '引擎未初始化', en: 'Engine not initialized' }))
      return ok(tt({
        zh: `自动性能模式：${st.autoPerf ? '开' : '关'} · 当前帧率 ${st.fps ? st.fps.toFixed(1) : '—'} fps · ${st.degraded ? '降级中（后处理已关、像素比 ×0.6）' : '正常'}${st.autoPerf ? '（perf off / perf restore 可随时手动干预）' : ''}`,
        en: `Auto performance mode: ${st.autoPerf ? 'on' : 'off'} · current ${st.fps ? st.fps.toFixed(1) : '—'} fps · ${st.degraded ? 'degraded (post-processing off, pixel ratio ×0.6)' : 'normal'}${st.autoPerf ? ' (perf off / perf restore to intervene anytime)' : ''}`,
      }))
    }
    return err(tt({ zh: '用法：perf on|off|status|restore', en: 'Usage: perf on|off|status|restore' }))
  }

  if (cmd === 'label') {
    const arg = (parts[1] ?? 'on').toLowerCase()
    if (arg === 'off' || arg === 'clear') {
      useMolStore.getState().clearLabels()
      return ok(tt({ zh: '标签已清除', en: 'Labels cleared' }))
    }
    const s = useMolStore.getState()
    if (!s.selection.structureId || !s.selection.indices.length) return err(tt({ zh: '请先选择原子', en: 'Select atoms first' }))
    s.addLabelsForSelection()
    return ok(tt({ zh: `已添加 ${s.selection.indices.length} 个标签`, en: `${s.selection.indices.length} labels added` }))
  }

  // ---------- PyMOL 兼容动词（r60：spectrum / iterate / alter / util.cbss / cell） ----------

  if (cmd === 'spectrum') {
    // PyMOL spectrum：按数值属性连续渐变上色。spectrum count / spectrum b, rainbow [起点色 终点色]
    const rest = input.slice(parts[0].length).trim()
    const { head, tail } = commaSplit(rest)
    const headWords = head.split(/\s+/).filter(Boolean)
    const attr = (headWords[0] ?? 'count').toLowerCase()
    const ATTRS: Record<string, 'spectrum' | 'bfactor' | 'uniform'> = {
      count: 'spectrum', rainbow: 'spectrum', spectrum: 'spectrum',
      b: 'bfactor', bfactor: 'bfactor', factor: 'bfactor',
    }
    const scheme = ATTRS[attr]
    if (!scheme) return err(tt({ zh: `spectrum 不支持的属性 "${headWords[0]}"。可用: count（链序渐变） / b（B 因子）`, en: `spectrum does not support property "${headWords[0]}". Available: count (chain-order gradient) / b (B-factor)` }))
    if (scheme === 'uniform') return err(tt({ zh: '属性错误', en: 'Invalid property' }))
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有加载结构', en: 'No structure loaded' }))
    // 可选自定义起终点色（PyMOL spectrum b, rainbow, blue red / spectrum b rainbow blue red）
    const tailWords = tail.split(/\s+/).filter(Boolean)
    let note = ''
    const colorWords: string[] = []
    if (tailWords.length >= 2) {
      const c1 = parseCssColor(tailWords[tailWords.length - 2])
      const c2 = parseCssColor(tailWords[tailWords.length - 1])
      if (c1 && c2) {
        colorWords.push(tailWords[tailWords.length - 2].toLowerCase(), tailWords[tailWords.length - 1].toLowerCase())
        note = tt({ zh: `（自定义起终点 ${c1}→${c2} 需「color ${scheme}」配合色板编辑，暂用内置渐变）`, en: ` (custom endpoints ${c1}→${c2} need "color ${scheme}" plus palette editing — using the built-in gradient for now)` })
      }
    }
    // 选择范围（可选）：spectrum b, rainbow, chain A —— 排除属性/配色/颜色词后的剩余
    const selWords = tailWords.filter(w => !['rainbow', 'count', 'b', 'bfactor', 'factor', ...colorWords].includes(w.toLowerCase()))
    const selExpr = selWords.join(' ')
    if (selExpr) {
      const res = s.selectFromExpr(selExpr)
      if (res.error) return err(tt({ zh: `选择错误: ${res.error}`, en: `Selection error: ${res.error}` }))
    }
    s.applyColor(scheme)
    return ok(tt({
      zh: `已按${scheme === 'bfactor' ? ' B 因子（低蓝 → 高红连续渐变）' : '链序（多链连续渐变）'}上色${note}${selExpr ? `（范围: ${selExpr}）` : ''}——PyMOL spectrum 兼容`,
      en: `Colored by ${scheme === 'bfactor' ? 'B-factor (low blue → high red continuous gradient)' : 'chain order (continuous gradient across chains)'}${note}${selExpr ? ` (scope: ${selExpr})` : ''} — PyMOL spectrum compatible`,
    }))
  }

  if (cmd === 'iterate') {
    // PyMOL iterate：遍历选择打印原子属性（只读）。iterate (chain A and name CA), print resi+resn
    const rest = input.slice(parts[0].length).trim()
    const { head, tail } = commaSplit(rest)
    const expr = (head || 'all').trim()
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有加载结构', en: 'No structure loaded' }))
    const data = dataRegistry.get(s.activeId)
    if (!data) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    const named = buildNamedMasks(s.activeId, data)
    const r = evaluateSelection(expr, { structure: data, named })
    if (r.error) return err(tt({ zh: `选择错误: ${r.error}`, en: `Selection error: ${r.error}` }))
    const idx = maskToIndices(r.mask)
    if (!idx.length) return err(tt({ zh: `选择 "${expr}" 命中 0 个原子`, en: `Selection "${expr}" matched 0 atoms` }))
    // 表达式变量（PyMOL 词法子集）：model/name/resn/resi/chain/ss/b/q/elem/index
    const fields = (tail || 'name resn resi chain').split(/[\s,+]+/).filter(Boolean)
    const upper = 20 // 输出上限（防刷屏；PyMOL 无上限但命令行面板有）
    let n = 0
    ok(tt({ zh: `iterate ${expr ? `(${expr})` : '(all)'} —— ${idx.length.toLocaleString(loc())} 原子${idx.length > upper ? `（前 ${upper} 行）` : ''}:`, en: `iterate ${expr ? `(${expr})` : '(all)'} — ${idx.length.toLocaleString(loc())} atoms${idx.length > upper ? ` (first ${upper} rows)` : ''}:` }))
    for (const i of idx) {
      if (n >= upper) break
      const vals: Record<string, string | number> = {
        index: i + 1, model: s.activeId, name: data.atoms.names[i], resn: data.atoms.resNames[i],
        resi: data.atoms.resSeqs[i], chain: data.atoms.chainIds[i].trim() || 'A',
        ss: data.residues[data.atomResidue[i]].ss, b: data.atoms.bfactors[i].toFixed(2),
        q: data.atoms.occupancies[i].toFixed(2), elem: data.atoms.elements[i],
      }
      const line = fields.filter(f => f in vals).map(f => `${f}=${vals[f]}`).join('  ')
      if (line) { ok(`  ${line}`); n++ }
    }
    return ok(tt({ zh: `（变量可用: index / model / name / resn / resi / chain / ss / b / q / elem——完整输出可 save <file>.pdb 后离线分析）`, en: `(available variables: index / model / name / resn / resi / chain / ss / b / q / elem — for full output, save <file>.pdb and analyze offline)` }))
  }

  if (cmd === 'alter') {
    // PyMOL alter：修改原子属性（本工具支持 b / q / name——改坐标无意义，rep 自动重建）
    const rest = input.slice(parts[0].length).trim()
    const { head, tail } = commaSplit(rest)
    const expr = (head || '').trim()
    const assign = tail.match(/^(\w+)\s*=\s*(.+)$/)
    if (!expr || !assign) return err(tt({ zh: '用法：alter (选择), 属性=表达式。如 alter (chain A and name CA), b=50 · alter (resn HEM), q=1', en: 'Usage: alter (selection), property=expression. E.g. alter (chain A and name CA), b=50 · alter (resn HEM), q=1' }))
    const field = assign[1].toLowerCase()
    const valExpr = assign[2].trim()
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有加载结构', en: 'No structure loaded' }))
    const data = dataRegistry.get(s.activeId)
    if (!data) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    const named = buildNamedMasks(s.activeId, data)
    const r = evaluateSelection(expr, { structure: data, named })
    if (r.error) return err(tt({ zh: `选择错误: ${r.error}`, en: `Selection error: ${r.error}` }))
    const idx = maskToIndices(r.mask)
    if (!idx.length) return err(tt({ zh: `选择 "${expr}" 命中 0 个原子`, en: `Selection "${expr}" matched 0 atoms` }))
    if (!['b', 'q', 'name'].includes(field)) return err(tt({ zh: `alter 暂支持 b / q / name（当前 "${field}"）——改坐标在本工具无意义（叠合/变换有专用命令）`, en: `alter currently supports b / q / name (got "${field}") — editing coordinates is meaningless here (superpose/transform have dedicated commands)` }))
    // 数值表达式：数字/简单算术 + b/q 原值引用（先替换再校验，防 b=b+10 被字符集否决）
    if (field !== 'name') {
      const probe = valExpr.replace(/\bb\b/g, '1').replace(/\bq\b/g, '1')
      if (!/^[\d.+\-*/()\s]+$/.test(probe)) return err(tt({ zh: `数值表达式非法 "${valExpr}"（仅数字、+ - * / 括号与 b/q 原值引用）`, en: `Invalid numeric expression "${valExpr}" (digits, + - * / parentheses, and b/q self-reference only)` }))
      try { new Function(`return (${probe})`)() } catch { return err(tt({ zh: `数值表达式无法求值 "${valExpr}"`, en: `Numeric expression cannot be evaluated "${valExpr}"` })) }
    }
    let n = 0
    for (const i of idx) {
      if (field === 'name') { data.atoms.names[i] = valExpr.replace(/^["']|["']$/g, '') }
      else {
        // 支持 b=b+5 形式（valExpr 引用原值）
        const raw = valExpr.replace(/\bb\b/g, String(data.atoms.bfactors[i])).replace(/\bq\b/g, String(data.atoms.occupancies[i]))
        const v = new Function(`return (${raw})`)() as number
        if (!isFinite(v)) continue
        if (field === 'b') data.atoms.bfactors[i] = v
        else data.atoms.occupancies[i] = Math.min(1, Math.max(0, v))
      }
      n++
    }
    useMolStore.getState().bumpVisual()
    return ok(tt({ zh: `已修改 ${n.toLocaleString(loc())} 个原子的 ${field}（putty/spectrum b 可见效果）`, en: `Modified ${field} on ${n.toLocaleString(loc())} atoms (visible via putty/spectrum b)` }))
  }

  if (cmd === 'cell') {
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg && arg !== 'on' && arg !== 'off' && arg !== '1' && arg !== '0') return err(tt({ zh: '用法：show cell / hide cell（CRYST1 晶胞盒，a红 b绿 c蓝）', en: 'Usage: show cell / hide cell (CRYST1 unit cell, a red b green c blue)' }))
    const s = useMolStore.getState()
    const on = arg ? ['on', '1'].includes(arg) : !s.settings.showCell
    s.updateSettings({ showCell: on })
    const st = s.activeId ? dataRegistry.get(s.activeId) : null
    const info = st?.crystal ? tt({ zh: `（${st.crystal.a.toFixed(1)}×${st.crystal.b.toFixed(1)}×${st.crystal.c.toFixed(1)}Å ${st.crystal.spaceGroup.trim()}）`, en: ` (${st.crystal.a.toFixed(1)}×${st.crystal.b.toFixed(1)}×${st.crystal.c.toFixed(1)} Å ${st.crystal.spaceGroup.trim()})` }) : tt({ zh: '（当前结构无 CRYST1 晶胞信息）', en: ' (no CRYST1 unit-cell info in this structure)' })
    return ok(on ? tt({ zh: `晶胞盒开启 ${info}——a 红 / b 绿 / c 蓝`, en: `Unit cell shown ${info} — a red / b green / c blue` }) : tt({ zh: '晶胞盒已关闭', en: 'Unit cell hidden' }))
  }

  if (cmd === 'isolate') {
    return runIsolateCommand(input, parts, ok, err)
  }

  if (cmd === 'chains' || cmd === 'chain' && (parts[1] ?? '').toLowerCase() === 'hide' || cmd === 'chain' && (parts[1] ?? '').toLowerCase() === 'show') {
    return runChainsCommand(input, parts, ok, err)
  }

  if (cmd === 'preset' || cmd === 'style' || cmd === 'scene') {
    const name = (parts[1] ?? '').toLowerCase()
    // 场景快照子命令（scene save/recall/update/del/clear/next/prev）——
    // 先于 preset 别名判定（非子命令时 scene 仍是 preset 别名，向后兼容）
    if (cmd === 'scene' && SCENE_SUBS.has(name)) {
      return runSceneCommand(parts, ok, err)
    }
    // 场景组合预设先查（r59-a2 #4：键冲突——SCENE_PRESETS.publication 曾被 PRESETS.publication
    // 永久遮蔽，命令行永远无法触达「出版级渲染」场景；scene <键> 一律走场景语义）
    if (cmd === 'scene') {
      const scene = SCENE_PRESETS[name]
      if (scene) {
        for (const c of scene.commands) runCommand(c)
        return ok(tt({ zh: `已应用场景: ${tt(scene.label)}（${scene.commands.length} 条命令）`, en: `Scene applied: ${tt(scene.label)} (${scene.commands.length} commands)` }))
      }
    }
    const p = PRESETS[name]
    if (p) {
      useMolStore.getState().applyPreset(name)
      if (name === 'publication') {
        return ok(tt({ zh: '已应用预设: 出版级互作——配体碳鲜绿单一色 · 口袋残基按到配体距离紫→粉渐变（杂原子元素色，主链+侧链完整显示）· 配体 6Å 内晶体水小球·已自动聚焦口袋。建议配 hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water：氢键虚线是互作图的专业细节', en: 'Preset applied: publication-grade interactions — ligand carbons in a single fresh green · pocket residues in a violet→pink gradient by distance to ligand (hetero-atoms in element colors, backbone + side chains fully shown) · crystal waters within 6 Å of the ligand as small spheres · pocket auto-focused. Pair with hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water: H-bond dashes are the professional touch of interaction figures' }))
      }
      if (name === 'bindingsite') {
        return ok(tt({ zh: '已应用预设: 结合口袋——口袋残基完整球棍（元素色）· 配体 6Å 内晶体水小球·已自动聚焦口袋', en: 'Preset applied: binding site — pocket residues as full ball-and-stick (element colors) · crystal waters within 6 Å of the ligand as small spheres · pocket auto-focused' }))
      }
      return ok(tt({ zh: `已应用预设: ${tt(p.label)}`, en: `Preset applied: ${tt(p.label)}` }))
    }
    // preset/style 动词仍可触达场景组合预设（含 publication 场景的完整渲染链）
    const scene = SCENE_PRESETS[name]
    if (scene) {
      for (const c of scene.commands) runCommand(c)
      return ok(tt({ zh: `已应用场景: ${tt(scene.label)}（${scene.commands.length} 条命令）`, en: `Scene applied: ${tt(scene.label)} (${scene.commands.length} commands)` }))
    }
    return err(tt({ zh: `未知预设 "${parts[1]}"。表示法: ${Object.keys(PRESETS).join(', ')} · 场景: ${Object.keys(SCENE_PRESETS).join(', ')}`, en: `Unknown preset "${parts[1]}". Style presets: ${Object.keys(PRESETS).join(', ')} · scene presets: ${Object.keys(SCENE_PRESETS).join(', ')}` }))
  }

  if (cmd === 'delete') {
    const name = parts[1]
    if (!name) return err(tt({ zh: '用法: delete <命名选择名>', en: 'Usage: delete <named selection name>' }))
    const s = useMolStore.getState()
    if (!s.namedSelections.find(n => n.name === name)) return err(tt({ zh: `未找到命名选择 "${name}"`, en: `Named selection "${name}" not found` }))
    s.deleteNamedSelection(name)
    return ok(tt({ zh: `已删除 ${name}`, en: `${name} deleted` }))
  }

  if (cmd === 'close') {
    // 关闭结构：close（活动）/ close all / close <名|前缀|PDBID>
    const s = useMolStore.getState()
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg === 'all' || arg === '*') {
      const n = s.structures.length
      if (!n) return err(tt({ zh: '当前没有已加载的结构', en: 'No structures loaded' }))
      for (const st of [...s.structures]) s.removeStructure(st.id)
      return ok(tt({ zh: `已关闭全部 ${n} 个结构（书签与时间轴保留；彻底重置用 session new）`, en: `Closed all ${n} structures (bookmarks and timeline kept; use session new for a full reset)` }))
    }
    let target = s.structures.find(x => x.id === s.activeId)
    if (arg) {
      target = s.structures.find(x =>
        x.name.toLowerCase() === arg ||
        x.name.toLowerCase().startsWith(arg) ||
        x.meta.pdbId?.toLowerCase() === arg)
      if (!target) return err(tt({ zh: `未找到结构 "${parts[1]}"（可用：${s.structures.map(x => x.name).join('、') || '无'}）`, en: `Structure "${parts[1]}" not found (available: ${s.structures.map(x => x.name).join(', ') || 'none'})` }))
    }
    if (!target) return err(tt({ zh: '没有活动结构（close <名> 指定，或 close all）', en: 'No active structure (specify close <name>, or close all)' }))
    const atoms = target.summary.atoms
    s.removeStructure(target.id)
    return ok(tt({ zh: `已关闭 ${target.name}（${atoms.toLocaleString(loc())} 原子）。结构卡片 X 按钮关闭时 toast 内可撤销`, en: `Closed ${target.name} (${atoms.toLocaleString(loc())} atoms). Undo is available in the toast when closing via the structure card X button` }))
  }

  if (cmd === 'clear' || cmd === 'reset') {
    const s = useMolStore.getState()
    const n = s.structures.length
    for (const st of [...s.structures]) s.removeStructure(st.id)
    return ok(n > 0 ? tt({ zh: `已清空所有结构（${n} 个；彻底重置含书签/时间轴用 session new）`, en: `Cleared all structures (${n}; use session new to also reset bookmarks/timeline)` }) : tt({ zh: '当前没有已加载的结构', en: 'No structures loaded' }))
  }

  if (cmd === 'orient') {
    // 主轴对齐（PyMOL orient：PCA）；可带选择表达式（容忍逗号写法 orient ligand, 5）
    const rest = input.slice(parts[0].length).trim().replace(/,/g, ' ')
    const s = useMolStore.getState()
    const eng = engineRef.current
    if (!eng) {
      // 视图切换窗口（欢迎页 load 落地 → MolViewer dynamic 挂载中）：选择先行求值，
      // 相机操作入队等待冲刷（与 zoom 同语义）；空场景引擎永不来 → 诚实报错
      if (!s.structures.length) return err(tt({ zh: '引擎未就绪（先加载结构）', en: 'Engine not ready (load a structure first)' }))
      let refs: { structureId: string; indices: number[] }[] | undefined
      let cnt = 0
      if (rest) {
        if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
        const data = dataRegistry.get(s.activeId)
        if (!data) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
        const named = buildNamedMasks(s.activeId, data)
        const r = evaluateSelection(rest, { structure: data, named })
        if (r.error) return err(tt({ zh: `选择错误: ${r.error}`, en: `Selection error: ${r.error}` }))
        const indices = maskToIndices(r.mask)
        if (!indices.length) return err(tt({ zh: '选择为空', en: 'Selection is empty' }))
        refs = [{ structureId: s.activeId, indices }]
        cnt = indices.length
      }
      whenEngineReady(() => engineRef.current?.orient(refs))
      return ok(cnt ? tt({ zh: `已按主轴对齐视角（${cnt.toLocaleString(loc())} 个原子，PCA）`, en: `View aligned to principal axes (${cnt.toLocaleString(loc())} atoms, PCA)` }) : tt({ zh: '已按主轴对齐视角（全部可见结构）', en: 'View aligned to principal axes (all visible structures)' }))
    }
    if (rest) {
      if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
      const data = dataRegistry.get(s.activeId)
      if (!data) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
      const named = buildNamedMasks(s.activeId, data)
      const r = evaluateSelection(rest, { structure: data, named })
      if (r.error) return err(tt({ zh: `选择错误: ${r.error}`, en: `Selection error: ${r.error}` }))
      const indices = maskToIndices(r.mask)
      if (!indices.length) return err(tt({ zh: '选择为空', en: 'Selection is empty' }))
      eng.orient([{ structureId: s.activeId, indices }])
      return ok(tt({ zh: `已按主轴对齐视角（${indices.length.toLocaleString(loc())} 个原子，PCA）`, en: `View aligned to principal axes (${indices.length.toLocaleString(loc())} atoms, PCA)` }))
    }
    eng.orient()
    return ok(tt({ zh: '已按主轴对齐视角（全部可见结构）', en: 'View aligned to principal axes (all visible structures)' }))
  }

  if (cmd === 'turn') {
    // 对标 PyMOL turn：绕屏幕轴旋转相机（x=俯仰 y=水平方位 z=滚转）
    const axis = (parts[1] ?? '').toLowerCase()
    const deg = clampNum(parseFloat(parts[2] ?? ''), -180, 180, NaN)
    if (!/^[xyz]$/.test(axis) || isNaN(deg) || deg === 0) {
      return err(tt({ zh: '用法：turn <x|y|z> <±角度°>（x=俯仰 y=水平方位 z=滚转；如 turn y 30、turn x -15）', en: 'Usage: turn <x|y|z> <±degrees> (x = pitch, y = yaw, z = roll; e.g. turn y 30, turn x -15)' }))
    }
    const eng = engineRef.current
    if (!eng) {
      // 视图切换窗口：入队等待冲刷（与 zoom 同语义）；空场景引擎永不来 → 诚实报错
      if (!useMolStore.getState().structures.length) return err(tt({ zh: '引擎未就绪（先加载结构）', en: 'Engine not ready (load a structure first)' }))
      whenEngineReady(() => engineRef.current?.turnCamera(axis as 'x' | 'y' | 'z', deg))
    } else {
      eng.turnCamera(axis as 'x' | 'y' | 'z', deg)
    }
    const axisName = axis === 'x' ? tt({ zh: '水平屏轴（俯仰）', en: 'horizontal screen axis (pitch)' }) : axis === 'y' ? tt({ zh: '竖直屏轴（水平方位）', en: 'vertical screen axis (yaw)' }) : tt({ zh: '视线轴（滚转）', en: 'view axis (roll)' })
    return ok(tt({ zh: `视角旋转：绕${axisName} ${deg > 0 ? '+' : ''}${deg}°（turn 反向可退回）`, en: `View rotated: ${deg > 0 ? '+' : ''}${deg}° about the ${axisName} (turn back the other way to undo)` }))
  }

  if (cmd === 'move') {
    // 对标 PyMOL move：沿屏幕轴平移（x=右 y=上 z=推拉；正 z=远离主体）
    const axis = (parts[1] ?? '').toLowerCase()
    const d = clampNum(parseFloat(parts[2] ?? ''), -200, 200, NaN)
    if (!/^[xyz]$/.test(axis) || isNaN(d) || d === 0) {
      return err(tt({ zh: '用法：move <x|y|z> <±Å>（x=右移 y=上移 z=推拉；如 move z -10 拉近）', en: 'Usage: move <x|y|z> <±Å> (x = right, y = up, z = dolly; e.g. move z -10 to move closer)' }))
    }
    const eng = engineRef.current
    if (!eng) {
      // 视图切换窗口：入队等待冲刷（与 zoom 同语义）；空场景引擎永不来 → 诚实报错
      if (!useMolStore.getState().structures.length) return err(tt({ zh: '引擎未就绪（先加载结构）', en: 'Engine not ready (load a structure first)' }))
      whenEngineReady(() => engineRef.current?.moveCamera(axis as 'x' | 'y' | 'z', d))
    } else {
      eng.moveCamera(axis as 'x' | 'y' | 'z', d)
    }
    const axisName = axis === 'x' ? tt({ zh: '水平右移', en: 'right' }) : axis === 'y' ? tt({ zh: '竖直上移', en: 'up' }) : d > 0 ? tt({ zh: '推远', en: 'pushed away' }) : tt({ zh: '拉近', en: 'pulled closer' })
    return ok(tt({ zh: `视角平移：${axisName} ${d > 0 ? '+' : ''}${d} Å`, en: `View translated: ${axisName} ${d > 0 ? '+' : ''}${d} Å` }))
  }

  if (cmd === 'get_view') {
    const eng = engineRef.current
    if (!eng) return err(tt({ zh: '引擎未就绪', en: 'Engine not ready' }))
    const st = eng.getCameraState()
    ok(JSON.stringify(st))
    return ok(tt({ zh: '↑ 复制此 JSON，用 set_view <JSON> 可恢复该视角（支持跨会话）', en: '↑ Copy this JSON and restore the view later with set_view <JSON> (works across sessions)' }))
  }

  if (cmd === 'set_view') {
    const rest = input.slice(parts[0].length).trim()
    if (!rest) return err(tt({ zh: '用法：set_view {"pos":[..],"target":[..],"up":[..]}（JSON 来自 get_view）', en: 'Usage: set_view {"pos":[..],"target":[..],"up":[..]} (JSON from get_view)' }))
    let parsed: { pos?: number[]; target?: number[]; up?: number[]; fov?: number; ortho?: boolean }
    try {
      parsed = JSON.parse(rest) as typeof parsed
    } catch {
      return err(tt({ zh: 'JSON 解析失败——请粘贴 get_view 输出的完整 JSON', en: 'JSON parse failed — paste the full JSON printed by get_view' }))
    }
    const eng = engineRef.current
    if (!eng) {
      // 视图切换窗口：入队等待冲刷（与 zoom 同语义）；空场景引擎永不来 → 诚实报错
      if (!useMolStore.getState().structures.length) return err(tt({ zh: '引擎未就绪（先加载结构）', en: 'Engine not ready (load a structure first)' }))
      whenEngineReady(() => engineRef.current?.animateCameraTo(parsed))
      return ok(tt({ zh: '视角已恢复（平滑过渡）', en: 'View restored (smooth transition)' }))
    }
    // r55：与 view 书签跳转同一路径（up 球面 slerp + 极点豁免 + 过渡手感三档）——录像不跳变
    eng.animateCameraTo(parsed)
    return ok(tt({ zh: '视角已恢复（平滑过渡）', en: 'View restored (smooth transition)' }))
  }

  if (cmd === 'view' || cmd === 'views' || cmd === 'bookmark') {
    useViewsStore.getState().hydrate()  // 首次（未装载）时从 localStorage 填充
    const vs = useViewsStore.getState() // hydrate 会替换 state 对象——必须重新获取
    const sub = (parts[1] ?? '').toLowerCase()
    // view from <选择>：从选择方向观察（口袋开口正对相机）——先于书签跳转判定
    if (sub === 'from') {
      const selExpr = input.slice(parts[0].length).trim().replace(/^from\s+/i, '').replace(/,/g, ' ').trim()
      const s = useMolStore.getState()
      if (!selExpr) return err(tt({ zh: '用法：view from <选择>（如 view from ligand / view from (resn HEM and chain A)）——从选择方向观察，口袋开口正对相机', en: 'Usage: view from <selection> (e.g. view from ligand / view from (resn HEM and chain A)) — look from the direction of the selection, pocket opening facing the camera' }))
      if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
      const data = dataRegistry.get(s.activeId)
      if (!data) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
      const named = buildNamedMasks(s.activeId, data)
      const r = evaluateSelection(selExpr, { structure: data, named })
      if (r.error) return err(tt({ zh: `选择错误: ${r.error}`, en: `Selection error: ${r.error}` }))
      const indices = maskToIndices(r.mask)
      if (!indices.length) return err(tt({ zh: '选择为空', en: 'Selection is empty' }))
      const sid = s.activeId
      const eng = engineRef.current
      if (!eng) {
        // 视图切换窗口（欢迎页 load 落地 → MolViewer dynamic 挂载中）：入队等待冲刷——
        // 与 zoom 同语义（r47 模式），相机操作不因挂载时序失败；多配体兑底也在冲刷时执行
        whenEngineReady(() => {
          const e = engineRef.current
          if (!e) return
          if (e.viewFrom([{ structureId: sid!, indices }])) return
          const inst = nearestInstance(data, indices, e)
          if (inst) e.viewFrom([{ structureId: sid!, indices: inst.indices }])
        })
        return ok(tt({ zh: `视角 → 从「${selExpr}」方向观察（选择在前景、开口正对相机，17° 仰角增加纵深）`, en: `View → looking from "${selExpr}" (selection in the foreground, opening facing the camera, 17° elevation for depth)` }))
      }
      if (eng.viewFrom([{ structureId: sid!, indices }])) {
        return ok(tt({ zh: `视角 → 从「${selExpr}」方向观察（选择在前景、开口正对相机，17° 仰角增加纵深）`, en: `View → looking from "${selExpr}" (selection in the foreground, opening facing the camera, 17° elevation for depth)` }))
      }
      // 多配体兑底：选择质心贴近结构中心（如 ligand 覆盖 4 个 HEM 均布）→ 自动挑离相机目标最近的配体实例重试
      const inst = nearestInstance(data, indices, eng)
      if (inst && eng.viewFrom([{ structureId: s.activeId, indices: inst.indices }])) {
        return ok(tt({ zh: `视角 → 从「${selExpr}」方向观察——多配体均布已自动聚焦 ${inst.label}（选择在前景、开口正对相机）`, en: `View → looking from "${selExpr}" — evenly distributed ligands auto-focused on ${inst.label} (selection in the foreground, opening facing the camera)` }))
      }
      return err(tt({ zh: '选择贴近结构中心、方向无意义（多配体均布或深埋）——先 zoom (resn XXX and chain A), 6 聚焦单个配体，再 view from (resn XXX and chain A)（口袋正对相机）', en: 'Selection is near the structure center — direction is meaningless (evenly distributed ligands or deeply buried). First zoom (resn XXX and chain A), 6 to focus a single ligand, then view from (resn XXX and chain A) (pocket facing the camera)' }))
    }
    // 正交视角预设（先于书签跳转判定——与书签名不冲突）：view front/top/left/right/back/bottom/x/y/z
    const AXIS_VIEW_LABELS: Record<string, { zh: string; en: string }> = {
      front: { zh: '正面', en: 'front' }, back: { zh: '背面', en: 'back' }, top: { zh: '俯视', en: 'top' }, bottom: { zh: '仰视', en: 'bottom' }, left: { zh: '左视', en: 'left' }, right: { zh: '右视', en: 'right' },
      x: { zh: '右视（沿 X 轴）', en: 'right (along X)' }, y: { zh: '俯视（沿 Y 轴）', en: 'top (along Y)' }, z: { zh: '正面（沿 Z 轴）', en: 'front (along Z)' },
    }
    if (AXIS_VIEW_LABELS[sub]) {
      const eng = engineRef.current
      if (!eng) {
        // 视图切换窗口：入队等待冲刷（与 zoom 同语义）；空场景引擎永不来 → 诚实报错
        if (!useMolStore.getState().structures.length) return err(tt({ zh: '引擎未就绪（先加载结构）', en: 'Engine not ready (load a structure first)' }))
        whenEngineReady(() => engineRef.current?.setAxisView(sub))
        return ok(tt({ zh: `视角 → ${tt(AXIS_VIEW_LABELS[sub])}（保持目标点与距离，平滑过渡）`, en: `View → ${tt(AXIS_VIEW_LABELS[sub])} (target and distance kept, smooth transition)` }))
      }
      if (!eng.setAxisView(sub)) return err(tt({ zh: '引擎未就绪', en: 'Engine not ready' }))
      return ok(tt({ zh: `视角 → ${tt(AXIS_VIEW_LABELS[sub])}（保持目标点与距离，平滑过渡）`, en: `View → ${tt(AXIS_VIEW_LABELS[sub])} (target and distance kept, smooth transition)` }))
    }
    if (!sub || sub === 'list' || sub === 'ls') {
      if (!vs.bookmarks.length) return ok(tt({ zh: '暂无视角书签——view save [名称] 保存当前视角（或快捷键 V）；view front/top/left/right 转正交视角；view from ligand 从配体方向观察', en: 'No view bookmarks yet — view save [name] saves the current view (or hotkey V); view front/top/left/right switches to orthographic views; view from ligand looks from the ligand direction' }))
      ok(tt({ zh: `视角书签（${vs.bookmarks.length}/${MAX_BOOKMARKS}）：`, en: `View bookmarks (${vs.bookmarks.length}/${MAX_BOOKMARKS}):` }))
      vs.bookmarks.forEach((b, i) => {
        const t = new Date(b.createdAt).toLocaleTimeString(tt({ zh: 'zh-CN', en: 'en-US' }), { hour: '2-digit', minute: '2-digit' })
        ok(`  ${String(i + 1).padEnd(2)}  ${b.name.padEnd(16)} ${t}${i < 9 ? '  ⇧' + (i + 1) : ''}`)
      })
      return ok(tt({ zh: '跳转：view <序号|名称> / Shift+数字键；删除：view del <序号|名称>；清空：view clear', en: 'Jump: view <number|name> / Shift+number; delete: view del <number|name>; clear all: view clear' }))
    }
    if (sub === 'save' || sub === 'add' || sub === 'snap') {
      const name = parts.slice(2).join(' ').trim() || undefined
      const bm = vs.addBookmark(name)
      if (!bm) return err(tt({ zh: `书签已达上限（${MAX_BOOKMARKS}）——先 view del 删除不再需要的书签`, en: `Bookmark limit reached (${MAX_BOOKMARKS}) — delete unneeded ones with view del first` }))
      const idx = useViewsStore.getState().bookmarks.length
      return ok(tt({ zh: `已保存视角书签「${bm.name}」${idx < 9 ? `（Shift+${idx} 或 view ${idx} 跳转）` : ''}`, en: `View bookmark "${bm.name}" saved${idx < 9 ? ` (Shift+${idx} or view ${idx} to jump)` : ''}` }))
    }
    if (sub === 'clear') {
      vs.clearBookmarks()
      return ok(tt({ zh: '已清空所有视角书签', en: 'All view bookmarks cleared' }))
    }
    if (sub === 'del' || sub === 'rm' || sub === 'delete') {
      const arg = parts.slice(2).join(' ').trim()
      if (!arg) return err(tt({ zh: '用法：view del <序号|名称>', en: 'Usage: view del <number|name>' }))
      const n = Number(arg)
      const target = Number.isInteger(n) && n >= 1 ? vs.bookmarks[n - 1] : vs.bookmarks.find(b => b.name.toLowerCase() === arg.toLowerCase())
      if (!target) return err(tt({ zh: `找不到书签「${arg}」`, en: `Bookmark "${arg}" not found` }))
      vs.removeBookmark(target.id)
      return ok(tt({ zh: `已删除视角书签「${target.name}」`, en: `View bookmark "${target.name}" deleted` }))
    }
    // view <序号|名称> / view go <序号|名称>：跳转（平滑过渡；名称可含空格）
    const arg = (sub === 'go' || sub === 'goto' || sub === 'jump' ? parts.slice(2).join(' ') : parts.slice(1).join(' ')).trim()
    if (!arg) return err(tt({ zh: '用法：view save [名称] | view <序号|名称> | view del <序号|名称> | view clear', en: 'Usage: view save [name] | view <number|name> | view del <number|name> | view clear' }))
    const n = Number(arg)
    const target = Number.isInteger(n) && n >= 1 ? vs.bookmarks[n - 1] : vs.bookmarks.find(b => b.name.toLowerCase() === arg.toLowerCase())
    if (!target) return err(tt({ zh: `找不到书签「${arg}」——view list 查看现有书签`, en: `Bookmark "${arg}" not found — view list shows existing bookmarks` }))
    vs.restoreBookmark(target.id)
    return ok(tt({ zh: `已跳转到视角书签「${target.name}」`, en: `Jumped to view bookmark "${target.name}"` }))
  }

  if (cmd === 'tour' || cmd === 'demo') {
    const sub = (parts[1] ?? '').toLowerCase()
    if (sub === 'stop' || sub === 'exit' || sub === 'quit') {
      useTourStore.getState().stop()
      return ok(tt({ zh: '演示已结束', en: 'Tour ended' }))
    }
    if (!sub || sub === 'list' || sub === 'ls') {
      ok(tt({ zh: '引导式演示场景（逐步讲解 + 自动执行，←/→ 切换、Esc 结束）：', en: 'Guided tours (step-by-step narration + auto-execution, ←/→ to step, Esc to end):' }))
      for (const t of TOURS) ok(`  ${t.id.padEnd(14)} ${tt(t.title)}${tt({ zh: `（${t.steps.length} 步 · ≈${t.minutes} 分钟）`, en: ` (${t.steps.length} steps · ≈${t.minutes} min)` })}`)
      return ok(tt({ zh: '启动：tour <id>，如 tour quickstart；工具栏「演示」菜单同样可启动', en: 'Start: tour <id>, e.g. tour quickstart; the toolbar "Tours" menu works too' }))
    }
    const t = findTour(sub)
    if (!t) return err(tt({ zh: `未知演示「${sub}」——tour 查看可用场景`, en: `Unknown tour "${sub}" — run tour to list available tours` }))
    void useTourStore.getState().start(t.id)
    return ok(tt({ zh: `▶ 开始演示「${tt(t.title)}」——顶部引导卡片亮起，按 → 键继续`, en: `▶ Tour "${tt(t.title)}" started — guide card lit at the top, press → to continue` }))
  }

  if (cmd === 'count_atoms' || cmd === 'count') {
    const rest = input.slice(parts[0].length).trim()
    const s = useMolStore.getState()
    if (!rest) {
      let n = 0
      for (const x of s.structures) {
        if (!x.visible) continue
        n += dataRegistry.get(x.id)?.atoms.count ?? 0
      }
      return ok(tt({ zh: `可见结构共 ${n.toLocaleString(loc())} 个原子（${s.structures.filter(x => x.visible).length} 个对象）`, en: `${n.toLocaleString(loc())} atoms in visible structures (${s.structures.filter(x => x.visible).length} objects)` }))
    }
    if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    const data = dataRegistry.get(s.activeId)
    if (!data) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    const named = buildNamedMasks(s.activeId, data)
    const r = evaluateSelection(rest, { structure: data, named })
    if (r.error) return err(tt({ zh: `选择错误: ${r.error}`, en: `Selection error: ${r.error}` }))
    return ok(tt({ zh: `选择包含 ${r.count.toLocaleString(loc())} 个原子（不改变当前选择）`, en: `Selection contains ${r.count.toLocaleString(loc())} atoms (current selection unchanged)` }))
  }

  if (cmd === 'create') {
    // create <名> = <选择>：从选择创建新对象（PyMOL 核心工作流）
    const rest = input.slice(parts[0].length).trim()
    const m = rest.match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/)
    if (!m) return err(tt({ zh: '用法：create <新对象名> = <选择表达式>，如 create pocket = within 5 of resn HEM', en: 'Usage: create <new object name> = <selection expression>, e.g. create pocket = within 5 of resn HEM' }))
    const name = m[1]
    const expr = m[2].trim()
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    const data = dataRegistry.get(s.activeId)
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!data || !entry) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    const named = buildNamedMasks(s.activeId, data)
    const r = evaluateSelection(expr, { structure: data, named })
    if (r.error) return err(tt({ zh: `选择错误: ${r.error}`, en: `Selection error: ${r.error}` }))
    if (r.count === 0) return err(tt({ zh: '选择为空（0 个原子）', en: 'Selection is empty (0 atoms)' }))
    const indices = maskToIndices(r.mask)
    try {
      const t0 = performance.now()
      const sub = subsetStructure(data, indices, name)
      const ms = performance.now() - t0
      const id = useMolStore.getState().addStructure(sub, name, ms)
      // 生成 PDB 文本登记（会话持久化用；坐标为当前世界坐标）
      textRegistry.set(id, structureToPdbText(sub))
      useMolStore.getState().appendLog('out', tt({ zh: `已创建对象 ${name}：${sub.atoms.count.toLocaleString(loc())} 原子 · ${sub.residues.length} 残基 · ${ms.toFixed(0)} ms（源：${entry.name}）`, en: `Object ${name} created: ${sub.atoms.count.toLocaleString(loc())} atoms · ${sub.residues.length} residues · ${ms.toFixed(0)} ms (from: ${entry.name})` }))
      return ok(tt({ zh: `对象 "${name}" 已创建（${r.count.toLocaleString(loc())} 原子）——可用 show/color 独立控制，已自动登记进会话存档`, en: `Object "${name}" created (${r.count.toLocaleString(loc())} atoms) — control independently with show/color; registered in the session archive` }))
    } catch (e) {
      return err(tt({ zh: `创建失败：${e instanceof Error ? e.message : String(e)}`, en: `Create failed: ${e instanceof Error ? e.message : String(e)}` }))
    }
  }

  if (cmd === 'split_chains' || cmd === 'splitchains') {
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    const data = dataRegistry.get(s.activeId)
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!data || !entry) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    const groups = data.chains.filter(c => c.type !== 'water')
    if (!groups.length) return err(tt({ zh: '没有非水链组可拆分', en: 'No non-water chain groups to split' }))
    if (groups.length > 24) return err(tt({ zh: `链组过多（${groups.length}）——请先用 create 缩小结构再拆分`, en: `Too many chain groups (${groups.length}) — use create to shrink the structure first, then split` }))
    // 重名链 ID 加序号（4HHB 同 ID 多组场景）
    const seen = new Map<string, number>()
    let created = 0
    const skippedWater = data.chains.length - groups.length
    for (const c of groups) {
      const base = (c.id || 'X').trim() || 'X'
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      const name = `${entry.name}_${base}${n > 1 ? `#${n}` : ''}`
      const idx: number[] = []
      for (let i = c.start; i < c.end; i++) idx.push(i)
      try {
        const sub = subsetStructure(data, idx, name)
        const id = useMolStore.getState().addStructure(sub, name, 0)
        textRegistry.set(id, structureToPdbText(sub))
        created++
      } catch {
        // 单链失败不阻断
      }
    }
    return ok(tt({ zh: `已拆分为 ${created} 个对象（跳过 ${skippedWater} 个水链组；重名链 ID 已加 # 序号）——对象在结构面板中独立可控`, en: `Split into ${created} objects (skipped ${skippedWater} water chain groups; duplicate chain IDs suffixed with #) — objects are independently controllable in the structure panel` }))
  }

  if (cmd === 'util') {
    const sub = (parts[1] ?? '').toLowerCase()
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    const entry = s.structures.find(x => x.id === s.activeId)
    const data = entry ? dataRegistry.get(s.activeId) : null
    if (!entry || !data) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    if (sub === 'cbc' || sub === 'chain') {
      s.applyColor('chain')
      return ok(tt({ zh: '已按链着色（util.cbc）', en: 'Colored by chain (util.cbc)' }))
    }
    if (sub === 'cnc') {
      s.applyColor('#b7bcc3')
      return ok(tt({ zh: '已整体灰化（util.cnc）', en: 'Colored overall gray (util.cnc)' }))
    }
    if (sub === 'ss') {
      s.applyColor('ss')
      return ok(tt({ zh: '已按二级结构着色（util.ss：螺旋红 · 折叠黄 · 环灰）', en: 'Colored by secondary structure (util.ss: helix red · sheet yellow · loop gray)' }))
    }
    if (sub === 'cbss') {
      // PyMOL util.cbss： cartoons 按二级结构（螺旋红折叠黄环灰）+ 其余元素色——最常用的卡通配色
      s.applyColor('ss')
      const st = useMolStore.getState()
      const e2 = st.structures.find(x => x.id === st.activeId)
      if (!e2) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
      const scope = st.selection.structureId === e2.id && st.selection.indices.length ? new Set(st.selection.indices) : null
      const overrides = { ...e2.colorOverrides }
      // SS 配色只写 polymer 残基；非聚合物原子（配体/水/离子）回元素色
      let n = 0
      for (let i = 0; i < data.atoms.count; i++) {
        const r = data.residues[data.atomResidue[i]]
        if (r.polymer) continue
        if (scope && !scope.has(i)) continue
        overrides[i] = '#c9cdd4'
        n++
      }
      useMolStore.setState(s2 => ({
        structures: s2.structures.map(x => x.id === e2.id ? { ...x, colorOverrides: overrides, rev: x.rev + 1 } : x),
        visualRev: s2.visualRev + 1,
      }))
      return ok(tt({ zh: `已 util.cbss：卡通按二级结构（螺旋红 · 折叠黄 · 环灰），配体/水/离子 ${n.toLocaleString(loc())} 原子回元素灰基色——PyMOL 经典组合`, en: `util.cbss: cartoons by secondary structure (helix red · sheet yellow · loop gray), ${n.toLocaleString(loc())} ligand/water/ion atoms back to element gray base — the classic PyMOL combo` }))
    }
    if (sub === 'cbao') {
      // PyMOL util.cbao：元素色 + 环境光遮蔽提示（本工具 ao 即 ssao）——PyMOL 用户迁移最顺手的「立体感一键」
      s.applyColor('element')
      const st = useMolStore.getState()
      if (!st.settings.ssao) st.updateSettings({ ssao: true })
      return ok(tt({ zh: '已 util.cbao：元素配色 + 环境光遮蔽开启（PyMOL 的 ambient occlusion——立体感提升；ssao off 关闭）', en: 'util.cbao: element coloring + ambient occlusion on (PyMOL-style AO — adds depth; ssao off to disable)' }))
    }
    if (sub === 'cbaw' || sub === 'cbac') {
      // 元素着色 + 碳改白/灰（PyMOL 论文图风格：白底黑碳）
      s.applyColor('element')
      const st = useMolStore.getState()
      const e2 = st.structures.find(x => x.id === st.activeId)
      if (!e2) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
      const scope = st.selection.structureId === e2.id && st.selection.indices.length ? new Set(st.selection.indices) : null
      const overrides = { ...e2.colorOverrides }
      const hex = sub === 'cbaw' ? '#f7f8fa' : '#a9aeb5'
      let n = 0
      for (let i = 0; i < data.atoms.count; i++) {
        if (data.atoms.elements[i] !== 'C') continue
        if (scope && !scope.has(i)) continue
        overrides[i] = hex
        n++
      }
      useMolStore.setState(s2 => ({
        structures: s2.structures.map(x => x.id === e2.id ? { ...x, colorOverrides: overrides, rev: x.rev + 1 } : x),
        visualRev: s2.visualRev + 1,
      }))
      return ok(tt({ zh: `已按元素着色 + 碳${sub === 'cbaw' ? '白' : '灰'}（util.${sub}，${n.toLocaleString(loc())} 个碳原子）——适合白底论文图`, en: `Element coloring + ${sub === 'cbaw' ? 'white' : 'gray'} carbons (util.${sub}, ${n.toLocaleString(loc())} carbon atoms) — good for white-background figures` }))
    }
    return err(tt({ zh: '用法：util cbc | cnc | ss | cbss | cbao | cbaw | cbac（按链 / 灰化 / 二级结构 / SS卡通+配体基色 / 元素+AO立体 / 元素+白碳 / 元素+灰碳）', en: 'Usage: util cbc | cnc | ss | cbss | cbao | cbaw | cbac (by-chain / gray / secondary structure / SS cartoon + ligand base color / element + AO depth / element + white C / element + gray C)' }))
  }

  if (cmd === 'set') {
    const key = (parts[1] ?? '').toLowerCase()
    const rawVal = parts.slice(2).join(' ').trim()
    if (!key || !rawVal) return err(tt({ zh: '用法：set <项> <值>。可用：ambient / direct / fill / specular / fog / fog_strength / fov / spin_speed / transition / quality / stereo / axes / outline / outline_strength / outline_thickness / fps / auto_perf / cap_color / cap_shading / transparency / sphere_scale / stick_radius / cartoon_width / bg_follow', en: 'Usage: set <key> <value>. Available: ambient / direct / fill / specular / fog / fog_strength / fov / spin_speed / transition / quality / stereo / axes / outline / outline_strength / outline_thickness / fps / auto_perf / cap_color / cap_shading / transparency / sphere_scale / stick_radius / cartoon_width / bg_follow' }))
    const s = useMolStore.getState()
    const num = parseFloat(rawVal)
    const on = ['on', '1', 'true', 'open'].includes(rawVal.toLowerCase())
    const off = ['off', '0', 'false', 'close'].includes(rawVal.toLowerCase())
    if (num === 0 && !on && !off && rawVal !== '0') { /* 非数值非开关，稍后报错 */ }
    const repPatch = (patch: Partial<import('./types').RepConfig>) => {
      const st = useMolStore.getState()
      const entry = st.structures.find(x => x.id === st.activeId)
      if (!entry) return 0
      let n = 0
      for (const r of entry.reps) {
        if (patch.opacity !== undefined && r.type !== 'surface') continue
        if ((patch.ballScale !== undefined) && r.type !== 'spacefill' && r.type !== 'ballstick') continue
        if ((patch.stickRadius !== undefined) && r.type !== 'sticks' && r.type !== 'ballstick') continue
        if ((patch.cartoonWidth !== undefined) && r.type !== 'cartoon' && r.type !== 'putty') continue
        st.updateRep(entry.id, r.id, patch)
        n++
      }
      return n
    }
    switch (key) {
      case 'ambient': {
        if (isNaN(num)) return err(tt({ zh: '用法：set ambient <0-2>，默认 1', en: 'Usage: set ambient <0-2>, default 1' }))
        s.updateSettings({ lightAmbient: clampNum(num, 0, 2, 1) })
        return ok(tt({ zh: `环境光 → ${clampNum(num, 0, 2, 1)}（含环境贴图贡献）`, en: `Ambient light → ${clampNum(num, 0, 2, 1)} (incl. environment map contribution)` }))
      }
      case 'direct': case 'key': {
        if (isNaN(num)) return err(tt({ zh: '用法：set direct <0-3>，默认 1', en: 'Usage: set direct <0-3>, default 1' }))
        s.updateSettings({ lightKey: clampNum(num, 0, 3, 1) })
        return ok(tt({ zh: `主光强度 → ${clampNum(num, 0, 3, 1)}`, en: `Key light intensity → ${clampNum(num, 0, 3, 1)}` }))
      }
      case 'fill': {
        if (isNaN(num)) return err(tt({ zh: '用法：set fill <0-2>，默认 1', en: 'Usage: set fill <0-2>, default 1' }))
        s.updateSettings({ lightFill: clampNum(num, 0, 2, 1) })
        return ok(tt({ zh: `补光强度 → ${clampNum(num, 0, 2, 1)}`, en: `Fill light intensity → ${clampNum(num, 0, 2, 1)}` }))
      }
      case 'specular': {
        if (!on && !off) return err(tt({ zh: '用法：set specular on|off（关闭后无镜面高光，哑光质感）', en: 'Usage: set specular on|off (off = no specular highlights, matte look)' }))
        s.updateSettings({ specular: on })
        return ok(tt({ zh: `高光 ${on ? '开启' : '关闭'}（set specular off 得到哑光/论文风格渲染）`, en: `Specular ${on ? 'on' : 'off'} (set specular off gives a matte/paper-style render)` }))
      }
      case 'fog': {
        if (!on && !off) return err(tt({ zh: '用法：set fog on|off', en: 'Usage: set fog on|off' }))
        s.updateSettings({ fog: on })
        return ok(tt({ zh: `雾效 ${on ? '开启（远端淡化）' : '关闭'}`, en: `Fog ${on ? 'on (distance fade)' : 'off'}` }))
      }
      case 'bg_follow': {
        if (!on && !off) return err(tt({ zh: '用法：set bg_follow on|off（on = 主题切换时视口背景跟随；bg 命令会自动固定背景）', en: 'Usage: set bg_follow on|off (on = viewport background follows theme switches; the bg command pins it)' }))
        s.updateSettings({ backgroundPinned: !on })
        return ok(on ? tt({ zh: '背景恢复主题跟随（切换深浅主题时同步）', en: 'Background follows the theme again (syncs on light/dark switch)' }) : tt({ zh: '背景固定（不随主题切换）', en: 'Background pinned (does not follow theme)' }))
      }
      case 'bgcolor': case 'background': {
        // ChimeraX set bgColor <色>
        const css = parseCssColor(rawVal.toLowerCase())
        if (!css) return err(tt({ zh: '用法：set bgColor <#hex 或颜色名>（ChimeraX 风格；本工具 bg 命令同效）', en: 'Usage: set bgColor <#hex or color name> (ChimeraX style; same as the bg command here)' }))
        s.updateSettings({ background: css, backgroundPinned: true })
        return ok(tt({ zh: `背景色 → ${css}`, en: `Background color → ${css}` }))
      }
      case 'fog_strength': case 'fog_density': {
        if (isNaN(num)) return err(tt({ zh: '用法：set fog_strength <0-1>', en: 'Usage: set fog_strength <0-1>' }))
        s.updateSettings({ fog: true, fogStrength: clampNum(num, 0, 1, 0.5) })
        return ok(tt({ zh: `雾强度 → ${clampNum(num, 0, 1, 0.5)}（雾效已开启）`, en: `Fog strength → ${clampNum(num, 0, 1, 0.5)} (fog on)` }))
      }
      case 'fov': case 'field_of_view': {
        if (isNaN(num)) return err(tt({ zh: '用法：set fov <10-100>，默认 45', en: 'Usage: set fov <10-100>, default 45' }))
        s.updateSettings({ fov: clampNum(num, 10, 100, 45) })
        return ok(tt({ zh: `视场角 → ${clampNum(num, 10, 100, 45)}°（小值≈长焦）`, en: `Field of view → ${clampNum(num, 10, 100, 45)}° (small ≈ telephoto)` }))
      }
      case 'spin_speed': {
        if (isNaN(num)) return err(tt({ zh: '用法：set spin_speed <0.5-20>', en: 'Usage: set spin_speed <0.5-20>' }))
        s.updateSettings({ spinSpeed: clampNum(num, 0.5, 20, 2) })
        return ok(tt({ zh: `旋转速度 → ${clampNum(num, 0.5, 20, 2)}`, en: `Spin speed → ${clampNum(num, 0.5, 20, 2)}` }))
      }
      case 'transition': case 'cam_transition': {
        const t = rawVal.toLowerCase()
        if (!['quick', 'normal', 'cinematic'].includes(t)) return err(tt({ zh: '用法：set transition quick|normal|cinematic（视角书签/正交视角/场景恢复的飞行时长 0.35/0.65/1.2s）', en: 'Usage: set transition quick|normal|cinematic (flight duration for view bookmarks/axis views/scene recall: 0.35/0.65/1.2s)' }))
        s.updateSettings({ camTransition: t as 'quick' | 'normal' | 'cinematic' })
        return ok(tt({ zh: `视角过渡 → ${t === 'quick' ? '敏锐 0.35s' : t === 'normal' ? '标准 0.65s' : '电影 1.2s'}（场景面板「交互与动画」可同样切换）`, en: `Camera transition → ${t === 'quick' ? 'quick 0.35s' : t === 'normal' ? 'standard 0.65s' : 'cinematic 1.2s'} (also switchable in the scene panel under "Interaction & animation")` }))
      }
      case 'quality': {
        const q = rawVal.toLowerCase()
        if (!['low', 'medium', 'high'].includes(q)) return err(tt({ zh: '用法：set quality low|medium|high', en: 'Usage: set quality low|medium|high' }))
        s.updateSettings({ quality: q as 'low' | 'medium' | 'high' })
        return ok(tt({ zh: `画质 → ${q}（像素比与几何细分）`, en: `Quality → ${q} (pixel ratio and geometry detail)` }))
      }
      case 'stereo': {
        if (!on && !off) return err(tt({ zh: '用法：set stereo on|off 或 stereo on|off', en: 'Usage: set stereo on|off, or stereo on|off' }))
        s.updateSettings({ stereo: on })
        return ok(on ? tt({ zh: '红蓝立体开启（佩戴红蓝 3D 眼镜；GTAO 暂停）', en: 'Red-cyan stereo on (wear red-cyan 3D glasses; GTAO paused)' }) : tt({ zh: '立体渲染关闭', en: 'Stereo rendering off' }))
      }
      case 'axes': case 'show_axes': {
        if (!on && !off) return err(tt({ zh: '用法：set axes on|off（视口右上角坐标轴指示器）', en: 'Usage: set axes on|off (axis gizmo at the viewport top-right)' }))
        s.updateSettings({ showAxes: on })
        return ok(tt({ zh: `坐标轴指示器 ${on ? '开启（点击轴端可对齐视角）' : '关闭'}`, en: `Axis gizmo ${on ? 'on (click an axis tip to align the view)' : 'off'}` }))
      }
      case 'fps': case 'show_fps': {
        if (!on && !off) return err(tt({ zh: '用法：set fps on|off（状态栏性能指示器）', en: 'Usage: set fps on|off (status-bar performance indicator)' }))
        s.updateSettings({ showFps: on })
        return ok(tt({ zh: `性能指示器 ${on ? '开启（状态栏显示 FPS / 绘制调用 / 三角形数）' : '关闭'}`, en: `Performance indicator ${on ? 'on (status bar shows FPS / draw calls / triangles)' : 'off'}` }))
      }
      case 'seq_focus': case 'viewport_focus': {
        if (!on && !off) return err(tt({ zh: '用法：set seq_focus on|off（序列条视口聚焦指示）', en: 'Usage: set seq_focus on|off (sequence bar viewport-focus indicator)' }))
        s.updateSettings({ seqFocus: on })
        return ok(tt({ zh: `序列条视口聚焦 ${on ? '开启（视野内残基绿色下划线标记，切层裁剪同步感知）' : '关闭'}`, en: `Sequence viewport focus ${on ? 'on (in-view residues underlined in green; slab-aware)' : 'off'}` }))
      }
      case 'cap_color': case 'slab_cap_color': {
        const css = parseCssColor(rawVal.toLowerCase())
        if (!css) return err(tt({ zh: '用法：set cap_color <#hex 或颜色名>（切层剖面封盖色，默认 #ccd2d9）', en: 'Usage: set cap_color <#hex or color name> (slab cap color, default #ccd2d9)' }))
        s.updateSettings({ slab: true, slabCap: true, capColor: css })
        return ok(tt({ zh: `截面封盖色 → ${css}（slab cap 已开启）`, en: `Cap color → ${css} (slab caps on)` }))
      }
      case 'cap_shading': case 'slab_cap_shading': case 'depth_cue_cap': {
        if (!on && !off) return err(tt({ zh: '用法：set cap_shading on|off（封盖深度明暗：剖面远端加深，呈现层次）', en: 'Usage: set cap_shading on|off (cap depth shading: far side of the cross-section darkened for depth)' }))
        s.updateSettings({ capShading: on })
        return ok(on
          ? tt({ zh: '封盖深度明暗开启：剖面按视深由亮到暗渐变（远端加深），立体层次感增强', en: 'Cap depth shading on: cross-sections fade bright→dark with view depth (far side darkened), enhancing depth perception' })
          : tt({ zh: '封盖深度明暗关闭（剖面回到统一平面色）', en: 'Cap depth shading off (cross-sections back to a flat color)' }))
      }
      case 'auto_perf': case 'autoperf': {
        if (!on && !off) return err(tt({ zh: '用法：set auto_perf on|off（低帧率自动降级，恢复后自动还原）', en: 'Usage: set auto_perf on|off (auto-degrade on low fps, auto-restore on recovery)' }))
        s.updateSettings({ autoPerf: on })
        return ok(on ? tt({ zh: '自动性能模式开启（帧率持续偏低时自动关闭后处理并降分辨率）', en: 'Auto performance mode on (post-processing off and resolution lowered when fps stays low)' }) : tt({ zh: '自动性能模式关闭（画质设置已还原）', en: 'Auto performance mode off (quality settings restored)' }))
      }
      case 'outline': case 'silhouettes': case 'silhouette': {
        if (!on && !off) return err(tt({ zh: '用法：set outline on|off（出版级轮廓线；或 outline on 1.5 2；ChimeraX 称 silhouettes）', en: 'Usage: set outline on|off (publication-grade outlines; or outline on 1.5 2; ChimeraX calls them silhouettes)' }))
        s.updateSettings({ outline: on })
        return ok(tt({ zh: `轮廓线 ${on ? '开启（Sobel 深度+亮度描边；ray 静帧同样生效；ChimeraX silhouettes 同义）' : '关闭'}`, en: `Outlines ${on ? 'on (Sobel depth+brightness edges; applies to ray stills too; ChimeraX silhouettes synonym)' : 'off'}` }))
      }
      case 'outline_strength': {
        if (isNaN(num)) return err(tt({ zh: '用法：set outline_strength <0.2-3>，默认 1', en: 'Usage: set outline_strength <0.2-3>, default 1' }))
        s.updateSettings({ outline: true, outlineStrength: clampNum(num, 0.2, 3, 1) })
        return ok(tt({ zh: `轮廓线强度 → ${clampNum(num, 0.2, 3, 1).toFixed(1)}（已开启）`, en: `Outline strength → ${clampNum(num, 0.2, 3, 1).toFixed(1)} (on)` }))
      }
      case 'outline_thickness': {
        if (isNaN(num)) return err(tt({ zh: '用法：set outline_thickness <1-4>（像素采样步长），默认 1.5', en: 'Usage: set outline_thickness <1-4> (pixel sample step), default 1.5' }))
        s.updateSettings({ outline: true, outlineThickness: clampNum(num, 1, 4, 1.5) })
        return ok(tt({ zh: `轮廓线粗细 → ${clampNum(num, 1, 4, 1.5).toFixed(1)}px（已开启）`, en: `Outline thickness → ${clampNum(num, 1, 4, 1.5).toFixed(1)}px (on)` }))
      }
      case 'transparency': case 'surface_opacity': {
        if (isNaN(num)) return err(tt({ zh: '用法：set transparency <0-1>（0=不透明，作用于表面表示）', en: 'Usage: set transparency <0-1> (0 = opaque; applies to surface representations)' }))
        const opacity = clampNum(1 - num, 0.05, 1, 0.6)
        const n = repPatch({ opacity })
        return n ? ok(tt({ zh: `表面不透明度 → ${opacity.toFixed(2)}（${n} 个表面表示）`, en: `Surface opacity → ${opacity.toFixed(2)} (${n} surface representation(s))` })) : err(tt({ zh: '当前结构没有表面表示（先 show surface）', en: 'No surface representation in the current structure (show surface first)' }))
      }
      case 'sphere_scale': case 'ball_scale': {
        if (isNaN(num)) return err(tt({ zh: '用法：set sphere_scale <0.2-3>', en: 'Usage: set sphere_scale <0.2-3>' }))
        const n = repPatch({ ballScale: clampNum(num, 0.2, 3, 1) })
        return n ? ok(tt({ zh: `球体倍率 → ${clampNum(num, 0.2, 3, 1)}（${n} 个表示）`, en: `Sphere scale → ${clampNum(num, 0.2, 3, 1)} (${n} representation(s))` })) : err(tt({ zh: '没有球体类表示（spacefill / ballstick）', en: 'No sphere representation (spacefill / ballstick)' }))
      }
      case 'stick_radius': {
        if (isNaN(num)) return err(tt({ zh: '用法：set stick_radius <0.05-0.5 Å>', en: 'Usage: set stick_radius <0.05-0.5 Å>' }))
        const n = repPatch({ stickRadius: clampNum(num, 0.05, 0.5, 0.16) })
        return n ? ok(tt({ zh: `棍半径 → ${clampNum(num, 0.05, 0.5, 0.16)} Å（${n} 个表示）`, en: `Stick radius → ${clampNum(num, 0.05, 0.5, 0.16)} Å (${n} representation(s))` })) : err(tt({ zh: '没有棍类表示（sticks / ballstick）', en: 'No stick representation (sticks / ballstick)' }))
      }
      case 'cartoon_width': {
        if (isNaN(num)) return err(tt({ zh: '用法：set cartoon_width <0.3-4>', en: 'Usage: set cartoon_width <0.3-4>' }))
        const n = repPatch({ cartoonWidth: clampNum(num, 0.3, 4, 1) })
        return n ? ok(tt({ zh: `cartoon 宽度 → ${clampNum(num, 0.3, 4, 1)}（${n} 个表示）`, en: `Cartoon width → ${clampNum(num, 0.3, 4, 1)} (${n} representation(s))` })) : err(tt({ zh: '没有 cartoon 表示', en: 'No cartoon representation' }))
      }
      default:
        return err(tt({ zh: `未知设置项 "${key}"。可用：ambient, direct, fill, specular, fog, fog_strength, fov, spin_speed, transition, quality, stereo, axes, outline, outline_strength, outline_thickness, fps, auto_perf, cap_color, cap_shading, transparency, sphere_scale, stick_radius, cartoon_width`, en: `Unknown setting "${key}". Available: ambient, direct, fill, specular, fog, fog_strength, fov, spin_speed, transition, quality, stereo, axes, outline, outline_strength, outline_thickness, fps, auto_perf, cap_color, cap_shading, transparency, sphere_scale, stick_radius, cartoon_width` }))
    }
  }

  if (cmd === 'stereo') {
    const arg = (parts[1] ?? 'on').toLowerCase()
    const on = arg === 'on' || arg === '1' || arg === 'true'
    useMolStore.getState().updateSettings({ stereo: on })
    return ok(on ? tt({ zh: '红蓝立体开启（佩戴红蓝 3D 眼镜观看；GTAO 在立体模式下暂停）', en: 'Red-cyan stereo on (wear red-cyan 3D glasses; GTAO paused in stereo mode)' }) : tt({ zh: '立体渲染关闭', en: 'Stereo rendering off' }))
  }

  if (cmd === 'axes' || cmd === 'axis' || cmd === 'gizmo') {
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg && arg !== 'on' && arg !== 'off' && arg !== '1' && arg !== '0') return err(tt({ zh: '用法：axes on|off（视口右上角坐标轴指示器）', en: 'Usage: axes on|off (axis gizmo at the viewport top-right)' }))
    const s = useMolStore.getState()
    const on = arg ? ['on', '1'].includes(arg) : !s.settings.showAxes
    s.updateSettings({ showAxes: on })
    return ok(on ? tt({ zh: '坐标轴指示器开启（视口右上角；点击轴端对齐视角）', en: 'Axis gizmo on (viewport top-right; click an axis tip to align the view)' }) : tt({ zh: '坐标轴指示器已关闭', en: 'Axis gizmo off' }))
  }

  if (cmd === 'fps' || cmd === 'perf') {
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg && arg !== 'on' && arg !== 'off' && arg !== '1' && arg !== '0') return err(tt({ zh: '用法：fps on|off（状态栏实时性能指示）', en: 'Usage: fps on|off (live performance indicator in the status bar)' }))
    const s = useMolStore.getState()
    const on = arg ? ['on', '1'].includes(arg) : !s.settings.showFps
    s.updateSettings({ showFps: on })
    return ok(on ? tt({ zh: '性能指示器开启（状态栏显示 FPS / 绘制调用 / 三角形数）', en: 'Performance indicator on (status bar shows FPS / draw calls / triangles)' }) : tt({ zh: '性能指示器已关闭', en: 'Performance indicator off' }))
  }

  if (cmd === 'outline' || cmd === 'edge') {
    // outline on|off [强度] [粗细]
    const rest = parts.slice(1)
    const arg = (rest[0] ?? '').toLowerCase()
    const s = useMolStore.getState()
    let on: boolean
    if (arg === 'on' || arg === '1') on = true
    else if (arg === 'off' || arg === '0') on = false
    else on = !s.settings.outline
    const patch: { outline: boolean; outlineStrength?: number; outlineThickness?: number } = { outline: on }
    const strength = rest[1] !== undefined ? parseFloat(rest[1]) : NaN
    if (!isNaN(strength)) patch.outlineStrength = clampNum(strength, 0.2, 3, 1)
    const thickness = rest[2] !== undefined ? parseFloat(rest[2]) : NaN
    if (!isNaN(thickness)) patch.outlineThickness = clampNum(thickness, 1, 4, 1.5)
    s.updateSettings(patch)
    if (!on) return ok(tt({ zh: '轮廓线已关闭', en: 'Outlines off' }))
    const cur = useMolStore.getState().settings
    return ok(tt({ zh: `轮廓线开启（强度 ${cur.outlineStrength.toFixed(1)} · 粗细 ${cur.outlineThickness.toFixed(1)}px）——出版级描边：Sobel 深度+亮度双信号，ray 静帧同样生效`, en: `Outlines on (strength ${cur.outlineStrength.toFixed(1)} · thickness ${cur.outlineThickness.toFixed(1)}px) — publication-grade edges: Sobel depth+brightness dual signal, applies to ray stills too` }))
  }

  if (cmd === 'symmetry' || cmd === 'symmates') {
    const s = useMolStore.getState()
    const eng = engineRef.current
    if (!eng) return err(tt({ zh: '引擎未就绪', en: 'Engine not ready' }))
    let argStr = input.slice(parts[0].length).trim()
    let targetId = s.activeId
    // 首 token 若为结构名（非数字非 off）→ 指定结构
    const first = (argStr.split(/\s+/)[0] ?? '').toLowerCase()
    const isNumOrOff = first === 'off' || first === '' || !isNaN(parseFloat(first))
    if (!isNumOrOff && first) {
      const found = s.structures.find(x => x.name.toLowerCase().startsWith(first) || x.meta.pdbId?.toLowerCase() === first)
      if (!found) return err(tt({ zh: `未找到结构 "${first}"（可用：${s.structures.map(x => x.name).join('、')}）`, en: `Structure "${first}" not found (available: ${s.structures.map(x => x.name).join(', ')})` }))
      targetId = found.id
      argStr = argStr.slice(first.length).trim()
    }
    if (!targetId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    if (argStr === 'off' || argStr === '0') {
      const r = eng.updateSymmetry(targetId, 0)
      return r.ok ? ok(r.message) : err(r.message)
    }
    const radius = clampNum(parseFloat(argStr), 5, 80, 20)
    const r = eng.updateSymmetry(targetId, radius)
    if (!r.ok) return err(r.message)
    ok(r.message)
    ok(tt({ zh: '对称伴侣为视觉副本（不参与拾取/选择）；结构面板可调半径或关闭', en: 'Symmetry mates are visual copies (not pickable/selectable); adjust the radius or turn off in the structure panel' }))
    return
  }

  if (cmd === 'map') {
    const sub = (parts[1] ?? '').toLowerCase()
    const isFofc = sub === 'fofc' || sub === 'diff' || sub === 'difference'
    if (sub === 'fetch' || sub === 'load' || sub === 'calc' || sub === 'compute' || isFofc) {
      const idArg = isFofc ? parts[2] : parts[2]
      // 幂等：同编号同类型的图已加载且引擎图层仍在 → 跳过重新计算（演示可安全重放）。
      // 引擎侧必须同时确认（Fast Refresh/引擎重建会丢图层而镜像残留——此时应走重算恢复）
      const wantId = (idArg ?? useMolStore.getState().structures.find(x => x.id === useMolStore.getState().activeId)?.meta.pdbId ?? '').toUpperCase()
      const wantKind = isFofc ? 'fofc' : '2fofc'
      const cur = useMapStore.getState()
      if (wantId && !cur.computing && engineRef.current?.getMapInfo() && cur.info?.source === 'sf' && cur.info.pdbId === wantId && cur.info.kind === wantKind) {
        if (!cur.info.visible) setMapLook({ visible: true })
        return ok(tt({ zh: `密度图 ${wantId} ${isFofc ? 'Fo−Fc 差图' : '2Fo−Fc'} 已在场景中——跳过重复计算（map off 后可重新计算）`, en: `Map ${wantId} ${isFofc ? 'Fo−Fc difference map' : '2Fo−Fc'} already in the scene — skipping recompute (map off then re-run to recompute)` }))
      }
      if (idArg && /^[0-9][a-z0-9]{3}$/i.test(idArg)) {
        void fetchAndComputeMap(idArg, isFofc ? 'fofc' : '2fofc')
        return ok(isFofc
          ? tt({ zh: `正在获取 ${idArg.toUpperCase()} 结构因子并合成 Fo−Fc 差图（±σ 正绿/负红；未加载的结构会自动获取作为相位模型）…`, en: `Fetching ${idArg.toUpperCase()} structure factors and building the Fo−Fc difference map (±σ, positive green/negative red; an unloaded structure is auto-fetched as the phase model)…` })
          : tt({ zh: `正在获取 ${idArg.toUpperCase()} 结构因子并合成 2Fo−Fc 密度图（模型相位 + 3D FFT；未加载的结构会自动获取）…`, en: `Fetching ${idArg.toUpperCase()} structure factors and building the 2Fo−Fc map (model phases + 3D FFT; an unloaded structure is auto-fetched)…` }))
      }
      const s = useMolStore.getState()
      const pid = s.structures.find(x => x.id === s.activeId)?.meta.pdbId
      if (!pid) return err(tt({ zh: '用法：map fetch <PDB编号> | map fofc <PDB编号>（结构未加载时将自动从 RCSB 获取作为相位模型）', en: 'Usage: map fetch <PDB ID> | map fofc <PDB ID> (an unloaded structure is auto-fetched from RCSB as the phase model)' }))
      void fetchAndComputeMap(pid, isFofc ? 'fofc' : '2fofc')
      return ok(tt({ zh: `正在获取 ${pid} 结构因子并合成 ${isFofc ? 'Fo−Fc 差图' : '2Fo−Fc 密度图'}…`, en: `Fetching ${pid} structure factors and building the ${isFofc ? 'Fo−Fc difference map' : '2Fo−Fc map'}…` }))
    }
    if (sub === 'isolevel' || sub === 'iso' || sub === 'level') {
      // map isolevel <σ>（差图同时设正负）| map isolevel pos <σ> / neg <σ>（差图独立正负峰）
      const sideArg = (parts[2] ?? '').toLowerCase()
      const isPos = sideArg === 'pos' || sideArg === 'positive' || sideArg === '+'
      const isNeg = sideArg === 'neg' || sideArg === 'negative' || sideArg === '-'
      const v = parseFloat(isPos || isNeg ? (parts[3] ?? '') : (parts[2] ?? ''))
      if (isNaN(v) || v < 0.2 || v > 8) {
        return err(tt({ zh: '用法：map isolevel <σ 0.2-8>；差图可分开设置：map isolevel pos 3 / map isolevel neg 2.5', en: 'Usage: map isolevel <σ 0.2-8>; difference maps allow separate levels: map isolevel pos 3 / map isolevel neg 2.5' }))
      }
      const info = engineRef.current?.getMapInfo()
      if (isPos || isNeg) {
        if (!info) return err(tt({ zh: '未加载密度图（map fetch <编号> / map fofc <编号>）', en: 'No map loaded (map fetch <ID> / map fofc <ID>)' }))
        if (!info.difference) return err(tt({ zh: '正/负峰独立级别仅适用于 Fo−Fc 差图（map fofc <编号>）', en: 'Separate pos/neg levels only apply to Fo−Fc difference maps (map fofc <ID>)' }))
        setMapLook(isPos ? { iso: v } : { isoNeg: v })
        return ok(isPos
          ? tt({ zh: `差图正峰（绿）等值面 → +${v} σ`, en: `Difference map positive peak (green) isosurface → +${v} σ` })
          : tt({ zh: `差图负峰（红）等值面 → −${v} σ`, en: `Difference map negative peak (red) isosurface → −${v} σ` }))
      }
      setMapLook({ iso: v, isoNeg: v })
      return info?.difference
        ? ok(tt({ zh: `差图等值面级别 → ±${v} σ（可用 map isolevel pos/neg 分开调整正负峰）`, en: `Difference map isosurface level → ±${v} σ (map isolevel pos/neg adjusts peaks separately)` }))
        : ok(tt({ zh: `等值面级别 → ${v} σ（1σ≈噪声基准，1.5-2σ 常规骨架）`, en: `Isosurface level → ${v} σ (1σ ≈ noise baseline, 1.5–2σ for the usual backbone)` }))
    }
    if (sub === 'mesh') { setMapLook({ mode: 'mesh' }); return ok(tt({ zh: '密度图切换为网格 isomesh', en: 'Map switched to mesh (isomesh)' })) }
    if (sub === 'surface') { setMapLook({ mode: 'surface' }); return ok(tt({ zh: '密度图切换为实体面 isosurface', en: 'Map switched to solid surface (isosurface)' })) }
    if (sub === 'both') { setMapLook({ mode: 'both' }); return ok(tt({ zh: '密度图切换为网格+面叠加', en: 'Map switched to mesh + surface overlay' })) }
    if (sub === 'off' || sub === 'close' || sub === 'remove') { removeMap(); return ok(tt({ zh: '密度图已移除', en: 'Map removed' })) }
    if (sub === 'hide') { setMapLook({ visible: false }); return ok(tt({ zh: '密度图已隐藏（map show 恢复）', en: 'Map hidden (map show to restore)' })) }
    if (sub === 'show') { setMapLook({ visible: true }); return ok(tt({ zh: '密度图已显示', en: 'Map shown' })) }
    const info = engineRef.current?.getMapInfo()
    if (!info) {
      return err(tt({ zh: '未加载密度图。用法：map fetch <PDB编号> | map fofc <PDB编号> | isolevel <σ> | mesh | surface | both | hide | show | off（未加载的结构会自动获取；也可拖入 .ccp4/.map/.mrc 文件）', en: 'No map loaded. Usage: map fetch <PDB ID> | map fofc <PDB ID> | isolevel <σ> | mesh | surface | both | hide | show | off (an unloaded structure is auto-fetched; you can also drop a .ccp4/.map/.mrc file)' }))
    }
    return ok(tt({
      zh: `密度图 ${info.name}：${info.dims.join('×')} 体素 · ${info.triangles.toLocaleString(loc())} 三角形 · ${info.difference
        ? (Math.abs(info.iso - info.isoNeg) < 1e-6 ? `±${info.iso.toFixed(1)}σ 差图` : `+${info.iso.toFixed(1)}/−${info.isoNeg.toFixed(1)}σ 差图`)
        : `${info.iso.toFixed(1)} σ`} · 模式 ${info.mode}${info.truncated ? '（已截断）' : ''} · rms ${info.rms.toFixed(3)}`,
      en: `Map ${info.name}: ${info.dims.join('×')} voxels · ${info.triangles.toLocaleString(loc())} triangles · ${info.difference
        ? (Math.abs(info.iso - info.isoNeg) < 1e-6 ? `±${info.iso.toFixed(1)}σ difference map` : `+${info.iso.toFixed(1)}/−${info.isoNeg.toFixed(1)}σ difference map`)
        : `${info.iso.toFixed(1)} σ`} · mode ${info.mode}${info.truncated ? ' (truncated)' : ''} · rms ${info.rms.toFixed(3)}`,
    }))
  }

  if (cmd === 'png') {
    const eng = engineRef.current
    if (!eng) return err(tt({ zh: '引擎未就绪', en: 'Engine not ready' }))
    const scale = clampNum(parseFloat(parts[1]), 1, 4, 2)
    const s = useMolStore.getState()
    try {
      const url = eng.capture({ scale })
      const a = document.createElement('a')
      a.href = url
      a.download = `${s.structures[0]?.name ?? 'molvision'}${scale > 1 ? `@${scale}x` : ''}.png`
      a.click()
      return ok(tt({ zh: `已导出 PNG（${scale}× 分辨率）`, en: `PNG exported (${scale}× resolution)` }))
    } catch {
      return err(tt({ zh: '截图失败', en: 'Screenshot failed' }))
    }
  }

  if (cmd === 'ray') {
    // PyMOL ray 风格静帧：软阴影 + 1.5× 真超采样（内部高分辨率渲染→高质量降采样=全场景抗锯齿）
    // 异步化：先弹进度 toast 再渲染（双 rAF 让提示先绘制），避免长时间无反馈的「假死」观感
    const eng = engineRef.current
    if (!eng) return err(tt({ zh: '引擎未就绪', en: 'Engine not ready' }))
    if (!eng.hasStructures) return err(tt({ zh: '场景为空——先加载结构再渲染（load <PDB编号>）', en: 'Scene is empty — load a structure before rendering (load <PDB ID>)' }))
    let width: number | undefined
    if (parts[1]) {
      width = clampNum(parseFloat(parts[1]), 320, 4096, NaN)
      if (isNaN(width)) return err(tt({ zh: '用法：ray [宽 px]（如 ray 1920；缺省按视口 2× 自适应）', en: 'Usage: ray [width px] (e.g. ray 1920; default adapts to viewport ×2)' }))
    }
    const s = useMolStore.getState()
    const tid = 'ray-render'
    ok(tt({ zh: 'Ray 渲染已启动（PCF 软阴影 + 1.5× 真超采样抗锯齿）——完成后自动导出 PNG，期间界面可能短暂停顿', en: 'Ray render started (PCF soft shadows + 1.5× true supersampling AA) — PNG exports automatically when done; the UI may briefly freeze' }))
    toast.loading(tt({ zh: 'Ray 渲染中…', en: 'Ray rendering…' }), { id: tid, description: tt({ zh: '软阴影 + 超采样静帧渲染，大场景需数秒', en: 'Soft shadows + supersampled still render; large scenes take a few seconds' }) })
    void (async () => {
      // 双 rAF：确保 loading toast 先绘制到屏幕，再进入阻塞渲染
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      // 相机动画落位等待：view from / 视角书签过渡期间直接 ray 会把中途帧（旧构图）渲染进静帧
      for (let i = 0; i < 25 && eng.isCameraAnimating(); i++) await new Promise<void>(r => setTimeout(r, 100))
      try {
        const r = await eng.rayRender({ width })
        if (!r.url) {
          toast.error(tt({ zh: 'Ray 渲染失败', en: 'Ray render failed' }), { id: tid, description: tt({ zh: '画布尺寸限制——试试更小的宽度', en: 'Canvas size limit — try a smaller width' }) })
          useMolStore.getState().appendLog('err', tt({ zh: 'Ray 渲染失败（画布尺寸限制——试试更小的宽度）', en: 'Ray render failed (canvas size limit — try a smaller width)' }))
          return
        }
        const a = document.createElement('a')
        a.href = r.url
        a.download = `${s.structures[0]?.name ?? 'molvision'}-ray-${r.w}x${r.h}.png`
        a.click()
        const ms = r.ms.toFixed(0)
        toast.success(tt({ zh: `Ray 完成：${r.w}×${r.h} px`, en: `Ray done: ${r.w}×${r.h} px` }), { id: tid, description: tt({ zh: `耗时 ${ms} ms · 真超采样抗锯齿 · PNG 已导出`, en: `${ms} ms · true supersampling AA · PNG exported` }) })
        useMolStore.getState().appendLog('out', tt({ zh: `Ray 渲染完成：${r.w}×${r.h} px（PCF 软阴影 + 1.5× 真超采样：内部高分辨率渲染后降采样，全场景抗锯齿）· ${ms} ms——已导出 PNG`, en: `Ray render done: ${r.w}×${r.h} px (PCF soft shadows + 1.5× true supersampling: internal hi-res render then downsample, full-scene AA) · ${ms} ms — PNG exported` }))
      } catch {
        toast.error(tt({ zh: 'Ray 渲染失败', en: 'Ray render failed' }), { id: tid, description: tt({ zh: '显存或画布尺寸限制——试试更小的宽度', en: 'GPU memory or canvas size limit — try a smaller width' }) })
        useMolStore.getState().appendLog('err', tt({ zh: 'Ray 渲染失败（显存或画布尺寸限制——试试更小的宽度）', en: 'Ray render failed (GPU memory or canvas size limit — try a smaller width)' }))
      }
    })()
    return
  }

  if (cmd === 'svg') {
    // 矢量图导出：CPU 侧投影（画家算法），无限缩放不失真，可入稿 Illustrator/Inkscape
    let width: number | undefined
    if (parts[1]) {
      width = clampNum(parseFloat(parts[1]), 320, 4096, NaN)
      if (isNaN(width)) return err(tt({ zh: '用法：svg [宽 px]（如 svg 2400；缺省 1600，高度按视口纵横比）', en: 'Usage: svg [width px] (e.g. svg 2400; default 1600, height follows the viewport aspect)' }))
    }
    const s = useMolStore.getState()
    const r = buildSvgExport({ width })
    if (!r.ok || !r.svg) return err(r.error ?? tt({ zh: 'SVG 导出失败', en: 'SVG export failed' }))
    const name = s.structures[0]?.name ?? 'molvision'
    downloadSvg(r.svg, name)
    const skipped = r.skippedSurfaces.length
      ? tt({ zh: `；跳过 ${r.skippedSurfaces.length} 个表面表示（等值面无矢量原语）`, en: `; skipped ${r.skippedSurfaces.length} surface representation(s) (isosurfaces have no vector primitives)` })
      : ''
    return ok(tt({ zh: `已导出矢量图 ${r.width}×${r.height} · ${r.items.toLocaleString(loc())} 个原语 · ${r.ms.toFixed(0)} ms${skipped}——SVG 无限缩放不失真，可直接入稿`, en: `Vector image exported ${r.width}×${r.height} · ${r.items.toLocaleString(loc())} primitives · ${r.ms.toFixed(0)} ms${skipped} — SVG scales losslessly, ready for publication` }))
  }

  if (cmd === 'deselect' || cmd === 'desel') {
    // 清除当前选择（状态栏徽章 / 面板链行 / 序列条高亮归零；不影响氢键范围烘焙 hbondScope）
    const s = useMolStore.getState()
    if (!s.selection.structureId && !s.selection.indices.length) return ok(tt({ zh: '当前无选择', en: 'No current selection' }))
    useMolStore.setState(st => ({ selection: { structureId: null, indices: [], rev: st.selection.rev + 1 }, visualRev: st.visualRev + 1 }))
    return ok(tt({ zh: '已取消选择（面板/序列条高亮已清除；hbonds in 范围不受影响）', en: 'Selection cleared (panel/sequence highlights cleared; hbonds in scope unaffected)' }))
  }

  if (cmd === 'hbonds' || cmd === 'hbond' || cmd === 'hbon') {
    const s = useMolStore.getState()
    const arg = (parts[1] ?? 'on').toLowerCase()
    if (arg === 'off' || arg === '0') {
      s.updateSettings({ showHBonds: false })
      if (s.hbondScope) s.setHBondScope(null)
      return ok(tt({ zh: '氢键显示关闭（范围烘焙已同步清除）', en: 'H-bond display off (baked scope cleared too)' }))
    }
    // 范围子句：hbonds on [nÅ] in <表达式>（如 hbonds on 3.4 in byres(within 4.5 of ligand)）
    // 烘焙为独立范围——不随 deselect 清除，也不依赖后续选择变化（口袋工作流标准用法）
    const inMatch = input.slice(parts[0].length).match(/\bin\s+(.+)$/i)
    if (inMatch) {
      const scopeExpr = inMatch[1].trim()
      if (!s.activeId) return err(tt({ zh: '没有加载结构', en: 'No structure loaded' }))
      const data = dataRegistry.get(s.activeId)
      if (!data) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
      const named = buildNamedMasks(s.activeId, data)
      const r = evaluateSelection(scopeExpr, { structure: data, named })
      if (r.error) return err(tt({ zh: `范围选择错误: ${r.error}`, en: `Scope selection error: ${r.error}` }))
      const idx = maskToIndices(r.mask)
      if (!idx.length) return err(tt({ zh: '范围选择为空', en: 'Scope selection is empty' }))
      const dist = parseFloat(parts[2] ?? '')
      const patch: Partial<import('./types').Settings> = { showHBonds: true }
      if (!isNaN(dist) && dist >= 2 && dist <= 6) patch.hbondMaxDist = dist
      s.updateSettings(patch)
      s.setHBondScope({ structureId: s.activeId, indices: idx })
      // 范围不含配体时提示：配体-残基氢键是互作图核心（旧写法 and polymer 会漏掉配体自身氢键）
      const scopeHint = /ligand|resn/i.test(scopeExpr)
        ? ''
        : tt({ zh: '。提示：范围写 byres(within 4.5 of (ligand)) and not water 可同时画出配体-残基氢键（含配体本身）', en: '. Tip: scope byres(within 4.5 of (ligand)) and not water also draws ligand–residue H-bonds (including the ligand itself)' })
      return ok(tt({
        zh: `氢键已烘焙范围「${scopeExpr}」（${idx.length.toLocaleString(loc())} 原子内${!isNaN(dist) && dist >= 2 && dist <= 6 ? `，距离上限 ${dist} Å` : ''}）——不随 deselect 清除，端点球同步显示${scopeHint}`,
        en: `H-bonds baked to scope "${scopeExpr}" (within ${idx.length.toLocaleString(loc())} atoms${!isNaN(dist) && dist >= 2 && dist <= 6 ? `, distance limit ${dist} Å` : ''}) — not cleared by deselect, endpoint spheres shown${scopeHint}`,
      }))
    }
    let dist = parseFloat(parts[2] ?? '')
    if (isNaN(dist)) dist = parseFloat(arg)
    const patch: Partial<import('./types').Settings> = { showHBonds: true }
    if (!isNaN(dist) && dist >= 2 && dist <= 6) patch.hbondMaxDist = dist
    s.updateSettings(patch)
    const hasSel = s.selection.indices.length > 0
    const scope = s.hbondScope
    if (scope) return ok(tt({ zh: `氢键网络开启（烘焙范围 ${scope.indices.length.toLocaleString(loc())} 原子内${!isNaN(dist) && dist >= 2 && dist <= 6 ? `，距离上限 ${dist} Å` : ''}，deselect 不影响）`, en: `H-bond network on (within baked scope of ${scope.indices.length.toLocaleString(loc())} atoms${!isNaN(dist) && dist >= 2 && dist <= 6 ? `, distance limit ${dist} Å` : ''}; deselect has no effect)` }))
    const scope2 = s.settings.hbondSelOnly
      ? (hasSel ? tt({ zh: `当前选择集（${s.selection.indices.length.toLocaleString(loc())} 原子）范围内`, en: `within the current selection (${s.selection.indices.length.toLocaleString(loc())} atoms)` }) : tt({ zh: '仅选择集模式：请先选择残基/链，或用 hbonds on 3.4 in <表达式> 烘焙独立范围（不随 deselect 清除）', en: 'Selection-only mode: select residues/chains first, or bake a standalone scope with hbonds on 3.4 in <expression> (survives deselect)' }))
      : tt({ zh: '全结构网络（大结构较密，可在场景面板开启「仅选择集」缩小范围）', en: 'whole-structure network (dense for large structures; enable "selection only" in the scene panel to narrow the scope)' })
    return ok(tt({ zh: `氢键网络开启${!isNaN(dist) && dist >= 2 && dist <= 6 ? `（距离上限 ${dist} Å）` : ''}——${scope2}，快捷键 B 切换`, en: `H-bond network on${!isNaN(dist) && dist >= 2 && dist <= 6 ? ` (distance limit ${dist} Å)` : ''} — ${scope2}, hotkey B toggles` }))
  }

  if (cmd === 'ssao' || cmd === 'ao' || cmd === 'gtao') {
    const s = useMolStore.getState()
    const arg = (parts[1] ?? 'on').toLowerCase()
    if (arg === 'off' || arg === '0') {
      s.updateSettings({ ssao: false })
      return ok(tt({ zh: '环境光遮蔽已关闭', en: 'Ambient occlusion off' }))
    }
    // ssao on [半径Å] [强度]（`ssao on 1.5 2` 的第二个数此前被静默忽略——LLM 常给双参数）
    let idx = arg === 'on' ? 2 : 1
    let radius = parseFloat(parts[idx] ?? '')
    if (!isNaN(radius)) idx++
    const intensity = parseFloat(parts[idx] ?? '')
    const patch: Partial<import('./types').Settings> = { ssao: true }
    if (!isNaN(radius) && radius >= 0.5 && radius <= 12) patch.ssaoRadius = radius
    if (!isNaN(intensity) && intensity >= 0.2 && intensity <= 2.5) patch.ssaoIntensity = intensity
    s.updateSettings(patch)
    return ok(tt({ zh: `GTAO 环境光遮蔽开启${!isNaN(radius) && radius >= 0.5 && radius <= 12 ? `（采样半径 ${radius} Å）` : '（默认 3 Å）'}${!isNaN(intensity) && intensity >= 0.2 && intensity <= 2.5 ? `，强度 ${intensity}` : ''}，可在场景面板调节强度与半径`, en: `GTAO ambient occlusion on${!isNaN(radius) && radius >= 0.5 && radius <= 12 ? ` (sample radius ${radius} Å)` : ' (default 3 Å)'}${!isNaN(intensity) && intensity >= 0.2 && intensity <= 2.5 ? `, intensity ${intensity}` : ''}; adjust intensity and radius in the scene panel` }))
  }

  if (cmd === 'superpose' || cmd === 'match' || cmd === 'align' || cmd === 'mm') {
    const eng = engineRef.current
    if (!eng) return err(tt({ zh: '引擎未就绪', en: 'Engine not ready' }))
    const s = useMolStore.getState()
    if (s.structures.length < 2) return err(tt({ zh: `叠合需要至少 2 个结构（当前 ${s.structures.length}）`, en: `Superposition needs at least 2 structures (currently ${s.structures.length})` }))
    // 解析参数：<mobile> [onto <ref>] [chain <移动链> [to <参考链>]]（省略 onto 时参考为当前活动结构）
    let rest = input.slice(parts[0].length).trim()
    // 可选链对：chain <A> [to <B>]——从整条命令中先提取（可出现在任何位置）
    let mobChain: string | undefined
    let refChain: string | undefined
    const chainM = rest.match(/\s+chain\s+(\S+)(?:\s+to\s+(\S+))?$/i)
    if (chainM) {
      mobChain = chainM[1]
      refChain = chainM[2]
      rest = rest.slice(0, chainM.index).trim()
    }
    let refName: string | null = null
    const ontoM = rest.match(/\s+onto\s+(.+)$/i)
    if (ontoM) {
      refName = ontoM[1].trim()
      rest = rest.slice(0, ontoM.index).trim()
    }
    const mobileName = rest || (s.activeId ? s.structures.find(x => x.id === s.activeId)?.name : null)
    if (!mobileName) return err(tt({ zh: '用法：superpose <移动结构名> onto <参考结构名> [chain <移动链> to <参考链>]（省略 onto 则叠合到当前活动结构）', en: 'Usage: superpose <mobile name> onto <reference name> [chain <mobile chain> to <reference chain>] (omit onto to superpose onto the active structure)' }))
    if (!refName) {
      if (!s.activeId) return err(tt({ zh: '没有活动结构作为参考，请用 superpose <名> onto <参考名>', en: 'No active structure to use as the reference — use superpose <name> onto <reference>' }))
      const a = s.structures.find(x => x.id === s.activeId)
      if (a && a.name.toUpperCase() === mobileName.toUpperCase()) {
        // 移动=活动：改用第一个其它结构作参考
        const other = s.structures.find(x => x.id !== s.activeId)
        if (!other) return err(tt({ zh: '没有其它结构可作参考', en: 'No other structure to use as the reference' }))
        refName = other.name
      } else {
        refName = a?.name ?? null
      }
    }
    const findByName = (name: string) => s.structures.find(x => x.name.toUpperCase() === name.toUpperCase() || x.name.toUpperCase().startsWith(name.toUpperCase()))
    const mobile = findByName(mobileName)
    const ref = refName ? findByName(refName) : null
    if (!mobile) return err(tt({ zh: `未找到移动结构 "${mobileName}"（可用：${s.structures.map(x => x.name).join(', ')}）`, en: `Mobile structure "${mobileName}" not found (available: ${s.structures.map(x => x.name).join(', ')})` }))
    if (!ref) return err(tt({ zh: `未找到参考结构 "${refName}"`, en: `Reference structure "${refName}" not found` }))
    if (mobile.id === ref.id) return err(tt({ zh: '移动与参考结构不能相同', en: 'Mobile and reference structures cannot be the same' }))
    const t0 = performance.now()
    const res = eng.superpose(mobile.id, ref.id, mobChain, refChain)
    const ms = Math.round(performance.now() - t0)
    if (!res.ok) return err(tt({ zh: `叠合失败：${res.error}`, en: `Superposition failed: ${res.error}` }))
    ok(tt({ zh: `叠合完成：${mobile.name} → ${ref.name}（链 ${res.mobileChain} ↔ 链 ${res.refChain}${mobChain ? '（手动指定）' : ''}）`, en: `Superposed: ${mobile.name} → ${ref.name} (chain ${res.mobileChain} ↔ chain ${res.refChain}${mobChain ? ' (manually specified)' : ''})` }))
    ok(tt({ zh: `匹配 ${res.matched} 对 CA 原子，对齐后 RMSD = ${res.rmsd.toFixed(3)} Å，耗时 ${ms} ms`, en: `Matched ${res.matched} CA atom pairs, RMSD = ${res.rmsd.toFixed(3)} Å after alignment, ${ms} ms` }))
    if (res.rmsd > 3) ok(tt({ zh: '提示：RMSD 偏大，可能存在构象差异或序列相似度低', en: 'Note: RMSD is large — possible conformational differences or low sequence identity' }))
    return
  }

  if (cmd === 'dssp' || cmd === 'secstr') {
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    const entry = s.structures.find(x => x.id === s.activeId)
    const r = s.recomputeSS(s.activeId)
    if (r.error) return err(tt({ zh: `DSSP 失败：${r.error}`, en: `DSSP failed: ${r.error}` }))
    const total = r.helix + r.strand + r.loop
    const pct = (v: number) => total > 0 ? (v / total * 100).toFixed(0) : '0'
    ok(tt({ zh: `DSSP 二级结构指认完成：螺旋 ${r.helix}（${pct(r.helix)}%）· 折叠 ${r.strand}（${pct(r.strand)}%）· 环 ${r.loop}（${pct(r.loop)}%）`, en: `DSSP secondary structure assigned: helix ${r.helix} (${pct(r.helix)}%) · sheet ${r.strand} (${pct(r.strand)}%) · loop ${r.loop} (${pct(r.loop)}%)` }))
    ok(tt({ zh: `cartoon 已按新指认重建${entry?.hasSS ? '' : '（原无 HELIX/SHEET 记录）'}；helix / sheet 选择关键字同步更新`, en: `Cartoons rebuilt with the new assignment${entry?.hasSS ? '' : ' (no HELIX/SHEET records originally)'}; helix / sheet selection keywords updated` }))
    return
  }

  if (cmd === 'contacts' || cmd === 'contact' || cmd === 'clash') {
    // contacts off | contacts <exprA> | <exprB> [cutoff] | contacts [cutoff]（用当前/默认表达式）
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg === 'off' || arg === '0') {
      useContactStore.getState().clear()
      engineRef.current?.updateContacts()
      return ok(tt({ zh: '接触分析已清除', en: 'Contact analysis cleared' }))
    }
    if (arg === 'hide') {
      useContactStore.getState().setVisible(false)
      engineRef.current?.updateContacts()
      return ok(tt({ zh: '接触连线已隐藏（结果保留，用 contacts show 恢复）', en: 'Contact lines hidden (results kept; contacts show to restore)' }))
    }
    if (arg === 'show') {
      useContactStore.getState().setVisible(true)
      engineRef.current?.updateContacts()
      return ok(tt({ zh: '接触连线已显示', en: 'Contact lines shown' }))
    }
    // 解析 "exprA | exprB [cutoff]"（cutoff 前导空格或逗号均可：contacts A | B 4.5 / contacts A | B, 4.5——LLM 的 PyMOL 惯性写法）
    const rest = input.slice(parts[0].length).trim()
    const pipeM = rest.match(/^(.+?)\s*\|\s*(.+)$/)
    let aExpr: string | undefined, bExpr: string | undefined, cutoff: number | undefined
    if (pipeM) {
      aExpr = pipeM[1].trim()
      let bPart = pipeM[2].trim()
      const tailNum = bPart.match(/[\s,，]\s*(\d+(?:\.\d+)?)\s*$/)
      if (tailNum) {
        const n = parseFloat(tailNum[1])
        if (n >= 2.5 && n <= 10) {
          cutoff = n
          bPart = bPart.slice(0, bPart.length - tailNum[0].length).trim()
        }
      }
      bExpr = bPart
    } else if (arg) {
      const maybeNum = parseFloat(arg)
      if (!isNaN(maybeNum) && maybeNum >= 2.5 && maybeNum <= 10) cutoff = maybeNum
      else {
        // 非 off/show/hide/数字却无管道：不静默复用 store 残留表达式（agent 修正轮会拿到莫名其妙的旧错误）
        return err(tt({ zh: '用法：contacts <exprA> | <exprB> [cutoff]（A/B 两组用 | 分隔），如 contacts chain A | chain B 4.0；contacts off 清除', en: 'Usage: contacts <exprA> | <exprB> [cutoff] (groups A/B separated by |), e.g. contacts chain A | chain B 4.0; contacts off clears' }))
      }
    }
    const outcome = runContactAnalysis(aExpr, bExpr, cutoff)
    if (!outcome.ok) return err(outcome.message)
    ok(outcome.message)
    ok(tt({ zh: '分析面板（左侧「分析」标签）提供 2D 接触图谱与界面残基选择；contacts off 清除', en: 'The analysis panel (left "Analysis" tab) offers a 2D contact map and interface residue selection; contacts off clears' }))
    return
  }

  if (cmd === 'interface' || cmd === 'iface') {
    // interface <链A> <链B> [cutoff]：链间界面快捷命令
    // 兼容三种写法：interface A B / interface :A :B / interface chain A chain B（表达式风格）
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    const rest = input.slice(parts[0].length).trim()
    // 尾部截断值
    let expr = rest
    let cutoff: number | undefined
    const lastSpace = expr.lastIndexOf(' ')
    if (lastSpace > 0) {
      const maybeNum = parseFloat(expr.slice(lastSpace + 1))
      if (!isNaN(maybeNum) && maybeNum >= 2.5 && maybeNum <= 10) {
        cutoff = maybeNum
        expr = expr.slice(0, lastSpace).trim()
      }
    }
    const norm = expr.replace(/[:：]/g, ' ').trim()
    const tokens = norm.split(/\s+/)
    const SELECTOR_KEYWORDS = ['chain', 'resn', 'resi', 'name', 'elem', 'protein', 'ligand', 'water', 'within', 'byres', 'not', 'and', 'or', 'backbone', 'sidechain', 'helix', 'sheet', 'coil', 'all', 'polymer', 'hetero', 'metal']
    const isExprStyle = tokens.some(t => SELECTOR_KEYWORDS.includes(t.toLowerCase()))
    let aExpr: string, bExpr: string
    if (isExprStyle && tokens.length >= 4) {
      // 表达式风格：interface chain A chain B → A 组 = chain A，B 组 = chain B
      // 启发式：找到第二个选择关键字的位置切分
      const lower = tokens.map(t => t.toLowerCase())
      const secondKw = lower.lastIndexOf('chain')
      if (secondKw > 0 && lower.indexOf('chain') !== secondKw) {
        aExpr = tokens.slice(0, secondKw).join(' ')
        bExpr = tokens.slice(secondKw).join(' ')
      } else {
        // 其他表达式：无法可靠切分，提示用 contacts 管道语法
        return err(tt({ zh: '复杂表达式请使用 contacts <A> | <B> [cutoff]，如 contacts chain A | chain B 4.0', en: 'For complex expressions use contacts <A> | <B> [cutoff], e.g. contacts chain A | chain B 4.0' }))
      }
    } else if (tokens.length === 2) {
      aExpr = `chain ${tokens[0]}`
      bExpr = `chain ${tokens[1]}`
    } else {
      return err(tt({ zh: '用法：interface <链A> <链B> [cutoff]，如 interface A B 4.0 或 interface chain A chain B', en: 'Usage: interface <chainA> <chainB> [cutoff], e.g. interface A B 4.0 or interface chain A chain B' }))
    }
    const outcome = runContactAnalysis(aExpr, bExpr, cutoff)
    if (!outcome.ok) return err(outcome.message)
    ok(outcome.message)
    return
  }

  if (cmd === 'xcontacts' || cmd === 'xcontact' || cmd === 'xiface') {
    // xcontacts <结构A>:<exprA> | <结构B>:<exprB> [cutoff]
    const rest = input.slice(parts[0].length).trim()
    const pipeM = rest.match(/^(.+?)\s*\|\s*(.+)$/)
    if (!pipeM) return err(tt({ zh: '用法：xcontacts <结构A>:<exprA> | <结构B>:<exprB> [cutoff]，如 xcontacts 1UBQ:chain A | 1D3Z:chain A 5.0', en: 'Usage: xcontacts <structA>:<exprA> | <structB>:<exprB> [cutoff], e.g. xcontacts 1UBQ:chain A | 1D3Z:chain A 5.0' }))
    let aSpec = pipeM[1].trim()
    let bPart = pipeM[2].trim()
    // 尾部截断值
    let cutoff: number | undefined
    const lastSpace = bPart.lastIndexOf(' ')
    if (lastSpace > 0) {
      const maybeNum = parseFloat(bPart.slice(lastSpace + 1))
      if (!isNaN(maybeNum) && maybeNum >= 2.5 && maybeNum <= 10) {
        cutoff = maybeNum
        bPart = bPart.slice(0, lastSpace).trim()
      }
    }
    const outcome = runCrossContactAnalysis(aSpec, bPart, cutoff)
    if (!outcome.ok) return err(outcome.message)
    ok(outcome.message)
    if (useContactStore.getState().cross) {
      ok(tt({ zh: '跨结构接触以两结构当前位姿为准（superpose 变换会实时反映在坐标中）；分析面板可查看跨结构界面残基列表', en: 'Cross-structure contacts use the current poses of both structures (superpose transforms are reflected live); the analysis panel lists cross-structure interface residues' }))
    }
    return
  }

  if (cmd === 'sasa' || cmd === 'area') {
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    const data = engineRef.current && dataRegistry.get(s.activeId)
    if (!data) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    const probe = clampNum(parseFloat(parts[1]), 0.8, 2.0, 1.4)
    const nPoints = Math.round(clampNum(parseFloat(parts[2]), 32, 512, 92))
    const eng = engineRef.current!
    const r = eng.requestSasa(s.activeId, { probe, nPoints })
    if (r.done && r.stats) {
      const st = r.stats
      ok(tt({ zh: `SASA（Shrake–Rupley，probe ${probe} Å，${nPoints} 点）：总计 ${st.total.toFixed(0)} Å² · 疏水 ${st.hydrophobic.toFixed(0)} · 极性 ${st.polar.toFixed(0)} · 水与配体 ${st.het.toFixed(0)} · ${st.ms.toFixed(0)} ms`, en: `SASA (Shrake–Rupley, probe ${probe} Å, ${nPoints} points): total ${st.total.toFixed(0)} Å² · hydrophobic ${st.hydrophobic.toFixed(0)} · polar ${st.polar.toFixed(0)} · water & ligands ${st.het.toFixed(0)} · ${st.ms.toFixed(0)} ms` }))
      ok(tt({ zh: '可用 color sasa 按暴露度着色（埋藏蓝 → 暴露橙红）；分析面板含 Top 暴露残基', en: 'Use color sasa to color by exposure (buried blue → exposed orange-red); the analysis panel lists top-exposed residues' }))
    } else {
      ok(tt({ zh: `SASA 计算中（Web Worker，probe ${probe} Å，${nPoints} 点）——完成后将在此输出结果，并自动更新着色`, en: `SASA computing (Web Worker, probe ${probe} Å, ${nPoints} points) — results print here when done, coloring updates automatically` }))
    }
    return
  }

  if (cmd === 'bsa' || cmd === 'buried' || cmd === 'bsa-area') {
    const outcome = runBuriedSasa()
    if (!outcome.ok) return err(outcome.message)
    ok(outcome.message)
    if (useSasaStore.getState().buried?.computing === false && useSasaStore.getState().buried) {
      ok(tt({ zh: '分析面板提供界面核心残基选择（ΔSASA > 1 Å² 判据）', en: 'The analysis panel offers core interface residue selection (ΔSASA > 1 Å² criterion)' }))
    }
    return
  }

  if (cmd === 'xbsa' || cmd === 'xburied' || cmd === 'xbsa-area') {
    const outcome = runCrossBuriedSasa()
    if (!outcome.ok) return err(outcome.message)
    ok(outcome.message)
    const b = useSasaStore.getState().buried
    if (b && b.cross && !b.computing) {
      ok(tt({ zh: '以两结构当前位姿为准（superpose 变换实时反映）；分析面板提供两侧核心残基选择', en: 'Based on the current poses of both structures (superpose transforms reflected live); the analysis panel offers core residue selection for both sides' }))
    }
    return
  }

  if (cmd === 'untransform' || cmd === 'unpose') {
    const s = useMolStore.getState()
    const nameArg = parts[1]
    let targetId = s.activeId
    if (nameArg) {
      const found = s.structures.find(x =>
        x.name.toLowerCase() === nameArg.toLowerCase() ||
        x.name.toLowerCase().startsWith(nameArg.toLowerCase()) ||
        x.meta.pdbId?.toLowerCase() === nameArg.toLowerCase())
      if (!found) return err(tt({ zh: `未找到结构 "${nameArg}"（可用：${s.structures.map(x => x.name).join('、')}）`, en: `Structure "${nameArg}" not found (available: ${s.structures.map(x => x.name).join(', ')})` }))
      targetId = found.id
    }
    if (!targetId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    const r = engineRef.current?.resetTransform(targetId)
    if (!r) return err(tt({ zh: '引擎未就绪', en: 'Engine not ready' }))
    if (!r.ok) return err(r.message)
    ok(r.message + tt({ zh: '；会话存档中的变换已同步清除', en: '; transform also cleared from the session archive' }))
    return
  }

  if (cmd === 'record' || cmd === 'rec') {
    const eng = engineRef.current
    if (!eng) return err(tt({ zh: '引擎未就绪', en: 'Engine not ready' }))
    const sub = (parts[1] ?? 'start').toLowerCase()
    if (sub === 'start' || sub === 'on') {
      if (eng.isRecording) return ok(tt({ zh: '已在录制中', en: 'Already recording' }))
      const okStart = eng.startRecording()
      if (!okStart) return err(tt({ zh: '当前浏览器不支持画布录制（MediaRecorder）', en: 'Canvas recording not supported in this browser (MediaRecorder)' }))
      useRecordStore.getState().setRecording(true)
      const smooth = useMovieStore.getState().smooth
      return ok(tt({ zh: `开始录制（30fps WebM）——可同时播放 ensemble / rock / spin；record stop 停止并下载${smooth ? ' · movie play 走平滑巡航（当前默认，录像连贯）' : ' · 录连贯转场推荐：movie smooth 开启平滑巡航'}`, en: `Recording started (30 fps WebM) — ensemble / rock / spin can play simultaneously; record stop stops and downloads${smooth ? ' · movie play uses smooth cruise (current default, silky recordings)' : ' · for silky transitions, enable smooth cruise with movie smooth'}` }))
    }
    if (sub === 'stop' || sub === 'off') {
      if (!eng.isRecording) return err(tt({ zh: '当前未在录制', en: 'Not currently recording' }))
      void eng.stopRecording().then(blob => {
        useRecordStore.getState().setRecording(false)
        if (!blob || blob.size === 0) {
          useMolStore.getState().appendLog('err', tt({ zh: '录制内容为空', en: 'Recording is empty' }))
          return
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const d = new Date()
        const p = (n: number) => String(n).padStart(2, '0')
        a.href = url
        a.download = `molvision-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.webm`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
        useMolStore.getState().appendLog('out', tt({ zh: `动画已导出：${(blob.size / 1024 / 1024).toFixed(1)} MB WebM`, en: `Animation exported: ${(blob.size / 1024 / 1024).toFixed(1)} MB WebM` }))
      })
      return ok(tt({ zh: '停止录制，正在生成 WebM…', en: 'Recording stopped, generating WebM…' }))
    }
    return err(tt({ zh: '用法：record start | record stop', en: 'Usage: record start | record stop' }))
  }

  if (cmd === 'session' || (cmd === 'save' && !(parts[1] ?? '').toLowerCase().endsWith('.pdb') && !(parts[1] ?? '').toLowerCase().endsWith('.ent'))) {
    const sub = (parts[1] ?? (cmd === 'save' ? 'save' : 'info')).toLowerCase()
    if (cmd === 'save' || sub === 'save') {
      const okSaved = saveSession()
      const n = useMolStore.getState().structures.length
      return okSaved && n > 0 ? ok(tt({ zh: `会话已保存（${n} 个结构，含相机视角）`, en: `Session saved (${n} structures, incl. camera views)` })) : err(tt({ zh: '无可保存内容或保存失败', en: 'Nothing to save, or save failed' }))
    }
    if (sub === 'export' || sub === 'file') {
      // 导出 .molvision 会话文件（含结构源文本与全部视图状态）
      const okExport = exportSessionFile()
      return okExport
        ? ok(tt({ zh: '会话已导出为 .molvision 文件（含结构源文本 · 表示法 · 设置 · 相机视角 · 书签）', en: 'Session exported as a .molvision file (structure source text · representations · settings · camera views · bookmarks)' }))
        : err(tt({ zh: '无可导出的会话（先加载结构）', en: 'No session to export (load a structure first)' }))
    }
    if (sub === 'new') {
      const closed = newSession()
      return ok(closed > 0
        ? tt({ zh: `已新建会话（关闭 ${closed} 个结构，书签/时间轴/密度图已清空）`, en: `New session started (closed ${closed} structures; bookmarks/timeline/maps cleared)` })
        : tt({ zh: '已新建会话（书签/时间轴/密度图已清空）', en: 'New session started (bookmarks/timeline/maps cleared)' }))
    }
    if (sub === 'clear' || sub === 'reset') {
      clearSession()
      return ok(tt({ zh: '会话存档已清除（下次刷新不再恢复）', en: 'Session archive cleared (not restored on next refresh)' }))
    }
    return ok(sessionInfo())
  }

  if (cmd === 'save') {
    // save <名>.pdb [选择]：坐标导出（PyMOL save）
    const fileName = parts[1] ?? ''
    if (!fileName.toLowerCase().endsWith('.pdb') && !fileName.toLowerCase().endsWith('.ent')) {
      return err(tt({ zh: '用法：save <文件名>.pdb [选择表达式]（导出坐标）；会话存档用 session save', en: 'Usage: save <file>.pdb [selection expression] (exports coordinates); use session save for the session archive' }))
    }
    const s = useMolStore.getState()
    if (!s.activeId) return err(tt({ zh: '没有活动结构', en: 'No active structure' }))
    const data = dataRegistry.get(s.activeId)
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!data || !entry) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    const expr = parts.slice(2).join(' ').trim()
    let outData = data
    let atomCount = data.atoms.count
    if (expr) {
      const named = buildNamedMasks(s.activeId, data)
      const r = evaluateSelection(expr, { structure: data, named })
      if (r.error) return err(tt({ zh: `选择错误: ${r.error}`, en: `Selection error: ${r.error}` }))
      if (r.count === 0) return err(tt({ zh: '选择为空', en: 'Selection is empty' }))
      try {
        outData = subsetStructure(data, maskToIndices(r.mask), entry.name)
        atomCount = outData.atoms.count
      } catch (e) {
        return err(tt({ zh: `导出失败：${e instanceof Error ? e.message : String(e)}`, en: `Export failed: ${e instanceof Error ? e.message : String(e)}` }))
      }
    }
    const text = structureToPdbText(outData)
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName.toLowerCase().endsWith('.ent') ? fileName : fileName.replace(/\.[^.]*$/, '') + '.pdb'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return ok(tt({ zh: `已导出 ${atomCount.toLocaleString(loc())} 个原子 → ${a.download}${expr ? `（选择：${expr}）` : ''}（世界坐标，含 CRYST1）`, en: `Exported ${atomCount.toLocaleString(loc())} atoms → ${a.download}${expr ? ` (selection: ${expr})` : ''} (world coordinates, incl. CRYST1)` }))
  }

  if (cmd === 'morph') {
    // morph [multi] <新名> = <结构A> <结构B> [<结构C>…] [帧数]：构象插值轨迹（对标 PyMOL morph）
    const isMulti = (parts[1] ?? '').toLowerCase() === 'multi'
    // parts = input 按空白切分；multi 时去掉前两个词，否则去掉命令词（避免手算偏移漏空格）
    const rest = (isMulti ? parts.slice(2) : parts.slice(1)).join(' ')
    const m = rest.match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/)
    if (!m) return err(isMulti
      ? tt({ zh: '用法：morph multi <新对象名> = <构象A> <构象B> <构象C> … [帧数]，如 morph multi m = 1BQL 2LYZ 2VB1 60', en: 'Usage: morph multi <new object name> = <conformer A> <conformer B> <conformer C> … [frames], e.g. morph multi m = 1BQL 2LYZ 2VB1 60' })
      : tt({ zh: '用法：morph <新对象名> = <结构A> <结构B> [帧数]，如 morph m1 = 1BQL 2LYZ 40', en: 'Usage: morph <new object name> = <structure A> <structure B> [frames], e.g. morph m1 = 1BQL 2LYZ 40' }))
    const name = m[1]
    const tail = m[2].trim().split(/\s+/)
    // 尾部可选标志：norefine 关闭帧精修（键长约束 + 去碰撞）
    const noRefine = tail.some(t => t.toLowerCase() === 'norefine')
    const tailClean = tail.filter(t => t.toLowerCase() !== 'norefine')
    if (tailClean.length < 2) return err(tt({ zh: `需要至少两个构象：morph ${isMulti ? 'multi ' : ''}<名> = <A> <B>${isMulti ? ' <C> …' : ''} [帧数] [norefine]`, en: `At least two conformers required: morph ${isMulti ? 'multi ' : ''}<name> = <A> <B>${isMulti ? ' <C> …' : ''} [frames] [norefine]` }))
    const s = useMolStore.getState()
    const resolve = (q: string) => s.structures.find(x =>
      x.name.toLowerCase() === q.toLowerCase() ||
      x.name.toLowerCase().startsWith(q.toLowerCase()) ||
      x.meta.pdbId?.toLowerCase() === q.toLowerCase())
    const framesTok = tailClean[tailClean.length - 1]
    const framesParsed = /^\d+$/.test(framesTok) ? parseInt(framesTok, 10) : null
    const structToks = framesParsed !== null ? tailClean.slice(0, -1) : tailClean
    const entries = structToks.map(t => resolve(t))
    const missing = structToks.filter((t, i) => !entries[i])
    if (missing.length) return err(tt({ zh: `未找到结构：${missing.join('、')}（可用：${s.structures.map(x => x.name).join('、') || '无'}）`, en: `Structures not found: ${missing.join(', ')} (available: ${s.structures.map(x => x.name).join(', ') || 'none'})` }))
    const ids = new Set(entries.map(e => e!.id))
    if (ids.size < 2) return err(tt({ zh: '构象不能来自同一结构（morph 需要不同构象）', en: 'Conformers cannot come from the same structure (morph needs distinct conformers)' }))
    const datas = entries.map(e => dataRegistry.get(e!.id))
    if (datas.some(d => !d)) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    try {
      const t0 = performance.now()
      if (isMulti) {
        // ---------- 多态样条 morph ----------
        const steps = framesParsed ?? 48
        if (steps < 10 || steps > 200) return err(tt({ zh: '帧数范围 10–200（默认 48）', en: 'Frames must be 10–200 (default 48)' }))
        const r = buildMultiMorph(datas as StructureData[], name, steps, !noRefine)
        if (!r.ok || !r.data) return err(r.error ?? tt({ zh: 'morph 失败', en: 'morph failed' }))
        const ms = performance.now() - t0
        const id = useMolStore.getState().addStructure(r.data, name, ms)
        textRegistry.set(id, structureToPdbText(r.data))
        const chainInfo = r.matchedChains.map(([a, b]) => `${a}↔${b}`).join(' ')
        ok(tt({ zh: `多态 morph 对象 "${name}" 已创建：${r.knots} 个构象态 · ${r.matchedAtoms.toLocaleString(loc())} 原子 · ${r.matchedResidues.toLocaleString(loc())} 残基 · ${r.frames} 帧（Catmull-Rom 样条，${ms.toFixed(0)} ms）${chainInfo ? ` · 链对 ${chainInfo}` : ''}`, en: `Multi-state morph object "${name}" created: ${r.knots} conformational states · ${r.matchedAtoms.toLocaleString(loc())} atoms · ${r.matchedResidues.toLocaleString(loc())} residues · ${r.frames} frames (Catmull-Rom spline, ${ms.toFixed(0)} ms)${chainInfo ? ` · chain pairs ${chainInfo}` : ''}` }))
        if (r.refine) ok(tt({ zh: `帧精修（rigimol 风格）：${r.refine.bonds.toLocaleString(loc())} 键长度约束 · 中间帧键长偏差均值 ${r.refine.bondDrift.toFixed(3)} Å 已归零（最大 ${r.refine.maxDrift.toFixed(3)} Å）· 修复非键碰撞 ${r.refine.clashesFixed.toLocaleString(loc())} 处`, en: `Frame refinement (rigimol-style): ${r.refine.bonds.toLocaleString(loc())} bond-length constraints · mean bond-length drift of intermediate frames zeroed at ${r.refine.bondDrift.toFixed(3)} Å (max ${r.refine.maxDrift.toFixed(3)} Å) · fixed ${r.refine.clashesFixed.toLocaleString(loc())} non-bonded clashes` }))
        else if (noRefine) ok(tt({ zh: '帧精修已关闭（norefine）：中间帧保留纯样条插值', en: 'Frame refinement off (norefine): intermediate frames keep pure spline interpolation' }))
        r.rmsds.forEach((rmsd, i) => {
          if (rmsd !== null) ok(tt({ zh: `构象 ${i + 2}（${structToks[i + 1]}）叠合到参考：CA RMSD ${rmsd.toFixed(2)} Å`, en: `Conformer ${i + 2} (${structToks[i + 1]}) superposed onto the reference: CA RMSD ${rmsd.toFixed(2)} Å` }))
        })
        if (r.strategy === 'identity') ok(tt({ zh: '匹配策略：恒等（同源结构按原子序对应）', en: 'Matching strategy: identity (homologous structures matched by atom order)' }))
        return ok(tt({ zh: '底部播放条可逐帧浏览样条轨迹——ensemble play 播放，帧滑块可停在任意中间构象', en: 'The bottom playback bar scrubs the spline trajectory — ensemble play animates, the frame slider can stop at any intermediate conformation' }))
      }
      // ---------- 双构象 morph ----------
      const steps = framesParsed ?? 30
      if (steps < 10 || steps > 120) return err(tt({ zh: '帧数范围 10–120（默认 30）', en: 'Frames must be 10–120 (default 30)' }))
      const r = buildMorph(datas[0]!, datas[1]!, name, steps, !noRefine)
      if (!r.ok || !r.data) return err(r.error ?? tt({ zh: 'morph 失败', en: 'morph failed' }))
      const ms = performance.now() - t0
      const id = useMolStore.getState().addStructure(r.data, name, ms)
      textRegistry.set(id, structureToPdbText(r.data))
      const chainInfo = r.matchedChains.map(([a, b]) => `${a}↔${b}`).join(' ')
      ok(tt({ zh: `morph 对象 "${name}" 已创建：${r.matchedAtoms.toLocaleString(loc())} 原子 · ${r.matchedResidues.toLocaleString(loc())} 残基对 · ${r.frames} 帧${chainInfo ? ` · 链对 ${chainInfo}` : ''}（${ms.toFixed(0)} ms）`, en: `Morph object "${name}" created: ${r.matchedAtoms.toLocaleString(loc())} atoms · ${r.matchedResidues.toLocaleString(loc())} residue pairs · ${r.frames} frames${chainInfo ? ` · chain pairs ${chainInfo}` : ''} (${ms.toFixed(0)} ms)` }))
      if (r.refine) ok(tt({ zh: `帧精修（rigimol 风格）：${r.refine.bonds.toLocaleString(loc())} 键长度约束 · 中间帧键长偏差均值 ${r.refine.bondDrift.toFixed(3)} Å 已归零（最大 ${r.refine.maxDrift.toFixed(3)} Å）· 修复非键碰撞 ${r.refine.clashesFixed.toLocaleString(loc())} 处`, en: `Frame refinement (rigimol-style): ${r.refine.bonds.toLocaleString(loc())} bond-length constraints · mean bond-length drift of intermediate frames zeroed at ${r.refine.bondDrift.toFixed(3)} Å (max ${r.refine.maxDrift.toFixed(3)} Å) · fixed ${r.refine.clashesFixed.toLocaleString(loc())} non-bonded clashes` }))
      else if (noRefine) ok(tt({ zh: '帧精修已关闭（norefine）：中间帧保留纯插值', en: 'Frame refinement off (norefine): intermediate frames keep pure interpolation' }))
      if (r.alignRmsd !== null) ok(tt({ zh: `自动叠合 ${entries[1]!.name} → ${entries[0]!.name}：CA RMSD ${r.alignRmsd.toFixed(2)} Å（内存中完成，不改动原结构）`, en: `Auto-superposed ${entries[1]!.name} → ${entries[0]!.name}: CA RMSD ${r.alignRmsd.toFixed(2)} Å (in memory; original structures untouched)` }))
      if (r.strategy === 'identity') ok(tt({ zh: '匹配策略：恒等（同源结构按原子序对应）', en: 'Matching strategy: identity (homologous structures matched by atom order)' }))
      return ok(tt({ zh: '底部出现构象播放条——ensemble play 开始播放，V 键保存当前机位后 movie play 可巡航录制（会话存档保存第 1 帧坐标）', en: 'A conformation playback bar appears at the bottom — ensemble play starts playback; save the current viewpoint with V and movie play can cruise-record (the session archive stores frame 1 coordinates)' }))
    } catch (e) {
      return err(tt({ zh: `morph 失败：${e instanceof Error ? e.message : String(e)}`, en: `morph failed: ${e instanceof Error ? e.message : String(e)}` }))
    }
  }

  if (cmd === 'movie') {
    const sub = (parts[1] ?? 'status').toLowerCase()
    if (sub === 'play' || sub === 'start') {
      // 模式关键字（任意位置）：smooth = 平滑巡航（录像连贯）；hold = 逐帧驻留（PyMOL 经典）；缺省用面板开关的默认
      const args = parts.slice(2)
      const hasSmooth = args.some(a => a.toLowerCase() === 'smooth' || a.toLowerCase() === 'cruise')
      const hasHold = args.some(a => a.toLowerCase() === 'hold' || a.toLowerCase() === 'classic')
      const nums = args.filter(a => /^[\d.]+$/.test(a))
      const secs = parseFloat(nums[0] ?? '')
      const loops = parseInt(nums[1] ?? '', 10)
      const hasSecs = !isNaN(secs)
      const dur = hasSecs ? secs : 2.6
      const n = isNaN(loops) ? undefined : loops
      const smooth = hasSmooth ? true : hasHold ? false : useMovieStore.getState().smooth
      // r59-a2 #5 修复：欢迎页/agent 首轮 views-store 尚未水合——与 view 命令同款 hydrate 先行
      useViewsStore.getState().hydrate()
      const vs = useViewsStore.getState()
      const tl = useMovieStore.getState().timeline
      const byId = new Map(vs.bookmarks.map(b => [b.id, b] as const))
      const validTl = tl.filter(e => byId.has(e.viewId)).length
      // 无显式秒数且时间轴有 ≥2 有效关键帧 → 时间轴模式（逐段时长）；否则经典书签统一时长模式
      const useTl = !hasSecs && validTl >= 2
      if (!useTl && vs.bookmarks.length < 2) return err(tt({ zh: `至少需要 2 个视角书签（当前 ${vs.bookmarks.length}）——V 键或 view save 先保存多机位`, en: `At least 2 view bookmarks required (currently ${vs.bookmarks.length}) — save viewpoints first with V or view save` }))
      const rounds = n ?? (useTl ? useMovieStore.getState().loopsEdit : 1)
      // 开始消息立即打印（playMovie 的 promise 在播放结束时才 resolve）
      if (useTl) {
        const totalMs = tl.reduce((s, e) => s + e.duration, 0)
        ok(tt({ zh: `movie 开始（时间轴模式${smooth ? ' · 平滑巡航' : ' · 逐帧驻留'}）：${validTl} 个关键帧 · 单轮 ${(totalMs / 1000).toFixed(1)}s（逐段时长）× ${rounds} 轮——拖动/滚轮接管停止；record start 可同步录制`, en: `movie started (timeline mode${smooth ? ' · smooth cruise' : ' · per-frame dwell'}): ${validTl} keyframes · ${(totalMs / 1000).toFixed(1)}s per pass (per-segment durations) × ${rounds} rounds — drag/scroll to take over; record start records in sync` }))
      } else {
        ok(tt({ zh: `movie 开始（${smooth ? '平滑巡航：关键帧间速度连续，录像丝滑' : '逐帧驻留：每机位 easeInOut 停顿'}）：${vs.bookmarks.length} 个视角 × ${rounds} 轮 × ${dur}s——拖动/滚轮可随时接管停止；record start 可同步录制`, en: `movie started (${smooth ? 'smooth cruise: continuous velocity between keyframes, silky recordings' : 'per-frame dwell: easeInOut pause at each viewpoint'}): ${vs.bookmarks.length} viewpoints × ${rounds} rounds × ${dur}s — drag/scroll to take over anytime; record start records in sync` }))
      }
      void playMovie({ duration: dur * 1000, loops: n, useTimeline: useTl, smooth }).then(r => {
        if (!r.ok) err(r.error)
      })
      return
    }
    if (sub === 'smooth' || sub === 'cruise') {
      useMovieStore.getState().setSmooth(true)
      return ok(tt({ zh: 'movie 默认模式已设为平滑巡航（关键帧间 Catmull-Rom 连续插值，速度不归零——录像连贯无顿挫）——movie play 使用此默认；movie hold 切回逐帧驻留', en: 'movie default mode set to smooth cruise (Catmull-Rom continuous interpolation between keyframes, velocity never zero — silky, stutter-free recordings) — movie play uses this default; movie hold switches back to per-frame dwell' }))
    }
    if (sub === 'hold' || sub === 'classic') {
      useMovieStore.getState().setSmooth(false)
      return ok(tt({ zh: 'movie 默认模式已设为逐帧驻留（每个关键帧 easeInOut 停顿——PyMOL 经典幻灯片式）——movie play 使用此默认；movie smooth 切回平滑巡航', en: 'movie default mode set to per-frame dwell (easeInOut pause at each keyframe — PyMOL classic slideshow) — movie play uses this default; movie smooth switches back to smooth cruise' }))
    }
    if (sub === 'stop' || sub === 'end') {
      stopMovie()
      return ok(tt({ zh: 'movie 序列播放已停止', en: 'movie sequence playback stopped' }))
    }
    if (sub === 'edit' || sub === 'timeline') {
      useMovieStore.getState().setTimelineOpen(true)
      return ok(tt({ zh: 'movie 时间轴已打开（底部面板：拖拽排序、逐段时长、轮数、播放）——工具栏 Film 按钮可开关', en: 'movie timeline opened (bottom panel: drag to reorder, per-segment durations, rounds, playback) — the toolbar Film button toggles it' }))
    }
    const ms = useMovieStore.getState()
    if (ms.playing) {
      return ok(tt({ zh: `movie 播放中${ms.smooth ? '（平滑巡航）' : '（逐帧驻留）'}：段 ${ms.seg + 1}/${ms.total}（${ms.currentName ?? ''}），本段 ${(ms.duration / 1000).toFixed(1)}s × ${ms.loops} 轮`, en: `movie playing${ms.smooth ? ' (smooth cruise)' : ' (per-frame dwell)'}: segment ${ms.seg + 1}/${ms.total} (${ms.currentName ?? ''}), ${(ms.duration / 1000).toFixed(1)}s × ${ms.loops} rounds` }))
    }
    const tlInfo = ms.timeline.length
      ? tt({ zh: ` · 时间轴 ${ms.timeline.length} 段（movie play 走时间轴模式；movie edit 打开编排面板）`, en: ` · timeline with ${ms.timeline.length} segments (movie play uses timeline mode; movie edit opens the arranging panel)` })
      : tt({ zh: ' · movie edit 打开时间轴编排面板', en: ' · movie edit opens the timeline arranging panel' })
    return ok(tt({ zh: `movie 未播放。已存 ${useViewsStore.getState().bookmarks.length} 个视角书签（上限 ${MAX_BOOKMARKS}）——movie play [smooth|hold] [秒/视角] [轮数] 启动；当前默认模式：${ms.smooth ? '平滑巡航（录像连贯）' : '逐帧驻留（PyMOL 经典）'}${tlInfo}`, en: `movie idle. ${useViewsStore.getState().bookmarks.length} view bookmarks saved (max ${MAX_BOOKMARKS}) — start with movie play [smooth|hold] [seconds/viewpoint] [rounds]; current default mode: ${ms.smooth ? 'smooth cruise (silky recordings)' : 'per-frame dwell (PyMOL classic)'}${tlInfo}` }))
  }

  if (cmd === 'ensemble' || cmd === 'ens') {
    const eng = engineRef.current
    const es = useEnsembleStore.getState()
    if (!eng) return err(tt({ zh: '引擎未就绪', en: 'Engine not ready' }))
    const sub = (parts[1] ?? 'info').toLowerCase()
    if (sub === 'play') {
      if (!es.structureId) return err(tt({ zh: '当前无含 ensemble 的结构（试试 1D3Z）', en: 'No structure with an ensemble (try 1D3Z)' }))
      eng.playEnsemble(es.structureId)
      return ok(tt({ zh: `构象动画播放中（${es.total} 帧，P 暂停）`, en: `Ensemble animation playing (${es.total} frames, P pauses)` }))
    }
    if (sub === 'pause' || sub === 'stop') {
      eng.pauseEnsemble()
      return ok(tt({ zh: '构象动画已暂停', en: 'Ensemble animation paused' }))
    }
    if (sub === 'reset') {
      if (!es.structureId) return err(tt({ zh: '当前无含 ensemble 的结构', en: 'No structure with an ensemble' }))
      eng.resetEnsemble(es.structureId)
      return ok(tt({ zh: '已回到第 1 帧', en: 'Back to frame 1' }))
    }
    if (sub === 'frame' || sub === 'goto') {
      if (!es.structureId) return err(tt({ zh: '当前无含 ensemble 的结构', en: 'No structure with an ensemble' }))
      const n = parseInt(parts[2] ?? '', 10)
      if (isNaN(n)) return err(tt({ zh: '用法：ensemble frame <1..N>', en: 'Usage: ensemble frame <1..N>' }))
      eng.setEnsembleFrame(es.structureId, n - 1)
      return ok(tt({ zh: `已跳到第 ${n} 帧`, en: `Jumped to frame ${n}` }))
    }
    if (sub === 'fps' || sub === 'speed') {
      const v = parseFloat(parts[2] ?? '')
      if (isNaN(v) || v < 0.5 || v > 60) return err(tt({ zh: '用法：ensemble fps <0.5-60>', en: 'Usage: ensemble fps <0.5-60>' }))
      es.setFps(v)
      return ok(tt({ zh: `播放速度 ${v} 帧/秒`, en: `Playback speed ${v} fps` }))
    }
    if (sub === 'interp') {
      const on = (parts[2] ?? 'on').toLowerCase() !== 'off'
      es.setInterp(on)
      return ok(on ? tt({ zh: '帧间插值开启（平滑）', en: 'Inter-frame interpolation on (smooth)' }) : tt({ zh: '帧间插值关闭（跳变）', en: 'Inter-frame interpolation off (stepped)' }))
    }
    if (sub === 'loop') {
      const on = (parts[2] ?? 'on').toLowerCase() !== 'off'
      es.setLoop(on)
      return ok(on ? tt({ zh: '循环播放开启', en: 'Looping on' }) : tt({ zh: '循环播放关闭', en: 'Looping off' }))
    }
    return es.structureId
      ? ok(tt({ zh: `ensemble：${es.total} 帧，当前第 ${es.frame + 1} 帧，${es.playing ? '播放中' : '已暂停'}，${es.fps} fps，插值${es.interp ? '开' : '关'}，循环${es.loop ? '开' : '关'}`, en: `ensemble: ${es.total} frames, currently frame ${es.frame + 1}, ${es.playing ? 'playing' : 'paused'}, ${es.fps} fps, interpolation ${es.interp ? 'on' : 'off'}, looping ${es.loop ? 'on' : 'off'}` }))
      : err(tt({ zh: '当前无含 ensemble 的结构（试试 load 1D3Z）', en: 'No structure with an ensemble (try load 1D3Z)' }))
  }

  if (cmd === 'measure' || cmd === 'dist') {
    // measure dist|angle|dihedral (选择A) (选择B) […] —— 选择表达式测量（命令行 / AI 助手 / 面板点击三种入口共用 measurements 存储）
    if ((parts[1] ?? '').toLowerCase() === 'clear' || (parts[1] ?? '').toLowerCase() === 'off') {
      useMolStore.getState().clearMeasurements()
      return ok(tt({ zh: '已清除全部测量标注', en: 'All measurement annotations cleared' }))
    }
    const MEASURE_MODES: Record<string, 'distance' | 'angle' | 'dihedral'> = {
      dist: 'distance', distance: 'distance',
      angle: 'angle', ang: 'angle',
      dihedral: 'dihedral', torsion: 'dihedral', dihe: 'dihedral',
    }
    const parenStart = input.indexOf('(')
    const headTok = ((parenStart >= 0 ? input.slice(0, parenStart) : input).trim().split(/\s+/)[1] ?? '').toLowerCase()
    if (parenStart < 0 || (headTok && !MEASURE_MODES[headTok])) {
      return err(tt({ zh: '用法：measure dist|angle|dihedral (选择A) (选择B) [(选择C) (选择D)] 或 measure clear。例：measure dist (resn HEM) (within 5 of resn HEM and protein)', en: 'Usage: measure dist|angle|dihedral (selection A) (selection B) [(selection C) (selection D)], or measure clear. E.g. measure dist (resn HEM) (within 5 of resn HEM and protein)' }))
    }
    const mode = MEASURE_MODES[headTok] ?? 'distance'
    const need = mode === 'distance' ? 2 : mode === 'angle' ? 3 : 4
    // 顶层括号组切分（组间只允许空白）
    const groups: string[] = []
    let depth = 0, cur = '', topJunk = ''
    for (const ch of input.slice(parenStart)) {
      if (ch === '(') { depth++; if (depth === 1) { cur = ''; continue } }
      else if (ch === ')') {
        depth--
        if (depth === 0) { groups.push(cur.trim()); continue }
        if (depth < 0) return err(tt({ zh: '括号不匹配', en: 'Unbalanced parentheses' }))
      }
      if (depth >= 1) cur += ch
      else if (depth === 0 && ch.trim()) topJunk += ch
    }
    if (depth !== 0) return err(tt({ zh: '括号不匹配', en: 'Unbalanced parentheses' }))
    if (topJunk.trim()) {
      // PyMOL 宽容：组间仅逗号+空白时静默容忍（measure dist (A), (B) 习惯写法）
      if (!/^[\s,]+$/.test(topJunk)) return err(tt({ zh: `括号组之间存在多余内容「${topJunk.trim()}」——每个选择用一对括号包裹`, en: `Extra content "${topJunk.trim()}" between parenthesized groups — wrap each selection in its own parentheses` }))
    }
    if (groups.length !== need) {
      return err(tt({ zh: `${mode === 'distance' ? '距离' : mode === 'angle' ? '角度' : '二面角'}测量需要 ${need} 个选择（括号组），当前 ${groups.length} 个`, en: `${mode === 'distance' ? 'Distance' : mode === 'angle' ? 'Angle' : 'Dihedral'} measurement needs ${need} selections (parenthesized groups), got ${groups.length}` }))
    }
    const sMeas = useMolStore.getState()
    if (!sMeas.activeId) return err(tt({ zh: '没有加载结构（测量作用于活动结构）', en: 'No structure loaded (measurements act on the active structure)' }))
    const dataMeas = dataRegistry.get(sMeas.activeId)
    if (!dataMeas) return err(tt({ zh: '结构数据不存在', en: 'Structure data not found' }))
    const namedMeas = buildNamedMasks(sMeas.activeId, dataMeas)
    const P = dataMeas.atoms.positions
    // 各组求值 → 原子索引
    const idxPerGroup: number[] = []
    const countPerGroup: number[] = []
    for (const g of groups) {
      const r = evaluateSelection(g, { structure: dataMeas, named: namedMeas })
      if (r.error) return err(tt({ zh: `选择错误: ${r.error}（"${g}"）`, en: `Selection error: ${r.error} ("${g}")` }))
      if (!r.count) return err(tt({ zh: `选择 "${g}" 命中 0 个原子`, en: `Selection "${g}" matched 0 atoms` }))
      // r63-fix-c #6：40000 护栏先于展开转换（>10 万原子时 push(...arr) 触发 RangeError 栈溢出）；
      // 累计口径不变——旧版 push 后查 idxPerGroup.length，等价于转换前的「已累计 + 本组 r.count」
      if (idxPerGroup.length + r.count > 40000) return err(tt({ zh: '选择过大（>4万原子），请缩小范围后测量', en: 'Selection too large (>40k atoms) — narrow the scope before measuring' }))
      for (const i of maskToIndices(r.mask)) idxPerGroup.push(i)
      countPerGroup.push(r.count)
    }
    // 每组代表原子：单原子直接用；多原子取质心最近原子（距离模式取两组间最近原子对）
    const centroidNearest = (from: number, to: number): number => {
      const idxs = idxPerGroup.slice(from, to)
      if (idxs.length === 1) return idxs[0]
      let cx = 0, cy = 0, cz = 0
      for (const i of idxs) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2] }
      cx /= idxs.length; cy /= idxs.length; cz /= idxs.length
      let best = Infinity, bi = idxs[0]
      for (const i of idxs) {
        const d = (cx - P[i * 3]) ** 2 + (cy - P[i * 3 + 1]) ** 2 + (cz - P[i * 3 + 2]) ** 2
        if (d < best) { best = d; bi = i }
      }
      return bi
    }
    const groupStarts: number[] = []
    { let acc = 0; for (const c of countPerGroup) { groupStarts.push(acc); acc += c } }
    let selIdx: number[]
    let value: number
    const atomDesc = (i: number) => {
      const ch2 = (dataMeas.atoms.chainIds[i] ?? '?').trim() || '?'
      return `${ch2}/${dataMeas.atoms.resNames[i]}${dataMeas.atoms.resSeqs[i]}/${dataMeas.atoms.names[i]}`
    }
    if (mode === 'distance') {
      const idxA = idxPerGroup.slice(0, countPerGroup[0])
      const idxB = idxPerGroup.slice(groupStarts[1])
      if (idxA.length * idxB.length > 30_000_000) return err(tt({ zh: '两个选择过大（>3000万原子对），请缩小范围', en: 'The two selections are too large (>30M atom pairs) — narrow the scope' }))
      let best = Infinity, bi = idxA[0], bj = idxB[0]
      for (const i of idxA) {
        const ax = P[i * 3], ay = P[i * 3 + 1], az = P[i * 3 + 2]
        for (const j of idxB) {
          const d = (ax - P[j * 3]) ** 2 + (ay - P[j * 3 + 1]) ** 2 + (az - P[j * 3 + 2]) ** 2
          if (d < best) { best = d; bi = i; bj = j }
        }
      }
      value = Math.sqrt(best)
      selIdx = [bi, bj]
      ok(tt({ zh: `距离 ${value.toFixed(2)} Å：${atomDesc(bi)} — ${atomDesc(bj)}${countPerGroup.some(c => c > 1) ? '（多原子选择取最近原子对）' : ''}`, en: `Distance ${value.toFixed(2)} Å: ${atomDesc(bi)} — ${atomDesc(bj)}${countPerGroup.some(c => c > 1) ? ' (nearest atom pair for multi-atom selections)' : ''}` }))
    } else {
      // 角度/二面角：每组取质心最近原子
      selIdx = groupStarts.map((st, gi) => centroidNearest(st, st + countPerGroup[gi]))
      const pos = selIdx.map(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]])
      if (mode === 'angle') {
        const [a, b, c] = pos
        const v1 = [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
        const v2 = [c[0] - b[0], c[1] - b[1], c[2] - b[2]]
        const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]
        const n1 = Math.hypot(...v1), n2 = Math.hypot(...v2)
        value = Math.acos(Math.max(-1, Math.min(1, dot / (n1 * n2)))) * 180 / Math.PI
        ok(tt({ zh: `键角 ${value.toFixed(1)}°：${atomDesc(selIdx[0])} — ${atomDesc(selIdx[1])} — ${atomDesc(selIdx[2])}${countPerGroup.some(c => c > 1) ? '（多原子选择取质心最近原子）' : ''}`, en: `Bond angle ${value.toFixed(1)}°: ${atomDesc(selIdx[0])} — ${atomDesc(selIdx[1])} — ${atomDesc(selIdx[2])}${countPerGroup.some(c => c > 1) ? ' (centroid-nearest atom for multi-atom selections)' : ''}` }))
      } else {
        const b1 = [pos[1][0] - pos[0][0], pos[1][1] - pos[0][1], pos[1][2] - pos[0][2]]
        const b2 = [pos[2][0] - pos[1][0], pos[2][1] - pos[1][1], pos[2][2] - pos[1][2]]
        const b3 = [pos[3][0] - pos[2][0], pos[3][1] - pos[2][1], pos[3][2] - pos[2][2]]
        const n1 = [b1[1] * b2[2] - b1[2] * b2[1], b1[2] * b2[0] - b1[0] * b2[2], b1[0] * b2[1] - b1[1] * b2[0]]
        const n2 = [b2[1] * b3[2] - b2[2] * b3[1], b2[2] * b3[0] - b2[0] * b3[2], b2[0] * b3[1] - b2[1] * b3[0]]
        const m = [b2[1] * n1[2] - b2[2] * n1[1], b2[2] * n1[0] - b2[0] * n1[2], b2[0] * n1[1] - b2[1] * n1[0]]
        const x = n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]
        const y = m[0] * n2[0] + m[1] * n2[1] + m[2] * n2[2]
        value = Math.atan2(y, x) * 180 / Math.PI
        ok(tt({ zh: `二面角 ${value.toFixed(1)}°：${selIdx.map(atomDesc).join(' — ')}${countPerGroup.some(c => c > 1) ? '（多原子选择取质心最近原子）' : ''}`, en: `Dihedral ${value.toFixed(1)}°: ${selIdx.map(atomDesc).join(' — ')}${countPerGroup.some(c => c > 1) ? ' (centroid-nearest atom for multi-atom selections)' : ''}` }))
      }
    }
    useMolStore.setState(st => ({
      measurements: [...st.measurements, {
        id: Math.random().toString(36).slice(2, 10),
        structureId: st.activeId!,
        type: mode,
        atoms: selIdx,
        value,
      }],
      visualRev: st.visualRev + 1,
    }))
    return ok(tt({ zh: '已添加 3D 测量标注（测量面板可查看/删除全部测量）', en: '3D measurement annotation added (view/delete all measurements in the measurement panel)' }))
  }

  err(tt({ zh: `未知命令 "${parts[0]}"。输入 help 查看可用命令。`, en: `Unknown command "${parts[0]}". Type help to list available commands.` }))
}
