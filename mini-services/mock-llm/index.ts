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

/** r114-b 链清单消费：从探测输出解析可用链（行式：`  ◉  00  A   蛋白  141 残基` /
 *  EN `  ◉  00  A   protein  141 residues`——chains list 的每链一行格式）。返回按序
 *  [id, type] 对；空数组 = 清单为空或格式异常（诚实降级路径）。 */
function parseChainsFromProbeOutput(text: string): { id: string; type: string }[] {
  const out: { id: string; type: string }[] = []
  for (const m of text.matchAll(/^\s*[\u25c9\u2298]\s+\d+\s+(\S+)\s+(\S+)/gm)) {
    out.push({ id: m[1], type: m[2].toLowerCase() })
  }
  return out
}

/** r114-b 链清单消费：按可用链重组失败命令（mock 的机械版「看清单再重组」）。
 *  规则（与 fixRewrite 发探测的命令域同族）：
 *  ① chains hide/show <args>——参数 token 逐个替换（无效链 → pick，保留分隔结构）；
 *  ② chain X 词式（select/zoom/isolate/contacts/hide/color…一切选择表达式域）——无效链换 pick；
 *  ③ interface X Y 形态——两侧分别替换。pick = 清单首个蛋白链（无蛋白链取首链）。
 *  命令不含链 token 时原样返回（探测清单对它无增量——不首造改写）。 */
function recomposeByChainList(cmd: string, available: Set<string>, pick: string): string {
  const hideShow = /^(chains|chain)\s+(hide|show)\s+(.+)$/i.exec(cmd.trim())
  if (hideShow) {
    // 失败的 chains hide X+Y 必然全部无效（app 侧部分命中即成功不报错）——逐 token 换
    // pick 后去重（X+Y → H+H 归一为 H；真实 LLM 同样不会写 hide H+H）
    const args = [...new Set(hideShow[3].split(/[+\s,]+/)
      .map(tok => { const T = tok.trim().toUpperCase(); return T && !available.has(T) ? pick : tok })
      .filter(Boolean))].join('+')
    return `${hideShow[1].toLowerCase()} ${hideShow[2].toLowerCase()} ${args}`
  }
  let out = cmd.replace(/\bchain\s+([A-Za-z0-9])\b/gi, (whole, ch: string) =>
    available.has(ch.toUpperCase()) ? whole : `chain ${pick}`)
  out = out.replace(/\binterface\s+([A-Za-z0-9])(?:\s+([A-Za-z0-9]))?\b/gi, (whole, a: string, b?: string) => {
    const fa = available.has(a.toUpperCase()) ? a : pick
    const fb = b !== undefined ? (available.has(b.toUpperCase()) ? b : pick) : undefined
    return `interface ${fa}${fb !== undefined ? ` ${fb}` : ''}`
  })
  return out
}

/** r110-c 修正轮「真修正」：失败命令的语义改写（场景替换后应用）。
 *  动机：r109 的 0.45 是「场景替换后回放原命令」——失败原因若不是场景参数（如无配体
 *  结构跑配体技能：场景替换后命令仍是 contacts ligand），同名重试必再失败（应用侧
 *  depth 兜底停，修正轮沦为仪式）。真实 LLM 的修正是「读错误信息换一种问法」：
 *  按失败 output 的错误类型 + 命令形态改写为更可能成功的等价命令。
 *  规则（失败 output 含「命中 0 个原子 / matched 0 atoms」时空选择错误才适用）：
 *  ① ligand 依赖降级——命令含 ligand（典型：无配体结构跑配体技能）：
 *     view from ligand → orient（视角兜底）/ zoom within N of (ligand) → zoom
 *     （整框兜底）/ 其余命令 ligand 词级换 polymer（contacts 两段语法、hbonds 烘焙
 *     scope、count/isolate 选择子均得到合法且非空的等价命令）；
 *  ② 链不存在探测——命令含 chain X 而 output 报空选择（链不在场景）：回放
 *     chains list（单轮 mock 无法「看链清单再重组」——需要消费命令输出，跨轮次；
 *     诚实降级为探测命令，用户/LLM 下轮按清单重组）。
 *  无规则命中保持原命令（场景替换后回放——r109 行为，适配场景参数失配类失败）。 */
function fixRewriteCommand(cmd: string, failOutput: string): string {
  // r111-c 链不存在族优先分支：文案「未找到链 X——可用链：… / Chain X not found —
  // available: …」（chains hide/show 参数链不存在 + 一切链域失败）→ chains list 探测。
  // 单列于空选择判据之前：该族无论命令形态（chains hide X 连 \bchain\s+X\b 词式都不
  // 匹配——逐形态规则必漏），探测可用链都是统一正确答案；且与空选择四族文案互斥
  // （空选择族不含「未找到链」字样），先判不抢 ligand 降级规则。
  if (/未找到链|Chain \S+ not found/i.test(failOutput)) return 'chains list'
  // G1 实测补判据（两轮）：空选择文案共四族——①zoom/count 系「命中 0 个原子 / matched
  // 0 atoms」②contacts 系「选择为空（A: 0 原子…）/ Empty selection (A: 0 atoms…)」
  // ③hbonds scope「范围选择为空 / Scope selection is empty」④view/isolate「选择为空 /
  // Selection is empty」。ZH 侧「选择为空」是②③④的公共子串、EN 侧「selection is empty」
  // （不区分大小写）统一③④——正则五选一覆盖全族；否则某族失败恒不改写（G1 抓出
  // contacts 与 hbonds/view 两轮漏判的教训：判据必须按产品代码实文案枚举，勿凭一族推全）
  if (!/命中 0 个原子|matched 0 atoms|选择为空|Empty selection|selection is empty/i.test(failOutput)) return cmd
  if (/\bligand\b/i.test(cmd)) {
    if (/^view\s+from\s+ligand$/i.test(cmd.trim())) return 'orient'
    if (/^zoom\s+within\s+\S+\s+of\s+\(ligand\)$/i.test(cmd.trim())) return 'zoom'
    return cmd.replace(/\bligand\b/gi, 'polymer')
  }
  if (/\bchain\s+[A-Za-z0-9]\b/.test(cmd)) return 'chains list'
  // r114-b interface 形态补入：interface A B [cutoff] 裸链字母（无 chain 词式）——空选择
  // 失败同样源于链不在场景，futile 同名重跑不如探测（与 r111-c 链族单列同一设计哲学：
  // 命令形态规则对无词式命中必漏，形态枚举是词式规则外的第二全覆盖维度）。
  if (/^interface\s+[A-Za-z0-9](\s+[A-Za-z0-9])?(\s+\d+(\.\d+)?)?\s*$/i.test(cmd.trim())) return 'chains list'
  return cmd
}


/** r109-c 链 ID 场景替换（r106-parallel 遗留②）：workflow 模板里的示例链（chain A /
 *  chain B / interface A B）按场景链替换——真实 LLM 按 check 提示「A/B 换成场景中的
 *  两条链」做同样的事，mock 用机械替换模拟。保守条件：模板字母不在场景链清单时才替换
 *  （场景真有 A/B 链时是实参不是占位符，绝不动）；链不足两条时保留原样（命令诚实报错
 *  走应用侧自动修正轮，不静默编造）。 */
function substituteSceneChains(cmd: string, chains: string[]): string {
  if (chains.length < 2) return cmd
  let out = cmd
  if (!chains.includes('A')) out = out.replace(/\bchain A\b/g, `chain ${chains[0]}`)
  if (!chains.includes('B')) out = out.replace(/\bchain B\b/g, `chain ${chains[1]}`)
  if (!chains.includes('A') && !chains.includes('B')) out = out.replace(/\binterface A B\b/g, `interface ${chains[0]} ${chains[1]}`)
  return out
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

// ---------- r107 两段式回填（mock 侧） ----------
// 解析回填 prompt（草稿 + 命令回执 + 运行时补充）→ 占位值按节域正则从回执提取实测值。
// 与真实 LLM 的语义匹配等价的机械版：节域名 → 回执文案正则（contacts「N 对残基接触」/
// bsa「合计 N Å²」/ sasa「总计 N Å²」/ symmetry「已生成 N 个对称伴侣」/ 运行时「氢键网络
// 当前 N 条」）。提取不到保持原值——绝不编造（与技能注入段「取不到写—」同一纪律）。

/** 节域名 → 回执正则提取（src = 回执行文本 + 运行时补充拼接）。
 *  r107 双语：应用 console 回执随界面语言（ZH「N 对残基接触」/ EN「N residue-pair
 *  contacts」）——E2E 实测 EN 语言下中文-only 正则全数失配，占位值无法回填。 */
function fillFromReceiptsByLabel(label: string, src: string): string | null {
  // 接触对/口袋残基/接触残基类：contacts 回执 + 最近接触（残基对 + 距离）
  if (/接触对|接触残基|口袋残基/.test(label)) {
    const m = /(\d+) 对(跨结构)?残基接触/.exec(src) ?? /(\d+) (?:cross-structure )?residue-pair contacts/.exec(src)
    if (!m) return null
    const near = /最近 (\S+ ↔ \S+) ([\d.]+) Å/.exec(src) ?? /nearest (\S+ ↔ \S+) ([\d.]+) Å/.exec(src)
    return near ? `${m[1]} 对（最近 ${near[1]} ${near[2]} Å）` : `${m[1]} 对`
  }
  if (/氢键条数|^氢键$/.test(label)) {
    // r108-b：runner 现把 hbond-store 键数追加进回执（「氢键网络当前 N 条」ZH / EN 同锚格式）
    const m = /氢键网络当前 (\d+) 条/.exec(src) ?? /H-bond network: currently (\d+) bonds/.exec(src)
    return m ? `${m[1]} 条` : null
  }
  if (/埋藏面积/.test(label)) {
    const m = /合计 (\d+) Å²/.exec(src) ?? /ΔSASA[\s\S]*?total (\d+) Å²/.exec(src)
    return m ? `${m[1]} Å²` : null
  }
  if (/总面积/.test(label)) {
    const m = /总计 (\d+) Å²/.exec(src) ?? /SASA[\s\S]*?total (\d+) Å²/.exec(src)
    return m ? `${m[1]} Å²` : null
  }
  if (/疏水与极性/.test(label)) {
    const m = /疏水 (\d+) · 极性 (\d+)/.exec(src) ?? /hydrophobic (\d+) · polar (\d+)/.exec(src)
    return m ? `疏水 ${m[1]} Å² · 极性 ${m[2]} Å²` : null
  }
  if (/伴侣数/.test(label)) {
    const m = /已生成 (\d+) 个对称伴侣/.exec(src) ?? /(\d+) symmetry mates generated/.exec(src)
    return m ? `${m[1]} 个` : null
  }
  if (/距离/.test(label)) {
    const m = /最近 \S+ ↔ \S+ ([\d.]+) Å/.exec(src) ?? /nearest \S+ ↔ \S+ ([\d.]+) Å/.exec(src)
    return m ? `${m[1]} Å` : null
  }
  if (/RMSD/i.test(label)) {
    const m = /RMSD ([\d.]+)/.exec(src)
    return m ? `${m[1]} Å` : null
  }
  return null
}

/** 回填 prompt → 回填后的报告（格式与节结构原样保持，仅占位值替换为实测值） */
function fillReportFromReceipts(text: string): { reply: string; commands: string[] } {
  // 草稿段：'报告草稿：\n' 之后到 '\n\n命令回执' 前；回执段：'命令回执' 标记之后
  const draftMatch = /报告草稿：\n([\s\S]*?)\n\n命令回执/.exec(text)
  const draft = draftMatch ? draftMatch[1].trim() : ''
  const receiptPart = text.split('命令回执（cmd → output）：')[1] ?? ''
  // 回执行 '- cmd → output'（指令行无 ' → '——cmd/output 分隔符是唯一判据）
  const receiptLines = [...receiptPart.matchAll(/^- (.+?) → (.+)$/gm)].map(m => `${m[1]} ${m[2]}`)
  const rtMatch = /运行时补充：(.+)$/m.exec(text)
  const src = `${receiptLines.join('\n')}\n${rtMatch ? rtMatch[1] : ''}`
  if (!draft) return { reply: '【回填失败】草稿段解析失败', commands: [] }
  const filled = draft.split('\n').map(line => {
    const sec = /^▌([^：]+)：(.*)$/.exec(line)
    if (!sec) return line
    const [, label, value] = sec
    // 只回填占位值（「—」/「后台计算中」）——草稿已有实测值不覆盖（保守策略，与
    // 「回执为准」指令的差异仅在于 mock 无法语义判定草稿值是否可被回执覆盖）
    if (value !== '—' && !/后台计算中/.test(value)) return line
    const v = fillFromReceiptsByLabel(label, src)
    return v ? `▌${label}：${v}` : line
  }).join('\n')
  return { reply: filled, commands: [] }
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
    if (/失败演练链域|fail drill chain/i.test(lastUser)) {
      // r115-a 链域失败演练：修正命令带不存在的链（Z 在任何场景都不存在）→ 应用侧视觉
      // 自查子轮的命令失败走链域路径——r115 消费救济（chainFails 全量扫描）的 G1 驱动器。
      // 命令选用「空选择必报错」族（zoom chain Z, 5 → 命中 0 原子错误；interface A Z →
      // Empty selection 错误）——select/color 对 0 原子选择是 ok 态（G1 实测：Colored:
      // #e04545 (chain Z)），不产生 error 记录就无法并入 chainFails。先于通用失败演练
      // （具体优先于宽泛）：前者验证链域失败闭环，后者验证通用修正透传。
      return dec(zh,
        '视觉自查未达标：修正命令引用了不存在的链，已下发链域修正命令（将失败并触发链清单消费救济）。',
        'Visual check failed: corrective commands reference a nonexistent chain (they will fail and trigger the chain-list consumption relief).',
        ['zoom chain Z, 5', 'interface A Z'])
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

  // 0.4 r107 报告回执回填分支（两段式第二段）：末条 user 消息以【报告回执回填】开头时，
  //     解析「草稿 + 命令回执 + 运行时补充」→ 占位值（— / 后台计算中）按节域正则从回执
  //     提取实测值（提取不到保持「—」——诚实优先）；commands 恒为 []（回填只改文稿）。
  if (lastUser.startsWith('【报告回执回填】')) {
    return fillReportFromReceipts(lastUser)
  }

  // 0.45 r109-c 修正轮技能上下文分支：末条 user 为应用侧自动修正 prompt（「刚才这些命令
  //      执行失败了，请修正」/ "These commands just failed. Fix them"）且技能注入段在场
  //      （runTurn 修正轮现随请求上送 skillId → route 重注入标准流程）时，按技能上下文
  //      修正：从 prompt 提取失败命令行（`- cmd → output`），场景替换（结构名 + 链 ID）
  //      后回放为修正命令——修正不偏离该技能的 workflow 命令域。r106-parallel 遗留①的
  //      落地：修正轮无技能上下文时关键词模板回复会跑偏标准流程。先于 0.5（否则整段
  //      workflow 回放会重复已成功命令——与修正 prompt「不要重复已成功的命令」相悖）。
  if (/执行失败了，请修正|just failed\. Fix them/i.test(lastUser) && parseSkillDirective(messages)) {
    // r110-c 提取升级：捕获失败 output（改写判据——空选择错误才触发规则；r109 只提
    // 命令本体，改写无据可依）。matchAll 产出与命令一一配对的 (cmd, output) 序列。
    // r114-b 修复：prompt 尾部「已成功命令的关键输出」节同样以 `- cmd → output` 行式
    // 出现——旧正则全量吞入会把成功命令当失败重跑（违反 prompt 自己的「不要重复已
    // 成功命令」）。先按节头切分，只取失败节。
    const failSection = lastUser.split(/已成功命令的关键输出|Key output of already-successful/)[0]
    const failedPairs = [...failSection.matchAll(/^- (.+?) → (.+)$/gm)].map(m => [m[1].trim(), m[2].trim()] as const)
    const scene = parseSceneFacts(messages)
    // r110-c 真修正管线：场景替换（场景参数失配类失败）→ 语义改写（ligand 依赖降级 /
    // 链不存在探测——错误类型类失败）。两道各自独立：前者治「参数写错」，后者治
    // 「命令语义在本场景不成立」（同名重试必再失败的根因）。
    const sceneSubbed = failedPairs
      .map(([c, o]) => [substituteSceneStructs(c, scene?.structureNames ?? []), o] as const)
      .map(([c, o]) => [substituteSceneChains(c, scene?.chains ?? []), o] as const)
    // r114-b 去重：多个链域失败会各自改写出同一条 chains list 探测（真实 LLM 不会
    // 把同一探测命令重复三遍）——精确重复去重保序（不同命令的改写产物不受影响）。
    // rewrote 先于去重计算（去重后索引错位会误判改写态）。
    const rewritten = sceneSubbed.map(([c, o]) => fixRewriteCommand(c, o))
    const commands = [...new Set(rewritten)]
    // rewrote 只反映语义改写（与场景替换后的中间态比——场景替换改写不冒充「按失败原因修正」）
    const rewrote = rewritten.some((c, i) => c !== sceneSubbed[i][0])
    return dec(zh,
      rewrote
        ? `已按失败原因修正命令（失败选择子按错误信息改写为等价命令后重试；链不存在时先 chains list 探测可用链）。`
        : `已按标准技能流程修正失败命令（按当前场景替换选择表达式后重试）。`,
      rewrote
        ? `Commands fixed by failure cause (failed selectors rewritten to equivalent commands per the error message; chains list probes available chains when a chain is absent).`
        : `Failed commands corrected within the standard skill workflow (selection expressions re-substituted for the current scene).`,
      commands)
  }

  // 0.46 r114-b 链清单消费分支（「看清单再重组」的真闭环——r110/r111 持续挂起项收口）：
  //      末条 user 为应用侧探测消费 prompt（「链清单已探测 / chain list has been probed」
  //      ——AgentPanel r114-b 接线在修正轮 chains list 探测成功后发出）。解析「失败命令
  //      + chains list 输出」→ 按清单机械重组（无效链 → 首个蛋白链）。真实 LLM 天然可从
  //      同一 prompt 语义重组（无需 mock 侧会话记忆——prompt 自包含探测结果，这就是把
  //      「跨轮次记忆」问题转化为「单轮自包含上下文」的架构决策）。先于 0.5（技能注入
  //      在场时会拦截一切消息——0.46 的自包含性不依赖技能上下文）。
  if (/链清单已探测|chain list has been probed/i.test(lastUser)) {
    // r115-d：先切掉尾部「已成功命令的关键输出 / Key output of already-successful」节
    //（与 0.45 的 r114-b 同款隔离——成功命令的 `- cmd → output` 行式与失败节同形，
    // 不切会把成功命令当失败重组重跑）；从中提取已成功命令集，重组产物同名时丢弃
    //（防重发：视觉修正命令 color red, chain A 已成功 → 重组再出同名命令不执行）。
    const okSection = lastUser.split(/已成功命令的关键输出|Key output of already-successful/)[1] ?? ''
    const okCmds = new Set(okSection.matchAll(/^- (.+?) → /gm).map(m => m[1].trim()))
    const failSection = lastUser.split(/已成功命令的关键输出|Key output of already-successful/)[0].split(/chains list 输出|chains list output/)[0]
    const failedPairs = [...failSection.matchAll(/^- (.+?) → (.+)$/gm)].map(m => [m[1].trim(), m[2].trim()] as const)
    const probeSection = lastUser.split(/chains list 输出|chains list output/)[1] ?? ''
    const chains = parseChainsFromProbeOutput(probeSection)
    if (!failedPairs.length || !chains.length) {
      // 诚实降级：解析不出失败命令或清单为空（格式漂移/输出截断）——不编造重组
      return dec(zh,
        '未能从链清单输出中解析出可用链或失败命令（清单为空或格式异常）——请人工执行 chains list 查看后重发。',
        'Could not parse available chains or failed commands from the chain-list output (empty or malformed) — run chains list manually and resend.',
        [])
    }
    const available = new Set(chains.map(c => c.id))
    const protein = chains.find(c => c.type === 'protein' || c.type === '蛋白')
    const pick = protein?.id ?? chains[0].id
    // r115-d 双重去重：①重组产物精确去重（不同失败命令可重组出同名命令——原失败与
    // 视觉重发同文时）；②与已成功命令同名时丢弃（防重发——真实 LLM 同样不会重发已
    // 成功的命令）。丢弃计数进 reply（诚实口径：重组了几条、丢了几条重复、为什么丢）。
    // r118-a 对称守卫（r117 建议①）：再从失败节提取 failCmds 集，重组产物与既往失败
    // 命令同文时丢弃——app 侧 r117-b 同款短路的 mock 对称（重组无变化的命令重跑必再
    // 败；r117 G1a 实测口径差：mock 说「1 条待执行」而 app 短路后实际执行 0）。两类
    // 丢弃独立计数、各自诚实进 reply；app 侧防线保留（真实 LLM 无 mock 配合仍生效）。
    const failCmds = new Set(failedPairs.map(([c]) => c))
    const recomposedAll = failedPairs.map(([c]) => recomposeByChainList(c, available, pick))
    const uniqAll = [...new Set(recomposedAll)]
    const commands = uniqAll.filter(c => !okCmds.has(c.trim()) && !failCmds.has(c.trim()))
    const okDrop = uniqAll.filter(c => okCmds.has(c.trim())).length
    const failDrop = uniqAll.length - commands.length - okDrop
    const avail = [...available].join('、')
    // r119-c（r118 建议③收口）：0 待执行场景文案切换——「无效链已替换为 A」在重组
    // 产物全部被丢弃时是伪陈述（没有任何命令真的被替换后执行；旧文案「0 条待执行 +
    // 替换说明」读起来像重组发生了但产物为空）。诚实口径：候选全部分类为已成功重复
    // /既往失败同文已跳过，无可执行命令——并给用户下一步（换分析目标或人工核验链
    // 清单）。commands.length===0 时 uniqAll.length===okDrop+failDrop 恒成立
    // （recomposeByChainList 恒非空 + failedPairs 非空已前置校验——不存在 0 候选分支）。
    if (!commands.length) {
      return dec(zh,
        `链清单核对完成：${uniqAll.length} 条候选命令全部与已成功命令重复或与既往失败命令同文（${okDrop} 条成功重复、${failDrop} 条失败同文），无可执行命令——请换一个分析目标，或人工执行 chains list 核验后重试。`,
        `Chain-list check complete: all ${uniqAll.length} candidate commands are duplicates of already-successful commands or prior same-text failures (${okDrop} success duplicates, ${failDrop} failure same-text) — nothing to run. Try a different analysis target, or run chains list manually and retry.`,
        [])
    }
    return dec(zh,
      `已按链清单重组命令（场景可用链：${avail}；无效链已替换为 ${pick}——${commands.length} 条待执行${okDrop > 0 ? `，另有 ${okDrop} 条与已成功命令重复已跳过` : ''}${failDrop > 0 ? `，另有 ${failDrop} 条与既往失败命令同文已跳过` : ''}）。`,
      `Commands recomposed per the chain list (available chains: ${[...available].join(', ')}; invalid chains replaced with ${pick} — ${commands.length} to run${okDrop > 0 ? `, ${okDrop} skipped as duplicates of already-successful commands` : ''}${failDrop > 0 ? `, ${failDrop} skipped as prior same-text failures` : ''}).`,
      commands)
  }

  // 0.5 r106 技能感知分支（先于关键词模板：技能命中时标准流程优先）。commands 按注入段
  //     步骤序回放（示例 PDB ID + 示例链 ID 场景替换）；reply 按【…报告】+ ▌节行固定格式
  //     （章节标签与数值由注入段 + 场景快照驱动——mock 不编造回执类数值）。
  const directive = parseSkillDirective(messages)
  if (directive) {
    const scene = parseSceneFacts(messages)
    const commands = directive.cmds
      .map(c => substituteSceneStructs(c, scene?.structureNames ?? []))
      .map(c => substituteSceneChains(c, scene?.chains ?? []))
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
