// 引导式演示场景（Guided Tours）：脚本化步骤驱动既有命令行 / 状态 API
// 设计原则：①步骤幂等（重复执行不破坏场景：加载前查重、show 前 hide）②命令走
// runCommand 让控制台留下教学回显 ③异步步骤（加载/密度图）用 waitFor 等待就绪
import { useMolStore, dataRegistry } from './store'
import { useMapStore } from './map-store'
import { fetchPdbId } from './loader'

export type TourIcon = 'flask' | 'pill' | 'layers' | 'waves' | 'dna' | 'puzzle'
export type TourAccent = 'emerald' | 'rose' | 'amber' | 'teal' | 'violet' | 'fuchsia'

export interface TourStep {
  title: string
  body: string
  /** 展示为命令 chip（正文呼应；步骤本身通常已在执行同等动作） */
  cmd?: string
  /** 步骤动作（幂等）；返回 Promise 时下一步按钮等待完成 */
  run?: () => Promise<void> | void
}

export interface TourDef {
  id: string
  title: string
  tagline: string
  icon: TourIcon
  accent: TourAccent
  /** 预计时长（分钟） */
  minutes: number
  steps: TourStep[]
}

// ---------- 幂等执行工具 ----------

/** 轮询等待条件成立（返回非 null 即成功；超时返回 null） */
function waitFor<T>(pred: () => T | null, timeoutMs: number, intervalMs = 120): Promise<T | null> {
  return new Promise(resolve => {
    const t0 = performance.now()
    const tick = () => {
      let v: T | null = null
      try { v = pred() } catch { v = null }
      if (v !== null && v !== undefined) return resolve(v)
      if (performance.now() - t0 > timeoutMs) return resolve(null)
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

/** 按展示名（PDB id）查找已加载结构 */
function findByName(name: string): string | null {
  const want = name.trim().toUpperCase()
  const st = useMolStore.getState()
  const hit = st.structures.find(x =>
    x.name.trim().toUpperCase() === want || (x.meta.pdbId ?? '').trim().toUpperCase() === want)
  return hit?.id ?? null
}

/** 幂等加载：已存在则仅激活，否则从 RCSB 拉取并等待解析完成 */
async function ensureLoaded(pdbId: string): Promise<string | null> {
  const existing = findByName(pdbId)
  if (existing) {
    useMolStore.getState().setActive(existing)
    return existing
  }
  await fetchPdbId(pdbId)
  return waitFor(() => {
    const id = findByName(pdbId)
    return id && !useMolStore.getState().loading ? id : null
  }, 20000)
}

/** 执行命令（延迟导入避免 commands ↔ tours 循环依赖的模块初始化问题） */
async function exec(cmd: string): Promise<void> {
  const { runCommand } = await import('./commands')
  runCommand(cmd)
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** 检查结构是否包含指定链 ID（全部大写比较；找不到结构返回 false） */
function hasChains(structId: string | null, ...chains: string[]): boolean {
  if (!structId) return false
  const data = dataRegistry.get(structId)
  if (!data) return false
  const present = new Set(data.atoms.chainIds.map(c => c.trim().toUpperCase()))
  return chains.every(c => present.has(c.toUpperCase()))
}

/** 等待密度图就绪（computing 归零且 info 出现） */
async function waitForMap(kind: '2fofc' | 'fofc', timeoutMs = 60000): Promise<boolean> {
  const okFlag = await waitFor(() => {
    const m = useMapStore.getState()
    if (m.computing) return null
    if (!m.info || m.info.kind !== kind) return null
    return true
  }, timeoutMs, 250)
  return okFlag === true
}

// ---------- 演示场景定义 ----------

export const TOURS: TourDef[] = [
  {
    id: 'quickstart',
    title: '快速上手 · 血红蛋白',
    tagline: '加载、旋转、选择与口袋分析的最短路径',
    icon: 'flask',
    accent: 'emerald',
    minutes: 2,
    steps: [
      {
        title: '加载第一个结构',
        body: '我们从血红蛋白 4HHB 开始——2 α + 2 β 亚基组成的四聚体，每个亚基口袋里嵌着一个血红素辅基。\n结构正从 RCSB Protein Data Bank 拉取，稍候片刻。',
        cmd: 'load 4hhb',
        run: async () => { await ensureLoaded('4HHB') },
      },
      {
        title: '带状图与视角操作',
        body: '默认的 cartoon 带状图沿多肽骨架走向渲染，是观察整体折叠的首选。\n试试拖动旋转（左键）、平移（右键）和缩放（滚轮）——结构会实时高亮悬停的原子。',
        cmd: 'preset cartoon',
        run: () => { void exec('preset cartoon') },
      },
      {
        title: '按链着色',
        body: 'util cbc 给每条链分配独立颜色（PyMOL 经典 util）。四聚体的 α/β 亚基组合一目了然。',
        cmd: 'util cbc',
        run: () => { void exec('util cbc') },
      },
      {
        title: '血红素口袋',
        body: 'HEM 是铁卟啉辅基——携氧的核心位点。先隐藏棍状表示避免叠加，再只对 HEM 显示棍状模型，并把 4.5 Å 内的结合口袋残基选为命名选择 pocket。\n选中后琥珀色高亮 + 序列条联动会立即出现。',
        cmd: 'show sticks resn HEM',
        run: async () => {
          await exec('hide sticks')
          await exec('show sticks resn HEM')
          await exec('select pocket = byres within 4.5 of resn HEM')
          await exec('zoom pocket')
        },
      },
      {
        title: '氢键网络',
        body: 'hbonds on 在满足几何判据的供体-受体对之间绘制虚线。口袋附近出现的短氢键往往就是催化/结合的关键相互作用。',
        cmd: 'hbonds on',
        run: () => { void exec('hbonds on') },
      },
      {
        title: '自由探索',
        body: '至此你已掌握核心工作流。接下来可以：\n· 数字键 1-8 一键切换风格（putty 看柔性）\n· 工具栏标尺测距/角/二面角\n· 右键原子打开上下文菜单\n· 按 V 保存视角书签，` 打开命令行\n演示结束，随时可从工具栏「演示」重新开始。',
        run: () => { void exec('zoom') },
      },
    ],
  },
  {
    id: 'drug-target',
    title: '药物靶点 · SARS-CoV-2 主蛋白酶',
    tagline: '抑制剂口袋、二聚体界面与埋藏面积（ΔSASA）分析',
    icon: 'pill',
    accent: 'rose',
    minutes: 3,
    steps: [
      {
        title: '加载 Mpro 与 N3 抑制剂',
        body: '6LU7 是首个解析的新冠主蛋白酶结构（2.1 Å），N3 抑制剂共价结合在底物口袋——抗病毒药物设计的经典起点。',
        cmd: 'load 6lu7',
        run: async () => { await ensureLoaded('6LU7') },
      },
      {
        title: '主轴对齐视角',
        body: 'orient（PyMOL 同名命令）对坐标做 PCA 主轴对齐，让二聚体的长轴正对屏幕——发表级构图的第一步。',
        cmd: 'orient',
        run: async () => {
          await exec('orient')
          await exec('util cbc')
        },
      },
      {
        title: '抑制剂棍状模型',
        body: 'ligand 选择器匹配所有 HETATM 小分子（不含水）。N3 以棍状模型显示并缩放到配体，注意口袋周围的催化残基。',
        cmd: 'show sticks ligand',
        run: async () => {
          await exec('hide sticks')
          await exec('show sticks ligand')
          await exec('select pocket = byres within 4.5 of ligand')
          await exec('zoom ligand')
        },
      },
      {
        title: '二聚体界面接触',
        body: 'interface A B 4.0 检测两条链之间 4 Å 内的接触残基对，绘制接触虚线，并在左侧「分析」面板生成 2D 接触图谱与界面残基列表。',
        cmd: 'interface A B 4.0',
        run: async () => {
          const sid = useMolStore.getState().activeId
          if (!hasChains(sid, 'A', 'B')) {
            useMolStore.getState().appendLog('out', '该结构未包含链 A/B——跳过界面分析（可试 contacts chain A | chain A）')
            return
          }
          await exec('zoom')
          await exec('interface A B 4.0')
        },
      },
      {
        title: '界面埋藏面积 ΔSASA',
        body: 'bsa 用三路 SASA（A 单独 / B 单独 / AB 复合）计算界面埋藏面积。ΔSASA > 1 Å² 的残基即界面残基——这是 PDB 界面分析的标准判据。',
        cmd: 'bsa',
        run: async () => {
          await exec('bsa')
          await sleep(400)
        },
      },
      {
        title: '完成',
        body: '药物靶点分析链路已走通：加载 → 口袋 → 界面 → ΔSASA。\n延伸玩法：color sasa 按暴露度着色、map fetch 6lu7 叠加电子密度、save pocket.pdb 导出坐标。',
        run: () => { void exec('zoom') },
      },
    ],
  },
  {
    id: 'crystallography',
    title: '晶体学验证 · 差值密度图',
    tagline: 'putty B 因子管 + Fo−Fc 差图（Web Worker 零阻塞）',
    icon: 'layers',
    accent: 'amber',
    minutes: 4,
    steps: [
      {
        title: '加载结构并切换 putty',
        body: '3EKJ（2.8 Å）是检验电子密度工作流的好例子。preset putty 把 cartoon 管径按 B 因子调制——管越粗，晶体中该区域越无序（柔性/表面环线）。',
        cmd: 'preset putty',
        run: async () => {
          await ensureLoaded('3EKJ')
          await exec('preset putty')
        },
      },
      {
        title: '读 B 因子图例卡',
        body: '视口左下角出现了颜色标尺图例卡：渐变条给出 B 值 → 颜色映射，下方的管径刻度与着色共享同一组停靠点。\n观察哪些区段又粗又红——那就是高柔性环线。',
      },
      {
        title: '计算 Fo−Fc 差图',
        body: 'map fofc 3ekj 从 RCSB 拉取实测结构因子，经 FFT 合成差值密度图。\n绿色正峰 = 模型缺失（该有而没建）；红色负峰 = 模型多余（建多了或摆错位）。计算在 Web Worker 中进行，界面全程不卡顿。',
        cmd: 'map fofc 3ekj',
        run: async () => {
          await exec('map fofc 3ekj')
          await waitForMap('fofc')
        },
      },
      {
        title: '正负峰独立调级',
        body: '差图的两个等值面各有独立 σ 阈值：正峰调到 3σ 只保留强缺失信号，负峰 2.5σ 观察错位。\n状态栏徽章实时显示 ±σ 数值；密度图面板（左侧「密度图」标签）提供双滑块。',
        cmd: 'map isolevel pos 3',
        run: async () => {
          await exec('map isolevel pos 3')
          await exec('map isolevel neg 2.5')
          await exec('zoom')
        },
      },
      {
        title: '会话自动存档',
        body: '密度图的 σ/模式/颜色已写入会话存档——刷新页面后结构与密度图都会自动恢复（密度图由 Worker 后台重算，约十几秒）。\nsession info 可随时查看存档状态。',
        cmd: 'session info',
        run: () => { void exec('session info') },
      },
      {
        title: '完成',
        body: '晶体学验证三件套已展示：putty 柔性 → 差图缺失/多余信号 → 双 σ 调级。\n对照 2Fo−Fc（map fetch 3ekj）可以区分「密度弱」与「无密度」两种情形。',
        run: () => { void exec('zoom') },
      },
    ],
  },
  {
    id: 'nmr-dynamics',
    title: 'NMR 动力学 · 泛素系综',
    tagline: 'ensemble 构象动画与柔性包络',
    icon: 'waves',
    accent: 'teal',
    minutes: 2,
    steps: [
      {
        title: '加载 NMR 系综',
        body: '1D3Z 是泛素的溶液 NMR 解析结构，包含 10 个满足约束的构象（MODEL 记录）。\n加载后默认展示第一个构象，其余保存在系综数据中。',
        cmd: 'load 1d3z',
        run: async () => { await ensureLoaded('1D3Z') },
      },
      {
        title: '播放构象动画',
        body: 'ensemble play 在 10 个构象间平滑插值循环。底部播放条支持暂停（P 键）、逐帧步进与速度调节。\n注意 C 端尾链的摆动幅度——柔性区域在动画中一目了然。',
        cmd: 'ensemble play',
        run: async () => {
          await exec('ensemble play')
          await sleep(600)
        },
      },
      {
        title: '摇摆视角',
        body: 'rock 让相机绕 y 轴 ±26° 摇摆，配合动画是展示柔性区段的发表级视角（R 键切换）。',
        cmd: 'rock on',
        run: () => { void exec('rock on') },
      },
      {
        title: '完成',
        body: 'ensemble pause 暂停后可以：\n· preset surface 查看单一构象表面\n· superpose 把泛素叠合到晶体结构对比（superpose 1UBQ onto 1D3Z）\n· untransform 撤销叠合回到原始位姿',
        run: () => { void exec('zoom') },
      },
    ],
  },
  {
    id: 'antibody',
    title: '抗体-抗原 · 溶菌酶识别',
    tagline: '叠合→跨结构接触→界面 ΔSASA 一条龙（免疫识别工作流）',
    icon: 'puzzle',
    accent: 'fuchsia',
    minutes: 4,
    steps: [
      {
        title: '加载抗体-抗原复合物',
        body: '1BQL 是经典免疫学结构：HyHEL-5 抗体 Fab 片段结合鹤鹑卵清溶菌酶（2.6 Å）。\n链 H = 抗体重链、链 L = 轻链、链 Y = 抗原溶菌酶。util cbc 按链分色后，Y 形抗体把抗原“抱”在中间的拓扑一目了然。',
        cmd: 'load 1bql',
        run: async () => {
          await ensureLoaded('1BQL')
          await exec('util cbc')
          await exec('zoom')
        },
      },
      {
        title: '加载游离抗原（鸡溶菌酶）',
        body: '2LYZ 是单独解析的鸡卵清溶菌酶（2.0 Å）——未结合状态。\n两个物种的溶菌酶只差十几个残基，但表位（epitope）完全保守：接下来把游离抗原叠合进复合物坐标系，比较“结合前 vs 结合中”的构象。',
        cmd: 'load 2lyz',
        run: async () => { await ensureLoaded('2LYZ') },
      },
      {
        title: '叠合：游离抗原 → 复合物坐标架',
        body: 'superpose 把 2LYZ 的链 A 刚体叠合到 1BQL 的链 Y（序列比对 + 最优拟合）。\nRMSD < 1 Å 说明抗原结合后几乎不变——诱导契合（induced fit）很小，这是 HyHEL-5 识别溶菌酶的著名结论。叠合后把游离抗原改画为棍状，直观看到它与复合物中的抗原重合。',
        cmd: 'superpose 2LYZ onto 1BQL chain A to Y',
        run: async () => {
          const sid = useMolStore.getState().activeId
          if (!hasChains(sid, 'A')) {
            useMolStore.getState().appendLog('out', '2LYZ 未包含链 A——跳过叠合演示')
            return
          }
          await exec('superpose 2LYZ onto 1BQL chain A to Y')
          // 游离抗原改为棍状+玫瑰色，叠合重合度可视化（先清选择防 color 误作用到遗留选区）
          useMolStore.getState().setSelection(null, [])
          await exec('hide cartoon')
          await exec('show sticks')
          await exec('color #fb7185')
          await exec('zoom')
        },
      },
      {
        title: '跨结构接触：表位检测',
        body: 'xcontacts 在两个不同 PDB 条目之间检测接触（这是它与 interface 的本质区别）。\n把叠合后的游离 2LYZ 与复合物中的抗体链 H+L 做接触分析——直接从“游离结构”坐标上读出表位残基；分析面板可查看跨结构界面列表。',
        cmd: 'xcontacts 2LYZ:chain A | 1BQL:chain H or chain L 5.0',
        run: async () => {
          if (!findByName('1BQL') || !findByName('2LYZ')) {
            useMolStore.getState().appendLog('out', '两个结构均需在场才能做跨结构接触——已跳过')
            return
          }
          await exec('xcontacts 2LYZ:chain A | 1BQL:chain H or chain L 5.0')
        },
      },
      {
        title: '真实界面 + 埋藏面积',
        body: '回到复合物本体：contacts 检测链 Y 与抗体链 H/L 之间的界面接触对，再用 bsa 三路 SASA 计算界面埋藏面积（ΔSASA）。\nΔSASA > 1 Å² 的残基即界面核心残基——抗原-抗体界面每侧通常埋藏 600-1000 Å²，可与分析面板对照。',
        cmd: 'bsa',
        run: async () => {
          const sid = findByName('1BQL')
          if (!sid || !hasChains(sid, 'H', 'L', 'Y')) {
            useMolStore.getState().appendLog('out', '1BQL 链 H/L/Y 不完整——跳过界面 ΔSASA')
            return
          }
          useMolStore.getState().setActive(sid)
          await exec('contacts chain Y | chain H or chain L 4.0')
          await exec('bsa')
          await sleep(400)
        },
      },
      {
        title: '完成',
        body: '免疫识别工作流已走通：叠合 → 跨结构表位 → 界面 ΔSASA。\n延伸玩法：\n· untransform 2LYZ 撤销叠合回原位\n· select epitope = byres (chain Y within 5 of (chain H or chain L))\n· V 保存视角书签，record start 录制旋转动画',
        run: () => { void exec('zoom') },
      },
    ],
  },
  {
    id: 'nucleic',
    title: '核酸 · B-DNA 双螺旋',
    tagline: '碱基氢键、大小沟与磷酸骨架柔性',
    icon: 'dna',
    accent: 'violet',
    minutes: 2,
    steps: [
      {
        title: '加载 B-DNA 十二聚体',
        body: '1BNA 是教科书级的 B 型 DNA：两条反平行链、12 个碱基对、完整的 Drew-Dickerson 序列。',
        cmd: 'load 1bna',
        run: async () => { await ensureLoaded('1BNA') },
      },
      {
        title: '双链分色',
        body: 'util cbc 给两条链分配不同颜色。拖动旋转观察大沟（wide groove）与小沟（narrow groove）交替出现的螺旋纹路。',
        cmd: 'util cbc',
        run: async () => {
          await exec('preset cartoon')
          await exec('util cbc')
        },
      },
      {
        title: 'Watson–Crick 氢键',
        body: 'hbonds on 绘出碱基对之间的氢键——A·T 两条、G·C 三条。氢键近似垂直于螺旋轴，是双螺旋识别的基础。',
        cmd: 'hbonds on',
        run: () => { void exec('hbonds on') },
      },
      {
        title: '骨架柔性（putty）',
        body: 'preset putty 对核酸同样有效：磷酸骨架 P 原子的 B 因子调制管径与颜色。\n端部碱基对通常又粗又红——末端效应导致的 disorder。',
        cmd: 'preset putty',
        run: () => { void exec('preset putty') },
      },
      {
        title: '完成',
        body: '核酸工作流展示完毕。延伸玩法：\n· show sticks resn DG+DA+DT+DC 只看特定碱基\n· color element 强调磷原子\n· slab 15 沿轴裁剪查看内部碱基堆叠',
        run: () => { void exec('zoom') },
      },
    ],
  },
]

export function findTour(id: string): TourDef | undefined {
  const want = id.trim().toLowerCase()
  return TOURS.find(t => t.id === want)
}
