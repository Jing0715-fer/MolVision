---
name: molvision-skills-index
description: MolVision Agent Skill 体系索引——所有 agent 操作（主代理/子代理/cron 巡检）统一按 skill 标准流程执行、输出文稿用固定格式。新会话或子代理开工时先读本索引选技能，再按任务类型读对应 SKILL.md。
---

# MolVision Agent Skill 体系

本目录（`.agent/skills/`）**随 git 跟踪**，是 MolVision 项目资产；与全局 `skills/` 目录
（平台个人技能库，不入库——见 .gitignore 的 `/skills/` 条目）相区分。

## 体系目的

把本项目多轮开发（r60-r104+）沉淀的 agent 操作规矩标准化为 skill 文件：**所有 agent
操作——主代理、子代理、cron 巡检——统一按 skill 标准流程执行，输出文稿用固定格式**。
新 agent 开工不再依赖口口相传或通读全部 worklog，读对应 SKILL.md 即恢复操作语境。

## 技能清单

| 名称 | 一句话适用场景 | 文件路径 |
|---|---|---|
| molvision-dev-cycle | 开发轮次三段式流程：下一阶段开发 → QA+E2E → 以测试结果规划后续 | `.agent/skills/molvision-dev-cycle/SKILL.md` |
| molvision-qa-gates | QA 门禁链：每道门禁的精确命令、通过口径与已知良性噪音 | `.agent/skills/molvision-qa-gates/SKILL.md` |
| molvision-e2e | E2E 测试规矩全集：agent-browser/eval/VLM 的血泪铁律（每条附为什么） | `.agent/skills/molvision-e2e/SKILL.md` |
| molvision-worklog-format | 输出文稿固定格式：worklog 段 / 子代理任务书 / 测试报告三模板 | `.agent/skills/molvision-worklog-format/SKILL.md` |

## 使用方式

1. **新会话/子代理开工前**：先读 `worklog.md` 尾部 ~200 行恢复近期语境（上轮基线数字、
   遗留项、坑记录——上轮 Stage Summary 的「下一轮建议」即本轮立项来源），再按任务
   类型读对应 SKILL.md：
   - 写代码/改功能 → `molvision-dev-cycle/SKILL.md`（三段式 + 基线检查四步 + 收尾门禁链）
   - 跑 QA/收尾验证 → `molvision-qa-gates/SKILL.md`（六道门禁逐道口径 + 良性噪音清单）
   - 跑 E2E → `molvision-e2e/SKILL.md`（铁律先行，避免重踩历史坑）
   - 写 worklog 段/子代理任务书/测试报告 → `molvision-worklog-format/SKILL.md`（三模板）
2. **主代理派发子代理**：任务书按 worklog-format 的子代理任务书模板写（读基/任务/
   交付/红线/收尾五段齐全，范围红线明确到文件）。
3. **守卫**：本体系由 `scripts/regression-guards.sh` r105-a 块的 4 条结构守卫钉住——
   skill 文件被删、索引被清空或门禁口径被改写即 FAIL（总数一致性纪律见 qa-gates）。

## 版本

- r105-a：体系初创——4 个 SKILL.md + 本索引，内容从 r99-r104 worklog 提炼。
