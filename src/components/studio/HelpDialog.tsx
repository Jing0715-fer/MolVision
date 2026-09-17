'use client'

// 帮助对话框：快捷键、鼠标操作、快速上手
import { MousePointer2, Keyboard, Lightbulb, FlaskConical, Wand2, GraduationCap } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

const SHORTCUTS: [string, string][] = [
  ['1 – 8', '快速切换风格预设（8 = Putty B 因子管，蛋白+核酸全覆盖）'],
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
  ['Esc', '退出测量模式 / 清除选择 / 结束演示'],
  ['Delete', '清除当前选择'],
]

const MOUSE: [string, string][] = [
  ['左键拖动', '旋转视角'],
  ['滚轮', '缩放'],
  ['右键拖动', '平移'],
  ['单击', '选择残基'],
  ['Ctrl + 单击', '选择单个原子'],
  ['Shift + 单击', '追加选择'],
  ['Alt + 单击', '从选择中移除'],
  ['双击', '聚焦残基'],
  ['右键', '上下文菜单（原子/残基/链/同类残基/周围环境 5Å/测距/标注）'],
]

export function HelpDialog() {
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)

  return (
    <Dialog open={ui.helpOpen} onOpenChange={open => setUi({ helpOpen: open })}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>使用帮助</DialogTitle>
          <DialogDescription>MolVision — 基于 Three.js 的专业分子可视化工作台</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Lightbulb className="h-3.5 w-3.5 text-amber-500" /> 快速上手
            </h3>
            <ol className="ml-4 list-decimal space-y-1 text-xs leading-relaxed text-muted-foreground">
              <li>顶部输入 PDB 编号（如 <code className="rounded bg-muted px-1 font-mono">4HHB</code>）加载结构，或拖入本地文件；空状态下也可点击一键示例</li>
              <li>用「风格预设」一键切换 Cartoon / 球棍 / 空间填充 / 表面</li>
              <li>点击 3D 视图中的残基进行选择，在左侧面板调颜色与表示法</li>
              <li>工具栏切换测量模式，点击原子测量距离 / 角度 / 二面角</li>
              <li>按 <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">`</kbd> 打开命令行，像 PyMOL 一样工作</li>
            </ol>
            <p className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2.5 py-2 text-[11px] leading-relaxed text-violet-700 dark:text-violet-300">
              <GraduationCap className="mr-1 inline h-3.5 w-3.5 -translate-y-px" />
              初次使用？工具栏「演示」菜单提供 6 个引导式场景（快速上手 / 药物靶点 / 晶体学验证 / NMR 动力学 / 抗体-抗原 / 核酸），逐步自动操作并讲解，或命令行 <code className="rounded bg-muted px-1 font-mono text-[10px]">tour quickstart</code>。
            </p>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <MousePointer2 className="h-3.5 w-3.5 text-emerald-500" /> 鼠标操作
            </h3>
            <div className="grid gap-1">
              {MOUSE.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 text-xs">
                  <span className="w-24 shrink-0 rounded border border-border/60 bg-muted/60 px-1.5 py-0.5 text-center font-mono text-[10px]">{k}</span>
                  <span className="text-muted-foreground">{v}</span>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Keyboard className="h-3.5 w-3.5 text-primary" /> 键盘快捷键
            </h3>
            <div className="grid gap-1">
              {SHORTCUTS.map(([k, v]) => (
                <div key={k} className="flex items-center gap-3 text-xs">
                  <kbd className="w-16 shrink-0 rounded border border-border/60 bg-muted/60 px-1.5 py-0.5 text-center font-mono text-[10px]">{k}</kbd>
                  <span className="text-muted-foreground">{v}</span>
                </div>
              ))}
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <FlaskConical className="h-3.5 w-3.5 text-violet-500" /> 结构分析与晶体学
            </h3>
            <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <p><span className="font-semibold text-foreground">视角书签</span>：快捷键 <code className="rounded bg-muted px-1 font-mono text-[10px]">V</code> 或视口右缘「保存视角」把当前相机状态存为书签（带视口缩略图），<code className="rounded bg-muted px-1 font-mono text-[10px]">Shift+数字</code> / 点击缩略图平滑过渡跳转；命令行 <code className="rounded bg-muted px-1 font-mono text-[10px]">view save 口袋</code>、<code className="rounded bg-muted px-1 font-mono text-[10px]">view 2</code>、<code className="rounded bg-muted px-1 font-mono text-[10px]">view del 2</code>；书签独立持久化（清空结构不清空，刷新后仍在），双击名称可重命名，导出 .molvision 会话文件时随文件携带（导入自动还原）。</p>
              <p><span className="font-semibold text-foreground">叠合</span>：结构卡片 ⧉ 按钮或「叠合 (matchmaker)」面板，支持手动指定链对（<code className="rounded bg-muted px-1 font-mono text-[10px]">superpose 4HHB onto 1A3N chain A to A</code>）；<code className="rounded bg-muted px-1 font-mono text-[10px]">untransform</code> 撤销；多结构同屏时 <code className="rounded bg-muted px-1 font-mono text-[10px]">activate 1BQL</code> 切换活动结构（show/hide/color 命令的作用对象）。</p>
              <p><span className="font-semibold text-foreground">电子密度</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">map fetch 3ekj</code> 从 RCSB 结构因子实时合成 2Fo−Fc 图（模型相位 + 3D FFT，Web Worker 零阻塞）；<code className="rounded bg-muted px-1 font-mono text-[10px]">map fofc 3ekj</code> 合成 Fo−Fc 差图（正绿/负红双等值面：绿峰=密度有而模型缺、红峰=模型有而密度无）——<span className="text-foreground/70">结构未加载时会自动从 RCSB 获取作为相位模型</span>；<code className="rounded bg-muted px-1 font-mono text-[10px]">map isolevel 1.5</code> 同时调正负峰，差图可 <code className="rounded bg-muted px-1 font-mono text-[10px]">map isolevel pos 3 / neg 2.5</code> 独立调级（面板双滑块同效）；也可拖入 .ccp4/.mrc 文件；密度图面板（左侧 🧮）可视化等值面/网格；σ/模式/颜色随会话保存，刷新自动重算恢复（会话缺结构时同样自动补拉）；加载密度图后，视口左下角出现 σ 控制卡（差图正/负峰双滑块 + 模式切换 + 可见性），视线不离结构即可调级（与面板滑块等效）。</p>
              <p><span className="font-semibold text-foreground">B 因子分析</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">preset putty</code> 或快捷键 8——Putty 管径随 B 因子连续变化（粗=柔性/高 B、细=刚性/低 B）配 B 因子彩虹渐变，蛋白（CA）与核酸（磷酸骨架）统一映射；<code className="rounded bg-muted px-1 font-mono text-[10px]">color bfactor</code> 同款色标；视口左下角自动显示颜色标尺图例（B 值→颜色→管径三联映射）。</p>
              <p><span className="font-semibold text-foreground">对称伴侣</span>：结构面板「对称伴侣」区块或 <code className="rounded bg-muted px-1 font-mono text-[10px]">symmetry 20</code>，按 CRYST1 空间群（65 手性群全覆盖）生成晶格邻居。</p>
              <p><span className="font-semibold text-foreground">界面接触</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">contacts chain A | chain B</code> 或 <code className="rounded bg-muted px-1 font-mono text-[10px]">interface A B</code>——残基对连线 + 2D 图谱 + ΔSASA 埋藏面积。</p>
              <p><span className="font-semibold text-foreground">跨结构接触与埋藏面积</span>：superpose 后用 <code className="rounded bg-muted px-1 font-mono text-[10px]">xcontacts 1UBQ:chain A | 1D3Z:chain A</code> 检测复合物界面，再 <code className="rounded bg-muted px-1 font-mono text-[10px]">xbsa</code> 把两结构原子拼成联合坐标集做三路 SASA——游离构象视角的界面埋藏面积，面板可分别选择两侧核心残基。</p>
              <p><span className="font-semibold text-foreground">SASA / DSSP</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">sasa</code> 溶剂可及面积（可 <code className="rounded bg-muted px-1 font-mono text-[10px]">color sasa</code> 暴露度着色）；<code className="rounded bg-muted px-1 font-mono text-[10px]">dssp</code> 重算二级结构。</p>
              <p><span className="font-semibold text-foreground">对象工作流</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">create pocket = within 5 of resn HEM</code> 把选择提升为独立对象；<code className="rounded bg-muted px-1 font-mono text-[10px]">split_chains</code> 按链拆分；<code className="rounded bg-muted px-1 font-mono text-[10px]">save out.pdb chain A</code> 导出坐标。</p>
              <p><span className="font-semibold text-foreground">配体工作流</span>：结构面板配体行 →「口袋」一键选中该配体 4.5Å 结合位点（<code className="rounded bg-muted px-1 font-mono text-[10px]">byres (within 4.5 of resn HEM)</code>）；序列条底部配体行可逐个分子选择/聚焦；右键菜单「周围环境」从任意原子出发。</p>
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
              <Wand2 className="h-3.5 w-3.5 text-sky-500" /> 渲染与视图
            </h3>
            <div className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <p><span className="font-semibold text-foreground">灯光</span>：场景面板「灯光与渲染」或 <code className="rounded bg-muted px-1 font-mono text-[10px]">set ambient 0.5 / set direct 2 / set specular off</code>（哑光论文图风格）。</p>
              <p><span className="font-semibold text-foreground">立体</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">stereo on</code> 红蓝立体（工具栏 👓）。</p>
              <p><span className="font-semibold text-foreground">视角</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">orient</code> 主轴对齐；<code className="rounded bg-muted px-1 font-mono text-[10px]">get_view</code> / <code className="rounded bg-muted px-1 font-mono text-[10px]">set_view</code> 视角导出恢复（JSON）；<code className="rounded bg-muted px-1 font-mono text-[10px]">png 4</code> 导出 4× 截图。</p>
              <p><span className="font-semibold text-foreground">Ray 级渲染</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">ray</code> 或工具栏相机菜单「Ray 级渲染」——PCF 软阴影 + 1.5× 内部超采样 + 场景自适应阴影相机，导出高清 PNG（对标 PyMOL ray；<code className="rounded bg-muted px-1 font-mono text-[10px]">ray 1920</code> 指定宽度）。同步渲染，大场景可能阻塞数秒。</p>
              <p><span className="font-semibold text-foreground">实用着色</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">util cbc</code> 按链 · <code className="rounded bg-muted px-1 font-mono text-[10px]">util cbaw</code> 元素+白碳（白底论文图） · <code className="rounded bg-muted px-1 font-mono text-[10px]">util ss</code> 二级结构。</p>
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="mb-2 text-xs font-semibold">选择表达式语法</h3>
            <div className="space-y-1 rounded-lg bg-muted/40 p-2.5 font-mono text-[10px] leading-relaxed">
              <div><span className="text-emerald-600 dark:text-emerald-400">chain A</span> and <span className="text-emerald-600 dark:text-emerald-400">resi 40-80</span></div>
              <div><span className="text-emerald-600 dark:text-emerald-400">chainidx 4</span>  <span className="text-muted-foreground">{'// 第 5 个链组（同链 ID 的蛋白/配体/水互不波及）'}</span></div>
              <div><span className="text-emerald-600 dark:text-emerald-400">within 5 of</span> (resn HEM)  <span className="text-muted-foreground">{'// HEM 周围 5 Å'}</span></div>
              <div><span className="text-emerald-600 dark:text-emerald-400">byres</span>(within 4 of ligand)  <span className="text-muted-foreground">{'// 扩展到整个残基'}</span></div>
              <div>(protein or nucleic) and <span className="text-emerald-600 dark:text-emerald-400">not helix</span></div>
              <div>name CA+CB · elem Fe · bfactor &gt; 40 · backbone · metal</div>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
