'use client'

// 分析面板：界面接触检测（表达式组 A/B + 距离截断）+ 2D 接触图谱 + 界面残基选择 + SASA/ΔSASA + DSSP 重算
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, Trash2, MousePointerClick, Network, RefreshCw, Droplets, Palette, Layers } from 'lucide-react'
import { dataRegistry, engineRef, useMolStore, buildNamedMasks } from '@/lib/molecular/store'
import { runContactAnalysis, runBuriedSasa, interfaceAtomIndices } from '@/lib/molecular/contacts'
import { useContactStore } from '@/lib/molecular/contacts-store'
import { useSasaStore } from '@/lib/molecular/sasa-store'
import { evaluateSelection } from '@/lib/molecular/selection'
import { cn } from '@/lib/utils'
import { SectionTitle, PanelHint } from '../LeftPanel'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

/** 接触图谱 canvas 尺寸（含 28px 轴标区） */
const MAP_PAD = 30
const MAP_SIZE = 232

/** 距离 → 图谱颜色（近 = 亮红，远 = 深琥珀；与 3D 连线同族） */
function heatColor(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t))
  return [Math.round(239 + 6 * c), Math.round(68 + 90 * c), Math.round(68 - 57 * c)]
}

export function AnalysisPanel() {
  const activeId = useMolStore(s => s.activeId)
  const structures = useMolStore(s => s.structures)
  const setSelection = useMolStore(s => s.setSelection)
  const appendLog = useMolStore(s => s.appendLog)
  const recomputeSS = useMolStore(s => s.recomputeSS)
  const aExpr = useContactStore(s => s.aExpr)
  const bExpr = useContactStore(s => s.bExpr)
  const cutoff = useContactStore(s => s.cutoff)
  const visible = useContactStore(s => s.visible)
  const pairs = useContactStore(s => s.pairs)
  const residuesA = useContactStore(s => s.residuesA)
  const residuesB = useContactStore(s => s.residuesB)
  const structureId = useContactStore(s => s.structureId)
  const errors = useContactStore(s => s.errors)
  const defaulted = useContactStore(s => s.defaulted)
  const setExpr = useContactStore(s => s.setExpr)
  const setCutoff = useContactStore(s => s.setCutoff)
  const setVisible = useContactStore(s => s.setVisible)
  const clear = useContactStore(s => s.clear)
  // SASA 状态
  const sasaComputing = useSasaStore(s => s.computing)
  const sasaStructureId = useSasaStore(s => s.structureId)
  const sasaTotal = useSasaStore(s => s.total)
  const sasaHydrophobic = useSasaStore(s => s.hydrophobic)
  const sasaPolar = useSasaStore(s => s.polar)
  const sasaHet = useSasaStore(s => s.het)
  const sasaMs = useSasaStore(s => s.ms)
  const sasaProbe = useSasaStore(s => s.probe)
  const sasaPoints = useSasaStore(s => s.nPoints)
  const topResidues = useSasaStore(s => s.topResidues)
  const buried = useSasaStore(s => s.buried)
  const applyColor = useMolStore(s => s.applyColor)

  // SASA 参数本地态（运行时才写入 store）
  const [probe, setProbe] = useState(1.4)
  const [nPoints, setNPoints] = useState(92)

  const entry = structures.find(s => s.id === activeId) ?? null
  const data = activeId ? dataRegistry.get(activeId) : null
  const stale = structureId !== null && structureId !== activeId

  // 切换结构时填充默认表达式（前两条聚合物链），仅当用户未自定义
  useEffect(() => {
    if (!data || defaulted) return
    const polymer = data.chains.filter(c => c.type === 'protein' || c.type === 'nucleic')
    if (polymer.length >= 2) {
      useContactStore.setState({ aExpr: `chain ${polymer[0].id.trim()}`, bExpr: `chain ${polymer[1].id.trim()}`, defaulted: true })
    } else if (polymer.length === 1) {
      useContactStore.setState({ aExpr: `chain ${polymer[0].id.trim()}`, bExpr: 'ligand', defaulted: true })
    }
  }, [data, defaulted])

  // 表达式实时计数（输入反馈）
  const counts = useMemo(() => {
    if (!data || !activeId) return { a: 0, b: 0 }
    const named = buildNamedMasks(activeId, data)
    const ra = aExpr.trim() ? evaluateSelection(aExpr, { structure: data, named }) : null
    const rb = bExpr.trim() ? evaluateSelection(bExpr, { structure: data, named }) : null
    return { a: ra?.count ?? 0, b: rb?.count ?? 0 }
  }, [data, activeId, aExpr, bExpr])

  const run = useCallback(() => {
    const outcome = runContactAnalysis()
    appendLog(outcome.ok ? 'out' : 'err', outcome.message)
  }, [appendLog])

  // SASA 运行（小结构同步完成即有结果；大结构 worker 异步，完成后 sasa-store 更新）
  const runSasa = useCallback(() => {
    if (!activeId) return
    const r = engineRef.current?.requestSasa(activeId, { probe, nPoints })
    if (!r) return appendLog('err', '渲染引擎未就绪')
    if (r.done && r.stats) {
      const st = r.stats
      appendLog('out', `SASA（Shrake–Rupley，probe ${probe} Å，${nPoints} 点）：总计 ${st.total.toFixed(0)} Å² · 疏水 ${st.hydrophobic.toFixed(0)} · 极性 ${st.polar.toFixed(0)} · ${st.ms.toFixed(0)} ms`)
    } else {
      appendLog('out', `SASA 计算中（Web Worker，probe ${probe} Å，${nPoints} 点）…`)
    }
  }, [activeId, probe, nPoints, appendLog])

  const runBsa = useCallback(() => {
    const outcome = runBuriedSasa()
    appendLog(outcome.ok ? 'out' : 'err', outcome.message)
  }, [appendLog])

  // ---------- 2D 接触图谱 ----------
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; pairIdx: number } | null>(null)
  const mapData = data && structureId === activeId && pairs.length ? { data, pairs } : null

  // 行列残基索引（按链序 + 残基序）
  const axis = useMemo(() => {
    if (!mapData) return null
    const { data: d, pairs: ps } = mapData
    const idxA = [...new Set(ps.map(p => p.resA))].sort((a, b) => a - b)
    const idxB = [...new Set(ps.map(p => p.resB))].sort((a, b) => a - b)
    const posA = new Map<number, number>()
    const posB = new Map<number, number>()
    idxA.forEach((ri, i) => posA.set(ri, i))
    idxB.forEach((ri, i) => posB.set(ri, i))
    // cell 尺寸（限制最大，避免大残基数时过小）
    const cw = Math.max(1, Math.min(14, Math.floor((MAP_SIZE - MAP_PAD * 2) / Math.max(1, idxB.length))))
    const ch = Math.max(1, Math.min(14, Math.floor((MAP_SIZE - MAP_PAD * 2) / Math.max(1, idxA.length))))
    const gridW = cw * idxB.length, gridH = ch * idxA.length
    return { idxA, idxB, posA, posB, cw, ch, gridW, gridH, pairs: ps }
  }, [mapData])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !axis || !mapData) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const W = MAP_PAD * 2 + axis.gridW
    const H = MAP_PAD * 2 + axis.gridH
    canvas.width = W * dpr
    canvas.height = H * dpr
    canvas.style.width = `${W}px`
    canvas.style.height = `${H}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const isDark = document.documentElement.classList.contains('dark')
    // 背景
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'
    ctx.fillRect(MAP_PAD, MAP_PAD, axis.gridW, axis.gridH)
    // 单元格
    for (const p of axis.pairs) {
      const cx = axis.posA.get(p.resA)
      const cy = axis.posB.get(p.resB)
      if (cx === undefined || cy === undefined) continue
      const t = (p.minDist - 2.5) / Math.max(0.5, cutoff - 2.5)
      const [r, g, b] = heatColor(t)
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.fillRect(MAP_PAD + cy * axis.cw, MAP_PAD + cx * axis.ch, Math.max(1, axis.cw - 0.5), Math.max(1, axis.ch - 0.5))
    }
    // 链边界线 + 轴标
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)'
    ctx.lineWidth = 1
    ctx.font = '8px ui-monospace, monospace'
    ctx.fillStyle = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'
    const labelTick = (ri: number, kind: 'A' | 'B') => {
      const res = mapData.data.residues[ri]
      const label = `${res.chainId.trim()}${res.resSeq}`
      return kind === 'A' ? label : label
    }
    // Y 轴（A 残基）标签抽样
    const yStep = Math.max(1, Math.ceil(axis.idxA.length / 12))
    for (let i = 0; i < axis.idxA.length; i += yStep) {
      const label = labelTick(axis.idxA[i], 'A')
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'
      ctx.fillText(label, 2, MAP_PAD + i * axis.ch + axis.ch / 2 + 3)
      // 链切换处画分隔线
      const next = axis.idxA[i + 1]
      const cur = axis.idxA[i]
      if (next !== undefined && mapData.data.residues[next].chainId !== mapData.data.residues[cur].chainId) {
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
        ctx.beginPath()
        ctx.moveTo(MAP_PAD, MAP_PAD + (i + 1) * axis.ch)
        ctx.lineTo(MAP_PAD + axis.gridW, MAP_PAD + (i + 1) * axis.ch)
        ctx.stroke()
      }
    }
    // X 轴（B 残基）标签抽样（旋转 90°）
    const xStep = Math.max(1, Math.ceil(axis.idxB.length / 12))
    ctx.save()
    for (let j = 0; j < axis.idxB.length; j += xStep) {
      const label = labelTick(axis.idxB[j], 'B')
      ctx.save()
      ctx.translate(MAP_PAD + j * axis.cw + axis.cw / 2, MAP_PAD + axis.gridH + 4)
      ctx.rotate(Math.PI / 4)
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.55)'
      ctx.fillText(label, 0, 7)
      ctx.restore()
      const next = axis.idxB[j + 1]
      const cur = axis.idxB[j]
      if (next !== undefined && mapData.data.residues[next].chainId !== mapData.data.residues[cur].chainId) {
        ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)'
        ctx.beginPath()
        ctx.moveTo(MAP_PAD + (j + 1) * axis.cw, MAP_PAD)
        ctx.lineTo(MAP_PAD + (j + 1) * axis.cw, MAP_PAD + axis.gridH)
        ctx.stroke()
      }
    }
    ctx.restore()
  }, [axis, mapData, cutoff])

  // 图谱交互：hover 提示 + 点击选择残基对
  const onMapMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!axis || !mapData) return setHover(null)
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    const col = Math.floor((x - MAP_PAD) / axis.cw)
    const row = Math.floor((y - MAP_PAD) / axis.ch)
    if (col < 0 || row < 0 || col >= axis.idxB.length || row >= axis.idxA.length) return setHover(null)
    const resA = axis.idxA[row], resB = axis.idxB[col]
    const pair = mapData.pairs.find(p => p.resA === resA && p.resB === resB)
    setHover(pair ? { x, y, pairIdx: mapData.pairs.indexOf(pair) } : null)
  }
  const onMapClick = () => {
    if (!hover || !mapData || !activeId) return
    const p = mapData.pairs[hover.pairIdx]
    const d = mapData.data
    const idx: number[] = []
    for (let i = d.residues[p.resA].start; i < d.residues[p.resA].end; i++) idx.push(i)
    for (let i = d.residues[p.resB].start; i < d.residues[p.resB].end; i++) idx.push(i)
    setSelection(activeId, idx)
    appendLog('out', `已选择接触残基对：${d.residues[p.resA].chainId.trim()}:${d.residues[p.resA].resName}${d.residues[p.resA].resSeq} ↔ ${d.residues[p.resB].chainId.trim()}:${d.residues[p.resB].resName}${d.residues[p.resB].resSeq}（${p.minDist.toFixed(2)} Å，${p.count} 个原子对）`)
  }

  // ---------- 选择界面残基 ----------
  const selectSide = (side: 'a' | 'b' | 'both') => {
    if (!activeId || !data || !structureId || structureId !== activeId) return
    const idx = side === 'a'
      ? interfaceAtomIndices(data, residuesA)
      : side === 'b'
        ? interfaceAtomIndices(data, residuesB)
        : [...interfaceAtomIndices(data, residuesA), ...interfaceAtomIndices(data, residuesB)]
    setSelection(activeId, idx)
    appendLog('out', `已选择${side === 'a' ? 'A 侧' : side === 'b' ? 'B 侧' : '全部'}界面残基：${idx.length} 原子（${side === 'a' ? residuesA.length : side === 'b' ? residuesB.length : residuesA.length + residuesB.length} 残基）`)
  }

  const hasResult = structureId === activeId && pairs.length > 0
  const hoverPair = hover && mapData ? mapData.pairs[hover.pairIdx] : null

  return (
    <div className="pb-4">
      <SectionTitle right={
        <span className="text-[10px] font-normal text-muted-foreground">
          {entry ? entry.name : '无活动结构'}
        </span>
      }>
        界面接触检测
      </SectionTitle>

      {!entry && (
        <PanelHint>加载结构后，检测两组原子选择间的重原子接触（≤ 距离截断），获得残基级界面与 2D 接触图谱。</PanelHint>
      )}

      {entry && (
        <>
          <div className="space-y-2 px-2">
            <ExprInput
              label="A 组" tone="rose"
              value={aExpr} onChange={v => setExpr('a', v)}
              count={counts.a} error={errors.a}
              placeholder="如 chain A / resn HEM / within 8 of ..."
            />
            <ExprInput
              label="B 组" tone="cyan"
              value={bExpr} onChange={v => setExpr('b', v)}
              count={counts.b} error={errors.b}
              placeholder="如 chain B / protein / ligand"
            />
            <div className="rounded-lg border border-border/60 px-2.5 py-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">距离截断</span>
                <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">{cutoff.toFixed(1)} Å</span>
              </div>
              <Slider
                value={[cutoff]}
                min={3} max={8} step={0.5}
                onValueChange={([v]) => setCutoff(v)}
                className="mt-1.5"
              />
            </div>
            <div className="flex gap-1.5">
              <button
                onClick={run}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90"
              >
                <Play className="h-3.5 w-3.5" />
                分析接触
              </button>
              {hasResult && (
                <button
                  onClick={() => { clear(); engineRef.current?.updateContacts() }}
                  title="清除结果与连线"
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition hover:border-destructive/50 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {stale && (
            <p className="mx-2 mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              结果属于其它结构，重新运行分析以更新。
            </p>
          )}

          {hasResult && (
            <>
              <SectionTitle right={
                <div className="flex items-center gap-2">
                  <label className="flex cursor-pointer items-center gap-1 text-[10px] text-muted-foreground">
                    <Switch
                      checked={visible}
                      onCheckedChange={v => { setVisible(v); engineRef.current?.updateContacts() }}
                      className="scale-90"
                    />
                    连线
                  </label>
                </div>
              }>
                接触图谱 ({pairs.length} 对)
              </SectionTitle>

              <div className="px-2">
                <div className="mb-2 grid grid-cols-3 gap-1.5">
                  <Stat label="接触对" value={pairs.length.toLocaleString()} />
                  <Stat label="A 侧残基" value={residuesA.length.toLocaleString()} tone="rose" />
                  <Stat label="B 侧残基" value={residuesB.length.toLocaleString()} tone="cyan" />
                </div>

                <div className="mol-scroll relative overflow-x-auto rounded-lg border border-border/60 bg-card/40 p-1.5">
                  <canvas
                    ref={canvasRef}
                    onMouseMove={onMapMove}
                    onMouseLeave={() => setHover(null)}
                    onClick={onMapClick}
                    className={cn('block cursor-pointer', !mapData && 'hidden')}
                  />
                  {!mapData && (
                    <p className="px-2 py-3 text-center text-[10px] text-muted-foreground">无接触数据</p>
                  )}
                  {hoverPair && mapData && (
                    <div
                      className="pointer-events-none absolute z-10 rounded-md border border-border bg-popover px-2 py-1 font-mono text-[10px] text-popover-foreground shadow-lg"
                      style={{ left: hover.x + 12, top: hover.y - 8 }}
                    >
                      {mapData.data.residues[hoverPair.resA].chainId.trim()}:
                      {mapData.data.residues[hoverPair.resA].resName}{mapData.data.residues[hoverPair.resA].resSeq}
                      {' ↔ '}
                      {mapData.data.residues[hoverPair.resB].chainId.trim()}:
                      {mapData.data.residues[hoverPair.resB].resName}{mapData.data.residues[hoverPair.resB].resSeq}
                      <span className="ml-1.5 font-bold text-amber-600 dark:text-amber-400">{hoverPair.minDist.toFixed(2)} Å</span>
                      <span className="ml-1 text-muted-foreground">({hoverPair.count} 对)</span>
                    </div>
                  )}
                </div>
                <p className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <MousePointerClick className="h-3 w-3 shrink-0" />
                  点击图谱单元格选择该残基对；颜色近红远琥珀，对应 3D 视图连线。
                </p>

                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  <button
                    onClick={() => selectSide('a')}
                    className="flex items-center justify-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-1.5 text-[10px] font-medium text-rose-600 transition hover:bg-rose-500/20 dark:text-rose-400"
                  >
                    选 A 侧界面
                  </button>
                  <button
                    onClick={() => selectSide('b')}
                    className="flex items-center justify-center gap-1 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-2 py-1.5 text-[10px] font-medium text-cyan-600 transition hover:bg-cyan-500/20 dark:text-cyan-300"
                  >
                    选 B 侧界面
                  </button>
                  <button
                    onClick={() => selectSide('both')}
                    className="flex items-center justify-center gap-1 rounded-lg border border-border/60 px-2 py-1.5 text-[10px] font-medium text-muted-foreground transition hover:bg-accent"
                  >
                    选全部界面
                  </button>
                </div>
              </div>
            </>
          )}

          <SectionTitle right={
            <span className="text-[10px] font-normal text-muted-foreground">
              {sasaStructureId === activeId && sasaTotal > 0 ? `${sasaProbe} Å · ${sasaPoints} 点 · ${sasaMs.toFixed(0)} ms` : 'Shrake–Rupley'}
            </span>
          }>
            溶剂可及面积 (SASA)
          </SectionTitle>
          <div className="px-2">
            <div className="rounded-lg border border-border/60 px-2.5 py-2">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">水探针半径</span>
                <span className="font-mono font-semibold text-cyan-600 dark:text-cyan-400">{probe.toFixed(1)} Å</span>
              </div>
              <Slider
                value={[probe]}
                min={0.8} max={2.0} step={0.1}
                onValueChange={([v]) => setProbe(v)}
                className="mt-1.5"
              />
              <div className="mt-1.5 flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">采样点数/原子</span>
                <div className="flex gap-1">
                  {[64, 92, 128, 256].map(np => (
                    <button
                      key={np}
                      onClick={() => setNPoints(np)}
                      className={cn(
                        'rounded px-1.5 py-0.5 font-mono text-[10px] transition',
                        nPoints === np
                          ? 'bg-cyan-500/20 font-semibold text-cyan-700 dark:text-cyan-300'
                          : 'text-muted-foreground hover:bg-accent',
                      )}
                    >{np}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-1.5 flex gap-1.5">
              <button
                onClick={runSasa}
                disabled={sasaComputing}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
              >
                {sasaComputing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Droplets className="h-3.5 w-3.5" />}
                {sasaComputing ? '计算中…' : '计算 SASA'}
              </button>
              <button
                onClick={() => { applyColor('sasa'); appendLog('out', '已按 SASA 暴露度着色：埋藏蓝紫 → 暴露橙红（需先计算 SASA）') }}
                title="按暴露度着色（埋藏蓝 → 暴露橙红）"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border/60 text-muted-foreground transition hover:border-cyan-500/50 hover:text-cyan-600 dark:hover:text-cyan-300"
              >
                <Palette className="h-3.5 w-3.5" />
              </button>
            </div>

            {sasaStructureId === activeId && sasaTotal > 0 && (
              <>
                <div className="mt-2 grid grid-cols-4 gap-1.5">
                  <Stat label="总 SASA" value={sasaTotal.toFixed(0)} />
                  <Stat label="疏水" value={sasaHydrophobic.toFixed(0)} tone="cyan" />
                  <Stat label="极性" value={sasaPolar.toFixed(0)} tone="rose" />
                  <Stat label="水/配体" value={sasaHet.toFixed(0)} />
                </div>
                <div className="mt-1.5 flex h-2 w-full overflow-hidden rounded-full" title="疏水/极性/水与配体的面积占比">
                  <div className="bg-cyan-500/70" style={{ width: `${sasaHydrophobic / sasaTotal * 100}%` }} />
                  <div className="bg-rose-500/70" style={{ width: `${sasaPolar / sasaTotal * 100}%` }} />
                  <div className="bg-muted" style={{ width: `${sasaHet / sasaTotal * 100}%` }} />
                </div>
                <div className="mol-scroll mt-2 max-h-40 overflow-y-auto rounded-lg border border-border/60 bg-card/40">
                  <p className="sticky top-0 bg-card/95 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">Top 暴露残基（Å²）</p>
                  {topResidues.map(({ resIdx, area }, i) => {
                    const r = data?.residues[resIdx]
                    if (!r) return null
                    const max = topResidues[0]?.area || 1
                    return (
                      <button
                        key={resIdx}
                        onClick={() => {
                          if (!activeId || !data) return
                          const idx: number[] = []
                          for (let ai = r.start; ai < r.end; ai++) idx.push(ai)
                          setSelection(activeId, idx)
                        }}
                        className="group flex w-full items-center gap-2 px-2 py-1 text-left transition hover:bg-accent/50"
                      >
                        <span className="w-4 shrink-0 text-right font-mono text-[9px] text-muted-foreground">{i + 1}</span>
                        <span className="w-20 shrink-0 truncate font-mono text-[10px] font-medium">{r.chainId.trim()}:{r.resName}{r.resSeq}</span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <span className="block h-full rounded-full bg-gradient-to-r from-cyan-500/60 to-amber-500/80" style={{ width: `${area / max * 100}%` }} />
                        </span>
                        <span className="w-10 shrink-0 text-right font-mono text-[10px] text-cyan-600 dark:text-cyan-400">{area.toFixed(0)}</span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}

            {hasResult && (
              <div className="mt-2 rounded-lg border border-violet-500/30 bg-violet-500/5 px-2.5 py-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-[11px] font-semibold text-violet-600 dark:text-violet-300">
                    <Layers className="h-3.5 w-3.5" />
                    界面埋藏面积 (ΔSASA)
                  </span>
                  <button
                    onClick={runBsa}
                    disabled={buried?.computing}
                    className="rounded-md bg-violet-500/80 px-2 py-1 text-[10px] font-medium text-white transition hover:bg-violet-500 disabled:opacity-60"
                  >
                    {buried?.computing ? '计算中…' : buried?.structureId === activeId ? '重算' : '计算'}
                  </button>
                </div>
                {buried && buried.structureId === activeId && !buried.computing && (
                  <div className="mt-1.5">
                    <div className="grid grid-cols-3 gap-1.5">
                      <Stat label="A 侧埋藏" value={`${buried.buriedA.toFixed(0)} Å²`} tone="rose" />
                      <Stat label="B 侧埋藏" value={`${buried.buriedB.toFixed(0)} Å²`} tone="cyan" />
                      <Stat label="合计" value={`${(buried.buriedA + buried.buriedB).toFixed(0)} Å²`} />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span>核心界面残基（ΔSASA &gt; 1 Å²）：A {buried.coreA.length} · B {buried.coreB.length} · {buried.ms.toFixed(0)} ms</span>
                    </div>
                    <button
                      onClick={() => {
                        if (!activeId || !data) return
                        const idx = [
                          ...interfaceAtomIndices(data, buried.coreA),
                          ...interfaceAtomIndices(data, buried.coreB),
                        ]
                        setSelection(activeId, idx)
                        appendLog('out', `已选择界面核心残基：A ${buried.coreA.length} + B ${buried.coreB.length} 残基（${idx.length} 原子，ΔSASA > 1 Å²）`)
                      }}
                      className="mt-1.5 w-full rounded-md border border-violet-500/40 px-2 py-1.5 text-[10px] font-medium text-violet-600 transition hover:bg-violet-500/15 dark:text-violet-300"
                    >
                      选核心界面残基（ΔSASA 判据，比距离截断更准）
                    </button>
                  </div>
                )}
                {(!buried || buried.structureId !== activeId) && (
                  <p className="mt-1 text-[10px] text-muted-foreground">基于接触 A/B 组三路 SASA（单独/单独/复合）计算埋藏面积，判据比距离截断更严格。</p>
                )}
              </div>
            )}
          </div>

          <SectionTitle>二级结构</SectionTitle>
          <div className="px-2">
            <SSComposition structureId={activeId} />
            <button
              onClick={() => {
                if (!activeId) return
                const r = recomputeSS(activeId)
                if (r.error) return appendLog('err', `DSSP 失败：${r.error}`)
                const total = r.helix + r.strand + r.loop
                const pct = (v: number) => total > 0 ? (v / total * 100).toFixed(0) : '0'
                appendLog('out', `DSSP 重算完成：螺旋 ${r.helix}（${pct(r.helix)}%）· 折叠 ${r.strand}（${pct(r.strand)}%）· 环 ${r.loop}（${pct(r.loop)}%）`)
              }}
              className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-[11px] font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              DSSP 重算二级结构
            </button>
          </div>
        </>
      )}

      <PanelHint>
        <span className="flex items-center gap-1"><Network className="inline h-3 w-3" /> contacts 命令同样可用：</span>
        <span className="font-mono">contacts chain A | chain B 4.0</span> 或快捷链间
        <span className="font-mono">interface A B</span>。
      </PanelHint>
    </div>
  )
}

// ---------- 子组件 ----------

function ExprInput({ label, tone, value, onChange, count, error, placeholder }: {
  label: string
  tone: 'rose' | 'cyan'
  value: string
  onChange: (v: string) => void
  count: number
  error?: string
  placeholder?: string
}) {
  const toneCls = tone === 'rose'
    ? 'border-rose-500/40 text-rose-600 dark:text-rose-400'
    : 'border-cyan-500/40 text-cyan-600 dark:text-cyan-300'
  return (
    <div className={cn('rounded-lg border bg-card/40 px-2.5 py-1.5', error ? 'border-destructive/60' : 'border-border/60')}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider', toneCls)}>
          {label}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">{count.toLocaleString()} 原子</span>
      </div>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => e.stopPropagation()}
        placeholder={placeholder}
        spellCheck={false}
        className="mt-1 w-full bg-transparent font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground/50"
      />
      {error && <p className="mt-0.5 text-[9px] text-destructive">{error}</p>}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'rose' | 'cyan' }) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-2 py-1.5 text-center">
      <div className={cn(
        'font-mono text-sm font-bold',
        tone === 'rose' && 'text-rose-600 dark:text-rose-400',
        tone === 'cyan' && 'text-cyan-600 dark:text-cyan-300',
        !tone && 'text-foreground',
      )}>{value}</div>
      <div className="text-[9px] text-muted-foreground">{label}</div>
    </div>
  )
}

/** 二级结构组成（H/E/L 堆叠条 + 百分比） */
function SSComposition({ structureId }: { structureId: string | null }) {
  const visualRev = useMolStore(s => s.visualRev)
  const stats = useMemo(() => {
    void visualRev
    if (!structureId) return null
    const data = dataRegistry.get(structureId)
    if (!data) return null
    let h = 0, e = 0, l = 0
    for (const r of data.residues) {
      if (r.water || !r.polymer) continue
      if (r.ss === 'H') h++
      else if (r.ss === 'E') e++
      else l++
    }
    const total = h + e + l
    return total > 0 ? { h, e, l, total } : null
  }, [structureId, visualRev])
  if (!stats) return <p className="px-1 text-[10px] text-muted-foreground">无聚合物残基</p>
  const pct = (v: number) => (v / stats.total * 100).toFixed(0)
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-2.5 py-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full">
        <div className="bg-rose-500/80" style={{ width: `${stats.h / stats.total * 100}%` }} title={`螺旋 ${stats.h}`} />
        <div className="bg-amber-500/80" style={{ width: `${stats.e / stats.total * 100}%` }} title={`折叠 ${stats.e}`} />
        <div className="bg-muted" style={{ width: `${stats.l / stats.total * 100}%` }} title={`环 ${stats.l}`} />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px]">
        <span className="text-rose-600 dark:text-rose-400">螺旋 {stats.h}（{pct(stats.h)}%）</span>
        <span className="text-amber-600 dark:text-amber-400">折叠 {stats.e}（{pct(stats.e)}%）</span>
        <span className="text-muted-foreground">环 {stats.l}（{pct(stats.l)}%）</span>
      </div>
    </div>
  )
}
