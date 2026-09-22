'use client'

// 会话恢复卡：dynamic(ssr:false) 挂载（服务端不渲染 → 零水合差异）
// localStorage 存档摘要仅在客户端读取；恢复失败时自我隐藏
import dynamic from 'next/dynamic'
import { useRef, useState } from 'react'
import { ArrowRight, HardDriveDownload } from 'lucide-react'
import { toast } from 'sonner'
import { useMolStore } from '@/lib/molecular/store'
import { restoreSession, sessionSnapshot } from '@/lib/molecular/session'

function relTime(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.round(s / 60)} 分钟前`
  if (s < 86400) return `${Math.round(s / 3600)} 小时前`
  return `${Math.round(s / 86400)} 天前`
}

function SessionResumeCard() {
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
      toast.success('已恢复上次会话', { description: `${n} 个结构 · 表示法与相机视角已还原` })
    } else {
      restoring.current = false
      setGone(true)
      toast.error('会话恢复失败', { description: '本地存档中没有可恢复的结构，已忽略' })
    }
  }

  return (
    <button
      onClick={resume}
      disabled={loading}
      className="welcome-in panel-card group mt-9 flex w-full items-center gap-3 px-4 py-3 text-left hover:border-primary/45!"
      style={{ animationDelay: '200ms' }}
    >
      <HardDriveDownload className="h-[18px] w-[18px] shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-tight">继续上次会话</span>
        <span className="mt-1 block truncate font-mono text-[10px] leading-none tabular-nums text-muted-foreground">
          {session.count} 个结构 · {session.names.join(' / ')} · {relTime(session.savedAt)}
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
