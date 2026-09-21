'use client'

// AI 供应商设置 —— 双栏工作台式重构
// 左栏：可搜索的供应商目录（分类筛选 + 分组 + 状态指示）
// 右栏：所选供应商详情（品牌头部 → API Key → 模型自动检测 → 高级 Base URL）
// 核心交互：输入 API Key 后自动探测 /models 端点，检测到的真实模型进入
//           Command 检索选择器（支持直接输入自定义 ID），保存时一并落盘。
// 设计语言：中性表面 + 每家品牌色仅用于 monogram/选中条等微点缀，
//           微标签大写字距、等宽字体呈现技术值、150-200ms 过渡——专业工具质感。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check, ChevronsUpDown, CornerDownLeft, Eye, EyeOff, ExternalLink, Globe, KeyRound,
  Loader2, Lock, RefreshCw, Search, ServerCog, Star, Trash2, X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '@/components/ui/command'
import { cn } from '@/lib/utils'

// ———— 类型（与后端 ProviderStatus 对齐） ————

export type ProviderCategory = 'builtin' | 'global' | 'cn' | 'aggregator' | 'local' | 'custom'

export interface AvailableModelInfo {
  id: string
  name: string
  contextWindow?: number
  ownedBy?: string
  kind?: string
  source: 'catalog' | 'probe'
}

export interface ProviderInfo {
  id: string
  displayName: string
  label: string
  category: ProviderCategory
  brand: string
  baseURL: string
  apiKeyEnv: string
  defaultModel: string
  models: { id: string; name: string; contextWindow?: number }[]
  docsUrl: string
  website: string
  note?: string
  hasApiKey: boolean
  hasBaseURLOverride: boolean
  effectiveModel: string
  isDefault: boolean
  maskedKey: string | null
  envKeySource: boolean
  availableModels: AvailableModelInfo[]
}

/** /models 探测返回条目 */
interface DetectedModel { id: string; ownedBy?: string; contextLength?: number; kind?: string }

interface ProbeState {
  status: 'idle' | 'loading' | 'ok' | 'error'
  models: DetectedModel[]
  total: number
  note?: string
  error?: string
}

const CATEGORY_LABEL: Record<ProviderCategory, string> = {
  builtin: '内置',
  global: '国际',
  cn: '国内',
  aggregator: '聚合',
  local: '本地',
  custom: '自定义',
}

const CATEGORY_ORDER: ProviderCategory[] = ['builtin', 'global', 'cn', 'aggregator', 'local', 'custom']

const KIND_GROUP: { match: (k?: string) => boolean; label: string }[] = [
  { match: k => !k || k === 'chat', label: '对话模型' },
  { match: k => k === 'embedding', label: '向量 / 检索' },
  { match: k => k === 'image', label: '图像生成' },
  { match: k => k === 'audio', label: '语音' },
  { match: k => k === 'video', label: '视频' },
  { match: k => k === 'other', label: '其他' },
]

/** 上下文窗口人性化（1M / 128k） */
function fmtCtx(n?: number): string | null {
  if (!n || n <= 0) return null
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  return `${Math.round(n / 1000)}k`
}

/** 品牌色 monogram（供应商视觉锚点） */
function Monogram({ label, brand, size = 'md' }: { label: string; brand: string; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: brand }}
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-[6px] font-mono font-bold tracking-wide text-white ring-1 ring-black/10 dark:ring-white/10',
        size === 'md' ? 'h-6 w-6 text-[9px]' : 'h-8 w-8 text-[11px]',
      )}
    >
      {label}
    </span>
  )
}

/** 探测/目录模型条目（Command 内） */
function ModelOption({ m, active }: { m: { id: string; contextWindow?: number; ownedBy?: string; name?: string }; active: boolean }) {
  const ctx = fmtCtx(m.contextWindow)
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{m.id}</span>
      {ctx && (
        <span className="shrink-0 rounded bg-muted px-1 py-px font-mono text-[9px] tabular-nums text-muted-foreground">
          {ctx}
        </span>
      )}
      {active && <Check className="h-3 w-3 shrink-0" />}
    </div>
  )
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
}

export function ProviderSettingsDialog({ open, onOpenChange }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState('zai')
  const [search, setSearch] = useState('')
  const [cat, setCat] = useState<'all' | ProviderCategory>('all')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/agent/providers')
      if (!res.ok) return
      const data = (await res.json()) as { providers: ProviderInfo[] }
      setProviders(data.providers ?? [])
    } catch { /* 静默 */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) void refresh() }, [open, refresh])

  // 首次载入：定位到当前默认供应商
  useEffect(() => {
    if (open && providers.length > 0 && !providers.some(p => p.id === selectedId)) {
      setSelectedId(providers.find(p => p.isDefault)?.id ?? 'zai')
    }
  }, [open, providers, selectedId])

  const defaultProvider = useMemo(() => providers.find(p => p.isDefault), [providers])
  const configuredCount = useMemo(() => providers.filter(p => p.hasApiKey).length, [providers])

  // 目录过滤：搜索（名称/标签/模型）+ 分类
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return providers.filter(p => {
      if (cat !== 'all' && p.category !== cat) return false
      if (!q) return true
      return p.displayName.toLowerCase().includes(q)
        || p.label.toLowerCase().includes(q)
        || p.availableModels.some(m => m.id.toLowerCase().includes(q))
    })
  }, [providers, search, cat])

  const grouped = useMemo(() => {
    return CATEGORY_ORDER
      .map(c => ({ c, items: filtered.filter(p => p.category === c) }))
      .filter(g => g.items.length > 0)
  }, [filtered])

  const selected = providers.find(p => p.id === selectedId)

  const setDefault = async (id: string) => {
    await fetch('/api/agent/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: id, setDefault: true }),
    })
    const p = providers.find(x => x.id === id)
    toast.success(`默认供应商已切换为 ${p?.displayName ?? id}`)
    void refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex gap-0 overflow-hidden p-0 sm:w-[860px] sm:max-w-[calc(100vw-2rem)] h-[min(600px,88dvh)] w-[calc(100vw-2rem)] rounded-xl mol-elevate-lg"
      >
        <DialogTitle className="sr-only">AI 模型服务商设置</DialogTitle>
        <DialogDescription className="sr-only">
          配置 AI 助手的模型供应商：输入 API Key 后自动检测可用模型。
        </DialogDescription>

        <div className="flex min-h-0 w-full flex-col">
          {/* 顶栏 */}
          <div className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border/70 px-4">
            <span className="flex h-5.5 w-5.5 items-center justify-center rounded-md bg-primary/10 text-primary">
              <KeyRound className="h-3 w-3" />
            </span>
            <span className="text-[13px] font-semibold leading-none">模型服务商</span>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {providers.length > 0 ? `${providers.length} 家可选 · 已配置 ${configuredCount}` : '加载目录…'}
            </span>
            <div className="ml-auto flex min-w-0 items-center gap-1.5">
              {defaultProvider && (
                <button
                  onClick={() => setSelectedId(defaultProvider.id)}
                  title={`当前默认：${defaultProvider.displayName}（点击查看）`}
                  className="flex h-6 min-w-0 items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 pl-1 pr-2.5 transition hover:border-border"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span className="max-w-32 truncate text-[10px] font-medium">{defaultProvider.displayName}</span>
                  <span className="max-w-36 truncate font-mono text-[9px] text-muted-foreground">{defaultProvider.effectiveModel || '—'}</span>
                </button>
              )}
              <button
                onClick={() => void refresh()}
                aria-label="刷新供应商状态"
                title="刷新状态"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-accent hover:text-foreground"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
              </button>
              <button
                onClick={() => onOpenChange(false)}
                aria-label="关闭设置"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* 主体双栏（移动端纵向堆叠：横向供应商条 + 详情） */}
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            {/* 左栏：供应商目录（桌面） */}
            <aside className="hidden w-60 shrink-0 flex-col border-r border-border/70 bg-muted/25 sm:flex" aria-label="供应商目录">
              <div className="shrink-0 space-y-2 px-2.5 pb-2 pt-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/60" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="搜索供应商或模型…"
                    aria-label="搜索供应商"
                    className="h-8 w-full rounded-md border border-border/60 bg-background pl-7.5 pr-2 text-xs outline-none transition placeholder:text-muted-foreground/50 focus:border-ring/60 focus:ring-2 focus:ring-ring/25"
                  />
                </div>
                <div className="flex flex-wrap gap-1" role="tablist" aria-label="分类筛选">
                  {(['all', 'global', 'cn', 'aggregator', 'local'] as const).map(c => (
                    <button
                      key={c}
                      role="tab"
                      aria-selected={cat === c}
                      onClick={() => setCat(c)}
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors',
                        cat === c
                          ? 'bg-foreground text-background'
                          : 'bg-background/70 text-muted-foreground ring-1 ring-border/60 hover:text-foreground',
                      )}
                    >
                      {c === 'all' ? '全部' : CATEGORY_LABEL[c]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mol-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {loading && providers.length === 0 && (
                  <div className="space-y-1.5 px-1 pt-1">
                    {[...Array(9)].map((_, i) => (
                      <div key={i} className="h-8 animate-pulse rounded-md bg-muted" style={{ animationDelay: `${i * 60}ms` }} />
                    ))}
                  </div>
                )}
                {grouped.map(g => (
                  <div key={g.c} className="mb-1.5">
                    <p className="px-2 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">
                      {CATEGORY_LABEL[g.c]}
                      {g.c === 'builtin' ? '' : ` · ${g.items.length}`}
                    </p>
                    <div role="listbox" aria-label={CATEGORY_LABEL[g.c]} className="space-y-0.5">
                      {g.items.map(p => (
                        <button
                          key={p.id}
                          role="option"
                          aria-selected={selectedId === p.id}
                          onClick={() => setSelectedId(p.id)}
                          className={cn(
                            'group relative flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-100',
                            selectedId === p.id ? 'bg-accent' : 'hover:bg-accent/50',
                          )}
                        >
                          {selectedId === p.id && (
                            <span
                              aria-hidden
                              style={{ backgroundColor: p.brand }}
                              className="absolute left-0 top-1/2 h-4 w-[2.5px] -translate-y-1/2 rounded-full"
                            />
                          )}
                          <Monogram label={p.label} brand={p.brand} />
                          <span className={cn(
                            'min-w-0 flex-1 truncate text-xs',
                            selectedId === p.id ? 'font-medium text-foreground' : 'text-foreground/85',
                          )}>
                            {p.displayName}
                          </span>
                          {p.hasApiKey && (
                            <span aria-label="已配置" title="已配置 API Key" className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_4px_rgba(16,185,129,0.5)]" />
                          )}
                          {p.isDefault && (
                            <Star aria-label="默认供应商" className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {providers.length > 0 && filtered.length === 0 && (
                  <p className="px-2 py-6 text-center text-[11px] text-muted-foreground/60">无匹配供应商</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5 border-t border-border/70 px-3 py-2 text-[10px] leading-tight text-muted-foreground/70">
                <Lock className="h-2.5 w-2.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                Key 仅存本机 .molvision/，服务端读取，前端不回传明文
              </div>
            </aside>

            {/* 移动端：供应商横向条 */}
            <div className="mol-scroll-x flex max-h-24 shrink-0 flex-wrap gap-1.5 overflow-y-auto border-b border-border/70 px-3 py-2 sm:hidden">
              {filtered.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors',
                    selectedId === p.id ? 'border-foreground/30 bg-accent font-medium' : 'border-border/60 bg-background/70',
                  )}
                >
                  <Monogram label={p.label} brand={p.brand} size='md' />
                  <span className="max-w-28 truncate">{p.displayName}</span>
                  {p.hasApiKey && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                </button>
              ))}
            </div>

            {/* 右栏：详情 */}
            <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="供应商详情">
              {selected ? (
                <ProviderDetail
                  key={selected.id}
                  p={selected}
                  onChanged={() => void refresh()}
                  onSetDefault={() => void setDefault(selected.id)}
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground/50">
                  <ServerCog className="h-6 w-6" />
                  <p className="text-xs">从左侧目录选择供应商开始配置</p>
                </div>
              )}
            </section>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ———— 右栏详情 ————

function ProviderDetail({
  p, onChanged, onSetDefault,
}: {
  p: ProviderInfo
  onChanged: () => void
  onSetDefault: () => void
}) {
  const isLocal = p.category === 'local' || p.category === 'custom'
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [baseURL, setBaseURL] = useState(p.baseURL)
  const [model, setModel] = useState(p.effectiveModel || p.defaultModel || '')
  const [modelOpen, setModelOpen] = useState(false)
  const [modelQuery, setModelQuery] = useState('')
  const [probe, setProbe] = useState<ProbeState>({ status: 'idle', models: [], total: 0 })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const lastProbedRef = useRef('')
  const probeCtrlRef = useRef<AbortController | null>(null)

  /** /models 探测：优先用输入中的 Key（不落盘），回落存储/环境变量 */
  const runProbe = useCallback(async (opts: { reason: 'auto' | 'manual' | 'enter' }) => {
    if (p.id === 'zai') return // 内置通道走固定目录
    const key = apiKey.trim()
    if (!key && !p.hasApiKey) return
    const fp = `${key}::${baseURL.trim()}`
    if (opts.reason !== 'manual' && lastProbedRef.current === fp) return
    lastProbedRef.current = fp
    probeCtrlRef.current?.abort()
    const ctrl = new AbortController()
    probeCtrlRef.current = ctrl
    setProbe({ status: 'loading', models: [], total: 0 })
    try {
      const res = await fetch('/api/agent/providers/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: p.id, apiKey: key || undefined, baseURL: baseURL.trim() || undefined }),
        signal: ctrl.signal,
      })
      const data = (await res.json()) as { ok: boolean; models?: DetectedModel[]; total?: number; note?: string; error?: string }
      if (ctrl.signal.aborted || probeCtrlRef.current !== ctrl) return
      if (data.ok) {
        const models = data.models ?? []
        setProbe({ status: 'ok', models, total: data.total ?? models.length, note: data.note })
        if (models.length > 0) {
          if (opts.reason !== 'auto') {
            toast.success(`检测到 ${models.length} 个可用模型`, { description: `${p.displayName} · /models 列表` })
          }
          // 空模型时智能预选：目录默认 → 首个 chat 模型
          if (!model.trim()) {
            const ids = new Set(models.map(m => m.id))
            const prefer = [p.defaultModel, ...p.models.map(m => m.id)].find(x => x && ids.has(x))
            setModel(prefer ?? models.find(m => (m.kind ?? 'chat') === 'chat')?.id ?? '')
          }
        }
      } else {
        setProbe({ status: 'error', models: [], total: 0, error: data.error })
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setProbe({ status: 'error', models: [], total: 0, error: e instanceof Error ? e.message : String(e) })
      }
    } finally {
      if (probeCtrlRef.current === ctrl) probeCtrlRef.current = null
    }
  }, [p.id, p.hasApiKey, p.defaultModel, p.models, apiKey, baseURL, model])

  // 稳定引用：runProbe 闭包随表单变化，但只在供应商/配置态变化时触发自动探测
  const runProbeRef = useRef(runProbe)
  useEffect(() => { runProbeRef.current = runProbe })

  // 已配置供应商：进入即静默探测（用存储 Key）填充真实列表
  useEffect(() => {
    if (p.id !== 'zai' && p.hasApiKey) void runProbeRef.current({ reason: 'auto' })
  }, [p.id, p.hasApiKey])

  // 模型候选：探测结果 > 目录+历史（探测中显示目录 + 加载态）
  const modelList: { id: string; contextWindow?: number; ownedBy?: string; kind?: string; name?: string }[] = useMemo(() => {
    if (probe.status === 'ok' && probe.models.length > 0) return probe.models
    return p.availableModels.map(m => ({ id: m.id, contextWindow: m.contextWindow, ownedBy: m.ownedBy, kind: m.kind, name: m.name }))
  }, [probe, p.availableModels])

  const modelNotInList = !!model.trim() && modelList.length > 0 && !modelList.some(m => m.id === model.trim())
  const keyDirty = apiKey.trim().length > 0
  const canSave = p.id === 'zai' || (!p.hasApiKey ? keyDirty : true) || keyDirty || !!model.trim()

  const save = async () => {
    setSaving(true)
    try {
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: p.id,
          apiKey: apiKey.trim() || undefined,
          baseURL: baseURL.trim() || undefined,
          defaultModel: model.trim() || undefined,
          ...(probe.status === 'ok' && probe.models.length > 0 ? { discoveredModels: probe.models } : {}),
        }),
      })
      setApiKey('')
      toast.success(`已保存 ${p.displayName} 配置`, {
        description: p.isDefault ? '该供应商即当前默认，下次对话生效' : '在顶栏徽章处可切换默认供应商',
      })
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    setDeleting(true)
    try {
      await fetch(`/api/agent/providers?providerId=${p.id}`, { method: 'DELETE' })
      toast.success(`已删除 ${p.displayName} 配置`)
      setApiKey('')
      setModel(p.defaultModel || '')
      setProbe({ status: 'idle', models: [], total: 0 })
      lastProbedRef.current = ''
      onChanged()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="provider-detail-in flex min-h-0 flex-1 flex-col">
      {/* 品牌头部 */}
      <div className="flex shrink-0 items-start gap-3 border-b border-border/70 px-4 py-3.5">
        <Monogram label={p.label} brand={p.brand} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="text-sm font-semibold leading-tight">{p.displayName}</h3>
            <span className="rounded bg-muted px-1.5 py-px text-[9px] font-medium text-muted-foreground">
              {CATEGORY_LABEL[p.category]}
            </span>
            {p.isDefault && (
              <span className="flex items-center gap-0.5 rounded-full bg-amber-500/10 px-1.5 py-px text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                <Star className="h-2.5 w-2.5 fill-current" /> 默认
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="font-mono">{p.effectiveModel || '未配置模型'}</span>
            {p.maskedKey && (
              <span className="font-mono" title={p.envKeySource ? `来自环境变量 ${p.apiKeyEnv}` : '本地存储'}>{p.maskedKey}</span>
            )}
            {p.envKeySource && <span className="rounded bg-muted px-1 py-px text-[9px]">env</span>}
            {p.website && (
              <a href={p.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 transition hover:text-foreground">
                官网 <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
            {p.docsUrl && (
              <a href={p.docsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 transition hover:text-foreground">
                获取 Key <ExternalLink className="h-2.5 w-2.5" />
              </a>
            )}
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[9px] font-semibold',
            p.hasApiKey ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground',
          )}
        >
          {p.hasApiKey ? '已配置' : '未配置'}
        </span>
      </div>

      {/* 表单体 */}
      <div className="mol-scroll min-h-0 flex-1 space-y-4.5 overflow-y-auto px-4 py-4">
        {/* API Key */}
        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor={`key-${p.id}`} className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              <KeyRound className="h-2.5 w-2.5" /> API Key
            </label>
            {p.id !== 'zai' && (
              <button
                onClick={() => void runProbe({ reason: 'manual' })}
                disabled={probe.status === 'loading' || (!keyDirty && !p.hasApiKey)}
                className="flex items-center gap-1 rounded text-[10px] font-medium text-primary/90 transition hover:text-primary disabled:opacity-40"
                title="用当前输入的 Key 立即检测可用模型"
              >
                {probe.status === 'loading'
                  ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  : <RefreshCw className="h-2.5 w-2.5" />}
                检测模型
              </button>
            )}
          </div>
          <div className="relative">
            <input
              id={`key-${p.id}`}
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onBlur={() => {
                const k = apiKey.trim()
                if (k.length >= 8) void runProbe({ reason: 'auto' })
              }}
              onPaste={() => { setTimeout(() => { if (apiKey.trim().length >= 8) void runProbe({ reason: 'auto' }) }, 500) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void runProbe({ reason: 'enter' }) } }}
              placeholder={p.id === 'zai' ? '内置通道，无需 API Key' : p.hasApiKey ? '留空保留现有 Key' : isLocal ? '本地服务可填任意值（如 none）' : `粘贴 ${p.label} 的 Key 后自动检测模型…`}
              autoComplete="off"
              spellCheck={false}
              disabled={p.id === 'zai'}
              className="h-9 w-full rounded-md border border-border/70 bg-background pr-9 pl-3 font-mono text-xs outline-none transition placeholder:font-sans placeholder:text-muted-foreground/45 focus:border-ring/60 focus:ring-2 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button
              type="button"
              onClick={() => setShowKey(v => !v)}
              aria-label={showKey ? '隐藏 Key' : '显示 Key'}
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 transition hover:text-foreground"
            >
              {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
          {/* 探测反馈行 */}
          <ProbeFeedback probe={probe} hasStored={p.hasApiKey} onRetry={() => void runProbe({ reason: 'manual' })} />
        </section>

        {/* 模型选择 */}
        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              <ServerCog className="h-2.5 w-2.5" /> 模型
            </label>
            <span className="text-[9px] text-muted-foreground/50">
              {probe.status === 'ok' && probe.models.length > 0
                ? `已检测 ${probe.total} 个`
                : probe.status === 'ok'
                  ? '端点连通，列表不可用'
                  : '目录预设 · 可搜索后直接输入自定义 ID'}
            </span>
          </div>

          <Popover open={modelOpen} onOpenChange={setModelOpen}>
            <PopoverTrigger asChild>
              <button
                role="combobox"
                aria-expanded={modelOpen}
                aria-controls={`model-list-${p.id}`}
                aria-haspopup="listbox"
                className={cn(
                  'flex h-9 w-full items-center gap-2 rounded-md border border-border/70 bg-background px-3 text-left transition focus:border-ring/60 focus:ring-2 focus:ring-ring/25',
                  modelNotInList && 'border-amber-500/50',
                )}
              >
                <span className={cn('min-w-0 flex-1 truncate font-mono text-xs', model ? 'text-foreground' : 'text-muted-foreground/45')}>
                  {model || '选择或输入模型 ID…'}
                </span>
                {probe.status === 'loading' && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground/60" />}
                {probe.status === 'ok' && probe.models.length > 0 && (
                  <span className="probe-pop shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-px font-mono text-[9px] font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {probe.total}
                  </span>
                )}
                <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
              <Command>
                <CommandInput
                  value={modelQuery}
                  onValueChange={setModelQuery}
                  placeholder="搜索模型，或输入自定义 ID 后选择…"
                  className="h-8 text-xs"
                />
                <CommandList id={`model-list-${p.id}`} className="mol-scroll max-h-64 py-1">
                  <CommandEmpty className="py-3 text-center text-[11px] text-muted-foreground">
                    无匹配模型——直接输入自定义 ID 选择
                  </CommandEmpty>
                  {KIND_GROUP.map(g => {
                    const items = modelList.filter(m => g.match(m.kind))
                    if (items.length === 0) return null
                    return (
                      <CommandGroup key={g.label} heading={g.label}>
                        {items.slice(0, 200).map(m => (
                          <CommandItem
                            key={m.id}
                            value={`${m.id} ${m.name ?? ''} ${m.ownedBy ?? ''}`}
                            onSelect={() => { setModel(m.id); setModelOpen(false) }}
                            className="gap-2 text-xs"
                          >
                            <ModelOption m={m} active={model === m.id} />
                          </CommandItem>
                        ))}
                        {items.length > 200 && (
                          <p className="px-2 py-1 text-[9px] text-muted-foreground/50">…还有 {items.length - 200} 个，请搜索缩小范围</p>
                        )}
                      </CommandGroup>
                    )
                  })}
                  {/* 搜索词直接作为自定义模型 ID（私有部署/最新模型） */}
                  {modelQuery.trim().length >= 2 && !modelList.some(m => m.id === modelQuery.trim()) && (
                    <CommandGroup heading="自定义">
                      <CommandItem value={`__custom__${modelQuery.trim()}`} onSelect={() => { setModel(modelQuery.trim()); setModelOpen(false) }} className="gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{modelQuery.trim()}</span>
                        <span className="shrink-0 rounded bg-primary/10 px-1.5 py-px text-[9px] font-medium text-primary">使用此 ID</span>
                      </CommandItem>
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>

          {modelNotInList && (
            <p className="text-[10px] leading-relaxed text-amber-600 dark:text-amber-400/90">
              当前模型不在检测列表中——若为自定义部署 ID 属正常，保存即可
            </p>
          )}
        </section>

        {/* Base URL（高级） */}
        <section className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor={`base-${p.id}`} className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              <Globe className="h-2.5 w-2.5" /> Base URL
              {p.hasBaseURLOverride && <span className="rounded bg-muted px-1 py-px font-normal normal-case tracking-normal text-[9px]">自定义</span>}
            </label>
            <span className="text-[9px] text-muted-foreground/50">代理 / 私有部署时修改</span>
          </div>
          <input
            id={`base-${p.id}`}
            value={baseURL}
            onChange={e => setBaseURL(e.target.value)}
            onBlur={() => { if (baseURL.trim() && lastProbedRef.current !== `${apiKey.trim()}::${baseURL.trim()}`) void runProbe({ reason: 'auto' }) }}
            placeholder={isLocal ? 'http://localhost:11434/v1' : 'https://api.example.com/v1'}
            spellCheck={false}
            className="h-9 w-full rounded-md border border-border/70 bg-background px-3 font-mono text-xs outline-none transition placeholder:text-muted-foreground/45 focus:border-ring/60 focus:ring-2 focus:ring-ring/25"
          />
        </section>

        {/* 说明 */}
        {p.note && (
          <p className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            {p.note}
          </p>
        )}
      </div>

      {/* 底部操作条 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 bg-muted/25 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-1.5">
          {p.id !== 'zai' && p.hasApiKey && (
            <button
              onClick={() => void remove()}
              disabled={deleting}
              className="flex h-7 items-center gap-1 rounded-md border border-border/60 px-2 text-[11px] text-muted-foreground/80 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50"
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              删除
            </button>
          )}
          {p.hasApiKey && !p.isDefault && (
            <button
              onClick={onSetDefault}
              className="flex h-7 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 text-[11px] font-medium text-amber-700 transition hover:bg-amber-500/20 dark:text-amber-400"
            >
              <Star className="h-3 w-3" /> 设为默认
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="hidden items-center gap-0.5 text-[9px] text-muted-foreground/45 sm:flex">
            <CornerDownLeft className="h-2.5 w-2.5" /> Key 输入框回车即检测
          </span>
          <button
            onClick={() => void save()}
            disabled={saving || !canSave}
            className="mol-btn-primary flex h-7 items-center gap-1.5 rounded-md bg-primary px-3.5 text-[11px] font-medium text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            保存配置
          </button>
        </div>
      </div>
    </div>
  )
}

/** 探测状态反馈行（Key 输入框下方） */
function ProbeFeedback({ probe, hasStored, onRetry }: { probe: ProbeState; hasStored: boolean; onRetry: () => void }) {
  if (probe.status === 'loading') {
    return (
      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        正在检测可用模型…
      </p>
    )
  }
  if (probe.status === 'ok') {
    return (
      <p className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        {probe.models.length > 0
          ? `已连通 · 检测到 ${probe.total} 个模型（下方模型列表已更新）`
          : `已连通${probe.note ? ` · ${probe.note}` : ''}`}
      </p>
    )
  }
  if (probe.status === 'error') {
    return (
      <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-red-600 dark:text-red-400">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
        <span className="min-w-0 flex-1 break-words">{probe.error}</span>
        <button onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2 transition hover:opacity-70">
          重试
        </button>
      </p>
    )
  }
  return (
    <p className="text-[10px] text-muted-foreground/55">
      {hasStored ? '已保存 Key——粘贴新值可替换，留空保留' : '输入 Key 后自动检测该账号可用的模型列表'}
    </p>
  )
}
