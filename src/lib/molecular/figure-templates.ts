'use client'

// 论文图复现模板（r71 创立 · r72 差异化打磨 + 特定蛋白类型分析模板）
// ─────────────────────────────────────────────────────────────────────────────
// 定位：把 Cell / Nature / Science 等高影响力结构生物学文章中反复出现的「图式」
// （figure style）——表示法组合 + 配色 + 视角 + 灯光 + 轮廓 + 相机——固化为命令
// 序列模板。一键应用到用户当前结构，快速得到 CNS 级别作图。
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
import type { DualText } from '@/i18n'

/** 图式来源文献（真实引用，经检索核实；doi 可省略——避免不确定引用伤害可信度） */
export interface FigureCitation {
  journal: 'Nature' | 'Science' | 'Cell'
  year: number
  /** 论文短标题（截取主短语） */
  title: string
  doi?: string
}

/** 模板分类：通用图式（任意蛋白）vs 特定蛋白类型（膜蛋白/离子通道分析） */
export type FigureCategory = 'general' | 'membrane'

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
  /** 分类（弹窗过滤 chips：通用 / 膜蛋白·通道） */
  category: FigureCategory
  /** 图式参考来源 */
  citation: FigureCitation
  /** 代表结构（缩略图渲染用；「演示」按钮加载它再应用） */
  demo: string
  /** 复现命令序列（全部为已验证命令语法） */
  commands: string[]
  /** 卡片强调色（Tailwind 类族名，用于占位渐变与 hover 边框） */
  accent: 'rose' | 'emerald' | 'amber' | 'sky' | 'violet' | 'teal' | 'orange' | 'fuchsia' | 'lime' | 'cyan' | 'slate'
}

/** 分类元数据（弹窗过滤 chips） */
export const FIGURE_CATEGORIES: { key: FigureCategory | 'all'; label: DualText }[] = [
  { key: 'all', label: { zh: '全部', en: 'All' } },
  { key: 'general', label: { zh: '通用图式', en: 'General styles' } },
  { key: 'membrane', label: { zh: '膜蛋白 · 通道', en: 'Membrane · channels' } },
]

export const FIGURE_TEMPLATES: FigureTemplate[] = [
  {
    id: 'rainbow-overview',
    name: { zh: '彩虹全景', en: 'Rainbow overview' },
    tagline: { zh: 'N→C 渐变卡通 + 白底细描边：结构文首图惯例', en: 'N→C rainbow cartoon on white with hairline outlines: the classic opening figure' },
    purpose: { zh: '整体概览 · 折叠走向 · 组装示意', en: 'Overall architecture · fold topology · assembly' },
    tags: [{ zh: '整体结构', en: 'Overview' }, { zh: '首图', en: 'Panel A' }],
    category: 'general',
    citation: { journal: 'Science', year: 2020, title: 'Cryo-EM structure of the 2019-nCoV spike in the prefusion conformation', doi: '10.1126/science.abb2507' },
    demo: '4HHB',
    // 差异点：纯白底 + 细描边 + PCA 主轴对齐（基线「经典款」，其余模板均偏离它）
    commands: ['preset cartoon', 'spectrum count, rainbow', 'bg white', 'outline on 1.3 1.2', 'orient'],
    accent: 'rose',
  },
  {
    id: 'chain-assembly',
    name: { zh: '亚基分色组装', en: 'Chain assembly' },
    tagline: { zh: '逐链配色 + 加宽卡通 + 冷灰底正面视角：寡聚体组成一目了然', en: 'Per-chain coloring + widened cartoon + cool-gray front view: oligomer composition at a glance' },
    purpose: { zh: '多亚基组装 · 化学计量 · 界面初判', en: 'Multi-subunit assembly · stoichiometry · interfaces' },
    tags: [{ zh: '寡聚体', en: 'Oligomer' }, { zh: '复合物', en: 'Complex' }],
    category: 'general',
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
    category: 'general',
    citation: { journal: 'Nature', year: 2024, title: 'Structural and molecular basis of choline uptake into the brain by FLVCR2', doi: '10.1038/s41586-024-57361-2' },
    demo: '1AKI',
    // 差异点：暖象牙底（#fbf8f1）+ 斜侧视角 turn y -20（基元交叠可辨）+ 细描边
    commands: ['preset cartoon', 'util ss', 'bg #fbf8f1', 'turn y -20', 'outline on 1.2 1.1'],
    accent: 'amber',
  },
  {
    id: 'ligand-pocket',
    name: { zh: '配体口袋特写', en: 'Ligand pocket close-up' },
    tagline: { zh: '口袋球棍 + 元素着色 + 自动聚焦 + 细描边：药物靶点文主角图', en: 'Pocket ball-stick + element coloring + auto-zoom + hairline edges: the drug-target hero figure' },
    purpose: { zh: '抑制剂设计 · 互作残基 · 靶点验证', en: 'Inhibitor design · contacting residues · target validation' },
    tags: [{ zh: '药物靶点', en: 'Drug target' }, { zh: '互作', en: 'Interactions' }],
    category: 'general',
    citation: { journal: 'Nature', year: 2020, title: 'Structure of Mpro from SARS-CoV-2 and discovery of its inhibitors', doi: '10.1038/s41586-020-2223-y' },
    demo: '6LU7',
    // 差异点：白底特写（bindingsite 自动聚焦）+ 细描边——近景描边必须细，粗线会糊掉球棍
    commands: ['preset bindingsite', 'bg white', 'outline on 1.3 1.2'],
    accent: 'emerald',
  },
  {
    id: 'sasa-surface',
    name: { zh: '可及性表面', en: 'SASA surface' },
    tagline: { zh: 'SASA 渐变表面 + 冷雾底无描边：疏水核心与 patch 分布', en: 'SASA-graded surface on cool mist, outline-free: hydrophobic cores and patch distribution' },
    purpose: { zh: '表面性质 · 疏水 patch · 界面预测', en: 'Surface properties · hydrophobic patches · interface prediction' },
    tags: [{ zh: '表面', en: 'Surface' }, { zh: '疏水性', en: 'Hydrophobicity' }],
    category: 'general',
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
    category: 'general',
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
    category: 'general',
    citation: { journal: 'Nature', year: 2026, title: 'Next-generation inhibitors of SARS-CoV-2 Mpro overcome Paxlovid deficiencies' },
    demo: '6LU7',
    // 差异点：冷灰底 + 正面视角（界面正对读者，接触线全程可见）+ 细描边
    commands: ['preset cartoon', 'util cbc', 'interface A B', 'bg #f5f7fa', 'view front', 'outline on 1.3 1.2'],
    accent: 'orange',
  },
  {
    id: 'symmetry-assembly',
    name: { zh: '晶体对称伙伴', en: 'Symmetry mates' },
    tagline: { zh: '对称伴侣 + 俯视晶格视角：结晶学组装语境图', en: 'Symmetry mates + top-down lattice view: crystallographic packing context' },
    purpose: { zh: '生物组装判读 · 晶格核对', en: 'Biological assembly · lattice cross-check' },
    tags: [{ zh: '晶体学', en: 'Crystallography' }, { zh: '组装', en: 'Assembly' }],
    category: 'general',
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
    category: 'general',
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
    category: 'general',
    citation: { journal: 'Nature', year: 2026, title: 'Next-generation inhibitors of SARS-CoV-2 Mpro overcome Paxlovid deficiencies' },
    demo: '4HHB',
    // 差异点：纯白底 + Ray 1920 静帧（超采样 AA）+ 发丝描边 1.3 1.2（r72 减细主战场）
    commands: ['preset publication', 'bg white', 'outline on 1.3 1.2', 'ray 1920'],
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
    citation: { journal: 'Science', year: 1998, title: 'The Structure of the Potassium Channel: Molecular Basis of K+ Conduction and Selectivity', doi: '10.1126/science.280.5360.69' },
    demo: '1BL8',
    // 差异点（分析模板）：membrane 34 脂双层 + pore 计算环带（红/绿/蓝）+ 主轴对齐竖排视角
    commands: ['preset cartoon', 'util cbc', 'bg white', 'membrane 34', 'pore', 'orient', 'turn z 90', 'outline on 1.3 1.2'],
    accent: 'slate',
  },
  {
    id: 'membrane-embed',
    name: { zh: '膜蛋白脂双层语境', en: 'Membrane-embedded context' },
    tagline: { zh: '表面渐变 + 橙头基双层板 + 侧视：膜蛋白跨膜区一图判读', en: 'Gradient surface + orange headgroup slab + side view: transmembrane extent at a glance' },
    purpose: { zh: '跨膜深度 · 膜界面 patch · β-桶/螺旋束', en: 'TM span · interfacial patches · barrel vs helix bundle' },
    tags: [{ zh: '膜蛋白', en: 'Membrane' }, { zh: '水通道', en: 'Aquaporin' }],
    category: 'membrane',
    citation: { journal: 'Science', year: 2002, title: 'Structure of a glycerol-conducting channel and the basis for its selectivity', doi: '10.1126/science.1072457' },
    demo: '1FX8',
    // 差异点：SASA 渐变表面 + 脂双层板（跨膜区灰表面嵌入橙头基之间）+ 正面侧视
    commands: ['preset surface', 'color sasa', 'bg #f5f7fa', 'membrane 32', 'view front'],
    accent: 'orange',
  },
]

/** 按命令序列逐条应用（120ms 微间隔衔接聚焦动画/worker 着色） */
export function runTemplateCommands(commands: string[]): void {
  commands.forEach((cmd, i) => {
    setTimeout(() => runCommand(cmd), i * 120)
  })
}

/** 加载演示结构并应用模板（「演示」按钮：100% 还原缩略图的取材路径） */
export async function demoThenApply(tpl: FigureTemplate): Promise<void> {
  await fetchPdbId(tpl.demo)
  // 加载 resolve 后引擎首帧 rep 建立需一拍
  await new Promise(r => setTimeout(r, 600))
  runTemplateCommands(tpl.commands)
}
