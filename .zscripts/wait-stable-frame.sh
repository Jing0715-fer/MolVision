#!/usr/bin/env bash
# wait-stable-frame.sh —— r112-c：E2E 截图断言前的「渲染稳定帧」等待工具
#
# 背景（r111 坑①，40 分钟排查教训）：异步派生渲染（口袋表面/接触着色等后台计算）
# 落屏前的中间态会被拍进截图——「基线拍早」产生恒定假差异，且复拍不复现（下一轮
# 已落屏）导致误判「间歇性回归」。判定法（r111 实测口径）：now-vs-cleared ≈ 0 则
# cleared 即终态；活跃落屏差异在 3-5.8% 量级、终态噪声 0.12% 量级——差一个数量级，
# 容差默认 0.15% 取分离带内偏噪声侧（与 visual-baseline 阈值同哲学）。
#
# 用法：bash .zscripts/wait-stable-frame.sh [轮数] [间隔秒] [容差%] [--canvas-aria <模式>]
#   默认：6 轮 × 2s × 0.15%（agent-browser 截图单张实测 ~5s：每轮 2 张+间隔 ≈12s，
#   6 轮 ≈72s——单次 Bash 调用 ≤90s 铁律内（r112-a 坑：>~240s 长等待致 MCP 网关
#   断连永久失会话）；需要更长耐心则分多次调用——STABLE 通常 2-4 轮内到达
#   （派生计算 ~15s 落屏，r111 实测））
#   --canvas-aria <模式>（r118-c，r117 建议⑤收口）：按 aria-label 子串精选 canvas
#   （不区分大小写）——显式指定即权威：未匹配任何画布时 PIPE-FAIL 诚实退出，
#   **不静默回退最大面积**（回退会把错抓伪装成通过——与哨兵哲学同款）。不指定时
#   维持 r117-a 最大面积择优。多 3D 视口场景或拉马散点等辅助画布干扰时的显式
#   覆盖入口；被测页需先给目标 canvas 补 aria-label（MolVision 的 3D 视口已随
#   r118-c 补「3D 分子视口 / 3D molecular viewport」——模式「3d」双语文案均可命中）。
#   退出码：0 = STABLE（打印到达轮数与实测漂移）；1 = UNSTABLE（超轮数——派生
#           计算未落屏或存在持续动画，如实排查勿硬拍基线）；2 = 管线故障
#           （canvas 缺失 / aria 未匹配 / 截图三败 / 空白哨兵）；3 = Python 比对
#           异常（rect 壳剥取失败等——与 UNSTABLE 严格区分，防「崩溃假报不稳定」）
# 前置：agent-browser 会话已打开且页面处于被测状态。本工具不动 DOM——视口清洁由
#   调用方负责（G1 类测试 agent 面板本就是断言上下文不可隐藏）；比对算法与
#   visual-baseline 同源（灰度差 > 12/255 计变化像素——bins 13..）。
#   r117-a 探针修复（r116 坑②，建议①收口）：①canvas 精选改「最大面积」——querySelector
#   首个在拉马节/报告图等辅助 canvas 渲染后会错抓小画布（拉马散点 232×224 vs 3D 视口
#   944×311），且小画布滚出视口时 rect 落在屏外→空白哨兵误报；②rect 每轮现取——
#   /tmp rect 缓存跨布局陈旧（异步内容落屏推挤布局后，旧 rect 裁剪到错误区域）；
#   同轮内两截图间布局不动仍是稳定帧语义的一部分（轮内探一次，轮间重探）。
#   r112 首测根修：rect 探针输出**不剥引号**直接落盘（tr -d '"' 会把 JSON 内部引号
#   一并剥掉 → json.loads 崩 → 漂移恒空假 UNSTABLE）；Python 体整体 try/except
#   → 异常 exit 3 与真实 UNSTABLE（exit 1）严格分流。
#   r112 G1 实测二修（渲染活性守卫）：SwiftShader 重场景 tick 间隔实测 4-8s——
#   间隔内零新帧时 0.000% 是同帧假稳定；两截图间须关住 ≥1 次 perfLastT 推进
#   （STALE-FRAME 分支继续轮询；引擎钩子缺失时退化纯像素判定）。
set -u
ROUNDS="${1:-6}"
INTERVAL="${2:-2}"
TOL="${3:-0.15}"
# r118-c：--canvas-aria <模式>（第 4/5 位可选参数）——显式 aria-label 子串精选
ARIA_PATTERN=''
if [ "${4:-}" = '--canvas-aria' ]; then
  ARIA_PATTERN="${5:-}"
fi

RAW1='/tmp/wsf-a.raw.png'
RAW2='/tmp/wsf-b.raw.png'
RECT_JSON='/tmp/wsf-canvas.json'

rect_probe () {
  # 注意：不做任何引号剥离——agent-browser 的 shell 引号壳由 Python 侧 startswith('"')
  # 分支统一处理（visual-baseline crop_scene 同款）；bash 侧 tr -d '"' 会连带剥掉
  # JSON 内部引号致解析崩（r112 首测根修）。
  # r117-a：最大面积 canvas 精选（r116 坑②）——拉马散点图等辅助 canvas 先于 3D 视口
  # 出现在 DOM 时，querySelector 首个会错抓；面积最大者恒为 3D 视口（辅助画布均小）。
  # 返回附 canvas 数 n 供诊断（Python 侧只取 x/y/w/h，多余键无感）。
  # r118-c：--canvas-aria 在场时优先按 aria-label 子串精选（不区分大小写；未匹配
  # 返回 NOMATCH——调用方诚实退出，不静默回退最大面积）；模式串经反斜杠/单引号
  # 双重转义注入 JS 字符串字面量。
  local js
  if [ -n "$ARIA_PATTERN" ]; then
    local esc
    esc=$(printf '%s' "$ARIA_PATTERN" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g")
    js="(() => { const cs = [...document.querySelectorAll('canvas')]; if (!cs.length) return 'NOCANVAS'; const pat = '${esc}'.toLowerCase(); const best = cs.find(c => (c.getAttribute('aria-label') || '').toLowerCase().includes(pat)); if (!best) return 'NOMATCH'; const r = best.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), n: cs.length, m: 'aria' }) })()"
  else
    js="(() => { const cs = [...document.querySelectorAll('canvas')]; if (!cs.length) return 'NOCANVAS'; let best = null, ba = -1; for (const c of cs) { const r = c.getBoundingClientRect(); const a = r.width * r.height; if (a > ba) { ba = a; best = c } } const r = best.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), n: cs.length }) })()"
  fi
  agent-browser eval "$js" 2>/dev/null
}

# 三败重试截图（r92 陈旧帧防护同款——先删旧再拍，防重拍返回上一轮残帧）
shot () {
  local p="$1" attempt
  rm -f "$p"
  for attempt in 1 2 3; do
    if agent-browser screenshot "$p" >/dev/null 2>&1 && [ -s "$p" ]; then return 0; fi
    sleep 2
  done
  return 1
}

probe=$(rect_probe)
case "$probe" in
  *NOCANVAS*|'') echo "PIPE-FAIL canvas 缺失（agent-browser 会话未开或页面无 3D 视口）"; exit 2 ;;
  *NOMATCH*) echo "PIPE-FAIL aria 未匹配（--canvas-aria '${ARIA_PATTERN}'：现有 canvas 的 aria-label 均不含该子串——显式指定即权威，不回退最大面积；先给目标画布补 aria-label）"; exit 2 ;;
esac
# r117-a：rect 每轮现取（r116 坑②）——旧版循环前探一次写入 RECT_JSON 后复用，
# 异步内容落屏推挤布局后旧 rect 裁剪错区域（空白哨兵/假漂移双风险）。首轮落盘后
# 每轮开头重探重写；轮内两截图间不重探（布局不动是稳定帧语义的一部分）。
printf '%s' "$probe" > "$RECT_JSON"

# r112 G1 实测根修（渲染活性守卫）：SwiftShader 重场景 tick 间隔实测 4-8s（0.12-0.25fps）
# ——两截图间隔内可能零新帧渲染，「0.000% 漂移」实为同一陈旧帧的假稳定（r111 异步落屏
# 坑的慢渲染变体：工具首测 STABLE 第 1 轮假通过，真派生变更在后续 25s 窗口落地成 8.15%
# 单向漂移）。守卫：两截图须关住至少一次引擎 tick 推进（perfLastT 前后不同）——零新帧
# 的 0.000% 无意义，继续轮询。引擎钩子缺失（非 MolVision 页）时退化为纯像素判定。
engine_tick () {
  agent-browser eval "window.__molEngine && window.__molEngine.perfLastT ? window.__molEngine.perfLastT : 0" 2>/dev/null | tr -cd '0-9.'
}

round=1
while [ "$round" -le "$ROUNDS" ]; do
  # r117-a：每轮现取 rect（首轮已在上方落盘；此句对首轮是幂等重探）——跨轮布局
  # 变化（异步派生内容落屏推挤/面板开闭）后裁剪区域始终对准当前最大面积 canvas。
  if [ "$round" -gt 1 ]; then
    probe=$(rect_probe)
    case "$probe" in
      *NOCANVAS*|'') echo "PIPE-FAIL canvas 消失（第 ${round} 轮重探——页面被导航/画布被卸载）"; exit 2 ;;
      *NOMATCH*) echo "PIPE-FAIL aria 失配（第 ${round} 轮重探：--canvas-aria '${ARIA_PATTERN}' 不再匹配——目标画布被卸载或 aria-label 变更）"; exit 2 ;;
    esac
    printf '%s' "$probe" > "$RECT_JSON"
  fi
  tick_a=$(engine_tick)
  if ! shot "$RAW1"; then echo "PIPE-FAIL 截图三败（$RAW1）"; exit 2; fi
  sleep "$INTERVAL"
  if ! shot "$RAW2"; then echo "PIPE-FAIL 截图三败（$RAW2）"; exit 2; fi
  tick_b=$(engine_tick)
  verdict=$(python3 - "$TOL" "$tick_a" "$tick_b" <<'PY'
import json, sys, traceback
try:
    from PIL import Image, ImageChops, ImageStat
    tol = float(sys.argv[1])
    tick_a, tick_b = sys.argv[2], sys.argv[3]
    raw = open('/tmp/wsf-canvas.json').read().strip()
    # agent-browser eval 输出带 shell 引号壳（visual-baseline crop_scene 同款剥壳）
    if raw.startswith('"'):
        raw = json.loads(raw)
    rect = json.loads(raw) if isinstance(raw, str) else raw
    box = (rect['x'], rect['y'], rect['x'] + rect['w'], rect['y'] + rect['h'])
    a = Image.open('/tmp/wsf-a.raw.png').convert('RGB').crop(box)
    b = Image.open('/tmp/wsf-b.raw.png').convert('RGB').crop(box)
    std = ImageStat.Stat(a.convert('L')).stddev[0]
    if std < 2:
        print(f'空白哨兵：canvas stddev {std:.2f} < 2 —— 无内容，截图管线或渲染失效')
        sys.exit(2)
    diff = ImageChops.difference(a, b).convert('L')
    hist = diff.histogram()
    total = a.size[0] * a.size[1]
    changed = sum(hist[13:])   # 灰度差 > 12/255 的像素（bins 13..255）
    pct = 100.0 * changed / total
    # 渲染活性守卫：引擎在场（tick 值非零）且两截图间零 tick 推进 → 0.000% 是同帧假稳定
    engine_present = tick_a not in ('', '0') or tick_b not in ('', '0')
    stale = engine_present and tick_a == tick_b
    if pct <= tol and stale:
        print(f'STALE-FRAME 漂移 {pct:.3f}% 但零新帧（tick {tick_a}→{tick_b}）——同帧假稳定，继续等真实落屏')
        sys.exit(4)
    print(f'{pct:.3f}')
    sys.exit(0 if pct <= tol else 1)
except SystemExit:
    raise
except Exception:
    # 异常与真实 UNSTABLE 严格分流（exit 3）——防「崩溃假报不稳定」误导排查方向
    print('PYERR ' + traceback.format_exc(limit=1).replace('\n', ' | '))
    sys.exit(3)
PY
)
  rc=$?
  case "$rc" in
    0) echo "STABLE 第 ${round} 轮到达：漂移 ${verdict}% ≤ 容差 ${TOL}%（含新帧渲染，终态可拍断言截图）"; exit 0 ;;
    1) echo "  … 第 ${round}/${ROUNDS} 轮：漂移 ${verdict}% > ${TOL}%（异步派生仍在落屏）" ;;
    4) echo "  … 第 ${round}/${ROUNDS} 轮：${verdict}" ;;
    *) echo "PIPE-FAIL ${verdict}"; exit 2 ;;
  esac
  round=$((round + 1))
done
echo "UNSTABLE ${ROUNDS} 轮（${INTERVAL}s 间隔）仍未到达 ${TOL}% 容差——派生计算未落屏或存在持续动画；如实排查勿硬拍基线"
exit 1
