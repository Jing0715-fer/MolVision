// 图片 → 自定义模板解析后端（r79 创立 · r97 精度三件套升级）：
// VLM 分析用户上传的论文/科研分子图 → 输出 FigureTemplate 草案协议。
// ─────────────────────────────────────────────────────────────────────────────
// r97 精度升级（用户指令「增加图片解析的能力，争取准确还原成模板」）：
//  ① 客观色彩证据（hints）：客户端 canvas 程序采样（背景色四角众数 + 主色板
//    量子化 top5 + 亮度）随图上行——bg/着色命令不再靠 VLM 目测估色，锚定在
//    程序采样值上（hex 直接注入提示词，可信度高于目测）
//  ② 两段式解析：第一轮「感知+合成」（六维图式解剖 → 命令草案）之后追加
//    第二轮「复检精修」（原图 + 草案回炉 → 逐维对照 → 修正后完整命令序列）。
//    精修失败优雅降级回第一轮草案（refine 字段缺省，UI 不展示自查卡）
//  ③ 响应增加 refine 协议（verdict accurate/adjusted + 双语 critique）——
//    UI 审核表单展示「AI 自查精修」卡（用户看得到改了什么、为何改）
// 供应商分派与 /api/agent 视觉自查同构：默认供应商具备视觉能力时 OpenAI 兼容
// 直连（visionWithProvider），否则/失败时回退 zai 内置 SDK createVision。
// 命令白名单：template-command-guard（纯函数，服务端+客户端共用）——AI 产出
// 每条过闸，剔除附原因回传（UI 透明展示「AI 想执行什么、为何被拦」）；
// 有效命令 < 2 条按打捞失败处理（502 诚实拒绝不可入库空转模板）。
import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import ZAI from 'z-ai-web-dev-sdk'
import { visionWithProvider, type ContentPart, type VisionMessage } from '@/lib/molecular/agent/providers'
import { sanitizeTemplateCommands, type TemplateDraft } from '@/lib/molecular/template-command-guard'
import { LOCALE_COOKIE, type Locale } from '@/i18n/locales'

const CATEGORIES = ['basic', 'surface', 'conform', 'site', 'interaction', 'membrane'] as const
const ACCENTS = ['rose', 'emerald', 'amber', 'sky', 'violet', 'teal', 'orange', 'fuchsia', 'lime', 'cyan', 'slate'] as const

/** r97：客户端程序采样上行的客观色彩证据（防注入：逐字段白名单化） */
interface ImageHints {
  background: string
  backgroundLuma: number
  palette: { hex: string; share: number }[]
  width: number
  height: number
}

const HEX_RE = /^#[0-9a-f]{6}$/

/** hints 防注入清洗：hex 白名单 / 数值 clamp / 数组截断；整体非法 → null（退纯目测） */
function sanitizeHints(raw: unknown): ImageHints | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const background = typeof r.background === 'string' && HEX_RE.test(r.background) ? r.background : null
  const luma = typeof r.backgroundLuma === 'number' && Number.isFinite(r.backgroundLuma)
    ? Math.min(1, Math.max(0, r.backgroundLuma))
    : null
  const paletteRaw = Array.isArray(r.palette) ? r.palette.slice(0, 8) : []
  const palette: { hex: string; share: number }[] = []
  for (const p of paletteRaw) {
    if (!p || typeof p !== 'object') continue
    const { hex, share } = p as { hex?: unknown; share?: unknown }
    if (typeof hex !== 'string' || !HEX_RE.test(hex)) continue
    if (typeof share !== 'number' || !Number.isFinite(share) || share <= 0) continue
    palette.push({ hex, share: Math.min(1, share) })
    if (palette.length >= 5) break
  }
  const width = typeof r.width === 'number' && Number.isFinite(r.width) ? Math.round(r.width) : 0
  const height = typeof r.height === 'number' && Number.isFinite(r.height) ? Math.round(r.height) : 0
  if (!background || luma === null || !palette.length) return null
  return { background, backgroundLuma: luma, palette, width, height }
}

/** 色彩证据 → 提示词注入块（bg 与着色的锚；亮度语境辅助判读深浅底） */
function hintsBlock(h: ImageHints): string {
  const tone = h.backgroundLuma >= 0.72 ? '浅底' : h.backgroundLuma <= 0.28 ? '深底' : '中灰底'
  const pal = h.palette.map(p => `${p.hex}（占 ${(p.share * 100).toFixed(0)}%）`).join(' · ')
  return `

## 客观色彩证据（客户端程序采样——可信度高于目测，必须遵守）
- 图片尺寸：${h.width || '?'}×${h.height || '?'} px
- 背景色（四角+边中采样众数）：${h.background}（亮度 ${(h.backgroundLuma * 100).toFixed(0)}%，${tone}）
- 主色板（降采样量子化 top5，已剔除背景色）：${pal}
- 使用规则：bg 命令的色值必须直接采用背景采样 ${h.background}；主体单色/链主题色的 hex 从主色板就近取值；深底图记得压暗环境光（set ambient 0.4 附近）或保持深底氛围
`
}

/** 命令速查（图式配方子集——模板相关动词面；与 template-command-guard 白名单一致） */
const TEMPLATE_CMD_REF = `

${'## 命令速查（全部小写；[sel] 为可选选择表达式）'}
表示法：preset <cartoon|ballstick|spacefill|wireframe|surface|bindingsite|publication|hybrid|putty> · show/hide <rep> [sel]（rep: cartoon/putty/ballstick/sticks/lines/spacefill/surface/spheres/waters/hydrogens/everything） · show sticks, byres(within 4.5 of (ligand)) and polymer（口袋残基完整展开）
着色：spectrum count|b, rainbow[, sel]（N→C 彩虹 / B 因子） · color <element|ss|sasa|chain|residue|bfactor|颜色名|#hex> [sel]（如 color element, ligand / color red, chain A） · util cbc|cnc|ss|cbss|cbao|cbaw（链色/SS 三色/元素） · reset_colors
背景/氛围：bg <white|black|#f5f7fa 等> · outline on|off [强度 粗细px]（出版描边最优 0.5 1） · set ambient|direct|fill|specular|fog|cartoon_width|sphere_scale|stick_radius|transparency <值> · ssao on|off
视角（收尾）：orient（PCA 主轴） · zoom [sel][, 缓冲Å]（zoom (resn HEM and chain A), 6 / zoom in / zoom out） · view front|back|top|bottom|left|right · turn x|y|z ±角度（如 turn y -20） · move x|y|z ±Å · view from ligand（口袋正对相机自适应特写）
选择表达式：chain A / resi 35-52 / resn HEM+ALA / name CA / elem C / protein / polymer / ligand / water / backbone / sidechain / nucleic / not hydrogen / within 5 of (resn HEM) / byres(...) / and or not ( ) 组合
分析/测量：hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water（口袋氢键虚线） · contacts <A> | <B> [nÅ]（如 contacts ligand | polymer 4.5） · interface A B · measure dist (resi 35 and name OE2) (resi 52 and name OD1)（距离虚线标注） · symmetry <Å> · map fetch <PDB编号>（电子密度） · membrane 34（脂双层板）/ pore（孔道剖面） · dssp
双结构：load <PDB编号> · superpose <mobile> onto <ref> · morph <名> = <A> <B> [帧数] · disable/enable <对象名>（显隐聚焦）
标签：label on|off · deselect`

/** 解析提示词（第一轮：感知+合成）：看图 → 六维图式解剖 → 命令序列草案 */
const PARSE_PROMPT = `你是 MolVision（Web 端 PyMOL 风格分子可视化工作台）的论文图式解析模块【论文图模板解析】。用户上传一张论文/科研分子结构图（或截图），你要把它解析成一个可复用的「图式模板」——表示法组合 + 配色 + 视角 + 灯光 + 轮廓的命令序列。

## 分析维度（先在心里逐项判读，analysis 字段落笔时逐项给出）
1. 表示法：cartoon（卡通带）/ sticks（球棍）/ spheres（CPK 球）/ surface（表面）/ lines；混合表示（蛋白 cartoon + 配体球棍 + 口袋残基）要分别判读
2. 着色：彩虹渐变（N→C）/ 逐链分色 / 元素色（C 灰 N 蓝 O 红 S 黄）/ 二级结构三色（螺旋红片黄环灰）/ SASA 或静电渐变 / B 因子柔性 / 单色主题（品牌色等）——若上方给出了「客观色彩证据」，主题色 hex 以证据为准
3. 背景：以「客观色彩证据」的背景采样为准（浅底/深底/中灰）
4. 轮廓描边：有无、粗细观感
5. 视角：全景（整蛋白占框）/ 位点特写（口袋/活性中心，球棍集群占框）/ 正交视角 / 斜侧角度
6. 专业元素：氢键虚线 / 距离标注 / 残基标签 / 电子密度网格 / 脂双层板 / 多拷贝组装 / 盐桥互作网络

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要 markdown 代码块、不要任何其他文字：
{"name": {"zh": "<模板名≤10字>", "en": "<≤30字符>"}, "tagline": {"zh": "<一句图式描述≤40字>", "en": "<≤80字符>"}, "purpose": {"zh": "<适用场景≤20字>", "en": "<≤40字符>"}, "tags": [{"zh": "<≤6字>", "en": "<≤16字符>"}], "category": "<basic|surface|conform|site|interaction|membrane>", "demo": "<4位PDB编号>", "accent": "<rose|emerald|amber|sky|violet|teal|orange|fuchsia|lime|cyan|slate>", "analysis": {"zh": "<图中看到了什么：表示法/配色/视角/专业元素逐项，≤120字>", "en": "<≤200字符>"}, "commands": ["<命令1>", "<命令2>"]}

## 命令序列规则（commands）
1. 只使用下方速查语法；每条完整可直接执行；最多 12 条
2. 顺序惯例：表示法基座（preset 或 show 组合）→ 着色 → 环境（bg/outline/set）→ 专业元素（hbonds/contacts/measure 等）→ 视角收尾（orient/zoom/view/turn）
3. 表示法映射：卡通带 → preset cartoon；全原子球 → preset spacefill 或 hide everything + show spheres；表面 → preset surface + 着色；蛋白卡通+配体球棍 → preset publication 或 show 组合；线框 → preset wireframe
4. 着色映射：N→C 彩虹 → spectrum count, rainbow；逐链 → util cbc；元素色 → color element；SS 三色 → util ss；SASA 渐变 → color sasa；B 因子 → spectrum b, rainbow；单色 → color <色名或 #hex（有色彩证据时用证据 hex）>
5. 视角映射：全景 → orient；位点特写 → zoom <口袋选择>, 6 或 preset bindingsite（配体图）；正交 → view front 等；斜侧 → turn y ±20 附近
6. 特写图（口袋/互作）必须以聚焦命令收尾——全景命令会把镜头拉远
7. demo 选代表结构：能认出具体蛋白就选其 PDB（血红蛋白 4HHB / 溶菌酶 1AKI / 肌红蛋白 1MBO / 胰岛素 3INS / Mpro 6LU7 / KcsA 通道 1BL8 / ADK 4AKE / Ras 4Q21 / DNA 复合物 1A3N / GFP 1EMA / 核小体 1AOI）；认不出时：膜蛋白/通道图 → 1BL8，DNA/核酸图 → 1A3N，其余 → 4HHB
8. accent 按图主视觉挑：暖色系 rose/amber/orange，冷色系 sky/teal/cyan/violet，中性 slate，绿色主题 emerald/lime
9. 非分子图（截图含 UI 面板/非结构内容）照样解析主视觉；纯非分子图（无任何分子结构可辨）在 analysis 说明并给最接近的基础配方（basic + preset cartoon 起步）
`

/** 复检精修提示词（第二轮）：原图 + 第一轮草案 → 逐维对照 → 修正完整序列 */
const REFINE_PROMPT = `你是 MolVision 图式模板的「复检精修」模块【复检精修】。第一轮解析已从用户上传的原图产出一个命令序列草案（见用户消息）。请对照原图逐维复检该草案，然后输出修正后的完整命令序列——目标：用这套命令在 MolVision 里渲染出来，尽可能还原原图的视觉。

## 复检维度（逐项对照原图与草案，有实据才下笔）
1. 表示法一致吗：草案用的表示法组合 vs 原图实际（混合表示是否漏了配体棍/口袋残基/表面叠加）
2. 着色一致吗：彩虹方向与起止 / 逐链色数 / 元素色 / 单色主题——若有「客观色彩证据」，hex 以证据为准
3. 背景一致吗：bg 命令的色值是否等于证据采样值（或目测底色）
4. 视角与景别一致吗：全景（取景占比）/ 特写（聚焦对象选择式是否合理）/ 斜侧角度（±20° 量级）
5. 专业元素齐吗：原图里的虚线/标签/膜板/密度网格/多拷贝有没有漏；草案里原图没有的有没有多
6. 命令顺序对吗：表示法 → 着色 → 环境 → 专业元素 → 视角收尾；特写图必须以聚焦命令收尾

## 修正规则
- 只修有实据的错，不许无中生有加维度；草案里正确的命令原样保留
- 修正后的序列必须完整可直接执行（不是增量 patch）；最多 14 条
- 只使用下方速查语法
- 若草案已高度准确：verdict 填 "accurate"，commands 原样返回

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要 markdown 代码块、不要任何其他文字：
{"verdict": "accurate|adjusted", "critique": {"zh": "<逐维复检结论：哪些维度通过、改了什么、为何改，≤100字>", "en": "<≤160字符>"}, "commands": ["<完整修正命令序列>"]}
`

/** 英语界面时的输出语言指令（字段文案用英文撰写；命令不变） */
function langDirective(locale: Locale): string {
  return locale === 'en'
    ? '\n\n## Response language (highest priority)\nAll "name/tagline/purpose/tags/analysis/critique" text fields must be written in English. Command strings stay unchanged.'
    : '\n\n## 输出语言（最高优先级）\nname/tagline/purpose/tags/analysis/critique 各字段的 zh 与 en 都要填写（zh 为中文、en 为英文）。命令字符串不变。'
}

/** 剥 ```json 围栏 + 截取首个平衡 JSON 对象（LLM 输出打捞——与 agent 协议同哲学） */
function extractJsonObject(text: string): unknown | null {
  const stripped = text.trim().replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim()
  const start = stripped.indexOf('{')
  if (start < 0) return null
  // 从首个 { 起做括号平衡扫描（字符串字面量内的括号不计数）
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i]
    if (esc) { esc = false; continue }
    if (ch === '\\') { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(stripped.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

/** 双语文段清洗（非法/缺失 → 缺省文案；超长截断） */
function dual(raw: unknown, defZh: string, defEn: string, maxZh: number, maxEn: number): { zh: string; en: string } {
  const src = (raw ?? {}) as { zh?: unknown; en?: unknown }
  const zh = typeof src.zh === 'string' && src.zh.trim() ? src.zh.trim().slice(0, maxZh) : defZh
  const en = typeof src.en === 'string' && src.en.trim() ? src.en.trim().slice(0, maxEn) : defEn
  return { zh, en }
}

/** 草案协议清洗：逐字段校验 + 缺省回填 + 命令过白名单闸。
 *  有效命令 < 2 条 → null（调用方按打捞失败处理）；dropped 剔除明细透传 UI */
function sanitizeTemplateDraft(raw: unknown): { draft: TemplateDraft; dropped: { cmd: string; reason: string }[] } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  // 分类/强调色/demo 枚举校验
  const category = (CATEGORIES as readonly string[]).includes(r.category as string) ? (r.category as TemplateDraft['category']) : 'basic'
  const accent = (ACCENTS as readonly string[]).includes(r.accent as string) ? (r.accent as TemplateDraft['accent']) : 'violet'
  const demoRaw = typeof r.demo === 'string' ? r.demo.trim().toUpperCase() : ''
  const demo = /^[0-9][A-Z0-9]{3}$/.test(demoRaw) ? demoRaw : '4HHB'
  // 标签数组（≤3，双语逐项清洗；全部非法 → 单标签兜底）
  const tagsRaw = Array.isArray(r.tags) ? r.tags.slice(0, 3) : []
  const tags = tagsRaw.map(x => dual(x, '', '', 6, 16)).filter(x => x.zh || x.en)
  const finalTags = tags.length ? tags : [{ zh: '图片解析', en: 'From image' }]
  // 命令过闸
  const { commands, dropped } = sanitizeTemplateCommands(r.commands)
  if (commands.length < 2) return null
  return {
    draft: {
      name: dual(r.name, '图片解析模板', 'Template from image', 10, 30),
      tagline: dual(r.tagline, '从上传图片解析的图式配方', 'Style recipe parsed from the uploaded image', 40, 80),
      purpose: dual(r.purpose, '复现同款视觉风格', 'Reproduce this visual style', 20, 40),
      tags: finalTags,
      category, demo, accent,
      analysis: dual(r.analysis, '未返回解析说明。', 'No analysis returned.', 120, 200),
      commands: commands.slice(0, 14),
    },
    dropped,
  }
}

/** r97：复检精修产物清洗（verdict 枚举 + critique 双语 + 命令过闸）。
 *  命令 < 2 条 → null（视作本轮精修无产出，调用方退回草案一） */
interface RefineResult {
  verdict: 'accurate' | 'adjusted'
  critique: { zh: string; en: string }
  commands: string[]
  dropped: { cmd: string; reason: string }[]
}
function sanitizeRefine(raw: unknown): RefineResult | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const verdict = r.verdict === 'accurate' ? 'accurate' : r.verdict === 'adjusted' ? 'adjusted' : null
  if (!verdict) return null
  const { commands, dropped } = sanitizeTemplateCommands(r.commands)
  if (commands.length < 2) return null
  return {
    verdict,
    critique: dual(r.critique, '复检完成。', 'Re-check complete.', 100, 160),
    commands: commands.slice(0, 14),
    dropped,
  }
}

/** 请求级语言检测（与 /api/agent 同规则） */
async function detectReqLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value
  if (stored === 'en' || stored === 'zh') return stored
  const accept = (await headers()).get('accept-language')?.toLowerCase() ?? ''
  return accept.startsWith('en') ? 'en' : 'zh'
}

export async function POST(req: Request) {
  const locale = await detectReqLocale()
  const errText = (zh: string, en: string, status: number) =>
    NextResponse.json({ ok: false, error: locale === 'en' ? en : zh }, { status })

  // r98：体积预检先行——旧版 await req.json() 把任意大小 body 完整缓冲进内存后
  // 才校验 5MB 上限（App Router route handler 无框架级 body 上限，直连数百 MB
  // JSON 即可打内存）。content-length 头在解析前可得，异常直达直接拒
  const declaredLen = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLen) && declaredLen > 12 * 1024 * 1024) {
    return errText('请求体超过 12MB 上限（图片应 ≤ 5MB，客户端会缩放）', 'Request body exceeds the 12MB limit (image ≤ 5MB; the client downscales)', 413)
  }

  // ---------- 请求体校验 ----------
  let body: { image?: unknown; hints?: unknown }
  try {
    body = (await req.json()) as { image?: unknown; hints?: unknown }
  } catch {
    return errText('请求体不是合法 JSON', 'Request body is not valid JSON', 400)
  }
  const image = typeof body.image === 'string' ? body.image : ''
  // dataURL 校验：image/(png|jpeg|webp)；体积 ≤ 5MB（base64 长度折算 ×0.75）
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image)
  if (!m) return errText('image 必须是 data:image/(png|jpeg|webp) 的 base64 data URL', 'image must be a base64 data URL of image/(png|jpeg|webp)', 400)
  if (m[2].length * 0.75 > 5 * 1024 * 1024) return errText('图片超过 5MB 上限（前端会缩放，异常直达时拦截）', 'Image exceeds the 5MB limit (the client downscales; direct hits are blocked here)', 413)
  // r97 色彩证据（可选；非法整体丢弃退纯目测）
  const hints = sanitizeHints(body.hints)
  const evidence = hints ? hintsBlock(hints) : ''

  // ---------- VLM 调用小汇（provider 直连优先，ZAI SDK 兜底） ----------
  // r98：兜底路径三修——①SDK createVision 不收 signal/timeout（类型就是裸 Promise），
  // 上游挂起时整个解析无限挂起；②客户端已断开（req.signal aborted）时不再烧 VLM
  // 轮次（provider 路径抛 AbortError 落 catch 后旧版仍继续走兜底）；③复用同一超时
  const callVision = async (messages: VisionMessage[], timeoutMs: number): Promise<string> => {
    let providerErr = ''
    try {
      const text = await visionWithProvider(messages, { signal: req.signal, timeoutMs })
      if (text !== null) return text
    } catch (e) {
      // 客户端主动取消：不再进入兜底（为已断开的连接烧 VLM 轮次无意义）
      if (req.signal.aborted) throw new Error('aborted')
      providerErr = e instanceof Error ? e.message : 'vision provider call failed'
    }
    if (req.signal.aborted) throw new Error('aborted')
    const zai = await ZAI.create()
    try {
      const completion = await Promise.race([
        zai.chat.completions.createVision({
          model: 'glm-4.6v',
          messages,
          thinking: { type: 'disabled' },
        }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`VLM 兜底调用超时（${timeoutMs}ms）`)), timeoutMs)),
      ])
      return String(completion.choices[0]?.message?.content ?? '')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'VLM 调用异常'
      throw new Error(providerErr ? `${providerErr}; ${msg}` : msg)
    }
  }

  // ---------- 第一轮：感知 + 合成（2 次重试） ----------
  const imageParts: ContentPart[] = [
    { type: 'text', text: '【论文图模板解析】请解析这张图片的分子图式，输出模板 JSON 协议。' },
    { type: 'image_url', image_url: { url: image } },
  ]
  const parseMessages: VisionMessage[] = [
    { role: 'assistant', content: PARSE_PROMPT + evidence + TEMPLATE_CMD_REF + langDirective(locale) },
    { role: 'user', content: imageParts },
  ]

  let draft1: TemplateDraft | null = null
  let droppedAll: { cmd: string; reason: string }[] = []
  let lastErr = ''
  for (let attempt = 0; attempt < 2 && !draft1; attempt++) {
    try {
      const text = await callVision(parseMessages, 90_000)
      const parsed = sanitizeTemplateDraft(extractJsonObject(text))
      if (parsed) {
        draft1 = parsed.draft
        droppedAll = parsed.dropped
      } else {
        lastErr = locale === 'en'
          ? 'The model reply contained no usable template (unparseable JSON or fewer than 2 valid commands)'
          : '模型返回无可用的模板（JSON 不可解析或有效命令不足 2 条）'
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'VLM 调用异常'
    }
  }
  if (!draft1) {
    return errText(`图式解析失败：${lastErr}`, `Figure-style parsing failed: ${lastErr}`, 502)
  }

  // ---------- 第二轮：复检精修（1 次尝试；任何失败优雅降级回草案一） ----------
  let refine: { applied: boolean; verdict: 'accurate' | 'adjusted'; critique: { zh: string; en: string } } | null = null
  let finalDraft = draft1
  try {
    const refineMessages: VisionMessage[] = [
      {
        role: 'assistant',
        content: REFINE_PROMPT + evidence + TEMPLATE_CMD_REF + langDirective(locale),
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `第一轮草案命令序列：\n${JSON.stringify(draft1.commands, null, 1)}\n\n请对照上传的原图逐维复检上述草案，输出修正后的完整命令序列。`,
          },
          { type: 'image_url', image_url: { url: image } },
        ] as ContentPart[],
      },
    ]
    const text2 = await callVision(refineMessages, 90_000)
    const refined = sanitizeRefine(extractJsonObject(text2))
    if (refined) {
      droppedAll = [...droppedAll, ...refined.dropped]
      // adjusted 且命令有实质变化 → 采纳精修序列；accurate → 保留草案一（防降级改写）
      const changed = refined.verdict === 'adjusted' && refined.commands.join('\n') !== draft1.commands.join('\n')
      if (changed) finalDraft = { ...draft1, commands: refined.commands }
      refine = {
        applied: changed,
        verdict: refined.verdict,
        critique: refined.critique,
      }
    }
  } catch {
    // 精修是增益不是依赖：静默降级（refine 缺省，UI 不展示自查卡）
  }

  return NextResponse.json({ ok: true, draft: finalDraft, dropped: droppedAll, refine })
}
