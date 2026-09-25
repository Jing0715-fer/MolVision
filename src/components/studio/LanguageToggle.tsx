'use client'

// 语言切换器（仪表分段控件：中 / EN）
// 放置于 StatusBar 尾部与欢迎页 —— 任意时刻可达。切换即写 cookie（molvision-locale），
// 下次首屏 SSR 直读该 cookie，全程无闪烁。
import { Languages } from 'lucide-react'
import { useI18n, type Locale } from '@/i18n'
import { cn } from '@/lib/utils'

export function LanguageToggle({ variant = 'status' }: { variant?: 'status' | 'default' }) {
  const { locale, setLocale } = useI18n()
  const items: { key: Locale; label: string; title: string }[] = [
    { key: 'zh', label: '中', title: '中文' },
    { key: 'en', label: 'EN', title: 'English' },
  ]
  return (
    <div
      role="group"
      aria-label={locale === 'en' ? 'Language' : '语言'}
      className={cn(
        'flex shrink-0 items-center rounded-full border p-0.5',
        variant === 'status'
          ? 'border-white/10 bg-white/5 h-5'
          : 'border-border bg-muted/50 h-7',
      )}
    >
      {variant !== 'status' && <Languages className="ml-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden />}
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          onClick={() => setLocale(it.key)}
          aria-pressed={locale === it.key}
          title={it.title}
          className={cn(
            'cursor-pointer rounded-full font-semibold tracking-wide transition-colors',
            variant === 'status' ? 'px-1.5 text-[9px] leading-[14px]' : 'px-2.5 text-[11px] leading-[20px]',
            locale === it.key
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
