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
 * 预置技能库（6 支）——全部命令均在 runner.ts 白名单内（membrane/pore 已随 r105 补入）。
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
        { key: 'residues', label: { zh: '口袋残基', en: 'Pocket residues' }, hint: { zh: '4.5Å 内接触残基数与关键残基列举（≤6 个）', en: 'Contact residues within 4.5Å (list ≤6)' } },
        { key: 'hbonds', label: { zh: '氢键', en: 'H-bonds' }, hint: { zh: '口袋范围氢键条数；点名配体-残基关键氢键（如有）', en: 'H-bond count in pocket; notable ligand-residue bonds' } },
        { key: 'contacts', label: { zh: '接触对', en: 'Contact pairs' }, hint: { zh: 'contacts 命令输出的接触对总数与最近距离', en: 'Total contact pairs & closest distance' } },
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
        { key: 'count', label: { zh: '氢键条数', en: 'H-bond count' }, hint: { zh: '状态栏/徽章显示的当前氢键总数', en: 'Total H-bonds from status badge' } },
        { key: 'main', label: { zh: '主要相互作用', en: 'Key interactions' }, hint: { zh: '关键氢键对列举（残基-残基 / 配体-残基，≤4 对）', en: 'Notable H-bond pairs (≤4)' } },
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
        zh: ['界面', '接触面', '链间互作'],
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
        { key: 'chains', label: { zh: '界面链对', en: 'Interface chains' }, hint: { zh: '参与界面的链对（如 A-C）', en: 'Chain pair (e.g. A-C)' } },
        { key: 'residues', label: { zh: '接触残基', en: 'Contact residues' }, hint: { zh: '界面接触残基对数与关键热点残基（≤6）', en: 'Contact pairs & hot-spot residues (≤6)' } },
        { key: 'bsa', label: { zh: '埋藏面积', en: 'Buried area' }, hint: { zh: 'bsa 回执数值（Å²）；无回执写「后台计算中」', en: 'ΔSASA in Å²; "computing" if pending' } },
        { key: 'distance', label: { zh: '关键距离', en: 'Key distance' }, hint: { zh: '最近接触距离（contacts 输出的最小值）', en: 'Closest contact distance' } },
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
        { key: 'target', label: { zh: '图面目标', en: 'Figure target' }, hint: { zh: '结构 + 图面主题（互作图/全貌图）', en: 'Structure + figure theme' } },
        { key: 'preset', label: { zh: '表示与配色', en: 'Representation' }, hint: { zh: '所用预设与关键配色（链色/配体鲜绿/距离渐变）', en: 'Preset & key colors used' } },
        { key: 'render', label: { zh: '渲染参数', en: 'Render settings' }, hint: { zh: '背景/描边/灯光实值（默认 1 不动）', en: 'Bg / outline / lighting values' } },
        { key: 'export', label: { zh: '导出规格', en: 'Export spec' }, hint: { zh: 'Ray 宽度与格式；导出完成回执', en: 'Ray width & format' } },
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
        { key: 'axis', label: { zh: '主轴方位', en: 'Axis orientation' }, hint: { zh: 'orient 后主轴与相机的方位关系', en: 'Principal axis vs camera after orient' } },
        { key: 'membrane', label: { zh: '膜参数', en: 'Membrane params' }, hint: { zh: '膜厚实值（默认 34Å）与对象数（5 = 双头基板+核心）', en: 'Thickness value & object count' } },
        { key: 'pore', label: { zh: '孔道剖面', en: 'Pore profile' }, hint: { zh: '收缩点半径与位置；非通道结构写「—」', en: 'Constriction radius & position; "—" if not a channel' } },
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
 * （单个 weak 词如「配体」「膜」不足以选中——避免纯着色/纯显示类需求被误拉进分析流程；
 * 并列最高视为歧义，降级为普通对话）。
 */
export function matchSkill(text: string): AgentSkill | null {
  const q = text.toLowerCase()
  let best: AgentSkill | null = null
  let bestScore = 0
  let tie = false
  for (const skill of AGENT_SKILLS) {
    let score = 0
    for (const t of skill.triggers.strong.zh) if (q.includes(t.toLowerCase())) score += 2
    for (const t of skill.triggers.strong.en) if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)) score += 2
    for (const t of skill.triggers.weak.zh) if (q.includes(t.toLowerCase())) score += 1
    for (const t of skill.triggers.weak.en) if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)) score += 1
    if (score > bestScore) { bestScore = score; best = skill; tie = false }
    else if (score === bestScore && score > 0 && best) tie = true
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
 */
export function buildSkillDirective(skill: AgentSkill): string {
  const steps = skill.workflow
    .map((s, i) => `   ${i + 1}. ${s.label.zh}：${s.cmd}${s.check ? ` —— ${s.check.zh}` : ''}`)
    .join('\n')
  const sections = skill.report.sections
    .map(sec => `▌${sec.label.zh}：${sec.hint.zh}`)
    .join('\n')
  return `## 本次任务命中标准技能：${skill.name.zh}（${skill.id}）
用户需求与该技能适用场景匹配。你必须按以下标准执行，不得自由发挥：

### 标准流程（按序执行；选择表达式与数值参数按当前场景填充，步骤顺序与关键命令不可省略或自造替代；不适用的步骤可跳过但须在报告中注明）
${steps}

### 报告文稿固定格式（reply 必须且只能是以下格式的报告——每节一行、以 ▌ 开头；数值取自命令回执与场景信息，取不到的写「—」，绝不编造；总长不超过 200 字）
【${skill.name.zh}报告】
${sections}

报告完成后不要再附加其他寒暄文字；commands 按标准流程完整给出（含 ray 等导出类收尾命令）。`
}
