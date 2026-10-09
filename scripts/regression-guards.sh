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
