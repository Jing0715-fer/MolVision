#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# regression-guards.sh —— r60 历史修复的 grep 级回归防线（r63-review-b 建议②）
#
# 背景：r62 i18n 并行改写曾静默回滚 r60 的 13/16 项已验证修复（isComposing
# 全仓零命中实锤）。本脚本检查一组「必须存在的代码标志」——某条 FAIL 即意味着
# 对应修复被后续改写回滚（或守卫正则失效，需同步修正脚本）。
#
# 用法：bun run guards   （或 bash scripts/regression-guards.sh）
# 退出码：0 = 全过；1 = 存在 FAIL（CI 可直接拦截）
# -----------------------------------------------------------------------------
set -u
cd "$(dirname "$0")/.."

FAILS=0

# check <名称> <rg 正则> <路径> <最小命中数>
# rg -c 多文件输出 "path:count"、单文件输出裸 "count"，两种形态按末字段求和；
# rg 无命中退出码 1 且无输出 → 计 0（--no-messages 抑制路径缺失等 stderr）
check() {
  local name="$1" pattern="$2" path="$3" min="$4"
  local count
  count=$(rg -c --no-messages -e "$pattern" -- "$path" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
  if [ "${count:-0}" -ge "$min" ]; then
    printf 'PASS  %-34s 命中 %2d（要求 ≥%d）\n' "$name" "$count" "$min"
  else
    printf 'FAIL  %-34s 命中 %2d（要求 ≥%d）—— %s\n' "$name" "${count:-0}" "$min" "$path"
    FAILS=$((FAILS + 1))
  fi
}

echo "== MolVision 回归防线（r60 修复代码标志） =="

# ---- 输入交互守卫（IME / Escape / 确认 / 滚动） ----
check "IME Enter 守卫"            "isComposing"                     "src/components/"                       10
check "Escape 跨层穿透守卫"       "defaultPrevented"                "src/components/molecular/MolViewer.tsx" 1
check "新建会话二次确认"          "alertdialog|AlertDialog"         "src/components/studio/CommandPalette.tsx" 1
check "AgentPanel 智能滚动"       "nearBottom|prevBusy"             "src/components/studio/AgentPanel.tsx"   1
check "EnsembleBar 拖帧续播"      "prevPlaying|playEnsemble"        "src/components/studio/EnsembleBar.tsx"  1

# ---- 网络与数据错误处理 ----
check "ProviderDialog fetch 检查" "res\.ok"                         "src/components/studio/ProviderSettingsDialog.tsx" 3

# ---- 选择引擎接线（r63 主线程 P1：q 谓词 / in-like 二元操作符） ----
check "PyMOL q 谓词接线"          "q.*occupancy|occupancyCmp"       "src/lib/molecular/selection.ts"         2
check "in/like 残基匹配接线"      "matchByResidue"                  "src/lib/molecular/selection.ts"         2

# ---- 引擎行为 ----
check "rep 可见性参与拾取过滤"    "build\.group\.visible"           "src/lib/molecular/engine.ts"            2

# ---- 凭据安全（不入库 + 权限位） ----
check "凭据文件权限收紧"          "chmodSync"                       "src/lib/molecular/agent/providers.ts"   1
if git check-ignore -q .molvision/agent-providers.json 2>/dev/null; then
  echo "PASS  凭据不入库（git check-ignore）    命中  1（要求 ≥1）"
else
  echo "FAIL  凭据不入库（git check-ignore）    命中  0（要求 ≥1）—— .molvision/agent-providers.json 未被 .gitignore 覆盖"
  FAILS=$((FAILS + 1))
fi

# ---- i18n 细节（时间 locale 随语言切换） ----
check "ViewBar 时间 locale"       "locale === 'en' \? 'en-US'"      "src/components/studio/ViewBar.tsx"      1

# ---- r65-c：locale 格式化接线 / a11y / 超时 UI ----
check "toLocale locale 接线"      "toLocaleString\(locale\)|toLocaleString\(loc\(\)\)" "src/" 60
check "Slider aria-label"         "aria-label"                      "src/components/studio/panels/"          60
check "供应商超时 UI"             "timeoutMs|parseTimeoutMs"        "src/components/studio/ProviderSettingsDialog.tsx" 3
check "超时档透出"                "effectiveTimeoutMs"              "src/lib/molecular/agent/providers.ts"   2
check "ConsoleBar 稳定 seq key"   "l\.seq \?\?"                     "src/components/studio/ConsoleBar.tsx"   1
check "HistoryDialog Row 外提"    "function HistoryRow"             "src/components/studio/HistoryDialog.tsx" 1

# ---- 汇总 ----
TOTAL=18
if [ "$FAILS" -eq 0 ]; then
  echo "== 结果：PASS（$TOTAL/$TOTAL 守卫全部通过） =="
  exit 0
else
  echo "== 结果：FAIL（$FAILS/$TOTAL 守卫失败——对应 r60/r63 修复疑被回滚，或守卫正则需更新） =="
  exit 1
fi
