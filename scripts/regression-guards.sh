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

# check0 <名称> <正则> <路径>：负向守卫（命中数必须为 0——出现即回归）
check0() {
  local name="$1" pattern="$2" path="$3"
  local count
  count=$(rg -c --no-messages -e "$pattern" -- "$path" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
  if [ "${count:-0}" -eq 0 ]; then
    printf 'PASS  %-34s 命中  0（要求 =0）\n' "$name"
  else
    printf 'FAIL  %-34s 命中 %2d（要求 =0）—— %s\n' "$name" "${count:-0}" "$path"
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

# ---- r66-b：VLM 视觉自查离线回归（mock 模板 + route 供应商分派） ----
check "mock-llm 视觉模型"        "mock-vision-pro"                 "mini-services/mock-llm/index.ts"       1
check "mock-llm image_url 处理"  "image_url"                       "mini-services/mock-llm/index.ts"       2
check "route.ts 视觉分派"        "visionWithProvider"              "src/app/api/agent/route.ts"            1

# ---- r66-a：响应头安全硬化 + headless 冒烟门禁 ----
check "响应头 nosniff"             "X-Content-Type-Options"        "next.config.ts"                        1
check "响应头 Permissions-Policy"  "Permissions-Policy"            "next.config.ts"                        1
check "响应头 CSP"                 "Content-Security-Policy"       "next.config.ts"                        1
if [ -f scripts/smoke.sh ] && rg -q --no-messages '"smoke"' package.json 2>/dev/null; then
  echo "PASS  冒烟脚本入 package.json     命中  1（要求 ≥1）"
else
  echo "FAIL  冒烟脚本入 package.json     命中  0（要求 ≥1）—— scripts/smoke.sh 缺失或 package.json 无 \"smoke\" script"
  FAILS=$((FAILS + 1))
fi

# ---- r66-main：大结构内存防护（r65 OOM 事故实锤） ----
check "loader 原子硬上限"        "MAX_ATOMS"                       "src/lib/molecular/loader.ts"           3
check "loader 原子预扫描"        "countAtomRecords"                "src/lib/molecular/loader.ts"           2
check "loader 体积护栏"          "MAX_STRUCTURE_MB|MAX_MAP_MB"     "src/lib/molecular/loader.ts"           4
check "pdb 路由 413 体积护栏"    "oversize|content-length"         "src/app/api/pdb/"                     3
check "sf 路由 413 体积护栏"     "oversize|content-length"         "src/app/api/sf/"                      3

# ---- r67：病态结构防护（残基裂变 / 键爆炸 / 序列条渲染爆炸） ----
check "parser 残基硬上限"        "MAX_RESIDUES"                    "src/lib/molecular/parser.ts"           2
check "parser 键数硬上限"        "MAX_BONDS_PER_ATOM|bondCap"      "src/lib/molecular/parser.ts"           3
check "序列条折叠阈值"           "SEQ_CELL_LIMIT"                  "src/components/studio/SequenceBar.tsx" 3
check "序列条渲染封顶"           "SEQ_CELL_HARD"                   "src/components/studio/SequenceBar.tsx" 4
check "大链折叠行双语"           "大链已折叠.*Large chain collapsed" "src/components/studio/SequenceBar.tsx" 1
check "截断提示双语"             "仅渲染前.*more residues are hidden" "src/components/studio/SequenceBar.tsx" 1

# ---- r68：欢迎页语言切换重设计（轨道驻留开关） ----
check "语言轨道开关滑块探针"     "data-slide"                      "src/components/studio/LanguageToggle.tsx" 2
check "欢迎页浮动语言入口"       "variant=\"welcome\""              "src/components/studio/WelcomeScreen.tsx" 1

# ---- r69：语言控件全应用形态统一（OrbitTrack 四变体）+ 滑块锁定脉冲 + 浮动胶囊工具类 ----
check "语言控件全形态滑轨化"     "OrbitTrack tone="                "src/components/studio/LanguageToggle.tsx" 4
check "滑块锁定脉冲组件接线"     "lang-lock"                       "src/components/studio/LanguageToggle.tsx" 2
check "滑块锁定脉冲样式"         "lang-lock-pulse"                 "src/app/globals.css"              2
check "浮动胶囊工具类定义"       "welcome-float-chip"              "src/app/globals.css"              2
check "浮动胶囊工具类接线"       "welcome-float-chip"              "src/components/studio/WelcomeScreen.tsx" 2

# ---- r70：工具栏移动端溢出收纳（⋯ 菜单）+ 锁定脉冲点击驱动时序 ----
check "溢出收纳菜单触发钮"       "MoreHorizontal"                  "src/components/studio/Toolbar.tsx" 2
check "溢出收纳菜单三入口"       "GitHub 仓库"                     "src/components/studio/Toolbar.tsx" 2
check "锁定脉冲合成器时序"       "650ms ease-out 300ms"            "src/app/globals.css"              1

# ---- r71：论文图复现模板（CNS 图式一键应用） ----
check "论文图模板库数据"         "FIGURE_TEMPLATES|FigureTemplate"  "src/lib/molecular/figure-templates.ts" 3
check "论文图模板卡片对话框"     "FigureTemplatesDialog|TemplateCard" "src/components/studio/FigureTemplatesDialog.tsx" 3
check "论文图模板库开库命令"     "templateOpen: true"              "src/lib/molecular/commands.ts"    1
check "论文图模板工具栏入口"     "templateOpen: true"              "src/components/studio/Toolbar.tsx" 2
check "论文图模板弹窗挂载"       "FigureTemplatesDialog"           "src/app/page.tsx"                 2
check "论文图模板文献溯源"       "10\.1038|10\.1126"              "src/lib/molecular/figure-templates.ts" 3

# ---- r72：轮廓减细 + 模板差异化 + 孔道分析（HOLE 式）+ 脂双层板 ----
check "孔道剖面计算模块"         "HOLE_NARROW|computePoreProfile"  "src/lib/molecular/pore.ts"         4
check "孔道剖面轻量 store"       "usePoreStore"                    "src/lib/molecular"                 4
check "孔道命令注册"             "pore \[封顶Å\]|cmd === 'pore'"   "src/lib/molecular/commands.ts"     2
check "膜板命令注册"             "cmd === 'membrane'"              "src/lib/molecular/commands.ts"     1
check "膜板设置项"               "showMembrane|membraneThickness"  "src/lib/molecular/types.ts"        4
check "引擎孔道环带渲染"         "updatePore"                      "src/lib/molecular/engine.ts"       2
check "引擎脂膜板渲染"           "updateMembrane"                  "src/lib/molecular/engine.ts"       2
check "剖面卡挂载"               "PoreProfile"                     "src/components/molecular/MolViewer.tsx" 2
check "剖面卡分区图例"           "poreZoneColor|HOLE_MAX_GREEN"    "src/components/studio/PoreProfile.tsx" 3
check "模板分类过滤"             "FIGURE_CATEGORIES|category: 'membrane'" "src/lib/molecular/figure-templates.ts" 3
check "模板专属图标"             "TPL_ICONS"                       "src/components/studio/FigureTemplatesDialog.tsx" 2
check "模板差异化配方"           "set cartoon_width|view front|view top|turn y -20" "src/lib/molecular/figure-templates.ts" 4
check0 "轮廓减细（负向：粗线回归即 FAIL）" "outline on 2 2\.5" "src/lib/molecular/figure-templates.ts"
check "发丝描边配方（r76 单像素级）" "outline on 1\.1 1\.0"          "src/lib/molecular/figure-templates.ts" 13

# ---- r73：会话边界体系（修复「新会话泄漏旧视角」——书签/场景 = 会话上下文） ----
check "会话边界判定函数"         "beginFreshSessionIfSkipped"      "src/lib/molecular/session.ts"      1
check "会话边界接线（加载汇点）" "beginFreshSessionIfSkipped"      "src/lib/molecular/loader.ts"      2
check "存档携带书签/场景"        "\.\.\.\(views\.length \? \{ views \} : \{\}\)" "src/lib/molecular/session.ts" 1
check "恢复会话带回书签场景"     "importBookmarks\(data\.views\)|importScenes\(data\.scenes\)" "src/lib/molecular/session.ts" 2
check "新建会话清场景（补漏）"   "useSceneStore\.getState\(\)\.clearScenes" "src/lib/molecular/session.ts" 1
check "场景导入合并（新增能力）" "importScenes|mergeScenes"        "src/lib/molecular/scene-store.ts" 4
check "会话边界恢复日志"         "已随会话恢复|Restored with the session" "src/lib/molecular/session.ts" 1
check "孤儿清理日志"             "已开始新会话：清除|New session started: cleared" "src/lib/molecular/session.ts" 2
check "模板参数化适配层"         "adaptTemplateCommands"           "src/lib/molecular/figure-templates.ts" 2
check "适配层双调用方接线"       "adaptTemplateCommands"           "src/lib/molecular/commands.ts"     2
check "适配说明入日志"           "logAdaptNotes"                   "src/lib/molecular"                 3

# ---- r74：欢迎页 Open-design 重设计（顶栏 + 左 hero/右模板画廊分栏） ----
check "欢迎页画廊数据接线"       "FIGURE_TEMPLATES"                "src/components/studio/WelcomeScreen.tsx" 5
check "欢迎页画廊演示动作"       "demoThenApply"                   "src/components/studio/WelcomeScreen.tsx" 3
check "欢迎页画廊缩略图"         "/templates/"                     "src/components/studio/WelcomeScreen.tsx" 1
check "画廊卡片入场动画定义"     "gallery-card-in"                "src/app/globals.css"              4
check "画廊卡片入场接线"         "gallery-card-in"                "src/components/studio/WelcomeScreen.tsx" 2
check "画廊网格探针"             "data-welcome-gallery"            "src/components/studio/WelcomeScreen.tsx" 1
check "欢迎页顶栏探针"           "data-welcome-topbar"             "src/components/studio/WelcomeScreen.tsx" 1
check "画廊分类过滤接线"         "FIGURE_CATEGORIES"              "src/components/studio/WelcomeScreen.tsx" 2
check "画廊库弹窗入口"           "templateOpen"                    "src/components/studio/WelcomeScreen.tsx" 1

# ---- r75：模板扩容（互作分析）+ 原文图式对比 + 画廊 hover 浮层 ----
check "互作分析分类四模板"       "category: 'interaction'"         "src/lib/molecular/figure-templates.ts" 4
check "五新模板入库"             "salt-bridge-network|hbond-network|dna-protein-complex|domain-coloring|mutation-hotspots" "src/lib/molecular/figure-templates.ts" 5
check "原文图式参考字段"         "figure:"                         "src/lib/molecular/figure-templates.ts" 19
check "命令图鉴表"               "COMMAND_GLOSSARY"                "src/lib/molecular/figure-templates.ts" 3
check "命令图鉴导出"             "export function explainCommand"  "src/lib/molecular/figure-templates.ts" 1
check "对比视图组件"             "ComparePanel"                    "src/components/studio/FigureTemplatesDialog.tsx" 2
check "对比视图探针"             "data-template-compare"           "src/components/studio/FigureTemplatesDialog.tsx" 1
check "对比态管理接线"           "setCompareId"                    "src/components/studio/FigureTemplatesDialog.tsx" 4
check "对比视图接线"             "compareId"                       "src/components/studio/FigureTemplatesDialog.tsx" 2
check "新模板五图标"             "'salt-bridge-network': Zap"      "src/components/studio/FigureTemplatesDialog.tsx" 1
check "画廊 hover 浮层探针"     "data-welcome-tpl-purpose"        "src/components/studio/WelcomeScreen.tsx" 1
check "无配体氢键退避主链"       "hbonds on 3.2 in backbone"       "src/lib/molecular/figure-templates.ts" 1
check "无核酸降级"               "无核酸"                          "src/lib/molecular/figure-templates.ts" 2
check "热点链不匹配降级"         "链不匹配"                        "src/lib/molecular/figure-templates.ts" 3
check "域区间截断说明"           "结构域区间按"                    "src/lib/molecular/figure-templates.ts" 1
check "缩略图管线增量模式"       "filtered mode"                   "scripts/gen-template-thumbs.sh"    1

# ---- r76：清洁缩略图 + 演示居中根治 + 分类细化 + 位点特写扩容 ----
check "分类细化三新类"           "category: 'basic'|category: 'surface'|category: 'site'" "src/lib/molecular/figure-templates.ts" 13
check "位点特写两新模板"         "disulfide-bonds|metal-center"   "src/lib/molecular/figure-templates.ts" 3
check "二新模板图标"             "'disulfide-bonds': Link2"        "src/components/studio/FigureTemplatesDialog.tsx" 1
check "二新模板命令序列"         "show sticks, resn CYS|show spheres, resn ZN" "src/lib/molecular/figure-templates.ts" 2
check "演示居中根治（结构入店+引擎就绪+fit 落地）" "waitForStructureInStore|whenEngineReady|waitForCameraIdle" "src/lib/molecular/figure-templates.ts" 4
check "相机命令串行等飞行"       "CAMERA_CMD_RE"                   "src/lib/molecular/figure-templates.ts" 2
check "金属重映射降级"           "金属中心已重映射"                 "src/lib/molecular/figure-templates.ts" 1
check "无半胱氨酸说明"           "无半胱氨酸"                      "src/lib/molecular/figure-templates.ts" 1
check "管线清洁视口两遍"         "hidden:"                         "scripts/gen-template-thumbs.sh"    2
check "全局默认描边减细"         "outlineThickness: 1\.2"          "src/lib/molecular/types.ts"        1

# ---- r77：hover 重叠修复 + 四新模板 + 选择泄漏根治 + B 因子百分位 ----
check "hover 浮层序号避让（pl-10）" "pl-10 pr-3 pb-9 pt-2.5"    "src/components/studio/WelcomeScreen.tsx" 1
check "四新模板入库"               "cpk-spacefill|mobility-bfactor|heme-pocket|cation-pi" "src/lib/molecular/figure-templates.ts" 5
check "四新模板图标"               "'cpk-spacefill': Shapes"   "src/components/studio/FigureTemplatesDialog.tsx" 1
check "CPK 空间填充命令"           "hide everything"            "src/lib/molecular/figure-templates.ts" 1
check "B 因子热图命令"             "spectrum b, rainbow"        "src/lib/molecular/figure-templates.ts" 2
check "血红素口袋命令"             "resn HEM"                   "src/lib/molecular/figure-templates.ts" 5
check "阳离子-π 接触命令"          "resn PHE\+TYR\+TRP"         "src/lib/molecular/figure-templates.ts" 1
check "辅因子重映射降级"           "辅因子已重映射"              "src/lib/molecular/figure-templates.ts" 1
check "全零 B 因子跳过"            "B 因子全为零"                "src/lib/molecular/figure-templates.ts" 1
check "选择泄漏修复（恢复器）"     "function restoreSelection"  "src/lib/molecular/commands.ts" 1
check "color 命令恢复选择"         "restoreSelection\(prevSel\)" "src/lib/molecular/commands.ts" 3
check "模板收尾清选择"             "s\.setSelection\(null, \[\]\)" "src/lib/molecular/figure-templates.ts" 1
check "B 因子百分位归一"           "polyB\.sort\(\(a, b\) => a - b\)" "src/lib/molecular/colors.ts" 1
check "图鉴新词条（阳离子-π/CPK）" "阳离子-π 接触虚线|全原子空间填充球" "src/lib/molecular/figure-templates.ts" 2
check "期刊类型拓宽"               "journal: string"            "src/lib/molecular/figure-templates.ts" 1
check "管线四新缩略图"             "cpk-spacefill:10:1CRN:19"   "scripts/gen-template-thumbs.sh" 1
check "mobility 演示换 3INS"       "mobility-bfactor:10:3INS:20" "scripts/gen-template-thumbs.sh" 1

# ---- 汇总 ----
TOTAL=129
if [ "$FAILS" -eq 0 ]; then
  echo "== 结果：PASS（$TOTAL/$TOTAL 守卫全部通过） =="
  exit 0
else
  echo "== 结果：FAIL（$FAILS/$TOTAL 守卫失败——对应 r60/r63 修复疑被回滚，或守卫正则需更新） =="
  exit 1
fi
