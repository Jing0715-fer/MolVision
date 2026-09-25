#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# smoke.sh —— MolVision headless 冒烟门禁（r65-main 建议③ / r66-a 落地）
#
# 用途：与 lint/guards 并列的最小端到端冒烟——dev server 起后在真实浏览器里
#       断言应用仍能渲染。覆盖 guards（grep 级）够不到的运行面：
#         1. console 错误为零（含 CSP violation / 未捕获异常）
#         2. 应用标志在（document.title / 正文含 "MolVision"）
#         3. 语言切换入口在（中文/EN 按钮）
#         4. 主体 UI 骨架在（正文含 structure/结构 等工作台标志）
# 任一失败打印清晰失败信息并 exit 1（CI 可直接拦截）。
#
# 用法：bun run smoke   （或 bash scripts/smoke.sh）
# 前置：dev server 已在 localhost:3000 运行；agent-browser 已安装。
# 退出码：0 = 全过；1 = 存在 FAIL 或前置不满足
# -----------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/.."

BASE_URL="${BASE_URL:-http://localhost:3000}"
export AGENT_BROWSER_SESSION="molvision-smoke"   # 固定独立会话，不碰其他代理的浏览器

FAILS=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }

# ---- 前置：dev server 存活 ----
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/" 2>/dev/null || echo "000")
if [ "$code" != "200" ]; then
  echo "FAIL  dev server 未就绪：curl $BASE_URL/ → HTTP ${code}（请先 bun run dev）"
  exit 1
fi
pass "dev server 存活（$BASE_URL/ → HTTP 200）"

# ---- 清掉可能残留的旧冒烟会话，保证 console 错误缓冲区干净 ----
agent-browser close >/dev/null 2>&1 || true
sleep 1   # 等 daemon 收尾，防 close→open 重启竞态（实测偶发）

# ---- 打开首页（agent-browser open 自带页面级超时） ----
if ! agent-browser open "$BASE_URL/" >/dev/null 2>&1; then
  echo "FAIL  agent-browser open $BASE_URL/ 失败（检查 agent-browser doctor）"
  exit 1
fi
agent-browser wait --load load >/dev/null 2>&1 || true
# URL 兜底：close→open 偶发竞态会让新浏览器停在 about:blank——重开一次
cur_url=$(agent-browser get url 2>/dev/null || echo "")
if [ "$cur_url" != "$BASE_URL/" ]; then
  agent-browser open "$BASE_URL/" >/dev/null 2>&1 || true
  agent-browser wait --load load >/dev/null 2>&1 || true
fi
sleep 3   # 等水合与首屏渲染稳定，避免竞态误报

# ---- 断言 1：console 错误为零 ----
errors=$(agent-browser errors 2>/dev/null)
if [ -z "$errors" ]; then
  pass "console 错误为零"
else
  fail "console 存在错误：
$errors"
fi

# ---- 断言 2：应用标志（title / 正文含 MolVision） ----
marker=$(agent-browser eval "document.title.includes('MolVision') || document.body.innerText.includes('MolVision')" 2>/dev/null)
if [ "$marker" = "true" ]; then
  pass "应用标志在（MolVision）"
else
  fail "应用标志缺失：title/正文均不含 MolVision（实得：${marker:-<eval 无返回>}）"
fi

# ---- 断言 3：语言切换入口（中文/EN 按钮） ----
total_btn=$(agent-browser eval "document.querySelectorAll('button').length" 2>/dev/null)
has_lang=$(agent-browser eval "Array.from(document.querySelectorAll('button')).some(x => /^(中文|EN|中)$/i.test((x.textContent || '').trim()))" 2>/dev/null)
if [ "$has_lang" = "true" ] && [ "${total_btn:-0}" -gt 0 ]; then
  pass "语言切换入口在（中文/EN 按钮，页面按钮 ${total_btn} 个）"
else
  fail "语言切换入口缺失：未找到 中文/EN 按钮（按钮总数 ${total_btn:-0}，hasLang=${has_lang:-<eval 无返回>}）"
fi

# ---- 断言 4：主体 UI 骨架（正文含 structure/结构 等工作台标志） ----
skel=$(agent-browser eval "/structure|结构|MOLECULAR STUDIO/i.test(document.body.innerText)" 2>/dev/null)
if [ "$skel" = "true" ]; then
  pass "主体 UI 骨架在（structure/结构 工作台标志）"
else
  fail "主体 UI 骨架缺失：正文不含 structure/结构/MOLECULAR STUDIO（实得：${skel:-<eval 无返回>}）"
fi

# ---- 收尾：关闭冒烟会话（不占用常驻浏览器） ----
agent-browser close >/dev/null 2>&1 || true

# ---- 汇总 ----
if [ "$FAILS" -eq 0 ]; then
  echo "== 结果：PASS（4/4 冒烟断言全部通过） =="
  exit 0
else
  echo "== 结果：FAIL（$FAILS/4 冒烟断言失败） =="
  exit 1
fi
