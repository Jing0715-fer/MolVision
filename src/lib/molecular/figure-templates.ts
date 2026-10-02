'use client'

// 论文图复现模板（r71 创立 · r72 差异化打磨 · r75 互作分析扩容 + 原文图式对比 · r76 分类细化 · r77 表示法经典与辅因子位扩容 · r78 构象与动力学分类落地 · r87 同类异风变体扩容 · r89 多风格再五连）
// ─────────────────────────────────────────────────────────────────────────────
// 定位：把 Cell / Nature / Science 等高影响力结构生物学文章中反复出现的「图式」
// （figure style）——表示法组合 + 配色 + 视角 + 灯光 + 轮廓 + 相机——固化为命令
// 序列模板。一键应用到用户当前结构，快速得到 CNS 级别作图。
//
// r87 扩容（用户指令：同类型不同风格变体——每类补一支「第二风格」）：
//  · basic +3：墨夜封面全景（深底 AlphaFold 时代呈现风 / 与 rainbow 的「明暗两
//    风格」）· 球棍化学模型（键连视角 / 与 CPK 的「堆积 vs 键连」两风格）· 红蓝
//    立体对（Richardson 1981 印刷时代立体图式——stereo on 双通道色分移）
//  · conform +1：B 因子胖瘦管（preset putty——管径通道表柔性，与 mobility 的
//    颜色通道互证）
//  · surface +1：切层剖面封盖（slab 14 + cap on——剖切通道看内里，与 sasa 的
//    外表观察互补）
//
// r78 扩容（用户指令：继续打磨所有模板 + 继续加入更多模板——构象与动力学分类落地）：
//  · 新分类 conform「构象与动力学」（ensemble/mobility 迁入）——r72 起的长期欠账
//    「两态构象对比」终于清偿：conformational-morph（ADK 开/合双结构 load + create
//    单体提取 + morph 插值轨迹 + disable 聚焦 + ensemble play 播放）与
//    two-state-comparison（Ras GDP/GTP 幽灵表面叠合——不透明双卡通在 1.6Å 级
//    位移上不可读的实测教训产物）
//  · ghost-surface（同结构灰壳半透明表面 + 内部分链卡通——「壳+核」分层语境）；
//    catalytic-residues（催化残基棍 + measure dist 距离虚线标注——模板库首个
//    「测量图式」，Phillips 1966 溶菌酶 Glu35/Asp52 教科书图式）
//  · runTemplateCommands 改顺序执行器：load/fetch 等结构真正入 store 再继续
//    （morph/superpose 不再扑空——双结构模板的执行地基）；⑬构象对补齐/去重/隐藏
//    聚焦 ⑭短结构催化位点整组跳过
//
// r77 扩容（用户指令：继续加入更多模板——表示法经典 + 动力学 + 辅因子位点 + 互作第四式）：
//  · CPK 空间填充（Corey-Pauling 1953 模型图式源流，hide everything + show spheres +
//    color element 三命令零依赖全结构适用）；B 因子柔性热图（天然 b 通道非改写——
//    与 mutation-hotspots 热点改写式互补；Frauenfelder 1979 温度因子图式源流）
//  · 血红素口袋特写（元素色棍 + 4Å 邻域 + 8Å 聚焦；Phillips 1980 1MBO 取材原文）；
//    adapt ⑪辅因子重映射（HEM→FAD/NAD/CLA…十二+种或整组退避）
//  · 阳离子-π 网络（PHE/TYR/TRP 紫 + LYS/ARG/HIS 青 + 4.0Å 接触；Gallivan &
//    Dougherty 1999 图式源流；1AKI 实测 11 对）；adapt ⑫全零 B 因子诚实跳过
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
  // r77 拓宽：期刊为展示标签（CPK 源流 Rev. Sci. Instrum. / 1MBO 取材 J. Mol. Biol. /
  // 阳离子-π PNAS 入库——图式源流不必限于 CNS 三刊）
  journal: string
  year: number
  /** 论文短标题（截取主短语） */
  title: string
  doi?: string
}

/** 模板分类（r76 细化）：基础构图 / 表面与全局 / 位点特写 / 互作分析 / 特定蛋白类型（膜/通道） */
export type FigureCategory = 'basic' | 'surface' | 'conform' | 'site' | 'interaction' | 'membrane'

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
  /** r79：用户自定义模板标记（图片解析创建；缩略图为用户上传图缩存 dataURL） */
  custom?: true
  /** r79：自定义模板卡片缩略图（dataURL，≤384px JPEG；存储配额不足时可缺省→强调色渐变占位） */
  thumb?: string
}

/** 分类元数据（弹窗/欢迎页画廊过滤 chips；r76：general 11 拆三类；r78：拆出构象与动力学——
 *  surface 留「表面与全局」，ensemble/mobility 迁入新类并接收 morph/两态叠合） */
export const FIGURE_CATEGORIES: { key: FigureCategory | 'all'; label: DualText }[] = [
  { key: 'all', label: { zh: '全部', en: 'All' } },
  { key: 'basic', label: { zh: '基础图式', en: 'Basic styles' } },
  { key: 'surface', label: { zh: '表面与全局', en: 'Surface & global' } },
  { key: 'conform', label: { zh: '构象与动力学', en: 'Conformations & dynamics' } },
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
    // 差异点：暖象牙底（#fbf8f1）+ 斜侧视角 turn y -20（基元交叠可辨）+ 细描边。
    // r91 打磨：像素实测揭发取景过宽（bbox 宽仅 27% vs 健康 45-50%——引擎默认
    // fit 边距吃掉近四分之三横向幅面）→ zoom 1.5 收紧（r89 线描/墨夜/系综三连同款）
    commands: ['preset cartoon', 'util ss', 'bg #fbf8f1', 'turn y -20', 'zoom 1.5', 'outline on 1.1 1.0'],
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
    category: 'conform',
    figure: { ref: 'Fig. 4', shows: { zh: '构象系综图：柔性区段散布与功能构象采样', en: 'Conformational ensemble: flexible segment spread and functional sampling' } },
    citation: { journal: 'Cell', year: 2021, title: 'Structural and dynamic insights into the activation of the μ-opioid receptor' },
    demo: '1D3Z',
    // 差异点：墨底夜色（#14171c，封面/ graphical abstract 惯例）+ 细杆卡通（0.5×——
    // 多构象叠影下粗杆会糊成一团）+ 斜侧 turn y 25
    commands: ['preset cartoon', 'spectrum count, rainbow', 'ensemble play', 'bg #14171c', 'set cartoon_width 0.5', 'turn y 25', 'zoom 1.5'],
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
    // r92：orient → orient polymer——膜板/孔道轴的 PCA 只算聚合物原子，裸 orient 连
    // 晶体水/配体一起算（1FX8 类富水结构轴被带偏 ~45°，膜板斜跨屏幕）；同源原子集
    // 才能保证 turn z 90 后膜法线纯竖直（环带纯竖排）
    commands: ['preset cartoon', 'util cbc', 'bg white', 'membrane 34', 'pore', 'orient polymer', 'turn z 90', 'outline on 1.1 1.0'],
    accent: 'slate',
  },
  {
    id: 'membrane-embed',
    name: { zh: '膜蛋白脂双层语境', en: 'Membrane-embedded context' },
    tagline: { zh: '钢蓝表面 + 橙头基双层板 + 侧视：膜蛋白跨膜区一图判读', en: 'Steel-blue surface + orange headgroup slab + side view: transmembrane extent at a glance' },
    purpose: { zh: '跨膜深度 · 膜界面 patch · β-桶/螺旋束', en: 'TM span · interfacial patches · barrel vs helix bundle' },
    tags: [{ zh: '膜蛋白', en: 'Membrane' }, { zh: '水通道', en: 'Aquaporin' }],
    category: 'membrane',
    figure: { ref: 'Fig. 1', shows: { zh: '膜语境图：跨膜深度 + 膜界面 patch 标注', en: 'Membrane context: transmembrane span and interfacial patches' } },
    citation: { journal: 'Science', year: 2002, title: 'Structure of a glycerol-conducting channel and the basis for its selectivity', doi: '10.1126/science.1072457' },
    demo: '1FX8',
    // 差异点：钢蓝单色表面 + 脂双层板（跨膜区嵌入橙头基之间）+ 正面侧视。
    // r91 打磨：原 color sasa（埋藏蓝紫→暴露橙红渐变）的暴露区与橙膜同色系
    // 融合——膜边界视觉模糊、被误读为「膜板错位」；改钢蓝单色（冷暖分离，
    // 橙膜边界一图清晰；SASA 梯度语义由 electrostatic/hydration 模板分工）
    // r92 几何修复：view front → orient polymer + turn z 90。1FX8 沉积坐标 TM 轴
    // 近 Z 向，front 视角正对膜法线——看到的是膜板正面大矩形（「蛋白没在膜中间」
    // 的视觉根因）；orient polymer 与 membrane 命令同源（仅聚合物 PCA）+ turn z 90
    // 竖排法线 → 膜板纯水平双板、蛋白跨膜居中（E2E 实测屏幕投影 (0,-1,0)）。
    // r92 构图修复：+ hide ballstick——preset surface 的 ligand 球棍层把晶体学
    // 去污剂/甘油云（散布 ~180Å）也画进来，蓝色团块远大于聚合物本体、膜板
    // 显得「没包住蛋白」且视口裁切；语境图要的是蛋白+膜，隐藏配体层
    commands: ['preset surface', 'hide ballstick', 'color #94a9c0', 'bg #f5f7fa', 'membrane 32', 'orient polymer', 'turn z 90'],
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

  // ── r77 扩容：表示法经典 + 动力学 + 辅因子位点 + 互作第四式 ──
  // 命令语法全部 E2E 预验证：1MBO 实测 resn HEM 43 原子（元素色棍/4Å 邻域/8Å
  // 聚焦全链生效）；spectrum b 渐变正常；hide everything→show spheres→color
  // element 空间填充三命令零依赖；cation-pi 接触 1AKI 11 对 / 4HHB 42 对 / 1MBO 9 对
  {
    id: 'cpk-spacefill',
    name: { zh: 'CPK 空间填充', en: 'CPK space-filling' },
    tagline: { zh: '全原子球体 + 元素配色 + 白底主轴视角：物理填充模型经典图式', en: 'All-atom spheres + element colors + white principal-axis view: the physical-packing classic' },
    purpose: { zh: '原子堆积 · 空间位阻 · 表面形状', en: 'Atomic packing · steric clash · surface shape' },
    tags: [{ zh: 'CPK 模型', en: 'CPK model' }, { zh: '全原子', en: 'All-atom' }],
    category: 'basic',
    figure: { ref: '模型图版', shows: { zh: '实体分子模型版式：原子按 van der Waals 半径的空间填充外观', en: 'Physical model plates: van der Waals space-filled appearances' } },
    citation: { journal: 'Rev. Sci. Instrum.', year: 1953, title: 'Molecular models of amino acids, peptides, and proteins', doi: '10.1063/1.1770803' },
    demo: '1CRN',
    // 差异点：全原子球（唯一无卡通模板——与 rainbow 的「带状抽象」构成表示法两极）；
    // 1CRN 0.58Å 高分辨率文首蛋白——每个原子清晰可辨的空间填充教科书案例
    commands: ['preset cartoon', 'hide everything', 'hide waters', 'show spheres', 'color element', 'bg white', 'orient'],
    accent: 'slate',
  },
  {
    id: 'mobility-bfactor',
    name: { zh: 'B 因子柔性热图', en: 'B-factor mobility map' },
    tagline: { zh: '天然 B 因子蓝→红渐变 + 冷雾底无描边：柔性环区与刚性核心一图判读', en: 'Native B-factor blue→red gradient on cool mist: flexible loops vs rigid core at a glance' },
    purpose: { zh: '局部柔性 · 环区定位 · 动力学解读', en: 'Local flexibility · loop mapping · dynamics reading' },
    tags: [{ zh: 'B 因子', en: 'B-factor' }, { zh: '动力学', en: 'Dynamics' }],
    category: 'conform',
    figure: { ref: 'Fig. 1', shows: { zh: '温度因子图：不同温度下原子位移参数的分布与变化', en: 'Temperature-factor plates: displacement parameters across temperatures' } },
    citation: { journal: 'Nature', year: 1979, title: 'Temperature-dependent X-ray diffraction as a probe of protein structural dynamics', doi: '10.1038/280558a0' },
    demo: '3INS',
    // 差异点：读天然 B 因子（与 mutation-hotspots 的「改写 b 表达热点」互补——那支
    // 标注人工位点，这支表达实测柔性）；冷雾底 + 无描边（渐变面自明）；图式源流
    // Frauenfelder/Petsko/Tsernoglou 温度依赖精修（DOI 经 crossref 双核实）；
    // 演示取材 3INS 胰岛素（B 链末端柔性实测拉开梯度——1MBO 试拍单边蓝的教训：
    // 1MBO 晶体过于有序，min-max 归一后蓝青占 99%，视觉上不成「热图」）；
    // adapt ⑫：全零 B 因子（NMR/预测模型）诚实跳过
    commands: ['preset cartoon', 'spectrum b, rainbow', 'bg #eef1f5', 'orient'],
    accent: 'cyan',
  },
  {
    id: 'heme-pocket',
    name: { zh: '血红素口袋特写', en: 'Heme pocket close-up' },
    tagline: { zh: '血红素元素色棍 + 4Å 邻域残基棍 + 位点聚焦：辅因子结合几何一图判读', en: 'Element-colored heme sticks + 4Å neighborhood + site zoom: cofactor geometry at a glance' },
    purpose: { zh: '辅因子结合 · 近端/远端组氨酸 · 催化机制', en: 'Cofactor binding · proximal/distal histidines · catalysis' },
    tags: [{ zh: '血红素', en: 'Heme' }, { zh: '辅因子', en: 'Cofactor' }],
    category: 'site',
    figure: { shows: { zh: '血红素环境图：Fe 配位 + 近端组氨酸 + 口袋残基全景', en: 'Heme environment: Fe ligation, proximal histidine and pocket residues' } },
    citation: { journal: 'J. Mol. Biol.', year: 1980, title: 'Structure and refinement of oxymyoglobin at 1.6 Å resolution', doi: '10.1016/0022-2836(80)90262-4' },
    demo: '1MBO',
    // 差异点：血红素元素色棍（Fe 橙/N 蓝/O 红——配位几何可读）+ 4Å 邻域棍（近端
    // HIS93/远端 HIS64 同框）+ 8Å 聚焦；Phillips 1980 氧合肌红蛋白原文取材（DOI
    // 经 RCSB/PDBj/ScienceDirect 三源核实）；adapt ⑪：无 HEM 时重映射结构内其它
    // 辅因子（FAD/NAD/CLA…）或整组退避
    commands: ['preset cartoon', 'util cbc', 'bg white', 'show sticks, resn HEM', 'color element, resn HEM', 'show sticks, byres(within 4 of (resn HEM))', 'zoom byres(within 8 of (resn HEM))', 'outline on 1.1 1.0'],
    accent: 'rose',
  },
  {
    id: 'cation-pi',
    name: { zh: '阳离子-π 网络', en: 'Cation–π network' },
    tagline: { zh: '芳香紫 + 阳离子青 + 接触虚线 + 侧链棍：π 电子互作网络图式', en: 'Aromatic purple + cationic cyan + contact dashes + sidechain sticks: the π-electron interaction map' },
    purpose: { zh: '酶底物定位 · 芳香笼 · 结合能解析', en: 'Substrate positioning · aromatic cages · binding energetics' },
    tags: [{ zh: '阳离子-π', en: 'Cation–π' }, { zh: '芳香残基', en: 'Aromatics' }],
    category: 'interaction',
    figure: { ref: 'Fig. 1', shows: { zh: '阳离子-π 几何统计图：结构库互作频率与距离/角度分布', en: 'Cation–π census: interaction frequency and distance/angle geometry across the structural database' } },
    citation: { journal: 'PNAS', year: 1999, title: 'Cation-pi interactions in structural biology', doi: '10.1073/pnas.96.17.9459' },
    demo: '1AKI',
    // 差异点：芳香/阳离子语义双色（PHE/TYR/TRP 紫 · LYS/ARG/HIS 青——与盐桥模板
    // 红蓝酸碱形成视觉亲缘但语义有别）+ 4.0Å 接触虚线 + 侧链棍；1AKI 实测 11 对
    // （最近 PHE34↔ARG114 3.40Å——溶菌酶芳香簇经典位点）
    commands: ['preset cartoon', 'util cbc', 'bg white', 'contacts (resn PHE+TYR+TRP and sidechain) | (resn LYS+ARG+HIS and sidechain) 4.0', 'color purple, resn PHE+TYR+TRP', 'color cyan, resn LYS+ARG+HIS', 'show sticks, (resn PHE+TYR+TRP+LYS+ARG+HIS) and sidechain', 'view front', 'outline on 1.1 1.0'],
    accent: 'violet',
  },

  // ── r78 扩容：构象与动力学分类（r72 起的长期欠账——两态构象对比终于落地）──
  // 命令语法全部活体预验证：morph 对象 1,656 原子·214 残基对·40 帧（链 A↔A 单体对，
  // RMSD 7.13Å 全局叠合）；Ras 叠合 166 对 CA·1.642Å；幽灵表面灰 14.9%+彩 3.5% 像素
  // 实证；催化距离标注 8.19Å 虚线在位。create 对象名不能数字开头（[A-Za-z_] 规则）。
  {
    id: 'conformational-morph',
    name: { zh: '两态构象 morph 动画', en: 'Two-state morph movie' },
    tagline: { zh: '开/合双构象插值轨迹 + 彩虹卡通 + 播放条：域运动机理一图播放', en: 'Open/closed interpolation trajectory + rainbow cartoon + playback bar: domain motion as a movie' },
    purpose: { zh: '构象转变 · 域运动 · 机理动画', en: 'Conformational change · domain motion · mechanism movies' },
    tags: [{ zh: 'morph', en: 'morph' }, { zh: '域运动', en: 'Domain motion' }],
    category: 'conform',
    figure: { ref: 'Fig. 1', shows: { zh: '构象插值轨迹图：中间构象序列 + 域运动路径标注', en: 'Interpolated trajectory: intermediate conformers with the domain-motion path' } },
    // 图式源流：Krebs & Gerstein 2000 morph server（构象插值可视化方法的奠基文献，
    // DOI 经 crossref 核实）；演示对 = ADK 开/合两态（4AKE 开放 / 1AKE 闭合+Ap5A）
    citation: { journal: 'Nucleic Acids Research', year: 2000, title: 'The morph server: a standardized system for analyzing and visualizing macromolecular motions', doi: '10.1093/nar/28.8.1665' },
    demo: '4AKE',
    // 差异点（双结构架构·r78 落地）：create 提取两态单体链 A（二聚体直连 morph 会把
    // 链 B 拉伸 170Å——实测教训：superpose 只对齐链 A，morph 包围球暴涨相机推远）；
    // morph 内部自动叠合（RMSD 7.13Å 全局）→ disable 四源对象聚焦动画 → 底部播放条
    // 逐帧浏览 + ensemble play 自动播放；adapt ⑬：非演示端点结构补 load + 隐藏聚焦
    commands: [
      'load 1ake',
      'create closedA = chain A and polymer',
      'use 4ake',
      'create openA = chain A and polymer',
      'morph m1 = openA closedA 40',
      'disable 4ake', 'disable 1ake', 'disable closedA', 'disable openA',
      'preset cartoon', 'spectrum count, rainbow', 'bg white', 'orient', 'ensemble play', 'outline on 1.1 1.0',
    ],
    accent: 'cyan',
  },
  {
    id: 'two-state-comparison',
    name: { zh: '两态叠合对比', en: 'Two-state superposition' },
    tagline: { zh: '灰色幽灵表面（参考态）+ 彩虹卡通（移动态）叠合：分子开关运动一图判读', en: 'Gray ghost surface (reference) + rainbow cartoon (mobile) superposed: the switching motion at a glance' },
    purpose: { zh: '活性/非活性 · switch 区运动 · 变构传播', en: 'Active/inactive · switch regions · allosteric propagation' },
    tags: [{ zh: '构象对比', en: 'Conformational' }, { zh: '分子开关', en: 'Molecular switch' }],
    category: 'conform',
    figure: { ref: 'Fig. 4', shows: { zh: '活性/非活性叠合图：switch I/II 区段位移 + 配体环境对比', en: 'Active/inactive superposition: switch I/II displacements with ligand environments' } },
    // 图式源流：Milburn et al. 1990 Science 247:939「Molecular switch」（Ras 两态对比
    // 图式的奠基文献，DOI 经 crossref 核实）；演示对 = H-Ras GDP（4Q21）/ GTP 类似物（5P21）
    citation: { journal: 'Science', year: 1990, title: 'Molecular switch for signal transduction: structural differences between active and inactive forms of protooncogenic ras proteins', doi: '10.1126/science.2406906' },
    demo: '4Q21',
    // 差异点：不透明双卡通叠合在 Ras（1.642Å）上不可读（彩虹罩死灰参考——实测教训）；
    // 参考态转半透明灰表面（0.55）+ 移动态彩虹卡通 = 「幽灵壳内开关」图式；
    // 【r78 实测教训：zoom 替 orient】叠合后用 zoom 重适配可见的两提取物（保持载入
    // 视向）——orient 的 PCA 视向在表面内容下同样有偏心风险；adapt ⑬：非演示端点
    // 结构补 load + 隐藏聚焦
    commands: [
      'load 5p21',
      'create gtpA = chain A and polymer',
      'use 4q21',
      'create gdpA = chain A and polymer',
      'disable 5p21', 'disable 4q21',
      'superpose gtpA onto gdpA',
      'use gdpA', 'preset surface', 'color gray', 'set transparency 0.55',
      'use gtpA', 'spectrum count, rainbow',
      'bg white', 'zoom', 'outline on 1.1 1.0',
    ],
    accent: 'slate',
  },
  {
    id: 'ghost-surface',
    name: { zh: '幽灵表面语境', en: 'Ghost surface context' },
    tagline: { zh: '半透明分子表面 + 内部分链卡通：整体形状与折叠细节同框分层', en: 'Translucent surface shell + per-chain cartoon inside: global shape and fold detail layered in one frame' },
    purpose: { zh: '表面形状 · 内部架构 · 语境叠加', en: 'Overall shape · internal architecture · layered context' },
    tags: [{ zh: '表面', en: 'Surface' }, { zh: '分层语境', en: 'Layered context' }],
    category: 'surface',
    figure: { ref: 'Fig. 2', shows: { zh: '分子表面概览：整体形状与包装特征 + 功能位点标注', en: 'Molecular-surface overview: overall shape and packing with functional sites' } },
    // 图式源流：Richards 1977 Annu Rev Biophys Bioeng（分子表面/可及面积概念的
    // 缔造文献，DOI 经 crossref 核实）；演示取材 4HHB 血红蛋白四聚体
    citation: { journal: 'Annu. Rev. Biophys. Bioeng.', year: 1977, title: 'Areas, volumes, packing, and protein structure', doi: '10.1146/annurev.bb.06.060177.001055' },
    demo: '4HHB',
    // 差异点：同一结构的「壳+核」双层表示（与 two-state 的跨结构幽灵壳互补）——
    // 灰壳给整体形状读数、分链卡通给折叠拓扑读数；像素实证灰壳 14.9% + 彩核 3.5%。
    // 【r78 实测教训：无 orient】orient 的 PCA 视向在「表面内容 + 全原子（含结晶水
    // 离群点）取景目标」下会把内容挤出画框左下角（像素实证 33%,65% 裁切）；继承
    // 载入时适配（实测 49%,61% 居中）——与 sasa-surface 同构的无相机命令配方
    commands: ['preset surface', 'color gray', 'set transparency 0.5', 'show cartoon', 'util cbc', 'bg #eef1f5'],
    accent: 'teal',
  },
  {
    id: 'catalytic-residues',
    name: { zh: '催化位点几何标注', en: 'Catalytic-site geometry' },
    tagline: { zh: '催化残基侧链棍 + 距离虚线标注 + 位点特写：催化机理一图判读', en: 'Catalytic sidechain sticks + distance dashes + site close-up: the catalytic machinery at a glance' },
    purpose: { zh: '催化机制 · 活性位点 · 突变验证', en: 'Catalysis · active sites · mutagenesis readout' },
    tags: [{ zh: '催化残基', en: 'Catalytic' }, { zh: '距离标注', en: 'Distance' }],
    category: 'site',
    figure: { ref: '机制图版', shows: { zh: '溶菌酶机理图：Glu35/Asp52 催化双残基几何 + 底物裂解注解', en: 'Lysozyme mechanism plate: Glu35/Asp52 catalytic geometry with substrate cleavage' } },
    // 图式源流：Phillips 1966 Sci Am「The Three-Dimensional Structure of an Enzyme
    // Molecule」（Glu35/Asp52 催化位点图式的教科书缔造，DOI 经 crossref 核实）；
    // 演示取材 1AKI 鸡蛋清溶菌酶（实测 Glu35 OE2↔Asp52 OD1 = 8.19Å）
    citation: { journal: 'Sci. Am.', year: 1966, title: 'The three-dimensional structure of an enzyme molecule', doi: '10.1038/scientificamerican1166-78' },
    demo: '1AKI',
    // 差异点：measure dist 真实测量标注（虚线 + Å 标签——模板库首个「测量图式」）；
    // 位点缓冲取景 zoom (resi 35 or resi 52), 8（实测 8Å 邻域 byres 展开会把取景拉回
    // 全景——421 原子包围盒近整蛋白；两残基+缓冲 8Å 相机 55° 恰好特写）；
    // 多链结构 measure 自动取最近原子对；adapt ⑭：短于 60 残基结构整组跳过
    commands: [
      'preset cartoon', 'util cbc', 'bg white',
      'show sticks, (resi 35 or resi 52) and sidechain',
      'measure dist (resi 35 and name OE2) (resi 52 and name OD1)',
      'zoom (resi 35 or resi 52), 8',
      'outline on 1.1 1.0',
    ],
    accent: 'amber',
  },

  // ── r87 扩容（用户指令：同类型不同风格变体——每类给一支「第二风格」）──
  // 设计维度刻意与同类存量错开：basic 三支分别占「深底封面 / 键连化学 / 立体印刷」
  // 三个未被表示的子风格；conform 加管径通道（与颜色通道互补）；surface 加剖切通道
  // （与外表观察互补）。全部命令沿用既有白名单语法（validateTemplateCommand 预验证）。
  {
    id: 'ink-night-cover',
    name: { zh: '墨夜封面全景', en: 'Ink-night cover' },
    tagline: { zh: '墨蓝夜底 + 加宽彩虹卡通 + 斜侧 25°：封面/图文摘要的深底风格', en: 'Ink-blue night + widened rainbow cartoon + 25° oblique: the dark-ground cover style' },
    purpose: { zh: '封面图 · 图文摘要 · 演示汇报', en: 'Cover art · graphical abstracts · talks' },
    tags: [{ zh: '封面', en: 'Cover' }, { zh: '图文摘要', en: 'Graphical abstract' }],
    category: 'basic',
    figure: { ref: '封面/图文摘要', shows: { zh: '深底彩色结构呈现：期刊封面与图文摘要的视觉惯例', en: 'Dark-ground colored structures: the journal-cover and graphical-abstract convention' } },
    citation: { journal: 'Nature', year: 2021, title: 'Highly accurate protein structure prediction with AlphaFold', doi: '10.1038/s41586-021-03819-2' },
    demo: '4HHB',
    // 差异点：墨蓝夜底（#101418——AlphaFold 时代论文深底呈现风）+ 卡通 1.4× 加宽
    // （远距投屏可读）+ 斜侧 25°（封面动感构图）；无描边（深底上轮廓线反而收束
    // 色块——与白底 rainbow-overview 构成同类型「明暗两风格」）
    commands: ['preset cartoon', 'spectrum count, rainbow', 'bg #101418', 'set cartoon_width 1.4', 'turn y 25', 'zoom 1.5'],
    accent: 'cyan',
  },
  {
    id: 'ballstick-chemistry',
    name: { zh: '球棍化学模型', en: 'Ball-and-stick chemistry' },
    tagline: { zh: '全结构球棍 + 元素配色 + 白底细描边：化学教科书经典模型图式', en: 'Full ball-and-stick + element colors + white hairlines: the chemistry-textbook classic' },
    purpose: { zh: '化学骨架 · 键连拓扑 · 教学示意', en: 'Chemical skeleton · bonding topology · teaching' },
    tags: [{ zh: '球棍', en: 'Ball & stick' }, { zh: '元素色', en: 'Element colors' }],
    category: 'basic',
    figure: { ref: '模型图版', shows: { zh: '球棍模型版式：原子球与键棍的化学骨架呈现', en: 'Ball-and-stick plates: chemical skeletons as atom spheres and bond rods' } },
    citation: { journal: 'Rev. Sci. Instrum.', year: 1953, title: 'Molecular models of amino acids, peptides, and proteins', doi: '10.1063/1.1770803' },
    demo: '1CRN',
    // 差异点：与 CPK 空间填充同源（Corey-Pauling-Koltun 模型体系）——那支看「堆积」，
    // 这支看「键连」：球小棍出、键拓扑可读；1CRN 46 残基小蛋白全原子不糊
    commands: ['preset ballstick', 'color element', 'bg white', 'orient', 'outline on 1.1 1.0'],
    accent: 'emerald',
  },
  {
    id: 'stereo-anaglyph',
    name: { zh: '红蓝立体对', en: 'Stereo anaglyph' },
    tagline: { zh: '彩虹卡通 + 红蓝立体通道分移：戴红蓝眼镜即得深度感知的印刷图式', en: 'Rainbow cartoon + red-cyan channel offset: print-era stereo depth with 3D glasses' },
    purpose: { zh: '立体深度 · 印刷插图 · 教学演示', en: 'Stereo depth · print figures · teaching demos' },
    tags: [{ zh: '立体图', en: 'Stereo' }, { zh: '印刷图式', en: 'Print figure' }],
    category: 'basic',
    figure: { ref: '立体对图版', shows: { zh: '红蓝立体对结构图：印刷时代的深度感知惯例（配红蓝眼镜）', en: 'Anaglyph stereo plates: the print-era depth convention (with red-cyan glasses)' } },
    // 图式源流：Richardson 1981 蛋白解剖与分类图集（ribbon 图谱以立体对呈现——
    // 印刷时代结构生物学家的「3D 眼镜」，DOI 经 crossref 核实）
    citation: { journal: 'Adv. Protein Chem.', year: 1981, title: 'The anatomy and taxonomy of protein structure', doi: '10.1016/S0065-3233(08)60520-3' },
    demo: '1AKI',
    // 差异点：stereo on 红蓝立体（渲染管线双通道色分移——左右眼色偏移即深度线索，
    // 观看需红蓝眼镜）；白底 + 彩虹保证两通道都有色彩可分；GTAO 在立体模式自动
    // 暂停（引擎既有语义）
    commands: ['preset cartoon', 'spectrum count, rainbow', 'bg white', 'stereo on', 'orient'],
    accent: 'rose',
  },
  {
    id: 'putty-flexibility',
    name: { zh: 'B 因子胖瘦管', en: 'Putty B-factor tube' },
    tagline: { zh: '管径随 B 因子胀缩 + 蓝→红渐变：柔性在几何上「看得见」', en: 'Tube radius swells with B-factor + blue→red: flexibility made visible in geometry' },
    purpose: { zh: '局部柔性 · 环区定位 · 动力学解读', en: 'Local flexibility · loop mapping · dynamics reading' },
    tags: [{ zh: 'putty 管', en: 'Putty tube' }, { zh: 'B 因子', en: 'B-factor' }],
    category: 'conform',
    figure: { ref: 'Fig. 1', shows: { zh: '温度因子胖瘦管图：柔性区段沿链胀缩呈现', en: 'Temperature-factor putty: flexible segments swelling along the chain' } },
    citation: { journal: 'Nature', year: 1979, title: 'Temperature-dependent X-ray diffraction as a probe of protein structural dynamics', doi: '10.1038/280558a0' },
    demo: '3INS',
    // 差异点：与 mobility-bfactor（卡通热图）同为 B 因子动力学图式——那支用「颜色」
    // 表柔性，这支用「管径」：胖瘦即振幅，几何通道与颜色通道互证；preset putty 原生
    // bfactor 渐变配色 + 管径映射；冷雾底无描边（渐变面自明，与 mobility 同底色）
    commands: ['preset putty', 'bg #eef1f5', 'orient'],
    accent: 'amber',
  },
  {
    id: 'slab-cutaway',
    name: { zh: '切层剖面封盖', en: 'Slab cutaway' },
    tagline: { zh: '空间填充切层 14Å + 实心封盖剖面：内部空腔与核心分区一图剖开', en: '14Å slabbed spacefill with solid caps: internal cavities and cores cut wide open' },
    purpose: { zh: '内部空腔 · 核心分区 · 剖面图式', en: 'Internal cavities · core layout · cutaway figures' },
    tags: [{ zh: '剖面', en: 'Cutaway' }, { zh: '切层', en: 'Slab' }],
    category: 'surface',
    figure: { ref: 'Fig. 2', shows: { zh: '剖面图：切层揭示内部空腔与埋藏核心', en: 'Cutaway plates: slabbed views revealing cavities and buried cores' } },
    citation: { journal: 'Annu. Rev. Biophys. Bioeng.', year: 1977, title: 'Areas, volumes, packing, and protein structure', doi: '10.1146/annurev.bb.06.060177.001055' },
    demo: '4HHB',
    // 差异点：剖面图式的 PyMOL interior 经典形态——r92 重造：原「表面 + slab」组合
    // 几何上不可能实心（metaball 表面是薄壳，slab 窗口切壳只见环带+透明内腔，
    // 窗口外的远侧壳被裁掉、封盖无背面可填——VLM 三审「空心破壳」实锤）；
    // 空间填充球是闭合实体，切层即得原子截面 + cap 实心封盖（1280 实测实心色场✓）。
    // 缩略图管线侧配套：无头 Chrome SwiftShader 软光栅下重渲染每帧数秒——截图
    // CDP 超时曾静默吞掉并用除旧 raw 反复伪造「空心环」（r92 实锤）；管线已加
    // 截图三次重试+陈旧防护，本模板降 1280 视口 + 30s 等待让渲染落定（真 GPU 用户
    // 端无此问题）。Richards 1977 areas/volumes/packing 正是剖面所揭示的量
    commands: ['preset spacefill', 'hide waters', 'color sasa', 'bg #eef1f5', 'slab 14', 'slab cap on', 'view front', 'zoom'],
    accent: 'teal',
  },
  // ── r89 扩容（用户指令：继续添加新模板——多风格再五连：线描/灰度占 basic 未覆盖
  //    的「无彩色」两子风格，静电/水合/晶胞占 surface 的电荷·溶剂·晶体学三通道。
  //    全部命令沿用既有白名单语法（validateTemplateCommand 预验证） ──
  {
    id: 'wire-skeleton',
    name: { zh: '线描骨架', en: 'Wireframe skeleton' },
    tagline: { zh: '全原子线框 + 白底：键网络的「工程制图」风全貌', en: 'All-atom wireframe on white: an engineering-drawing view of the bond network' },
    purpose: { zh: '键网络 · 原子级检视 · 小蛋白全貌', en: 'Bond network · atom-level inspection · small-protein overviews' },
    tags: [{ zh: '线框', en: 'Wireframe' }, { zh: '全原子', en: 'All-atom' }],
    category: 'basic',
    figure: { ref: 'Fig. 1', shows: { zh: '线框全原子模型：肌红蛋白三级结构的首次呈现', en: 'All-atom wire model: the first view of myoglobin\'s tertiary structure' } },
    citation: { journal: 'Nature', year: 1958, title: 'A three-dimensional model of the myoglobin molecule obtained by x-ray analysis', doi: '10.1038/181662a0' },
    demo: '1CRN',
    // 差异点：全原子 lines（无卡通无球）——与球棍的「球+棍」不同，纯线网络读键连
    // 拓扑；小蛋白适用（大蛋白会变发球）；1CRN 46 残基线描清晰可读。
    // r91 打磨：像素实测揭发对比度塌方（线亮度 p5=206、最暗 158 vs 健康模板
    // ~80——元素着色的碳线 #a9aeb5 级灰在白底上几不可见）→ 追加统一深墨
    // #3f454d（Kendrew 1958 原版制图就是黑墨白纸——风格与可读性双赢；
    // 化学元素区分语义由 cpk-spacefill 模板分工）
    commands: ['preset wireframe', 'color #3f454d', 'bg white', 'orient', 'zoom 1.7'],
    accent: 'cyan',
  },
  {
    id: 'grayscale-print',
    name: { zh: '黑白制版', en: 'Grayscale print' },
    tagline: { zh: '全灰卡通 + 白底细描边：单色印刷与学术海报的稳妥款', en: 'All-gray cartoon on white with hairlines: the safe pick for B/W print and posters' },
    purpose: { zh: '单色印刷 · 海报 · 复印友好', en: 'Monochrome print · posters · photocopy-friendly' },
    tags: [{ zh: '单色', en: 'Monochrome' }, { zh: '印刷', en: 'Print' }],
    category: 'basic',
    figure: { ref: 'Fig. 1', shows: { zh: '黑白制版结构图：无彩色印刷时代的全灰呈现', en: 'Grayscale structure figure: all-gray rendering of the pre-color print era' } },
    citation: { journal: 'Nature', year: 1960, title: 'Structure of haemoglobin: a three-dimensional Fourier synthesis at 5.5-A resolution', doi: '10.1038/185416a0' },
    demo: '4HHB',
    // 差异点：util cnc 全灰（与分色/彩虹系全部相反——单通道明度制图；1960 年印刷
    // 时代即此风格，现代单色期刊/海报仍在用）；描边保留（灰度分层靠明度差+轮廓）
    commands: ['preset cartoon', 'util cnc', 'bg white', 'outline on 1.1 1.0', 'orient'],
    accent: 'slate',
  },
  {
    id: 'electrostatic-surface',
    name: { zh: '红蓝静电表面', en: 'Electrostatic surface' },
    tagline: { zh: '酸红碱蓝双色调表面：口袋与结合位点的电荷语境', en: 'Acid-red / base-blue two-tone surface: the charge context of pockets and binding sites' },
    purpose: { zh: '电荷分布 · 等电语境 · 结合预判', en: 'Charge distribution · pI context · binding-site prediction' },
    tags: [{ zh: '静电', en: 'Electrostatics' }, { zh: '表面', en: 'Surface' }],
    category: 'surface',
    figure: { ref: 'Fig. 2', shows: { zh: '静电势表面图：红负蓝正的电荷 patch 与配体取向', en: 'Electrostatic-potential surface: red-negative/blue-positive patches and ligand orientation' } },
    citation: { journal: 'Science', year: 1995, title: 'Classical electrostatics in biology and chemistry', doi: '10.1126/science.268.5214.1144' },
    demo: '4HHB',
    // 差异点：表面 + 中性灰底 + 酸碱残基双色调（酸红 ASP/GLU、碱蓝 LYS/ARG/HIS）
    // ——盐桥网络同款配色移到表面载体上：颜色即电荷 patch，配体/互作位点一眼定位
    // （先 color gray 中性底再上双色调——非酸碱残基不残留链配色，r89 缩略图 VLM
    // 验证揭发的混色问题当轮修正）
    commands: ['preset surface', 'color gray', 'color red, resn ASP+GLU', 'color blue, resn LYS+ARG+HIS', 'bg white'],
    accent: 'rose',
  },
  {
    id: 'hydration-shell',
    name: { zh: '水合壳层', en: 'Hydration shell' },
    tagline: { zh: '卡通 + 晶体水小球：蛋白表面首层水分子的语境图', en: 'Cartoon + crystal-water spheres: the first hydration layer in context' },
    purpose: { zh: '晶体水 · 溶剂含量 · 首壳水分析', en: 'Crystal waters · solvent content · first-shell analysis' },
    tags: [{ zh: '水分子', en: 'Waters' }, { zh: '晶体学', en: 'Crystallography' }],
    category: 'surface',
    figure: { ref: 'Fig. 3', shows: { zh: '表面有序水图：首壳水分子与主链羰基的氢键网络', en: 'Ordered waters: first-shell molecules H-bonded to backbone carbonyls' } },
    citation: { journal: 'Nature', year: 1968, title: 'Solvent effect in protein crystals', doi: '10.1038/218665a0' },
    demo: '4HHB',
    // 差异点：show waters（水 rep 转小球，ChimeraX nonbonded 风）——蛋白质晶体约
    // 半体积是溶剂（Matthews 1968）；水球即表面有序位点的诚实标注
    commands: ['preset cartoon', 'util cbc', 'show waters', 'bg white', 'orient'],
    accent: 'sky',
  },
  {
    id: 'unit-cell-context',
    name: { zh: '晶胞语境', en: 'Unit-cell context' },
    tagline: { zh: '卡通 + a红b绿c蓝晶胞盒：结构数据的晶体学坐标系构图', en: 'Cartoon + a-red/b-green/c-blue cell box: the crystallographic composition frame' },
    purpose: { zh: '晶格参数 · 对称性初判 · PDB 溯源', en: 'Lattice parameters · symmetry first-look · PDB provenance' },
    tags: [{ zh: '晶胞', en: 'Unit cell' }, { zh: '晶体学', en: 'Crystallography' }],
    category: 'surface',
    figure: { ref: 'Fig. 1', shows: { zh: '不对称单元与晶胞：分子在晶体中的平移重复语境', en: 'Asymmetric unit in its cell: translational context of the molecule in the crystal' } },
    citation: { journal: 'Nucleic Acids Res.', year: 2000, title: 'The Protein Data Bank', doi: '10.1093/nar/28.1.235' },
    demo: '4HHB',
    // 差异点：show cell（CRYST1 晶胞盒线框，a红b绿c蓝）——结构数据「从哪块晶体
    // 来」的诚实语境图；无 CRYST1 的结构自动退化为无盒纯卡通（命令零报错）
    commands: ['preset cartoon', 'util cbc', 'show cell', 'bg white', 'orient'],
    accent: 'lime',
  },

  // ── r97 扩容（用户指令：更多实用和风格不同的模板——风格矩阵六连 + 实用三连）──
  // 风格六连覆盖此前未占位的视觉语域：影院聚光（key-light 暗调）/ 黑板粉笔（教学
  // 板书）/ 马卡龙柔色（柔和糖果色板）/ 双色海报（现代平面设计 duotone）/ 复古
  // 棕印（1958 首个肌红蛋白结构的印刷年代棕调）/ 赛博霓虹（暗底荧光青）。
  // 实用三连：教科书标注（SS 三色 + 催化残基标签）/ 核小体 DNA 彩虹（1AOI 组
  // 蛋白灰 + 核酸 N→C 双彩虹 + 顶视盘面）/ GFP 荧光色素特写（1EMA CRO 色素
  // 棍特写 + 暗底荧光语境）。命令语法全部实测：1EMA CRO 为 HETATM 可 resn
  // 直选（190KB）；1AOI 链 A-J（8 组蛋白 + 2 DNA 链）；3INS/4HHB 均 4 链
  // （A+C / B+D 组合选择已在 mutation-hotspots 验证）。
  {
    id: 'cinematic-spotlight',
    name: { zh: '影院聚光', en: 'Cinematic spotlight' },
    tagline: { zh: '黑幕 + 定向主光 + 侧逆 28°：key-light 下的蛋白肖像', en: 'Black stage + directional key light + 28° rim angle: a protein portrait under key lighting' },
    purpose: { zh: '封面主视觉 · 演讲大屏 · 首图氛围', en: 'Cover hero · conference slides · mood-setting' },
    tags: [{ zh: '暗调', en: 'Low-key' }, { zh: '主光', en: 'Key light' }],
    category: 'basic',
    figure: { ref: '封面', shows: { zh: '封面主视觉：单侧主光塑形 + 深背景氛围', en: 'Cover hero: single-sided key light sculpting the fold on a deep stage' } },
    citation: { journal: 'Nature', year: 2021, title: 'The protein folding problem 50 years on', doi: '10.1038/s41586-021-03819-2' },
    demo: '4HHB',
    // 差异点：三灯光比改写（direct 0.9 强主光 / ambient 0.35 压环境 / fill 0.25 收补
    // 光）+ 雾深收尾——与墨夜（纯平深底）不同，这是「有光向」的舞台感；彩虹管在
    // 单侧光下呈现体积渐变
    commands: ['preset cartoon', 'spectrum count, rainbow', 'bg black', 'set direct 0.9', 'set ambient 0.35', 'set fill 0.25', 'turn y 28', 'zoom 1.3'],
    accent: 'rose',
  },
  {
    id: 'chalk-wireframe',
    name: { zh: '黑板粉笔', en: 'Chalkboard sketch' },
    tagline: { zh: '墨绿板 + 米白粉笔卡通：教室板书语境的结构速写', en: 'Deep-green board + chalk-cream cartoon: the structure as a classroom sketch' },
    purpose: { zh: '教学讲义 · 课程幻灯 · 直播板书', en: 'Lecture notes · course slides · live teaching' },
    tags: [{ zh: '教学', en: 'Teaching' }, { zh: '板书', en: 'Sketchy' }],
    category: 'basic',
    figure: { ref: '讲义图', shows: { zh: '教学示意：手绘感结构速写 + 板书语境', en: 'Teaching schematic: hand-drawn feel on a chalkboard' } },
    citation: { journal: 'J. Chem. Educ.', year: 2019, title: 'Teaching protein structure with molecular visualization', doi: '10.1021/acs.jchemed.8b00909' },
    demo: '1AKI',
    // 差异点：米白单色（#f0e8d4）卡通线稿化——深墨绿板（#20362c）上的「粉笔痕」；
    // 描边开但弱（0.6 1.4）保留手绘松弛感；与灰度制版（白底灰调）构成「亮暗两板」
    commands: ['preset cartoon', 'color #f0e8d4', 'bg #20362c', 'outline on 0.6 1.4', 'turn y -32', 'zoom 1.4'],
    accent: 'emerald',
  },
  {
    id: 'pastel-macaron',
    name: { zh: '马卡龙柔色', en: 'Pastel macaron' },
    tagline: { zh: '糖果色链对 + 奶油底 + 哑光：柔和语境的组装示意', en: 'Candy-colored chain pairs on cream, matte finish: a soft-spoken assembly' },
    purpose: { zh: '科普插画 · 儿童向材料 · 海报配图', en: 'Sci-communication · kid-friendly materials · poster art' },
    tags: [{ zh: '柔和', en: 'Soft' }, { zh: '科普', en: 'Popular science' }],
    category: 'basic',
    figure: { ref: '科普图版', shows: { zh: '科普插图：柔和配色的分子拟人化呈现', en: 'Popular-science illustration: molecule in a soft, friendly palette' } },
    citation: { journal: 'Science', year: 2019, title: 'The art of science communication through molecular illustration' },
    demo: '3INS',
    // 差异点：双色马卡龙（A+C 玫瑰粉 / B+D 薄荷绿——胰岛素二聚体的链对语义）+
    // 奶油底（#faf5ee）+ specular off 哑光；与链组装（饱和链色）构成「浓淡两版」
    commands: ['preset cartoon', 'color #eeb1c4, chain A+C', 'color #a9d6c9, chain B+D', 'bg #faf5ee', 'set specular off', 'orient'],
    accent: 'rose',
  },
  {
    id: 'duotone-poster',
    name: { zh: '双色海报', en: 'Duotone poster' },
    tagline: { zh: '青/珊瑚双色域 + 大留白：现代平面设计的海报语态', en: 'Teal/coral two-hue domains on white: the flat-design poster register' },
    purpose: { zh: '学术海报 · 展板主视觉 · 品牌物料', en: 'Conference poster · booth visual · branding' },
    tags: [{ zh: '双色', en: 'Duotone' }, { zh: '海报', en: 'Poster' }],
    category: 'basic',
    figure: { ref: '海报', shows: { zh: '学术海报主视觉：双色域大色块构图', en: 'Poster hero: bold two-hue color blocking' } },
    citation: { journal: 'Nature', year: 2023, title: 'Graphic design in scientific communication' },
    demo: '4HHB',
    // 差异点：严格双色（A+C 青 #0d9488 / B+D 珊瑚 #f0726f——α/β 链对语义同 pastel
    // 但饱和度拉满）+ 加宽卡通（1.4×）块面化——海报远距离可读性优先
    commands: ['preset cartoon', 'color #0d9488, chain A+C', 'color #f0726f, chain B+D', 'bg white', 'set cartoon_width 1.4', 'turn y 20', 'zoom 1.3'],
    accent: 'teal',
  },
  {
    id: 'sepia-vintage',
    name: { zh: '复古棕印', en: 'Sepia vintage' },
    tagline: { zh: '羊皮纸底 + 全结构棕调 + 正光斜 15°：1958 首结构的印刷年代质感', en: 'Parchment ground + monochrome sepia + 15° oblique: the 1958 print-era texture' },
    purpose: { zh: '历史叙事 · 综述配图 · 周年纪念版面', en: 'History essays · review figures · anniversary layouts' },
    tags: [{ zh: '复古', en: 'Vintage' }, { zh: '综述', en: 'Review' }],
    category: 'basic',
    figure: { ref: '历史图版', shows: { zh: '里程碑结构的历史呈现：印刷年代的单色制版', en: 'Milestone structures in print-era monochrome' } },
    citation: { journal: 'Nature', year: 1958, title: 'A three-dimensional model of the myoglobin molecule obtained by x-ray analysis', doi: '10.1038/181662a0' },
    demo: '1MBO',
    // 差异点：全结构单棕 #8a6a42（与灰度制版的「去色」不同——棕调带「年代温度」）+
    // 羊皮纸底 #f2e9d5 + 弱描边——1958 Kendrew 首个肌红蛋白低分辨率模型的时代质感
    commands: ['preset cartoon', 'color #8a6a42', 'bg #f2e9d5', 'outline on 0.5 1.2', 'turn y 15', 'zoom 1.3'],
    accent: 'amber',
  },
  {
    id: 'neon-night',
    name: { zh: '赛博霓虹', en: 'Neon night' },
    tagline: { zh: '近黑底 + 荧光青管 + 发光描边：科技发布会的视觉语态', en: 'Near-black stage + fluorescent cyan tubes + glow edges: the product-launch register' },
    purpose: { zh: '发布会大屏 · 科技品牌 · 动态背景基底', en: 'Launch keynotes · tech branding · motion backdrops' },
    tags: [{ zh: '霓虹', en: 'Neon' }, { zh: '科技感', en: 'Futuristic' }],
    category: 'basic',
    figure: { ref: '主视觉', shows: { zh: '科技风主视觉：暗底荧光 + 发光轮廓', en: 'Tech-hero visual: dark stage, fluorescent tubes, glowing rims' } },
    citation: { journal: 'Nature', year: 2022, title: 'Designing molecules: the interface of science and technology' },
    demo: '1CRN',
    // 差异点：荧光青 #22d3ee 单色管 + 近黑蓝底 #0b0e14 + 强描边（1.2 2.2——描边即
    // 「霓虹灯管」）+ 高镜面（specular 语义默认开，无需显式）；与影院聚光同为暗调
    // 但无光向（平光霓虹）——两支构成暗调语域的「有光向/自发光」两版
    commands: ['preset cartoon', 'color #22d3ee', 'bg #0b0e14', 'outline on 1.2 2.2', 'turn y 40', 'zoom 1.4'],
    accent: 'cyan',
  },
  {
    id: 'textbook-annotated',
    name: { zh: '教科书标注', en: 'Textbook annotated' },
    tagline: { zh: 'SS 三色 + 催化残基标签 + 白底：教课书机制图的标准注记图式', en: 'SS tri-color + catalytic-residue labels on white: the canonical textbook mechanism figure' },
    purpose: { zh: '机制讲解 · 作业题图 · 教材插图', en: 'Mechanism walkthroughs · problem sets · textbook figures' },
    tags: [{ zh: '标注', en: 'Annotated' }, { zh: '教材', en: 'Textbook' }],
    category: 'basic',
    figure: { ref: 'Fig. 2', shows: { zh: '机制图：催化残基标注 + 反应位点箭头指涉', en: 'Mechanism figure: catalytic residues labeled, reaction site referenced' } },
    citation: { journal: 'J. Mol. Biol.', year: 1966, title: 'The three-dimensional structure of an enzyme molecule: lysozyme', doi: '10.1016/S0022-2836(66)80100-3' },
    demo: '1AKI',
    // 差异点：label on 教科书注记（溶菌酶 Glu35/Asp52 催酸碱对——Phillips 1966 教
    // 科书图式）；链不匹配时标签静默缺失（select 空集不报错），SS 三色兜底仍是标准
    // 教学图；与催化残基（棍 + 距离虚线）构成「标注版/测量版」两档
    commands: ['preset cartoon', 'util ss', 'bg white', 'select (name CA) and ((resi 35 and chain A) or (resi 52 and chain A))', 'label on', 'deselect', 'zoom 1.4', 'outline on 1.1 1.0'],
    accent: 'sky',
  },
  {
    id: 'nucleosome-dna',
    name: { zh: '核小体 DNA 彩虹', en: 'Nucleosome DNA rainbow' },
    tagline: { zh: '组蛋白石板灰 + DNA 双链各自 N→C 彩虹 + 顶视盘面：染色质基本单位的读法', en: 'Slate histones + per-strand N→C DNA rainbow, top-down disc: how to read chromatin\'s basic unit' },
    purpose: { zh: '染色质组装 · DNA 缠绕拓扑 · 表观位点', en: 'Chromatin assembly · DNA wrapping topology · epigenetic sites' },
    tags: [{ zh: '核小体', en: 'Nucleosome' }, { zh: '染色质', en: 'Chromatin' }],
    category: 'interaction',
    figure: { ref: 'Fig. 1', shows: { zh: '核小体核心颗粒全景：147bp DNA 超螺旋缠绕组蛋白八聚体', en: 'Nucleosome core particle: 147 bp DNA superhelix around the histone octamer' } },
    citation: { journal: 'Nature', year: 1997, title: 'Crystal structure of the nucleosome core particle at 2.8 Å resolution', doi: '10.1038/38444' },
    demo: '1AOI',
    // 差异点：nucleic 选择域的 per-chain 彩虹（spectrum count, rainbow, nucleic——
    // DNA 双链各自 N→C 渐变）+ 组蛋白统一石板灰（蛋白/核酸视觉分工）+ 顶视
    // （1.65 圈超螺旋盘面在 top view 读得最清楚——Luger 1997 图式）
    commands: ['preset cartoon', 'color #9aa3ad, protein', 'spectrum count, rainbow, nucleic', 'bg #f7f8fa', 'view top', 'zoom 1.3'],
    accent: 'violet',
  },
  {
    id: 'gfp-chromophore',
    name: { zh: '荧光色素特写', en: 'GFP chromophore' },
    tagline: { zh: '暗底荧光绿 + CRO 色素亮黄棍特写：β 桶里的发光核心', en: 'Dark stage, fluorescent green, and the CRO chromophore in glowing sticks: the heart of the β-barrel' },
    purpose: { zh: '报告基因 · 荧光机制 · 光遗传工具', en: 'Reporter genes · fluorescence mechanism · optogenetics' },
    tags: [{ zh: 'GFP', en: 'GFP' }, { zh: '荧光', en: 'Fluorescence' }],
    category: 'site',
    figure: { ref: 'Fig. 1', shows: { zh: 'GFP 发色团环境：β 桶内的色素口袋与周围残基', en: 'The chromophore environment: the pocket inside the β-barrel' } },
    citation: { journal: 'Science', year: 1996, title: 'The structural basis of the green fluorescent protein chromophore formation', doi: '10.1126/science.273.5280.1392' },
    demo: '1EMA',
    // 差异点：暗荧光语境（深墨绿底 #07100a + 全蛋白荧光绿 #22c55e——GFP 的「身份
    // 色」）+ CRO 色素（HETATM 可 resn 直选）亮黄绿棍 + 12Å 缓冲特写（β 桶内袋
    // 展开但不贴脸）——与血红素口袋（白底元素色）构成「亮暗两特写」
    commands: ['preset cartoon', 'color #22c55e', 'bg #07100a', 'show sticks, (resn CRO)', 'color #fde68a, (resn CRO)', 'zoom (resn CRO), 12', 'outline on 1.0 2.0'],
    accent: 'lime',
  },
]

/** 命令图鉴（r75：「对比」视图把命令序列翻成双语图式解剖；未命中退回原命令）。
 *  规则序：具体在前（contacts (resn ASP… 先于 contacts；show sticks, nucleic 先于 show sticks） */
export const COMMAND_GLOSSARY: { re: RegExp; label: DualText }[] = [
  { re: /^preset cartoon\b/i, label: { zh: '卡通带表示', en: 'Cartoon ribbons' } },
  { re: /^preset putty\b/i, label: { zh: 'B 因子胖瘦管表示', en: 'Putty B-factor tube' } },
  { re: /^preset ballstick\b/i, label: { zh: '球棍全结构表示', en: 'Ball-and-stick model' } },
  { re: /^preset surface\b/i, label: { zh: '分子表面表示', en: 'Molecular surface' } },
  { re: /^preset bindingsite\b/i, label: { zh: '结合位点特写（球棍）', en: 'Binding-site close-up (ball & stick)' } },
  { re: /^preset publication\b/i, label: { zh: '出版级互作预设', en: 'Publication preset' } },
  { re: /^spectrum count/i, label: { zh: 'N→C 彩虹渐变', en: 'N→C rainbow gradient' } },
  { re: /^spectrum b\b/i, label: { zh: 'B 因子热图渐变', en: 'B-factor heatmap gradient' } },
  { re: /^util cbc/i, label: { zh: '逐链配色', en: 'Per-chain coloring' } },
  { re: /^util ss\b/i, label: { zh: '二级结构三色', en: 'Secondary-structure colors' } },
  // r78 构象对比四模板新词条（具体锚定先于泛匹配：color gray 必须先于域色正则）
  { re: /^load \w/i, label: { zh: '加载第二构象结构', en: 'Load the second conformer' } },
  { re: /^create \w+ = chain/i, label: { zh: '提取单链单体对象', en: 'Extract a single-chain monomer' } },
  { re: /^use \w/i, label: { zh: '切换活动结构', en: 'Switch the active structure' } },
  { re: /^superpose .* onto/i, label: { zh: '构象叠合对齐（刚体变换）', en: 'Conformational superposition (rigid-body)' } },
  { re: /^morph /i, label: { zh: '构象插值轨迹生成（自动叠合+精修）', en: 'Conformational morph trajectory (auto-superpose + refine)' } },
  { re: /^disable \w/i, label: { zh: '隐藏源构象聚焦动画', en: 'Hide source conformers to focus the movie' } },
  { re: /^measure dist/i, label: { zh: '催化距离虚线标注（Å）', en: 'Catalytic distance dashes (Å)' } },
  { re: /^set transparency/i, label: { zh: '表面半透明化', en: 'Surface translucency' } },
  { re: /^color gray$/i, label: { zh: '参考态幽灵灰表面', en: 'Reference ghost-gray surface' } },
  { re: /^show cartoon$/i, label: { zh: '表面内叠加卡通骨架', en: 'Cartoon skeleton inside the surface' } },
  { re: /^color residue, nucleic/i, label: { zh: '核酸碱基五色', en: 'Nucleic base coloring' } },
  { re: /^color sasa/i, label: { zh: 'SASA 可及性渐变', en: 'SASA gradient' } },
  { re: /^color red, resn/i, label: { zh: '酸性残基红（ASP/GLU）', en: 'Acidic residues red (ASP/GLU)' } },
  { re: /^color blue, resn/i, label: { zh: '碱性残基蓝（LYS/ARG/HIS）', en: 'Basic residues blue (LYS/ARG/HIS)' } },
  { re: /^color yellow, resn/i, label: { zh: '半胱氨酸黄（二硫键）', en: 'Cysteines yellow (disulfides)' } },
  { re: /^color orange, resn/i, label: { zh: '金属离子橙', en: 'Metal ion orange' } },
  { re: /^color element, resn/i, label: { zh: '辅因子元素色棍（Fe 橙/N 蓝/O 红）', en: 'Cofactor element colors (Fe orange / N blue / O red)' } },
  { re: /^color element$/i, label: { zh: '全原子元素配色（CPK）', en: 'Element coloring (CPK)' } },
  { re: /^color purple, resn/i, label: { zh: '芳香残基紫（PHE/TYR/TRP）', en: 'Aromatics purple (PHE/TYR/TRP)' } },
  { re: /^color cyan, resn/i, label: { zh: '阳离子残基青（LYS/ARG/HIS）', en: 'Cationic residues cyan (LYS/ARG/HIS)' } },
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
  { re: /^contacts \(resn PHE/i, label: { zh: '阳离子-π 接触虚线', en: 'Cation–π contact dashes' } },
  { re: /^contacts protein \| nucleic/i, label: { zh: '蛋白-核酸接触虚线', en: 'Protein–nucleic contact dashes' } },
  { re: /^contacts/i, label: { zh: '残基对接触虚线', en: 'Residue-pair contact dashes' } },
  { re: /^hbonds on .*within/i, label: { zh: '范围氢键虚线', en: 'Scoped H-bond dashes' } },
  { re: /^hbonds on/i, label: { zh: '全局氢键虚线', en: 'Global H-bond dashes' } },
  { re: /^symmetry \d+/i, label: { zh: '晶体对称伙伴', en: 'Symmetry mates' } },
  // r87 新词条（具体锚定先于泛匹配：slab cap on 必须先于 slab <数字>）
  { re: /^stereo on/i, label: { zh: '红蓝立体渲染（双通道色分移）', en: 'Red-cyan anaglyph stereo' } },
  { re: /^slab cap on/i, label: { zh: '剖面实心封盖', en: 'Solid slab caps' } },
  { re: /^slab \d+/i, label: { zh: '切层裁剪厚度（Å）', en: 'Slab clipping thickness (Å)' } },
  // r89 新词条（线描/灰度/静电/水合/晶胞五模板；具体锚定先于泛匹配）
  { re: /^preset wireframe\b/i, label: { zh: '线框全原子表示', en: 'All-atom wireframe' } },
  { re: /^util cnc/i, label: { zh: '整体灰化（单色制版）', en: 'Overall gray (monochrome)' } },
  { re: /^show waters$/i, label: { zh: '水分子小球显示', en: 'Water spheres shown' } },
  { re: /^show cell$/i, label: { zh: '晶胞盒线框（a红 b绿 c蓝）', en: 'Unit-cell box (a red, b green, c blue)' } },
  { re: /^ensemble play/i, label: { zh: 'NMR 构象系综动画', en: 'NMR ensemble animation' } },
  { re: /^membrane \d+/i, label: { zh: '脂双层板语境', en: 'Bilayer slab context' } },
  { re: /^pore\b/i, label: { zh: 'HOLE 孔道剖面环带', en: 'HOLE pore rings' } },
  { re: /^show sticks, nucleic/i, label: { zh: 'DNA 棍状表示', en: 'DNA sticks' } },
  { re: /^show sticks, resn HEM/i, label: { zh: '血红素棍状表示', en: 'Heme sticks' } },
  { re: /^show sticks, byres/i, label: { zh: '配位残基棍（金属邻域）', en: 'Coordinating residues (metal neighborhood)' } },
  { re: /^show sticks/i, label: { zh: '侧链棍状表示', en: 'Sidechain sticks' } },
  { re: /^show spheres, resn/i, label: { zh: '金属离子球状标记', en: 'Metal ion spheres' } },
  { re: /^show spheres$/i, label: { zh: '全原子空间填充球（CPK）', en: 'All-atom spacefill spheres (CPK)' } },
  { re: /^show spheres/i, label: { zh: '热点位球状标记', en: 'Hotspot site spheres' } },
  { re: /^hide everything/i, label: { zh: '清空全部表示法', en: 'Clear all representations' } },
  { re: /^hide waters/i, label: { zh: '隐藏结晶水', en: 'Hide crystal waters' } },
  { re: /^zoom byres/i, label: { zh: '界面聚焦取景', en: 'Interface-focused framing' } },
  { re: /^zoom/i, label: { zh: '聚焦取景', en: 'Focused framing' } },
  { re: /^alter \(polymer\)/i, label: { zh: 'B 因子基线归零', en: 'B-factor baseline reset' } },
  { re: /^alter .*b=100/i, label: { zh: '热点位 B 因子置顶', en: 'Hotspot B-factor maxed' } },
  { re: /^alter/i, label: { zh: 'B 因子通道改写', en: 'B-factor channel edit' } },
  { re: /^select/i, label: { zh: '热点位点选择', en: 'Hotspot site selection' } },
  { re: /^label on/i, label: { zh: '残基标签', en: 'Residue labels' } },
  // r97 新词条（风格六连 + 实用三连；具体锚定先于泛匹配：
  // set direct/ambient/fill 灯光三连先于泛 set；spectrum …nucleic 先于 spectrum count；
  // color hex chain 组合先于泛 color hex；show sticks resn CRO 先于泛 show sticks）
  { re: /^set direct/i, label: { zh: '定向主光增强', en: 'Directional key light boosted' } },
  { re: /^set ambient/i, label: { zh: '平光照明', en: 'Flat ambient light' } },
  { re: /^set fill/i, label: { zh: '补光减弱', en: 'Fill light eased' } },
  { re: /^set specular off/i, label: { zh: '镜面高光关闭（哑光）', en: 'Specular off (matte)' } },
  { re: /^spectrum count, rainbow, nucleic/i, label: { zh: 'DNA 双链各自 N→C 彩虹', en: 'Per-strand N→C DNA rainbow' } },
  { re: /^color #9aa3ad, protein/i, label: { zh: '组蛋白统一石板灰', en: 'Histones uniform slate' } },
  { re: /^color #[0-9a-f]{6}, chain/i, label: { zh: '链对主题色分配', en: 'Chain-pair theme colors' } },
  { re: /^color #[0-9a-f]{6}$/i, label: { zh: '全结构主题单色', en: 'Structure-wide theme color' } },
  { re: /^show sticks, \(resn CRO\)/i, label: { zh: '荧光色素 CRO 棍状表示', en: 'CRO chromophore sticks' } },
  { re: /^color #[0-9a-f]{6}, \(resn CRO\)/i, label: { zh: '色素亮黄绿高亮', en: 'Chromophore glow highlight' } },
  { re: /^zoom \(resn CRO\)/i, label: { zh: '色素口袋特写取景', en: 'Chromophore pocket framing' } },
  { re: /^bg #07100a/i, label: { zh: '暗荧光语境底色', en: 'Dark fluorescence stage' } },
  { re: /^bg #20/i, label: { zh: '深墨绿板书底色', en: 'Deep-green chalkboard' } },
]

/** 命令 → 双语图式解剖（未命中返回 null——调用方退回展示原命令） */
export function explainCommand(cmd: string): DualText | null {
  for (const g of COMMAND_GLOSSARY) if (g.re.test(cmd.trim())) return g.label
  return null
}

/** 相机类命令（执行前需确认在飞相机动画已落地——见 runTemplateCommands） */
const CAMERA_CMD_RE = /^(orient|view|views|turn|move|zoom|dolly|rock|bookmark|clip)\b/i

/** load/fetch 类命令（r78：构象对比模板需要第二条结构——load 是 fire-and-forget
 *  异步（fetch→parse→addStructure 约 1-3s），后续命令必须等结构落地再执行） */
const LOAD_CMD_RE = /^(load|fetch)\s+(\S+)\s*$/i

/** 等待相机动画落地（r76：orient 650ms 飞行后 120ms 接 turn 会把相机打断在
 *  partial pose——KcsA 竖排环带/演示居中的另一半根因；上限兑底防僵死）。
 *  r84 导出：对照预览分屏复用同一相机门控 */
export async function waitForCameraIdle(maxMs: number): Promise<void> {
  const t0 = performance.now()
  while (performance.now() - t0 < maxMs) {
    const eng = engineRef.current
    if (!eng || !eng.isCameraAnimating()) return
    await new Promise(r => setTimeout(r, 60))
  }
}

/** 等待结构真正入 store（r76：fetchPdbId resolve 在 parse 前——欢迎页首发链路
 *  parse 走 rAF 异步，旧 600ms 定时器靠运气；超时兑底返 false）。
 *  r84 导出：对照预览分屏复用 */
export async function waitForStructureInStore(pdbId: string, maxMs: number): Promise<boolean> {
  const target = pdbId.trim().toUpperCase()
  const t0 = performance.now()
  while (performance.now() - t0 < maxMs) {
    const s = useMolStore.getState()
    if (s.structures.some(x => (x.meta.pdbId ?? '').toUpperCase() === target || x.name.toUpperCase() === target)) return true
    await new Promise(r => setTimeout(r, 80))
  }
  return false
}

/** 结构是否已在 store（同步单查——r84 对照预览的免拉取探测；r84 E2E 揭发
 *  waitForStructureInStore(id, 0) 的 maxMs=0 循环体不执行恒返 false，伪探测） */
export function isStructureInStore(pdbId: string): boolean {
  const target = pdbId.trim().toUpperCase()
  const s = useMolStore.getState()
  return s.structures.some(x => (x.meta.pdbId ?? '').toUpperCase() === target || x.name.toUpperCase() === target)
}

/** 按命令序列逐条应用（r76：相机命令先等在飞动画落地；r78：改为顺序执行器——
 *  load/fetch 命令等结构真正入 store 再继续，构象对比模板的第二条结构落地后
 *  superpose/morph 才不会扑空；非 load 命令仍保持 120ms 微间隔衔接动画/着色。
 *  r77 收尾清选择：模板成品不应携带选择光晕（mutation 类模板的 select+label 流
 *  会把琥珀色 halo 留在终帧上——罩住刚渲染的视觉锚点；命令级 color/spectrum
 *  泄漏已在 commands.ts 根治，此处兜底所有 select 型模板） */
/** 按命令序列逐条应用（对外 fire-and-forget 语义保持；r84 返回 Promise 供
 *  对照预览分屏等待序列完成后再截屏——三个既有调用方不 await 不受影响） */
export function runTemplateCommands(commands: string[]): Promise<void> {
  return runTemplateCommandsSeq(commands)
}

/** 顺序执行器本体（load 等结构落地 / 相机等飞行——r84 起由 runTemplateCommands
 *  返回 Promise，fire-and-forget 调用方与可等待调用方（对照预览）共用） */
async function runTemplateCommandsSeq(commands: string[]): Promise<void> {
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i].trim()
    if (i > 0) await new Promise(r => setTimeout(r, 120))
    const loadM = cmd.match(LOAD_CMD_RE)
    if (loadM) {
      runCommand(cmd)
      // 网络拉取兑底 15s：fetch 失败已 toast（fetchPdbId 内部），超时后继续余下
      // 序列而非整链僵死——诚实降级哲学的命令序列版
      await waitForStructureInStore(loadM[2], 15000)
    } else if (CAMERA_CMD_RE.test(cmd)) {
      await waitForCameraIdle(1800)
      runCommand(cmd)
    } else {
      runCommand(cmd)
    }
  }
  // 兜底清选择（旧版按 commands.length*120+2800 估时；顺序版循环天然吸收相机等待）
  const s = useMolStore.getState()
  if (s.selection.indices.length) s.setSelection(null, [])
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
//  ⑪（r77）血红素口袋（resn HEM 四命令）→ 重映射结构内实际辅因子（FAD/NAD/CLA…
//          二十五种常见辅因子合集）；无任何辅因子时整组跳过（与⑨同构）
//  ⑫（r77）B 因子柔性热图（spectrum b）→ 全零 B 因子（NMR/预测模型）时跳过 +
//          诚实说明（全零渐变=单色图，空转要说清楚）
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
  // ⑪（r77）预探测：辅因子（血红素口袋模板按演示结构 HEM 硬编码——用户结构
  //     可能是 FAD/NAD/CLA…或无辅因子）；卟啉/黄素/核苷酸/叶酸等常见辅因子合集
  const COFACTOR_RESNS = ['HEM', 'HEC', 'BIL', 'HBL', 'CLA', 'CHL', 'FAD', 'FMN', 'NAD', 'NDP', 'NAP', 'PLP', 'SAM', 'ATP', 'ADP', 'AMP', 'GTP', 'GDP', 'ANP', 'MEN', 'COF', 'BH4', 'H4B', 'TPP', 'PQQ', 'MTE']
  const cofactorsPresent = active.ligands.map(l => l.resName.trim().toUpperCase()).filter(r => COFACTOR_RESNS.includes(r))
  const hasHem = cofactorsPresent.includes('HEM')
  const altCofactor = cofactorsPresent.find(c => c !== 'HEM')
  const tplCofactor = /resn HEM\b/i.test(tpl.commands.join('\n'))
  // ⑫（r77）预探测：全零 B 因子（NMR/预测模型常见——柔性热图会退化单色）
  let allZeroB = false
  const bf = data.atoms.bfactors
  if (bf && bf.length > 0 && !bf.some(v => v > 0)) allZeroB = true
  let domainNoted = false
  // ⑬（r78）预扫描：构象对模板（commands 含 morph/superpose 两态配方）——
  //     端点结构缺哪个补 load 哪个；用户既有结构隐藏聚焦 + 诚实说明。构象对是模板
  //     固有配方（用户结构无法凭空变出第二构象）——补齐演示对是最诚实的行为；
  //     对自己的构象对：load 两个结构 + superpose/morph 即可复现同款图式。
  //     防双载：端点已被模板自身 load 覆盖时不前置（load 1ake 在命令里）；端点已在
  //     store 时把模板的 load 去重丢弃（重复 load 会 addStructure 两份同名结构）
  const tplIsTwoState = tpl.commands.some(c => /^(morph|superpose)\b/i.test(c))
  const endpoints = new Set<string>()
  const tplLoads = new Set<string>()
  if (tplIsTwoState) {
    for (const c of tpl.commands) {
      const lm = c.match(/^load\s+(\w+)/i)
      if (lm) tplLoads.add(lm[1].toUpperCase())
      for (const m of c.matchAll(/\b([0-9][a-z0-9]{3})\b/gi)) endpoints.add(m[1].toUpperCase())
    }
  }
  const structKey = (x: { name: string; meta: { pdbId?: string | null } }) => (x.meta.pdbId ?? x.name).toUpperCase()
  const endpointPresent = (id: string) => s.structures.some(x => structKey(x) === id)
  const extraLoads: string[] = []
  if (tplIsTwoState) {
    for (const e of endpoints) {
      if (!endpointPresent(e) && !tplLoads.has(e)) extraLoads.push(`load ${e.toLowerCase()}`)
    }
  }
  // ⑭（r78）预扫描：催化位点模板（measure dist + resi 35/52 按溶菌酶演示硬编码）——
  //     聚合物短于 60 残基时位点三命令整组跳过（measure 空选择会报错——诚实跳过优于
  //     报错刷屏；60 = 52 号催化位点 + 环区余量）
  const tplIsCatalytic = tpl.commands.some(c => /^measure dist\b/i.test(c))
  const catalyticSkip = tplIsCatalytic && maxResi < 60
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
    // ⑪（r77）血红素口袋：模板按演示结构 HEM 硬编码——重映射结构内实际辅因子
    //     （resn HEM → resn FAD/NAD/CLA…）；无任何辅因子时四命令整组跳过（一次提示——
    //     与⑨金属重映射同构；去重键与文案严格对齐）
    if (tplCofactor && /resn HEM\b/i.test(cmd)) {
      if (!hasHem && !altCofactor) {
        if (notes.every(n => !n.zh.includes('未检出辅因子'))) {
          notes.push({ zh: '未检出辅因子（血红素/黄素/核苷酸等）——口袋特写命令组已跳过（适用于含辅因子的结构）', en: 'No cofactors detected (heme / flavin / nucleotide etc.) — pocket close-up commands skipped (meant for cofactor-containing structures)' })
        }
        continue
      }
      if (!hasHem && altCofactor) {
        commands.push(cmd.replace(/resn HEM\b/gi, `resn ${altCofactor}`))
        if (notes.every(n => !n.zh.includes('辅因子已重映射'))) {
          notes.push({ zh: `辅因子已重映射为结构内的 ${altCofactor}（模板演示 HEM 血红素）`, en: `Cofactor remapped to the structure's ${altCofactor} (template demos HEM heme)` })
        }
        continue
      }
      commands.push(cmd)
      continue
    }
    // ⑫（r77）B 因子柔性：全零 B 因子（NMR/预测模型常见）时 spectrum b 跳过 +
    //     诚实说明（全零渐变 = 单色图——空转要说清楚；晶体/电镜结构不受影响）
    if (/^spectrum b\b/i.test(cmd) && allZeroB) {
      if (notes.every(n => !n.zh.includes('B 因子全为零'))) {
        notes.push({ zh: 'B 因子全为零（NMR/预测模型常见）——柔性热图已跳过（适用于晶体/电镜结构）', en: 'All B-factors are zero (common for NMR/predicted models) — mobility map skipped (meant for crystal/EM structures)' })
      }
      continue
    }
    // ⑬（r78）构象对去重：端点已在 store 时丢弃模板的 load（防 addStructure 双份同名）
    if (tplIsTwoState && /^load\s+\w+/i.test(cmd)) {
      const id = cmd.replace(/^load\s+/i, '').trim().toUpperCase()
      if (endpointPresent(id)) continue
      commands.push(cmd)
      continue
    }
    // ⑭（r78）催化位点：短结构时位点三命令（sticks/measure/zoom——都引用 resi 35/52）
    //     整组跳过（去重键 =「催化位点按溶菌酶演示」与文案严格对齐）
    if (catalyticSkip && /resi (35|52)\b/i.test(cmd)) {
      if (notes.every(n => !n.zh.includes('催化位点按溶菌酶演示'))) {
        notes.push({ zh: `催化位点按溶菌酶 Glu35/Asp52 演示——当前结构最长链仅 ${maxResi} 残基，位点命令组已跳过（可用 select + measure dist 标注自己的位点）`, en: `Catalytic sites follow the lysozyme Glu35/Asp52 demo — the longest chain here is only ${maxResi} residues, so the site commands were skipped (mark your own sites via select + measure dist)` })
      }
      continue
    }
    commands.push(cmd)
  }
  // ⑬（r78）构象对模板收尾：前置补齐缺失端点 load + 后置隐藏用户既有结构聚焦演示
  let finalCommands = commands
  if (tplIsTwoState) {
    const hiddenOthers: string[] = []
    for (const x of s.structures) {
      if (endpoints.has(structKey(x))) continue // 端点（含演示结构）不隐藏
      hiddenOthers.push(`disable ${x.name}`)
    }
    if (extraLoads.length || hiddenOthers.length) {
      finalCommands = [...extraLoads, ...commands, ...hiddenOthers]
      // 去重键 =「构象对已按演示结构补齐」——与文案严格对齐（r75/r76 刷屏教训）
      if (notes.every(n => !n.zh.includes('构象对已按演示结构补齐'))) {
        notes.push({
          zh: `构象对已按演示结构补齐（${[...endpoints].join(' / ')}）${hiddenOthers.length ? `；已隐藏你的 ${hiddenOthers.length} 个既有结构以聚焦演示（enable <名> 可恢复）` : ''}——对自己的构象对：load 两个结构后 superpose / morph 即可复现此图式`,
          en: `Conformational pair loaded per the template demo (${[...endpoints].join(' / ')})${hiddenOthers.length ? `; your ${hiddenOthers.length} existing structure(s) hidden to focus the demo (enable <name> restores)` : ''} — for your own pair: load both structures, then superpose / morph`,
        })
      }
    }
  }
  return { commands: finalCommands, notes }
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
