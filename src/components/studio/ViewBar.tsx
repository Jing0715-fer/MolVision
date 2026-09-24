'use client'

// 视角书签浮层（视口右缘竖排）：保存/恢复相机视角
// - 缩略图点击 → 平滑过渡跳转；悬停删除；双击名称重命名
// - 快捷键：V 保存新书签；Shift+1..9 跳转（注册于 MolViewer）
import { useEffect, useRef, useState } from 'react'
import { Bookmark, BookmarkPlus, Camera, ChevronRight, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { MAX_BOOKMARKS, useViewsStore, type ViewBookmark } from '@/lib/molecular/views-store'
import { useMolStore } from '@/lib/molecular/store'
import { useI18n, tt } from '@/i18n'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'

export function ViewBar() {
  const { t } = useI18n()
  const structures = useMolStore(s => s.structures)
  const bookmarks = useViewsStore(s => s.bookmarks)
  const hydrate = useViewsStore(s => s.hydrate)
  const addBookmark = useViewsStore(s => s.addBookmark)
  const restoreBookmark = useViewsStore(s => s.restoreBookmark)
  const removeBookmark = useViewsStore(s => s.removeBookmark)
  const renameBookmark = useViewsStore(s => s.renameBookmark)
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const isMobile = useIsMobile()

  // 客户端装载 localStorage 存档（模块级 store 在 SSR 期间不可访问 localStorage）
  useEffect(() => { hydrate() }, [hydrate])

  // 重命名输入框聚焦
  useEffect(() => {
    if (renamingId) renameRef.current?.focus()
  }, [renamingId])

  // 跳转后短暂高亮目标卡片
  const jump = (b: ViewBookmark, idx: number) => {
    if (!restoreBookmark(b.id)) return
    setActiveId(b.id)
    window.setTimeout(() => setActiveId(prev => (prev === b.id ? null : prev)), 900)
    useMolStore.getState().appendLog('out', tt({ zh: `已跳转到视角书签「${b.name}」`, en: `Jumped to view bookmark "${b.name}"` }))
  }

  const save = () => {
    const bm = addBookmark()
    if (!bm) {
      toast.error(tt({ zh: `书签已达上限（${MAX_BOOKMARKS}）`, en: `Bookmark limit reached (${MAX_BOOKMARKS})` }), { description: tt({ zh: '先删除不再需要的书签', en: 'Delete bookmarks you no longer need first' }) })
      return
    }
    setUserCollapsed(false)
    toast.success(tt({ zh: `已保存视角书签「${bm.name}」`, en: `View bookmark "${bm.name}" saved` }), {
      description: bookmarks.length + 1 < 9
        ? tt({ zh: `Shift+${bookmarks.length + 1} 快速跳转 · 双击名称可重命名`, en: `Shift+${bookmarks.length + 1} to jump · double-click the name to rename` })
        : tt({ zh: '双击名称可重命名', en: 'Double-click the name to rename' }),
    })
  }

  if (!structures.length) return null

  // 窄屏（<768px）：默认折叠成徽章，避免 112px 宽书签条挤压小视口；用户点开后尊重选择
  const collapsed = userCollapsed ?? isMobile

  return (
    <div className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-end gap-1.5">
      {/* 头部：保存 + 折叠开关 */}
      <div className="flex items-center gap-1">
        <button
          onClick={save}
          title={t({ zh: '保存当前视角为书签 (V)', en: 'Save the current view as a bookmark (V)' })}
          className="mol-elevate flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-[11px] font-medium transition hover:border-primary/40 hover:text-primary active:scale-[0.97]"
        >
          <BookmarkPlus className="h-3 w-3" />
          {t({ zh: '保存视角', en: 'Save view' })}
        </button>
        {bookmarks.length > 0 && (
          <button
            onClick={() => setUserCollapsed(!collapsed)}
            title={collapsed ? t({ zh: '展开书签列表', en: 'Expand the bookmark list' }) : t({ zh: '折叠书签列表', en: 'Collapse the bookmark list' })}
            aria-label={collapsed ? t({ zh: '展开书签列表', en: 'Expand the bookmark list' }) : t({ zh: '折叠书签列表', en: 'Collapse the bookmark list' })}
            className="mol-elevate flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:text-foreground active:scale-[0.97]"
          >
            <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', collapsed ? '' : 'rotate-180')} />
          </button>
        )}
      </div>

      {/* 折叠态：计数徽章 */}
      {collapsed ? (
        <button
          onClick={() => setUserCollapsed(false)}
          title={t({ zh: `视角书签 × ${bookmarks.length}`, en: `View bookmarks × ${bookmarks.length}` })}
          className="mol-elevate relative flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground transition hover:text-foreground"
        >
          <Bookmark className="h-4 w-4" />
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[9px] font-bold text-primary-foreground">
            {bookmarks.length}
          </span>
        </button>
      ) : (
        <div className={cn('mol-scroll flex max-h-[min(56vh,520px)] flex-col items-end gap-1.5 overflow-y-auto pb-0.5 pr-0.5', isMobile && 'max-h-[46vh]')}>
          {bookmarks.length === 0 && (
            <div className="mol-elevate w-28 rounded-lg border border-dashed border-border bg-card px-2.5 py-3 text-center">
              <Camera className="mx-auto mb-1.5 h-4 w-4 text-muted-foreground/70" />
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                {t({ zh: '暂无书签', en: 'No bookmarks yet' })}<br />{t({ zh: '保存常用视角', en: 'Save your favorite views' })}<br />
                <span className="text-muted-foreground/70">{t({ zh: '（结合口袋 / 活性位点）', en: '(pockets / active sites)' })}</span>
              </p>
            </div>
          )}
          {bookmarks.map((b, i) => (
            <BookmarkCard
              key={b.id}
              b={b}
              idx={i}
              compact={isMobile}
              active={activeId === b.id}
              renaming={renamingId === b.id}
              renameRef={renameRef}
              onJump={() => jump(b, i)}
              onDelete={() => { removeBookmark(b.id); toast.success(tt({ zh: `已删除书签「${b.name}」`, en: `Bookmark "${b.name}" deleted` })) }}
              onRenameStart={() => setRenamingId(b.id)}
              onRenameCommit={name => { renameBookmark(b.id, name); setRenamingId(null) }}
            />
          ))}
          {bookmarks.length > 0 && (
            <p className="px-1 pt-0.5 text-right text-[9px] leading-tight text-muted-foreground/80">
              {t({ zh: 'V 保存 · Shift+数字 跳转', en: 'V to save · Shift+number to jump' })}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function BookmarkCard({
  b, idx, compact, active, renaming, renameRef, onJump, onDelete, onRenameStart, onRenameCommit,
}: {
  b: ViewBookmark
  idx: number
  compact?: boolean
  active: boolean
  renaming: boolean
  renameRef: React.RefObject<HTMLInputElement | null>
  onJump: () => void
  onDelete: () => void
  onRenameStart: () => void
  onRenameCommit: (name: string) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState(b.name)

  const time = new Date(b.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

  return (
    <div
      className={cn(
        'group relative shrink-0 overflow-hidden rounded-lg border bg-card mol-elevate transition-all duration-200',
        compact ? 'w-20' : 'w-28',
        active
          ? 'border-primary/70 ring-1 ring-primary/40'
          : 'border-border hover:border-foreground/25',
      )}
    >
      <button onClick={onJump} className="block w-full" title={t({ zh: `跳转到「${b.name}」（${time} 保存）`, en: `Jump to "${b.name}" (saved ${time})` })}>
        {b.thumb ? (
          <img src={b.thumb} alt={t({ zh: `视角书签「${b.name}」缩略图`, en: `View bookmark "${b.name}" thumbnail` })} className="block aspect-[8/5] w-full bg-black/10 object-cover" draggable={false} />
        ) : (
          <div className="flex aspect-[8/5] w-full items-center justify-center bg-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />
          </div>
        )}
      </button>

      {/* 序号徽章（快捷键提示，仅 1-9） */}
      {idx < 9 && (
        <span className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/65 font-mono text-[9px] font-bold text-white">
          {idx + 1}
        </span>
      )}

      {/* 删除按钮（悬停浮现） */}
      <button
        onClick={onDelete}
        title={t({ zh: '删除此书签', en: 'Delete this bookmark' })}
        aria-label={t({ zh: `删除书签「${b.name}」`, en: `Delete bookmark "${b.name}"` })}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/65 text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-500"
      >
        <Trash2 className="h-3 w-3" />
      </button>

      {/* 名称（双击重命名） */}
      <div className="border-t border-border/70 bg-muted/50 px-1.5 py-1">
        {renaming ? (
          <input
            ref={renameRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => onRenameCommit(draft)}
            onKeyDown={e => {
              if (e.key === 'Enter') onRenameCommit(draft)
              else if (e.key === 'Escape') onRenameCommit(b.name)
              e.stopPropagation()
            }}
            maxLength={40}
            className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-[10px] outline-none"
          />
        ) : (
          <button
            onDoubleClick={() => { setDraft(b.name); onRenameStart() }}
            title={t({ zh: '双击重命名', en: 'Double-click to rename' })}
            className="w-full truncate text-left font-mono text-[10px] font-medium leading-tight text-foreground/90"
          >
            {b.name}
            <span className="ml-1 font-mono text-[8px] text-muted-foreground/70">{time}</span>
          </button>
        )}
      </div>
    </div>
  )
}
