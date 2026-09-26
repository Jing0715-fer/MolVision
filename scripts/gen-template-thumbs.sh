#!/usr/bin/env bash
# r71 创立 · r72 重造：论文图模板缩略图管线
# ─────────────────────────────────────────────────────────────────────────────
# 路径：欢迎页输入 demo 结构 → 工作台 → 收起序列条 → 开模板面板 → 按「序号」
# 点该模板卡片「应用」→ 等命令序列完成 → 关面板 → 截图 → PIL 裁剪 canvas →
# public/templates/{id}.png。
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

# 模板id:等待秒数:demo结构:grid序号（FIGURE_TEMPLATES 顺序 0-11）
# density-map 22s：SF 拉取 + Worker FFT + 38 万三角等值面 marching cubes 紧凑（r72 实测
# 16s 截图会漏网格——密度缩略图无 mesh 实锤后补拍验证的教训）；publication 18s（ray 1920）
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
)

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
  # 2) 工具栏开模板面板 → 按【序号】点目标卡片「应用」（见文件头坑档——
  #    必须收窄到 .mol-scroll .grid + children[idx]，防 DialogContent grid 类污染）
  agent-browser eval "(() => { const b = document.querySelector('button[aria-label*=\"Paper-figure\"], button[aria-label*=\"论文图\"]'); if (!b) return 'NOBTN'; b.click(); return 'panel' })()"
  sleep 1.2
  agent-browser eval "(() => { const grid = document.querySelector('[role=\"dialog\"] .mol-scroll .grid'); if (!grid) return 'NOGRID'; const card = grid.children[$idx]; if (!card) return 'NOCARD'; const demoOk = card.textContent.includes('$demo') ? 'ok' : 'MISMATCH'; const apply = card.querySelector('button[title*=\"Apply to the current structure\"], button[title*=\"应用到当前结构\"]'); if (!apply) return 'NOAPPLY'; apply.click(); return 'applied:' + demoOk })()"
  sleep "$wait"
  # 3) 关面板（面板会挡画布）+ toast 退场；实测 canvas rect（裁剪用）
  agent-browser press Escape >/dev/null 2>&1
  sleep 1.8
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
