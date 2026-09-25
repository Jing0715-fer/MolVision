'use client'

// 会话恢复卡：dynamic(ssr:false) 挂载（服务端不渲染 → 零水合差异）
// localStorage 存档摘要仅在客户端读取；恢复失败时自我隐藏
import dynamic from 'next/dynamic'
import { useRef, useState } from 'react'
import { ArrowRight, HardDriveDownload } from 'lucide-react'
import { toast } from 'sonner'
import { useMolStore } from '@/lib/molecular/store'
import { useI18n, tt, type DualText } from '@/i18n'
import { restoreSession, sessionSnapshot } from '@/lib/molecular/session'

function relTime(ts: number): DualText {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return { zh: '刚刚', en: 'just now' }
  if (s < 3600) return { zh: `${Math.round(s / 60)} 分钟前`, en: `${Math.round(s / 60)} min ago` }
  if (s < 86400) return { zh: `${Math.round(s / 3600)} 小时前`, en: `${Math.round(s / 3600)} h ago` }
  return { zh: `${Math.round(s / 86400)} 天前`, en: `${Math.round(s / 86400)} d ago` }
}

function SessionResumeCard() {
  const { t } = useI18n()
  const loading = useMolStore(s => s.loading)
  // 仅客户端渲染：localStorage 惰性读取安全
  const [session] = useState(sessionSnapshot)
  const [gone, setGone] = useState(false)
  const restoring = useRef(false)

  if (!session || gone) return null

  const resume = () => {
    if (restoring.current) return
    restoring.current = true
    const n = restoreSession()
    if (n > 0) {
      toast.success(tt({ zh: '已恢复上次会话', en: 'Previous session restored' }), { description: tt({ zh: `${n} 个结构 · 表示法与相机视角已还原`, en: `${n} structures · representations and camera views restored` }) })
    } else {
      restoring.current = false
      setGone(true)
      toast.error(tt({ zh: '会话恢复失败', en: 'Session restore failed' }), { description: tt({ zh: '本地存档中没有可恢复的结构，已忽略', en: 'No recoverable structures in the local autosave; ignored' }) })
    }
  }

  return (
    <button
      onClick={resume}
      disabled={loading}
      className="welcome-in panel-card group relative mt-9 flex w-full items-center gap-3.5 overflow-hidden px-4 py-3.5 text-left shadow-[0_2px_10px_oklch(0.25_0.01_80/0.04)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-primary/45! hover:shadow-[0_5px_16px_oklch(0.25_0.01_80/0.08)] dark:shadow-none dark:hover:shadow-[0_5px_16px_oklch(0_0_0/0.35)]"
      style={{ animationDelay: '200ms' }}
    >
      {/* 左缘翡翠刻线锚（带微光；hover 时延伸增亮——「通电」暗示） */}
      <span
        aria-hidden
        className="absolute left-0 top-1/2 h-[38%] w-[2px] -translate-y-1/2 rounded-r-sm bg-primary/75 shadow-[0_0_8px_color-mix(in_oklab,var(--primary)_45%,transparent)] transition-[height,background-color] duration-200 group-hover:h-[62%] group-hover:bg-primary"
      />
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/[0.08] transition-colors duration-200 group-hover:border-primary/35 group-hover:bg-primary/[0.14]">
        <HardDriveDownload className="h-4 w-4 text-primary" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-tight">{t({ zh: '继续上次会话', en: 'Resume last session' })}</span>
        <span className="mt-1 block truncate font-mono text-[10px] leading-none tabular-nums text-muted-foreground">
          {t({ zh: `${session.count} 个结构`, en: `${session.count} structures` })} · {session.names.join(' / ')} · {t(relTime(session.savedAt))}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  )
}

/** 客户端专属挂载（服务端渲染 null —— 水合安全） */
export const SessionResumeSlot = dynamic(() => Promise.resolve(SessionResumeCard), {
  ssr: false,
})
