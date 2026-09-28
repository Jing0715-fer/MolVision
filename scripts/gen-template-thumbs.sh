#!/usr/bin/env bash
# r71 创立 · r72 重造 · r76 清洁视口：论文图模板缩略图管线
# ─────────────────────────────────────────────────────────────────────────────
# 路径：欢迎页输入 demo 结构 → 工作台 → 收起序列条 → 隐藏视口 overlay（见下）→
# 开模板面板 → 按「序号」点该模板卡片「应用」→ 等命令序列完成 → 关面板 →
# 再隐藏一遍（命令可能新造 overlay：pore 卡/系综条/图例）→ 截图 → PIL 裁剪
# canvas → public/templates/{id}.png。
#
# 【r76 清洁视口（用户反馈：右黑框=书签条、左上灰框=结构 HUD 被截入）】
# 缩略图只留纯渲染：①遍历 main 隐藏一切 absolute/fixed 且不含 canvas 的元素
# （HUD/书签条/快捷样式/系综条/图例/取景刻线/十字线/pore 卡）；②万向轮是 WebGL
# scissor 渲染进 canvas 像素的——DOM 隐藏无效，改关引擎 settings.showAxes
# （window.__molEngine 为 QA 诊断钩子，且引擎持有 store settings 同一引用，
# 截图后即弃页无副作用）；③分两遍：命令前 + 截图前（命令会新造 overlay）。
#
# 【r72 揭发的 r71 潜伏坑（本轮根治）】旧版用「卡片 textContent 含 demo 号」定位
# 卡片——但 shadcn DialogContent 自带 grid 类，`.grid > div` 把滚动容器也匹配进去
# （它包含全部 12 张卡文本）→ find 恒中容器 → querySelector 恒取首卡（rainbow）
# apply 钮。实锤：r71 存量缩略图 21 对像素差 <2%（几乎全是 rainbow 同款）。
# 根治：①选择器收窄到 .mol-scroll .grid（弹窗内容滚动区内的模板网格）；
# ②卡片按 grid.children[序号] 定位（r71 worklog 已总结的方法，当时未落到脚本）；
# ③裁剪用截图前的 canvas getBoundingClientRect 实测值（不再硬编码）。
set -u
export AGENT_BROWSER_SESSION=r72-thumbs
BASE=http://localhost:3000
OUT=/home/z/my-project/public/templates
mkdir -p "$OUT"

# 模板id:等待秒数:demo结构:grid序号（FIGURE_TEMPLATES 顺序 0-22）
# density-map 22s：SF 拉取 + Worker FFT + 38 万三角等值面 marching cubes 紧凑（r72 实测
# 16s 截图会漏网格——密度缩略图无 mesh 实锤后补拍验证的教训）；publication 18s（ray 1920）
# r75 新增五模板（12-16）：mutation 12s（12 条命令 × 120ms + 标签精灵 + 相机动画）
# r76 新增两模板（17-18）：disulfide 11s（黄棍 + orient）；metal 12s（球/棍 + 聚焦动画）
# r77 新增四模板（19-22）：cpk 10s（hide all→spheres 空间填充）；mobility 10s（spectrum b）；
# heme 12s（棍 + 聚焦动画）；cation-pi 11s（contacts + 侧链棍）
# r78 新增四模板（23-26）：morph 24s（load 1ake 网络 + create 提取 + morph 计算/精修 +
# orient + ensemble play 后稳定帧）；two-state 20s（load 5p21 + superpose + SASA 表面
# worker + 幽灵透明）；ghost 14s（表面计算 + 透明 + 卡通叠加）；catalytic 12s（sticks +
# measure 标注 + 缓冲取景）
SPECS=(
  rainbow-overview:10:4HHB:0
  chain-assembly:10:4HHB:1
  ss-motif:10:1AKI:2
  ligand-pocket:11:6LU7:3
  sasa-surface:13:4HHB:4
  density-map:22:3EKJ:5
  interface-contacts:11:6LU7:6
  symmetry-assembly:11:1CRN:7
  ensemble-dynamics:10:1D3Z:8
  publication-ready:18:4HHB:9
  pore-analysis:14:1BL8:10
  membrane-embed:15:1FX8:11
  salt-bridge-network:11:1AKI:12
  hbond-network:12:6LU7:13
  dna-protein-complex:12:1LMB:14
  domain-coloring:10:6LU7:15
  mutation-hotspots:12:4HHB:16
  disulfide-bonds:11:3INS:17
  metal-center:12:2CBA:18
  cpk-spacefill:10:1CRN:19
  mobility-bfactor:10:3INS:20
  heme-pocket:12:1MBO:21
  cation-pi:11:1AKI:22
  conformational-morph:24:4AKE:23
  two-state-comparison:20:4Q21:24
  ghost-surface:14:4HHB:25
  catalytic-residues:12:1AKI:26
)

# r75：可选增量模式——命令行传模板 id 列表则只生成指定项（缺省全量）
if [ $# -gt 0 ]; then
  SPECS=($(printf '%s\n' "${SPECS[@]}" | while IFS= read -r line; do
    id="${line%%:*}"
    for want in "$@"; do [ "$id" = "$want" ] && echo "$line"; done
  done))
  echo "== filtered mode: ${#SPECS[@]} templates =="
fi

gen_one() {
  local id="$1" wait="$2" demo="$3" idx="$4"
  agent-browser open "$BASE" >/dev/null 2>&1 && sleep 4
  # 1) 欢迎页加载 demo 结构（缩略图取材 = 模板代表结构）
  agent-browser eval "(() => { const i = document.querySelector('input[aria-label=\"PDB 编号\"], input[aria-label=\"PDB ID\"]'); if (!i) return 'NOINPUT'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(i, '$demo'); i.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('form button[type=\"submit\"]').click(); return 'submitted' })()"
  sleep 7
  local loaded
  loaded=$(agent-browser eval "window.__molData ? window.__molData.size : 0" 2>/dev/null | tr -d '"')
  if [ "$loaded" = "0" ]; then echo "SKIP $id (demo $demo not loaded)"; return 1; fi
  # 1.5) 收起序列条（194px → ~40px，canvas 增高约 150px，缩略图更聚焦 3D 视口）
  agent-browser eval "(() => { const bar = document.querySelector('.tape-well'); if (!bar) return 'NOBAR'; const btn = bar.closest('div')?.querySelector('button') || document.querySelector('.tape-well button'); if (!btn) return 'NOBTN'; btn.click(); return 'collapsed' })()"
  sleep 1
  # 1.6) r76 清洁视口（第一遍）：隐藏全部 absolute/fixed 且不含 canvas 的元素 +
  #      关 WebGL 万向轮（右黑框=书签条、左上灰框=HUD 的根治；见文件头说明）
  agent-browser eval "(() => { const main = document.querySelector('main'); const canvas = main && main.querySelector('canvas'); if (!main || !canvas) return 'NOVIEW'; let n = 0; const walk = el => { for (const child of el.children) { if (child.contains(canvas)) { walk(child); continue } const cs = getComputedStyle(child); if (cs.position === 'absolute' || cs.position === 'fixed') { child.style.display = 'none'; n++; continue } walk(child) } }; walk(main); if (window.__molEngine && window.__molEngine.settings) window.__molEngine.settings.showAxes = false; return 'hidden:' + n })()"
  sleep 0.5
  # 2) 工具栏开模板面板 → 按【序号】点目标卡片「应用」（见文件头坑档——
  #    必须收窄到 .mol-scroll .grid + children[idx]，防 DialogContent grid 类污染）
  agent-browser eval "(() => { const b = document.querySelector('button[aria-label*=\"Paper-figure\"], button[aria-label*=\"论文图\"]'); if (!b) return 'NOBTN'; b.click(); return 'panel' })()"
  sleep 1.2
  agent-browser eval "(() => { const grid = document.querySelector('[role=\"dialog\"] .mol-scroll .grid'); if (!grid) return 'NOGRID'; const card = grid.children[$idx]; if (!card) return 'NOCARD'; const demoOk = card.textContent.includes('$demo') ? 'ok' : 'MISMATCH'; const apply = card.querySelector('button[title*=\"Apply to the current structure\"], button[title*=\"应用到当前结构\"]'); if (!apply) return 'NOAPPLY'; apply.click(); return 'applied:' + demoOk })()"
  sleep "$wait"
  # 3) 关面板（面板会挡画布）+ toast 退场；实测 canvas rect（裁剪用）
  agent-browser press Escape >/dev/null 2>&1
  sleep 1.8
  # 3.5) r76 清洁视口（第二遍）：命令可能新造 overlay（pore 卡/系综条/密度图例）——
  #      截图前再扫一遍（幂等；万向轮设置第一遍已关，此处防重置）
  agent-browser eval "(() => { const main = document.querySelector('main'); const canvas = main && main.querySelector('canvas'); if (!main || !canvas) return 'NOVIEW'; let n = 0; const walk = el => { for (const child of el.children) { if (child.contains(canvas)) { walk(child); continue } const cs = getComputedStyle(child); if (cs.position === 'absolute' || cs.position === 'fixed') { child.style.display = 'none'; n++; continue } walk(child) } }; walk(main); if (window.__molEngine && window.__molEngine.settings) window.__molEngine.settings.showAxes = false; return 'hidden:' + n })()"
  sleep 0.5
  agent-browser eval "(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }) })()" > /tmp/r72-canvas.json 2>/dev/null
  agent-browser screenshot "/tmp/r72-$id.raw.png" >/dev/null 2>&1
  # 4) PIL 裁剪 canvas 区 → 640×320 LANCZOS
  python3 - "$id" <<'PY'
import json, sys
from PIL import Image
tid = sys.argv[1]
raw = open('/tmp/r72-canvas.json').read().strip()
# agent-browser eval 输出带 shell 引号壳（'"{\"x\":..}"'）——剥壳后再 parse
if raw.startswith('"'):
    raw = json.loads(raw)
rect = json.loads(raw) if isinstance(raw, str) else raw
im = Image.open(f'/tmp/r72-{tid}.raw.png').convert('RGB')
im = im.crop((rect['x'], rect['y'], rect['x'] + rect['w'], rect['y'] + rect['h']))
im = im.resize((640, 320), Image.LANCZOS)
im.save(f'/home/z/my-project/public/templates/{tid}.png')
print(f'CROP {tid} canvas={rect["w"]}x{rect["h"]}')
PY
  echo "SHOT $id ($demo idx=$idx)"
}

for spec in "${SPECS[@]}"; do
  IFS=':' read -r id wait demo idx <<< "$spec"
  gen_one "$id" "$wait" "$demo" "$idx"
done
echo "== phase done =="
