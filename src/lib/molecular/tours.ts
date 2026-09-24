// 引导式演示场景（Guided Tours）：脚本化步骤驱动既有命令行 / 状态 API
// 设计原则：①步骤幂等（重复执行不破坏场景：加载前查重、show 前 hide）②命令走
// runCommand 让控制台留下教学回显 ③异步步骤（加载/密度图）用 waitFor 等待就绪
import { useMolStore, dataRegistry } from './store'
import { useMapStore } from './map-store'
import { useContactStore } from './contacts-store'
import { fetchPdbId } from './loader'
import { tt, type DualText } from '@/i18n'

export type TourIcon = 'flask' | 'pill' | 'layers' | 'waves' | 'dna' | 'puzzle'
export type TourAccent = 'emerald' | 'rose' | 'amber' | 'teal' | 'violet' | 'fuchsia'

export interface TourStep {
  title: DualText
  body: DualText
  /** 展示为命令 chip（正文呼应；步骤本身通常已在执行同等动作） */
  cmd?: string
  /** 步骤动作（幂等）；返回 Promise 时下一步按钮等待完成 */
  run?: () => Promise<void> | void
}

export interface TourDef {
  id: string
  title: DualText
  tagline: DualText
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
    title: { zh: '快速上手 · 血红蛋白', en: 'Quick start · Hemoglobin' },
    tagline: { zh: '加载、旋转、选择与口袋分析的最短路径', en: 'The shortest path to loading, rotating, selecting and pocket analysis' },
    icon: 'flask',
    accent: 'emerald',
    minutes: 2,
    steps: [
      {
        title: { zh: '加载第一个结构', en: 'Load your first structure' },
        body: {
          zh: '我们从血红蛋白 4HHB 开始——2 α + 2 β 亚基组成的四聚体，每个亚基口袋里嵌着一个血红素辅基。\n结构正从 RCSB Protein Data Bank 拉取，稍候片刻。',
          en: 'We start with hemoglobin 4HHB — a tetramer of 2 α + 2 β subunits, each with a heme cofactor tucked into its pocket.\nThe structure is being fetched from the RCSB Protein Data Bank; one moment.',
        },
        cmd: 'load 4hhb',
        run: async () => { await ensureLoaded('4HHB') },
      },
      {
        title: { zh: '带状图与视角操作', en: 'Cartoon view and camera controls' },
        body: {
          zh: '默认的 cartoon 带状图沿多肽骨架走向渲染，是观察整体折叠的首选。\n试试拖动旋转（左键）、平移（右键）和缩放（滚轮）——结构会实时高亮悬停的原子。',
          en: 'The default cartoon representation follows the peptide backbone and is the first choice for viewing the overall fold.\nTry dragging to rotate (left button), panning (right button) and zooming (scroll wheel) — hovered atoms highlight in real time.',
        },
        cmd: 'preset cartoon',
        run: () => { void exec('preset cartoon') },
      },
      {
        title: { zh: '按链着色', en: 'Color by chain' },
        body: {
          zh: 'util cbc 给每条链分配独立颜色（PyMOL 经典 util）。四聚体的 α/β 亚基组合一目了然。',
          en: 'util cbc assigns a distinct color to each chain (the classic PyMOL utility). The α/β subunit arrangement of the tetramer becomes obvious at a glance.',
        },
        cmd: 'util cbc',
        run: () => { void exec('util cbc') },
      },
      {
        title: { zh: '血红素口袋', en: 'The heme pocket' },
        body: {
          zh: 'HEM 是铁卟啉辅基——携氧的核心位点。先隐藏棍状表示避免叠加，再只对 HEM 显示棍状模型，并把 4.5 Å 内的结合口袋残基选为命名选择 pocket。\n选中后琥珀色高亮 + 序列条联动会立即出现。',
          en: 'HEM is the iron-porphyrin cofactor — the core oxygen-binding site. First hide sticks to avoid clutter, then show sticks only for HEM, and save the binding-pocket residues within 4.5 Å as the named selection pocket.\nOnce selected, the amber highlight and the sequence-bar linkage appear immediately.',
        },
        cmd: 'show sticks resn HEM',
        run: async () => {
          await exec('hide sticks')
          await exec('show sticks resn HEM')
          await exec('select pocket = byres within 4.5 of resn HEM')
          await exec('zoom pocket')
        },
      },
      {
        title: { zh: '氢键网络', en: 'Hydrogen-bond network' },
        body: {
          zh: 'hbonds on 在满足几何判据的供体-受体对之间绘制虚线。口袋附近出现的短氢键往往就是催化/结合的关键相互作用。',
          en: 'hbonds on draws dashed lines between donor–acceptor pairs that satisfy the geometric criteria. Short H-bonds near the pocket are often the key catalytic or binding interactions.',
        },
        cmd: 'hbonds on',
        run: () => { void exec('hbonds on') },
      },
      {
        title: { zh: '自由探索', en: 'Free exploration' },
        body: {
          zh: '至此你已掌握核心工作流。接下来可以：\n· 数字键 1-8 一键切换风格（putty 看柔性）\n· 工具栏标尺测距/角/二面角\n· 右键原子打开上下文菜单\n· 按 V 保存视角书签，` 打开命令行\n演示结束，随时可从工具栏「演示」重新开始。',
          en: 'You now know the core workflow. From here you can:\n· Press 1-8 to switch styles in one keystroke (putty shows flexibility)\n· Use the toolbar ruler to measure distances/angles/dihedrals\n· Right-click an atom to open the context menu\n· Press V to save a view bookmark, ` to open the command line\nThe tour ends here — restart any time from the "Tours" entry in the toolbar.',
        },
        run: () => { void exec('zoom') },
      },
    ],
  },
  {
    id: 'drug-target',
    title: { zh: '药物靶点 · SARS-CoV-2 主蛋白酶', en: 'Drug target · SARS-CoV-2 main protease' },
    tagline: { zh: '抑制剂口袋、二聚体界面与埋藏面积（ΔSASA）分析', en: 'Inhibitor pocket, dimer interface and buried area (ΔSASA) analysis' },
    icon: 'pill',
    accent: 'rose',
    minutes: 3,
    steps: [
      {
        title: { zh: '加载 Mpro 与 N3 抑制剂', en: 'Load Mpro with the N3 inhibitor' },
        body: {
          zh: '6LU7 是首个解析的新冠主蛋白酶结构（2.1 Å），N3 抑制剂共价结合在底物口袋——抗病毒药物设计的经典起点。',
          en: '6LU7 is the first solved SARS-CoV-2 main protease structure (2.1 Å); the N3 inhibitor binds covalently in the substrate pocket — a classic starting point for antiviral drug design.',
        },
        cmd: 'load 6lu7',
        run: async () => { await ensureLoaded('6LU7') },
      },
      {
        title: { zh: '主轴对齐视角', en: 'Principal-axis aligned view' },
        body: {
          zh: 'orient（PyMOL 同名命令）对坐标做 PCA 主轴对齐，让二聚体的长轴正对屏幕——发表级构图的第一步。',
          en: 'orient (same name as in PyMOL) PCA-aligns the coordinates so the long axis of the dimer faces the screen — the first step toward a publication-grade composition.',
        },
        cmd: 'orient',
        run: async () => {
          await exec('orient')
          await exec('util cbc')
        },
      },
      {
        title: { zh: '抑制剂棍状模型', en: 'Inhibitor as sticks' },
        body: {
          zh: 'ligand 选择器匹配所有 HETATM 小分子（不含水）。N3 以棍状模型显示并缩放到配体，注意口袋周围的催化残基。',
          en: 'The ligand selector matches all HETATM small molecules (water excluded). N3 is shown as sticks and the camera zooms to the ligand — note the catalytic residues around the pocket.',
        },
        cmd: 'show sticks ligand',
        run: async () => {
          await exec('hide sticks')
          await exec('show sticks ligand')
          await exec('select pocket = byres within 4.5 of ligand')
          await exec('zoom ligand')
        },
      },
      {
        title: { zh: '二聚体界面接触', en: 'Dimer interface contacts' },
        body: {
          zh: 'interface A B 4.0 检测两条链之间 4 Å 内的接触残基对，绘制接触虚线，并在左侧「分析」面板生成 2D 接触图谱与界面残基列表。',
          en: 'interface A B 4.0 detects contacting residue pairs within 4 Å between the two chains, draws contact dashes, and produces a 2D contact map plus an interface residue list in the "Analysis" panel on the left.',
        },
        cmd: 'interface A B 4.0',
        run: async () => {
          const sid = useMolStore.getState().activeId
          if (!hasChains(sid, 'A', 'B')) {
            useMolStore.getState().appendLog('out', tt({ zh: '该结构未包含链 A/B——跳过界面分析（可试 contacts chain A | chain A）', en: 'This structure lacks chains A/B — skipping interface analysis (try contacts chain A | chain A)' }))
            return
          }
          await exec('zoom')
          await exec('interface A B 4.0')
        },
      },
      {
        title: { zh: '界面埋藏面积 ΔSASA', en: 'Interface buried area ΔSASA' },
        body: {
          zh: 'bsa 用三路 SASA（A 单独 / B 单独 / AB 复合）计算界面埋藏面积。ΔSASA > 1 Å² 的残基即界面残基——这是 PDB 界面分析的标准判据。',
          en: 'bsa computes the interface buried area via three SASA passes (A alone / B alone / the AB complex). Residues with ΔSASA > 1 Å² count as interface residues — the standard criterion in PDB interface analysis.',
        },
        cmd: 'bsa',
        run: async () => {
          await exec('bsa')
          await sleep(400)
        },
      },
      {
        title: { zh: '完成', en: 'Done' },
        body: {
          zh: '药物靶点分析链路已走通：加载 → 口袋 → 界面 → ΔSASA。\n延伸玩法：color sasa 按暴露度着色、map fetch 6lu7 叠加电子密度、save pocket.pdb 导出坐标。',
          en: 'The drug-target analysis chain is complete: load → pocket → interface → ΔSASA.\nGoing further: color sasa to color by exposure, map fetch 6lu7 to overlay electron density, save pocket.pdb to export coordinates.',
        },
        run: () => { void exec('zoom') },
      },
    ],
  },
  {
    id: 'crystallography',
    title: { zh: '晶体学验证 · 差值密度图', en: 'Crystallography validation · difference density' },
    tagline: { zh: 'putty B 因子管 + Fo−Fc 差图（Web Worker 零阻塞）', en: 'Putty B-factor tubes + Fo−Fc difference map (non-blocking Web Worker)' },
    icon: 'layers',
    accent: 'amber',
    minutes: 4,
    steps: [
      {
        title: { zh: '加载结构并切换 putty', en: 'Load the structure and switch to putty' },
        body: {
          zh: '3EKJ（2.8 Å）是检验电子密度工作流的好例子。preset putty 把 cartoon 管径按 B 因子调制——管越粗，晶体中该区域越无序（柔性/表面环线）。',
          en: '3EKJ (2.8 Å) is a good example for trying the electron-density workflow. preset putty modulates the cartoon tube radius by B-factor — the thicker the tube, the more disordered that region is in the crystal (flexible or surface loops).',
        },
        cmd: 'preset putty',
        run: async () => {
          await ensureLoaded('3EKJ')
          await exec('preset putty')
        },
      },
      {
        title: { zh: '读 B 因子图例卡', en: 'Read the B-factor legend card' },
        body: {
          zh: '视口左下角出现了颜色标尺图例卡：渐变条给出 B 值 → 颜色映射，下方的管径刻度与着色共享同一组停靠点。\n观察哪些区段又粗又红——那就是高柔性环线。',
          en: 'A color-scale legend card appears at the bottom-left of the viewport: the gradient bar maps B values to colors, and the tube-radius ticks below share the same stops.\nLook for segments that are both thick and red — those are the high-flexibility loops.',
        },
      },
      {
        title: { zh: '计算 Fo−Fc 差图', en: 'Compute the Fo−Fc difference map' },
        body: {
          zh: 'map fofc 3ekj 从 RCSB 拉取实测结构因子，经 FFT 合成差值密度图。\n绿色正峰 = 模型缺失（该有而没建）；红色负峰 = 模型多余（建多了或摆错位）。计算在 Web Worker 中进行，界面全程不卡顿。',
          en: 'map fofc 3ekj fetches the measured structure factors from RCSB and synthesizes the difference density map via FFT.\nGreen positive peaks = missing model (should be there but wasn\u2019t built); red negative peaks = excess model (overbuilt or misplaced). The computation runs in a Web Worker — the UI never blocks.',
        },
        cmd: 'map fofc 3ekj',
        run: async () => {
          await exec('map fofc 3ekj')
          await waitForMap('fofc')
        },
      },
      {
        title: { zh: '正负峰独立调级', en: 'Independent level control for ±peaks' },
        body: {
          zh: '差图的两个等值面各有独立 σ 阈值：正峰调到 3σ 只保留强缺失信号，负峰 2.5σ 观察错位。\n状态栏徽章实时显示 ±σ 数值；密度图面板（左侧「密度图」标签）提供双滑块。',
          en: 'The two isosurfaces of the difference map have independent σ thresholds: raise positive peaks to 3σ to keep only strong missing-signal, set negative to 2.5σ to inspect misplacement.\nThe status-bar badge shows live ±σ values; the map panel (the "Maps" tab on the left) provides dual sliders.',
        },
        cmd: 'map isolevel pos 3',
        run: async () => {
          await exec('map isolevel pos 3')
          await exec('map isolevel neg 2.5')
          await exec('zoom')
        },
      },
      {
        title: { zh: '会话自动存档', en: 'Automatic session archive' },
        body: {
          zh: '密度图的 σ/模式/颜色已写入会话存档——刷新页面后结构与密度图都会自动恢复（密度图由 Worker 后台重算，约十几秒）。\nsession info 可随时查看存档状态。',
          en: 'The map\u2019s σ/mode/color settings are written into the session archive — after a page refresh both the structure and the map are restored automatically (the map is recomputed by a background Worker, taking a dozen seconds or so).\nsession info shows the archive status at any time.',
        },
        cmd: 'session info',
        run: () => { void exec('session info') },
      },
      {
        title: { zh: '完成', en: 'Done' },
        body: {
          zh: '晶体学验证三件套已展示：putty 柔性 → 差图缺失/多余信号 → 双 σ 调级。\n对照 2Fo−Fc（map fetch 3ekj）可以区分「密度弱」与「无密度」两种情形。',
          en: 'The crystallography validation trio is done: putty flexibility → difference-map missing/excess signal → dual-σ leveling.\nComparing against 2Fo−Fc (map fetch 3ekj) distinguishes "weak density" from "no density".',
        },
        run: () => { void exec('zoom') },
      },
    ],
  },
  {
    id: 'nmr-dynamics',
    title: { zh: 'NMR 动力学 · 泛素系综', en: 'NMR dynamics · ubiquitin ensemble' },
    tagline: { zh: 'ensemble 构象动画与柔性包络', en: 'Ensemble conformer animation and flexibility' },
    icon: 'waves',
    accent: 'teal',
    minutes: 2,
    steps: [
      {
        title: { zh: '加载 NMR 系综', en: 'Load the NMR ensemble' },
        body: {
          zh: '1D3Z 是泛素的溶液 NMR 解析结构，包含 10 个满足约束的构象（MODEL 记录）。\n加载后默认展示第一个构象，其余保存在系综数据中。',
          en: '1D3Z is the solution-NMR structure of ubiquitin with 10 constraint-satisfying conformers (MODEL records).\nThe first conformer is shown by default after loading; the rest are kept in the ensemble data.',
        },
        cmd: 'load 1d3z',
        run: async () => { await ensureLoaded('1D3Z') },
      },
      {
        title: { zh: '播放构象动画', en: 'Play the conformer animation' },
        body: {
          zh: 'ensemble play 在 10 个构象间平滑插值循环。底部播放条支持暂停（P 键）、逐帧步进与速度调节。\n注意 C 端尾链的摆动幅度——柔性区域在动画中一目了然。',
          en: 'ensemble play smoothly interpolates in a loop across the 10 conformers. The bottom playback bar supports pause (P key), single-frame stepping and speed control.\nWatch how far the C-terminal tail swings — flexible regions stand out immediately in the animation.',
        },
        cmd: 'ensemble play',
        run: async () => {
          await exec('ensemble play')
          await sleep(600)
        },
      },
      {
        title: { zh: '摇摆视角', en: 'Rocking camera' },
        body: {
          zh: 'rock 让相机绕 y 轴 ±26° 摇摆，配合动画是展示柔性区段的发表级视角（R 键切换）。',
          en: 'rock swings the camera ±26° around the y axis — combined with the animation it is a publication-grade way to showcase flexible segments (toggle with the R key).',
        },
        cmd: 'rock on',
        run: () => { void exec('rock on') },
      },
      {
        title: { zh: '完成', en: 'Done' },
        body: {
          zh: 'ensemble pause 暂停后可以：\n· preset surface 查看单一构象表面\n· superpose 把泛素叠合到晶体结构对比（superpose 1UBQ onto 1D3Z）\n· untransform 撤销叠合回到原始位姿',
          en: 'After ensemble pause you can:\n· preset surface to view a single-conformer surface\n· superpose ubiquitin onto the crystal structure for comparison (superpose 1UBQ onto 1D3Z)\n· untransform to undo the superposition and return to the original pose',
        },
        run: () => { void exec('zoom') },
      },
    ],
  },
  {
    id: 'antibody',
    title: { zh: '抗体-抗原 · 溶菌酶识别', en: 'Antibody–antigen · lysozyme recognition' },
    tagline: { zh: '叠合→跨结构接触→界面 ΔSASA 一条龙（免疫识别工作流）', en: 'Superpose → cross-structure contacts → interface ΔSASA in one flow (immune-recognition workflow)' },
    icon: 'puzzle',
    accent: 'fuchsia',
    minutes: 4,
    steps: [
      {
        title: { zh: '加载抗体-抗原复合物', en: 'Load the antibody–antigen complex' },
        body: {
          zh: '1BQL 是经典免疫学结构：HyHEL-5 抗体 Fab 片段结合鹤鹑卵清溶菌酶（2.6 Å）。\n链 H = 抗体重链、链 L = 轻链、链 Y = 抗原溶菌酶。util cbc 按链分色后，Y 形抗体把抗原“抱”在中间的拓扑一目了然。',
          en: '1BQL is a classic immunology structure: the HyHEL-5 antibody Fab fragment bound to quail egg-white lysozyme (2.6 Å).\nChain H = antibody heavy chain, chain L = light chain, chain Y = the antigen lysozyme. After util cbc colors by chain, the topology of the Y-shaped antibody "hugging" the antigen is obvious at a glance.',
        },
        cmd: 'load 1bql',
        run: async () => {
          await ensureLoaded('1BQL')
          await exec('util cbc')
          await exec('zoom')
        },
      },
      {
        title: { zh: '加载游离抗原（鸡溶菌酶）', en: 'Load the free antigen (hen lysozyme)' },
        body: {
          zh: '2LYZ 是单独解析的鸡卵清溶菌酶（2.0 Å）——未结合状态。\n两个物种的溶菌酶只差十几个残基，但表位（epitope）完全保守：接下来把游离抗原叠合进复合物坐标系，比较“结合前 vs 结合中”的构象。',
          en: '2LYZ is the separately solved hen egg-white lysozyme (2.0 Å) — the unbound state.\nThe two species\u2019 lysozymes differ by only a dozen residues, yet the epitope is fully conserved: next we superpose the free antigen into the complex coordinate frame to compare the "before binding vs during binding" conformations.',
        },
        cmd: 'load 2lyz',
        run: async () => { await ensureLoaded('2LYZ') },
      },
      {
        title: { zh: '叠合：游离抗原 → 复合物坐标架', en: 'Superpose: free antigen → complex frame' },
        body: {
          zh: 'superpose 把 2LYZ 的链 A 刚体叠合到 1BQL 的链 Y（序列比对 + 最优拟合）。\nRMSD < 1 Å 说明抗原结合后几乎不变——诱导契合（induced fit）很小，这是 HyHEL-5 识别溶菌酶的著名结论。叠合后把游离抗原改画为细线框（比棍状更轻盈，不喧宾夺主），玫瑰色细线与复合物中的抗原重合度一目了然。',
          en: 'superpose rigidly fits chain A of 2LYZ onto chain Y of 1BQL (sequence alignment + best fit).\nRMSD < 1 Å means the antigen barely changes upon binding — little induced fit, the famous conclusion for HyHEL-5 recognizing lysozyme. After superposing, the free antigen is redrawn as thin wireframe (lighter than sticks so it doesn\u2019t dominate); how well the rose thin lines overlap the antigen in the complex is plain at a glance.',
        },
        cmd: 'superpose 2LYZ onto 1BQL chain A to Y',
        run: async () => {
          const sid = useMolStore.getState().activeId
          if (!hasChains(sid, 'A')) {
            useMolStore.getState().appendLog('out', tt({ zh: '2LYZ 未包含链 A——跳过叠合演示', en: '2LYZ lacks chain A — skipping the superposition demo' }))
            return
          }
          await exec('superpose 2LYZ onto 1BQL chain A to Y')
          // 游离抗原改为细线框+玫瑰色：叠合重合度可视化（先清选择防 color 误作用到遗留选区）
          useMolStore.getState().setSelection(null, [])
          await exec('hide cartoon')
          await exec('show lines')
          await exec('color #fb7185')
          await exec('zoom')
        },
      },
      {
        title: { zh: '跨结构接触：表位检测', en: 'Cross-structure contacts: epitope detection' },
        body: {
          zh: 'xcontacts 在两个不同 PDB 条目之间检测接触（这是它与 interface 的本质区别）。\n把叠合后的游离 2LYZ 与复合物中的抗体链 H+L 做接触分析——直接从“游离结构”坐标上读出表位残基；分析面板可查看跨结构界面列表。',
          en: 'xcontacts detects contacts between two different PDB entries (its essential difference from interface).\nWe run contact analysis between the superposed free 2LYZ and the antibody chains H+L of the complex — reading epitope residues directly off the "free structure" coordinates; the analysis panel lists the cross-structure interface.',
        },
        cmd: 'xcontacts 2LYZ:chain A | 1BQL:chain H or chain L 5.0',
        run: async () => {
          if (!findByName('1BQL') || !findByName('2LYZ')) {
            useMolStore.getState().appendLog('out', tt({ zh: '两个结构均需在场才能做跨结构接触——已跳过', en: 'Both structures must be present for cross-structure contacts — skipped' }))
            return
          }
          await exec('xcontacts 2LYZ:chain A | 1BQL:chain H or chain L 5.0')
        },
      },
      {
        title: { zh: '跨结构界面埋藏面积', en: 'Cross-structure interface buried area' },
        body: {
          zh: 'xbsa 沿用跨结构接触的 A/B 掩码，把两个条目的原子拼成联合坐标集做三路 SASA：游离 2LYZ 单独、抗体 H+L 单独、两者「复合」。\n这给出「游离抗原视角」的界面埋藏面积——与下一步复合物本体的 bsa 对照，两组数字接近就是表位完全保守的定量证据。分析面板可分别选择两侧核心残基。',
          en: 'xbsa reuses the A/B masks from cross-structure contacts, pooling the atoms of both entries into a joint coordinate set for three SASA passes: free 2LYZ alone, antibody H+L alone, and the two "complexed".\nThis yields the interface buried area from the "free-antigen viewpoint" — compare it with the complex\u2019s own bsa in the next step; close numbers are quantitative evidence that the epitope is fully conserved. The analysis panel lets you pick core residues on either side.',
        },
        cmd: 'xbsa',
        run: async () => {
          if (!findByName('1BQL') || !findByName('2LYZ')) return
          // 幂等：无跨结构上下文（跳步进入）时先补一次 xcontacts
          if (!useContactStore.getState().cross) {
            await exec('xcontacts 2LYZ:chain A | 1BQL:chain H or chain L 5.0')
          }
          await exec('xbsa')
          await sleep(500)
        },
      },
      {
        title: { zh: '真实界面 + 埋藏面积', en: 'The real interface + buried area' },
        body: {
          zh: '回到复合物本体：contacts 检测链 Y 与抗体链 H/L 之间的界面接触对，再用 bsa 三路 SASA 计算界面埋藏面积（ΔSASA）。\nΔSASA > 1 Å² 的残基即界面核心残基——抗原-抗体界面每侧通常埋藏 600-1000 Å²，可与分析面板对照。',
          en: 'Back to the complex itself: contacts detects interface contact pairs between chain Y and antibody chains H/L, then bsa computes the interface buried area (ΔSASA) via three SASA passes.\nResidues with ΔSASA > 1 Å² are interface core residues — each side of an antigen–antibody interface typically buries 600-1000 Å²; compare with the analysis panel.',
        },
        cmd: 'bsa',
        run: async () => {
          const sid = findByName('1BQL')
          if (!sid || !hasChains(sid, 'H', 'L', 'Y')) {
            useMolStore.getState().appendLog('out', tt({ zh: '1BQL 链 H/L/Y 不完整——跳过界面 ΔSASA', en: '1BQL chains H/L/Y incomplete — skipping interface ΔSASA' }))
            return
          }
          useMolStore.getState().setActive(sid)
          await exec('contacts chain Y | chain H or chain L 4.0')
          await exec('bsa')
          await sleep(400)
        },
      },
      {
        title: { zh: '完成', en: 'Done' },
        body: {
          zh: '免疫识别工作流已走通：叠合 → 跨结构表位 → 跨结构 ΔSASA → 复合物本体 bsa。\n延伸玩法：\n· untransform 2LYZ 撤销叠合回原位\n· select epitope = byres (chain Y within 5 of (chain H or chain L))\n· V 保存视角书签，record start 录制旋转动画',
          en: 'The immune-recognition workflow is complete: superpose → cross-structure epitope → cross-structure ΔSASA → the complex\u2019s own bsa.\nGoing further:\n· untransform 2LYZ undoes the superposition and returns it to its place\n· select epitope = byres (chain Y within 5 of (chain H or chain L))\n· V saves a view bookmark, record start records a rotation movie',
        },
        run: () => { void exec('zoom') },
      },
    ],
  },
  {
    id: 'nucleic',
    title: { zh: '核酸 · B-DNA 双螺旋', en: 'Nucleic acids · B-DNA double helix' },
    tagline: { zh: '碱基氢键、大小沟与磷酸骨架柔性', en: 'Base H-bonds, major/minor grooves and backbone flexibility' },
    icon: 'dna',
    accent: 'violet',
    minutes: 2,
    steps: [
      {
        title: { zh: '加载 B-DNA 十二聚体', en: 'Load the B-DNA dodecamer' },
        body: {
          zh: '1BNA 是教科书级的 B 型 DNA：两条反平行链、12 个碱基对、完整的 Drew-Dickerson 序列。',
          en: '1BNA is the textbook B-form DNA: two antiparallel strands, 12 base pairs, the complete Drew-Dickerson sequence.',
        },
        cmd: 'load 1bna',
        run: async () => { await ensureLoaded('1BNA') },
      },
      {
        title: { zh: '双链分色', en: 'Color the two strands' },
        body: {
          zh: 'util cbc 给两条链分配不同颜色。拖动旋转观察大沟（wide groove）与小沟（narrow groove）交替出现的螺旋纹路。',
          en: 'util cbc assigns different colors to the two strands. Drag to rotate and watch the helical pattern of alternating wide and narrow grooves.',
        },
        cmd: 'util cbc',
        run: async () => {
          await exec('preset cartoon')
          await exec('util cbc')
        },
      },
      {
        title: { zh: 'Watson–Crick 氢键', en: 'Watson–Crick hydrogen bonds' },
        body: {
          zh: 'hbonds on 绘出碱基对之间的氢键——A·T 两条、G·C 三条。氢键近似垂直于螺旋轴，是双螺旋识别的基础。',
          en: 'hbonds on draws the hydrogen bonds between base pairs — two for A·T, three for G·C. The H-bonds run roughly perpendicular to the helix axis and underlie double-helix recognition.',
        },
        cmd: 'hbonds on',
        run: () => { void exec('hbonds on') },
      },
      {
        title: { zh: '骨架柔性（putty）', en: 'Backbone flexibility (putty)' },
        body: {
          zh: 'preset putty 对核酸同样有效：磷酸骨架 P 原子的 B 因子调制管径与颜色。\n端部碱基对通常又粗又红——末端效应导致的 disorder。',
          en: 'preset putty works for nucleic acids too: the B factors of backbone P atoms modulate tube radius and color.\nTerminal base pairs are usually thick and red — the disorder caused by end effects.',
        },
        cmd: 'preset putty',
        run: () => { void exec('preset putty') },
      },
      {
        title: { zh: '完成', en: 'Done' },
        body: {
          zh: '核酸工作流展示完毕。延伸玩法：\n· show sticks resn DG+DA+DT+DC 只看特定碱基\n· color element 强调磷原子\n· slab 15 沿轴裁剪查看内部碱基堆叠',
          en: 'The nucleic-acid workflow is done. Going further:\n· show sticks resn DG+DA+DT+DC to view only specific bases\n· color element to emphasize the phosphorus atoms\n· slab 15 to slice along the axis and inspect the internal base stacking',
        },
        run: () => { void exec('zoom') },
      },
    ],
  },
]

export function findTour(id: string): TourDef | undefined {
  const want = id.trim().toLowerCase()
  return TOURS.find(t => t.id === want)
}
