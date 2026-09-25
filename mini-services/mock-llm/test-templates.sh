#!/usr/bin/env bash
# r65-b mock-llm 模板引擎 curl 断言（非流式全模板 + 中英双语 + 顺序边界）
set -u
URL="http://localhost:3999/v1/chat/completions"
pass=0; fail=0

# post <消息> —— 输出 content 字段（协议 JSON 字符串）
post() {
  curl -s -X POST "$URL" -H 'Content-Type: application/json' \
    -d "{\"stream\":false,\"messages\":[{\"role\":\"user\",\"content\":$(printf '%s' "$1" | jq -Rs .)}]}"
}

# assert <消息> <reply 应含> <commands 应含（; 分隔多个，每个都须出现）>
assert() {
  local msg="$1" replyNeed="$2" cmdNeed="$3"
  local out content reply cmds ok=1
  out=$(post "$msg")
  content=$(printf '%s' "$out" | jq -r '.choices[0].message.content')
  reply=$(printf '%s' "$content" | jq -r '.reply // empty')
  cmds=$(printf '%s' "$content" | jq -rc '.commands // empty')
  [[ "$reply" == *"$replyNeed"* ]] || { ok=0; echo "  ✗ reply 不含「$replyNeed」→ $reply"; }
  if [[ -n "$cmdNeed" ]]; then
    local IFS=';'
    for c in $cmdNeed; do
      [[ "$cmds" == *"$c"* ]] || { ok=0; echo "  ✗ commands 不含「$c」→ $cmds"; }
    done
  fi
  if [[ $ok -eq 1 ]]; then pass=$((pass+1)); echo "  ✓ [$msg] → $reply | $cmds"
  else fail=$((fail+1)); echo "  FAIL [$msg]"; fi
}

echo "== 新增模板（中文） =="
assert "彩虹着色"      "彩虹渐变着色"          "spectrum count, rainbow"
assert "测量 A 链和 B 链的距离" "最近原子对距离"  "measure dist (chain A and name CA) (chain B and name CA)"
assert "测量距离"      "距离"                  "measure dist (chain A and name CA) (chain B and name CA)"
assert "显示氢键网络"  "氢键网络"              "hbonds on 3.2"
assert "比对 4HHB 和 1A3N" "叠合比对"          "superpose 4HHB onto 1A3N"
assert "结构比对"      "叠合比对"              "superpose 4HHB onto 1A3N chain A to A"
assert "背景设为白色"  "背景色已切换为白色"     "bg white"
assert "把背景弄成黑色" "黑色"                  "bg black"
assert "换个背景"      "灰色"                  "bg grey"
assert "按二级结构着色" "二级结构"             "util cbss"
assert "静电着色"      "溶剂可及性"            "color sasa"
assert "sasa 着色"     "sasa"                  "color sasa"
assert "居中显示"      "主轴定向"              "orient;zoom"
assert "定向"          "主轴定向"              "orient;zoom"

echo "== 新增模板（英文 → 英文 reply） =="
assert "rainbow gradient please"    "rainbow gradient"        "spectrum count, rainbow"
assert "measure the distance between chain A and chain B" "nearest-atom-pair distance" "measure dist (chain A and name CA) (chain B and name CA)"
assert "show hydrogen bonds"        "H-bond network"          "hbonds on 3.2"
assert "superpose 4HHB onto 1A3N"   "superposition"           "superpose 4HHB onto 1A3N"
assert "align these structures"     "superposition"           "superpose 4HHB onto 1A3N chain A to A"
assert "set the background to white" "Background set to white" "bg white"
assert "black background"           "Background set to black" "bg black"
assert "color by secondary structure" "secondary structure"   "util cbss"
assert "electrostatic coloring"     "solvent accessibility"   "color sasa"
assert "color by sasa"              "solvent accessibility"   "color sasa"
assert "orient and center the view" "principal axes"          "orient;zoom"

echo "== 表示法细分（中英） =="
assert "显示球棍"     "球棍"   "show sticks, chain A"
assert "显示球体"     "球体"   "show spheres, chain A"
assert "显示线条"     "线条"   "show lines, chain A"
assert "带状显示 B 链" "带状"   "select chain B;show cartoon, chain B"
assert "show sticks"  "sticks" "show sticks, chain A"
assert "show spheres" "spheres" "show spheres, chain A"
assert "show lines"   "lines"  "show lines, chain A"
assert "show ribbon"  "cartoon" "show cartoon, chain A"
assert "隐藏球棍"     "球棍"   "hide sticks, chain A"
assert "hide spheres" "spheres" "hide spheres, chain A"

echo "== 谓词选择（中英） =="
assert "选择 name CA"            "name CA"        "select name CA;zoom sele"
assert "select resn HEM"         "resn HEM"       "select resn HEM;zoom sele"
assert "选择残基名 HEM"           "resn HEM"       "select resn HEM;zoom sele"
assert "select resi 100-110"     "resi 100-110"   "select resi 100-110;zoom sele"
assert "选择残基号 100 到 110"    "resi 100-110"   "select resi 100-110;zoom sele"
assert "select chain B and name CA" "chain B and name CA" "select chain B and name CA;zoom sele"
assert "选择链 A 的 name CA"      "chain A and name CA" "select chain A and name CA;zoom sele"

echo "== 既有模板（双语升级回归） =="
assert "染红 A 链"    "已将 A 链染为红色。"   "select chain A;color red, chain A"
assert "B 链蓝色"     "已将 B 链染为蓝色。"   "select chain B;color blue, chain B"
assert "color A chain green" "Chain A colored green" "select chain A;color green, chain A"
assert "显示卡通"     "已将 A 链切换为带状展示。" "select chain A;show cartoon, chain A"
assert "show cartoon" "Chain A switched to cartoon" "select chain A;show cartoon, chain A"
assert "隐藏线条"     "已隐藏 A 链的线条表示。" "hide lines, chain A"
assert "hide lines"   "Hidden lines representation of chain A" "hide lines, chain A"
assert "不显示球棍"   "已隐藏 A 链的球棍表示。" "hide sticks, chain A"
assert "看 A 链"      "已选择 A 链并适配视图。" "select chain A;zoom chain A"
assert "hello"        "Chain A selected and framed" "select chain A;zoom chain A"

echo "== 顺序边界（具体优先于宽泛） =="
assert "彩虹色"       "彩虹"  "spectrum count, rainbow"   # 彩虹不被颜色类吞掉
assert "背景红色"     "背景色" "bg red"                    # 背景红按 bg 处理而非链染色
assert "color sasa"   "sasa"  "color sasa"                # sasa 不被 color 吞掉
assert "按二级结构染色" "二级结构" "util cbss"             # 二级结构不被染色吞掉
assert "隐藏线框"     "线条"  "hide lines, chain A"       # 隐藏不被显示吞掉
assert "渲染一张图"   "选择"  "select chain A"            # 「渲染」不被染字吞掉（走默认）

echo
echo "PASS=$pass FAIL=$fail"
[[ $fail -eq 0 ]] || exit 1
