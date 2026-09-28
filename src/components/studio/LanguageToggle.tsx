'use client'

// 语言切换器（r68「轨道驻留开关」；r80 入口去重）
// ─────────────────────────────────────────────────────────────────────────────
// 设计概念——呼应欢迎页原子轨道视觉主题：两个「轨道位」（中文 / EN，母语名
// 惯例），一枚「电子滑块」驻留在当前语言位；切换时滑块沿轨道滑向另一位
// （probe-pop 同族回弹缓动），到位瞬间触发一次 LED「锁定」脉冲（仪器
// 到位反馈语义——滑块滑到驻留位 = 仪器旋钮到位锁定）。
//
// r80 入口去重——用户指令「语言切换只保留右下角的即可，右上重复的删掉」：
//  · 全应用仅保留两处右下角入口，顶栏重复入口（欢迎页顶栏 welcome 变体 /
//    工作台 toolbar 变体）已删除：
//    · default —— 欢迎页页脚 instrument-bar 墨色仪表滑轨（sm，唯一主入口）
//    · status  —— 工作台底部状态栏（instrument 墨底紧凑 xs 滑轨）
//
// 交互细节：
//  · 键盘：Tab 逐位聚焦（原生 button）；位上 ←/→ 在两位间拨动（仪表拨杆语义）
//  · 切换即写 cookie（molvision-locale），下次首屏 SSR 直读该 cookie，零闪烁
//  · prefers-reduced-motion 下滑块过渡与锁定脉冲均退化为瞬时
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
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
type Size = 'sm' | 'xs'

/**
 * 双位轨道 + 电子滑块（全形态共用核心）。
 * 几何约定：容器 p-[3px]，滑块 absolute left-[3px] w-[calc(50%-3px)]——
 * 两位按钮（各占内容盒 50%）的中心与滑块两驻留位的中心严格重合；
 * en 时滑块 translate-x-full（= 自身宽度）→ 严格对称换位。
 * data-slide 暴露滑块当前驻留位（E2E 探针）。
 *  · tone：plain（常规底）/ instrument（墨色仪表底座恒深底）
 *  · size：sm（default h-7）/ xs（status h-6）
 */
function OrbitTrack({ tone, size }: { tone: Tone; size: Size }) {
  const { locale, setLocale, t } = useI18n()
  const en = locale === 'en'

  // r70：锁定脉冲改点击驱动 + CSS animation-delay——类在点击同步添加，::after
  // 动画带 300ms 延迟（= 滑移时长）在合成器时间线启动，与滑块视觉到位严格同步，
  // 免疫主线程重渲阻塞（r69 实测 transitionend 在全局重渲下延迟 100-200ms）；
  // 且仅被操作的轨道脉冲（旧实现任意入口切换时全轨道皆脉冲）。
  const [locked, setLocked] = useState(false)
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (lockTimer.current) clearTimeout(lockTimer.current) }, [])

  const switchTo = (key: Locale) => {
    if (key === locale) return
    setLocale(key)
    setLocked(true)
    if (lockTimer.current) clearTimeout(lockTimer.current)
    lockTimer.current = setTimeout(() => setLocked(false), 1000)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      switchTo(e.key === 'ArrowLeft' ? 'zh' : 'en')
    }
  }

  return (
    <div
      role="group"
      aria-label={t({ zh: '语言', en: 'Language' })}
      title={t({ zh: '切换界面语言（中 / EN）· 支持左右方向键', en: 'Switch interface language (中 / EN) · arrow keys supported' })}
      onKeyDown={onKeyDown}
      className={cn(
        'relative flex shrink-0 select-none rounded-full p-[3px]',
        size === 'sm' && 'h-7 w-[100px]',
        size === 'xs' && 'h-6 w-[88px]',
        tone === 'instrument' && 'border border-white/10 bg-white/5',
      )}
    >
      {/* 电子滑块：驻留当前语言位；lang-lock 由点击同步挂上（::after 动画
          带 300ms delay 在合成器时间线与滑块到位同步起闪，见 globals.css） */}
      <span
        aria-hidden
        data-slide={en ? 'en' : 'zh'}
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
          onClick={() => switchTo(it.key)}
          aria-pressed={locale === it.key}
          title={it.title}
          className={cn(
            'relative z-[1] flex h-full w-1/2 cursor-pointer items-center justify-center rounded-full font-semibold tracking-wide transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-primary/60',
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
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function LanguageToggle({
  variant = 'default',
}: {
  variant?: 'status' | 'default'
}) {
  // —— status：工作台底部状态栏（instrument 紧凑 xs 滑轨） ——
  if (variant === 'status') {
    return <OrbitTrack tone="instrument" size="xs" />
  }

  // —— default：欢迎页页脚 instrument-bar 墨色仪表滑轨（r80 起唯一主入口） ——
  return <OrbitTrack tone="instrument" size="sm" />
}
