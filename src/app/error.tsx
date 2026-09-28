'use client'

// 路由级错误边界（r81 全面代码审查缺口修复）
// ─────────────────────────────────────────────────────────────────────────────
// 审查发现：src/app 此前无 error.tsx / global-error.tsx——任何客户端组件渲染
// 抛错会落到 Next.js 默认报错页（英文、与产品视觉完全脱节）。生产就绪的
// 应用必须有路由级兜底：用户看到的是「仪器故障面板」（与 MolVision 仪器
// 视觉语言同构），而非框架原始堆栈。
//
// 设计要点：
//  · 仪器语义的「故障检修面板」：六角警示徽章 + 故障码（digest 短标识）+
//    复位（reset——重试渲染，Transient 错误如竞态/瞬时状态多数可恢复）+
//    硬重启（location.reload——清所有客户端状态，Reset 无效时的兜底）
//  · 双语（useI18n cookie SSR 直读——layout 已包裹 I18nProvider）
//  · reset 后仍反复崩溃：Next 会重新抛给本边界，复位按钮仍在（用户可硬重启）
//  · error.digest：Next 生产环境的错误短标识（上报/检索日志用；开发环境
//    附 error.message 便于现场定位）
//  · 不吞错误边界自身的异常——本组件保持极简（无外部依赖、无 store 订阅，
//    仅 useI18n 与 next/navigation，两者在边界场景最不可能再抛）
import { useEffect } from 'react'
import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useI18n } from '@/i18n'

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useI18n()

  // 开发环境把错误透传到控制台（生产行为由 Next 统一上报）
  useEffect(() => {
    console.error('[RouteError]', error)
  }, [error])

  const digest = error.digest ?? '—'

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12 text-center">
      {/* 六角警示徽章（hero 六角芯片的故障变体：琥珀告警色） */}
      <div className="relative flex h-16 w-16 items-center justify-center" aria-hidden>
        <svg viewBox="0 0 28 28" className="absolute inset-0 h-full w-full">
          <polygon points="14,1 25.1,7.25 25.1,20.75 14,27 2.9,20.75 2.9,7.25" className="fill-none stroke-amber-500/70" strokeWidth="1.2" />
        </svg>
        <AlertTriangle className="h-6 w-6 text-amber-500" />
      </div>

      <h1 className="mt-5 text-[22px] font-bold leading-tight tracking-[-0.01em]">
        {t({ zh: '仪器遇到临时故障', en: 'A temporary instrument fault occurred' })}
      </h1>
      <p className="mt-2.5 max-w-md text-[12.5px] leading-relaxed text-muted-foreground">
        {t({
          zh: '渲染过程中出现未预期的错误。多数情况复位即可恢复；若反复出现，请硬重启（清空界面状态重新载入）。',
          en: 'An unexpected error occurred while rendering. Reset recovers most cases; if it repeats, perform a hard restart (clears interface state and reloads).',
        })}
      </p>

      {/* 故障码（检索日志用；等宽仪表风格） */}
      <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 font-mono text-[10.5px] tracking-wide text-muted-foreground">
        <span className="led-dot h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden />
        {t({ zh: '故障码', en: 'Fault code' })}
        <span className="font-semibold text-foreground/80">{digest}</span>
      </div>

      {/* 动作排：复位（重试渲染）· 硬重启（整页重载） */}
      <div className="mt-6 flex items-center gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-md bg-primary px-5 text-[13px] font-semibold text-primary-foreground transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98]"
        >
          <Loader2 className="h-4 w-4" aria-hidden />
          {t({ zh: '复位重试', en: 'Reset & retry' })}
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-5 text-[13px] font-semibold text-foreground/85 transition-[border-color,background-color] duration-150 hover:border-foreground/30 hover:bg-muted/60"
        >
          <RefreshCw className="h-4 w-4" aria-hidden />
          {t({ zh: '硬重启', en: 'Hard restart' })}
        </button>
      </div>

      <p className="mt-6 text-[10px] leading-relaxed text-muted-foreground/70">
        {t({
          zh: '已加载的结构与会话存档不受影响——硬重启后会话恢复卡仍可接续。',
          en: 'Loaded structures and saved sessions are unaffected — the session-resume card still works after a hard restart.',
        })}
      </p>
    </div>
  )
}
