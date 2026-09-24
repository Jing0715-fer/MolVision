'use client'

// 加载结构对话框：PDB ID / 文件上传 / 示例
import { useRef, useState } from 'react'
import { FileUp, Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useMolStore } from '@/lib/molecular/store'
import { EXAMPLE_STRUCTURES, fetchPdbId, loadFiles } from '@/lib/molecular/loader'
import { useI18n, tt } from '@/i18n'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

export function LoadDialog() {
  const { t } = useI18n()
  const ui = useMolStore(s => s.ui)
  const setUi = useMolStore(s => s.setUi)
  const loading = useMolStore(s => s.loading)
  const [id, setId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const submitId = () => {
    const v = id.trim().toUpperCase()
    if (!v) return
    if (!/^[0-9][A-Z0-9]{3}$/.test(v)) {
      toast.error(tt({ zh: 'PDB 编号为 4 位字符（如 4HHB、1CRN）', en: 'PDB IDs are 4 characters (e.g. 4HHB, 1CRN)' }))
      return
    }
    void fetchPdbId(v)
    setUi({ loadOpen: false })
  }

  return (
    <Dialog open={ui.loadOpen} onOpenChange={open => setUi({ loadOpen: open })}>
      <DialogContent className="mol-elevate-lg gap-0 p-0 sm:max-w-md">
        <DialogHeader className="gap-1.5 border-b border-border px-4 pb-2.5 pt-3.5">
          <DialogTitle className="flex items-center gap-2 text-sm">
            {t({ zh: '加载分子结构', en: 'Load molecular structure' })}
            <span className="mol-micro ml-auto mr-9 text-muted-foreground">LOAD</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t({ zh: '从 RCSB Protein Data Bank 获取，或打开本地 PDB / mmCIF 文件。', en: 'Fetch from the RCSB Protein Data Bank, or open a local PDB / mmCIF file.' })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-4 py-4">
          {/* PDB ID */}
          <section className="space-y-2">
            <div className="mol-micro text-muted-foreground">{t({ zh: 'PDB 编号', en: 'PDB ID' })}</div>
            <form
              onSubmit={e => { e.preventDefault(); submitId() }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
                <Input
                  value={id}
                  onChange={e => setId(e.target.value.toUpperCase())}
                  placeholder={t({ zh: 'PDB 编号，如 4HHB', en: 'PDB ID, e.g. 4HHB' })}
                  className="h-9 pl-8 font-mono text-[13px] uppercase tracking-wider md:text-[13px]"
                  maxLength={4}
                  autoFocus
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="mol-btn-primary flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-[13px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t({ zh: '获取', en: 'Fetch' })}
              </button>
            </form>
          </section>

          {/* 文件 */}
          <section className="space-y-2">
            <div className="mol-micro text-muted-foreground">{t({ zh: '本地文件', en: 'Local file' })}</div>
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
              className="flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-dashed border-border p-5 text-center transition hover:border-primary/50 hover:bg-primary/5"
            >
              <FileUp className="h-5 w-5 text-muted-foreground" />
              <div className="text-[13px] font-medium">{t({ zh: '点击选择或拖入文件', en: 'Click to choose or drop a file' })}</div>
              <div className="text-[11px] text-muted-foreground">{t({ zh: '支持 .pdb / .ent / .cif / .mmcif / .ccp4 密度图 / .molvision 会话', en: 'Supports .pdb / .ent / .cif / .mmcif / .ccp4 maps / .molvision sessions' })}</div>
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
          </section>

          {/* 示例 */}
          <section className="space-y-2">
            <div className="mol-micro text-muted-foreground">{t({ zh: '经典示例', en: 'Classic examples' })}</div>
            <div className="grid grid-cols-2 gap-1.5">
              {EXAMPLE_STRUCTURES.map(ex => (
                <button
                  key={ex.id}
                  onClick={() => { void fetchPdbId(ex.id); setUi({ loadOpen: false }) }}
                  className="group panel-card flex items-center gap-2 p-2 text-left"
                >
                  <span className="shrink-0 rounded bg-muted px-1.5 py-1 font-mono text-[10px] font-bold tabular-nums transition group-hover:text-primary">
                    {ex.id}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{t(ex.title)}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{t(ex.desc)}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
