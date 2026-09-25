'use client'

// 语言切换器（仪表分段控件：中 / EN）
// 三处入口保证任意时刻可达：
//  · Toolbar（variant="toolbar"）——顶部工具栏，主题按钮旁，主入口（28px 触达）
//  · StatusBar（variant="status"）——底部状态栏尾部，常驻
//  · WelcomeScreen（variant="default"）——欢迎页页脚
// 切换即写 cookie（molvision-locale），下次首屏 SSR 直读该 cookie，全程无闪烁。
import { Languages } from 'lucide-react'
import { useI18n, type Locale } from '@/i18n'
import { cn } from '@/lib/utils'

export function LanguageToggle({ variant = 'default' }: { variant?: 'status' | 'default' | 'toolbar' }) {
  const { locale, setLocale, t } = useI18n()
  const items: { key: Locale; label: string; title: string }[] = [
    { key: 'zh', label: '中文', title: '中文' },
    { key: 'en', label: 'EN', title: 'English' },
  ]
  return (
    <div
      role="group"
      aria-label={t({ zh: '语言', en: 'Language' })}
      title={t({ zh: '切换界面语言（中 / EN）', en: 'Switch interface language (中 / EN)' })}
      className={cn(
        'flex shrink-0 items-center rounded-full border p-0.5',
        variant === 'status' && 'border-white/10 bg-white/5 h-6 dark:border-white/10',
        variant === 'toolbar' && 'border-border bg-muted/40 h-7 gap-0.5',
        variant === 'default' && 'border-border bg-muted/50 h-8',
      )}
    >
      {variant !== 'status' && (
        <Languages
          className={cn('text-muted-foreground', variant === 'toolbar' ? 'ml-1.5 hidden h-3.5 w-3.5 sm:block' : 'ml-2 h-4 w-4')}
          aria-hidden
        />
      )}
      {items.map((it) => (
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
            variant === 'default' && 'px-3 text-xs leading-[22px]',
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
