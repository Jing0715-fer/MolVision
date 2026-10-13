'use client'

// 拉马钱德兰图（Ramachandran plot）QC 面板：主链 φ/ψ 散点 + favored/allowed 背景分区 + 离群残基
// 审计与选择。计算内核 src/lib/molecular/rama.ts（Lovell 2003 椭圆高斯近似分区）。
// 交互约定与接触图谱（AnalysisPanel ContactMap）同源：canvas dpr 缩放、hover DOM 提示、
// 点击行/点选择残基原子（复用全局选择通道 → 3D amber 光晕）。
import { useEffect, useMemo, useRef, useState } from 'react'
import { Spline, Crosshair, Clapperboard, Layers } from 'lucide-react'
import { dataRegistry, engineRef, useMolStore } from '@/lib/molecular/store'
import { runCommand } from '@/lib/molecular/commands'
import { computeRama, classifyRama, residueAtomRange, type RamaPoint } from '@/lib/molecular/rama'
import type { StructureData } from '@/lib/molecular/parser'
import { useI18n, tt } from '@/i18n'
import { cn } from '@/lib/utils'
import { SectionTitle } from '../LeftPanel'

// ---------- 布局常量（总宽 232 与接触图谱同格；面板最窄 232 可容纳） ----------
const CANVAS_W = 232
const PLOT = 190            // 正方形绘图区边长（px）
const PAD_L = 34            // ψ 轴刻度 + 标题
const PAD_T = 8
const PAD_R = 8
const CANVAS_H = PLOT + PAD_T + 26

/** φ/ψ → 绘图区像素（φ 横轴 ψ 纵轴；均 -180..180 线性映射，ψ 向上为正） */
function pxOf(phi: number, psi: number): { x: number; y: number } {
  return {
    x: PAD_L + (phi + 180) / 360 * PLOT,
    y: PAD_T + (180 - psi) / 360 * PLOT,
  }
}

/** 散点分类配色（与统计卡 tone 一致：favored teal / allowed amber / outlier rose） */
function clsColor(cls: number, isDark: boolean): string {
  if (cls === 0) return isDark ? 'rgba(45,212,191,0.55)' : 'rgba(13,148,136,0.55)'
  if (cls === 1) return isDark ? 'rgba(251,191,36,0.75)' : 'rgba(217,119,6,0.75)'
  return isDark ? '#fb7185' : '#e11d48'
}

/** 残基类型筛选（同时驱动散点过滤与背景分区体系——Gly/Pro 容差体系不同） */
type RamaFilter = 'all' | 'general' | 'gly' | 'pro'
const FILTERS: { key: RamaFilter; label: { zh: string; en: string }; probe: string }[] = [
  { key: 'all', label: { zh: '全部', en: 'All' }, probe: 'ALA' },
  { key: 'general', label: { zh: '通用', en: 'General' }, probe: 'ALA' },
  { key: 'gly', label: { zh: 'Gly', en: 'Gly' }, probe: 'GLY' },
  { key: 'pro', label: { zh: 'Pro', en: 'Pro' }, probe: 'PRO' },
]

/** r116-c 隔离开关偏好持久化键（'on' = 开；缺席/异常 = 默认关——与 AGENT_VISUAL_KEY
 *  同款读写模式）。「隔离审阅多个离群」是跨结构/跨会话工作流：用户逐个离群点击审阅
 *  时，每次重开面板/刷新重按开关是高频摩擦。面板级偏好（非会话数据）就地定义，
 *  不入 agent 域 protocol.ts。 */
const RAMA_ISOLATE_KEY = 'molvision-rama-row-isolate'

export function RamaSection() {
  const { t, locale } = useI18n()
  const activeId = useMolStore(s => s.activeId)
  const setSelection = useMolStore(s => s.setSelection)
  const appendLog = useMolStore(s => s.appendLog)

  const data: StructureData | null = activeId ? dataRegistry.get(activeId) ?? null : null

  // computeRama 纯函数（4HHB ~2ms 量级），data 身份稳定（dataRegistry 同结构同引用）
  const rama = useMemo(() => (data ? computeRama(data) : null), [data])

  const [filter, setFilter] = useState<RamaFilter>('all')
  const [hover, setHover] = useState<{ x: number; y: number; p: RamaPoint } | null>(null)
  const [themeTick, setThemeTick] = useState(0)
  // r115-b 离群行「隔离其余链」开关（r114 建议②后半）：多链结构（1PRC 类四链）中离群
  // 常被其他链遮挡——开启后行点击附带 isolate（只留残基所在链，同链配体/水连带保留），
  // 与影视级检视的区别：不 label 不 slab（轻量去遮挡，保留用户自己的表示与光照）。
  // 单/双链结构不渲染开关（isolate 语义上无其余链可隔，诚实隐藏而非无效展示）。
  // r116-c 偏好持久化（r115 建议③收口）：惰性初始化直读（typeof 守卫兼容 SSR 预渲染
  // ——组件在无结构时恒早退 null，双端零 DOM 输出，直读无 hydration 面；挂载 effect
  // 里 setState 会被 react-hooks/set-state-in-effect 拦截）；切换即写盘。
  const [rowIsolate, setRowIsolate] = useState(() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem(RAMA_ISOLATE_KEY) === 'on' } catch { return false }
  })
  const toggleRowIsolate = () => setRowIsolate(v => {
    const next = !v
    try { localStorage.setItem(RAMA_ISOLATE_KEY, next ? 'on' : 'off') } catch { /* 配额满静默 */ }
    return next
  })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  // 聚合物链数（蛋白 + 核酸）——多链判定驱动隔离开关的渲染
  const polymerChains = useMemo(() =>
    (data?.chains ?? []).filter(c => c.type === 'protein' || c.type === 'nucleic'), [data])

  // 主题切换重绘（canvas 填充色随 isDark 取值——MutationObserver 监听 html class）
  useEffect(() => {
    const el = document.documentElement
    const ob = new MutationObserver(() => setThemeTick(v => v + 1))
    ob.observe(el, { attributes: true, attributeFilter: ['class'] })
    return () => ob.disconnect()
  }, [])

  // 按残基类型过滤的散点（背景分区用 FILTERS.probe 驱动 classifyRama 采样）
  const points = useMemo(() => {
    if (!rama || !data) return []
    if (filter === 'all') return rama.points
    return rama.points.filter(p => {
      const rn = data.residues[p.resIdx]?.resName.toUpperCase() ?? ''
      if (filter === 'gly') return rn === 'GLY'
      if (filter === 'pro') return rn === 'PRO'
      return rn !== 'GLY' && rn !== 'PRO'
    })
  }, [rama, data, filter])

  const outliers = useMemo(() => points.filter(p => p.cls === 2), [points])
  const total = points.length
  const pct = (v: number) => total > 0 ? (v / total * 100).toFixed(1) : '0.0'

  // ---------- 绘制（散点 + 分区背景 + 构象区标注 + 轴） ----------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !rama) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = CANVAS_W * dpr
    canvas.height = CANVAS_H * dpr
    canvas.style.width = `${CANVAS_W}px`
    canvas.style.height = `${CANVAS_H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const isDark = document.documentElement.classList.contains('dark')

    // 分区背景：4° 网格采样（95×95 格，每格 2px）——allowed 联合域先铺 favored 叠上
    const STEP = 4
    for (let phi = -180; phi < 180; phi += STEP) {
      for (let psi = -180; psi < 180; psi += STEP) {
        const cls = classifyRama(phi + STEP / 2, psi + STEP / 2, FILTERS.find(f => f.key === filter)!.probe)
        if (cls === 2) continue
        const a = pxOf(phi, psi)
        ctx.fillStyle = cls === 0
          ? (isDark ? 'rgba(45,212,191,0.13)' : 'rgba(13,148,136,0.15)')
          : (isDark ? 'rgba(45,212,191,0.055)' : 'rgba(13,148,136,0.065)')
        ctx.fillRect(a.x, a.y, PLOT / (360 / STEP) + 0.5, PLOT / (360 / STEP) + 0.5)
      }
    }

    // 主流构象区标注（通用体系区心；学术图惯例）——散点之后绘制 + 同色描边光环：密集区不遣没
    // （VLM 实测：αR 标签落在密集散点下不可见——halo 保证任意密度下可读）
    const bridgeLabel = locale === 'zh' ? '桥' : 'br'
    const REG_LABELS: [number, number, string][] = filter === 'gly'
      ? [[-63, -43, 'αR'], [-120, 130, 'β'], [57, 39, 'αL'], [75, -135, 'ε']]
      : filter === 'pro'
        ? [[-60, -40, 'αR'], [-60, 145, 'PPII']]
        : [[-63, -43, 'αR'], [-120, 130, 'β'], [-142, 92, 'pPII'], [57, 39, 'αL'], [-100, 5, bridgeLabel]]
    const drawRegionLabel = (phi: number, psi: number, s: string) => {
      const a = pxOf(phi, psi)
      const w = ctx.measureText(s).width
      ctx.lineWidth = 3
      ctx.strokeStyle = isDark ? 'rgba(10,12,16,0.55)' : 'rgba(255,255,255,0.7)'
      ctx.strokeText(s, a.x - w / 2, a.y + 3)
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)'
      ctx.fillText(s, a.x - w / 2, a.y + 3)
    }
    ctx.font = '9px ui-monospace, monospace'

    // 散点：favored 先铺（小、半透明——密集区自然加深），outlier 最后（大 + 描边圈）
    for (const p of points) {
      if (p.cls === 2) continue
      const a = pxOf(p.phi, p.psi)
      ctx.fillStyle = clsColor(p.cls, isDark)
      ctx.beginPath()
      ctx.arc(a.x, a.y, 2, 0, Math.PI * 2)
      ctx.fill()
    }
    for (const p of points) {
      if (p.cls !== 2) continue
      const a = pxOf(p.phi, p.psi)
      ctx.fillStyle = clsColor(2, isDark)
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 1.25
      ctx.beginPath()
      ctx.arc(a.x, a.y, 3.4, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    for (const [phi, psi, s] of REG_LABELS) drawRegionLabel(phi, psi, s)

    // hover 点强调圈（DOM 提示之外的画面反馈）
    if (hover) {
      const a = pxOf(hover.p.phi, hover.p.psi)
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.75)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.arc(a.x, a.y, 6.5, 0, Math.PI * 2)
      ctx.stroke()
    }

    // 轴框 + 刻度 + 轴标题（VLM 实测初版 10px 太淡——11px + 提亮）
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.22)'
    ctx.lineWidth = 1
    ctx.strokeRect(PAD_L, PAD_T, PLOT, PLOT)
    ctx.font = '8px ui-monospace, monospace'
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'
    ctx.textAlign = 'center'
    for (const v of [-180, -90, 0, 90, 180]) {
      const a = pxOf(v, 0), b = pxOf(0, v)
      ctx.fillText(String(v), a.x, CANVAS_H - 12)
      ctx.textAlign = 'right'
      ctx.fillText(String(v), PAD_L - 4, b.y + 3)
      ctx.textAlign = 'center'
    }
    // 轴标题：monospace 字族与区域标签同族（DejaVu Mono 希腊覆盖完整——PIL 参考位图
    // 对照实证：11px φ 为真实字形，VLM 把像素化小字形误读为 tofu；13px 增可读性）
    ctx.font = 'italic 13px ui-monospace, monospace'
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.62)'
    ctx.fillText('φ', PAD_L + PLOT / 2, CANVAS_H - 3)
    ctx.save()
    ctx.translate(9, PAD_T + PLOT / 2)
    ctx.rotate(-Math.PI / 2)
    ctx.fillText('ψ', 0, 0)
    ctx.restore()
  }, [rama, points, filter, hover, themeTick, locale])

  // ---------- hover：最近点探测（≤7px 命中；大结构点数 ≤ 数千，线性扫描足够） ----------
  const onMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!points.length || !data) return setHover(null)
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    if (x < PAD_L || x > PAD_L + PLOT || y < PAD_T || y > PAD_T + PLOT) return setHover(null)
    let best: RamaPoint | null = null
    let bestD = 7 * 7
    for (const p of points) {
      const a = pxOf(p.phi, p.psi)
      const d = (a.x - x) * (a.x - x) + (a.y - y) * (a.y - y)
      if (d < bestD) { bestD = d; best = p }
    }
    if (!best) return setHover(null)
    const a = pxOf(best.phi, best.psi)
    setHover({ x: a.x, y: a.y, p: best })
  }

  /** 选择单个残基（点/离群行共用；复用全局选择通道 → 3D amber 光晕联动）。
   *  r114-a：离群行点击追加 focus——相机平滑聚焦该残基（fitView + 8Å 缓冲，与
   *  zoom <选择>, 8 同一通道）；散点画布点击保持仅选择（密集散点下镜头频繁跳动刺眼，
   *  行点击才是「审阅某个离群」的刻意动作）。
   *  r115-b：rowIsolate 开启时行点击附带 isolate（隔离其余链——多链去遮挡）；走
   *  runCommand 与命令行同路径，console 审计免费；顺序 isolate → fitView（先去遮挡
   *  再聚焦，镜头落位即干净画面）。 */
  const selectResidue = (p: RamaPoint, opts?: { focus?: boolean; isolate?: boolean }) => {
    if (!activeId || !data) return
    const r = data.residues[p.resIdx]
    if (!r) return
    const indices = residueAtomRange(data, p.resIdx)
    setSelection(activeId, indices)
    if (opts?.isolate) runCommand(`isolate (chain ${r.chainId.trim() || 'A'} and resi ${r.resSeq})`)
    if (opts?.focus) engineRef.current?.fitView([{ structureId: activeId, indices }], { buffer: 8 })
    appendLog('out', tt({
      zh: `拉马钱德兰：已选择${opts?.focus ? '并聚焦' : ''}${opts?.isolate ? '（已隔离其余链，isolate off 恢复）' : ''} ${r.chainId.trim()}:${r.resName}${r.resSeq}（φ ${p.phi.toFixed(0)}° · ψ ${p.psi.toFixed(0)}° · ${['优势区', '允许区', '离群'][p.cls]}）`,
      en: `Ramachandran: selected${opts?.focus ? ' and focused on' : ''}${opts?.isolate ? ' (other chains isolated; isolate off restores)' : ''} ${r.chainId.trim()}:${r.resName}${r.resSeq} (φ ${p.phi.toFixed(0)}° · ψ ${p.psi.toFixed(0)}° · ${['favored', 'allowed', 'outlier'][p.cls]})`,
    }))
  }

  /** r114-a 影视级检视：离群残基一键 zoom + isolate + label 三连（r113 建议①）。
   *  全部走 runCommand（与命令行同一条代码路径——行为一致、console 审计免费）：
   *  select（建立选择）→ isolate（隔离到残基所在链——同链 ID 配体/水连带保留）→
   *  zoom（聚焦残基， 10Å 缓冲留出侧链环境）→ label（残基原子标注）。
   *  选择子用 (chain X and resi N)（同链同号残基在多链结构中唯一限定）。
   *  r115-b 一镜到底（r114 建议②前半）：三连后 slab 切层到残基平面（±10Å 沿视线裁剪，
   *  前后遮挡剩侧链环境——影视感切层镜头）+ 环境光压暗（1 → 0.6，对比度戏剧化）；
   *  恢复链四件套在日志明示（slab off · set ambient 1 · isolate off · label off）。 */
  const cinematicInspect = (p: RamaPoint) => {
    if (!activeId || !data) return
    const r = data.residues[p.resIdx]
    if (!r) return
    const sel = `(chain ${r.chainId.trim() || 'A'} and resi ${r.resSeq})`
    runCommand(`select ${sel}`)
    runCommand(`isolate ${sel}`)
    runCommand(`zoom ${sel}, 10`)
    runCommand('label')
    runCommand('slab 20')
    runCommand('set ambient 0.6')
    appendLog('out', tt({
      zh: `拉马钱德兰：影视级检视 ${r.chainId.trim()}:${r.resName}${r.resSeq}——聚焦 + 隔离所在链 + 原子标注 + 切层镜头 + 环境光压暗（恢复：isolate off · label off · slab off · set ambient 1）`,
      en: `Ramachandran: cinematic inspection of ${r.chainId.trim()}:${r.resName}${r.resSeq} — focused + isolated to its chain + atom labels + slab clipping + dimmed ambient (restore: isolate off · label off · slab off · set ambient 1)`,
    }))
  }

  const selectAllOutliers = () => {
    if (!activeId || !data || !outliers.length) return
    const idx: number[] = []
    for (const p of outliers) idx.push(...residueAtomRange(data, p.resIdx))
    setSelection(activeId, idx)
    appendLog('out', tt({
      zh: `拉马钱德兰：已选择全部离群残基 ${outliers.length} 个（${idx.length} 原子）——模型局部位错/精修问题候选`,
      en: `Ramachandran: selected all ${outliers.length} outlier residues (${idx.length} atoms) — candidates for local model errors / refinement issues`,
    }))
  }

  const hoverRes = hover && data ? data.residues[hover.p.resIdx] : null
  const clsName = (c: number) => t({ zh: ['优势区', '允许区', '离群'][c], en: ['favored', 'allowed', 'outlier'][c] })

  if (!rama || !data) return null

  // 无连续氨基酸（核苷酸/仅配体结构）——骨架 N-CA-C 提取空
  if (!rama.points.length) {
    return (
      <>
        <SectionTitle>{t({ zh: '拉马钱德兰图 (QC)', en: 'Ramachandran plot (QC)' })}</SectionTitle>
        <div className="px-2">
          <p className="text-[10px] text-muted-foreground">
            {t({ zh: '无连续氨基酸残基——核苷酸/仅配体结构无主链 φ/ψ 可分析。', en: 'No contiguous amino-acid residues — nucleic-acid / ligand-only structures have no backbone φ/ψ to analyze.' })}
          </p>
        </div>
      </>
    )
  }

  return (
    <>
      <SectionTitle right={
        <span className="text-[10px] font-normal font-mono tabular-nums text-muted-foreground">
          {total.toLocaleString(locale)} pt · {rama.ms.toFixed(1)} ms
        </span>
      }>
        {t({ zh: '拉马钱德兰图 (QC)', en: 'Ramachandran plot (QC)' })}
      </SectionTitle>
      <div className="px-2">
        {/* 残基类型筛选（Gly/Pro 容差体系独立——分区背景随之切换） */}
        <div className="mb-1.5 flex items-center gap-1">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                'rounded px-1.5 py-0.5 font-mono text-[10px] transition',
                filter === f.key ? 'bg-primary/15 font-semibold text-primary' : 'text-muted-foreground hover:bg-accent',
              )}
            >{t(f.label)}</button>
          ))}
          <span className="ml-auto text-[9px] text-muted-foreground">● {t({ zh: '通用', en: 'general' })} ◆ Gly ▲ Pro</span>
        </div>

        {/* 散点图（hover 提示为 DOM 层——canvas 不因 hover 重绘以外的因素闪动） */}
        <div className="relative flex justify-center">
          <canvas
            ref={canvasRef}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            onClick={() => hover && selectResidue(hover.p)}
            role="img"
            aria-label={t({
              zh: `拉马钱德兰散点图：${total} 残基，离群 ${outliers.length}，点击点位选择该残基`,
              en: `Ramachandran scatter: ${total} residues, ${outliers.length} outliers; click a point to select that residue`,
            })}
            className="cursor-crosshair rounded-lg border border-border/60 bg-card"
          />
          {hover && hoverRes && (
            <div
              className="pointer-events-none absolute z-10 max-w-[210px] rounded-md border border-border bg-popover px-2 py-1.5 text-[10px] shadow-md"
              style={{
                left: Math.min(hover.x + 14, CANVAS_W - 120),
                top: Math.max(hover.y - 44, 4),
              }}
            >
              <div className="font-mono font-semibold">
                {hoverRes.chainId.trim()}:{hoverRes.resName}{hoverRes.resSeq}
                <span className={cn(
                  'ml-1.5 rounded px-1 py-px text-[9px] font-bold',
                  hover.p.cls === 2 && 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
                  hover.p.cls === 1 && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                  hover.p.cls === 0 && 'bg-teal-500/15 text-teal-600 dark:text-teal-400',
                )}>{clsName(hover.p.cls)}</span>
              </div>
              <div className="mt-0.5 font-mono tabular-nums text-muted-foreground">
                φ {hover.p.phi.toFixed(1)}° · ψ {hover.p.psi.toFixed(1)}°
              </div>
            </div>
          )}
        </div>

        {/* 三分类统计（favored/allowed/outlier 占比 + 计数） */}
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          <div className="panel-card px-2 py-1.5 text-center">
            <div className="font-mono text-[13px] font-bold tabular-nums text-teal-600 dark:text-teal-400">{pct(points.length - points.filter(p => p.cls !== 0).length)}%</div>
            <div className="text-[9px] text-muted-foreground">{t({ zh: `优势 ${points.filter(p => p.cls === 0).length}`, en: `Favored ${points.filter(p => p.cls === 0).length}` })}</div>
          </div>
          <div className="panel-card px-2 py-1.5 text-center">
            <div className="font-mono text-[13px] font-bold tabular-nums text-amber-600 dark:text-amber-400">{pct(points.filter(p => p.cls === 1).length)}%</div>
            <div className="text-[9px] text-muted-foreground">{t({ zh: `允许 ${points.filter(p => p.cls === 1).length}`, en: `Allowed ${points.filter(p => p.cls === 1).length}` })}</div>
          </div>
          <div className="panel-card px-2 py-1.5 text-center">
            <div className="font-mono text-[13px] font-bold tabular-nums text-rose-600 dark:text-rose-400">{pct(outliers.length)}%</div>
            <div className="text-[9px] text-muted-foreground">{t({ zh: `离群 ${outliers.length}`, en: `Outliers ${outliers.length}` })}</div>
          </div>
        </div>
        {rama.skipped > 0 && (
          <p className="mt-1 text-[9px] text-muted-foreground">
            {t({ zh: `链端/断链/骨架缺失跳过 ${rama.skipped} 残基`, en: `${rama.skipped} residues skipped (chain termini / breaks / missing backbone)` })}
          </p>
        )}

        {/* 离群残基清单（点击选择；离群为 QC 关注焦点——模型位错候选） */}
        {outliers.length > 0 && (
          <>
            <div className="mol-scroll panel-card mt-1.5 max-h-40 overflow-y-auto">
              <p className="mol-micro sticky top-0 z-[1] flex items-center gap-1 bg-card px-2 py-1 text-muted-foreground">
                <span className="min-w-0 flex-1 truncate">{t({ zh: `离群残基（φ/ψ 落在 3.5σ 之外）`, en: `Outlier residues (φ/ψ beyond 3.5σ)` })}</span>
                {polymerChains.length > 1 && (
                  <button
                    onClick={toggleRowIsolate}
                    aria-pressed={rowIsolate}
                    title={rowIsolate
                      ? t({ zh: '已开启（已记忆）：点击离群行同时隔离其余链（isolate off 恢复）', en: 'On (remembered): clicking an outlier row also isolates other chains (isolate off restores)' })
                      : t({ zh: '开启后点击离群行时隔离其余链——多链结构去遮挡（偏好已记忆）', en: 'When on, clicking an outlier row isolates other chains — declutter for multi-chain structures (preference remembered)' })}
                    aria-label={rowIsolate ? t({ zh: '关闭点击行时隔离其余链', en: 'Turn off isolate-other-chains on row click' }) : t({ zh: '开启点击行时隔离其余链', en: 'Turn on isolate-other-chains on row click' })}
                    className={cn(
                      'ml-auto shrink-0 rounded px-1 py-px font-mono text-[9px] transition',
                      rowIsolate ? 'bg-primary/15 font-semibold text-primary' : 'text-muted-foreground/70 hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Layers className="mr-0.5 inline h-2.5 w-2.5" aria-hidden />
                    {t({ zh: '隔离其余链', en: 'isolate' })}
                  </button>
                )}
              </p>
              {outliers.slice(0, 60).map(p => {
                const r = data.residues[p.resIdx]
                if (!r) return null
                return (
                  // r114-a 行重组：外层 div + 双按钮（嵌套 button 非法 HTML）——行点击
                  // 选择+聚焦（r113 建议①前半）；场记板图标一键影视级检视（后半）。
                  // 图标按钮 title 常显（触屏无 hover；44px 触达由行高保障）。
                  <div key={p.resIdx} className="flex items-center gap-0.5 transition hover:bg-accent/50">
                    <button
                      onClick={() => selectResidue(p, { focus: true, isolate: rowIsolate })}
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left"
                      aria-label={t({ zh: `选择并聚焦离群残基 ${r.chainId.trim()}:${r.resName}${r.resSeq}`, en: `Select and focus outlier residue ${r.chainId.trim()}:${r.resName}${r.resSeq}` })}
                    >
                      <span className="w-[74px] shrink-0 truncate font-mono text-[10px] font-medium">{r.chainId.trim()}:{r.resName}{r.resSeq}</span>
                      <span className="flex-1 font-mono text-[9px] tabular-nums text-muted-foreground">φ {p.phi.toFixed(0)}° · ψ {p.psi.toFixed(0)}°</span>
                      <Crosshair className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                    </button>
                    <button
                      onClick={() => cinematicInspect(p)}
                      title={t({ zh: '影视级检视：聚焦 + 隔离所在链 + 原子标注', en: 'Cinematic inspection: focus + isolate to its chain + atom labels' })}
                      aria-label={t({ zh: `影视级检视 ${r.chainId.trim()}:${r.resName}${r.resSeq}`, en: `Cinematic inspection of ${r.chainId.trim()}:${r.resName}${r.resSeq}` })}
                      className="mr-1 shrink-0 rounded p-1 text-muted-foreground/70 transition hover:bg-primary/10 hover:text-primary"
                    >
                      <Clapperboard className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )
              })}
              {outliers.length > 60 && (
                <p className="px-2 py-1 text-[9px] text-muted-foreground">{t({ zh: `… 共 ${outliers.length} 个，仅列前 60`, en: `… ${outliers.length} in total, showing first 60` })}</p>
              )}
            </div>
            <button
              onClick={selectAllOutliers}
              className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
            >
              <Spline className="h-3.5 w-3.5" />
              {t({ zh: `选全部离群残基（${outliers.length}）`, en: `Select all ${outliers.length} outliers` })}
            </button>
          </>
        )}
      </div>
    </>
  )
}

