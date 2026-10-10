---
name: molvision-qa-gates
description: MolVision QA 门禁链执行口径。当要跑 QA、收尾验证、执行门禁检查（lint/tsc/guards/smoke/visual-baseline）、判断守卫总数是否一致、或核查 dev.log 真伪 error 时使用。含每道门禁的精确命令、通过口径与已知良性噪音清单。
---

# MolVision QA 门禁链

六道门禁 + dev.log 核查，与收尾顺序配套（完整轮次流程见 molvision-dev-cycle）。全绿
才允许收尾；任何一道红，先修后重跑该道，不跳道。

## 门禁总表

| # | 门禁 | 精确命令 | 通过口径 |
|---|------|----------|----------|
| 1 | lint | `bun run lint` | 0 错误 |
| 2 | tsc | `bunx tsc --noEmit src/` | 0 错误（**只看 src/**） |
| 3 | guards | `bash scripts/regression-guards.sh` | 全过；总数 = 基线数 + 本轮新增守卫数 |
| 4 | smoke | `bash scripts/smoke.sh` | 6/6 PASS |
| 5 | visual-baseline | `bash scripts/visual-baseline.sh check` | 3/3 PASS |
| 6 | dev.log | 尾部核查（见下） | 零新增真 error |

## 逐道口径

### 1. lint

`bun run lint` → **0 错误**。有错先修；warning 按 lint 输出如实记录。

### 2. tsc —— 只看 src/

`bunx tsc --noEmit src/` → **0 错误**。

**注意**：全项目 tsc（不带 `src/`）存在 5 个历史基线错误——examples×2 + mini-services×1
+ skills×2。逐条核对为历史基线不变即可，**不要修它们、不要用全项目口径判本轮失败**；
守卫口径永远只看 src/。

### 3. guards —— 总数一致性

`bash scripts/regression-guards.sh` → **全过**，且总数必须与「基线数 + 本轮新增守卫数」
一致（例：589 基线 + 本轮 4 新增 = 593/593）。总数偏高 = 他人并行追加了守卫（如实记录，
不删他人的）；总数偏低 = 守卫被误删或正则失效。

**守卫插入纪律**：

- 新守卫以**独立注释块**插入：`# ---- r<N>：...` 块插在上一轮块后、`# ---- 汇总 ----` 段前
- **只追加自己的块，绝不动他人块**（并行子代理共存——插入前先 rg 复核 guards 尾部实态）
- rg 正则三坑（bash 双引号内）：**括号必转义** `\(`（字面括号）；**`$` 用单引号护正则**
  （双引号内 `$(` 是子壳替换坑）；反引号绝不出现在双引号内（命令替换坑）
- 模式前缀碰撞警惕：如裸 `supersample: 1` 是 `supersample: 1.5` 的行内前缀——用结构锚
  （`\}`）消歧
- 每条守卫注明实测命中数（注释里写「实测 N」）；`bash -n` 语法过后再实跑全量

### 4. smoke

`bash scripts/smoke.sh` → **6/6 PASS**。断言 5 是假死哨兵 **heavy 路径**：装载 4HHB
（native setter 范式）+ press 2 真实预设切换 + `Date.now()` eval 探针；装载失败诚实降级
light 路径（PASS 文案带 heavy/light 标记——如实区分，不冒充 heavy）。

### 5. visual-baseline

`bash scripts/visual-baseline.sh check` → **3/3 PASS**（home-cartoon / membrane-toggle /
template-rainbow 三场景，1280×800 定视口，PIL 逐像素 diff 阈 1.5%/2.0）。改动了渲染面
时若基线需要更新：`capture` 模式重拍 + 在 worklog 写明 diff 依据（基线更新必须可审查）。

### 6. dev.log 核查 —— 已知良性噪音清单

| 现象 | 判定 |
|------|------|
| 头部 EADDRINUSE listen 块 | 历史会话遗留，良性（r101-a 起多轮入档同款） |
| 7AHL >2MB 超 Next data cache 2MB 的缓存通知 | 良性（请求本身 200；r104 实测入档） |
| 本轮改动触发的 `○ Compiling /` 之后报错 | **真 error**——先定位本轮编译段再归因 |

dev.log 含历史 NUL 字符时先 `tr -d '\0'` 再读；尾部应连续 `GET / 200`。

## 红线

- **绝不 `bun run build`**——4GB 沙箱内存实锤撑不住（r101 4K 渲染组杀事件教训）
- dev server **只用 3000 端口**；绝不重启 dev server 解决疑题（devd 看门狗自愈是防线）
- Bash 命令字符串绝不出现 kill/TERM/KILL 字样——网关过滤 403 永久断会话
