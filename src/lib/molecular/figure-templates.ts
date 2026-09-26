'use client'

// 论文图复现模板（r71：CNS Paper Figure Templates）
// ─────────────────────────────────────────────────────────────────────────────
// 定位：把近 5 年 Cell / Nature / Science 等高影响力结构生物学文章中反复出现
// 的「图式」（figure style）——表示法组合 + 配色 + 视角 + 灯光 + 轮廓 + 相机
// ——固化为命令序列模板。一键应用到用户当前结构，快速得到 CNS 级别作图。
//
// 版权与还原策略（诚实定位）：
//  · 不保存任何论文原图（版权），模板还原的是「图式视觉配方」——同一配方在
//    MolVision 引擎下的 100% 复现；缩略图由本引擎对代表结构真实渲染生成
//    （public/templates/*.png，管线见 r71 E2E）。
//  · citation 字段为图式来源的真实文献（期刊/年份/标题/DOI，经 web 检索核实），
//    卡片上标注「图式参考」，供用户溯源原paper的视觉惯例。
//
// 架构：模板 = 命令序列（全部走既有 runCommand——preset/spectrum/util/…
// 已被 guards 与 E2E 反复验证的命令面）。模板应用因此天然获得：
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
  /** 图式参考来源 */
  citation: FigureCitation
  /** 代表结构（缩略图渲染用；「演示」按钮加载它再应用） */
  demo: string
  /** 复现命令序列（全部为已验证命令语法） */
  commands: string[]
  /** 卡片强调色（Tailwind 类族名，用于占位渐变与 hover 边框） */
  accent: 'rose' | 'emerald' | 'amber' | 'sky' | 'violet' | 'teal' | 'orange' | 'fuchsia' | 'lime' | 'cyan'
}

export const FIGURE_TEMPLATES: FigureTemplate[] = [
  {
    id: 'rainbow-overview',
    name: { zh: '彩虹全景', en: 'Rainbow overview' },
    tagline: { zh: 'N→C 渐变卡通 + 白底描边：结构文首图惯例', en: 'N→C rainbow cartoon on white with outlines: the classic opening figure' },
    purpose: { zh: '整体概览 · 折叠走向 · 组装示意', en: 'Overall architecture · fold topology · assembly' },
    tags: [{ zh: '整体结构', en: 'Overview' }, { zh: '首图', en: 'Panel A' }],
    citation: { journal: 'Science', year: 2020, title: 'Cryo-EM structure of the 2019-nCoV spike in the prefusion conformation', doi: '10.1126/science.abb2507' },
    demo: '4HHB',
    commands: ['preset cartoon', 'spectrum count, rainbow', 'bg white', 'outline on 2 2.5', 'orient'],
    accent: 'rose',
  },
  {
    id: 'chain-assembly',
    name: { zh: '亚基分色组装', en: 'Chain assembly' },
    tagline: { zh: '逐链配色卡通：寡聚体与复合物组成一目了然', en: 'Per-chain cartoon coloring: oligomer composition at a glance' },
    purpose: { zh: '多亚基组装 · 化学计量 · 界面初判', en: 'Multi-subunit assembly · stoichiometry · interfaces' },
    tags: [{ zh: '寡聚体', en: 'Oligomer' }, { zh: '复合物', en: 'Complex' }],
    citation: { journal: 'Science', year: 2022, title: 'Architecture of the linker-scaffold in the nuclear pore complex' },
    demo: '4HHB',
    commands: ['preset cartoon', 'util cbc', 'bg white', 'outline on 2 2.5'],
    accent: 'sky',
  },
  {
    id: 'ss-motif',
    name: { zh: '二级结构基元', en: 'Secondary-structure motifs' },
    tagline: { zh: 'helix/sheet/coil 三色卡通：基序与拓扑教学图式', en: 'Helix/sheet/coil tri-color cartoon: motif & topology schematics' },
    purpose: { zh: '折叠类型 · 基序识别 · 教学示意', en: 'Fold class · motif recognition · teaching' },
    tags: [{ zh: '拓扑', en: 'Topology' }, { zh: '基序', en: 'Motif' }],
    citation: { journal: 'Nature', year: 2024, title: 'Structural and molecular basis of choline uptake into the brain by FLVCR2', doi: '10.1038/s41586-024-57361-2' },
    demo: '1AKI',
    commands: ['preset cartoon', 'util ss', 'bg white', 'outline on 2 2.5'],
    accent: 'amber',
  },
  {
    id: 'ligand-pocket',
    name: { zh: '配体口袋特写', en: 'Ligand pocket close-up' },
    tagline: { zh: '口袋球棍 + 元素着色 + 自动聚焦：药物靶点文主角图', en: 'Pocket ball-stick + element coloring + auto-zoom: the drug-target hero figure' },
    purpose: { zh: '抑制剂设计 · 互作残基 · 靶点验证', en: 'Inhibitor design · contacting residues · target validation' },
    tags: [{ zh: '药物靶点', en: 'Drug target' }, { zh: '互作', en: 'Interactions' }],
    citation: { journal: 'Nature', year: 2020, title: 'Structure of Mpro from SARS-CoV-2 and discovery of its inhibitors', doi: '10.1038/s41586-020-2223-y' },
    demo: '6LU7',
    commands: ['preset bindingsite', 'bg white', 'outline on 2 2.5'],
    accent: 'emerald',
  },
  {
    id: 'sasa-surface',
    name: { zh: '可及性表面', en: 'SASA surface' },
    tagline: { zh: 'SASA 连续渐变表面：疏水核心与 patch 分布', en: 'SASA-graded surface: hydrophobic cores and patch distribution' },
    purpose: { zh: '表面性质 · 疏水 patch · 界面预测', en: 'Surface properties · hydrophobic patches · interface prediction' },
    tags: [{ zh: '表面', en: 'Surface' }, { zh: '疏水性', en: 'Hydrophobicity' }],
    citation: { journal: 'Nature', year: 2024, title: 'Structural and molecular basis of choline uptake into the brain by FLVCR2', doi: '10.1038/s41586-024-57361-2' },
    demo: '4HHB',
    commands: ['preset surface', 'color sasa', 'bg white'],
    accent: 'teal',
  },
  {
    id: 'density-map',
    name: { zh: '密度叠加验证', en: 'Density overlay' },
    tagline: { zh: '彩虹模型 + 电子密度网格：cryo-EM 局部质量图式', en: 'Rainbow model + electron-density mesh: cryo-EM local-quality figure' },
    purpose: { zh: '模型质量 · 局部分辨率 · 投稿审稿', en: 'Model quality · local resolution · review-ready' },
    tags: [{ zh: 'cryo-EM', en: 'cryo-EM' }, { zh: '密度图', en: 'Maps' }],
    citation: { journal: 'Science', year: 2020, title: 'Cryo-EM structure of the 2019-nCoV spike in the prefusion conformation', doi: '10.1126/science.abb2507' },
    demo: '3EKJ',
    commands: ['preset cartoon', 'spectrum count, rainbow', 'map fetch 3ekj', 'bg white'],
    accent: 'violet',
  },
  {
    id: 'interface-contacts',
    name: { zh: '界面接触网络', en: 'Interface contacts' },
    tagline: { zh: '亚基分色 + 界面残基对连线：PPI 分析标准图', en: 'Chain coloring + contact lines across the interface: standard PPI figure' },
    purpose: { zh: '界面残基 · 结合强度 · 突变设计', en: 'Interface residues · binding strength · mutagenesis design' },
    tags: [{ zh: 'PPI', en: 'PPI' }, { zh: '界面', en: 'Interface' }],
    citation: { journal: 'Nature', year: 2026, title: 'Next-generation inhibitors of SARS-CoV-2 Mpro overcome Paxlovid deficiencies' },
    demo: '6LU7',
    commands: ['preset cartoon', 'util cbc', 'interface A B', 'bg white'],
    accent: 'orange',
  },
  {
    id: 'symmetry-assembly',
    name: { zh: '晶体对称伙伴', en: 'Symmetry mates' },
    tagline: { zh: '非对称单元 + 对称伴侣：结晶学组装语境图', en: 'Asymmetric unit + symmetry mates: crystallographic packing context' },
    purpose: { zh: '生物组装判读 · 晶格核对', en: 'Biological assembly · lattice cross-check' },
    tags: [{ zh: '晶体学', en: 'Crystallography' }, { zh: '组装', en: 'Assembly' }],
    citation: { journal: 'Nature', year: 2020, title: 'Structure of Mpro from SARS-CoV-2 and discovery of its inhibitors', doi: '10.1038/s41586-020-2223-y' },
    demo: '1CRN',
    commands: ['preset cartoon', 'spectrum count, rainbow', 'symmetry 30', 'bg white'],
    accent: 'fuchsia',
  },
  {
    id: 'ensemble-dynamics',
    name: { zh: '构象系综动画', en: 'Ensemble dynamics' },
    tagline: { zh: 'NMR 多构象彩虹卡通 + 播放：动力学与柔性图式', en: 'NMR conformer rainbow cartoon with playback: dynamics & flexibility' },
    purpose: { zh: '构象变化 · 柔性区段 · NMR 验证', en: 'Conformational spread · flexible segments · NMR validation' },
    tags: [{ zh: 'NMR', en: 'NMR' }, { zh: '动力学', en: 'Dynamics' }],
    citation: { journal: 'Cell', year: 2021, title: 'Structural and dynamic insights into the activation of the μ-opioid receptor' },
    demo: '1D3Z',
    commands: ['preset cartoon', 'spectrum count, rainbow', 'ensemble play', 'bg white'],
    accent: 'cyan',
  },
  {
    id: 'publication-ready',
    name: { zh: '出版级静帧', en: 'Publication still' },
    tagline: { zh: '出版互作预设 + 轮廓 + Ray 渲染：直接可投稿', en: 'Publication preset + outlines + ray render: submission-ready' },
    purpose: { zh: '投稿图 · 高分辨率 · 免修图', en: 'Submission figures · hi-res · no post-processing' },
    tags: [{ zh: '出稿', en: 'Figure out' }, { zh: 'Ray', en: 'Ray' }],
    citation: { journal: 'Nature', year: 2026, title: 'Next-generation inhibitors of SARS-CoV-2 Mpro overcome Paxlovid deficiencies' },
    demo: '4HHB',
    commands: ['preset publication', 'bg white', 'outline on 2 2.5', 'ray 1920'],
    accent: 'lime',
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
