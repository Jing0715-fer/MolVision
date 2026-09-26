'use client'

// 语言切换器（r68 欢迎页重设计：「轨道驻留开关」）
// ─────────────────────────────────────────────────────────────────────────────
// 设计概念——呼应欢迎页原子轨道视觉主题：两个「轨道位」（中文 / EN），一枚
// 「电子滑块」驻留在当前语言位；切换时滑块沿轨道滑向另一位（probe-pop 同族
// 回弹缓动，带轻微过冲），其上位标签反色高亮，其余位保持母语名惯例显示。
//
// 形态矩阵（「任意时刻语言可达」的多入口原则不变）：
//  · variant="welcome" —— 欢迎页右上角浮动玻璃胶囊（主入口；与右下 AI 助手
//    胶囊对角呼应，自带 absolute top-5 right-5 z-20 定位，入场随整页错峰节奏）
//  · variant="default" —— 欢迎页页脚 instrument-bar 墨色仪表滑轨（紧凑次入口；
//    恒深底上亮白滑块对比鲜明，与主题/GitHub 图标钮同族气质）
//  · variant="toolbar" —— 工作台顶栏常驻（保持既有形态，零回归）
//  · variant="status"  —— 工作台底部状态栏常驻（保持既有形态，零回归）
//
// 交互细节：
//  · 键盘：Tab 逐位聚焦（原生 button）；位上 ←/→ 在两位间拨动（仪表拨杆语义）
//  · 切换即写 cookie（molvision-locale），下次首屏 SSR 直读该 cookie，零闪烁
//  · prefers-reduced-motion 下滑块过渡退化为瞬时（尊重运动偏好）
import type { KeyboardEvent } from 'react'
import { Languages } from 'lucide-react'
import { useI18n, type Locale } from '@/i18n'
import { cn } from '@/lib/utils'

const ITEMS: { key: Locale; label: string; title: string }[] = [
  { key: 'zh', label: '中文', title: '中文' },
  { key: 'en', label: 'EN', title: 'English' },
]

/** 电子滑块滑移曲线（probe-pop 同族回弹；reduced-motion 瞬时） */
const SLIDE = 'duration-300 ease-[cubic-bezier(0.34,1.35,0.64,1)] motion-reduce:duration-0'

/**
 * 双位轨道 + 电子滑块（welcome / default 形态共用核心）。
 * 几何约定：容器 p-[3px]，滑块 absolute left-[3px] w-[calc(50%-3px)]——
 * 两位按钮（各占内容盒 50%）的中心与滑块两驻留位的中心严格重合。
 * data-slide 暴露滑块当前驻留位（E2E 探针）。
 */
function OrbitTrack({ tone }: { tone: 'glass' | 'instrument' }) {
  const { locale, setLocale, t } = useI18n()
  const en = locale === 'en'

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      setLocale(e.key === 'ArrowLeft' ? 'zh' : 'en')
    }
  }

  return (
    <div
      role="group"
      aria-label={t({ zh: '语言', en: 'Language' })}
      title={t({ zh: '切换界面语言（中 / EN）· 支持左右方向键', en: 'Switch interface language (中 / EN) · arrow keys supported' })}
      onKeyDown={onKeyDown}
      className={cn(
        'relative flex select-none rounded-full p-[3px]',
        tone === 'instrument' ? 'h-7 shrink-0 border border-white/10 bg-white/5' : 'h-10 w-[120px]',
      )}
    >
      {/* 电子滑块：驻留当前语言位（en 时 translate-x-full = 自身宽度 → 严格对称换位） */}
      <span
        aria-hidden
        data-slide={en ? 'en' : 'zh'}
        className={cn(
          'pointer-events-none absolute top-[3px] bottom-[3px] left-[3px] w-[calc(50%-3px)] rounded-full transition-transform',
          SLIDE,
          tone === 'instrument'
            ? 'bg-[oklch(0.92_0.01_85)] shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_1px_4px_oklch(0_0_0/0.45)]'
            : 'bg-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_2px_10px_color-mix(in_oklab,var(--foreground)_20%,transparent)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_2px_10px_oklch(0_0_0/0.35)]',
          en && 'translate-x-full',
        )}
      />
      {ITEMS.map(it => (
        <button
          key={it.key}
          type="button"
          onClick={() => setLocale(it.key)}
          aria-pressed={locale === it.key}
          title={it.title}
          className={cn(
            'relative z-[1] flex h-full w-1/2 cursor-pointer items-center justify-center rounded-full font-semibold tracking-wide transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
            tone === 'instrument' ? 'text-[11px]' : 'text-[12.5px]',
            locale === it.key
              ? tone === 'instrument'
                ? 'text-[oklch(0.24_0.012_80)]'
                : 'text-background'
              : tone === 'instrument'
                ? 'text-white/55 hover:text-white'
                : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function LanguageToggle({
  variant = 'default',
}: {
  variant?: 'status' | 'default' | 'toolbar' | 'welcome'
}) {
  const { locale, setLocale, t } = useI18n()
  const items: { key: Locale; label: string; title: string }[] = [
    { key: 'zh', label: '中文', title: '中文' },
    { key: 'en', label: 'EN', title: 'English' },
  ]

  // —— 工作台两入口：既有分段形态原样保留（零回归） ——
  if (variant === 'toolbar' || variant === 'status') {
    return (
      <div
        role="group"
        aria-label={t({ zh: '语言', en: 'Language' })}
        title={t({ zh: '切换界面语言（中 / EN）', en: 'Switch interface language (中 / EN)' })}
        className={cn(
          'flex shrink-0 items-center rounded-full border p-0.5',
          variant === 'status' && 'border-white/10 bg-white/5 h-6 dark:border-white/10',
          variant === 'toolbar' && 'border-border bg-muted/40 h-7 gap-0.5',
        )}
      >
        {variant !== 'status' && (
          <Languages
            className={cn('text-muted-foreground', variant === 'toolbar' ? 'ml-1.5 hidden h-3.5 w-3.5 sm:block' : 'ml-2 h-4 w-4')}
            aria-hidden
          />
        )}
        {items.map(it => (
          <button
            key={it.key}
            type="button"
            onClick={() => setLocale(it.key)}
            aria-pressed={locale === it.key}
            title={it.title}
            className={cn(
              'cursor-pointer rounded-full font-semibold tracking-wide transition-colors',
              variant === 'status' && 'px-2 text-[10px] leading-[18px]',
              variant === 'toolbar' && 'px-2 text-[11px] leading-[20px] sm:px-2.5 sm:text-xs',
              locale === it.key
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {/* 窄屏缩写（移动端工具栏空间紧张），≥sm 全名 */}
            {it.key === 'zh' ? (
              <>
                <span className="sm:hidden">中</span>
                <span className="hidden sm:inline">中文</span>
              </>
            ) : it.label}
          </button>
        ))}
      </div>
    )
  }

  // —— welcome：右上角浮动玻璃胶囊（图标 + 轨道；入场随整页错峰节奏） ——
  if (variant === 'welcome') {
    return (
      <div className="welcome-in absolute top-5 right-5 z-20" style={{ animationDelay: '500ms' }}>
        <div className="flex h-10 items-center gap-1.5 rounded-full border border-foreground/[0.16] bg-card/85 pl-2.5 pr-1 shadow-[0_2px_12px_oklch(0.25_0.01_80/0.1)] backdrop-blur-sm transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-foreground/30 hover:shadow-[0_5px_18px_oklch(0.25_0.01_80/0.16)] active:translate-y-0 dark:border-white/[0.15] dark:bg-white/[0.07] dark:shadow-[0_2px_14px_oklch(0_0_0/0.35)] dark:hover:border-white/30">
          <Languages aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary/85" />
          <OrbitTrack tone="glass" />
        </div>
      </div>
    )
  }

  // —— default：页脚 instrument-bar 墨色仪表滑轨（紧凑次入口） ——
  return <OrbitTrack tone="instrument" />
}
