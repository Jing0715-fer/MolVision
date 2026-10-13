#!/usr/bin/env bash
# r121 G1a：疏水性着色全链（g1-lib.sh 首个实战驱动——标准三步真跑）
# 链路：4HHB 装载 → Colors 面板轨道 → 疏水色卡点击（g1_click_toast 观察窗）→
# 图例卡在场断言（g1_wait_state 慢状态）→ 图例刻度内容 → 控制台 color kd 回执统计 → 截图存证
# 退出码：0 全链通过；1 任一环断言失败；2 管线故障
set -u
cd /home/z/my-project
source .zscripts/g1-lib.sh

echo "== G1a 疏水性着色全链 =="

# —— 0. 清场：会话存档/钉/残留选择清空（welcome 态起步）——
agent-browser eval "(() => { localStorage.removeItem('molvision-session-v1'); localStorage.removeItem('molvision-pinned-jumps'); return 'CLEARED' })()" >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 3

# —— 1. 4HHB 装载（native setter 铁律 + fill 后按钮解禁过滤 r117 坑①）——
agent-browser eval "(() => { const i = document.querySelector('input[placeholder*=\"PDB\"], input[aria-label*=\"PDB\"], input[type=\"text\"]'); if (!i) return 'NOINPUT'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, '4HHB'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'SET' })()" >/dev/null 2>&1
sleep 1
agent-browser eval "(() => { const btns = Array.from(document.querySelectorAll('button')); const b = btns.find(x => /fetch|获取|下载|load/i.test(x.textContent || '') && !x.disabled); if (!b) return 'NOFETCH'; b.click(); return 'OK' })()" 2>/dev/null | tr -d '\n' | tr -d '"'
echo " <- fetch clicked"
# 结构落地 + 引擎就位（慢状态有界轮询——g1_wait_state）
g1_wait_state "(() => { const s = window.__molEngine; const st = document.querySelector('[data-structure-count], .structure-item'); return (s && document.querySelector('canvas[aria-label*=\"3D\"], canvas[aria-label*=\"molecular\"]')) ? 'OK::engine' : 'MISS::waiting' })()" 'OK::' 25 1 || g1_fail "4HHB 引擎 25s 未就位"
sleep 2

# —— 2. Colors 面板轨道打开（aria-label Colors/颜色）——
agent-browser eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^(Colors|颜色)$/.test((x.getAttribute('aria-label') || '').trim())); if (!b) return 'NOBTN'; b.click(); return 'OK::panel' })()" >/dev/null 2>&1
sleep 1

# —— 3. 疏水色卡点击 → toast 观察窗（g1_click_toast 标准三步）——
# 色卡定位：ColorsPanel 方案卡（panel-card 按钮，含 Hydrophobicity 文本）
CLICK_JS="(() => { const cards = Array.from(document.querySelectorAll('button.panel-card')); const c = cards.find(x => /Hydrophobicity|疏水性/.test(x.textContent || '')); if (!c) return 'NOBTN'; c.click(); return 'OK::clicked' })()"
g1_click_toast "$CLICK_JS" 'Applied: Hydrophobicity' 6
toast_rc=$?
if [ "$toast_rc" -ne 0 ]; then
  # EN 文案截断风险兜底：宽模式重试一次（不吞失败——只放宽前缀）
  g1_click_toast "$CLICK_JS" 'Applied' 6 || g1_fail "疏水色卡 toast 观察窗未命中（退出码 $toast_rc → 重试仍败）"
fi
echo "  toast 命中（Applied: Hydrophobicity…）"

# —— 4. 图例卡在场断言（慢状态——着色即时但 legend 渲染走 React 提交）——
g1_wait_state "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; return lg.textContent && /Hydrophobicity|疏水性/.test(lg.textContent) ? 'OK::legend' : 'MISS::wrongkind' })()" 'OK::' 8 0.5 || g1_fail "图例卡 8s 未出现或非疏水方案"

# —— 5. 图例刻度内容断言（KD 界 + 端点残基标注）——
legend_body=$(g1_eval "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; const t = (lg.textContent || '').replace(/\\s+/g, ' '); return t.includes('−4.5') && t.includes('+4.5') ? 'OK::' + t.slice(0, 90) : 'MISS::' + t.slice(0, 90) })()" 'OK::') || g1_fail "图例刻度缺 −4.5/+4.5 界标注：$legend_body"
echo "  图例刻度：${legend_body:0:80}"

# —— 6. 控制台 color kd 回执统计（残基构成三类计数）——
# 控制台开关 = 反引号（MolViewer keydown '`'——PyMOL 惯例）；输入是 input 元素非 textarea
agent-browser eval "(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\u0060', bubbles: true })); return 'CONSOLE-TOGGLE-SENT' })()" >/dev/null 2>&1
sleep 1
agent-browser eval "(() => { const cands = Array.from(document.querySelectorAll('input')).filter(x => x.type === 'text' && !x.disabled); const t = cands.find(x => /color|命令|command|PDB/i.test(x.placeholder || '')) || cands[cands.length - 1]; if (!t) return 'NOINPUT'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(t, 'color kd'); t.dispatchEvent(new Event('input', { bubbles: true })); t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return 'OK::sent' })()" 2>/dev/null | tr -d '\n' | tr -d '"'
echo " <- color kd sent"
sleep 2
receipt=$(g1_eval "(() => { const logs = Array.from(document.querySelectorAll('.font-mono, [class*=\"console\"] span, [class*=\"receipt\"]')); const all = document.body.innerText; return /残基构成：疏水/.test(all) || /hydrophobic ·/.test(all) ? 'OK::receipt-stats' : 'MISS::no-stats' })()" 'OK::') || g1_fail "color kd 回执缺残基构成统计"
echo "  回执统计：${receipt}"

# —— 7. 截图存证（稳定帧后拍）——
bash .zscripts/wait-stable-frame.sh 4 2 0.15 >/dev/null 2>&1
agent-browser screenshot shots/r121-hydro-legend.png >/dev/null 2>&1 && echo "  存证 shots/r121-hydro-legend.png"

echo "== G1a PASS（色卡点击 toast / 图例在场+刻度 / 回执统计 三环全过）=="
