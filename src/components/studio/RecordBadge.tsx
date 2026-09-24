'use client'

// 动画录制指示器：录制中显示红点 + 计时 + 停止按钮（下载 WebM）
import { useEffect, useRef } from 'react'
import { CircleStop } from 'lucide-react'
import { toast } from 'sonner'
import { engineRef } from '@/lib/molecular/store'
import { useRecordStore } from '@/lib/molecular/record-store'
import { useI18n, tt } from '@/i18n'

function timestampName(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `molvision-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.webm`
}

export function RecordBadge() {
  const { t } = useI18n()
  const recording = useRecordStore(s => s.recording)
  const setRecording = useRecordStore(s => s.setRecording)
  const timeRef = useRef<HTMLSpanElement>(null)

  // 计时器：直接更新 DOM 文本（避开 set-state-in-effect 且零重渲染）
  useEffect(() => {
    if (!recording) return
    const t = setInterval(() => {
      const eng = engineRef.current
      const el = timeRef.current
      if (!eng || !el) return
      const s = eng.recordingElapsed
      const mm = Math.floor(s / 60)
      const ss = Math.floor(s % 60)
      el.textContent = `REC ${mm}:${String(ss).padStart(2, '0')}`
    }, 250)
    return () => clearInterval(t)
  }, [recording])

  if (!recording) return null

  const stop = async () => {
    const eng = engineRef.current
    if (!eng) return
    const elapsed = eng.recordingElapsed
    const blob = await eng.stopRecording()
    setRecording(false)
    if (!blob || blob.size === 0) {
      toast.error(tt({ zh: '录制内容为空', en: 'Recording is empty' }))
      return
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = timestampName()
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    toast.success(tt({ zh: '动画已导出为 WebM 视频', en: 'Animation exported as a WebM video' }), {
      description: tt({ zh: `${(blob.size / 1024 / 1024).toFixed(1)} MB · ${elapsed.toFixed(1)} 秒 · 30 fps`, en: `${(blob.size / 1024 / 1024).toFixed(1)} MB · ${elapsed.toFixed(1)} s · 30 fps` }),
    })
  }

  return (
    <div className="absolute left-3 top-3 z-30 flex items-center gap-2 rounded-full border border-red-500/40 bg-popover px-3 py-1.5 mol-elevate">
      <span className="relative flex h-3 w-3 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
      </span>
      <span ref={timeRef} className="font-mono text-xs font-semibold tabular-nums text-red-500">
        REC 0:00
      </span>
      <button
        onClick={() => void stop()}
        className="flex h-6 items-center gap-1 rounded-full bg-red-500/90 px-2 text-[10px] font-semibold text-white transition hover:bg-red-600"
        title={t({ zh: '停止并下载 WebM', en: 'Stop and download the WebM' })}
      >
        <CircleStop className="h-3 w-3" /> {t({ zh: '停止', en: 'Stop' })}
      </button>
    </div>
  )
}
