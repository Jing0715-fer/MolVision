#!/usr/bin/env bash
# g1-lib.sh —— r121-a（r120 建议①②制度化收口）：G1 浏览器 E2E 驱动标准库
#
# 背景（r120 实测三教训）：
#  ① sonner toast ~4s 自动退场 vs 历史驱动「等完状态再查 toast」观察窗错位
#    （wait-toast.sh 已修，但历史 G1 的 hasToast 手查法仍在旧驱动习惯里）
#  ② agent-browser eval 返回 JSON 字符串的转义层坑（{\"found\":true} 内引号
#    全转义——bash 剥壳后与模式永不匹配；纯字符串协议已立在两个工具里，
#    但「未来 bash 侧新工具应直接采用纯字符串契约」缺制度化载体）
#  ③ G1 驱动散写 eval/断言，五段式节奏（触发→观察窗→状态断言→现场恢复→
#    诊断落盘）每轮重造，观察窗错位类缺陷反复重演（r119 G1b → r120 根治）
#
# 本库把 r120 建议①「click → wait-toast → 状态断言三步固化为标准」与建议②
# 「纯字符串契约制度化」落成可 source 的函数族：
#
#  · g1_eval <js> [期望前缀]   —— eval 统一入口：剥 shell 引号壳 →（带期望前缀时）
#    校验协议 → 命中输出体；探针返回 JSON（'{' 开头）直接判协议违规
#    PROTOCOL-VIOLATION（制度化：写探针的人当场知道错，不是「永不匹配」之后排查）
#  · g1_click_toast <click-js> <toast 模式串> [toast 超时秒]
#    —— r120 建议①标准三步：触发（click eval）→ **立即** wait-toast（4.6s
#    在场窗从 toast 出现起算——先 sleep 再查必错过）→ 退出码透传
#  · g1_wait_state <js> <期望前缀> [总超时秒=15] [轮询间隔秒=0.6]
#    —— 状态断言有界轮询（引擎就位/molData 落地/面板开合等慢状态；toast
#    走 g1_click_toast——观察窗语义不同勿混用）
#  · g1_fail <消息>             —— 统一失败出口（FAIL:: 前缀 + exit 1）
#
# 退出码约定（与 wait-toast / wait-stable-frame 同族三分流）：
#   0 = 命中；1 = 未命中/断言失配；2 = 管线故障（eval 连续两轮空返回——
#   会话假死/daemon 掉线，与页面故障严格分流）
#
# 用法：source .zscripts/g1-lib.sh（函数注入当前 shell，不执行任何动作；
#       依赖同目录 wait-toast.sh——G1_TOOLS_DIR 自动解析，跨 cwd source 可用）
#
# 纯字符串协议注册表（r120 建议②的制度化形态——新增前缀在此登记）：
#   HIT::<文本>     命中且携带在场文本（wait-toast / g1_eval 常用）
#   MISS::<数>      未命中且携带在场计数（toast 数/元素数）
#   SEEN::<清单>    未命中但窗内在场清单（诊断用——wait-toast 超时分支）
#   EMPTY           观察窗内无任何目标元素
#   NUM::<数>       数值探针（计数/长度——裸数字返回也是干净契约）
#   OK::<文本>      泛命中（g1_click_toast 的 click 步）
#   NOBTN/NOITEM/NOFETCH/NOCANVAS   定位失败裸词（历史 G1 惯用，沿用）
set -u

G1_TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
G1_PIPE_EMPTY=0   # g1_eval 连续空返回计数（管线健康哨兵）

# 剥 agent-browser 字符串返回的外层引号壳（内部无引号即无转义层——纯字符串
# 协议保障；只剥首尾成对壳，与 wait-toast.sh 同款实现）
g1_strip() {
  local out="${1:-}"
  case "$out" in
    \"*\") body=${out#\"}; printf '%s' "${body%\"}" ;;
    *) printf '%s' "$out" ;;
  esac
}

# g1_eval <js> [期望前缀]
#   stdout：命中时输出协议体（前缀之后的部分）；无期望前缀时输出剥壳全文
#   退出码：0 命中 / 1 失配（或协议违规）/ 2 管线故障
#   带期望前缀时探针返回 '{' 开头 → PROTOCOL-VIOLATION（JSON 转义层坑的
#   制度化拦截——探针作者须改成纯字符串前缀返回）
g1_eval() {
  local js="${1:?g1_eval: 缺 JS 探针}"
  local want_prefix="${2:-}"
  local out body
  out=$(agent-browser eval "$js" 2>/dev/null | tr -d '\n')
  if [ -z "$out" ]; then
    G1_PIPE_EMPTY=$((G1_PIPE_EMPTY + 1))
    if [ "$G1_PIPE_EMPTY" -ge 2 ]; then
      echo "FAIL:: g1_eval 连续 ${G1_PIPE_EMPTY} 次空返回——agent-browser 会话假死或 daemon 掉线（先 agent-browser get title 区分环境故障）" >&2
      return 2
    fi
    return 1
  fi
  G1_PIPE_EMPTY=0
  body=$(g1_strip "$out")
  if [ -z "$want_prefix" ]; then
    printf '%s\n' "$body"
    return 0
  fi
  case "$body" in
    "{$"*|'{'*)
      if [ -n "$want_prefix" ]; then
        echo "FAIL:: PROTOCOL-VIOLATION 探针返回 JSON（${body:0:80}…）——期望前缀 ${want_prefix}。bash 侧 JSON 有转义层坑（r120 实测），探针须改纯字符串协议返回（HIT::/MISS::/NUM::…见 g1-lib.sh 注册表）" >&2
        return 1
      fi
      ;;
  esac
  if [ "${body#"$want_prefix"}" != "$body" ]; then
    printf '%s\n' "${body#"$want_prefix"}"
    return 0
  fi
  echo "FAIL:: PREFIX-MISMATCH 期望 ${want_prefix} 实得 ${body:0:100}" >&2
  return 1
}

# g1_wait_state <js> <期望前缀> [总超时秒=15] [轮询间隔秒=0.6]
#   状态断言有界轮询：每轮 g1_eval（带期望前缀）；命中即返回 0
#   退出码：0 命中（stdout 附命中轮数）/ 1 超时未命中 / 2 管线故障透传
g1_wait_state() {
  local js="${1:?g1_wait_state: 缺 JS 状态探针}"
  local want_prefix="${2:?g1_wait_state: 缺期望前缀}"
  local timeout="${3:-15}"
  local interval="${4:-0.6}"
  local rounds round=1 rc
  rounds=$(awk -v t="$timeout" -v i="$interval" 'BEGIN { n = 0; while (n * i < t) n++; print (n < 1 ? 1 : n) }')
  while [ "$round" -le "$rounds" ]; do
    if g1_eval "$js" "$want_prefix" >/dev/null; then
      echo "STATE-HIT 第 ${round}/${rounds} 轮（总窗 ${timeout}s）"
      return 0
    fi
    rc=$?
    if [ "$rc" -eq 2 ]; then
      echo "FAIL:: g1_wait_state 管线故障（第 ${round} 轮）" >&2
      return 2
    fi
    sleep "$interval"
    round=$((round + 1))
  done
  echo "FAIL:: g1_wait_state ${rounds} 轮（总窗 ${timeout}s）未达期望态 ${want_prefix}" >&2
  return 1
}

# g1_click_toast <click-js> <toast 模式串> [toast 超时秒=5]
#   r120 建议①标准三步固化：①触发（click eval，期望 OK:: 前缀——探针返回
#   OK:: 已点 / NOBTN 未找到）②**立即** wait-toast（观察窗 4.6s 从 toast 出现
#   起算——中间不 sleep）③退出码透传（0 FOUND / 1 NOTFOUND / 2 PIPE-FAIL）
#   注意：click-js 须返回纯字符串协议（OK::/NOBTN）；本函数不做点击后的
#   状态断言——引擎就位等慢状态由调用方接 g1_wait_state（三步标准的第 3 步
#   按场景选择 toast 或 state，勿在 toast 观察窗内夹慢断言）
g1_click_toast() {
  local click_js="${1:?g1_click_toast: 缺 click JS}"
  local pattern="${2:?g1_click_toast: 缺 toast 模式串}"
  local toast_timeout="${3:-5}"
  if ! g1_eval "$click_js" 'OK::' >/dev/null; then
    echo "FAIL:: g1_click_toast 触发步未命中（NOBTN 或探针失配——click-js 须返回 OK::/NOBTN 纯字符串协议）" >&2
    return 1
  fi
  bash "$G1_TOOLS_DIR/wait-toast.sh" "$pattern" "$toast_timeout"
}

# g1_fail <消息> —— 统一失败出口（FAIL:: 前缀 + exit 1；G1 驱动 trap 语义）
g1_fail() {
  echo "FAIL:: ${1:?g1_fail: 缺消息}" >&2
  exit 1
}
