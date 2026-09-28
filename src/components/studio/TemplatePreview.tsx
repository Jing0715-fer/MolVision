'use client'

// 解析结果「对照预览」分屏（r84，r81 方向 2 落地）
// ─────────────────────────────────────────────────────────────────────────────
// 审核表单（上传解析 / 编辑既有模板共用）里，把「读命令」升级为「看效果」：
// 左原图 / 下渲染对照——按当前表单命令在引擎里真实渲染并截取视口快照。
//
// 管线（demoThenApply 同款相机门控，r76 里程碑的复用）：
//   结构已入 store？──否→fetchPdbId + waitForStructureInStore（欢迎页首发时
//   弹窗根级挂载跨页面转变存活，引擎随后挂载冲刷 whenEngineReady 队列）
//   → whenEngineReady → 80ms 双帧余量 → waitForCameraIdle(fit 飞行落地)
//   → adaptTemplateCommands（智能适配与正式应用同路径）→ runTemplateCommands
//   （r84 起可等待：序列完成才截屏）→ 引擎 capture()（composer/AO/轮廓路径
//   自动处理，快照后恢复渲染状态）→ 展示 dataURL。
//
// 语义诚实：
//   · 渲染发生在主视口（弹窗后方）——与「演示 / 试效果」按钮同一套副作用语义，
//     CTA 文案明说「将于后台加载演示结构并应用命令」
//   · 命令/demo 修改后快照即过期——琥珀横幅「命令已修改」+ 重新渲染入口，
//     绝不拿旧图冒充新效果
//   · adapt 降级说明（notes）如实呈现（智能适配 N 项 · title 逐条）
import { useEffect, useState } from 'react'
import { Camera, Loader2, Play, RefreshCw, Wand2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import {
  adaptTemplateCommands, isStructureInStore, runTemplateCommands, waitForCameraIdle, waitForStructureInStore,
  type FigureTemplate,
} from '@/lib/molecular/figure-templates'
import { fetchPdbId } from '@/lib/molecular/loader'
import { whenEngineReady } from '@/lib/molecular/engine-ready'
import { engineRef } from '@/lib/molecular/store'

const PREVIEW_STAGES = [
  { zh: '拉取演示结构…', en: 'Fetching demo structure…' },
  { zh: '引擎挂载 · 相机取景…', en: 'Engine mounting · framing…' },
  { zh: '应用命令序列…', en: 'Applying command sequence…' },
  { zh: '截取视口…', en: 'Capturing viewport…' },
] as const

export function TemplatePreview({ tpl }: { tpl: FigureTemplate }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [stage, setStage] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  const [meta, setMeta] = useState<{ demo: string; nCmds: number; adapt: number; at: number } | null>(null)
  const [capturedSig, setCapturedSig] = useState('')
  const [errMsg, setErrMsg] = useState('')

  // 剧场式进度轮播（运行中阶段推进——真实推进由管线各段完成，这里只做观感）
  useEffect(() => {
    if (phase !== 'running') return
    const iv = setInterval(() => setStage(s => Math.min(s + 1, PREVIEW_STAGES.length - 1)), 2600)
    return () => clearInterval(iv)
  }, [phase])

  const sig = `${tpl.demo}::${tpl.commands.join('\n')}`
  const stale = phase === 'done' && url !== null && capturedSig !== sig

  const run = async () => {
    if (phase === 'running') return
    setPhase('running')
    setStage(0)
    setErrMsg('')
    try {
      // ① 演示结构：已入 store 则免拉取（重复预览零网络成本——同步单查；
      //    r84 E2E 揭发首版 waitForStructureInStore(id, 0) 伪探测恒 false）
      if (!isStructureInStore(tpl.demo)) {
        await fetchPdbId(tpl.demo)
        const ok = await waitForStructureInStore(tpl.demo, 9000)
        if (!ok) throw new Error('LOAD_TIMEOUT')
      }
      // ② 引擎就绪 + 相机取景落地（与 demoThenApply 同拍：80ms 双帧 + idle + 100ms 余量）
      await new Promise<void>(res => whenEngineReady(() => res()))
      await new Promise(r => setTimeout(r, 80))
      await waitForCameraIdle(2600)
      await new Promise(r => setTimeout(r, 100))
      // ③ 智能适配 + 顺序执行（r84 起可等待：命令序列完成再截屏）
      const { commands, notes } = adaptTemplateCommands(tpl)
      setStage(2)
      await runTemplateCommands(commands)
      await new Promise(r => setTimeout(r, 450)) // 表示重建最后一拍（cartoon/表面异步装配）
      // ④ 截取视口（capture 内部处理 composer/AO/轮廓路径并恢复渲染状态）
      const eng = engineRef.current
      if (!eng) throw new Error('NO_ENGINE')
      setStage(3)
      await new Promise(r => setTimeout(r, 60))
      const shot = eng.capture({ scale: 1.5 })
      setUrl(shot)
      setMeta({ demo: tpl.demo, nCmds: commands.length, adapt: notes.length, at: Date.now() })
      setCapturedSig(`${tpl.demo}::${tpl.commands.join('\n')}`)
      setPhase('done')
    } catch (e) {
      setPhase('error')
      setErrMsg(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div data-template-preview className="relative overflow-hidden rounded-lg border border-border bg-muted/40">
      {/* idle：CTA */}
      {phase === 'idle' && (
        <button
          type="button"
          onClick={() => void run()}
          data-preview-cta
          className="group flex aspect-[16/10] w-full cursor-pointer flex-col items-center justify-center gap-2.5 px-6 text-center transition-colors hover:bg-primary/[0.05]"
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
            <Camera className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-[12.5px] font-semibold">{t({ zh: '渲染对照预览', en: 'Render side-by-side preview' })}</span>
          <span className="max-w-[34ch] text-[10.5px] leading-relaxed text-muted-foreground">
            {t({
              zh: `将后台加载演示结构 ${tpl.demo}，按当前 ${tpl.commands.length} 条命令真实渲染并截取视口——与上方原图逐项对照`,
              en: `Loads demo structure ${tpl.demo} in the background, renders with the current ${tpl.commands.length} commands and captures the viewport — compare against the source above`,
            })}
          </span>
        </button>
      )}

      {/* running：剧场 */}
      {phase === 'running' && (
        <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2.5 bg-background/60">
          <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
          <span className="text-[11.5px] font-medium text-foreground/85">{t(PREVIEW_STAGES[stage])}</span>
          <span className="flex items-center gap-1 font-mono text-[9px] text-muted-foreground">
            {PREVIEW_STAGES.map((_, i) => (
              <span key={i} className={`h-1 w-5 rounded-full transition-colors ${i <= stage ? 'bg-primary/70' : 'bg-border'}`} />
            ))}
          </span>
        </div>
      )}

      {/* done：快照 + 元信息 */}
      {phase === 'done' && url && (
        <>
          <img src={url} alt={t({ zh: '按当前命令渲染的引擎视口快照', en: 'Engine viewport snapshot rendered with current commands' })} className="aspect-[16/10] w-full object-contain" />
          <span className="absolute left-2 top-2 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted-foreground backdrop-blur-sm">
            {t({ zh: '渲染对照', en: 'RENDER' })}
          </span>
          <span className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground backdrop-blur-sm">
            {meta && <span>{meta.demo} · {meta.nCmds} cmds</span>}
            <button
              type="button"
              onClick={() => void run()}
              data-preview-rerun
              title={t({ zh: '按当前命令重新渲染', en: 'Re-render with current commands' })}
              className="cursor-pointer text-foreground/70 transition-colors hover:text-primary"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
            </button>
          </span>
          {meta && meta.adapt > 0 && (
            <span
              className="absolute right-2 top-2 flex cursor-help items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400"
              title={t({ zh: `智能适配 ${meta.adapt} 项（与正式应用同路径）`, en: `${meta.adapt} smart adaptation(s) — same path as a real apply` })}
            >
              <Wand2 className="h-2.5 w-2.5" aria-hidden />
              {meta.adapt}
            </span>
          )}
          {/* 过期横幅：命令已改，快照不再代表当前效果 */}
          {stale && (
            <button
              type="button"
              onClick={() => void run()}
              data-preview-stale
              className="absolute inset-x-0 bottom-0 flex cursor-pointer items-center justify-center gap-1.5 border-t border-amber-500/40 bg-amber-500/15 px-2 py-1.5 text-[10px] font-semibold text-amber-700 backdrop-blur-sm transition-colors hover:bg-amber-500/25 dark:text-amber-400"
            >
              <RefreshCw className="h-3 w-3" aria-hidden />
              {t({ zh: '命令已修改——重新渲染对照', en: 'Commands changed — re-render the preview' })}
            </button>
          )}
        </>
      )}

      {/* error：诚实归因 + 重试 */}
      {phase === 'error' && (
        <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2.5 px-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <Camera className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-[11px] leading-relaxed text-red-600 dark:text-red-400" role="alert">
            {errMsg === 'LOAD_TIMEOUT'
              ? t({ zh: `演示结构 ${tpl.demo} 加载超时——检查网络后重试`, en: `Timed out loading demo structure ${tpl.demo} — check the network and retry` })
              : errMsg === 'NO_ENGINE'
                ? t({ zh: '渲染引擎尚未就绪——稍候重试', en: 'Render engine not ready yet — retry shortly' })
                : t({ zh: '预览渲染失败——请重试', en: 'Preview rendering failed — please retry' })}
          </p>
          <button
            type="button"
            onClick={() => void run()}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-muted/40 px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Play className="h-3 w-3" aria-hidden />
            {t({ zh: '重试', en: 'Retry' })}
          </button>
        </div>
      )}
    </div>
  )
}
