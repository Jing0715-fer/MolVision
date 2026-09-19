'use client'

// 选择面板：表达式输入、快捷选择、当前选择统计、命名选择、标注
import { useState } from 'react'
import { Crosshair, BookmarkPlus, Trash2, Tag, Target, X } from 'lucide-react'
import { toast } from 'sonner'
import { engineRef, dataRegistry, useMolStore } from '@/lib/molecular/store'
import { maskToIndices, evaluateSelection, PRESET_SELECTIONS } from '@/lib/molecular/selection'
import { buildNamedMasks } from '@/lib/molecular/store'
import { cn } from '@/lib/utils'
import { SectionTitle, PanelHint } from '../LeftPanel'
import { Input } from '@/components/ui/input'

const QUICK_EXPRS: { expr: string; label: string }[] = [
  { expr: 'all', label: '全部' },
  { expr: 'protein', label: '蛋白' },
  { expr: 'nucleic', label: '核酸' },
  { expr: 'ligand', label: '配体' },
  { expr: 'water', label: '水' },
  { expr: 'metal', label: '金属' },
  { expr: 'backbone', label: '主链' },
  { expr: 'sidechain', label: '侧链' },
  { expr: 'helix', label: '螺旋' },
  { expr: 'sheet', label: '折叠' },
]

export function SelectionPanel() {
  const [expr, setExpr] = useState('')
  const [name, setName] = useState('')
  const selection = useMolStore(s => s.selection)
  const activeId = useMolStore(s => s.activeId)
  const structures = useMolStore(s => s.structures)
  const selectFromExpr = useMolStore(s => s.selectFromExpr)
  const namedSelections = useMolStore(s => s.namedSelections)
  const saveNamedSelection = useMolStore(s => s.saveNamedSelection)
  const deleteNamedSelection = useMolStore(s => s.deleteNamedSelection)
  const invertSelection = useMolStore(s => s.invertSelection)
  const addLabelsForSelection = useMolStore(s => s.addLabelsForSelection)
  const setSelection = useMolStore(s => s.setSelection)

  const st = structures.find(x => x.id === activeId)
  const data = activeId ? dataRegistry.get(activeId) : null

  const stats = (() => {
    if (!selection.structureId || !selection.indices.length) return null
    const d = dataRegistry.get(selection.structureId)
    if (!d) return null
    const residues = new Set<number>()
    const chains = new Set<string>()
    let het = 0
    for (const i of selection.indices) {
      residues.add(d.atomResidue[i])
      chains.add(d.atoms.chainIds[i])
      if (d.atoms.hetero[i]) het++
    }
    return { atoms: selection.indices.length, residues: residues.size, chains: chains.size, het }
  })()

  const runExpr = (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!expr.trim()) return
    const res = selectFromExpr(expr)
    if (res.error) toast.error(`选择错误：${res.error}`)
    else toast.success(`已选择 ${res.count.toLocaleString()} 个原子`)
  }

  return (
    <div className="pb-4">
      <SectionTitle>表达式选择</SectionTitle>
      <form onSubmit={runExpr} className="flex gap-1.5 px-2">
        <Input
          value={expr}
          onChange={e => setExpr(e.target.value)}
          placeholder="如 chain A and resi 40-80"
          className="h-8 flex-1 border-border/60 font-mono text-[11px]"
        />
        <button
          type="submit"
          className="flex h-8 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition hover:opacity-90"
        >
          <Target className="h-3.5 w-3.5" />
        </button>
      </form>

      <div className="mt-2 flex flex-wrap gap-1 px-2">
        {QUICK_EXPRS.map(q => (
          <button
            key={q.expr}
            onClick={() => {
              const res = selectFromExpr(q.expr)
              if (res.error) toast.error(res.error)
            }}
            className="rounded-full border border-border/60 bg-background/60 px-2.5 py-1 text-[10px] font-medium transition hover:border-primary/40 hover:bg-primary/5"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* 当前选择 */}
      <SectionTitle>当前选择</SectionTitle>
      {stats ? (
        <div className="mx-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="grid grid-cols-2 gap-y-1.5 text-[11px]">
            <span className="text-muted-foreground">原子</span>
            <span className="text-right font-mono font-semibold">{stats.atoms.toLocaleString()}</span>
            <span className="text-muted-foreground">残基</span>
            <span className="text-right font-mono">{stats.residues.toLocaleString()}</span>
            <span className="text-muted-foreground">链</span>
            <span className="text-right font-mono">{stats.chains}</span>
            {stats.het > 0 && (
              <>
                <span className="text-muted-foreground">杂原子</span>
                <span className="text-right font-mono">{stats.het.toLocaleString()}</span>
              </>
            )}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <button
              onClick={() => {
                if (!selection.structureId) return
                engineRef.current?.fitView([{ structureId: selection.structureId, indices: selection.indices }])
              }}
              className="flex h-6.5 items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[10px] font-medium transition hover:bg-accent"
            >
              <Crosshair className="h-3 w-3" /> 聚焦
            </button>
            <button
              onClick={() => invertSelection()}
              className="flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[10px] font-medium transition hover:bg-accent"
            >
              反选
            </button>
            <button
              onClick={() => addLabelsForSelection()}
              className="flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[10px] font-medium transition hover:bg-accent"
            >
              <Tag className="h-3 w-3" /> 标注 (L)
            </button>
            <button
              onClick={() => setSelection(null, [])}
              className="flex items-center gap-1 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[10px] font-medium transition hover:bg-accent"
            >
              <X className="h-3 w-3" /> 清除
            </button>
          </div>

          {/* 保存命名 */}
          <div className="mt-2.5 flex gap-1.5">
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="命名保存…"
              className="h-7 flex-1 border-border/60 text-[11px]"
            />
            <button
              onClick={() => {
                if (!name.trim()) return toast.error('请输入名称')
                saveNamedSelection(name.trim())
                toast.success(`已保存命名选择 "${name.trim()}"`)
                setName('')
              }}
              className="flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-[10px] font-medium transition hover:bg-accent"
            >
              <BookmarkPlus className="h-3 w-3" /> 保存
            </button>
          </div>
        </div>
      ) : (
        <p className="px-3 text-[11px] text-muted-foreground">
          在 3D 视图中点击残基（Ctrl+点击选单原子，Shift 追加，Alt 移除），或使用上方表达式。
        </p>
      )}

      {/* 命名选择 */}
      {namedSelections.length > 0 && (
        <>
          <SectionTitle>命名选择</SectionTitle>
          <div className="space-y-0.5 px-2">
            {namedSelections.map(ns => (
              <div key={ns.name} className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-accent">
                <span className="flex-1 truncate font-mono text-[11px] font-medium">{ns.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{ns.count.toLocaleString()} at</span>
                <button
                  onClick={() => {
                    if (!data) return
                    if (ns.indices) setSelection(ns.structureId, ns.indices)
                    else if (ns.expr) {
                      const res = evaluateSelection(ns.expr, { structure: data, named: buildNamedMasks(ns.structureId, data) })
                      if (!res.error) setSelection(ns.structureId, maskToIndices(res.mask))
                    }
                  }}
                  className="rounded px-1.5 py-0.5 text-[10px] text-primary transition hover:bg-primary/10"
                >
                  选中
                </button>
                <button
                  onClick={() => deleteNamedSelection(ns.name)}
                  className="text-muted-foreground opacity-0 transition hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <PanelHint>
        语法：<code className="text-[10px]">chain A</code> · <code className="text-[10px]">resi 1-60</code> · <code className="text-[10px]">resn HEM</code> · <code className="text-[10px]">name CA</code> · <code className="text-[10px]">elem Fe</code> · <code className="text-[10px]">within 5 of (…)</code> · <code className="text-[10px]">byres(…)</code>，可用 and / or / not。
      </PanelHint>
      <div className={cn('hidden', st ? '' : '')} />
    </div>
  )
}
