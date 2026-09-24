'use client'

// 帮助对话框：快捷键、鼠标操作、快速上手
import type { ReactNode } from 'react'
import { MousePointer2, Keyboard, Lightbulb, FlaskConical, Wand2, GraduationCap, FolderOpen } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { useI18n, type DualText } from '@/i18n'

/** 快捷键胶囊统一规格（border-border bg-muted px-1.5 mono 10px，最小宽度保证短键不塌陷） */
function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn(
      'inline-flex min-w-[28px] shrink-0 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[10px]',
      className,
    )}>
      {children}
    </kbd>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 长帮助文案双语组织：段落拆成「文段」序列，每段自带 zh/en 与样式标记
// （命令记号胶囊 / 前景加粗 / 弱化说明 / 键帽）。渲染时逐段 t()——两语言共享
// 同一结构与标记，零重复 JSX；命令示例与键位记号不译（zh == en）。
/** 文段：code=命令记号胶囊 · strong=前景加粗 · dim=弱化说明 · kbd=键帽 */
interface Seg {
  zh: string
  en: string
  code?: boolean
  strong?: boolean
  dim?: boolean
  kbd?: boolean
}
/** 普通文本段 */
const T = (zh: string, en: string): Seg => ({ zh, en })
/** 命令记号段（命令本身不译，两语言同文） */
const C = (cmd: string): Seg => ({ zh: cmd, en: cmd, code: true })
/** 需要翻译的命令记号段（如内嵌中文示例书签名） */
const C2 = (zh: string, en: string): Seg => ({ zh, en, code: true })
/** 键帽段（键位记号不译） */
const K = (key: string): Seg => ({ zh: key, en: key, kbd: true })
/** 前景加粗强调段 */
const S = (zh: string, en: string): Seg => ({ zh, en, strong: true })
/** 弱化说明段 */
const D = (zh: string, en: string): Seg => ({ zh, en, dim: true })

/** 按文段样式渲染一段内联内容（命令胶囊 / 加粗 / 弱化 / 键帽与原标记一致） */
function Segs({ segs }: { segs: Seg[] }) {
  const { t } = useI18n()
  return (
    <>
      {segs.map((g, i) => {
        if (g.kbd) return <Kbd key={i}>{g.zh}</Kbd>
        const text = t(g)
        if (g.code) return <code key={i} className="rounded bg-muted px-1 font-mono text-[10px]">{text}</code>
        if (g.strong) return <span key={i} className="font-semibold text-foreground">{text}</span>
        if (g.dim) return <span key={i} className="text-foreground/70">{text}</span>
        return text
      })}
    </>
  )
}

const SHORTCUTS: [string, DualText][] = [
  ['1 – 9', { zh: '快速切换风格预设（6 = 结合口袋，7 = 出版级互作，9 = Putty B 因子管）', en: 'Quickly switch style presets (6 = binding pocket, 7 = publication-grade interactions, 9 = Putty B-factor tubes)' }],
  ['F', { zh: '适配视图（缩放到结构）', en: 'Fit view (zoom to the structure)' }],
  ['S', { zh: '自动旋转 开/关', en: 'Auto-rotate on/off' }],
  ['R', { zh: '相机摇摆 开/关（±26°）', en: 'Camera rock on/off (±26°)' }],
  ['H', { zh: '显示/隐藏氢原子', en: 'Show/hide hydrogen atoms' }],
  ['W', { zh: '显示/隐藏水分子', en: 'Show/hide water molecules' }],
  ['B', { zh: '氢键网络 开/关', en: 'H-bond network on/off' }],
  ['P', { zh: 'NMR 构象动画 播放/暂停', en: 'NMR ensemble animation play/pause' }],
  ['L', { zh: '为当前选择添加原子标注', en: 'Add atom labels to the current selection' }],
  ['V', { zh: '保存当前视角为书签（带缩略图）', en: 'Save the current view as a bookmark (with thumbnail)' }],
  ['Shift + 1-9', { zh: '平滑跳转到视角书签', en: 'Smoothly jump to a view bookmark' }],
  ['→ / ←', { zh: '演示引导中：下一步 / 上一步', en: 'During a guided tour: next / previous step' }],
  ['` / ~', { zh: '打开/关闭命令行', en: 'Open/close the command line' }],
  ['Ctrl + K', { zh: '命令面板：搜索全部命令/最近使用/置顶/结构切换（Enter 执行 · Tab 填入命令行编辑）', en: 'Command palette: search all commands / recent / pinned / structure switching (Enter to run · Tab to fill the command line for editing)' }],
  ['Ctrl + R', { zh: '命令行内反向搜索历史（再按循环下一条，Esc 取出编辑）', en: 'Reverse history search in the command line (press again to cycle; Esc pulls it out for editing)' }],
  ['Esc', { zh: '退出测量 / 清除选择 / 结束演示 / 停止 movie / 关闭时间轴', en: 'Exit measurement / clear selection / end tour / stop movie / close the timeline' }],
  ['Delete', { zh: '清除当前选择', en: 'Clear the current selection' }],
]

const MOUSE: [DualText, DualText][] = [
  [{ zh: '左键拖动', en: 'Left-drag' }, { zh: '旋转视角', en: 'Rotate the view' }],
  [{ zh: '滚轮', en: 'Scroll wheel' }, { zh: '缩放', en: 'Zoom' }],
  [{ zh: '右键拖动', en: 'Right-drag' }, { zh: '平移', en: 'Pan' }],
  [{ zh: 'Ctrl+拖动', en: 'Ctrl+drag' }, { zh: '框选（橡胶带：框内可见残基整体选中，不旋转）', en: 'Rubber-band box selection (visible residues inside the box are selected whole; the view does not rotate)' }],
  [{ zh: 'Ctrl+Shift+拖动', en: 'Ctrl+Shift+drag' }, { zh: '框选追加到当前选择', en: 'Box-select and add to the current selection' }],
  [{ zh: 'Ctrl+Alt+拖动', en: 'Ctrl+Alt+drag' }, { zh: '框选从当前选择移除', en: 'Box-select and remove from the current selection' }],
  [{ zh: '单击', en: 'Click' }, { zh: '选择残基', en: 'Select a residue' }],
  [{ zh: 'Ctrl + 单击', en: 'Ctrl + click' }, { zh: '选择单个原子', en: 'Select a single atom' }],
  [{ zh: 'Shift + 单击', en: 'Shift + click' }, { zh: '追加选择', en: 'Add to the selection' }],
  [{ zh: 'Alt + 单击', en: 'Alt + click' }, { zh: '从选择中移除', en: 'Remove from the selection' }],
  [{ zh: '双击', en: 'Double-click' }, { zh: '聚焦残基', en: 'Focus on a residue' }],
  [{ zh: '右键', en: 'Right-click' }, { zh: '上下文菜单（原子/残基/链/同类残基/周围环境 5Å/测距/标注）', en: 'Context menu (atom / residue / chain / same-type residues / 5 Å surroundings / measure distance / label)' }],
]

/** PyMOL → MolVision 习惯迁移速查（PyMOL 老用户零成本上手） */
const PYMOL_MAP: [DualText | string, string, DualText][] = [
  ['select / sele', 'select site = within 5 of resn HEM', { zh: '选择语法同源：chain/resi/resn/name/elem + and or not；sele = 当前选择；命名选择同 PyMOL 对象语义', en: 'Same selection syntax: chain/resi/resn/name/elem + and or not; sele = the current selection; named selections behave like PyMOL objects' }],
  ['show / hide', 'show ballstick, ligand · hide cartoon', { zh: '逗号语法完全兼容；reps 面板同步可视编辑', en: 'Comma syntax fully compatible; the reps panel mirrors it for visual editing' }],
  ['color / spectrum', 'color element, ligand · spectrum b, rainbow', { zh: 'spectrum 连续渐变；color pocket = 配体距离渐变（本工具特色）', en: 'spectrum gives continuous gradients; color pocket = distance-from-ligand gradient (a MolVision specialty)' }],
  ['zoom / orient', 'zoom ligand, 5 · orient', { zh: 'zoom 不改写当前选择（与 PyMOL 一致）；带缓冲距离参数', en: 'zoom does not rewrite the current selection (as in PyMOL); accepts a buffer distance' }],
  ['iterate / alter', 'iterate (name CA), resn resi b · alter (resi 1-10), b=b+5', { zh: '属性查看/修改（b/q/name）；输出到命令行面板', en: 'Inspect / modify properties (b/q/name); output goes to the console panel' }],
  ['util.*', 'util cbc · util cbss · util cbaw', { zh: 'cbc 链色 / cbss SS 卡通 / cbao 元素+AO / cbaw 白碳论文图', en: 'cbc chain colors / cbss SS cartoons / cbao element + AO / cbaw white-carbon paper figures' }],
  ['byres / in / like', 'byres(within 5 of ligand) · name CA in chain A', { zh: '残基扩展与集合算子同源；bychain/byobject 同可用', en: 'Residue expansion and set operators work the same; bychain/byobject are also available' }],
  [{ zh: 'ss / b / q 谓词', en: 'ss / b / q predicates' }, 'ss h+s · b > 50 · q > 0.5', { zh: '二级结构/B 因子/占据率比较选择', en: 'Secondary-structure / B-factor / occupancy comparison selections' }],
  ['show cell', 'show cell · symmetry 25', { zh: '晶胞盒（a红 b绿 c蓝）+ 晶格邻居克隆', en: 'Unit-cell box (a red, b green, c blue) + cloned lattice neighbors' }],
  ['distance', 'measure dist (resn HEM) (resi 93)', { zh: 'PyMOL distance 命令在本工具为 measure（逗号/空格分隔皆可）', en: 'PyMOL’s distance command is measure here (comma or space separated)' }],
  ['get_view / set_view', 'get_view · set_view {…}', { zh: '视角 JSON 导出/恢复，格式更丰富（含 up/fov）', en: 'Export / restore the view as JSON, with a richer format (including up/fov)' }],
  ['session', 'session save · session export', { zh: '会话存档（自动）/ .molvision 文件导出导入', en: 'Session autosave / .molvision file export & import' }],
  ['ray / png', 'ray 1920 · png 2', { zh: 'ray 真超采样软阴影静帧；png 截屏倍率', en: 'ray renders true supersampled soft-shadow stills; png sets the screenshot multiplier' }],
]

/** ChimeraX → MolVision 习惯迁移速查（双软件语法并轨） */
const CHIMERAX_MAP: [DualText | string, string, DualText][] = [
  ['open / close', 'open 4hhb · close', { zh: '加载=load · 关闭同义（open 直接可用）', en: 'Loading = load · close is a synonym (open works directly)' }],
  [{ zh: '说明符 /A :42 :HEM @CA #1', en: 'Specifiers /A :42 :HEM @CA #1' }, 'select /A:42@CA · show ballstick :HEM zone 5', { zh: '链/残基号/残基名/原子/模型五记号，拼接即交集；zone N = 邻域（within）', en: 'Five specifiers — chain / residue number / residue name / atom / model — concatenated as an intersection; zone N = neighborhood (within)' }],
  [{ zh: '& | ~ 取反', en: '& | ~ negation' }, 'select :HEM & /A · ~display cartoon · ~:HEM', { zh: '与/或/非与命令取反前缀均支持', en: 'And / or / not, plus command-negation prefixes, are all supported' }],
  ['show atoms|stick|ribbon', 'show atoms, :HEM · show ribbon · hide surfaces', { zh: 'ChimeraX 表示名全兼容（atoms→球棍 · ribbon→cartoon · surfaces→表面）', en: 'ChimeraX representation names fully compatible (atoms→ball-stick · ribbon→cartoon · surfaces→surface)' }],
  [{ zh: 'color byX 双词', en: 'color byX two-word form' }, 'color bychain · color byelement, :HEM · color rainbow', { zh: 'bychain/byelement/byresidue/byhet/rainbow 全部可用', en: 'bychain/byelement/byresidue/byhet/rainbow are all available' }],
  [{ zh: 'focus / zoom <倍率>', en: 'focus / zoom <factor>' }, 'focus :HEM · zoom 2', { zh: 'focus=聚焦适配 · zoom 纯数字=倍率语义（zoom 2 放大两倍）', en: 'focus = fit to view · a bare zoom number means magnification (zoom 2 doubles the scale)' }],
  ['rotate / translate', 'rotate y 30 · translate z -10', { zh: 'turn/move 同义词（ChimeraX 习惯直接用）', en: 'turn/move synonyms (ChimeraX habits work directly)' }],
  ['presets', 'presets interactive · presets publication', { zh: '交互预设/出版预设一键切换', en: 'One-click switching between interactive and publication presets' }],
  ['set bgColor / silhouettes', 'set bgColor black · set silhouettes true', { zh: '背景色/轮廓线（ChimeraX 键名直通）', en: 'Background color / silhouettes (ChimeraX key names pass straight through)' }],
  ['transparency', 'transparency 0.6', { zh: '透明度（ChimeraX 0-1 语义）', en: 'Transparency (ChimeraX 0–1 semantics)' }],
  ['select add|subtract', 'select add :42 · select subtract :HEM', { zh: '选择修饰动词（追加/移除）', en: 'Selection modifier verbs (add / remove)' }],
  ['measure distance', 'measure distance @CA :42', { zh: '无括号形式自动包装（PyMOL 括号形式同样支持）', en: 'The parenthesis-free form is wrapped automatically (the PyMOL parenthesized form also works)' }],
  ['save image', 'save image', { zh: '截图导出 PNG（= png 2）', en: 'Screenshot export as PNG (= png 2)' }],
  ['sel / zone', 'color red sel · select zone 5', { zh: '当前选择 sel（PyMOL sele 同义）· zone 扩展当前选择', en: 'sel = the current selection (synonym of PyMOL sele) · zone expands the current selection' }],
]

/** 快速上手六步（每条为文段序列） */
const QUICK_START: Seg[][] = [
  [T('顶部输入 PDB 编号（如 ', 'Enter a PDB ID at the top (e.g. '), C('4HHB'), T('）加载结构，或拖入本地文件；空状态下也可点击一键示例', ') to load a structure, or drop in a local file; one-click examples are also available in the empty state')],
  [T('用「风格预设」一键切换 Cartoon / 球棍 / 空间填充 / 表面 / 出版级互作（7）', 'Use style presets to switch in one click between Cartoon / ball-stick / spacefill / surface / publication-grade interactions (7)')],
  [T('点击 3D 视图中的残基进行选择，在左侧面板调颜色与表示法', 'Click residues in the 3D view to make selections; tune color and representation in the left panel')],
  [T('工具栏切换测量模式，点击原子测量距离 / 角度 / 二面角', 'Switch to a measurement mode from the toolbar and click atoms to measure distance / angle / dihedral')],
  [T('按 ', 'Press '), K('`'), T(' 打开命令行，像 PyMOL 一样工作；', ' to open the command line and work the PyMOL way; '), S('Tab 智能补全', 'Tab smart completion'), T('——命令名/子命令/结构名/表示法/颜色/选择关键字全部可补全，↑↓ 切换候选，输入时实时显示参数用法提示', ' — command names / subcommands / structure names / representations / colors / selection keywords are all completable; ↑↓ cycles candidates and usage hints appear live as you type')],
  [T('按 ', 'Press '), K('Ctrl+K'), T(' 打开命令面板——搜索即执行：全部命令（带示例）、最近使用、置顶常用、多结构切换一键直达，无需记命令', ' to open the command palette — search and run: all commands (with examples), recent, pinned, and one-click structure switching — no need to memorize commands')],
]

/** 演示引导提示段 */
const TOUR_NOTE: Seg[] = [
  T('初次使用？工具栏「演示」菜单提供 6 个引导式场景（快速上手 / 药物靶点 / 晶体学验证 / NMR 动力学 / 抗体-抗原 / 核酸），逐步自动操作并讲解，或命令行 ', 'New here? The toolbar “Tours” menu offers 6 guided scenes (quick start / drug target / crystallographic validation / NMR dynamics / antibody–antigen / nucleic acids) that operate and narrate step by step — or run '),
  C('tour quickstart'),
  T('。', ' in the command line.'),
]

/** 结构分析与晶体学段落 */
const ANALYSIS: Seg[][] = [
  // 视角书签
  [
    S('视角书签', 'View bookmarks'),
    T('：快捷键 ', ': the '),
    C('V'),
    T(' 或视口右缘「保存视角」把当前相机状态存为书签（带视口缩略图），', ' shortcut or the “Save view” chip at the right edge of the viewport stores the current camera state as a bookmark (with a viewport thumbnail); '),
    C2('Shift+数字', 'Shift+number'),
    T(' / 点击缩略图平滑过渡跳转；命令行 ', ' / click a thumbnail to glide there; on the command line: '),
    C2('view save 口袋', 'view save pocket'),
    T('、', ', '),
    C('view 2'),
    T('、', ', '),
    C('view del 2'),
    T('；书签独立持久化（清空结构不清空，刷新后仍在），双击名称可重命名，导出 .molvision 会话文件时随文件携带（导入自动还原）。', '; bookmarks persist on their own (clearing structures leaves them intact, and they survive a reload), double-click a name to rename, and they travel inside exported .molvision session files (restored automatically on import).'),
  ],
  // 叠合
  [
    S('叠合', 'Superposition'),
    T('：结构卡片「叠合」按钮或「叠合 (matchmaker)」面板，支持手动指定链对（', ': the “Superpose” button on a structure card or the “Superpose (matchmaker)” panel supports manually specified chain pairs ('),
    C('superpose 4HHB onto 1A3N chain A to A'),
    T('）；', '); '),
    C('untransform'),
    T(' 撤销；多结构同屏时 ', ' undoes it; with several structures on screen, '),
    C('activate 1BQL'),
    T(' 切换活动结构（show/hide/color 命令的作用对象）。', ' switches the active structure (the target that show/hide/color commands act on).'),
  ],
  // 电子密度
  [
    S('电子密度', 'Electron density'),
    T('：', ': '),
    C('map fetch 3ekj'),
    T(' 从 RCSB 结构因子实时合成 2Fo−Fc 图（模型相位 + 3D FFT，Web Worker 零阻塞）；', ' synthesizes a 2Fo−Fc map on the fly from RCSB structure factors (model phases + 3D FFT, zero blocking in a Web Worker); '),
    C('map fofc 3ekj'),
    T(' 合成 Fo−Fc 差图（正绿/负红双等值面：绿峰=密度有而模型缺、红峰=模型有而密度无）——', ' builds the Fo−Fc difference map (positive-green / negative-red dual isosurfaces: green peaks = density without model, red peaks = model without density) — '),
    D('结构未加载时会自动从 RCSB 获取作为相位模型', 'if the structure is not loaded yet it is fetched from RCSB automatically to supply phases'),
    T('；', '; '),
    C('map isolevel 1.5'),
    T(' 同时调正负峰，差图可 ', ' adjusts both peaks at once; the difference map also accepts '),
    C('map isolevel pos 3 / neg 2.5'),
    T(' 独立调级（面板双滑块同效）；也可拖入 .ccp4/.mrc 文件；密度图面板（左侧「密度图」标签）可视化等值面/网格；σ/模式/颜色随会话保存，刷新自动重算恢复（会话缺结构时同样自动补拉）；加载密度图后，视口左下角出现 σ 控制卡（差图正/负峰双滑块 + 模式切换 + 可见性），视线不离结构即可调级（与面板滑块等效）。', ' for independent levels (same as the panel’s dual sliders); .ccp4/.mrc files can be dropped in as well; the density panel (the “Density” tab at the left) visualizes isosurfaces and meshes; σ / mode / colors are saved with the session and recomputed on reload (auto-fetching again if the session lacks the structure); once a map is loaded, a σ control card appears at the lower-left of the viewport (dual positive/negative sliders for the difference map + mode toggle + visibility) so levels can be tuned without looking away from the structure (equivalent to the panel sliders).'),
  ],
  // B 因子分析
  [
    S('B 因子分析', 'B-factor analysis'),
    T('：', ': '),
    C('preset putty'),
    T(' 或快捷键 9——Putty 管径随 B 因子连续变化（粗=柔性/高 B、细=刚性/低 B）配 B 因子彩虹渐变，蛋白（CA）与核酸（磷酸骨架）统一映射；', ' or shortcut 9 — Putty tube radius varies continuously with the B-factor (thick = flexible / high B, thin = rigid / low B) paired with a B-factor rainbow gradient, mapped uniformly for proteins (CA) and nucleic acids (phosphate backbone); '),
    C('color bfactor'),
    T(' 同款色标；视口左下角自动显示颜色标尺图例（B 值→颜色→管径三联映射）。', ' uses the same color scale; a color-scale legend (B-value → color → tube radius) appears automatically at the lower-left of the viewport.'),
  ],
  // 对称伴侣
  [
    S('对称伴侣', 'Symmetric mates'),
    T('：结构面板「对称伴侣」区块或 ', ': the “Symmetric mates” block in the structure panel, or '),
    C('symmetry 20'),
    T('，按 CRYST1 空间群（65 手性群全覆盖）生成晶格邻居。', ', generates lattice neighbors from the CRYST1 space group (all 65 chiral groups covered).'),
  ],
  // 界面接触
  [
    S('界面接触', 'Interface contacts'),
    T('：', ': '),
    C('contacts chain A | chain B'),
    T(' 或 ', ' or '),
    C('interface A B'),
    T('——残基对连线 + 2D 图谱 + ΔSASA 埋藏面积；分析面板另有可交互的', ' — residue-pair lines + a 2D diagram + ΔSASA buried area; the analysis panel also offers an interactive '),
    S('「接触残基对」表格', '“Contact residue pairs” table'),
    T('：按距离/接触数排序、关键字筛选，', ': sort by distance or contact count, filter by keyword, '),
    S('点击行即选中该残基对并相机聚焦', 'click a row to select that pair and focus the camera on it'),
    T('（口袋逐对巡检利器）。', ' (ideal for walking through a pocket pair by pair).'),
  ],
  // 跨结构接触与埋藏面积
  [
    S('跨结构接触与埋藏面积', 'Cross-structure contacts & buried area'),
    T('：superpose 后用 ', ': after superposing, use '),
    C('xcontacts 1UBQ:chain A | 1D3Z:chain A'),
    T(' 检测复合物界面，再 ', ' to detect the complex interface, then '),
    C('xbsa'),
    T(' 把两结构原子拼成联合坐标集做三路 SASA——游离构象视角的界面埋藏面积，面板可分别选择两侧核心残基。', ' to pool both structures’ atoms into a joint coordinate set for three-way SASA — the interface buried area from the free-conformation perspective; the panel can select core residues on either side.'),
  ],
  // SASA / DSSP
  [
    S('SASA / DSSP', 'SASA / DSSP'),
    T('：', ': '),
    C('sasa'),
    T(' 溶剂可及面积（可 ', ' computes solvent-accessible surface area (optionally with '),
    C('color sasa'),
    T(' 暴露度着色）；', ' exposure coloring); '),
    C('dssp'),
    T(' 重算二级结构。', ' recomputes secondary structure.'),
  ],
  // 对象工作流
  [
    S('对象工作流', 'Object workflows'),
    T('：', ': '),
    C('create pocket = within 5 of resn HEM'),
    T(' 把选择提升为独立对象；', ' promotes a selection into a standalone object; '),
    C('split_chains'),
    T(' 按链拆分；', ' splits by chain; '),
    C('save out.pdb chain A'),
    T(' 导出坐标。', ' exports coordinates.'),
  ],
  // 配体工作流
  [
    S('配体工作流', 'Ligand workflows'),
    T('：点击配体 → ', ': click a ligand → '),
    S('选中整个分子', 'the entire molecule is selected'),
    T('（连通分量：多残基配体如多糖/肽类抑制剂合并为一，同链其它分子互不波及）；结构面板配体行按分子精确选择、双击聚焦；「口袋」一键选中该配体 4.5Å 结合位点（', ' (connected component: multi-residue ligands such as glycans or peptide inhibitors merge into one, while other molecules in the same chain stay untouched); ligand rows in the structure panel select exactly per molecule, double-click to focus; “Pocket” selects the ligand’s 4.5 Å binding site in one click ('),
    C('byres (within 4.5 of resn HEM)'),
    T('）；序列条底部配体行可逐个分子选择/聚焦；右键菜单「选择此分子」/「周围环境」从任意原子出发。', '); ligand rows at the bottom of the sequence bar select/focus molecule by molecule; the right-click menu’s “Select this molecule” / “Surroundings” work from any atom.'),
  ],
  // 序列条视口聚焦
  [
    S('序列条视口聚焦', 'Sequence-bar viewport focus'),
    T('：序列条头部「聚焦」开关（默认开，', ': the “Focus” toggle in the sequence-bar header (on by default; '),
    C('set seq_focus off'),
    T(' 等价）——当前相机视野内的残基显示', ' is the equivalent) — residues within the current camera frustum get a '),
    S('绿色下划线', 'green underline'),
    T('、头部显示「N/M 在视野」计数、视野外配体淡化；旋转/缩放/切层实时同步（150ms 节流），长序列里快速定位当前观察区域。', ', the header shows an “N/M in view” count, and ligands outside the view are dimmed; rotate / zoom / slab operations sync live (150 ms throttle) — a fast way to locate the region you are viewing in long sequences.'),
  ],
]

/** 渲染与视图段落 */
const RENDER_VIEW: Seg[][] = [
  // 灯光
  [
    S('灯光', 'Lighting'),
    T('：场景面板「灯光与渲染」或 ', ': the “Lighting & rendering” block in the scene panel, or '),
    C('set ambient 0.5 / set direct 2 / set specular off'),
    T('（哑光论文图风格）。', ' (a matte, paper-figure look).'),
  ],
  // 立体
  [
    S('立体', 'Stereo'),
    T('：', ': '),
    C('stereo on'),
    T(' 红蓝立体（工具栏「立体」按钮）。', ' red-blue stereo (the “Stereo” toolbar button).'),
  ],
  // 坐标轴指示器
  [
    S('坐标轴指示器', 'Axes indicator'),
    T('：视口右上角朝向罗盘（X 红 / Y 绿 / Z 蓝，暗点为负方向）实时反映视角；', ': the orientation compass at the upper-right of the viewport (X red / Y green / Z blue; dim dots mark negative directions) mirrors the view in real time; '),
    S('悬停轴端发光高亮、点击平滑对齐视角', 'hover an axis tip for a glowing highlight, click to glide the view into alignment'),
    T('（保持目标点与距离）；场景面板或 ', ' (target point and distance preserved); the scene panel or '),
    C('axes off'),
    T(' 可关闭；红蓝立体模式下自动隐藏。', ' turns it off; it hides itself in red-blue stereo mode.'),
  ],
  // 视角
  [
    S('视角', 'View'),
    T('：', ': '),
    C('orient'),
    T(' 主轴对齐；', ' aligns to the principal axes; '),
    C('get_view'),
    T(' / ', ' / '),
    C('set_view'),
    T(' 视角导出恢复（JSON）；', ' export/restore the view (JSON); '),
    C('png 4'),
    T(' 导出 4× 截图。', ' exports a 4× snapshot.'),
  ],
  // Ray 级渲染
  [
    S('Ray 级渲染', 'Ray-quality rendering'),
    T('：', ': '),
    C('ray'),
    T(' 或工具栏相机菜单「Ray 级渲染」——PCF 软阴影 + 1.5× 内部超采样 + 场景自适应阴影相机，导出高清 PNG（对标 PyMOL ray；', ' or “Ray-quality render” in the toolbar camera menu — PCF soft shadows + 1.5× internal supersampling + a scene-adaptive shadow camera, exported as a high-resolution PNG (on par with PyMOL ray; '),
    C('ray 1920'),
    T(' 指定宽度）。异步执行：先弹进度提示再渲染，完成后 toast 报告尺寸与耗时并自动导出。', ' sets the width). It runs asynchronously: a progress notice appears first, then a toast reports the size and elapsed time and exports automatically.'),
  ],
  // 构象插值 morph
  [
    S('构象插值 morph', 'Conformation-interpolation morph'),
    T('：', ': '),
    C('morph m1 = 1BQL 2LYZ 40'),
    T('——两个同源结构间生成插值轨迹对象（自动链配对 + 残基对内原子名匹配 + 内存中叠合，不改动原结构），底部出现构象播放条，', ' — creates an interpolated trajectory object between two homologous structures (automatic chain pairing + atom-name matching within residue pairs + in-memory superposition, leaving the originals untouched); a conformation playback bar appears at the bottom, and '),
    C('ensemble play'),
    T(' 播放（P 暂停，fps/loop 可调）；同 PDB 不同构象则按恒等匹配直接插值。默认开启', ' plays it (P pauses; fps/loop adjustable); different conformations of the same PDB interpolate directly via identity matching. '),
    S('帧精修', 'Frame refinement'),
    T('（rigimol 风格：键长约束松弛 + 长程去碰撞，消除中间帧「橡皮筋抖动」与原子穿插）；加 ', ' (rigimol style: bond-length-constrained relaxation + long-range de-collision, eliminating the “rubber-band jitter” and atom clashes of intermediate frames) is on by default; add '),
    C('norefine'),
    T(' 保留纯插值。', ' to keep pure interpolation.'),
  ],
  // 多态 morph
  [
    S('多态 morph', 'Multi-state morph'),
    T('：', ': '),
    C('morph multi m = 1BQL 2LYZ 2VB1 60'),
    T('——3–8 个构象态过 Catmull-Rom 样条平滑插值（各态独立叠合到参考位姿，取全部匹配原子交集）；帧滑块可停在任意中间构象，徽章显示「多态 morph · N 态 · M 帧」；同样默认启用帧精修（支持 norefine）。', ' — smoothly interpolates 3–8 conformational states along a Catmull-Rom spline (each state superposed independently onto a reference pose, using the intersection of all matched atoms); the frame slider can park at any intermediate conformation, the badge reads “multi-state morph · N states · M frames”, and frame refinement is likewise on by default (norefine supported).'),
  ],
  // movie 时间轴编排
  [
    S('movie 时间轴编排', 'Movie timeline editing'),
    T('：工具栏 Film 按钮或 ', ': the Film button in the toolbar or '),
    C('movie edit'),
    T(' 打开底部时间轴面板——「同步书签」导入关键帧后可', ' opens the bottom timeline panel — once “Sync bookmarks” imports keyframes you can '),
    S('拖拽卡片排序', 'drag cards to reorder'),
    T('、逐段调时长（0.6–20s）、调轮数、「预览」查看机位；', ', tune each segment’s duration (0.6–20 s), set the loop count, and “Preview” camera positions; '),
    C('movie play'),
    T('（无秒数参数时）按时间轴逐段巡航，显式秒数则走统一时长模式；时间轴 localStorage 持久化。', ' (without a seconds argument) cruises segment by segment along the timeline, while an explicit number of seconds switches to a uniform-duration mode; the timeline persists via localStorage.'),
  ],
  // movie 录制
  [
    S('movie 录制', 'Movie recording'),
    T('：时间轴或 ', ': with the timeline or a '),
    C('movie play'),
    T(' 巡航时，先 ', ' cruise running, first '),
    C('record start'),
    T(' 再播放、结束 ', ', then play, and finish with '),
    C('record stop'),
    T('，把巡航录成 WebM 视频（对标 PyMOL movie + mpng 工作流）；顶部胶囊显示段进度，拖动/滚轮接管或 Esc 停止。', ' to record the cruise as a WebM video (the counterpart of the PyMOL movie + mpng workflow); a capsule at the top shows segment progress — drag or scroll to take over, Esc to stop.'),
  ],
  // 实用着色
  [
    S('实用着色', 'Utility colorings'),
    T('：', ': '),
    C('util cbc'),
    T(' 按链 · ', ' by chain · '),
    C('util cbaw'),
    T(' 元素+白碳（白底论文图） · ', ' element + white carbon (paper figures on a white background) · '),
    C('util ss'),
    T(' 二级结构。', ' by secondary structure.'),
  ],
  // 轮廓线
  [
    S('轮廓线（描边）', 'Outlines (silhouettes)'),
    T('：场景面板「轮廓线」区块或 ', ': the “Outline” block in the scene panel, or '),
    C('outline on 2 2.5'),
    T('（强度 0.2–3 / 粗细 1–4px）——Sobel 深度+亮度双信号检测边缘，为剪影与层叠结构描出出版级细线（线色随背景亮度自适应）；', ' (strength 0.2–3 / width 1–4 px) — edges are detected via a Sobel depth + luminance dual signal, tracing publication-grade thin lines around silhouettes and stacked structures (line color adapts to background brightness); '),
    C('ray'),
    T(' 静帧同样生效；与 GTAO 可叠加。', ' stills benefit as well; it stacks with GTAO.'),
  ],
  // 性能指示器
  [
    S('性能指示器', 'Performance HUD'),
    T('：', ': '),
    C('fps on'),
    T(' 或场景面板开关——状态栏实时显示帧率/绘制调用/三角形数（500ms 刷新，≥55 绿 · ≥30 琥珀 · <30 红，悬停看帧耗时与 GPU 资源数）；多结构大场景排查卡顿利器。', ' or the scene-panel toggle — the status bar shows live frame rate / draw calls / triangle counts (500 ms refresh; ≥55 green · ≥30 amber · <30 red; hover for frame times and GPU resource counts); the go-to tool for tracking down stalls in large multi-structure scenes.'),
  ],
  // 切层（slab）
  [
    S('切层（slab）', 'Slab (depth clipping)'),
    T('：', ': '),
    C('slab 20'),
    T(' 开启视向切层（仅显示沿视线厚度内的分子区域，中心默认在环绕目标处）；', ' enables view-axis slabbing (only the region of the molecule within the given thickness along the view axis is shown, centered on the orbit target by default); '),
    C('slab move -5'),
    T(' 沿视线推进切层穿过分子内部（正 = 远离相机）、', ' advances the slab through the interior along the view axis (positive = away from the camera), '),
    C('slab center'),
    T(' 回中、', ' re-centers, '),
    C('slab off'),
    T(' 关闭；场景面板「切层」区块同效（厚度/位置双滑块 + 回中按钮）。观察内部口袋、埋藏氢键与配体结合面的利器。', ' disables; the “Slab” block in the scene panel is equivalent (thickness/position dual sliders + a re-center button). The tool of choice for inspecting internal pockets, buried H-bonds, and ligand-binding faces.'),
  ],
  // 截面封盖（cap）
  [
    S('截面封盖（cap）', 'Slab caps'),
    T('：', ': '),
    C('slab cap'),
    T('（默认开，可接 on/off）——剖面以统一平面色填充呈', ' (on by default; accepts on/off) — cross-sections are filled with a uniform planar color so they read as '),
    S('实心', 'solid'),
    T('（出版级截面图；无封盖时剖面为开放式空壳）；', ' (publication-grade section images; without the cap, sections are open shells); '),
    C('set cap_color slate'),
    T(' 或场景面板色块自定义封盖色；对 cartoon/球棍/表面等实体表示全部生效，半透明表面不参与封盖。', ' or the scene-panel swatch customizes the cap color; it applies to all solid representations — cartoon / ball-stick / surface — while translucent surfaces do not take part.'),
  ],
  // 封盖深度明暗
  [
    S('封盖深度明暗', 'Cap depth shading'),
    T('：', ': '),
    C('set cap_shading off'),
    T('（默认开）——封盖色按视深由亮到暗渐变（远端明显加深），深剖面呈现', ' (on by default) — the cap color fades from bright to dark with view depth (the far side darkens noticeably), giving deep sections '),
    S('前后层次', 'front-to-back layering'),
    T('（四聚体堆叠/多链内部一眼可辨层次关系）；场景面板切层区块「深度明暗」开关同效。', ' (stacked tetramers / multi-chain interiors read at a glance); the “Depth shading” toggle in the scene panel’s Slab block does the same.'),
  ],
  // SVG 矢量导出
  [
    S('SVG 矢量导出', 'SVG vector export'),
    T('：', ': '),
    C('svg'),
    T(' 或工具栏相机菜单「SVG 矢量图」——CPU 侧投影当前视角为矢量原语（原子=圆、键=双色圆头线段、cartoon=平滑折线），画家算法按视深排序；颜色/选择/氢水过滤与 3D 视图完全一致，页脚自带结构名+原子数+日期署名；', ' or “SVG vector image” in the toolbar camera menu — the current view is projected into vector primitives on the CPU side (atoms = circles, bonds = two-tone round-capped segments, cartoon = smooth polylines), depth-sorted with the painter’s algorithm; colors / selections / hydrogen-water filtering match the 3D view exactly, and the footer signs the structure name + atom count + date; '),
    C('svg 2400'),
    T(' 指定宽度（高度按视口纵横比）。SVG 无限缩放不失真，可直接拖入 Illustrator / Inkscape 编辑入稿（表面表示为等值面几何，无原子级原语，导出时自动跳过并提示）。', ' sets the width (height follows the viewport aspect ratio). SVG scales infinitely without loss and can be dropped straight into Illustrator / Inkscape for publication editing (the surface representation is isosurface geometry with no atom-level primitives, so it is skipped automatically with a notice during export).'),
  ],
  // 自动性能模式
  [
    S('自动性能模式', 'Automatic performance mode'),
    T('：', ': '),
    C('perf on'),
    T('（默认开）——帧率持续偏低（<15 fps 约 3 秒）时自动关闭后处理并降低分辨率（像素比 ×0.6），帧率恢复后自动还原；降级时状态栏亮起琥珀色「性能」徽章；', ' (on by default) — when the frame rate stays low (below ~15 fps for about 3 s) post-processing is switched off and resolution is lowered automatically (pixel ratio ×0.6), reverting once the frame rate recovers; an amber “Performance” badge lights up in the status bar while degraded; '),
    C('perf status'),
    T(' 查看状态，', ' reports the state, '),
    C('perf off / perf restore'),
    T(' 手动干预；降级期间手动开启后处理会自动交还控制权。', ' for manual control; enabling post-processing by hand during a downgrade hands control back automatically.'),
  ],
  // 命令行补全
  [
    S('命令行补全', 'Command-line completion'),
    T('：输入时实时弹出候选（命令/子命令/结构名/表示法/颜色方案/选择关键字，带分类图标与说明），', ': candidates pop up live while typing (commands / subcommands / structure names / representations / color schemes / selection keywords, each with a category icon and description); '),
    C('Tab'),
    T(' 接受选中项、', ' accepts the highlighted item, '),
    C('↑↓'),
    T(' 切换（弹层开启时优先于历史）、', ' cycles (taking precedence over history while the popup is open), '),
    C('Esc'),
    T(' 关闭；识别到命令时上方显示用法提示（描述+示例）；', ' closes it; once a command is recognized, a usage hint (description + example) appears above; '),
    C('↑↓'),
    T(' 在无候选时浏览历史（最近 200 条跨会话保存）。', ' browses history when no candidates are showing (the last 200 entries persist across sessions).'),
  ],
  // 命令行历史搜索
  [
    S('命令行历史搜索', 'Command-line history search'),
    T('：', ': '),
    C('Ctrl+R'),
    T(' 进入反向搜索（输入即过滤，提示条预览当前匹配并高亮命中片段），再按 ', ' enters reverse search (typing filters instantly; the hint bar previews the current match with the hit highlighted); pressing '),
    C('Ctrl+R'),
    T(' 或 ', ' or '),
    C('↑↓'),
    T(' 循环下一条、', ' cycles to the next match, '),
    C('↵'),
    T(' 直接执行、', ' runs it outright, '),
    C('Esc'),
    T(' 取出到输入行编辑——快速重跑长命令（如 morph / superpose）不用重打。', ' pulls it into the input line for editing — rerun long commands (morph / superpose) without retyping.'),
  ],
  // 最近命令徽章
  [
    S('最近命令徽章', 'Recent command chips'),
    T('：控制台日志区下方的「最近」行展示去重后最近 6 条命令（跨会话持久保存，上限 200 条）——', ': the “Recent” row below the console log shows the last 6 deduplicated commands (persisted across sessions, capped at 200) — '),
    S('左键直接执行', 'click to run outright'),
    T('、', ', '),
    S('右键填入输入行', 'right-click to fill the input line'),
    T('修改参数再跑；行尾垃圾桶图标一键清空全部历史。', ' and rerun with edited parameters; the trash icon at the row’s end clears the whole history in one click.'),
  ],
  // 命令历史面板
  [
    S('命令历史面板', 'Command history panel'),
    T('：控制台头部「历史」按钮或 ', ': the “History” button in the console header or '),
    C('history'),
    T(' 打开——全量历史（新→旧）+ ', ' opens it — the full history (newest → oldest) plus '),
    S('关键词搜索', 'keyword search'),
    T('（Enter 直接执行首个匹配）+ ', ' (Enter runs the first match) plus '),
    S('星标置顶', 'starred pinning'),
    T('常用工作流（置顶区置顶展示、清空历史时保留）；每行可点击', ' for frequent workflows (pinned entries stay on top and survive a history clear); every row supports click-to-'),
    S('执行', 'run'),
    T('、铅笔', ', pencil-to-'),
    S('填入编辑', 'fill-and-edit'),
    T('、复制；与控制台箭头/Ctrl+R 实时同步（同一份 localStorage）。', ', and copy; it stays in sync with the console arrows / Ctrl+R in real time (one shared localStorage store).'),
  ],
  // 命令面板
  [
    S('命令面板（Ctrl+K）', 'Command palette (Ctrl+K)'),
    T('：工具栏「命令面板」按钮或快捷键——搜索即执行的统一入口：', ': the toolbar “Command palette” button or the shortcut — one unified search-and-run entry point: '),
    S('置顶/最近/结构切换/全部命令', 'Pinned / Recent / Structure switch / All commands'),
    T('四区分组展示；Enter 直接执行（条目内展示将执行的完整示例命令，无意外），Tab 把命令填入控制台继续带补全编辑；多结构场景下「切换到 4HHB」类条目一键切换活动结构。', ' in four grouped sections; Enter runs an entry directly (each entry previews the exact example command that will run — no surprises), Tab fills the command into the console for further completion-assisted editing; in multi-structure scenes, entries like “Switch to 4HHB” switch the active structure in one click.'),
  ],
  // 氢键网络
  [
    S('氢键网络', 'H-bond network'),
    T('：快捷键 ', ': the '),
    C('B'),
    T(' 或 ', ' shortcut or '),
    C('hbonds on 3.2'),
    T('——供体-受体虚线网络（N/O/S 几何判据：直接成键/1-3 共键邻居/同残基对均已排除）；默认只画虚线，开启「仅选择集」后附带端点小球便于追踪；状态栏徽章可一键关闭；分析面板同步生成', ' — a donor–acceptor dashed network (N/O/S geometric criteria: directly bonded atoms, 1-3 co-bonded neighbors, and same-residue pairs are all excluded); by default only dashes are drawn — turn on “Selection only” to add endpoint spheres for easier tracing; the status-bar badge closes it in one click; the analysis panel gains a matching '),
    S('「氢键网络 · 残基对」表格', '“H-bond network · residue pairs” table'),
    T('（供体→受体、按距离排序、点击行选中并聚焦两侧残基）。', ' (donor → acceptor, sorted by distance; click a row to select it and focus both residues). '),
    D('分析叠加层不随会话自动恢复，按需重开', 'Analysis overlays are not restored with the session — reopen them as needed'),
    T('。', '.'),
  ],
  // AI 绘图助手
  [
    S('AI 绘图助手', 'AI plotting assistant'),
    T('：工具栏「AI 助手」按钮打开右侧面板——用自然语言描述需求（如「展示血红素口袋」「出版级渲染」「测一下配体和最近残基的距离」「生成两个构象的插值动画」），AI 自动翻译成 MolVision 命令并执行：', ': the “AI assistant” toolbar button opens the right-hand panel — describe what you want in natural language (e.g. “show the heme pocket”, “publication-quality rendering”, “measure the distance from the ligand to the nearest residue”, “generate an interpolation between two conformations”) and the AI translates it into MolVision commands and runs them: '),
    S('全部功能皆可自然语言下达', 'every feature can be driven in natural language'),
    T('（加载/表示/着色/测量/分析/构象动画/导出）。回复', ' (loading / representations / coloring / measurement / analysis / conformational animation / export). Replies '),
    S('逐字流式生成（打字机效果）', 'stream token by token (typewriter effect)'),
    T('，生成中可点发送按钮随时', ', and while one is generating you can hit the send button to '),
    S('停止', 'stop'),
    T('（保留已生成部分）；每条命令以', ' at any time (the part already generated is kept); every command appears as a '),
    S('卡片', 'card'),
    T('展示（状态图标 + 可展开的执行输出 + 重跑按钮）；', ' (status icon + expandable execution output + a rerun button); '),
    S('影响较大的命令（关闭结构/清空场景等）需点「确认执行」', 'high-impact commands (closing a structure, clearing the scene, …) require a “Confirm run” click'),
    T('；执行失败的命令会', '; failed commands are '),
    S('自动反馈 AI 修正一轮', 'fed back to the AI for one automatic correction round'),
    T('；对话历史本地持久化（刷新恢复）。命令与命令行同一条执行路径，白名单校验后运行。', '; conversation history persists locally (restored on reload). Commands share the exact execution path of the command line and run only after whitelist validation.'),
  ],
  // 视觉自查
  [
    S('视觉自查', 'Visual self-check'),
    T('：助手面板头部 ', ': the '),
    S('Eye 开关', 'Eye toggle'),
    T('（默认开）——命令执行完毕后自动截图送视觉模型审视渲染结果：达成则以「视觉自查」徽章消息确认；未达标会指出问题并自动给出修正命令执行（不二次自查，防循环）。「看不见效果对不对」类顾虑交给助手自己看。', ' in the assistant panel header (on by default) — once commands finish, a screenshot is sent automatically to a vision model that reviews the render: on success a “Visual self-check” badge message confirms it; on a miss it pinpoints the problem and issues a corrective command automatically (no second check, to avoid loops). Leave “did it come out right?” worries to the assistant’s own eyes.'),
  ],
  // 增量调整
  [
    S('增量调整', 'Incremental tweaks'),
    T('：直接说「轮廓再粗一点」「灯光再亮一些」「转慢一点」——助手读取场景中的当前数值参数（轮廓粗细/灯光/FOV/spin 速度等）计算新值下发命令，无需知道原值。', ': just say “thicker outlines”, “brighter lighting”, “spin a little slower” — the assistant reads the current numeric parameters in the scene (outline width / lighting / FOV / spin speed, …), computes new values, and issues the commands; you never need to know the previous values.'),
  ],
  // 测量命令
  [
    S('测量命令', 'Measurement commands'),
    T('：', ': '),
    C('measure dist (resn HEM) (within 5 of resn HEM and protein)'),
    T('——括号内为任意选择表达式；距离取两组间最近原子对，角度/二面角各组取质心最近原子；结果入 3D 标注与测量面板。', ' — the parentheses hold arbitrary selection expressions; distances use the closest atom pair between the two groups, angles / dihedrals use the centroid-nearest atom of each group; results land in 3D labels and the measurement panel. '),
    C('measure clear'),
    T(' 清除全部。也可用工具栏测量模式点击原子测量。', ' clears them all. You can also click atoms in a toolbar measurement mode.'),
  ],
  // 序列条搜索定位
  [
    S('序列条搜索定位', 'Sequence-bar search & locate'),
    T('：序列条头部「定位」按钮——输入 ', ': the “Locate” button in the sequence-bar header — type a '),
    S('残基号（57）', 'residue number (57)'),
    T('、', ', a '),
    S('链+号（A57）', 'chain + number (A57)'),
    T(' 或 ', ', or a '),
    S('配体名（HEM）', 'ligand name (HEM)'),
    T('，Enter 即选中并自动滚动到可见位置（相机不移动；可再双击格子聚焦缩放）。序列格子每 10 位显示序号刻度（Jalview 风格），点击选残基、Shift 加选、Alt 减选、双击聚焦。', ' and press Enter to select it and auto-scroll it into view (the camera does not move; double-click the cell afterwards to focus and zoom). Sequence cells show a ruler mark every 10 positions (Jalview style); click to select a residue, Shift to add, Alt to remove, double-click to focus.'),
  ],
]

/** 会话与文件段落 */
const SESSION_FILES: Seg[][] = [
  // 关闭结构
  [
    S('关闭结构', 'Closing structures'),
    T('：结构卡片右侧 ', ': the '),
    S('X 按钮', 'X button'),
    T('（常显）关闭单个结构，toast 内 8 秒可撤销（表示法/着色/叠合变换/对称伴侣一并还原）；「全部关闭」批量清空（书签与时间轴保留）；命令行 ', ' on the right of a structure card (always visible) closes that structure, with an 8-second undo inside the toast (representations / coloring / superposition transforms / symmetric mates all restored); “Close all” clears them in bulk (bookmarks and the timeline are kept); on the command line '),
    C('close'),
    T('（活动结构）/ ', ' (active structure) / '),
    C('close 4HHB'),
    T(' / ', ' / '),
    C('close all'),
    T('。', '.'),
  ],
  // 保存会话文件
  [
    S('保存会话文件', 'Saving session files'),
    T('：工具栏「会话」菜单 →「保存会话文件」导出 ', ': toolbar “Session” menu → “Save session file” exports a '),
    C('.molvision'),
    T(' 文件——含全部结构源文本、表示法、着色、设置、相机视角与视角书签，可跨设备分享；命令行 ', ' file — with all structure source text, representations, coloring, settings, camera views, and view bookmarks — shareable across devices; on the command line '),
    C('session export'),
    T('。', '.'),
  ],
  // 打开会话
  [
    S('打开会话', 'Opening sessions'),
    T('：「会话」菜单 →「打开会话文件」，或直接把 .molvision 文件拖到 3D 视口 / 加载对话框（替换当前场景并自动还原全部状态）。', ': “Session” menu → “Open session file”, or simply drop a .molvision file onto the 3D viewport / the load dialog (replaces the current scene and restores all state automatically).'),
  ],
  // 合并会话
  [
    S('合并会话', 'Merging sessions'),
    T('：「会话」菜单 →「合并会话文件…」——不清空当前场景，把文件中的结构', ': “Session” menu → “Merge session file…” — instead of clearing the current scene, structures from the file are '),
    S('追加', 'appended'),
    T('进来（名称冲突自动编号如 4HHB-2；叠合位姿与对称设置保留；命名选择与视角书签追加合并，重名跳过；当前设置/相机/密度图不受影响）。', ' (name clashes are auto-numbered like 4HHB-2; superposition poses and symmetry settings are preserved; named selections and view bookmarks merge in with duplicates skipped; current settings / camera / density maps are untouched).'),
  ],
  // 新建会话
  [
    S('新建会话', 'New session'),
    T('：「会话」菜单 →「新建会话」（有结构时二次确认）——清空结构、选择、测量、标签、命名选择、视角书签、movie 时间轴、密度图与本地存档，回到全新状态；录制中会先自动保存已录片段。命令行 ', ': “Session” menu → “New session” (double-confirmed when structures are loaded) — clears structures, selections, measurements, labels, named selections, view bookmarks, the movie timeline, density maps, and the local autosave, returning to a pristine state; if a recording is in progress, the segments already recorded are saved first. On the command line '),
    C('session new'),
    T('。', '.'),
  ],
  // 自动存档
  [
    S('自动存档', 'Autosave'),
    T('：结构加载/视图变动自动写入浏览器本地（localStorage），刷新自动恢复；', ': structure loads and view changes are written automatically to browser-local storage (localStorage) and restored on reload; '),
    C('session save / info / clear'),
    T(' 手动管理。分析叠加层（氢键网络等）不随自动存档恢复——刷新后是干净的渲染视图，按需重开。', ' manages it manually. Analysis overlays (H-bond networks, etc.) are not restored by autosave — after a reload you get a clean render and reopen them as needed.'),
  ],
]

export function HelpDialog() {
  const { t } = useI18n()
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)

  return (
    <Dialog open={ui.helpOpen} onOpenChange={open => setUi({ helpOpen: open })}>
      <DialogContent className="mol-elevate-lg flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="gap-1.5 border-b border-border px-4 pb-2.5 pt-3.5">
          <DialogTitle className="flex items-center gap-2 text-sm">
            {t({ zh: '使用帮助', en: 'Help' })}
            <span className="mol-micro ml-auto mr-9 text-muted-foreground">SHORTCUTS</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t({ zh: 'MolVision — 基于 Three.js 的专业分子可视化工作台', en: 'MolVision — a professional molecular visualization workbench built on Three.js' })}
          </DialogDescription>
        </DialogHeader>

        <div className="mol-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Lightbulb className="h-3 w-3" /> {t({ zh: '快速上手', en: 'Quick start' })}
            </h3>
            <ol className="ml-4 list-decimal space-y-1 text-xs leading-relaxed text-muted-foreground">
              {QUICK_START.map((segs, i) => (
                <li key={i}><Segs segs={segs} /></li>
              ))}
            </ol>
            <p className="mt-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <GraduationCap className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-muted-foreground" />{' '}
              <Segs segs={TOUR_NOTE} />
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <MousePointer2 className="h-3 w-3" /> {t({ zh: '鼠标操作', en: 'Mouse controls' })}
            </h3>
            <div className="grid gap-1">
              {MOUSE.map(([k, v], i) => (
                <div key={i} className="flex items-center gap-3 text-xs">
                  <span className="inline-flex w-28 shrink-0 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[10px]">{t(k)}</span>
                  <span className="text-muted-foreground">{t(v)}</span>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Wand2 className="h-3 w-3" /> {t({ zh: 'PyMOL 用户速查（习惯迁移）', en: 'PyMOL user cheat sheet (habit transfer)' })}
            </h3>
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              {t({ zh: '选择语法、命令动词、逗号参数、命名对象语义均与 PyMOL 对齐——熟悉的命令直接输入即可：', en: 'Selection syntax, command verbs, comma-separated arguments, and named-object semantics all align with PyMOL — just type the commands you already know:' })}
            </p>
            <div className="grid gap-1.5">
              {PYMOL_MAP.map(([k, ex, v], i) => (
                <div key={i} className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 font-mono font-semibold text-foreground">{t(k)}</span>
                    <code className="min-w-0 truncate font-mono text-[10px] text-primary/90">{ex}</code>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t(v)}</p>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <FlaskConical className="h-3 w-3" /> {t({ zh: 'ChimeraX 用户速查（双语法并轨）', en: 'ChimeraX user cheat sheet (dual syntax)' })}
            </h3>
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              {t({ zh: '原子说明符（/A :42 @CA #1）与 ChimeraX 命令动词直接可用，与 PyMOL 语法可混用：', en: 'ChimeraX atom specifiers (/A :42 @CA #1) and command verbs work directly and can be mixed with PyMOL syntax:' })}
            </p>
            <div className="grid gap-1.5">
              {CHIMERAX_MAP.map(([k, ex, v], i) => (
                <div key={i} className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 font-mono font-semibold text-foreground">{t(k)}</span>
                    <code className="min-w-0 truncate font-mono text-[10px] text-primary/90">{ex}</code>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{t(v)}</p>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Keyboard className="h-3 w-3" /> {t({ zh: '键盘快捷键', en: 'Keyboard shortcuts' })}
            </h3>
            <div className="grid gap-1">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 text-xs">
                  <Kbd className="w-16">{k}</Kbd>
                  <span className="text-muted-foreground">{t(v)}</span>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <FlaskConical className="h-3 w-3" /> {t({ zh: '结构分析与晶体学', en: 'Structure analysis & crystallography' })}
            </h3>
            <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              {ANALYSIS.map((segs, i) => <p key={i}><Segs segs={segs} /></p>)}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Wand2 className="h-3 w-3" /> {t({ zh: '渲染与视图', en: 'Rendering & view' })}
            </h3>
            <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              {RENDER_VIEW.map((segs, i) => <p key={i}><Segs segs={segs} /></p>)}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <FolderOpen className="h-3 w-3" /> {t({ zh: '会话与文件', en: 'Session & files' })}
            </h3>
            <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              {SESSION_FILES.map((segs, i) => <p key={i}><Segs segs={segs} /></p>)}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 text-muted-foreground">{t({ zh: '选择表达式语法', en: 'Selection expression syntax' })}</h3>
            <div className="space-y-1 rounded-lg bg-muted/40 p-2.5 font-mono text-[10px] leading-relaxed">
              <div><span className="text-primary">chain A</span> and <span className="text-primary">resi 40-80</span></div>
              <div><span className="text-primary">chainidx 4</span>  <span className="text-muted-foreground">{t({ zh: '// 第 5 个链组（同链 ID 的蛋白/配体/水互不波及）', en: '// the 5th chain group (protein/ligand/water sharing one chain ID never affect each other)' })}</span></div>
              <div><span className="text-primary">molecule 2</span>  <span className="text-muted-foreground">{t({ zh: '// 第 3 个配体分子（多残基配体整体，别名 mol）', en: '// the 3rd ligand molecule (a whole multi-residue ligand; alias mol)' })}</span></div>
              <div><span className="text-primary">within 5 of</span> (resn HEM)  <span className="text-muted-foreground">{t({ zh: '// HEM 周围 5 Å', en: '// 5 Å around HEM' })}</span></div>
              <div><span className="text-primary">byres</span>(within 4 of ligand)  <span className="text-muted-foreground">{t({ zh: '// 扩展到整个残基', en: '// expand to whole residues' })}</span></div>
              <div>(protein or nucleic) and <span className="text-primary">not helix</span></div>
              <div>name CA+CB · elem Fe · bfactor &gt; 40 · backbone · metal</div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
