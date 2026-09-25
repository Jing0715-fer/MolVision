// 结构加载：RCSB API 代理 / 本地文件
import { toast } from 'sonner'
import { tt, loc, type DualText } from '@/i18n'
import { detectFormat, parseStructure } from './parser'
import { useMolStore, engineRef } from './store'
import { textRegistry } from './text-registry'
import { saveSession, importSessionFile } from './session'
import { loadMapBuffer } from './map-load'
import { whenEngineReady } from './engine-ready'

export const EXAMPLE_STRUCTURES: { id: string; title: DualText; desc: DualText }[] = [
  { id: '1CRN', title: { zh: 'Crambin', en: 'Crambin' }, desc: { zh: '小蛋白 · 327 原子 · 高分辨率', en: 'Small protein · 327 atoms · high resolution' } },
  { id: '4HHB', title: { zh: '血红蛋白', en: 'Hemoglobin' }, desc: { zh: '四聚体 · 血红素辅基', en: 'Tetramer · heme cofactors' } },
  { id: '1UBQ', title: { zh: '泛素', en: 'Ubiquitin' }, desc: { zh: '经典 β-grasp 折叠', en: 'Classic β-grasp fold' } },
  { id: '1D3Z', title: { zh: '泛素 NMR', en: 'Ubiquitin NMR' }, desc: { zh: 'ensemble · 10 构象动画', en: 'ensemble · 10-conformer animation' } },
  { id: '1AKI', title: { zh: '溶菌酶', en: 'Lysozyme' }, desc: { zh: '酶 · 129 残基', en: 'Enzyme · 129 residues' } },
  { id: '1BNA', title: { zh: 'B-DNA', en: 'B-DNA' }, desc: { zh: '双链 DNA 十二聚体', en: 'Double-stranded DNA dodecamer' } },
  { id: '6LU7', title: { zh: 'SARS-CoV-2 主蛋白酶', en: 'SARS-CoV-2 Main Protease' }, desc: { zh: '药物靶点 · 二聚体', en: 'Drug target · dimer' } },
]

// ---------- 大结构内存防护（r65 OOM 事故实锤：4GB 容器被核糖体级 ~30 万原子结构拖垮） ----------
// 硬上限拒解析、软阈值告警放行；体积护栏在读取前拦截（FileReader 整读同样吃内存）
const MAX_ATOMS = 300_000
const WARN_ATOMS = 100_000
const MAX_STRUCTURE_MB = 120
const MAX_MAP_MB = 256

/** 记录名边界（空格/Tab/数字——吞掉 ATOMIC 之类前缀同形词） */
function isSep(c: number): boolean {
  return c === 32 || c === 9 || (c >= 48 && c <= 57)
}

/** 行首 ATOM/HETATM 计数（PDB 固定列与 mmCIF atom_site 数据行通用）。
 *  一遍行跳扫描、不逐行切子串——50MB 文本毫秒级完成，parse 前先拦超大体系。 */
function countAtomRecords(text: string): number {
  let n = 0
  let i = 0
  const L = text.length
  while (i < L) {
    const c = text.charCodeAt(i)
    if ((c === 65 && text.startsWith('ATOM', i) && isSep(text.charCodeAt(i + 4)))
      || (c === 72 && text.startsWith('HETATM', i) && isSep(text.charCodeAt(i + 6)))) n++
    const nl = text.indexOf('\n', i)
    if (nl === -1) break
    i = nl + 1
  }
  return n
}

export async function fetchPdbId(idRaw: string): Promise<void> {
  const id = idRaw.trim().toUpperCase()
  const store = useMolStore.getState()
  if (!/^[0-9][A-Z0-9]{3}$/.test(id)) {
    toast.error(tt({ zh: `无效的 PDB 编号: "${id}"（应为 4 位字符，如 4HHB）`, en: `Invalid PDB ID: "${id}" (expected 4 characters, e.g. 4HHB)` }))
    return
  }
  useMolStore.setState({ loading: true, loadingMsg: tt({ zh: `正在从 RCSB 获取 ${id}…`, en: `Fetching ${id} from RCSB…` }) })
  try {
    const res = await fetch(`/api/pdb/${id}`)
    if (!res.ok) {
      // 优先透传服务端错误文案（如 413 体积护栏的具体提示，随界面语言）
      const err = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(err?.error || tt({ zh: `获取失败 (${res.status})`, en: `Fetch failed (${res.status})` }))
    }
    const format = (res.headers.get('x-mol-format') as 'pdb' | 'cif') ?? 'pdb'
    const text = await res.text()
    if (!text || text.length < 100) throw new Error(tt({ zh: '返回内容为空', en: 'Empty response' }))
    loadStructureText(text, id, format)
  } catch (e) {
    toast.error(tt({ zh: `加载 ${id} 失败：${e instanceof Error ? e.message : String(e)}`, en: `Failed to load ${id}: ${e instanceof Error ? e.message : String(e)}` }))
    useMolStore.setState({ loading: false, loadingMsg: '' })
  }
  void store
}

export function loadStructureText(text: string, name: string, format?: 'pdb' | 'cif') {
  const fmt = format ?? detectFormat(text, name)
  // 大结构预扫描（parse 前快速护栏：毫秒级行计数，主线程不卡）
  const atomCount = countAtomRecords(text)
  if (atomCount > MAX_ATOMS) {
    toast.error(tt({
      zh: `结构过大：预扫描到 ${atomCount.toLocaleString(loc())} 条原子记录（上限 ${MAX_ATOMS.toLocaleString(loc())}）`,
      en: `Structure too large: pre-scan found ${atomCount.toLocaleString(loc())} atom records (limit ${MAX_ATOMS.toLocaleString(loc())})`,
    }), {
      description: tt({
        zh: '已停止解析以避免页面失去响应或内存溢出。核糖体等超大体系建议改用较小的结构或链级子集。',
        en: 'Parsing stopped to keep the page responsive and avoid out-of-memory. For huge systems like ribosomes, load a smaller structure or a chain-level subset.',
      }),
    })
    useMolStore.setState({ loading: false, loadingMsg: '' })
    return
  }
  if (atomCount > WARN_ATOMS) {
    toast.warning(tt({
      zh: `大结构提示：${atomCount.toLocaleString(loc())} 个原子`,
      en: `Large structure: ${atomCount.toLocaleString(loc())} atoms`,
    }), {
      description: tt({
        zh: '表示法构建、接触网络与 SASA 计算可能明显变慢，请耐心等待。',
        en: 'Representation building, contact networks and SASA may be noticeably slower — please be patient.',
      }),
    })
  }
  useMolStore.setState({ loading: true, loadingMsg: tt({ zh: `正在解析 ${name}…`, en: `Parsing ${name}…` }) })
  // 延迟到下一帧，让 loading UI 先渲染
  requestAnimationFrame(() => {
    try {
      const t0 = performance.now()
      const data = parseStructure(text, name, fmt)
      const ms = performance.now() - t0
      if (data.atoms.count === 0) {
        throw new Error(tt({ zh: '文件中没有可识别的原子记录（ATOM/HETATM）', en: 'No recognizable atom records (ATOM/HETATM) in the file' }))
      }
      const store = useMolStore.getState()
      const displayName = data.meta.pdbId ?? name
      const id = store.addStructure(data, displayName.toUpperCase() === displayName ? displayName : name, ms)
      // 会话持久化：登记源文本并立即保存
      textRegistry.set(id, text)
      setTimeout(() => saveSession(), 600)
      useMolStore.setState({ loading: false, loadingMsg: '' })
      // 视角适配（欢迎页首发时引擎晚于结构就位——入队，引擎挂载后冲刷）
      whenEngineReady(() => {
        requestAnimationFrame(() => {
          engineRef.current?.fitView()
        })
      })
      toast.success(tt({ zh: `已加载 ${displayName}`, en: `Loaded ${displayName}` }), {
        description: tt({
          zh: `${data.atoms.count.toLocaleString(loc())} 原子 · ${data.residues.length.toLocaleString(loc())} 残基 · ${data.chains.length} 条链 · 解析 ${ms < 1 ? '<1' : ms.toFixed(0)} ms`,
          en: `${data.atoms.count.toLocaleString(loc())} atoms · ${data.residues.length.toLocaleString(loc())} residues · ${data.chains.length} chains · parsed in ${ms < 1 ? '<1' : ms.toFixed(0)} ms`,
        }),
      })
      useMolStore.getState().appendLog('out', tt({
        zh: `已加载 ${displayName}：${data.atoms.count.toLocaleString(loc())} 原子，${data.residues.length.toLocaleString(loc())} 残基，${data.chains.length} 链`,
        en: `Loaded ${displayName}: ${data.atoms.count.toLocaleString(loc())} atoms, ${data.residues.length.toLocaleString(loc())} residues, ${data.chains.length} chains`,
      }))
    } catch (e) {
      toast.error(tt({ zh: `解析失败：${e instanceof Error ? e.message : String(e)}`, en: `Parse failed: ${e instanceof Error ? e.message : String(e)}` }))
      useMolStore.setState({ loading: false, loadingMsg: '' })
    }
  })
}

export function loadFiles(files: FileList | File[]) {
  for (const file of Array.from(files)) {
    const lower = file.name.toLowerCase()
    const sizeMb = (file.size / 1048576).toFixed(0)
    // CCP4 / MRC 密度图文件 → 密度图层（二进制）
    if (/\.(ccp4|map|mrc|dsn6|omap)$/i.test(lower)) {
      // 体积护栏：读取前拦截（FileReader 整读大文件同样吃内存）
      if (file.size > MAX_MAP_MB * 1048576) {
        toast.error(tt({ zh: `密度图文件过大（${sizeMb} MB，上限 ${MAX_MAP_MB} MB）：${file.name}`, en: `Map file too large (${sizeMb} MB, limit ${MAX_MAP_MB} MB): ${file.name}` }))
        continue
      }
      const reader = new FileReader()
      reader.onload = () => loadMapBuffer(reader.result as ArrayBuffer, file.name.replace(/\.[^.]+$/, ''))
      reader.onerror = () => toast.error(tt({ zh: `读取地图文件失败: ${file.name}`, en: `Failed to read map file: ${file.name}` }))
      reader.readAsArrayBuffer(file)
      continue
    }
    // 体积护栏：结构/会话文件读取前拦截
    if (file.size > MAX_STRUCTURE_MB * 1048576) {
      toast.error(tt({ zh: `文件过大（${sizeMb} MB，上限 ${MAX_STRUCTURE_MB} MB）：${file.name}`, en: `File too large (${sizeMb} MB, limit ${MAX_STRUCTURE_MB} MB): ${file.name}` }))
      continue
    }
    // .molvision 会话文件（或内容带 molvision-session 标记的 .json）→ 整会话恢复（替换场景）
    if (/\.molvision$/i.test(lower) || /\.json$/i.test(lower)) {
      void (async () => {
        try {
          const n = await importSessionFile(file)
          if (n > 0) {
            toast.success(tt({ zh: '会话已导入', en: 'Session imported' }), { description: tt({ zh: `${n} 个结构 · 表示法与相机视角已还原（来自 ${file.name}）`, en: `${n} ${n === 1 ? 'structure' : 'structures'} · representations & camera restored (from ${file.name})` }) })
          } else {
            toast.error(tt({ zh: '会话文件中没有可恢复的结构', en: 'No recoverable structures in the session file' }), { description: file.name })
          }
        } catch (e) {
          // .json 可能其实是普通结构文件（罕见命名）——退回按结构解析
          if (/\.json$/i.test(lower)) {
            const text = await file.text()
            loadStructureText(text, file.name.replace(/\.[^.]+$/, ''), undefined)
            return
          }
          toast.error(tt({ zh: '导入会话失败', en: 'Failed to import session' }), { description: e instanceof Error ? e.message : String(e) })
        }
      })()
      continue
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      loadStructureText(text, file.name.replace(/\.(pdb|ent|cif|mmcif|txt)$/i, ''))
    }
    reader.onerror = () => toast.error(tt({ zh: `读取文件失败: ${file.name}`, en: `Failed to read file: ${file.name}` }))
    reader.readAsText(file)
  }
}
