---
name: molvision-e2e
description: MolVision E2E 测试规矩全集（agent-browser 驱动）。当要跑 E2E、写浏览器自动化、在 MolVision 页面上装载结构/点击/切换预设/截图/VLM 复鉴，或 E2E 出现超时/假死/误报要排查时必读——血泪教训铁律清单，每条附「为什么」。
---

# MolVision E2E 测试规矩

以下规矩全部来自 r92-r104 多轮 E2E 实跑的血泪教训。每条写明**为什么**——理解触发条件
才知道何时能破例（绝大多数不能破）。

## 输入与交互

### 1. React 受控输入必须 native setter + input 事件

- **做法**：取原型链 value setter 赋值后再派发 input 事件——
  `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` →
  `setter.call(el, '4HHB')` → `el.dispatchEvent(new Event('input', { bubbles: true }))`
- **为什么**：直接 `el.value = ...` 赋值**不触发 React onChange**——React 的合成事件体系
  感知不到裸赋值，UI 与 store 零变化，测试假通过。装载 4HHB/命令行 input 等一切受控
  输入场景的铁律（smoke heavy 路径同款范式）。

### 2. agent-browser click 偶发 not found —— 改用 eval 状态断言

- **做法**：以 `eval` 读 DOM 存在性/文本内容做断言（如
  `document.querySelector('...')?.textContent`），状态到达后再操作
- **为什么**：click 对动态渲染/时序敏感，偶发找不到目标却非页面故障；eval 直读状态
  比「点到了没有」更接近被测事实

### 3. 双位轨道组件点「目标语言」钮

- **做法**：语言切换（EN↔中文）这类双位控件，点**目标语言**那个钮
- **为什么**：点当前位是 no-op（r104 实测入档）——点当前语言钮零切换，断言必假红

## eval 与会话管理

### 4. 异步/长任务 eval 会 CDP 超时 —— 拆成分步 eval

- **做法**：把长流程拆成多个短小 eval，每步快速返回；轮询用有界循环（如 2s×10 轮）
- **为什么**：单次 eval 内 await 长任务，CDP 协议层超时先到——命令报失败但页面侧可能
  已在执行，状态不可知；分步后每步可断言、可重试

### 5. agent-browser 会话按 ~20 分钟周期性 close + open

- **为什么**：浏览器内存累积实证（r102 假死现场：双 Chrome ~1.35GB + next-server
  1259MB → 4GB 沙箱仅剩 544MB free → 页面主线程假死）；周期性重建会话是 E2E 长跑的
  内存纪律

### 6. Task 工具超时 ≠ 未执行 —— 先查副产物

- **做法**：遇 Task 超时先 `git status` / ls 核对副产物（新文件/改动），再决定重做或收编
- **为什么**：r104 实锤——Task 三连超时，但第二次调用实际已完整执行（子代理交付落盘，
  只是结果未回传）；盲目重做 = 重复劳动 + 并行冲突

## 截图与 VLM 复鉴

### 7. VLM 截图结论必须全尺寸复鉴

- **做法**：从截取内容**首个 `{` 起**取 JSON；结论须**像素计数 + 引擎内部状态**
  （`membraneGroup.children` / `membraneBox` / `settings.showCell` 等）交叉验证
- **为什么**：VLM 输出有前导噪音（历史 8 例误报）；且 **VLM 对 WebGL 渲染解读不可靠**
  ——幻影「晶胞盒」、把膜板认成 symmetry mates 等误读实锤（r104 两次）。三方（VLM/
  像素/引擎状态）一致才是硬证据；visual-baseline 像素 diff 哨兵正是该认知的产品化

### 8. 截图陈旧帧防护

- **做法**：截图三败重试；拍对比前**清洁视口两遍** + autoPerf/showAxes 关
- **为什么**：截图偶发返回陈旧帧（r92 膜错位教训）；HUD 叠加（性能表/坐标轴）会让像素
  diff 假红——基线与对比必须同口径

## 断言纪律

- 断言写「预期 vs 实测数字」（hbond 2202 条 / draw calls 39 / 三角面 485,097 这种），
  不写「看起来正常」
- 全会话 console errors 必须为零（`agent-browser errors` 命令）——每轮 E2E 的硬收口
- 环境型症状（假死/超时/慢）**先查 free/top 系统态再归因代码**——A/B 测试采样偏差陷阱：
  环境间歇故障与代码变更时间点耦合会制造假确定性（r102 两度误判实锤）
