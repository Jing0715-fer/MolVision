'use client'

// 论文图复现模板（r71 创立 · r72 差异化打磨 · r75 互作分析扩容 + 原文图式对比 · r76 分类细化）
// ─────────────────────────────────────────────────────────────────────────────
// 定位：把 Cell / Nature / Science 等高影响力结构生物学文章中反复出现的「图式」
// （figure style）——表示法组合 + 配色 + 视角 + 灯光 + 轮廓 + 相机——固化为命令
// 序列模板。一键应用到用户当前结构，快速得到 CNS 级别作图。
//
// r76 打磨（用户反馈驱动）：
//  · 分类细化：general 11 拆为基础图式/表面与全局/位点特写三类——过滤 chips 从
//    4 组到 6 组（全部/基础/表面/位点/互作/膜蛋白），用户按目的直达
//  · 轮廓再减细：全体描边模板 1.3/1.2 → 1.1/1.0（粗细触及 Sobel 采样步长下限——
//    单像素级发丝线；全局默认同步 1.5 → 1.2）
//  · 演示居中根治：demoThenApply 等结构入 store + 引擎挂载 + 自动 fit 飞行落地后
//    才跑命令序列（旧 600ms 定时器会在 fit 半途打断相机——1D3Z 演示偏心根因）；
//    runTemplateCommands 对相机命令串行等飞行落地（orient 后 120ms 接 turn 打断
//    在 partial pose 的另一半根因）
//  · 位点特写扩容：二硫键网络（胰岛素黄棍 CYS）+ 金属活性中心（金属球 + 配位棍）；
//    adapt 层新规则⑨金属离子重映射/退避与⑩无半胱氨酸说明
// r75 扩容（用户指令：继续增加更多模板，涵盖互作分析等多种场景）：
//  · 新分类 interaction（互作分析）：盐桥网络 / 配体氢键网络 / DNA-蛋白复合物
//    （+既有 interface-contacts 重归类）——全部走 contacts/hbonds 真实分析命令
//  · 新通用场景：结构域分区着色（Mpro 三域）+ 突变热点图（B 因子通道 + 标签）
//  · figure 字段：原文图式参考（图版位置 + 原图展示内容）——模板弹窗「对比」
//    视图的右栏数据；COMMAND_GLOSSARY 命令图鉴把命令序列翻成双语图式解剖
//  · adapt 层新规则：⑤配体氢键退避主链 ⑥无核酸降级 ⑦域区间截断说明 ⑧链不匹配热点降级
//
// r72 打磨（用户反馈驱动）：
//  · 轮廓线减细：全体描边模板从「on 2 2.5」降到「on 1.3 1.2」——发丝级细线
//    更贴近期刊制版（过粗描边会吞掉二级结构细节，是用户实感反馈）
//  · 模板差异化：每个模板一套独立配方维度（背景色温/正交视角/卡通宽度/灯光/
//    轮廓取舍），十卡不再「同底同角度」——见每条 commands 注释里的「差异点」
//  · 特定蛋白类型分析模板（category: membrane）：离子通道孔道剖面（pore 命令，
//    HOLE 式计算）与脂双层语境（membrane 命令）——从「配色模板」进化到「分析图」
//
// 版权与还原策略（诚实定位）：
//  · 不保存任何论文原图（版权），模板还原的是「图式视觉配方」；缩略图由本引擎
//    对代表结构真实渲染生成（public/templates/*.png，管线见 r71/r72 E2E）。
//  · citation 为图式来源的真实文献（DOI 经检索核实）；膜蛋白/通道类模板溯源到
//    领域奠基论文（KcsA/Doyle 1998、GlpF/Fu 2002）——分析图式（HOLE 剖面、
//    脂双层语境）正是这些论文确立的。
//
// 架构：模板 = 命令序列（全部走既有 runCommand）。模板应用因此天然获得：
//  · 命令行可重放性（历史面板可见每一步）
//  · 引擎/多结构/撤销等一切既有语义
//  · 逐条执行间隔 120ms（preset 聚焦动画 / spectrum worker 着色平滑衔接）
import { runCommand } from './commands'
import { fetchPdbId } from './loader'
import { dataRegistry, engineRef, useMolStore } from './store'
import { whenEngineReady } from './engine-ready'
import { tt } from '@/i18n'
import type { DualText } from '@/i18n'

/** 图式来源文献（真实引用，经检索核实；doi 可省略——避免不确定引用伤害可信度） */
export interface FigureCitation {
  journal: 'Nature' | 'Science' | 'Cell'
  year: number
  /** 论文短标题（截取主短语） */
  title: string
  doi?: string
}

/** 模板分类（r76 细化）：基础构图 / 表面与全局 / 位点特写 / 互作分析 / 特定蛋白类型（膜/通道） */
export type FigureCategory = 'basic' | 'surface' | 'site' | 'interaction' | 'membrane'

/** 论文图复现模板 */
export interface FigureTemplate {
  id: string
  /** 名称（双语） */
  name: DualText
  /** 一句图式描述（卡片正文） */
  tagline: DualText
  /** 适用分析目的（卡片 footer 说明） */
  purpose: DualText
  /** 标签 chips（≤3，双语） */
  tags: DualText[]
  /** 分类（弹窗过滤 chips：基础 / 表面与全局 / 位点特写 / 互作分析 / 膜蛋白·通道） */
  category: FigureCategory
  /** 原文图式参考（「对比」视图右栏） */
  figure?: FigureRef
  /** 图式参考来源 */
  citation: FigureCitation
  /** 代表结构（缩略图渲染用；「演示」按钮加载它再应用） */
  demo: string
  /** 复现命令序列（全部为已验证命令语法） */
  commands: string[]
  /** 卡片强调色（Tailwind 类族名，用于占位渐变与 hover 边框） */
  accent: 'rose' | 'emerald' | 'amber' | 'sky' | 'violet' | 'teal' | 'orange' | 'fuchsia' | 'lime' | 'cyan' | 'slate'
}

/** 分类元数据（弹窗/欢迎页画廊过滤 chips；r76：general 11 拆三类，过滤直达分析目的） */
export const FIGURE_CATEGORIES: { key: FigureCategory | 'all'; label: DualText }[] = [
  { key: 'all', label: { zh: '全部', en: 'All' } },
  { key: 'basic', label: { zh: '基础图式', en: 'Basic styles' } },
  { key: 'surface', label: { zh: '表面与全局', en: 'Surface & global' } },
  { key: 'site', label: { zh: '位点特写', en: 'Site close-ups' } },
  { key: 'interaction', label: { zh: '互作分析', en: 'Interaction analysis' } },
  { key: 'membrane', label: { zh: '膜蛋白 · 通道', en: 'Membrane · channels' } },
]

/** 原文图式参考（「对比」视图右栏：原图展示什么——诚实溯源，非存图） */
export interface FigureRef {
  /** 原文图版位置（宽松标注，如 "Fig. 1a"；不确定时省略——UI 退为期刊年份） */
  ref?: string
  /** 原图展示的内容（对比视图的「原文图式」描述） */
  shows: DualText
}

export const FIGURE_TEMPLATES: FigureTemplate[] = [
  {
    id: 'rainbow-overview',
    name: { zh: '彩虹全景', en: 'Rainbow overview' },
    tagline: { zh: 'N→C 渐变卡通 + 白底细描边：结构文首图惯例', en: 'N→C rainbow cartoon on white with hairline outlines: the classic opening figure' },
    purpose: { zh: '整体概览 · 折叠走向 · 组装示意', en: 'Overall architecture · fold topology · assembly' },
    tags: [{ zh: '整体结构', en: 'Overview' }, { zh: '首图', en: 'Panel A' }],
    category: 'basic',
    figure: { ref: 'Fig. 1a', shows: { zh: '整体结构首图：全貌 + 折叠走向 + 结构域标注', en: 'Opening figure: overall architecture, fold topology and domain annotations' } },
    citation: { journal: 'Science', year: 2020, title: 'Cryo-EM structure of the 2019-nCoV spike in the prefusion conformation', doi: '10.1126/science.abb2507' },
    demo: '4HHB',
    // 差异点：纯白底 + 细描边 + PCA 主轴对齐（基线「经典款」，其余模板均偏离它）
    commands: ['preset cartoon', 'spectrum count, rainbow', 'bg white', 'outline on 1.1 1.0', 'orient'],
    accent: 'rose',
  },
  {
    id: 'chain-assembly',
    name: { zh: '亚基分色组装', en: 'Chain assembly' },
    tagline: { zh: '逐链配色 + 加宽卡通 + 冷灰底正面视角：寡聚体组成一目了然', en: 'Per-chain coloring + widened cartoon + cool-gray front view: oligomer composition at a glance' },
    purpose: { zh: '多亚基组装 · 化学计量 · 界面初判', en: 'Multi-subunit assembly · stoichiometry · interfaces' },
    tags: [{ zh: '寡聚体', en: 'Oligomer' }, { zh: '复合物', en: 'Complex' }],
    category: 'basic',
    figure: { ref: 'Fig. 1', shows: { zh: '组装层级图：亚基如何拼成复合物 + 化学计量标注', en: 'Assembly hierarchy: how subunits build the complex, with stoichiometry' } },
    citation: { journal: 'Science', year: 2022, title: 'Architecture of the linker-scaffold in the nuclear pore complex' },
    demo: '4HHB',
    // 差异点：冷灰蓝底（#f5f7fa）+ 无描边（色块自明）+ 卡通 1.5× 加宽（块面感）+ 正面视角
    commands: ['preset cartoon', 'util cbc', 'bg #f5f7fa', 'set cartoon_width 1.5', 'view front'],
    accent: 'sky',
  },
  {
    id: 'ss-motif',
    name: { zh: '二级结构基元', en: 'Secondary-structure motifs' },
    tagline: { zh: 'helix/sheet/coil 三色 + 暖象牙底 + 斜侧 20°：基序与拓扑教学图式', en: 'Helix/sheet/coil tri-color + warm ivory + 20° oblique: motif & topology schematics' },
    purpose: { zh: '折叠类型 · 基序识别 · 教学示意', en: 'Fold class · motif recognition · teaching' },
    tags: [{ zh: '拓扑', en: 'Topology' }, { zh: '基序', en: 'Motif' }],
    category: 'basic',
    figure: { ref: 'Fig. 1b', shows: { zh: '拓扑概览图：螺旋/折叠片布局 + 基序标注', en: 'Topology overview: helix/sheet layout with motif annotations' } },
    citation: { journal: 'Nature', year: 2024, title: 'Structural and molecular basis of choline uptake into the brain by FLVCR2', doi: '10.1038/s41586-024-57361-2' },
    demo: '1AKI',
    // 差异点：暖象牙底（#fbf8f1）+ 斜侧视角 turn y -20（基元交叠可辨）+ 细描边
    commands: ['preset cartoon', 'util ss', 'bg #fbf8f1', 'turn y -20', 'outline on 1.1 1.0'],
    accent: 'amber',
  },
  {
    id: 'ligand-pocket',
    name: { zh: '配体口袋特写', en: 'Ligand pocket close-up' },
    tagline: { zh: '口袋球棍 + 元素着色 + 自动聚焦 + 细描边：药物靶点文主角图', en: 'Pocket ball-stick + element coloring + auto-zoom + hairline edges: the drug-target hero figure' },
    purpose: { zh: '抑制剂设计 · 互作残基 · 靶点验证', en: 'Inhibitor design · contacting residues · target validation' },
    tags: [{ zh: '药物靶点', en: 'Drug target' }, { zh: '互作', en: 'Interactions' }],
    category: 'site',
    figure: { ref: 'Fig. 2', shows: { zh: '抑制剂口袋特写：互作残基 + 氢键/疏水接触逐项标注', en: 'Inhibitor pocket close-up: contacting residues annotated bond by bond' } },
    citation: { journal: 'Nature', year: 2020, title: 'Structure of Mpro from SARS-CoV-2 and discovery of its inhibitors', doi: '10.1038/s41586-020-2223-y' },
    demo: '6LU7',
    // 差异点：白底特写（bindingsite 自动聚焦）+ 细描边——近景描边必须细，粗线会糊掉球棍
    commands: ['preset bindingsite', 'bg white', 'outline on 1.1 1.0'],
    accent: 'emerald',
  },
  {
    id: 'sasa-surface',
    name: { zh: '可及性表面', en: 'SASA surface' },
    tagline: { zh: 'SASA 渐变表面 + 冷雾底无描边：疏水核心与 patch 分布', en: 'SASA-graded surface on cool mist, outline-free: hydrophobic cores and patch distribution' },
    purpose: { zh: '表面性质 · 疏水 patch · 界面预测', en: 'Surface properties · hydrophobic patches · interface prediction' },
    tags: [{ zh: '表面', en: 'Surface' }, { zh: '疏水性', en: 'Hydrophobicity' }],
    category: 'surface',
    figure: { ref: 'Fig. 3', shows: { zh: '表面性质图：疏水/亲水 patch 分布与功能位点标注', en: 'Surface property map: hydrophobic/philic patches and functional sites' } },
    citation: { journal: 'Nature', year: 2024, title: 'Structural and molecular basis of choline uptake into the brain by FLVCR2', doi: '10.1038/s41586-024-57361-2' },
    demo: '4HHB',
    // 差异点：冷雾底（#eef1f5）+ 无轮廓（表面自带渐变边界，描边反而脏）
    commands: ['preset surface', 'color sasa', 'bg #eef1f5'],
    accent: 'teal',
  },
  {
    id: 'density-map',
    name: { zh: '密度叠加验证', en: 'Density overlay' },
    tagline: { zh: '彩虹模型 + 电子密度网格 + 平光：cryo-EM 局部质量图式', en: 'Rainbow model + density mesh + flat ambient: cryo-EM local-quality figure' },
    purpose: { zh: '模型质量 · 局部分辨率 · 投稿审稿', en: 'Model quality · local resolution · review-ready' },
    tags: [{ zh: 'cryo-EM', en: 'cryo-EM' }, { zh: '密度图', en: 'Maps' }],
    category: 'surface',
    figure: { ref: 'Fig. 1 / ED', shows: { zh: '模型-密度叠合图：局部质量与分辨率验证', en: 'Model-to-map overlay: local quality and resolution validation' } },
    citation: { journal: 'Science', year: 2020, title: 'Cryo-EM structure of the 2019-nCoV spike in the prefusion conformation', doi: '10.1126/science.abb2507' },
    demo: '3EKJ',
    // 差异点：白底 + 平光（ambient 1.15——密度网格需均匀照明，避免阴影吃掉网格线）
    commands: ['preset cartoon', 'spectrum count, rainbow', 'map fetch 3ekj', 'bg white', 'set ambient 1.15'],
    accent: 'violet',
  },
  {
    id: 'interface-contacts',
    name: { zh: '界面接触网络', en: 'Interface contacts' },
    tagline: { zh: '亚基分色 + 接触虚线 + 冷灰底正面：PPI 分析标准图', en: 'Chain coloring + contact dashes + cool-gray front view: standard PPI figure' },
    purpose: { zh: '界面残基 · 结合强度 · 突变设计', en: 'Interface residues · binding strength · mutagenesis design' },
    tags: [{ zh: 'PPI', en: 'PPI' }, { zh: '界面', en: 'Interface' }],
    category: 'interaction',
    figure: { ref: 'Fig. 3', shows: { zh: 'PPI 界面网络图：界面残基 + 结合热点标注', en: 'PPI interface network: interface residues and binding hotspots' } },
    citation: { journal: 'Nature', year: 2026, title: 'Next-generation inhibitors of SARS-CoV-2 Mpro overcome Paxlovid deficiencies' },
    demo: '6LU7',
    // 差异点：冷灰底 + 正面视角（界面正对读者，接触线全程可见）+ 细描边
    commands: ['preset cartoon', 'util cbc', 'interface A B', 'bg #f5f7fa', 'view front', 'outline on 1.1 1.0'],
    accent: 'orange',
  },
  {
    id: 'symmetry-assembly',
    name: { zh: '晶体对称伙伴', en: 'Symmetry mates' },
    tagline: { zh: '对称伴侣 + 俯视晶格视角：结晶学组装语境图', en: 'Symmetry mates + top-down lattice view: crystallographic packing context' },
    purpose: { zh: '生物组装判读 · 晶格核对', en: 'Biological assembly · lattice cross-check' },
    tags: [{ zh: '晶体学', en: 'Crystallography' }, { zh: '组装', en: 'Assembly' }],
    category: 'surface',
    figure: { ref: 'Fig. S1', shows: { zh: '晶格堆积图：晶体学组装 vs 生物组装判读', en: 'Lattice packing: crystallographic vs biological assembly' } },
    citation: { journal: 'Nature', year: 2020, title: 'Structure of Mpro from SARS-CoV-2 and discovery of its inhibitors', doi: '10.1038/s41586-020-2223-y' },
    demo: '1CRN',
    // 差异点：白底 + 俯视（view top——晶格平移在俯视下读得最清楚，装箱图惯例）
    commands: ['preset cartoon', 'spectrum count, rainbow', 'symmetry 30', 'bg white', 'view top'],
    accent: 'fuchsia',
  },
  {
    id: 'ensemble-dynamics',
    name: { zh: '构象系综动画', en: 'Ensemble dynamics' },
    tagline: { zh: 'NMR 多构象 + 墨底夜色系 + 细杆卡通：动力学与柔性图式', en: 'NMR conformers + ink-dark night palette + thin-rod cartoon: dynamics & flexibility' },
    purpose: { zh: '构象变化 · 柔性区段 · NMR 验证', en: 'Conformational spread · flexible segments · NMR validation' },
    tags: [{ zh: 'NMR', en: 'NMR' }, { zh: '动力学', en: 'Dynamics' }],
    category: 'surface',
    figure: { ref: 'Fig. 4', shows: { zh: '构象系综图：柔性区段散布与功能构象采样', en: 'Conformational ensemble: flexible segment spread and functional sampling' } },
    citation: { journal: 'Cell', year: 2021, title: 'Structural and dynamic insights into the activation of the μ-opioid receptor' },
    demo: '1D3Z',
    // 差异点：墨底夜色（#14171c，封面/ graphical abstract 惯例）+ 细杆卡通（0.5×——
    // 多构象叠影下粗杆会糊成一团）+ 斜侧 turn y 25
    commands: ['preset cartoon', 'spectrum count, rainbow', 'ensemble play', 'bg #14171c', 'set cartoon_width 0.5', 'turn y 25'],
    accent: 'cyan',
  },
  {
    id: 'publication-ready',
    name: { zh: '出版级静帧', en: 'Publication still' },
    tagline: { zh: '出版互作预设 + 发丝描边 + Ray 渲染：直接可投稿', en: 'Publication preset + hairline outlines + ray render: submission-ready' },
    purpose: { zh: '投稿图 · 高分辨率 · 免修图', en: 'Submission figures · hi-res · no post-processing' },
    tags: [{ zh: '出稿', en: 'Figure out' }, { zh: 'Ray', en: 'Ray' }],
    category: 'basic',
    figure: { ref: 'Fig. 1', shows: { zh: '投稿主图：全貌 + 完整标注的出版静帧', en: 'Submission hero figure: fully annotated publication still' } },
    citation: { journal: 'Nature', year: 2026, title: 'Next-generation inhibitors of SARS-CoV-2 Mpro overcome Paxlovid deficiencies' },
    demo: '4HHB',
    // 差异点：纯白底 + Ray 1920 静帧（超采样 AA）+ 发丝描边 1.1 1.0（r76 再减细——单像素级）
    commands: ['preset publication', 'bg white', 'outline on 1.1 1.0', 'ray 1920'],
    accent: 'lime',
  },
  {
    // ── 特定蛋白类型分析模板（r72）：不再是「配色配方」，而是分析命令序列 ──
    id: 'pore-analysis',
    name: { zh: '离子通道孔道剖面', en: 'Ion-channel pore profile' },
    tagline: { zh: 'HOLE 式球拟合环带 + 脂双层语境 + 收缩点读数：通道分析图标配', en: 'HOLE-style sphere-fitted rings + bilayer context + constriction readout: the channel-analysis staple' },
    purpose: { zh: '收缩点半径 · 选择性滤波器 · 门控判读', en: 'Constriction radius · selectivity filter · gating readout' },
    tags: [{ zh: '离子通道', en: 'Ion channel' }, { zh: '孔道分析', en: 'Pore' }],
    category: 'membrane',
    figure: { ref: 'HOLE 剖面图版', shows: { zh: '孔道剖面图：半径沿轴曲线 + 收缩点/选择性滤波器标注', en: 'Pore profile: radius-vs-axis curve with constriction / selectivity filter' } },
    citation: { journal: 'Science', year: 1998, title: 'The Structure of the Potassium Channel: Molecular Basis of K+ Conduction and Selectivity', doi: '10.1126/science.280.5360.69' },
    demo: '1BL8',
    // 差异点（分析模板）：membrane 34 脂双层 + pore 计算环带（红/绿/蓝）+ 主轴对齐竖排视角
    commands: ['preset cartoon', 'util cbc', 'bg white', 'membrane 34', 'pore', 'orient', 'turn z 90', 'outline on 1.1 1.0'],
    accent: 'slate',
  },
  {
    id: 'membrane-embed',
    name: { zh: '膜蛋白脂双层语境', en: 'Membrane-embedded context' },
    tagline: { zh: '表面渐变 + 橙头基双层板 + 侧视：膜蛋白跨膜区一图判读', en: 'Gradient surface + orange headgroup slab + side view: transmembrane extent at a glance' },
    purpose: { zh: '跨膜深度 · 膜界面 patch · β-桶/螺旋束', en: 'TM span · interfacial patches · barrel vs helix bundle' },
    tags: [{ zh: '膜蛋白', en: 'Membrane' }, { zh: '水通道', en: 'Aquaporin' }],
    category: 'membrane',
    figure: { ref: 'Fig. 1', shows: { zh: '膜语境图：跨膜深度 + 膜界面 patch 标注', en: 'Membrane context: transmembrane span and interfacial patches' } },
    citation: { journal: 'Science', year: 2002, title: 'Structure of a glycerol-conducting channel and the basis for its selectivity', doi: '10.1126/science.1072457' },
    demo: '1FX8',
    // 差异点：SASA 渐变表面 + 脂双层板（跨膜区灰表面嵌入橙头基之间）+ 正面侧视
    commands: ['preset surface', 'color sasa', 'bg #f5f7fa', 'membrane 32', 'view front'],
    accent: 'orange',
  },

  // ── r75 互作分析扩容（用户指令：涵盖互作分析等多种场景）──
  // 互作三模板全部走 contacts / hbonds 真实分析命令（非纯配色配方）：
  // 盐桥 = 残基对接触的酸碱子集；配体氢键 = 范围烘焙 hbonds；DNA = protein|nucleic 零参接触
  {
    id: 'salt-bridge-network',
    name: { zh: '盐桥网络', en: 'Salt-bridge network' },
    tagline: { zh: '酸/碱残基红蓝双色 + 接触虚线 + 侧链棍状：静电互作网络图式', en: 'Acid/base two-tone + contact dashes + sidechain sticks: electrostatic interaction map' },
    purpose: { zh: '稳定性 · pH 敏感性 · 别构机制', en: 'Stability · pH sensitivity · allostery' },
    tags: [{ zh: '静电互作', en: 'Electrostatics' }, { zh: '盐桥', en: 'Salt bridge' }],
    category: 'interaction',
    figure: { ref: '机制图版', shows: { zh: '盐桥网络图：T/R 态转换中的静电键拆合（Perutz 经典手绘图式）', en: 'Salt-bridge scheme: electrostatic bonds broken/formed across T/R transitions (Perutz classic)' } },
    citation: { journal: 'Nature', year: 1970, title: 'Stereochemistry of cooperative effects in haemoglobin: haem-haem interaction and the problem of allostery', doi: '10.1038/228726a0' },
    demo: '1AKI',
    // 差异点：红蓝语义色（酸 ASP/GLU 红 · 碱 LYS/ARG/HIS 蓝）+ 4.0Å 残基对虚线 +
    // 侧链棍（带电残基加棍——虚线端点与残基类型视觉可互证）；1AKI 实测 4 对盐桥
    commands: [
      'preset cartoon', 'util cbc', 'bg white',
      'contacts (resn ASP+GLU and sidechain) | (resn LYS+ARG+HIS and sidechain) 4.0',
      'color red, resn ASP+GLU', 'color blue, resn LYS+ARG+HIS',
      'show sticks, (resn ASP+GLU+LYS+ARG+HIS) and sidechain',
      'view front', 'outline on 1.1 1.0',
    ],
    accent: 'rose',
  },
  {
    id: 'hbond-network',
    name: { zh: '配体氢键网络', en: 'Ligand H-bond network' },
    tagline: { zh: '结合位点特写 + 范围氢键虚线：药物-靶点互作指纹图', en: 'Binding-site close-up + scoped H-bond dashes: the drug-target interaction fingerprint' },
    purpose: { zh: '抑制剂优化 · 互作指纹 · SAR 解释', en: 'Inhibitor optimization · interaction fingerprint · SAR rationale' },
    tags: [{ zh: '氢键', en: 'H-bonds' }, { zh: '药物设计', en: 'Drug design' }],
    category: 'interaction',
    figure: { ref: 'Fig. 2', shows: { zh: '配体互作图：口袋内氢键/疏水接触逐项标注', en: 'Ligand interaction diagram: pocket contacts annotated bond by bond' } },
    citation: { journal: 'Nature', year: 2020, title: 'Structure of Mpro from SARS-CoV-2 and discovery of its inhibitors', doi: '10.1038/s41586-020-2223-y' },
    demo: '6LU7',
    // 差异点：hbonds 范围烘焙（配体 5Å 邻域 byres 展开，非全局）——互作虚线只在口袋内
    // 出现；6LU7 N3 抑制剂实测 65 条氢键；无配体时 adapt 退避主链氢键网络
    commands: ['preset bindingsite', 'bg white', 'hbonds on 3.4 in byres(within 5 of (ligand)) and not water', 'outline on 1.1 1.0'],
    accent: 'emerald',
  },
  {
    id: 'dna-protein-complex',
    name: { zh: 'DNA-蛋白复合物', en: 'DNA-protein complex' },
    tagline: { zh: '蛋白分链配色 + DNA 碱基五色棍状 + 接触虚线：识别界面一图判读', en: 'Per-chain protein + base-colored DNA sticks + contact dashes: recognition interface at a glance' },
    purpose: { zh: '序列识别 · 大沟/小沟接触 · 转录调控', en: 'Sequence recognition · groove contacts · transcription control' },
    tags: [{ zh: 'DNA 识别', en: 'DNA binding' }, { zh: '转录因子', en: 'Transcription factor' }],
    category: 'interaction',
    figure: { ref: 'Fig. 2', shows: { zh: '识别复合物图：螺旋-转入大沟 + 碱基特异接触标注', en: 'Recognition complex: helix-turn-in-groove with base-specific contacts' } },
    // Jordan & Pabo 1988 Science 242:893——λ 阻遏蛋白-操纵子复合物（1LMB 取材原文）
    citation: { journal: 'Science', year: 1988, title: 'Structure of the lambda complex at 2.5 Å resolution: details of the repressor-operator interactions', doi: '10.1126/science.3187530' },
    demo: '1LMB',
    // 差异点：核酸专属视觉（碱基五色棍 + 骨架管）+ protein|nucleic 零参接触——
    // 链名无关（任意 DNA/RNA-蛋白复合物开箱即用）；界面聚焦 zoom（识别图惯例——
    // 全景下接触虚线太稀，视图收到 DNA ± 8Å 接触面残基）；1LMB 实测 55 对接触
    commands: ['preset cartoon', 'util cbc', 'color residue, nucleic', 'show sticks, nucleic', 'contacts protein | nucleic 4.0', 'bg white', 'view front', 'zoom byres(within 8 of (nucleic))', 'outline on 1.1 1.0'],
    accent: 'violet',
  },
  {
    id: 'domain-coloring',
    name: { zh: '结构域分区着色', en: 'Domain partition coloring' },
    tagline: { zh: '按域分段纯色 + 白底细描边：多域架构与域界一图说清', en: 'Solid color per domain + white hairlines: multi-domain architecture and boundaries at a glance' },
    purpose: { zh: '多域架构 · 域界标注 · 嵌合设计', en: 'Multi-domain architecture · boundary mapping · chimera design' },
    tags: [{ zh: '结构域', en: 'Domains' }, { zh: '架构', en: 'Architecture' }],
    category: 'site',
    figure: { ref: 'Fig. 1', shows: { zh: '结构域组织图：I/II/III 域分段 + 功能位点标注', en: 'Domain organization: I/II/III partition with functional site annotations' } },
    citation: { journal: 'Nature', year: 2020, title: 'Structure of Mpro from SARS-CoV-2 and discovery of its inhibitors', doi: '10.1038/s41586-020-2223-y' },
    demo: '6LU7',
    // 差异点：三域四段纯色（I 1-99 teal · II 100-182 orange · linker 183-197 gray ·
    // III 198-306 slate）——区间按 SARS-CoV-2 Mpro 域界（Alzyoud 2022 综述）；
    // adapt 层对短结构给诚实截断说明
    commands: ['preset cartoon', 'util cbc', 'bg white', 'color teal, (resi 1-99)', 'color orange, (resi 100-182)', 'color gray, (resi 183-197)', 'color slate, (resi 198-306)', 'orient', 'outline on 1.1 1.0'],
    accent: 'sky',
  },
  {
    id: 'mutation-hotspots',
    name: { zh: '突变热点图', en: 'Mutation hotspots' },
    tagline: { zh: 'B 因子通道热点高亮 + 残基标签：变异位点与关键残基标注图式', en: 'B-factor channel hotspots + residue labels: variant and key-residue annotation' },
    purpose: { zh: '疾病突变 · 催化残基 · 功能位点标注', en: 'Disease variants · catalytic residues · functional site annotation' },
    tags: [{ zh: '突变', en: 'Variants' }, { zh: '标注', en: 'Annotation' }],
    category: 'site',
    figure: { ref: '机制图版', shows: { zh: '变异位点图：关键残基标注 + 生化后果注解', en: 'Variant map: key residues annotated with biochemical consequences' } },
    citation: { journal: 'Nature', year: 1970, title: 'Stereochemistry of cooperative effects in haemoglobin: haem-haem interaction and the problem of allostery', doi: '10.1038/228726a0' },
    demo: '4HHB',
    // 差异点：alter B 因子通道改写（热点=100 其余=0）→ spectrum b 热图 + 热点整残基红球
    // （可见性关键：18 个热点原子在全景下太小——球化后红色热点在蓝底上一眼可辨，
    // r75 E2E 实证纯 spectrum b 路径 VLM 判「uniform blue」后补的设计）+ CA 标签；
    // 演示位点为 Hb 经典（β6 镰刀位点 · α87/β92 近端组氨酸——血红素配位）；
    // 链不匹配时 adapt 降级为天然 B 因子柔性热图
    commands: [
      'preset cartoon', 'bg white',
      'alter (polymer), b=0',
      'alter (resi 6 and chain B+D), b=100',
      'alter (resi 87 and chain A+C), b=100',
      'alter (resi 92 and chain B+D), b=100',
      'spectrum b, rainbow',
      'show spheres, ((resi 6 and chain B+D) or (resi 87 and chain A+C) or (resi 92 and chain B+D))',
      'select (name CA) and ((resi 6 and chain B+D) or (resi 87 and chain A+C) or (resi 92 and chain B+D))',
      'label on',
      'orient', 'outline on 1.1 1.0',
    ],
    accent: 'fuchsia',
  },

  // ── r76 位点特写扩容：共价交联与金属配位两大经典「位点图」──
  // 命令语法全部 E2E 预验证：3INS 实测 resn CYS 12 残基（黄棍在位）；2CBA 实测
  // resn ZN 1 离子（橙球 + 3.2Å 配位棍 + 8Å 聚焦构图全部生效）
  {
    id: 'disulfide-bonds',
    name: { zh: '二硫键网络', en: 'Disulfide network' },
    tagline: { zh: '半胱氨酸黄棍 + 链分色卡通：共价交联架构一图判读', en: 'Cysteine yellow sticks + chain-colored cartoon: covalent cross-linking at a glance' },
    purpose: { zh: '链间交联 · 折叠稳定 · 工程改造', en: 'Inter-chain crosslinks · fold stability · engineering' },
    tags: [{ zh: '二硫键', en: 'Disulfide' }, { zh: '共价交联', en: 'Crosslinks' }],
    category: 'site',
    figure: { ref: 'Fig. 1', shows: { zh: '胰岛素首图：A/B 链二硫交联（A6-A11 链内 + A7-B7 / A20-B19 链间）', en: 'Insulin opening figure: A/B-chain disulfide crosslinks (A6-A11 intra + A7-B7 / A20-B19 inter)' } },
    citation: { journal: 'Nature', year: 1969, title: 'Structure of rhombohedral 2 zinc insulin crystals', doi: '10.1038/224491a0' },
    demo: '3INS',
    // 差异点：黄棍 CYS 语义色（胰岛素二硫键教科书图式）+ 链分色卡通（交联归属可辨）
    // + 白底细描边；adapt 层规则⑩：无 CYS 时诚实说明（命令仍跑、自然 no-op）
    commands: ['preset cartoon', 'util cbc', 'bg white', 'show sticks, resn CYS', 'color yellow, resn CYS', 'orient', 'outline on 1.1 1.0'],
    accent: 'amber',
  },
  {
    id: 'metal-center',
    name: { zh: '金属活性中心', en: 'Metal active center' },
    tagline: { zh: '金属橙球 + 配位残基棍 + 位点聚焦：金属酶催化几何一图判读', en: 'Orange metal sphere + coordinating sticks + site zoom: metalloenzyme geometry at a glance' },
    purpose: { zh: '催化机制 · 配位几何 · 抑制剂设计', en: 'Catalysis · coordination geometry · inhibitor design' },
    tags: [{ zh: '金属酶', en: 'Metalloenzyme' }, { zh: '配位几何', en: 'Coordination' }],
    category: 'site',
    figure: { ref: 'Fig. 2', shows: { zh: '金属配位几何图：锌位点配位键 + 螺旋取向（Cys2His2 型图式源流）', en: 'Coordination geometry figure: zinc-site ligation and helix presentation (the Cys2His2 archetype)' } },
    // 图式源：Pavletich & Pabo 1991 Science 252:809（Zif268 锌指——金属配位几何图的
    // 奠基图式）；演示取材 2CBA 牛 CA II（经典锌金属酶，催化锌 + 配位残基齐全）
    citation: { journal: 'Science', year: 1991, title: 'Zinc finger-DNA recognition: crystal structure of a Zif268-DNA complex at 2.1 Å', doi: '10.1126/science.2028256' },
    demo: '2CBA',
    // 差异点：金属橙球（视觉锚点）+ 3.2Å 配位残基棍（几何可读）+ 8Å 聚焦（催化
    // 中心满幅）+ 彩虹全局（上下文）；adapt 层规则⑨：无 ZN 时重映射结构内其它
    // 金属离子（MG/FE/MN/CU/NI/CA/K/NA…）或整组退避
    commands: ['preset cartoon', 'spectrum count, rainbow', 'bg white', 'show spheres, resn ZN', 'color orange, resn ZN', 'show sticks, byres(within 3.2 of (resn ZN))', 'zoom byres(within 8 of (resn ZN))', 'outline on 1.1 1.0'],
    accent: 'cyan',
  },
]

/** 命令图鉴（r75：「对比」视图把命令序列翻成双语图式解剖；未命中退回原命令）。
 *  规则序：具体在前（contacts (resn ASP… 先于 contacts；show sticks, nucleic 先于 show sticks） */
export const COMMAND_GLOSSARY: { re: RegExp; label: DualText }[] = [
  { re: /^preset cartoon\b/i, label: { zh: '卡通带表示', en: 'Cartoon ribbons' } },
  { re: /^preset surface\b/i, label: { zh: '分子表面表示', en: 'Molecular surface' } },
  { re: /^preset bindingsite\b/i, label: { zh: '结合位点特写（球棍）', en: 'Binding-site close-up (ball & stick)' } },
  { re: /^preset publication\b/i, label: { zh: '出版级互作预设', en: 'Publication preset' } },
  { re: /^spectrum count/i, label: { zh: 'N→C 彩虹渐变', en: 'N→C rainbow gradient' } },
  { re: /^spectrum b\b/i, label: { zh: 'B 因子热图渐变', en: 'B-factor heatmap gradient' } },
  { re: /^util cbc/i, label: { zh: '逐链配色', en: 'Per-chain coloring' } },
  { re: /^util ss\b/i, label: { zh: '二级结构三色', en: 'Secondary-structure colors' } },
  { re: /^color residue, nucleic/i, label: { zh: '核酸碱基五色', en: 'Nucleic base coloring' } },
  { re: /^color sasa/i, label: { zh: 'SASA 可及性渐变', en: 'SASA gradient' } },
  { re: /^color red, resn/i, label: { zh: '酸性残基红（ASP/GLU）', en: 'Acidic residues red (ASP/GLU)' } },
  { re: /^color blue, resn/i, label: { zh: '碱性残基蓝（LYS/ARG/HIS）', en: 'Basic residues blue (LYS/ARG/HIS)' } },
  { re: /^color yellow, resn/i, label: { zh: '半胱氨酸黄（二硫键）', en: 'Cysteines yellow (disulfides)' } },
  { re: /^color orange, resn/i, label: { zh: '金属离子橙', en: 'Metal ion orange' } },
  { re: /^color (teal|orange|gray|slate|sky|amber)\b/i, label: { zh: '结构域分段纯色', en: 'Domain partition color' } },
  { re: /^bg (white|#)/i, label: { zh: '期刊制版底色', en: 'Publication background' } },
  { re: /^outline on/i, label: { zh: '发丝级描边', en: 'Hairline outlines' } },
  { re: /^orient\b/i, label: { zh: '主轴对齐视角', en: 'Principal-axis view' } },
  { re: /^view (front|top)/i, label: { zh: '正交预设视角', en: 'Orthographic preset view' } },
  { re: /^turn [xyz]/i, label: { zh: '视角微调', en: 'Camera fine-turn' } },
  { re: /^set cartoon_width/i, label: { zh: '卡通宽度调整', en: 'Cartoon width tuning' } },
  { re: /^set ambient/i, label: { zh: '平光照明', en: 'Flat ambient light' } },
  { re: /^ray \d+/i, label: { zh: 'Ray 超采样渲染', en: 'Ray supersampled render' } },
  { re: /^map fetch/i, label: { zh: '电子密度网格叠加', en: 'Density mesh overlay' } },
  { re: /^interface\s/i, label: { zh: '界面接触虚线', en: 'Interface contact dashes' } },
  { re: /^contacts \(resn ASP/i, label: { zh: '盐桥残基对虚线', en: 'Salt-bridge pair dashes' } },
  { re: /^contacts protein \| nucleic/i, label: { zh: '蛋白-核酸接触虚线', en: 'Protein–nucleic contact dashes' } },
  { re: /^contacts/i, label: { zh: '残基对接触虚线', en: 'Residue-pair contact dashes' } },
  { re: /^hbonds on .*within/i, label: { zh: '范围氢键虚线', en: 'Scoped H-bond dashes' } },
  { re: /^hbonds on/i, label: { zh: '全局氢键虚线', en: 'Global H-bond dashes' } },
  { re: /^symmetry \d+/i, label: { zh: '晶体对称伙伴', en: 'Symmetry mates' } },
  { re: /^ensemble play/i, label: { zh: 'NMR 构象系综动画', en: 'NMR ensemble animation' } },
  { re: /^membrane \d+/i, label: { zh: '脂双层板语境', en: 'Bilayer slab context' } },
  { re: /^pore\b/i, label: { zh: 'HOLE 孔道剖面环带', en: 'HOLE pore rings' } },
  { re: /^show sticks, nucleic/i, label: { zh: 'DNA 棍状表示', en: 'DNA sticks' } },
  { re: /^show sticks, byres/i, label: { zh: '配位残基棍（金属邻域）', en: 'Coordinating residues (metal neighborhood)' } },
  { re: /^show sticks/i, label: { zh: '侧链棍状表示', en: 'Sidechain sticks' } },
  { re: /^show spheres, resn/i, label: { zh: '金属离子球状标记', en: 'Metal ion spheres' } },
  { re: /^show spheres/i, label: { zh: '热点位球状标记', en: 'Hotspot site spheres' } },
  { re: /^zoom byres/i, label: { zh: '界面聚焦取景', en: 'Interface-focused framing' } },
  { re: /^zoom/i, label: { zh: '聚焦取景', en: 'Focused framing' } },
  { re: /^alter \(polymer\)/i, label: { zh: 'B 因子基线归零', en: 'B-factor baseline reset' } },
  { re: /^alter .*b=100/i, label: { zh: '热点位 B 因子置顶', en: 'Hotspot B-factor maxed' } },
  { re: /^alter/i, label: { zh: 'B 因子通道改写', en: 'B-factor channel edit' } },
  { re: /^select/i, label: { zh: '热点位点选择', en: 'Hotspot site selection' } },
  { re: /^label on/i, label: { zh: '残基标签', en: 'Residue labels' } },
]

/** 命令 → 双语图式解剖（未命中返回 null——调用方退回展示原命令） */
export function explainCommand(cmd: string): DualText | null {
  for (const g of COMMAND_GLOSSARY) if (g.re.test(cmd.trim())) return g.label
  return null
}

/** 相机类命令（执行前需确认在飞相机动画已落地——见 runTemplateCommands） */
const CAMERA_CMD_RE = /^(orient|view|views|turn|move|zoom|dolly|rock|bookmark|clip)\b/i

/** 等待相机动画落地（r76：orient 650ms 飞行后 120ms 接 turn 会把相机打断在
 *  partial pose——KcsA 竖排环带/演示居中的另一半根因；上限兑底防僵死） */
async function waitForCameraIdle(maxMs: number): Promise<void> {
  const t0 = performance.now()
  while (performance.now() - t0 < maxMs) {
    const eng = engineRef.current
    if (!eng || !eng.isCameraAnimating()) return
    await new Promise(r => setTimeout(r, 60))
  }
}

/** 等待结构真正入 store（r76：fetchPdbId resolve 在 parse 前——欢迎页首发链路
 *  parse 走 rAF 异步，旧 600ms 定时器靠运气；超时兑底返 false） */
async function waitForStructureInStore(pdbId: string, maxMs: number): Promise<boolean> {
  const target = pdbId.trim().toUpperCase()
  const t0 = performance.now()
  while (performance.now() - t0 < maxMs) {
    const s = useMolStore.getState()
    if (s.structures.some(x => (x.meta.pdbId ?? '').toUpperCase() === target || x.name.toUpperCase() === target)) return true
    await new Promise(r => setTimeout(r, 80))
  }
  return false
}

/** 按命令序列逐条应用（120ms 微间隔衔接聚焦动画/worker 着色；r76：相机命令
 *  先等在飞相机动画落地再执行——非相机命令不受影响，节奏不变） */
export function runTemplateCommands(commands: string[]): void {
  commands.forEach((cmd, i) => {
    setTimeout(() => {
      if (CAMERA_CMD_RE.test(cmd.trim())) {
        void waitForCameraIdle(1800).then(() => runCommand(cmd))
      } else {
        runCommand(cmd)
      }
    }, i * 120)
  })
}

// ── 模板参数化适配（r73 创立 · r75 扩展四条）──────────────────────
// adaptTemplateCommands：对当前活动结构逐条改写模板命令——历史问题：模板命令按演示结构特征硬编码（interface A B / map fetch 3ekj /
// preset bindingsite / symmetry），用户结构特征不符时命令部分失效——弹 warning
// 或干脆错配（密度图挂到别的结构上）。适配层在应用前逐条探测并改写：
//  ① interface A B → 前两条非水链重映射；单链跳过
//  ② map fetch <演示ID> → 活动结构 pdbId；本地文件（无编号）跳过
//  ③ preset bindingsite → 无配体降级 preset cartoon
//  ④ symmetry → 无晶胞（CRYST1）跳过
//  ⑤（r75）hbonds … within 5 of (ligand) → 无配体退避主链氢键网络（backbone scaffold 视图仍是有用图）
//  ⑥（r75）核酸三命令（color residue, nucleic / show sticks, nucleic / contacts protein|nucleic）→ 无核酸链逐条跳过
//  ⑦（r75）结构域区间命令 → 聚合物短于域界时诚实截断说明（命令仍执行，超出区间自然 no-op）
//  ⑧（r75）链特异热点（alter/select 引用 chain A-D）→ 链不匹配时退避天然 B 因子热图（跳过 alter/select/label）
//  ⑨（r76）金属中心（resn ZN 四命令）→ 重映射结构内实际金属离子（MG/FE/MN…）；
//          无任何金属时整组跳过（球化空选择会得到无球金属酶图——诚实跳过）
//  ⑩（r76）二硫键网络（resn CYS 两命令）→ 无半胱氨酸时诚实说明（命令仍跑、
//          选择自然 no-op——与⑦同哲学：可空转但要说清楚）
// notes 携带每条降级说明（调用方 toast/appendLog 呈现）——「诚实降级」而非静默吞命令。
// demoThenApply 不走此层：演示结构即模板取材结构，特征必然齐备。

export interface AdaptedTemplate {
  /** 适配后的命令序列（原样或改写/跳过后） */
  commands: string[]
  /** 降级/重映射说明（空 = 完美适配） */
  notes: DualText[]
}

/** 对当前活动结构适配模板命令（无结构时原样返回——调用方负责引导先加载） */
export function adaptTemplateCommands(tpl: FigureTemplate): AdaptedTemplate {
  const s = useMolStore.getState()
  const active = s.structures.find(x => x.id === s.activeId) ?? s.structures[0]
  if (!active) return { commands: tpl.commands, notes: [] }
  const data = dataRegistry.get(active.id)
  if (!data) return { commands: tpl.commands, notes: [] }

  const notes: DualText[] = []
  const commands: string[] = []
  // r75 预探测（规则⑤⑥⑦⑧共用）：有无配体 / 有无核酸链 / 聚合物最大残基号 / 热点链拓扑匹配
  const hasLigand = !!active.summary.ligandMolecules
  const hasNucleic = data.chains.some(c => c.type === 'nucleic')
  const polyChains = data.chains.filter(c => c.type === 'protein' || c.type === 'nucleic')
  const chainIds = new Set(polyChains.map(c => c.id.trim().toUpperCase()))
  let maxResi = 0
  for (const ch of data.chains) {
    if (ch.type === 'water') continue
    for (const ri of ch.residueIdx) {
      const r = data.residues[ri]
      if (r && r.resSeq > maxResi) maxResi = r.resSeq
    }
  }
  // ⑧ 预扫描：模板引用的演示链字母（chain A-D）任一缺失 → 热点体系不适用
  //   （alter 基线+热点置顶+select+label 整组跳过，保留 spectrum b 展示天然 B 因子柔性热图；
  //    若放过基线归零而热点置顶被跳过，会得到全蓝空图——预扫描的动机）
  const tplChainRefs = new Set<string>()
  for (const c of tpl.commands) for (const m of c.matchAll(/chain ([A-D])/gi)) tplChainRefs.add(m[1].toUpperCase())
  const hotspotMismatch = tplChainRefs.size > 0 && [...tplChainRefs].some(c => !chainIds.has(c))
  // ⑨ 预探测：金属离子（模板按演示结构 ZN 硬编码——用户结构可能是 MG/FE…或无金属）
  const METAL_RESNS = ['ZN', 'MG', 'MN', 'FE', 'CU', 'NI', 'CO', 'CA', 'K', 'NA', 'CD', 'HG']
  const metalsPresent = active.ligands.map(l => l.resName.trim().toUpperCase()).filter(r => METAL_RESNS.includes(r))
  const hasZn = metalsPresent.includes('ZN')
  const altMetal = metalsPresent.find(m => m !== 'ZN')
  const tplMetal = /resn ZN\b/i.test(tpl.commands.join('\n'))
  let metalNoted = false
  // ⑩ 预探测：有无半胱氨酸（二硫键模板）
  let hasCys = false
  for (const ch of data.chains) {
    if (ch.type === 'water') continue
    for (const ri of ch.residueIdx) {
      const r = data.residues[ri]
      if (r && r.resName === 'CYS') { hasCys = true; break }
    }
    if (hasCys) break
  }
  const tplDisulfide = /resn CYS\b/i.test(tpl.commands.join('\n'))
  let domainNoted = false
  for (const cmd of tpl.commands) {
    // ① 界面接触：链重映射 / 单链跳过
    if (/^interface\s/i.test(cmd)) {
      const poly = data.chains.filter(c => c.type !== 'water')
      if (poly.length < 2) {
        notes.push({ zh: '单链结构——界面接触命令已跳过（需 ≥2 条链）', en: 'Single-chain structure — interface contacts skipped (needs ≥2 chains)' })
        continue
      }
      const [a, b] = [poly[0].id.trim() || 'A', poly[1].id.trim() || 'B']
      if (cmd !== `interface ${a} ${b}`) {
        notes.push({ zh: `界面命令已重映射为链 ${a}/${b}（模板按演示结构的链命名）`, en: `Interface command remapped to chains ${a}/${b} (template assumes the demo structure's chains)` })
      }
      commands.push(`interface ${a} ${b}`)
      continue
    }
    // ② 密度图：来源切到当前结构 / 无编号跳过
    if (/^map fetch\s/i.test(cmd)) {
      const demoId = cmd.replace(/^map fetch\s/i, '').trim()
      const pdbId = active.meta.pdbId
      if (!pdbId) {
        notes.push({ zh: '当前结构无 PDB 编号（本地文件）——密度图命令已跳过（可手动 map fetch）', en: 'Current structure has no PDB ID (local file) — density map skipped (map fetch manually if needed)' })
        continue
      }
      if (demoId.toLowerCase() !== pdbId.toLowerCase()) {
        notes.push({ zh: `密度图来源已切换为当前结构 ${pdbId}（模板演示 ${demoId.toUpperCase()}）`, en: `Density map source switched to the current structure ${pdbId} (template demos ${demoId.toUpperCase()})` })
        commands.push(`map fetch ${pdbId.toLowerCase()}`)
        continue
      }
      commands.push(cmd)
      continue
    }
    // ③ 口袋特写：无配体降级（summary 在 store 的结构条目上）
    if (/^preset bindingsite/i.test(cmd)) {
      if (!active.summary.ligandMolecules) {
        commands.push('preset cartoon')
        notes.push({ zh: '未检出配体——口袋特写已降级为卡通概览', en: 'No ligands detected — pocket close-up degraded to cartoon overview' })
        continue
      }
      commands.push(cmd)
      continue
    }
    // ④ 对称伙伴：无晶胞跳过
    if (/^symmetry\s/i.test(cmd)) {
      if (!data.crystal) {
        notes.push({ zh: '无晶胞信息（CRYST1 缺失，常见于 NMR/预测模型）——对称伙伴命令已跳过', en: 'No crystal cell info (CRYST1 missing, common for NMR/predicted models) — symmetry mates skipped' })
        continue
      }
      commands.push(cmd)
      continue
    }
    // ⑤（r75）配体氢键：无配体退避主链氢键网络（保留 preset 部分——③ 已降级特写）
    if (/^hbonds on .*within \d+ of \(ligand\)/i.test(cmd)) {
      if (!hasLigand) {
        commands.push('hbonds on 3.2 in backbone')
        notes.push({ zh: '未检出配体——配体氢键网络已退避为主链氢键网络（二级结构 scaffold 视图）', en: 'No ligands detected — ligand H-bond network fell back to backbone H-bonds (secondary-structure scaffold view)' })
        continue
      }
      commands.push(cmd)
      continue
    }
    // ⑥（r75）核酸四命令（color residue, nucleic / show sticks, nucleic / contacts protein|nucleic /
    //    zoom …nucleic）：无核酸链逐条跳过（提示一次，避免刷屏）
    if (/^color residue, nucleic/i.test(cmd) || /^show sticks, nucleic/i.test(cmd) || /^contacts protein \| nucleic/i.test(cmd) || /^zoom .*nucleic/i.test(cmd)) {
      if (!hasNucleic) {
        if (notes.every(n => !n.zh.includes('无核酸'))) {
          notes.push({ zh: '当前结构无核酸链——DNA 相关命令已跳过（适用于蛋白-DNA/RNA 复合物）', en: 'No nucleic chains detected — DNA-specific commands skipped (meant for protein–DNA/RNA complexes)' })
        }
        continue
      }
      commands.push(cmd)
      continue
    }
    // ⑦（r75）结构域区间：聚合物短于域界时诚实截断说明（命令仍执行——超出区间自然 no-op）
    if (/^color (teal|orange|gray|slate)\b.*resi/i.test(cmd) && !domainNoted) {
      if (maxResi > 0 && maxResi < 250) {
        domainNoted = true
        notes.push({ zh: `结构域区间按 SARS-CoV-2 Mpro 域界定义（至 306 号）——当前结构最长链 ${maxResi} 残基，超出部分自然不适用，可手动 color resi 自定义域界`, en: `Domain ranges follow the SARS-CoV-2 Mpro boundaries (up to residue 306) — the longest chain here is ${maxResi} residues; ranges beyond fold in naturally, or set custom ones via color resi` })
      }
      commands.push(cmd)
      continue
    }
    // ⑧（r75）热点链拓扑不匹配：引用演示链字母（chain A-D）的命令 + alter 基线 + label 整组跳过
    //    （基线归零也不能放——否则归零后无热点置顶 = 全蓝空图；球化/选择同理跳过）；
    //    spectrum b 保留 → 天然 B 因子柔性热图降级
    if (hotspotMismatch) {
      const refsDemoChain = /chain [A-D]/i.test(cmd)
      if (refsDemoChain || /^alter /i.test(cmd) || /^label on/i.test(cmd)) {
        // 去重键 =「链不匹配」——与文案严格对齐（r75 E2E 揭发：曾用「链拓扑不匹配」
        // 检文案致 7 条重复 note 刷屏）
        if (notes.every(n => !n.zh.includes('链不匹配'))) {
          notes.push({ zh: '热点位点按 Hb 演示结构（4HHB 的 α/β 链拓扑）——当前结构链不匹配，已改展示天然 B 因子柔性热图（可用 select + alter 标注自己的热点）', en: 'Hotspot sites follow the Hb demo (4HHB α/β chain topology) — chain mismatch detected; showing the native B-factor flexibility map instead (mark your own via select + alter)' })
        }
        continue
      }
    }
    // ⑨（r76）金属中心：模板按演示结构 ZN 硬编码——重映射结构内实际金属
    //    （resn ZN → resn MG/FE/…）；无任何金属时四命令整组跳过（一次提示）
    if (tplMetal && /resn ZN\b/i.test(cmd)) {
      if (!hasZn && !altMetal) {
        if (notes.every(n => !n.zh.includes('未检出金属离子'))) {
          notes.push({ zh: '未检出金属离子——金属中心命令组已跳过（适用于锌酶/金属酶等含金属结构）', en: 'No metal ions detected — metal-center commands skipped (meant for metalloproteins)' })
        }
        continue
      }
      if (!hasZn && altMetal) {
        commands.push(cmd.replace(/resn ZN\b/gi, `resn ${altMetal}`))
        // 去重键 =「金属中心已重映射」——与文案严格对齐（r75 E2E 教训：去重键与
        // 文案错位会按命令条数刷屏；r76 当轮 E2E 再揭发一次同类坑）
        if (notes.every(n => !n.zh.includes('金属中心已重映射'))) {
          notes.push({ zh: `金属中心已重映射为结构内的 ${altMetal} 离子（模板演示 ZN 锌）`, en: `Metal center remapped to the structure's ${altMetal} ion (template demos ZN zinc)` })
        }
        continue
      }
      commands.push(cmd)
      continue
    }
    // ⑩（r76）二硫键网络：无半胱氨酸时诚实说明（命令仍跑——空选择自然 no-op，
    //     与⑦域区间同哲学：可空转但要说清楚；一次提示）
    if (tplDisulfide && /resn CYS\b/i.test(cmd) && !hasCys) {
      if (notes.every(n => !n.zh.includes('无半胱氨酸'))) {
        notes.push({ zh: '当前结构无半胱氨酸（CYS）——二硫键棍为空选择自然不显示（适用于含 CYS 的结构）', en: 'No cysteines (CYS) in this structure — disulfide sticks select nothing (meant for CYS-containing structures)' })
      }
      commands.push(cmd)
      continue
    }
    commands.push(cmd)
  }
  return { commands, notes }
}

/** 适配说明入命令日志（应用方调用——诚实降级的可追溯通道） */
export function logAdaptNotes(notes: DualText[]): void {
  for (const n of notes) useMolStore.getState().appendLog('out', tt(n))
}

/** 加载演示结构并应用模板（「演示」按钮：100% 还原缩略图的取材路径）。
 *  r76 居中根治：旧实现 fetchPdbId 后固定 600ms 就跑命令——但欢迎页首发链路里
 *  parse 走 rAF 异步、MolViewer（dynamic chunk）晚于结构挂载、自动 fit 是
 *  650ms 动画，三者叠加时 turn/view 命令会在 fit 半途把相机打断在 partial pose
 *  （1D3Z NMR 演示「结构不在屏幕中心」的根因）。新序列：结构入 store →
 *  引擎就绪 → 自动 fit 落地 → 才开始命令序列（runTemplateCommands 内部再对
 *  相机命令串行等飞行，见上） */
export async function demoThenApply(tpl: FigureTemplate): Promise<void> {
  await fetchPdbId(tpl.demo)
  const loaded = await waitForStructureInStore(tpl.demo, 8000)
  if (!loaded) return // fetch 失败已 toast；兑底防僵死
  // 引擎挂载（欢迎页首发：结构入 store 后 MolViewer 才开始挂载；fitView 已在
  // whenEngineReady 队列里，先于本 resolver 入队 → 冲刷时先起飞）
  await new Promise<void>(res => whenEngineReady(() => res()))
  // 冲刷后 fit 起飞还差一拍 rAF（loader 的入队体是 rAF(fitView)）——先过两帧
  // 再等飞行，否则 waitForCameraIdle 首检时动画尚未起飞会假性「立即落地」
  await new Promise(r => setTimeout(r, 80))
  // 自动 fit 飞行落地（normal 650ms / cinematic 1200ms 都等完；无动画时立即过）
  await waitForCameraIdle(2600)
  await new Promise(r => setTimeout(r, 100)) // 落位后一拍余量
  runTemplateCommands(tpl.commands)
}
