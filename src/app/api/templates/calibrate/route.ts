// 渲染校准后端（r97）：原图 vs 引擎实际渲染 → VLM 逐维比对 → 修正命令序列。
// ─────────────────────────────────────────────────────────────────────────────
// 「争取准确还原成模板」的闭环最后一环：审核表单里用户不仅能「看效果」（r84
// 对照预览），还能让 AI 自己看两图差距并直接改命令：
//   原图（target，用户上传的论文图）+ 渲染图（render，客户端按当前命令真实
//   渲染后 capture 的视口快照）+ 当前命令序列 → 比对六维（表示法/着色/背景/
//   景别/视角/专业元素）→ 输出修正后的完整命令序列（仍然全部过白名单闸）。
// 与 /api/templates/parse 的两段式第二轮同构：verdict close→原样 / adjusted→
// 采纳修正；任何失败诚实报错（前端显示重试，不静默冒充「已校准」）。
import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import ZAI from 'z-ai-web-dev-sdk'
import { visionWithProvider, type ContentPart, type VisionMessage } from '@/lib/molecular/agent/providers'
import { sanitizeTemplateCommands } from '@/lib/molecular/template-command-guard'
import { LOCALE_COOKIE, type Locale } from '@/i18n/locales'

/** 校准提示词：两图比对 → 六维差异 → 修正完整序列 */
const CALIBRATE_PROMPT = `你是 MolVision（Web 端 PyMOL 风格分子可视化工作台）的「渲染校准」模块【渲染校准】。用户消息里有两张图：第一张是目标原图（target，来自论文/科研figure），第二张是 MolVision 引擎按当前命令序列真实渲染的截图（render）。请逐维比对两图并修正命令序列——目标：用修正后的命令再渲染一次，尽可能接近原图。

## 比对维度（target vs render，逐项写下有实据的差异）
1. 表示法：render 的表示法组合与 target 是否一致（卡通/球棍/球/表面/线/混合——配体棍或口袋残基棍有没有缺）
2. 着色：色相族与渐变方向 / 链色数 / 元素色 / 单色主题（hex 肉眼就近比对）
3. 背景：两图背景色是否一致（render 的背景可直接读出，与 target 比对）
4. 景别：主体占框大小（render 偏大→zoom 0.8 收；偏小→zoom 1.3 放）；聚焦对象选择式是否对（特写图）
5. 视角：旋转差按度估计（±10-40° 量级；输出 turn x/y/z 命令，正负号按 target 相对 render 的旋转方向）
6. 专业元素：target 有而 render 缺的虚线/标签/膜板/密度网格/多拷贝

## 修正规则
- 只修看得到的差异；target 里没有的元素不许加
- 保持惯例顺序：表示法 → 着色 → 环境 → 专业元素 → 视角收尾
- 相机修正用相对命令：zoom 1.2（放大）/ zoom 0.8（缩小）/ turn y -15（绕 y 转 15°）；特写图以聚焦命令收尾
- 修正基于当前命令序列改写（用户消息里给出），不是从零重写；正确的命令原样保留
- 输出完整修正序列（不是增量 patch）；最多 14 条；只用下方速查语法
- 两图已经很接近：verdict 填 "close"，commands 原样返回当前序列

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要 markdown 代码块、不要任何其他文字：
{"verdict": "close|adjusted", "critique": {"zh": "<逐维具体差异与改法，≤100字>", "en": "<≤160字符>"}, "commands": ["<完整修正命令序列>"]}
`

/** 命令速查（与 parse 路由同一份面——模板相关动词面） */
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

function langDirective(locale: Locale): string {
  return locale === 'en'
    ? '\n\n## Response language (highest priority)\nThe "critique" text fields must be written in English. Command strings stay unchanged.'
    : '\n\n## 输出语言（最高优先级）\ncritique 字段的 zh 与 en 都要填写（zh 为中文、en 为英文）。命令字符串不变。'
}

/** 剥 ```json 围栏 + 截取首个平衡 JSON 对象（与 parse 路由同哲学） */
function extractJsonObject(text: string): unknown | null {
  const stripped = text.trim().replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim()
  const start = stripped.indexOf('{')
  if (start < 0) return null
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

function dual(raw: unknown, defZh: string, defEn: string, maxZh: number, maxEn: number): { zh: string; en: string } {
  const src = (raw ?? {}) as { zh?: unknown; en?: unknown }
  const zh = typeof src.zh === 'string' && src.zh.trim() ? src.zh.trim().slice(0, maxZh) : defZh
  const en = typeof src.en === 'string' && src.en.trim() ? src.en.trim().slice(0, maxEn) : defEn
  return { zh, en }
}

/** dataURL 形状校验（image/(png|jpeg|webp) ≤ 5MB） */
const DATAURL_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/

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

  // r98：体积预检先行（与 parse 路由同修——await req.json() 先缓冲后校验的内存炸弹）
  const declaredLen = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declaredLen) && declaredLen > 12 * 1024 * 1024) {
    return errText('请求体超过 12MB 上限（图片应 ≤ 5MB，客户端会缩放）', 'Request body exceeds the 12MB limit (images ≤ 5MB; the client downscales)', 413)
  }

  // ---------- 请求体校验 ----------
  let body: { target?: unknown; render?: unknown; commands?: unknown }
  try {
    body = (await req.json()) as { target?: unknown; render?: unknown; commands?: unknown }
  } catch {
    return errText('请求体不是合法 JSON', 'Request body is not valid JSON', 400)
  }
  const target = typeof body.target === 'string' ? body.target : ''
  const render = typeof body.render === 'string' ? body.render : ''
  const mt = DATAURL_RE.exec(target)
  const mr = DATAURL_RE.exec(render)
  if (!mt || !mr) return errText('target/render 必须是 image/(png|jpeg|webp) 的 base64 data URL', 'target/render must be base64 data URLs of image/(png|jpeg|webp)', 400)
  if (mt[2].length * 0.75 > 5 * 1024 * 1024 || mr[2].length * 0.75 > 5 * 1024 * 1024) {
    return errText('图片超过 5MB 上限（前端已缩放，异常直达时拦截）', 'An image exceeds the 5MB limit (the client downscales; direct hits are blocked here)', 413)
  }
  const commands = Array.isArray(body.commands)
    ? body.commands
        .filter((x): x is string => typeof x === 'string')
        // r98：单条长度上限——旧版仅限条数与类型，单条字符串可携任意长度原文
        // 注入 VLM 提示词（提示词膨胀面 + 成本放大器）
        .map(x => x.slice(0, 200))
        .slice(0, 20)
    : []
  if (commands.length < 1) return errText('commands 不能为空', 'commands must not be empty', 400)
  // r98：用户 commands 服务端先过闸（客户端有预过滤但直连 API 可绕；与 parse
  // 精修轮的 draft1.commands 全过闸对称——提示词面只送合法命令）
  const gated = sanitizeTemplateCommands(commands)
  if (gated.commands.length < 1) return errText('commands 无合法条目', 'commands has no valid entries', 400)
  const cmdSeq = gated.commands

  // ---------- VLM 比对（provider 直连优先，ZAI 兜底；1 次尝试 90s） ----------
  const userParts: ContentPart[] = [
    {
      type: 'text',
      text: `当前命令序列（校准基准）：\n${JSON.stringify(cmdSeq, null, 1)}\n\n第一张图 = 目标原图（target）；第二张图 = 引擎按上述命令的当前渲染（render）。请逐维比对并输出修正后的完整命令序列。`,
    },
    { type: 'image_url', image_url: { url: target } },
    { type: 'image_url', image_url: { url: render } },
  ]
  const messages: VisionMessage[] = [
    { role: 'assistant', content: CALIBRATE_PROMPT + TEMPLATE_CMD_REF + langDirective(locale) },
    { role: 'user', content: userParts },
  ]

  let lastErr = ''
  try {
    let text: string | null = null
    let providerErr = ''
    try {
      text = await visionWithProvider(messages, { signal: req.signal, timeoutMs: 90_000 })
    } catch (e) {
      // r98：客户端已断开不再烧兜底 VLM 轮次（与 parse 同修）
      if (req.signal.aborted) throw new Error('aborted')
      providerErr = e instanceof Error ? e.message : 'vision provider call failed'
    }
    if (text === null) {
      if (req.signal.aborted) throw new Error('aborted')
      const zai = await ZAI.create()
      // r98：SDK createVision 不收 signal/timeout——Promise.race 包同款 90s。
      // r99-main：定时器 clearTimeout（成功路径不再空挂 90s 持 rej 闭包）+ 超时毫秒插值
      const VLM_TIMEOUT_MS = 90_000
      let zaiReject: ((e: Error) => void) | null = null
      const timeoutP = new Promise<never>((_, rej) => { zaiReject = rej })
      const zaiTimer = setTimeout(() => zaiReject?.(new Error(`VLM 兜底调用超时（${VLM_TIMEOUT_MS}ms）`)), VLM_TIMEOUT_MS)
      try {
        const completion = await Promise.race([
          zai.chat.completions.createVision({
            model: 'glm-4.6v',
            messages,
            thinking: { type: 'disabled' },
          }),
          timeoutP,
        ])
        text = String(completion.choices[0]?.message?.content ?? '')
      } finally {
        clearTimeout(zaiTimer)
      }
    }
    const raw = extractJsonObject(text) as Record<string, unknown> | null
    if (!raw) {
      return errText('模型返回不可解析（无 JSON 对象）', 'The model reply contained no parseable JSON object', 502)
    }
    const verdict = raw.verdict === 'close' ? 'close' : raw.verdict === 'adjusted' ? 'adjusted' : null
    if (!verdict) return errText('模型返回的 verdict 不合法', 'The model returned an invalid verdict', 502)
    const { commands: refined, dropped } = sanitizeTemplateCommands(raw.commands)
    if (refined.length < 2) {
      return errText('修正后有效命令不足 2 条（详见剔除明细）', 'Fewer than 2 valid commands after refinement (see dropped list)', 422)
    }
    // r98：对称判定——旧版 refined（已过 normalize：trim/空白折叠/等号剥离）与
    // 原始 commands 比较，`set ambient = 0.4` 回显被归一化成 `set ambient 0.4` 即
    // changed=true，UI 报「N 条新命令」实为语义零变化。两侧同过闸后比较
    const changed = refined.join('\n') !== cmdSeq.join('\n')
    return NextResponse.json({
      ok: true,
      verdict,
      critique: dual(raw.critique, '比对完成。', 'Comparison complete.', 100, 160),
      // close 或无实质变化 → 不给 commands（前端不展示「采纳」）
      commands: verdict === 'adjusted' && changed ? refined.slice(0, 14) : null,
      dropped,
    })
  } catch (e) {
    lastErr = e instanceof Error ? e.message : 'VLM 调用异常'
    return errText(`渲染校准失败：${lastErr}`, `Render calibration failed: ${lastErr}`, 502)
  }
}
