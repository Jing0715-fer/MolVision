// QA 用 OpenAI 兼容 mock：GET /v1/models + POST /v1/chat/completions
// 两种形态：非流式（整段 JSON）与 stream:true（OpenAI SSE 分片流）
// 鉴权：携带错误 Authorization 返回 401；省略头放行（裸 curl 冒烟用——应用侧总会带 Bearer test-key-12345）
// 流式内容为「可配置协议 JSON」：按最后一条 user 消息关键词选模板生成 AgentDecision——
// r65-b 模板引擎扩展到全命令面（commands 动词/语法逐一对照 src/lib/molecular/commands.ts 注册表）：
//   彩虹渐变(spectrum) / 距离测量(measure dist) / 氢键(hbonds) / 结构叠合(superpose) / 背景色(bg) /
//   二级结构着色(util cbss) / SASA-静电着色(color sasa) / 链染色(color) / 表示法显隐(show|hide
//   cartoon/sticks/spheres/lines) / orient+zoom / 谓词选择(name|resn|resi|chain) / 默认(select+zoom)
// 回复语言自适应：最后一条 user 消息含 CJK 字符 → 中文 reply，否则英文 reply。
// 模板匹配顺序「具体优先于宽泛」：彩虹先于色词（彩虹色不能被颜色类吞掉）、bg 先于染色（背景色
// 含「色」）、sasa/ss 先于颜色、hide 先于 show（「不显示」不可被显示模板吞掉）。
// r66-b VLM 支持：user content 为多模态数组（含 image_url 段，AgentPanel 截图自查请求）时按
// 视觉自查模板处理——默认「通过」；归一化文本含「失败演练 / fail drill」→ 演练未达标路径
// （下发修正命令）。数组 content 先归一化为纯文本再走模板（直toLowerCase 会 TypeError 500）。
// r79 模板解析分支：多模态文本含标记「论文图模板解析」（/api/templates/parse 固定注入）→
// 返回 TemplateDraft 协议 JSON（含 2 条白名单外命令——save/make——供路由剔除明细透传 UI 的联调实证）。
const models = {
  object: 'list',
  data: [
    { id: 'mock-vision-pro', owned_by: 'mock-labs' },
    { id: 'mock-ultra-128k', owned_by: 'mock-labs', context_length: 131072 },
    { id: 'mock-pro', owned_by: 'mock-labs', context_length: 64000 },
    { id: 'mock-mini', owned_by: 'mock-labs', context_length: 32000 },
    { id: 'text-embedding-mock-3', owned_by: 'mock-labs' },
    { id: 'dall-e-mock-x', owned_by: 'mock-labs' },
    { id: 'whisper-mock', owned_by: 'mock-labs' },
  ],
}

/** OpenAI 多模态内容片（VLM 视觉自查请求）：text 段参与模板匹配，image_url 段仅作视觉分支判定标志 */
interface MockContentPart { type?: string; text?: string; image_url?: unknown }

interface MockMessage { role?: string; content?: string | MockContentPart[] }

// ---------- 语言与参数提取助手 ----------

/** content 归一化：字符串原样；数组 → 拼接全部 type:'text' 段（图片段忽略）——
 *  多模态请求的关键词模板匹配与 CJK 判定都基于归一化文本 */
function normalizeContent(content: string | MockContentPart[] | undefined): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((p): p is { type: 'text'; text: string } => !!p && typeof p === 'object' && p.type === 'text' && typeof p.text === 'string')
    .map(p => p.text)
    .join('\n')
}

/** 视觉自查请求判定：content 为数组且含 image_url 段（AgentPanel 截图自查的特征） */
function hasImagePart(content: string | MockContentPart[] | undefined): boolean {
  return Array.isArray(content) && content.some(p => !!p && typeof p === 'object' && p.type === 'image_url')
}

/** CJK 判定（含扩展 A 区）：最后一条 user 消息命中 → 中文 reply，否则英文 reply */
const CJK_RE = /[\u3400-\u4dbf\u4e00-\u9fff]/

/** 链 ID 严格提取：「A 链」「A链」「链 A」「chain A」皆可；未命中返回 null（谓词/测量模板用）。
 *  负向先行断言防吞词首字母（chain green 不可把 g 当链号） */
const CHAIN_RE = /(?:链\s*([A-Za-z0-9])(?![A-Za-z0-9])|([A-Za-z0-9])(?![A-Za-z0-9])\s*链|chain\s+([A-Za-z0-9])(?![A-Za-z0-9]))/i
function chainStrict(text: string): string | null {
  const m = CHAIN_RE.exec(text)
  const c = m?.[1] ?? m?.[2] ?? m?.[3]
  return c ? c.toUpperCase() : null
}

/** 链 ID 宽容提取：未命中缺省 A（颜色/显示/隐藏等链作用域模板保持 r64-b 行为） */
function extractChain(text: string): string {
  return chainStrict(text) ?? 'A'
}

/** 依序提取至多 n 个不同链 ID（距离测量双端用；0 个 → 缺省 [A,B]，1 个 → 补一个不同的） */
function extractChains(text: string, n: number): string[] {
  const out: string[] = []
  const re = /(?:链\s*([A-Za-z0-9])(?![A-Za-z0-9])|([A-Za-z0-9])(?![A-Za-z0-9])\s*链|chain\s+([A-Za-z0-9])(?![A-Za-z0-9]))/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const c = (m[1] ?? m[2] ?? m[3] ?? '').toUpperCase()
    if (c && !out.includes(c)) out.push(c)
    if (out.length >= n) break
  }
  if (!out.length) return ['A', 'B']
  if (out.length === 1) return [out[0], out[0] === 'A' ? 'B' : 'A']
  return out.slice(0, n)
}

/** PDB ID 提取（4 位、首字符数字、大小写不敏感）：superpose 模板用 */
function extractPdbIds(text: string): string[] {
  const out: string[] = []
  const re = /\b(\d[a-z0-9]{3})\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const id = m[1].toUpperCase()
    if (!out.includes(id)) out.push(id)
  }
  return out
}

/** 颜色词 → 英文命令色名（bg / color 模板共用；命令侧 parseCssColor/NAMED_COLORS 全部收录）。
 *  中文裸字直配（红蓝绿黄黑灰橙紫青）；「白」用白色/变白/白底（裸「白」会误吞「明白」）；
 *  英文带 \b（防 colored 里的 red 子串）。 */
const COLOR_WORDS: [RegExp, string, string][] = [
  [/红|\bred\b/, 'red', '红色'],
  [/蓝|\bblue\b/, 'blue', '蓝色'],
  [/绿|\bgreen\b/, 'green', '绿色'],
  [/黄|\byellow\b/, 'yellow', '黄色'],
  [/橙|\borange\b/, 'orange', '橙色'],
  [/紫|\bpurple\b|\bviolet\b/, 'purple', '紫色'],
  [/青|\bcyan\b|\bteal\b/, 'cyan', '青色'],
  [/黑|\bblack\b/, 'black', '黑色'],
  [/白色|变白|白底|\bwhite\b/, 'white', '白色'],
  [/灰|\bgr[ae]y\b/, 'grey', '灰色'],
]

/** 表示法关键词 → 真实 rep 名（commands.ts REP_ALIASES 子集）。
 *  中文映射（任务书）：带状→cartoon、球棍→sticks、球体→spheres、线→lines。 */
function detectRep(t: string): { en: string; zh: string } | null {
  if (/cartoon|卡通|带状|ribbon|缎带/.test(t)) return { en: 'cartoon', zh: '带状' }
  if (/球棍|球棒|\bsticks?\b|ballstick|ball.?and.?stick/.test(t)) return { en: 'sticks', zh: '球棍' }
  if (/球体|球状|\bspheres?\b|spacefill|\bcpk\b/.test(t)) return { en: 'spheres', zh: '球体' }
  if (/\blines?\b|wire|线/.test(t)) return { en: 'lines', zh: '线条' }
  return null
}

/** 组装协议 JSON：按消息语言选 reply */
function dec(zh: boolean, zhReply: string, enReply: string, commands: string[]): { reply: string; commands: string[] } {
  return { reply: zh ? zhReply : enReply, commands }
}

// ---------- r106 技能感知（skill-aware mock） ----------
// route.ts 命中标准技能时把 buildSkillDirective 的注入段（标准流程 + 固定报告格式）拼在
// 系统提示尾部、以首条 assistant 消息发送。本分支模拟「遵循技能指令的合规 LLM」：
// 从注入段原样解析步骤命令序列（commands 按序回放）与报告章节（reply 按【…报告】+
// ▌节行固定格式生成）。报告数值：能从场景快照（【自动注入的当前场景信息】user 消息）
// 取的取（结构名/配体/链/水/原子数）；命令回执类数值（接触数/氢键数/ΔSASA/RMSD——
// 报告生成在命令执行之前）合规写法就是「—」。此分支先于关键词模板：技能命中时流程
// 优先；普通对话（无注入段）零影响——这是把 E2E 的技能链升级为真端到端的 QA 基础设施。

/** 场景快照解析结果（技能报告填值用；对应前端 buildSceneContext 的输出格式） */
interface SceneFacts {
  structureName: string
  atoms: number
  residues: number
  chains: string[]
  ligandInfo: string
  waterCount: number
  structureNames: string[]
}

/** 解析场景快照：route.ts 把「【自动注入的当前场景信息，非用户发言】」开头的 user 消息
 *  放在系统提示之后。结构行格式：
 *  `- 【活动】4HHB [PDB] 4779原子/574残基 · 链: A(蛋白·141残基) B(…) · 配体: HEM×4 · 水50`
 *  （段分隔符是带双侧空格的 ' · '——链内“蛋白·141残基”的点号无空格，不会误切） */
function parseSceneFacts(messages: MockMessage[]): SceneFacts | null {
  const sceneMsg = messages.find(m => m?.role === 'user' && normalizeContent(m.content).startsWith('【自动注入的当前场景信息'))
  if (!sceneMsg) return null
  const text = normalizeContent(sceneMsg.content)
  const facts: SceneFacts = { structureName: '', atoms: 0, residues: 0, chains: [], ligandInfo: '', waterCount: 0, structureNames: [] }
  if (/未加载任何结构/.test(text)) return facts
  const m = /已加载 (\d+) 个结构，活动结构：(.+)$/m.exec(text)
  if (m) facts.structureName = m[2].trim()
  let activeDone = false
  for (const line of text.split('\n')) {
    if (!/^\s*-\s/.test(line)) continue
    const segs = line.trim().slice(2).split(' · ') // 去掉行首「- 」再按段切
    const head = /^(?:【活动】)?([A-Za-z0-9_-]+)\s+\[\w+\]\s+(\d+)原子\/(\d+)残基/.exec(segs[0])
    if (!head) continue
    facts.structureNames.push(head[1])
    const isActive = segs[0].startsWith('【活动】')
    if (isActive && !activeDone) {
      activeDone = true
      facts.structureName = head[1]
      facts.atoms = parseInt(head[2], 10)
      facts.residues = parseInt(head[3], 10)
      for (const seg of segs.slice(1)) {
        if (seg.startsWith('链: ') && seg !== '链: 无') {
          facts.chains = [...seg.matchAll(/([A-Za-z0-9]+)\(/g)].map(x => x[1])
        } else if (seg.startsWith('配体: ')) {
          facts.ligandInfo = seg.slice(3).trim()
        } else if (/^水\d+/.test(seg)) {
          facts.waterCount = parseInt(seg.slice(1), 10)
        }
      }
    }
  }
  return facts
}

/** 注入段解析结果（commands = 标准流程命令序列；sectionLabels = 报告章节标签序列） */
interface SkillDirective {
  name: string
  id: string
  cmds: string[]
  sectionLabels: string[]
}

/** 解析技能注入段：标记行「## 本次任务命中标准技能：{名}（{id}」只在 route.ts 注入时出现
 *  （历史消息的 assistant 回复是【…报告】文稿，不含该标记——无假阳性）。步骤行：
 *  `   1. 互作接触分析：contacts ligand | polymer 4.5 —— 验证说明`；章节行：`▌结构与配体：提示语` */
function parseSkillDirective(messages: MockMessage[]): SkillDirective | null {
  for (const msg of messages) {
    if (msg?.role !== 'assistant' && msg?.role !== 'system') continue
    const text = normalizeContent(msg.content)
    const marker = /## 本次任务命中标准技能：(.+?)（([a-z-]+)）/.exec(text)
    if (!marker) continue
    const d: SkillDirective = { name: marker[1], id: marker[2], cmds: [], sectionLabels: [] }
    let mm: RegExpExecArray | null
    const stepRe = /^\s+\d+\.\s[^：]+：(.+?)(?:\s+——\s.*)?$/gm
    while ((mm = stepRe.exec(text))) d.cmds.push(mm[1].trim())
    const secRe = /^▌([^：]+)：/gm
    while ((mm = secRe.exec(text))) d.sectionLabels.push(mm[1])
    return d
  }
  return null
}

/** workflow 模板里的示例 PDB ID（morph/xcontact 类双结构流程）按已加载结构名替换——
 *  真实 LLM 会按 check 提示「A/B 换成场景中的两个结构」做同样的事，mock 用机械替换模拟。
 *  首结构替换 1BQL/1UBQ、次结构替换 2LYZ/1D3Z；结构不足两个时保留原样（命令诚实报错
 *  走应用侧自动修正轮，不静默编造）。不含示例 ID 的命令不受影响。 */
function substituteSceneStructs(cmd: string, names: string[]): string {
  if (names.length < 2) return cmd
  // 单趟替换（replacer 函数）：链式 split/join 会把「替换产物再替换」——场景本身含
  // 1BQL/1D3Z 等示例名时命令被连环改写（实测踩坑：morph m1 = 1BQL 1BQL 40）
  const map: Record<string, string> = { '1BQL': names[0], '2LYZ': names[1], '1UBQ': names[0], '1D3Z': names[1] }
  return cmd.replace(/\b(1BQL|2LYZ|1UBQ|1D3Z)\b/g, m => map[m])
}

/** 各技能的建议短句（报告「建议」节静态填值——建议不依赖命令回执） */
const SKILL_ADVICE: Record<string, string> = {
  'ligand-pocket': '可 view from ligand 再看口袋；hbonds 3.2 可收紧判据',
  'hbond-network': 'zoom in 看网络细节；hbonds off 清除虚线',
  'interface-analysis': '分析面板可点选核心界面残基',
  'pub-figure': 'ray 宽度可至 3000；配色可换 spectrum',
  'structure-survey': '可 isolate <配体名> 聚焦辅基环境',
  'membrane-context': '膜厚 30-40Å 可调；通道结构可加 pore',
  'sasa-surface': '可 zoom 活性位点叠加渐变观察',
  'xcontact-analysis': 'superpose 变换实时反映在跨结构接触中',
  'morph-conformations': 'ensemble fps 可调速；record 可录制',
  'symmetry-assembly': '半径 5-80Å 可调组装范围',
}

/** 报告章节填值：场景快照可取的填实值；命令回执类（报告生成在命令执行前——接触数/氢键数/
 *  ΔSASA/RMSD/总面积等）合规写「—」；建议类给短句。default 分支即回执类的总出口。 */
function fillSkillReportValue(skillId: string, label: string, scene: SceneFacts | null): string {
  if (label === '建议') return SKILL_ADVICE[skillId] ?? '可结合场景继续调整视角与表示'
  const has = !!scene?.structureName
  switch (label) {
    case '结构与配体': return has ? (scene!.ligandInfo ? `${scene!.structureName} + ${scene!.ligandInfo}` : `${scene!.structureName}（无配体）`) : '—'
    case '分析范围': return has ? (scene!.ligandInfo ? '配体 4.5Å 内残基群（排除水）' : '活动结构主链（无配体回退）') : '—'
    case '界面链对': return has && scene!.chains.length >= 2 ? `${scene!.chains[0]}-${scene!.chains[1]}` : '—'
    case '图面目标': return has ? `${scene!.structureName}${scene!.ligandInfo ? ' 互作图' : ' 全貌图'}` : '—'
    case '表示与配色': return 'publication（链色卡通 · 配体鲜绿 · 距离渐变）'
    case '渲染参数': return '白底 · 描边 0.5/1px · 灯光默认'
    case '导出规格': return 'ray 2400 · PNG'
    case '链组成': return has && scene!.chains.length ? `${scene!.chains.join('/')}（${scene!.chains.length} 条链）` : '—'
    case '配体与辅基': return has && scene!.ligandInfo ? scene!.ligandInfo : '—'
    case '水与总量': return has ? `水${scene!.waterCount} · 共${scene!.atoms}原子` : '—'
    case '主轴方位': return 'PCA 主轴已对齐（跨膜轴竖直）'
    case '膜参数': return '厚度 34Å · 5 对象（双头基板+核心）'
    case '构象对': return scene && scene.structureNames.length >= 2 ? `${scene.structureNames[0]} → ${scene.structureNames[1]}` : '—'
    case '结构对': return scene && scene.structureNames.length >= 2 ? `${scene.structureNames[0]} | ${scene.structureNames[1]}` : '—'
    case '帧数': return '40（默认）'
    case '组装半径': return '20Å（默认）'
    case '组装观感': return '原体 + 对称伴侣整体入框'
    default: return '—'
  }
}

/** 关键词 → AgentDecision 协议模板（commands 覆盖全命令面；顺序具体优先于宽泛） */
function buildDecision(messages: MockMessage[]): { reply: string; commands: string[] } {
  // 多模态兼容：content 可能是 OpenAI 视觉格式的数组——归一化为纯文本再走模板
  const lastUserMsg = [...messages].reverse().find(m => m?.role === 'user')
  const lastUser = normalizeContent(lastUserMsg?.content)
  const t = lastUser.toLowerCase()
  const zh = CJK_RE.test(lastUser)

  // 0. VLM 视觉自查（最前：含 image_url 的多模态请求按视觉分支处理，文本模板不受影响）。
  //    默认「通过」；归一化文本含「失败演练 / fail drill」→ 演练未达标路径（修正命令透传回前端执行）
  if (hasImagePart(lastUserMsg?.content)) {
    // r79：论文图模板解析（/api/templates/parse 的多模态请求——文本含固定标记
    // 「论文图模板解析」）：返回 TemplateDraft 协议 JSON（非 AgentDecision 形状——
    // 路由端 extractJsonObject + sanitizeTemplateDraft 消费）。含两条白名单外命令
    // （save x.pdb / fake verbs）供「剔除明细透传 UI」路径的联调实证
    if (/论文图模板解析/.test(lastUser)) {
      const draft = {
        name: { zh: '彩虹卡通全景', en: 'Rainbow cartoon overview' },
        tagline: { zh: 'N→C 渐变卡通带 + 白底细描边 + 主轴全景', en: 'N→C rainbow cartoon on white with hairline outlines, principal-axis framing' },
        purpose: { zh: '整体概览 · 折叠走向', en: 'Overview · fold topology' },
        tags: [{ zh: '整体结构', en: 'Overview' }, { zh: '图片解析', en: 'From image' }],
        category: 'basic',
        demo: '4HHB',
        accent: 'rose',
        analysis: {
          zh: '图中为四聚体蛋白的卡通带表示：N→C 彩虹渐变着色、纯白背景、发丝级轮廓描边、主轴对齐全景构图，无氢键虚线或距离标注等分析元素。',
          en: 'A tetramer shown as cartoon ribbons: N→C rainbow gradient, pure white background, hairline outlines, principal-axis overview framing; no H-bond dashes or distance labels.',
        },
        commands: [
          'preset cartoon',
          'spectrum count, rainbow',
          'bg white',
          'outline on 1.1 1.0',
          'orient',
          'save x.pdb',
          'make everything beautiful',
        ],
      }
      return draft as unknown as { reply: string; commands: string[] }
    }
    if (/失败演练|fail drill/i.test(lastUser)) {
      return dec(zh,
        '视觉自查未达标：目标颜色未生效，已自动下发修正命令。',
        'Visual check failed: target color not applied — corrective commands issued.',
        ['select chain A', 'color red, chain A'])
    }
    return dec(zh,
      '视觉自查通过：渲染结果与用户目标一致，无需修正。',
      'Visual check passed: the render matches the goal — no corrections needed.',
      [])
  }

  // 0.5 r106 技能感知分支（先于关键词模板：技能命中时标准流程优先）。commands 按注入段
  //     步骤序回放（示例 PDB ID 场景替换）；reply 按【…报告】+ ▌节行固定格式（章节标签
  //     与数值由注入段 + 场景快照驱动——mock 不编造回执类数值）。
  const directive = parseSkillDirective(messages)
  if (directive) {
    const scene = parseSceneFacts(messages)
    const commands = directive.cmds.map(c => substituteSceneStructs(c, scene?.structureNames ?? []))
    const replyLines = [`【${directive.name}报告】`]
    for (const label of directive.sectionLabels) {
      replyLines.push(`▌${label}：${fillSkillReportValue(directive.id, label, scene)}`)
    }
    return { reply: replyLines.join('\n'), commands }
  }

  // 1. 彩虹渐变（先于颜色类：「彩虹色/渐变」不能被色词匹配吞掉）
  //    真实语法：spectrum count|b, rainbow [选择]（PyMOL 兼容）
  if (/彩虹|\brainbow\b|spectrum|渐变/.test(t)) {
    return dec(zh,
      '已按链序彩虹渐变着色（spectrum count, rainbow）。',
      'Colored with a rainbow gradient by chain order (spectrum count, rainbow).',
      ['spectrum count, rainbow'])
  }

  // 2. 距离测量（先于显示类：「距离」消息不可落到表示法模板）
  //    真实语法：measure dist (选择A) (选择B)——两组括号选择，取两组间最近原子对，3D 标注入测量面板
  if (/测量|量距|距离|\bmeasure\b|\bdistance\b|\bdist\b/.test(t)) {
    const [c1, c2] = extractChains(lastUser, 2)
    return dec(zh,
      `已测量 ${c1} 链与 ${c2} 链代表原子（CA）之间的最近原子对距离，3D 标注已加入测量面板。`,
      `Measured the nearest-atom-pair distance between chain ${c1} and chain ${c2} CA atoms; the 3D annotation is in the measurement panel.`,
      [`measure dist (chain ${c1} and name CA) (chain ${c2} and name CA)`])
  }

  // 3. 氢键网络。真实语法：hbonds on [nÅ]（距离上限 2-6 Å 合法窗；另支持 in <范围> 烘焙）
  if (/氢键|hydrogen\s*bond|\bh-?bonds?\b|\bhbon\b/.test(t)) {
    return dec(zh,
      '已开启氢键网络（距离上限 3.2 Å）——快捷键 B 可随时切换。',
      'H-bond network enabled (distance limit 3.2 Å) — hotkey B toggles it anytime.',
      ['hbonds on 3.2'])
  }

  // 4. 结构叠合比对。真实语法：superpose <mobile> [onto <ref>] [chain X to Y]——
  //    需两个已加载结构；消息里带 PDB ID 就用之，否则照发示例命令（应用侧诚实报错补齐提示）
  if (/比对|叠合|superpose|\balign\b|\bmatch\b/.test(t)) {
    const ids = extractPdbIds(lastUser)
    const cmd = ids.length >= 2 ? `superpose ${ids[0]} onto ${ids[1]}`
      : ids.length === 1 ? `superpose ${ids[0]}`
      : 'superpose 4HHB onto 1A3N chain A to A'
    return dec(zh,
      `将执行结构叠合比对（${cmd}）——需要两个已加载的结构；若当前只有一个，应用会提示先加载另一个。`,
      `Running structure superposition (${cmd}) — two loaded structures are required; if only one is loaded the app will ask you to load the other.`,
      [cmd])
  }

  // 5. 背景色（先于颜色类：「背景蓝色」按背景处理）。真实语法：bg <颜色名|#hex>
  if (/背景|底色|\bbg\b|background/.test(t)) {
    const hit = COLOR_WORDS.find(([re]) => re.test(t))
    const en = hit?.[1] ?? 'grey'
    const zhName = hit?.[2] ?? '灰色'
    return dec(zh,
      `背景色已切换为${zhName}（bg ${en}）。`,
      `Background set to ${en} (bg ${en}).`,
      [`bg ${en}`])
  }

  // 6. 二级结构着色（先于颜色类：「按二级结构着色」不可落到链染色）。
  //    真实语法：util cbss（空格分隔——非 util.cbss 点号写法；卡通按 SS + 配体回元素基色）
  if (/二级结构|二级|secstr|\bsecondary\b|\bss\b|\bcbss\b/.test(t)) {
    return dec(zh,
      '已按二级结构着色（util cbss：螺旋红 · 折叠黄 · 环灰，配体/水/离子回元素基色）。',
      'Colored by secondary structure (util cbss: helix red, sheet yellow, loop gray; ligands/waters/ions back to element base colors).',
      ['util cbss'])
  }

  // 7. SASA/静电着色（先于颜色类：「color sasa / 静电着色」不可落到链染色）。
  //    真实语法：color sasa（暴露度渐变；大结构 Worker 后台算完自动烘焙）
  if (/静电|electrostat|coulomb|\bsasa\b|溶剂可及|暴露度/.test(t)) {
    return dec(zh,
      '已按溶剂可及性着色（color sasa：埋藏蓝紫 → 暴露橙红，静电态势的常用近似）——大结构后台计算完成后自动烘焙上色。',
      'Colored by solvent accessibility (color sasa: buried blue-violet to exposed orange-red, a common electrostatics proxy) — large structures auto-bake once the background computation finishes.',
      ['color sasa'])
  }

  // 8. 链染色（r64-b 既有模板升级双语）：显式上色动词，或消息本身就带颜色词（如「B 链蓝色」）
  const colorHit = COLOR_WORDS.find(([re]) => re.test(t))
  if (/颜色|染色|染[成为红蓝绿黄黑白灰橙紫青]|上色|\bcolou?r\b/.test(t) || colorHit) {
    const chain = extractChain(lastUser)
    const en = colorHit?.[1] ?? 'red'
    const zhName = colorHit?.[2] ?? '红色'
    return dec(zh,
      `已将 ${chain} 链染为${zhName}。`,
      `Chain ${chain} colored ${en}.`,
      [`select chain ${chain}`, `color ${en}, chain ${chain}`])
  }

  // 9. 定向/居中（先于显示/隐藏：「居中显示」按居中处理）。
  //    center 不是命令动词——居中由裸 zoom（fitView 全量）承担；orient = PCA 主轴对齐
  if (/orient|定向|主轴|居中|\bcenter\b|centre/.test(t)) {
    return dec(zh,
      '已按主轴定向视角并居中适配全部结构（orient + zoom）。',
      'View aligned to principal axes and re-framed on all structures (orient + zoom).',
      ['orient', 'zoom'])
  }

  // 10. 隐藏（先于显示：「不显示」不可被显示模板吞掉）。真实语法：hide <rep> [选择]
  if (/隐藏|藏|\bhide\b|undisplay|不显示/.test(t)) {
    const chain = extractChain(lastUser)
    const rep = detectRep(t) ?? { en: 'lines', zh: '线条' }
    return dec(zh,
      `已隐藏 ${chain} 链的${rep.zh}表示。`,
      `Hidden ${rep.en} representation of chain ${chain}.`,
      [`hide ${rep.en}, chain ${chain}`])
  }

  // 11. 显示（表示法细分：cartoon/sticks/spheres/lines，缺省 cartoon）。
  //     真实语法：show <rep> [选择]（逗号/空格分隔皆可）
  if (/显示|展示|\bshow\b|display|cartoon|卡通|带状|ribbon|缎带|球棍|球棒|\bsticks?\b|球体|球状|\bspheres?\b|spacefill|\bcpk\b|\blines?\b|wire|线/.test(t)) {
    const chain = extractChain(lastUser)
    const rep = detectRep(t) ?? { en: 'cartoon', zh: '带状' }
    return dec(zh,
      `已将 ${chain} 链切换为${rep.zh}展示。`,
      `Chain ${chain} switched to ${rep.en} representation.`,
      [`select chain ${chain}`, `show ${rep.en}, chain ${chain}`])
  }

  // 12. 谓词选择：name CA / resn HEM / resi N-M / chain X（中英谓词；链严格提取不缺省）
  if (/选择|选取|\bselect\b/.test(t)) {
    const parts: string[] = []
    const ch = chainStrict(lastUser)
    if (ch) parts.push(`chain ${ch}`)
    const resn = /(?:\bresn\b|resname|残基名|残基)\s*[:=]?\s*([a-z0-9]{1,4})/i.exec(lastUser)?.[1]
    if (resn) parts.push(`resn ${resn.toUpperCase()}`)
    const resiRaw = /(?:\bresi\b|resid|残基号|残基编号|编号)\s*[:=]?\s*(\d+(?:\s*[-~到至]\s*\d+)?)/i.exec(lastUser)?.[1]
    if (resiRaw) parts.push(`resi ${resiRaw.replace(/\s*[-~到至]\s*/g, '-')}`)
    const name = /(?:\bname\b|原子名|原子)\s*[:=]?\s*([a-z0-9'`^+\-]{1,4})/i.exec(lastUser)?.[1]
    if (name) parts.push(`name ${name.toUpperCase()}`)
    if (parts.length) {
      const expr = parts.join(' and ')
      return dec(zh,
        `已选择 ${expr} 并聚焦视图（zoom sele）。`,
        `Selected ${expr} and focused the view (zoom sele).`,
        [`select ${expr}`, 'zoom sele'])
    }
  }

  // 13. 默认 / 选择类（r64-b 既有模板升级双语）
  const chain = extractChain(lastUser)
  return dec(zh,
    `已选择 ${chain} 链并适配视图。`,
    `Chain ${chain} selected and framed.`,
    [`select chain ${chain}`, `zoom chain ${chain}`])
}

/** 均分文本为 n 段（流式内容分片用；拼接还原原文） */
function splitChunks(s: string, n: number): string[] {
  const size = Math.max(1, Math.ceil(s.length / n))
  const out: string[] = []
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size))
  return out
}

/** OpenAI SSE chunk 帧 */
function sseChunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: 'mock',
    object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

const server = Bun.serve({
  port: 3999,
  idleTimeout: 30,
  async fetch(req) {
    const url = new URL(req.url)
    const auth = req.headers.get('authorization') ?? ''
    if (auth && auth !== 'Bearer test-key-12345') {
      return new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      })
    }
    if (url.pathname.endsWith('/models')) {
      return new Response(JSON.stringify(models), { headers: { 'Content-Type': 'application/json' } })
    }
    if (url.pathname.endsWith('/chat/completions')) {
      const body = (await req.json().catch(() => ({}))) as { stream?: boolean; messages?: MockMessage[] }
      const decision = buildDecision(body.messages ?? [])

      // ---- 流式分支：OpenAI SSE 协议（首帧 role、3 个内容增量帧、末帧 finish_reason + [DONE]） ----
      if (body.stream) {
        const parts = splitChunks(JSON.stringify(decision), 3)
        return new Response(
          new ReadableStream({
            async start(controller) {
              const enc = new TextEncoder()
              let clientGone = false
              // 客户端断开（取消传播测试）：吞掉 enqueue 异常并停止后续分片
              const write = (chunk: string) => {
                try { controller.enqueue(enc.encode(chunk)) } catch { clientGone = true }
              }
              write(sseChunk({ role: 'assistant' })) // 首 chunk：role 帧（OpenAI 惯例）
              for (const piece of parts) {
                if (clientGone) break
                write(sseChunk({ content: piece }))
                await new Promise(r => setTimeout(r, 40)) // 模拟生成间隔（联调流式 UI）
              }
              if (!clientGone) {
                write(sseChunk({}, 'stop')) // 末 chunk：finish_reason stop
                write('data: [DONE]\n\n')
                try { controller.close() } catch { /* 已取消 */ }
              }
            },
          }),
          {
            headers: {
              'Content-Type': 'text/event-stream; charset=utf-8',
              'Cache-Control': 'no-cache, no-transform',
              Connection: 'keep-alive',
            },
          },
        )
      }

      // ---- 非流式：整段返回协议 JSON（联调 callAgent 非流式路径） ----
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: JSON.stringify(decision) }, finish_reason: 'stop' }],
      }), { headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('not found', { status: 404 })
  },
})
console.log(`mock-llm listening on ${server.url}`)

// hot-reload nudge r66-b
