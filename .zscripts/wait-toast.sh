#!/usr/bin/env bash
# wait-toast.sh —— r120-a（r119 建议①收口）：E2E toast 观察窗等待工具
#
# 背景（r119 G1b 实测教训）：sonner 默认 duration 4s（本应用 <Toaster> 未自定义
# duration——layout.tsx 实测确认），G1 驱动点击恢复后等引擎就位（~9s）再查
# hasToast 必 false——toast 已在 4s 时自动退场。观察窗错位让「闭环主证据」退化为
# 间接推断（结构恢复 + 条消失），toast 这一用户反馈面的断言长期空转。
#
# 判定法：轮询 [data-sonner-toast] 元素族（sonner 渲染进 body 的 portal——不查
# 全 body innerText，避免按钮/面板同文案假阳性——「恢复」二字在 UI 里到处都是）；
# 命中即 exit 0。未命中超时 exit 1 时附「当时在场 toast 清单」诊断（诚实呈现
# 观察窗内实际看到了什么——是空（toast 已退场/从未出现）还是错文案（模式串
# 不匹配），两种失败方向排查路径完全不同）。
#
# 【r120 首跑实测坑：agent-browser 字符串返回的 JSON 编码层】eval 返回 JSON 对象
# 字符串时输出形如 "{\"found\":true,...}"——内部引号全部反斜杠转义，bash 剥外
# 层引号壳后 \"found\":true 与模式 "found":true 永不匹配（r112「shell 引号壳」
# 教训的字符串层变体——Python json.loads 可解，bash 无等价物）。修复：探针改
# 纯字符串协议（HIT::/MISS:: 前缀，文本内引号预先剥离）——无内部引号即无转义
# 层，布尔/裸词返回（smoke.sh has_lang 同款）是 agent-browser 的干净契约。
#
# 用法：bash .zscripts/wait-toast.sh <模式串> [总超时秒] [轮询间隔秒]
#   <模式串>     toast 文本子串（区分大小写——双语 toast 文案本身即精确锚；
#                ZH/EN 二选一，多语验证由调用方分次调用）
#   [总超时秒]   默认 5（sonner 默认 4s 退场 + 触发→渲染 ~0.3s + dismiss 动画
#                ~0.3s ≈ 4.6s 在场窗；5s 默认即完整覆盖，调用方勿传过长——
#                观察窗语义是「及时抓取」不是「耐心等待」）
#   [轮询间隔秒] 默认 0.5（agent-browser eval 单次开销 ~0.3-0.8s，0.5s 间隔 +
#                eval 开销 ≈ 每轮 0.8-1.3s 实际节奏；间隔再小不增加捕获率只
#                增加 daemon 压力）
#
# 退出码：0 = FOUND（打印命中轮数与 toast 文本前缀）
#         1 = NOTFOUND（超时——附在场 toast 清单诊断；空清单 = 观察窗内无任何
#             toast（触发时机过晚 / toast 从未出现），非空清单 = 有 toast 但
#             模式串不匹配（文案变更或断言写错））
#         2 = 管线故障（agent-browser eval 连续两轮无返回——会话假死/daemon
#             掉线，与 NOTFOUND 严格分流，防「环境故障假报文案失配」）
#
# 前置：agent-browser 会话已打开且页面处于被测状态；调用纪律——触发动作（click
# 等）后**立即**调用本工具（观察窗 4.6s 从 toast 出现起算，先 sleep 再查必错过；
# r119 G1b 的 9s 等待反例即此）。本工具不动 DOM、不关会话——现场恢复由调用方负责。
#
# 与 wait-stable-frame.sh 的分工：后者管「渲染稳定帧」（截图前），本工具管
# 「toast 在场窗」（交互后即时）——两工具都遵守「有界 + 诚实退出 + 诊断落盘」
# 三原则（E2E 工具族 r112-c/r118-c 同款纪律）。
set -u

PATTERN="${1:?用法：wait-toast.sh <模式串> [总超时秒=5] [轮询间隔秒=0.5]}"
TIMEOUT="${2:-5}"
INTERVAL="${3:-0.5}"

# 模式串经反斜杠/单引号双重转义注入 JS 字符串字面量（wait-stable-frame r118-c
# ARIA_PATTERN 同款——模式串内含引号/反斜杠不炸 eval）；探针返回纯字符串协议
#（HIT::<文本> / MISS::<数>——文本内引号/反斜杠预先剥离，规避 agent-browser
# 字符串返回的 JSON 转义层）
esc=$(printf '%s' "$PATTERN" | sed -e 's/\\/\\\\/g' -e "s/'/\\\\'/g")
PROBE_JS="(() => { const ts = Array.from(document.querySelectorAll('[data-sonner-toast]')); const hit = ts.find(el => (el.textContent || '').includes('${esc}')); if (hit) return 'HIT::' + (hit.textContent || '').replace(/['\"\\\\]/g, '').replace(/\\s+/g, ' ').slice(0, 140); return 'MISS::' + ts.length })()"

# 轮数 = 总窗 / 间隔 向上取整（awk 浮点安全；eval 开销 (~0.3-0.8s/轮) 会自然
# 延展实际经过时间——总窗语义是「至少等这么久」，上界由轮数 × (间隔+开销) 有界）
ROUNDS=$(awk -v t="$TIMEOUT" -v i="$INTERVAL" 'BEGIN { n = 0; while (n * i < t) n++; print (n < 1 ? 1 : n) }')

round=1
consec_empty=0
while [ "$round" -le "$ROUNDS" ]; do
  out=$(agent-browser eval "$PROBE_JS" 2>/dev/null | tr -d '\n')
  # agent-browser 字符串返回带外层引号壳（内部无引号即无转义层——纯字符串协议
  # 保障；只剥首尾成对壳）
  case "$out" in
    \"*\") body=${out#\"}; body=${body%\"} ;;
    *) body=$out ;;
  esac
  if [ -z "$body" ]; then
    consec_empty=$((consec_empty + 1))
    if [ "$consec_empty" -ge 2 ]; then
      echo "PIPE-FAIL agent-browser eval 连续 ${consec_empty} 轮无返回——会话假死或 daemon 掉线（先用 agent-browser get title 区分环境故障与页面故障）"
      exit 2
    fi
  else
    consec_empty=0
    case "$body" in
      HIT::*)
        echo "FOUND 第 ${round}/${ROUNDS} 轮：toast 命中「${PATTERN}」——在场文本：${body#HIT::}"
        exit 0
        ;;
    esac
  fi
  sleep "$INTERVAL"
  round=$((round + 1))
done

# 超时诊断：诚实呈现观察窗内在场的 toast 清单（EMPTY = 无 toast 出现过；
# SEEN:: = 有 toast 在场——模式串失配，文案变更或断言写错）
diag=$(agent-browser eval "(() => { const ts = Array.from(document.querySelectorAll('[data-sonner-toast]')); if (!ts.length) return 'EMPTY'; return 'SEEN::' + ts.map(el => (el.textContent || '').replace(/['\"\\\\]/g, '').replace(/\\s+/g, ' ').slice(0, 60)).join(' || ') })()" 2>/dev/null | tr -d '\n')
case "$diag" in
  \"*\") diag=${diag#\"}; diag=${diag%\"} ;;
esac
if [ -z "$diag" ] || [ "$diag" = "EMPTY" ]; then
  echo "NOTFOUND ${ROUNDS} 轮（总窗 ${TIMEOUT}s × ${INTERVAL}s 间隔）未命中「${PATTERN}」——观察窗内无任何 toast 在场（触发时机过晚已退场，或 toast 从未出现）"
else
  echo "NOTFOUND ${ROUNDS} 轮（总窗 ${TIMEOUT}s × ${INTERVAL}s 间隔）未命中「${PATTERN}」——窗内曾见 toast：${diag#SEEN::}（模式串失配——核对文案或断言）"
fi
exit 1
