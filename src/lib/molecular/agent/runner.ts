// Agent 命令执行器：白名单校验 → runCommand 执行 → 捕获控制台输出
// 与命令行/命令面板共用 runCommand（同一条代码路径，行为一致、可审计）。
import { runCommand } from '../commands'
import { useMolStore } from '../store'
import { useHBondStore } from '../hbond-store'
import { tt } from '@/i18n'
import type { AgentCmdRecord } from './protocol'

/**
 * 自动执行的安全命令前缀（视觉/选择/分析/导出/构象类）。
 * 覆盖 commands.ts 的全部命令及其别名——自然语言可触达应用全部功能。
 * load 亦安全（只新增结构不动既有数据）。
 */
const AUTO_PREFIXES = new Set([
  // 加载与对象
  'load', 'fetch', 'create', 'split_chains', 'splitchains', 'activate', 'use',
  // 选择与表示
  'select', 'sel', 'deselect', 'desel', 'show', 'display', 'hide', 'undisplay', 'preset', 'style', 'scene',
  // 链隔离（PyMOL isolate 语义：单链配体分析）与链显隐
  'isolate', 'chains',
  // 着色
  'color', 'colour', 'util', 'reset_colors', 'recolor', 'bg', 'background',
  // 视角
  'zoom', 'fit', 'orient', 'turn', 'move', 'get_view', 'set_view', 'view', 'views', 'bookmark',
  // 视觉设置
  'set', 'spin', 'rock', 'slab', 'stereo', 'axes', 'axis', 'gizmo', 'fps',
  'outline', 'edge', 'ssao', 'ao', 'gtao', 'label',
  // 分析
  'hbonds', 'hbond', 'hbon', 'count_atoms', 'count', 'symmetry', 'symmates',
  'contacts', 'contact', 'clash', 'interface', 'iface',
  'xcontacts', 'xcontact', 'xiface', 'sasa', 'area', 'bsa', 'buried', 'bsa-area',
  'xbsa', 'xburied', 'xbsa-area', 'dssp', 'secstr',
  // 膜与孔道（r105 补入——此前 agent 无法触达 membrane/pore，membrane-context 技能依赖）
  'membrane', 'lipid', 'bilayer', 'pore',
  'superpose', 'match', 'align', 'mm', 'untransform', 'unpose',
  // 测量
  'measure', 'dist',
  // 构象与媒体
  'morph', 'movie', 'ensemble', 'ens', 'record', 'rec',
  // 密度图与导出
  'map', 'save', 'png', 'ray', 'svg',
  // 信息
  'help', 'history', 'perf',
  // PyMOL 数据动词（r60 移植：iterate 只读遍历；alter 限 b/q/name 属性白名单；cell 同 show cell）
  'iterate', 'alter', 'cell', 'spectrum', 'enable', 'disable', 'set_name',
])

/** 破坏性/高影响命令：需用户在面板上确认后才执行 */
const CONFIRM_PREFIXES = new Set(['close', 'clear', 'reset', 'delete', 'session', 'tour', 'demo'])

/** 异步命令：执行后延迟抓取输出（fetch/计算在后台落地） */
const ASYNC_PREFIXES = new Set([
  'load', 'fetch', 'map', 'sasa', 'area', 'bsa', 'buried', 'xbsa', 'xburied',
  'ray', 'svg', 'superpose', 'match', 'align', 'mm', 'contacts', 'contact', 'clash',
  'xcontacts', 'xcontact', 'xiface', 'create', 'morph', 'movie', 'ensemble', 'ens',
  'record', 'rec', 'symmetry', 'symmates',
])

/** r108-a 计算类命令：回执常为「计算中」——有界轮询等待结果日志落地（大结构 Web Worker 可达数秒，
 *  r107 实测 700ms 单次延迟不够，报告回填拿到的是占位文案而非实测值） */
const CALC_WAIT_PREFIXES = new Set(['sasa', 'area', 'bsa', 'buried', 'bsa-area', 'xbsa', 'xburied', 'xbsa-area'])

export type CmdClass = 'auto' | 'confirm' | 'blocked'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** 命令分类（白名单判定） */
export function classifyCmd(rawCmd: string): CmdClass {
  const cmd = rawCmd.trim().toLowerCase().split(/\s+/)[0] ?? ''
  if (CONFIRM_PREFIXES.has(cmd)) {
    // 细粒度豁免：session save/export/info、record stop、movie stop、perf off/status 等非破坏子命令
    const rest = rawCmd.trim().toLowerCase()
    if (/^session\s+(save|export|info)/.test(rest)) return 'auto'
    if (/^(record|rec)\s+stop/.test(rest)) return 'auto'
    if (/^(movie|ensemble|ens|tour|demo)\s+stop/.test(rest)) return 'auto'
    if (/^perf\s+(off|status|restore)/.test(rest)) return 'auto'
    if (/^view\s+(save|go|list|del|next|prev)/.test(rest)) return 'auto'
    if (/^(set_view|get_view)/.test(rest)) return 'auto'
    return 'confirm'
  }
  if (AUTO_PREFIXES.has(cmd)) {
    // set 的破坏面有限（渲染设置），但 session 相关键不允许经 agent 改
    return 'auto'
  }
  return 'blocked'
}

/** 去掉续行/多语句拆分：把 LLM 可能给出的多行文本拆成单条命令数组 */
export function splitCommands(text: string[]): string[] {
  const out: string[] = []
  for (const chunk of text) {
    for (const line of String(chunk).split(/[\n;]+/)) {
      const t = line.trim()
      if (t && !t.startsWith('#') && !t.startsWith('//')) out.push(t)
    }
  }
  return out
}

/**
 * 执行一条命令并捕获控制台输出（runCommand 会把结果写 consoleLog）。
 * load/fetch 会轮询等待结构真正落地（网络 + 解析可达数秒，后续命令依赖它）；
 * 其余异步命令延迟二次抓取，尽量带上有意义的日志。
 */
export async function execAgentCmd(cmd: string): Promise<AgentCmdRecord> {
  const store = useMolStore.getState()
  // r59-a2 #1 修复：consoleLog 是 slice(-200) 滚动窗口，长度饱和后绝对下标切片会失聪
  // （每条命令 output 为空、hasErr 恒 false → agent 自动修正与 VLM 修正双反馈环失效）。
  // 改用单调 seq 过滤：执行前记 seq 高水位，执行后取 seq 更大的条目——滚动不影响。
  const seqBefore = store.consoleLog.reduce((m, l) => Math.max(m, l.seq ?? 0), 0)
  try {
    runCommand(cmd)
  } catch (e) {
    return { cmd, status: 'error', output: e instanceof Error ? e.message : tt({ zh: '执行异常', en: 'Execution error' }) }
  }
  const grab = () => {
    const logs = useMolStore.getState().consoleLog
    const added = logs.filter(l => (l.seq ?? 0) > seqBefore && l.type !== 'in')
    return added.map(l => l.text).join('\n').slice(0, 300)
  }
  const hasErr = () => useMolStore.getState().consoleLog.some(l => (l.seq ?? 0) > seqBefore && l.type === 'err')
  const head = cmd.trim().toLowerCase().split(/\s+/)[0] ?? ''

  // load/fetch：轮询等待结构数量增加（最多 ~20s）；失败（err 已落地）提前退出
  if (head === 'load' || head === 'fetch') {
    const structBefore = useMolStore.getState().structures.length
    for (let i = 0; i < 66; i++) {
      await sleep(300)
      if (hasErr()) break
      if (useMolStore.getState().structures.length > structBefore) {
        await sleep(200) // 让加载完成日志落地
        break
      }
    }
    return { cmd, status: hasErr() ? 'error' : 'ok', output: grab() || tt({ zh: '已加载', en: 'Loaded' }) }
  }

  const first = grab()
  // r108-a 计算类命令有界轮询：回执 entry 含「计算中/computing」时等待后续结果 entry 落地
  // （sasa/bsa/xbsa 完成时必打结果日志，consoleLog seq 单调——后续 out entry 出现即完成；
  //  有界 5s 防大结构卡死，超时/无标记走旧路径保持兜底）
  if (CALC_WAIT_PREFIXES.has(head) && first && /计算中|computing/i.test(first) && !hasErr()) {
    const pending = useMolStore.getState().consoleLog.find(
      l => (l.seq ?? 0) > seqBefore && l.type !== 'in' && /计算中|computing/i.test(l.text),
    )
    if (pending) {
      for (let i = 0; i < 16; i++) {
        await sleep(300)
        if (hasErr()) break
        const landed = useMolStore.getState().consoleLog.some(l => (l.seq ?? 0) > (pending.seq ?? 0) && l.type === 'out')
        if (landed) return { cmd, status: 'ok', output: grab().slice(0, 300) }
      }
    }
  }
  // r108-b hbonds 开启类命令：轮询 hbond-store 统计落地后把键数追加进回执（引擎检测在渲染
  // 节流拍里跑——小结构同步、大结构走 worker；此前回执只含烘焙原子数不含键数，回填链拿不到
  // 实测值）。statLine 与 AgentPanel 运行时补充行同格式（「氢键网络当前 N 条」——mock 回填
  // 正则与真实 LLM 都可从回执直接提取）；off/0 关闭命令回执已完整，跳过
  if ((head === 'hbonds' || head === 'hbond' || head === 'hbon') && !/^(off|0)$/i.test((cmd.trim().split(/\s+/)[1] ?? '').toLowerCase())) {
    await sleep(250) // 引擎节流 150ms 一拍——先等一拍再读
    const t0 = Date.now()
    let statLine = ''
    // r108 E2E 实测：4HHB（4,779 原子）worker 检测超 2.75s 首版上界——statLine 未落地；
    // 扩至 5.5s（对齐 r107 建议口径「计算类轮询有界 5s」），超时仍保旧回执兜底
    while (Date.now() - t0 < 5250) {
      if (hasErr()) break
      const hb = useHBondStore.getState()
      if (hb.visible && !hb.computing) {
        statLine = tt({ zh: `氢键网络当前 ${hb.count} 条（其中涉水 ${hb.waterCount}）`, en: `H-bond network: currently ${hb.count} bonds (${hb.waterCount} water-involved)` })
        break
      }
      await sleep(250)
    }
    if (statLine && first) return { cmd, status: hasErr() ? 'error' : 'ok', output: `${first}\n${statLine}`.slice(0, 300) }
  }
  if (ASYNC_PREFIXES.has(head) && !first) {
    await new Promise(r => setTimeout(r, 700))
    return { cmd, status: hasErr() ? 'error' : 'ok', output: grab() || tt({ zh: '已受理（后台进行中）', en: 'Accepted (running in the background)' }) }
  }
  return { cmd, status: hasErr() ? 'error' : 'ok', output: first || undefined }
}
