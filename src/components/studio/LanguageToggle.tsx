'use client'

// 语言切换器（r68「轨道驻留开关」；r69 全应用形态统一）
// ─────────────────────────────────────────────────────────────────────────────
// 设计概念——呼应欢迎页原子轨道视觉主题：两个「轨道位」（中文 / EN，母语名
// 惯例），一枚「电子滑块」驻留在当前语言位；切换时滑块沿轨道滑向另一位
// （probe-pop 同族回弹缓动），到位瞬间触发一次 LED「锁定」脉冲（r69：仪器
// 到位反馈语义——滑块滑到驻留位 = 仪器旋钮到位锁定）。
//
// r69 形态统一——全应用四处入口均为轨道滑块形态（消除旧分段控件混搭）：
//  · welcome  —— 欢迎页右上浮动玻璃胶囊（主入口；与右下 AI 胶囊对角呼应，
//    自带 absolute top-5 right-5 z-20 定位 + welcome-in 错峰入场）
//  · default  —— 欢迎页页脚 instrument-bar 墨色仪表滑轨（sm，紧凑次入口）
//  · toolbar  —— 工作台顶栏常驻（neutral 浅底滑轨 + Languages 图标，
//    外框沿用工具栏胶囊 border-border bg-muted/40，窄屏图标隐藏）
//  · status   —— 工作台底部状态栏（instrument 墨底紧凑 xs 滑轨，
//    与欢迎页页脚同款仪表语义）
//
// 交互细节：
//  · 键盘：Tab 逐位聚焦（原生 button）；位上 ←/→ 在两位间拨动（仪表拨杆语义）
//  · 切换即写 cookie（molvision-locale），下次首屏 SSR 直读该 cookie，零闪烁
//  · prefers-reduced-motion 下滑块过渡与锁定脉冲均退化为瞬时
import { useEffect, useRef, useState, type KeyboardEvent, type TransitionEvent } from 'react'
import { Languages } from 'lucide-react'
import { useI18n, type Locale } from '@/i18n'
import { cn } from '@/lib/utils'

const ITEMS: { key: Locale; label: string; title: string }[] = [
  { key: 'zh', label: '中文', title: '中文' },
  { key: 'en', label: 'EN', title: 'English' },
]

/** 电子滑块滑移曲线（probe-pop 同族回弹；reduced-motion 瞬时）
 *  过渡显式覆盖 transform+translate 双属性（TW4 translate-x 走原生 translate 属性） */
const SLIDE = 'transition-[transform,translate] duration-300 ease-[cubic-bezier(0.34,1.35,0.64,1)] motion-reduce:duration-0'

type Tone = 'plain' | 'instrument'
type Size = 'md' | 'sm' | 'xs'

/**
 * 双位轨道 + 电子滑块（全形态共用核心）。
 * 几何约定：容器 p-[3px]，滑块 absolute left-[3px] w-[calc(50%-3px)]——
 * 两位按钮（各占内容盒 50%）的中心与滑块两驻留位的中心严格重合；
 * en 时滑块 translate-x-full（= 自身宽度）→ 严格对称换位。
 * data-slide 暴露滑块当前驻留位（E2E 探针）。
 *  · tone：plain（常规底——胶囊/工具栏外框内）/ instrument（墨色仪表底座恒深底）
 *  · size：md（welcome h-10）/ sm（default + toolbar h-7）/ xs（status h-6）
 *  · widthClass：宽度覆写（toolbar 移动端收紧至 60px 防顶栏溢出，≥sm 恢复）
 *  · abbrevZh：中文位 <sm 显示单字「中」（工具栏窄屏沿用旧版缩写惯例）
 */
function OrbitTrack({ tone, size, widthClass, abbrevZh }: { tone: Tone; size: Size; widthClass?: string; abbrevZh?: boolean }) {
  const { locale, setLocale, t } = useI18n()
  const en = locale === 'en'

  // r69：滑块到位「锁定」LED 脉冲（translate 过渡结束挂 .lang-lock，650ms 后摘除）
  const [locked, setLocked] = useState(false)
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (lockTimer.current) clearTimeout(lockTimer.current) }, [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      setLocale(e.key === 'ArrowLeft' ? 'zh' : 'en')
    }
  }

  const onSlideSettled = (e: TransitionEvent<HTMLSpanElement>) => {
    // 只认滑块自身的位移过渡（过滤按钮 transition-colors 的冒泡 end 事件）
    if (e.propertyName !== 'translate' && e.propertyName !== 'transform') return
    setLocked(true)
    if (lockTimer.current) clearTimeout(lockTimer.current)
    lockTimer.current = setTimeout(() => setLocked(false), 700)
  }

  return (
    <div
      role="group"
      aria-label={t({ zh: '语言', en: 'Language' })}
      title={t({ zh: '切换界面语言（中 / EN）· 支持左右方向键', en: 'Switch interface language (中 / EN) · arrow keys supported' })}
      onKeyDown={onKeyDown}
      className={cn(
        'relative flex shrink-0 select-none rounded-full p-[3px]',
        size === 'md' && 'h-10 w-[120px]',
        size === 'sm' && 'h-7',
        size === 'xs' && 'h-6 w-[88px]',
        widthClass ?? (size === 'sm' && 'w-[100px]'),
        tone === 'instrument' && 'border border-white/10 bg-white/5',
      )}
    >
      {/* 电子滑块：驻留当前语言位 */}
      <span
        aria-hidden
        data-slide={en ? 'en' : 'zh'}
        onTransitionEnd={onSlideSettled}
        className={cn(
          'pointer-events-none absolute top-[3px] bottom-[3px] left-[3px] w-[calc(50%-3px)] rounded-full',
          SLIDE,
          tone === 'instrument'
            ? 'bg-[oklch(0.92_0.01_85)] shadow-[inset_0_1px_0_rgb(255_255_255/0.5),0_1px_4px_oklch(0_0_0/0.45)]'
            : 'bg-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_2px_10px_color-mix(in_oklab,var(--foreground)_20%,transparent)] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.28),0_2px_10px_oklch(0_0_0/0.35)]',
          en && 'translate-x-full',
          locked && 'lang-lock',
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
            size === 'md' && 'text-[12.5px]',
            size === 'sm' && 'text-[11px]',
            size === 'xs' && 'text-[10px]',
            tone === 'instrument'
              ? locale === it.key
                ? 'text-[oklch(0.24_0.012_80)]'
                : 'text-white/55 hover:text-white'
              : locale === it.key
                ? 'text-background'
                : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {/* 窄屏缩写（移动端工具栏空间紧张），≥sm 全名 */}
          {it.key === 'zh' && abbrevZh ? (
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

export function LanguageToggle({
  variant = 'default',
}: {
  variant?: 'status' | 'default' | 'toolbar' | 'welcome'
}) {
  // —— welcome：右上角浮动玻璃胶囊（welcome-float-chip 行为核心 + 图标 + 轨道） ——
  if (variant === 'welcome') {
    return (
      <div className="welcome-in absolute top-5 right-5 z-20" style={{ animationDelay: '500ms' }}>
        <div className="welcome-float-chip flex h-10 items-center gap-1.5 border-foreground/[0.16] bg-card/85 pl-2.5 pr-1 shadow-[0_2px_12px_oklch(0.25_0.01_80/0.1)] hover:border-foreground/30 hover:shadow-[0_5px_18px_oklch(0.25_0.01_80/0.16)] dark:border-white/[0.15] dark:bg-white/[0.07] dark:shadow-[0_2px_14px_oklch(0_0_0/0.35)] dark:hover:border-white/30 dark:hover:shadow-[0_5px_18px_oklch(0_0_0/0.42)]">
          <Languages aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary/85" />
          <OrbitTrack tone="plain" size="md" />
        </div>
      </div>
    )
  }

  // —— toolbar：工作台顶栏（muted 外框胶囊 + 图标 + 浅底滑轨；窄屏图标隐藏；
  //     移动端轨道收紧 60px + 中文缩写「中」——总宽 69px 与 r68 旧版持平，
  //     防顶栏右溢（r69 E2E 实测 375px 下旧版零冗余，任何加宽即溢出） ——
  if (variant === 'toolbar') {
    return (
      <div className="flex h-7 shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 pl-1 sm:pl-1.5 pr-[3px]">
        <Languages aria-hidden className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" />
        <OrbitTrack tone="plain" size="sm" widthClass="w-[60px] sm:w-[100px]" abbrevZh />
      </div>
    )
  }

  // —— status：工作台底部状态栏（instrument 紧凑 xs 滑轨） ——
  if (variant === 'status') {
    return <OrbitTrack tone="instrument" size="xs" />
  }

  // —— default：欢迎页页脚 instrument-bar 墨色仪表滑轨（紧凑次入口） ——
  return <OrbitTrack tone="instrument" size="sm" />
}
