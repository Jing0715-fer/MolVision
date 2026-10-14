// Agent 标准技能注册表（r105）：把高频 agent 操作标准化为「标准流程 + 固定报告格式」。
// 动机：此前 LLM 自由发挥命令组合，同类需求（口袋分析/出版图/氢键网络）每次走不同路径，
// 回复格式散乱无法比对。skill 化后：前端 matchSkill 识别用户意图 → 请求带 skillId →
// 后端把该技能的标准 workflow + 固定报告模板注入系统提示 → LLM 按标准流程出命令、
// 按固定格式出报告文稿。纯数据 + 纯函数（无 window/document 依赖，route.ts 服务端可 import）。

/** 技能工作流的单个步骤 */
export interface SkillStep {
  /** 步骤名（中/英） */
  label: { zh: string; en: string }
  /** 标准命令模板（LLM 按场景替换选择表达式与数值参数，步骤顺序不可省略） */
  cmd: string
  /** 该步的验证点 / 输出说明（帮 LLM 理解这步为什么在） */
  check?: { zh: string; en: string }
}

/** 报告文稿的固定章节 */
export interface ReportSection {
  /** 章节标签（报告行前缀，渲染检测锚） */
  key: string
  label: { zh: string; en: string }
  /** 该节填写内容的说明（数值来自命令回执与场景信息，不许编造） */
  hint: { zh: string; en: string }
  /** r109-b 报告节点击跳转命令：'view'/'zoom'/'ray'/'preset' = 回放该消息最后一条成功的
   *  同类命令（view from/orient · zoom 系 · ray 系 · preset 系——场景实参已在该命令里，
   *  如 view from (chain A and chain B) 已被 LLM 按场景替换过），回放源缺失时 view→orient、
   *  zoom→bare zoom 静态兜底（恒安全），ray/preset 无兜底不跳；其余字符串 = 静态命令原样执行；
   *  缺省 = 该节不可跳转（纯信息节）。报告从只读文稿升级为可交互分析入口 */
  jump?: string
}

/** 标准技能定义 */
export interface AgentSkill {
  /** 技能标识（请求体 skillId 引用；中横线小写） */
  id: string
  name: { zh: string; en: string }
  /** 适用场景描述（给人看的；UI 徽章 tooltip 用） */
  description: { zh: string; en: string }
  /** 触发词：strong 单个命中即选中（≥2 分）；weak 需组合（1 分/个） */
  triggers: {
    strong: { zh: string[]; en: string[] }
    weak: { zh: string[]; en: string[] }
  }
  /** 标准流程（LLM 必须遵循的步骤序列） */
  workflow: SkillStep[]
  /** 输出报告的固定章节（reply 的文稿格式） */
  report: { sections: ReportSection[] }
}

/**
 * 预置技能库（11 支：r105 六支 + r106 扩容四支 + r122-a 表面疏水分析）——全部命令均在 runner.ts 白名单内
 * （membrane/pore 已随 r105 补入；sasa/xcontacts/superpose/morph/symmetry 本就在册）。
 * workflow 与 SYSTEM_PROMPT 行为规则严格一致（pub-figure 即规则 18 出版流程的 skill 化）。
 */
export const AGENT_SKILLS: AgentSkill[] = [
  {
    id: 'ligand-pocket',
    name: { zh: '配体口袋分析', en: 'Ligand Pocket Analysis' },
    description: {
      zh: '分析配体结合口袋：接触残基、氢键、出版级互作图一站式标准流程',
      en: 'Analyze a ligand-binding pocket: contact residues, hydrogen bonds, and a publication-grade interaction view in one standard workflow',
    },
    triggers: {
      strong: {
        zh: ['口袋分析', '结合位点', '结合口袋', '互作分析', '相互作用分析', '配体环境', '配体怎么结合', '药物结合'],
        en: ['binding site', 'binding pocket', 'pocket analysis', 'ligand interaction', 'interaction analysis'],
      },
      weak: {
        zh: ['配体', '口袋', '互作', '结合模式'],
        en: ['ligand', 'pocket', 'interaction'],
      },
    },
    workflow: [
      { label: { zh: '互作接触分析', en: 'Contact analysis' }, cmd: 'contacts ligand | polymer 4.5', check: { zh: '接触残基与距离输出在控制台 + 分析面板可点击表格', en: 'Contact residues & distances in console + clickable analysis panel' } },
      { label: { zh: '出版级互作表示', en: 'Publication preset' }, cmd: 'preset publication', check: { zh: 'cartoon 链色 + 配体碳鲜绿 + 口袋残基距离渐变 + 自动聚焦', en: 'Chain-colored cartoon + green ligand + distance-graded pocket + auto focus' } },
      { label: { zh: '口袋氢键烘焙', en: 'Pocket H-bonds' }, cmd: 'hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water', check: { zh: '烘焙独立范围（不依赖选择集）；范围含配体本身才能画出配体-残基氢键', en: 'Baked scope independent of selection; must include the ligand itself' } },
      { label: { zh: '口袋标准视角', en: 'Pocket view' }, cmd: 'view from ligand', check: { zh: '口袋正对相机 + 自适应特写；多配体自动挑最近实例；其后不要叠加 zoom', en: 'Pocket facing camera with adaptive close-up; nearest ligand picked automatically' } },
      { label: { zh: '清除选中高亮', en: 'Deselect' }, cmd: 'deselect', check: { zh: '画面与 UI 双清洁；hbonds 烘焙范围不受影响', en: 'Clean canvas & UI; baked hbond scope unaffected' } },
    ],
    report: {
      sections: [
        { key: 'struct', label: { zh: '结构与配体', en: 'Structure & ligand' }, hint: { zh: '结构名 + 配体名（含链与实例数）', en: 'Structure name + ligand name (chain & copies)' } },
        { key: 'residues', label: { zh: '口袋残基', en: 'Pocket residues' }, hint: { zh: '4.5Å 内接触残基数与关键残基列举（≤6 个）', en: 'Contact residues within 4.5Å (list ≤6)' }, jump: 'view' },
        { key: 'hbonds', label: { zh: '氢键', en: 'H-bonds' }, hint: { zh: '口袋范围氢键条数；点名配体-残基关键氢键（如有）', en: 'H-bond count in pocket; notable ligand-residue bonds' }, jump: 'zoom within 6 of (ligand)' },
        { key: 'contacts', label: { zh: '接触对', en: 'Contact pairs' }, hint: { zh: 'contacts 命令输出的接触对总数与最近距离', en: 'Total contact pairs & closest distance' }, jump: 'view' },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '基于上述数值的下一步操作建议（≤40 字）', en: 'Next-step suggestion based on the numbers (≤40 chars)' } },
      ],
    },
  },
  {
    id: 'hbond-network',
    name: { zh: '氢键网络分析', en: 'H-bond Network Analysis' },
    description: {
      zh: '指定范围（配体口袋/残基群/链间）的氢键网络统计与可视化标准流程',
      en: 'Standard workflow for H-bond network statistics and visualization over a chosen scope',
    },
    triggers: {
      strong: {
        zh: ['氢键网络', '氢键分析', '氢键统计', 'h键网络'],
        en: ['hbond network', 'hydrogen bond network', 'hbond analysis'],
      },
      weak: {
        zh: ['氢键', '氢键多少'],
        en: ['hbond', 'hydrogen bond', 'h-bond'],
      },
    },
    workflow: [
      { label: { zh: '烘焙氢键范围', en: 'Bake hbond scope' }, cmd: 'hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water', check: { zh: '默认口袋模板；用户点名其他范围时替换选择表达式（残基群/链对），键长按需 3.0-3.6', en: 'Pocket template by default; replace selector for other scopes' } },
      { label: { zh: '范围原子计数', en: 'Scope count' }, cmd: 'count_atoms byres(within 4.5 of (ligand)) and not water', check: { zh: '确认烘焙范围非空（0 则说明场景无配体，改用蛋白主链范围）', en: 'Confirm non-empty scope' } },
      { label: { zh: '聚焦范围', en: 'Focus scope' }, cmd: 'zoom within 6 of (ligand)', check: { zh: '氢键虚线在全景下不可见——必须聚焦', en: 'Dashes invisible at full view — must focus' } },
    ],
    report: {
      sections: [
        { key: 'scope', label: { zh: '分析范围', en: 'Scope' }, hint: { zh: '氢键烘焙的范围描述（选择表达式语义化）', en: 'Human-readable scope description' } },
        { key: 'count', label: { zh: '氢键条数', en: 'H-bond count' }, hint: { zh: '状态栏/徽章显示的当前氢键总数', en: 'Total H-bonds from status badge' }, jump: 'zoom' },
        { key: 'main', label: { zh: '主要相互作用', en: 'Key interactions' }, hint: { zh: '关键氢键对列举（残基-残基 / 配体-残基，≤4 对）', en: 'Notable H-bond pairs (≤4)' }, jump: 'zoom' },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '下一步操作建议（≤40 字）', en: 'Next-step suggestion (≤40 chars)' } },
      ],
    },
  },
  {
    id: 'interface-analysis',
    name: { zh: '界面接触分析', en: 'Interface Analysis' },
    description: {
      zh: '蛋白-蛋白界面（二聚体/抗体-抗原/链间）的接触对、埋藏面积与关键距离标准流程',
      en: 'Protein-protein interface contacts, buried area, and key distances in one standard workflow',
    },
    triggers: {
      strong: {
        zh: ['界面分析', '接触面分析', '蛋白蛋白互作', '结合界面', '二聚体界面', '界面残基'],
        en: ['interface analysis', 'protein-protein interaction', 'dimer interface', 'interface residues'],
      },
      weak: {
        zh: ['界面', '接触面', '链间互作', '接触'],
        en: ['interface', 'contact surface'],
      },
    },
    workflow: [
      { label: { zh: '界面接触计算', en: 'Interface contacts' }, cmd: 'interface A B', check: { zh: 'A/B 换成场景中的两条链（如 interface A C）；输出接触残基对', en: 'Substitute actual chain IDs' } },
      { label: { zh: '接触距离明细', en: 'Contact details' }, cmd: 'contacts (chain A and polymer) | (chain B and polymer) 4.5', check: { zh: '分析面板生成可点击接触残基对表格', en: 'Clickable pairs in analysis panel' } },
      { label: { zh: '埋藏面积', en: 'Buried area' }, cmd: 'bsa', check: { zh: '界面埋藏总面积（ΔSASA）；后台计算需等回执', en: 'Buried ΔSASA; async — wait for receipt' } },
      { label: { zh: '界面视角', en: 'Interface view' }, cmd: 'view from (chain A and chain B)', check: { zh: '沿界面法向观察；或 turn 微调到两链并列', en: 'View along interface normal' } },
    ],
    report: {
      sections: [
        { key: 'chains', label: { zh: '界面链对', en: 'Interface chains' }, hint: { zh: '参与界面的链对（如 A-C）', en: 'Chain pair (e.g. A-C)' }, jump: 'view' },
        { key: 'residues', label: { zh: '接触残基', en: 'Contact residues' }, hint: { zh: '界面接触残基对数与关键热点残基（≤6）', en: 'Contact pairs & hot-spot residues (≤6)' }, jump: 'view' },
        { key: 'bsa', label: { zh: '埋藏面积', en: 'Buried area' }, hint: { zh: 'bsa 回执数值（Å²）；无回执写「后台计算中」', en: 'ΔSASA in Å²; "computing" if pending' } },
        { key: 'distance', label: { zh: '关键距离', en: 'Key distance' }, hint: { zh: '最近接触距离（contacts 输出的最小值）', en: 'Closest contact distance' }, jump: 'view' },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '下一步操作建议（≤40 字）', en: 'Next-step suggestion (≤40 chars)' } },
      ],
    },
  },
  {
    id: 'pub-figure',
    name: { zh: '出版级配图导出', en: 'Publication Figure Export' },
    description: {
      zh: '出版/投稿级互作图标准流程（规则 18 skill 化）：接触分析→出版预设→氢键→视角→白底描边→Ray 导出',
      en: 'Publication-grade figure workflow (rule 18 as a skill): contacts → publication preset → H-bonds → view → white bg + outline → ray export',
    },
    triggers: {
      strong: {
        zh: ['出版级', '投稿图', '论文图', '封面图', '出版图', '高清导出图'],
        en: ['publication figure', 'journal figure', 'cover figure', 'publication-quality'],
      },
      weak: {
        zh: ['高清图', '出图', '导出大图', '好看图'],
        en: ['high-res figure', 'figure export'],
      },
    },
    workflow: [
      { label: { zh: '互作接触分析', en: 'Contact analysis' }, cmd: 'contacts ligand | polymer 4.5', check: { zh: '有配体的结构执行；纯蛋白结构跳过本步', en: 'Skip for protein-only structures' } },
      { label: { zh: '出版级预设', en: 'Publication preset' }, cmd: 'preset publication', check: { zh: '一键出版级互作表示 + 自动聚焦口袋', en: 'One-shot publication preset + auto pocket focus' } },
      { label: { zh: '口袋氢键', en: 'Pocket H-bonds' }, cmd: 'hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water', check: { zh: '互作图专业细节；纯蛋白结构改为界面范围', en: 'Use interface scope for protein-only structures' } },
      { label: { zh: '标准视角', en: 'Standard view' }, cmd: 'view from ligand', check: { zh: '口袋正对相机；无配体时 orient 或 view front', en: 'orient / view front when no ligand' } },
      { label: { zh: '白底', en: 'White bg' }, cmd: 'bg white', check: { zh: '出版图标配', en: 'Standard for publication' } },
      { label: { zh: '克制描边', en: 'Subtle outline' }, cmd: 'outline on 0.5 1', check: { zh: '实测最优值：强度 0.5 粗细 1px；≥2 线稿化', en: 'Empirically optimal; ≥2 destroys it' } },
      { label: { zh: '清除高亮', en: 'Deselect' }, cmd: 'deselect', check: { zh: '画面 UI 双清洁', en: 'Clean canvas & UI' } },
      { label: { zh: 'Ray 静帧导出', en: 'Ray export' }, cmd: 'ray 2400', check: { zh: '必须是最后一条；用户指定宽度用指定值', en: 'Must be last; honor user-specified width' } },
    ],
    report: {
      sections: [
        { key: 'target', label: { zh: '图面目标', en: 'Figure target' }, hint: { zh: '结构 + 图面主题（互作图/全貌图）', en: 'Structure + figure theme' }, jump: 'view' },
        { key: 'preset', label: { zh: '表示与配色', en: 'Representation' }, hint: { zh: '所用预设与关键配色（链色/配体鲜绿/距离渐变）', en: 'Preset & key colors used' }, jump: 'preset' },
        { key: 'render', label: { zh: '渲染参数', en: 'Render settings' }, hint: { zh: '背景/描边/灯光实值（默认 1 不动）', en: 'Bg / outline / lighting values' }, jump: 'preset' },
        { key: 'export', label: { zh: '导出规格', en: 'Export spec' }, hint: { zh: 'Ray 宽度与格式；导出完成回执', en: 'Ray width & format' }, jump: 'ray' },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '后续调整建议（≤40 字）', en: 'Follow-up suggestion (≤40 chars)' } },
      ],
    },
  },
  {
    id: 'structure-survey',
    name: { zh: '结构组分普查', en: 'Structure Survey' },
    description: {
      zh: '一次性摸清结构家底：链组成、配体辅基、金属离子、水分子与原子总量标准流程',
      en: 'One-shot inventory: chains, ligands, cofactors, metal ions, waters, and atom totals',
    },
    triggers: {
      strong: {
        zh: ['组分普查', '结构普查', '有哪些链', '结构组成', '结构里有什么', '组分统计', '结构盘点'],
        en: ['structure survey', 'composition survey', 'chain inventory', 'structure inventory'],
      },
      weak: {
        zh: ['普查', '组成', '盘点', '统计一下'],
        en: ['survey', 'inventory', 'composition'],
      },
    },
    workflow: [
      { label: { zh: '链清单', en: 'Chain list' }, cmd: 'chains list', check: { zh: '全部链组及显隐状态', en: 'All chain groups & visibility' } },
      { label: { zh: '原子总量', en: 'Atom total' }, cmd: 'count_atoms', check: { zh: '全结构原子数', en: 'Total atoms' } },
      { label: { zh: '配体普查', en: 'Ligand inventory' }, cmd: 'iterate (ligand), resn', check: { zh: '配体/辅基残基名清单（含金属离子）', en: 'Ligand & cofactor list incl. metals' } },
      { label: { zh: '水分子计数', en: 'Water count' }, cmd: 'count_atoms water', check: { zh: '晶体水数量', en: 'Crystal waters' } },
    ],
    report: {
      sections: [
        { key: 'chains', label: { zh: '链组成', en: 'Chains' }, hint: { zh: '各链类型与残基数（蛋白/核酸/其他）', en: 'Chain types & residue counts' } },
        { key: 'ligands', label: { zh: '配体与辅基', en: 'Ligands & cofactors' }, hint: { zh: '配体名×拷贝数清单；辅基（HEM/RET/FAD 等）单独点名', en: 'Ligand × copies; call out cofactors' } },
        { key: 'metals', label: { zh: '金属离子', en: 'Metal ions' }, hint: { zh: '金属元素与数量（K⁺/NA⁺/ZN²⁺/MG²⁺ 等）；无则写「—」', en: 'Metal elements & counts; "—" if none' } },
        { key: 'totals', label: { zh: '水与总量', en: 'Waters & totals' }, hint: { zh: '水分子数 + 全结构原子数', en: 'Water count + total atoms' } },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '基于组分的分析切入点建议（≤40 字）', en: 'Suggested next analysis (≤40 chars)' } },
      ],
    },
  },
  {
    id: 'membrane-context',
    name: { zh: '膜蛋白语境配图', en: 'Membrane Context Figure' },
    description: {
      zh: '膜蛋白标准作图语境：主轴定向 + 脂双层板 +（通道结构）孔道剖面一站式标准流程',
      en: 'Membrane-protein figure context: principal-axis alignment + lipid bilayer slab + (for channels) pore profile',
    },
    triggers: {
      strong: {
        zh: ['膜蛋白作图', '脂双层', '磷脂双分子层', '跨膜语境', '膜语境', '加个膜', '画个膜'],
        en: ['membrane context', 'lipid bilayer', 'membrane figure', 'add membrane'],
      },
      weak: {
        zh: ['膜', '跨膜', '磷脂'],
        en: ['membrane', 'bilayer', 'transmembrane'],
      },
    },
    workflow: [
      { label: { zh: '主轴定向', en: 'Axis alignment' }, cmd: 'orient', check: { zh: 'PCA 主轴对齐视角（跨膜轴竖直是膜图标配）', en: 'PCA axis alignment (TM axis vertical is the convention)' } },
      { label: { zh: '脂双层板', en: 'Bilayer slab' }, cmd: 'membrane', check: { zh: '默认 34Å；典型生物膜 30-40Å；膜心自动对准跨膜腰窗', en: 'Default 34Å; slab auto-centered on TM waist' } },
      { label: { zh: '孔道剖面', en: 'Pore profile' }, cmd: 'pore', check: { zh: '仅通道/孔道类结构执行（收缩点半径红绿蓝环带）；非通道跳过', en: 'Channels/pores only; skip otherwise' } },
      { label: { zh: '全量适配', en: 'Fit view' }, cmd: 'zoom', check: { zh: '蛋白+膜整体入框', en: 'Fit protein + slab' } },
    ],
    report: {
      sections: [
        { key: 'axis', label: { zh: '主轴方位', en: 'Axis orientation' }, hint: { zh: 'orient 后主轴与相机的方位关系', en: 'Principal axis vs camera after orient' }, jump: 'view' },
        { key: 'membrane', label: { zh: '膜参数', en: 'Membrane params' }, hint: { zh: '膜厚实值（默认 34Å）与对象数（5 = 双头基板+核心）', en: 'Thickness value & object count' }, jump: 'zoom' },
        { key: 'pore', label: { zh: '孔道剖面', en: 'Pore profile' }, hint: { zh: '收缩点半径与位置；非通道结构写「—」', en: 'Constriction radius & position; "—" if not a channel' }, jump: 'zoom' },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '下一步操作建议（≤40 字）', en: 'Next-step suggestion (≤40 chars)' } },
      ],
    },
  },
  // ---------- r106 扩容四支（r105 建议清单第 2 项：sasa/bsa 表面、xcontacts 跨结构、
  // morph 构象、symmetry 晶格四类高频工作流技能化——全部命令已在 runner 白名单内） ----------
  {
    id: 'sasa-surface',
    name: { zh: '表面暴露分析', en: 'Surface Exposure Analysis' },
    description: {
      zh: '溶剂可及面积统计（总/疏水/极性）+ 暴露度渐变着色一站式标准流程',
      en: 'Solvent-accessible area stats (total/hydrophobic/polar) + exposure-gradient coloring in one standard workflow',
    },
    triggers: {
      strong: {
        zh: ['表面分析', '暴露分析', '溶剂可及', '可及面积', '表面积分析', '暴露度分析', '表面暴露', '暴露程度'],
        en: ['surface analysis', 'solvent accessible', 'sasa analysis', 'exposure analysis', 'surface area analysis'],
      },
      weak: {
        zh: ['表面', '暴露度', '暴露'],
        en: ['surface', 'exposure', 'accessible', 'sasa'],
      },
    },
    workflow: [
      { label: { zh: 'SASA 计算', en: 'SASA computation' }, cmd: 'sasa', check: { zh: 'Shrake–Rupley 法（probe 1.4Å 默认）；大结构 Web Worker 后台算完自动输出并更新着色', en: 'Shrake–Rupley (probe 1.4 Å default); large structures auto-print when the worker finishes' } },
      { label: { zh: '暴露度着色', en: 'Exposure coloring' }, cmd: 'color sasa', check: { zh: '埋藏蓝紫 → 暴露橙红渐变；分析面板含 Top 暴露残基', en: 'Buried blue-violet → exposed orange-red; panel lists top-exposed residues' } },
      { label: { zh: '全景适配', en: 'Fit view' }, cmd: 'zoom', check: { zh: '整体结构入框', en: 'Frame the whole structure' } },
    ],
    report: {
      sections: [
        { key: 'total', label: { zh: '总面积', en: 'Total area' }, hint: { zh: 'SASA 总面积（Å²，命令回执）', en: 'Total SASA (Å², from receipt)' }, jump: 'zoom' },
        { key: 'ratio', label: { zh: '疏水与极性', en: 'Hydrophobic & polar' }, hint: { zh: '疏水/极性/水与配体分项面积（Å²）', en: 'Hydrophobic / polar / het areas (Å²)' }, jump: 'color sasa' },
        { key: 'top', label: { zh: '高暴露残基', en: 'Top exposed' }, hint: { zh: 'Top 暴露残基（分析面板，≤4 个）', en: 'Top-exposed residues (panel, ≤4)' }, jump: 'zoom' },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '下一步操作建议（≤40 字）', en: 'Next-step suggestion (≤40 chars)' } },
      ],
    },
  },
  {
    id: 'xcontact-analysis',
    name: { zh: '跨结构互作分析', en: 'Cross-structure Interaction Analysis' },
    description: {
      zh: '两个已加载结构间的接触对、跨结构埋藏面积与关键距离标准流程（叠合后以当前位姿为准）',
      en: 'Contacts, cross-structure buried area, and key distances between two loaded structures in one standard workflow',
    },
    triggers: {
      strong: {
        zh: ['跨结构互作', '跨结构接触', '结构间互作', '两结构界面', '复合物界面分析', '跨结构分析'],
        en: ['cross-structure interaction', 'cross-structure contacts', 'inter-structure interaction'],
      },
      weak: {
        zh: ['跨结构', '结构间'],
        en: ['xcontacts', 'between structures'],
      },
    },
    workflow: [
      { label: { zh: '位姿叠合', en: 'Pose alignment' }, cmd: 'superpose 1UBQ onto 1D3Z', check: { zh: 'A/B 换成场景中两个已加载结构；跨结构接触以当前位姿实时为准', en: 'Substitute the two loaded structures; cross-contacts track current poses live' } },
      { label: { zh: '跨结构接触', en: 'Cross contacts' }, cmd: 'xcontacts 1UBQ:chain A | 1D3Z:chain A 5.0', check: { zh: '结构名与链按场景替换；cutoff 2.5-10Å（默认 5.0）', en: 'Substitute names & chains; cutoff 2.5-10 Å (default 5.0)' } },
      { label: { zh: '跨结构埋藏面积', en: 'Cross buried area' }, cmd: 'xbsa', check: { zh: '界面 ΔSASA（后台计算，等回执）', en: 'Interface ΔSASA (background, wait for receipt)' } },
      { label: { zh: '界面视角', en: 'Interface view' }, cmd: 'zoom', check: { zh: '两结构整体入框', en: 'Frame both structures' } },
    ],
    report: {
      sections: [
        { key: 'pair', label: { zh: '结构对', en: 'Structure pair' }, hint: { zh: '参与跨结构界面的两个结构名', en: 'The two structures at the interface' }, jump: 'zoom' },
        { key: 'contacts', label: { zh: '接触对', en: 'Contact pairs' }, hint: { zh: 'xcontacts 输出的接触对总数（命令回执）', en: 'Total cross-contact pairs (receipt)' }, jump: 'zoom' },
        { key: 'xbsa', label: { zh: '埋藏面积', en: 'Buried area' }, hint: { zh: 'xbsa 回执数值（Å²）；无回执写「后台计算中」', en: 'ΔSASA in Å²; "computing" if pending' } },
        { key: 'distance', label: { zh: '最近距离', en: 'Closest distance' }, hint: { zh: '最近跨结构接触距离（Å）', en: 'Closest cross-structure contact (Å)' }, jump: 'zoom' },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '下一步操作建议（≤40 字）', en: 'Next-step suggestion (≤40 chars)' } },
      ],
    },
  },
  {
    id: 'morph-conformations',
    name: { zh: '构象插值对比', en: 'Conformational Morph' },
    description: {
      zh: '两个/多个构象间的插值轨迹创建与播放标准流程（rigimol 风格帧精修）',
      en: 'Create and play interpolation trajectories between conformers in one standard workflow (rigimol-style refinement)',
    },
    triggers: {
      strong: {
        zh: ['构象插值', '构象对比动画', '插值动画', '构象变化动画', '构象过渡', 'morph 动画'],
        en: ['conformational morph', 'morph animation', 'interpolate conformations', 'conformational transition'],
      },
      weak: {
        zh: ['构象', '插值'],
        en: ['morph', 'conformation', 'interpolation'],
      },
    },
    workflow: [
      { label: { zh: '创建插值轨迹', en: 'Create morph' }, cmd: 'morph m1 = 1BQL 2LYZ 40', check: { zh: 'A/B 换成场景中已加载的两个构象；帧数 10-200（默认 48）；多构象用 morph multi', en: 'Substitute two loaded conformers; frames 10-200 (default 48); morph multi for >2 states' } },
      { label: { zh: '轨迹对象适配', en: 'Frame morph' }, cmd: 'zoom', check: { zh: 'morph 对象整体入框', en: 'Frame the morph object' } },
      { label: { zh: '播放构象动画', en: 'Play ensemble' }, cmd: 'ensemble play', check: { zh: 'P 键暂停；ensemble fps <0.5-60> 调速', en: 'P pauses; ensemble fps <0.5-60> adjusts speed' } },
    ],
    report: {
      sections: [
        { key: 'conformers', label: { zh: '构象对', en: 'Conformer pair' }, hint: { zh: '参与插值的构象名（A → B）', en: 'Conformers interpolated (A → B)' }, jump: 'ensemble play' },
        { key: 'rmsd', label: { zh: '叠合 RMSD', en: 'RMSD' }, hint: { zh: '构象间 CA RMSD（Å，命令回执）', en: 'Inter-conformer CA RMSD (Å, receipt)' }, jump: 'zoom' },
        { key: 'frames', label: { zh: '帧数', en: 'Frames' }, hint: { zh: '轨迹帧数（默认 48/模板 40）', en: 'Trajectory frame count' }, jump: 'ensemble play' },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '下一步操作建议（≤40 字）', en: 'Next-step suggestion (≤40 chars)' } },
      ],
    },
  },
  {
    id: 'symmetry-assembly',
    name: { zh: '晶格组装展示', en: 'Symmetry Assembly' },
    description: {
      zh: '晶体学对称伴侣组装展示标准流程：主轴定向 → 对称伴侣 → 组装全景',
      en: 'Crystallographic symmetry-mate assembly in one standard workflow: axis alignment → mates → full view',
    },
    triggers: {
      strong: {
        zh: ['晶格组装', '对称伴侣', '晶体堆积', '对称性组装', '晶格展示', '对称组装'],
        en: ['symmetry assembly', 'symmetry mates', 'crystal packing', 'lattice assembly', 'symmetry operation'],
      },
      weak: {
        zh: ['晶格', '晶体对称', '堆积'],
        en: ['symmetry', 'lattice', 'packing'],
      },
    },
    workflow: [
      { label: { zh: '主轴定向', en: 'Axis alignment' }, cmd: 'orient', check: { zh: 'PCA 主轴对齐（晶格观感标配）', en: 'PCA axis alignment (standard for lattice views)' } },
      { label: { zh: '生成对称伴侣', en: 'Symmetry mates' }, cmd: 'symmetry 20', check: { zh: '半径 5-80Å（默认 20）；结构名可前缀指定（如 symmetry 4HHB 30）；symmetry off 关闭', en: 'Radius 5-80 Å (default 20); structure prefix optional; symmetry off disables' } },
      { label: { zh: '组装全景', en: 'Assembly view' }, cmd: 'zoom', check: { zh: '原体+伴侣整体入框；伴侣为视觉副本不参与拾取', en: 'Frame assembly; mates are visual copies, not pickable' } },
    ],
    report: {
      sections: [
        { key: 'radius', label: { zh: '组装半径', en: 'Assembly radius' }, hint: { zh: '对称伴侣生成半径（Å，默认 20）', en: 'Mate generation radius (Å, default 20)' }, jump: 'zoom' },
        { key: 'mates', label: { zh: '伴侣数', en: 'Mate count' }, hint: { zh: '生成的对称伴侣数（命令回执）', en: 'Number of mates generated (receipt)' }, jump: 'zoom' },
        { key: 'view', label: { zh: '组装观感', en: 'Assembly view' }, hint: { zh: '原体与伴侣的视角关系描述', en: 'Orientation of protomer vs mates' }, jump: 'zoom' },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '下一步操作建议（≤40 字）', en: 'Next-step suggestion (≤40 chars)' } },
      ],
    },
  },
  // ---------- r122-a：表面疏水分析（r121 建议①收口——疏水工作流技能化） ----------
  // 疏水性着色（r121-c color kd）与 SASA 暴露（r106 sasa-surface）各自成技能，但
  // 「表面化学」高频组合需求（配体可药性/二聚界面疏水斑块/膜结合面评估）是两者串联：
  // 先算暴露（面积分项），再上 KD 梯度（斑块定位）——skill 化后报告同时携带
  // 面积分项 + 残基构成两类实测数值。全部命令均在 runner 白名单内（sasa/color/zoom）。
  {
    id: 'surface-hydrophobicity',
    name: { zh: '表面疏水分析', en: 'Surface Hydrophobicity Analysis' },
    description: {
      zh: 'SASA 暴露统计 + Kyte-Doolittle 疏水梯度着色组合流程：表面疏水斑块定位与面积分项一站式分析',
      en: 'SASA exposure stats + Kyte-Doolittle hydropathy gradient coloring in one combined workflow: locate surface hydrophobic patches with area breakdown',
    },
    triggers: {
      strong: {
        zh: ['表面疏水', '疏水表面', '疏水性分析', '疏水分析', '疏水分布', '疏水斑块', '疏水位点'],
        en: ['hydrophobic surface analysis', 'surface hydrophobicity', 'hydrophobicity analysis', 'hydropathy analysis', 'hydrophobic patch', 'hydrophobic surface'],
      },
      weak: {
        zh: ['疏水', '亲水'],
        en: ['hydrophobic', 'hydrophilic'],
      },
    },
    workflow: [
      { label: { zh: 'SASA 计算', en: 'SASA computation' }, cmd: 'sasa', check: { zh: 'Shrake–Rupley 法（probe 1.4Å 默认）；总面积与疏水/极性分项在回执——大结构 Worker 后台算完自动输出', en: 'Shrake–Rupley (probe 1.4 Å default); total & hydrophobic/polar breakdown in the receipt — large structures auto-print when the worker finishes' } },
      { label: { zh: '疏水梯度着色', en: 'Hydropathy coloring' }, cmd: 'color kd', check: { zh: '亲水青 −4.5 → 疏水琥珀 +4.5 残基级碳渐变（杂原子保元素色）；回执附残基构成三类计数——疏水斑块在表面语境一眼可辨', en: 'Residue-level carbon gradient teal −4.5 → amber +4.5 (heteroatoms keep element colors); receipt includes residue composition' } },
      { label: { zh: '全景适配', en: 'Fit view' }, cmd: 'zoom', check: { zh: '整体结构入框——斑块分布要全景观察，不要 zoom sele', en: 'Frame the whole structure — patch distribution needs the full view' } },
    ],
    report: {
      sections: [
        { key: 'total', label: { zh: '总面积', en: 'Total area' }, hint: { zh: 'SASA 总面积（Å²，命令回执）', en: 'Total SASA (Å², from receipt)' }, jump: 'zoom' },
        { key: 'ratio', label: { zh: '疏水与极性', en: 'Hydrophobic & polar' }, hint: { zh: '疏水/极性分项面积（Å²，sasa 回执）', en: 'Hydrophobic / polar areas (Å², sasa receipt)' }, jump: 'color sasa' },
        { key: 'residues', label: { zh: '残基构成', en: 'Residue composition' }, hint: { zh: 'color kd 回执三类计数：疏水 KD>0 / 亲水 KD<0 / 表外', en: 'color kd receipt counts: hydrophobic KD>0 / hydrophilic KD<0 / off-scale' }, jump: 'color kd' },
        { key: 'advice', label: { zh: '建议', en: 'Advice' }, hint: { zh: '下一步操作建议（≤40 字）', en: 'Next-step suggestion (≤40 chars)' } },
      ],
    },
  },
]

/** 全部技能 id 集（请求体 skillId 合法性校验用） */
export const SKILL_IDS = new Set(AGENT_SKILLS.map(s => s.id))

/**
 * 从用户文本匹配标准技能（前端发送前调用）。
 * 计分：strong 触发词 ×2 / weak ×1；score ≥2 且唯一最高分才选中
 * （单个 weak 词如「配体」「膜」不足以选中——避免纯着色/纯显示类需求被误拉进分析流程）。
 * r106 两项升级（技能库 6→10 后暴露的并列歧义）：
 * ①技能内重叠去重——weak 词是其同技能已命中 strong 短语的子串时不计分
 *   （「互作分析」强命中后「互作」弱词不再重复加分——同词族双计会虚抬分数）；
 * ②跨技能特异性决胜——总分并列时以命中触发词总字长 spec 高者为先
 *   （「跨结构互作分析」在 ligand-pocket（互作分析 4 字）与 xcontact-analysis
 *   （跨结构互作 5 字）间 2:2 并列，更长触发词=更具体意图=更正确归属；
 *   score 与 spec 双并列才视为真歧义降级普通对话）。
 */
export function matchSkill(text: string): AgentSkill | null {
  const q = text.toLowerCase()
  let best: AgentSkill | null = null
  let bestScore = 0
  let bestSpec = 0
  let tie = false
  for (const skill of AGENT_SKILLS) {
    let score = 0
    let spec = 0
    const strongHits: string[] = []
    for (const t of skill.triggers.strong.zh) if (q.includes(t.toLowerCase())) { score += 2; spec += t.length; strongHits.push(t.toLowerCase()) }
    for (const t of skill.triggers.strong.en) if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)) { score += 2; spec += t.length; strongHits.push(t.toLowerCase()) }
    // 技能内重叠去重：weak 词是已命中 strong 短语的子串 → 信息已被强词吸收，不计分
    for (const t of skill.triggers.weak.zh) if (q.includes(t.toLowerCase()) && !strongHits.some(s => s.includes(t.toLowerCase()))) { score += 1; spec += t.length }
    for (const t of skill.triggers.weak.en) if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q) && !strongHits.some(s => s.includes(t.toLowerCase()))) { score += 1; spec += t.length }
    if (score > bestScore || (score === bestScore && spec > bestSpec)) { bestScore = score; bestSpec = spec; best = skill; tie = false }
    else if (score === bestScore && spec === bestSpec && score > 0 && best) tie = true
  }
  if (bestScore >= 2 && !tie) return best
  return null
}

/**
 * 报告文稿标记检测（AgentPanel 渲染报告卡片用）：
 * reply 以「【…报告】」标题行开头即视为标准技能报告文稿。
 */
export function isSkillReport(content: string): boolean {
  return /^【[^】]{2,20}报告】/.test(content.trim())
}

/**
 * 把技能编译成注入 LLM 的指令段（route.ts 追加在 SYSTEM_PROMPT 之后）。
 * 三部分：命中声明 + 标准流程（步骤顺序不可省略）+ 固定报告格式（数值不许编造）。
 * r107-a：报告格式段后附 few-shot 输出示例——单行 JSON（\n 为字面转义，不产生真实换行），
 * 演示报告如何嵌进 reply 字段（r106 实测 GLM-4.6 懂格式但不懂「报告住在 JSON 字符串里」）。
 */
export function buildSkillDirective(skill: AgentSkill): string {
  const steps = skill.workflow
    .map((s, i) => `   ${i + 1}. ${s.label.zh}：${s.cmd}${s.check ? ` —— ${s.check.zh}` : ''}`)
    .join('\n')
  const sections = skill.report.sections
    .map(sec => `▌${sec.label.zh}：${sec.hint.zh}`)
    .join('\n')
  // few-shot：单行 JSON（\\n 字面转义——行首锚定解析不受影响），章节取前两节演示嵌套方式
  const sampleSections = skill.report.sections.slice(0, 2).map(sec => `▌${sec.label.zh}：…`).join('\\n')
  const sampleFirstCmd = (skill.workflow[0]?.cmd ?? '').replace(/"/g, '\\"')
  const sample = `{"reply":"【${skill.name.zh}报告】\\n${sampleSections}\\n…","commands":["${sampleFirstCmd}","…"]}`
  return `## 本次任务命中标准技能：${skill.name.zh}（${skill.id}）
用户需求与该技能适用场景匹配。你必须按以下标准执行，不得自由发挥：

### 标准流程（按序执行；选择表达式与数值参数按当前场景填充，步骤顺序与关键命令不可省略或自造替代；不适用的步骤可跳过但须在报告中注明）
${steps}

### 报告文稿固定格式（reply 必须且只能是以下格式的报告——每节一行、以 ▌ 开头；数值取自命令回执与场景信息，取不到的写「—」，绝不编造；总长不超过 200 字）
【${skill.name.zh}报告】
${sections}

### 输出示例（仅演示 JSON 结构与报告在 reply 字段内的嵌套方式——\\n 为转义换行；数值必须按实际场景与回执替换，章节按完整清单给全）
${sample}

报告完成后不要再附加其他寒暄文字；commands 按标准流程完整给出（含 ray 等导出类收尾命令）。`
}

// ---------- r107-b：技能报告两段式执行（回执数值回填） ----------
// 根因（r106 E2E 实测坐实）：单轮架构里报告生成在命令执行之前——回执类数值（接触对数/
// ΔSASA/RMSD/总面积等）只能合规写「—」。两段式：第一段照常流式出报告（「—」占位，用户
// 立刻看到结构）；第二段在命令执行完毕后把「报告草稿 + 命令回执 + 运行时补充」二次送 LLM
// 回填实测数值——报告从「格式合规」升级到「数值真实」。

/** 回填消息固定开头标记（前端组包 + mock 检测共用——单站点定义防两端漂移） */
export const REPORT_FILL_MARKER = '【报告回执回填】'

/** 单条命令回执（AgentPanel 从 runTurn 的执行记录提取） */
export interface SkillReceipt {
  cmd: string
  output?: string
}

/**
 * 组装两段式回填的用户消息（自包含：草稿 + 回执 + 运行时补充；无需对话历史）。
 * 走普通对话路径（不带 skillId——不重注技能流程与命令回放，避免 mock/LLM 把回填当成
 * 新一轮技能执行）。runtime 为前端可取的实时事实（如氢键网络当前条数）——回执文本
 * 之外的补充数值源。
 */
export function buildReportFillPrompt(skill: AgentSkill, draft: string, receipts: SkillReceipt[], runtime?: string): string {
  const receiptLines = receipts
    .filter(r => r.output)
    .slice(-10)
    .map(r => `- ${r.cmd} → ${(r.output ?? '').replace(/\s+/g, ' ').slice(0, 260)}`)
    .join('\n')
  const runtimeLine = runtime?.trim() ? `\n\n运行时补充：${runtime.trim().slice(0, 160)}` : ''
  return `${REPORT_FILL_MARKER}（系统任务，非用户发言）
标准技能「${skill.name.zh}」的报告草稿与命令执行回执如下。请把草稿回填为实测数值版报告：
- reply 字段的值必须（且只能）是回填后的完整报告文本本身：首行【${skill.name.zh}报告】、每节一行 ▌ 开头、节名与顺序与草稿逐字一致——不要输出任何确认语、说明或总结（如「已完成回填」即错）
- 回执中有的数值以回执为准（覆盖草稿占位值——回执可为英文，报告保持中文）；回执中确实没有的保留草稿原值（「—」保持「—」，绝不编造）
- 数值提取示例：草稿「▌口袋残基：—」+ 回执「91 residue-pair contacts … nearest … 2.06 Å」→ 该节填「91 对（最近 … 2.06 Å）」
- commands 恒为空数组 []

报告草稿：
${draft}

命令回执（cmd → output）：
${receiptLines}${runtimeLine}`
}

// ---------- r109-b：报告节点击跳转（报告 → 可交互分析入口） ----------
// 动机：两段式回填后报告已是「数值真实」的只读文稿；数值节（口袋残基/氢键/界面链对…）
// 天然对应一个视角/聚焦动作——点节即跳转，报告从阅读产物升级为分析入口。

/** 回放类 jump 特殊值 → 该消息已成功命令的匹配前缀（回放源）；无兜底的命中失败返回 null */
const JUMP_REPLAY: Record<string, { re: RegExp; fallback: string | null }> = {
  view: { re: /^(view\s+from|orient)\b/i, fallback: 'orient' },
  zoom: { re: /^zoom\b/i, fallback: 'zoom' },
  ray: { re: /^ray\b/i, fallback: null },
  preset: { re: /^preset\b/i, fallback: null },
}

/**
 * 报告节点击跳转命令解析（纯函数）。sectionLabel 为报告行「▌标签：」里 localized 标签
 * （zh/en 均可匹配；容错接受带 ▌ 前缀的形态——浏览器 G1 实测：调用侧截取「：」前整段
 * 天然含行首 ▌，剥离在此单点完成）；okCmds 为该消息已成功执行的命令（回放源——场景
 * 实参已在其中，如 view from (chain A and chain B) 已被 LLM 按场景链替换过）。
 * 返回 null = 该节不可跳（无 jump 定义，或 ray/preset 回放源缺失）。
 */
export function reportSectionJumpCmd(skillId: string | undefined, sectionLabel: string, okCmds: string[]): string | null {
  if (!skillId) return null
  const label = sectionLabel.replace(/^▌/, '')
  const skill = AGENT_SKILLS.find(s => s.id === skillId)
  const sec = skill?.report.sections.find(s => label === s.label.zh || label === s.label.en)
  const j = sec?.jump
  if (!j) return null
  const replay = JUMP_REPLAY[j]
  if (!replay) return j
  const hit = [...okCmds].reverse().find(c => replay.re.test(c.trim()))
  return hit?.trim() ?? replay.fallback
}

// ---------- r111-b：报告节 hover 预览选择子（跳转命令 → 可预览表达式） ----------
// 动机：跳转命令天然携带「关注域」——view from (chain A and chain B) 的括号内表达式、
// zoom within 6 of (ligand) 的目标子。hover 报告节时先以该表达式无副作用求值原子集
// （store.previewExpr）→ engine.previewHighlight 青色薄纱罩亮（点击跳转前的「先看一眼」
// 预览——与点击后的真实视角跳转形成两段式交互）。zoom/orient/ray/preset 等结构级
// 命令无局部选择子，返回 null 不预览。

/** 首组括号是否包裹整个字符串（防 (A) or (B) 形态误剥——首组在尾前闭合即非整体包裹）。 */
function isWrappedExpr(t: string): boolean {
  if (!t.startsWith('(') || !t.endsWith(')')) return false
  let depth = 0
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '(') depth++
    else if (t[i] === ')') {
      depth--
      if (depth === 0 && i < t.length - 1) return false
    }
  }
  return depth === 0
}

/** 从跳转命令提取可预览的选择子表达式（纯函数）：
 *  - view from <arg> → arg（(chain A and chain B) 剥外层包裹括号；ligand 裸词原样）
 *  - zoom within <N> of <arg> → arg（同上）
 *  - 其余（zoom / orient / ray / preset / color / ensemble 等结构级或静态兜底命令）→ null */
export function previewExprFromJumpCmd(cmd: string): string | null {
  const c = cmd.trim()
  let m = /^view\s+from\s+(.+)$/i.exec(c)
  if (m) return isWrappedExpr(m[1].trim()) ? m[1].trim().slice(1, -1).trim() : m[1].trim()
  m = /^zoom\s+within\s+\S+\s+of\s+(.+)$/i.exec(c)
  if (m) return isWrappedExpr(m[1].trim()) ? m[1].trim().slice(1, -1).trim() : m[1].trim()
  return null
}
