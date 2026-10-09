#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# smoke.sh —— MolVision headless 冒烟门禁（r65-main 建议③ / r66-a 落地）
#
# 用途：与 lint/guards 并列的最小端到端冒烟——dev server 起后在真实浏览器里
#       断言应用仍能渲染、预设切换触发后主线程仍响应。覆盖 guards（grep 级）
#       够不到的运行面：
#         1. console 错误为零（含 CSP violation / 未捕获异常）
#         2. 应用标志在（document.title / 正文含 "MolVision"）
#         3. 语言切换入口在（中文/EN 按钮）
#         4. 主体 UI 骨架在（正文含 structure/结构 等工作台标志）
#         5. 假死哨兵：预设切换键（press 2）触发后有界 eval 探针仍响应
#            （r103-c / r102 建议③——主线程假死症状的 CI 判定缺口补齐）
#         6. 预设触发后 console 仍零错误（交互路径不引入运行时错误）
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
TOTAL=0   # 断言总数动态计数（r103-c）：pass/fail 各计一次，汇总段不再硬编码「4/4」
pass() { printf 'PASS  %s\n' "$1"; TOTAL=$((TOTAL + 1)); }
fail() { printf 'FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); TOTAL=$((TOTAL + 1)); }

# ---- 前置：dev server 存活 ----
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE_URL/" 2>/dev/null || echo "000")
if [ "$code" != "200" ]; then
  echo "FAIL  dev server 未就绪：curl $BASE_URL/ → HTTP ${code}（请先 bun run dev）"
  exit 1
fi
# 前置存活项走纯打印不计数（r103-c）：TOTAL 口径只数 6 项断言，与旧「4/4」同为
# 纯断言计数——前置不满足时上方已 exit 1，不进入汇总
printf 'PASS  %s\n' "dev server 存活（$BASE_URL/ → HTTP 200）"

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

# ---- 断言 5：假死哨兵（r103-c / r102 建议③） ----
# 动机：r102 E2E 实测沙箱内存耗尽（next-server RSS 1259MB + 双 Chrome ~1.35GB，
# 4GB 沙箱仅剩 544MB free）时页面主线程假死——eval 超时但浏览器级存活（get title
# 正常），lint/guards 的静态面测不到该症状，CI 存在判定性缺口。哨兵 = 渲染负载
# 触发器 + 有界 eval 探针：触发器选 press 2 的依据——MolViewer.tsx 快捷键监听挂
# window（非 canvas/document），数字键 1-9 直接映射预设（'2' → ballstick），无
# 输入框聚焦时 agent-browser press 派发的按键可达监听器（r102 E2E 的「预设
# 2/5/1 三键切换」即走此路径）。探针有界宽容：首次空返回可能只是瞬态长任务
# （GC 尖峰/编译不 yield），sleep 5 重试一次，两次皆空才判假死——避免瞬时抖动误报。
agent-browser press 2 >/dev/null 2>&1 || true
sleep 2   # 等触发后的键盘分发/状态更新落地，再探测主线程
probe=$(agent-browser eval "Date.now()" 2>/dev/null || true)
retries=0
if [ -z "$probe" ]; then
  sleep 5   # 有界宽限：重试一次
  retries=1
  probe=$(agent-browser eval "Date.now()" 2>/dev/null || true)
fi
if [ -n "$probe" ]; then
  pass "假死哨兵：预设切换键触发后主线程仍响应（eval Date.now() → ${probe}，重试 ${retries} 次）"
else
  fail "假死哨兵触发：press 2 后 eval Date.now() 探针两轮（首测 + 有界宽限重试 ${retries} 次）均无返回——疑似主线程假死（r102 实测症状为 eval 超时但浏览器级存活，可先跑 agent-browser get title 区分环境内存耗尽假死与页面崩溃）"
fi

# ---- 断言 6：预设触发后 console 仍零错误 ----
# 与断言 1 构成「交互前/交互后」两道 console 闸：断言 5 的触发路径
# （快捷键分发 → applyPreset → 渲染）不应引入运行时错误。
errors2=$(agent-browser errors 2>/dev/null)
if [ -z "$errors2" ]; then
  pass "预设切换后 console 仍零错误"
else
  fail "预设切换引入 console 错误：
$errors2"
fi

# ---- 收尾：关闭冒烟会话（不占用常驻浏览器） ----
agent-browser close >/dev/null 2>&1 || true

# ---- 汇总（r103-c：断言数动态化——TOTAL 由 pass/fail 实时累计，新增断言免改此处） ----
if [ "$FAILS" -eq 0 ]; then
  echo "== 结果：PASS（$TOTAL/$TOTAL 冒烟断言全部通过） =="
  exit 0
else
  echo "== 结果：FAIL（$FAILS/$TOTAL 冒烟断言失败） =="
  exit 1
fi
