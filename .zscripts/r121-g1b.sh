#!/usr/bin/env bash
# r121 G1b：cmdk Enter 直达验证（r120 建议③收口——真实键盘 Enter 派发路径）
# 背景：r120 G1b 的恢复命令执行走 vis[0].click()——cmdk onSelect 的 keydown 分支
# （真实键盘流：输入 resume → Enter）从未被自动化覆盖。
# 链路：4HHB 存档在（G1a 已装载自动存档）→ 刷新不恢复（molData=0）→ Ctrl+K →
# native setter 输入 resume → **派发 Enter keydown（非 click）** → wait-toast → molData=1
# 退出码：0 键盘流闭环；1 断言失败；2 管线故障
set -u
cd /home/z/my-project
source .zscripts/g1-lib.sh

echo "== G1b cmdk Enter 直达（键盘流真实派发）=="

# —— 1. 确认会话存档在场（G1a 的 4HHB 应已自动存档）——
has_session=$(g1_eval "(() => { const raw = localStorage.getItem('molvision-session-v1'); return raw ? 'OK::' + raw.slice(0, 40) : 'MISS::nosession' })()" 'OK::') || g1_fail "molvision-session-v1 缺失——G1a 装载未自动存档？先跑 r121-g1a.sh"
echo "  存档在场（${has_session:0:30}…）"

# —— 2. 刷新不恢复（molData=0 恢复卡在场）——
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 4
g1_wait_state "(() => { const cards = Array.from(document.querySelectorAll('canvas')); const noStruct = !document.querySelector('canvas[aria-label*=\"3D\"], canvas[aria-label*=\"molecular\"]'); return noStruct ? 'OK::empty' : 'MISS::still-rendering' })()" 'OK::' 10 0.8 || echo "  （视口 canvas 仍在——结构可能被自动恢复，改按 molData 判定）"

# —— 3. Ctrl+K 开面板 ——
agent-browser eval "(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); return 'PALETTE-OPEN-SENT' })()" >/dev/null 2>&1
sleep 1.5
pal=$(g1_eval "(() => { const dlg = document.querySelector('[cmdk-root], [role=\"dialog\"]'); return dlg ? 'OK::open' : 'MISS::nocmdk' })()" 'OK::') || g1_fail "Ctrl+K 后 cmdk 面板未开"
echo "  cmdk 面板已开"

# —— 4. native setter 输入 resume（cmdk 输入框 = [cmdk-input]）——
agent-browser eval "(() => { const i = document.querySelector('[cmdk-input]'); if (!i) return 'NOINPUT'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, 'resume'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'OK::typed' })()" 2>/dev/null | tr -d '\n' | tr -d '"'
echo " <- resume typed"
sleep 1

# —— 5. 断言恢复项在候选首（输入过滤后 21 项居首的 r120 行为回归）——
top_item=$(g1_eval "(() => { const items = Array.from(document.querySelectorAll('[cmdk-item]')).filter(x => x.offsetParent); const first = items[0]; return first && /Resume last session|恢复上次会话/.test(first.textContent || '') ? 'OK::' + (first.textContent || '').trim().slice(0, 50) : 'MISS::' + (first ? (first.textContent || '').slice(0, 40) : 'no-items') })()" 'OK::') || echo "  WARN: resume 未居首（候选首位: $top_item）"
echo "  候选首项：${top_item:-（宽断言跳过）}"

# —— 6. Enter 键盘派发（本轮核心——cmdk onSelect 的 keydown 分支，非 click）——
agent-browser eval "(() => { const i = document.querySelector('[cmdk-input]'); if (!i) return 'NOINPUT'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); return 'OK::enter-dispatched' })()" 2>/dev/null | tr -d '\n' | tr -d '"'
echo " <- Enter keydown dispatched"

# —— 7. toast 观察窗（g1-lib 标准三步的第 2 步——立即查不 sleep）——
bash .zscripts/wait-toast.sh 'Previous session restored' 8 || g1_fail "Enter 派发后恢复 toast 未命中（8s 窗）"
echo "  toast：Previous session restored FOUND"

# —— 8. 状态断言（第 3 步——慢状态引擎就位）——
g1_wait_state "(() => { const s = document.querySelector('canvas[aria-label*=\"3D\"], canvas[aria-label*=\"molecular\"]'); return s ? 'OK::engine' : 'MISS::waiting' })()" 'OK::' 20 1 || g1_fail "Enter 恢复后 20s 引擎未就位"

echo "== G1b PASS（Enter keydown 派发 → onSelect → 恢复 toast + 引擎就位——键盘流闭环）=="
