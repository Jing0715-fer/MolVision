#!/usr/bin/env bash
# r71 论文图模板缩略图管线（phase-1 截图）
# 路径：欢迎页输入 demo 结构 → 工作台 → 开模板面板 → 点该模板卡片「应用」
# （demo 结构即模板代表结构，场景干净单结构）→ 等命令序列完成 → 截图。
# phase-2（PIL 裁剪 canvas → public/templates/{id}.png）由 crop-thumbs.py 处理。
set -u
export AGENT_BROWSER_SESSION=r71-thumbs
BASE=http://localhost:3000

# 模板id:等待秒数:demo结构
# 模板id:等待秒数:demo结构:grid序号（FIGURE_TEMPLATES 顺序 0-9）
SPECS=(
  rainbow-overview:10:4HHB:0
  chain-assembly:10:4HHB:1
  ss-motif:10:1AKI:2
  ligand-pocket:11:6LU7:3
  sasa-surface:13:4HHB:4
  density-map:16:3EKJ:5
  interface-contacts:11:6LU7:6
  symmetry-assembly:11:1CRN:7
  ensemble-dynamics:10:1D3Z:8
  publication-ready:16:4HHB:9
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
  # 2) 工具栏开模板面板 → 点目标卡片「应用」
  agent-browser eval "(() => { const b = document.querySelector('button[aria-label*=\"Paper-figure\"], button[aria-label*=\"论文图\"]'); if (!b) return 'NOBTN'; b.click(); return 'panel' })()"
  sleep 1.2
  agent-browser eval "(() => { const dlg = document.querySelector('[role=\"dialog\"]'); if (!dlg) return 'NODIALOG'; const card = Array.from(dlg.querySelectorAll('.grid > div')).find(c => c.textContent.includes('$demo')); if (!card) return 'NOCARD'; const apply = card.querySelector('button[title*=\"Apply to the current structure\"], button[title*=\"应用到当前结构\"]'); if (!apply) return 'NOAPPLY'; apply.click(); return 'applied' })()"
  sleep "$wait"
  # 3) 关面板（面板会挡画布）+ toast 退场
  agent-browser press Escape >/dev/null 2>&1
  sleep 1.8
  agent-browser screenshot "/home/z/my-project/public/templates/$id.raw.png" >/dev/null 2>&1
  echo "SHOT $id ($demo)"
}

mkdir -p /home/z/my-project/public/templates
for spec in "${SPECS[@]}"; do
  IFS=':' read -r id wait demo idx <<< "$spec"
  gen_one "$id" "$wait" "$demo" "$idx"
done
echo "== phase-1 done =="
