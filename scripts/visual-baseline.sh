#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# visual-baseline.sh —— E2E 视觉回归基线（r104-b / r103 建议①：像素 diff 哨兵）
#
# 用途：与 guards（grep 级）/ smoke（主线程响应级）并列的「渲染面回归」防线——
#       膜错位（r92 事故）/模板变色/表示法丢失等只有真实截图才能判定的回归，
#       由 screenshot 像素对比基线捕捉（VLM 复鉴有 429 限流，像素 diff 更适合 CI）。
#
# 用法：
#   bash scripts/visual-baseline.sh capture   拍基线：每场景截图存
#                                           scripts/visual-baselines/<场景>.png（入 git）
#   bash scripts/visual-baseline.sh check     重拍每场景与基线 PIL 逐像素比对，
#                                           输出每场景 PASS/FAIL + 漂移百分比，
#                                           任一 FAIL 即 exit 1（CI 可直接拦截）
#   无参 → 打印用法并 exit 1；check 发现基线缺失 → 该场景 FAIL 并提示先 capture。
#
# 【场景操作路径选型（r104-b live 实证，勿凭直觉改路径）】
# 结构装载：欢迎页 PDB 输入（input[aria-label="PDB 编号"/"PDB ID"] + closest('form')
#   提交钮；React 受控输入必须 native setter + input 事件）——gen-template-thumbs
#   成熟范式整段借鉴。
# 命令执行（membrane 32 / figure rainbow-overview）：**无 window 级命令执行钩子**
#   （实证：window 只挂 __molData 数据注册表 + __molEngine 引擎实例两枚 QA 钨子，
#   runCommand 是 commands.ts 模块函数、不暴露 window）→ 走控制台输入行 UI 路径：
#   ① MolViewer.tsx window 级 Backquote 键位（keydown case 分支 toggle consoleOpen，
#     与 r102 E2E 的 L 键 window.dispatchEvent(KeyboardEvent) 同模式）开/关命令行
#     ——JS 侧用 String.fromCharCode(96) 合成该键字面量（bash 命令串禁反引号，
#     网关过滤 + 引号双层坑，见 worklog 编辑纪律）；
#   ② 输入行定位 input[placeholder^="load 4hhb"]（ConsoleBar 硬编码非本地化
#     placeholder——中英文界面同值，全 DOM 最稳的 selector）；
#   ③ 提交 = native setter + input 事件 + 输入行上派发 Enter keydown（React 19
#     根节点委托监听可收到冒泡原生事件）——live 实证：figure rainbow-overview →
#     __molEngine.settings.background=#ffffff；membrane 32 →
#     __molEngine.membraneGroup.children=5、membraneBox 非空。
#   膜场景不用 M 键（M 切默认厚度 34 的 showMembrane；本场景要 membrane 32 的
#   命令语义与厚度）；模板场景用 figure 直达命令（commands.ts 与模板面板卡片
#   同走 adaptTemplateCommands → runTemplateCommands 执行器；面板 UI 路径已由
#   gen-template-thumbs 52 张缩略图管线覆盖，本哨兵补的是命令执行器分支）。
#
# 【确定性保障】
#   视口 1280×800（无头 Chrome SwiftShader 软光栅负载降档——r92 先例：1920×960
#   下重渲染模板可饿死主线程）；场景操作后按 SCENES 数组秒数 sleep 等动画/着色/
#   膜构建落地；截图前清洁视口两遍（隐藏 main 下 absolute/fixed 且不含 canvas 的
#   元素 + __molEngine.settings.showAxes=false + autoPerf=false——r99 实锤
#   SwiftShader 低帧率下 autoPerf 会静默拆 ssao/outline 降级）+ 收起序列条 +
#   关闭命令行；canvas getBoundingClientRect 实测 + PIL 裁剪（只比 3D 视口，
#   裁掉 DOM 噪音）；截图三败重试（r92 陈旧帧防护——先删旧 raw 再拍，防 PIL
#   反复裁剪上一轮残帧伪造新图）。
#
# 【比对算法与阈值（r104-b 首版经验值，改值须同步 regression-guards 守卫）】
#   PIL ImageChops.difference（RGB 逐通道绝对差）→ convert('L') 灰度 →
#   ① 变化像素占比：灰度差 > 12/255 的像素（直方图 bins 13..）占比
#   ② 平均绝对差：全像素灰度差均值（0-255 尺度）
#   FAIL 判定：占比 > 1.5% 或 均值 > 2.0/255。
#   依据：同环境重拍的固有噪声 = WebGL 抗锯齿时序抖动——集中分子轮廓边缘、
#   幅度数个灰阶、面占比 <1%（capture→check 同环境重拍实证校准）；真实渲染面
#   回归（膜错位/模板变色/表示法丢失）= 数十灰阶 × >5% 像素面——两者差一个数量
#   级，1.5%/2.0 取分离带内偏噪声侧（宁漏报不误报；负例实验数据见 worklog r104-b）。
#
# 前置：dev server 已在 localhost:3000 运行；agent-browser 已安装；PIL 已装
#      （scripts/tighten-thumbs.py 先例）。
# 退出码：0 = 全过；1 = 前置不满足 / 任一场景 FAIL / 用法错误。
# -----------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:3000}"
export AGENT_BROWSER_SESSION="visual-baseline"   # 固定独立会话，不碰其他代理的浏览器管线
BL_DIR="$(pwd)/scripts/visual-baselines"
CANVAS_JSON="/tmp/visual-baseline-canvas.json"

# ---- 模式分发（无参 → 用法 + exit 1） ----
MODE="${1:-}"
if [ "$MODE" != "capture" ] && [ "$MODE" != "check" ]; then
  echo "用法：bash scripts/visual-baseline.sh capture|check"
  echo "  capture —— 拍摄基线：每场景截图存 scripts/visual-baselines/<场景>.png（基线入 git）"
  echo "  check   —— 重拍每场景与基线 PIL 逐像素比对（默认门禁模式），任一 FAIL 即 exit 1"
  exit 1
fi

# ---- 场景集（r104-b 起步 3 个；格式 name:wait:操作类型:参数） ----
#   wait = 操作完成后的等待秒数；操作类型 load = 装载即场景 /
#   load+cmd = 装载后执行控制台命令（参数 PDB|命令）/
#   template = 装载 demo 结构（4HHB，与 template-specs.sh rainbow-overview 条目
#   同源）后 figure 直达应用模板（参数 = 模板 id）
SCENES=(
  "home-cartoon:8:load:4HHB"                          # 欢迎页上载后默认卡通——最基础回归面
  "membrane-toggle:14:load+cmd:1FX8|membrane 32"      # 膜渲染回归面（r92 膜错位事故场景）
  "template-rainbow:16:template:rainbow-overview"     # 模板执行器回归面（全命令序列）
)

FAILS=0
TOTAL=0
pass() { printf 'PASS  %s\n' "$1"; TOTAL=$((TOTAL + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); TOTAL=$((TOTAL + 1)); }

# ---- 前置：dev server 存活（smoke.sh 同款；纯打印不计数——TOTAL 只数场景） ----
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/" 2>/dev/null || echo "000")
if [ "$code" != "200" ]; then
  echo "FAIL  dev server 未就绪：curl $BASE_URL/ → HTTP ${code}（请先 bun run dev）"
  exit 1
fi
printf 'PASS  %s\n' "dev server 存活（$BASE_URL/ → HTTP 200）"

# ---- 清残留会话（保证 console 错误缓冲区与页面态干净），固定视口 ----
agent-browser close >/dev/null 2>&1 || true
sleep 1   # 等 daemon 收尾，防 close→open 重启竞态（smoke.sh 实测偶发）
agent-browser set viewport 1280 800 >/dev/null 2>&1
mkdir -p "$BL_DIR"

# =============================================================================
# 控制台命令执行（路径选型见文件头【场景操作路径选型】——三段式 eval）
# =============================================================================
# 开命令行（若未开）：MolViewer window 级 Backquote 键位 toggle consoleOpen。
# JS 用 String.fromCharCode(96) 合成键字面量——bash 命令串禁反引号
open_console() {
  local probe
  probe=$(agent-browser eval "(() => { const inp = document.querySelector('input[placeholder^=\"load 4hhb\"]'); if (inp) return 'already-open'; window.dispatchEvent(new KeyboardEvent('keydown', { key: String.fromCharCode(96) })); return 'opened' })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    opened|already-open) return 0 ;;
    *) echo "PROBE-FAIL $1 (open console: ${probe:-<no output>})"; return 1 ;;
  esac
}

# 关命令行（若开着）：同一键位再 toggle（截图前确定性 DOM 状态；清洁视口遍历
# 也会隐藏它，这里显式关是双保险）
close_console() {
  local probe
  probe=$(agent-browser eval "(() => { const inp = document.querySelector('input[placeholder^=\"load 4hhb\"]'); if (!inp) return 'already-closed'; window.dispatchEvent(new KeyboardEvent('keydown', { key: String.fromCharCode(96) })); return 'closed' })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    closed|already-closed) return 0 ;;
    *) echo "PROBE-FAIL $1 (close console: ${probe:-<no output>})"; return 1 ;;
  esac
}

# 提交命令：React 受控输入 native setter + input 事件（gen-template-thumbs 同款）
# + 输入行派发 Enter keydown（冒泡到 React 根委托监听 → ConsoleBar onKeyDown）
submit_console_cmd() {
  local name="$1" cmd="$2" probe
  probe=$(agent-browser eval "(() => { const inp = document.querySelector('input[placeholder^=\"load 4hhb\"]'); if (!inp) return 'NOINPUT'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(inp, '$cmd'); inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); return 'submitted' })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    submitted) return 0 ;;
    *) echo "PROBE-FAIL $name (submit cmd '$cmd': ${probe:-<no output>})"; return 1 ;;
  esac
}

run_console_cmd() {
  local name="$1" cmd="$2"
  open_console "$name" || return 1
  sleep 1   # 等 consoleOpen 状态落地渲染输入行（React 批量更新异步提交）
  submit_console_cmd "$name" "$cmd" || return 1
}

# PIL 裁剪 canvas rect（gen-template-thumbs r72 管线同款）+ 空白哨兵
# （stddev < 2 判空白——防「基线拍成纯背景色」静默入 git；正常分子渲染边缘
# 众多，stddev 远大于 2）。capture 存基线；check 存 /tmp 供比对。
crop_scene() {
  python3 - "$1" "$MODE" "$BL_DIR" <<'PY'
import json, sys
from PIL import Image, ImageStat
name, mode, base_dir = sys.argv[1], sys.argv[2], sys.argv[3]
raw = open('/tmp/visual-baseline-canvas.json').read().strip()
# r98-f4 同款：rect 缺失/损坏显式失败（json.loads('') 直接崩且无兜底——假成功）
if not raw:
    print(f'RECTFAIL {name} (canvas rect eval empty)')
    sys.exit(1)
# agent-browser eval 输出带 shell 引号壳（'"{\"x\":..}"'）——剥壳后再 parse
if raw.startswith('"'):
    raw = json.loads(raw)
try:
    rect = json.loads(raw) if isinstance(raw, str) else raw
    assert rect.get('w', 0) > 50 and rect.get('h', 0) > 50, f"canvas-tiny {rect.get('w')}x{rect.get('h')}"
except Exception as exc:
    print(f'RECTFAIL {name} ({exc})')
    sys.exit(1)
im = Image.open(f'/tmp/visual-baseline-{name}.raw.png').convert('RGB')
im = im.crop((rect['x'], rect['y'], rect['x'] + rect['w'], rect['y'] + rect['h']))
std = ImageStat.Stat(im.convert('L')).stddev[0]
if std < 2:
    print(f'BLANK {name} (stddev {std:.2f} < 2 —— canvas 无内容，截图管线或渲染失效)')
    sys.exit(1)
out = f'{base_dir}/{name}.png' if mode == 'capture' else f'/tmp/visual-baseline-{name}.png'
im.save(out)
print(f'canvas={rect["w"]}x{rect["h"]} stddev={std:.1f}')
PY
}

# 像素比对（check 模式）：退出码 0 = PASS；非 0 = FAIL（详情经 stdout 带回）
compare_baseline() {
  python3 - "$1" "$BL_DIR" <<'PY'
import os, sys
from PIL import Image, ImageChops, ImageStat
name, base_dir = sys.argv[1], sys.argv[2]
base_p = f'{base_dir}/{name}.png'
cur_p = f'/tmp/visual-baseline-{name}.png'
if not os.path.exists(base_p):
    print(f'基线缺失——先跑 bash scripts/visual-baseline.sh capture 建立（{base_p}）')
    sys.exit(1)
a = Image.open(base_p).convert('RGB')
b = Image.open(cur_p).convert('RGB')
if a.size != b.size:
    print(f'画布尺寸漂移：基线 {a.size[0]}x{a.size[1]} vs 当前 {b.size[0]}x{b.size[1]}（布局回归或清洁视口/收条失败）')
    sys.exit(1)
# RGB 逐通道绝对差 → 灰度（0.299R+0.587G+0.114B 加权）
diff = ImageChops.difference(a, b).convert('L')
mean = ImageStat.Stat(diff).mean[0]
hist = diff.histogram()
total = a.size[0] * a.size[1]
changed = sum(hist[13:])   # 灰度差 > 12/255 的像素（bins 13..255）
pct = 100.0 * changed / total
# 阈值依据见文件头【比对算法与阈值】——改值须同步 regression-guards 守卫锚
if pct > 1.5 or mean > 2.0:
    print(f'像素漂移 {pct:.2f}% / 平均差 {mean:.2f}/255（阈 1.5% / 2.0）——渲染面回归（当前截图留档 {cur_p}）')
    sys.exit(1)
print(f'像素漂移 {pct:.2f}% / 平均差 {mean:.2f}/255（阈 1.5% / 2.0）')
PY
}

# =============================================================================
# 单场景执行（探针失败 → PROBE-FAIL 归因行 + return 1；计数留给主循环——
# 函数内命令替换是子壳边界，fails 自增会丢，r102-b 坑①判例）
# =============================================================================
run_scene() {
  local name="$1" wait="$2" op="$3" params="$4"
  local probe loaded pdb cmd

  # 场景结构装载目标
  case "$op" in
    load) pdb="$params" ;;
    load+cmd) pdb="${params%%|*}" ;;
    template) pdb="4HHB" ;;   # rainbow-overview demo（template-specs.sh 同源）
    *) echo "PROBE-FAIL $name (unknown op: $op)"; return 1 ;;
  esac

  echo "-- [$MODE] $name（op=$op pdb=$pdb）"
  agent-browser set viewport 1280 800 >/dev/null 2>&1
  agent-browser open "$BASE_URL" >/dev/null 2>&1
  sleep 4   # 等水合与首屏渲染稳定

  # 1) 欢迎页装载结构（gen-template-thumbs 同款范式：PDB input 锚定 closest form）
  probe=$(agent-browser eval "(() => { const i = document.querySelector('input[aria-label=\"PDB 编号\"], input[aria-label=\"PDB ID\"]'); if (!i) return 'NOINPUT'; const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; setter.call(i, '$pdb'); i.dispatchEvent(new Event('input', { bubbles: true })); const btn = i.closest('form')?.querySelector('button[type=\"submit\"]'); if (!btn) return 'NOBTN'; btn.click(); return 'submitted' })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    submitted) ;;
    *) echo "PROBE-FAIL $name (load form: ${probe:-<no output>})"; return 1 ;;
  esac
  # 装载判定：__molData.size 正整数才算成功（r99-f3 收紧口径——空串/错误文本不算）
  sleep 8
  loaded=$(agent-browser eval "window.__molData ? window.__molData.size : 0" 2>/dev/null | tr -d '"')
  if ! [[ "$loaded" =~ ^[1-9][0-9]*$ ]]; then
    sleep 5   # 有界宽限重试一次（RCSB 网络抖动）
    loaded=$(agent-browser eval "window.__molData ? window.__molData.size : 0" 2>/dev/null | tr -d '"')
  fi
  if ! [[ "$loaded" =~ ^[1-9][0-9]*$ ]]; then
    echo "PROBE-FAIL $name (structure $pdb not loaded — __molData.size=${loaded:-<empty>})"
    return 1
  fi

  # 2) 收起序列条（194px → ~40px，canvas 增高聚焦 3D 视口——gen-template-thumbs 同款）
  probe=$(agent-browser eval "(() => { const bar = document.querySelector('.tape-well'); if (!bar) return 'NOBAR'; const btn = bar.closest('div')?.querySelector('button') || document.querySelector('.tape-well button'); if (!btn) return 'NOBTN'; btn.click(); return 'collapsed' })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    collapsed) ;;
    *) echo "PROBE-FAIL $name (collapse seq bar: ${probe:-<no output>})"; return 1 ;;
  esac
  sleep 1

  # 3) 清洁视口第一遍 + 关 autoPerf（必须在场景命令【前】——r99：SwiftShader 低帧率
  #    <15fps 持续 ~3s 即自动关 ssao+outline，模板里的 ssao on 会被悄悄拆除）
  probe=$(agent-browser eval "(() => { const main = document.querySelector('main'); const canvas = main && main.querySelector('canvas'); if (!main || !canvas) return 'NOVIEW'; let n = 0; const walk = el => { for (const child of el.children) { if (child.contains(canvas)) { walk(child); continue } const cs = getComputedStyle(child); if (cs.position === 'absolute' || cs.position === 'fixed') { child.style.display = 'none'; n++; continue } walk(child) } }; walk(main); if (window.__molEngine && window.__molEngine.settings) { window.__molEngine.settings.showAxes = false; window.__molEngine.settings.autoPerf = false } return 'hidden:' + n })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    hidden:*) ;;
    *) echo "PROBE-FAIL $name (clean viewport pass1: ${probe:-<no output>})"; return 1 ;;
  esac
  sleep 0.5

  # 4) 场景操作（load = 装载即场景，默认卡通）
  case "$op" in
    load) ;;
    load+cmd)
      cmd="${params#*|}"
      run_console_cmd "$name" "$cmd" || return 1
      ;;
    template)
      run_console_cmd "$name" "figure $params" || return 1
      ;;
  esac
  sleep "$wait"   # 场景数组里的等待秒数：动画/着色/膜构建/toast 退场全落地

  # 5) 操作效果探针（命令「已提交」≠「已生效」——膜/模板各自的渲染态证据）
  if [ "$op" = "load+cmd" ]; then
    probe=$(agent-browser eval "window.__molEngine && window.__molEngine.membraneGroup ? 'membrane:' + window.__molEngine.membraneGroup.children.length : 'no-engine'" 2>/dev/null | tr -d '"')
    case "$probe" in
      membrane:[1-9]*) ;;   # r103 E2E 口径：上膜 = membraneGroup children 5
      *) echo "PROBE-FAIL $name (membrane effect: ${probe:-<no output>}——膜板未构建)"; return 1 ;;
    esac
  fi
  if [ "$op" = "template" ]; then
    probe=$(agent-browser eval "window.__molEngine && window.__molEngine.settings ? String(window.__molEngine.settings.background) : 'no-engine'" 2>/dev/null | tr -d '"')
    if [ "$probe" != "#ffffff" ]; then
      echo "PROBE-FAIL $name (template effect: bg=${probe:-<no output>} 非 #ffffff——figure 命令序列未执行完)"
      return 1
    fi
  fi

  # 6) 关命令行（若开着）——截图前确定性 DOM 状态
  if [ "$op" != "load" ]; then
    close_console "$name" || return 1
    sleep 0.8
  fi

  # 7) 清洁视口第二遍（幂等；命令可能新造 overlay，截图前再扫一遍——r76 双遍范式）
  probe=$(agent-browser eval "(() => { const main = document.querySelector('main'); const canvas = main && main.querySelector('canvas'); if (!main || !canvas) return 'NOVIEW'; let n = 0; const walk = el => { for (const child of el.children) { if (child.contains(canvas)) { walk(child); continue } const cs = getComputedStyle(child); if (cs.position === 'absolute' || cs.position === 'fixed') { child.style.display = 'none'; n++; continue } walk(child) } }; walk(main); if (window.__molEngine && window.__molEngine.settings) { window.__molEngine.settings.showAxes = false; window.__molEngine.settings.autoPerf = false } return 'hidden:' + n })()" 2>/dev/null | tr -d '"')
  case "$probe" in
    hidden:*) ;;
    *) echo "PROBE-FAIL $name (clean viewport pass2: ${probe:-<no output>})"; return 1 ;;
  esac
  sleep 0.5

  # 8) canvas rect 实测（裁剪用——不硬编码）
  agent-browser eval "(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }) })()" > "$CANVAS_JSON" 2>/dev/null

  # 9) 截图三败重试（r92：先删旧 raw 防 PIL 裁剪陈旧残帧伪造新图）
  rm -f "/tmp/visual-baseline-$name.raw.png"
  local shot_ok=0 attempt
  for attempt in 1 2 3; do
    if agent-browser screenshot "/tmp/visual-baseline-$name.raw.png" >/dev/null 2>&1 && [ -s "/tmp/visual-baseline-$name.raw.png" ]; then
      shot_ok=1
      break
    fi
    echo "  RETRY shot $name (attempt $attempt failed)"
    sleep 5
  done
  if [ "$shot_ok" = "0" ]; then
    echo "PROBE-FAIL $name (screenshot failed 3x — render saturation)"
    return 1
  fi

  # 10) PIL 裁剪 + 空白哨兵（capture 存基线 / check 存 /tmp）
  local info
  info=$(crop_scene "$name")
  if [ $? -ne 0 ]; then
    echo "PROBE-FAIL $name (crop: $info)"
    return 1
  fi
  echo "  · $name $info"
}

# =============================================================================
# 主循环
# =============================================================================
echo "== MolVision 视觉回归基线（r104-b 像素 diff 哨兵）· mode: $MODE =="

for spec in "${SCENES[@]}"; do
  IFS=':' read -r name wait op params <<< "$spec"
  if run_scene "$name" "$wait" "$op" "$params"; then
    if [ "$MODE" = "capture" ]; then
      pass "$name：基线已拍摄（scripts/visual-baselines/$name.png · $(stat -c%s "$BL_DIR/$name.png" 2>/dev/null || echo '?') bytes）"
    else
      detail=$(compare_baseline "$name")
      if [ $? -eq 0 ]; then
        pass "$name：$detail"
      else
        fail "$name：$detail"
      fi
    fi
  else
    fail "$name：场景执行失败（见上方 PROBE-FAIL 归因行）——基线未产出/未比对"
  fi
done

# ---- 收尾：关闭哨兵会话（4GB 沙箱内存纪律——不留常驻浏览器） ----
agent-browser close >/dev/null 2>&1 || true

# ---- 汇总（CI 退出码：0 = 全过；1 = 任一场景 FAIL） ----
if [ "$FAILS" -eq 0 ]; then
  if [ "$MODE" = "capture" ]; then
    echo "== 结果：PASS（$TOTAL/$TOTAL 场景基线已拍摄——git add scripts/visual-baselines/ 入库） =="
  else
    echo "== 结果：PASS（$TOTAL/$TOTAL 场景与基线像素一致） =="
  fi
  exit 0
else
  echo "== 结果：FAIL（$FAILS/$TOTAL 场景失败——渲染面回归或管线故障，见上方归因行） =="
  exit 1
fi
