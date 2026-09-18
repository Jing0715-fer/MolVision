'use client'

// 加载结构对话框：PDB ID / 文件上传 / 示例
import { useRef, useState } from 'react'
import { FileUp, Loader2, Search, FlaskConical } from 'lucide-react'
import { toast } from 'sonner'
import { useMolStore } from '@/lib/molecular/store'
import { EXAMPLE_STRUCTURES, fetchPdbId, loadFiles } from '@/lib/molecular/loader'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export function LoadDialog() {
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)
  const loading = useMolStore(s => s.loading)
  const [id, setId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const submitId = () => {
    const v = id.trim().toUpperCase()
    if (!v) return
    if (!/^[0-9][A-Z0-9]{3}$/.test(v)) {
      toast.error('PDB 编号为 4 位字符（如 4HHB、1CRN）')
      return
    }
    void fetchPdbId(v)
    setUi({ loadOpen: false })
  }

  return (
    <Dialog open={ui.loadOpen} onOpenChange={open => setUi({ loadOpen: open })}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>加载分子结构</DialogTitle>
          <DialogDescription>
            从 RCSB Protein Data Bank 获取，或打开本地 PDB / mmCIF 文件。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* PDB ID */}
          <form
            onSubmit={e => { e.preventDefault(); submitId() }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={id}
                onChange={e => setId(e.target.value.toUpperCase())}
                placeholder="PDB 编号，如 4HHB"
                className="h-10 pl-8 font-mono text-sm uppercase tracking-wider"
                maxLength={4}
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="flex h-10 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow transition hover:opacity-90 disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              获取
            </button>
          </form>

          {/* 文件 */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault()
              if (e.dataTransfer.files?.length) {
                loadFiles(e.dataTransfer.files)
                setUi({ loadOpen: false })
              }
            }}
            className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-border/70 p-5 text-center transition hover:border-primary/50 hover:bg-primary/5"
          >
            <FileUp className="h-5 w-5 text-muted-foreground" />
            <div className="text-sm font-medium">点击选择或拖入文件</div>
            <div className="text-[11px] text-muted-foreground">支持 .pdb / .ent / .cif / .mmcif / .ccp4 密度图 / .molvision 会话</div>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".pdb,.ent,.cif,.mmcif,.txt,.molvision,.json,.ccp4,.map,.mrc"
              className="hidden"
              onChange={e => {
                if (e.target.files?.length) {
                  loadFiles(e.target.files)
                  setUi({ loadOpen: false })
                }
              }}
            />
          </div>

          <Separator />

          {/* 示例 */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <FlaskConical className="h-3.5 w-3.5 text-emerald-500" />
              经典示例
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {EXAMPLE_STRUCTURES.map(ex => (
                <button
                  key={ex.id}
                  onClick={() => { void fetchPdbId(ex.id); setUi({ loadOpen: false }) }}
                  className={cn(
                    'group flex items-center gap-2 rounded-lg border border-border/60 p-2 text-left transition hover:border-primary/40 hover:bg-primary/5',
                  )}
                >
                  <span className="rounded bg-muted px-1.5 py-1 font-mono text-[10px] font-bold group-hover:bg-primary group-hover:text-primary-foreground">
                    {ex.id}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{ex.title}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{ex.desc}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
