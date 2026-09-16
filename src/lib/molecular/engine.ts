// MolEngine：Three.js 渲染引擎（场景/相机/拾取/高亮/测量/标签/裁剪/截图）
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { computeAtomColors } from './colors'
import { elementInfo } from './chemistry'
import {
  buildCartoon, buildLines, buildSpheres, buildSticks, buildSurface,
  type Pickable, type RepBuild,
} from './representations'
import type { StructureData } from './parser'
import { evaluateSelection } from './selection'
import { detectHBonds, type HBond } from './hbonds'
import { useHBondStore } from './hbond-store'
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
}

const AMBER = 0xfbbf24

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
  private lastPicksKey = ''
  private ro: ResizeObserver
  private pickablesCache: { obj: THREE.Object3D; pick: Pickable; structureId: string }[] | null = null
  private hasContent = false

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
    this.scene.background = new THREE.Color('#101215')
    this.scene.add(this.measureGroup)
    this.scene.add(this.pickMarkerGroup)
    this.scene.add(this.hbondGroup)

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
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.12))

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
    this.controls.update()
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
    this.renderer.render(this.scene, cam)
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
  }

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
    }
    // 移除消失的结构
    for (const [id, view] of this.views) {
      if (!seen.has(id)) {
        this.scene.remove(view.group)
        for (const rv of view.reps.values()) rv.build.dispose()
        if (view.highlight) { view.highlight.geometry.dispose(); (view.highlight.material as THREE.Material).dispose() }
        this.views.delete(id)
        this.hbondCache.delete(id)
        this.pickablesCache = null
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
    // 氢键网络
    const hbondKey = [
      state.settings.showHBonds, state.settings.hbondMaxDist, state.settings.hbondIncludeWater,
      state.settings.hbondSelOnly, state.settings.hideWater,
      state.structures.filter(s => s.visible).map(s => s.id).join('|'),
      state.selection.structureId, state.selection.rev,
    ].join('#')
    if (hbondKey !== this.lastHbondKey) {
      this.lastHbondKey = hbondKey
      this.updateHBonds(state)
    }
    this.hasContent = this.views.size > 0
  }

  /** 氢键网络检测与虚线渲染 */
  private updateHBonds(state: Parameters<MolEngine['sync']>[0]) {
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
      useHBondStore.getState().setStats(0, 0, false)
      return
    }
    let total = 0, waterTotal = 0
    for (const entry of state.structures) {
      if (!entry.visible) continue
      const data = dataRegistry.get(entry.id)
      if (!data) continue
      // 检测缓存
      const detKey = `${s.hbondMaxDist}|${s.hbondIncludeWater}|${entry.rev}`
      let cached = this.hbondCache.get(entry.id)
      if (!cached || cached.key !== detKey) {
        const hbonds = detectHBonds(data, {
          maxHeavyDist: s.hbondMaxDist,
          maxDist: Math.min(2.5, s.hbondMaxDist - 1),
          includeWater: s.hbondIncludeWater,
        })
        cached = { key: detKey, hbonds }
        this.hbondCache.set(entry.id, cached)
      }
      let hbonds = cached.hbonds
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
      // 虚线几何：H...A 或 D...A
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
        color: 0x4fd1c5,
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
      const sphereMat = new THREE.MeshBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.85, depthWrite: false })
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
    // 材质统一挂裁剪平面
    build.group.traverse(o => {
      const mesh = o as THREE.Mesh
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) (m as THREE.Material).clippingPlanes = this.clippingPlanes
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
    const changed = JSON.stringify(settings) !== JSON.stringify(this.settings)
    this.settings = settings
    if (!changed) return
    // 背景
    this.scene.background = new THREE.Color(settings.background)
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
    this.controls.autoRotate = settings.spin
    this.controls.autoRotateSpeed = settings.spinSpeed
    // slab
    if (!settings.slab) this.setClippingInfinite()
    // 画质
    const cap = settings.quality === 'high' ? 2 : settings.quality === 'medium' ? 1.5 : 1
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap))
    this.pickablesCache = null
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
      this.scene.background = null
      this.scene.fog = null
      this.renderer.setClearColor(0x000000, 0)
    }
    this.renderer.render(this.scene, this.activeCamera)
    const url = this.renderer.domElement.toDataURL('image/png')
    this.scene.background = prevBg
    this.scene.fog = prevFog
    this.renderer.setPixelRatio(prevRatio)
    this.renderer.setSize(w, h, false)
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
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.canvas.removeEventListener('dblclick', this.onDoubleClick)
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave)
    this.controls.dispose()
    for (const view of this.views.values()) {
      for (const rv of view.reps.values()) rv.build.dispose()
    }
    this.views.clear()
    this.renderer.dispose()
    if (this.canvas.parentElement === this.container) this.container.removeChild(this.canvas)
  }
}
