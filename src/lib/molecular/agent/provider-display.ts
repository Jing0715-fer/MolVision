// 供应商显示名双语助手（客户端安全模块——纯函数，零 node:/next 依赖）。
// providers.ts 是 server-only（node:fs），客户端组件禁止直接 import 其值导出。
import type { DualText } from '@/i18n/locales'

/** 供应商显示名：设置页渲染 t(providerNameText(p))，事件 toast 用 tt(...) */
export function providerNameText(p: { displayName: string; displayNameEn?: string }): DualText {
  return { zh: p.displayName, en: p.displayNameEn ?? p.displayName }
}
