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
