'use client'

// 帮助对话框：快捷键、鼠标操作、快速上手
import { MousePointer2, Keyboard, Lightbulb } from 'lucide-react'
import { useMolStore } from '@/lib/molecular/store'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'

const SHORTCUTS: [string, string][] = [
  ['1 – 7', '快速切换风格预设'],
  ['F', '适配视图（缩放到结构）'],
  ['S', '自动旋转 开/关'],
  ['H', '显示/隐藏氢原子'],
  ['W', '显示/隐藏水分子'],
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
  ['双击', '聚焦该残基'],
  ['右键单击', '上下文菜单'],
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
            <h3 className="mb-2 text-xs font-semibold">选择表达式语法</h3>
            <div className="space-y-1 rounded-lg bg-muted/40 p-2.5 font-mono text-[10px] leading-relaxed">
              <div><span className="text-emerald-600 dark:text-emerald-400">chain A</span> and <span className="text-emerald-600 dark:text-emerald-400">resi 40-80</span></div>
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
