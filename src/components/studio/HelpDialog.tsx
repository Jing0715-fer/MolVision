'use client'

// 帮助对话框：快捷键、鼠标操作、快速上手
import { MousePointer2, Keyboard, Lightbulb, FlaskConical, Wand2 } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

const SHORTCUTS: [string, string][] = [
  ['1 – 7', '快速切换风格预设'],
  ['F', '适配视图（缩放到结构）'],
  ['S', '自动旋转 开/关'],
  ['R', '相机摇摆 开/关（±26°）'],
  ['H', '显示/隐藏氢原子'],
  ['W', '显示/隐藏水分子'],
  ['B', '氢键网络 开/关'],
  ['P', 'NMR 构象动画 播放/暂停'],
  ['L', '为当前选择添加原子标注'],
  ['` / ~', '打开/关闭命令行'],
  ['Esc', '退出测量模式 / 清除选择'],
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
              <li>顶部输入 PDB 编号（如 <code className="rounded bg-muted px-1 font-mono">4HHB</code>）加载结构，或拖入本地文件</li>
              <li>用「风格预设」一键切换 Cartoon / 球棍 / 空间填充 / 表面</li>
              <li>点击 3D 视图中的残基进行选择，在左侧面板调颜色与表示法</li>
              <li>工具栏切换测量模式，点击原子测量距离 / 角度 / 二面角</li>
              <li>按 <kbd className="rounded border border-border bg-muted px-1 font-mono text-[10px]">`</kbd> 打开命令行，像 PyMOL 一样工作</li>
            </ol>
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
              <p><span className="font-semibold text-foreground">叠合</span>：结构卡片 ⧉ 按钮或「叠合 (matchmaker)」面板，支持手动指定链对（<code className="rounded bg-muted px-1 font-mono text-[10px]">superpose 4HHB onto 1A3N chain A to A</code>）；<code className="rounded bg-muted px-1 font-mono text-[10px]">untransform</code> 撤销。</p>
              <p><span className="font-semibold text-foreground">电子密度</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">map fetch 3ekj</code> 从 RCSB 结构因子实时合成 2Fo−Fc 图（模型相位 + 3D FFT）；<code className="rounded bg-muted px-1 font-mono text-[10px]">map isolevel 1.5</code> 调级；也可拖入 .ccp4/.mrc 文件；密度图面板（左侧 🧮）可视化等值面/网格。</p>
              <p><span className="font-semibold text-foreground">对称伴侣</span>：结构面板「对称伴侣」区块或 <code className="rounded bg-muted px-1 font-mono text-[10px]">symmetry 20</code>，按 CRYST1 空间群（65 手性群全覆盖）生成晶格邻居。</p>
              <p><span className="font-semibold text-foreground">界面接触</span>：<code className="rounded bg-muted px-1 font-mono text-[10px]">contacts chain A | chain B</code> 或 <code className="rounded bg-muted px-1 font-mono text-[10px]">interface A B</code>——残基对连线 + 2D 图谱 + ΔSASA 埋藏面积。</p>
              <p><span className="font-semibold text-foreground">跨结构接触</span>：superpose 后用 <code className="rounded bg-muted px-1 font-mono text-[10px]">xcontacts 1UBQ:chain A | 1D3Z:chain A</code> 检测复合物界面。</p>
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
