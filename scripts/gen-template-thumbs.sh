#!/usr/bin/env bash
# r71 创立 · r72 重造 · r76 清洁视口 · r102-b 探针计数与退出码：论文图模板缩略图管线
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

# 模板id:等待秒数:demo结构:grid序号（顺序即 FIGURE_TEMPLATES——见 template-specs.sh）
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
# r87 新增五模板（27-31）：ink-night 11s（深底 + 加宽卡通 + turn）；ballstick 10s（全
# 结构球棍）；stereo 10s（红蓝立体后处理即成）；putty 10s（胖瘦管几何 + bfactor 归一）；
# slab 15s（SASA 表面 worker + 切层封盖——与 sasa 13s 同基线加余量）
# r97 新增九模板（37-45）：风格六连（影院/黑板/马卡龙/双色/棕印/霓虹）即成 10s；
# 教科书 12s（标签 + 取景动画）；核小体 12s（1AOI 1MB 下载 + 核酸谱着色）；GFP 12s（CRO 特写飞行）
# r89 新增五模板（32-36）：wire 10s（线框即成）；grayscale 10s（灰化即成）；electrostatic
# 13s（SASA 表面 worker 基线）；hydration 11s（水 rep 转小球 + orient）；unit-cell 10s
# （CRYST1 盒线框即成）
# r98-f4：SPECS 抽离为 scripts/template-specs.sh 单一事实源（与 health-check 共用；
# 数量与 figure-templates.ts 有 source 时断言强制对齐）——新增模板只改那一份
# shellcheck source=template-specs.sh
source "$(dirname "${BASH_SOURCE[0]}")/template-specs.sh"

# r75：可选增量模式——命令行传模板 id 列表则只生成指定项（缺省全量）
if [ $# -gt 0 ]; then
  SPECS=($(printf '%s\n' "${SPECS[@]}" | while IFS= read -r line; do
    id="${line%%:*}"
    for want in "$@"; do [ "$id" = "$want" ] && echo "$line"; done
  done))
  echo "== filtered mode: ${#SPECS[@]} templates =="
fi
# r99-f3：过滤模式 id 全不匹配时 SPECS 为空——旧版静默跳过全部并照常跑 tighten
# 收尾（假成功语义）；显式报错退出
if [ "${#SPECS[@]}" -eq 0 ]; then
  echo "ERROR: filter matched no template ids (requested: $*) — check against scripts/template-specs.sh" >&2
  exit 1
fi

# r89：高清视口截取（1920×960 → 内容 ~2× 像素）——配合 scripts/tighten-thumbs.py
# 内容感知裁剪 + 降采样到 640×320，消灭小内容上采样软化（r89 VLM 审揭发：
# 默认 944×471 画布下 ~350px 内容放大 1.7× 后发虚）。视口只影响本 session。
agent-browser set viewport 1920 960 >/dev/null 2>&1

# r92：每模板可选视口（SPECS 第 5 字段 vp，如 slab-cutaway:20:4HHB:31:1280x720）——
# 无头 Chrome 走 SwiftShader 软件光栅化，spacefill 2.9M 双面三角 + slab 裁剪在
# 1920×960（1.27M px）下主线程饱和（r92 实测：slab 14 后 eval >120s 无响应、
# 截图捕获残帧=「空心环」伪影）；1280×720 实测响应正常（真 GPU 用户不受影响）。
# 默认仍 1920×960（r89 高清收紧收益），重渲染模板按需降档
gen_one() {
  local id="$1" wait="$2" demo="$3" idx="$4" vp="${5:-}"
  if [ -n "$vp" ]; then
    agent-browser set viewport "${vp%x*}" "${vp#*x}" >/dev/null 2>&1
  else
    agent-browser set viewport 1920 960 >/dev/null 2>&1
  fi
  agent-browser open "$BASE" >/dev/null 2>&1 && sleep 4
  # 1) 欢迎页加载 demo 结构（缩略图取材 = 模板代表结构）
  # 【r87 坑档修复】querySelector('form button[type=submit]') 会命中 DOM 在先的
  # 分享链接粘贴卡表单（r86 新增——空值提交静默 no-op，结构永不上载 → 全量 SKIP）。
  # 根治：从 PDB input 锚定 closest('form') 再取提交钮（r86 worklog 同款判例）
  # r102-b 探针计数（对齐 health-check-templates.sh r99-f3）：eval 返回值捕获判定——
  # 成功值 submitted；NOINPUT/NOBTN/eval 失败空输出计 fails 并打 PROBE-FAIL 行
  # （旧版只打印不计数，空输出被静默放行——旧 stdout 原样回显改为成功静默/失败带
  # id 归因，失败诊断信息量反升）
  local probe
  probe=$(agent-browser eval "(() => { const i = document.querySelector('input[aria-label=\"PDB 编号\"], input[aria-label=\"PDB ID\"]'); if (!i) return 'NOINPUT'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(i, '$demo'); i.dispatchEvent(new Event('input', { bubbles: true })); const btn = i.closest('form')?.querySelector('button[type=\"submit\"]'); if (!btn) return 'NOBTN'; btn.click(); return 'submitted' })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    submitted) ;;
    *) echo "PROBE-FAIL $id (load demo: ${probe:-<no output>})"; fails=$((fails + 1)) ;;
  esac
  sleep 7
  local loaded
  loaded=$(agent-browser eval "window.__molData ? window.__molData.size : 0" 2>/dev/null | tr -d '"')
  # r99-f3：装载判定收紧——旧版只拦 = "0"，eval 失败/超时返回空串或错误文本时被误
  # 当成功走全管线产空图；正整数才算装载成功（与 __molData.size 语义严格对齐）
  if ! [[ "$loaded" =~ ^[1-9][0-9]*$ ]]; then
    echo "SKIP $id (demo $demo not loaded — eval returned: ${loaded:-<empty>})"
    fails=$((fails + 1))
    return 1
  fi
  # 1.5) 收起序列条（194px → ~40px，canvas 增高约 150px，缩略图更聚焦 3D 视口）
  # r102-b 探针计数：成功值 collapsed；NOBAR/NOBTN/空输出计 fails
  probe=$(agent-browser eval "(() => { const bar = document.querySelector('.tape-well'); if (!bar) return 'NOBAR'; const btn = bar.closest('div')?.querySelector('button') || document.querySelector('.tape-well button'); if (!btn) return 'NOBTN'; btn.click(); return 'collapsed' })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    collapsed) ;;
    *) echo "PROBE-FAIL $id (collapse seq bar: ${probe:-<no output>})"; fails=$((fails + 1)) ;;
  esac
  sleep 1
  # r99：+ autoPerf = false——缩略图管线曾长期被自动性能模式静默阉割：SwiftShader
#      低帧率 <15fps 持续 ~3s 即自动关 ssao+outline（降级徽章都不显）——所有
#      AO/描边打磨在截图前已被悄悄拆除（r99 VLM 复鉴「flat」追查实锤；真 GPU
#      用户帧率达标不受影响，autoPerf 对用户端仍是正确行为）
# 1.6) r76 清洁视口（第一遍）：隐藏全部 absolute/fixed 且不含 canvas 的元素 +
  #      关 WebGL 万向轮（右黑框=书签条、左上灰框=HUD 的根治；见文件头说明）
  # r102-b 探针计数：成功前缀 hidden:n（n≥0）；NOVIEW/空输出计 fails
  probe=$(agent-browser eval "(() => { const main = document.querySelector('main'); const canvas = main && main.querySelector('canvas'); if (!main || !canvas) return 'NOVIEW'; let n = 0; const walk = el => { for (const child of el.children) { if (child.contains(canvas)) { walk(child); continue } const cs = getComputedStyle(child); if (cs.position === 'absolute' || cs.position === 'fixed') { child.style.display = 'none'; n++; continue } walk(child) } }; walk(main); if (window.__molEngine && window.__molEngine.settings) { window.__molEngine.settings.showAxes = false; window.__molEngine.settings.autoPerf = false } return 'hidden:' + n })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    hidden:*) ;;
    *) echo "PROBE-FAIL $id (clean viewport pass1: ${probe:-<no output>})"; fails=$((fails + 1)) ;;
  esac
  sleep 0.5
  # 2) 工具栏开模板面板 → 按【序号】点目标卡片「应用」（见文件头坑档——
  #    必须收窄到 .mol-scroll .grid + children[idx]，防 DialogContent grid 类污染）
  # r102-b 探针计数：成功值 panel；NOBTN/空输出计 fails
  probe=$(agent-browser eval "(() => { const b = document.querySelector('button[aria-label*=\"Paper-figure\"], button[aria-label*=\"论文图\"]'); if (!b) return 'NOBTN'; b.click(); return 'panel' })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    panel) ;;
    *) echo "PROBE-FAIL $id (open template panel: ${probe:-<no output>})"; fails=$((fails + 1)) ;;
  esac
  sleep 1.2
  # r102-b 探针计数：成功值 applied:ok——applied:MISMATCH（grid 序号落错卡，规格
  # 漂移）同样计失败：错卡的 apply 已被点击、错误模板渲染仍会写入 $id.png。与
  # health-check 的 clicked:ID-MISMATCH 仅信息性不同（那边断言的模板 id 文本恒不
  # 在卡内，这边断言 demo 结构号必须命中——序号正确时稳态即 ok）
  probe=$(agent-browser eval "(() => { const grid = document.querySelector('[role=\"dialog\"] .mol-scroll .grid'); if (!grid) return 'NOGRID'; const card = grid.children[$idx]; if (!card) return 'NOCARD'; const demoOk = card.textContent.includes('$demo') ? 'ok' : 'MISMATCH'; const apply = card.querySelector('button[title*=\"Apply to the current structure\"], button[title*=\"应用到当前结构\"]'); if (!apply) return 'NOAPPLY'; apply.click(); return 'applied:' + demoOk })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    applied:ok) ;;
    *) echo "PROBE-FAIL $id (apply template card: ${probe:-<no output>})"; fails=$((fails + 1)) ;;
  esac
  sleep "$wait"
  # 3) 关面板（面板会挡画布）+ toast 退场；实测 canvas rect（裁剪用）
  agent-browser press Escape >/dev/null 2>&1
  sleep 1.8
  # 3.5) r76 清洁视口（第二遍）：命令可能新造 overlay（pore 卡/系综条/密度图例）——
  #      截图前再扫一遍（幂等；万向轮设置第一遍已关，此处防重置）
  # r102-b 探针计数：第二遍同计数（成功前缀 hidden:n）——此遍 eval 静默失败会让
  # overlay 入图且无下游兜底（rect 探针只验 canvas 存在与尺寸，不验 overlay 已隐藏）
  probe=$(agent-browser eval "(() => { const main = document.querySelector('main'); const canvas = main && main.querySelector('canvas'); if (!main || !canvas) return 'NOVIEW'; let n = 0; const walk = el => { for (const child of el.children) { if (child.contains(canvas)) { walk(child); continue } const cs = getComputedStyle(child); if (cs.position === 'absolute' || cs.position === 'fixed') { child.style.display = 'none'; n++; continue } walk(child) } }; walk(main); if (window.__molEngine && window.__molEngine.settings) { window.__molEngine.settings.showAxes = false; window.__molEngine.settings.autoPerf = false } return 'hidden:' + n })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    hidden:*) ;;
    *) echo "PROBE-FAIL $id (clean viewport pass2: ${probe:-<no output>})"; fails=$((fails + 1)) ;;
  esac
  sleep 0.5
  agent-browser eval "(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }) })()" > /tmp/r72-canvas.json 2>/dev/null
  # r92 截图重试 + 陈旧防护：无头 Chrome SwiftShader 下重渲染模板（spacefill/slab+cap）
  # 每帧可达数秒——CDP Page.captureScreenshot 超时被旧版 >/dev/null 2>&1 静默吞掉，
  # PIL 便反复裁剪上一轮的陈旧 raw（r92 实锤：slab-cutaway 04:17/04:29 两轮「新图」
  # 全是 03:01 旧环壳的再裁剪）。根治：先删旧 raw，失败可见 + 三次重试（间隔 5s
  # 让渲染追帧），三次全败则 SKIP 该模板而非用残帧伪造
  rm -f "/tmp/r72-$id.raw.png"
  local shot_ok=0
  for attempt in 1 2 3; do
    if agent-browser screenshot "/tmp/r72-$id.raw.png" >/dev/null 2>&1 && [ -s "/tmp/r72-$id.raw.png" ]; then
      shot_ok=1
      break
    fi
    echo "  RETRY shot $id (attempt $attempt failed)"
    sleep 5
  done
  if [ "$shot_ok" = "0" ]; then
    echo "SKIP $id (screenshot failed 3x — render saturation)"
    fails=$((fails + 1))
    return 1
  fi
  # 4) PIL 裁剪 canvas 区 → 640×320 LANCZOS
  python3 - "$id" <<'PY'
import json, sys
from PIL import Image
tid = sys.argv[1]
raw = open('/tmp/r72-canvas.json').read().strip()
# r98-f4：rect 缺失/损坏显式失败（旧版 json.loads('') 直接崩且无 set -e——
# 外层继续 echo SHOT 假成功，缩略图静默缺失由旧图顶包）
if not raw:
    print(f'RECTFAIL {tid} (canvas rect eval empty)')
    sys.exit(1)
# agent-browser eval 输出带 shell 引号壳（'"{\"x\":..}"'）——剥壳后再 parse
if raw.startswith('"'):
    raw = json.loads(raw)
try:
    rect = json.loads(raw) if isinstance(raw, str) else raw
    assert rect.get('w', 0) > 50 and rect.get('h', 0) > 50, f"canvas-tiny {rect.get('w')}x{rect.get('h')}"
except Exception as exc:
    print(f'RECTFAIL {tid} ({exc})')
    sys.exit(1)
im = Image.open(f'/tmp/r72-{tid}.raw.png').convert('RGB')
im = im.crop((rect['x'], rect['y'], rect['x'] + rect['w'], rect['y'] + rect['h']))
im = im.resize((640, 320), Image.LANCZOS)
im.save(f'/home/z/my-project/public/templates/{tid}.png')
print(f'CROP {tid} canvas={rect["w"]}x{rect["h"]}')
PY
  python_ok=$?
  # r98-f4：PIL 裁剪失败（rect 缺失/canvas 过小）不再假成功——SHOT 只在真落盘后打
  if [ "$python_ok" = "0" ] && [ -s "/home/z/my-project/public/templates/$id.png" ]; then
    echo "SHOT $id ($demo idx=$idx)"
  else
    echo "RECTFAIL-CAUGHT $id (crop skipped — see above)"
    fails=$((fails + 1))
    return 1
  fi
}

# r102-b 退出码语义（对齐 health-check-templates.sh r99-f3 / smoke.sh）——旧行为：
# 五处 eval 探针只打印不计数、gen_one 返回值无人聚合，脚本恒 exit 0（除空 SPECS
# 守卫）——apply 探针失败（含 applied:MISMATCH 落错卡）可产出错误内容缩略图仍报
# 成功。现六调用点探针（submitted/collapsed/hidden:n×2/panel/applied:ok）非成功
# 值计 fails 并打 PROBE-FAIL 行；SKIP/RECTFAIL 亦计数（gen_one 内直接自增而非循环
# 聚合返回值——探针失败与下游 SKIP 可对同一根因各计一次，health-check r99-f3 同款
# 容许，退出语义只看非零）；结尾非零退出供 CI 拦截
fails=0
for spec in "${SPECS[@]}"; do
  IFS=':' read -r id wait demo idx vp <<< "$spec"
  gen_one "$id" "$wait" "$demo" "$idx" "$vp"
done

# r89：内容感知收紧（bbox 检测 + 裁剪 + 16:10 重排）——管线产出后自动跑一遍，
# 消灭「分子在画布里只占 24-76%」的展示卡取景问题（详见 tighten-thumbs.py 头注）
# r104 作用域化：过滤模式把本轮 id 透传给 tighten——旧图免重采样漂移（全量
# tighten 对已收紧旧图做裁剪 + LANCZOS 往返，单轮 5-13% 边缘像素漂移累积）
python3 "$(dirname "$0")/tighten-thumbs.py" "$@"
echo "== phase done =="
# r102-b 退出码语义——非零退出供 CI 拦截（输出格式不变；tighten 收尾阶段失败
# 不在本轮口径内，沿用既有静默行为——探针/SKIP/RECTFAIL 已全覆盖产出正确性）
[[ $fails -eq 0 ]] || exit 1
