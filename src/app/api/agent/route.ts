// AI 助手后端：自然语言 → MolVision 命令（LLM 决策 + 严格 JSON 协议）
// 两种模式：① 对话决策（文本）② 视觉自查（截图 → VLM 审视 → 修正命令）
// 命令参考为独立静态文本（不 import 客户端 commands.ts，服务端零 zustand/three 依赖）
// 供应商可配（设置页）：默认 zai 内置 SDK；其余 OpenAI 兼容端点直连 fetch
import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import ZAI from 'z-ai-web-dev-sdk'
import type { AgentRequestBody, AgentDecision } from '@/lib/molecular/agent/protocol'
import { chatCompletionOnce, chatCompletionStream, getDefaultProviderId, visionWithProvider, type ChatMessage, type ContentPart, type VisionMessage } from '@/lib/molecular/agent/providers'
import { LOCALE_COOKIE, type Locale } from '@/i18n/locales'

/** 请求级语言检测（与 layout 同规则）：cookie > Accept-Language —— 与界面语言保持一致 */
async function detectReqLocale(): Promise<Locale> {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value
  if (stored === 'en' || stored === 'zh') return stored
  const accept = (await headers()).get('accept-language')?.toLowerCase() ?? ''
  return accept.startsWith('en') ? 'en' : 'zh'
}

/** 英文界面时的回复语言指令（附在提示词尾部，recency 最优——覆盖「reply 用中文」默认规则） */
function langDirective(locale: Locale): string {
  return locale === 'en'
    ? '\n\n## Response language (highest priority)\nThe user interface language is English. The "reply" field MUST be written in English (≤80 words). All explanations, questions, and confirmations to the user must be in English. Command strings stay unchanged.'
    : ''
}

/** 服务端错误文案（面向 AgentPanel 错误展示） */
function errText(locale: Locale, zh: string, en: string): string {
  return locale === 'en' ? en : zh
}

/** 命令语法速查（对话与视觉自查两份提示词共用——覆盖应用全部功能） */
const COMMAND_REF = `## 命令速查（全部小写；[sel] 为可选选择表达式，省略时作用于活动结构或当前选择；双软件语法并轨——PyMOL 与 ChimeraX 习惯均直接可用）

## ChimeraX 兼容（与上述 PyMOL 语法可混用）
动词：open <id>（=load） · focus [sel]（=zoom 聚焦） · zoom <纯数字>（倍率语义：zoom 2 = 放大 2 倍） · rotate/translate（=turn/move） · bgcolor <色>（=bg） · silhouettes on|off（=outline） · presets interactive|publication（风格预设） · transparency <0-1>（透明度） · set bgColor|silhouettes（ChimeraX 键名直通） · save image（=png 2） · ~display/~show/~label（取反前缀 → hide/label off） · select add|subtract <expr>（选择修饰） · measure distance <specA> <specB>（无括号形式自动包装）
说明符：/A 链 · :42 残基号 · :HEM 残基名 · @CA 原子名 · #1 模型（拼接即交集：#1/A:42@CA） · & | ~ 与或非 · <spec> zone <Å>（邻域=within） · sel（当前选择） · ions/solvent（离子/溶剂）——选择表达式与作用域动词（show/hide/color/zoom/label）全部接受 ChimeraX 说明符

加载/对象：load <pdb编号>（从 RCSB 加载，如 load 4hhb） · create <名> = <表达式> · split_chains · activate <名|编号>（切换活动结构）
表示法：preset <cartoon|ballstick|spacefill|wireframe|surface|bindingsite|publication|hybrid|putty>（publication=出版级互作一键组合：蛋白 cartoon 链色 + 配体碳鲜绿 + 口袋残基碳按到配体距离紫→粉渐变（N 蓝 O 红 S 黄杂原子元素色，主链+侧链完整残基）+ 配体 6Å 内晶体水小球，自动聚焦口袋，同时清除旧烘焙色；bindingsite=同构元素色版） · show <rep> <sel>（rep 与 sel 用空格或逗号分隔均可：show ballstick, ligand ≡ show ballstick ligand；rep: cartoon/putty/ballstick/sticks/lines/spacefill/surface） · hide <rep|all> <sel> · show hydrogens / hide hydrogens / show waters / hide waters
链隔离（多链蛋白分析单链配体时非常关键——四聚体全景里配体几乎不可见）：isolate <选择>（保留选择所在链、隐藏其余链，如 isolate (resn HEM and chain A) / isolate chain A） · isolate off（恢复全部链） · chains hide A+B / chains show A / chains show all · chains list（列出全部链组及显隐状态）
场景快照（PyMOL 式：视角 + 显示样式一体保存切换，对比 view save 仅存相机）：scene save [名]（快照相机+表示法+链隔离+环境+氢键范围；重名再 save = 更新） · scene <名|序号> / scene recall <名>（整体召回，相机平滑过渡） · scene update [名]（用当前状态覆盖） · scene del <名> · scene next / scene prev（轮播切换） · scene list
着色：color <方案|颜色> <sel>（逗号/空格分隔均可；方案: element/pocket/chain/spectrum/residue/ss/bfactor/sasa/uniform，pocket=口袋专业配色：配体碳鲜绿+残基碳按到配体距离紫→粉渐变+杂原子元素色；或 red/#ff8800） · spectrum count|b, rainbow[, sel]（PyMOL 连续渐变：count=链序 / b=B 因子） · util cbc|cnc|ss|cbss|cbao|cbaw（cbss=SS卡通+配体基色 · cbao=元素+AO立体） · reset_colors · bg <颜色>
选择/统计：select [名=]<表达式> · deselect（清除选中——状态栏/面板/序列条高亮归零，不影响 hbonds in 烘焙范围） · count_atoms [表达式] · iterate (选择), 字段…（打印原子属性：name resn resi chain ss b q elem） · alter (选择), b=表达式 / q=值 / name="…"（修改属性，如 alter (resi 100-110), b=b+10）
视角：zoom <sel>（聚焦选择；zoom ligand, 5 带缓冲Å；zoom in / zoom out 推拉；无参=全量适配） · orient [sel]（PCA 主轴对齐） · view from <sel>（从选择方向观察——口袋开口正对相机、配体在前景，结合位点标准视角；如 view from ligand / view from (resn HEM and chain A)） · turn <x|y|z> <±角度°>（旋转视角：x=俯仰 y=水平方位 z=滚转） · move <x|y|z> <±Å>（平移：x=右 y=上 z=推拉） · view front|back|top|bottom|left|right|x|y|z（正交视角预设） · view save <名> / view go <名> / view list（视角书签）
视觉：set <项> <值>（项: ambient direct fill specular fog fog_strength fov spin_speed transition quick|normal|cinematic quality low|medium|high axes fps seq_focus cap_color cap_shading auto_perf outline outline_strength outline_thickness transparency sphere_scale stick_radius cartoon_width） · spin on|off · rock on|off · slab <nÅ>|off|move <±Å>|center|cap on|off · stereo on|off · ssao on|off [半径Å] [强度]（独立命令，非 set 键） · outline on|off [强度 粗细px] · axes on|off · fps on|off · label on|off（标记当前选择） · show cell / hide cell（晶胞盒线框：a红 b绿 c蓝） · cell on|off（同 show cell） · hbonds on [nÅ]（默认仅选择集范围；无选择时不显示） · hbonds on [nÅ] in <表达式>（烘焙独立范围：不随 deselect 清除、不依赖选择——口袋工作流标准写法 hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water，范围必须含配体本身才能画出配体-残基氢键） · hbonds off · symmetry <Å>|off · map fofc <id>（差值电子密度）
分析：contacts <A> | <B> [nÅ] · interface <链A> <链B> · xcontacts <A>:<expr> | <B>:<expr>（跨结构） · sasa · bsa · xbsa · dssp（重算二级结构） · superpose <名> onto <名> [chain X to Y] · untransform [名]
测量：measure dist (exprA) (exprB) · measure angle (A) (B) (C) · measure dihedral (A) (B) (C) (D) · measure clear（多原子选择距离取最近原子对，角度/二面角取质心最近原子；例：measure dist (resn HEM) (within 5 of resn HEM and protein)）
构象/媒体：morph <名> = <结构A> <结构B> [帧数] · morph multi <名> = <A> <B> <C>… [帧数]（构象插值轨迹） · ensemble play|stop|frame <n> · movie play|stop [smooth|hold] [秒 轮]（smooth=平滑巡航：关键帧间 Catmull-Rom 连续路径速度不归零，录 WebM 必用；hold=逐帧驻留经典模式） · movie smooth|hold（设默认模式） · movie edit（时间轴编排） · record start|stop（录制 WebM）
导出/会话：save <名.pdb> [sel] · png [倍率] · ray [宽px]（Ray 级静帧） · svg [宽px] · session save|export|info
其他：help · history · perf on|off|status · tour stop

## 选择表达式语法
chain A / chainidx 0 / resi 1-60 / resn HEM+ALA / name CA / elem C / id 100-200（PDB 序号） / ss h|s|l（二级结构字母） / b > 50 / q > 0.5（属性比较） / protein / polymer / ligand / water / backbone / sidechain / helix / sheet / not hydrogen / within 5 of (resn HEM) / byres(...) / bychain(...) / A in B / A like B（集合算子）/ sele（当前选择），支持 and or not ( ) 组合；用户用 PyMOL 语法写选择时直接照搬（resn = ALA 的裸等号、逗号分隔均容忍）`

const SYSTEM_PROMPT = `你是 MolVision（Web 端 PyMOL 风格分子可视化工作台）内置的 AI 绘图助手。用户用自然语言描述绘图 / 选择 / 分析 / 测量需求，你把它翻译成该应用支持的命令序列。应用的全部功能都可用命令触达（上方速查即全集）。

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要 markdown 代码块、不要任何其他文字：
{"reply": "<给用户的中文回复>", "commands": ["<命令1>", "<命令2>"]}

${COMMAND_REF}

## 行为规则
1. 命令必须完整、可直接执行、只使用上述语法；不确定时在 reply 中提问并让 commands 为空数组
2. 单次最多 8 条命令，顺序合理（先 select 后 show/color；需要聚焦时收尾 zoom；出版级工作流见规则 16）
3. 纯科普 / 聊天问题（如「什么是 α 螺旋」）commands 为空数组，直接回答
4. reply 用中文、不超过 120 字：说明将执行的操作与理由
5. 「出版级 / 投稿 / 高清图 / 好看」类需求：严格按规则 16 标准流程执行（不要自造参数组合；outline 安全值 1 1.5，不要给 2 2）
6. 破坏性操作（关闭结构、清空场景）不要主动执行；如确需，在 reply 中说明并单独给出一条命令
7. 优先用内联选择表达式（resn HEM、within 5 of (resn HEM)），不要发明场景中不存在的命名选择名；如需命名选择，必须在同一批命令中先用 select <名> = <表达式> 创建
8. 增量调整（「再粗一点 / 再亮一点 / 转慢一点」）：基于场景信息中的「数值参数」当前值计算新值，命令给绝对值（如 outline_thickness 当前 1 → set outline_thickness 2）；幅度适度：单次变化 ≤50%，且灯光类（ambient/direct/fill）不超过 1.5、outline_strength 不超过 3、outline_thickness 不超过 4——过曝比偏暗更糟
9. 测量距离/角度/二面角 → measure 命令；测量结果会在 reply 之后由系统展示，无需再解释数值
10. 构象动画（morph/ensemble/movie/record）与叠合（superpose）等多结构工作流照常支持：先用 load 加载所需构象再执行
11. 灯光语义：ambient/direct/fill 正常值均为 1（环境光含环境贴图贡献）；视觉变化是渐变的——1→1.2 变化轻微，要「明显变亮/变暗」至少 ±0.4；用户反馈「没有变化」时给更大步长（如 1→1.5）而非重复小幅调整
12. 着色与背景搭配：spectrum/bfactor 等渐变着色在纯白背景下对比度低——用户要求「彩虹上色」且背景为白时，可建议同时换深背景（bg black）提升观感；颜色变更 (color) 只影响几何体颜色，背景用 bg
13. ssao 与 outline 是独立命令（ssao on / outline on [强度 粗细]），不是 set 的键；两者可叠加，叠加后画面更重——用户说「太脏/太重」时先关其一
14. 视角控制：聚焦/看XX/转到/俯视/仰视/正视/侧面看/旋转一点/拉近拉远等需求必须用视角命令收尾——zoom <sel>（聚焦）/ zoom in|out（推拉）/ turn <x|y|z> ±°（旋转）/ move <x|y|z> ±Å（平移）/ view front|top|left|right（正交视角）/ view from <sel>（从选择方向观察，口袋正对相机+自适应特写距离，多配体自动挑最近实例）/ orient（主轴对齐）。视角命令可与其他命令自由组合（如 preset bindingsite 后 zoom within 5 of (ligand)）。「结合口袋/互作/配体环境」类任务务必收尾聚焦：zoom within 5 of (ligand) 或 view from ligand——全景视角下配体几乎不可见（场景信息相机行显示全景/中景时必须聚焦）；用户点名特定配体时用 zoom (resn HEM and chain A), 6 或 view from (resn HEM and chain A)。多拷贝选择陷阱：命名选择或 resn 类属性选择常覆盖多个远距拷贝（如血红蛋白 4×HEM 遍布四聚体）——直接 zoom 会把全部拷贝入框、拉远到全景；此时限定单链单实例：zoom (resn HEM and chain A), 6，或改用 view from（自动挑最近实例）。view from 已含自适应特写距离——其后不要对同一多拷贝选择叠加 zoom（会把镜头拉回全景）；需要更近用 zoom in 或 move z -15
15. 链隔离（多链蛋白分析配体/口袋的专业工作流）：同源多聚体（同源二聚体/四聚体如血红蛋白 4HHB、抗体二聚体）或含冗余链的结构中分析单链配体时，背景多余链会喧宾夺主且拥挤。判断依据：场景信息中结构链数 ≥3 条蛋白链（多拷贝同源聚体）且用户分析配体/口袋/互作 → 直接执行 isolate (配体选择)（如 isolate (resn HEM and chain A)，不只在 reply 中提议——PyMOL 用户默认期待隔离后的干净单链口袋，用户不要时 isolate off 一键恢复，reply 中说明这一点）；isolate 保留选择所在链 + 同链配体 + 同链晶体水（口袋结合水跟随保留），隐藏其余链组——水分子也会收缩到单链，不会出现「蛋白单链但水还是四聚体全在」的不一致。配体所在链不确定时先 isolate (resn XXX)（选择所在链自动保留）。注意：isolate 只隐藏链组不删数据，分析类命令（contacts/hbonds/sasa）仍全结构计算；场景信息结构行显示「已隔离」时不要再 isolate（已隔离态）
16. 场景快照（多视角/多风格对比展示）：用户需求含「多个视角」「保存几个角度」「对比展示」「保存显示样式」「后续切回」类诉求 → 用 scene save 落快照而非 view save（view 仅存相机，显示样式丢失；scene 存相机+表示法+链隔离+环境，召回即完整还原）。标准用法：完成第一个满意状态后 scene save <描述名>（如 scene save A链口袋）→ 调整到下一个状态（isolate 链 B / 换 surface 风格 / 换视角）再 scene save <名二>——视口底部场景条会出现缩略图卡片，点击或 scene <名> 一键切换；用户说「切回刚才/回到第一个」时 scene <名> 召回。重名再 save 是更新不是新增（可纠正快照内容）
17. 蛋白+配体混合表示（「蛋白 cartoon 配体球棍」类需求的标准解法）：首选 preset publication（一键：cartoon 链色 + 配体碳鲜绿 + 口袋残基碳按到配体距离紫→粉渐变 + 杂原子元素色 + 完整残基（主链+侧链）+ 口袋水小球 + 自动聚焦——配体分析/互作图标配）；手动分解时蛋白部分 show cartoon, protein（或 polymer），配体部分 show ballstick, ligand，口袋环境必须用 byres 展开完整残基：show ballstick, byres(within 4.5 of (ligand)) and polymer——只用 within 会令侧链残缺（仅距离球内的部分原子，主链断片侧链半个，不专业）。着色同理带选择（color element, ligand）——绝不要 color <方案>, within N of (ligand) 这种写法（会把渐变烘焙进口袋区域，连卡通带一起染花）；已有表示冲突时先 preset <名> 重置再叠加。绝不要 show ballstick 不带选择（作用 all 会盖满蛋白主链，cartoon 就看不见了）；水分子显示用受限范围（show ballstick, water and within 6 of (ligand)）而非全水（全水会把整个晶格的溶剂都画出来）
18. 出版级图标准流程（「出版级/投稿图/高清图/互作图/药物-蛋白结合图/分析结合位点出图/展示口袋」类需求，按此顺序，ray 必须是最后一条）：
   ① contacts ligand | polymer 4.5（互作分析：接触残基与距离输出在控制台，并在分析面板生成可点击的「接触残基对」表格——用户可逐对点击跳转聚焦，reply 中可提示这一点）
   ② preset publication（cartoon 链色 + 配体碳鲜绿 + 口袋残基按到配体距离紫→粉渐变 + 杂原子元素色 + 完整残基主链侧链 + 口袋水小球，已自动聚焦口袋）
   ③ hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water（口袋范围氢键虚线——烘焙独立范围，不依赖选择集；范围必须含配体本身（and not water 而非 and polymer）才能画出配体-残基氢键，如血红素丙酸基-精氨酸盐桥；虚线主要在口袋残基间与配体-残基间，互作图的专业细节）
   ④ view from ligand（口袋正对相机的标准视角，自适应特写距离；多配体结构自动挑选离相机最近的配体实例聚焦，无需手动指定；用户点名特定配体时用 view from (resn XXX and chain A)；其后不要再叠加 zoom <同一多拷贝选择>——会拉回全景，需要更近用 zoom in）
   ⑤ bg white → outline on 0.5 1（出版描边最优值：强度 0.5 · 粗细 1px——实测 VLM 终审 9/10「非常克制、层次分离好」；强度 ≥1 会线稿化、≥2 严重）
   ⑥ deselect（清除选中高亮——状态栏/面板/序列条归零，画面与 UI 双清洁；hbonds in 烘焙范围不受影响）
   ⑦ ray 2400（Ray 级静帧渲染导出 PNG，必须是最后一条命令；用户未指定宽度时 2400；非导图类任务省略本步）
   灯光保持默认 1（已按 ACES 标定，不要动）；ssao 对 cartoon 表示贡献极小，出版图可不加；用户要求额外效果（渐变/表面/雾）时在 ②④ 之间插入对应命令；多链结构（≥3 蛋白链）建议在 ② 前加 isolate (配体选择) 突出单链口袋（rule 15）
19. 场景信息末尾可能附「## 早期对话记忆」（最近窗口之外的早期轮次压缩摘要）。用户说「之前那个/上次的效果/再加点/回到刚才」等指代早期内容时从记忆摘要中找依据；记忆里已成功执行过的操作不要无脑重复——用户要求叠加/增强时，基于场景信息中的「数值参数」当前值做增量调整`

/** 视觉自查提示词（VLM 分支）：审视执行后截图（可选前后对比），判断目标达成度 */
const REVIEW_PROMPT = `你是 MolVision（Web 端 PyMOL 风格分子可视化工作台）的视觉自查模块。用户提出绘图目标，助手已执行若干命令。随消息可能附两张截图：第一张是命令执行【前】、第二张是执行【后】（只附一张时即为执行后状态）。请对比前后并审视，判断目标是否达成并给出结论。

## 输出格式（严格遵守）
只输出一个 JSON 对象，不要 markdown 代码块：
{"reply": "<给用户的中文结论>", "commands": ["<可选的修正命令>"]}

判断标准：
- 已达成：reply 简述你在截图中看到了什么、确认目标达成（≤80 字），commands 为空数组
- 未达成 / 明显可优化：reply 指出具体问题（如结构未聚焦、颜色未生效、配体不可见、背景未变、前后几乎无变化），commands 给出 1-3 条修正命令（必须使用下方命令语法，给绝对值）
- 截图为空场景 / 渲染异常：如实说明并给修复建议
- 【重要】修正纪律——只修有问题的部分，不得摧毁已成功的构图：表示法组合已正确（cartoon 带 + 配体球棍俱在）时绝不 preset 重置、绝不 hide 已生效的表示——只调出问题的参数；outline/ssao 只是参数过猛时降到安全值（outline 1 1.5）而非全关；灯光与聚焦已正确时不动
- 【重要】用户目标含「出版级/图片/导出/渲染图/高清图」且你的修正命令改变了画面 → 最后一条修正命令必须是 ray <宽度px>（沿用场景信息「用户最近执行过的命令」里出现过的宽度，未知则 2400）——修正后不重渲染等于没修复出版图
- 前后对比发现「几乎无变化」而用户目标明确要求变化：优先怀疑幅度不足 → 给更大幅度的绝对值（灯光 ±0.4 以上、粗细 +1px 以上），而不是重复原值
- 修正命令必须参考场景信息中的「数值参数」当前值：当前值已高于你要给的值时不要盲目套用速查表示例（如当前 ambient 1.8 而你打算给 1.2 是变暗不是提亮）；亮度判断看分子本身的可读性与饱和度，不要把深色背景占比误判为「画面过暗」
- 不要吹毛求疵：审美层面的微小瑕疵不构成「未达成」；只在目标明确未实现时给修正命令
- 修正幅度适度：单次变化 ≤50%；灯光 ambient/direct/fill 正常值均为 1，下限 0.3 上限 1.5；outline_strength 上限 3、outline_thickness 上限 4
- 症状速查（看图 → 根因 → 修正，只调最可能的根因参数，1-2 条命令为宜；修正值须相对当前值向上/向下，不要回落到当前值以下）：
  · 白色过曝、细节丢失 → 灯光过高 → set ambient 1 · set direct 1
  · 画面呈线稿感/描边刺目但结构轮廓仍可辨（卡通被黑边吞没、配体残基细节模糊） → outline 过强 → set outline_strength 0.5 · set outline_thickness 1（降到最优值，不要直接关闭——出版图需要克制的细描边做层次分离）
  · 场景过暗发灰 → 灯光过低 → set ambient 1 · set direct 1.2
  · 层次感不足、扁平 → 需要环境光遮蔽 → ssao on（独立命令，非 set 键）
  · 配体/主体太小或未聚焦、画面主体不突出 → view from ligand（自适应特写距离且口袋正对相机，多配体自动挑最近实例）或 zoom within 5 of (ligand)（相机状态见场景信息的「相机」行，全景时必须聚焦）；聚焦特定配体：zoom (resn HEM and chain A), 6
  · 特写/口袋/结合位点类目标的构图判据：配体及其口袋残基球棍集群应占画面 ≥1/3 且口袋开口朝向镜头；配体本体很小、或画面里散布多个球棍口袋集群（四聚体全貌）都算未聚焦——view from ligand（自适应特写距离且口袋正对相机，多配体自动挑最近实例）或 zoom (resn XXX and chain A), 4
  · 配体孤零零没有周围残基环境（出版互作图必须有口袋上下文） → 口袋残基缺失 → show ballstick, byres(within 4.5 of (ligand)) and polymer
  · 口袋残基侧链残缺（原子零散、主链断片、侧链只有几个原子而非完整氨基酸） → 缺 byres 展开 → show ballstick, byres(within 4.5 of (ligand)) and polymer（并 hide ballstick, within 4.5 of (ligand) 移除旧的残缺表示）
  · 需要氢键虚线而图上没有（互作图专业细节） → hbonds on 3.4 in byres(within 4.5 of (ligand)) and not water（烘焙独立范围，不随 deselect 清除；范围含配体本身才能画出配体-残基氢键——写 and polymer 会漏掉）
  · 选中高亮残留（序列条/面板残留选中态，UI 噪声） → deselect（不影响 hbonds in 烘焙范围的氢键）
  · 视角不佳（结构斜置、纵深不清晰、配体被蛋白遮挡、看不到口袋开口） → view from ligand（口袋正对相机；多配体用 view from (resn HEM and chain A)）或 orient / turn y 30（换个角度再看）
  · 蛋白只剩球棍/线框、cartoon 带状丢失 → 表示法叠加冲突（ballstick 盖住 cartoon） → preset publication（一键重建：卡通链色 + 配体鲜绿 + 口袋距离渐变球棍）再 zoom within 5 of (ligand), 6（绝不能 show ballstick 作用 all）
  · 结构完全消失 / 画面大面积空白 / 纯噪点（前后对比确认真空） → 后处理渲染异常 → ssao off · outline off
  · 颜色看不清（白背景下偏淡） → bg 后改深色再观察，或直接说颜色正常仅对比度低 → bg black 或 bg #1a2e35
  · 「恢复正常」类目标 → 灯光回默认（ambient 1 / direct 1 / fill 1），outline_thickness ≤ 2

${COMMAND_REF}`

interface ZAIMessage { role: 'assistant' | 'user'; content: string }

/**
 * 供应商无关的补全抽象：内部按当前默认供应商分派
 * - zai → 内置 SDK（双形态流式/整段）
 * - 其余 → OpenAI 兼容直连（SSE 流式解析与 SDK 同源 data: 行协议）
 * 返回值统一为「完整文本」；onDelta 收到增量时透传（流式模式共用）
 * opts.signal 中止时即刻停止消费上游生成（SDK 路径 cancel reader；直连路径 fetch signal）
 */
async function completeWithProvider(
  messages: ZAIMessage[],
  opts: { onDelta?: (piece: string) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const providerId = getDefaultProviderId()

  if (providerId === 'zai') {
    const zai = await ZAI.create()
    const raw = await zai.chat.completions.create({ messages, stream: true, thinking: { type: 'disabled' } })
    if (raw instanceof ReadableStream || (raw && typeof raw.getReader === 'function')) {
      const reader = (raw as ReadableStream<Uint8Array>).getReader()
      // SDK 不接受 fetch signal——取消传播只能自管：abort 即刻 cancel 上游 reader
      // （打断挂起的 read()，不再消费后续生成），读取循环再逐轮轮询双保险
      const onAbort = () => { void reader.cancel().catch(() => { /* 已结束 */ }) }
      opts.signal?.addEventListener('abort', onAbort)
      try {
        const decoder = new TextDecoder()
        let buf = ''
        let full = ''
        for (;;) {
          if (opts.signal?.aborted) { try { await reader.cancel() } catch { /* 已结束 */ } break }
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          // SSE 行协议：空行分隔事件，data: 前缀承载 JSON（与 OpenAI 兼容端点同构）
          const events = buf.split('\n\n')
          buf = events.pop() ?? ''
          for (const ev of events) {
            for (const line of ev.split('\n')) {
              if (!line.startsWith('data:')) continue
              const payload = line.slice(5).trim()
              if (!payload || payload === '[DONE]') continue
              try {
                const j = JSON.parse(payload) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] }
                const piece = j.choices?.[0]?.delta?.content ?? j.choices?.[0]?.message?.content ?? ''
                if (piece) { full += piece; opts.onDelta?.(piece) }
              } catch { /* 忽略不可解析的分片 */ }
            }
          }
        }
        return full
      } finally {
        opts.signal?.removeEventListener('abort', onAbort)
      }
    }
    // 非流式形态（服务端忽略 stream 参数）：一次性文本，包装为单增量
    const text = (raw as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? ''
    if (text) opts.onDelta?.(text)
    return text
  }

  // OpenAI 兼容直连：系统提示在首位（SDK 习惯用 assistant 位，直连端点要求 system 位）
  const converted: ChatMessage[] = messages.map(m => ({ role: m.role, content: m.content }))
  if (converted.length > 0 && converted[0].role === 'assistant') converted[0].role = 'system'
  if (opts.onDelta) {
    return chatCompletionStream(providerId, converted, { onDelta: opts.onDelta, signal: opts.signal })
  }
  return chatCompletionOnce(providerId, converted, { signal: opts.signal })
}

/** 从 LLM 输出提取 JSON（容忍 ```json 围栏与前后杂讯） */
function extractJson(text: string): { reply?: string; commands?: unknown } | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    return null
  }
}

/** 命令头全集（打捞/白名单用——与服务端命令参考同源静态维护） */
const KNOWN_CMD_HEADS = new Set([
  'load', 'fetch', 'create', 'split_chains', 'splitchains', 'activate', 'use',
  'select', 'sel', 'show', 'display', 'hide', 'undisplay', 'preset', 'style',
  'color', 'colour', 'util', 'reset_colors', 'recolor', 'bg', 'background',
  'zoom', 'fit', 'orient', 'turn', 'move', 'get_view', 'set_view', 'view', 'views', 'bookmark',
  'set', 'spin', 'rock', 'slab', 'stereo', 'axes', 'axis', 'gizmo', 'fps',
  'outline', 'edge', 'ssao', 'ao', 'gtao', 'label',
  'hbonds', 'hbond', 'hbon', 'count_atoms', 'count', 'symmetry', 'symmates',
  'contacts', 'contact', 'clash', 'interface', 'iface',
  'xcontacts', 'xcontact', 'xiface', 'sasa', 'area', 'bsa', 'buried',
  'xbsa', 'xburied', 'dssp', 'secstr',
  'superpose', 'match', 'align', 'mm', 'untransform', 'unpose',
  'measure', 'dist', 'morph', 'movie', 'ensemble', 'ens', 'record', 'rec',
  'map', 'save', 'png', 'ray', 'svg',
  'help', 'history', 'perf', 'session', 'tour', 'demo',
  'close', 'clear', 'reset', 'delete',
  'iterate', 'alter', 'cell', 'spectrum', 'enable', 'disable', 'set_name',
  'isolate', 'chains', 'deselect', 'desel',
])

/** commands 字段兼容：数组或字符串（"set a 1; set b 2" 形式——实测 LLM 偶发用字符串） */
function normalizeCommands(v: unknown): string[] {
  let list: string[] = []
  if (Array.isArray(v)) {
    list = v.filter((c): c is string => typeof c === 'string')
  } else if (typeof v === 'string') {
    list = v.split(/[\n;；]+/)
  } else {
    return []
  }
  return list
    .map(c => c.trim())
    .filter(Boolean)
    .slice(0, 10) // AGENT_CMDS_MAX 硬上限（防 LLM 失控）
    .map(c => c.slice(0, 300))
}

/** 降级兜底：从纯文本回复中打捞命令行（以已知命令头开头的短行） */
function salvageCommands(text: string): string[] {
  const out: string[] = []
  for (const rawLine of text.split(/[\n;；]+/)) {
    const t = rawLine
      .trim()
      .replace(/^[•\-*\d.、)\]]+\s*/, '')
      .replace(/[`*_"'“”]+/g, '')
      .replace(/[.。,，!！?？]+$/, '')
      .trim()
    if (!t || t.length > 120) continue
    const head = t.toLowerCase().split(/\s+/)[0] ?? ''
    if (KNOWN_CMD_HEADS.has(head)) out.push(t)
  }
  return [...new Set(out)].slice(0, 10)
}

/** 校验并规整 LLM 决策 */
function sanitizeDecision(raw: unknown): AgentDecision | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as { reply?: unknown; commands?: unknown }
  if (typeof obj.reply !== 'string' || !obj.reply.trim()) return null
  return { reply: obj.reply.trim().slice(0, 800), commands: normalizeCommands(obj.commands) }
}

/** 场景上下文 + 长期记忆拼接：客户端把滚动窗口（最近 12 条）之外的早期对话压缩为摘要随请求携带。
 *  注入在场景尾部——LLM 能引用早期轮次、避免重复已完成的工作（多步工作流跨窗口衔接）。 */
function sceneWithMemory(scene: string, memory?: string): string {
  const mem = memory?.trim().slice(0, 1500)
  return mem
    ? `${scene}\n\n## 早期对话记忆（最近 12 条之前的压缩摘要；用户可能引用这些早期轮次——已做过的操作不要重复执行）\n${mem}`
    : scene
}

export async function POST(req: Request) {
  const locale = await detectReqLocale()
  let body: AgentRequestBody
  try {
    body = (await req.json()) as AgentRequestBody
  } catch {
    return NextResponse.json({ ok: false, error: errText(locale, '请求体不是合法 JSON', 'Request body is not valid JSON') }, { status: 400 })
  }
  if (!body?.scene) {
    return NextResponse.json({ ok: false, error: errText(locale, '缺少 scene', 'Missing scene') }, { status: 400 })
  }

  // ---------- 视觉自查分支（VLM 看截图，可选前后对比） ----------
  if (body.image && body.goal) {
    try {
      // 视觉消息组装（provider 直连与 ZAI SDK 兜底共用同一份）：assistant 位评审提示词 +
      // user 位多模态内容片（场景/目标文本在前，可选 imageBefore 在中，当前截图在后）
      const imageParts: ContentPart[] = [
        {
          type: 'text',
          text: `用户目标：${body.goal.slice(0, 500)}\n\n【自动注入的当前场景信息】\n${sceneWithMemory(body.scene, body.memory).slice(0, 3600)}`,
        },
      ]
      if (body.imageBefore) imageParts.push({ type: 'image_url', image_url: { url: body.imageBefore } })
      imageParts.push({ type: 'image_url', image_url: { url: body.image } })
      const vlmMessages: VisionMessage[] = [
        { role: 'assistant', content: REVIEW_PROMPT + langDirective(locale) },
        { role: 'user', content: imageParts },
      ]
      let decision: AgentDecision | null = null
      let lastErr = ''
      for (let attempt = 0; attempt < 2 && !decision; attempt++) {
        // 本轮 provider 直连失败信息（回退 ZAI 仍未成功时并入 lastErr 供 502 文案展示）
        let providerErr = ''
        try {
          // provider 视觉分派优先，ZAI 兜底：默认供应商模型具备视觉能力（visionWithProvider
          // 判定）时走 OpenAI 兼容直连多模态补全；null = 无可用视觉 provider（zai 内置 /
          // 模型非视觉）→ 原生 ZAI SDK 视觉通道；throw（直连失败）→ 记入 providerErr 后
          // 同样回退 ZAI——两条路产出统一走 sanitizeDecision 协议解析与降级打捞
          let text: string | null = null
          try {
            text = await visionWithProvider(vlmMessages, { signal: req.signal })
          } catch (e) {
            providerErr = e instanceof Error ? e.message : errText(locale, '视觉供应商调用异常', 'vision provider call failed')
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
          decision = sanitizeDecision(extractJson(text))
          if (decision) break
          const plain = text.trim()
          if (plain.length > 4) {
            // 降级兜底：纯文本当 reply + 从中打捞命令行（可用性优先于严格协议）
            decision = {
              reply: plain.replace(/^```[a-z]*\n?|```$/g, '').trim().slice(0, 800),
              commands: salvageCommands(plain),
            }
            break
          }
          lastErr = 'AI 返回为空'
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'VLM 调用异常'
          // provider 直连曾失败时并列展示（两条通道都倒了才会到这）
          lastErr = providerErr
            ? errText(locale, `视觉供应商直连失败：${providerErr}；ZAI 兜底失败：${msg}`, `Vision provider failed: ${providerErr}; ZAI fallback failed: ${msg}`)
            : msg
        }
      }
      if (!decision) {
        return NextResponse.json({ ok: false, error: errText(locale, `视觉自查失败：${lastErr}`, `Visual review failed: ${lastErr}`) }, { status: 502 })
      }
      return NextResponse.json({ ok: true, decision })
    } catch (e) {
      const msg = e instanceof Error ? e.message : errText(locale, 'VLM 服务异常', 'VLM service error')
      return NextResponse.json({ ok: false, error: msg }, { status: 502 })
    }
  }

  // ---------- 对话决策分支（文本 LLM） ----------
  if (!body?.messages?.length) {
    return NextResponse.json({ ok: false, error: errText(locale, '缺少 messages', 'Missing messages') }, { status: 400 })
  }
  // 历史裁剪：最近 12 条（防上下文超限）
  const history = body.messages.slice(-12)
  const last = history[history.length - 1]
  if (!last || last.role !== 'user') {
    return NextResponse.json({ ok: false, error: errText(locale, '最后一条消息必须是 user', 'The last message must have role "user"') }, { status: 400 })
  }

  // 协议提醒附加在最后一条用户消息（recency 加固——长历史下 LLM 会模仿历史的散文格式而丢掉 JSON 协议，实测捕获）
  const PROTOCOL_SUFFIX = locale === 'en'
    ? '\n\n[System reminder] Your next reply must be ONLY a JSON object: {"reply":"<English reply>","commands":["<command>",...]}. commands is an array of strings (empty [] if no executable commands). Output nothing besides the JSON.'
    : '\n\n【系统提醒】你的下一条回复必须只是一个 JSON 对象：{"reply":"<中文回复>","commands":["<命令>",...]}。commands 是字符串数组（无可执行命令时为 []），不要输出 JSON 以外的任何文字。'

  const messages: ZAIMessage[] = [
    { role: 'assistant', content: SYSTEM_PROMPT + langDirective(locale) },
    // 场景上下文（含长期记忆）以首条 user 消息注入（每次请求都是最新快照）
    { role: 'user', content: `【自动注入的当前场景信息，非用户发言】\n${sceneWithMemory(body.scene, body.memory)}` },
    { role: 'assistant', content: '已了解当前场景。请讲。' },
    ...history.map((m, i) => ({
      role: m.role,
      content: (i === history.length - 1 ? m.content + PROTOCOL_SUFFIX : m.content).slice(0, 2400),
    })),
  ]

  // ---------- 流式模式：SDK stream:true → ReadableStream(SSE) → NDJSON 转发 ----------
  // 事件协议见 protocol.ts AgentStreamEvent；瞬时故障重试（仅在未流出增量时——防内容重复）
  // 取消传播：客户端点「停止」→ fetch abort → req.signal / 下游流 cancel() 双源汇聚到
  // upstreamAbort —— 任一触发即中止上游 LLM 拉取（不再白烧 token 等它自然结束）
  if (body.stream) {
    const encoder = new TextEncoder()
    const upstreamAbort = new AbortController()
    const onReqAbort = () => upstreamAbort.abort()
    if (req.signal.aborted) upstreamAbort.abort()
    else req.signal.addEventListener('abort', onReqAbort)
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (ev: { t: string; [k: string]: unknown }) => {
          try { controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`)) } catch { /* 已中止 */ }
        }
        // controller.close() 幂等包装：cancel 路径与正常收尾共用，重复关闭只吞一次 TypeError
        const close = () => { try { controller.close() } catch { /* 客户端已断开/已关闭 */ } }
        let full = ''
        let decision: AgentDecision | null = null
        let lastErr = ''
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            if (upstreamAbort.signal.aborted) break // 退避等待期间客户端已取消
            try {
              // 供应商无关补全（zai SDK / OpenAI 兼容直连统一分派）；增量逐条转发；
              // signal = req.signal + 本流 cancel() 的汇聚信号——客户端停止即刻传播到上游 fetch
              full = await completeWithProvider(messages, { onDelta: piece => send({ t: 'd', v: piece }), signal: upstreamAbort.signal })
              decision = sanitizeDecision(extractJson(full))
              if (!decision) {
                // 降级兜底：全文当 reply + 打捞命令行（可用性优先于严格协议）
                const plain = full.trim()
                if (plain.length > 4) {
                  decision = { reply: plain.replace(/^```[a-z]*\n?|```$/g, '').trim().slice(0, 800), commands: salvageCommands(plain) }
                }
              }
              if (decision || full.trim().length > 4) break // 有产出即成功
              lastErr = 'AI 返回为空'
            } catch (e) {
              // 区分「客户端主动取消」与「上游错误」：AbortError / 汇聚信号已触发 = 取消
              // ——不重试、不报错（重试只留给限流/网络抖动等瞬时上游故障）
              if (upstreamAbort.signal.aborted || (e instanceof Error && e.name === 'AbortError')) break
              lastErr = e instanceof Error ? e.message : 'LLM 调用异常'
              if (full) break // 已流出内容不重试（重发会重复推送增量）
            }
            // 瞬时故障退避后重试（429 限流窗口显著更长——限流感知退避）
            const isRate = /429|too many|rate.?limit/i.test(lastErr)
            await new Promise(r => setTimeout(r, isRate ? 2500 : 700))
          }
        } catch (e) {
          lastErr = e instanceof Error ? e.message : errText(locale, 'LLM 调用异常', 'LLM call failed')
        }
        if (decision) send({ t: 'end', decision })
        else if (!upstreamAbort.signal.aborted) {
          // 客户端取消不是错误——不再给已断开的下游发 err 事件
          const isRate = /429|too many|rate.?limit/i.test(lastErr)
          send({ t: 'err', error: isRate ? errText(locale, '服务限流中，请稍候片刻再试', 'The service is rate-limited — please retry in a moment') : `${lastErr}${errText(locale, '，请重试或换个说法', ' — please retry or rephrase')}` })
        }
        close()
        req.signal.removeEventListener('abort', onReqAbort)
      },
      // 客户端断开/点「停止」：置中止标志并中止上游（completeWithProvider 内部随即
      // cancel 上游 reader / fetch signal 中止直连流），start() 循环跳出后走幂等 close
      cancel() {
        upstreamAbort.abort()
      },
    })
    return new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' },
    })
  }

  try {
    // 瞬时故障重试一次（LLM 服务偶发超时/格式异常）；供应商无关分派
    let decision: AgentDecision | null = null
    let lastErr = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // 客户端断开传播到上游（非流式模式同样不该继续烧完 LLM 生成）
        const text = await completeWithProvider(messages, { signal: req.signal })
        decision = sanitizeDecision(extractJson(text))
        if (decision) break
        // 降级兜底：LLM 未按 JSON 说话但有实质文本 → 全文当 reply + 打捞命令行（可用性优先于严格协议）
        const plain = text.trim()
        if (plain.length > 4) {
          decision = {
            reply: plain.replace(/^```[a-z]*\n?|```$/g, '').trim().slice(0, 800),
            commands: salvageCommands(plain),
          }
          break
        }
        lastErr = errText(locale, 'AI 返回为空', 'AI returned an empty response')
      } catch (e) {
        // 客户端主动取消（AbortError）不是上游故障：不重试（响应也无人接收）
        if (req.signal.aborted || (e instanceof Error && e.name === 'AbortError')) break
        lastErr = e instanceof Error ? e.message : errText(locale, 'LLM 调用异常', 'LLM call failed')
      }
    }
    if (!decision) {
      return NextResponse.json({ ok: false, error: `${lastErr}${errText(locale, '，请重试或换个说法', ' — please retry or rephrase')}` }, { status: 502 })
    }
    return NextResponse.json({ ok: true, decision })
  } catch (e) {
    const msg = e instanceof Error ? e.message : errText(locale, 'LLM 服务异常', 'LLM service error')
    return NextResponse.json({ ok: false, error: msg }, { status: 502 })
  }
}
