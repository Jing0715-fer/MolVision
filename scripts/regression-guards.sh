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
PASSES=0

# check <名称> <rg 正则> <路径> <最小命中数>
# rg -c 多文件输出 "path:count"、单文件输出裸 "count"，两种形态按末字段求和；
# rg 无命中退出码 1 且无输出 → 计 0（--no-messages 抑制路径缺失等 stderr）
check() {
  local name="$1" pattern="$2" path="$3" min="$4"
  local count
  count=$(rg -c --no-messages -e "$pattern" -- "$path" 2>/dev/null | awk -F: '{s+=$NF} END {print s+0}')
  if [ "${count:-0}" -ge "$min" ]; then
    printf 'PASS  %-34s 命中 %2d（要求 ≥%d）\n' "$name" "$count" "$min"
    PASSES=$((PASSES + 1))
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
    # r101-rev-c：PASS 分支补 PASSES 自增——r60 起的历史缺口（实跑 529 条上报 517，
    # 指标失真；exit 码语义不受影响但守卫总数应反映真实执行量）
    PASSES=$((PASSES + 1))
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

# ---- r68：欢迎页语言切换重设计（轨道驻留开关；r80 入口去重） ----
check "语言轨道开关滑块探针"     "data-slide"                      "src/components/studio/LanguageToggle.tsx" 2
check "页脚语言入口（r80 唯一）"  "variant=\"default\""              "src/components/studio/WelcomeScreen.tsx" 1

# ---- r69：语言控件滑轨形态 + 滑块锁定脉冲 + 浮动胶囊工具类 ----
check "语言控件滑轨化（双变体）" "OrbitTrack tone="                "src/components/studio/LanguageToggle.tsx" 2
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
check "欢迎页画廊数据接线"       "FIGURE_TEMPLATES"                "src/components/studio/WelcomeScreen.tsx" 2
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
check "规格 cpk-spacefill"          "cpk-spacefill:10:1CRN:19"   "scripts/template-specs.sh" 1
check "规格 mobility 3INS"          "mobility-bfactor:10:3INS:20" "scripts/template-specs.sh" 1

# ---- r78：构象与动力学分类 + 两态对比落地 + 幽灵表面 + 催化测量 + 顺序执行器 ----
check "conform 新分类"              "category: 'conform'"           "src/lib/molecular/figure-templates.ts" 4
check "分类七 chips"                "'conform', label"               "src/lib/molecular/figure-templates.ts" 1
check "四新模板入库"                "conformational-morph|two-state-comparison|ghost-surface|catalytic-residues" "src/lib/molecular/figure-templates.ts" 6
check "四新模板图标"                "'conformational-morph': Orbit"  "src/components/studio/FigureTemplatesDialog.tsx" 1
check "morph 命令序列"              "morph m1 = openA closedA 40"    "src/lib/molecular/figure-templates.ts" 1
check "两态幽灵叠合序列"            "superpose gtpA onto gdpA"       "src/lib/molecular/figure-templates.ts" 1
check "催化测量命令"                "measure dist \(resi 35 and name OE2\)" "src/lib/molecular/figure-templates.ts" 1
check "顺序执行器（load 门控）"     "runTemplateCommandsSeq"         "src/lib/molecular/figure-templates.ts" 2
check "load 等结构入店"             "LOAD_CMD_RE"                    "src/lib/molecular/figure-templates.ts" 2
check "disable/enable 命令"         "cmd === 'disable' || cmd === 'enable'" "src/lib/molecular/commands.ts" 1
check "disable 帮助词条"            "disable\|enable \[名\]"         "src/lib/molecular/commands.ts" 1
check "⑬ 构象对补齐降级"            "构象对已按演示结构补齐"          "src/lib/molecular/figure-templates.ts" 2
check "⑭ 催化位点跳过"              "催化位点按溶菌酶演示"            "src/lib/molecular/figure-templates.ts" 2
check "图鉴新词条（morph/测量）"    "构象插值轨迹生成|催化距离虚线标注" "src/lib/molecular/figure-templates.ts" 2
check "幽灵表面无 orient（负向）"   "util cbc', 'bg #eef1f5'\],"      "src/lib/molecular/figure-templates.ts" 1
check "规格 conformational-morph"   "conformational-morph:24:4AKE:23" "scripts/template-specs.sh" 1
check "规格 two-state"              "two-state-comparison:20:4Q21:24" "scripts/template-specs.sh" 1
check "体检脚本资产"                "health-check-templates.sh"      "scripts/health-check-templates.sh" 1
check "体检状态翻转等待"            "backgroundPinned"               "scripts/health-check-templates.sh" 1

# ---- r79：图片上传 → AI 解析 → 自定义模板 ----
check "模板解析 API 路由"        "图式解析失败"                  "src/app/api/templates/parse/route.ts" 1
check "VLM 供应商分派+ZAI 兜底"  "visionWithProvider"            "src/app/api/templates/parse/route.ts" 2
check "草案协议清洗"             "sanitizeTemplateDraft"         "src/app/api/templates/parse/route.ts" 2
check "命令白名单闸"             "sanitizeTemplateCommands"      "src/app/api/templates/parse/route.ts" 1
check "图片体积上限"             "5 \* 1024 \* 1024"             "src/app/api/templates/parse/route.ts" 1
check "guard 纯函数库"           "TEMPLATE_VERBS"                "src/lib/molecular/template-command-guard.ts" 2
check "注入字符集拦截"           "SEL_CHARS"                     "src/lib/molecular/template-command-guard.ts" 2
check "set 等号归一"             "normalizeCommand"              "src/lib/molecular/template-command-guard.ts" 2
check "模板草案共享类型"         "TemplateDraft"                 "src/lib/molecular/template-command-guard.ts" 1
check "自定义模板存储库"         "customTemplates.v1"            "src/lib/molecular/custom-templates.ts" 2
check "存储侧字段防线"           "sanitizeStoredTemplate"        "src/lib/molecular/custom-templates.ts" 2
check "上限 20 张 LRU"           "MAX_CUSTOM"                    "src/lib/molecular/custom-templates.ts" 2
check "React 订阅钩子"           "useCustomTemplates"            "src/lib/molecular/custom-templates.ts" 2
check "存储配额韧性"             "QuotaExceededError"            "src/lib/molecular/custom-templates.ts" 1
check "上传面板三态流"           "phase === 'picked' \|\| phase === 'parsing'" "src/components/studio/FigureTemplatesDialog.tsx" 1
check "审核表单"                 "data-upload-commands"          "src/components/studio/FigureTemplatesDialog.tsx" 1
check "保存动作"                 "data-upload-save"              "src/components/studio/FigureTemplatesDialog.tsx" 1
check "上传入口按钮"             "data-open-upload"              "src/components/studio/FigureTemplatesDialog.tsx" 1
check "弹窗监听上传事件"         "open-template-upload"          "src/components/studio/FigureTemplatesDialog.tsx" 1
check "自定义卡片删除"           "removeCustomTemplate"          "src/components/studio/FigureTemplatesDialog.tsx" 2
check "我的模板过滤 chip"        "我的模板"                      "src/components/studio/FigureTemplatesDialog.tsx" 2
check "欢迎页创建入口"           "data-welcome-create-template" "src/components/studio/WelcomeScreen.tsx" 1
check "欢迎页画廊合并自定义"     "allTemplates"                  "src/components/studio/WelcomeScreen.tsx" 3
check "欢迎页我的 chip"          "data-welcome-mine-chip"        "src/components/studio/WelcomeScreen.tsx" 1
check "自定义缩略图 dataURL"     "tpl.thumb"                     "src/components/studio/FigureTemplatesDialog.tsx" 1
check "mock 模板解析分支"        "论文图模板解析"                "mini-services/mock-llm/index.ts" 2
check "mock 剔除实证命令"        "make everything beautiful"     "mini-services/mock-llm/index.ts" 1
check "模板图式解析提示词"       "论文图模板解析"                "src/app/api/templates/parse/route.ts" 1
check "图式模板 custom 字段"     "custom\?: true"               "src/lib/molecular/figure-templates.ts" 1

# ---- r80：语言入口去重（用户指令：只保留右下角） + 欢迎页左舱打磨 ----
check0 "顶栏语言入口已删（负向）" "variant=\"welcome\"|variant=\"toolbar\"" "src/components/studio/"
check0 "Toolbar 语言开关已删（负向）" "LanguageToggle"              "src/components/studio/Toolbar.tsx"
check "状态栏语言入口保留"       "variant=\"status\""              "src/components/studio/StatusBar.tsx" 1
check "hero 主色晕染"            "radial-gradient\(circle,color-mix" "src/components/studio/WelcomeScreen.tsx" 1
check "遥测读数板（动态模板数）" "\{allTemplates.length\}"       "src/components/studio/WelcomeScreen.tsx" 1
check "遥测读数板标签"           "图式模板.*Figure styles"        "src/components/studio/WelcomeScreen.tsx" 1
check "加载舱面板"               "或本地文件.*or local file"      "src/components/studio/WelcomeScreen.tsx" 1
check "示例卡 desc 副行上屏"     "t\(ex\.desc\)"                  "src/components/studio/WelcomeScreen.tsx" 1
check "示例双列卡片栅格（r87 收紧）" "mt-3 grid w-full grid-cols-2 gap-2 sm:mt-3\.5" "src/components/studio/WelcomeScreen.tsx" 1

# ---- r81：全面代码审查缺口修复——路由级错误边界 ----
check "路由错误边界文件"         "RouteError"                     "src/app/error.tsx"                 2
check "错误边界复位动作"         "onClick=\{reset\}"               "src/app/error.tsx"                 1
check "错误边界硬重启"           "location.reload"                "src/app/error.tsx"                 1
check "错误边界双语"             "仪器遇到临时故障.*temporary instrument fault" "src/app/error.tsx"      1
check "错误边界故障码透传"       "error.digest"                   "src/app/error.tsx"                 2

# ---- r82：UGC 三件套补齐「编辑」 + 导入导出 JSON ----
check "更新存储库函数"           "updateCustomTemplate"           "src/lib/molecular/custom-templates.ts" 1
check "更新命令重过闸"           "INVALID_COMMANDS"               "src/lib/molecular/custom-templates.ts" 2
check "导出 bundle 协议"         "kind: 'custom-templates'"        "src/lib/molecular/custom-templates.ts" 1
check "导入合并统计"             "importCustomTemplates"          "src/lib/molecular/custom-templates.ts" 1
check "导入脏条目跳过"           "skipped\+\+"                    "src/lib/molecular/custom-templates.ts" 1
check "卡片编辑入口"             "data-open-edit"                 "src/components/studio/FigureTemplatesDialog.tsx" 1
check "编辑模式预填"             "templateToDraft"                "src/components/studio/FigureTemplatesDialog.tsx" 2
check "保存修改文案"             "保存修改.*Save changes"         "src/components/studio/FigureTemplatesDialog.tsx" 1
check "编辑模式禁粘贴"           "editMode \|\| phase !== 'idle' && phase !== 'picked'\) return"  "src/components/studio/FigureTemplatesDialog.tsx" 1
check "编辑视图接线"             "view === 'edit' && editTpl"     "src/components/studio/FigureTemplatesDialog.tsx" 1
check "导入入口按钮"             "data-import-templates"          "src/components/studio/FigureTemplatesDialog.tsx" 1
check "导出入口按钮"             "data-export-templates"          "src/components/studio/FigureTemplatesDialog.tsx" 1
check "导入文件读取"             "f\.text\(\)"                    "src/components/studio/FigureTemplatesDialog.tsx" 1
check "导出文件下载"             "URL\.createObjectURL"           "src/components/studio/FigureTemplatesDialog.tsx" 1
check "导入体积上限"             "4 \* 1024 \* 1024"              "src/components/studio/FigureTemplatesDialog.tsx" 1

# ---- r83：审查修复（订阅挂载失效 + 保存 NOT_FOUND 归因） ----
check "订阅挂载失效"             "挂载即失效"                     "src/lib/molecular/custom-templates.ts" 1
check "订阅失效重读"             "cache = null"                  "src/lib/molecular/custom-templates.ts" 3
check "保存NOT_FOUND归因"        "NOT_FOUND"                     "src/components/studio/FigureTemplatesDialog.tsx" 2

# ---- r84：对照预览分屏（读命令 → 看效果） ----
check "对照预览组件"             "data-template-preview"         "src/components/studio/TemplatePreview.tsx" 1
check "预览CTA"                  "data-preview-cta"              "src/components/studio/TemplatePreview.tsx" 1
check "过期横幅"                 "data-preview-stale"            "src/components/studio/TemplatePreview.tsx" 1
check "快路径同步探测"           "export function isStructureInStore" "src/lib/molecular/figure-templates.ts" 1
check "探测接线"                 "isStructureInStore"            "src/components/studio/TemplatePreview.tsx" 2
check "管线可等待"               "runTemplateCommands\(commands: string\[\]\): Promise<void>" "src/lib/molecular/figure-templates.ts" 1
check "相机门控导出"             "export async function waitForCameraIdle" "src/lib/molecular/figure-templates.ts" 1
check "快照截取"                 "capture\(\{ scale: 1\.5 \}\)"   "src/components/studio/TemplatePreview.tsx" 1
check "审核表单接线"             "TemplatePreview"               "src/components/studio/FigureTemplatesDialog.tsx" 2

# ---- r85：会话分享链接（轻量快照 → URL #s=base64url）+ 画廊卡直编入口 ----
check "分享模块存在"             "export function buildShareLink" "src/lib/molecular/share-link.ts" 1
check "分享解码器"               "export function decodeShareLink" "src/lib/molecular/share-link.ts" 1
check "分享应用恢复"             "export async function applyShareSnapshot" "src/lib/molecular/share-link.ts" 1
check "启动消费幂等"             "export async function consumeShareLinkOnBoot" "src/lib/molecular/share-link.ts" 1
check "快照体积上限"             "SHARE_LIMIT"                   "src/lib/molecular/share-link.ts" 2
check "本地结构诚实计数"         "skippedLocal"                  "src/lib/molecular/share-link.ts" 6
check "接收端重拉管线"           "api/pdb/"                      "src/lib/molecular/share-link.ts" 1
check "启动清hash防循环"         "history\.replaceState"         "src/lib/molecular/share-link.ts" 1
check "恢复核心参数化"           "export function restoreSessionData" "src/lib/molecular/session.ts" 1
check "书签缩略图剥离"           "thumb: null as null"           "src/lib/molecular/share-link.ts" 1
check "选择集体积护栏"           "SEL_INDICES_LIMIT"             "src/lib/molecular/share-link.ts" 2
check "工具栏分享入口"           "data-qa=\"share-link-item\""   "src/components/studio/Toolbar.tsx" 1
check "面板分享按钮"             "data-qa=\"share-link-panel\""  "src/components/studio/panels/ScenePanel.tsx" 1
check "统一复制入口"             "copyShareLinkToClipboard"      "src/components/studio/Toolbar.tsx" 1
check "启动接线"                 "consumeShareLinkOnBoot"        "src/app/page.tsx" 1
check "命令行share"              "sub === 'share' \|\| sub === 'link'" "src/lib/molecular/commands.ts" 1
check "面板快速动作"             "qa-session-share"              "src/components/studio/CommandPalette.tsx" 2
check "画廊卡管理排"             "data-welcome-tpl-edit"         "src/components/studio/WelcomeScreen.tsx" 1
check "画廊编辑广播"             "open-template-edit"            "src/components/studio/WelcomeScreen.tsx" 1
check "编辑广播监听"             "open-template-edit"            "src/components/studio/FigureTemplatesDialog.tsx" 1

# ---- r86：分享链接发现性（粘贴卡 + 文本提取）+ 低优先打磨（箭头光学居中 / CommandDialog DOM 残留 / 面板直填） ----
check "粘贴提取器"               "export function extractShareSnapshotFromText" "src/lib/molecular/share-link.ts" 1
check "粘贴文本应用入口"         "export async function applyShareLinkFromText" "src/lib/molecular/share-link.ts" 1
check "非锚定提取正则"           "#s=\(\[A-Za-z0-9_-\]\{16,\}\)" "src/lib/molecular/share-link.ts" 1
check "共享解析核心"             "function parseSharePayload"      "src/lib/molecular/share-link.ts" 1
check "粘贴卡组件"               "data-qa=\"share-load-card\""    "src/components/studio/ShareLinkLoadCard.tsx" 1
check "粘贴卡输入钩子"           "data-qa=\"share-link-input\""   "src/components/studio/ShareLinkLoadCard.tsx" 1
check "粘贴卡提交钩子"           "data-qa=\"share-load-apply\""   "src/components/studio/ShareLinkLoadCard.tsx" 1
check "剪贴板降级引导"           "Ctrl\+V / ⌘V 粘贴"            "src/components/studio/ShareLinkLoadCard.tsx" 1
check "欢迎页接线"               "ShareLinkLoadCard"              "src/components/studio/WelcomeScreen.tsx" 1
check "会话区容器"               "mt-6 flex w-full flex-col gap-2\.5 sm:mt-9" "src/components/studio/WelcomeScreen.tsx" 1
check "面板子命令直填"           "fill: 'session share'"          "src/components/studio/CommandPalette.tsx" 1
check "箭头光学居中"             "-translate-y-px"                "src/components/studio/SessionResumeCard.tsx" 1
check "CommandDialog标题入栈"   "DialogContent"                 "src/components/ui/command.tsx" 3

# ---- r87：窄屏密度重构（速览条 + 响应式收紧 + chips 横滑）+ 同类异风模板五连 + 分享卡窄输入 + 管线表单锚定修复 ----
check "墨夜封面模板（明暗对）"    "id: 'ink-night-cover'"         "src/lib/molecular/figure-templates.ts" 1
check "球棍化学模板（键连对）"    "id: 'ballstick-chemistry'"     "src/lib/molecular/figure-templates.ts" 1
check "红蓝立体模板（印刷对）"    "id: 'stereo-anaglyph'"         "src/lib/molecular/figure-templates.ts" 1
check "胖瘦管模板（管径对）"      "id: 'putty-flexibility'"       "src/lib/molecular/figure-templates.ts" 1
check "切层剖面模板（剖切对）"    "id: 'slab-cutaway'"            "src/lib/molecular/figure-templates.ts" 1
check "图鉴 r87 新词条"           "红蓝立体渲染（双通道色分移）"  "src/lib/molecular/figure-templates.ts" 1
check "hero 响应式收紧"           "px-3 pb-6 pt-7 sm:max-w-\[368px\] sm:px-6 sm:pt-9" "src/components/studio/WelcomeScreen.tsx" 1
check "画廊 chips 横滑"           "mol-toolbar-scroll ml-auto"   "src/components/studio/WelcomeScreen.tsx" 1
check "分享卡窄屏图标化提交"      "w-9 shrink-0"                  "src/components/studio/ShareLinkLoadCard.tsx" 1
check "规格 ink-night-cover"        "ink-night-cover:11:4HHB:27"   "scripts/template-specs.sh" 1
check "管线表单锚定修复"          "closest\('form'\)"            "scripts/gen-template-thumbs.sh" 1
check "版本升级 1.6"              "v1\.6"                          "src/components/studio/WelcomeScreen.tsx" 2

# ---- r89：窄屏画廊去重重构（分类横滚行 + 画廊上移）+ 多风格新五连 + 缩略图内容收紧管线 ----
check0 "速览条退役（零残留）"      "WELCOME_TEASER_IDS"            "src/components/studio/WelcomeScreen.tsx"
check0 "速览条探针零残留"          "data-welcome-teaser"            "src/components/studio/WelcomeScreen.tsx"
check "左栏 display:contents 载体" "\[display:contents\] lg:flex" "src/components/studio/WelcomeScreen.tsx" 1
check "part1 表单舱 order-1"      "order-1 mx-auto flex w-full flex-col items-center px-3" "src/components/studio/WelcomeScreen.tsx" 1
check "part2 示例舱 order-3"      "order-3 mx-auto flex w-full flex-col items-center px-3" "src/components/studio/WelcomeScreen.tsx" 1
check "画廊 order-2 上移"         "mol-scroll order-2 flex w-full" "src/components/studio/WelcomeScreen.tsx" 1
check "分类横滚行容器"            "data-welcome-cat-rows"         "src/components/studio/WelcomeScreen.tsx" 1
check "分类行渲染探针"            "data-welcome-cat-row"          "src/components/studio/WelcomeScreen.tsx" 2
check "行卡渲染探针"              "data-welcome-row-card"         "src/components/studio/WelcomeScreen.tsx" 1
check "行头查看全部按钮"          "data-welcome-row-all"          "src/components/studio/WelcomeScreen.tsx" 1
check "行卡组件"                  "function RowCard"              "src/components/studio/WelcomeScreen.tsx" 1
check "紧凑缩略图组件"            "function CompactThumb"         "src/components/studio/WelcomeScreen.tsx" 1
check "过滤网格条件渲染"          "filter === 'all'"              "src/components/studio/WelcomeScreen.tsx" 3
check "紧凑卡 2 列网格"           "'grid grid-cols-2 xl:grid-cols-3'" "src/components/studio/WelcomeScreen.tsx" 1
check "信息条 <sm 隐藏溯源"       "mt-1\.5 hidden items-center gap-1\.5 sm:flex" "src/components/studio/WelcomeScreen.tsx" 1
check "线描骨架模板"              "id: 'wire-skeleton'"           "src/lib/molecular/figure-templates.ts" 1
check "黑白制版模板"              "id: 'grayscale-print'"         "src/lib/molecular/figure-templates.ts" 1
check "红蓝静电模板"              "id: 'electrostatic-surface'"   "src/lib/molecular/figure-templates.ts" 1
check "水合壳层模板"              "id: 'hydration-shell'"         "src/lib/molecular/figure-templates.ts" 1
check "晶胞语境模板"              "id: 'unit-cell-context'"       "src/lib/molecular/figure-templates.ts" 1
check "静电中性底修正"            "color gray', 'color red"       "src/lib/molecular/figure-templates.ts" 1
check "弱模板取景收紧三连"        "zoom 1\.5"                     "src/lib/molecular/figure-templates.ts" 2
check "线描取景收紧"              "zoom 1\.6"                     "src/lib/molecular/figure-templates.ts" 1
check "图鉴 r89 新词条"           "线框全原子表示"                "src/lib/molecular/figure-templates.ts" 1
check "图鉴水合词条"              "水分子小球显示"                "src/lib/molecular/figure-templates.ts" 1
check "图鉴晶胞词条"              "晶胞盒线框（a红 b绿 c蓝）"    "src/lib/molecular/figure-templates.ts" 1
check "图标 r89 五新键"           "'wire-skeleton': Waypoints"    "src/components/studio/FigureTemplatesDialog.tsx" 1
check "图标水合键"                "'hydration-shell': Droplets"   "src/components/studio/FigureTemplatesDialog.tsx" 1
check "规格 wire-skeleton"          "wire-skeleton:10:1CRN:32"      "scripts/template-specs.sh" 1
check "管线高清视口"              "set viewport 1920 960"         "scripts/gen-template-thumbs.sh" 2
check "缩略图内容收紧脚本"        "content_bbox"                  "scripts/tighten-thumbs.py" 2

# ---- r90：窄屏 hero 全宽化（解除 <sm 368px 盒宽 + px-5→px-3 六处同步）+ 过滤网格返回入口（r89 建议①） ----
check "画廊头 <sm 收紧"          "px-3 py-3.5 sm:px-7"          "src/components/studio/WelcomeScreen.tsx" 1
check "分类行头 <sm 收紧"        "px-3 pt-4 sm:px-7"            "src/components/studio/WelcomeScreen.tsx" 1
check "分类横滚行 <sm 收紧"      "px-3 pb-1\.5 pt-2 sm:px-7"    "src/components/studio/WelcomeScreen.tsx" 1
check "画廊网格容器 <sm 收紧"    "px-3 pb-6 pt-4 sm:px-7"       "src/components/studio/WelcomeScreen.tsx" 1
check "过滤网格返回入口"          "data-welcome-back-rows"        "src/components/studio/WelcomeScreen.tsx" 1
check "返回入口仅 <lg"            "返回分类浏览"                  "src/components/studio/WelcomeScreen.tsx" 1
check "返回入口 ArrowLeft 图标"   "ArrowLeft"                    "src/components/studio/WelcomeScreen.tsx" 1

# ---- r91：旋转限位解除（orbitClamp 默认 false + 引擎全开分支）+ 膜模板钢蓝修正 + 线描深墨 + ss 取景收紧 ----
check "俯仰限位默认解除"          "orbitClamp: false"             "src/lib/molecular/types.ts" 1
check "引擎限位全开分支"          "orbitClamp === false"          "src/lib/molecular/engine.ts" 1
check "限位开关 UI 保留"          "settings.orbitClamp}"           "src/components/studio/panels/ScenePanel.tsx" 1
check "膜模板钢蓝单色"            "color #94a9c0"                 "src/lib/molecular/figure-templates.ts" 1
check "线描主侧链两级"            "color #79818b"                 "src/lib/molecular/figure-templates.ts" 1
check "ss 基元取景收紧"           "turn y -20', 'zoom 1.5"        "src/lib/molecular/figure-templates.ts" 1
check "跨域回环白名单"            "127.0.0.1"                     "next.config.ts" 1

# ---- r92：旋转毒化根治（存档恢复强制解限）+ 膜模板几何五层修复 + 表面引擎域映射根治 + 取景一致性 + 剖面模板重造 + 管线防陈旧 ----
check "存档恢复解除俯仰限位"      "orbitClamp: false"             "src/lib/molecular/session.ts" 1
check "膜模板确定性侧视对"        "'orient polymer', 'turn z 90'" "src/lib/molecular/figure-templates.ts" 2
check "膜模板隐藏配体云"          "'preset surface', 'hide ballstick'" "src/lib/molecular/figure-templates.ts" 1
check "膜板盒中定心（对称板缘）"  "const uc = \(uLo \+ uHi\) / 2" "src/lib/molecular/engine.ts" 1
check "表面 MC 域映射根治（2×镜像偏移）" "mc.scale.set\(L / 2, L / 2, L / 2\)" "src/lib/molecular/representations.ts" 1
check "取景尊重隐藏水"            "skipWater"                     "src/lib/molecular/engine.ts" 3
check "剖面模板空间填充重造"      "'preset spacefill', 'hide waters'" "src/lib/molecular/figure-templates.ts" 1
check "管线截图防陈旧重试"        "rm -f ..tmp/r72-.id.raw.png"   "scripts/gen-template-thumbs.sh" 1
check "规格 slab-cutaway 视口档"   "slab-cutaway:35:4HHB:31:800x450" "scripts/template-specs.sh" 1

# ---- r93：极点钉死死区根治（过极翻转 wrap + 极点微推）——「转到一定程度转不动」终修（r96 输入奇偶随刚体化退役）----
check "过极翻转守卫方法"          "private wrapPoleGuard"        "src/lib/molecular/engine.ts" 1
check "翻转位置连续数学"          "TMP_ORBIT_S.theta \+= Math.PI" "src/lib/molecular/engine.ts" 1
check "钉死带窄带宽 0.4°"         "degToRad\(0.4\)"                "src/lib/molecular/engine.ts" 1
check "极点微推方法"              "nudgeOffPoleOnRotateStart"    "src/lib/molecular/engine.ts" 2
check "翻转紧随 update 防钳制帧"  "this.wrapPoleGuard()"         "src/lib/molecular/engine.ts" 1

# ---- r96：刚体过极（up 随 R_min 滚转 + 轨道基即时换新）——「转到一个位置突然偏转 180°（坐标轴 gizmo 同翻）」终修 ----
check "刚体过极 up 滚转"          "up.applyQuaternion\(TMP_POLE_Q\)" "src/lib/molecular/engine.ts" 2
check "刚体最小旋转构造"          "TMP_POLE_Q.setFromUnitVectors"    "src/lib/molecular/engine.ts" 2
check0 "输入奇偶全退役"           "poleParity"                        "src/lib/molecular/engine.ts"

# ---- r94：膜残留根治 + 轨道基随 up（「模板有转动限制/双层膜到处出现」双主诉终修） ----
check "轨道基随up同步方法"        "private syncOrbitFrame"       "src/lib/molecular/engine.ts" 1
check "同步调用点（r96 增 wrap/nudge）" "this.syncOrbitFrame()"   "src/lib/molecular/engine.ts" 5
check "轨道基追踪字段"            "orbitFrameUp"                 "src/lib/molecular/engine.ts" 3
check "极点机件换up基"            "frameQ"                       "src/lib/molecular/engine.ts" 10
check "基向量退化守卫"            "right.set\(-dir.z, 0, dir.x\)" "src/lib/molecular/engine.ts" 1
check "rock绕视角up摆动"          "applyAxisAngle\(cam.up"       "src/lib/molecular/engine.ts" 1
check "膜复位load汇点"            "showMembrane: false"          "src/lib/molecular/loader.ts" 1
check "书签栏指针穿透容器"        "pointer-events-none absolute right-3 top-1/2" "src/components/studio/ViewBar.tsx" 1
check "书签可交互件恢复指针"      "pointer-events-auto"          "src/components/studio/ViewBar.tsx" 3


# ---- r95：膜结构旋转手感双修（拖拽期 hover 拾取抑制 + 膜板 FrontSide/取景并入膜盒）----
check "拖拽窗口标记字段"          "private pointerDragging"      "src/lib/molecular/engine.ts" 1
check "拖拽期hover抑制分支"      "if \(this.pointerDragging\) \{" "src/lib/molecular/engine.ts" 1
check "hover转换才派发null"      "else if \(this.hoverShown\)" "src/lib/molecular/engine.ts" 1
check "按下开窗拖拽窗口"          "this.pointerDragging = true"  "src/lib/molecular/engine.ts" 1
check "指针取消收尾监听"          "onPointerCancelDrag"          "src/lib/molecular/engine.ts" 3
check "膜板AABB字段"             "private membraneBox"           "src/lib/molecular/engine.ts" 1
check "膜板FrontSide材质"        "side: THREE.FrontSide"         "src/lib/molecular/engine.ts" 1
check "膜AABB落档更新"            "setFromObject\(this.membraneGroup\)" "src/lib/molecular/engine.ts" 1
check "膜关清AABB"                "this.membraneBox = null"       "src/lib/molecular/engine.ts" 3
check "全景取景并入膜盒"          "if \(!refs \|\| !refs.length\)" "src/lib/molecular/engine.ts" 1
check "orient取景并入膜盒"        "const mb = this.membraneBox"   "src/lib/molecular/engine.ts" 2
check "拖拽期冻结视口可见性"      "if \(this.pointerDragging\) return" "src/lib/molecular/engine.ts" 1

# ---- r92（变基调和版）：双层膜 activate 路径复位（r94 loader 汇点复位的结构切换补全）+ Radix hydration 挂载守卫 ----
# r92 独立发现与 r93-95 并行：engine 侧倾斜 up 根修由 r94 syncOrbitFrame 优胜实现（保留滚转构图，
# 拖拽语义恒屏幕正确）——本侧保留 r94 未覆盖的两件：①activate 切换已载结构时膜残留（updateMembrane
# key 含 activeId，切到可溶蛋白按主轴回退 bogus 双板）②CommandPalette Radix useId SSR/CSR 错位
check "加载复位膜开关"          "settings: \{ \.\.\.s\.settings, showMembrane: false \}" "src/lib/molecular/store.ts" 1
check "切换复位膜开关"          "s\.settings\.showMembrane \? \{ \.\.\.s\.settings, showMembrane: false \}" "src/lib/molecular/store.ts" 1
check "面板挂载守卫"            "const mounted = useSyncExternalStore" "src/components/studio/CommandPalette.tsx" 1
check "面板挂载条件渲染"        "\{mounted && \("               "src/components/studio/CommandPalette.tsx" 1

# ---- r97：风格九连模板（风格矩阵六 + 实用三）+ 图片解析精度三件套（色彩证据 + 两段式精修 + 渲染校准回路） ----
check "影院聚光模板"            "id: 'cinematic-spotlight'"     "src/lib/molecular/figure-templates.ts" 1
check "黑板粉笔模板"            "id: 'chalk-wireframe'"         "src/lib/molecular/figure-templates.ts" 1
check "马卡龙柔色模板"          "id: 'pastel-macaron'"          "src/lib/molecular/figure-templates.ts" 1
check "双色海报模板"            "id: 'duotone-poster'"          "src/lib/molecular/figure-templates.ts" 1
check "复古棕印模板"            "id: 'sepia-vintage'"           "src/lib/molecular/figure-templates.ts" 1
check "赛博霓虹模板"            "id: 'neon-night'"              "src/lib/molecular/figure-templates.ts" 1
check "教科书标注模板"          "id: 'textbook-annotated'"      "src/lib/molecular/figure-templates.ts" 1
check "核小体模板"              "id: 'nucleosome-dna'"          "src/lib/molecular/figure-templates.ts" 1
check "GFP荧光模板"             "id: 'gfp-chromophore'"         "src/lib/molecular/figure-templates.ts" 1
check "影院聚光灯光三连"        "set direct 0\.9"               "src/lib/molecular/figure-templates.ts" 1
check "黑板板书底色"            "bg #20362c"                    "src/lib/molecular/figure-templates.ts" 1
check "马卡龙链对色"            "color #eeb1c4, chain A\+C"     "src/lib/molecular/figure-templates.ts" 1
check "核酸彩虹选择域"          "spectrum count, rainbow, nucleic" "src/lib/molecular/figure-templates.ts" 1
check "GFP色素直选"             "zoom \(resn CRO\), 12"         "src/lib/molecular/figure-templates.ts" 1
check "图鉴r97灯光词条"         "定向主光增强"                  "src/lib/molecular/figure-templates.ts" 1
check "图鉴r97链对词条"         "链对主题色分配"                "src/lib/molecular/figure-templates.ts" 1
check "图标r97九新键"           "'cinematic-spotlight': Drama"  "src/components/studio/FigureTemplatesDialog.tsx" 1
check "图标核小体键"            "'nucleosome-dna': Disc"        "src/components/studio/FigureTemplatesDialog.tsx" 1
check "图标GFP键"               "'gfp-chromophore': FlaskConical" "src/components/studio/FigureTemplatesDialog.tsx" 1
check "规格 nucleosome-dna"         "nucleosome-dna:12:1AOI:44"     "scripts/template-specs.sh" 1
check "色彩证据类型"            "export interface ParseImageHints" "src/components/studio/FigureTemplatesDialog.tsx" 1
check "色彩证据提取函数"        "async function extractImageHints" "src/components/studio/FigureTemplatesDialog.tsx" 1
check "解析上行hints"            "body: JSON\.stringify\(\{ image: img\.dataUrl, hints \}\)" "src/components/studio/FigureTemplatesDialog.tsx" 1
check "复检精修卡渲染"          "复检精修 · 已采纳修正"          "src/components/studio/FigureTemplatesDialog.tsx" 1
check "解析阶段精修轮播"        "复检精修：逐维对照原图修正命令" "src/components/studio/FigureTemplatesDialog.tsx" 1
check "服务端hints清洗"         "function sanitizeHints"        "src/app/api/templates/parse/route.ts" 1
check "服务端两段式精修"        "function sanitizeRefine"       "src/app/api/templates/parse/route.ts" 1
check "服务端精修提示词"        "复检精修"                      "src/app/api/templates/parse/route.ts" 2
check "校准路由存在"            "渲染校准"                      "src/app/api/templates/calibrate/route.ts" 2
check "校准组件"                "function CalibrationPanel"     "src/components/studio/FigureTemplatesDialog.tsx" 1
check "校准面板挂载"            "data-calibration-panel"        "src/components/studio/FigureTemplatesDialog.tsx" 1
check "校准采纳回写"            "data-calibration-accept"       "src/components/studio/FigureTemplatesDialog.tsx" 1
check "校准双图上行"            "target: targetJ, render: renderJ" "src/components/studio/FigureTemplatesDialog.tsx" 1

# ---- r98 批次（代码审查修复防线：cron r98 收编 + f1 引擎 + f2 API + f3 UI + f4 脚本单一源）----
# f4：模板规格单一事实源（health-check 27/46 漂移根治）
check "SPECS单一源-缩略图管线"    "source.*template-specs"         "scripts/gen-template-thumbs.sh"    1
check "SPECS单一源-体检脚本"      "source.*template-specs"         "scripts/health-check-templates.sh" 1
check "SPECS对齐断言"             "数量漂移"                       "scripts/template-specs.sh"         1
check "体检动态范围"              "SPECS\[@\]\} - 1 \)\)\}"  "scripts/health-check-templates.sh" 1
check "管线rect失败显式"          "RECTFAIL"                       "scripts/gen-template-thumbs.sh"    2
# cron r98 收编批次（PDB 超时 / parse·calibrate 预检与 race / 取消口 / 代际 token / 去重 / remove 膜复位 / LRU / layer 清空）
check "PDB出站超时"               "AbortSignal.timeout\(UPSTREAM_TIMEOUT\)" "src/app/api/pdb/[id]/route.ts" 2
check "PDB超时文案"               "TimeoutError"                   "src/app/api/pdb/[id]/route.ts"    1
check "parse体积预检"             "declaredLen > 12"               "src/app/api/templates/parse/route.ts" 1
check "calibrate体积预检"         "declaredLen > 12"               "src/app/api/templates/calibrate/route.ts" 1
check "VLM兜底race-parse"         "Promise.race"                   "src/app/api/templates/parse/route.ts" 1
check "VLM兜底race-calibrate"     "Promise.race"                   "src/app/api/templates/calibrate/route.ts" 1
check "calibrate命令过闸"         "sanitizeTemplateCommands\(commands\)" "src/app/api/templates/calibrate/route.ts" 1
check "解析取消口"                "cancelParse"                    "src/components/studio/FigureTemplatesDialog.tsx" 2
check "序列代际token"             "templateSeqToken"               "src/lib/molecular/figure-templates.ts" 4
check "演示去重"                  "isStructureInStore\(tpl.demo\)" "src/lib/molecular/figure-templates.ts" 1
check "remove路径膜复位"          "dropMembrane"                   "src/lib/molecular/store.ts"        1
check "remove路径picks清"         "measurePicks: s.measurePicks"   "src/lib/molecular/store.ts"        1
check "纹理LRU上限"               "TEXTURE_CACHE_MAX"              "src/lib/molecular/textsprite.ts"   2
check "反平行up插值"              "\.dot\(.*up.*\) < 0\.99999" "src/lib/molecular/engine.ts"       2
check "膜零聚合物早退"            "Number.isFinite\(tLo\)"       "src/lib/molecular/engine.ts"       1
# f1：引擎层（sasa 分型键 / xbsa 随请求 / 橡皮带取消 / 录制轨道 / dispose 卫生）
check "sasa分型键"                "sasaPendingKey"                 "src/lib/molecular/engine.ts"       6
check "xbsa元信息随请求"          "xbsaMeta.set"                   "src/lib/molecular/engine.ts"       1
check "橡皮带取消收尾"            "cancelBoxSelect"                "src/lib/molecular/engine.ts"       3
check "录制轨道停止"              "recorderStream"                 "src/lib/molecular/engine.ts"       3
check "dispose清window钩子"       "__molEngine === this"           "src/lib/molecular/engine.ts"       1
check "pore零聚合物守卫"          "没有聚合物链"                   "src/lib/molecular/pore.ts"         1
# r100：通道轴检测根修（对称轴投票 + 腰扫描）——9P6B 膜歪/孔道歪 bug
check "Kabsch对称轴投票"          "symmetryAxis"                   "src/lib/molecular/pore.ts"         2
check "Kabsch反射修正"            "detH"                           "src/lib/molecular/pore.ts"         1
check "跨膜腰扫描"                "membraneWaist"                  "src/lib/molecular/pore.ts"         2
check "通道轴统一入口"            "poreAxis"                       "src/lib/molecular/pore.ts"         2
check "腰心膜板"                  "waist \? waist.center"          "src/lib/molecular/engine.ts"       1
check "腰窗聚焦采样"              "VESTIBULE"                      "src/lib/molecular/pore.ts"         2
check "剖面卡轴徽标"              "result.method === 'symmetry'"   "src/components/studio/PoreProfile.tsx" 2
check "剖面卡膜区带"              "zone.center - zone.halfWidth"   "src/components/studio/PoreProfile.tsx" 2
# f2：agent/sf 路由 r98 同构修复
check "agent体积预检"             "declaredLen"                    "src/app/api/agent/route.ts"        1
check "agent图片dataURL闸"        "DATAURL_RE"                     "src/app/api/agent/route.ts"        1
check "agent VLM兜底race"         "Promise.race"                   "src/app/api/agent/route.ts"        1
check "agent scene截断"           "slice\(0, 3600\)"             "src/app/api/agent/route.ts"        2
check "sf出站超时"                "AbortSignal.timeout"            "src/app/api/sf/[id]/route.ts"     1
check "sf超时文案"                "TimeoutError"                   "src/app/api/sf/[id]/route.ts"     1
# f3：UI 层（滑杆松手提交 / 草稿态 / mapData memo / 卸载守卫 / busyId 竞态 / 键盘可见 / a11y）
check "滑杆松手提交组件"          "CommitSlider"                   "src/components/studio/panels/RepsPanel.tsx" 3
check "表达式草稿态"              "selDraft"                       "src/components/studio/panels/RepsPanel.tsx" 3
check "伴侣滑杆松手提交"          "symDrag"                        "src/components/studio/panels/StructuresPanel.tsx" 2
check "mapData记忆化"             "const mapData = useMemo"       "src/components/studio/panels/AnalysisPanel.tsx" 1
check "stats记忆化"               "const stats = useMemo"         "src/components/studio/panels/SelectionPanel.tsx" 1
check "校准卸载守卫"              "disposedRef"                    "src/components/studio/FigureTemplatesDialog.tsx" 2
check "busyId竞态修"              "prev === tpl.id"               "src/components/studio/FigureTemplatesDialog.tsx" 1
check "解析卸载中止"              "abortRef.current\?\.abort"    "src/components/studio/FigureTemplatesDialog.tsx" 1

# f5：校准回路多轮迭代 + 历史时间线
check "校准轮数上限"                "CALIB_MAX_ROUNDS"               "src/components/studio/FigureTemplatesDialog.tsx" 2
check "校准历史时间线"              "data-calibration-history"       "src/components/studio/FigureTemplatesDialog.tsx" 1
check "校准自动续轮"                "autoPending"                    "src/components/studio/FigureTemplatesDialog.tsx" 4
check "校准采纳续轮条件"            "setAutoPending\(autoNext"      "src/components/studio/FigureTemplatesDialog.tsx" 1
check "校准自动开关"                "data-calibration-auto"          "src/components/studio/FigureTemplatesDialog.tsx" 1

# ---- r99：模板美学大修（VLM 全量审计 46 支 → 18 支弱项精修）+ 新模板六连（52 支）----
# 审计基线：wire-skeleton 2.5 / grayscale 4.0 / ballstick·hotspots·sepia·stereo 4.5 /
# catalytic·interface·nucleosome 5.0 / cpk·slab 5.5 / 6.0 档六支——本轮全部精修；
# interface-contacts 根修：6LU7 AU 无链 B（interface A B 虚线从未画出）→ demo 4HHB；
# 双引擎根修：GTAOPass 预通道漏排除 Sprite（label+ssao 组合黑条）+ 管线 autoPerf
# 静默阉割（SwiftShader 低帧自动关 ssao/outline——历史缩略图发灰发虚根因）
check "负像模板"              "id: 'xray-film'"               "src/lib/molecular/figure-templates.ts" 1
check "白瓷模板"              "id: 'porcelain-studio'"        "src/lib/molecular/figure-templates.ts" 1
check "波普模板"              "id: 'comic-pop'"               "src/lib/molecular/figure-templates.ts" 1
check "锌指模板"              "id: 'zn-finger-dna'"           "src/lib/molecular/figure-templates.ts" 1
check "BDNA模板"              "id: 'bdna-dodecamer'"          "src/lib/molecular/figure-templates.ts" 1
check "抗体模板"              "id: 'antibody-architecture'"   "src/lib/molecular/figure-templates.ts" 1
check "负像暗底配方"          "color #e8e3d8"                 "src/lib/molecular/figure-templates.ts" 1
check "白瓷影棚配方"          "bg #d8d1c2"                    "src/lib/molecular/figure-templates.ts" 1
check "波普加宽描边"          "outline on 1\.6 2\.2"          "src/lib/molecular/figure-templates.ts" 1
check "抗体链对三色"          "color #0f766e, chain B\+D"     "src/lib/molecular/figure-templates.ts" 1
check "BDNA双链色"            "color #0e8f82, chain A"        "src/lib/molecular/figure-templates.ts" 1
check "锌指DNA琥珀"           "color #dd9a5c, chain B\+C"     "src/lib/molecular/figure-templates.ts" 1
check "线描主链重墨"          "color #24292f, \(name N\+CA\+C\+O\)" "src/lib/molecular/figure-templates.ts" 1
check "线描雾深线索"          "set fog_strength 0\.75"         "src/lib/molecular/figure-templates.ts" 1
check "灰度SS三级灰"          "color #4b535c, ss h"           "src/lib/molecular/figure-templates.ts" 1
check "棕印SS分级棕"          "color #5f4526, ss h"           "src/lib/molecular/figure-templates.ts" 1
check "热点基线b30"           "alter \(polymer\), b=30"       "src/lib/molecular/figure-templates.ts" 1
check "热点标签减半单链"      "resi 6 and chain B\) or \(resi 87 and chain A\)" "src/lib/molecular/figure-templates.ts" 1
check "立体单灰底"            "color #6b7280"                 "src/lib/molecular/figure-templates.ts" 1
check "催化元素色棍"          "color element, \(resi 35 or resi 52\)" "src/lib/molecular/figure-templates.ts" 1
check "界面饱和链对色"        "color #d9544f, chain A"        "src/lib/molecular/figure-templates.ts" 1
check "核小体斜俯视"          "turn x 22"                     "src/lib/molecular/figure-templates.ts" 1
check "水合板岩蛋白底"        "color #64748b, protein"        "src/lib/molecular/figure-templates.ts" 1
check "AO打磨铺开"            "'ssao on'"                     "src/lib/molecular/figure-templates.ts" 16
check "图鉴负像词条"          "负像骨白亮调"                  "src/lib/molecular/figure-templates.ts" 1
check "图鉴AO词条"            "接触阴影塑形"                  "src/lib/molecular/figure-templates.ts" 1
check "图标r99六新键"         "'xray-film': Aperture"         "src/components/studio/FigureTemplatesDialog.tsx" 1
check "图标抗体键"            "'antibody-architecture': Shield" "src/components/studio/FigureTemplatesDialog.tsx" 1
check "规格r99六新"           "antibody-architecture:18:1IGT:51" "scripts/template-specs.sh" 1
check "规格界面demo改4HHB"    "interface-contacts:11:4HHB:6"  "scripts/template-specs.sh" 1
check "管线autoPerf关闭"      "settings\.autoPerf = false"    "scripts/gen-template-thumbs.sh" 2
check "引擎精灵AO排除补丁"    "gtaoInternal._overrideVisibility" "src/lib/molecular/engine.ts" 2

# r99：孔道环带 X 光叠加层（depthTest 全关——9PB6 实测旧版可见像素 0.05% 主诉「通道没画」）+ 膜显隐双 UI（用户指令）
check "环带depthTest关"            "depthWrite: false, depthTest: false" "src/lib/molecular/engine.ts" 1
check "主轴虚线depthTest关"        "gapSize: 0.8, depthTest: false" "src/lib/molecular/engine.ts"    1
check "收缩环面depthTest关"        "opacity: 0.95, depthTest: false" "src/lib/molecular/engine.ts"   1
check "工具栏膜显隐钮"             "aria-pressed=\{settings.showMembrane\}" "src/components/studio/Toolbar.tsx" 1
check "膜钮橙色激活态"             "bg-orange-500/15"               "src/components/studio/Toolbar.tsx" 1
check "膜钮无结构守卫"             "先加载膜蛋白（如 load 1bl8 KcsA）" "src/components/studio/Toolbar.tsx" 1
check "场景面板膜开关"             "Show the lipid bilayer"        "src/components/studio/panels/ScenePanel.tsx" 1
check "膜厚度滑杆"                 "membraneThickness: v\[0\]"     "src/components/studio/panels/ScenePanel.tsx" 1

# ---- r99-f1：引擎层失效链细拆（rev/repsRev/colorRev 分离 + buildSeq 对称克隆链） ----
# A：rep 哈希并入 colorRev（sync 侧 3 + buildRep 侧 2）；repsRev 不入哈希（rep 对象自身即粒度）
check "rep哈希含colorRev"          "entry\.rev, entry\.colorRev, filtersKey" "src/lib/molecular/engine.ts" 5
# A：symKey 三处改挂 view.buildSeq（滑杆/着色不 bump rev 后克隆防引用已 dispose 几何）
check "symKey挂buildSeq"           "\\\$\{view\.buildSeq\}\|" "src/lib/molecular/engine.ts" 3
check "buildRep自增buildSeq"       "view\.buildSeq\+\+"             "src/lib/molecular/engine.ts" 2
# A：updateRep/addRep/removeRep 三路径 bump repsRev（rep 对象在哈希内天然只失效本 rep）
check "rep操作bump repsRev"        "repsRev: x\.repsRev \+ 1"      "src/lib/molecular/store.ts" 3
# E：applyColor/resetColors 四分支 bump colorRev（不再误伤 hbond detKey/membraneKey）
check "着色路径bump colorRev"      "colorRev: x\.colorRev \+ 1"   "src/lib/molecular/store.ts" 4
# E：util.cbss/cbaw/cbac 的 overrides 烘焙同样走 colorRev（复核发现的命令层漏网点）
check "util色命令colorRev"         "colorRev: x\.colorRev \+ 1"   "src/lib/molecular/commands.ts" 2
# E：colorBackup 备份/恢复/清空机制（store）+ 随档/随链透传（session/share-link）
check "配色备份机制-store"          "colorBackup"                    "src/lib/molecular/store.ts" 5
check "配色备份随档透传"            "colorBackup"                    "src/lib/molecular/session.ts" 4
check "配色备份随链透传"            "colorBackup"                    "src/lib/molecular/share-link.ts" 3
# B：rayRender 先恢复现场再解码（restore 幂等闭包 + toDataURL 后同步调用）
check "ray先恢复再解码"            "rayRestored"                    "src/lib/molecular/engine.ts" 2
# C：seqFocus 节流前移 + 数值元组快路径（VisTuple 接口/字段/比较）
check "seqFocus元组快路径"         "VisTuple"                       "src/lib/molecular/engine.ts" 3
# D：hbond 渲染键 selection 分量条件化（hbondSelOnly/hbondScope 在场才并入）
check "hbond键selection条件化"     "selInHbondKey"                  "src/lib/molecular/engine.ts" 2
# 小修包：ensemble 播放氢键 150ms 节流（参数+调用点）；superpose 后膜键显式作废；
# applySettings 引用比较；dispose 补 recorderStream 轨道 stop
check "ensemble氢键节流"           "hbondThrottle"                  "src/lib/molecular/engine.ts" 3
check "superpose膜作废"            "this\.membraneKey = ''"         "src/lib/molecular/engine.ts" 1
check "applySettings引用比较"      "settings !== prev"              "src/lib/molecular/engine.ts" 1
check "dispose轨道stop"            "recorderStream\?\.getTracks\(\)" "src/lib/molecular/engine.ts" 2
# A：MolViewer 自动存档签名并入三版本号（updateRep 不 bump rev 后防存档失聪；
# 双引号内 \$ 会变成 rg 行尾锚点——模板字面量用 .{0,3} 跨越 ${ 前缀，避开 $ 字面量）
check "存档签名三版本号"           "x\.rev\}:.{0,3}x\.repsRev\}:.{0,3}x\.colorRev" "src/components/molecular/MolViewer.tsx" 1
# 小修包：buildSpheres/buildSticks 热路径单例复用（setRGB 复用，无 new Color/clone）
check "热路径颜色单例"             "tmpColor\.setRGB"               "src/lib/molecular/representations.ts" 2
# 小修包：parser 死变量 r2（query() 内——单行模式无法与 queryRadius 的合法 r2 区分，
# 以清理标记注释钉住）与 representations 恒真死条件清理（负向——复现即回归）
check "parser死变量清理标记"      "清理死变量"                   "src/lib/molecular/parser.ts" 1
check0 "cartoon恒真死条件"        "i0 \+ 1\) < n \?"              "src/lib/molecular/representations.ts"

# ---- r99-main：并入会话独有修复（dynSelKey 动态选择签名 / alter 双bump / 膜落帧失效 / flush sasa / API 类型白名单补齐 / emitted 守卫 / ZAI 定时器清理 / UI 小修批） ----
check "动态选择依赖签名"          "repDynSelKey"                   "src/lib/molecular/engine.ts" 6
check "alter双bump"               "rev: x\.rev \+ 1, colorRev: x\.colorRev \+ 1" "src/lib/molecular/commands.ts" 1
check "flush含sasa重烘"           "colorScheme === 'pocket' \|\| r.colorScheme === 'sasa'" "src/lib/molecular/engine.ts" 1
check "落帧膜失效"                "this.updateMembrane\(useMolStore.getState\(\)\)" "src/lib/molecular/engine.ts" 2
check "agent流emitted守卫"        "let emitted = 0"               "src/app/api/agent/route.ts" 1
check "agent类型白名单补齐"       "badStr\(body.image\)"        "src/app/api/agent/route.ts" 1
check "providers类型白名单"       "const badStr"                  "src/app/api/agent/providers/route.ts" 1
check "models类型白名单"          "const badStr"                  "src/app/api/agent/providers/models/route.ts" 1
check "命名选择归属数据"          "dataRegistry\.get\(ns\.structureId\)" "src/components/studio/panels/SelectionPanel.tsx" 1
check "演示并发闸"                "if \(busyId \|\| loading\) return" "src/components/studio/FigureTemplatesDialog.tsx" 1
check "撤销还原链隔离"            "hiddenChains: st.hiddenChains" "src/components/studio/panels/StructuresPanel.tsx" 1
check "S菜单膜语境"               "脂双层膜语境"                   "src/components/studio/ObjectActionBar.tsx" 2
check "录制停止双击闸"            "stopBusyRef"                   "src/components/studio/RecordBadge.tsx" 3
check "fileinput清value"          "e.target.value = ''"           "src/components/studio/LoadDialog.tsx" 1
check "ZAI定时器清理"             "clearTimeout\(zaiTimer\)"    "src/app/api/templates/parse/route.ts" 1
check "短key全遮"                 "length <= 8 \? '••••'"       "src/lib/molecular/agent/providers.ts" 1

# ---- r101-b：API 请求体流式限长（r99 建议③前半——chunked 传输绕过 content-length 预检的权威上限） ----
# 共享工具 readRequestCapped（src/lib/api/read-body.ts）：request.body 为 null 回落
# text() 事后字节判定；有流则 getReader 逐块累计，超限 cancel 上游返回 null。
# 五路由全接入（providers 64KB / models 64KB / agent 16MB / parse 12MB / calibrate 12MB），
# content-length 预检保留为快速拒绝路径；全 src/app/api 复核确认无第 6 个 request.json() 路由
check "请求体限长读取函数"        "export async function readRequestCapped" "src/lib/api/read-body.ts" 1
# r101-rev-c：边界语义统一「超过才拒」（旧 >= 语义使恰在上限的诚实请求被拒，
# 与 content-length 预检的 > 在同一边界字节上自相矛盾）
check "超限cancel上游"            "received > maxBytes"         "src/lib/api/read-body.ts" 1
check "五路由限长读取接入"        "await readRequestCapped\("    "src/app/api" 5
check "五路由超限413回落"         "bodyText === null"            "src/app/api" 5
# 负向：request/req .json() 调用零残留（正则锚定「= (await …」调用形——注释里的
# 历史引用「旧版 await req.json()」不带等号赋值形，不误伤；第 6 个路由若出现
# 裸 json() 读取也会被此守卫拦下，倒逼走 readRequestCapped）
check0 "五路由json零残留"         "= \(?await (req|request)\.json\(\)" "src/app/api"

# ---- r101-a：导出管线统一（png/ray/svg 三口下载收敛 + ray 参数面对话框 + PCFSoft 弃用清理 + TemplateCard ARIA 兄弟化） ----
# ①共享下载模块定义（此前 Toolbar capture/rayCapture 与 commands png/ray 四处各复制一份 <a> 下载）
check "下载收敛模块"              "export function downloadDataUrl" "src/lib/molecular/image-export.ts" 1
# ②三口引用（Toolbar capture+rayCapture / commands png+ray 各 ≥2——任务要求的「合计 ≥3」由此双闸保证）
check "Toolbar下载收敛"          "downloadDataUrl\(" "src/components/studio/Toolbar.tsx" 2
check "commands下载收敛"         "downloadDataUrl\(" "src/lib/molecular/commands.ts" 2
# ③内联 <a> 下载零残留（Toolbar 全清；commands 仅 png/ray 文件名构造清零——record webm / save pdb
#    为非图像口保留内联；CommandPalette/RecordBadge 等其他组件的独立下载点不属本轮收敛范围，
#    故模式钉住 png/ray 的 `${s.structures[0]} 文件名构造，避 $ 字面量用 .{0,3} 跨越——r99-main 同款）
check0 "Toolbar无内联a下载"      "a\.download" "src/components/studio/Toolbar.tsx"
check0 "commands无png/ray内联下载" "a\.download = .{0,3}s\.structures\[0\]" "src/lib/molecular/commands.ts"
# ④ray 命令参数解析（语法扩展 ray [宽px] [超采样1-2] [transparent]——supersample 钳位 + 关键字正则）
check "ray超采样解析"            "supersample" "src/lib/molecular/commands.ts" 2
check "ray透明参数解析"          "TRANSPARENT_ARG_RE" "src/lib/molecular/commands.ts" 2
# ⑤PCFSoftShadowMap（r186 弃用 API——每次 ray 触发 console warning）代码级零命中
#    （模式钉住 THREE. 前缀：engine 保留的弃用说明注释文字不入此闸）
check0 "PCFSoft弃用API清理"     "THREE\.PCFSoftShadowMap" "src"
# ⑥Ray 渲染设置对话框（rayRender 参数面：宽度/超采样/透明，选项持久化 mv-ray-opts）存在且被 Toolbar 引用
check "Ray导出参数面存在"       "RayExportDialog" "src/components/studio/RayExportDialog.tsx" 1
check "Toolbar引用Ray对话框"    "RayExportDialog" "src/components/studio/Toolbar.tsx" 2
# TemplateCard 嵌套交互修复（r99 遗留 P3）：button 嵌 role="button" span（ARIA 非法）改兄弟结构——
# 缩略图容器 div 承接 aspect/w（旧 button 的该类句柄不复存在；右引号锚定区别于对照视图 L1444 的同前缀类）
check "TemplateCard兄弟容器"    'relative aspect-\[16/10\] w-full"' "src/components/studio/FigureTemplatesDialog.tsx" 1

# ---- r101 主代理：hbond detKey 去 entry.rev（r99 下轮建议②简化落地） ----
# 检测输入只有（坐标+两设置）：setChainHidden/dssp/alter/场景恢复 bump rev 但不改坐标，
# 旧键把链显隐误判为检测失效 → 全量 worker 重检。真坐标变更（superpose/resetTransform/
# ensemble 落帧）全走 rebuildStructureVisuals → hbondCache.delete 自失效。
# 正向：新 detKey 只含两设置分量
check "hbond检测键纯化"          'detKey = .{0,4}\$\{s\.hbondMaxDist\}\|\$\{s\.hbondIncludeWater\}' "src/lib/molecular/engine.ts" 1
# 负向：detKey 不再拼 rev（防回滚——拼接形 .rev 回潮即拦）
check0 "hbond键无rev回潮"        'detKey = .{0,3}s\.hbondMaxDist.{0,4}entry\.rev' "src/lib/molecular/engine.ts"
# 坐标自失效链在位（rebuildStructureVisuals 直调路径的显式 delete——detKey 去 rev 后这是唯一失效源）
check "坐标直调氢键自失效"       "this\.hbondCache\.delete\(data\.id\)" "src/lib/molecular/engine.ts" 1

# ---- r101-rev：三区审查修复钉 ----
# ①hbond in-flight 竞态根治（rev-a P2-1）：reqId 双闸——同设置下坐标突变后重投的新请求与
# 旧在飞请求同 detKey，靠 hbondLastReq 判过期丢弃旧坐标快照结果
check "hbond请求纪元在位"        "private hbondLastReq" "src/lib/molecular/engine.ts" 1
check "hbond结果reqId闸"         "hbondLastReq\.get\(msg\.structureId\) !== msg\.reqId" "src/lib/molecular/engine.ts" 1
# ②坐标突变点同步作废 pending（去重判等会吞掉重投——两处 delete 站点各补一行）
check "pause作废pending"         "this\.hbondPending\.delete\(sid\)" "src/lib/molecular/engine.ts" 1
check "rebuild作废pending"       "this\.hbondPending\.delete\(data\.id\)" "src/lib/molecular/engine.ts" 1
# ③rayRender GPU 护栏（rev-a P2-2）：超采样画布宽不得超 maxTextureSize（移动端 context lost）
check "rayGPU护栏"               "maxTextureSize / ss" "src/lib/molecular/engine.ts" 1
# ④FadeEdge 内容增删重估（rev-b P3-1）：MutationObserver 观察 childList/subtree（RO 盲区）
check "FadeEdge内容重估"         "new MutationObserver\(update\)" "src/components/studio/FadeEdge.tsx" 1
# ⑤Ray busy 闸（rev-b P3-2）：渲染中重触发早退 + finally 复位
check "ray渲染busy闸"            "rayBusyRef\.current" "src/components/studio/Toolbar.tsx" 3
# ⑥readCapped 终局 flush 对齐（rev-c P3）：models 路由响应体读取补 decoder.decode()
check "models响应终局flush"      "out \+= decoder\.decode\(\)" "src/app/api/agent/providers/models/route.ts" 1
# ⑦png 循环解析器（rev-a P3-2）：对齐 ray 语法（png t 3 不再吞倍率）
check "png循环解析器"            "isNaN\(n\) \|\| scale !== undefined" "src/lib/molecular/commands.ts" 1

# ---- r102-a：Ray 4K 内存护栏（r101 建议①——deviceMemory 提示 + 显存估算 + 低内存默认降档） ----
# 背景：r101 E2E 实测 4K×2× 超采样渲染的内存尖峰（toDataURL 7680px 画布 + PNG 字符串 +
# depth/stencil）超沙箱 1.5GB 预算致 devd 组杀 dev server——桌面 GPU maxTextureSize 通常
# 16384 使 r101 的 GPU 护栏不触发；内存不足是另一维度，navigator.deviceMemory 是唯一可用的
# 客户端信号。设计决策：引擎侧不加设备维度硬钳（用户显式选 2× 被静默降为 1× 会造成导出与
# 预览不一致的困惑）——设备维度全部留在 RayExportDialog（首用默认降档+组合警示+显存估算），
# engine.ts 零改动（r101 wCap 护栏原样保留）。
# ①低内存设备检测（navigator.deviceMemory——Chrome 系独有，其他浏览器 undefined 静默不限制）
check "低内存设备检测"          "deviceMemory"                   "src/components/studio/RayExportDialog.tsx" 2
# ②显存估算公式（RGBA 4B/px × color+depth 2 份 / 1048576——预估行「约 N MB 显存」的数值来源）
check "显存估算公式"            "1048576"                        "src/components/studio/RayExportDialog.tsx" 1
# ③低内存首用默认降档（loadOpts 无存档分支的 supersample: 1——右花括号锚定，不误伤
#    DEFAULT_RAY_OPTS 行的 supersample: 1.5；存档优先级永远高于设备推断）
check "低内存默认降档"          "supersample: 1 \}"              "src/components/studio/RayExportDialog.tsx" 1
# ④3840 + 高超采样 + 低内存组合警示文案（宽度段选区下方行内警示——TriangleAlert 图标 + 黄色文本）
check "4K低内存组合警示"        "可能触发显存溢出"               "src/components/studio/RayExportDialog.tsx" 1
# ⑤预估行显存估算文本在位（「约 N MB 显存」+ 16:9 上界注记；≥500MB 转警示色）
check "显存估算行文案"          "按 16:9 估算"                   "src/components/studio/RayExportDialog.tsx" 1

# ---- r102-b：脚本韧性（devd 看门狗双竞态修复 + gen-thumbs 探针计数与退出码） ----
# ①devd cwd 归属过滤（r101-rev-c 竞态一）：server_rss_mb 扫全机 /proc/*/comm 匹配
# next-server 无 cwd 过滤——多项目沙箱下他项目根的 next-server 可致错杀自己健康
# server 或漏看真凶（/proc 遍历序不确定）；现要求 readlink /proc/<pid>/cwd ==
# PROJECT 才计入（os.readlink 调用形锚定——docstring 里的 readlink 文字不误伤）
check "devd看门狗cwd过滤"       "os\.readlink\(" "scripts/devd.py" 1
# ②devd 端口释放有界等待（r101-rev-c 竞态二）：重启前单次 port_alive 判定会把
# SIGKILL 路径的端口迟滞误判「外部接管」而退位——现有界轮询常量 + 轮询睡眠双锚
check "devd端口释放有界常量"    "PORT_RELEASE_POLL" "scripts/devd.py" 2
check "devd端口释放轮询睡眠"    "time\.sleep\(PORT_RELEASE_POLL_S\)" "scripts/devd.py" 1
# ③gen-thumbs 探针失败计数（对齐 health-check r99-f3）：六调用点 eval 探针非成功值
# （submitted/collapsed/hidden:n×2/panel/applied:ok——applied:MISMATCH 落错卡亦计）
# 打 PROBE-FAIL 行并计 fails；SKIP/RECTFAIL 亦计数
check "gen-thumbs探针失败计数"  "PROBE-FAIL" "scripts/gen-template-thumbs.sh" 1
check "gen-thumbs失败计数站点"  'fails=\$\(\(fails \+ 1\)\)' "scripts/gen-template-thumbs.sh" 8
# ④gen-thumbs 退出闸（旧行为恒 exit 0——apply 探针失败可产错误内容缩略图仍报成功）
check "gen-thumbs非零退出闸"    "fails -eq 0" "scripts/gen-template-thumbs.sh" 1

# ---- r102 主代理：死依赖大扫除 + global-error 兜底 ----
# 24 个零引用包（src/ 全模式 import 穷尽实证 + examples/config/middleware/交叉引用零命中）
# + 7 个死 shadcn 模板件（calendar/input-otp/form/carousel/chart/drawer/resizable——
# 业务引用 0 文件）移除；prisma/@prisma/client/db.ts 保留（平台标准栈 + db:* 脚本，
# 零运行时代价）。负向守卫防依赖回潮（package.json 再现即 FAIL——倒逼新需求走
# 既有栈或显式论证后同步移除守卫）
check0 "死依赖不回潮"            "framer-motion|@dnd-kit|@mdxeditor|next-auth|next-intl|react-query|react-table|syntax-highlighter|embla-carousel|recharts|input-otp|react-hook-form|react-day-picker|react-resizable-panels|@reactuses|@hookform|react-markdown|@mdxeditor" "package.json"
# 死模板件的独占符号零复活（文件已删——RechartsPrimitive/useCarousel/DrawerPrimitive
# 只存在于已删的 chart/carousel/drawer.tsx）
check0 "死模板符号不复活"        "RechartsPrimitive|useCarousel|DrawerPrimitive|OTPInput" "src"
# global-error 根级兜底（r101-rev-a P3 悬置项收口）：root layout 抛错时最后一道 UI 防线
check "全局错误兜底"            "Unexpected rendering error" "src/app/global-error.tsx" 1

# ---- r103-a：rayRender SSAA 同步直降采样内存优化（r102 建议②） ----
# 背景：r101 E2E 实测 3840 宽 ×2× 超采样渲染内存尖峰超沙箱预算致 dev server 进程组被杀；
# 旧 SSAA 路径「主画布 toDataURL（7680px 宽 → 巨型 PNG base64 字符串，可达百 MB 级）→
# await Image 解码该字符串（又一份 7680px 位图 ~66MB）→ drawImage → 小画布再 toDataURL」
# 存在 PNG 编码→字符串→解码回位图的无谓往返，两份巨型瞬时分配是尖峰主源。新路径：
# restore() 之前离屏目标尺寸 2D 画布直接 drawImage 主画布（同步直降采样，无巨型中间
# 字符串/无解码往返，仅对目标尺寸小画布编码一次）；getContext('2d') 返回 null 的极端
# 环境回落完整旧路径（hiUrl toDataURL → Image 解码 → drawImage → toDataURL）兜底。
# ①drawImage 直降采样调用锚（必须发生在 restore() 之前——setSize 恢复视口会清空主画布；
#    参数串完整锚定目标尺寸语义，与兜底路径的 drawImage(src,…) 不混淆）
check "ray直降采样调用"        "drawImage\(this\.renderer\.domElement, 0, 0, targetW, targetH\)" "src/lib/molecular/engine.ts" 1
# ②降采样平滑质量等级（imageSmoothingQuality='high'——与旧路径一致的质量语义，
#    新快路径 + 兜底路径各一处）
check "ray降采样high平滑"      "imageSmoothingQuality = 'high'" "src/lib/molecular/engine.ts" 2
# ③兜底路径保留锚（getContext('2d') 不可用时的 Image 解码旧路径——'ssaa-decode' 错误串）
check "ray旧路径解码兜底"      "ssaa-decode" "src/lib/molecular/engine.ts" 1
# ④离屏小画布单次编码锚（目标尺寸 canvas 的 toDataURL——新路径唯一一次 PNG 编码；
#    off\. 右侧点锚定不误伤兜底路径的 off2.toDataURL）
check "ray离屏小画布编码"      "off\.toDataURL\('image/png'\)" "src/lib/molecular/engine.ts" 1
# ⑤兜底路径降采样调用锚（Image 解码后 drawImage——旧路径结构完整性双锚之一，与③配套）
check "ray旧路径降采样保留"    "drawImage\(src, 0, 0, targetW, targetH\)" "src/lib/molecular/engine.ts" 1

# ---- r103-b：devd 内存增长斜率检测（r102 建议①的斜率方案——绝对阈值对「缓慢爬升」不敏感） ----
# r102 实测假死发生在 RSS 1259MB（远未触 1500MB 绝对线）——只有绝对阈值时缓慢爬升
# 要等触线才换血，等触线往往体验已受损；现 4 分钟窗（8 采样 × 30s）内 RSS 单调不减
# （允许平顶、显著回落即否决——编译尖峰后的 GC 回落正是「正常缓存增长」与「泄漏」
# 的分界）+ 总涨 ≥300MB（稳态 ~1.22GB + 300 ≈ 1.5GB 与绝对阈值衔接）+ 当前
# ≥1000MB（低基数噪声防护）即判泄漏嫌疑主动换血；换血日志行「slope restart」与
# 绝对阈值行「memory restart」用词区分，事后 grep dev.log 能分清两类换血。
# ①②触发常量锚（改阈值须同步改守卫——数值语义变化应显式过闸）
check "斜率涨幅常量"            "SLOPE_RISE_MB = 300"   "scripts/devd.py" 1
check "斜率地板常量"            "SLOPE_FLOOR_MB = 1000" "scripts/devd.py" 1
# ③判定纯函数锚（定义 + main 循环调用双站点——纯函数形态供 import 级测试，r102-b 先例）
check "斜率判定纯函数"          "slope_restart_needed"  "scripts/devd.py" 2
# ④斜率换血日志行锚（rg 正则括号必须转义——r101 坑②判例）
check "斜率换血日志行"          "growth \(leak suspect\); slope restart" "scripts/devd.py" 1
# ⑤main 循环采样窗接线（声明/入窗/滑窗裁剪/传参四站点——防判定函数退化为死函数）
check "斜率采样窗接线"          "rss_window"            "scripts/devd.py" 4

# ---- r103-c：smoke 假死哨兵（r102 建议③——主线程假死症状的 CI 判定缺口补齐） ----
# 背景：r102 E2E 实测沙箱内存耗尽（next-server 1259MB + 双 Chrome ~1.35GB → free
# 544MB）时页面主线程假死——eval 超时但浏览器级存活（get title 正常），lint/guards
# 的静态面测不到该症状。smoke.sh 落地断言 5「假死哨兵」：press 2 触发预设切换
# （MolViewer.tsx 快捷键监听挂 window，数字键 1-9 直映射预设——agent-browser
# press 派发可达）+ 有界 eval 探针（Date.now() 首测 + sleep 5 有界宽限重试一次，
# 两次皆空才判假死）+ 断言 6 触发后 console 仍零错误；汇总段由硬编码「4/4」改
# TOTAL 动态计数。以下四锚防哨兵被后续改写静默退化：
# ①press 触发调用锚（渲染负载触发器本体——改触发方式须同步过闸）
check "哨兵press触发锚"          "agent-browser press 2" "scripts/smoke.sh" 1
# ②响应探针 eval 锚（首测 + 有界宽限重试双站点；模式带 probe 赋值前缀，不误伤
#    pass/fail 文案里的 Date.now() 字样——$ 与括号在 bash 双引号内有替换/子壳坑，
#    沿 r101-a/r102-b 手法用单引号护正则）
check "哨兵响应探针eval锚"      'probe=\$\(agent-browser eval "Date\.now\(\)"' "scripts/smoke.sh" 2
# ③「假死哨兵」fail 文案锚（哨兵触发时的判定输出——文案自带 get title 区分指引；
#    「假死哨兵触发」为 fail 分支独有串，pass 文案为「假死哨兵：」不误伤）
check "哨兵fail文案锚"          "假死哨兵触发" "scripts/smoke.sh" 1
# ④TOTAL 动态计数锚（pass/fail 内自增双站点 + 汇总段 $TOTAL/$TOTAL 输出共三站点
#    ——新增断言后忘同步硬编码总数的坑就此根治）
check "哨兵TOTAL计数锚"         'TOTAL=\$\(\(TOTAL \+ 1\)\)|\$TOTAL/\$TOTAL' "scripts/smoke.sh" 3

# ---- r104-b：E2E 视觉回归基线（r103 建议①——像素 diff 哨兵补「渲染面回归」判定缺口） ----
# 背景：guards 是 grep 级静态防线，膜错位（r92）/模板变色/表示法丢失等渲染面回归
# 只有真实截图才能判定；VLM 复鉴有 429 限流不适合 CI——visual-baseline.sh 以
# screenshot 与基线的 PIL 逐像素比对补齐该缺口（capture 拍基线入 git / check 门禁
# 比对，任一场景 FAIL 即 exit 1）。以下锚防哨兵被后续改写静默退化：
# ①capture/check 双模式入口锚（模式门 $ 变量 + 花括号在 bash 双引号内有替换坑，
#    沿 r101-a/r102-b 手法用单引号护正则；capture 提示串在用法 echo + 基线缺失
#    FAIL 文案双站点出现）
check "视觉基线模式门锚"        'MODE="\$\{1:-\}"' "scripts/visual-baseline.sh" 1
check "视觉基线capture提示锚"   "visual-baseline\.sh capture" "scripts/visual-baseline.sh" 2
# ②场景数组锚（写死的 3 场景集是哨兵的覆盖面定义——删膜场景 = r92 级膜回归面失守；
#    + 是 rg 正则元字符必须转义）
check "视觉基线膜场景锚"        "membrane-toggle:14:load\+cmd:1FX8" "scripts/visual-baseline.sh" 1
# ③PIL 差异判定锚（比对核心 ImageChops.difference + 阈值判定行——改阈值须显式
#    过闸，阈值依据见 visual-baseline.sh 文件头【比对算法与阈值】）
check "视觉基线像素diff锚"      "ImageChops\.difference" "scripts/visual-baseline.sh" 1
check "视觉基线阈值锚"          "pct > 1\.5 or mean > 2\.0" "scripts/visual-baseline.sh" 1
# ④退出码锚（CI 拦截语义——恒 exit 0 的哨兵是摆设，r102-b gen-thumbs 假成功判例）
check "视觉基线退出码锚"        'FAILS" -eq 0' "scripts/visual-baseline.sh" 1
# ⑤固定会话锚（visual-baseline 独立会话名——不与缩略图管线/冒烟会话撞车，
#    4GB 沙箱内存纪律与并行代理共存的前提）
check "视觉基线会话锚"          'AGENT_BROWSER_SESSION="visual-baseline"' "scripts/visual-baseline.sh" 1

# ---- r104-a：膜类模板四连（r103 测试结果建议④产品侧推进——membrane 分类 2→6） ----
# 背景：52 模板中 membrane 仅 2 支（分类最大缺口）；r104 新增四支全部经 RCSB API
# 核实 PDB/引文 + agent-browser 活体验证（VLM 复鉴 + 像素级配体计数 + 引擎内部
# 状态三方交叉）。以下锚防新模板被后续改写静默退化（命令序列核心特征逐条钉住）：
# ①四模板 id 锚（figure-templates.ts 各 1 命中——id 即卡片身份）
check "膜类滤器模板锚"          "id: 'selectivity-filter'" "src/lib/molecular/figure-templates.ts" 1
check "膜类GPCR模板锚"          "id: 'gpcr-retinal-pocket'" "src/lib/molecular/figure-templates.ts" 1
check "膜类porin模板锚"         "id: 'beta-barrel-porin'" "src/lib/molecular/figure-templates.ts" 1
check "膜类毒素模板锚"          "id: 'toxin-pore-assembly'" "src/lib/molecular/figure-templates.ts" 1
# ②SPECS 登记锚（template-specs.sh 四行齐全——漏登记 = 缩略图管线点错卡/静默漏拍）
check "膜类规格登记锚"          "selectivity-filter:12:1K4C:52" "scripts/template-specs.sh" 1
check "膜类规格登记锚2"         "gpcr-retinal-pocket:15:1F88:53" "scripts/template-specs.sh" 1
# ③活体验证过的关键命令锚（GPCR 口袋开窗——模板库首个 hide cartoon 局部开窗图式，
#    橙配体像素 26→431 的根因命令；滤器离子纵列 elem K 双命令）
check "膜类开窗命令锚"          "hide cartoon, byres\(within 5\.5 of \(resn RET\)\)" "src/lib/molecular/figure-templates.ts" 1
check "膜类离子纵列锚"          "show spheres, elem K" "src/lib/molecular/figure-templates.ts" 1
# ④头注释 r104 扩容段锚（扩容史与验证方法论的档位点）
check "膜类头注释锚"            "r104 扩容（膜蛋白 · 通道分类补全 2→6" "src/lib/molecular/figure-templates.ts" 1

# ---- r104-c：smoke 假死哨兵重载变体（r103 建议③ / r103-c 遗留①） ----
# 背景：r103-c 哨兵的轻量键盘分发在空页面 press 2 因 activeId 空守卫不真正
# applyPreset——无渲染负载，发现率有限。r104-c 升级为「装载 4HHB → press 2」
# 重载路径（真实 4,548 原子重渲染，贴近 r102 假死现场）；装载失败诚实降级轻量
# 路径（路径标记入 PASS 文案）。以下锚防重载逻辑被后续改写静默退化回轻量：
# ①重载路径标记锚（heavy/light 双站点——load_path 变量是路径语义的载体）
check "哨兵重载路径锚"          'load_path="(light|heavy)"' "scripts/smoke.sh" 2
# ②装载探针锚（native setter + 4HHB——React 受控输入 E2E 铁律的装载实现本体）
check "哨兵装载探针锚"          "setter\.call\(i, '4HHB'\)" "scripts/smoke.sh" 1
# ③有界等待循环锚（__molData.size 轮询——装载判定的数据源；非零才升 heavy）
check "哨兵装载等待锚"          "window\.__molData \? window\.__molData\.size : 0" "scripts/smoke.sh" 1
# ④路径标记 PASS 文案锚（重载路径的证据输出——smoke 6/6 输出能区分 heavy/light）
check "哨兵路径文案锚"          '\$\{load_path\} 路径预设切换触发后主线程仍响应' "scripts/smoke.sh" 1

# ---- r104-d：缩略图管线 tighten 作用域化（r104 像素对比实锤的生成损失根修） ----
# 背景：全量 tighten 对已收紧旧图做裁剪 + LANCZOS 往返，单轮 5-13% 边缘像素漂移
# （pore-analysis/ss-motif/xray-film 三样本 git HEAD 像素对比）——多轮累积即生成
# 损失。修法：过滤模式把本轮 id 透传给 tighten-thumbs.py，旧图零重采样。
# ①管线透传锚（gen-template-thumbs 把命令行 id 传给 tighten——增量模式的作用域来源）
check "管线tighten透传锚"      'tighten-thumbs\.py" "\$@"' "scripts/gen-template-thumbs.sh" 1
# ②tighten 作用域门锚（scope 过滤 + 未知名报错——防作用域化被静默回退成全量）
check "tighten作用域门锚"      "if scope:" "scripts/tighten-thumbs.py" 1
check "tighten未知名报错锚"    "作用域含未知名" "scripts/tighten-thumbs.py" 1

# ---- r105-a：.agent/skills 开发流程 skill 体系（多轮 agent 操作规矩标准化为 4 SKILL + 索引） ----
# 背景：r99-r104 多轮开发沉淀的操作规矩（三段式流程/QA 门禁链/E2E 铁律/worklog 文稿
# 格式）此前只存在于 worklog 叙述中——新会话/子代理恢复语境全靠通读尾部大段文字。本轮
# 标准化为 .agent/skills/ 下 4 个 SKILL.md + README 索引（随 git 跟踪，区别于不入库的
# 全局 /skills/）。以下四锚防体系被后续改写/删除静默退化（括号为 rg 正则分组
# alternation——沿 r104-c load_path="(light|heavy)" 手法；四模式均无 $/反引号，
# bash 双引号内安全；目录递归路径 .agent/skills/ 为隐藏目录——rg 显式给定路径
# 可正常搜索，插入前已实测验证）：
# ①索引四技能锚（README 技能清单表 4 行 + 使用方式 4 行，实测 8——索引被清空或任一
#    技能从索引消失即 FAIL）
check "skill索引四技能锚"     "molvision-(dev-cycle|qa-gates|e2e|worklog-format)" ".agent/skills/README.md" 8
# ②frontmatter 结构锚（目录递归 5 文件各 1 行 description:，实测 5——任一 skill 文件
#    被删或 frontmatter 损坏即 FAIL）
check "skill frontmatter锚"   "^description:" ".agent/skills/" 5
# ③门禁 tsc 口径锚（目录递归：dev-cycle 收尾门禁链 1 + qa-gates 门禁表/详述 2，实测 3
#    ——「只看 src/」口径在两份流程文档双站点钉住，防回退成全项目口径误判 5 个历史
#    基线错）
check "skill门禁tsc口径锚"    "bunx tsc --noEmit src/" ".agent/skills/" 3
# ④E2E 铁律锚（目录递归：e2e 铁律 1 本体 + qa-gates smoke heavy 路径引用，实测 2——
#    React 受控输入 native setter 范式双站点，防头号铁律被删）
check "skill E2E铁律锚"       "native setter" ".agent/skills/" 2

# ---- r105：产品侧 agent 标准技能系统（skills.ts 注册表 6 支 + 匹配/注入/徽章/报告卡片
# ---- + runner/route 白名单补 membrane/pore + COMMAND_REF 膜孔道词条） ----
# 用户指令「所有 agent 操作用 skill 标准化流程 + 输出文稿固定格式」的产品侧落地：
# 前端 matchSkill（strong×2/weak×1 计分，唯一最高 ≥2 选中）→ skillId 随请求上送 →
# 后端把「标准 workflow + 固定报告格式」注入系统提示 → LLM 按标准流程出命令、
# reply 按【…报告】+ ▌节行固定文稿 → AgentPanel 报告卡片分级渲染。
# 以下十一锚防各环节被改写/删除静默退化（括号与 \[ \] 均为 rg 正则合法转义，
# 无 $/反引号——bash 双引号内安全；实测数见各行注释）：
# ①注册表六支技能 id 锚（实测 6——任一技能被删即 FAIL）
check "agent技能注册表六支锚"  "id: 'ligand-pocket'|id: 'hbond-network'|id: 'interface-analysis'|id: 'pub-figure'|id: 'structure-survey'|id: 'membrane-context'" "src/lib/molecular/agent/skills.ts" 6
# ②匹配阈值锚（实测 1——唯一最高分 ≥2 才选中的防误触发达成式；改阈值/删 tie 判定即 FAIL）
check "agent技能匹配阈值锚"    "bestScore >= 2 && !tie" "src/lib/molecular/agent/skills.ts" 1
# ③系统提示注入锚（实测 2——matchedSkill find + buildSkillDirective 拼接双站点；注入被删技能退化为普通对话即 FAIL）
check "agent技能指令注入锚"    "matchedSkill" "src/app/api/agent/route.ts" 2
# ④报告标记检测函数锚（实测 1——isSkillReport 定义；删掉则前端报告卡片永不触发）
check "agent报告检测函数锚"    "isSkillReport" "src/lib/molecular/agent/skills.ts" 1
# ⑤报告检测接线锚（实测 3——AgentPanel import + isReport 判定 + 渲染分支三站点）
check "agent报告检测接线锚"    "isSkillReport" "src/components/studio/AgentPanel.tsx" 3
# ⑥技能徽章文案锚（实测 7——消息徽章「标准技能 ·」2 + 输入预览「已识别标准技能」2 + 注释 3）
check "agent技能徽章文案锚"    "标准技能" "src/components/studio/AgentPanel.tsx" 7
# ⑦报告卡片样式锚（实测 1——border-l-2 主色边 + 浅主色底的视觉分级样式串）
check "agent报告卡片样式锚"    "border-l-2 border-l-primary bg-primary/\[0\.04\]" "src/components/studio/AgentPanel.tsx" 1
# ⑧runner 执行白名单膜锚（实测 1——membrane/lipid/bilayer/pore 四命令头一行；删则 agent 无法执行膜技能）
check "agent runner膜白名单锚" "'membrane', 'lipid', 'bilayer', 'pore'" "src/lib/molecular/agent/runner.ts" 1
# ⑨route 打捞白名单膜锚（实测 1——与 runner 同步的 KNOWN_CMD_HEADS 四命令头）
check "agent route打捞白名单锚" "'membrane', 'lipid', 'bilayer', 'pore'" "src/app/api/agent/route.ts" 1
# ⑩协议 skillId 字段锚（实测 2——AgentRequestBody 请求体 + AgentChatMessage 持久化消息双字段）
check "agent协议skillId锚"     "skillId\?: string" "src/lib/molecular/agent/protocol.ts" 2
# ⑪命令速查膜孔道词条锚（实测 1——COMMAND_REF 分析行的 membrane/pore 语法说明；删则 LLM 不知命令存在）
check "agent速查膜孔道词条锚"  "membrane \[厚度Å\]\|off（脂双层示意板" "src/app/api/agent/route.ts" 1

# ---- r106：mock-llm 技能感知 + 技能库扩容四支 + matchSkill 并列决胜 + 技能选择器 ----
# 用户指令「进行下一阶段开发」——r105 建议清单第 1/2 项落地：
# ①mock-llm 收到含技能注入段的 system 时按技能 workflow 生成命令序列与固定格式报告
#   （技能遵循度的 QA 基础设施——E2E 技能链从「前端注入 localStorage」升级为真端到端）；
# ②skills.ts 注册表 6→10（sasa 表面 / xcontacts 跨结构 / morph 构象 / symmetry 晶格）；
# ③matchSkill 两项升级：技能内重叠去重（weak 是已命中 strong 的子串不计分）+ 跨技能
#   特异性决胜（总分并列比命中触发词总字长——「跨结构互作分析」不再与 ligand-pocket
#   平局判歧义、「蛋白蛋白互作分析」修正归属 interface）；④AgentPanel 技能选择器芯片栏
#   （点选强制绑定 skillId——不依赖自然语言措辞也能走标准流程）。
# 以下十锚防各环节被改写/删除静默退化（实测数见各行注释；括号为 rg 正则分组
# alternation 沿 r105 手法，无 $/反引号——bash 双引号内安全）：
# ①扩容四支 id 锚（实测 4——任一新技能被删即 FAIL）
check "agent技能扩容四支锚"    "id: 'sasa-surface'|id: 'xcontact-analysis'|id: 'morph-conformations'|id: 'symmetry-assembly'" "src/lib/molecular/agent/skills.ts" 4
# ②匹配特异性决胜锚（实测 3——bestSpec 声明+并列比较双站点；删则总分并列回到一律判歧义）
check "agent匹配特异性决胜锚"  "bestSpec" "src/lib/molecular/agent/skills.ts" 3
# ③技能内重叠去重锚（实测 2——weak 子串吸收判定中英双站点；删则同词族双计虚抬分数）
check "agent匹配重叠去重锚"    "strongHits.some" "src/lib/molecular/agent/skills.ts" 2
# ④技能选择器状态锚（实测 9——pinnedSkill 状态/发送优先级/预览/芯片/取消全链站点）
check "agent技能选择器锚"      "pinnedSkill" "src/components/studio/AgentPanel.tsx" 8
# ⑤技能选择器入口锚（实测 1——aria-label「选择标准技能」按钮；删则芯片栏不可达）
check "agent技能选择器入口锚"  "选择标准技能" "src/components/studio/AgentPanel.tsx" 1
# ⑥mock 注入段解析锚（实测 2——parseSkillDirective 定义+调用；删则技能感知退回关键词模板）
check "mock注入段解析锚"       "parseSkillDirective" "mini-services/mock-llm/index.ts" 2
# ⑦mock 场景快照解析锚（实测 2——parseSceneFacts 定义+调用；删则报告数值全为 —）
check "mock场景快照解析锚"     "parseSceneFacts" "mini-services/mock-llm/index.ts" 2
# ⑧mock 报告填值锚（实测 2——fillSkillReportValue 定义+调用；删则报告无章节行）
check "mock报告填值锚"         "fillSkillReportValue" "mini-services/mock-llm/index.ts" 2
# ⑨mock 场景结构替换锚（实测 2——substituteSceneStructs 定义+调用；删则 morph/xcontact 模板命令不随场景替换）
check "mock场景结构替换锚"     "substituteSceneStructs" "mini-services/mock-llm/index.ts" 2
# ⑩mock 注入段标记锚（实测 2——与 buildSkillDirective 输出的标记串一致〔注释+正则〕；标记改文案两侧不同步即 FAIL）
check "mock注入段标记锚"       "本次任务命中标准技能" "mini-services/mock-llm/index.ts" 2

# ---- r107：真实 LLM 报告格式 recency 加固 + 技能报告两段式执行（回执数值回填） ----
# 用户指令「进行下一阶段开发，并进行qa测试和e2e测试，并根据测试结果规划后续开发计划」
# ——r106 E2E 实测坐实的两大缺口根修：
# ①真实 LLM 报告格式遵循率 0（注入段在系统提示位、recency 弱于 PROTOCOL_SUFFIX——英文
#   散文覆盖固定格式）：route.ts 末条 user 消息追加 SKILL_FORMAT_SUFFIX（与协议提醒同
#   机制的近距离锚）+ skills.ts 注入段附 few-shot JSON 嵌套示例（单行、\n 字面转义）；
# ②报告回执类数值恒为「—」的单轮架构根因：两段式——runTurn 返回执行记录 → AgentPanel
#   在命令执行完毕后把「草稿+回执+运行时补充」二次送 LLM 回填（isSkillReport 卡点——
#   回填不合规保留草稿）；mock-llm 新增 0.4 回填分支（节域正则机械提取，诚实优先）。
# 以下十一锚防各环节被改写/删除静默退化（实测数见各行注释；括号/管道转义沿 r105-r106 手法）：
# ①route 技能格式 recency 锚（实测 2——SKILL_FORMAT_SUFFIX 定义+末条 user 消息拼接；删则真实 LLM 报告格式遵循率回退）
check "route技能格式recency锚"  "SKILL_FORMAT_SUFFIX" "src/app/api/agent/route.ts" 2
# ②注入段 few-shot 示例锚（实测 2——示例标题行+文档注释；删则 LLM 不知报告嵌在 JSON reply 字段内）
check "注入段few-shot示例锚"    "输出示例" "src/lib/molecular/agent/skills.ts" 2
# ③回填消息标记单站点锚（实测 2——REPORT_FILL_MARKER 定义+组包引用；改值须两端同步否则 mock 分支失聪）
check "回填标记单站点锚"        "REPORT_FILL_MARKER" "src/lib/molecular/agent/skills.ts" 2
# ④回填 prompt 构建锚（实测 3——注释+import+调用；删则两段式第二段无消息可发）
check "回填prompt构建锚"        "buildReportFillPrompt" "src/components/studio/AgentPanel.tsx" 3
# ⑤回填格式卡点锚（实测 1——isSkillReport(fill.reply)；删则回填散文直接覆盖报告草稿）
check "回填格式卡点锚"          "isSkillReport\(fill.reply\)" "src/components/studio/AgentPanel.tsx" 1
# ⑥runTurn 回执返回锚（实测 1——return records；删则回填无回执来源）
check "runTurn回执返回锚"       "return records" "src/components/studio/AgentPanel.tsx" 1
# ⑦fill 阶段锚（实测 3——setPhase+标签+提示文案；删则回填期间无进度反馈）
check "fill阶段锚"              "'fill'" "src/components/studio/AgentPanel.tsx" 3
# ⑧BusyPhase fill 锚（实测 1——chat-store 联合类型字面段；删则 setPhase('fill') tsc 报错）
check "BusyPhasefill锚"         "'visual' \| 'fill'" "src/lib/molecular/agent/chat-store.ts" 1
# ⑨mock 回填分支锚（实测 2——fillReportFromReceipts 定义+0.4 分支调用；删则 mock 把回填当普通对话）
check "mock回填分支锚"          "fillReportFromReceipts" "mini-services/mock-llm/index.ts" 2
# ⑩mock 节域提取锚（实测 2——fillFromReceiptsByLabel 定义+调用；删则回填永远 —）
check "mock节域提取锚"          "fillFromReceiptsByLabel" "mini-services/mock-llm/index.ts" 2
# ⑪mock 回填标记同步锚（实测 2——分支注释+startsWith 检测；与 skills.ts REPORT_FILL_MARKER 值双站点同步哨兵）
check "mock回填标记同步锚"      "报告回执回填" "mini-services/mock-llm/index.ts" 2

# ---- r108：回执数值源扩容（计算类命令有界轮询 + hbonds 回执补键数）+ 回填 UX（闪高亮/toast/技能计数） ----
# 用户指令「进行下一阶段开发，并进行qa测试和e2e测试，并根据测试结果规划后续开发计划」
# ——r107 E2E 实测坐实的回填链缺口根修：
# ①计算类命令（sasa/bsa/xbsa）回执常为「计算中」——700ms 单次延迟不够大结构 Web Worker，
#   报告回填拿到的是占位文案而非实测值：execAgentCmd 有界轮询（5s）等结果日志落地
#   （consoleLog seq 单调——「计算中」entry 之后出现 out entry 即完成，超时走旧兜底）；
# ②hbonds 回执只含烘焙原子数不含键数：轮询 hbond-store（visible && !computing，3s 有界）
#   把「氢键网络当前 N 条（其中涉水 M）」追加进回执——与运行时补充行同锚格式，mock/真实
#   LLM 都可从回执直接提取；mock 氢键正则补 EN 分支（H-bond network: currently N bonds）；
# ③回填 UX：protocol filled 字段 + 报告卡 fill-flash 闪高亮（1.6s 淡出）+ toast 双语；
# ④技能使用计数：msgs 派生 skillCounts + 弹层项 ×N 徽章（probe-pop 弹跳，key 变化重播）。
# 以下十二锚防各环节被改写/删除静默退化（实测数见各行注释）：
# ①计算轮询常量锚（实测 2——注释+CALC_WAIT_PREFIXES 定义；删则 sasa/bsa 回填恒为「后台计算中」）
check "计算轮询常量锚"          "CALC_WAIT_PREFIXES" "src/lib/molecular/agent/runner.ts" 2
# ②计算轮询落地锚（实测 2——landed 判定+返回；删则轮询空转永超时）
check "计算轮询落地锚"          "landed" "src/lib/molecular/agent/runner.ts" 2
# ③氢键statLine锚（实测 2——statLine 定义+注释提及；删则 hbonds 回执无键数、回填链失实测值）
check "氢键statLine锚"          "氢键网络当前" "src/lib/molecular/agent/runner.ts" 2
# ④氢键store轮询锚（实测 1——hb.visible && !hb.computing 完成判据；改则轮询读半成品统计）
check "氢键store轮询锚"         "hb.visible && !hb.computing" "src/lib/molecular/agent/runner.ts" 1
# ⑤mock氢键EN正则锚（实测 1——H-bond network: currently 分支；删则 EN 语言回执氢键数无法回填）
check "mock氢键EN正则锚"        "H-bond network: currently" "mini-services/mock-llm/index.ts" 1
# ⑥protocol filled 字段锚（实测 1——filled?: boolean；删则 tsc 报错挡回填标记写入）
check "protocolfilled字段锚"    "filled\?: boolean" "src/lib/molecular/agent/protocol.ts" 1
# ⑦AgentPanel 回填标记锚（实测 1——patchAi({filled: true})；删则闪高亮永不触发）
check "回填标记写入锚"          "filled: true" "src/components/studio/AgentPanel.tsx" 1
# ⑧回填 toast 锚（实测 1——toast.success 双语文案；删则数值真实化无可感知反馈）
check "回填toast锚"             "报告数值已按命令回执回填" "src/components/studio/AgentPanel.tsx" 1
# ⑨闪高亮 class 锚（实测 1——isReport && m.filled 条件类；删则 fill-flash 定义成死代码）
check "闪高亮class锚"           "fill-flash" "src/components/studio/AgentPanel.tsx" 1
# ⑩css keyframes 锚（实测 3——@keyframes 定义+.fill-flash 类+animation 引用；删则类无动画）
check "闪高亮keyframes锚"       "fill-flash" "src/app/globals.css" 2
# ⑪技能计数派生锚（实测 4——useMemo 定义+弹层徽章引用 3 处；删则计数徽章消失）
check "技能计数派生锚"          "skillCounts" "src/components/studio/AgentPanel.tsx" 4
# ⑫计数徽章文案锚（实测 1——本会话已使用次数 title；删则徽章无障碍提示丢失）
check "计数徽章文案锚"          "本会话已使用次数" "src/components/studio/AgentPanel.tsx" 1

# ---- r106-c：视觉基线场景扩容 3→7（r104 建议① / r105 建议③——r104 四支膜类模板入像素基线哨兵） ----
# 背景：r104 四支膜类模板（selectivity-filter/gpcr-retinal-pocket/beta-barrel-porin/
# toxin-pore-assembly）此前只有缩略图管线单次成像覆盖，无像素基线哨兵——gpcr 的
# create/disable 复合链路、7AHL 的 pore 计算链路（SYM 七重轴 + HOLE 剖面环带）的
# 渲染回归现在由 7 场景基线锁定（r106-c check 实测 7/7 全过、4 新场景漂移 0.00%）。
# 以下六锚防扩容被静默退化回 3 场景（括号为 rg 正则 alternation，沿 r105-a/r106-b
# 手法；含 $/{/| 的正则一律单引号护——r101-a/r104-b bash 双引号替换坑）：
# ①四新场景名锚（实测 4——SCENES 数组 name:wait:template: 结构行；删任一场景即 FAIL）
check "视觉基线膜类四场景锚"  "membrane-(1k4c|1f88|1pho|7ahl):[0-9]+:template:" "scripts/visual-baseline.sh" 4
# ②demo PDB 与模板 id 配对锚（实测 4——配对被改错 = 场景装载错结构/错模板而哨兵仍绿；
#    \| 为字面管道符，四个「PDB|模板 id」配对各 1 命中）
check "视觉基线模板装载对锚"  '1K4C\|selectivity-filter|1F88\|gpcr-retinal-pocket|1PHO\|beta-barrel-porin|7AHL\|toxin-pore-assembly' "scripts/visual-baseline.sh" 4
# ③template op 解析锚（实测 3——pdb 取 | 前段双站点〔load+cmd/template〕+ figure 命令
#    取 | 后段 1 站点；任一站点退回硬编码 4HHB = 四新场景全部装载/应用错位）
check "视觉基线template解析锚" 'pdb="\$\{params%%\|\*\}"|figure \$\{params#\*\|\}' "scripts/visual-baseline.sh" 3
# ④7AHL 重等待锚（实测 1——20,324 原子 + pore/membrane/util cbc 最重链路 13→20 的余量
#    等待；被砍短会造成着色/膜构建未落地的 capture↔check 帧相位漂移假红）
check "视觉基线7AHL重等待锚"  "membrane-7ahl:20:template:7AHL" "scripts/visual-baseline.sh" 1
# ⑤新基线文件存在锚（四张 PNG 必须在 scripts/visual-baselines/——rg 对 PNG 二进制无文本
#    锚可搜，沿「凭据不入库」if/else 手法；被删/漏 capture 即 FAIL 提示重拍）
BL_NEW=0
for f in membrane-1k4c membrane-1f88 membrane-1pho membrane-7ahl; do
  [ -s "scripts/visual-baselines/$f.png" ] && BL_NEW=$((BL_NEW + 1))
done
if [ "$BL_NEW" -eq 4 ]; then
  echo "PASS  视觉基线四新文件锚        命中  4（要求 ≥4）"
  PASSES=$((PASSES + 1))
else
  echo "FAIL  视觉基线四新文件锚        命中  $BL_NEW（要求 ≥4）—— scripts/visual-baselines/ 缺新基线 PNG（bash scripts/visual-baseline.sh capture 重拍）"
  FAILS=$((FAILS + 1))
fi
# ⑥双模式分派锚（实测 3——capture 存图分支 + capture 汇总分支 + check 比对调用；
#    SCENES 数组 capture/check 双模式共用，场景锚①②+分派锚合证双模式对新场景的覆盖）
check "视觉基线双模式分派锚"  'MODE" = "capture"|compare_baseline "\$name"' "scripts/visual-baseline.sh" 3

# ---- r109：statLine UI 层补抓 + 报告节点击跳转 + 修正轮技能上下文 ----
# 用户指令「进行下一阶段开发，并进行qa测试和e2e测试，并根据测试结果规划后续开发计划」
# ——r108 建议清单第 1【高】/第 3【中】 + r106-parallel 遗留①② 落地：
# ①r109-a（r108 G1 实测根修·方案 B）：技能轮渲染负载下 hbonds statLine 超 runner 5.25s
#   有界轮询未入回执——回填前 hbond-store 若已就绪，把键数补进该命令回执（records 本地
#   副本 + patchCmds 可见命令卡 output 同步更新；已含 statLine 或无 hbonds 命令零改动）；
# ②r109-b 报告节点击跳转：ReportSection 增 jump 字段（'view'/'zoom'/'ray'/'preset' 回放
#   该消息最后一条成功同类命令——场景实参已在其中；静态命令原样执行；缺省不可跳），
#   报告卡 ▌ 节行可点（hover 底色 + CornerDownRight 图标浮现），命令卡追加到同一消息
#   （复用状态/输出/展开审计全链）——报告从只读文稿升级为可交互分析入口；
# ③r109-c 修正轮技能上下文（r106-parallel 遗留①）：runTurn 增 skillId 形参，自动修正轮
#   随请求上送（route 重注入标准流程）；mock 0.45 分支（先于 0.5——否则整段 workflow 回放
#   重复已成功命令）：从修正 prompt 提取失败命令行，场景替换后回放——修正不偏离技能
#   workflow 命令域；链 ID 场景替换（遗留②）：chain A/B、interface A B 按场景链保守替换
#   （模板字母不在场景链清单时才动），0.5 workflow 命令同步接入。
# 以下十七锚防各环节被改写/删除静默退化（实测数见各行注释）：
# ①jump 字段锚（实测 1——ReportSection jump?: string；删则 tsc 挡住、节行恒不可点）
check "jump字段锚"              "jump\?: string" "src/lib/molecular/agent/skills.ts" 1
# ②jump 值分布锚（实测 27——10 技能 27 个可跳节；缩水 = 跳转覆盖面退化）
check "jump值分布锚"            "jump: '" "src/lib/molecular/agent/skills.ts" 27
# ③jump 解析函数锚（实测 1——reportSectionJumpCmd 纯函数定义；删则全部节行不可点）
check "jump解析函数锚"          "reportSectionJumpCmd" "src/lib/molecular/agent/skills.ts" 1
# ④jump 回放表锚（实测 2——JUMP_REPLAY 定义+查表；删则 view/zoom/ray/preset 退化为静态串）
check "jump回放表锚"            "JUMP_REPLAY" "src/lib/molecular/agent/skills.ts" 2
# ⑤节跳转接入锚（实测 3——import 注释+import+调用；删则报告卡与解析函数断链）
check "节跳转接入锚"            "reportSectionJumpCmd" "src/components/studio/AgentPanel.tsx" 3
# ⑥节跳转回放源锚（实测 4——okCmds 定义+调用〔r109 新增〕+ buildMemoryDigest 既有 2；
#    新增 2 处被删 → 命中跌回 2 触发 FAIL）
check "节跳转回放源锚"          "okCmds" "src/components/studio/AgentPanel.tsx" 4
# ⑦jumpTo 锚（实测 2——定义+onClick 调用；删则点击无执行）
check "jumpTo锚"                "jumpTo" "src/components/studio/AgentPanel.tsx" 2
# ⑧节跳转按钮锚（实测 1——group/jump 命名组 className；删则 hover 联动全失效）
check "节跳转按钮锚"            "group/jump" "src/components/studio/AgentPanel.tsx" 1
# ⑨节跳转hover锚（实测 2——数值行+图标行 group-hover/jump 变体；删则视觉反馈缺失）
check "节跳转hover锚"           "group-hover/jump" "src/components/studio/AgentPanel.tsx" 2
# ⑩节跳转title锚（实测 3——注释+jumpTo 注释+title 提示；删则无障碍/悬浮提示丢失）
check "节跳转title锚"           "点击跳转" "src/components/studio/AgentPanel.tsx" 3
# ⑪补抓records锚（实测 3——let fillRecords+patched 判定+回填 prompt 组包；删则回填源回退未补抓态）
check "补抓records锚"           "fillRecords" "src/components/studio/AgentPanel.tsx" 3
# ⑫补抓注释锚（实测 1——r109-a 方案 B 注释块标识；删则补抓意图不可追溯）
check "补抓注释锚"              "UI 层补抓" "src/components/studio/AgentPanel.tsx" 1
# ⑬runTurn skillId 形参锚（实测 3——callAgent/callAgentStream/runTurn 三签名；runTurn 形参
#    被删 → 命中跌回 2 触发 FAIL——修正轮技能上下文断链）
check "runTurn skillId形参锚"   "skillId\?: string" "src/components/studio/AgentPanel.tsx" 3
# ⑭修正轮传递锚（实测 3——fix callAgent 末参+fix 递归+视觉修正递归；删任一则该轮失去技能上下文）
check "修正轮传递锚"            ", skillId\)" "src/components/studio/AgentPanel.tsx" 3
# ⑮mock修正轮分支锚（实测 1——0.45 分支回执文案；删则修正轮回落关键词模板跑偏流程）
check "mock修正轮分支锚"        "已按标准技能流程修正失败命令" "mini-services/mock-llm/index.ts" 1
# ⑯mock修正轮识别锚（实测 2——条件正则+注释；改文案则 0.45 失配静默退化）
check "mock修正轮识别锚"        "执行失败了，请修正" "mini-services/mock-llm/index.ts" 2
# ⑰mock链替换锚（实测 3——substituteSceneChains 定义+0.45 接入+0.5 接入；删则 interface A B
#    在 A/B 链不在场的场景恒报错、修正轮回放不替换链）
check "mock链替换锚"            "substituteSceneChains" "mini-services/mock-llm/index.ts" 3

# ---- r110：mockd 看门狗 + 跳转溯源 + 修正轮真修正 ----
# 用户指令「进行下一阶段开发，并进行qa测试和e2e测试，并根据测试结果规划后续开发计划」
# ——r109 下一轮建议第 1【高】/ 第 4【中】落地：
# ①r110-a mock-llm 看门狗（独立 scripts/mockd.py——r109 建议「devd 增 3999 探活」的
#   独立守护实现路径：替换运行中 devd 须中断 dev server，独立进程零中断部署）：两级探活
#   （L1 GET /v1/models 任何 HTTP 响应即活 30s 周期；L2 流式探针 POST stream:true 断言
#   [DONE] 尾——r109 实测损坏态「非流式正常流式挂起」的表形态探针，120s 周期）；L1 连续
#   3 败 / L2 连续 2 败触发单例重启（lsof 端口反查清旧 + /proc cwd 兜底 + Popen 脱离 +
#   有界等活）；1h 窗 ≥3 次重启退避 30min。实战闭环验证：本轮 mock 热重载损坏（curl 实测
#   流式只吐 1/3 无 [DONE]）被 mockd 2min15s 自愈（L2 streak2 → 重启 → L1/L2 复活单例）——
#   r109 同款故障 40 分钟人工取证的缺口就此闭环；
# ②r110-b 跳转命令溯源：AgentCmdRecord 增 sourceJump（节标签持久化），jumpTo 追加命令卡
#   时写入，命令卡头部「跳转自报告节 · X」徽章（审计链可读：报告节 → 跳转 → 命令卡）；
#   报告节 hover 标签变主色（r109 建议③ hover 细节增强的第一步）；
# ③r110-c 修正轮真修正（r109 建议第 4 项）：mock 0.45 提取升级捕获失败 output（改写判据），
#   fixRewriteCommand 语义改写——空选择错误 + 命令含 ligand（无配体结构跑配体技能）时
#   view from ligand→orient / zoom within N of (ligand)→zoom / 其余 ligand→polymer 词级
#   替换；命令含 chain X → chains list 探测（单轮 mock 无法探测后重组，诚实降级）；
#   无规则命中保持 r109 场景替换回放（非空选择类失败不受影响）。
# 以下十七锚防各环节被改写/删除静默退化（实测数见各行注释）：
# ①mockd L1 探针锚（实测 3——探活 URL+docstring+注释；删则 L1 失明、死亡态无人发现）
check "mockd L1探针锚"            "/v1/models" "scripts/mockd.py" 3
# ②mockd L2 DONE 断言锚（实测 1——流式探针核心判据；删则热重载损坏态失明——r109 故障形态）
check "mockd L2 DONE锚"           "data: \[DONE\]" "scripts/mockd.py" 1
# ③mockd 重启阈值锚（实测 3——L1/L2 两阈值定义+判定行；放松 = 故障发现变慢或永不触发）
check "mockd 阈值锚"              "FAILS_RESTART" "scripts/mockd.py" 3
# ④mockd lsof 反查锚（实测 4——端口反查清旧〔r109 教训：pkill 按目录名失配〕+注释；删则重启 EADDRINUSE）
check "mockd lsof锚"              "lsof" "scripts/mockd.py" 4
# ⑤mockd 退避锚（实测 3——BACKOFF 常量+触发+注释；删则重启风暴无防护）
check "mockd 退避锚"              "BACKOFF" "scripts/mockd.py" 3
# ⑥mockd 防双实例锚（实测 2——already_running 定义+main 调用；删则双守护互踩+日志双写）
check "mockd 防双实例锚"          "already_running" "scripts/mockd.py" 2
# ⑦sourceJump 字段锚（实测 1——protocol.ts 字段定义；删则持久化与徽章数据源断链）
check "sourceJump字段锚"          "sourceJump\?: string" "src/lib/molecular/agent/protocol.ts" 1
# ⑧jumpTo 写入锚（实测 1——命令记录写入 sourceJump: label；删则徽章无来源数据）
check "jumpTo写入锚"              "sourceJump: label" "src/components/studio/AgentPanel.tsx" 1
# ⑨溯源徽章文案锚（实测 1——EN 徽章文案；删则审计链丢失跳转来源标注）
check "溯源徽章文案锚"            "Jumped from report section" "src/components/studio/AgentPanel.tsx" 1
# ⑩hover 主色锚（实测 1——节标签行 group-hover/jump:text-primary；删则 hover 细节退化回灰）
check "hover主色锚"               "group-hover/jump:text-primary\"" "src/components/studio/AgentPanel.tsx" 1
# ⑪MousePointerClick 锚（实测 2——图标 import+徽章使用；删则 tsc 挡住徽章渲染断链）
check "MousePointerClick锚"       "MousePointerClick" "src/components/studio/AgentPanel.tsx" 2
# ⑫fixRewrite 函数锚（实测 2——定义+0.45 接入；删则修正轮回退「同名重试必再失败」仪式态）
check "fixRewrite函数锚"          "fixRewriteCommand" "mini-services/mock-llm/index.ts" 2
# ⑬fixRewrite 空选择锚（实测 2——ZH/EN 错误文案正则+注释；放松 = 非空选择失败也可触发改写）
check "fixRewrite空选择锚"        "matched 0 atoms" "mini-services/mock-llm/index.ts" 2
# ⑭fixRewrite polymer 规则锚（实测 1——ligand 词级替换目标；删则 contacts/hbonds 类失败降级路径断）
check "fixRewrite polymer锚"      "'polymer'" "mini-services/mock-llm/index.ts" 1
# ⑮fixRewrite 链探测锚（实测 1——return 'chains list'；删则链不存在类失败无探测路径）
check "fixRewrite链探测锚"        "return 'chains list'" "mini-services/mock-llm/index.ts" 1
# ⑯提取配对锚（实测 1——matchAll 捕获 cmd+output 二元组；回退单捕获 = 改写无据可依）
check "提取配对锚"                "\[m\[1\]\.trim\(\), m\[2\]\.trim\(\)\]" "mini-services/mock-llm/index.ts" 1
# ⑰改写文案锚（实测 1——EN 改写发生文案；删则用户无法感知「按失败原因修正」动作）
check "改写文案锚"                "fixed by failure cause" "mini-services/mock-llm/index.ts" 1

# ---- r111：mockd 编辑监听 + 报告节 hover 预览 + 修正轮链族扩容 ----
# 用户指令「进行下一阶段开发，并进行qa测试和e2e测试，并根据测试结果规划后续开发计划」
# ——r110 下一轮建议第 1【高】/ 第 4【中】（r109 建议③ 剩余子项）落地：
# ①r111-a mockd 源码变更即时验证（r110 建议①：热重载损坏高频化的响应加速）——主循环
#   30s 粗粒度改 1s 小步进，每秒比对 mini-services/mock-llm/index.ts 的 mtime；变更即
#   立即 L2 探针（1s 热重载宽限）；失败再等 3s 复验（热重载可能在途）；仍失败才重启
#   ——mid-write 损坏自愈从 ~2min15s（L2 周期发现）缩到 ~5s。正常编辑 L2 通过零动作只
#   记日志（不误杀）。实战首验：本轮编辑 mock-llm 后 mockd 1s 内检测 + L2 确认健康 +
#   零重启；
# ②r111-b 报告节 hover 3D 预览（r109 建议③/r110 建议④ 剩余子项）：跳转命令携带的选择子
#   （view from (chain A and chain B) 的括号内表达式 / zoom within N of (ligand) 的
#   目标子）无副作用求值（store.previewExpr——不落全局选择）→ engine.previewHighlight
#   青色薄纱罩亮（与选择光晕 amber 分色、不参与拾取）；点击跳转/blur/卸载时清除——
#   「先看一眼再跳」的两段式交互；zoom/orient/ray/preset 结构级命令无局部选择子不预览；
# ③r111-c 修正轮链族扩容（r110 建议⑤）：链不存在族文案「未找到链 X——可用链：…/
#   Chain X not found — available: …」单列优先分支 → chains list 探测（该族与空选择
#   四族文案互斥先判不抢 ligand 降级；chains hide X 形态不含 \bchain\s+X\b 词式——
#   逐形态规则必漏，文案族单列是唯一全覆盖路径）。
# 以下十六锚防各环节被改写/删除静默退化（实测数见各行注释）：
# ①mockd mtime 函数锚（实测 3——定义+启动基线+循环内比对；删则编辑监听失明回退 2min 周期发现）
check "mockd mtime函数锚"         "mock_source_mtime" "scripts/mockd.py" 3
# ②mockd 变更检测日志锚（实测 1——source change detected 行；删则编辑检测静默失联）
check "mockd 变更检测锚"          "source change detected" "scripts/mockd.py" 1
# ③mockd 热重载宽限锚（实测 2——HOT_RELOAD_GRACE_S 常量+sleep；删则热重载未完成即探针误判）
check "mockd 热重载宽限锚"        "HOT_RELOAD_GRACE_S" "scripts/mockd.py" 2
# ④mockd 编辑复验锚（实测 2——EDIT_RETRY_S 常量+sleep；删则单次探针失败即重启误杀正常编辑）
check "mockd 编辑复验锚"          "EDIT_RETRY_S" "scripts/mockd.py" 2
# ⑤mockd 主循环粒度锚（实测 3——WATCH_TICK_S 常量+sleep+elapsed 累计；回退 30s = 监听分辨率退化）
check "mockd 主循环粒度锚"        "WATCH_TICK_S" "scripts/mockd.py" 3
# ⑥engine 预览 API 锚（实测 2——previewHighlight 定义+StructureView 注释；删则 hover 无渲染通道）
check "engine 预览API锚"          "previewHighlight" "src/lib/molecular/engine.ts" 2
# ⑦engine 预览清理锚（实测 3——clearPreviewMeshes 定义+两公开方法调用；删则预览残影叠加新视角）
check "engine 预览清理锚"         "clearPreviewMeshes" "src/lib/molecular/engine.ts" 3
# ⑧store 无副作用求值锚（实测 2——previewExpr 声明+实现；删则预览退回 selectFromExpr 改用户选择）
check "store 无副作用求值锚"      "previewExpr" "src/lib/molecular/store.ts" 2
# ⑨skills 预览表达式锚（实测 1——previewExprFromJumpCmd 定义；删则 hover 无选择子可提取）
check "skills 预览表达式锚"       "previewExprFromJumpCmd" "src/lib/molecular/agent/skills.ts" 1
# ⑩skills 括号包裹判断锚（实测 3——isWrappedExpr 定义+两调用；删则 (A) or (B) 形态误剥外层括号致求值失败）
check "skills 括号包裹锚"         "isWrappedExpr" "src/lib/molecular/agent/skills.ts" 3
# ⑪hover 接线锚（实测 1——onMouseEnter；删则鼠标悬停无预览。r112-b 同步更新：调用形态
# previewJump(jump) → previewJump(jump, jumpLabel)（ARIA 标签入参——功能合法演进非回滚））
check "hover 接线锚"              'onMouseEnter=\{\(\) => previewJump\(jump, jumpLabel\)\}' "src/components/studio/AgentPanel.tsx" 1
# ⑫focus 接线锚（实测 1——onFocus 键盘可达；删则键盘用户无预览。r112-b 同步更新同⑪）
check "focus 接线锚"              'onFocus=\{\(\) => previewJump\(jump, jumpLabel\)\}' "src/components/studio/AgentPanel.tsx" 1
# ⑬AgentPanel 预览清除锚（实测 3——clearPreviewJump 定义+jumpTo 点击清除+useEffect 卸载清理；删则残影/泄漏）
check "AgentPanel 预览清除锚"     "clearPreviewHighlight" "src/components/studio/AgentPanel.tsx" 3
# ⑭mock 链族 ZH 锚（实测 3——「未找到链」正则+注释×2；删则链不存在失败不改写回仪式态）
check "mock 链族ZH锚"             "未找到链" "mini-services/mock-llm/index.ts" 3
# ⑮mock 链族 EN 锚（实测 1——Chain \S+ not found 正则；删则 EN 界面链族漏判）
check "mock 链族EN锚"             'Chain \\S\+ not found' "mini-services/mock-llm/index.ts" 1
# ⑯mock 链族优先注释锚（实测 1——单列于空选择判据之前的顺序说明；重排则链族分支被空选择 return 拦截）
check "mock 链族优先锚"           "单列于空选择判据之前" "mini-services/mock-llm/index.ts" 1

# ---- r112-a：devd 采纳模式 + devd/mockd 互察 + 启动链带起双守护 ----
# r111 建议①（r110 建议②持续挂起项）：沙箱重启后环境先直起 dev server、后补 devd 因端口
# 占用静默退位（3000 无守护缺口，r111 实证）。采纳模式=端口活→收养监护（端口轮询+内存
# 看门狗按 pid 换血）→实例死亡转 spawn 循环；互察=双方周期探对方 pid 死亡报警+拉起（防
# 「守护的守护」盲区）；dev.sh 启动链带起双守护（沙箱走此链重启不再缺席）。
# ①采纳分支锚（实测 1——adopting 日志行；删则后补 devd 又静默退位，3000 无守护回归）
check "devd 采纳分支锚"            "adopting existing instance" "scripts/devd.py" 1
# ②采纳监护函数锚（实测 1——supervise_adopted；删则收养态无人轮询端口与内存）
check "devd 采纳监护锚"            "def supervise_adopted" "scripts/devd.py" 1
# ③采纳死亡转spawn锚（实测 1——收养实例死亡日志；删则收养实例死后无人拉起自有实例）
check "devd 采纳死亡锚"            "adopted instance died; spawn own" "scripts/devd.py" 1
# ④采纳换血标注锚（实测 4——adopted instance 日志族（死亡+换血绝对阈值+斜率+文档）；删则收养实例内存失控）
check "devd 采纳换血锚"            "adopted instance" "scripts/devd.py" 4
# ⑤按pid终止锚（实测 1——stop_pid：收养实例无 Popen 句柄，换血须按 pid 终止）
check "devd 按pid终止锚"           "def stop_pid" "scripts/devd.py" 1
# ⑥pid-RSS扫描锚（实测 5——server_pid_rss（定义+调用+注释）；删则看门狗对收养实例失明）
check "devd pidRSS扫描锚"          "server_pid_rss" "scripts/devd.py" 5
# ⑦防双实例锚（实测 1——devd.py already_running 函数定义；采纳模式使端口防线失效，pid 文件是唯一防双闸）
check "devd 防双实例锚"            "def already_running" "scripts/devd.py" 1
# ⑧pid文件锚（实测 3——devd.pid（PID_FILE 组装+注释×2）；删则双 devd 互踩收养同一端口）
check "devd pid文件锚"             "devd\.pid" "scripts/devd.py" 3
# ⑨互察mockd函数锚（实测 3——cross_check_mockd（定义+双调用点：收养循环+spawn 循环）；删则 mockd 死亡无人管）
check "devd 互察函数锚"            "cross_check_mockd" "scripts/devd.py" 3
# ⑩互察存活汇总锚（实测 2——mockd ok (pid= 日志族（格式串+注释）；删则守护盲区无周期可观测性）
check "devd 互察汇总锚"            "mockd ok \(pid=" "scripts/devd.py" 2
# ⑪互察死亡拉起锚（实测 1——mockd dead; relaunching 报警行；删则 mockd 静默死无自愈）
check "devd 互察拉起锚"            "mockd dead; relaunching" "scripts/devd.py" 1
# ⑫mockd互察pid锚（实测 2——devd_pid（定义+调用）；删则 mockd 对 devd 死亡失明）
check "mockd 互察pid锚"            "devd_pid" "scripts/mockd.py" 2
# ⑬mockd互察周期锚（实测 3——DEVD_CHECK_S（常量+主循环取模+注释）；删则互察退化为永不触发）
check "mockd 互察周期锚"           "DEVD_CHECK_S" "scripts/mockd.py" 3
# ⑭mockd互察拉起锚（实测 1——devd dead; relaunching；删则 devd 死后 mockd 不补位（采纳模式使其有意义））
check "mockd 互察拉起锚"           "devd dead; relaunching" "scripts/mockd.py" 1
# ⑮启动链devd锚（实测 1——dev.sh 起 devd.py；删则沙箱走此链重启后 3000 无守护）
check "启动链devd锚"               'scripts/devd\.py' ".zscripts/dev.sh" 1
# ⑯启动链mockd锚（实测 1——dev.sh 起 mockd.py（幂等）；删则走此链重启后 3999 无守护）
check "启动链mockd锚"              'scripts/mockd\.py' ".zscripts/dev.sh" 1
# ⑰mockd重启脚本锚（实测 2——restart-mockd.sh 读 mockd.pid（停+验）；删则守护代码更新无旁路重启法）
check "mockd重启脚本锚"            'mockd\.pid' ".zscripts/restart-mockd.sh" 2
# ⑱devd重启脚本锚（实测 2——restart-devd.sh 读 devd.pid（停+验）；删则守护代码更新无旁路重启法）
check "devd重启脚本锚"             'devd\.pid' ".zscripts/restart-devd.sh" 2

# ---- r112-b：报告节 hover 预览增强——视口外原子 dim 聚焦通道 + ARIA 预览态描述 ----
# r111 建议②剩余子项：预览期间视口外原子 dim（聚焦感更强——材质级透明度 save/restore，
# 对称克隆共享材质自动连坐）+ 3D 预览的 ARIA 描述（屏幕阅读器感知预览态——live region
# 常驻 + 预览开始播报目标节标签与原子数，清屏静默防刷屏）。
# ①dim 因子常量锚（实测 2——PREVIEW_DIM_FACTOR 定义+引用；删则 dim 失参（回 1.0 全亮））
check "dim 因子常量锚"             "PREVIEW_DIM_FACTOR" "src/lib/molecular/engine.ts" 2
# ②dim 开关函数锚（实测 4——setRepDim 定义+三调用（previewHighlight 入口复位/成功施加/clear 复位）；删则聚焦通道断链）
check "dim 开关函数锚"             "setRepDim" "src/lib/molecular/engine.ts" 4
# ③dim save/restore 标记锚（实测 5——dim0/dimT0 存取族；删则透明度不可逆（dim 后不还原））
check "dim 存取标记锚"             "dim0" "src/lib/molecular/engine.ts" 5
# ④ARIA 状态锚（实测 2——previewAria 状态声明+渲染；删则预览态对屏幕阅读器不可见）
check "ARIA 状态锚"                "previewAria" "src/components/studio/AgentPanel.tsx" 2
# ⑤live region 锚（实测 1——aria-live=polite 常驻 status 区（先于内容更新存在才生效）；删则播报失效）
check "live region 锚"             'aria-live' "src/components/studio/AgentPanel.tsx" 1
# ⑥ARIA 写入锚（实测 3——setPreviewAria 调用族（预览开始带标签/无标签+清屏）；删则 live region 恒空）
check "ARIA 写入锚"                "setPreviewAria" "src/components/studio/AgentPanel.tsx" 3
# ⑦标签三用锚（实测 4——jumpLabel 提取+onClick 溯源/hover 预览/focus 预览三用（同一文本源防手抄漂移）；删则 ARIA 文案缺标签退化）
check "标签三用锚"                 "jumpLabel" "src/components/studio/AgentPanel.tsx" 4
# ⑧ARIA 中文文案锚（实测 1——正在预览：label（N 个原子）；删则播报无目标语义）
check "ARIA 中文文案锚"            "正在预览：" "src/components/studio/AgentPanel.tsx" 1

# ---- r112-c：E2E 视觉自查基线化——wait-stable-frame 工具 + e2e skill 铁律固化 ----
# r111 建议④：「异步派生落屏时序坑」的工程化收口——G1 类截图断言前统一等「渲染稳定
# 帧」（连续两截图漂移 ≤0.15% 才拍基线），工具固化为 .zscripts 约定 + skill 铁律
# （规则 9）；顺带固化 r112-a 新坑（Bash 单调用 sleep ≤90s——>~240s 断 MCP 网关）。
# ①稳定帧工具存在锚（实测 2——脚本名自引（文件头+注释）；删则工具缺位，E2E 回裸拍时序坑）
check "稳定帧工具锚"               "wait-stable-frame" ".zscripts/wait-stable-frame.sh" 2
# ②稳定帧 diff 算法锚（实测 2——ImageChops 差分（import+调用）；删则比对失法（恒 0 假稳定））
check "稳定帧diff锚"               "ImageChops" ".zscripts/wait-stable-frame.sh" 2
# ③稳定帧容差锚（实测 3——0.15 默认值族（文件头+TOL 默认+STABLE 文案）；改值须评估分离带（落屏 3-5.8% vs 终态 0.12%））
check "稳定帧容差锚"               "0\.15" ".zscripts/wait-stable-frame.sh" 3
# ④UNSTABLE 诚实口径锚（实测 2+——超轮数失败文案（主行+退出码注释）；删则超时静默成功（假稳定））
check "稳定帧UNSTABLE锚"           "UNSTABLE" ".zscripts/wait-stable-frame.sh" 2
# ④b渲染活性守卫锚（实测 3——perfLastT 双探（G1 实测：4-8s tick 间隔下零新帧的 0.000% 是同帧假稳定）；删则假稳定回归）
check "稳定帧活性守卫锚"           "perfLastT" ".zscripts/wait-stable-frame.sh" 3
# ④c同帧假稳定分支锚（实测 2——STALE-FRAME 分支（Python 判定+文案）；删则守卫失效退化纯像素）
check "稳定帧同帧分支锚"           "STALE-FRAME" ".zscripts/wait-stable-frame.sh" 2
# ⑤skill 规则9锚（实测 3——molvision-e2e SKILL.md 引用工具（标题+做法+纪律行）；删则铁律不传承，下轮 E2E 重踩时序坑）
check "skill稳定帧规则锚"          "wait-stable-frame" ".agent/skills/molvision-e2e/SKILL.md" 3
# ⑥skill 长sleep规则锚（实测 2——≤90s 铁律（断言纪律行+规则内文）；删则 r112-a 断会话坑重现无防线）
check "skill长sleep规则锚"         "90s" ".agent/skills/molvision-e2e/SKILL.md" 2

# ---- r113-a：拉马钱德兰图 QC 面板（孤儿模块 rama.ts 接入 UI——r111 建议⑥收口） ----
# φ/ψ 散点 + favored/allowed 分区背景 + 离群残基审计与选择（点击行/点 → 全局选择通道
# → 3D amber 光晕联动）。E2E 实证：4HHB 566 点 0 离群（99.3% favored）；1A2N 416 点
# 2 离群（A:ASN67 φ175° / A:SER349 φ52°）全链路（清单渲染 + 单行点击 + 全选 2 残基
# 14 原子）；Gly 筛选 40 点 + ε 独有区渲染；亮暗主题 MutationObserver 重绘。
# ①组件挂载锚（实测 2——AnalysisPanel import+渲染；删则面板不可达（孤儿模块回归））
check "拉马挂载锚"                 "RamaSection" "src/components/studio/panels/AnalysisPanel.tsx" 2
# ②计算内核接线锚（实测 3——computeRama 调用+类型引用族；删则散点恒空）
check "拉马计算锚"                 "computeRama" "src/components/studio/panels/RamaSection.tsx" 3
# ③分区背景采样锚（实测 3——classifyRama 网格采样（favored/allowed 双层底色）；删则背景无分区）
check "拉马分区锚"                 "classifyRama" "src/components/studio/panels/RamaSection.tsx" 3
# ④单残基选择锚（实测 3——selectResidue 定义+点点击+离群行点击；删则点击无选择）
check "拉马选择锚"                 "selectResidue" "src/components/studio/panels/RamaSection.tsx" 3
# ⑤残基原子展开锚（实测 3——residueAtomRange import+单选+全选（rama.ts 选择辅助）；删则选择集空）
check "拉马原子展开锚"             "residueAtomRange" "src/components/studio/panels/RamaSection.tsx" 3
# ⑥全选离群锚（实测 2——selectAllOutliers 定义+onClick；删则批量审计断链）
check "拉马全选锚"                 "selectAllOutliers" "src/components/studio/panels/RamaSection.tsx" 2
# ⑦离群清单锚（实测 1——slice(0, 60) 截断渲染（大离群数不爆列表）；删则长列表无界）
check "拉马离群清单锚"             "outliers\.slice" "src/components/studio/panels/RamaSection.tsx" 1
# ⑧类型筛选锚（实测 4——FILTERS 全部/通用/Gly/Pro（Gly/Pro 容差体系独立——背景随之切）；删则筛选退化）
check "拉马筛选锚"                 "FILTERS" "src/components/studio/panels/RamaSection.tsx" 4
# ⑨hover 探测锚（实测 2——onMove 最近点（≤7px 命中）+ onMouseMove 接线；删则 tooltip 失效）
check "拉马hover锚"                "onMove" "src/components/studio/panels/RamaSection.tsx" 2
# ⑩区域标签光环锚（实测 1——strokeText（密集散点下标签可读——VLM 实测 αR 被遮后加）；删则标签被散点淹没）
check "拉马标签光环锚"             "strokeText" "src/components/studio/panels/RamaSection.tsx" 1
# ⑪主题重绘锚（实测 2——MutationObserver 声明+observe（亮暗切换 canvas 重绘）；删则主题切换画布陈旧）
check "拉马主题重绘锚"             "MutationObserver" "src/components/studio/panels/RamaSection.tsx" 2
# ⑫canvas ARIA 锚（实测 1——role=img + aria-label（散点数/离群数/点击语义，双语）；删则屏幕阅读器不可感知）
check "拉马ARIA锚"                 'role="img"' "src/components/studio/panels/RamaSection.tsx" 1
# ⑬统计卡锚（实测 1——Favored 占比卡（favored/allowed/outlier 三卡同族）；删则 QC 概览缺失）
check "拉马统计卡锚"               "Favored" "src/components/studio/panels/RamaSection.tsx" 1
# ⑭离群清单标题锚（实测 1——「离群残基（φ/ψ 落在 3.5σ 之外）」（3.5σ 口径与 D2_ALLOWED 同源）；删则清单无题）
check "拉马离群题锚"               "离群残基（φ/ψ" "src/components/studio/panels/RamaSection.tsx" 1
# ⑮选择日志双语锚（实测 2——Ramachandran: selected（单选/全选两处英文文案族——离群行点击复用单选）；删则审计回显缺失）
check "拉马日志锚"                 "Ramachandran:" "src/components/studio/panels/RamaSection.tsx" 2
# ⑯空态锚（实测 2——无连续氨基酸（核苷酸/仅配体结构——注释+文案）；删则空态误渲染空画布）
check "拉马空态锚"                 "无连续氨基酸" "src/components/studio/panels/RamaSection.tsx" 2

# ---- r113-b：tee 双写踩踏根治（守护标记行独立落盘 .zscripts/daemon.log） ----
# r112-a 遗留①：采纳模式下被收养实例父链含 `next dev | tee dev.log`——tee 持非追加
# 偏移 fd 与守护 O_APPEND 写至相竞（r112-a 实测标记行 2s 内被覆盖）。根治：标记行
# 全量迁移 daemon.log（与 tee 零交集）；spawn 子进程 stdout 重定向仍写 dev.log（应用
# 日志本职去向）。附带诊断修正：r112-a 坑②「丢前 2 字符」实为启动态源码笔误（写
# "ockd]"）非 tee 踩踏——笔误入库前已修，dev.log 内 11 条 ockd 行均出自陈旧守护。
# ①devd 独立日志常量锚（实测 2——DAEMON_LOG 定义+log_line 引用；删则标记行回 dev.log 重遭踩踏）
check "devd独立日志锚"             "DAEMON_LOG" "scripts/devd.py" 2
# ②mockd 独立日志常量锚（实测 2——同上；删则同上）
check "mockd独立日志锚"            "DAEMON_LOG" "scripts/mockd.py" 2
# ③devd 标记行迁移锚（实测 1——log_line open(DAEMON_LOG)（全部 [devd] 标记的唯一落盘点）；删则标记回 dev.log）
check "devd标记落盘锚"             'open\(DAEMON_LOG' "scripts/devd.py" 1
# ④mockd 标记行迁移锚（实测 1——同上（[mockd] 标记唯一落盘点））
check "mockd标记落盘锚"            'open\(DAEMON_LOG' "scripts/mockd.py" 1
# ⑤mockd 前缀完整性锚（实测 3——[mockd 前缀族（docstring×2+f-string）；丢前缀则 grep 断链（r112-a 坑②的防线））
check "mockd前缀锚"                '\[mockd' "scripts/mockd.py" 3
# ⑥spawn stdout 仍写 dev.log 锚（实测 2——open(LOG（next dev stdout + mockd 重定向；改掉则崩溃回溯无去处）
check "devd应用日志锚"             'open\(LOG' "scripts/devd.py" 2
# ⑦根治理由锚（实测 2——tee 双写踩踏根治（docstring+注释）；删则后续维护者不知为何两套日志）
check "tee根治理由锚"              "tee 双写踩踏根治" "scripts/devd.py" 2
# ⑧诊断修正锚（实测 2——mockd 侧同款理由注释；删则 r112-a 坑②误诊断（tee 背锅）无更正）
check "mockd根治理由锚"            "tee 双写踩踏根治" "scripts/mockd.py" 2

# ---- r114-a：拉马离群 3D 聚焦 + 影视级检视（r113 建议①收口） ----
# 离群行点击选择+聚焦（fitView + 8Å 缓冲——zoom within 同一通道）；场记板图标一键
# zoom+isolate+label 三连（全走 runCommand——与命令行同一条代码路径，console 审计免费）。
# E2E 实证见 r114 段（1A2N 双离群行点击镜头聚焦 + 三连命令链 console 回显）。
# ①聚焦通道锚（实测 2——fitView 调用+engineRef import；删则行点击无镜头聚焦（只选不亮镜头回归））
check "拉马聚焦通道锚"             "fitView" "src/components/studio/panels/RamaSection.tsx" 2
# ②聚焦缓冲锚（实测 1——buffer: 8（残基 bounding sphere 外扩 8Å 留侧链上下文）；删则贴脸无语境）
check "拉马聚焦缓冲锚"             "buffer: 8" "src/components/studio/panels/RamaSection.tsx" 1
# ③影视检视函数锚（实测 2——cinematicInspect 定义+onClick；删则一键三连断链）
check "影视检视函数锚"             "cinematicInspect" "src/components/studio/panels/RamaSection.tsx" 2
# ④影视命令链锚（实测 6——runCommand import+四条命令（select/isolate/zoom/label）；删则绕开命令行路径）
check "影视命令链锚"               "runCommand" "src/components/studio/panels/RamaSection.tsx" 6
# ⑤影视隔离锚（实测 1——isolate ${sel}（隔离到残基所在链）；删则三连缺隔离）
check "影视隔离锚"                 'isolate \$\{sel\}' "src/components/studio/panels/RamaSection.tsx" 1
# ⑥影视标注锚（实测 1——runCommand('label')（残基原子标注）；删则三连缺标注）
check "影视标注锚"                 "runCommand\\('label'\\)" "src/components/studio/panels/RamaSection.tsx" 1
# ⑦场记板图标锚（实测 2——Clapperboard import+使用；删则按钮图标缺失）
check "场记板图标锚"               "Clapperboard" "src/components/studio/panels/RamaSection.tsx" 2
# ⑧聚焦日志锚（实测 2——「并聚焦」按 opts.focus 分支（zh 日志+注释）；删则审计回显不分聚焦态）
check "拉马聚焦日志锚"             "并聚焦" "src/components/studio/panels/RamaSection.tsx" 2
# ⑨影视日志锚（实测 5——「影视级检视」注释+日志+title 双语族；删则一键动作无审计）
check "影视日志锚"                 "影视级检视" "src/components/studio/panels/RamaSection.tsx" 5

# ---- r114-b：修正轮 chains list 探测结果消费（「看清单再重组」真闭环——r110/r111 持续挂起项收口） ----
# 旧链路：链族失败 → 修正轮发 chains list 探测 → 探测成功即止（原命令永远无人重组）。
# 新链路：AgentPanel 探测成功检测（probe）+ 链域原始失败筛选（chainFails）→ 消费轮 prompt
# （自包含：原失败+清单输出——「跨轮次记忆」转化为「单轮自包含上下文」）→ mock 0.46 机械
# 重组（无效链→首个蛋白链）→ depth+2 执行（有界）。附带修复：0.45 okOuts 节污染（成功命令
# 被当失败重跑）+ 探测命令精确去重 + interface 形态入链族探测。
# ①消费轮入口锚（实测 1——「链清单已探测」zh prompt 模板；删则消费 prompt 不再可辨识）
check "消费轮入口锚"               "链清单已探测" "src/components/studio/AgentPanel.tsx" 1
# ②探测检测锚（实测 1——probe 正则 chains list/ls + ok + output；删则探测结果无人消费）
check "探测检测锚"                 'chains\\s\+\(list\|ls\)' "src/components/studio/AgentPanel.tsx" 1
# ③链域失败锚（实测 4——chainFails 筛选（chain X 词式或 chains hide/show 形态）；删则消费轮无候选）
check "链域失败锚"                 "chainFails" "src/components/studio/AgentPanel.tsx" 4
# ④消费消息锚（实测 1——「链清单消费」assistant 消息前缀；删则 E2E 断言链断）
check "消费消息锚"                 "链清单消费" "src/components/studio/AgentPanel.tsx" 1
# ⑤消费深度上界锚（实测 1——depth + 2（重组轮不再有后续修正——有界防循环）；删则无界风险回归）
check "消费深度上界锚"             "depth \\+ 2" "src/components/studio/AgentPanel.tsx" 1
# ⑥mock 清单解析锚（实测 2——parseChainsFromProbeOutput 定义+调用（◉/⊘ 行式）；删则 0.46 恒降级）
check "mock清单解析锚"             "parseChainsFromProbeOutput" "mini-services/mock-llm/index.ts" 2
# ⑦mock 重组锚（实测 2——recomposeByChainList 定义+调用（hide/show 形态+chain 词式+interface 形态三规则））
check "mock重组锚"                 "recomposeByChainList" "mini-services/mock-llm/index.ts" 2
# ⑧mock 消费分支锚（实测 2——EN prompt 判定 regex+分支内 split；删则 EN 消费轮落到技能回放）
check "mock消费分支锚"             "chain list has been probed" "mini-services/mock-llm/index.ts" 2
# ⑨mock 消费中文锚（实测 2——zh prompt 判定 regex+注释；删则 ZH 消费轮落到技能回放）
check "mock消费中文锚"             "链清单已探测" "mini-services/mock-llm/index.ts" 2
# ⑩okOuts 隔离锚（实测 2——失败节/成功节切分（mock 侧 split 锚+注释）；删则成功命令被当失败重跑回归）
check "okOuts隔离锚"               "已成功命令的关键输出" "mini-services/mock-llm/index.ts" 2
# ⑪mock 去重锚（实测 1——new Set(rewritten)（多链域失败→单条探测）；删则 chains list×3 噪音回归）
check "mock去重锚"                 'new Set\(rewritten\)' "mini-services/mock-llm/index.ts" 1
# ⑫interface 形态探测锚（实测 1——fixRewrite 的 interface 裸链字母形态正则；删则 interface 失败 futile 重跑）
check "interface形态探测锚"        'interface\\s\+\[A-Za-z0-9\]' "mini-services/mock-llm/index.ts" 1

# ---- r114-c：报告节预览「钉住」模式（r113 建议③——hover 即换 → 钉住叠加比对） ----
# 钉住 = 固定青色薄纱（并集求值：多节叠加为一个薄纱集，Set 去重防重复罩亮）；hover 仍瞬态
# （覆盖钉住集，离开恢复——clearPreviewJump 恢复链）；钉钮 aria-pressed 开关态；clearChat/
# newSession 同步清钉（消息消失后钉失去取消入口——孤儿薄纱防线）。
# ①钉住状态锚（r115-c 迁 store 后实测 12——store 订阅+判定+依赖族+徽章计数；删则钉住态无载体）
check "钉住状态锚"                 "pinnedJumps" "src/components/studio/AgentPanel.tsx" 12
# ②钉住应用锚（实测 4——applyPinned 定义+effect+恢复链+注释（并集求值重建薄纱）；删则钉住不渲染）
check "钉住应用锚"                 "applyPinned" "src/components/studio/AgentPanel.tsx" 4
# ③钉住恢复锚（实测 2——applyPinned(pinnedJumps)（effect+clearPreviewJump 两处——hover 离开后恢复钉住集））
check "钉住恢复锚"                 'applyPinned\(pinnedJumps\)' "src/components/studio/AgentPanel.tsx" 2
# ④钉住切换锚（实测 2——togglePin 定义+onClick（再点取消）；删则无法钉/取消）
check "钉住切换锚"                 "togglePin" "src/components/studio/AgentPanel.tsx" 2
# ⑤钉钮图标锚（实测 1——<Pin aria-hidden（lucide Pin，钉住时 fill-current 实心）；删则按钮空图标）
check "钉钮图标锚"                 '<Pin aria-hidden' "src/components/studio/AgentPanel.tsx" 1
# ⑥钉住 ARIA 锚（实测 1——「已钉住预览」（live region 播报钉住集标签+原子数）；删则屏幕阅读器不知钉住态）
check "钉住ARIA锚"                 "已钉住预览" "src/components/studio/AgentPanel.tsx" 1
# ⑦钉住开关态锚（实测 4——aria-pressed（钉钮开关语义；pinnable 门控同族）；删则辅助技术无法辨识开关）
check "钉住开关态锚"               "aria-pressed" "src/components/studio/AgentPanel.tsx" 4
# ⑧清钉防孤儿锚（r115-c 迁 store：persistPins([]) 四入口（clearMsgs/newSession/switchSession/
#    deleteSession 活动删除）——消息行不可达即孤儿，统一清零含持久化；AgentPanel 侧仅剩
#    clearAllPins 一处手动清空）
check "清钉防孤儿锚"               'persistPins\(\[\]\)' "src/lib/molecular/agent/chat-store.ts" 4

# ---- r115-a/d：视觉修正轮失败并入链清单消费救济 + 消费 prompt 已成功上下文（r114 建议①④） ----
# 深度 1 视觉自查的修正命令（VLM 生成 interface A B 等）失败后无救济——chainFails 全量
# 扫描 records（含修正轮+视觉子轮的递归合并记录）一次消费；cmd 文本去重防双份重组；
# 消费 prompt 附带 okOuts（已成功命令关键输出）供 mock/LLM 防重发（重组产物同名丢弃）。
# ①链域判定 helper 锚（三族形单一出处，app/mock 对称；删则全量扫描无判据）
check "链域判定helper锚"           "isChainDomainCmd" "src/components/studio/AgentPanel.tsx" 2
# ②全量扫描去重锚（seenFail 声明+has 判定+add 登记——原始失败优先保留）
check "消费全量去重锚"             'seenFail' "src/components/studio/AgentPanel.tsx" 3
# ③视觉救济注释锚（视觉子轮记录经递归合并进 records 的设计依据；删则后续维护者会把
#    chainFails 改回只看 fails 原始失败——r114 建议①回归）
check "视觉救济注释锚"             "视觉修正轮失败并入" "src/components/studio/AgentPanel.tsx" 1
# ④消费 okOuts 锚（ZH 文案全串——防重发上下文节；删则 mock 0.46 的 okCmds 无数据源）
check "消费okOuts锚"               '已成功命令的关键输出（重组时不要重复这些命令）' "src/components/studio/AgentPanel.tsx" 1
# ⑤mock 链域演练锚（fail drill chain 视觉分支 → select chain Z/color red, chain Z——
#    G1 驱动器：修正命令带不存在的链触发消费救济全链）
check "mock链域演练锚"             'fail drill chain' "mini-services/mock-llm/index.ts" 1
# ⑥mock okSection 隔离锚（先切已成功节再解析失败——成功命令不当失败重组重跑）
check "mock okSection隔离锚"       'okSection' "mini-services/mock-llm/index.ts" 2
# ⑦mock 防重发过滤锚（okCmds 集合 + filter 同名丢弃）
check "mock防重发过滤锚"           'okCmds' "mini-services/mock-llm/index.ts" 2
# ⑧mock 重组去重锚（r118-a 单一来源重构：uniqAll 一处去重，commands/okDrop/failDrop
#   全从 uniqAll 派生——旧两处 new Set(recomposedAll) 随口径拆分归一；删则去重与计数失源）
check "mock重组去重锚"             'uniqAll' "mini-services/mock-llm/index.ts" 3

# ---- r115-b：拉马影视级检视一镜到底 + 离群行隔离其余链开关（r114 建议②） ----
# 三连后 slab 切层（±10Å 沿视线裁剪，前后遮挡剩侧链环境）+ 环境光压暗（1 → 0.6）；恢复链
# 四件套日志明示；多链结构（聚合物链 > 1）离群行点击可附带隔离其余链（轻量去遮挡）。
# ①slab 切层锚（影视感切层镜头；删则一镜到底缺切层）
check "影视slab切层锚"             "runCommand\('slab 20'\)" "src/components/studio/panels/RamaSection.tsx" 1
# ②环境光压暗锚（对比度戏剧化；删则 cinematic 术语不完整）
check "影视环境光锚"               "runCommand\('set ambient 0.6'\)" "src/components/studio/panels/RamaSection.tsx" 1
# ③恢复链四件套锚（注释+ZH/EN 日志三处 set ambient 1——用户可逆性的明示）
check "影视恢复链锚"               'set ambient 1' "src/components/studio/panels/RamaSection.tsx" 3
# ④隔离开关状态锚（state+开关钮+行点击透传；删则多链去遮挡无入口）
check "行隔离开关锚"               'rowIsolate' "src/components/studio/panels/RamaSection.tsx" 7
# ⑤多链门控锚（polymerChains 蛋白+核酸链计数+length>1 渲染门控；单链诚实隐藏）
check "行隔离多链门控锚"           'polymerChains' "src/components/studio/panels/RamaSection.tsx" 2
# ⑥行点击隔离透传锚（selectResidue isolate 通道接线）
check "行点击隔离锚"               'isolate: rowIsolate' "src/components/studio/panels/RamaSection.tsx" 1
# ⑦行隔离日志锚（已隔离其余链 + isolate off 恢复提示——审计与可逆性）
check "行隔离日志锚"               '已隔离其余链' "src/components/studio/panels/RamaSection.tsx" 1

# ---- r115-c：钉住集持久化（store 迁移 + localStorage 独立键）+ 头部汇总徽章（r114 建议③） ----
# 刷新不丢（比对工作不因页面刷新中断）；会话切换/新建/清空/删除活动会话由 store 统一
# 清零（防孤儿语义不变）；结构重载时 effect 重跑恢复薄纱（持久化闭环最后一环）；头部
# 徽章计数 + 一键清全部。
# ①store 钉住字段锚（state+四入口清零+订阅注释；删则钉住无持久化载体）
check "store钉住字段锚"            'pinnedJumps' "src/lib/molecular/agent/chat-store.ts" 9
# ②store 持久化键锚（AGENT_PINS_KEY 独立键定义；删则跨刷新丢失）
check "store钉住持久化键锚"        'AGENT_PINS_KEY' "src/lib/molecular/agent/protocol.ts" 1
# ③loadPins 装载锚（定义+初始化调用——形状校验诚实降级）
check "store钉住装载锚"            'loadPins' "src/lib/molecular/agent/chat-store.ts" 2
# ④persistPins 写盘锚（定义+setPinnedJumps+四清零入口 = 6；删则刷新后钉丢/孤儿钉残留）
check "store钉住写盘锚"            'persistPins' "src/lib/molecular/agent/chat-store.ts" 6
# ⑤面板 store 订阅锚（useState → store 订阅迁移——持久化的消费端）
check "面板钉住订阅锚"             'useAgentChatStore\(s => s\.pinnedJumps\)' "src/components/studio/AgentPanel.tsx" 1
# ⑥结构重载恢复锚（effect 依赖 molActiveId 三处——结构加载后持久化钉自动恢复薄纱）
check "钉住结构重载锚"             'molActiveId' "src/components/studio/AgentPanel.tsx" 3
# ⑦一键清全部锚（clearAllPins 定义+徽章 onClick；删则多钉取消繁琐）
check "钉住一键清锚"               'clearAllPins' "src/components/studio/AgentPanel.tsx" 2
# ⑧头部徽章锚（钉 N 计数文案；删则钉住数跨滚动不可见）
check "钉住徽章锚"                 "zh: '钉'" "src/components/studio/AgentPanel.tsx" 1

# ---- r116-a：消费轮（depth 2）救济对称——有界二次消费（r115 建议①） ----
# r115 实测：消费轮命令成功 → 其视觉自查触发 → VLM 重发带错链修正命令失败即终（消费
# 站点只在 depth-0）。r116-a 把消费轮返回记录再做一次链域消费判定：线性结构恰两轮
# （第三轮不存在），二轮自身仍 depth+2 无修正轮，循环不可能成形。
# ①二轮扫描锚（chainFails2 声明+push+条件+map 重组 = 4；删则消费轮失败无救济）
check "消费二轮扫描锚"             'chainFails2' "src/components/studio/AgentPanel.tsx" 4
# ②二轮探测复用锚（probe2 新探测优先+兜底复用首轮+双语文案引用 = 4；删则无链清单可依）
check "消费二轮探测锚"             'probe2' "src/components/studio/AgentPanel.tsx" 4
# ③二轮消息锚（「链清单消费（二轮）」前缀——E2E 断言链；删则二轮与首轮不可区分）
check "消费二轮消息锚"             '链清单消费（二轮）' "src/components/studio/AgentPanel.tsx" 1
# ④二轮防重发上下文锚（okOuts2 注释+声明+双语文案模板行 = 4 行；删则二轮重组重发已成功命令）
check "消费二轮okOuts锚"           'okOuts2' "src/components/studio/AgentPanel.tsx" 4

# ---- r116-b：钉住集待恢复提示（徽章琥珀态 + title/aria 双通道）（r115 建议②） ----
# 刷新后钉恢复但结构未载时薄纱无法求值（ARIA 静默——恢复是隐式的）；徽章转琥珀色 +
# title 提示「结构加载后自动恢复」——隐式行为显式化。
# ①待恢复文案锚（badge 后缀「待结构恢复」；删则颜色变化无文字解释）
check "钉住待恢复文案锚"           '待结构恢复' "src/components/studio/AgentPanel.tsx" 1
# ②自动恢复提示锚（zh 自动恢复 + en restore automatically = aria/title 双语四处；删则用户不知薄纱何时回来）
check "钉住自动恢复提示锚"         '自动恢复|restore automatically' "src/components/studio/AgentPanel.tsx" 4
# ③琥珀待恢复态锚（amber 色系 class；AgentPanel 基线 3 行 + r116-b 新增 1 行；删则无结构时徽章与在场态不可区分）
check "钉住琥珀待恢复锚"           'amber' "src/components/studio/AgentPanel.tsx" 4

# ---- r116-c：拉马隔离开关偏好记忆（localStorage 持久化）（r115 建议③） ----
# 「隔离审阅多个离群」是跨结构/跨会话工作流——rowIsolate 刷新即失是高频摩擦；惰性
# 初始化直读（typeof 守卫兼容 SSR）+ 切换即写盘。
# ①持久化键锚（键定义+读+写 = 3；删则偏好无载体）
check "拉马隔离持久键锚"           'RAMA_ISOLATE_KEY' "src/components/studio/panels/RamaSection.tsx" 3
# ②键字面量锚（跨会话稳定键名；改名则旧用户偏好静默失效）
check "拉马隔离键名锚"             'molvision-rama-row-isolate' "src/components/studio/panels/RamaSection.tsx" 1
# ③切换写盘锚（toggleRowIsolate 定义+onClick = 2；删则开关不留痕）
check "拉马隔离切换锚"             'toggleRowIsolate' "src/components/studio/panels/RamaSection.tsx" 2

# ---- r117-a：wait-stable-frame canvas 探针修复（r116 建议①收口） ----
# r116 坑②：querySelector('canvas') 首个在拉马节渲染后错抓散点图（232×224）+ /tmp rect
# 缓存跨布局陈旧 → 空白哨兵误报。修复：最大面积 canvas 精选 + rect 每轮现取。
# ①最大画布遍历锚（querySelectorAll + 面积比较；删则探针回退「首个 canvas」错抓小画布）
check "稳定帧最大画布锚"           'querySelectorAll' ".zscripts/wait-stable-frame.sh" 1
# ②面积比较锚（最大面积择优的判据本体；删则遍历失去择优语义退化为最后一个）
check "稳定帧面积比较锚"           'best = c' ".zscripts/wait-stable-frame.sh" 1
# ③轮间重探锚（round>1 分支重探 rect；删则跨轮布局变化后裁剪区域陈旧）
check "稳定帧轮间重探锚"           'round" -gt 1' ".zscripts/wait-stable-frame.sh" 1

# ---- r117-b：消费重组「同文曾失败」短路（r116 建议②收口） ----
# r116 G1 实证：近中心 view from 几何 error 的同文重组产物重跑必再败（幂等执行白耗）。
# app 侧产物过滤（两轮消费全覆盖）——与 r115-d okOuts 防重发互补：那管「同成功」（prompt
# 上下文 + mock 侧），本短路管「同失败」（记录直判，真实 LLM 侧同样生效）。
# ①短路集合锚（failedTexts 首轮声明+过滤 + failedTexts2 二轮声明+过滤 = 4；删则幂等产物照跑）
check "同文失败短路集合锚"         'failedTexts' "src/components/studio/AgentPanel.tsx" 4
# ②短路产物锚（recompFresh/recomp2Fresh 声明+过滤+复用 = 3+3；删则消息命令卡与执行不走过滤集）
check "同文失败短路产物锚"         'recompFresh|recomp2Fresh' "src/components/studio/AgentPanel.tsx" 6
# ③跳过计数锚（recompDropped/recomp2Dropped 声明+三元 = 2+2；删则跳过数不可诚实上报）
check "同文失败跳过计数锚"         'recompDropped|recomp2Dropped' "src/components/studio/AgentPanel.tsx" 4
# ④跳过文案锚（双语模板两轮各一 = 2；删则 E2E 断言链断——「已跳过」不可见）
check "同文失败跳过文案锚"         '与既往失败命令同文' "src/components/studio/AgentPanel.tsx" 2

# ---- r117-c：钉住待恢复态「一键载入最近结构」快捷入口（r116 建议③收口） ----
# 琥珀徽章只提示「薄纱何时回来」，路径还差一步——此入口复用会话恢复同一路径（restoreSession）
# 一步到位；结构落地后 molActiveId effect 驱动薄纱自动重建。
# ①快捷恢复函数锚（quickResume 定义+onClick = 2；删则按钮无动作）
check "快捷恢复函数锚"             'quickResume' "src/components/studio/AgentPanel.tsx" 2
# ②快捷恢复文案锚（aria/title/label 双语 ≥3；删则无文字解释的动作按钮）
check "快捷恢复文案锚"             '载入最近结构' "src/components/studio/AgentPanel.tsx" 3
# ③快照门控锚（sessionSnap memo+条件+JSX = 5；删则无存档时也渲染死按钮）
check "快捷恢复快照锚"             'sessionSnap' "src/components/studio/AgentPanel.tsx" 4
# ④恢复路径复用锚（import+调用 ≥2；删则自造加载逻辑偏离会话恢复语义）
check "快捷恢复路径锚"             'restoreSession' "src/components/studio/AgentPanel.tsx" 2
# ⑤图标锚（HardDriveDownload import+JSX = 2；与恢复卡同图标语义呼应）
check "快捷恢复图标锚"             'HardDriveDownload' "src/components/studio/AgentPanel.tsx" 2

# ---- r118-a：mock 0.46「同文曾失败」对称守卫（r117 建议①收口） ----
# app 侧 r117-b 短路（failedTexts 过滤）后 mock 的「N 条待执行」与实际执行数出现口径差
# （r117 G1a 实测：mock 说 1 待执行、app 跳过 1 执行 0）——mock 侧从失败节提取 failCmds，
# 重组产物同文即丢弃 + 两类丢弃（ok 重复 / 同文失败）独立计数诚实进 reply。
# ①failCmds 提取锚（声明+过滤引用 = 3；删则同文产物照发、口径差回归）
check "mock同文失败集锚"           'failCmds' "mini-services/mock-llm/index.ts" 2
# ②成功重复计数锚（声明+双语模板 = 4；删则 ok 丢弃不可见）
check "mock成功重复计数锚"         'okDrop' "mini-services/mock-llm/index.ts" 3
# ③同文失败计数锚（声明+双语模板 = 3；删则 fail 丢弃不可见——E2E 断言链断）
check "mock同文失败计数锚"         'failDrop' "mini-services/mock-llm/index.ts" 3
# ④ZH 跳过文案锚（与 app 侧 r117-b 文案同款对齐 = 1；删则 ZH 侧口径断）
check "mock同文跳过文案锚ZH"       '与既往失败命令同文已跳过' "mini-services/mock-llm/index.ts" 1
# ⑤EN 跳过文案锚（"N skipped as prior same-text failures" 与 app 侧同款 = 1）
check "mock同文跳过文案锚EN"       'skipped as prior same-text failures' "mini-services/mock-llm/index.ts" 1

# ---- r118-b：小屏补偿入口（r117 建议②收口） ----
# 顶栏快捷恢复按钮 hidden sm:flex——移动端不可见，小屏待恢复态用户此前须绕道欢迎页
# 恢复卡；正文区顶部提示条补齐（sm:hidden 与顶栏按钮互斥成对，桌面端不重复渲染）。
# ①互斥锚（sm:hidden = 2：提示条 className + 既有处；删则移动端入口消失）
check "小屏补偿互斥锚"             'sm:hidden' "src/components/studio/AgentPanel.tsx" 1
# ②门控锚（钉在场+无活动结构+有存档+未失败 四条件同款 = 1；删则无钉也渲染误导入口）
check "小屏补偿门控锚"             'pinnedJumps.length > 0 && !molActiveId && sessionSnap && !resumeGone' "src/components/studio/AgentPanel.tsx" 1
# ③主行文案锚（钉 N 待恢复 / N pins pending 双语同线 = 1；删则无上下文的裸动作）
check "小屏补偿文案锚"             '待恢复）|pins pending' "src/components/studio/AgentPanel.tsx" 1
# ④双入口复用锚（quickResume 定义+双 onClick = 4；顶栏与小屏条同一路径——删则两入口行为分叉）
check "双入口复用锚"               'quickResume' "src/components/studio/AgentPanel.tsx" 3

# ---- r118-c：稳定帧工具 --canvas-aria 参数化 + 3D 视口 canvas aria（r117 建议⑤收口） ----
# 显式 aria-label 子串精选（不区分大小写、未匹配诚实退出不静默回退最大面积）；前提是
# 3D 视口 canvas 有 aria-label（r117 实测为空串）——MolViewer 挂载后补双语标签。
# ①aria 参数锚（ARIA_PATTERN 解析+分支+失配消息 = 6；删则参数静默失效回退面积择优）
check "aria精选参数锚"             'ARIA_PATTERN' ".zscripts/wait-stable-frame.sh" 5
# ②失配诚实锚（NOMATCH JS 返回+双 case 分支 = 4；删则失配被吞——错抓伪装成通过）
check "aria失配诚实锚"             'NOMATCH' ".zscripts/wait-stable-frame.sh" 3
# ③视口标签锚（setAttribute 行双语同款 = 1；删则 --canvas-aria 无可选目标）
check "视口aria标签锚"             '3D 分子视口|3D molecular viewport' "src/components/molecular/MolViewer.tsx" 1
# ④标签写入锚（eng.canvas.setAttribute = 1；删则 3D 视口 aria 仍为空串）
check "视口aria写入锚"             "setAttribute\\('aria-label'" "src/components/molecular/MolViewer.tsx" 1

# ---- 汇总 ----
# r100：TOTAL 改进程内计数（PASSES+FAILS）——历史静态 TOTAL=445 与实际执行 468 条
# 脱节（23 条盲区），新增守卫后忘同步静态数的坑就此根治
TOTAL=$((PASSES + FAILS))
if [ "$FAILS" -eq 0 ]; then
  echo "== 结果：PASS（$TOTAL/$TOTAL 守卫全部通过） =="
  exit 0
else
  echo "== 结果：FAIL（$FAILS/$TOTAL 守卫失败——对应修复疑被回滚，或守卫正则需更新） =="
  exit 1
fi
