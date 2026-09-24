// 结构加载：RCSB API 代理 / 本地文件
import { toast } from 'sonner'
import { tt, type DualText } from '@/i18n'
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
      throw new Error(tt({ zh: `获取失败 (${res.status})`, en: `Fetch failed (${res.status})` }))
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
          zh: `${data.atoms.count.toLocaleString()} 原子 · ${data.residues.length.toLocaleString()} 残基 · ${data.chains.length} 条链 · 解析 ${ms < 1 ? '<1' : ms.toFixed(0)} ms`,
          en: `${data.atoms.count.toLocaleString()} atoms · ${data.residues.length.toLocaleString()} residues · ${data.chains.length} chains · parsed in ${ms < 1 ? '<1' : ms.toFixed(0)} ms`,
        }),
      })
      useMolStore.getState().appendLog('out', tt({
        zh: `已加载 ${displayName}：${data.atoms.count} 原子，${data.residues.length} 残基，${data.chains.length} 链`,
        en: `Loaded ${displayName}: ${data.atoms.count} atoms, ${data.residues.length} residues, ${data.chains.length} chains`,
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
    // CCP4 / MRC 密度图文件 → 密度图层（二进制）
    if (/\.(ccp4|map|mrc|dsn6|omap)$/i.test(lower)) {
      const reader = new FileReader()
      reader.onload = () => loadMapBuffer(reader.result as ArrayBuffer, file.name.replace(/\.[^.]+$/, ''))
      reader.onerror = () => toast.error(tt({ zh: `读取地图文件失败: ${file.name}`, en: `Failed to read map file: ${file.name}` }))
      reader.readAsArrayBuffer(file)
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
