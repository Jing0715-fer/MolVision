// 切层截面封闭（slab cap）：背面渲染 + 统一平面色填充
// 原理：rep 几何均为闭合实体（球/圆柱闭合壳、cartoon 完整 2π 截面环 + 端帽、metaball 封闭面），
// 裁剪后可见的「背面」即剖面内壁——将背面片段替换为统一平面色即得视觉上的实心封盖
// （PyMOL interior 风格）。透明材质（半透明表面/等值面）不参与，避免改变混合观感。
import * as THREE from 'three'

/** 共享 uniforms（所有打过补丁的材质引用同一对象，改值即时全局生效） */
export const capUniforms = {
  uCapOn: { value: 0 },
  uCapColor: { value: new THREE.Color('#ccd2d9') },
}

/** 当前封盖生效状态（引擎写入；buildRep 新材质据此决定 side） */
export const capState = { on: false }

/**
 * 给材质打「截面封盖」补丁：
 * - 片段着色器注入：uCapOn 开启且非正面朝向（背面）时输出 uCapColor 平面色
 * - FrontSide 材质（球/棍）在封盖开启时切 DoubleSide（记录 side0 以便还原）
 * - 仅处理不透明的 MeshStandardMaterial（线材质/透明表面/高亮等一律跳过）
 */
export function patchCapMaterial(mat: THREE.Material): void {
  if (mat.userData.capPatched) return
  const std = mat as THREE.MeshStandardMaterial
  if (!std.isMeshStandardMaterial || std.transparent) return
  mat.userData.capPatched = true
  mat.userData.side0 = std.side
  const prev = std.onBeforeCompile
  std.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer)
    shader.uniforms.uCapOn = capUniforms.uCapOn
    shader.uniforms.uCapColor = capUniforms.uCapColor
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'uniform float uCapOn;\nuniform vec3 uCapColor;\nvoid main() {',
      )
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        if (uCapOn > 0.5 && !gl_FrontFacing) {
          gl_FragColor.rgb = uCapColor;
        }`,
      )
  }
}

/** 单个已补丁材质按封盖状态设置 side（FrontSide 材质切换双面；DoubleSide 材质不动） */
function applySide(mat: THREE.Material, on: boolean) {
  if (!mat.userData.capPatched) return
  if (mat.userData.side0 === THREE.DoubleSide) return
  const want = on ? THREE.DoubleSide : THREE.FrontSide
  if (mat.side !== want) {
    mat.side = want
    // side 变化影响 DOUBLE_SIDED 定义（背面法线翻转），需重编译
    mat.needsUpdate = true
  }
}

/** 场景级切换：遍历所有打过补丁的材质（引擎在 applySettings 与 buildRep 调用） */
export function applyCapSides(root: THREE.Object3D, on: boolean): void {
  capState.on = on
  root.traverse(o => {
    const mesh = o as THREE.Mesh
    if (!mesh.material) return
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const m of mats) applySide(m, on)
  })
}

/** 引擎入口：同步 uniform 值 + 切换场景材质 side */
export function syncCapSettings(root: THREE.Object3D, on: boolean, color: string): void {
  capUniforms.uCapOn.value = on ? 1 : 0
  capUniforms.uCapColor.value.set(color)
  applyCapSides(root, on)
}
