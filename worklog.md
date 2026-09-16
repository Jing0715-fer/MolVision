# MolVision — 3D PDB 结构可视化工作台

## 项目概述
用 Next.js 16 + Three.js 从零构建专业级 3D 分子可视化工具（对标 ChimeraX / PyMOL / Mol*）。

---
Task ID: 1
Agent: main
Task: 探索项目结构、安装依赖、初始化 worklog

Work Log:
- 读取 package.json / page.tsx / layout.tsx / globals.css，确认 Next.js 16 + React 19 + Tailwind 4 + shadcn/ui 全套组件 + zustand 5 + lucide-react 0.525 可用
- 确认 dev server 已在 3000 端口运行（next-server v16.1.3）
- 安装 three@0.186.0 + @types/three@0.186.0

Stage Summary:
- 技术栈确定：Three.js 渲染引擎 + zustand 状态管理 + shadcn/ui 界面
- 架构规划：src/lib/molecular/*（解析器/化学/选择器/颜色/引擎/表示法），src/components/studio/*（UI 面板），单路由 / + /api/pdb/[id] 代理 RCSB
---
Task ID: 5-helper
Agent: general-purpose
Task: QA 辅助验证（L 标签/截图/lint）

Work Log:
- agent-browser get title 成功返回「MolVision — 3D 分子可视化工作台」，浏览器会话存活，无需重新 open
- 会话状态核查：页面加载 2 个结构（4HHB 活动结构 + 1BNA），状态栏显示「已选 7 原子」；经引擎 scene 分析（视图 rep 哈希、cartoon 顶点数 5612/5812×2 vs 979×2、配体实例数 174+404）确认 7 个选中原子位于 4HHB（amber 高亮 InstancedMesh count=7），1BNA 无选中——与任务描述「1BNA 有 7 原子选中」略有出入，实际为 4HHB 选中
- 通过 window.dispatchEvent(KeyboardEvent keydown key:"l") 触发 L 快捷键，1 秒后执行任务给定 eval：返回 [{"labels":7},{"labels":0}] —— 选中原子所在视图新增 7 个文本标签 sprite（>0 验证通过），未选中结构 0 标签，无重复添加
- 截图保存至 /tmp/mv-1bna-sel.png（1280×577，93,211 字节，有效 PNG）；像素级校验：标签投影屏幕坐标 (822,230) 附近检出 347 个近白文本像素 + 781 个深色描边像素，canvas 区域内检出 amber(#fbbf24) 高亮像素 —— 标签与选中高亮均已实际渲染
- agent-browser errors 非空：共 13 条历史错误（均非本次 QA 操作引入，清空后无新增）—— 2× 主题切换按钮 Sun/Moon 图标 SSR 水合不匹配（React 自动恢复，低危）；3× SequenceBar TypeError undefined.map（发生于早前 Fast Refresh/HMR 期间，当前渲染正常，建议防御性修复）；8× OrbitControls setPointerCapture NotFoundError（早前 CDP 合成点击的自动化痕迹，真实用户不可复现）
- cd /home/z/my-project && bun run lint → eslint . 退出码 0，0 errors 0 warnings

Stage Summary:
- L 快捷键标签功能验证通过：7 个选中原子 → 7 个 3D 文本标签，截图像素级确认标签与 amber 高亮渲染正常，lint 全绿
- 遗留问题（建议后续处理）：① 主题按钮 SSR 水合不匹配（next-themes 惯例修复：suppressHydrationWarning 或挂载后再渲染图标）；② SequenceBar 对 undefined 数据缺防御（data.chains / chain.residueIdx 可选链保护）
- 实际选中结构为 4HHB 而非任务假设的 1BNA，但 1BNA 已加载且功能验证不受影响；截图文件名沿用任务指定 /tmp/mv-1bna-sel.png
---
Task ID: 7-prep
Agent: general-purpose
Task: GitHub 推送准备（用户信息/建仓/git 状态/身份配置/.gitignore）

Work Log:
- curl GET /user（token 已打码 ghp_****）：login=Jing0715-fer，name=Jing0715，email=None（GitHub 账号未公开邮箱）
- POST /user/repos 创建公开仓库成功（全新创建，非 422）：full_name=Jing0715-fer/MolVision，html_url=https://github.com/Jing0715-fer/MolVision；description 含 cartoon ribbons / ball-and-stick / molecular surfaces / PyMOL-style selection language；private=false，has_issues=true，has_wiki=false
- git 状态检查：HEAD 仅 1 个提交 4bbc01d "Initial commit"（作者为沙箱占位身份 Z User <z@container>，仅 tracked 3 个文件）；工作区 = 1 个已修改（.gitignore）+ 17 个未跟踪顶层条目，展开后 113 个待提交文件（src/ 占 85，其余 .zscripts 9、tests 3、public 2、examples 2 及配置文件等）
- git 原有 user.name/user.email 为沙箱占位值（Z User / z@container）而非真实 GitHub 身份，按推送意图改写 local config：user.name=Jing0715-fer，user.email=Jing0715-fer@users.noreply.github.com
- .gitignore 核查：node_modules(L4)、/.next/(L17)、dev.log(L47，另有 *.log L46 兜底)、.env*(L34) 均已存在；db 缺失 → 末尾追加 "/db"（含注释，根目录锚定）；git check-ignore -v 验证 db/custom.db、node_modules、.next、dev.log、.env.local 五项全部命中，db/ 已从 git status 消失，未破坏已有内容
- 遵照指令未执行 git add/commit/push，等 README 写好后再推送

Stage Summary:
- GitHub 身份与远程仓库就绪：login=Jing0715-fer，仓库 https://github.com/Jing0715-fer/MolVision（公开，issues 开启）
- 待提交规模：1 修改（.gitignore）+ 113 个未跟踪文件（src 85）；数据库 db/ 与敏感 .env* 均已被忽略，不会入库
- 下一步：撰写 README → git add -A → git commit → git remote add origin https://github.com/Jing0715-fer/MolVision.git → push（推送时用 token 认证）
---
Task ID: 7-shot
Agent: general-purpose
Task: GitHub 链接修复、防御性修复、README 截图拍摄

Work Log:
- 读取 worklog 了解背景（Task 5-helper 记录的遗留问题：SequenceBar undefined.map 需防御性修复；Task 7-prep 已建好 GitHub 仓库 Jing0715-fer/MolVision）
- Toolbar.tsx L261：href 由 https://github.com/z-ai-code/MolVision 改为 https://github.com/Jing0715-fer/MolVision（与 7-prep 实际仓库一致），grep 确认替换成功
- SequenceBar.tsx 双重防御：L32 data.chains.map → (data.chains || []).map；L60 chain.residueIdx.map → (chain.residueIdx || []).map；st.chains[i]?.color ?? '#9aa3ad' 按要求保持不变 —— 恰好消除 5-helper 记录的 3× SequenceBar TypeError 历史错误
- cd /home/z/my-project && bun run lint → eslint . 退出码 0，0 errors 0 warnings
- agent-browser 会话存活（get title 成功），reload 清空状态后等待 4 秒；点击「加载结构」→ 对话框中点击示例「4HHB 血红蛋白」→ 等待 8 秒，结构加载成功（4,779 原子 · 801 残基 · 12 链 · 4 条聚合物链）
- 截图 5 张（1280×577）至 public/screenshots/：cartoon.png（默认 cartoon+配体棍+水线框）→ 按 2 等 3 秒截 ballstick.png → 按 5 等 6 秒截 surface.png → 按 1 等 3 秒截 overview.png
- 点击工具栏「命令行」按钮打开终端面板，输入 zoom resn HEM 回车，等 2 秒截 bindingsite.png
- PIL 验证全部通过（独特颜色数 1602~4855，均 >> 10）：cartoon 89,661B/1793 色、ballstick 102,606B/2003 色、surface 107,621B/4855 色、overview 89,661B/1793 色、bindingsite 100,153B/1602 色
- 附加验证：overview 与 cartoon 逐字节相同（MD5 一致）—— MolViewer.tsx L120-123 快捷键 1-7 映射 presets ['cartoon','ballstick','spacefill','wireframe','surface','bindingsite','hybrid']，按 1 即恢复 cartoon 默认预设，确定性渲染下与初始帧一致，属预期而非按键失效；bindingsite vs overview 像素差异 29.6%（218,546 像素），证实 zoom resn HEM 相机聚焦生效
- agent-browser errors 非空但全部为历史错误：共 13 条（2× Sun/Moon 主题按钮 SSR 水合不匹配 + 3× SequenceBar undefined.map + 8× OrbitControls setPointerCapture NotFoundError），与本会话开始前 5-helper 记录的 13 条完全一致（组成与数量均未增长）；--clear 后仍显示同样 13 条（该版本缓冲为会话级持久）；对照实验：全新 reload 后计数仍为 13，且其中 SequenceBar TypeError 引用旧 HMR chunk src_bd4d3c6b._.js —— 本次操作（reload/加载/按键/命令行/截图）零新增错误
- 注意：截图完成后为做 errors 对照实验执行了一次 reload，当前浏览器页面已回到空状态（截图文件不受影响，已落盘）

Stage Summary:
- 链接修复完成：Toolbar GitHub 链接 → https://github.com/Jing0715-fer/MolVision；lint 全绿（0 错误 0 警告）
- 防御性修复完成：SequenceBar 的 data.chains 与 chain.residueIdx 均加 || [] 兜底，根治 5-helper 记录的 TypeError undefined.map 历史错误
- 5 张 README 截图就绪（public/screenshots/{cartoon,ballstick,surface,overview,bindingsite}.png），PIL 内容验证全部通过；overview 与 cartoon 因预设映射确定性一致属正常
- errors 缓冲仅含 13 条已知历史错误，本次操作零新增；遗留（非本任务范围）：主题按钮水合不匹配仍待 suppressHydrationWarning 修复
