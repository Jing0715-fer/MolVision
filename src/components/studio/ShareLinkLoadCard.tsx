'use client'

// r86 从分享链接加载（接收侧发现性教育入口）：欢迎页会话区常显粘贴卡——
// 接收方拿到链接文本（IM/邮件里拷贝的完整 URL 或裸 #s= 片段）可直接贴入加载，
// 不必知道「把链接粘到地址栏再回车」这一隐式约定。
// 视觉族：与 SessionResumeCard 同构（panel-card + 左缘刻线 + 32px 图标盒 +
// hover 浮起），色相区分语义——恢复=主色 / 分享接收=翡翠（r85 分享链接色系）。
// 副作用诚实：与「打开分享链接」同替换语义（欢迎页本就是空场景，无覆盖风险）；
// 剪贴板读取按钮在权限拒绝时降级为聚焦输入框引导手动 Ctrl+V，不硬失败。
import { useRef, useState, type FormEvent } from 'react'
import { ClipboardPaste, Link2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useMolStore } from '@/lib/molecular/store'
import { useI18n, tt } from '@/i18n'
import { applyShareLinkFromText } from '@/lib/molecular/share-link'

export function ShareLinkLoadCard() {
  const { t } = useI18n()
  const loading = useMolStore(s => s.loading)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const canSubmit = text.trim().length > 0 && !loading

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const v = text.trim()
    if (!v || busy.current || loading) return
    busy.current = true
    // applyShareSnapshot 起手即置 loading=true；成功时欢迎页卸载（结构入场景），
    // 失败时卡片仍在——解锁允许修正后重试
    void applyShareLinkFromText(v).finally(() => { busy.current = false })
  }

  /** 一键读取剪贴板（权限拒绝/空剪贴板时诚实降级——聚焦输入框引导手动粘贴） */
  const pasteFromClipboard = async () => {
    if (loading) return
    try {
      const v = await navigator.clipboard.readText()
      if (v.trim()) {
        setText(v.trim())
        inputRef.current?.focus()
        return
      }
      toast.info(tt({ zh: '剪贴板为空——请先复制分享链接', en: 'Clipboard is empty — copy a share link first' }))
    } catch {
      inputRef.current?.focus()
      toast.info(tt({ zh: '已聚焦输入框——按 Ctrl+V / ⌘V 粘贴', en: 'Input focused — press Ctrl+V / ⌘V to paste' }))
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      data-qa="share-load-card"
      aria-label={t({ zh: '从分享链接加载会话', en: 'Load session from share link' })}
      className="welcome-in panel-card group relative flex w-full items-center gap-2.5 overflow-hidden px-3.5 py-2.5 text-left shadow-[0_2px_10px_oklch(0.25_0.01_80/0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-emerald-500/40! hover:shadow-[0_5px_16px_oklch(0.25_0.01_80/0.08)] dark:shadow-none dark:hover:shadow-[0_5px_16px_oklch(0_0_0/0.35)]"
      style={{ animationDelay: '215ms' }}
    >
      {/* 左缘翡翠刻线锚（与恢复卡同族「通电」暗示，色相区分语义） */}
      <span
        aria-hidden
        className="absolute left-0 top-1/2 h-[38%] w-[2px] -translate-y-1/2 rounded-r-sm bg-emerald-500/75 shadow-[0_0_8px_oklch(0.65_0.14_160/0.4)] transition-[height,background-color] duration-200 group-hover:h-[62%] group-hover:bg-emerald-500"
      />
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-500/25 bg-emerald-500/[0.08] transition-colors duration-200 group-hover:border-emerald-500/40 group-hover:bg-emerald-500/[0.14]">
        <Link2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
      </span>
      <input
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t({ zh: '粘贴分享链接 · #s=… 或完整 URL', en: 'Paste a share link · #s=… or full URL' })}
        aria-label={t({ zh: '分享链接', en: 'Share link' })}
        autoComplete="off"
        spellCheck={false}
        data-qa="share-link-input"
        className="h-8 min-w-0 flex-1 rounded-md border border-foreground/15 bg-transparent px-2.5 font-mono text-[12px] leading-none text-foreground outline-none transition-[border-color,box-shadow] duration-150 placeholder:font-sans placeholder:text-[11px] placeholder:font-normal placeholder:tracking-[0.02em] placeholder:text-muted-foreground hover:border-foreground/30 focus-visible:border-emerald-500/60 focus-visible:shadow-[0_0_0_3px_oklch(0.65_0.14_160/0.12)] dark:border-white/[0.14] dark:hover:border-white/25 dark:focus-visible:border-emerald-400/60 dark:focus-visible:shadow-[0_0_0_3px_oklch(0.65_0.14_160/0.14)]"
      />
      <button
        type="button"
        onClick={() => { void pasteFromClipboard() }}
        disabled={loading}
        aria-label={t({ zh: '从剪贴板粘贴', en: 'Paste from clipboard' })}
        title={t({ zh: '从剪贴板粘贴（权限受限时请手动 Ctrl+V）', en: 'Paste from clipboard (or Ctrl+V manually if permission is restricted)' })}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-foreground/15 text-muted-foreground transition-colors duration-150 hover:border-foreground/30 hover:text-foreground disabled:pointer-events-none disabled:opacity-40 dark:border-white/[0.14] dark:hover:border-white/25"
      >
        <ClipboardPaste className="h-3.5 w-3.5" />
      </button>
      <button
        type="submit"
        disabled={!canSubmit}
        data-qa="share-load-apply"
        className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-[12px] font-medium leading-none text-white shadow-[inset_0_1px_0_oklch(1_0_0/0.25),0_1px_3px_oklch(0.5_0.12_160/0.3)] transition-[background-color,box-shadow,translate] duration-150 hover:bg-emerald-500 active:translate-y-px disabled:pointer-events-none disabled:opacity-40 dark:bg-emerald-500 dark:text-emerald-950 dark:hover:bg-emerald-400 dark:shadow-none"
      >
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
        {t({ zh: '加载', en: 'Load' })}
      </button>
    </form>
  )
}
