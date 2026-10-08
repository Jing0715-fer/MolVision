#!/usr/bin/env bash
# r78 全模板体检：欢迎页画廊逐卡点击（demoThenApply 全链路）→ 等命令序列完成 →
# 截图画布 → 像素级内容验证（非底色占比>0.5%）→ 记录结果。
# r98-f4：SPECS 改 source scripts/template-specs.sh（单一事实源——本脚本 r75 后
# 停更导致 27/46 漂移、19 支模板体检盲区；现与缩略图管线共用一份规格，数量与
# figure-templates.ts 由 specs 文件内断言强制对齐）。
# 用法：bash scripts/health-check-templates.sh [起idx] [止idx]（缺省全量 0-N-1 动态）
set -u
export AGENT_BROWSER_SESSION=r78-health
BASE=http://localhost:3000
# shellcheck source=template-specs.sh
source "$(dirname "${BASH_SOURCE[0]}")/template-specs.sh"
START=${1:-0}
END=${2:-$(( ${#SPECS[@]} - 1 ))}
mkdir -p /tmp/r78-health
# r99-f3：退出码语义（对齐 smoke.sh）——旧行为探针赋值后从不检查、结尾恒 exit 0；
# 现点击/翻转等待探针异常（NOGALLERY/NOCARD/NOBTN/ID-MISMATCH/TIMEOUT/eval 空输出）
# 与像素校验 FAIL/EMPTY 均计入 fails，结尾非零退出（CI 可拦截）
fails=0
for i in $(seq "$START" "$END"); do
  spec="${SPECS[$i]}"
  # r98-f4：template-specs.sh 全字段（id:wait:demo:idx[:vp]）——取前两字段
  id="${spec%%:*}"; wait="$(printf '%s' "$spec" | cut -d: -f2)"
  agent-browser open "$BASE" >/dev/null 2>&1
  sleep 4
  # 点击画廊第 i 张卡的演示按钮（卡片内首个 button）
  clicked=$(agent-browser eval "(() => { const g = document.querySelector('[data-welcome-gallery]'); if (!g) return 'NOGALLERY'; const cards = g.querySelectorAll('article'); const card = cards[$i]; if (!card) return 'NOCARD:' + cards.length; const btn = card.querySelector('button'); if (!btn) return 'NOBTN'; btn.click(); return 'clicked:' + (card.textContent.includes('${id}') ? 'id-ok' : 'ID-MISMATCH') })()" 2>/dev/null | tr -d '"')
  # r99-f3：点击探针校验——非 clicked:* 前缀（NOGALLERY/NOCARD/NOBTN/eval 空输出）计失败。
  # 注：clicked:ID-MISMATCH 不计——实跑实证画廊卡 textContent 只含本地化名与 demo 号
  # （原始 id 在 data-welcome-row-card 属性），该文本断言稳态即 MISMATCH（仅信息性），
  # 点击落卡正确性由下游像素校验把守
  case "$clicked" in
    clicked:*) ;;
    *) echo "PROBE-FAIL $id (gallery click: ${clicked:-<no output>})"; fails=$((fails + 1)) ;;
  esac
  # r77 坑档：状态翻转等待法——bg 命令把 backgroundPinned 翻为 true 即命令序列到达
  # bg 之后（比固定秒数鲁棒——无头低帧率下序列可拖到 30s+）；上限 wait+25s，兑底再等 4s
  pinned=$(agent-browser eval "(() => { const t0 = performance.now(); return new Promise(res => { const poll = () => { const e = window.__molEngine; if (e && e.settings && e.settings.backgroundPinned) { res('PINNED:' + Math.round((performance.now()-t0)/1000) + 's:' + e.settings.background); return } if (performance.now() - t0 > $(($wait + 25)) * 1000) { res('TIMEOUT'); return } setTimeout(poll, 250) }; poll() }) })()" 2>/dev/null | tr -d '"')
  # r99-f3：翻转等待探针校验——非 PINNED:*（含 TIMEOUT/eval 空输出）均计失败
  case "$pinned" in
    PINNED:*) ;;
    *) echo "PROBE-FAIL $id (bg pin wait: ${pinned:-<no output>})"; fails=$((fails + 1)) ;;
  esac
  sleep 4
  # 画布 rect + 截图 + 像素内容分析（Python 内联）
  rect=$(agent-browser eval "(() => { const c = document.querySelector('canvas'); if (!c) return 'NOCANVAS'; const r = c.getBoundingClientRect(); return JSON.stringify([Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]) })()" 2>/dev/null | tr -d '"' | sed "s/^\"//;s/\"$//")
  agent-browser screenshot "/tmp/r78-health/$id.png" >/dev/null 2>&1
  # r99-f3：像素校验判定捕获计数（FAIL/EMPTY/python 崩溃空输出）；原样回显保持输出格式不变
  verdict=$(python3 - "$id" "$rect" <<'PY'
import sys, json
from PIL import Image
import numpy as np
tid, raw = sys.argv[1], sys.argv[2]
try:
    rect = json.loads(raw)
except Exception:
    print(f'{tid}|FAIL|rect-parse:{raw[:40]}')
    sys.exit(0)
im = Image.open(f'/tmp/r78-health/{tid}.png').convert('RGB')
x, y, w, h = rect
if w < 50 or h < 50:
    print(f'{tid}|FAIL|canvas-tiny:{w}x{h}')
    sys.exit(0)
a = np.array(im.crop((x, y, x + w, y + h))).astype(int)
# 底色 = 画布主色（每模板 bg 不同——众数即底色）
flat = a.reshape(-1, 3)
from collections import Counter
bg = Counter(map(tuple, flat[::7])).most_common(1)[0][0]
bg = np.array(bg)
diff = np.abs(a - bg).max(axis=2)
content = (diff > 30).mean()
# 内容质心
ys, xs = np.where(diff > 30)
if len(xs):
    cx, cy = (xs.min()+xs.max())/2/w*100, (ys.min()+ys.max())/2/h*100
    clip = ('L' if xs.min() < 3 else '') + ('R' if xs.max() > w-4 else '') + ('T' if ys.min() < 3 else '') + ('B' if ys.max() > h-4 else '')
    print(f'{tid}|{"PASS" if content > 0.005 else "EMPTY"}|content={content*100:.1f}% centroid=({cx:.0f}%,{cy:.0f}%) clip={clip or "none"}')
else:
    print(f'{tid}|EMPTY|no-content')
PY
)
  if [ -n "$verdict" ]; then
    printf '%s\n' "$verdict"
    case "$verdict" in
      *'|PASS|'*) ;;
      *) fails=$((fails + 1)) ;;
    esac
  else
    echo "PROBE-FAIL $id (pixel check produced no output)"
    fails=$((fails + 1))
  fi
done
echo "== health check done (idx $START-$END) =="
# r99-f3：退出码语义——非零退出供 CI 拦截（smoke.sh 同款语义；输出格式不变）
[[ $fails -eq 0 ]] || exit 1
