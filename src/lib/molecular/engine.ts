// MolEngine：Three.js 渲染引擎（场景/相机/拾取/高亮/测量/标签/裁剪/截图/GTAO 遮蔽）
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js'
import { AnaglyphEffect } from 'three/examples/jsm/effects/AnaglyphEffect.js'
import { marchingCubes } from './marching-cubes'
import { mateTransforms, orthoMatrix, symOpsFor, type CrystalCell } from './symmetry'
import { computeAtomColors } from './colors'
import { elementInfo } from './chemistry'
import {
  buildCartoon, buildLines, buildSpheres, buildSticks, buildSurface,
  type Pickable, type RepBuild,
} from './representations'
import type { StructureData } from './parser'
import { evaluateSelection } from './selection'
import { detectHBonds, type HBond } from './hbonds'
import { contactColor } from './contacts'
import { useContactStore } from './contacts-store'
import { superposeStructures, applyRigidTransform, type SuperposeResult } from './superpose'
import {
  computeSasa, computeBuriedSasa, computeBuriedSasaArrays, sasaStats, compileRadii,
  type SasaComputeOptions, type SasaStats, type BuriedSasaResult,
} from './sasa'
import { useSasaStore } from './sasa-store'
import { useHBondStore } from './hbond-store'
import { useEnsembleStore } from './ensemble-store'
import { makeTextSprite, disposeSprite } from './textsprite'
import { useMolStore, buildNamedMasks, dataRegistry } from './store'
import type { AtomLabel, Measurement, RepConfig, Settings, StructureEntry } from './types'

export interface AtomPick {
  structureId: string
  atomIdx: number
  residueIdx: number
  x: number
  y: number
  button: number
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  doubleClick: boolean
}

export interface HoverInfo {
  structureId: string
  atomIdx: number
  residueIdx: number
  x: number
  y: number
}

export interface EngineCallbacks {
  onHover?: (info: HoverInfo | null) => void
  onPick?: (pick: AtomPick | null, empty: boolean) => void
  onContext?: (pick: AtomPick | null, x: number, y: number) => void
}

interface RepView {
  hash: string
  build: RepBuild
}

interface StructureView {
  group: THREE.Group
  reps: Map<string, RepView>
  repContainer: THREE.Group
  highlight: THREE.InstancedMesh | null
  selectionRev: number
  labelGroup: THREE.Group
  labelsKey: string
  /** 对称伴侣重建键（rev + reps 可见性 + radius） */
  symKey: string
  /** ensemble 播放期间对称克隆重建节流时间戳 */
  symLastRebuild?: number
}

/** 电子密度图层状态（引擎持有；UI 经 map-store 镜像） */
interface MapLayerState {
  name: string
  grid: Float32Array
  dims: [number, number, number]
  fracOrigin: [number, number, number]
  fracStep: [number, number, number]
  cell: CrystalCell
  mean: number; rms: number; min: number; max: number
  /** 等值面级别（σ 单位：绝对值 = mean ± iso·rms） */
  iso: number
  /** 差图负峰独立 σ 级别（正峰=iso；非差图忽略）——对标 PyMOL 双 isolevel 对象 */
  isoNeg: number
  mode: 'surface' | 'mesh' | 'both'
  /** 差图模式（Fo−Fc）：正峰绿 / 负峰红 双等值面（±iso·σ） */
  difference: boolean
  color: string
  /** 差图负峰颜色（仅 difference 时使用） */
  negColor: string
  opacity: number
  visible: boolean
  meshes: THREE.Mesh[]
  wires: THREE.LineSegments[]
  triangles: number
  truncated: boolean
}

const AMBER = 0xfbbf24
const UP_VECTOR = new THREE.Vector3(0, 1, 0)
/** superpose 空结果常量（失败时展开用） */
const NULL_RESULT: SuperposeResult = {
  ok: false, error: '', mobileChain: '?', refChain: '?', matched: 0,
  rmsd: NaN, quat: [1, 0, 0, 0], translation: [0, 0, 0], pairs: [],
}
/** 超过该原子数时氢键检测走 Web Worker（小结构同步更快） */
const HBOND_WORKER_MIN_ATOMS = 2000
/** 超过该原子数时 SASA 计算走 Web Worker；ΔSASA 三路计算阈值更低 */
const SASA_WORKER_MIN_ATOMS = 2200
const BSA_WORKER_MIN_ATOMS = 900
/** 深色背景下的氢键青色 / 浅色背景下的深青色（对比度自适应） */
const HBOND_COLOR_DARK = 0x4fd1c5
const HBOND_COLOR_LIGHT = 0x0d9488

/** 背景亮度判断（相对亮度 > 0.5 视为浅色） */
function isLightBackground(css: string): boolean {
  const c = new THREE.Color(css)
  return c.r * 0.299 + c.g * 0.587 + c.b * 0.114 > 0.5
}

/**
 * 克隆 rep 组（几何/材质共享）：THREE 的 Object3D.copy 会 JSON 深拷贝 userData，
 * 而 enginePick 存在循环引用（pick.object → mesh）会抛异常——克隆前暂存清空、克隆后恢复。
 */
function cloneGroupShallowUserData(src: THREE.Object3D): THREE.Object3D {
  const stash: { obj: THREE.Object3D; data: Record<string, unknown> }[] = []
  src.traverse(o => {
    if (o.userData && Object.keys(o.userData).length > 0) {
      stash.push({ obj: o, data: o.userData })
      o.userData = {}
    }
  })
  let clone: THREE.Object3D
  try {
    clone = src.clone(true)
  } finally {
    for (const { obj, data } of stash) obj.userData = data
  }
  return clone
}

/** 对称 3x3 特征分解（Jacobi 旋转迭代）；返回按特征值降序 { vals, vecs（vecs[j] 为第 j 个特征向量分量数组） } */
function eigenSymmetric3(a: number[]): { vals: number[]; vecs: number[][] } {
  const m = [...a]
  const vecs: number[][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
  for (let sweep = 0; sweep < 24; sweep++) {
    // 最大非对角元
    let p = 0, q = 1, max = Math.abs(m[1])
    if (Math.abs(m[2]) > max) { p = 0; q = 2; max = Math.abs(m[2]) }
    if (Math.abs(m[5]) > max) { p = 1; q = 2; max = Math.abs(m[5]) }
    if (max < 1e-12) break
    const app = m[p * 3 + p], aqq = m[q * 3 + q], apq = m[p * 3 + q]
    const theta = (aqq - app) / (2 * apq)
    const sign = theta >= 0 ? 1 : -1
    const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
    const c = 1 / Math.sqrt(t * t + 1)
    const s = t * c
    // 行/列旋转（A' = JᵀAJ）
    for (let k = 0; k < 3; k++) {
      const mkp = m[k * 3 + p], mkq = m[k * 3 + q]
      m[k * 3 + p] = c * mkp - s * mkq
      m[k * 3 + q] = s * mkp + c * mkq
    }
    for (let k = 0; k < 3; k++) {
      const mpk = m[p * 3 + k], mqk = m[q * 3 + k]
      m[p * 3 + k] = c * mpk - s * mqk
      m[q * 3 + k] = s * mpk + c * mqk
    }
    // 累积特征向量（V = V·J，列更新）
    const vp = [...vecs[p]], vq = [...vecs[q]]
    for (let k = 0; k < 3; k++) {
      vecs[p][k] = c * vp[k] - s * vq[k]
      vecs[q][k] = s * vp[k] + c * vq[k]
    }
  }
  const vals = [m[0], m[4], m[8]]
  const order = [0, 1, 2].sort((i, j) => vals[j] - vals[i])
  return {
    vals: order.map(i => vals[i]),
    vecs: order.map(i => vecs[i].map(v => +v.toFixed(12))),
  }
}

export class MolEngine {
  container: HTMLElement
  canvas: HTMLCanvasElement
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  orthoCamera: THREE.OrthographicCamera
  activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera
  controls: OrbitControls
  raycaster = new THREE.Raycaster()
  private mouse = new THREE.Vector2(-10, -10)
  private mouseClient = { x: 0, y: 0 }
  private views = new Map<string, StructureView>()
  private measureGroup = new THREE.Group()
  private pickMarkerGroup = new THREE.Group()
  private clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e9), new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e9)]
  private settings: Settings | null = null
  private raf = 0
  private disposed = false
  private lastHoverTime = 0
  private downPos = { x: 0, y: 0, t: 0, button: -1 }
  private lastLabelsKey = ''
  private lastMeasureKey = ''
  private hbondGroup = new THREE.Group()
  private hbondCache = new Map<string, { key: string; hbonds: HBond[] }>()
  private lastHbondKey = ''
  // 接触界面连线（分析面板触发计算，引擎仅负责渲染）
  private contactGroup = new THREE.Group()
  // 氢键检测 Web Worker（大结构异步计算）
  private hbondWorker: Worker | null = null
  private hbondWorkerFailed = false
  private hbondReqId = 0
  /** structureId → 检测中的 detKey（去重与过期丢弃） */
  private hbondPending = new Map<string, string>()
  /** 最近一次 updateHBonds 的 state（异步结果到达时重渲用） */
  private lastHbondState: Parameters<MolEngine['sync']>[0] | null = null
  // SASA / ΔSASA 计算 Web Worker（大结构异步）
  private sasaWorker: Worker | null = null
  private sasaWorkerFailed = false
  private sasaReqId = 0
  /** structureId → 计算中的 key（去重与过期丢弃） */
  private sasaPending = new Map<string, string>()
  /** 跨结构 ΔSASA 飞行中元信息（worker 结果回传时掩码不可得，用快照补齐 atoms 计数与标签） */
  private xbsaMeta: { idA: string; idB: string; labelA: string; labelB: string; heavyA: number; heavyB: number } | null = null
  /** 挂起的 color sasa 烘焙请求（worker 完成后自动 applyColor） */
  private pendingSasaBake: string | null = null

  /** 挂起 color sasa 烘焙：SASA worker 完成后自动按暴露度着色（store.applyColor 调用） */
  queueSasaBake(structureId: string) {
    this.pendingSasaBake = structureId
  }
  private lastPicksKey = ''
  /** ensemble 播放内部状态（插值帧号与时间戳） */
  private ensemblePlay: { frame: number; lastT: number } | null = null
  /** rock 摇摆：基准偏移与相位 */
  private rockBase: THREE.Vector3 | null = null
  private rockT = 0
  /** 视角书签平滑过渡（p=相机位置插值；g=controls.target 插值；fov 线性；up 结尾落位） */
  private camAnim: {
    t0: number; dur: number
    p0: THREE.Vector3; p1: THREE.Vector3
    g0: THREE.Vector3; g1: THREE.Vector3
    fov0: number; fov1: number
    up1: THREE.Vector3
  } | null = null
  private lastTickT = 0
  private ro: ResizeObserver
  private pickablesCache: { obj: THREE.Object3D; pick: Pickable; structureId: string }[] | null = null
  private hasContent = false
  // 灯光引用（applySettings 调节强度）
  private keyLight!: THREE.DirectionalLight
  private fillLight!: THREE.DirectionalLight
  private ambientLight!: THREE.AmbientLight
  // 红蓝立体（AnaglyphEffect 懒建；关闭即释放）
  private stereoEffect: AnaglyphEffect | null = null
  // 电子密度图层（单个；isomesh + isosurface）
  private mapGroup = new THREE.Group()
  private mapLayer: MapLayerState | null = null
  // 对称伴侣克隆组（structureId → 克隆容器；几何/材质与原 rep 共享）
  private symmetryGroups = new Map<string, THREE.Group>()
  // GTAO 后处理管线（ssao 开启时懒建；gtaoFailed 构建失败后永久回退）
  private composer: EffectComposer | null = null
  private gtaoPass: GTAOPass | null = null
  private composerCamera: THREE.Camera | null = null
  private gtaoFailed = false
  // 动画录制（WebM）
  private recorder: MediaRecorder | null = null
  private recordChunks: Blob[] = []
  private recordStartT = 0
  private recordResolve: ((blob: Blob | null) => void) | null = null

  constructor(container: HTMLElement, private callbacks: EngineCallbacks = {}) {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.localClippingEnabled = true
    this.canvas = this.renderer.domElement
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.display = 'block'
    this.canvas.style.outline = 'none'
    this.canvas.tabIndex = 0
    container.appendChild(this.canvas)

    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color('#ffffff')
    this.scene.add(this.measureGroup)
    this.scene.add(this.pickMarkerGroup)
    this.scene.add(this.hbondGroup)
    this.scene.add(this.contactGroup)
    this.scene.add(this.mapGroup)

    // 环境光照
    const pmrem = new THREE.PMREMGenerator(this.renderer)
    const env = pmrem.fromScene(new RoomEnvironment(), 0.06)
    this.scene.environment = env.texture
    pmrem.dispose()

    const key = new THREE.DirectionalLight(0xffffff, 1.5)
    key.position.set(4, 8, 5)
    this.scene.add(key)
    const fill = new THREE.DirectionalLight(0xffffff, 0.45)
    fill.position.set(-5, -3, -4)
    this.scene.add(fill)
    const ambient = new THREE.AmbientLight(0xffffff, 0.12)
    this.scene.add(ambient)
    this.keyLight = key
    this.fillLight = fill
    this.ambientLight = ambient

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.5, 8000)
    this.camera.position.set(40, 30, 60)
    this.orthoCamera = new THREE.OrthographicCamera(-50, 50, 40, -40, -2000, 8000)
    this.activeCamera = this.camera

    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.rotateSpeed = 0.9
    this.controls.zoomSpeed = 1.1
    this.controls.minDistance = 2
    this.controls.maxDistance = 4000

    // 裁剪平面常开（slab 关闭时设置为无穷远 → 不裁剪）
    this.setClippingInfinite()

    // 事件
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('wheel', this.onCancelCamAnim, { passive: true })
    this.canvas.addEventListener('contextmenu', this.onContextMenu)
    this.canvas.addEventListener('dblclick', this.onDoubleClick)
    this.canvas.addEventListener('pointerleave', this.onPointerLeave)

    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(container)
    this.resize()

    this.tick()
    // 调试钩子（可在浏览器控制台检查引擎状态）
    ;(window as unknown as { __molEngine?: MolEngine }).__molEngine = this
  }

  private resize() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.updateOrthoFrustum()
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio())
      this.composer.setSize(w, h)
    }
    this.stereoEffect?.setSize(w, h)
    this.pickablesCache = null
  }

  private updateOrthoFrustum() {
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    const dist = Math.max(this.camera.position.distanceTo(this.controls.target), 1)
    const halfH = dist * Math.tan((this.camera.fov * Math.PI) / 360)
    const halfW = (halfH * w) / h
    this.orthoCamera.top = halfH
    this.orthoCamera.bottom = -halfH
    this.orthoCamera.left = -halfW
    this.orthoCamera.right = halfW
    this.orthoCamera.zoom = 1
    this.orthoCamera.position.copy(this.camera.position)
    this.orthoCamera.quaternion.copy(this.camera.quaternion)
    this.orthoCamera.updateProjectionMatrix()
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const now = performance.now()
    const dt = this.lastTickT ? Math.min((now - this.lastTickT) / 1000, 0.1) : 0.016
    this.lastTickT = now
    this.controls.update()
    this.updateEnsemble()
    // 视角书签平滑过渡：easeInOutCubic 插值 pos/target/fov（放在 controls.update 之后，
    // 无用户输入时 OrbitControls 每帧以当前位置重算球坐标，外部修改可安全生效）
    if (this.camAnim) {
      const a = this.camAnim
      const k = Math.min(1, (now - a.t0) / a.dur)
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
      this.camera.position.lerpVectors(a.p0, a.p1, e)
      this.controls.target.lerpVectors(a.g0, a.g1, e)
      if (Math.abs(a.fov1 - a.fov0) > 1e-3) {
        this.camera.fov = a.fov0 + (a.fov1 - a.fov0) * e
        this.camera.updateProjectionMatrix()
      }
      if (this.activeCamera === this.orthoCamera) this.updateOrthoFrustum()
      if (k >= 1) {
        // 落位：up 向量（中途改会绕 target 翻转，结尾一次性应用）
        this.camera.up.copy(a.up1)
        this.orthoCamera.up.copy(a.up1)
        this.controls.update()
        this.camAnim = null
      }
    }
    // rock 摇摆：绕 target 上下轴正弦摆动（用户拖动时以新视角为基准）
    if (this.settings?.rock) {
      const cam = this.activeCamera
      if (!this.rockBase) {
        this.rockBase = cam.position.clone().sub(this.controls.target)
        this.rockT = 0
      }
      this.rockT += dt * (this.settings.spinSpeed || 2) * 0.45
      const angle = Math.sin(this.rockT) * (Math.PI / 7) // ±≈25.7°
      const off = this.rockBase.clone().applyAxisAngle(UP_VECTOR, angle)
      cam.position.copy(this.controls.target).add(off)
      cam.lookAt(this.controls.target)
    }
    const cam = this.activeCamera
    const dist = cam.position.distanceTo(this.controls.target)
    // 雾
    if (this.settings?.fog) {
      const fog = this.scene.fog as THREE.Fog
      if (fog) {
        const k = 1.4 - this.settings.fogStrength * 0.9
        fog.near = dist * k
        fog.far = dist * (k + 2.2 - this.settings.fogStrength * 1.2)
      }
    }
    // 裁剪（slab）
    if (this.settings?.slab) {
      const dir = new THREE.Vector3().subVectors(this.controls.target, cam.position).normalize()
      const half = this.settings.slabThickness / 2
      this.clippingPlanes[0].normal.copy(dir)
      this.clippingPlanes[0].constant = -(dir.dot(cam.position) + half)
      this.clippingPlanes[1].normal.copy(dir).negate()
      this.clippingPlanes[1].constant = dir.dot(cam.position) + half
    }
    // 渲染：stereo 红蓝立体优先（直渲），其次 GTAO composer，最后直接渲染
    if (this.settings?.stereo) {
      if (!this.stereoEffect) {
        this.stereoEffect = new AnaglyphEffect(this.renderer)
        this.stereoEffect.setSize(this.container.clientWidth || 1, this.container.clientHeight || 1)
      }
      this.stereoEffect.render(this.scene, cam)
    } else {
      if (this.stereoEffect) {
        this.stereoEffect.dispose()
        this.stereoEffect = null
      }
      // GTAO 环境光遮蔽：经 EffectComposer 渲染；否则直接渲染
      if (this.settings?.ssao && !this.gtaoFailed) {
        this.ensureComposer()
        if (this.composer && this.gtaoPass) {
          // 刷新投影矩阵 uniform（FOV / 正交 zoom / 相机切换后仍正确）
          const w = this.container.clientWidth || 1
          const h = this.container.clientHeight || 1
          this.composer.setPixelRatio(this.renderer.getPixelRatio())
          this.composer.setSize(w, h)
          this.gtaoPass.blendIntensity = this.settings.ssaoIntensity
          // 半径为纯 uniform 更新（无 shader 重编译），每帧同步保证滑块即时生效
          this.gtaoPass.updateGtaoMaterial({ radius: this.settings.ssaoRadius })
          this.composer.render()
        } else {
          this.renderer.render(this.scene, cam)
        }
      } else {
        if (this.composer) this.disposeComposer()
        this.renderer.render(this.scene, cam)
      }
    }
  }

  // ---------- GTAO 后处理管线 ----------
  /** 懒建 EffectComposer（RenderPass → GTAOPass → OutputPass）；相机类型切换时重建；失败时安全降级 */
  private ensureComposer() {
    if (this.composer && this.composerCamera === this.activeCamera) return
    if (this.composer) this.disposeComposer()
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    const pr = this.renderer.getPixelRatio()
    try {
      this.composer = new EffectComposer(this.renderer)
      this.composer.addPass(new RenderPass(this.scene, this.activeCamera))
      const gtao = new GTAOPass(this.scene, this.activeCamera, Math.round(w * pr), Math.round(h * pr))
      gtao.output = GTAOPass.OUTPUT.Default
      const s = this.settings
      gtao.blendIntensity = s?.ssaoIntensity ?? 1
      gtao.updateGtaoMaterial({
        radius: s?.ssaoRadius ?? 3,
        distanceExponent: 1,
        thickness: 1,
        scale: 1.25,
        samples: 16,
        distanceFallOff: 1,
        screenSpaceRadius: false,
      })
      // 去噪参数（方法名为 updatePdMaterial，小写 d）
      gtao.updatePdMaterial({ radius: 8, radiusExponent: 2, samples: 16, rings: 2 })
      this.gtaoPass = gtao
      this.composer.addPass(gtao)
      this.composer.addPass(new OutputPass())
      this.composer.setPixelRatio(pr)
      this.composer.setSize(w, h)
      this.composerCamera = this.activeCamera
    } catch (e) {
      // 构建失败：清掉半成品，标记禁用并回退直接渲染（避免每帧异常循环）
      console.warn('[MolVision] GTAO 后处理初始化失败，已回退直接渲染', e)
      this.gtaoFailed = true
      this.disposeComposer()
    }
  }

  private disposeComposer() {
    if (!this.composer) return
    for (const pass of this.composer.passes) pass.dispose?.()
    this.composer.dispose()
    this.composer = null
    this.gtaoPass = null
    this.composerCamera = null
  }

  // ---------- 指针事件 ----------

  private ndcFromEvent(e: PointerEvent | MouseEvent) {
    const rect = this.canvas.getBoundingClientRect()
    this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    this.mouseClient = { x: e.clientX, y: e.clientY }
  }

  private onPointerMove = (e: PointerEvent) => {
    this.ndcFromEvent(e)
    const now = performance.now()
    if (now - this.lastHoverTime < 40) return
    this.lastHoverTime = now
    const hit = this.pickAt(this.mouse)
    if (hit) {
      this.callbacks.onHover?.({
        structureId: hit.structureId,
        atomIdx: hit.atomIdx,
        residueIdx: hit.residueIdx,
        x: this.mouseClient.x,
        y: this.mouseClient.y,
      })
    } else {
      this.callbacks.onHover?.(null)
    }
  }

  private onPointerLeave = () => {
    this.callbacks.onHover?.(null)
  }

  private onPointerDown = (e: PointerEvent) => {
    this.downPos = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button }
    // 用户接管相机：取消书签过渡动画
    this.camAnim = null
    // rock 摇摆中用户拖动：以拖动后视角为新基准
    if (this.rockBase) this.rockBase = null
  }

  /** 滚轮缩放同样取消书签过渡（passive：不阻断 OrbitControls） */
  private onCancelCamAnim = () => { this.camAnim = null }

  private onPointerUp = (e: PointerEvent) => {
    const dx = e.clientX - this.downPos.x
    const dy = e.clientY - this.downPos.y
    const dt = performance.now() - this.downPos.t
    if (Math.hypot(dx, dy) > 6 || dt > 700) return
    if (e.button !== 0) return
    this.ndcFromEvent(e)
    const hit = this.pickAt(this.mouse)
    if (hit) {
      this.callbacks.onPick?.({
        ...hit,
        x: e.clientX,
        y: e.clientY,
        button: 0,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey || e.metaKey,
        metaKey: e.metaKey,
        doubleClick: false,
      }, false)
    } else {
      this.callbacks.onPick?.(null, true)
    }
  }

  private onDoubleClick = (e: MouseEvent) => {
    this.ndcFromEvent(e)
    const hit = this.pickAt(this.mouse)
    if (hit) {
      this.callbacks.onPick?.({
        ...hit,
        x: e.clientX, y: e.clientY, button: 0,
        shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey,
        doubleClick: true,
      }, false)
    }
  }

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    this.ndcFromEvent(e)
    const hit = this.pickAt(this.mouse)
    this.callbacks.onContext?.(hit ? { ...hit, x: e.clientX, y: e.clientY, button: 2, shiftKey: e.shiftKey, altKey: e.altKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, doubleClick: false } : null, e.clientX, e.clientY)
  }

  // ---------- 拾取 ----------

  private collectPickables() {
    if (this.pickablesCache) return this.pickablesCache
    const out: { obj: THREE.Object3D; pick: Pickable; structureId: string }[] = []
    for (const [id, view] of this.views) {
      if (!view.group.visible) continue
      for (const rv of view.reps.values()) {
        for (const p of rv.build.pickables) {
          if (p.mesh.visible !== false) out.push({ obj: p.mesh, pick: p, structureId: id })
        }
      }
    }
    this.pickablesCache = out
    return out
  }

  private pickAt(ndc: THREE.Vector2): { structureId: string; atomIdx: number; residueIdx: number } | null {
    const list = this.collectPickables()
    if (!list.length) return null
    this.raycaster.setFromCamera(ndc, this.activeCamera)
    this.raycaster.params.Line = { threshold: 0.35 }
    const objs = list.map(l => l.obj)
    const hits = this.raycaster.intersectObjects(objs, false)
    for (const hit of hits) {
      const entry = list.find(l => l.obj === hit.object)
      if (!entry) continue
      const data = dataRegistry.get(entry.structureId)
      if (!data) continue
      const { pick } = entry
      if (pick.kind === 'spheres' || pick.kind === 'cylinders') {
        const iid = hit.instanceId
        if (iid === undefined || !pick.atomMap) continue
        const atomIdx = pick.atomMap[iid]
        if (atomIdx === undefined) continue
        return { structureId: entry.structureId, atomIdx, residueIdx: data.atomResidue[atomIdx] }
      }
      if (pick.kind === 'lines') {
        const vi = hit.index
        if (vi === undefined || !pick.lineAtomMap) continue
        const atomIdx = pick.lineAtomMap[vi]
        if (atomIdx === undefined) continue
        return { structureId: entry.structureId, atomIdx, residueIdx: data.atomResidue[atomIdx] }
      }
      if (pick.kind === 'cartoon') {
        const face = hit.face
        if (!face || !pick.resAttr) continue
        const geo = (hit.object as THREE.Mesh).geometry
        const attr = geo.getAttribute(pick.resAttr)
        if (!attr) continue
        const resIdx = Math.round(attr.getX(face.a))
        const r = data.residues[resIdx]
        if (!r) continue
        // 代表原子：CA 优先
        let rep = r.start
        for (let i = r.start; i < r.end; i++) if (data.atoms.names[i] === 'CA') { rep = i; break }
        return { structureId: entry.structureId, atomIdx: rep, residueIdx: resIdx }
      }
      if (pick.kind === 'surface') {
        const pt = hit.point
        const cand = data.grid.queryRadius(pt.x, pt.y, pt.z, 4.5, data.atoms.positions)
        if (!cand.length) continue
        let best = cand[0], bd = Infinity
        for (const c of cand) {
          const d = (data.atoms.positions[c * 3] - pt.x) ** 2 + (data.atoms.positions[c * 3 + 1] - pt.y) ** 2 + (data.atoms.positions[c * 3 + 2] - pt.z) ** 2
          if (d < bd) { bd = d; best = c }
        }
        return { structureId: entry.structureId, atomIdx: best, residueIdx: data.atomResidue[best] }
      }
    }
    return null
  }

  // ---------- 同步 ----------

  sync(state: {
    structures: StructureEntry[]
    selection: { structureId: string | null; indices: number[]; rev: number }
    labels: AtomLabel[]
    measurements: Measurement[]
    measurePicks: { structureId: string; atoms: number[] } | null
    settings: Settings
  }) {
    this.applySettings(state.settings)
    const filtersKey = `${state.settings.hideHydrogens}|${state.settings.hideWater}|${state.settings.quality}`

    const seen = new Set<string>()
    for (const entry of state.structures) {
      const data = dataRegistry.get(entry.id)
      if (!data) continue
      seen.add(entry.id)
      let view = this.views.get(entry.id)
      if (!view) {
        view = {
          group: new THREE.Group(),
          reps: new Map(),
          repContainer: new THREE.Group(),
          highlight: null,
          selectionRev: -1,
          labelGroup: new THREE.Group(),
          labelsKey: '',
          symKey: '',
        }
        view.group.add(view.repContainer)
        view.group.add(view.labelGroup)
        this.scene.add(view.group)
        this.views.set(entry.id, view)
      }
      view.group.visible = entry.visible
      // 重建变化的 rep
      const repIds = new Set(entry.reps.map(r => r.id))
      for (const [repId, rv] of view.reps) {
        if (!repIds.has(repId)) {
          view.repContainer.remove(rv.build.group)
          rv.build.dispose()
          view.reps.delete(repId)
          this.pickablesCache = null
        }
      }
      for (const rep of entry.reps) {
        const hash = JSON.stringify([rep, entry.rev, filtersKey])
        const existing = view.reps.get(rep.id)
        if (existing && existing.hash === hash) continue
        if (existing) {
          view.repContainer.remove(existing.build.group)
          existing.build.dispose()
          view.reps.delete(rep.id)
        }
        this.buildRep(entry, rep, data, view, state.settings, filtersKey)
      }
      // 高亮
      if (state.selection.structureId === entry.id && state.selection.rev !== view.selectionRev) {
        view.selectionRev = state.selection.rev
        this.updateHighlight(view, data, state.selection.indices)
      } else if (state.selection.structureId !== entry.id && view.highlight) {
        view.highlight.visible = false
      }
      // 对称伴侣（symmetry 命令/面板）：rep 构建完成后再检查（恢复会话时 reps 晚于 updateSymmetry 就绪）
      const symRadius = entry.symmetry?.radius ?? 0
      const symGroup = this.symmetryGroups.get(entry.id)
      if (symRadius > 0) {
        const wantKey = `${entry.rev}|${entry.reps.map(r => r.id + (r.visible ? '1' : '0')).join(',')}|${symRadius}|${filtersKey}`
        if (!symGroup || symGroup.userData.symKey !== wantKey) {
          this.rebuildSymmetry(entry, data, view, wantKey, symRadius)
        }
      } else if (symGroup) {
        view.group.remove(symGroup)
        this.symmetryGroups.delete(entry.id)
        this.pickablesCache = null
      }
    }
    // 移除消失的结构
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        // 若移除的结构正在播放 ensemble，先停止
        if (useEnsembleStore.getState().structureId === id) {
          this.ensemblePlay = null
          const es = useEnsembleStore.getState()
          es.setPlaying(false)
          es.setTarget(null, 0)
        }
        this.scene.remove(view.group)
        for (const rv of view.reps.values()) rv.build.dispose()
        if (view.highlight) { view.highlight.geometry.dispose(); (view.highlight.material as THREE.Material).dispose() }
        this.views.delete(id)
        this.symmetryGroups.delete(id)
        this.hbondCache.delete(id)
        this.hbondPending.delete(id)
        this.sasaPending.delete(id)
        if (this.pendingSasaBake === id) this.pendingSasaBake = null
        // SASA 结果归属结构被移除 → 清空面板数据
        const ss = useSasaStore.getState()
        if (ss.structureId === id || ss.buried?.structureId === id) ss.clear()
        this.pickablesCache = null
        // 接触分析归属结构被移除 → 清空连线与结果
        const cs = useContactStore.getState()
        if (cs.structureId === id || cs.cross?.idA === id || cs.cross?.idB === id) {
          cs.clear()
          this.updateContacts()
        }
      }
    }
    // 标签
    const labelsKey = state.labels.map(l => l.id + l.atomIdx).join(',') + '#' + state.labels.length
    if (labelsKey !== this.lastLabelsKey) {
      this.lastLabelsKey = labelsKey
      this.updateLabels(state.labels)
    }
    // 测量
    const measureKey = state.measurements.map(m => m.id).join(',') + '#' + state.measurements.length
    if (measureKey !== this.lastMeasureKey) {
      this.lastMeasureKey = measureKey
      this.updateMeasurements(state.measurements)
    }
    const picksKey = state.measurePicks ? state.measurePicks.structureId + state.measurePicks.atoms.join(',') : ''
    if (picksKey !== this.lastPicksKey) {
      this.lastPicksKey = picksKey
      this.updatePickMarkers(state.measurePicks)
    }
    // 氢键网络（key 含背景色：氢键颜色随背景亮度自适应需重渲）
    const hbondKey = [
      state.settings.showHBonds, state.settings.hbondMaxDist, state.settings.hbondIncludeWater,
      state.settings.hbondSelOnly, state.settings.hideWater, state.settings.background,
      state.structures.filter(s => s.visible).map(s => s.id).join('|'),
      state.selection.structureId, state.selection.rev,
    ].join('#')
    if (hbondKey !== this.lastHbondKey) {
      this.lastHbondKey = hbondKey
      this.updateHBonds(state)
    }
    this.hasContent = this.views.size > 0
  }

  /** 氢键网络检测与虚线渲染（大结构经 Web Worker 异步） */
  private updateHBonds(state: Parameters<MolEngine['sync']>[0]) {
    this.lastHbondState = state
    // 清空旧渲染
    for (const child of [...this.hbondGroup.children]) {
      this.hbondGroup.remove(child)
      const any = child as THREE.LineSegments & THREE.Mesh
      any.geometry?.dispose()
      const mat = any.material as THREE.Material | THREE.Material[] | undefined
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach(m => m.dispose())
    }
    const s = state.settings
    if (!s.showHBonds) {
      this.hbondPending.clear()
      useHBondStore.getState().setStats(0, 0, false)
      useHBondStore.getState().setComputing(false)
      return
    }
    let total = 0, waterTotal = 0
    for (const entry of state.structures) {
      if (!entry.visible) continue
      const data = dataRegistry.get(entry.id)
      if (!data) continue
      // 检测缓存
      const detKey = `${s.hbondMaxDist}|${s.hbondIncludeWater}|${entry.rev}`
      let hbonds: HBond[] | null = null
      const cached = this.hbondCache.get(entry.id)
      if (cached && cached.key === detKey) {
        hbonds = cached.hbonds
      } else if (data.atoms.count >= HBOND_WORKER_MIN_ATOMS && this.requestHBondDetect(entry.id, detKey, data, s)) {
        // 已投递 worker 异步检测：本轮先跳过，结果到达后重渲
        hbonds = null
      } else {
        const detected = detectHBonds(data, {
          maxHeavyDist: s.hbondMaxDist,
          maxDist: Math.min(2.5, s.hbondMaxDist - 1),
          includeWater: s.hbondIncludeWater,
        })
        this.hbondCache.set(entry.id, { key: detKey, hbonds: detected })
        hbonds = detected
      }
      if (!hbonds) continue
      // 选择过滤
      if (s.hbondSelOnly && state.selection.structureId === entry.id && state.selection.indices.length) {
        const sel = new Set(state.selection.indices)
        hbonds = hbonds.filter(hb => sel.has(hb.donor) || sel.has(hb.acceptor))
      }
      if (!hbonds.length) continue
      // 上限保护
      const CAP = 8000
      const truncated = hbonds.length > CAP
      const draw = truncated ? hbonds.slice(0, CAP) : hbonds
      // 虚线几何：H...A 或 D...A（颜色随背景亮度自适应保证对比度）
      const hbColor = isLightBackground(s.background) ? HBOND_COLOR_LIGHT : HBOND_COLOR_DARK
      const pos = data.atoms.positions
      const verts: number[] = []
      const endPts: number[] = []
      let waterN = 0
      for (const hb of draw) {
        const from = hb.hydrogen >= 0 ? hb.hydrogen : hb.donor
        verts.push(pos[from * 3], pos[from * 3 + 1], pos[from * 3 + 2])
        verts.push(pos[hb.acceptor * 3], pos[hb.acceptor * 3 + 1], pos[hb.acceptor * 3 + 2])
        endPts.push(from, hb.acceptor)
        if (data.residues[data.atomResidue[hb.donor]].water || data.residues[data.atomResidue[hb.acceptor]].water) waterN++
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
      const mat = new THREE.LineDashedMaterial({
        color: hbColor,
        dashSize: 0.28,
        gapSize: 0.18,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      })
      const lines = new THREE.LineSegments(geo, mat)
      lines.computeLineDistances()
      lines.renderOrder = 8
      this.hbondGroup.add(lines)
      // 端点小标记（InstancedMesh）
      const sphereGeo = new THREE.SphereGeometry(0.24, 10, 8)
      const sphereMat = new THREE.MeshBasicMaterial({ color: hbColor, transparent: true, opacity: 0.85, depthWrite: false })
      const marker = new THREE.InstancedMesh(sphereGeo, sphereMat, endPts.length)
      const m4 = new THREE.Matrix4()
      for (let k = 0; k < endPts.length; k++) {
        const i = endPts[k]
        m4.makeTranslation(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
        marker.setMatrixAt(k, m4)
      }
      marker.instanceMatrix.needsUpdate = true
      marker.renderOrder = 9
      this.hbondGroup.add(marker)
      total += draw.length
      waterTotal += waterN
      if (truncated) useMolStore.getState().appendLog('out', `氢键数量超过 ${CAP}，已截断显示（共 ${hbonds.length}）`)
    }
    useHBondStore.getState().setStats(total, waterTotal, true)
    useHBondStore.getState().setComputing(this.hbondPending.size > 0)
  }

  // ---------- 接触界面连线（分析面板触发计算，此处渲染） ----------

  /** 接触上限保护（连线渲染用；检测本身不受限） */
  private static readonly CONTACT_CAP = 4000

  /** 渲染/清除接触连线（颜色按距离插值：近红远琥珀；支持跨结构两套坐标） */
  updateContacts() {
    // 清空旧渲染
    for (const child of [...this.contactGroup.children]) {
      this.contactGroup.remove(child)
      const any = child as THREE.LineSegments & THREE.Mesh
      any.geometry?.dispose()
      const mat = any.material as THREE.Material | THREE.Material[] | undefined
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach(m => m.dispose())
    }
    const cs = useContactStore.getState()
    if (!cs.visible) return

    // ---------- 跨结构模式：连线端点取自两个结构各自的坐标 ----------
    if (cs.cross && cs.crossPairs.length) {
      const dataA = dataRegistry.get(cs.cross.idA)
      const dataB = dataRegistry.get(cs.cross.idB)
      if (!dataA || !dataB) return
      const posA = dataA.atoms.positions
      const posB = dataB.atoms.positions
      const draw = cs.crossPairs.length > MolEngine.CONTACT_CAP ? cs.crossPairs.slice(0, MolEngine.CONTACT_CAP) : cs.crossPairs
      if (cs.crossPairs.length > MolEngine.CONTACT_CAP) {
        useMolStore.getState().appendLog('out', `接触连线超过 ${MolEngine.CONTACT_CAP}，仅渲染最近的 ${MolEngine.CONTACT_CAP} 条（共 ${cs.crossPairs.length} 对）`)
      }
      const verts = new Float32Array(draw.length * 6)
      const cols = new Float32Array(draw.length * 6)
      const endPts: { pos: [number, number, number] }[] = []
      const endCols: number[] = []
      const range = Math.max(0.5, cs.cross.cutoff - 2.5)
      for (let k = 0; k < draw.length; k++) {
        const p = draw[k]
        verts[k * 6] = posA[p.atomA * 3]
        verts[k * 6 + 1] = posA[p.atomA * 3 + 1]
        verts[k * 6 + 2] = posA[p.atomA * 3 + 2]
        verts[k * 6 + 3] = posB[p.atomB * 3]
        verts[k * 6 + 4] = posB[p.atomB * 3 + 1]
        verts[k * 6 + 5] = posB[p.atomB * 3 + 2]
        const t = (p.minDist - 2.5) / range
        const [r, g, b] = contactColor(t)
        for (let v = 0; v < 2; v++) {
          cols[k * 6 + v * 3] = r
          cols[k * 6 + v * 3 + 1] = g
          cols[k * 6 + v * 3 + 2] = b
        }
        endPts.push(
          { pos: [posA[p.atomA * 3], posA[p.atomA * 3 + 1], posA[p.atomA * 3 + 2]] },
          { pos: [posB[p.atomB * 3], posB[p.atomB * 3 + 1], posB[p.atomB * 3 + 2]] },
        )
        endCols.push(r, g, b, r, g, b)
      }
      this.buildContactGeometry(verts, cols, endPts, endCols)
      return
    }

    // ---------- 单结构模式 ----------
    if (!cs.structureId || !cs.pairs.length) return
    const data = dataRegistry.get(cs.structureId)
    if (!data) return
    const pos = data.atoms.positions
    const draw = cs.pairs.length > MolEngine.CONTACT_CAP ? cs.pairs.slice(0, MolEngine.CONTACT_CAP) : cs.pairs
    if (cs.pairs.length > MolEngine.CONTACT_CAP) {
      useMolStore.getState().appendLog('out', `接触连线超过 ${MolEngine.CONTACT_CAP}，仅渲染最近的 ${MolEngine.CONTACT_CAP} 条（共 ${cs.pairs.length} 对）`)
    }
    // 顶点色连线（近距离红 → 远距离琥珀）
    const verts = new Float32Array(draw.length * 6)
    const cols = new Float32Array(draw.length * 6)
    const endPts: number[] = []
    const endCols: number[] = []
    const range = Math.max(0.5, cs.cutoff - 2.5)
    for (let k = 0; k < draw.length; k++) {
      const p = draw[k]
      verts[k * 6] = pos[p.atomA * 3]
      verts[k * 6 + 1] = pos[p.atomA * 3 + 1]
      verts[k * 6 + 2] = pos[p.atomA * 3 + 2]
      verts[k * 6 + 3] = pos[p.atomB * 3]
      verts[k * 6 + 4] = pos[p.atomB * 3 + 1]
      verts[k * 6 + 5] = pos[p.atomB * 3 + 2]
      const t = (p.minDist - 2.5) / range
      const [r, g, b] = contactColor(t)
      for (let v = 0; v < 2; v++) {
        cols[k * 6 + v * 3] = r
        cols[k * 6 + v * 3 + 1] = g
        cols[k * 6 + v * 3 + 2] = b
      }
      endPts.push(p.atomA, p.atomB)
      endCols.push(r, g, b, r, g, b)
    }
    this.buildContactGeometry(verts, cols, endPts.map(i => ({ pos: [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]] as [number, number, number] })), endCols)
  }

  /** 组装接触连线 + 端点标记（两种模式共用） */
  private buildContactGeometry(verts: Float32Array, cols: Float32Array, endPts: { pos: [number, number, number] }[], endCols: number[]) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3))
    const mat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
    })
    const lines = new THREE.LineSegments(geo, mat)
    lines.renderOrder = 7
    this.contactGroup.add(lines)
    // 端点小标记（按各自连线颜色着色）
    const sphereGeo = new THREE.SphereGeometry(0.2, 8, 6)
    const sphereMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false })
    const marker = new THREE.InstancedMesh(sphereGeo, sphereMat, endPts.length)
    const m4 = new THREE.Matrix4()
    const colorAttr = new THREE.InstancedBufferAttribute(new Float32Array(endCols), 3)
    for (let k = 0; k < endPts.length; k++) {
      m4.makeTranslation(endPts[k].pos[0], endPts[k].pos[1], endPts[k].pos[2])
      marker.setMatrixAt(k, m4)
    }
    marker.instanceMatrix.needsUpdate = true
    marker.instanceColor = colorAttr
    colorAttr.needsUpdate = true
    marker.renderOrder = 9
    this.contactGroup.add(marker)
  }

  // ---------- 氢键 Web Worker ----------

  /** 懒建 worker（构造失败则永久回退同步检测） */
  private ensureHBondWorker(): Worker | null {
    if (this.hbondWorkerFailed) return null
    if (this.hbondWorker) return this.hbondWorker
    try {
      const w = new Worker(new URL('./hbond-worker.ts', import.meta.url))
      w.onmessage = (e: MessageEvent) => this.onHBondWorkerResult(e.data)
      w.onerror = () => {
        // worker 异常：标记失败并回退同步路径
        this.hbondWorkerFailed = true
        this.hbondPending.clear()
        useHBondStore.getState().setComputing(false)
      }
      this.hbondWorker = w
      return w
    } catch {
      this.hbondWorkerFailed = true
      return null
    }
  }

  /** 投递异步检测（同 key 在飞行中则去重）；返回是否成功投递 */
  private requestHBondDetect(structureId: string, detKey: string, data: StructureData, s: Settings): boolean {
    if (this.hbondPending.get(structureId) === detKey) return true // 同一请求在飞行中 → 视为已投递
    const w = this.ensureHBondWorker()
    if (!w) return false
    const a = data.atoms
    const n = a.count
    // 预编译元素标志（避免传字符串数组）
    const heteroFlag = new Uint8Array(n)
    const isHydrogen = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const e = a.elements[i]
      if (e === 'N' || e === 'O' || e === 'S') heteroFlag[i] = 1
      else if (e === 'H' || e === 'D') isHydrogen[i] = 1
    }
    const resWater = new Uint8Array(data.residues.length)
    for (let r = 0; r < data.residues.length; r++) resWater[r] = data.residues[r].water ? 1 : 0
    const reqId = ++this.hbondReqId
    this.hbondPending.set(structureId, detKey)
    w.postMessage({
      type: 'detect',
      reqId,
      structureId,
      key: detKey,
      positions: a.positions,
      heteroFlag,
      isHydrogen,
      atomResidue: data.atomResidue,
      resWater,
      bondA: data.bonds.a,
      bondB: data.bonds.b,
      hasH: data.hasHydrogens,
      maxDist: Math.min(2.5, s.hbondMaxDist - 1),
      maxHeavyDist: s.hbondMaxDist,
      minAngle: 120,
      includeWater: s.hbondIncludeWater,
    })
    return true
  }

  /** worker 结果：写入缓存并重渲氢键视觉 */
  private onHBondWorkerResult(msg: {
    type: string
    reqId: number
    structureId: string
    key: string
    count: number
    triplets: Int32Array
    values: Float32Array
  }) {
    if (!msg || msg.type !== 'result') return
    // 过期结果（设置已变 → 新 key 已投递）：丢弃
    if (this.hbondPending.get(msg.structureId) !== msg.key) return
    this.hbondPending.delete(msg.structureId)
    const hbonds: HBond[] = []
    for (let i = 0; i < msg.count; i++) {
      hbonds.push({
        donor: msg.triplets[i * 3],
        hydrogen: msg.triplets[i * 3 + 1],
        acceptor: msg.triplets[i * 3 + 2],
        dist: msg.values[i * 2],
        angle: msg.values[i * 2 + 1],
      })
    }
    this.hbondCache.set(msg.structureId, { key: msg.key, hbonds })
    // 用最近一次 state 重渲（异步完成时 sync 不一定会再触发）
    if (this.lastHbondState && this.settings?.showHBonds) {
      this.updateHBonds(this.lastHbondState)
    } else {
      useHBondStore.getState().setComputing(this.hbondPending.size > 0)
    }
  }

  // ---------- NMR ensemble 多构象动画 ----------

  /** 开始播放 ensemble（结构必须有 ensemble 数据） */
  playEnsemble(structureId: string) {
    const data = dataRegistry.get(structureId)
    if (!data?.ensemble || data.ensemble.frames.length < 2) return
    const es = useEnsembleStore.getState()
    this.ensemblePlay = { frame: this.ensemblePlay?.frame ?? es.frame, lastT: performance.now() }
    es.setPlaying(true)
  }

  pauseEnsemble() {
    this.ensemblePlay = null
    useEnsembleStore.getState().setPlaying(false)
  }

  /** 跳到指定整数帧（暂停状态下拖动滑块） */
  setEnsembleFrame(structureId: string, frame: number) {
    const data = dataRegistry.get(structureId)
    if (!data?.ensemble) return
    const f = Math.max(0, Math.min(frame, data.ensemble.frames.length - 1))
    this.ensemblePlay = null
    useEnsembleStore.getState().setPlaying(false)
    this.applyEnsembleFrame(data, f)
    useEnsembleStore.getState().setFrame(f)
  }

  /** 重置到第 1 帧并刷新几何 */
  resetEnsemble(structureId: string) {
    const data = dataRegistry.get(structureId)
    if (!data?.ensemble) return
    this.ensemblePlay = null
    const es = useEnsembleStore.getState()
    es.setPlaying(false)
    this.applyEnsembleFrame(data, 0)
    es.setFrame(0)
  }

  /** 渲染循环驱动：推进插值帧并重建几何 */
  private updateEnsemble() {
    const es = useEnsembleStore.getState()
    if (!es.playing || !es.structureId) return
    const data = dataRegistry.get(es.structureId)
    if (!data?.ensemble) { this.pauseEnsemble(); return }
    if (!this.ensemblePlay) this.ensemblePlay = { frame: es.frame, lastT: performance.now() }
    const ep = this.ensemblePlay
    const now = performance.now()
    const dt = Math.min((now - ep.lastT) / 1000, 0.12)
    ep.lastT = now
    const frames = data.ensemble.frames.length
    ep.frame += dt * es.fps
    if (ep.frame >= frames) {
      if (es.loop) ep.frame %= frames
      else {
        ep.frame = frames - 1
        this.applyEnsembleFrame(data, ep.frame)
        const store = useEnsembleStore.getState()
        store.setFrame(Math.floor(ep.frame))
        this.pauseEnsemble()
        return
      }
    }
    this.applyEnsembleFrame(data, ep.frame)
    // 节流同步 UI 帧号（避免 60Hz 全量 React 更新）
    if (Math.abs(Math.floor(ep.frame) - useEnsembleStore.getState().frame) >= 1) {
      useEnsembleStore.getState().setFrame(Math.floor(ep.frame))
    }
  }

  /** 应用帧（含插值）到原子坐标并增量重建该结构全部视图 */
  private applyEnsembleFrame(data: StructureData, frameF: number) {
    if (!data.ensemble) return
    const frames = data.ensemble.frames
    const n = frames.length
    const f = Math.max(0, Math.min(frameF, n - 1))
    const f0 = Math.floor(f)
    const f1 = Math.min(f0 + 1, n - 1)
    const alpha = f - f0
    const pos = data.atoms.positions
    const a = frames[f0]
    const b = frames[f1]
    if (alpha > 1e-4 && f1 !== f0) {
      for (let i = 0; i < pos.length; i++) pos[i] = a[i] + (b[i] - a[i]) * alpha
    } else {
      pos.set(a)
    }
    this.rebuildStructureVisuals(data)
  }

  /** 坐标变化后重建该结构的全部视觉（reps/高亮/标签/测量/拾取标记/氢键） */
  private rebuildStructureVisuals(data: StructureData) {
    // 找到对应 entry 并重建 reps
    const store = useMolStore.getState()
    const entry = store.structures.find(s => s.id === data.id)
    const view = this.views.get(data.id)
    if (!entry || !view) return
    const filtersKey = `${store.settings.hideHydrogens}|${store.settings.hideWater}|${store.settings.quality}`
    for (const rep of entry.reps) {
      const existing = view.reps.get(rep.id)
      if (existing) {
        view.repContainer.remove(existing.build.group)
        existing.build.dispose()
        view.reps.delete(rep.id)
      }
      this.buildRep(entry, rep, data, view, store.settings, filtersKey)
    }
    this.pickablesCache = null
    // 高亮/标签/测量/拾取标记强制刷新（key 缓存需失效）
    if (store.selection.structureId === data.id) {
      this.updateHighlight(view, data, store.selection.indices)
    }
    this.lastLabelsKey = ''
    this.updateLabels(store.labels)
    this.lastMeasureKey = ''
    this.updateMeasurements(store.measurements)
    this.lastPicksKey = ''
    this.updatePickMarkers(store.measurePicks)
    // 氢键重算（清缓存使 detKey 失效）
    this.hbondCache.delete(data.id)
    this.lastHbondKey = ''
    this.updateHBonds(store)
    // 接触连线坐标已变化 → 重渲染
    this.updateContacts()
    // 对称伴侣跟随重建（ensemble 播放期间节流，避免每帧全量克隆）
    const entrySym = store.structures.find(s => s.id === data.id)?.symmetry
    if (entrySym && entrySym.radius > 0) {
      const now = performance.now()
      if (now - (view.symLastRebuild ?? 0) > 140) {
        view.symLastRebuild = now
        const symKey = `${entry.rev}|${entry.reps.map(r => r.id + (r.visible ? '1' : '0')).join(',')}|${entrySym.radius}|${filtersKey}`
        this.rebuildSymmetry(entry, data, view, symKey, entrySym.radius)
      }
    }
  }

  // ---------- 晶体对称伴侣（PyMOL symmetry / ChimeraX symmates） ----------

  /** 设置/更新对称伴侣；radius ≤ 0 清除。返回 { ok, count, message } */
  updateSymmetry(structureId: string, radius: number): { ok: boolean; count: number; message: string } {
    const data = dataRegistry.get(structureId)
    const store = useMolStore.getState()
    const entry = store.structures.find(s => s.id === structureId)
    if (!data || !entry) return { ok: false, count: 0, message: '结构不存在' }
    if (radius <= 0) {
      useMolStore.setState(s => ({
        structures: s.structures.map(x => x.id === structureId ? { ...x, symmetry: undefined } : x),
        visualRev: s.visualRev + 1,
      }))
      const g = this.symmetryGroups.get(structureId)
      const view = this.views.get(structureId)
      if (g && view) view.group.remove(g)
      this.symmetryGroups.delete(structureId)
      this.pickablesCache = null
      return { ok: true, count: 0, message: `已关闭 ${entry.name} 的对称伴侣` }
    }
    if (!data.crystal) {
      return { ok: false, count: 0, message: `${entry.name} 无晶胞信息（CRYST1 缺失）——无法生成对称伴侣` }
    }
    const ops = symOpsFor(data.crystal.spaceGroup)
    if (!ops) {
      return { ok: false, count: 0, message: `空间群 "${data.crystal.spaceGroup.trim()}" 不在支持列表（65 个手性群）内` }
    }
    const mates = mateTransforms(data.crystal, data.crystal.spaceGroup, data.bbox.center, radius, data.bbox.radius)
    useMolStore.setState(s => ({
      structures: s.structures.map(x => x.id === structureId ? { ...x, symmetry: { radius, count: mates.length } } : x),
      visualRev: s.visualRev + 1,
    }))
    // 视觉重建（symKey 变化由 sync 触发；这里主动调一次确保即时反馈）
    const view = this.views.get(structureId)
    if (view) {
      const symKey = `${entry.rev}|${entry.reps.map(r => r.id + (r.visible ? '1' : '0')).join(',')}|${radius}|${store.settings.hideHydrogens}|${store.settings.hideWater}|${store.settings.quality}`
      this.rebuildSymmetry(entry, data, view, symKey, radius)
    }
    return {
      ok: true, count: mates.length,
      message: `${entry.name}：已生成 ${mates.length} 个对称伴侣（空间群 ${data.crystal.spaceGroup.trim()} · 半径 ${radius} Å · ${ops.length} 个对称操作）`,
    }
  }

  /** 重建对称克隆组：克隆各 rep 的 group（共享几何/材质），挂刚体矩阵（不参与拾取）。radius 显式传入（避免旧 entry 引用读取到未更新的 symmetry） */
  private rebuildSymmetry(entry: StructureEntry, data: StructureData, view: StructureView, symKey: string, radius: number) {
    let symGroup = this.symmetryGroups.get(entry.id)
    if (!symGroup) {
      symGroup = new THREE.Group()
      symGroup.name = 'symmetry'
      this.symmetryGroups.set(entry.id, symGroup)
      view.group.add(symGroup)
    }
    for (const child of [...symGroup.children]) symGroup.remove(child)
    view.symLastRebuild = performance.now()
    const crystal = data.crystal
    // reps 未就绪（会话恢复早期）→ 不缓存 symKey，sync 构建 reps 后会重试
    if (!crystal || radius <= 0 || view.reps.size === 0) return
    const mates = mateTransforms(crystal, crystal.spaceGroup, data.bbox.center, radius, data.bbox.radius)
    const m4 = new THREE.Matrix4()
    for (const mt of mates) {
      m4.set(
        mt.rot[0], mt.rot[1], mt.rot[2], mt.trans[0],
        mt.rot[3], mt.rot[4], mt.rot[5], mt.trans[1],
        mt.rot[6], mt.rot[7], mt.rot[8], mt.trans[2],
        0, 0, 0, 1,
      )
      for (const rv of view.reps.values()) {
        if (!rv.build.group.visible) continue
        const clone = cloneGroupShallowUserData(rv.build.group)
        clone.matrix.copy(m4)
        clone.matrixAutoUpdate = false
        clone.matrixWorldNeedsUpdate = true
        symGroup.add(clone)
      }
    }
    // 成功重建后才缓存 key（失败/清空时 sync 可重试）
    symGroup.userData.symKey = symKey
    // 数量回写（面板显示；读取 store 最新 entry，不触发 sync 循环）
    const cur = useMolStore.getState().structures.find(x => x.id === entry.id)
    if (cur?.symmetry && cur.symmetry.count !== mates.length) {
      useMolStore.setState(s => ({
        structures: s.structures.map(x => x.id === entry.id && x.symmetry
          ? { ...x, symmetry: { ...x.symmetry, count: mates.length } } : x),
      }))
    }
  }

  // ---------- 结构叠合（对标 ChimeraX matchmaker） ----------

  /**
   * 将 mobile 结构叠合到 ref 结构：序列比对 + Horn 四元数刚体拟合 + 变换应用
   * 返回拟合统计（RMSD / 匹配数 / 链对）；失败返回 error
   * 可选链参数：显式指定移动/参考蛋白链（matchmaker 风格）
   */
  superpose(mobileId: string, refId: string, mobileChain?: string, refChain?: string): SuperposeResult {
    const mobile = dataRegistry.get(mobileId)
    const ref = dataRegistry.get(refId)
    if (!mobile || !ref) return { ...NULL_RESULT, error: '结构不存在' }
    if (mobileId === refId) return { ...NULL_RESULT, error: '移动与参考结构相同' }
    const t0 = performance.now()
    const result = superposeStructures(mobile, ref, mobileChain, refChain)
    if (!result.ok) return result
    // 应用变换：positions + ensemble 帧 + 网格/包围盒
    applyRigidTransform(mobile, result.quat, result.translation)
    // 记录累计刚体变换（会话持久化：恢复时重放，保持叠合位姿）
    // p' = R(q2)·(R(q1)·p + t1) + t2 → qTotal = q2⊗q1，tTotal = R(q2)·t1 + t2
    // 注意：superpose/superpose.ts 的 quat 约定为 (w,x,y,z)，THREE.Quaternion 为 (x,y,z,w)
    const store = useMolStore.getState()
    const entry = store.structures.find(s => s.id === mobileId)
    const prev = entry?.transform
    /** (w,x,y,z) → THREE.Quaternion */
    const toThree = (q: [number, number, number, number]) => new THREE.Quaternion(q[1], q[2], q[3], q[0])
    const q2 = toThree(result.quat)
    const t2 = new THREE.Vector3(result.translation[0], result.translation[1], result.translation[2])
    let quatOut: [number, number, number, number]
    let tOut: [number, number, number]
    if (prev) {
      const q1 = toThree(prev.quat)
      const t1 = new THREE.Vector3(prev.translation[0], prev.translation[1], prev.translation[2])
      const qTotal = q2.clone().multiply(q1)
      const tTotal = t1.clone().applyQuaternion(q2).add(t2)
      const [tx, ty, tz, tw] = qTotal.toArray()
      quatOut = [tw, tx, ty, tz]
      tOut = tTotal.toArray() as [number, number, number]
    } else {
      quatOut = [...result.quat] as [number, number, number, number]
      tOut = [...result.translation] as [number, number, number]
    }
    useMolStore.setState(s => ({
      structures: s.structures.map(x => x.id === mobileId
        ? { ...x, transform: { quat: quatOut, translation: tOut } }
        : x),
    }))
    // 重建视觉（reps/标签/测量/氢键等）
    this.rebuildStructureVisuals(mobile)
    // 选择/视图跟随：若当前选中的是 mobile，保持选择不变（高亮已重建）
    const ms = Math.round(performance.now() - t0)
    void ms
    return result
  }

  /** 撤销叠合：用累计变换的逆变换把结构放回原始位姿（ensemble 帧/网格/包围盒同步） */
  resetTransform(structureId: string): { ok: boolean; message: string } {
    const store = useMolStore.getState()
    const entry = store.structures.find(s => s.id === structureId)
    const data = dataRegistry.get(structureId)
    if (!entry || !data) return { ok: false, message: '结构不存在' }
    if (!entry.transform) return { ok: false, message: '该结构未应用叠合变换' }
    const t = entry.transform
    // superpose.ts 约定 (w,x,y,z)；THREE.Quaternion 为 (x,y,z,w)
    const q = new THREE.Quaternion(t.quat[1], t.quat[2], t.quat[3], t.quat[0])
    const tr = new THREE.Vector3(t.translation[0], t.translation[1], t.translation[2])
    const qInv = q.clone().invert()
    const tInv = tr.clone().negate().applyQuaternion(qInv)
    const [qx, qy, qz, qw] = qInv.toArray()
    applyRigidTransform(data, [qw, qx, qy, qz], tInv.toArray() as [number, number, number])
    // 清除累计变换（会话持久化不再重放）+ bump rev 重建
    useMolStore.setState(s => ({
      structures: s.structures.map(x => x.id === structureId
        ? { ...x, transform: undefined, rev: x.rev + 1 }
        : x),
      visualRev: s.visualRev + 1,
    }))
    this.rebuildStructureVisuals(data)
    return { ok: true, message: `已重置 ${entry.name} 到原始位姿` }
  }

  // ---------- SASA 溶剂可及面积（Shrake–Rupley，大结构走 Web Worker） ----------

  /**
   * 计算完整结构 per-atom SASA 并写回 data.sasa。
   * 小结构同步完成返回 true；大结构投递 worker 返回 false（结果到达后自动 bump 重建）。
   */
  requestSasa(structureId: string, opts: SasaComputeOptions = {}): { done: boolean; stats?: SasaStats } {
    const data = dataRegistry.get(structureId)
    if (!data) return { done: false }
    const { probe = 1.4, nPoints = 92 } = opts
    const n = data.atoms.count
    const key = `full|${probe}|${nPoints}|${n}`
    // 小结构：同步计算直接落库
    if (n < SASA_WORKER_MIN_ATOMS) {
      const { perAtom, stats } = computeSasa(data, opts)
      data.sasa = perAtom
      this.applySasaResult(structureId, data, stats, probe, nPoints)
      return { done: true, stats }
    }
    // 大结构：worker 异步
    if (this.sasaPending.get(structureId) === key) return { done: false }
    const w = this.ensureSasaWorker()
    if (!w) {
      const { perAtom, stats } = computeSasa(data, opts)
      data.sasa = perAtom
      this.applySasaResult(structureId, data, stats, probe, nPoints)
      return { done: true, stats }
    }
    const isHydrogen = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const e = data.atoms.elements[i]
      if (e === 'H' || e === 'D') isHydrogen[i] = 1
    }
    this.sasaPending.set(structureId, key)
    useSasaStore.getState().setComputing(true)
    w.postMessage({
      type: 'compute',
      reqId: ++this.sasaReqId,
      structureId,
      key,
      kind: 'full',
      positions: data.atoms.positions,
      radii: compileRadii(data.atoms.elements),
      isHydrogen,
      probe,
      nPoints,
    })
    return { done: false }
  }

  /**
   * 界面埋藏面积（ΔSASA）：A/B 掩码三路计算。
   * 小结构同步；大结构 worker（结果写入 sasa-store.buried）。
   */
  requestBuriedSasa(
    structureId: string,
    maskA: Uint8Array,
    maskB: Uint8Array,
    opts: SasaComputeOptions = {},
  ): { done: boolean; result?: BuriedSasaResult } {
    const data = dataRegistry.get(structureId)
    if (!data) return { done: false }
    const { probe = 1.4, nPoints = 92 } = opts
    const n = data.atoms.count
    const key = `buried|${probe}|${nPoints}|${n}`
    if (n < BSA_WORKER_MIN_ATOMS) {
      const result = computeBuriedSasa(data, maskA, maskB, opts)
      this.applyBuriedResult(structureId, data, result, maskA, maskB)
      return { done: true, result }
    }
    if (this.sasaPending.get(structureId) === key) return { done: false }
    const w = this.ensureSasaWorker()
    if (!w) {
      const result = computeBuriedSasa(data, maskA, maskB, opts)
      this.applyBuriedResult(structureId, data, result, maskA, maskB)
      return { done: true, result }
    }
    const isHydrogen = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const e = data.atoms.elements[i]
      if (e === 'H' || e === 'D') isHydrogen[i] = 1
    }
    this.sasaPending.set(structureId, key)
    useSasaStore.getState().setBuriedComputing(true)
    w.postMessage({
      type: 'compute',
      reqId: ++this.sasaReqId,
      structureId,
      key,
      kind: 'buried',
      positions: data.atoms.positions,
      radii: compileRadii(data.atoms.elements),
      isHydrogen,
      probe,
      nPoints,
      maskA,
      maskB,
    })
    return { done: false }
  }

  /** SASA 结果落库：统计入 store + 有 sasa 着色 rep 时 bump rev 触发重建 */
  private applySasaResult(structureId: string, data: StructureData, stats: SasaStats, probe: number, nPoints: number) {
    // Top 暴露残基（≤12，降序，跳过水/非聚合物）
    const top: { resIdx: number; area: number }[] = []
    for (let r = 0; r < data.residues.length; r++) {
      const res = data.residues[r]
      if (res.water || !res.polymer) continue
      if (stats.perResidue[r] > 0) top.push({ resIdx: r, area: stats.perResidue[r] })
    }
    top.sort((a, b) => b.area - a.area)
    useSasaStore.getState().setResult({
      structureId,
      total: stats.total,
      hydrophobic: stats.hydrophobic,
      polar: stats.polar,
      het: stats.het,
      ms: stats.ms,
      probe,
      nPoints,
      topResidues: top.slice(0, 12),
    })
    // 若任何 rep 使用 sasa 着色 → bump rev 触发重着色（sasa 数据已就位）
    const entry = useMolStore.getState().structures.find(s => s.id === structureId)
    if (entry?.reps.some(rep => rep.colorScheme === 'sasa')) {
      useMolStore.setState(s => ({
        structures: s.structures.map(x => x.id === structureId ? { ...x, rev: x.rev + 1 } : x),
        visualRev: s.visualRev + 1,
      }))
    }
    // 挂起的 color sasa 烘焙请求（大结构 worker 路径）→ 数据就绪后自动补烘焙
    if (this.pendingSasaBake === structureId) {
      this.pendingSasaBake = null
      const store = useMolStore.getState()
      if (store.activeId === structureId) {
        store.applyColor('sasa')
        store.appendLog('out', 'SASA 数据就绪——已自动完成暴露度着色（埋藏蓝紫 → 暴露橙红）')
      }
    }
  }

  /** ΔSASA 结果落库（worker / 同步共用） */
  private applyBuriedResult(structureId: string, data: StructureData, result: BuriedSasaResult, maskA: Uint8Array, maskB: Uint8Array) {
    void maskA; void maskB
    useSasaStore.getState().setBuried({
      computing: false,
      structureId,
      atomsA: result.atomsA,
      atomsB: result.atomsB,
      buriedA: result.buriedA,
      buriedB: result.buriedB,
      coreA: result.coreA,
      coreB: result.coreB,
      ms: result.ms,
      cross: null,
    })
  }

  // ---------- 跨结构 ΔSASA（两个独立 PDB 条目间的界面埋藏面积） ----------

  /**
   * 跨结构界面埋藏面积：把 A/B 两结构的原子拼接为联合坐标集做三路 SASA
   * （A alone / B alone / A∪B）。当前位姿（superpose 变换已写入 positions）即为计算基准。
   * 小结构同步；大结构 worker（kind='buried'，key 前缀 xburied 区分单结构路径）。
   */
  requestCrossBuriedSasa(
    idA: string,
    maskA: Uint8Array,
    idB: string,
    maskB: Uint8Array,
    opts: SasaComputeOptions = {},
  ): { done: boolean; result?: { buriedA: number; buriedB: number; coreA: number[]; coreB: number[]; atomsA: number; atomsB: number; ms: number } } {
    const dataA = dataRegistry.get(idA)
    const dataB = dataRegistry.get(idB)
    if (!dataA || !dataB) return { done: false }
    const { probe = 1.4, nPoints = 92 } = opts
    const nA = dataA.atoms.count
    const nB = dataB.atoms.count
    const n = nA + nB
    if (maskA.length !== nA || maskB.length !== nB) return { done: false }
    // 联合数组（当前位姿）
    const positions = new Float32Array(n * 3)
    positions.set(dataA.atoms.positions, 0)
    positions.set(dataB.atoms.positions, nA * 3)
    const radii = new Float32Array(n)
    radii.set(compileRadii(dataA.atoms.elements), 0)
    radii.set(compileRadii(dataB.atoms.elements), nA)
    const isHydrogen = new Uint8Array(n)
    for (let i = 0; i < nA; i++) {
      const e = dataA.atoms.elements[i]
      if (e === 'H' || e === 'D') isHydrogen[i] = 1
    }
    for (let i = 0; i < nB; i++) {
      const e = dataB.atoms.elements[i]
      if (e === 'H' || e === 'D') isHydrogen[nA + i] = 1
    }
    const aMask = new Uint8Array(n)
    aMask.set(maskA, 0)
    const bMask = new Uint8Array(n)
    bMask.set(maskB, nA)
    // 重原子计数
    let heavyA = 0, heavyB = 0
    for (let i = 0; i < n; i++) {
      if (aMask[i] && !isHydrogen[i]) heavyA++
      if (bMask[i] && !isHydrogen[i]) heavyB++
    }
    const store = useMolStore.getState()
    const labelA = store.structures.find(s => s.id === idA)?.meta.pdbId ?? idA
    const labelB = store.structures.find(s => s.id === idB)?.meta.pdbId ?? idB

    const key = `xburied|${idA}|${idB}|${probe}|${nPoints}|${n}`
    if (n < BSA_WORKER_MIN_ATOMS) {
      const t0 = performance.now()
      const r = computeBuriedSasaArrays(positions, radii, isHydrogen, aMask, bMask, probe, nPoints)
      this.applyCrossBuriedResult(idA, dataA, idB, dataB, r.delta, performance.now() - t0, heavyA, heavyB, labelA, labelB)
      return { done: true, result: this.crossBuriedSummary(idA, dataA, idB, dataB, r.delta) }
    }
    if (this.sasaPending.get(idA) === key) return { done: false }
    const w = this.ensureSasaWorker()
    if (!w) {
      const t0 = performance.now()
      const r = computeBuriedSasaArrays(positions, radii, isHydrogen, aMask, bMask, probe, nPoints)
      this.applyCrossBuriedResult(idA, dataA, idB, dataB, r.delta, performance.now() - t0, heavyA, heavyB, labelA, labelB)
      return { done: true, result: this.crossBuriedSummary(idA, dataA, idB, dataB, r.delta) }
    }
    this.xbsaMeta = { idA, idB, labelA, labelB, heavyA, heavyB }
    this.sasaPending.set(idA, key)
    // 占位结果：面板立即可见「计算中」状态（worker 完成后替换）
    useSasaStore.getState().setBuried({
      computing: true,
      structureId: idA,
      atomsA: heavyA,
      atomsB: heavyB,
      buriedA: 0, buriedB: 0, coreA: [], coreB: [], ms: 0,
      cross: { idA, idB, labelA, labelB },
    })
    w.postMessage({
      type: 'compute',
      reqId: ++this.sasaReqId,
      structureId: idA,
      key,
      kind: 'buried',
      positions,
      radii,
      isHydrogen,
      probe,
      nPoints,
      maskA: aMask,
      maskB: bMask,
    })
    return { done: false }
  }

  /** 跨结构 ΔSASA 结果落库：delta 拆回两侧结构 + 各自残基聚合 + 核心残基（>1 Å²） */
  private applyCrossBuriedResult(
    idA: string, dataA: StructureData, idB: string, dataB: StructureData,
    delta: Float32Array, ms: number, atomsA: number, atomsB: number,
    labelA: string, labelB: string,
  ) {
    const nA = dataA.atoms.count
    const deltaA = delta.subarray(0, nA)
    const deltaB = delta.subarray(nA)
    const perResA = new Float32Array(dataA.residues.length)
    for (let i = 0; i < deltaA.length; i++) {
      if (deltaA[i] > 0) perResA[dataA.atomResidue[i]] += deltaA[i]
    }
    const perResB = new Float32Array(dataB.residues.length)
    for (let i = 0; i < deltaB.length; i++) {
      if (deltaB[i] > 0) perResB[dataB.atomResidue[i]] += deltaB[i]
    }
    let buriedA = 0, buriedB = 0
    for (let i = 0; i < deltaA.length; i++) buriedA += deltaA[i]
    for (let i = 0; i < deltaB.length; i++) buriedB += deltaB[i]
    const coreA: number[] = [], coreB: number[] = []
    for (let r = 0; r < perResA.length; r++) if (perResA[r] > 1) coreA.push(r)
    for (let r = 0; r < perResB.length; r++) if (perResB[r] > 1) coreB.push(r)
    useSasaStore.getState().setBuried({
      computing: false,
      structureId: idA,
      atomsA, atomsB, buriedA, buriedB, coreA, coreB, ms,
      cross: { idA, idB, labelA, labelB },
    })
    useMolStore.getState().appendLog('out', `跨结构 ΔSASA 完成（Web Worker）：合计 ${(buriedA + buriedB).toFixed(0)} Å²（${labelA} ${buriedA.toFixed(0)} + ${labelB} ${buriedB.toFixed(0)}）· 核心残基 ${labelA} ${coreA.length} / ${labelB} ${coreB.length} · ${ms.toFixed(0)} ms`)
  }

  /** 同步路径返回摘要（不动 store——applyCrossBuriedResult 已写入） */
  private crossBuriedSummary(idA: string, dataA: StructureData, idB: string, dataB: StructureData, delta: Float32Array) {
    const nA = dataA.atoms.count
    const deltaA = delta.subarray(0, nA)
    const deltaB = delta.subarray(nA)
    const perResA = new Float32Array(dataA.residues.length)
    for (let i = 0; i < deltaA.length; i++) {
      if (deltaA[i] > 0) perResA[dataA.atomResidue[i]] += deltaA[i]
    }
    const perResB = new Float32Array(dataB.residues.length)
    for (let i = 0; i < deltaB.length; i++) {
      if (deltaB[i] > 0) perResB[dataB.atomResidue[i]] += deltaB[i]
    }
    const coreA: number[] = [], coreB: number[] = []
    let buriedA = 0, buriedB = 0
    for (let i = 0; i < deltaA.length; i++) buriedA += deltaA[i]
    for (let i = 0; i < deltaB.length; i++) buriedB += deltaB[i]
    for (let r = 0; r < perResA.length; r++) if (perResA[r] > 1) coreA.push(r)
    for (let r = 0; r < perResB.length; r++) if (perResB[r] > 1) coreB.push(r)
    let heavyA = 0, heavyB = 0
    for (let i = 0; i < deltaA.length; i++) if (deltaA[i] > 0) heavyA++
    for (let i = 0; i < deltaB.length; i++) if (deltaB[i] > 0) heavyB++
    return { buriedA, buriedB, coreA, coreB, atomsA: heavyA, atomsB: heavyB, ms: 0 }
  }

  /** 懒建 SASA worker（失败永久回退同步） */
  private ensureSasaWorker(): Worker | null {
    if (this.sasaWorkerFailed) return null
    if (this.sasaWorker) return this.sasaWorker
    try {
      const w = new Worker(new URL('./sasa-worker.ts', import.meta.url))
      w.onmessage = (e: MessageEvent) => this.onSasaWorkerResult(e.data)
      w.onerror = () => {
        this.sasaWorkerFailed = true
        this.sasaPending.clear()
        useSasaStore.getState().setComputing(false)
      }
      this.sasaWorker = w
      return w
    } catch {
      this.sasaWorkerFailed = true
      return null
    }
  }

  /** worker 结果：full → 写 data.sasa + 统计 + 重建着色；buried → 写 store（xburied 前缀走跨结构拆分） */
  private onSasaWorkerResult(msg: {
    type: string
    reqId: number
    structureId: string
    key: string
    kind: 'full' | 'buried'
    sasa?: Float32Array
    delta?: Float32Array
    ms: number
  }) {
    if (!msg || msg.type !== 'result') return
    if (this.sasaPending.get(msg.structureId) !== msg.key) return
    this.sasaPending.delete(msg.structureId)
    // 跨结构 ΔSASA：delta 是两结构拼接后的联合数组，拆回各自结构落库
    if (msg.kind === 'buried' && msg.delta && msg.key.startsWith('xburied|')) {
      const meta = this.xbsaMeta
      this.xbsaMeta = null
      const dataA = dataRegistry.get(meta?.idA ?? '')
      const dataB = dataRegistry.get(meta?.idB ?? '')
      if (!meta || !dataA || !dataB) {
        if (this.sasaPending.size === 0) useSasaStore.getState().setComputing(false)
        return
      }
      this.applyCrossBuriedResult(meta.idA, dataA, meta.idB, dataB, msg.delta, msg.ms, meta.heavyA, meta.heavyB, meta.labelA, meta.labelB)
      return
    }
    const data = dataRegistry.get(msg.structureId)
    if (!data) {
      if (this.sasaPending.size === 0) useSasaStore.getState().setComputing(false)
      return
    }
    if (msg.kind === 'full' && msg.sasa) {
      data.sasa = msg.sasa
      const stats = sasaStats(data, msg.sasa)
      stats.ms = msg.ms
      const probe = parseFloat(msg.key.split('|')[1]) || 1.4
      const nPoints = parseInt(msg.key.split('|')[2]) || 92
      this.applySasaResult(msg.structureId, data, stats, probe, nPoints)
      useMolStore.getState().appendLog('out', `SASA 完成（Web Worker，probe ${probe} Å，${nPoints} 点）：总计 ${stats.total.toFixed(0)} Å² · 疏水 ${stats.hydrophobic.toFixed(0)} · 极性 ${stats.polar.toFixed(0)} · ${stats.ms.toFixed(0)} ms`)
    } else if (msg.kind === 'buried' && msg.delta) {
      // 残基聚合 + 核心界面残基（>1 Å²）
      const perResidue = new Float32Array(data.residues.length)
      for (let i = 0; i < msg.delta.length; i++) {
        if (msg.delta[i] > 0) perResidue[data.atomResidue[i]] += msg.delta[i]
      }
      const coreA: number[] = [], coreB: number[] = []
      let buriedA = 0, buriedB = 0
      // 侧别判定：A 掩码不可得（未回传）——用 contacts 结果掩码重建
      const cs = useContactStore.getState()
      let maskA: Uint8Array | null = null
      if (cs.structureId === msg.structureId && cs.pairs.length) {
        maskA = new Uint8Array(data.atoms.count)
        for (const ri of cs.residuesA) {
          const res = data.residues[ri]
          for (let i = res.start; i < res.end; i++) maskA[i] = 1
        }
      }
      for (let r = 0; r < data.residues.length; r++) {
        if (perResidue[r] <= 1) continue
        const res = data.residues[r]
        if (maskA && maskA[res.start]) coreA.push(r)
        else coreB.push(r)
      }
      for (let i = 0; i < msg.delta.length; i++) {
        if (msg.delta[i] > 0) {
          if (maskA && maskA[i]) buriedA += msg.delta[i]
          else buriedB += msg.delta[i]
        }
      }
      useSasaStore.getState().setBuried({
        computing: false,
        structureId: msg.structureId,
        atomsA: cs.structureId === msg.structureId ? cs.atomsA : 0,
        atomsB: cs.structureId === msg.structureId ? cs.atomsB : 0,
        buriedA, buriedB, coreA, coreB, ms: msg.ms,
        cross: null,
      })
      useMolStore.getState().appendLog('out', `ΔSASA 完成（Web Worker）：合计 ${(buriedA + buriedB).toFixed(0)} Å²（A ${buriedA.toFixed(0)} + B ${buriedB.toFixed(0)}）· 界面核心残基 A ${coreA.length} / B ${coreB.length} · ${msg.ms.toFixed(0)} ms`)
    }
  }

  // ---------- 电子密度图（isomesh / isosurface，对标 PyMOL map+isomesh/isosurface） ----------

  /** 安装/替换密度图层（grid + 晶胞分数几何 → 世界位置由 PDB 正交化矩阵确定） */
  setDensityMap(def: {
    name: string
    grid: Float32Array
    dims: [number, number, number]
    fracOrigin: [number, number, number]
    fracStep: [number, number, number]
    cell: CrystalCell
    mean: number; rms: number; min: number; max: number
    iso?: number
    /** 差图负峰独立 σ（缺省同 iso） */
    isoNeg?: number
    mode?: 'surface' | 'mesh' | 'both'
    difference?: boolean
    color?: string
    negColor?: string
    opacity?: number
    visible?: boolean
  }) {
    this.disposeMapGeometry()
    const iso = def.iso ?? (def.difference ? 3 : 2)
    this.mapLayer = {
      name: def.name, grid: def.grid, dims: def.dims,
      fracOrigin: def.fracOrigin, fracStep: def.fracStep, cell: def.cell,
      mean: def.mean, rms: def.rms, min: def.min, max: def.max,
      iso,
      isoNeg: def.isoNeg ?? iso,
      mode: def.mode ?? (def.difference ? 'mesh' : 'both'),
      difference: def.difference ?? false,
      color: def.color ?? (def.difference ? '#2e9e44' : '#3d7ab8'),
      negColor: def.negColor ?? '#d64545',
      opacity: def.opacity ?? 0.38, visible: def.visible ?? true,
      meshes: [], wires: [], triangles: 0, truncated: false,
    }
    this.rebuildMapMesh()
  }

  /** 调整密度图外观（σ 级别 / 模式 / 颜色 / 不透明度 / 可见性；差图正负峰 σ 可独立设置） */
  setMapAppearance(patch: { iso?: number; isoNeg?: number; mode?: 'surface' | 'mesh' | 'both'; color?: string; negColor?: string; opacity?: number; visible?: boolean }) {
    const l = this.mapLayer
    if (!l) return
    let needRebuild = false
    if (patch.iso !== undefined && patch.iso !== l.iso) { l.iso = patch.iso; needRebuild = true }
    if (patch.isoNeg !== undefined && patch.isoNeg !== l.isoNeg) { l.isoNeg = patch.isoNeg; needRebuild = true }
    if (patch.mode !== undefined && patch.mode !== l.mode) { l.mode = patch.mode; needRebuild = true }
    if (patch.color !== undefined) l.color = patch.color
    if (patch.negColor !== undefined) l.negColor = patch.negColor
    if (patch.opacity !== undefined) l.opacity = patch.opacity
    if (patch.visible !== undefined) l.visible = patch.visible
    if (needRebuild) {
      this.rebuildMapMesh()
    } else {
      for (let i = 0; i < l.meshes.length; i++) {
        const mesh = l.meshes[i]
        mesh.visible = l.visible && l.mode !== 'mesh'
        const m = mesh.material as THREE.MeshStandardMaterial
        m.color.set(i === 0 ? l.color : l.negColor)
        m.opacity = l.opacity
      }
      for (let i = 0; i < l.wires.length; i++) {
        const wire = l.wires[i]
        wire.visible = l.visible && l.mode !== 'surface'
        ;(wire.material as THREE.LineBasicMaterial).color.set(i === 0 ? l.color : l.negColor)
      }
    }
  }

  /** 移除密度图层 */
  removeDensityMap() {
    this.disposeMapGeometry()
  }

  /** 密度图信息（UI 镜像用） */
  getMapInfo() {
    const l = this.mapLayer
    if (!l) return null
    return {
      name: l.name, dims: l.dims, iso: l.iso, isoNeg: l.isoNeg, mode: l.mode, difference: l.difference,
      color: l.color, negColor: l.negColor,
      opacity: l.opacity, visible: l.visible, triangles: l.triangles, truncated: l.truncated,
      mean: l.mean, rms: l.rms, min: l.min, max: l.max, cell: l.cell,
      // 体素尺寸 = 晶轴长 × 分数步长（裁剪后步长不变，不能用 cell/dims）
      voxel: [l.cell.a * l.fracStep[0], l.cell.b * l.fracStep[1], l.cell.c * l.fracStep[2]] as [number, number, number],
    }
  }

  private disposeMapGeometry() {
    const l = this.mapLayer
    if (!l) return
    for (const mesh of l.meshes) {
      this.mapGroup.remove(mesh)
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    l.meshes = []
    for (const wire of l.wires) {
      this.mapGroup.remove(wire)
      wire.geometry.dispose()
      ;(wire.material as THREE.Material).dispose()
    }
    l.wires = []
  }

  /** marching cubes 等值面/网格重建：常规 mean+iso·rms；差图 ±iso·rms 正负双面；网格模式三角上限调低控内存 */
  private rebuildMapMesh() {
    const l = this.mapLayer
    if (!l) return
    this.disposeMapGeometry()
    const isoDefs: { level: number; color: string }[] = l.difference
      ? [
          { level: l.mean + l.iso * l.rms, color: l.color },     // 正峰（模型缺失处；σ=iso）
          { level: l.mean - l.isoNeg * l.rms, color: l.negColor }, // 负峰（模型多余/错位处；σ=isoNeg 独立）
        ]
      : [{ level: l.mean + l.iso * l.rms, color: l.color }]
    // grid 索引 → 世界笛卡尔（PDB 正交化）：cart = O·(fracOrigin + step·grid)
    const o = orthoMatrix(l.cell).o
    const [fx, fy, fz] = l.fracOrigin
    const [sx, sy, sz] = l.fracStep
    const m = new THREE.Matrix4().set(
      o[0] * sx, o[1] * sy, o[2] * sz, o[0] * fx + o[1] * fy + o[2] * fz,
      o[3] * sx, o[4] * sy, o[5] * sz, o[3] * fx + o[4] * fy + o[5] * fz,
      o[6] * sx, o[7] * sy, o[8] * sz, o[6] * fx + o[7] * fy + o[8] * fz,
      0, 0, 0, 1,
    )
    const [nx, ny, nz] = l.dims
    let tris = 0
    let truncated = false
    let skipWire = false
    // 面模式上限 60 万；网格模式上限 15 万（纯线渲染轻）；差图双面上限减半防内存峰值
    const cap = (l.mode === 'mesh' ? 150_000 : 600_000) / isoDefs.length
    for (const def of isoDefs) {
      let res = marchingCubes(l.grid, nx, ny, nz, def.level, cap)
      // 自适应上限：差图低 σ（尤其负面）等值面可远超默认上限（如 3EKJ 负面 2σ≈35 万、1.5σ>60 万三角形），
      // 截断会造成大面积缺角——mesh 模式重试 8×（线缓冲较轻），surface/both 重试 2×（实体面本已高上限）
      if (res.truncated) {
        res = marchingCubes(l.grid, nx, ny, nz, def.level, cap * (l.mode === 'mesh' ? 8 : 2))
      }
      tris += Math.floor(res.count / 3)
      truncated = truncated || res.truncated
      if (!res.count) continue
      // 叠加模式在高三角数时省略网格线（线段过重视觉噪声也大；差图已双面再减半阈值）
      if (l.mode === 'both' && res.count / 3 > 250_000 / isoDefs.length) skipWire = true
      if (l.mode !== 'mesh') {
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(res.positions, 3))
        geo.setAttribute('normal', new THREE.BufferAttribute(res.normals, 3))
        geo.applyMatrix4(m)
        const mat = new THREE.MeshStandardMaterial({
          color: def.color, transparent: true, opacity: l.opacity, depthWrite: false,
          side: THREE.DoubleSide, roughness: 0.85, metalness: 0,
        })
        mat.clippingPlanes = this.clippingPlanes
        const mesh = new THREE.Mesh(geo, mat)
        mesh.renderOrder = 4
        mesh.visible = l.visible
        this.mapGroup.add(mesh)
        l.meshes.push(mesh)
      }
      if (l.mode !== 'surface' && !skipWire) {
        // 三角边 → LineSegments（每三角 3 边 6 顶点；与 isomesh 等价）
        const trisN = Math.floor(res.count / 3)
        const linePos = new Float32Array(trisN * 18)
        for (let t = 0; t < trisN; t++) {
          const p = t * 9
          const q = t * 18
          for (let e = 0; e < 3; e++) {
            const a = p + e * 3
            const b = p + ((e + 1) % 3) * 3
            linePos[q + e * 6] = res.positions[a]
            linePos[q + e * 6 + 1] = res.positions[a + 1]
            linePos[q + e * 6 + 2] = res.positions[a + 2]
            linePos[q + e * 6 + 3] = res.positions[b]
            linePos[q + e * 6 + 4] = res.positions[b + 1]
            linePos[q + e * 6 + 5] = res.positions[b + 2]
          }
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(linePos, 3))
        geo.applyMatrix4(m)
        const mat = new THREE.LineBasicMaterial({
          color: def.color, transparent: true, opacity: Math.min(1, l.opacity + 0.5), depthWrite: false,
        })
        mat.clippingPlanes = this.clippingPlanes
        const wire = new THREE.LineSegments(geo, mat)
        wire.renderOrder = 5
        wire.visible = l.visible
        this.mapGroup.add(wire)
        l.wires.push(wire)
      }
    }
    l.triangles = tris
    l.truncated = truncated
  }

  // ---------- 动画录制（WebM） ----------

  get isRecording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording'
  }

  get recordingElapsed(): number {
    return this.isRecording ? (performance.now() - this.recordStartT) / 1000 : 0
  }

  /** 开始录制画布（30fps WebM）；返回是否成功 */
  startRecording(): boolean {
    if (this.isRecording) return true
    try {
      const stream = this.canvas.captureStream(30)
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m))
      if (!mime) return false
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 })
      this.recordChunks = []
      rec.ondataavailable = e => {
        if (e.data.size > 0) this.recordChunks.push(e.data)
      }
      rec.start(250)
      this.recorder = rec
      this.recordStartT = performance.now()
      return true
    } catch {
      return false
    }
  }

  /** 停止录制并返回 WebM Blob（未在录制返回 null） */
  stopRecording(): Promise<Blob | null> {
    const rec = this.recorder
    if (!rec || rec.state !== 'recording') return Promise.resolve(null)
    return new Promise(resolve => {
      this.recordResolve = resolve
      rec.onstop = () => {
        const blob = this.recordChunks.length ? new Blob(this.recordChunks, { type: 'video/webm' }) : null
        this.recorder = null
        this.recordResolve = null
        resolve(blob)
      }
      rec.stop()
    })
  }

  private buildRep(entry: StructureEntry, rep: RepConfig, data: StructureData, view: StructureView, settings: Settings, filtersKey: string) {
    const named = buildNamedMasks(entry.id, data)
    const res = evaluateSelection(rep.selection, { structure: data, named })
    const store = useMolStore
    if (res.error) {
      // 静默写回错误（不 bump visualRev，避免循环）
      if (rep.error !== res.error) {
        store.setState(s => ({
          structures: s.structures.map(x => x.id === entry.id
            ? { ...x, reps: x.reps.map(r => r.id === rep.id ? { ...r, error: res.error } : r) }
            : x),
        }))
      }
      const build: RepBuild = { group: new THREE.Group(), pickables: [], dispose: () => {} }
      view.reps.set(rep.id, { hash: JSON.stringify([rep, entry.rev, filtersKey]), build })
      return
    }
    if (rep.error) {
      store.setState(s => ({
        structures: s.structures.map(x => x.id === entry.id
          ? { ...x, reps: x.reps.map(r => r.id === rep.id ? { ...r, error: undefined } : r) }
          : x),
      }))
    }
    // 过滤氢 / 水
    const mask = res.mask
    if (settings.hideHydrogens || settings.hideWater) {
      for (let i = 0; i < mask.length; i++) {
        if (!mask[i]) continue
        if (settings.hideHydrogens) {
          const e = data.atoms.elements[i]
          if (e === 'H' || e === 'D') { mask[i] = 0; continue }
        }
        if (settings.hideWater && data.residues[data.atomResidue[i]].water) mask[i] = 0
      }
    }
    const atomIdx: number[] = []
    for (let i = 0; i < mask.length; i++) if (mask[i]) atomIdx.push(i)
    // 颜色
    const colors = computeAtomColors(data, rep.colorScheme, { uniformColor: rep.uniformColor })
    const overrides = Object.keys(entry.colorOverrides)
    if (overrides.length) {
      const c = new THREE.Color()
      for (const k of overrides) {
        const i = Number(k)
        if (i >= data.atoms.count) continue
        c.set(entry.colorOverrides[i])
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b
      }
    }
    const opts = { quality: settings.quality }
    let build: RepBuild
    switch (rep.type) {
      case 'spacefill':
        build = buildSpheres(data, atomIdx, colors, 'vdw', rep.ballScale, opts)
        break
      case 'ballstick':
      case 'sticks': {
        const group = new THREE.Group()
        const pickables: Pickable[] = []
        const disposes: (() => void)[] = []
        if (rep.type === 'ballstick') {
          const b = buildSpheres(data, atomIdx, colors, 'fixed', 0.22 * rep.ballScale, opts)
          group.add(b.group); pickables.push(...b.pickables); disposes.push(b.dispose)
        }
        const s = buildSticks(data, mask, atomIdx.length, colors, rep.stickRadius, opts)
        group.add(s.group); pickables.push(...s.pickables); disposes.push(s.dispose)
        build = { group, pickables, dispose: () => disposes.forEach(d => d()) }
        break
      }
      case 'lines':
        build = buildLines(data, mask, colors)
        break
      case 'cartoon':
        build = buildCartoon(data, mask, colors, rep.cartoonWidth, opts)
        break
      case 'putty':
        build = buildCartoon(data, mask, colors, rep.cartoonWidth, opts, { putty: true, puttyRange: rep.puttyRange })
        break
      case 'surface':
        build = buildSurface(data, atomIdx, colors, rep)
        break
      default:
        build = { group: new THREE.Group(), pickables: [], dispose: () => {} }
    }
    build.group.visible = rep.visible
    for (const p of build.pickables) {
      p.mesh.userData.enginePick = { pick: p, structureId: entry.id }
    }
    view.repContainer.add(build.group)
    view.reps.set(rep.id, { hash: JSON.stringify([rep, entry.rev, filtersKey]), build })
    this.pickablesCache = null
    // 材质统一挂裁剪平面；同时应用当前高光设置（新建材质也遵循 specular 开关）
    build.group.traverse(o => {
      const mesh = o as THREE.Mesh
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          ;(m as THREE.Material).clippingPlanes = this.clippingPlanes
          const std = m as THREE.MeshStandardMaterial
          if ('roughness' in std && this.settings) {
            if (std.userData.rough0 === undefined) std.userData.rough0 = std.roughness
            std.roughness = this.settings.specular ? std.userData.rough0 : 1
            std.envMapIntensity = this.settings.specular ? 1 : 0
          }
        }
      }
    })
  }

  private updateHighlight(view: StructureView, data: StructureData, indices: number[]) {
    if (view.highlight) {
      view.repContainer.remove(view.highlight)
      view.highlight.geometry.dispose()
      ;(view.highlight.material as THREE.Material).dispose()
      view.highlight = null
    }
    if (indices.length === 0 || indices.length > 40000) return
    const geo = new THREE.SphereGeometry(1, 14, 10)
    const mat = new THREE.MeshBasicMaterial({
      color: AMBER, transparent: true, opacity: 0.55, depthWrite: false,
    })
    const mesh = new THREE.InstancedMesh(geo, mat, indices.length)
    const m = new THREE.Matrix4()
    const pos = data.atoms.positions
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k]
      const r = elementInfo(data.atoms.elements[i]).vdw * 1.06 + 0.26
      m.makeScale(r, r, r)
      m.setPosition(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
      mesh.setMatrixAt(k, m)
    }
    mesh.instanceMatrix.needsUpdate = true
    mesh.renderOrder = 6
    view.highlight = mesh
    view.repContainer.add(mesh)
  }

  private updateLabels(labels: AtomLabel[]) {
    // 清空各结构 labelGroup
    for (const view of this.views.values()) {
      for (const child of [...view.labelGroup.children]) {
        view.labelGroup.remove(child)
        disposeSprite(child as THREE.Sprite)
      }
    }
    for (const label of labels) {
      const data = dataRegistry.get(label.structureId)
      const view = this.views.get(label.structureId)
      if (!data || !view || !view.group.visible) continue
      const h = Math.max(1.4, Math.min(5, data.bbox.radius * 0.055))
      const sprite = makeTextSprite(label.text, h, { color: '#f5f7fa', outline: 'rgba(10,12,16,0.85)' })
      sprite.position.set(
        data.atoms.positions[label.atomIdx * 3],
        data.atoms.positions[label.atomIdx * 3 + 1] + h * 0.6,
        data.atoms.positions[label.atomIdx * 3 + 2],
      )
      view.labelGroup.add(sprite)
    }
  }

  private updateMeasurements(measurements: Measurement[]) {
    for (const child of [...this.measureGroup.children]) {
      this.measureGroup.remove(child)
      if ((child as THREE.Sprite).isSprite) disposeSprite(child as THREE.Sprite)
      else {
        const m = child as THREE.Mesh
        m.geometry?.dispose()
        ;(m.material as THREE.Material)?.dispose()
      }
    }
    for (const meas of measurements) {
      const data = dataRegistry.get(meas.structureId)
      if (!data) continue
      const pos = data.atoms.positions
      const pts = meas.atoms.map(i => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]))
      const colorMap: Record<string, number> = { distance: 0xffd166, angle: 0x4fd1c5, dihedral: 0xc39bd3 }
      const color = colorMap[meas.type]
      const h = Math.max(1.3, Math.min(5, data.bbox.radius * 0.05))
      // 连线（细圆柱）
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k], b = pts[k + 1]
        const dir = new THREE.Vector3().subVectors(b, a)
        const len = dir.length()
        if (len < 1e-4) continue
        const geo = new THREE.CylinderGeometry(0.09, 0.09, len, 8)
        const mat = new THREE.MeshBasicMaterial({ color })
        const mesh = new THREE.Mesh(geo, mat)
        mesh.position.copy(a).addScaledVector(dir, 0.5)
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
        this.measureGroup.add(mesh)
      }
      // 值标签
      const text = meas.type === 'distance'
        ? `${meas.value.toFixed(2)} Å`
        : `${meas.value.toFixed(1)}°`
      const sprite = makeTextSprite(text, h, { color: '#ffffff', outline: 'rgba(10,12,16,0.9)' })
      const center = new THREE.Vector3()
      for (const p of pts) center.add(p)
      center.divideScalar(pts.length)
      sprite.position.copy(center).add(new THREE.Vector3(0, h * 0.8, 0))
      this.measureGroup.add(sprite)
    }
  }

  private updatePickMarkers(picks: { structureId: string; atoms: number[] } | null) {
    for (const child of [...this.pickMarkerGroup.children]) {
      this.pickMarkerGroup.remove(child)
      const m = child as THREE.Mesh
      m.geometry?.dispose()
      ;(m.material as THREE.Material)?.dispose()
    }
    if (!picks) return
    const data = dataRegistry.get(picks.structureId)
    if (!data) return
    const geo = new THREE.SphereGeometry(0.65, 16, 12)
    const mat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.9, depthTest: false })
    for (const i of picks.atoms) {
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(data.atoms.positions[i * 3], data.atoms.positions[i * 3 + 1], data.atoms.positions[i * 3 + 2])
      mesh.renderOrder = 15
      this.pickMarkerGroup.add(mesh)
    }
    // 共享 geo/mat 由上面统一 dispose（仅清 children）
  }

  // ---------- 设置 ----------

  private applySettings(settings: Settings) {
    const prev = this.settings
    const changed = JSON.stringify(settings) !== JSON.stringify(prev)
    this.settings = settings
    if (!changed) return
    // 背景
    this.scene.background = new THREE.Color(settings.background)
    // 灯光（倍率）
    this.ambientLight.intensity = 0.12 * settings.lightAmbient
    this.keyLight.intensity = 1.5 * settings.lightKey
    this.fillLight.intensity = 0.45 * settings.lightFill
    this.scene.environmentIntensity = settings.lightAmbient
    // 高光开关切换 → 遍历已有材质调整（新 rep 构建时也会应用）
    if (prev && prev.specular !== settings.specular) this.applySpecularAll(settings.specular)
    // 雾
    if (settings.fog) {
      if (!this.scene.fog) this.scene.fog = new THREE.Fog(new THREE.Color(settings.background), 50, 200)
      ;(this.scene.fog as THREE.Fog).color.set(settings.background)
    } else {
      this.scene.fog = null
    }
    // FOV / 正交
    this.camera.fov = settings.fov
    this.camera.updateProjectionMatrix()
    const wantOrtho = settings.ortho
    if (wantOrtho && this.activeCamera !== this.orthoCamera) {
      this.updateOrthoFrustum()
      this.activeCamera = this.orthoCamera
      this.controls.object = this.orthoCamera
      this.orthoCamera.zoom = 1
    } else if (!wantOrtho && this.activeCamera !== this.camera) {
      this.activeCamera = this.camera
      this.controls.object = this.camera
    } else if (wantOrtho) {
      this.updateOrthoFrustum()
    }
    // 旋转
    this.controls.autoRotate = settings.spin && !settings.rock
    this.controls.autoRotateSpeed = settings.spinSpeed
    if (!settings.rock) this.rockBase = null
    // slab
    if (!settings.slab) this.setClippingInfinite()
    // 画质
    const cap = settings.quality === 'high' ? 2 : settings.quality === 'medium' ? 1.5 : 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap))
    this.pickablesCache = null
  }

  /** 高光开关：遍历场景材质（粗糙度→1 且环境贴图贡献→0 消除镜面高光） */
  private applySpecularAll(specular: boolean) {
    this.scene.traverse(o => {
      const mesh = o as THREE.Mesh
      if (!mesh.material) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const m of mats) {
        const std = m as THREE.MeshStandardMaterial
        if (!('roughness' in std)) continue
        if (std.userData.rough0 === undefined) std.userData.rough0 = std.roughness
        std.roughness = specular ? std.userData.rough0 : 1
        std.envMapIntensity = specular ? 1 : 0
      }
    })
  }

  private setClippingInfinite() {
    // 可见条件：n·p + c ≥ 0 → c 取 +∞ 使所有点可见
    this.clippingPlanes[0].normal.set(0, 0, 1)
    this.clippingPlanes[0].constant = 1e9
    this.clippingPlanes[1].normal.set(0, 0, -1)
    this.clippingPlanes[1].constant = 1e9
  }

  // ---------- 视角 ----------

  fitView(refs?: { structureId: string; indices?: number[] }[]) {
    const state = useMolStore.getState()
    const pts: number[][] = []
    if (refs && refs.length) {
      for (const ref of refs) {
        const data = dataRegistry.get(ref.structureId)
        if (!data) continue
        if (ref.indices && ref.indices.length) {
          for (const i of ref.indices) pts.push([data.atoms.positions[i * 3], data.atoms.positions[i * 3 + 1], data.atoms.positions[i * 3 + 2]])
        } else {
          for (let i = 0; i < data.atoms.count; i++) pts.push([data.atoms.positions[i * 3], data.atoms.positions[i * 3 + 1], data.atoms.positions[i * 3 + 2]])
        }
      }
    } else {
      for (const entry of state.structures) {
        if (!entry.visible) continue
        const data = dataRegistry.get(entry.id)
        if (!data) continue
        for (let i = 0; i < data.atoms.count; i++) pts.push([data.atoms.positions[i * 3], data.atoms.positions[i * 3 + 1], data.atoms.positions[i * 3 + 2]])
      }
    }
    if (!pts.length) return
    const min: [number, number, number] = [Infinity, Infinity, Infinity]
    const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
    for (const p of pts) {
      for (let d = 0; d < 3; d++) {
        if (p[d] < min[d]) min[d] = p[d]
        if (p[d] > max[d]) max[d] = p[d]
      }
    }
    const center = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2)
    const radius = Math.max(2, 0.5 * Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]))
    const dir = new THREE.Vector3().subVectors(this.activeCamera.position, this.controls.target)
    if (dir.lengthSq() < 1e-6) dir.set(0.5, 0.35, 1)
    dir.normalize()
    const dist = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * 1.18
    this.controls.target.copy(center)
    this.activeCamera.position.copy(center).addScaledVector(dir, dist)
    if (this.activeCamera === this.orthoCamera) {
      this.updateOrthoFrustum()
      this.orthoCamera.position.copy(this.activeCamera.position)
    } else {
      this.camera.position.copy(this.activeCamera.position)
    }
    this.controls.update()
  }

  resetView() {
    this.activeCamera.position.set(40, 30, 60)
    this.controls.target.set(0, 0, 0)
    this.controls.update()
    this.fitView()
  }

  /** 对标 PyMOL orient：按 PCA 主轴对齐视角（最长轴→屏幕水平，次轴→垂直）再适配 */
  orient(refs?: { structureId: string; indices?: number[] }[]): boolean {
    const pts = this.collectFitPoints(refs)
    if (pts.length < 3) return false
    // 质心 + 协方差（3x3 对称）
    const c = [0, 0, 0]
    for (const p of pts) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2] }
    c[0] /= pts.length; c[1] /= pts.length; c[2] /= pts.length
    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    for (const p of pts) {
      const dx = p[0] - c[0], dy = p[1] - c[1], dz = p[2] - c[2]
      cov[0] += dx * dx; cov[1] += dx * dy; cov[2] += dx * dz
      cov[4] += dy * dy; cov[5] += dy * dz
      cov[8] += dz * dz
    }
    cov[3] = cov[1]; cov[6] = cov[2]; cov[7] = cov[5]
    const { vals, vecs } = eigenSymmetric3(cov)
    if (!(vals[0] > 1e-9)) { this.fitView(refs); return true }
    // 正交右手系：v1（最大方差）→屏幕 X，v2→Y(up)，v3 = v1×v2 →相机方向
    const v1 = new THREE.Vector3(vecs[0][0], vecs[0][1], vecs[0][2]).normalize()
    const v2 = new THREE.Vector3(vecs[1][0], vecs[1][1], vecs[1][2]).normalize()
    const v3 = new THREE.Vector3().crossVectors(v1, v2).normalize()
    const center = new THREE.Vector3(c[0], c[1], c[2])
    const dist = Math.max(2, this.activeCamera.position.distanceTo(this.controls.target))
    this.controls.target.copy(center)
    this.activeCamera.up.copy(v2)
    this.orthoCamera.up.copy(v2)
    this.activeCamera.position.copy(center).addScaledVector(v3, dist)
    if (this.activeCamera === this.orthoCamera) this.updateOrthoFrustum()
    this.controls.update()
    this.fitView(refs)
    return true
  }

  /** 相机状态导出（get_view） */
  getCameraState(): { pos: number[]; target: number[]; up: number[]; fov: number; ortho: boolean } {
    const cam = this.activeCamera
    return {
      pos: cam.position.toArray().map(v => +v.toFixed(4)),
      target: this.controls.target.toArray().map(v => +v.toFixed(4)),
      up: cam.up.toArray().map(v => +v.toFixed(4)),
      fov: this.camera.fov,
      ortho: this.settings?.ortho ?? false,
    }
  }

  /** 相机状态导入（set_view；JSON 文本解析后调用） */
  setCameraState(s: { pos?: number[]; target?: number[]; up?: number[]; fov?: number; ortho?: boolean }) {
    if (Array.isArray(s.pos) && s.pos.length === 3) this.activeCamera.position.fromArray(s.pos)
    if (Array.isArray(s.target) && s.target.length === 3) this.controls.target.fromArray(s.target)
    if (Array.isArray(s.up) && s.up.length === 3) {
      this.activeCamera.up.fromArray(s.up).normalize()
      this.orthoCamera.up.copy(this.activeCamera.up)
    }
    if (typeof s.fov === 'number' && s.fov > 5 && s.fov < 120) {
      this.camera.fov = s.fov
      this.camera.updateProjectionMatrix()
    }
    this.controls.update()
    if (typeof s.ortho === 'boolean' && this.settings && s.ortho !== this.settings.ortho) {
      useMolStore.getState().updateSettings({ ortho: s.ortho })
    }
  }

  /** 视角书签平滑过渡：easeInOutCubic 插值（pos/target/fov），up 在结尾落位；
   *  spin/rock 开启或参数非法时直接落位（每帧改相机的模式与过渡动画互相打架） */
  animateCameraTo(s: { pos?: number[]; target?: number[]; up?: number[]; fov?: number; ortho?: boolean }, dur = 650) {
    const valid = Array.isArray(s.pos) && s.pos.length === 3 && Array.isArray(s.target) && s.target.length === 3
    if (!valid || this.settings?.spin || this.settings?.rock) {
      this.setCameraState(s)
      return
    }
    // 投影模式先行切换（正交/透视过渡期间保持目标模式）
    if (typeof s.ortho === 'boolean' && this.settings && s.ortho !== this.settings.ortho) {
      useMolStore.getState().updateSettings({ ortho: s.ortho })
    }
    const fov1 = typeof s.fov === 'number' && s.fov > 5 && s.fov < 120 ? s.fov : this.camera.fov
    const up1 = Array.isArray(s.up) && s.up.length === 3
      ? new THREE.Vector3().fromArray(s.up).normalize()
      : this.camera.up.clone()
    this.camAnim = {
      t0: performance.now(),
      dur: Math.max(120, dur),
      p0: this.camera.position.clone(),
      p1: new THREE.Vector3().fromArray(s.pos as number[]),
      g0: this.controls.target.clone(),
      g1: new THREE.Vector3().fromArray(s.target as number[]),
      fov0: this.camera.fov,
      fov1,
      up1,
    }
  }

  /** fitView 取点抽出（orient 复用） */
  private collectFitPoints(refs?: { structureId: string; indices?: number[] }[]): number[][] {
    const state = useMolStore.getState()
    const pts: number[][] = []
    if (refs && refs.length) {
      for (const ref of refs) {
        const data = dataRegistry.get(ref.structureId)
        if (!data) continue
        if (ref.indices && ref.indices.length) {
          for (const i of ref.indices) pts.push([data.atoms.positions[i * 3], data.atoms.positions[i * 3 + 1], data.atoms.positions[i * 3 + 2]])
        } else {
          for (let i = 0; i < data.atoms.count; i++) pts.push([data.atoms.positions[i * 3], data.atoms.positions[i * 3 + 1], data.atoms.positions[i * 3 + 2]])
        }
      }
    } else {
      for (const entry of state.structures) {
        if (!entry.visible) continue
        const data = dataRegistry.get(entry.id)
        if (!data) continue
        for (let i = 0; i < data.atoms.count; i++) pts.push([data.atoms.positions[i * 3], data.atoms.positions[i * 3 + 1], data.atoms.positions[i * 3 + 2]])
      }
    }
    return pts
  }

  // ---------- 截图 ----------

  capture(opts: { scale?: number; transparent?: boolean } = {}): string {
    const scale = opts.scale ?? 1
    const w = this.container.clientWidth || 800
    const h = this.container.clientHeight || 600
    const prevRatio = this.renderer.getPixelRatio()
    const prevBg = this.scene.background
    const prevFog = this.scene.fog
    this.renderer.setPixelRatio(1)
    this.renderer.setSize(w * scale, h * scale, false)
    if (opts.transparent) {
      // 透明底：绕过 composer 直接渲染（AO 需要不透明底）
      this.scene.background = null
      this.scene.fog = null
      this.renderer.setClearColor(0x000000, 0)
      this.renderer.render(this.scene, this.activeCamera)
    } else if (this.settings?.ssao && this.composer) {
      // 开启 AO 时截图也走 composer（保持视觉一致）
      this.composer.setPixelRatio(1)
      this.composer.setSize(w * scale, h * scale)
      this.composer.render()
    } else {
      this.renderer.render(this.scene, this.activeCamera)
    }
    const url = this.renderer.domElement.toDataURL('image/png')
    this.scene.background = prevBg
    this.scene.fog = prevFog
    this.renderer.setPixelRatio(prevRatio)
    this.renderer.setSize(w, h, false)
    if (this.composer) {
      this.composer.setPixelRatio(prevRatio)
      this.composer.setSize(w, h)
    }
    return url
  }

  get hasStructures() {
    return this.hasContent
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.ro.disconnect()
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('wheel', this.onCancelCamAnim)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.canvas.removeEventListener('dblclick', this.onDoubleClick)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.controls.dispose()
    for (const view of this.views.values()) {
      for (const rv of view.reps.values()) rv.build.dispose()
    }
    this.views.clear()
    this.symmetryGroups.clear()
    this.disposeMapGeometry()
    this.stereoEffect?.dispose()
    this.stereoEffect = null
    this.disposeComposer()
    if (this.recorder && this.recorder.state === 'recording') {
      try { this.recorder.stop() } catch { /* ignore */ }
    }
    this.recorder = null
    this.hbondWorker?.terminate()
    this.sasaWorker?.terminate()
    this.sasaWorker = null
    this.hbondWorker = null
    this.hbondPending.clear()
    this.sasaPending.clear()
    this.renderer.dispose()
    if (this.canvas.parentElement === this.container) this.container.removeChild(this.canvas)
  }
}
