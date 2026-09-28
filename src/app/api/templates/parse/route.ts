// 图片 → 自定义模板解析后端（r79）：VLM 分析用户上传的论文/科研分子图 →
// 输出 FigureTemplate 草案协议（名称/描述/分类/演示结构/命令序列）。
// ─────────────────────────────────────────────────────────────────────────────
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

/** 命令速查（图式配方子集——模板相关动词面；与 template-command-guard 白名单一致） */
const TEMPLATE_CMD_REF = `

${'## 命令速查（全部小写；[sel] 为可选选择表达式）'}
表示法：preset <cartoon|ballstick|spacefill|wireframe|surface|bindingsite|publication|hybrid|putty> · show/hide <rep> [sel]（rep: cartoon/putty/ballstick/sticks/lines/spacefill/surface/spheres/waters/hydrogens/everything） · show sticks, byres(within 4.5 of (ligand)) and polymer（口袋残基完整展开）
着色：spectrum count|b, rainbow[, sel]（N→C 彩虹 / B 因子） · color <element|ss|sasa|chain|residue|bfactor|颜色名|#hex> [sel]（如 color element, ligand / color red, chain A） · util cbc|cnc|ss|cbss|cbao|cbaw（链色/SS 三色/元素） · reset_colors
背景/氛围：bg <white|black|#f5f7fa 等> · outline on|off [强度 粗细px]（出版描边最优 0.5 1） · set ambient|direct|fill|specular|fog|cartoon_width|sphere_scale|stick_radius|transparency <值> · ssao on|off
视角（收尾）：orient（PCA 主轴） · zoom [sel][, 缓冲Å]（zoom (resn HEM and chain A), 6 / zoom in / zoom out） · view front|back|top|bottom|left|right · turn x|y|z ±角度（如 turn y -20） · move x|y|z ±Å · view from ligand（口袋正对相机自适应特写）
选择表达式：chain A / resi 35-52 / resn HEM+ALA / name CA / elem C / protein / polymer / ligand / water / backbone / sidechain / not hydrogen / within 5 of (resn HEM) / byres(...) / and or not ( ) 组合
分析/测量：hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water（口袋氢键虚线） · contacts <A> | <B> [nÅ]（如 contacts ligand | polymer 4.5） · interface A B · measure dist (resi 35 and name OE2) (resi 52 and name OD1)（距离虚线标注） · symmetry <Å> · map fetch <PDB编号>（电子密度） · membrane 34（脂双层板）/ pore（孔道剖面） · dssp
双结构：load <PDB编号> · superpose <mobile> onto <ref> · morph <名> = <A> <B> [帧数] · disable/enable <对象名>（显隐聚焦）
标签：label on|off · deselect`

/** 解析提示词（VLM 分支）：看图 → 六维图式解剖 → 命令序列草案 */
const PARSE_PROMPT = `你是 MolVision（Web 端 PyMOL 风格分子可视化工作台）的论文图式解析模块【论文图模板解析】。用户上传一张论文/科研分子结构图（或截图），你要把它解析成一个可复用的「图式模板」——表示法组合 + 配色 + 视角 + 灯光 + 轮廓的命令序列。

## 分析维度（先在心里逐项判读）
1. 表示法：cartoon（卡通带）/ sticks（球棍）/ spheres（CPK 球）/ surface（表面）/ lines；混合表示（蛋白 cartoon + 配体球棍 + 口袋残基）要分别判读
2. 着色：彩虹渐变（N→C）/ 逐链分色 / 元素色（C 灰 N 蓝 O 红 S 黄）/ 二级结构三色（螺旋红片黄环灰）/ SASA 或静电渐变 / B 因子柔性 / 单色主题（品牌色等）
3. 背景：纯白 / 浅灰 / 深色（黑/深蓝）
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
4. 着色映射：N→C 彩虹 → spectrum count, rainbow；逐链 → util cbc；元素色 → color element；SS 三色 → util ss；SASA 渐变 → color sasa；B 因子 → spectrum b, rainbow；单色 → color <色名>
5. 视角映射：全景 → orient；位点特写 → zoom <口袋选择>, 6 或 preset bindingsite（配体图）；正交 → view front 等；斜侧 → turn y ±20 附近
6. 特写图（口袋/互作）必须以聚焦命令收尾——全景命令会把镜头拉远
7. demo 选代表结构：能认出具体蛋白就选其 PDB（血红蛋白 4HHB / 溶菌酶 1AKI / 肌红蛋白 1MBO / 胰岛素 3INS / Mpro 6LU7 / KcsA 通道 1BL8 / ADK 4AKE / Ras 4Q21 / DNA 复合物 1A3N）；认不出时：膜蛋白/通道图 → 1BL8，DNA/核酸图 → 1A3N，其余 → 4HHB
8. accent 按图主视觉挑：暖色系 rose/amber/orange，冷色系 sky/teal/cyan/violet，中性 slate，绿色主题 emerald/lime
9. 非分子图（截图含 UI 面板/非结构内容）照样解析主视觉；纯非分子图（无任何分子结构可辨）在 analysis 说明并给最接近的基础配方（basic + preset cartoon 起步）
`

/** 英语界面时的输出语言指令（字段文案用英文撰写；命令不变） */
function langDirective(locale: Locale): string {
  return locale === 'en'
    ? '\n\n## Response language (highest priority)\nAll "name/tagline/purpose/tags/analysis" text fields must be written in English. Command strings stay unchanged.'
    : '\n\n## 输出语言（最高优先级）\nname/tagline/purpose/tags/analysis 各字段的 zh 与 en 都要填写（zh 为中文、en 为英文）。命令字符串不变。'
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

  // ---------- 请求体校验 ----------
  let body: { image?: unknown }
  try {
    body = (await req.json()) as { image?: unknown }
  } catch {
    return errText('请求体不是合法 JSON', 'Request body is not valid JSON', 400)
  }
  const image = typeof body.image === 'string' ? body.image : ''
  // dataURL 校验：image/(png|jpeg|webp)；体积 ≤ 5MB（base64 长度折算 ×0.75）
  const m = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(image)
  if (!m) return errText('image 必须是 data:image/(png|jpeg|webp) 的 base64 data URL', 'image must be a base64 data URL of image/(png|jpeg|webp)', 400)
  if (m[2].length * 0.75 > 5 * 1024 * 1024) return errText('图片超过 5MB 上限（前端会缩放，异常直达时拦截）', 'Image exceeds the 5MB limit (the client downscales; direct hits are blocked here)', 413)

  // ---------- VLM 解析（provider 直连优先，ZAI SDK 兜底；2 轮重试） ----------
  const imageParts: ContentPart[] = [
    { type: 'text', text: '【论文图模板解析】请解析这张图片的分子图式，输出模板 JSON 协议。' },
    { type: 'image_url', image_url: { url: image } },
  ]
  const vlmMessages: VisionMessage[] = [
    { role: 'assistant', content: PARSE_PROMPT + TEMPLATE_CMD_REF + langDirective(locale) },
    { role: 'user', content: imageParts },
  ]

  let lastErr = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    let providerErr = ''
    try {
      let text: string | null = null
      try {
        text = await visionWithProvider(vlmMessages, { signal: req.signal, timeoutMs: 90_000 })
      } catch (e) {
        providerErr = e instanceof Error ? e.message : 'vision provider call failed'
      }
      if (text === null) {
        const zai = await ZAI.create()
        const completion = await zai.chat.completions.createVision({
          model: 'glm-4.6v',
          messages: vlmMessages,
          thinking: { type: 'disabled' },
        })
        text = String(completion.choices[0]?.message?.content ?? '')
      }
      const parsed = sanitizeTemplateDraft(extractJsonObject(text))
      if (parsed) {
        return NextResponse.json({ ok: true, draft: parsed.draft, dropped: parsed.dropped })
      }
      // JSON 打捞失败或命令全灭：第一轮继续重试，第二轮放弃
      lastErr = locale === 'en'
        ? 'The model reply contained no usable template (unparseable JSON or fewer than 2 valid commands)'
        : '模型返回无可用的模板（JSON 不可解析或有效命令不足 2 条）'
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'VLM 调用异常'
      lastErr = providerErr
        ? (locale === 'en' ? `Vision provider failed: ${providerErr}; ZAI fallback failed: ${msg}` : `视觉供应商直连失败：${providerErr}；ZAI 兜底失败：${msg}`)
        : msg
    }
  }
  return errText(`图式解析失败：${lastErr}`, `Figure-style parsing failed: ${lastErr}`, 502)
}
