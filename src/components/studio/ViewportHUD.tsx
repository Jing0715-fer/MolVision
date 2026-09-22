'use client'

// 视口取景器 OSD 读数（相机取景框风格）：活动结构 · 原子数 · 主表示法
// 悬浮层不参与 ray 导出（DOM 覆盖层）；pointer-events-none 不拦截交互
import { useMolStore } from '@/lib/molecular/store'
import { REP_LABELS } from '@/lib/molecular/types'

export function ViewportHUD() {
  const structures = useMolStore(s => s.structures)
  const activeId = useMolStore(s => s.activeId)
  const st = structures.find(x => x.id === activeId)
  if (!st) return null
  const rep = st.reps.find(r => r.visible) ?? st.reps[0]
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-7 top-7 z-10 hidden select-none items-center gap-1.5 rounded-[4px] border border-foreground/10 bg-background/60 px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] tabular-nums text-foreground/50 backdrop-blur-[2px] sm:flex"
    >
      <span className="h-1 w-1 rounded-full bg-primary/70" />
      <span className="font-bold text-foreground/70">{st.name.slice(0, 8)}</span>
      <span aria-hidden className="h-2 w-px bg-foreground/15" />
      <span>{st.summary.atoms.toLocaleString()} AT</span>
      {rep && (
        <>
          <span aria-hidden className="h-2 w-px bg-foreground/15" />
          <span>{REP_LABELS[rep.type] ?? rep.type}</span>
        </>
      )}
    </div>
  )
}
