// PyMOL 风格命令行：select / show / hide / color / bg / zoom / spin / slab / label / create / map / symmetry / stereo ...
import { PRESETS, useMolStore, engineRef, dataRegistry, buildNamedMasks } from './store'
import { saveSession, clearSession, sessionInfo, exportSessionFile, newSession } from './session'
import { parseCssColor, COLOR_SCHEME_LABELS, type ColorScheme } from './colors'
import { REP_LABELS, type RepType } from './types'
import { useEnsembleStore } from './ensemble-store'
import { useRecordStore } from './record-store'
import { runContactAnalysis, runBuriedSasa, runCrossContactAnalysis, runCrossBuriedSasa } from './contacts'
import { useContactStore } from './contacts-store'
import { useSasaStore } from './sasa-store'
import { subsetStructure } from './parser'
import type { StructureData } from './parser'
import { structureToPdbText } from './pdbwriter'
import { textRegistry } from './text-registry'
import { evaluateSelection, maskToIndices } from './selection'
import { fetchAndComputeMap, removeMap, setMapLook } from './map-load'
import { useMapStore } from './map-store'
import { MAX_BOOKMARKS, useViewsStore } from './views-store'
import { useTourStore } from './tour-store'
import { TOURS, findTour } from './tours'
import { buildMorph, buildMultiMorph } from './morph'
import { playMovie, stopMovie, useMovieStore } from './movie'
import { buildSvgExport, downloadSvg } from './svg-export'
import { clearCmdHistory } from './cmd-history'
import { toast } from 'sonner'

/** 数值裁剪（NaN 时取默认值） */
function clampNum(v: number, min: number, max: number, dflt: number): number {
  if (isNaN(v)) return dflt
  return Math.max(min, Math.min(max, v))
}

const REP_ALIASES: Record<string, RepType> = {
  cartoon: 'cartoon', ribbon: 'cartoon',
  putty: 'putty', 'b-factor': 'putty', bfactor: 'putty',
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
  { cmd: 'create <名> = <选择>', desc: '从选择创建新对象', example: 'create pocket = within 5 of resn HEM' },
  { cmd: 'split_chains', desc: '按链组拆分为多个对象', example: 'split_chains' },
  { cmd: 'select [name=]expr', desc: '选择原子（可命名）', example: 'select site = within 5 of resn HEM' },
  { cmd: 'show <rep> [sel]', desc: '添加表示法（cartoon/putty/sticks…）', example: 'show putty polymer' },
  { cmd: 'hide <rep> [sel]', desc: '移除匹配的表示法', example: 'hide lines' },
  { cmd: 'color <方案|颜色> [sel]', desc: '给选择上色', example: 'color red chain A' },
  { cmd: 'util cbc|cnc|ss|cbaw', desc: '实用着色（链/灰/二级结构/元素+白碳）', example: 'util cbc' },
  { cmd: 'set <项> <值>', desc: '渲染设置（灯光/fov/质量…）', example: 'set ambient 0.5' },
  { cmd: 'bg <颜色>', desc: '设置背景色', example: 'bg black' },
  { cmd: 'zoom [sel]', desc: '缩放到选择/全部', example: 'zoom ligand' },
  { cmd: 'activate <名|编号>', desc: '切换活动结构（多结构工作流）', example: 'activate 1BQL' },
  { cmd: 'orient [sel]', desc: '主轴对齐视角（PCA）', example: 'orient chain A' },
  { cmd: 'get_view / set_view', desc: '视角导出/恢复（JSON）', example: 'get_view' },
  { cmd: 'view save|go|del|list…', desc: '视角书签（缩略图+平滑跳转，Shift+数字）', example: 'view save 口袋' },
  { cmd: 'tour [id]|stop', desc: '引导式演示场景（逐步自动操作）', example: 'tour quickstart' },
  { cmd: 'count_atoms [expr]', desc: '统计原子数', example: 'count_atoms chain A' },
  { cmd: 'spin on|off', desc: '自动旋转', example: 'spin on' },
  { cmd: 'rock on|off', desc: '相机摇摆（±26°）', example: 'rock on' },
  { cmd: 'slab <n>|move <±Å>|center|cap|off', desc: '视向切层（厚度/位置/截面封盖）', example: 'slab 20 · slab move -5 · slab cap off' },
  { cmd: 'stereo on|off', desc: '红蓝立体渲染', example: 'stereo on' },
  { cmd: 'symmetry <半径Å>|off', desc: '晶体对称伴侣（CRYST1）', example: 'symmetry 25' },
  { cmd: 'map fetch <id>|fofc|isolevel pos/neg', desc: '电子密度图（SF→FFT，Worker 零阻塞；结构未加载时自动获取；差图双 σ）', example: 'map fofc 3ekj' },
  { cmd: 'hbonds on|off [n]', desc: '氢键网络开关/距离', example: 'hbonds on 3.2' },
  { cmd: 'ssao on|off [r]', desc: '环境光遮蔽开关/半径', example: 'ssao on 3' },
  { cmd: 'superpose <名> [onto <名>] [chain X to Y]', desc: '结构叠合（序列比对+刚体拟合，可选链对）', example: 'superpose 4HHB onto 1A3N chain A to A' },
  { cmd: 'dssp', desc: 'DSSP 重算二级结构（含无记录结构）', example: 'dssp' },
  { cmd: 'contacts <exprA> | <exprB> [n]', desc: '界面接触检测（残基对+连线）', example: 'contacts chain A | chain B 4.0' },
  { cmd: 'interface <链A> <链B> [n]', desc: '链间界面快捷命令', example: 'interface A B' },
  { cmd: 'xcontacts <A>:<expr> | <B>:<expr> [n]', desc: '跨结构接触（复合物界面，建议先 superpose）', example: 'xcontacts 1UBQ:chain A | 1D3Z:chain A 5.0' },
  { cmd: 'sasa [probe] [点数]', desc: '溶剂可及面积计算（Shrake–Rupley）', example: 'sasa 1.4 92' },
  { cmd: 'bsa', desc: '界面埋藏面积 ΔSASA（需 contacts A/B）', example: 'bsa' },
  { cmd: 'xbsa', desc: '跨结构界面埋藏面积（需 xcontacts，两结构联合三路 SASA）', example: 'xbsa' },
  { cmd: 'untransform [名]', desc: '撤销叠合变换回原始位姿', example: 'untransform 1D3Z' },
  { cmd: 'record start|stop', desc: '录制动画为 WebM 视频', example: 'record start' },
  { cmd: 'morph <名> = <A> <B> [帧] [norefine]', desc: '构象插值轨迹（自动叠合 + 键长约束/去碰撞精修）', example: 'morph m1 = 1BQL 2LYZ 40 · morph m = 1BQL 2LYZ norefine' },
  { cmd: 'morph multi <名> = <A> <B> <C>… [帧]', desc: '多态构象样条插值（Catmull-Rom 过 3+ 构象）', example: 'morph multi m = 1BQL 2LYZ 2VB1 60' },
  { cmd: 'movie play|stop|edit [秒 轮]', desc: '关键帧巡航（无秒数时走时间轴；edit 打开编排）', example: 'movie play · movie edit' },
  { cmd: 'ensemble play|frame|fps…', desc: 'NMR 构象动画控制', example: 'ensemble play' },
  { cmd: 'save <名>.pdb [选择]', desc: '导出坐标为 PDB 文件', example: 'save myprot.pdb chain A' },
  { cmd: 'png [倍率]', desc: '截图导出 PNG', example: 'png 2' },
  { cmd: 'ray [宽px]', desc: 'Ray 级静帧渲染（软阴影+超采样，异步+进度提示）', example: 'ray 1920' },
  { cmd: 'svg [宽px]', desc: '矢量图导出（CPU 投影，无限缩放不失真；可入稿 Illustrator/Inkscape）', example: 'svg 2400' },
  { cmd: 'axes on|off', desc: '视口坐标轴指示器（点击轴端对齐视角）', example: 'axes off' },
  { cmd: 'fps on|off', desc: '状态栏性能指示器（FPS/绘制调用/三角形）', example: 'fps on' },
  { cmd: 'perf on|off|status|restore', desc: '自动性能模式（低帧率降级/恢复）', example: 'perf status · perf off' },
  { cmd: 'outline on|off [强度 粗细]', desc: '出版级轮廓线（Sobel 深度+亮度描边；ray 同样生效）', example: 'outline on · outline on 2 2.5' },
  { cmd: 'session save|export|new|info|clear', desc: '会话存档 / 文件导出 / 新建', example: 'session export · session new' },
  { cmd: 'history [clear]', desc: '命令历史面板（搜索/置顶/执行；clear 清空）', example: 'history · history clear' },
  { cmd: 'label on|off', desc: '标记当前选择 / 清除标签', example: 'label on' },
  { cmd: 'preset <名>', desc: '应用风格预设', example: 'preset surface' },
  { cmd: 'delete <名>', desc: '删除命名选择', example: 'delete site' },
  { cmd: 'close [名|all]', desc: '关闭结构（默认活动结构）', example: 'close · close all · close 4HHB' },
  { cmd: 'clear', desc: '移除所有结构（同 close all）', example: 'clear' },
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
    ok('选择语法：chain A / chainidx 4（按链组精确选择） / resi 1-60 / resn ALA+GLY / name CA / elem C / protein / ligand / water / backbone / helix / sheet / within 5 of (...) / byres(...)，支持 and or not ( )')
    return
  }

  if (cmd === 'history') {
    // 打开命令历史面板（全量列表 + 搜索 + 置顶；clear 子命令直接清空）
    const sub = (parts[1] ?? '').toLowerCase()
    if (sub === 'clear') {
      clearCmdHistory()
      return ok('命令历史已清空（最近命令徽章与 Ctrl+R 搜索同步清除；置顶命令保留）')
    }
    useMolStore.getState().setUi({ historyOpen: true })
    return ok('已打开命令历史面板（搜索过滤 · 星标置顶 · 点击执行 · 铅笔填入编辑）')
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

  if (cmd === 'activate' || cmd === 'use') {
    const s = useMolStore.getState()
    const nameArg = parts[1]
    if (!nameArg) return err(`用法：activate <结构名或PDB编号>（可用：${s.structures.map(x => x.name).join('、') || '无'}）`)
    const q = nameArg.toLowerCase()
    const found = s.structures.find(x =>
      x.name.toLowerCase() === q ||
      x.name.toLowerCase().startsWith(q) ||
      x.meta.pdbId?.toLowerCase() === q)
    if (!found) return err(`未找到结构 "${nameArg}"（可用：${s.structures.map(x => x.name).join('、') || '无'}）`)
    if (found.id !== s.activeId) {
      useMolStore.getState().setActive(found.id)
      return ok(`活动结构 → ${found.name}（show/hide/color/preset 等命令均作用于它）`)
    }
    return ok(`${found.name} 已是活动结构`)
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
    if (arg === 'cap') {
      const sub = (parts[2] ?? '').toLowerCase()
      const cur = useMolStore.getState().settings
      // 无参数 = 切换；显式 on/off = 设定
      const on = sub === 'on' || sub === '1' || sub === 'true' ? true
        : sub === 'off' || sub === '0' || sub === 'false' ? false
        : !cur.slabCap
      useMolStore.getState().updateSettings({ slab: true, slabCap: on })
      return ok(on
        ? `切层截面封盖开启：剖面以平面色填充呈实心（set cap_color 可改色，当前 ${cur.capColor}）`
        : '切层截面封盖关闭（剖面为开放式空壳）')
    }
    if (arg === 'center' || arg === 'reset') {
      useMolStore.getState().updateSettings({ slab: true, slabOffset: 0 })
      return ok('切层已回到环绕目标中心（偏移 0 Å）')
    }
    if (arg === 'move') {
      const d = parseFloat(parts[2] ?? '')
      if (isNaN(d) || d === 0) return err('用法：slab move <±Å>（沿视线移动切层中心；正 = 远离相机）')
      const cur = useMolStore.getState().settings
      const off = Math.max(-80, Math.min(80, (cur.slabOffset ?? 0) + d))
      useMolStore.getState().updateSettings({ slab: true, slabOffset: off })
      return ok(`切层位置 → ${off > 0 ? '+' : ''}${off.toFixed(1)} Å（slab move ${d > 0 ? '+' : ''}${d}）`)
    }
    const n = parseFloat(arg)
    if (isNaN(n) || n <= 0) return err('用法：slab <厚度Å> | slab off | slab move <±Å> | slab center | slab cap on|off')
    useMolStore.getState().updateSettings({ slab: true, slabThickness: n })
    return ok(`裁剪厚度 → ${n} Å（切层中心在环绕目标处；slab move ± 调整位置）`)
  }

  if (cmd === 'perf') {
    const arg = (parts[1] ?? 'status').toLowerCase()
    const s = useMolStore.getState()
    if (arg === 'on') {
      s.updateSettings({ autoPerf: true })
      return ok('自动性能模式已开启：帧率持续偏低（<15 fps 约 3 秒）时自动关闭后处理并降低分辨率，恢复后自动还原')
    }
    if (arg === 'off') {
      s.updateSettings({ autoPerf: false })
      return ok('自动性能模式已关闭（若处于降级状态将立即还原画质设置）')
    }
    if (arg === 'restore') {
      const restored = engineRef.current?.perfManualRestore()
      return restored ? ok('已恢复降级前的画质设置（后处理 / 像素比）') : ok('当前无降级基线，画质保持现状')
    }
    if (arg === 'status') {
      const st = engineRef.current?.perfStatus()
      if (!st) return err('引擎未初始化')
      return ok(`自动性能模式：${st.autoPerf ? '开' : '关'} · 当前帧率 ${st.fps ? st.fps.toFixed(1) : '—'} fps · ${st.degraded ? '降级中（后处理已关、像素比 ×0.6）' : '正常'}${st.autoPerf ? '（perf off / perf restore 可随时手动干预）' : ''}`)
    }
    return err('用法：perf on|off|status|restore')
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

  if (cmd === 'close') {
    // 关闭结构：close（活动）/ close all / close <名|前缀|PDBID>
    const s = useMolStore.getState()
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg === 'all' || arg === '*') {
      const n = s.structures.length
      if (!n) return err('当前没有已加载的结构')
      for (const st of [...s.structures]) s.removeStructure(st.id)
      return ok(`已关闭全部 ${n} 个结构（书签与时间轴保留；彻底重置用 session new）`)
    }
    let target = s.structures.find(x => x.id === s.activeId)
    if (arg) {
      target = s.structures.find(x =>
        x.name.toLowerCase() === arg ||
        x.name.toLowerCase().startsWith(arg) ||
        x.meta.pdbId?.toLowerCase() === arg)
      if (!target) return err(`未找到结构 "${parts[1]}"（可用：${s.structures.map(x => x.name).join('、') || '无'}）`)
    }
    if (!target) return err('没有活动结构（close <名> 指定，或 close all）')
    const atoms = target.summary.atoms
    s.removeStructure(target.id)
    return ok(`已关闭 ${target.name}（${atoms.toLocaleString()} 原子）。结构卡片 X 按钮关闭时 toast 内可撤销`)
  }

  if (cmd === 'clear' || cmd === 'reset') {
    const s = useMolStore.getState()
    const n = s.structures.length
    for (const st of [...s.structures]) s.removeStructure(st.id)
    return ok(n > 0 ? `已清空所有结构（${n} 个；彻底重置含书签/时间轴用 session new）` : '当前没有已加载的结构')
  }

  if (cmd === 'orient') {
    // 主轴对齐（PyMOL orient：PCA）；可带选择表达式
    const eng = engineRef.current
    if (!eng) return err('引擎未就绪')
    const rest = input.slice(parts[0].length).trim()
    if (rest) {
      const s = useMolStore.getState()
      if (!s.activeId) return err('没有活动结构')
      const data = dataRegistry.get(s.activeId)
      if (!data) return err('结构数据不存在')
      const named = buildNamedMasks(s.activeId, data)
      const r = evaluateSelection(rest, { structure: data, named })
      if (r.error) return err(`选择错误: ${r.error}`)
      const indices = maskToIndices(r.mask)
      if (!indices.length) return err('选择为空')
      eng.orient([{ structureId: s.activeId, indices }])
      return ok(`已按主轴对齐视角（${indices.length.toLocaleString()} 个原子，PCA）`)
    }
    eng.orient()
    return ok('已按主轴对齐视角（全部可见结构）')
  }

  if (cmd === 'get_view') {
    const eng = engineRef.current
    if (!eng) return err('引擎未就绪')
    const st = eng.getCameraState()
    ok(JSON.stringify(st))
    return ok('↑ 复制此 JSON，用 set_view <JSON> 可恢复该视角（支持跨会话）')
  }

  if (cmd === 'set_view') {
    const eng = engineRef.current
    if (!eng) return err('引擎未就绪')
    const rest = input.slice(parts[0].length).trim()
    if (!rest) return err('用法：set_view {"pos":[..],"target":[..],"up":[..]}（JSON 来自 get_view）')
    try {
      const parsed = JSON.parse(rest) as { pos?: number[]; target?: number[]; up?: number[]; fov?: number; ortho?: boolean }
      eng.setCameraState(parsed)
      return ok('视角已恢复')
    } catch {
      return err('JSON 解析失败——请粘贴 get_view 输出的完整 JSON')
    }
  }

  if (cmd === 'view' || cmd === 'views' || cmd === 'bookmark') {
    useViewsStore.getState().hydrate()  // 首次（未装载）时从 localStorage 填充
    const vs = useViewsStore.getState() // hydrate 会替换 state 对象——必须重新获取
    const sub = (parts[1] ?? '').toLowerCase()
    if (!sub || sub === 'list' || sub === 'ls') {
      if (!vs.bookmarks.length) return ok('暂无视角书签——view save [名称] 保存当前视角（或快捷键 V）')
      ok(`视角书签（${vs.bookmarks.length}/${MAX_BOOKMARKS}）：`)
      vs.bookmarks.forEach((b, i) => {
        const t = new Date(b.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
        ok(`  ${String(i + 1).padEnd(2)}  ${b.name.padEnd(16)} ${t}${i < 9 ? '  ⇧' + (i + 1) : ''}`)
      })
      return ok('跳转：view <序号|名称> / Shift+数字键；删除：view del <序号|名称>；清空：view clear')
    }
    if (sub === 'save' || sub === 'add' || sub === 'snap') {
      const name = parts.slice(2).join(' ').trim() || undefined
      const bm = vs.addBookmark(name)
      if (!bm) return err(`书签已达上限（${MAX_BOOKMARKS}）——先 view del 删除不再需要的书签`)
      const idx = useViewsStore.getState().bookmarks.length
      return ok(`已保存视角书签「${bm.name}」${idx < 9 ? `（Shift+${idx} 或 view ${idx} 跳转）` : ''}`)
    }
    if (sub === 'clear') {
      vs.clearBookmarks()
      return ok('已清空所有视角书签')
    }
    if (sub === 'del' || sub === 'rm' || sub === 'delete') {
      const arg = parts.slice(2).join(' ').trim()
      if (!arg) return err('用法：view del <序号|名称>')
      const n = Number(arg)
      const target = Number.isInteger(n) && n >= 1 ? vs.bookmarks[n - 1] : vs.bookmarks.find(b => b.name.toLowerCase() === arg.toLowerCase())
      if (!target) return err(`找不到书签「${arg}」`)
      vs.removeBookmark(target.id)
      return ok(`已删除视角书签「${target.name}」`)
    }
    // view <序号|名称> / view go <序号|名称>：跳转（平滑过渡；名称可含空格）
    const arg = (sub === 'go' || sub === 'goto' || sub === 'jump' ? parts.slice(2).join(' ') : parts.slice(1).join(' ')).trim()
    if (!arg) return err('用法：view save [名称] | view <序号|名称> | view del <序号|名称> | view clear')
    const n = Number(arg)
    const target = Number.isInteger(n) && n >= 1 ? vs.bookmarks[n - 1] : vs.bookmarks.find(b => b.name.toLowerCase() === arg.toLowerCase())
    if (!target) return err(`找不到书签「${arg}」——view list 查看现有书签`)
    vs.restoreBookmark(target.id)
    return ok(`已跳转到视角书签「${target.name}」`)
  }

  if (cmd === 'tour' || cmd === 'demo') {
    const sub = (parts[1] ?? '').toLowerCase()
    if (sub === 'stop' || sub === 'exit' || sub === 'quit') {
      useTourStore.getState().stop()
      return ok('演示已结束')
    }
    if (!sub || sub === 'list' || sub === 'ls') {
      ok('引导式演示场景（逐步讲解 + 自动执行，←/→ 切换、Esc 结束）：')
      for (const t of TOURS) ok(`  ${t.id.padEnd(14)} ${t.title}（${t.steps.length} 步 · ≈${t.minutes} 分钟）`)
      return ok('启动：tour <id>，如 tour quickstart；工具栏「演示」菜单同样可启动')
    }
    const t = findTour(sub)
    if (!t) return err(`未知演示「${sub}」——tour 查看可用场景`)
    void useTourStore.getState().start(t.id)
    return ok(`▶ 开始演示「${t.title}」——顶部引导卡片亮起，按 → 键继续`)
  }

  if (cmd === 'count_atoms' || cmd === 'count') {
    const rest = input.slice(parts[0].length).trim()
    const s = useMolStore.getState()
    if (!rest) {
      let n = 0
      for (const x of s.structures) {
        if (!x.visible) continue
        n += dataRegistry.get(x.id)?.atoms.count ?? 0
      }
      return ok(`可见结构共 ${n.toLocaleString()} 个原子（${s.structures.filter(x => x.visible).length} 个对象）`)
    }
    if (!s.activeId) return err('没有活动结构')
    const data = dataRegistry.get(s.activeId)
    if (!data) return err('结构数据不存在')
    const named = buildNamedMasks(s.activeId, data)
    const r = evaluateSelection(rest, { structure: data, named })
    if (r.error) return err(`选择错误: ${r.error}`)
    return ok(`选择包含 ${r.count.toLocaleString()} 个原子（不改变当前选择）`)
  }

  if (cmd === 'create') {
    // create <名> = <选择>：从选择创建新对象（PyMOL 核心工作流）
    const rest = input.slice(parts[0].length).trim()
    const m = rest.match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/)
    if (!m) return err('用法：create <新对象名> = <选择表达式>，如 create pocket = within 5 of resn HEM')
    const name = m[1]
    const expr = m[2].trim()
    const s = useMolStore.getState()
    if (!s.activeId) return err('没有活动结构')
    const data = dataRegistry.get(s.activeId)
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!data || !entry) return err('结构数据不存在')
    const named = buildNamedMasks(s.activeId, data)
    const r = evaluateSelection(expr, { structure: data, named })
    if (r.error) return err(`选择错误: ${r.error}`)
    if (r.count === 0) return err('选择为空（0 个原子）')
    const indices = maskToIndices(r.mask)
    try {
      const t0 = performance.now()
      const sub = subsetStructure(data, indices, name)
      const ms = performance.now() - t0
      const id = useMolStore.getState().addStructure(sub, name, ms)
      // 生成 PDB 文本登记（会话持久化用；坐标为当前世界坐标）
      textRegistry.set(id, structureToPdbText(sub))
      useMolStore.getState().appendLog('out', `已创建对象 ${name}：${sub.atoms.count.toLocaleString()} 原子 · ${sub.residues.length} 残基 · ${ms.toFixed(0)} ms（源：${entry.name}）`)
      return ok(`对象 "${name}" 已创建（${r.count.toLocaleString()} 原子）——可用 show/color 独立控制，已自动登记进会话存档`)
    } catch (e) {
      return err(`创建失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (cmd === 'split_chains' || cmd === 'splitchains') {
    const s = useMolStore.getState()
    if (!s.activeId) return err('没有活动结构')
    const data = dataRegistry.get(s.activeId)
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!data || !entry) return err('结构数据不存在')
    const groups = data.chains.filter(c => c.type !== 'water')
    if (!groups.length) return err('没有非水链组可拆分')
    if (groups.length > 24) return err(`链组过多（${groups.length}）——请先用 create 缩小结构再拆分`)
    // 重名链 ID 加序号（4HHB 同 ID 多组场景）
    const seen = new Map<string, number>()
    let created = 0
    const skippedWater = data.chains.length - groups.length
    for (const c of groups) {
      const base = (c.id || 'X').trim() || 'X'
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      const name = `${entry.name}_${base}${n > 1 ? `#${n}` : ''}`
      const idx: number[] = []
      for (let i = c.start; i < c.end; i++) idx.push(i)
      try {
        const sub = subsetStructure(data, idx, name)
        const id = useMolStore.getState().addStructure(sub, name, 0)
        textRegistry.set(id, structureToPdbText(sub))
        created++
      } catch {
        // 单链失败不阻断
      }
    }
    return ok(`已拆分为 ${created} 个对象（跳过 ${skippedWater} 个水链组；重名链 ID 已加 # 序号）——对象在结构面板中独立可控`)
  }

  if (cmd === 'util') {
    const sub = (parts[1] ?? '').toLowerCase()
    const s = useMolStore.getState()
    if (!s.activeId) return err('没有活动结构')
    const entry = s.structures.find(x => x.id === s.activeId)
    const data = entry ? dataRegistry.get(s.activeId) : null
    if (!entry || !data) return err('结构数据不存在')
    if (sub === 'cbc' || sub === 'chain') {
      s.applyColor('chain')
      return ok('已按链着色（util.cbc）')
    }
    if (sub === 'cnc') {
      s.applyColor('#b7bcc3')
      return ok('已整体灰化（util.cnc）')
    }
    if (sub === 'ss') {
      s.applyColor('ss')
      return ok('已按二级结构着色（util.ss：螺旋红 · 折叠黄 · 环灰）')
    }
    if (sub === 'cbaw' || sub === 'cbac') {
      // 元素着色 + 碳改白/灰（PyMOL 论文图风格：白底黑碳）
      s.applyColor('element')
      const st = useMolStore.getState()
      const e2 = st.structures.find(x => x.id === st.activeId)
      if (!e2) return err('结构数据不存在')
      const scope = st.selection.structureId === e2.id && st.selection.indices.length ? new Set(st.selection.indices) : null
      const overrides = { ...e2.colorOverrides }
      const hex = sub === 'cbaw' ? '#f7f8fa' : '#a9aeb5'
      let n = 0
      for (let i = 0; i < data.atoms.count; i++) {
        if (data.atoms.elements[i] !== 'C') continue
        if (scope && !scope.has(i)) continue
        overrides[i] = hex
        n++
      }
      useMolStore.setState(s2 => ({
        structures: s2.structures.map(x => x.id === e2.id ? { ...x, colorOverrides: overrides, rev: x.rev + 1 } : x),
        visualRev: s2.visualRev + 1,
      }))
      return ok(`已按元素着色 + 碳${sub === 'cbaw' ? '白' : '灰'}（util.${sub}，${n.toLocaleString()} 个碳原子）——适合白底论文图`)
    }
    return err('用法：util cbc | cnc | ss | cbaw | cbac（按链 / 灰化 / 二级结构 / 元素+白碳 / 元素+灰碳）')
  }

  if (cmd === 'set') {
    const key = (parts[1] ?? '').toLowerCase()
    const rawVal = parts.slice(2).join(' ').trim()
    if (!key || !rawVal) return err('用法：set <项> <值>。可用：ambient / direct / fill / specular / fog / fog_strength / fov / spin_speed / quality / stereo / axes / outline / outline_strength / outline_thickness / fps / auto_perf / cap_color / cap_shading / transparency / sphere_scale / stick_radius / cartoon_width')
    const s = useMolStore.getState()
    const num = parseFloat(rawVal)
    const on = ['on', '1', 'true', 'open'].includes(rawVal.toLowerCase())
    const off = ['off', '0', 'false', 'close'].includes(rawVal.toLowerCase())
    if (num === 0 && !on && !off && rawVal !== '0') { /* 非数值非开关，稍后报错 */ }
    const repPatch = (patch: Partial<import('./types').RepConfig>) => {
      const st = useMolStore.getState()
      const entry = st.structures.find(x => x.id === st.activeId)
      if (!entry) return 0
      let n = 0
      for (const r of entry.reps) {
        if (patch.opacity !== undefined && r.type !== 'surface') continue
        if ((patch.ballScale !== undefined) && r.type !== 'spacefill' && r.type !== 'ballstick') continue
        if ((patch.stickRadius !== undefined) && r.type !== 'sticks' && r.type !== 'ballstick') continue
        if ((patch.cartoonWidth !== undefined) && r.type !== 'cartoon' && r.type !== 'putty') continue
        st.updateRep(entry.id, r.id, patch)
        n++
      }
      return n
    }
    switch (key) {
      case 'ambient': {
        if (isNaN(num)) return err('用法：set ambient <0-2>，默认 1')
        s.updateSettings({ lightAmbient: clampNum(num, 0, 2, 1) })
        return ok(`环境光 → ${clampNum(num, 0, 2, 1)}（含环境贴图贡献）`)
      }
      case 'direct': case 'key': {
        if (isNaN(num)) return err('用法：set direct <0-3>，默认 1')
        s.updateSettings({ lightKey: clampNum(num, 0, 3, 1) })
        return ok(`主光强度 → ${clampNum(num, 0, 3, 1)}`)
      }
      case 'fill': {
        if (isNaN(num)) return err('用法：set fill <0-2>，默认 1')
        s.updateSettings({ lightFill: clampNum(num, 0, 2, 1) })
        return ok(`补光强度 → ${clampNum(num, 0, 2, 1)}`)
      }
      case 'specular': {
        if (!on && !off) return err('用法：set specular on|off（关闭后无镜面高光，哑光质感）')
        s.updateSettings({ specular: on })
        return ok(`高光 ${on ? '开启' : '关闭'}（set specular off 得到哑光/论文风格渲染）`)
      }
      case 'fog': {
        if (!on && !off) return err('用法：set fog on|off')
        s.updateSettings({ fog: on })
        return ok(`雾效 ${on ? '开启（远端淡化）' : '关闭'}`)
      }
      case 'fog_strength': case 'fog_density': {
        if (isNaN(num)) return err('用法：set fog_strength <0-1>')
        s.updateSettings({ fog: true, fogStrength: clampNum(num, 0, 1, 0.5) })
        return ok(`雾强度 → ${clampNum(num, 0, 1, 0.5)}（雾效已开启）`)
      }
      case 'fov': case 'field_of_view': {
        if (isNaN(num)) return err('用法：set fov <10-100>，默认 45')
        s.updateSettings({ fov: clampNum(num, 10, 100, 45) })
        return ok(`视场角 → ${clampNum(num, 10, 100, 45)}°（小值≈长焦）`)
      }
      case 'spin_speed': {
        if (isNaN(num)) return err('用法：set spin_speed <0.5-20>')
        s.updateSettings({ spinSpeed: clampNum(num, 0.5, 20, 2) })
        return ok(`旋转速度 → ${clampNum(num, 0.5, 20, 2)}`)
      }
      case 'quality': {
        const q = rawVal.toLowerCase()
        if (!['low', 'medium', 'high'].includes(q)) return err('用法：set quality low|medium|high')
        s.updateSettings({ quality: q as 'low' | 'medium' | 'high' })
        return ok(`画质 → ${q}（像素比与几何细分）`)
      }
      case 'stereo': {
        if (!on && !off) return err('用法：set stereo on|off 或 stereo on|off')
        s.updateSettings({ stereo: on })
        return ok(on ? '红蓝立体开启（佩戴红蓝 3D 眼镜；GTAO 暂停）' : '立体渲染关闭')
      }
      case 'axes': case 'show_axes': {
        if (!on && !off) return err('用法：set axes on|off（视口右上角坐标轴指示器）')
        s.updateSettings({ showAxes: on })
        return ok(`坐标轴指示器 ${on ? '开启（点击轴端可对齐视角）' : '关闭'}`)
      }
      case 'fps': case 'show_fps': {
        if (!on && !off) return err('用法：set fps on|off（状态栏性能指示器）')
        s.updateSettings({ showFps: on })
        return ok(`性能指示器 ${on ? '开启（状态栏显示 FPS / 绘制调用 / 三角形数）' : '关闭'}`)
      }
      case 'seq_focus': case 'viewport_focus': {
        if (!on && !off) return err('用法：set seq_focus on|off（序列条视口聚焦指示）')
        s.updateSettings({ seqFocus: on })
        return ok(`序列条视口聚焦 ${on ? '开启（视野内残基绿色下划线标记，切层裁剪同步感知）' : '关闭'}`)
      }
      case 'cap_color': case 'slab_cap_color': {
        const css = parseCssColor(rawVal.toLowerCase())
        if (!css) return err('用法：set cap_color <#hex 或颜色名>（切层剖面封盖色，默认 #ccd2d9）')
        s.updateSettings({ slab: true, slabCap: true, capColor: css })
        return ok(`截面封盖色 → ${css}（slab cap 已开启）`)
      }
      case 'cap_shading': case 'slab_cap_shading': case 'depth_cue_cap': {
        if (!on && !off) return err('用法：set cap_shading on|off（封盖深度明暗：剖面远端加深，呈现层次）')
        s.updateSettings({ capShading: on })
        return ok(on
          ? '封盖深度明暗开启：剖面按视深由亮到暗渐变（远端加深），立体层次感增强'
          : '封盖深度明暗关闭（剖面回到统一平面色）')
      }
      case 'auto_perf': case 'autoperf': {
        if (!on && !off) return err('用法：set auto_perf on|off（低帧率自动降级，恢复后自动还原）')
        s.updateSettings({ autoPerf: on })
        return ok(on ? '自动性能模式开启（帧率持续偏低时自动关闭后处理并降分辨率）' : '自动性能模式关闭（画质设置已还原）')
      }
      case 'outline': {
        if (!on && !off) return err('用法：set outline on|off（出版级轮廓线；或 outline on 1.5 2）')
        s.updateSettings({ outline: on })
        return ok(`轮廓线 ${on ? '开启（Sobel 深度+亮度描边；ray 静帧同样生效）' : '关闭'}`)
      }
      case 'outline_strength': {
        if (isNaN(num)) return err('用法：set outline_strength <0.2-3>，默认 1')
        s.updateSettings({ outline: true, outlineStrength: clampNum(num, 0.2, 3, 1) })
        return ok(`轮廓线强度 → ${clampNum(num, 0.2, 3, 1).toFixed(1)}（已开启）`)
      }
      case 'outline_thickness': {
        if (isNaN(num)) return err('用法：set outline_thickness <1-4>（像素采样步长），默认 1.5')
        s.updateSettings({ outline: true, outlineThickness: clampNum(num, 1, 4, 1.5) })
        return ok(`轮廓线粗细 → ${clampNum(num, 1, 4, 1.5).toFixed(1)}px（已开启）`)
      }
      case 'transparency': case 'surface_opacity': {
        if (isNaN(num)) return err('用法：set transparency <0-1>（0=不透明，作用于表面表示）')
        const opacity = clampNum(1 - num, 0.05, 1, 0.6)
        const n = repPatch({ opacity })
        return n ? ok(`表面不透明度 → ${opacity.toFixed(2)}（${n} 个表面表示）`) : err('当前结构没有表面表示（先 show surface）')
      }
      case 'sphere_scale': case 'ball_scale': {
        if (isNaN(num)) return err('用法：set sphere_scale <0.2-3>')
        const n = repPatch({ ballScale: clampNum(num, 0.2, 3, 1) })
        return n ? ok(`球体倍率 → ${clampNum(num, 0.2, 3, 1)}（${n} 个表示）`) : err('没有球体类表示（spacefill / ballstick）')
      }
      case 'stick_radius': {
        if (isNaN(num)) return err('用法：set stick_radius <0.05-0.5 Å>')
        const n = repPatch({ stickRadius: clampNum(num, 0.05, 0.5, 0.16) })
        return n ? ok(`棍半径 → ${clampNum(num, 0.05, 0.5, 0.16)} Å（${n} 个表示）`) : err('没有棍类表示（sticks / ballstick）')
      }
      case 'cartoon_width': {
        if (isNaN(num)) return err('用法：set cartoon_width <0.3-4>')
        const n = repPatch({ cartoonWidth: clampNum(num, 0.3, 4, 1) })
        return n ? ok(`cartoon 宽度 → ${clampNum(num, 0.3, 4, 1)}（${n} 个表示）`) : err('没有 cartoon 表示')
      }
      default:
        return err(`未知设置项 "${key}"。可用：ambient, direct, fill, specular, fog, fog_strength, fov, spin_speed, quality, stereo, axes, outline, outline_strength, outline_thickness, fps, auto_perf, cap_color, cap_shading, transparency, sphere_scale, stick_radius, cartoon_width`)
    }
  }

  if (cmd === 'stereo') {
    const arg = (parts[1] ?? 'on').toLowerCase()
    const on = arg === 'on' || arg === '1' || arg === 'true'
    useMolStore.getState().updateSettings({ stereo: on })
    return ok(on ? '红蓝立体开启（佩戴红蓝 3D 眼镜观看；GTAO 在立体模式下暂停）' : '立体渲染关闭')
  }

  if (cmd === 'axes' || cmd === 'axis' || cmd === 'gizmo') {
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg && arg !== 'on' && arg !== 'off' && arg !== '1' && arg !== '0') return err('用法：axes on|off（视口右上角坐标轴指示器）')
    const s = useMolStore.getState()
    const on = arg ? ['on', '1'].includes(arg) : !s.settings.showAxes
    s.updateSettings({ showAxes: on })
    return ok(on ? '坐标轴指示器开启（视口右上角；点击轴端对齐视角）' : '坐标轴指示器已关闭')
  }

  if (cmd === 'fps' || cmd === 'perf') {
    const arg = (parts[1] ?? '').toLowerCase()
    if (arg && arg !== 'on' && arg !== 'off' && arg !== '1' && arg !== '0') return err('用法：fps on|off（状态栏实时性能指示）')
    const s = useMolStore.getState()
    const on = arg ? ['on', '1'].includes(arg) : !s.settings.showFps
    s.updateSettings({ showFps: on })
    return ok(on ? '性能指示器开启（状态栏显示 FPS / 绘制调用 / 三角形数）' : '性能指示器已关闭')
  }

  if (cmd === 'outline' || cmd === 'edge') {
    // outline on|off [强度] [粗细]
    const rest = parts.slice(1)
    const arg = (rest[0] ?? '').toLowerCase()
    const s = useMolStore.getState()
    let on: boolean
    if (arg === 'on' || arg === '1') on = true
    else if (arg === 'off' || arg === '0') on = false
    else on = !s.settings.outline
    const patch: { outline: boolean; outlineStrength?: number; outlineThickness?: number } = { outline: on }
    const strength = rest[1] !== undefined ? parseFloat(rest[1]) : NaN
    if (!isNaN(strength)) patch.outlineStrength = clampNum(strength, 0.2, 3, 1)
    const thickness = rest[2] !== undefined ? parseFloat(rest[2]) : NaN
    if (!isNaN(thickness)) patch.outlineThickness = clampNum(thickness, 1, 4, 1.5)
    s.updateSettings(patch)
    if (!on) return ok('轮廓线已关闭')
    const cur = useMolStore.getState().settings
    return ok(`轮廓线开启（强度 ${cur.outlineStrength.toFixed(1)} · 粗细 ${cur.outlineThickness.toFixed(1)}px）——出版级描边：Sobel 深度+亮度双信号，ray 静帧同样生效`)
  }

  if (cmd === 'symmetry' || cmd === 'symmates') {
    const s = useMolStore.getState()
    const eng = engineRef.current
    if (!eng) return err('引擎未就绪')
    let argStr = input.slice(parts[0].length).trim()
    let targetId = s.activeId
    // 首 token 若为结构名（非数字非 off）→ 指定结构
    const first = (argStr.split(/\s+/)[0] ?? '').toLowerCase()
    const isNumOrOff = first === 'off' || first === '' || !isNaN(parseFloat(first))
    if (!isNumOrOff && first) {
      const found = s.structures.find(x => x.name.toLowerCase().startsWith(first) || x.meta.pdbId?.toLowerCase() === first)
      if (!found) return err(`未找到结构 "${first}"（可用：${s.structures.map(x => x.name).join('、')}）`)
      targetId = found.id
      argStr = argStr.slice(first.length).trim()
    }
    if (!targetId) return err('没有活动结构')
    if (argStr === 'off' || argStr === '0') {
      const r = eng.updateSymmetry(targetId, 0)
      return r.ok ? ok(r.message) : err(r.message)
    }
    const radius = clampNum(parseFloat(argStr), 5, 80, 20)
    const r = eng.updateSymmetry(targetId, radius)
    if (!r.ok) return err(r.message)
    ok(r.message)
    ok('对称伴侣为视觉副本（不参与拾取/选择）；结构面板可调半径或关闭')
    return
  }

  if (cmd === 'map') {
    const sub = (parts[1] ?? '').toLowerCase()
    const isFofc = sub === 'fofc' || sub === 'diff' || sub === 'difference'
    if (sub === 'fetch' || sub === 'load' || sub === 'calc' || sub === 'compute' || isFofc) {
      const idArg = isFofc ? parts[2] : parts[2]
      // 幂等：同编号同类型的图已加载且引擎图层仍在 → 跳过重新计算（演示可安全重放）。
      // 引擎侧必须同时确认（Fast Refresh/引擎重建会丢图层而镜像残留——此时应走重算恢复）
      const wantId = (idArg ?? useMolStore.getState().structures.find(x => x.id === useMolStore.getState().activeId)?.meta.pdbId ?? '').toUpperCase()
      const wantKind = isFofc ? 'fofc' : '2fofc'
      const cur = useMapStore.getState()
      if (wantId && !cur.computing && engineRef.current?.getMapInfo() && cur.info?.source === 'sf' && cur.info.pdbId === wantId && cur.info.kind === wantKind) {
        if (!cur.info.visible) setMapLook({ visible: true })
        return ok(`密度图 ${wantId} ${isFofc ? 'Fo−Fc 差图' : '2Fo−Fc'} 已在场景中——跳过重复计算（map off 后可重新计算）`)
      }
      if (idArg && /^[0-9][a-z0-9]{3}$/i.test(idArg)) {
        void fetchAndComputeMap(idArg, isFofc ? 'fofc' : '2fofc')
        return ok(isFofc
          ? `正在获取 ${idArg.toUpperCase()} 结构因子并合成 Fo−Fc 差图（±σ 正绿/负红；未加载的结构会自动获取作为相位模型）…`
          : `正在获取 ${idArg.toUpperCase()} 结构因子并合成 2Fo−Fc 密度图（模型相位 + 3D FFT；未加载的结构会自动获取）…`)
      }
      const s = useMolStore.getState()
      const pid = s.structures.find(x => x.id === s.activeId)?.meta.pdbId
      if (!pid) return err('用法：map fetch <PDB编号> | map fofc <PDB编号>（结构未加载时将自动从 RCSB 获取作为相位模型）')
      void fetchAndComputeMap(pid, isFofc ? 'fofc' : '2fofc')
      return ok(`正在获取 ${pid} 结构因子并合成 ${isFofc ? 'Fo−Fc 差图' : '2Fo−Fc 密度图'}…`)
    }
    if (sub === 'isolevel' || sub === 'iso' || sub === 'level') {
      // map isolevel <σ>（差图同时设正负）| map isolevel pos <σ> / neg <σ>（差图独立正负峰）
      const sideArg = (parts[2] ?? '').toLowerCase()
      const isPos = sideArg === 'pos' || sideArg === 'positive' || sideArg === '+'
      const isNeg = sideArg === 'neg' || sideArg === 'negative' || sideArg === '-'
      const v = parseFloat(isPos || isNeg ? (parts[3] ?? '') : (parts[2] ?? ''))
      if (isNaN(v) || v < 0.2 || v > 8) {
        return err('用法：map isolevel <σ 0.2-8>；差图可分开设置：map isolevel pos 3 / map isolevel neg 2.5')
      }
      const info = engineRef.current?.getMapInfo()
      if (isPos || isNeg) {
        if (!info) return err('未加载密度图（map fetch <编号> / map fofc <编号>）')
        if (!info.difference) return err('正/负峰独立级别仅适用于 Fo−Fc 差图（map fofc <编号>）')
        setMapLook(isPos ? { iso: v } : { isoNeg: v })
        return ok(isPos
          ? `差图正峰（绿）等值面 → +${v} σ`
          : `差图负峰（红）等值面 → −${v} σ`)
      }
      setMapLook({ iso: v, isoNeg: v })
      return info?.difference
        ? ok(`差图等值面级别 → ±${v} σ（可用 map isolevel pos/neg 分开调整正负峰）`)
        : ok(`等值面级别 → ${v} σ（1σ≈噪声基准，1.5-2σ 常规骨架）`)
    }
    if (sub === 'mesh') { setMapLook({ mode: 'mesh' }); return ok('密度图切换为网格 isomesh') }
    if (sub === 'surface') { setMapLook({ mode: 'surface' }); return ok('密度图切换为实体面 isosurface') }
    if (sub === 'both') { setMapLook({ mode: 'both' }); return ok('密度图切换为网格+面叠加') }
    if (sub === 'off' || sub === 'close' || sub === 'remove') { removeMap(); return ok('密度图已移除') }
    if (sub === 'hide') { setMapLook({ visible: false }); return ok('密度图已隐藏（map show 恢复）') }
    if (sub === 'show') { setMapLook({ visible: true }); return ok('密度图已显示') }
    const info = engineRef.current?.getMapInfo()
    if (!info) {
      return err('未加载密度图。用法：map fetch <PDB编号> | map fofc <PDB编号> | isolevel <σ> | mesh | surface | both | hide | show | off（未加载的结构会自动获取；也可拖入 .ccp4/.map/.mrc 文件）')
    }
    return ok(`密度图 ${info.name}：${info.dims.join('×')} 体素 · ${info.triangles.toLocaleString()} 三角形 · ${info.difference
      ? (Math.abs(info.iso - info.isoNeg) < 1e-6 ? `±${info.iso.toFixed(1)}σ 差图` : `+${info.iso.toFixed(1)}/−${info.isoNeg.toFixed(1)}σ 差图`)
      : `${info.iso.toFixed(1)} σ`} · 模式 ${info.mode}${info.truncated ? '（已截断）' : ''} · rms ${info.rms.toFixed(3)}`)
  }

  if (cmd === 'png') {
    const eng = engineRef.current
    if (!eng) return err('引擎未就绪')
    const scale = clampNum(parseFloat(parts[1]), 1, 4, 2)
    const s = useMolStore.getState()
    try {
      const url = eng.capture({ scale })
      const a = document.createElement('a')
      a.href = url
      a.download = `${s.structures[0]?.name ?? 'molvision'}${scale > 1 ? `@${scale}x` : ''}.png`
      a.click()
      return ok(`已导出 PNG（${scale}× 分辨率）`)
    } catch {
      return err('截图失败')
    }
  }

  if (cmd === 'ray') {
    // PyMOL ray 风格静帧：软阴影 + 1.5× 超采样，导出高清 PNG
    // 异步化：先弹进度 toast 再渲染（双 rAF 让提示先绘制），避免长时间无反馈的「假死」观感
    const eng = engineRef.current
    if (!eng) return err('引擎未就绪')
    if (!eng.hasStructures) return err('场景为空——先加载结构再渲染（load <PDB编号>）')
    let width: number | undefined
    if (parts[1]) {
      width = clampNum(parseFloat(parts[1]), 320, 4096, NaN)
      if (isNaN(width)) return err('用法：ray [宽 px]（如 ray 1920；缺省按视口 2× 自适应）')
    }
    const s = useMolStore.getState()
    const tid = 'ray-render'
    ok('Ray 渲染已启动（PCF 软阴影 + 1.5× 超采样）——完成后自动导出 PNG，期间界面可能短暂停顿')
    toast.loading('Ray 渲染中…', { id: tid, description: '软阴影 + 超采样静帧渲染，大场景需数秒' })
    void (async () => {
      // 双 rAF：确保 loading toast 先绘制到屏幕，再进入阻塞渲染
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      try {
        const r = eng.rayRender({ width })
        if (!r.url) {
          toast.error('Ray 渲染失败', { id: tid, description: '画布尺寸限制——试试更小的宽度' })
          useMolStore.getState().appendLog('err', 'Ray 渲染失败（画布尺寸限制——试试更小的宽度）')
          return
        }
        const a = document.createElement('a')
        a.href = r.url
        a.download = `${s.structures[0]?.name ?? 'molvision'}-ray-${r.w}x${r.h}.png`
        a.click()
        const ms = r.ms.toFixed(0)
        toast.success(`Ray 完成：${r.w}×${r.h} px`, { id: tid, description: `耗时 ${ms} ms · PNG 已导出` })
        useMolStore.getState().appendLog('out', `Ray 渲染完成：${r.w}×${r.h} px（PCF 软阴影 + 1.5× 内部超采样）· ${ms} ms——已导出 PNG`)
      } catch {
        toast.error('Ray 渲染失败', { id: tid, description: '显存或画布尺寸限制——试试更小的宽度' })
        useMolStore.getState().appendLog('err', 'Ray 渲染失败（显存或画布尺寸限制——试试更小的宽度）')
      }
    })()
    return
  }

  if (cmd === 'svg') {
    // 矢量图导出：CPU 侧投影（画家算法），无限缩放不失真，可入稿 Illustrator/Inkscape
    let width: number | undefined
    if (parts[1]) {
      width = clampNum(parseFloat(parts[1]), 320, 4096, NaN)
      if (isNaN(width)) return err('用法：svg [宽 px]（如 svg 2400；缺省 1600，高度按视口纵横比）')
    }
    const s = useMolStore.getState()
    const r = buildSvgExport({ width })
    if (!r.ok || !r.svg) return err(r.error ?? 'SVG 导出失败')
    const name = s.structures[0]?.name ?? 'molvision'
    downloadSvg(r.svg, name)
    const skipped = r.skippedSurfaces.length
      ? `；跳过 ${r.skippedSurfaces.length} 个表面表示（等值面无矢量原语）`
      : ''
    return ok(`已导出矢量图 ${r.width}×${r.height} · ${r.items.toLocaleString()} 个原语 · ${r.ms.toFixed(0)} ms${skipped}——SVG 无限缩放不失真，可直接入稿`)
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
    const hasSel = s.selection.indices.length > 0
    const scope = s.settings.hbondSelOnly
      ? (hasSel ? `当前选择集（${s.selection.indices.length.toLocaleString()} 原子）范围内` : '仅选择集模式：请先选择残基/链（无选择时暂不显示，避免全局网络淹没结构）')
      : '全结构网络（大结构较密，可在场景面板开启「仅选择集」缩小范围）'
    return ok(`氢键网络开启${!isNaN(dist) && dist >= 2 && dist <= 6 ? `（距离上限 ${dist} Å）` : ''}——${scope}，快捷键 B 切换`)
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

  if (cmd === 'xbsa' || cmd === 'xburied' || cmd === 'xbsa-area') {
    const outcome = runCrossBuriedSasa()
    if (!outcome.ok) return err(outcome.message)
    ok(outcome.message)
    const b = useSasaStore.getState().buried
    if (b && b.cross && !b.computing) {
      ok('以两结构当前位姿为准（superpose 变换实时反映）；分析面板提供两侧核心残基选择')
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

  if (cmd === 'session' || (cmd === 'save' && !(parts[1] ?? '').toLowerCase().endsWith('.pdb') && !(parts[1] ?? '').toLowerCase().endsWith('.ent'))) {
    const sub = (parts[1] ?? (cmd === 'save' ? 'save' : 'info')).toLowerCase()
    if (cmd === 'save' || sub === 'save') {
      const okSaved = saveSession()
      const n = useMolStore.getState().structures.length
      return okSaved && n > 0 ? ok(`会话已保存（${n} 个结构，含相机视角）`) : err('无可保存内容或保存失败')
    }
    if (sub === 'export' || sub === 'file') {
      // 导出 .molvision 会话文件（含结构源文本与全部视图状态）
      const okExport = exportSessionFile()
      return okExport
        ? ok('会话已导出为 .molvision 文件（含结构源文本 · 表示法 · 设置 · 相机视角 · 书签）')
        : err('无可导出的会话（先加载结构）')
    }
    if (sub === 'new') {
      const closed = newSession()
      return ok(closed > 0
        ? `已新建会话（关闭 ${closed} 个结构，书签/时间轴/密度图已清空）`
        : '已新建会话（书签/时间轴/密度图已清空）')
    }
    if (sub === 'clear' || sub === 'reset') {
      clearSession()
      return ok('会话存档已清除（下次刷新不再恢复）')
    }
    return ok(sessionInfo())
  }

  if (cmd === 'save') {
    // save <名>.pdb [选择]：坐标导出（PyMOL save）
    const fileName = parts[1] ?? ''
    if (!fileName.toLowerCase().endsWith('.pdb') && !fileName.toLowerCase().endsWith('.ent')) {
      return err('用法：save <文件名>.pdb [选择表达式]（导出坐标）；会话存档用 session save')
    }
    const s = useMolStore.getState()
    if (!s.activeId) return err('没有活动结构')
    const data = dataRegistry.get(s.activeId)
    const entry = s.structures.find(x => x.id === s.activeId)
    if (!data || !entry) return err('结构数据不存在')
    const expr = parts.slice(2).join(' ').trim()
    let outData = data
    let atomCount = data.atoms.count
    if (expr) {
      const named = buildNamedMasks(s.activeId, data)
      const r = evaluateSelection(expr, { structure: data, named })
      if (r.error) return err(`选择错误: ${r.error}`)
      if (r.count === 0) return err('选择为空')
      try {
        outData = subsetStructure(data, maskToIndices(r.mask), entry.name)
        atomCount = outData.atoms.count
      } catch (e) {
        return err(`导出失败：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    const text = structureToPdbText(outData)
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName.toLowerCase().endsWith('.ent') ? fileName : fileName.replace(/\.[^.]*$/, '') + '.pdb'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return ok(`已导出 ${atomCount.toLocaleString()} 个原子 → ${a.download}${expr ? `（选择：${expr}）` : ''}（世界坐标，含 CRYST1）`)
  }

  if (cmd === 'morph') {
    // morph [multi] <新名> = <结构A> <结构B> [<结构C>…] [帧数]：构象插值轨迹（对标 PyMOL morph）
    const isMulti = (parts[1] ?? '').toLowerCase() === 'multi'
    // parts = input 按空白切分；multi 时去掉前两个词，否则去掉命令词（避免手算偏移漏空格）
    const rest = (isMulti ? parts.slice(2) : parts.slice(1)).join(' ')
    const m = rest.match(/^([A-Za-z_][\w]*)\s*=\s*(.+)$/)
    if (!m) return err(isMulti
      ? '用法：morph multi <新对象名> = <构象A> <构象B> <构象C> … [帧数]，如 morph multi m = 1BQL 2LYZ 2VB1 60'
      : '用法：morph <新对象名> = <结构A> <结构B> [帧数]，如 morph m1 = 1BQL 2LYZ 40')
    const name = m[1]
    const tail = m[2].trim().split(/\s+/)
    // 尾部可选标志：norefine 关闭帧精修（键长约束 + 去碰撞）
    const noRefine = tail.some(t => t.toLowerCase() === 'norefine')
    const tailClean = tail.filter(t => t.toLowerCase() !== 'norefine')
    if (tailClean.length < 2) return err(`需要至少两个构象：morph ${isMulti ? 'multi ' : ''}<名> = <A> <B>${isMulti ? ' <C> …' : ''} [帧数] [norefine]`)
    const s = useMolStore.getState()
    const resolve = (q: string) => s.structures.find(x =>
      x.name.toLowerCase() === q.toLowerCase() ||
      x.name.toLowerCase().startsWith(q.toLowerCase()) ||
      x.meta.pdbId?.toLowerCase() === q.toLowerCase())
    const framesTok = tailClean[tailClean.length - 1]
    const framesParsed = /^\d+$/.test(framesTok) ? parseInt(framesTok, 10) : null
    const structToks = framesParsed !== null ? tailClean.slice(0, -1) : tailClean
    const entries = structToks.map(t => resolve(t))
    const missing = structToks.filter((t, i) => !entries[i])
    if (missing.length) return err(`未找到结构：${missing.join('、')}（可用：${s.structures.map(x => x.name).join('、') || '无'}）`)
    const ids = new Set(entries.map(e => e!.id))
    if (ids.size < 2) return err('构象不能来自同一结构（morph 需要不同构象）')
    const datas = entries.map(e => dataRegistry.get(e!.id))
    if (datas.some(d => !d)) return err('结构数据不存在')
    try {
      const t0 = performance.now()
      if (isMulti) {
        // ---------- 多态样条 morph ----------
        const steps = framesParsed ?? 48
        if (steps < 10 || steps > 200) return err('帧数范围 10–200（默认 48）')
        const r = buildMultiMorph(datas as StructureData[], name, steps, !noRefine)
        if (!r.ok || !r.data) return err(r.error ?? 'morph 失败')
        const ms = performance.now() - t0
        const id = useMolStore.getState().addStructure(r.data, name, ms)
        textRegistry.set(id, structureToPdbText(r.data))
        const chainInfo = r.matchedChains.map(([a, b]) => `${a}↔${b}`).join(' ')
        ok(`多态 morph 对象 "${name}" 已创建：${r.knots} 个构象态 · ${r.matchedAtoms.toLocaleString()} 原子 · ${r.matchedResidues.toLocaleString()} 残基 · ${r.frames} 帧（Catmull-Rom 样条，${ms.toFixed(0)} ms）${chainInfo ? ` · 链对 ${chainInfo}` : ''}`)
        if (r.refine) ok(`帧精修（rigimol 风格）：${r.refine.bonds.toLocaleString()} 键长度约束 · 中间帧键长偏差均值 ${r.refine.bondDrift.toFixed(3)} Å 已归零（最大 ${r.refine.maxDrift.toFixed(3)} Å）· 修复非键碰撞 ${r.refine.clashesFixed.toLocaleString()} 处`)
        else if (noRefine) ok('帧精修已关闭（norefine）：中间帧保留纯样条插值')
        r.rmsds.forEach((rmsd, i) => {
          if (rmsd !== null) ok(`构象 ${i + 2}（${structToks[i + 1]}）叠合到参考：CA RMSD ${rmsd.toFixed(2)} Å`)
        })
        if (r.strategy === 'identity') ok('匹配策略：恒等（同源结构按原子序对应）')
        return ok('底部播放条可逐帧浏览样条轨迹——ensemble play 播放，帧滑块可停在任意中间构象')
      }
      // ---------- 双构象 morph ----------
      const steps = framesParsed ?? 30
      if (steps < 10 || steps > 120) return err('帧数范围 10–120（默认 30）')
      const r = buildMorph(datas[0]!, datas[1]!, name, steps, !noRefine)
      if (!r.ok || !r.data) return err(r.error ?? 'morph 失败')
      const ms = performance.now() - t0
      const id = useMolStore.getState().addStructure(r.data, name, ms)
      textRegistry.set(id, structureToPdbText(r.data))
      const chainInfo = r.matchedChains.map(([a, b]) => `${a}↔${b}`).join(' ')
      ok(`morph 对象 "${name}" 已创建：${r.matchedAtoms.toLocaleString()} 原子 · ${r.matchedResidues.toLocaleString()} 残基对 · ${r.frames} 帧${chainInfo ? ` · 链对 ${chainInfo}` : ''}（${ms.toFixed(0)} ms）`)
      if (r.refine) ok(`帧精修（rigimol 风格）：${r.refine.bonds.toLocaleString()} 键长度约束 · 中间帧键长偏差均值 ${r.refine.bondDrift.toFixed(3)} Å 已归零（最大 ${r.refine.maxDrift.toFixed(3)} Å）· 修复非键碰撞 ${r.refine.clashesFixed.toLocaleString()} 处`)
      else if (noRefine) ok('帧精修已关闭（norefine）：中间帧保留纯插值')
      if (r.alignRmsd !== null) ok(`自动叠合 ${entries[1]!.name} → ${entries[0]!.name}：CA RMSD ${r.alignRmsd.toFixed(2)} Å（内存中完成，不改动原结构）`)
      if (r.strategy === 'identity') ok('匹配策略：恒等（同源结构按原子序对应）')
      return ok(`底部出现构象播放条——ensemble play 开始播放，V 键保存当前机位后 movie play 可巡航录制（会话存档保存第 1 帧坐标）`)
    } catch (e) {
      return err(`morph 失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (cmd === 'movie') {
    const sub = (parts[1] ?? 'status').toLowerCase()
    if (sub === 'play' || sub === 'start') {
      const secs = parseFloat(parts[2] ?? '')
      const loops = parseInt(parts[3] ?? '', 10)
      const hasSecs = !isNaN(secs)
      const dur = hasSecs ? secs : 2.6
      const n = isNaN(loops) ? undefined : loops
      const vs = useViewsStore.getState()
      const tl = useMovieStore.getState().timeline
      const byId = new Map(vs.bookmarks.map(b => [b.id, b] as const))
      const validTl = tl.filter(e => byId.has(e.viewId)).length
      // 无显式秒数且时间轴有 ≥2 有效关键帧 → 时间轴模式（逐段时长）；否则经典书签统一时长模式
      const useTl = !hasSecs && validTl >= 2
      if (!useTl && vs.bookmarks.length < 2) return err(`至少需要 2 个视角书签（当前 ${vs.bookmarks.length}）——V 键或 view save 先保存多机位`)
      const rounds = n ?? (useTl ? useMovieStore.getState().loopsEdit : 1)
      // 开始消息立即打印（playMovie 的 promise 在播放结束时才 resolve）
      if (useTl) {
        const totalMs = tl.reduce((s, e) => s + e.duration, 0)
        ok(`movie 开始（时间轴模式）：${validTl} 个关键帧 · 单轮 ${(totalMs / 1000).toFixed(1)}s（逐段时长）× ${rounds} 轮——拖动/滚轮接管停止；record start 可同步录制`)
      } else {
        ok(`movie 开始：${vs.bookmarks.length} 个视角 × ${rounds} 轮 × ${dur}s——拖动/滚轮可随时接管停止；record start 可同步录制`)
      }
      void playMovie({ duration: dur * 1000, loops: n, useTimeline: useTl }).then(r => {
        if (!r.ok) err(r.error)
      })
      return
    }
    if (sub === 'stop' || sub === 'end') {
      stopMovie()
      return ok('movie 序列播放已停止')
    }
    if (sub === 'edit' || sub === 'timeline') {
      useMovieStore.getState().setTimelineOpen(true)
      return ok('movie 时间轴已打开（底部面板：拖拽排序、逐段时长、轮数、播放）——工具栏 Film 按钮可开关')
    }
    const ms = useMovieStore.getState()
    if (ms.playing) {
      return ok(`movie 播放中：段 ${ms.seg + 1}/${ms.total}（${ms.currentName ?? ''}），本段 ${(ms.duration / 1000).toFixed(1)}s × ${ms.loops} 轮`)
    }
    const tlInfo = ms.timeline.length
      ? ` · 时间轴 ${ms.timeline.length} 段（movie play 走时间轴模式；movie edit 打开编排面板）`
      : ' · movie edit 打开时间轴编排面板'
    return ok(`movie 未播放。已存 ${useViewsStore.getState().bookmarks.length} 个视角书签（上限 ${MAX_BOOKMARKS}）——movie play [秒/视角] [轮数] 启动${tlInfo}`)
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
