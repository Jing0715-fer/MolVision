'use client'

// MolVision 国际化核心（i18n）
// ─────────────────────────────────────────────────────────────────────────────
// 设计决策（r62）：
// 1. **inline DualText**（`t({ zh, en })`）而非中央字典键 —— 并行改造零键名协调、
//    grep 可达、类型安全、后续加语言只需加字段。
// 2. **cookie 为唯一持久源**（molvision-locale），SSR 由 layout 直读 —— 首屏即正确语言，
//    无 localStorage hydrate 闪烁；zustand 内存 store 供 React 订阅。
// 3. **worker 安全**：store 不用 persist/localStorage（Worker 上下文可安全 import tt），
//    document 访问全部守卫；Worker 内默认 zh，需要时经请求载荷线程化 locale。
// 4. `tt()` 面向事件时（lib 命令输出/toast/错误），`useI18n().t` 面向 React 渲染期
//    （订阅 locale，切换即重渲）。
import { create } from 'zustand'
import { useCallback, useState } from 'react'
import { LOCALE_COOKIE, type Locale, type DualText } from './locales'

export type { Locale, DualText } from './locales'
export { LOCALE_COOKIE } from './locales'

export type TranslateInput = DualText | string

interface I18nState {
  locale: Locale
  /** 切换语言：更新 store + <html lang> + cookie（persist:false 供 SSR 初始化） */
  setLocale: (locale: Locale, opts?: { persist?: boolean }) => void
}

export const useI18nStore = create<I18nState>((set) => ({
  locale: 'zh',
  setLocale: (locale, opts) => {
    set({ locale })
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
      if (opts?.persist !== false) {
        document.cookie = `${LOCALE_COOKIE}=${locale};path=/;max-age=31536000;samesite=lax`
      }
    }
  },
}))

/** 事件时翻译（非 React 渲染期）：lib 层命令输出、toast、throw 的错误消息等 */
export function tt(text: TranslateInput): string {
  if (typeof text === 'string') return text
  return useI18nStore.getState().locale === 'en' ? text.en : text.zh
}

/** React 渲染期翻译钩子：订阅 locale —— 语言切换时所有消费组件重渲染 */
export function useI18n() {
  const locale = useI18nStore((s) => s.locale)
  const setLocale = useI18nStore((s) => s.setLocale)
  const t = useCallback(
    (text: TranslateInput) => (typeof text === 'string' ? text : locale === 'en' ? text.en : text.zh),
    [locale],
  )
  return { locale, setLocale, t }
}

/**
 * SSR 直读初始化 Provider：layout（server）读 cookie/accept-language 后传入。
 * useState 初始化器在 SSR 与客户端首渲染以相同 prop 执行 → SSR HTML 与 hydration
 * 一致，无语言闪烁。切换语言时 setLocale 会写 cookie 供下次首屏直读。
 */
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale
  children: React.ReactNode
}) {
  useState(() => {
    const s = useI18nStore.getState()
    if (s.locale !== initialLocale) s.setLocale(initialLocale, { persist: false })
    return true
  })
  return <>{children}</>
}
