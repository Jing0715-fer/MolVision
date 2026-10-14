#!/usr/bin/env bash
# r122 G1：表面疏水分析技能全链 + 图例多卡并置（g1-lib.sh 驱动——r121 标准库第 2 个实战消费者）
# G1a 链路：mock 接线（两步三字段 r119 坑①）→ 4HHB 装载 → AgentPanel（悬浮胶囊文本定位
#   r119 坑④）→ 视觉自查关（聚焦主链）→ 「分析一下表面疏水性」→ 报告卡 + 技能徽章 →
#   两段式回填数值（总面积/残基构成数字化）→ 图例 hydro 卡在场（color kd 已执行的旁证）→
#   报告节跳转双环（疏水与极性→color sasa→SASA 卡；残基构成→color kd→hydro 卡回归）
# G1b 链路：Reps 面板 → 添加 putty（radix 菜单 pointer 三连 r122 新坑防备）→ 双卡同屏
#   （putty 管径卡 + 疏水性 KD 卡）→ 截图存证
# 现场恢复：provider 默认回 zai（GET 复核）+ pins 清空 + 浏览器关闭
# 退出码：0 全链通过；1 任一环断言失败；2 管线故障
set -u
cd /home/z/my-project
source .zscripts/g1-lib.sh

echo "== G1a 表面疏水分析技能全链 =="

# —— 0. 清场：会话存档/钉清空（welcome 态起步）——
agent-browser eval "(() => { localStorage.removeItem('molvision-session-v1'); localStorage.removeItem('molvision-pinned-jumps'); return 'CLEARED' })()" >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 3

# —— 0.5 mock 接线（两步三字段：save config → setDefault——r119 坑①纪律）——
curl -s --max-time 5 -X POST http://localhost:3000/api/agent/providers -H 'Content-Type: application/json' \
  -d '{"providerId":"custom","apiKey":"test-key-12345","baseURL":"http://localhost:3999/v1","defaultModel":"mock-gpt"}' >/dev/null
curl -s --max-time 5 -X POST http://localhost:3000/api/agent/providers -H 'Content-Type: application/json' \
  -d '{"providerId":"custom","setDefault":true}' >/dev/null
prov=$(curl -s --max-time 5 http://localhost:3000/api/agent/providers | python3 -c "import json,sys; print(json.load(sys.stdin).get('defaultProvider','?'))" 2>/dev/null)
[ "$prov" = "custom" ] || g1_fail "mock 供应商接线失败（defaultProvider=$prov）"
echo "  mock 供应商已接线（defaultProvider=custom → 3999）"

# —— 1. 4HHB 装载（native setter 铁律 + fill 后按钮解禁过滤 r117 坑①）——
agent-browser eval "(() => { const i = document.querySelector('input[placeholder*=\"PDB\"], input[aria-label*=\"PDB\"], input[type=\"text\"]'); if (!i) return 'NOINPUT'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, '4HHB'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'SET' })()" >/dev/null 2>&1
sleep 1
agent-browser eval "(() => { const btns = Array.from(document.querySelectorAll('button')); const b = btns.find(x => /fetch|获取|下载|load/i.test(x.textContent || '') && !x.disabled); if (!b) return 'NOFETCH'; b.click(); return 'OK' })()" >/dev/null 2>&1
g1_wait_state "(() => { const s = window.__molEngine; return (s && document.querySelector('canvas[aria-label*=\"3D\"], canvas[aria-label*=\"molecular\"]')) ? 'OK::engine' : 'MISS::waiting' })()" 'OK::' 25 1 || g1_fail "4HHB 引擎 25s 未就位"
sleep 2

# —— 2. AgentPanel 打开（悬浮胶囊无 aria——文本 AI 助手/AI assistant + 可见性过滤 r119 坑④）——
g1_eval "(() => { const bs = Array.from(document.querySelectorAll('button')).filter(x => /AI 助手|AI assistant/i.test(x.textContent || '')); const b = bs.find(x => x.offsetParent !== null); if (!b) return 'NOBTN'; b.click(); return 'OK::panel' })()" 'OK::' >/dev/null || g1_fail "AI 面板入口未找到"
g1_wait_state "(() => { const p = document.querySelector('[aria-label*=\"AI assistant panel\"], [aria-label*=\"AI 助手面板\"]'); return p ? 'OK::agentpanel' : 'MISS::waiting' })()" 'OK::' 8 0.5 || g1_fail "AgentPanel 8s 未打开"
echo "  AgentPanel 已打开"

# —— 3. 视觉自查关（Eye 按钮——mock 主链聚焦；默认开 chat-store 207 行）——
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /关闭视觉自查|Turn off visual self-check/i.test(x.getAttribute('aria-label') || '')); if (!b) return 'NOBTN'; b.click(); return 'OK::visual-off' })()" 'OK::' >/dev/null || echo "  （视觉自查已关或按钮未找到——非致命）"
sleep 0.5

# —— 3.5 清空当前会话（陈旧状态竞态根修：前轮失败运行的旧报告卡已带回填数字，
#      「OK::backfilled」第 1 轮瞬 match 旧内容而新 turn 仍 busy → jumpTo busy 早退。
#      清空后唯一报告卡 = 本轮新 turn——断言不再被历史污染）——
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /清空当前会话|Clear current session/i.test(x.getAttribute('aria-label') || '')); if (!b) return 'NOBTN'; b.click(); return 'OK::cleared' })()" 'OK::' >/dev/null 2>&1 || echo "  （会话本就为空——无需清空）"
sleep 1

# —— 4. 发送「分析一下表面疏水性」（textarea native setter + Enter 派发）——
g1_eval "(() => { const ta = document.querySelector('textarea[placeholder*=\"描述需求\"], textarea[placeholder*=\"Describe\"]'); if (!ta) return 'NOINPUT'; const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; s.call(ta, '分析一下表面疏水性'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); return 'OK::sent' })()" 'OK::' >/dev/null || g1_fail "技能消息发送失败（textarea 缺失或 Enter 未派发）"
echo "  消息已发送（分析一下表面疏水性）"

# —— 5. 报告卡 + 技能徽章（mock 决策 + 流式回放；含命令执行时长）——
# 双语坑（r119 locale 纪律同族）：页面 locale 跨会话持久（EN 场）——徽章 ZH「标准技能 ·」
# / EN「Skill ·」双形态；报告标题恒 ZH（mock 按用户消息语言出报告——本轮 ZH 消息）
g1_wait_state "(() => { const p = document.querySelector('[aria-label*=\"AI assistant panel\"], [aria-label*=\"AI 助手面板\"]'); if (!p) return 'MISS::nopanel'; const t = p.textContent || ''; const report = t.includes('表面疏水分析报告') || t.includes('Surface Hydrophobicity Analysis'); const badge = t.includes('标准技能') || /Skill ·/.test(t); return report && badge ? 'OK::report' : 'MISS::' + (report ? 'no-badge' : 'no-report') })()" 'OK::' 60 1 || g1_fail "报告卡/技能徽章 60s 未出现（mock 决策或命令执行超时）"
echo "  报告卡 + 技能徽章在场"

# —— 6. 两段式回填数值（总面积/残基构成从「—」变数字）——
g1_wait_state "(() => { const p = document.querySelector('[aria-label*=\"AI assistant panel\"], [aria-label*=\"AI 助手面板\"]'); if (!p) return 'MISS::nopanel'; const t = p.textContent || ''; const total = /总面积：\\s*\\d/.test(t); const comp = /残基构成：\\s*疏水\\s*\\d/.test(t); return total && comp ? 'OK::backfilled' : 'MISS::' + (total ? 'comp' : 'total') + '-pending' })()" 'OK::' 60 1 || g1_fail "回填 60s 未完成（总面积/残基构成仍为「—」）"
echo "  回填完成（总面积 + 残基构成均为实测数值）"
sleep 2  # busy 沉降保险（回填文本落地与 busy 清零同提交——2s 缓冲防 jumpTo busy 早退竞态）

# —— 7. color kd 已执行旁证：图例 hydro 卡在场 ——
g1_wait_state "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; return /Hydrophobicity|疏水性/.test(lg.textContent || '') ? 'OK::hydro-legend' : 'MISS::wrongkind' })()" 'OK::' 10 0.5 || g1_fail "color kd 执行旁证失败（hydro 图例卡未在场）"
echo "  hydro 图例卡在场（color kd 已执行）"

# —— 8. 报告节跳转环①：疏水与极性节 → color sasa → SASA 卡 ——
# aria 坑（r109-b 设计）：跳转按钮 aria-label 含行首 ▌（调用侧截取「：」前整段）——
# 正则须容 ▌? 前缀；双语 locale 双形态
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /(Jump|跳转)[：:]\\s*▌?(疏水与极性|Hydrophobic & polar)/i.test(x.getAttribute('aria-label') || '')); if (!b) return 'NOBTN'; b.click(); return 'OK::jump-ratio' })()" 'OK::' >/dev/null || g1_fail "疏水与极性节跳转按钮未找到（报告节交互缺失）"
g1_wait_state "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; return /SASA/.test(lg.textContent || '') ? 'OK::sasa-legend' : 'MISS::waiting' })()" 'OK::' 10 0.5 || g1_fail "跳转环①失败（color sasa 未生效——SASA 卡未在场）"
echo "  跳转环①：疏水与极性 → color sasa → SASA 卡在场"

# —— 9. 报告节跳转环②：残基构成节 → color kd → hydro 卡回归 ——
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /(Jump|跳转)[：:]\\s*▌?(残基构成|Residue composition)/i.test(x.getAttribute('aria-label') || '')); if (!b) return 'NOBTN'; b.click(); return 'OK::jump-comp' })()" 'OK::' >/dev/null || g1_fail "残基构成节跳转按钮未找到"
g1_wait_state "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; return /Hydrophobicity|疏水性/.test(lg.textContent || '') ? 'OK::hydro-back' : 'MISS::waiting' })()" 'OK::' 10 0.5 || g1_fail "跳转环②失败（color kd 重放未生效——hydro 卡未回归）"
echo "  跳转环②：残基构成 → color kd → hydro 卡回归（报告→命令→渲染闭环）"

# —— 10. 截图存证（技能报告卡全链）——
bash .zscripts/wait-stable-frame.sh 4 2 0.15 >/dev/null 2>&1
agent-browser screenshot shots/r122-skill-report.png >/dev/null 2>&1 && echo "  存证 shots/r122-skill-report.png"

echo "== G1b 图例多卡并置 =="

# —— 11. Reps 面板轨道打开（aria 表示法/Representations）——
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^(表示法|Representations)$/.test((x.getAttribute('aria-label') || '').trim())); if (!b) return 'NOBTN'; b.click(); return 'OK::reps' })()" 'OK::' >/dev/null || g1_fail "Reps 轨道按钮未找到"
sleep 1

# —— 12. 添加 putty rep（radix DropdownMenu：trigger pointerdown + click → portal → menuitem pointer 三连）——
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^添加$|^Add$/.test((x.textContent || '').trim()) && x.offsetParent !== null); if (!b) return 'NOBTN'; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); return 'OK::add-menu' })()" 'OK::' >/dev/null || g1_fail "添加 rep 按钮未找到"
sleep 0.8
g1_eval "(() => { const wrap = document.querySelector('[data-radix-popper-content-wrapper]'); if (!wrap) return 'NOBTN'; const items = Array.from(wrap.querySelectorAll('[role=\"menuitem\"]')); const it = items.find(x => /Putty/i.test(x.textContent || '')); if (!it) return 'NOBTN'; it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); it.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); it.click(); return 'OK::putty-added' })()" 'OK::' >/dev/null || g1_fail "putty 菜单项未找到或点击失败（radix portal）"
echo "  putty rep 已添加"

# —— 13. 双卡同屏断言（putty 管径卡 + 疏水性 KD 卡——r122-b 多卡并置本体）——
g1_wait_state "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; const t = lg.textContent || ''; const putty = /putty 管径|putty tube/i.test(t); const hydro = /Hydrophobicity|疏水性/.test(t); const cards = lg.querySelectorAll(':scope > div').length; return putty && hydro ? 'OK::dual-' + cards + 'cards' : 'MISS::' + (putty ? 'no-hydro' : 'no-putty') })()" 'OK::' 15 0.5 || g1_fail "双卡同屏断言失败（putty 卡或 hydro 卡缺失——多卡并置回归）"
echo "  双卡同屏（putty 管径卡 + 疏水性 KD 卡）"

# —— 14. 截图存证（多卡并置）——
bash .zscripts/wait-stable-frame.sh 4 2 0.15 >/dev/null 2>&1
agent-browser screenshot shots/r122-legend-multi.png >/dev/null 2>&1 && echo "  存证 shots/r122-legend-multi.png"

# —— 15. console 错误检查（全程零新错）——
errs=$(agent-browser errors 2>/dev/null | tr -d '\n')
if [ -n "$errs" ] && [ "$errs" != "[]" ]; then
  echo "  console errors 非空：${errs:0:200}"
  g1_fail "G1 全程出现 console 错误"
fi
echo "  console 零错误"

# —— 16. 现场恢复：provider 默认回 zai + pins 清空 + 浏览器关闭 ——
curl -s --max-time 5 -X POST http://localhost:3000/api/agent/providers -H 'Content-Type: application/json' \
  -d '{"providerId":"zai","setDefault":true}' >/dev/null
prov2=$(curl -s --max-time 5 http://localhost:3000/api/agent/providers | python3 -c "import json,sys; print(json.load(sys.stdin).get('defaultProvider','?'))" 2>/dev/null)
[ "$prov2" = "zai" ] || g1_fail "现场恢复失败（defaultProvider=$prov2，应为 zai）"
agent-browser eval "(() => { localStorage.removeItem('molvision-pinned-jumps'); return 'CLEARED' })()" >/dev/null 2>&1
agent-browser close >/dev/null 2>&1
echo "  现场恢复完成（provider=zai · pins 清空 · 浏览器关闭）"

echo "== G1 PASS（技能全链含双跳转环 + 多卡并置 全过）=="
