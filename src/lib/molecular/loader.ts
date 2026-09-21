// 结构加载：RCSB API 代理 / 本地文件
import { toast } from 'sonner'
import { detectFormat, parseStructure } from './parser'
import { useMolStore, engineRef } from './store'
import { textRegistry } from './text-registry'
import { saveSession, importSessionFile } from './session'
import { loadMapBuffer } from './map-load'
import { whenEngineReady } from './engine-ready'

export const EXAMPLE_STRUCTURES: { id: string; title: string; desc: string }[] = [
  { id: '1CRN', title: 'Crambin', desc: '小蛋白 · 327 原子 · 高分辨率' },
  { id: '4HHB', title: '血红蛋白', desc: '四聚体 · 血红素辅基' },
  { id: '1UBQ', title: '泛素', desc: '经典 β-grasp 折叠' },
  { id: '1D3Z', title: '泛素 NMR', desc: 'ensemble · 10 构象动画' },
  { id: '1AKI', title: '溶菌酶', desc: '酶 · 129 残基' },
  { id: '1BNA', title: 'B-DNA', desc: '双链 DNA 十二聚体' },
  { id: '6LU7', title: 'SARS-CoV-2 主蛋白酶', desc: '药物靶点 · 二聚体' },
]

export async function fetchPdbId(idRaw: string): Promise<void> {
  const id = idRaw.trim().toUpperCase()
  const store = useMolStore.getState()
  if (!/^[0-9][A-Z0-9]{3}$/.test(id)) {
    toast.error(`无效的 PDB 编号: "${id}"（应为 4 位字符，如 4HHB）`)
    return
  }
  useMolStore.setState({ loading: true, loadingMsg: `正在从 RCSB 获取 ${id}…` })
  try {
    const res = await fetch(`/api/pdb/${id}`)
    if (!res.ok) {
      throw new Error(`获取失败 (${res.status})`)
    }
    const format = (res.headers.get('x-mol-format') as 'pdb' | 'cif') ?? 'pdb'
    const text = await res.text()
    if (!text || text.length < 100) throw new Error('返回内容为空')
    loadStructureText(text, id, format)
  } catch (e) {
    toast.error(`加载 ${id} 失败：${e instanceof Error ? e.message : String(e)}`)
    useMolStore.setState({ loading: false, loadingMsg: '' })
  }
  void store
}

export function loadStructureText(text: string, name: string, format?: 'pdb' | 'cif') {
  const fmt = format ?? detectFormat(text, name)
  useMolStore.setState({ loading: true, loadingMsg: `正在解析 ${name}…` })
  // 延迟到下一帧，让 loading UI 先渲染
  requestAnimationFrame(() => {
    try {
      const t0 = performance.now()
      const data = parseStructure(text, name, fmt)
      const ms = performance.now() - t0
      if (data.atoms.count === 0) {
        throw new Error('文件中没有可识别的原子记录（ATOM/HETATM）')
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
      toast.success(`已加载 ${displayName}`, {
        description: `${data.atoms.count.toLocaleString()} 原子 · ${data.residues.length.toLocaleString()} 残基 · ${data.chains.length} 条链 · 解析 ${ms < 1 ? '<1' : ms.toFixed(0)} ms${id ? '' : ''}`,
      })
      useMolStore.getState().appendLog('out', `已加载 ${displayName}：${data.atoms.count} 原子，${data.residues.length} 残基，${data.chains.length} 链`)
    } catch (e) {
      toast.error(`解析失败：${e instanceof Error ? e.message : String(e)}`)
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
      reader.onerror = () => toast.error(`读取地图文件失败: ${file.name}`)
      reader.readAsArrayBuffer(file)
      continue
    }
    // .molvision 会话文件（或内容带 molvision-session 标记的 .json）→ 整会话恢复（替换场景）
    if (/\.molvision$/i.test(lower) || /\.json$/i.test(lower)) {
      void (async () => {
        try {
          const n = await importSessionFile(file)
          if (n > 0) {
            toast.success('会话已导入', { description: `${n} 个结构 · 表示法与相机视角已还原（来自 ${file.name}）` })
          } else {
            toast.error('会话文件中没有可恢复的结构', { description: file.name })
          }
        } catch (e) {
          // .json 可能其实是普通结构文件（罕见命名）——退回按结构解析
          if (/\.json$/i.test(lower)) {
            const text = await file.text()
            loadStructureText(text, file.name.replace(/\.[^.]+$/, ''), undefined)
            return
          }
          toast.error('导入会话失败', { description: e instanceof Error ? e.message : String(e) })
        }
      })()
      continue
    }
    const reader = new FileReader()
    reader.onload = () => {
      const text = String(reader.result ?? '')
      loadStructureText(text, file.name.replace(/\.(pdb|ent|cif|mmcif|txt)$/i, ''))
    }
    reader.onerror = () => toast.error(`读取文件失败: ${file.name}`)
    reader.readAsText(file)
  }
}
