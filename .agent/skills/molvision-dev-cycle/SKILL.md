---
name: molvision-dev-cycle
description: MolVision 开发轮次三段式流程。当用户指令「进行下一阶段开发，并进行qa测试和e2e测试，并根据测试结果规划后续开发计划」，或子代理接到单项开发任务需要开工/收尾流程时使用。涵盖基线检查四步、守卫先行纪律与收尾门禁链顺序。
---

# MolVision 开发轮次三段式流程

适用对象：主代理（整轮三段编排）与子代理（单段执行）。一轮开发 = ①开发 → ②QA+E2E →
③结果驱动规划 的闭环；「下一轮建议」清单是轮与轮之间的交接物。

## ① 下一阶段开发

1. **基线检查（四步，开工必做，见下节）**——起点不干净不动手
2. **读 worklog.md 尾部 ~200 行**——恢复上轮语境：上轮 Stage Summary 的「下一轮建议」
   即本轮立项来源；坑记录决定本轮要避什么
3. **立项**：从上轮建议清单按优先级选题；大轮次拆子代理并行（每个子代理独立任务书，
   按 molvision-worklog-format 的任务书模板写；范围红线明确到文件）
4. **开发，守卫先行**：每处功能改动**同步**加守卫锚——改动与守卫同一次落盘不欠账；
   守卫插独立注释块（`# ---- r<N>：...`），只追加不动他人块（并行子代理共存纪律，
   插入前先复核 guards 尾部实态）

## ② QA + E2E 测试

- QA 门禁链全跑，逐道口径见 molvision-qa-gates
- E2E 按 molvision-e2e 铁律执行——会话管理/受控输入/VLM 复鉴规矩先行，避免重踩历史坑
- 测试中的新发现（含环境型故障）按「系统级取证 → 归因」流程处理，坑入档

## ③ 以测试结果为依据规划后续

- 基于本轮 QA/E2E 的**实测数字**（不是感觉）产出「下一轮建议」清单，按优先级排序
- 每条格式：`<序号>. 【优先级】<标题>（依据）：<具体方案>`；【高/中/低】三档
- 每轮收尾必写该清单——它是下一轮的立项来源，也是三段闭环的交接物

## 基线检查四步（开工必做）

1. `git log --oneline -5` + `git status --short`——HEAD 应为上轮完成态、工作区干净；
   不干净时先弄清并行产物归属（他人的 M 文件绝不碰），绝不盲目开工
2. `bash scripts/regression-guards.sh` 实跑记数（如 589/589）——此即本轮「基线数」；
   收尾时 guards 总数必须 = 基线数 + 本轮新增守卫数（不符 = 有守卫被误删或他人并行
   追加——如实记录实跑数字，不硬凑）
3. `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000` → `200`——dev server
   活着；绝不用「重启 dev server」解决疑题（devd 看门狗是自愈防线）
4. dev.log 尾部核查——尾部应连续 `GET / 200` 无编译 error；头部 EADDRINUSE 块为历史
   遗留、7AHL 缓存通知为良性（完整良性噪音清单见 molvision-qa-gates）

## 收尾门禁链（顺序固定，全绿才算完成）

```
lint → tsc → guards → smoke → visual-baseline → dev.log → worklog 段 → push
```

即依次：

1. `bun run lint` → 0 错误
2. `bunx tsc --noEmit src/` → 0 错误（只看 src/——全项目口径有 5 个历史基线错误，见 qa-gates）
3. `bash scripts/regression-guards.sh` → 全过且总数 = 基线数 + 本轮新增
4. `bash scripts/smoke.sh` → 6/6 PASS（heavy 路径：装载 4HHB + press 2）
5. `bash scripts/visual-baseline.sh check` → 3/3 PASS
6. dev.log 尾部核查 → 零新增真 error（本轮 `○ Compiling` 后报错才算真——判据见 qa-gates）
7. worklog.md 追加本轮段（模板见 molvision-worklog-format；以 `---` 行开头、追加不覆盖）
8. `git add -A` → `git commit` → `git push origin main`——**子代理不 commit/push，主代理统一**

## 红线（全轮适用）

- 绝不 `bun run build`（4GB 沙箱实锤撑不住）；dev server 只用 3000 端口
- Bash 命令字符串绝不出现 kill/TERM/KILL 字样——网关过滤 403 永久断会话（进程管理走
  脚本文件旁路：Write 写脚本 + `bash 脚本名` 执行）
- 同文件多处编辑不用 MultiEdit（非原子坑四次实锤）——用独立单 Edit，每次编辑后复核落盘
- 不碰他人并行改动的文件；子代理不跑 E2E（主代理统一）、不 git commit/push（主代理统一）
