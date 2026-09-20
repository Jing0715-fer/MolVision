// Agent 命令执行器：白名单校验 → runCommand 执行 → 捕获控制台输出
// 与命令行/命令面板共用 runCommand（同一条代码路径，行为一致、可审计）。
import { runCommand } from '../commands'
import { useMolStore } from '../store'
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
  'select', 'sel', 'show', 'display', 'hide', 'undisplay', 'preset', 'style',
  // 着色
  'color', 'colour', 'util', 'reset_colors', 'recolor', 'bg', 'background',
  // 视角
  'zoom', 'fit', 'orient', 'get_view', 'set_view', 'view', 'views', 'bookmark',
  // 视觉设置
  'set', 'spin', 'rock', 'slab', 'stereo', 'axes', 'axis', 'gizmo', 'fps',
  'outline', 'edge', 'ssao', 'ao', 'gtao', 'label',
  // 分析
  'hbonds', 'hbond', 'hbon', 'count_atoms', 'count', 'symmetry', 'symmates',
  'contacts', 'contact', 'clash', 'interface', 'iface',
  'xcontacts', 'xcontact', 'xiface', 'sasa', 'area', 'bsa', 'buried', 'bsa-area',
  'xbsa', 'xburied', 'xbsa-area', 'dssp', 'secstr',
  'superpose', 'match', 'align', 'mm', 'untransform', 'unpose',
  // 测量
  'measure', 'dist',
  // 构象与媒体
  'morph', 'movie', 'ensemble', 'ens', 'record', 'rec',
  // 密度图与导出
  'map', 'save', 'png', 'ray', 'svg',
  // 信息
  'help', 'history', 'perf',
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
  const before = store.consoleLog.length
  try {
    runCommand(cmd)
  } catch (e) {
    return { cmd, status: 'error', output: e instanceof Error ? e.message : '执行异常' }
  }
  const grab = () => {
    const logs = useMolStore.getState().consoleLog
    const added = logs.slice(before).filter(l => l.type !== 'in')
    return added.map(l => l.text).join('\n').slice(0, 300)
  }
  const hasErr = () => useMolStore.getState().consoleLog.slice(before).some(l => l.type === 'err')
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
    return { cmd, status: hasErr() ? 'error' : 'ok', output: grab() || '已加载' }
  }

  const first = grab()
  if (ASYNC_PREFIXES.has(head) && !first) {
    await new Promise(r => setTimeout(r, 700))
    return { cmd, status: hasErr() ? 'error' : 'ok', output: grab() || '已受理（后台进行中）' }
  }
  return { cmd, status: hasErr() ? 'error' : 'ok', output: first || undefined }
}
