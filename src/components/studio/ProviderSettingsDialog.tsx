'use client'

// AI 供应商设置页：供应商卡片单选 → Base URL / 模型 / API Key 表单 → 测试连通 / 保存
// 已配置供应商列表：设为默认（单选语义）、展开编辑、删除
// 设计：暖色分层表面 + 卡片式选择器 + 精致 focus 态 + 测试结果动画反馈
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, Check, ChevronDown, ExternalLink, Eye, EyeOff, Globe, Key, Loader2,
  Plus, RefreshCw, ShieldCheck, Sparkles, Star, Trash2, Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface ProviderModelInfo { id: string; name: string; contextWindow?: number }
export interface ProviderInfo {
  id: string
  displayName: string
  label: string
  baseURL: string
  apiKeyEnv: string
  defaultModel: string
  models: ProviderModelInfo[]
  docsUrl: string
  note?: string
  hasApiKey: boolean
  hasBaseURLOverride: boolean
  effectiveModel: string
  isDefault: boolean
  maskedKey: string | null
  envKeySource: boolean
}

interface Props {
  open: boolean
  onOpenChange: (o: boolean) => void
}

/** 模型选择候选项 = 目录模型 + 当前生效模型（自定义/历史保留值不被列表吞掉） */
function modelCandidates(p: ProviderInfo): ProviderModelInfo[] {
  const list = [...p.models]
  if (p.effectiveModel && !list.some(m => m.id === p.effectiveModel)) {
    list.unshift({ id: p.effectiveModel, name: p.effectiveModel })
  }
  return list
}

export function ProviderSettingsDialog({ open, onOpenChange }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loading, setLoading] = useState(false)

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

  const configured = useMemo(() => providers.filter(p => p.hasApiKey), [providers])
  const unconfigured = useMemo(() => providers.filter(p => !p.hasApiKey && p.id !== 'zai'), [providers])
  const defaultId = useMemo(() => providers.find(p => p.isDefault)?.id ?? 'zai', [providers])

  const setDefault = async (id: string) => {
    await fetch('/api/agent/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: id, setDefault: true }),
    })
    const p = providers.find(x => x.id === id)
    toast.success(`默认供应商已切换为 ${p?.displayName ?? id}`, {
      description: id === 'zai' ? '内置 SDK 通道，无需配置' : `下次对话起经 ${p?.effectiveModel || '已配置模型'} 走直连端点`,
    })
    void refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0 sm:max-w-[520px]">
        {/* 头部 */}
        <DialogHeader className="border-b border-border/60 px-5 pb-3 pt-4">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold leading-none">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Key className="h-3.5 w-3.5" />
            </span>
            AI 供应商设置
            <button
              onClick={() => void refresh()}
              aria-label="刷新供应商状态"
              title="刷新状态"
              className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </DialogTitle>
          <DialogDescription className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            配置 OpenAI 兼容端点自选模型驱动 AI 助手；视觉自查始终使用内置 GLM-4.6V。
          </DialogDescription>
        </DialogHeader>

        <div className="mol-scroll max-h-[62vh] space-y-5 overflow-y-auto px-5 py-4">
          {/* 已配置供应商：卡片行（点击设为默认） */}
          {configured.length > 0 && (
            <section>
              <h3 className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
                <span>已配置 · {configured.length}</span>
                <span className="font-normal normal-case tracking-normal text-muted-foreground/60">点击卡片设为默认</span>
              </h3>
              <div className="space-y-1.5">
                {configured.map(p => (
                  <ProviderRow
                    key={p.id}
                    p={p}
                    isDefault={p.id === defaultId}
                    onSetDefault={() => void setDefault(p.id)}
                    onChanged={() => void refresh()}
                  />
                ))}
              </div>
            </section>
          )}

          {/* 添加新供应商 */}
          {unconfigured.length > 0 && <AddProviderForm providers={unconfigured} onSaved={() => void refresh()} />}

          {loading && providers.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载供应商目录…
            </div>
          )}
        </div>

        {/* 底部说明 */}
        <div className="flex items-center gap-2 border-t border-border/60 bg-muted/30 px-5 py-2.5 text-[10px] text-muted-foreground">
          <ShieldCheck className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
          API Key 存储在本机 .molvision/ 目录（仅服务端读取，日志与前端均不回传明文）
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** 单个已配置供应商行：标签徽章 + 名称/模型 + 默认星标；展开编辑（Key/BaseURL/模型/测试/删除） */
function ProviderRow({
  p, isDefault, onSetDefault, onChanged,
}: {
  p: ProviderInfo
  isDefault: boolean
  onSetDefault: () => void
  onChanged: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [editKey, setEditKey] = useState('')
  const [editBaseURL, setEditBaseURL] = useState('')
  const [editModel, setEditModel] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; note?: string } | null>(null)

  const toggleExpand = () => {
    if (!expanded) {
      setEditBaseURL(resolveEffectiveBase(p))
      setEditModel(p.effectiveModel || p.defaultModel)
      setEditKey('')
      setTestResult(null)
    }
    setExpanded(!expanded)
  }

  const save = async () => {
    setSaving(true)
    try {
      await fetch('/api/agent/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: p.id,
          apiKey: editKey.trim() || undefined,
          baseURL: editBaseURL.trim() || undefined,
          defaultModel: editModel.trim() || undefined,
        }),
      })
      setEditKey('')
      setExpanded(false)
      toast.success(`已更新 ${p.displayName} 配置`)
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      // 有编辑值先保存再测（测试端点读存储态）
      if (editKey.trim() || editBaseURL.trim() !== resolveEffectiveBase(p) || editModel.trim() !== (p.effectiveModel || p.defaultModel)) {
        await fetch('/api/agent/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            providerId: p.id,
            apiKey: editKey.trim() || undefined,
            baseURL: editBaseURL.trim() || undefined,
            defaultModel: editModel.trim() || undefined,
          }),
        })
      }
      const res = await fetch('/api/agent/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: p.id }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string; note?: string }
      setTestResult(data)
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  const remove = async () => {
    await fetch(`/api/agent/providers?providerId=${p.id}`, { method: 'DELETE' })
    toast.success(`已删除 ${p.displayName} 配置`)
    onChanged()
  }

  return (
    <div
      className={cn(
        'group overflow-hidden rounded-lg border transition-all duration-200',
        isDefault ? 'border-primary/45 bg-primary/[0.045] shadow-sm' : 'border-border/70 bg-card hover:border-border',
      )}
    >
      {/* 行头（点击=设为默认；右侧小按钮不冒泡） */}
      <div
        role="radio"
        aria-checked={isDefault}
        tabIndex={0}
        onClick={onSetDefault}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSetDefault() } }}
        className="flex cursor-pointer select-none items-center gap-2.5 px-3 py-2.5"
        title={isDefault ? '当前默认供应商' : `点击切换默认为 ${p.displayName}`}
      >
        <span className={cn(
          'flex h-6 w-11 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-bold tracking-wide',
          isDefault ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}>
          {p.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <span className="truncate">{p.displayName}</span>
            {p.envKeySource && (
              <span className="shrink-0 rounded bg-muted px-1 py-px text-[9px] font-normal text-muted-foreground" title={`密钥来自环境变量 ${p.apiKeyEnv}`}>env</span>
            )}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground/80">
            {p.effectiveModel || '未设模型'}{p.maskedKey && <span className="mx-1 text-muted-foreground/40">·</span>}
            {p.maskedKey && <span title="API Key 掩码">{p.maskedKey}</span>}
          </div>
        </div>
        {isDefault ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[9px] font-semibold text-primary">
            <Star className="h-2.5 w-2.5 fill-current" /> 默认
          </span>
        ) : (
          <Star className="h-3.5 w-3.5 shrink-0 text-muted-foreground/25 transition group-hover:text-muted-foreground/60" />
        )}
        <button
          onClick={e => { e.stopPropagation(); toggleExpand() }}
          aria-expanded={expanded}
          aria-label={expanded ? '收起编辑' : '展开编辑'}
          title={expanded ? '收起' : '编辑 / 测试 / 删除'}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-accent hover:text-foreground"
        >
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', expanded && 'rotate-180')} />
        </button>
      </div>

      {/* 展开编辑区 */}
      {expanded && (
        <div className="space-y-3 border-t border-border/60 bg-muted/25 px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                <Globe className="h-2.5 w-2.5" /> Base URL
              </Label>
              <Input
                value={editBaseURL}
                onChange={e => setEditBaseURL(e.target.value)}
                placeholder="https://api.example.com/v1"
                className="h-8 rounded-md bg-background font-mono text-xs shadow-none"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                <Sparkles className="h-2.5 w-2.5" /> 模型
              </Label>
              <Input
                value={editModel}
                onChange={e => setEditModel(e.target.value)}
                list={`models-${p.id}`}
                placeholder="model-id"
                className="h-8 rounded-md bg-background font-mono text-xs shadow-none"
                spellCheck={false}
              />
              <datalist id={`models-${p.id}`}>
                {modelCandidates(p).map(m => <option key={m.id} value={m.id} />)}
              </datalist>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
              <Key className="h-2.5 w-2.5" /> API Key <span className="font-normal normal-case tracking-normal text-muted-foreground/60">（留空保留现有）</span>
            </Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={editKey}
                onChange={e => setEditKey(e.target.value)}
                placeholder={`替换 ${p.displayName} 的 Key…`}
                className="h-8 rounded-md bg-background pr-8 font-mono text-xs shadow-none"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 transition hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {testResult && (
            <div className={cn(
              'flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed',
              testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300'
                : 'border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-300',
            )} role="status">
              {testResult.ok ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />}
              <span className="min-w-0 break-words">{testResult.ok ? `连接成功${testResult.note ? ` · ${testResult.note}` : ''}` : testResult.error}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-0.5">
            {p.docsUrl ? (
              <a
                href={p.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-0.5 text-[10px] text-muted-foreground/70 transition hover:text-primary"
              >
                <ExternalLink className="h-2.5 w-2.5" /> 获取 Key
              </a>
            ) : <span />}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void remove()}
                aria-label="删除此供应商配置"
                title="删除配置"
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground/70 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => void test()}
                disabled={testing}
                className="flex h-7 items-center gap-1 rounded-md border border-border/70 bg-background px-2.5 text-[11px] font-medium text-foreground/85 transition hover:border-border hover:bg-accent disabled:opacity-50"
              >
                {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3 text-amber-600 dark:text-amber-400" />}
                测试
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function resolveEffectiveBase(p: ProviderInfo): string {
  return p.baseURL
}

/** 添加供应商：卡片式网格单选 → 表单（BaseURL 自动填充 → 模型 → Key）→ 测试并保存 */
function AddProviderForm({ providers, onSaved }: { providers: ProviderInfo[]; onSaved: () => void }) {
  const [selectedId, setSelectedId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [model, setModel] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string; note?: string } | null>(null)

  const selected = providers.find(p => p.id === selectedId)

  // 选择供应商 → 自动填充
  useEffect(() => {
    if (selected) {
      setBaseURL(selected.baseURL)
      setModel(selected.defaultModel)
      setTestResult(null)
    } else {
      setBaseURL('')
      setModel('')
    }
  }, [selectedId, providers])

  const canSubmit = !!selected && apiKey.trim().length > 0 && (baseURL.trim().length > 0 || selected.id === 'zai')

  const persist = async () => {
    await fetch('/api/agent/providers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        providerId: selectedId,
        apiKey: apiKey.trim(),
        baseURL: baseURL.trim() || undefined,
        defaultModel: model.trim() || undefined,
      }),
    })
  }

  const reset = () => {
    setSelectedId('')
    setApiKey('')
    setTestResult(null)
  }

  const save = async () => {
    if (!canSubmit) return
    setSaving(true)
    try {
      await persist()
      toast.success(`已添加 ${selected?.displayName ?? selectedId}`, { description: '在上方卡片点击可设为默认供应商' })
      reset()
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  const testAndSave = async () => {
    if (!canSubmit) return
    setTesting(true)
    setTestResult(null)
    try {
      await persist()
      const res = await fetch('/api/agent/providers/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providerId: selectedId }),
      })
      const data = (await res.json()) as { ok: boolean; error?: string; note?: string }
      setTestResult(data)
      if (data.ok) {
        toast.success(`${selected?.displayName ?? selectedId} 连接成功，配置已保存`)
        reset()
        onSaved()
      }
    } catch (e) {
      setTestResult({ ok: false, error: e instanceof Error ? e.message : String(e) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/70">
        <Plus className="h-3 w-3" /> 添加供应商
      </h3>

      {/* 供应商卡片网格（两列；单选语义） */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="选择供应商">
        {providers.map(p => (
          <button
            key={p.id}
            role="radio"
            aria-checked={selectedId === p.id}
            onClick={() => setSelectedId(p.id === selectedId ? '' : p.id)}
            className={cn(
              'flex min-w-0 flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition-all duration-150',
              selectedId === p.id
                ? 'border-primary/55 bg-primary/[0.055] shadow-sm ring-1 ring-primary/25'
                : 'border-border/60 bg-card hover:border-border hover:bg-accent/50',
            )}
          >
            <span className="flex w-full items-center gap-1.5">
              <span className={cn(
                'flex h-4.5 w-9 shrink-0 items-center justify-center rounded font-mono text-[9px] font-bold tracking-wide',
                selectedId === p.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}>
                {p.label}
              </span>
              <span className={cn('truncate text-[11px] font-medium', selectedId === p.id ? 'text-foreground' : 'text-foreground/80')}>
                {p.displayName}
              </span>
            </span>
            <span className="truncate text-[9px] leading-tight text-muted-foreground/65">
              {p.note || (p.models[0] ? p.models[0].name : '兼容 /chat/completions')}
            </span>
          </button>
        ))}
      </div>

      {/* 选中后的配置表单 */}
      {selected && (
        <div className="mt-3 space-y-3 rounded-lg border border-border/70 bg-muted/25 p-3.5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                <Globe className="h-2.5 w-2.5" /> Base URL
              </Label>
              <Input
                value={baseURL}
                onChange={e => setBaseURL(e.target.value)}
                placeholder={selected.id === 'custom' ? 'https://your-gateway/v1' : '自动填充，可改'}
                className="h-8 rounded-md bg-background font-mono text-xs shadow-none"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
                <Sparkles className="h-2.5 w-2.5" /> 模型
              </Label>
              <Input
                value={model}
                onChange={e => setModel(e.target.value)}
                list={`add-models-${selected.id}`}
                placeholder={selected.defaultModel || 'model-id'}
                className="h-8 rounded-md bg-background font-mono text-xs shadow-none"
                spellCheck={false}
              />
              <datalist id={`add-models-${selected.id}`}>
                {modelCandidates(selected).map(m => <option key={m.id} value={m.id} />)}
              </datalist>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
              <Key className="h-2.5 w-2.5" /> API Key
            </Label>
            <div className="relative">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder={`输入 ${selected.displayName} 的 Key…`}
                className="h-8 rounded-md bg-background pr-8 font-mono text-xs shadow-none"
                spellCheck={false}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                aria-label={showKey ? '隐藏 Key' : '显示 Key'}
                className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground/60 transition hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            {selected.note && <p className="text-[9.5px] leading-relaxed text-muted-foreground/65">{selected.note}</p>}
          </div>

          {testResult && (
            <div className={cn(
              'flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11px] leading-relaxed',
              testResult.ok
                ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300'
                : 'border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-300',
            )} role="status">
              {testResult.ok ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />}
              <span className="min-w-0 break-words">{testResult.ok ? `连接成功${testResult.note ? ` · ${testResult.note}` : ''}，配置已保存` : testResult.error}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            {selected.docsUrl ? (
              <a
                href={selected.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-0.5 text-[10px] text-muted-foreground/70 transition hover:text-primary"
              >
                <ExternalLink className="h-2.5 w-2.5" /> 获取 Key
              </a>
            ) : <span />}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void testAndSave()}
                disabled={testing || !canSubmit}
                className="flex h-7 items-center gap-1 rounded-md border border-border/70 bg-background px-2.5 text-[11px] font-medium text-foreground/85 transition hover:border-border hover:bg-accent disabled:opacity-50"
              >
                {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3 text-amber-600 dark:text-amber-400" />}
                测试并保存
              </button>
              <button
                onClick={() => void save()}
                disabled={saving || !canSubmit}
                className="flex h-7 items-center gap-1 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
