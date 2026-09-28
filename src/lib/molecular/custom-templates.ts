'use client'

// 用户自定义模板存储（r79）：图片上传 → AI 解析 → 审核保存的 UGC 模板层
// ─────────────────────────────────────────────────────────────────────────────
// 设计：
//  · localStorage 持久（键 molvision.customTemplates.v1），上限 20 张（超限
//    LRU 淘汰最旧——与缩略图 dataURL 一起控制存储体积 ≤ ~1MB）
//  · 入库前逐张过 sanitizeStoredTemplate：命令过 template-command-guard 白名单
//    闸（存储侧防线——localStorage 被手改/旧版本脏数据不会进渲染管线）、
//    枚举字段校验、双语字段兜底——与 /api/templates/parse 的服务端清洗同构
//  · 订阅：模块级缓存 + storage/custom-templates-changed 双事件广播，
//    useSyncExternalStore 暴露 useCustomTemplates()——弹窗与欢迎页画廊同源响应
//  · 缩略图：384px 宽 JPEG dataURL（≤40KB 量级）；QuotaExceededError 时
//    先降级去 thumb 重试、再降级丢弃最旧模板重试——配额韧性三段降
import { useSyncExternalStore } from 'react'
import { sanitizeTemplateCommands } from './template-command-guard'
import type { FigureCategory, FigureTemplate } from './figure-templates'

const KEY = 'molvision.customTemplates.v1'
const MAX_CUSTOM = 20

export interface CustomTemplate extends FigureTemplate {
  custom: true
  /** 上传图缩存（缺省时卡片退强调色渐变占位） */
  thumb?: string
  /** 创建时间（LRU 淘汰序） */
  createdAt: number
}

/** 保存入参（审核表单产出；id/createdAt/citation 由本层组装） */
export interface CustomTemplateInput {
  name: FigureTemplate['name']
  tagline: FigureTemplate['tagline']
  purpose: FigureTemplate['purpose']
  tags: FigureTemplate['tags']
  category: FigureCategory
  demo: string
  accent: FigureTemplate['accent']
  commands: string[]
  thumb?: string
}

/** 存储条目校验：字段级防线（命令过闸 + 枚举校验 + 双语兜底）——脏数据整张丢弃 */
function sanitizeStoredTemplate(raw: unknown): CustomTemplate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.custom !== true) return null
  const { commands, dropped } = sanitizeTemplateCommands(r.commands)
  if (commands.length < 2 || dropped.length) return null // 命令面必须全绿（服务端入库前已过闸）
  const CATS = ['basic', 'surface', 'conform', 'site', 'interaction', 'membrane']
  const ACCENTS = ['rose', 'emerald', 'amber', 'sky', 'violet', 'teal', 'orange', 'fuchsia', 'lime', 'cyan', 'slate']
  if (!CATS.includes(r.category as string)) return null
  if (!ACCENTS.includes(r.accent as string)) return null
  if (!/^[0-9][A-Z0-9]{3}$/.test(String(r.demo ?? ''))) return null
  const dual = (x: unknown, dz: string, de: string): { zh: string; en: string } => {
    const s = (x ?? {}) as { zh?: unknown; en?: unknown }
    return {
      zh: typeof s.zh === 'string' && s.zh.trim() ? s.zh.trim().slice(0, 40) : dz,
      en: typeof s.en === 'string' && s.en.trim() ? s.en.trim().slice(0, 80) : de,
    }
  }
  const thumb = typeof r.thumb === 'string' && r.thumb.startsWith('data:image/') ? r.thumb : undefined
  const createdAt = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now()
  return {
    id: typeof r.id === 'string' && /^custom-[a-z0-9]+$/.test(r.id) ? r.id : '',
    custom: true,
    name: dual(r.name, '自定义模板', 'Custom template'),
    tagline: dual(r.tagline, '从图片解析的图式配方', 'Style recipe parsed from an image'),
    purpose: dual(r.purpose, '复现视觉风格', 'Reproduce the visual style'),
    tags: (Array.isArray(r.tags) ? r.tags.slice(0, 3) : []).map(x => dual(x, '', '')).filter(x => x.zh || x.en),
    category: r.category as FigureCategory,
    demo: String(r.demo),
    accent: r.accent as FigureTemplate['accent'],
    citation: { journal: '自定义 · 图片解析', year: new Date(createdAt).getFullYear(), title: 'AI 从用户上传图片解析的图式配方' },
    commands,
    thumb,
    createdAt,
  }
}

// ---------- 模块级缓存 + 订阅广播（useSyncExternalStore 要求快照引用稳定） ----------
let cache: CustomTemplate[] | null = null
const listeners = new Set<() => void>()

function readStore(): CustomTemplate[] {
  if (cache) return cache
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) { cache = []; return cache }
    const list = JSON.parse(raw) as unknown
    cache = Array.isArray(list)
      ? list.map(sanitizeStoredTemplate).filter((x): x is CustomTemplate => !!x && !!x.id)
      : []
  } catch {
    cache = []
  }
  return cache
}

function persist(next: CustomTemplate[]): void {
  cache = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // 配额韧性：①去 thumb（大头是 dataURL）重试 ②仍超→逐张丢最旧（thumb 在前）
    try {
      localStorage.setItem(KEY, JSON.stringify(next.map(x => ({ ...x, thumb: undefined }))))
    } catch {
      let shrink = [...next]
      while (shrink.length > 1) {
        shrink = shrink.slice(1)
        try { localStorage.setItem(KEY, JSON.stringify(shrink)); break } catch { /* 继续丢 */ }
      }
    }
  }
  for (const fn of listeners) fn()
  // 跨标签页同步（同源多标签各自刷新快照）
  window.dispatchEvent(new CustomEvent('custom-templates-changed'))
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  const onStorage = (e: StorageEvent) => { if (e.key === KEY || e.key === null) { cache = null; fn() } }
  const onLocal = () => { cache = null; fn() }
  window.addEventListener('storage', onStorage)
  window.addEventListener('custom-templates-changed', onLocal)
  return () => {
    listeners.delete(fn)
    window.removeEventListener('storage', onStorage)
    window.removeEventListener('custom-templates-changed', onLocal)
  }
}

/** 空快照稳定引用（useSyncExternalStore 的 getServerSnapshot 必须返回缓存值——
 *  内联 () => [] 每调用新数组会触发 React「infinite loop」保护性报错并冻死页面，
 *  r79 E2E 实测揭发：上传后渲染进程 CDP 全超时的根因） */
const EMPTY_SNAPSHOT: CustomTemplate[] = []

/** 自定义模板快照（弹窗/画廊同源；SSR 安全——首渲染稳定空引用，水合后广播刷新） */
export function getCustomTemplates(): CustomTemplate[] {
  if (typeof window === 'undefined') return EMPTY_SNAPSHOT
  return readStore()
}

/** React 订阅钩子 */
export function useCustomTemplates(): CustomTemplate[] {
  return useSyncExternalStore(subscribe, getCustomTemplates, () => EMPTY_SNAPSHOT)
}

/** 新增（保存按钮）：id `custom-<base36 时间戳>`；超上限丢最旧；返回落库实例 */
export function addCustomTemplate(input: CustomTemplateInput): CustomTemplate {
  const { commands, dropped } = sanitizeTemplateCommands(input.commands)
  if (commands.length < 2 || dropped.length) {
    throw new Error('INVALID_COMMANDS')
  }
  const tpl: CustomTemplate = {
    id: `custom-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    custom: true,
    name: input.name,
    tagline: input.tagline,
    purpose: input.purpose,
    tags: input.tags.slice(0, 3),
    category: input.category,
    demo: input.demo,
    accent: input.accent,
    citation: { journal: '自定义 · 图片解析', year: new Date().getFullYear(), title: 'AI 从用户上传图片解析的图式配方' },
    commands,
    thumb: input.thumb,
    createdAt: Date.now(),
  }
  const next = [...readStore(), tpl]
  persist(next.length > MAX_CUSTOM ? next.slice(next.length - MAX_CUSTOM) : next)
  return tpl
}

/** 删除 */
export function removeCustomTemplate(id: string): void {
  persist(readStore().filter(x => x.id !== id))
}
