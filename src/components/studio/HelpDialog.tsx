'use client'

// 帮助对话框：快捷键、鼠标操作、快速上手
import type { ReactNode } from 'react'
import { MousePointer2, Keyboard, Lightbulb, FlaskConical, Wand2, GraduationCap, FolderOpen } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

/** 快捷键胶囊统一规格（border-border bg-muted px-1.5 mono 10px，最小宽度保证短键不塌陷） */
function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn(
      'inline-flex min-w-[28px] shrink-0 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[10px]',
      className,
    )}>
      {children}
    </kbd>
  )
}

const SHORTCUTS: [string, string][] = [
  ['1 – 9', '快速切换风格预设（6 = 结合口袋，7 = 出版级互作，9 = Putty B 因子管）'],
  ['F', '适配视图（缩放到结构）'],
  ['S', '自动旋转 开/关'],
  ['R', '相机摇摆 开/关（±26°）'],
  ['H', '显示/隐藏氢原子'],
  ['W', '显示/隐藏水分子'],
  ['B', '氢键网络 开/关'],
  ['P', 'NMR 构象动画 播放/暂停'],
  ['L', '为当前选择添加原子标注'],
  ['V', '保存当前视角为书签（带缩略图）'],
  ['Shift + 1-9', '平滑跳转到视角书签'],
  ['→ / ←', '演示引导中：下一步 / 上一步'],
  ['` / ~', '打开/关闭命令行'],
  ['Ctrl + K', '命令面板：搜索全部命令/最近使用/置顶/结构切换（Enter 执行 · Tab 填入命令行编辑）'],
  ['Ctrl + R', '命令行内反向搜索历史（再按循环下一条，Esc 取出编辑）'],
  ['Esc', '退出测量 / 清除选择 / 结束演示 / 停止 movie / 关闭时间轴'],
  ['Delete', '清除当前选择'],
]

const MOUSE: [string, string][] = [
  ['左键拖动', '旋转视角'],
  ['滚轮', '缩放'],
  ['右键拖动', '平移'],
  ['Ctrl+拖动', '框选（橡胶带：框内可见残基整体选中，不旋转）'],
  ['Ctrl+Shift+拖动', '框选追加到当前选择'],
  ['Ctrl+Alt+拖动', '框选从当前选择移除'],
  ['单击', '选择残基'],
  ['Ctrl + 单击', '选择单个原子'],
  ['Shift + 单击', '追加选择'],
  ['Alt + 单击', '从选择中移除'],
  ['双击', '聚焦残基'],
  ['右键', '上下文菜单（原子/残基/链/同类残基/周围环境 5Å/测距/标注）'],
]

/** PyMOL → MolVision 习惯迁移速查（PyMOL 老用户零成本上手） */
const PYMOL_MAP: [string, string, string][] = [
  ['select / sele', 'select site = within 5 of resn HEM', '选择语法同源：chain/resi/resn/name/elem + and or not；sele = 当前选择；命名选择同 PyMOL 对象语义'],
  ['show / hide', 'show ballstick, ligand · hide cartoon', '逗号语法完全兼容；reps 面板同步可视编辑'],
  ['color / spectrum', 'color element, ligand · spectrum b, rainbow', 'spectrum 连续渐变；color pocket = 配体距离渐变（本工具特色）'],
  ['zoom / orient', 'zoom ligand, 5 · orient', 'zoom 不改写当前选择（与 PyMOL 一致）；带缓冲距离参数'],
  ['iterate / alter', 'iterate (name CA), resn resi b · alter (resi 1-10), b=b+5', '属性查看/修改（b/q/name）；输出到命令行面板'],
  ['util.*', 'util cbc · util cbss · util cbaw', 'cbc 链色 / cbss SS 卡通 / cbao 元素+AO / cbaw 白碳论文图'],
  ['byres / in / like', 'byres(within 5 of ligand) · name CA in chain A', '残基扩展与集合算子同源；bychain/byobject 同可用'],
  ['ss / b / q 谓词', 'ss h+s · b > 50 · q > 0.5', '二级结构/B 因子/占据率比较选择'],
  ['show cell', 'show cell · symmetry 25', '晶胞盒（a红 b绿 c蓝）+ 晶格邻居克隆'],
  ['distance', 'measure dist (resn HEM) (resi 93)', 'PyMOL distance 命令在本工具为 measure（逗号/空格分隔皆可）'],
  ['get_view / set_view', 'get_view · set_view {…}', '视角 JSON 导出/恢复，格式更丰富（含 up/fov）'],
  ['session', 'session save · session export', '会话存档（自动）/ .molvision 文件导出导入'],
  ['ray / png', 'ray 1920 · png 2', 'ray 真超采样软阴影静帧；png 截屏倍率'],
]

/** ChimeraX → MolVision 习惯迁移速查（双软件语法并轨） */
const CHIMERAX_MAP: [string, string, string][] = [
  ['open / close', 'open 4hhb · close', '加载=load · 关闭同义（open 直接可用）'],
  ['说明符 /A :42 :HEM @CA #1', 'select /A:42@CA · show ballstick :HEM zone 5', '链/残基号/残基名/原子/模型五记号，拼接即交集；zone N = 邻域（within）'],
  ['& | ~ 取反', 'select :HEM & /A · ~display cartoon · ~:HEM', '与/或/非与命令取反前缀均支持'],
  ['show atoms|stick|ribbon', 'show atoms, :HEM · show ribbon · hide surfaces', 'ChimeraX 表示名全兼容（atoms→球棍 · ribbon→cartoon · surfaces→表面）'],
  ['color byX 双词', 'color bychain · color byelement, :HEM · color rainbow', 'bychain/byelement/byresidue/byhet/rainbow 全部可用'],
  ['focus / zoom <倍率>', 'focus :HEM · zoom 2', 'focus=聚焦适配 · zoom 纯数字=倍率语义（zoom 2 放大两倍）'],
  ['rotate / translate', 'rotate y 30 · translate z -10', 'turn/move 同义词（ChimeraX 习惯直接用）'],
  ['presets', 'presets interactive · presets publication', '交互预设/出版预设一键切换'],
  ['set bgColor / silhouettes', 'set bgColor black · set silhouettes true', '背景色/轮廓线（ChimeraX 键名直通）'],
  ['transparency', 'transparency 0.6', '透明度（ChimeraX 0-1 语义）'],
  ['select add|subtract', 'select add :42 · select subtract :HEM', '选择修饰动词（追加/移除）'],
  ['measure distance', 'measure distance @CA :42', '无括号形式自动包装（PyMOL 括号形式同样支持）'],
  ['save image', 'save image', '截图导出 PNG（= png 2）'],
  ['sel / zone', 'color red sel · select zone 5', '当前选择 sel（PyMOL sele 同义）· zone 扩展当前选择'],
]

export function HelpDialog() {
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)

  return (
    <Dialog open={ui.helpOpen} onOpenChange={open => setUi({ helpOpen: open })}>
      <DialogContent className="mol-elevate-lg flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="gap-1.5 border-b border-border px-4 pb-2.5 pt-3.5">
          <DialogTitle className="flex items-center gap-2 text-sm">
            使用帮助
            <span className="mol-micro ml-auto mr-9 text-muted-foreground">SHORTCUTS</span>
          </DialogTitle>
          <DialogDescription className="text-xs">MolVision — 基于 Three.js 的专业分子可视化工作台</DialogDescription>
        </DialogHeader>

        <div className="mol-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Lightbulb className="h-3 w-3" /> 快速上手
            </h3>
            <ol className="ml-4 list-decimal space-y-1 text-xs leading-relaxed text-muted-foreground">
              <li>顶部输入 PDB 编号（如 <code className="rounded bg-muted px-1 font-mono text-[10px]">4HHB</code>）加载结构，或拖入本地文件；空状态下也可点击一键示例</li>
              <li>用「风格预设」一键切换 Cartoon / 球棍 / 空间填充 / 表面 / 出版级互作（7）</li>
              <li>点击 3D 视图中的残基进行选择，在左侧面板调颜色与表示法</li>
              <li>工具栏切换测量模式，点击原子测量距离 / 角度 / 二面角</li>
              <li>按 <Kbd>{'`'}</Kbd> 打开命令行，像 PyMOL 一样工作；<span className="font-semibold text-foreground">Tab 智能补全</span>——命令名/子命令/结构名/表示法/颜色/选择关键字全部可补全，↑↓ 切换候选，输入时实时显示参数用法提示</li>
              <li>按 <Kbd>Ctrl+K</Kbd> 打开命令面板——搜索即执行：全部命令（带示例）、最近使用、置顶常用、多结构切换一键直达，无需记命令</li>
            </ol>
            <p className="mt-2 rounded-lg border border-border bg-muted/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <GraduationCap className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-muted-foreground" />
              初次使用？工具栏「演示」菜单提供 6 个引导式场景（快速上手 / 药物靶点 / 晶体学验证 / NMR 动力学 / 抗体-抗原 / 核酸），逐步自动操作并讲解，或命令行 <code className="rounded bg-muted px-1 font-mono text-[10px]">tour quickstart</code>。
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <MousePointer2 className="h-3 w-3" /> 鼠标操作
            </h3>
            <div className="grid gap-1">
              {MOUSE.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 text-xs">
                  <span className="inline-flex w-24 shrink-0 items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 text-center font-mono text-[10px]">{k}</span>
                  <span className="text-muted-foreground">{v}</span>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Wand2 className="h-3 w-3" /> PyMOL 用户速查（习惯迁移）
            </h3>
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              选择语法、命令动词、逗号参数、命名对象语义均与 PyMOL 对齐——熟悉的命令直接输入即可：
            </p>
            <div className="grid gap-1.5">
              {PYMOL_MAP.map(([k, ex, v]) => (
                <div key={k} className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 font-mono font-semibold text-foreground">{k}</span>
                    <code className="min-w-0 truncate font-mono text-[10px] text-primary/90">{ex}</code>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{v}</p>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <FlaskConical className="h-3 w-3" /> ChimeraX 用户速查（双语法并轨）
            </h3>
            <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              原子说明符（/A :42 @CA #1）与 ChimeraX 命令动词直接可用，与 PyMOL 语法可混用：
            </p>
            <div className="grid gap-1.5">
              {CHIMERAX_MAP.map(([k, ex, v]) => (
                <div key={k} className="rounded-lg border border-border bg-muted/30 px-2.5 py-1.5">
                  <div className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 font-mono font-semibold text-foreground">{k}</span>
                    <code className="min-w-0 truncate font-mono text-[10px] text-primary/90">{ex}</code>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{v}</p>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Keyboard className="h-3 w-3" /> 键盘快捷键
            </h3>
            <div className="grid gap-1">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 text-xs">
                  <Kbd className="w-16">{k}</Kbd>
                  <span className="text-muted-foreground">{v}</span>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <FlaskConical className="h-3 w-3" /> 结构分析与晶体学
            </h3>
            <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <p><span className="font-semibold text-foreground">视角书签</span>：快捷键 <code className="rounded bg-muted px-1 font-mono text-[10px]">V</code> 或视口右缘「保存视角」把当前相机状态存为书签（带视口缩略图），<code className="rounded bg-muted px-1 font-mono text-[10px]">Shift+数字</code> / 点击缩略图平滑过渡跳转；命令行 <code className="rounded bg-muted px-1 font-mono text-[10px]">view save 口袋</code>、<code className="rounded bg-muted px-1 font-mono text-[10px]">view 2</code>、<code className="rounded bg-muted px-1 font-mono text-[10px]">view del 2</code>；书签独立持久化（清空结构不清空，刷新后仍在），双击名称可重命名，导出 .molvision 会话文件时随文件携带（导入自动还原）。</p>
              <p><span className="font-semibold text-foreground">叠合</span>：结构卡片「叠合」按钮或「叠合 (matchmaker)」面板，支持手动指定链对（<code className="rounded bg-muted px-1 font-mono text-[10px]">superpose 4HHB onto 1A3N chain A to A</code>）；<code className="rounded bg-muted px-1 font-mono text-[10px]">untransform</code> 撤销；多结构同屏时 <code className="rounded bg-muted px-1 font-mono text-[10px]">activate 1BQL</code> 切换活动结构（show/hide/color 命令的作用对象）。</p>
              <p><span className="font-semibold text-foreground">电子密度</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">map fetch 3ekj</code> 从 RCSB 结构因子实时合成 2Fo−Fc 图（模型相位 + 3D FFT，Web Worker 零阻塞）；<code className="rounded bg-muted px-1 font-mono text-[10px]">map fofc 3ekj</code> 合成 Fo−Fc 差图（正绿/负红双等值面：绿峰=密度有而模型缺、红峰=模型有而密度无）——<span className="text-foreground/70">结构未加载时会自动从 RCSB 获取作为相位模型</span>；<code className="rounded bg-muted px-1 font-mono text-[10px]">map isolevel 1.5</code> 同时调正负峰，差图可 <code className="rounded bg-muted px-1 font-mono text-[10px]">map isolevel pos 3 / neg 2.5</code> 独立调级（面板双滑块同效）；也可拖入 .ccp4/.mrc 文件；密度图面板（左侧「密度图」标签）可视化等值面/网格；σ/模式/颜色随会话保存，刷新自动重算恢复（会话缺结构时同样自动补拉）；加载密度图后，视口左下角出现 σ 控制卡（差图正/负峰双滑块 + 模式切换 + 可见性），视线不离结构即可调级（与面板滑块等效）。</p>
              <p><span className="font-semibold text-foreground">B 因子分析</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">preset putty</code> 或快捷键 9——Putty 管径随 B 因子连续变化（粗=柔性/高 B、细=刚性/低 B）配 B 因子彩虹渐变，蛋白（CA）与核酸（磷酸骨架）统一映射；<code className="rounded bg-muted px-1 font-mono text-[10px]">color bfactor</code> 同款色标；视口左下角自动显示颜色标尺图例（B 值→颜色→管径三联映射）。</p>
              <p><span className="font-semibold text-foreground">对称伴侣</span>：结构面板「对称伴侣」区块或 <code className="rounded bg-muted px-1 font-mono text-[10px]">symmetry 20</code>，按 CRYST1 空间群（65 手性群全覆盖）生成晶格邻居。</p>
              <p><span className="font-semibold text-foreground">界面接触</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">contacts chain A | chain B</code> 或 <code className="rounded bg-muted px-1 font-mono text-[10px]">interface A B</code>——残基对连线 + 2D 图谱 + ΔSASA 埋藏面积；分析面板另有可交互的<span className="font-semibold text-foreground">「接触残基对」表格</span>：按距离/接触数排序、关键字筛选，<span className="font-semibold text-foreground">点击行即选中该残基对并相机聚焦</span>（口袋逐对巡检利器）。</p>
              <p><span className="font-semibold text-foreground">跨结构接触与埋藏面积</span>：superpose 后用 <code className="rounded bg-muted px-1 font-mono text-[10px]">xcontacts 1UBQ:chain A | 1D3Z:chain A</code> 检测复合物界面，再 <code className="rounded bg-muted px-1 font-mono text-[10px]">xbsa</code> 把两结构原子拼成联合坐标集做三路 SASA——游离构象视角的界面埋藏面积，面板可分别选择两侧核心残基。</p>
              <p><span className="font-semibold text-foreground">SASA / DSSP</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">sasa</code> 溶剂可及面积（可 <code className="rounded bg-muted px-1 font-mono text-[10px]">color sasa</code> 暴露度着色）；<code className="rounded bg-muted px-1 font-mono text-[10px]">dssp</code> 重算二级结构。</p>
              <p><span className="font-semibold text-foreground">对象工作流</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">create pocket = within 5 of resn HEM</code> 把选择提升为独立对象；<code className="rounded bg-muted px-1 font-mono text-[10px]">split_chains</code> 按链拆分；<code className="rounded bg-muted px-1 font-mono text-[10px]">save out.pdb chain A</code> 导出坐标。</p>
              <p><span className="font-semibold text-foreground">配体工作流</span>：点击配体 → <span className="font-semibold text-foreground">选中整个分子</span>（连通分量：多残基配体如多糖/肽类抑制剂合并为一，同链其它分子互不波及）；结构面板配体行按分子精确选择、双击聚焦；「口袋」一键选中该配体 4.5Å 结合位点（<code className="rounded bg-muted px-1 font-mono text-[10px]">byres (within 4.5 of resn HEM)</code>）；序列条底部配体行可逐个分子选择/聚焦；右键菜单「选择此分子」/「周围环境」从任意原子出发。</p>
              <p><span className="font-semibold text-foreground">序列条视口聚焦</span>：序列条头部「聚焦」开关（默认开，<code className="rounded bg-muted px-1 font-mono text-[10px]">set seq_focus off</code> 等价）——当前相机视野内的残基显示<span className="font-semibold text-foreground">绿色下划线</span>、头部显示「N/M 在视野」计数、视野外配体淡化；旋转/缩放/切层实时同步（150ms 节流），长序列里快速定位当前观察区域。</p>
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Wand2 className="h-3 w-3" /> 渲染与视图
            </h3>
            <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <p><span className="font-semibold text-foreground">灯光</span>：场景面板「灯光与渲染」或 <code className="rounded bg-muted px-1 font-mono text-[10px]">set ambient 0.5 / set direct 2 / set specular off</code>（哑光论文图风格）。</p>
              <p><span className="font-semibold text-foreground">立体</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">stereo on</code> 红蓝立体（工具栏「立体」按钮）。</p>
              <p><span className="font-semibold text-foreground">坐标轴指示器</span>：视口右上角朝向罗盘（X 红 / Y 绿 / Z 蓝，暗点为负方向）实时反映视角；<span className="font-semibold text-foreground">悬停轴端发光高亮、点击平滑对齐视角</span>（保持目标点与距离）；场景面板或 <code className="rounded bg-muted px-1 font-mono text-[10px]">axes off</code> 可关闭；红蓝立体模式下自动隐藏。</p>
              <p><span className="font-semibold text-foreground">视角</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">orient</code> 主轴对齐；<code className="rounded bg-muted px-1 font-mono text-[10px]">get_view</code> / <code className="rounded bg-muted px-1 font-mono text-[10px]">set_view</code> 视角导出恢复（JSON）；<code className="rounded bg-muted px-1 font-mono text-[10px]">png 4</code> 导出 4× 截图。</p>
              <p><span className="font-semibold text-foreground">Ray 级渲染</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">ray</code> 或工具栏相机菜单「Ray 级渲染」——PCF 软阴影 + 1.5× 内部超采样 + 场景自适应阴影相机，导出高清 PNG（对标 PyMOL ray；<code className="rounded bg-muted px-1 font-mono text-[10px]">ray 1920</code> 指定宽度）。异步执行：先弹进度提示再渲染，完成后 toast 报告尺寸与耗时并自动导出。</p>
              <p><span className="font-semibold text-foreground">构象插值 morph</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">morph m1 = 1BQL 2LYZ 40</code>——两个同源结构间生成插值轨迹对象（自动链配对 + 残基对内原子名匹配 + 内存中叠合，不改动原结构），底部出现构象播放条，<code className="rounded bg-muted px-1 font-mono text-[10px]">ensemble play</code> 播放（P 暂停，fps/loop 可调）；同 PDB 不同构象则按恒等匹配直接插值。默认开启<span className="font-semibold text-foreground">帧精修</span>（rigimol 风格：键长约束松弛 + 长程去碰撞，消除中间帧「橡皮筋抖动」与原子穿插）；加 <code className="rounded bg-muted px-1 font-mono text-[10px]">norefine</code> 保留纯插值。</p>
              <p><span className="font-semibold text-foreground">多态 morph</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">morph multi m = 1BQL 2LYZ 2VB1 60</code>——3–8 个构象态过 Catmull-Rom 样条平滑插值（各态独立叠合到参考位姿，取全部匹配原子交集）；帧滑块可停在任意中间构象，徽章显示「多态 morph · N 态 · M 帧」；同样默认启用帧精修（支持 norefine）。</p>
              <p><span className="font-semibold text-foreground">movie 时间轴编排</span>：工具栏 Film 按钮或 <code className="rounded bg-muted px-1 font-mono text-[10px]">movie edit</code> 打开底部时间轴面板——「同步书签」导入关键帧后可<span className="font-semibold text-foreground">拖拽卡片排序</span>、逐段调时长（0.6–20s）、调轮数、「预览」查看机位；<code className="rounded bg-muted px-1 font-mono text-[10px]">movie play</code>（无秒数参数时）按时间轴逐段巡航，显式秒数则走统一时长模式；时间轴 localStorage 持久化。</p>
              <p><span className="font-semibold text-foreground">movie 录制</span>：时间轴或 <code className="rounded bg-muted px-1 font-mono text-[10px]">movie play</code> 巡航时，先 <code className="rounded bg-muted px-1 font-mono text-[10px]">record start</code> 再播放、结束 <code className="rounded bg-muted px-1 font-mono text-[10px]">record stop</code>，把巡航录成 WebM 视频（对标 PyMOL movie + mpng 工作流）；顶部胶囊显示段进度，拖动/滚轮接管或 Esc 停止。</p>
              <p><span className="font-semibold text-foreground">实用着色</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">util cbc</code> 按链 · <code className="rounded bg-muted px-1 font-mono text-[10px]">util cbaw</code> 元素+白碳（白底论文图） · <code className="rounded bg-muted px-1 font-mono text-[10px]">util ss</code> 二级结构。</p>
              <p><span className="font-semibold text-foreground">轮廓线（描边）</span>：场景面板「轮廓线」区块或 <code className="rounded bg-muted px-1 font-mono text-[10px]">outline on 2 2.5</code>（强度 0.2–3 / 粗细 1–4px）——Sobel 深度+亮度双信号检测边缘，为剪影与层叠结构描出出版级细线（线色随背景亮度自适应）；<code className="rounded bg-muted px-1 font-mono text-[10px]">ray</code> 静帧同样生效；与 GTAO 可叠加。</p>
              <p><span className="font-semibold text-foreground">性能指示器</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">fps on</code> 或场景面板开关——状态栏实时显示帧率/绘制调用/三角形数（500ms 刷新，≥55 绿 · ≥30 琥珀 · &lt;30 红，悬停看帧耗时与 GPU 资源数）；多结构大场景排查卡顿利器。</p>
              <p><span className="font-semibold text-foreground">切层（slab）</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">slab 20</code> 开启视向切层（仅显示沿视线厚度内的分子区域，中心默认在环绕目标处）；<code className="rounded bg-muted px-1 font-mono text-[10px]">slab move -5</code> 沿视线推进切层穿过分子内部（正 = 远离相机）、<code className="rounded bg-muted px-1 font-mono text-[10px]">slab center</code> 回中、<code className="rounded bg-muted px-1 font-mono text-[10px]">slab off</code> 关闭；场景面板「切层」区块同效（厚度/位置双滑块 + 回中按钮）。观察内部口袋、埋藏氢键与配体结合面的利器。</p>
              <p><span className="font-semibold text-foreground">截面封盖（cap）</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">slab cap</code>（默认开，可接 on/off）——剖面以统一平面色填充呈<span className="font-semibold text-foreground">实心</span>（出版级截面图；无封盖时剖面为开放式空壳）；<code className="rounded bg-muted px-1 font-mono text-[10px]">set cap_color slate</code> 或场景面板色块自定义封盖色；对 cartoon/球棍/表面等实体表示全部生效，半透明表面不参与封盖。</p>
              <p><span className="font-semibold text-foreground">封盖深度明暗</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">set cap_shading off</code>（默认开）——封盖色按视深由亮到暗渐变（远端明显加深），深剖面呈现<span className="font-semibold text-foreground">前后层次</span>（四聚体堆叠/多链内部一眼可辨层次关系）；场景面板切层区块「深度明暗」开关同效。</p>
              <p><span className="font-semibold text-foreground">SVG 矢量导出</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">svg</code> 或工具栏相机菜单「SVG 矢量图」——CPU 侧投影当前视角为矢量原语（原子=圆、键=双色圆头线段、cartoon=平滑折线），画家算法按视深排序；颜色/选择/氢水过滤与 3D 视图完全一致，页脚自带结构名+原子数+日期署名；<code className="rounded bg-muted px-1 font-mono text-[10px]">svg 2400</code> 指定宽度（高度按视口纵横比）。SVG 无限缩放不失真，可直接拖入 Illustrator / Inkscape 编辑入稿（表面表示为等值面几何，无原子级原语，导出时自动跳过并提示）。</p>
              <p><span className="font-semibold text-foreground">自动性能模式</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">perf on</code>（默认开）——帧率持续偏低（&lt;15 fps 约 3 秒）时自动关闭后处理并降低分辨率（像素比 ×0.6），帧率恢复后自动还原；降级时状态栏亮起琥珀色「性能」徽章；<code className="rounded bg-muted px-1 font-mono text-[10px]">perf status</code> 查看状态，<code className="rounded bg-muted px-1 font-mono text-[10px]">perf off / perf restore</code> 手动干预；降级期间手动开启后处理会自动交还控制权。</p>
              <p><span className="font-semibold text-foreground">命令行补全</span>：输入时实时弹出候选（命令/子命令/结构名/表示法/颜色方案/选择关键字，带分类图标与说明），<code className="rounded bg-muted px-1 font-mono text-[10px]">Tab</code> 接受选中项、<code className="rounded bg-muted px-1 font-mono text-[10px]">↑↓</code> 切换（弹层开启时优先于历史）、<code className="rounded bg-muted px-1 font-mono text-[10px]">Esc</code> 关闭；识别到命令时上方显示用法提示（描述+示例）；<code className="rounded bg-muted px-1 font-mono text-[10px]">↑↓</code> 在无候选时浏览历史（最近 200 条跨会话保存）。</p>
              <p><span className="font-semibold text-foreground">命令行历史搜索</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">Ctrl+R</code> 进入反向搜索（输入即过滤，提示条预览当前匹配并高亮命中片段），再按 <code className="rounded bg-muted px-1 font-mono text-[10px]">Ctrl+R</code> 或 <code className="rounded bg-muted px-1 font-mono text-[10px]">↑↓</code> 循环下一条、<code className="rounded bg-muted px-1 font-mono text-[10px]">↵</code> 直接执行、<code className="rounded bg-muted px-1 font-mono text-[10px]">Esc</code> 取出到输入行编辑——快速重跑长命令（如 morph / superpose）不用重打。</p>
              <p><span className="font-semibold text-foreground">最近命令徽章</span>：控制台日志区下方的「最近」行展示去重后最近 6 条命令（跨会话持久保存，上限 200 条）——<span className="font-semibold text-foreground">左键直接执行</span>、<span className="font-semibold text-foreground">右键填入输入行</span>修改参数再跑；行尾垃圾桶图标一键清空全部历史。</p>
              <p><span className="font-semibold text-foreground">命令历史面板</span>：控制台头部「历史」按钮或 <code className="rounded bg-muted px-1 font-mono text-[10px]">history</code> 打开——全量历史（新→旧）+ <span className="font-semibold text-foreground">关键词搜索</span>（Enter 直接执行首个匹配）+ <span className="font-semibold text-foreground">星标置顶</span>常用工作流（置顶区置顶展示、清空历史时保留）；每行可点击<span className="font-semibold text-foreground">执行</span>、铅笔<span className="font-semibold text-foreground">填入编辑</span>、复制；与控制台箭头/Ctrl+R 实时同步（同一份 localStorage）。</p>
              <p><span className="font-semibold text-foreground">命令面板（Ctrl+K）</span>：工具栏「命令面板」按钮或快捷键——搜索即执行的统一入口：<span className="font-semibold text-foreground">置顶/最近/结构切换/全部命令</span>四区分组展示；Enter 直接执行（条目内展示将执行的完整示例命令，无意外），Tab 把命令填入控制台继续带补全编辑；多结构场景下「切换到 4HHB」类条目一键切换活动结构。</p>
              <p><span className="font-semibold text-foreground">氢键网络</span>：快捷键 <code className="rounded bg-muted px-1 font-mono text-[10px]">B</code> 或 <code className="rounded bg-muted px-1 font-mono text-[10px]">hbonds on 3.2</code>——供体-受体虚线网络（N/O/S 几何判据：直接成键/1-3 共键邻居/同残基对均已排除）；默认只画虚线，开启「仅选择集」后附带端点小球便于追踪；状态栏徽章可一键关闭；分析面板同步生成<span className="font-semibold text-foreground">「氢键网络 · 残基对」表格</span>（供体→受体、按距离排序、点击行选中并聚焦两侧残基）。<span className="text-foreground/70">分析叠加层不随会话自动恢复，按需重开</span>。</p>
              <p><span className="font-semibold text-foreground">AI 绘图助手</span>：工具栏「AI 助手」按钮打开右侧面板——用自然语言描述需求（如「展示血红素口袋」「出版级渲染」「测一下配体和最近残基的距离」「生成两个构象的插值动画」），AI 自动翻译成 MolVision 命令并执行：<span className="font-semibold text-foreground">全部功能皆可自然语言下达</span>（加载/表示/着色/测量/分析/构象动画/导出）。回复<span className="font-semibold text-foreground">逐字流式生成（打字机效果）</span>，生成中可点发送按钮随时<span className="font-semibold text-foreground">停止</span>（保留已生成部分）；每条命令以<span className="font-semibold text-foreground">卡片</span>展示（状态图标 + 可展开的执行输出 + 重跑按钮）；<span className="font-semibold text-foreground">影响较大的命令（关闭结构/清空场景等）需点「确认执行」</span>；执行失败的命令会<span className="font-semibold text-foreground">自动反馈 AI 修正一轮</span>；对话历史本地持久化（刷新恢复）。命令与命令行同一条执行路径，白名单校验后运行。</p>
              <p><span className="font-semibold text-foreground">视觉自查</span>：助手面板头部 <span className="font-semibold text-foreground">Eye 开关</span>（默认开）——命令执行完毕后自动截图送视觉模型审视渲染结果：达成则以「视觉自查」徽章消息确认；未达标会指出问题并自动给出修正命令执行（不二次自查，防循环）。「看不见效果对不对」类顾虑交给助手自己看。</p>
              <p><span className="font-semibold text-foreground">增量调整</span>：直接说「轮廓再粗一点」「灯光再亮一些」「转慢一点」——助手读取场景中的当前数值参数（轮廓粗细/灯光/FOV/spin 速度等）计算新值下发命令，无需知道原值。</p>
              <p><span className="font-semibold text-foreground">测量命令</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">measure dist (resn HEM) (within 5 of resn HEM and protein)</code>——括号内为任意选择表达式；距离取两组间最近原子对，角度/二面角各组取质心最近原子；结果入 3D 标注与测量面板。<code className="rounded bg-muted px-1 font-mono text-[10px]">measure clear</code> 清除全部。也可用工具栏测量模式点击原子测量。</p>
              <p><span className="font-semibold text-foreground">序列条搜索定位</span>：序列条头部「定位」按钮——输入 <span className="font-semibold text-foreground">残基号（57）</span>、<span className="font-semibold text-foreground">链+号（A57）</span>或<span className="font-semibold text-foreground">配体名（HEM）</span>，Enter 即选中并自动滚动到可见位置（相机不移动；可再双击格子聚焦缩放）。序列格子每 10 位显示序号刻度（Jalview 风格），点击选残基、Shift 加选、Alt 减选、双击聚焦。</p>
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 flex items-center gap-1.5 text-muted-foreground">
              <FolderOpen className="h-3 w-3" /> 会话与文件
            </h3>
            <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <p><span className="font-semibold text-foreground">关闭结构</span>：结构卡片右侧 <span className="font-semibold text-foreground">X 按钮</span>（常显）关闭单个结构，toast 内 8 秒可撤销（表示法/着色/叠合变换/对称伴侣一并还原）；「全部关闭」批量清空（书签与时间轴保留）；命令行 <code className="rounded bg-muted px-1 font-mono text-[10px]">close</code>（活动结构）/ <code className="rounded bg-muted px-1 font-mono text-[10px]">close 4HHB</code> / <code className="rounded bg-muted px-1 font-mono text-[10px]">close all</code>。</p>
              <p><span className="font-semibold text-foreground">保存会话文件</span>：工具栏「会话」菜单 →「保存会话文件」导出 <code className="rounded bg-muted px-1 font-mono text-[10px]">.molvision</code> 文件——含全部结构源文本、表示法、着色、设置、相机视角与视角书签，可跨设备分享；命令行 <code className="rounded bg-muted px-1 font-mono text-[10px]">session export</code>。</p>
              <p><span className="font-semibold text-foreground">打开会话</span>：「会话」菜单 →「打开会话文件」，或直接把 .molvision 文件拖到 3D 视口 / 加载对话框（替换当前场景并自动还原全部状态）。</p>
              <p><span className="font-semibold text-foreground">合并会话</span>：「会话」菜单 →「合并会话文件…」——不清空当前场景，把文件中的结构<span className="font-semibold text-foreground">追加</span>进来（名称冲突自动编号如 4HHB-2；叠合位姿与对称设置保留；命名选择与视角书签追加合并，重名跳过；当前设置/相机/密度图不受影响）。</p>
              <p><span className="font-semibold text-foreground">新建会话</span>：「会话」菜单 →「新建会话」（有结构时二次确认）——清空结构、选择、测量、标签、命名选择、视角书签、movie 时间轴、密度图与本地存档，回到全新状态；录制中会先自动保存已录片段。命令行 <code className="rounded bg-muted px-1 font-mono text-[10px]">session new</code>。</p>
              <p><span className="font-semibold text-foreground">自动存档</span>：结构加载/视图变动自动写入浏览器本地（localStorage），刷新自动恢复；<code className="rounded bg-muted px-1 font-mono text-[10px]">session save / info / clear</code> 手动管理。分析叠加层（氢键网络等）不随自动存档恢复——刷新后是干净的渲染视图，按需重开。</p>
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mol-micro mb-2 text-muted-foreground">选择表达式语法</h3>
            <div className="space-y-1 rounded-lg bg-muted/40 p-2.5 font-mono text-[10px] leading-relaxed">
              <div><span className="text-primary">chain A</span> and <span className="text-primary">resi 40-80</span></div>
              <div><span className="text-primary">chainidx 4</span>  <span className="text-muted-foreground">{'// 第 5 个链组（同链 ID 的蛋白/配体/水互不波及）'}</span></div>
              <div><span className="text-primary">molecule 2</span>  <span className="text-muted-foreground">{'// 第 3 个配体分子（多残基配体整体，别名 mol）'}</span></div>
              <div><span className="text-primary">within 5 of</span> (resn HEM)  <span className="text-muted-foreground">{'// HEM 周围 5 Å'}</span></div>
              <div><span className="text-primary">byres</span>(within 4 of ligand)  <span className="text-muted-foreground">{'// 扩展到整个残基'}</span></div>
              <div>(protein or nucleic) and <span className="text-primary">not helix</span></div>
              <div>name CA+CB · elem Fe · bfactor &gt; 40 · backbone · metal</div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
