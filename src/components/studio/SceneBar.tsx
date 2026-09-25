'use client'

// 场景快照条（视口底部居中）：PyMOL 式「视角 + 显示样式」一体场景切换
// - scene save [名] 快照当前完整状态（相机/reps/链隔离/环境/氢键范围）
// - 点击卡片 → 召回（相机平滑过渡 + reps 重建 + 链隔离恢复）
// - ◀ ▶ 轮播 / 悬停删除 / 双击名称重命名；与命令行 scene save/recall 同一状态源
import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Layers, Loader2, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { MAX_SCENES, useSceneStore, type MolScene } from '@/lib/molecular/scene-store'
import { useMolStore } from '@/lib/molecular/store'
import { useIsMobile } from '@/hooks/use-mobile'
import { useI18n, tt } from '@/i18n'
import { cn } from '@/lib/utils'

export function SceneBar() {
  const { t } = useI18n()
  const structures = useMolStore(s => s.structures)
  const scenes = useSceneStore(s => s.scenes)
  const activeSceneId = useSceneStore(s => s.activeSceneId)
  const hydrate = useSceneStore(s => s.hydrate)
  const saveScene = useSceneStore(s => s.saveScene)
  const recallScene = useSceneStore(s => s.recallScene)
  const deleteScene = useSceneStore(s => s.deleteScene)
  const renameScene = useSceneStore(s => s.renameScene)
  const cycleScene = useSceneStore(s => s.cycleScene)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  const isMobile = useIsMobile()

  // 客户端装载 localStorage 存档
  useEffect(() => { hydrate() }, [hydrate])
  useEffect(() => {
    if (renamingId) renameRef.current?.focus()
  }, [renamingId])

  if (!structures.length || !scenes.length) return null

  const save = () => {
    const r = saveScene()
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success(tt(r.updated
      ? { zh: `已更新场景「${r.scene.name}」`, en: `Scene "${r.scene.name}" updated` }
      : { zh: `已保存场景「${r.scene.name}」`, en: `Scene "${r.scene.name}" saved` }), {
      description: tt({ zh: '相机 + 表示法 + 链隔离 + 环境一体快照 · 再次保存同名可覆盖', en: 'Camera + representations + chain isolation + environment in one snapshot · save again with the same name to overwrite' }),
    })
  }

  const recall = (sc: MolScene) => {
    const r = recallScene(sc.id)
    if (!r.ok) {
      toast.error(r.error, { description: tt({ zh: '场景按结构名恢复——先加载对应结构', en: 'Scenes restore by structure name — load the structure first' }) })
      return
    }
    setFlashId(sc.id)
    window.setTimeout(() => setFlashId(prev => (prev === sc.id ? null : prev)), 900)
    useMolStore.getState().appendLog('out', tt({ zh: `已召回场景「${sc.name}」——恢复 ${r.restored} 个结构的显示状态${r.cameraApplied ? ' + 相机' : ''}${r.missing.length ? `（未加载跳过：${r.missing.join('、')}）` : ''}`, en: `Scene "${sc.name}" recalled — restored display state for ${r.restored} structure(s)${r.cameraApplied ? ' + camera' : ''}${r.missing.length ? ` (skipped unloaded: ${r.missing.join(', ')})` : ''}` }))
  }

  const cardW = isMobile ? 'w-[76px]' : 'w-[104px]'

  return (
    <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-14">
      <div className="mol-elevate flex max-w-full items-center gap-1.5 rounded-2xl border border-border bg-card/95 p-1.5 backdrop-blur-sm">
        {/* 左：保存新场景 */}
        <button
          onClick={save}
          title={t({ zh: '快照当前状态为新场景（相机 + 表示法 + 链隔离 + 环境）', en: 'Snapshot current state as a new scene (camera + representations + chain isolation + environment)' })}
          aria-label={t({ zh: '保存当前状态为场景', en: 'Save current state as a scene' })}
          disabled={scenes.length >= MAX_SCENES}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 active:scale-95"
        >
          <Save className="h-4 w-4" />
        </button>

        {/* 轮播左箭头 */}
        <button
          onClick={() => { if (!cycleScene(-1)) toast.error(tt({ zh: '切换失败——场景结构未加载？', en: 'Switch failed — are the scene structures loaded?' })) }}
          title={t({ zh: '上一个场景', en: 'Previous scene' })}
          aria-label={t({ zh: '上一个场景', en: 'Previous scene' })}
          className="flex h-9 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground/80 transition hover:bg-accent hover:text-foreground active:scale-95"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {/* 场景卡片列（横向滚动；上限 10） */}
        <div className="mol-scroll flex max-w-full items-center gap-1.5 overflow-x-auto">
          {scenes.map(sc => (
            <SceneCard
              key={sc.id}
              sc={sc}
              cardW={cardW}
              active={activeSceneId === sc.id}
              flash={flashId === sc.id}
              renaming={renamingId === sc.id}
              renameRef={renameRef}
              onRecall={() => recall(sc)}
              onDelete={() => { deleteScene(sc.id); toast.success(tt({ zh: `已删除场景「${sc.name}」`, en: `Scene "${sc.name}" deleted` })) }}
              onRenameStart={() => setRenamingId(sc.id)}
              onRenameCommit={name => { renameScene(sc.id, name); setRenamingId(null) }}
            />
          ))}
        </div>

        {/* 轮播右箭头 */}
        <button
          onClick={() => { if (!cycleScene(1)) toast.error(tt({ zh: '切换失败——场景结构未加载？', en: 'Switch failed — are the scene structures loaded?' })) }}
          title={t({ zh: '下一个场景', en: 'Next scene' })}
          aria-label={t({ zh: '下一个场景', en: 'Next scene' })}
          className="flex h-9 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground/80 transition hover:bg-accent hover:text-foreground active:scale-95"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function SceneCard({
  sc, cardW, active, flash, renaming, renameRef, onRecall, onDelete, onRenameStart, onRenameCommit,
}: {
  sc: MolScene
  cardW: string
  active: boolean
  flash: boolean
  renaming: boolean
  renameRef: React.RefObject<HTMLInputElement | null>
  onRecall: () => void
  onDelete: () => void
  onRenameStart: () => void
  onRenameCommit: (name: string) => void
}) {
  const { t, locale } = useI18n()
  const [draft, setDraft] = useState(sc.name)
  const time = new Date(sc.createdAt).toLocaleTimeString(locale === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' })

  return (
    <div
      className={cn(
        'group relative shrink-0 overflow-hidden rounded-xl border bg-card transition-all duration-200',
        cardW,
        active
          ? 'border-primary/70 ring-1 ring-primary/40'
          : 'border-border hover:border-foreground/25',
        flash && 'border-primary ring-2 ring-primary/50',
      )}
    >
      {/* 缩略图（点击召回） */}
      <button onClick={onRecall} className="block w-full" title={t({ zh: `召回场景「${sc.name}」（${time} · ${sc.structures.length} 结构）——相机/表示法/链隔离/环境整体恢复`, en: `Recall scene "${sc.name}" (${time} · ${sc.structures.length} structures) — camera/representations/chain isolation/environment restored together` })}>
        {sc.thumb ? (
          <img src={sc.thumb} alt={t({ zh: `场景「${sc.name}」缩略图`, en: `Scene "${sc.name}" thumbnail` })} className="block aspect-[8/5] w-full bg-black/10 object-cover" draggable={false} />
        ) : (
          <div className="flex aspect-[8/5] w-full items-center justify-center bg-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground/60" />
          </div>
        )}
      </button>

      {/* 场景徽标（左上，区分视角书签） */}
      <span className="pointer-events-none absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/65 text-white">
        <Layers className="h-2.5 w-2.5" />
      </span>

      {/* 删除按钮（悬停浮现） */}
      <button
        onClick={onDelete}
        title={t({ zh: '删除此场景', en: 'Delete this scene' })}
        aria-label={t({ zh: `删除场景「${sc.name}」`, en: `Delete scene "${sc.name}"` })}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-black/65 text-white opacity-0 transition group-hover:opacity-100 hover:bg-red-500"
      >
        <Trash2 className="h-3 w-3" />
      </button>

      {/* 名称 + 结构数（双击重命名） */}
      <div className="border-t border-border/70 bg-muted/50 px-1.5 py-1">
        {renaming ? (
          <input
            ref={renameRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={() => onRenameCommit(draft)}
            onKeyDown={e => {
              // IME 组合中（中文输入法候选确认的 Enter）不触发重命名提交
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter') onRenameCommit(draft)
              else if (e.key === 'Escape') onRenameCommit(sc.name)
              e.stopPropagation()
            }}
            maxLength={40}
            className="w-full rounded border border-primary/50 bg-background px-1 py-0.5 text-[10px] outline-none"
          />
        ) : (
          <button
            onDoubleClick={() => { setDraft(sc.name); onRenameStart() }}
            title={t({ zh: '双击重命名', en: 'Double-click to rename' })}
            className="w-full truncate text-left font-mono text-[10px] font-medium leading-tight text-foreground/90"
          >
            {sc.name}
            <span className="ml-1 font-mono text-[8px] text-muted-foreground/70">{t({ zh: `${sc.structures.length}构`, en: `${sc.structures.length} str` })}</span>
          </button>
        )}
      </div>
    </div>
  )
}
