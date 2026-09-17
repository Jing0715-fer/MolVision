// PyMOL 风格命令行：select / show / hide / color / bg / zoom / spin / slab / label ...
import { PRESETS, useMolStore, engineRef, dataRegistry } from './store'
import { saveSession, clearSession, sessionInfo } from './session'
import { parseCssColor, COLOR_SCHEME_LABELS, type ColorScheme } from './colors'
import { REP_LABELS, type RepType } from './types'
import { useEnsembleStore } from './ensemble-store'
import { useRecordStore } from './record-store'
import { runContactAnalysis, runBuriedSasa, runCrossContactAnalysis } from './contacts'
import { useContactStore } from './contacts-store'
import { useSasaStore } from './sasa-store'

/** 数值裁剪（NaN 时取默认值） */
function clampNum(v: number, min: number, max: number, dflt: number): number {
  if (isNaN(v)) return dflt
  return Math.max(min, Math.min(max, v))
}

const REP_ALIASES: Record<string, RepType> = {
  cartoon: 'cartoon', ribbon: 'cartoon',
  ballstick: 'ballstick', 'ball&stick': 'ballstick', bs: 'ballstick',
  sticks: 'sticks', stick: 'sticks', lines: 'lines', wire: 'lines', wireframe: 'lines',
  spacefill: 'spacefill', sphere: 'spacefill', spheres: 'spacefill', cpk: 'spacefill',
  surface: 'surface', surf: 'surface',
}

const SCHEME_ALIASES: Record<string, ColorScheme> = {
  element: 'element', cpk: 'element',
  chain: 'chain', spectrum: 'spectrum', rainbow: 'spectrum',
  residue: 'residue', resn: 'residue', byresidue: 'residue',
  ss: 'ss', secondary: 'ss', secstr: 'ss',
  bfactor: 'bfactor', b: 'bfactor', temp: 'bfactor',
  sasa: 'sasa', sas: 'sasa', accessibility: 'sasa',
  uniform: 'uniform',
}

export const COMMAND_HELP: { cmd: string; desc: string; example: string }[] = [
  { cmd: 'load <id>', desc: '从 RCSB 加载 PDB 结构', example: 'load 4hhb' },
  { cmd: 'select [name=]expr', desc: '选择原子（可命名）', example: 'select site = within 5 of resn HEM' },
  { cmd: 'show <rep> [sel]', desc: '为当前结构添加表示法', example: 'show cartoon chain A' },
  { cmd: 'hide <rep> [sel]', desc: '移除匹配的表示法', example: 'hide lines' },
  { cmd: 'color <方案|颜色> [sel]', desc: '给选择上色', example: 'color red chain A' },
  { cmd: 'bg <颜色>', desc: '设置背景色', example: 'bg black' },
  { cmd: 'zoom [sel]', desc: '缩放到选择/全部', example: 'zoom ligand' },
  { cmd: 'spin on|off', desc: '自动旋转', example: 'spin on' },
  { cmd: 'rock on|off', desc: '相机摇摆（±26°）', example: 'rock on' },
  { cmd: 'slab <n>|off', desc: '裁剪厚度(Å)', example: 'slab 20' },
  { cmd: 'hbonds on|off [n]', desc: '氢键网络开关/距离', example: 'hbonds on 3.2' },
  { cmd: 'ssao on|off [r]', desc: '环境光遮蔽开关/半径', example: 'ssao on 3' },
  { cmd: 'superpose <名> [onto <名>] [chain X to Y]', desc: '结构叠合（序列比对+刚体拟合，可选链对）', example: 'superpose 4HHB onto 1A3N chain A to A' },
  { cmd: 'dssp', desc: 'DSSP 重算二级结构（含无记录结构）', example: 'dssp' },
  { cmd: 'contacts <exprA> | <exprB> [n]', desc: '界面接触检测（残基对+连线）', example: 'contacts chain A | chain B 4.0' },
  { cmd: 'interface <链A> <链B> [n]', desc: '链间界面快捷命令', example: 'interface A B' },
  { cmd: 'xcontacts <A>:<expr> | <B>:<expr> [n]', desc: '跨结构接触（复合物界面，建议先 superpose）', example: 'xcontacts 1UBQ:chain A | 1D3Z:chain A 5.0' },
  { cmd: 'sasa [probe] [点数]', desc: '溶剂可及面积计算（Shrake–Rupley）', example: 'sasa 1.4 92' },
  { cmd: 'bsa', desc: '界面埋藏面积 ΔSASA（需 contacts A/B）', example: 'bsa' },
  { cmd: 'untransform [名]', desc: '撤销叠合变换回原始位姿', example: 'untransform 1D3Z' },
  { cmd: 'record start|stop', desc: '录制动画为 WebM 视频', example: 'record start' },
  { cmd: 'ensemble play|frame|fps…', desc: 'NMR 构象动画控制', example: 'ensemble play' },
  { cmd: 'session save|info|clear', desc: '会话存档管理', example: 'session save' },
  { cmd: 'label on|off', desc: '标记当前选择 / 清除标签', example: 'label on' },
  { cmd: 'preset <名>', desc: '应用风格预设', example: 'preset surface' },
  { cmd: 'delete <名>', desc: '删除命名选择', example: 'delete site' },
  { cmd: 'clear', desc: '移除所有结构', example: 'clear' },
  { cmd: 'help', desc: '显示帮助', example: 'help' },
]

export function runCommand(raw: string): void {
  const store = useMolStore.getState()
  const input = raw.trim()
  if (!input) return
  store.appendLog('in', input)
  const lower = input.toLowerCase()
  const parts = input.split(/\s+/)
  const cmd = parts[0].toLowerCase()

  const ok = (msg: string) => store.appendLog('out', msg)
  const err = (msg: string) => store.appendLog('err', msg)

  if (cmd === 'help' || cmd === '?') {
    ok('可用命令：')
    for (const h of COMMAND_HELP) ok(`  ${h.cmd.padEnd(22)} ${h.desc}  例: ${h.example}`)
    ok('选择语法：chain A / resi 1-60 / resn ALA+GLY / name CA / elem C / protein / ligand / water / backbone / helix / sheet / within 5 of (...) / byres(...)，支持 and or not ( )')
    return
  }

  if (cmd === 'load' || cmd === 'fetch') {
    const id = parts[1]
    if (!id || !/^[0-9][a-z0-9]{3}$/i.test(id)) return err('用法: load <4位PDB编号>，如 load 4hhb')
    void import('./loader').then(m => m.fetchPdbId(id))
    return
  }

  if (cmd === 'select' || cmd === 'sel') {
    const rest = input.slice(parts[0].length).trim()
    const assign = rest.match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/)
    if (assign) {
      const name = assign[1]
      const expr = assign[2]
      const res = store.selectFromExpr(expr)
      if (res.error) return err(`选择错误: ${res.error}`)
      if (name.toLowerCase() !== 'sele') {
        useMolStore.setState(s => ({
          namedSelections: [...s.namedSelections.filter(n => n.name !== name), {
            name, structureId: s.activeId!, expr, indices: null, count: res.count,
          }],
        }))
      }
      ok(`已选择 ${res.count.toLocaleString()} 个原子 → ${name === 'sele' ? '当前选择' : name}`)
    } else {
      if (!rest) return err('用法: select <表达式> 或 select <名> = <表达式>')
      const res = store.selectFromExpr(rest)
      if (res.error) return err(`选择错误: ${res.error}`)
      ok(`已选择 ${res.count.toLocaleString()} 个原子`)
    }
    return
  }

  if (cmd === 'show' || cmd === 'display') {
    const repAlias = (parts[1] ?? '').toLowerCase()
    if (repAlias === 'hydrogens' || repAlias === 'h') {
      useMolStore.getState().updateSettings({ hideHydrogens: false })
      return ok('已显示氢原子')
    }
    if (repAlias === 'waters' || repAlias === 'water') {
      useMolStore.getState().updateSettings({ hideWater: false })
      return ok('已显示水分子')
    }
    const repType = REP_ALIASES[repAlias]
    if (!repType) return err(`未知表示法 "${parts[1]}"。可用: ${Object.keys(REP_ALIASES).slice(0, 7).join(', ')}…`)
    const selExpr = parts.slice(2).join(' ').trim() || 'all'
    if (!useMolStore.getState().activeId) return err('没有加载结构')
    useMolStore.getState().addRep(useMolStore.getState().activeId!, { type: repType, selection: selExpr })
    ok(`已添加 ${REP_LABELS[repType]} 表示 (${selExpr})`)
    return
  }

  if (cmd === 'hide' || cmd === 'undisplay') {
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg === 'hydrogens' || arg === 'h') {
      useMolStore.getState().updateSettings({ hideHydrogens: true })
      return ok('已隐藏氢原子')
    }
    if (arg === 'waters' || arg === 'water') {
      useMolStore.getState().updateSettings({ hideWater: true })
      return ok('已隐藏水分子')
    }
    const repType = REP_ALIASES[arg]
    const s = useMolStore.getState()
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!entry) return err('没有加载结构')
    if (repType) {
      const selExpr = parts.slice(2).join(' ').trim()
      const reps = entry.reps.filter(r => r.type === repType && (!selExpr || r.selection === selExpr))
      for (const r of reps) s.removeRep(entry.id, r.id)
      return ok(`已移除 ${reps.length} 个 ${REP_LABELS[repType]} 表示`)
    }
    // hide 全部
    for (const r of [...entry.reps]) s.removeRep(entry.id, r.id)
    return ok('已移除全部表示法')
  }

  if (cmd === 'color' || cmd === 'colour') {
    const target = (parts[1] ?? '').toLowerCase()
    const selExpr = parts.slice(2).join(' ').trim()
    const scheme = SCHEME_ALIASES[target]
    const css = parseCssColor(target)
    if (!scheme && !css) return err(`未知颜色 "${parts[1]}"。可用方案: ${Object.keys(SCHEME_ALIASES).join(', ')} 或 #hex / 颜色名`)
    const s = useMolStore.getState()
    if (!s.activeId) return err('没有加载结构')
    if (selExpr) {
      const res = s.selectFromExpr(selExpr)
      if (res.error) return err(`选择错误: ${res.error}`)
    }
    if (scheme === 'sasa') {
      const data = dataRegistry.get(s.activeId)
      if (data && !data.sasa) {
        // 触发计算（小结构同步完成；大结构 worker，完成后自动烘焙上色）
        const eng = engineRef.current
        const r = eng?.requestSasa(s.activeId)
        if (!r?.done) {
          return ok('SASA 后台计算中（Web Worker）——完成后将自动按暴露度着色（埋藏蓝紫 → 暴露橙红）')
        }
      }
    }
    s.applyColor(scheme ?? css!)
    ok(`已上色: ${scheme ? COLOR_SCHEME_LABELS[scheme] : css}${selExpr ? ` (${selExpr})` : ''}`)
    return
  }

  if (cmd === 'reset_colors' || cmd === 'recolor') {
    useMolStore.getState().resetColors(parts[1] ? 'selection' : 'structure')
    return ok('已重置颜色')
  }

  if (cmd === 'bg' || cmd === 'background') {
    const css = parseCssColor((parts[1] ?? '').toLowerCase())
    if (!css) return err('用法: bg <#hex 或颜色名>')
    useMolStore.getState().updateSettings({ background: css })
    return ok(`背景色 → ${css}`)
  }

  if (cmd === 'zoom' || cmd === 'fit') {
    const selExpr = parts.slice(1).join(' ').trim()
    const s = useMolStore.getState()
    if (selExpr) {
      const res = s.selectFromExpr(selExpr)
      if (res.error) return err(`选择错误: ${res.error}`)
      const sel = useMolStore.getState().selection
      if (sel.structureId) engineRef.current?.fitView([{ structureId: sel.structureId, indices: sel.indices }])
      return ok(`缩放到 ${selExpr}`)
    }
    engineRef.current?.fitView()
    return ok('缩放到全部结构')
  }

  if (cmd === 'spin') {
    const arg = (parts[1] ?? 'on').toLowerCase()
    const on = arg === 'on' || arg === '1' || arg === 'true'
    useMolStore.getState().updateSettings({ spin: on, ...(on ? { rock: false } : {}) })
    return ok(on ? '自动旋转开启（S 切换）' : '自动旋转关闭')
  }

  if (cmd === 'rock') {
    const arg = (parts[1] ?? 'on').toLowerCase()
    const on = arg === 'on' || arg === '1' || arg === 'true'
    useMolStore.getState().updateSettings({ rock: on, ...(on ? { spin: false } : {}) })
    return ok(on ? '相机摇摆开启（±26°，R 切换）' : '相机摇摆关闭')
  }

  if (cmd === 'slab') {
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg === 'off' || arg === '0') {
      useMolStore.getState().updateSettings({ slab: false })
      return ok('裁剪关闭')
    }
    const n = parseFloat(arg)
    if (isNaN(n) || n <= 0) return err('用法: slab <厚度Å> 或 slab off')
    useMolStore.getState().updateSettings({ slab: true, slabThickness: n })
    return ok(`裁剪厚度 → ${n} Å`)
  }

  if (cmd === 'label') {
    const arg = (parts[1] ?? 'on').toLowerCase()
    if (arg === 'off' || arg === 'clear') {
      useMolStore.getState().clearLabels()
      return ok('标签已清除')
    }
    const s = useMolStore.getState()
    if (!s.selection.structureId || !s.selection.indices.length) return err('请先选择原子')
    s.addLabelsForSelection()
    return ok(`已添加 ${s.selection.indices.length} 个标签`)
  }

  if (cmd === 'preset' || cmd === 'style') {
    const name = (parts[1] ?? '').toLowerCase()
    const p = PRESETS[name]
    if (!p) return err(`未知预设 "${parts[1]}"。可用: ${Object.keys(PRESETS).join(', ')}`)
    useMolStore.getState().applyPreset(name)
    return ok(`已应用预设: ${p.label}`)
  }

  if (cmd === 'delete') {
    const name = parts[1]
    if (!name) return err('用法: delete <命名选择名>')
    const s = useMolStore.getState()
    if (!s.namedSelections.find(n => n.name === name)) return err(`未找到命名选择 "${name}"`)
    s.deleteNamedSelection(name)
    return ok(`已删除 ${name}`)
  }

  if (cmd === 'clear' || cmd === 'reset') {
    const s = useMolStore.getState()
    for (const st of [...s.structures]) s.removeStructure(st.id)
    return ok('已清空所有结构')
  }

  if (cmd === 'orient') {
    engineRef.current?.fitView()
    return ok('视角已重置')
  }

  if (cmd === 'hbonds' || cmd === 'hbond' || cmd === 'hbon') {
    const s = useMolStore.getState()
    const arg = (parts[1] ?? 'on').toLowerCase()
    if (arg === 'off' || arg === '0') {
      s.updateSettings({ showHBonds: false })
      return ok('氢键显示关闭')
    }
    let dist = parseFloat(parts[2] ?? '')
    if (isNaN(dist)) dist = parseFloat(arg)
    const patch: Partial<import('./types').Settings> = { showHBonds: true }
    if (!isNaN(dist) && dist >= 2 && dist <= 6) patch.hbondMaxDist = dist
    s.updateSettings(patch)
    return ok(`氢键网络开启${!isNaN(dist) && dist >= 2 && dist <= 6 ? `（距离上限 ${dist} Å）` : '（默认 3.5 Å）'}，快捷键 B 切换`)
  }

  if (cmd === 'ssao' || cmd === 'ao' || cmd === 'gtao') {
    const s = useMolStore.getState()
    const arg = (parts[1] ?? 'on').toLowerCase()
    if (arg === 'off' || arg === '0') {
      s.updateSettings({ ssao: false })
      return ok('环境光遮蔽已关闭')
    }
    let radius = parseFloat(parts[2] ?? '')
    if (isNaN(radius)) radius = parseFloat(arg)
    const patch: Partial<import('./types').Settings> = { ssao: true }
    if (!isNaN(radius) && radius >= 0.5 && radius <= 12) patch.ssaoRadius = radius
    s.updateSettings(patch)
    return ok(`GTAO 环境光遮蔽开启${!isNaN(radius) && radius >= 0.5 && radius <= 12 ? `（采样半径 ${radius} Å）` : '（默认 3 Å）'}，可在场景面板调节强度与半径`)
  }

  if (cmd === 'superpose' || cmd === 'match' || cmd === 'align' || cmd === 'mm') {
    const eng = engineRef.current
    if (!eng) return err('引擎未就绪')
    const s = useMolStore.getState()
    if (s.structures.length < 2) return err('叠合需要至少 2 个结构（当前 ' + s.structures.length + '）')
    // 解析参数：<mobile> [onto <ref>] [chain <移动链> [to <参考链>]]（省略 onto 时参考为当前活动结构）
    let rest = input.slice(parts[0].length).trim()
    // 可选链对：chain <A> [to <B>]——从整条命令中先提取（可出现在任何位置）
    let mobChain: string | undefined
    let refChain: string | undefined
    const chainM = rest.match(/\s+chain\s+(\S+)(?:\s+to\s+(\S+))?$/i)
    if (chainM) {
      mobChain = chainM[1]
      refChain = chainM[2]
      rest = rest.slice(0, chainM.index).trim()
    }
    let refName: string | null = null
    const ontoM = rest.match(/\s+onto\s+(.+)$/i)
    if (ontoM) {
      refName = ontoM[1].trim()
      rest = rest.slice(0, ontoM.index).trim()
    }
    const mobileName = rest || (s.activeId ? s.structures.find(x => x.id === s.activeId)?.name : null)
    if (!mobileName) return err('用法：superpose <移动结构名> onto <参考结构名> [chain <移动链> to <参考链>]（省略 onto 则叠合到当前活动结构）')
    if (!refName) {
      if (!s.activeId) return err('没有活动结构作为参考，请用 superpose <名> onto <参考名>')
      const a = s.structures.find(x => x.id === s.activeId)
      if (a && a.name.toUpperCase() === mobileName.toUpperCase()) {
        // 移动=活动：改用第一个其它结构作参考
        const other = s.structures.find(x => x.id !== s.activeId)
        if (!other) return err('没有其它结构可作参考')
        refName = other.name
      } else {
        refName = a?.name ?? null
      }
    }
    const findByName = (name: string) => s.structures.find(x => x.name.toUpperCase() === name.toUpperCase() || x.name.toUpperCase().startsWith(name.toUpperCase()))
    const mobile = findByName(mobileName)
    const ref = refName ? findByName(refName) : null
    if (!mobile) return err(`未找到移动结构 "${mobileName}"（可用：${s.structures.map(x => x.name).join(', ')}）`)
    if (!ref) return err(`未找到参考结构 "${refName}"`)
    if (mobile.id === ref.id) return err('移动与参考结构不能相同')
    const t0 = performance.now()
    const res = eng.superpose(mobile.id, ref.id, mobChain, refChain)
    const ms = Math.round(performance.now() - t0)
    if (!res.ok) return err(`叠合失败：${res.error}`)
    ok(`叠合完成：${mobile.name} → ${ref.name}（链 ${res.mobileChain} ↔ 链 ${res.refChain}${mobChain ? '（手动指定）' : ''}）`)
    ok(`匹配 ${res.matched} 对 CA 原子，对齐后 RMSD = ${res.rmsd.toFixed(3)} Å，耗时 ${ms} ms`)
    if (res.rmsd > 3) ok('提示：RMSD 偏大，可能存在构象差异或序列相似度低')
    return
  }

  if (cmd === 'dssp' || cmd === 'secstr') {
    const s = useMolStore.getState()
    if (!s.activeId) return err('没有活动结构')
    const entry = s.structures.find(x => x.id === s.activeId)
    const r = s.recomputeSS(s.activeId)
    if (r.error) return err(`DSSP 失败：${r.error}`)
    const total = r.helix + r.strand + r.loop
    const pct = (v: number) => total > 0 ? (v / total * 100).toFixed(0) : '0'
    ok(`DSSP 二级结构指认完成：螺旋 ${r.helix}（${pct(r.helix)}%）· 折叠 ${r.strand}（${pct(r.strand)}%）· 环 ${r.loop}（${pct(r.loop)}%）`)
    ok(`cartoon 已按新指认重建${entry?.hasSS ? '' : '（原无 HELIX/SHEET 记录）'}；helix / sheet 选择关键字同步更新`)
    return
  }

  if (cmd === 'contacts' || cmd === 'contact' || cmd === 'clash') {
    // contacts off | contacts <exprA> | <exprB> [cutoff] | contacts [cutoff]（用当前/默认表达式）
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg === 'off' || arg === '0') {
      useContactStore.getState().clear()
      engineRef.current?.updateContacts()
      return ok('接触分析已清除')
    }
    if (arg === 'hide') {
      useContactStore.getState().setVisible(false)
      engineRef.current?.updateContacts()
      return ok('接触连线已隐藏（结果保留，用 contacts show 恢复）')
    }
    if (arg === 'show') {
      useContactStore.getState().setVisible(true)
      engineRef.current?.updateContacts()
      return ok('接触连线已显示')
    }
    // 解析 "exprA | exprB [cutoff]"
    const rest = input.slice(parts[0].length).trim()
    const pipeM = rest.match(/^(.+?)\s*\|\s*(.+)$/)
    let aExpr: string | undefined, bExpr: string | undefined, cutoff: number | undefined
    if (pipeM) {
      aExpr = pipeM[1].trim()
      let bPart = pipeM[2].trim()
      const lastSpace = bPart.lastIndexOf(' ')
      if (lastSpace > 0) {
        const maybeNum = parseFloat(bPart.slice(lastSpace + 1))
        if (!isNaN(maybeNum) && maybeNum >= 2.5 && maybeNum <= 10) {
          cutoff = maybeNum
          bPart = bPart.slice(0, lastSpace).trim()
        }
      }
      bExpr = bPart
    } else {
      const maybeNum = parseFloat(arg)
      if (!isNaN(maybeNum) && maybeNum >= 2.5 && maybeNum <= 10) cutoff = maybeNum
    }
    const outcome = runContactAnalysis(aExpr, bExpr, cutoff)
    if (!outcome.ok) return err(outcome.message)
    ok(outcome.message)
    ok('分析面板（左侧「分析」标签）提供 2D 接触图谱与界面残基选择；contacts off 清除')
    return
  }

  if (cmd === 'interface' || cmd === 'iface') {
    // interface <链A> <链B> [cutoff]：链间界面快捷命令
    // 兼容三种写法：interface A B / interface :A :B / interface chain A chain B（表达式风格）
    const s = useMolStore.getState()
    if (!s.activeId) return err('没有活动结构')
    const rest = input.slice(parts[0].length).trim()
    // 尾部截断值
    let expr = rest
    let cutoff: number | undefined
    const lastSpace = expr.lastIndexOf(' ')
    if (lastSpace > 0) {
      const maybeNum = parseFloat(expr.slice(lastSpace + 1))
      if (!isNaN(maybeNum) && maybeNum >= 2.5 && maybeNum <= 10) {
        cutoff = maybeNum
        expr = expr.slice(0, lastSpace).trim()
      }
    }
    const norm = expr.replace(/[:：]/g, ' ').trim()
    const tokens = norm.split(/\s+/)
    const SELECTOR_KEYWORDS = ['chain', 'resn', 'resi', 'name', 'elem', 'protein', 'ligand', 'water', 'within', 'byres', 'not', 'and', 'or', 'backbone', 'sidechain', 'helix', 'sheet', 'coil', 'all', 'polymer', 'hetero', 'metal']
    const isExprStyle = tokens.some(t => SELECTOR_KEYWORDS.includes(t.toLowerCase()))
    let aExpr: string, bExpr: string
    if (isExprStyle && tokens.length >= 4) {
      // 表达式风格：interface chain A chain B → A 组 = chain A，B 组 = chain B
      // 启发式：找到第二个选择关键字的位置切分
      const lower = tokens.map(t => t.toLowerCase())
      const secondKw = lower.lastIndexOf('chain')
      if (secondKw > 0 && lower.indexOf('chain') !== secondKw) {
        aExpr = tokens.slice(0, secondKw).join(' ')
        bExpr = tokens.slice(secondKw).join(' ')
      } else {
        // 其他表达式：无法可靠切分，提示用 contacts 管道语法
        return err('复杂表达式请使用 contacts <A> | <B> [cutoff]，如 contacts chain A | chain B 4.0')
      }
    } else if (tokens.length === 2) {
      aExpr = `chain ${tokens[0]}`
      bExpr = `chain ${tokens[1]}`
    } else {
      return err('用法：interface <链A> <链B> [cutoff]，如 interface A B 4.0 或 interface chain A chain B')
    }
    const outcome = runContactAnalysis(aExpr, bExpr, cutoff)
    if (!outcome.ok) return err(outcome.message)
    ok(outcome.message)
    return
  }

  if (cmd === 'xcontacts' || cmd === 'xcontact' || cmd === 'xiface') {
    // xcontacts <结构A>:<exprA> | <结构B>:<exprB> [cutoff]
    const rest = input.slice(parts[0].length).trim()
    const pipeM = rest.match(/^(.+?)\s*\|\s*(.+)$/)
    if (!pipeM) return err('用法：xcontacts <结构A>:<exprA> | <结构B>:<exprB> [cutoff]，如 xcontacts 1UBQ:chain A | 1D3Z:chain A 5.0')
    let aSpec = pipeM[1].trim()
    let bPart = pipeM[2].trim()
    // 尾部截断值
    let cutoff: number | undefined
    const lastSpace = bPart.lastIndexOf(' ')
    if (lastSpace > 0) {
      const maybeNum = parseFloat(bPart.slice(lastSpace + 1))
      if (!isNaN(maybeNum) && maybeNum >= 2.5 && maybeNum <= 10) {
        cutoff = maybeNum
        bPart = bPart.slice(0, lastSpace).trim()
      }
    }
    const outcome = runCrossContactAnalysis(aSpec, bPart, cutoff)
    if (!outcome.ok) return err(outcome.message)
    ok(outcome.message)
    if (useContactStore.getState().cross) {
      ok('跨结构接触以两结构当前位姿为准（superpose 变换会实时反映在坐标中）；分析面板可查看跨结构界面残基列表')
    }
    return
  }

  if (cmd === 'sasa' || cmd === 'area') {
    const s = useMolStore.getState()
    if (!s.activeId) return err('没有活动结构')
    const data = engineRef.current && dataRegistry.get(s.activeId)
    if (!data) return err('结构数据不存在')
    const probe = clampNum(parseFloat(parts[1]), 0.8, 2.0, 1.4)
    const nPoints = Math.round(clampNum(parseFloat(parts[2]), 32, 512, 92))
    const eng = engineRef.current!
    const r = eng.requestSasa(s.activeId, { probe, nPoints })
    if (r.done && r.stats) {
      const st = r.stats
      ok(`SASA（Shrake–Rupley，probe ${probe} Å，${nPoints} 点）：总计 ${st.total.toFixed(0)} Å² · 疏水 ${st.hydrophobic.toFixed(0)} · 极性 ${st.polar.toFixed(0)} · 水与配体 ${st.het.toFixed(0)} · ${st.ms.toFixed(0)} ms`)
      ok('可用 color sasa 按暴露度着色（埋藏蓝 → 暴露橙红）；分析面板含 Top 暴露残基')
    } else {
      ok(`SASA 计算中（Web Worker，probe ${probe} Å，${nPoints} 点）——完成后将在此输出结果，并自动更新着色`)
    }
    return
  }

  if (cmd === 'bsa' || cmd === 'buried' || cmd === 'bsa-area') {
    const outcome = runBuriedSasa()
    if (!outcome.ok) return err(outcome.message)
    ok(outcome.message)
    if (useSasaStore.getState().buried?.computing === false && useSasaStore.getState().buried) {
      ok('分析面板提供界面核心残基选择（ΔSASA > 1 Å² 判据）')
    }
    return
  }

  if (cmd === 'untransform' || cmd === 'unpose') {
    const s = useMolStore.getState()
    const nameArg = parts[1]
    let targetId = s.activeId
    if (nameArg) {
      const found = s.structures.find(x =>
        x.name.toLowerCase() === nameArg.toLowerCase() ||
        x.name.toLowerCase().startsWith(nameArg.toLowerCase()) ||
        x.meta.pdbId?.toLowerCase() === nameArg.toLowerCase())
      if (!found) return err(`未找到结构 "${nameArg}"（可用：${s.structures.map(x => x.name).join('、')}）`)
      targetId = found.id
    }
    if (!targetId) return err('没有活动结构')
    const r = engineRef.current?.resetTransform(targetId)
    if (!r) return err('引擎未就绪')
    if (!r.ok) return err(r.message)
    ok(r.message + '；会话存档中的变换已同步清除')
    return
  }

  if (cmd === 'record' || cmd === 'rec') {
    const eng = engineRef.current
    if (!eng) return err('引擎未就绪')
    const sub = (parts[1] ?? 'start').toLowerCase()
    if (sub === 'start' || sub === 'on') {
      if (eng.isRecording) return ok('已在录制中')
      const okStart = eng.startRecording()
      if (!okStart) return err('当前浏览器不支持画布录制（MediaRecorder）')
      useRecordStore.getState().setRecording(true)
      return ok('开始录制（30fps WebM）——可同时播放 ensemble / rock / spin；record stop 停止并下载')
    }
    if (sub === 'stop' || sub === 'off') {
      if (!eng.isRecording) return err('当前未在录制')
      void eng.stopRecording().then(blob => {
        useRecordStore.getState().setRecording(false)
        if (!blob || blob.size === 0) {
          useMolStore.getState().appendLog('err', '录制内容为空')
          return
        }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const d = new Date()
        const p = (n: number) => String(n).padStart(2, '0')
        a.href = url
        a.download = `molvision-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.webm`
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
        useMolStore.getState().appendLog('out', `动画已导出：${(blob.size / 1024 / 1024).toFixed(1)} MB WebM`)
      })
      return ok('停止录制，正在生成 WebM…')
    }
    return err('用法：record start | record stop')
  }

  if (cmd === 'session' || cmd === 'save') {
    const sub = (parts[1] ?? (cmd === 'save' ? 'save' : 'info')).toLowerCase()
    if (cmd === 'save' || sub === 'save') {
      const okSaved = saveSession()
      const n = useMolStore.getState().structures.length
      return okSaved && n > 0 ? ok(`会话已保存（${n} 个结构，含相机视角）`) : err('无可保存内容或保存失败')
    }
    if (sub === 'clear' || sub === 'reset') {
      clearSession()
      return ok('会话存档已清除（下次刷新不再恢复）')
    }
    return ok(sessionInfo())
  }

  if (cmd === 'ensemble' || cmd === 'ens') {
    const eng = engineRef.current
    const es = useEnsembleStore.getState()
    if (!eng) return err('引擎未就绪')
    const sub = (parts[1] ?? 'info').toLowerCase()
    if (sub === 'play') {
      if (!es.structureId) return err('当前无含 ensemble 的结构（试试 1D3Z）')
      eng.playEnsemble(es.structureId)
      return ok(`构象动画播放中（${es.total} 帧，P 暂停）`)
    }
    if (sub === 'pause' || sub === 'stop') {
      eng.pauseEnsemble()
      return ok('构象动画已暂停')
    }
    if (sub === 'reset') {
      if (!es.structureId) return err('当前无含 ensemble 的结构')
      eng.resetEnsemble(es.structureId)
      return ok('已回到第 1 帧')
    }
    if (sub === 'frame' || sub === 'goto') {
      if (!es.structureId) return err('当前无含 ensemble 的结构')
      const n = parseInt(parts[2] ?? '', 10)
      if (isNaN(n)) return err('用法：ensemble frame <1..N>')
      eng.setEnsembleFrame(es.structureId, n - 1)
      return ok(`已跳到第 ${n} 帧`)
    }
    if (sub === 'fps' || sub === 'speed') {
      const v = parseFloat(parts[2] ?? '')
      if (isNaN(v) || v < 0.5 || v > 60) return err('用法：ensemble fps <0.5-60>')
      es.setFps(v)
      return ok(`播放速度 ${v} 帧/秒`)
    }
    if (sub === 'interp') {
      const on = (parts[2] ?? 'on').toLowerCase() !== 'off'
      es.setInterp(on)
      return ok(on ? '帧间插值开启（平滑）' : '帧间插值关闭（跳变）')
    }
    if (sub === 'loop') {
      const on = (parts[2] ?? 'on').toLowerCase() !== 'off'
      es.setLoop(on)
      return ok(on ? '循环播放开启' : '循环播放关闭')
    }
    return es.structureId
      ? ok(`ensemble：${es.total} 帧，当前第 ${es.frame + 1} 帧，${es.playing ? '播放中' : '已暂停'}，${es.fps} fps，插值${es.interp ? '开' : '关'}，循环${es.loop ? '开' : '关'}`)
      : err('当前无含 ensemble 的结构（试试 load 1D3Z）')
  }

  if (cmd === 'measure' || cmd === 'dist') {
    return err('测量请使用工具栏的测量模式按钮（距离/角度/二面角），然后在 3D 视图中点击原子')
  }

  err(`未知命令 "${parts[0]}"。输入 help 查看可用命令。`)
}
