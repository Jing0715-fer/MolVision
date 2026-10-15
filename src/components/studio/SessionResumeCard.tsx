'use client'

// 会话恢复卡：dynamic(ssr:false) 挂载（服务端不渲染 → 零水合差异）
// localStorage 存档摘要仅在客户端读取；恢复失败时自我隐藏
// r127：Precision Dark 重皮——圆角 surface 卡（rounded-xl + bg-card +
// 发丝描边，与新欢迎页同族；悬停主色描边 + 极淡底）
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
      className="welcome-in group flex w-full items-center gap-3 rounded-xl border border-foreground/10 bg-card px-4 py-3.5 text-left transition-[border-color,background-color] duration-200 hover:border-primary/45 hover:bg-foreground/[0.02] disabled:pointer-events-none disabled:opacity-50"
      style={{ animationDelay: '200ms' }}
    >
      <HardDriveDownload className="h-4 w-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-tight">{t({ zh: '继续上次会话', en: 'Resume last session' })}</span>
        <span className="mt-1 block truncate font-mono text-[10px] leading-none tabular-nums text-muted-foreground">
          {t({ zh: `${session.count} 个结构`, en: `${session.count} structures` })} · {session.names.join(' / ')} · {t(relTime(session.savedAt))}
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-[color,translate] duration-200 group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  )
}

/** 客户端专属挂载（服务端渲染 null —— 水合安全） */
export const SessionResumeSlot = dynamic(() => Promise.resolve(SessionResumeCard), {
  ssr: false,
})
