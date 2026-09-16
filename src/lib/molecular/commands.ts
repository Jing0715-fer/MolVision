// PyMOL 风格命令行：select / show / hide / color / bg / zoom / spin / slab / label ...
import { PRESETS, useMolStore, engineRef } from './store'
import { saveSession, clearSession, sessionInfo } from './session'
import { parseCssColor, COLOR_SCHEME_LABELS, type ColorScheme } from './colors'
import { REP_LABELS, type RepType } from './types'

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
  { cmd: 'slab <n>|off', desc: '裁剪厚度(Å)', example: 'slab 20' },
  { cmd: 'hbonds on|off [n]', desc: '氢键网络开关/距离', example: 'hbonds on 3.2' },
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

  if (cmd === 'spin' || cmd === 'rock') {
    const arg = (parts[1] ?? 'on').toLowerCase()
    const on = arg === 'on' || arg === '1' || arg === 'true'
    useMolStore.getState().updateSettings({ spin: on })
    return ok(on ? '自动旋转开启' : '自动旋转关闭')
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

  if (cmd === 'measure' || cmd === 'dist') {
    return err('测量请使用工具栏的测量模式按钮（距离/角度/二面角），然后在 3D 视图中点击原子')
  }

  err(`未知命令 "${parts[0]}"。输入 help 查看可用命令。`)
}
