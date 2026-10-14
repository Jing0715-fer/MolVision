#!/usr/bin/env bash
# r123 G1：hover 试穿链 + putty 柔性技能链 + 图例折叠链 + Tab 填充链（g1-lib.sh 驱动）
# G1a 试穿链：4HHB 装载 → ColorsPanel → focus 疏水性色卡（onFocus 键盘路径与
#   onMouseEnter 同一 setter）→ Eye 图标在场（trying 态镜像）→ 像素级 teal/amber
#   渐变在场（hydrophobicity 渲染落地）→ blur 恢复（Eye 消失 + teal 退场）
# G1b 柔性技能链：mock 接线 → AgentPanel → 清空会话 →「分析一下柔性分布」→
#   报告卡 + 徽章 → 两段式回填（B 因子范围 min–max + 高柔性 n/total）→
#   putty 图例卡在场（show putty 旁证）→ 跳转环（B 因子范围 → color bfactor 稳态）
# G1c 折叠链：技能链后双卡直显（≤2 不折叠负向断言）→ Reps 添加 spheres →
#   colorScheme Select 改 hydrophobicity（radix Select 单 rep 改色——3 卡唯一路径）→
#   折叠态（颜色标尺 ×3 + aria-expanded=false）→ 点击展开三卡 → 收起回折叠
# G1d Tab 填充链：控制台跑 orient（进历史）→ Ctrl+K → 搜 orient → Tab 派发 →
#   ConsoleBar input 填充值断言（dispatchFillCmd 全链——r122 建议①收口）
# 现场恢复：provider 默认回 zai（GET 复核）+ pins/历史清空 + 浏览器关闭
# 退出码：0 全链通过；1 任一环断言失败；2 管线故障
set -u
cd /home/z/my-project
source .zscripts/g1-lib.sh

PY_CANVAS_TEAL() {
  # canvas 区 teal 计数（r122 DOMrect 纪律：全屏采样混入面板 UI teal 实测 ~173 像素——
# 左轨结构列表图标 + 底部停靠色卡样本圆点均 teal 系；裁剪到 3D 视口后基线近 0）。
# 参数：$1=png $2=x $3=y $4=w $5=h → 区域内全采样（stride-1，容差 45）
python3 - "$1" "$2" "$3" "$4" "$5" <<'PYEOF'
import sys
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGB')
x, y, w, h = int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
n = 0
for yy in range(max(0, y), min(y + h, img.size[1])):
    for xx in range(max(0, x), min(x + w, img.size[0])):
        p = img.getpixel((xx, yy))
        if abs(p[0]-23) <= 45 and abs(p[1]-126) <= 45 and abs(p[2]-145) <= 45:
            n += 1
print(n)
PYEOF
}

# canvas DOMrect 实测（截图前取——面板开合改变 canvas 高度，每帧现取）
CANVAS_RECT() {
  g1_eval "(() => { const c = document.querySelector('canvas[aria-label*=\"3D\"]'); if (!c) return 'MISS::nocanvas'; const r = c.getBoundingClientRect(); return 'OK::' + Math.round(r.x) + ',' + Math.round(r.y) + ',' + Math.round(r.width) + ',' + Math.round(r.height) })()" 'OK::' || g1_fail "canvas DOMrect 获取失败（3D 视口 canvas 缺席）"
}

echo "== G1a 配色方案 hover 试穿链（focus 键盘路径）=="

# —— 0. 清场：会话存档/钉清空（welcome 态起步）——
agent-browser eval "(() => { localStorage.removeItem('molvision-session-v1'); localStorage.removeItem('molvision-pinned-cmds'); localStorage.removeItem('molvision-cmd-history'); return 'CLEARED' })()" >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
sleep 3

# —— 1. 4HHB 装载（native setter 铁律 + fill 后按钮解禁过滤）——
agent-browser eval "(() => { const i = document.querySelector('input[placeholder*=\"PDB\"], input[aria-label*=\"PDB\"], input[type=\"text\"]'); if (!i) return 'NOINPUT'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, '4HHB'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'SET' })()" >/dev/null 2>&1
sleep 1
agent-browser eval "(() => { const btns = Array.from(document.querySelectorAll('button')); const b = btns.find(x => /fetch|获取|下载|load/i.test(x.textContent || '') && !x.disabled); if (!b) return 'NOFETCH'; b.click(); return 'OK' })()" >/dev/null 2>&1
g1_wait_state "(() => { const s = window.__molEngine; return (s && document.querySelector('canvas[aria-label*=\"3D\"], canvas[aria-label*=\"molecular\"]')) ? 'OK::engine' : 'MISS::waiting' })()" 'OK::' 25 1 || g1_fail "4HHB 引擎 25s 未就位"
sleep 2

# —— 2. ColorsPanel 轨道先开（底部停靠面板开合改变 canvas 高度——先开面板使三帧同布局，
# 基线/试穿/恢复帧的 canvas 尺寸一致，delta 口径才干净）——
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^(Colors|颜色)$/.test((x.getAttribute('aria-label') || '').trim())); if (!b) return 'NOBTN'; b.click(); return 'OK::panel' })()" 'OK::' >/dev/null || g1_fail "Colors 轨道按钮未找到"
g1_wait_state "(() => { const cards = Array.from(document.querySelectorAll('button.panel-card')); return cards.length > 0 ? 'OK::cards' : 'MISS::waiting' })()" 'OK::' 8 0.5 || g1_fail "配色方案色卡未渲染（面板空）"
echo "  Colors 面板已开（色卡在场——canvas 布局定型）"

# —— 3. 基线帧（试穿前——面板已开同布局；canvas DOMrect 裁剪计数）——
bash .zscripts/wait-stable-frame.sh 4 2 0.15 >/dev/null 2>&1
agent-browser screenshot /tmp/r123-try-before.png >/dev/null 2>&1
rect_b=$(CANVAS_RECT); rb=${rect_b#OK::}
IFS=',' read -r bx by bw bh <<< "$rb"
teal_base=$(PY_CANVAS_TEAL /tmp/r123-try-before.png "$bx" "$by" "$bw" "$bh")
echo "  基线帧（canvas ${bw}×${bh}）：teal=${teal_base}（element 态 canvas 区应近 0——UI teal 已被裁剪排除）"
if [ "$teal_base" -gt 60 ]; then
  g1_fail "基线帧 canvas 区 teal=${teal_base} 异常偏高（结构非默认着色？或 DOMrect 定位错位）"
fi

# —— 4. focus 疏水性色卡行（onFocus 键盘试穿——与 onMouseEnter 同一 setPreviewScheme）——
g1_eval "(() => { const cards = Array.from(document.querySelectorAll('button.panel-card')); const c = cards.find(x => /Hydrophobicity|疏水性/.test(x.textContent || '')); if (!c) return 'NOBTN'; c.focus(); return 'OK::focused' })()" 'OK::' >/dev/null || g1_fail "疏水性色卡行未找到（panel-card 定位失败）"
g1_wait_state "(() => { const cards = Array.from(document.querySelectorAll('button.panel-card')); const c = cards.find(x => /Hydrophobicity|疏水性/.test(x.textContent || '')); if (!c) return 'MISS::nocard'; const eye = c.querySelector('svg.lucide-eye'); const ring = (c.className || '').includes('ring'); return eye && ring ? 'OK::trying' : 'MISS::' + (eye ? 'no-ring' : 'no-eye') })()" 'OK::' 8 0.5 || g1_fail "试穿态 UI 镜像未落地（Eye 图标/ring 缺失）"
echo "  focus 试穿态在场（Eye 图标 + ring 高亮）"

# —— 5. 引擎重建 + 像素级渲染断言（delta 口径：试穿帧 − 基线帧 ≥ 40——KD 渐变上屏净增益；
# 全屏绝对值断言已被 UI teal 污染证伪，canvas 裁剪 + delta 是唯一干净口径）——
sleep 2
bash .zscripts/wait-stable-frame.sh 4 2 0.15 >/dev/null 2>&1
agent-browser screenshot /tmp/r123-try-on.png >/dev/null 2>&1
rect_t=$(CANVAS_RECT); rt=${rect_t#OK::}
IFS=',' read -r tx ty tw th <<< "$rt"
teal_on=$(PY_CANVAS_TEAL /tmp/r123-try-on.png "$tx" "$ty" "$tw" "$th")
delta_on=$((teal_on - teal_base))
echo "  试穿帧：teal=${teal_on}（delta +${delta_on} vs 基线 ${teal_base}）"
if [ "$delta_on" -lt 40 ]; then
  g1_fail "试穿渲染未落地（canvas 区 delta=${delta_on} < 40——hydrophobicity 渐变未上屏；引擎重建链断裂？）"
fi
echo "  像素级试穿在场（delta=+${delta_on} ≥ 40——KD 渐变渲染落地）"

# —— 6. blur 恢复（Eye 消失 + teal 退场——试穿零残留断言）——
g1_eval "(() => { const a = document.activeElement; if (a) a.blur(); return 'OK::blurred' })()" 'OK::' >/dev/null
g1_wait_state "(() => { const cards = Array.from(document.querySelectorAll('button.panel-card')); const c = cards.find(x => /Hydrophobicity|疏水性/.test(x.textContent || '')); if (!c) return 'MISS::nocard'; const eye = c.querySelector('svg.lucide-eye'); return eye ? 'MISS::still-eye' : 'OK::restored' })()" 'OK::' 8 0.5 || g1_fail "blur 后 Eye 图标未消失（试穿态卡死——卸载恢复缺失？）"
sleep 2
bash .zscripts/wait-stable-frame.sh 4 2 0.15 >/dev/null 2>&1
agent-browser screenshot /tmp/r123-try-off.png >/dev/null 2>&1
rect_o=$(CANVAS_RECT); ro=${rect_o#OK::}
IFS=',' read -r ox oy ow oh <<< "$ro"
teal_off=$(PY_CANVAS_TEAL /tmp/r123-try-off.png "$ox" "$oy" "$ow" "$oh")
residue=$((teal_off - teal_base))
echo "  恢复帧：teal=${teal_off}（残留 ${residue} vs 基线 ${teal_base}，容差 ±20）"
if [ "$residue" -gt 20 ] || [ "$residue" -lt -20 ]; then
  g1_fail "试穿残留（恢复帧 teal=${teal_off} vs 基线 ${teal_base}，残留 ${residue} 超容差 ±20——previewScheme 未清或引擎未重建）"
fi
cp /tmp/r123-try-on.png shots/r123-tryon-hydro.png 2>/dev/null && echo "  存证 shots/r123-tryon-hydro.png"
echo "== G1a 试穿链 PASS（focus 试穿 → 像素落地 → blur 恢复零残留）=="

echo "== G1b putty 柔性分析技能全链 =="

# —— 7. mock 接线（两步三字段：save config → setDefault）——
curl -s --max-time 5 -X POST http://localhost:3000/api/agent/providers -H 'Content-Type: application/json' \
  -d '{"providerId":"custom","apiKey":"test-key-12345","baseURL":"http://localhost:3999/v1","defaultModel":"mock-gpt"}' >/dev/null
curl -s --max-time 5 -X POST http://localhost:3000/api/agent/providers -H 'Content-Type: application/json' \
  -d '{"providerId":"custom","setDefault":true}' >/dev/null
prov=$(curl -s --max-time 5 http://localhost:3000/api/agent/providers | python3 -c "import json,sys; print(json.load(sys.stdin).get('defaultProvider','?'))" 2>/dev/null)
[ "$prov" = "custom" ] || g1_fail "mock 供应商接线失败（defaultProvider=$prov）"
echo "  mock 供应商已接线（defaultProvider=custom → 3999）"

# —— 8. AgentPanel 打开 + 清空会话（陈旧状态竞态根修）——
g1_eval "(() => { const bs = Array.from(document.querySelectorAll('button')).filter(x => /AI 助手|AI assistant/i.test(x.textContent || '')); const b = bs.find(x => x.offsetParent !== null); if (!b) return 'NOBTN'; b.click(); return 'OK::panel' })()" 'OK::' >/dev/null || g1_fail "AI 面板入口未找到"
g1_wait_state "(() => { const p = document.querySelector('[aria-label*=\"AI assistant panel\"], [aria-label*=\"AI 助手面板\"]'); return p ? 'OK::agentpanel' : 'MISS::waiting' })()" 'OK::' 8 0.5 || g1_fail "AgentPanel 8s 未打开"
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /清空当前会话|Clear current session/i.test(x.getAttribute('aria-label') || '')); if (!b) return 'NOBTN'; b.click(); return 'OK::cleared' })()" 'OK::' >/dev/null 2>&1 || echo "  （会话本就为空——无需清空）"
sleep 1

# —— 9. 发送「分析一下柔性分布」（textarea native setter + Enter 派发）——
g1_eval "(() => { const ta = document.querySelector('textarea[placeholder*=\"描述需求\"], textarea[placeholder*=\"Describe\"]'); if (!ta) return 'NOINPUT'; const s = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set; s.call(ta, '分析一下柔性分布'); ta.dispatchEvent(new Event('input', { bubbles: true })); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); return 'OK::sent' })()" 'OK::' >/dev/null || g1_fail "技能消息发送失败"
echo "  消息已发送（分析一下柔性分布）"

# —— 10. 报告卡 + 技能徽章 ——
g1_wait_state "(() => { const p = document.querySelector('[aria-label*=\"AI assistant panel\"], [aria-label*=\"AI 助手面板\"]'); if (!p) return 'MISS::nopanel'; const t = p.textContent || ''; const report = t.includes('柔性分析报告'); const badge = t.includes('标准技能') || /Skill ·/.test(t); return report && badge ? 'OK::report' : 'MISS::' + (report ? 'no-badge' : 'no-report') })()" 'OK::' 60 1 || g1_fail "报告卡/技能徽章 60s 未出现（mock 决策或命令执行超时）"
echo "  报告卡 + 技能徽章在场"

# —— 11. 两段式回填数值（B 因子范围 min–max + 高柔性 n/total 双数值域）——
g1_wait_state "(() => { const p = document.querySelector('[aria-label*=\"AI assistant panel\"], [aria-label*=\"AI 助手面板\"]'); if (!p) return 'MISS::nopanel'; const t = p.textContent || ''; const brange = /B 因子范围：\\s*[\\d.]+–[\\d.]+/.test(t); const flex = /高柔性残基：\\s*\\d+\\/\\d+/.test(t); return brange && flex ? 'OK::backfilled' : 'MISS::' + (brange ? 'flex' : 'brange') + '-pending' })()" 'OK::' 60 1 || g1_fail "回填 60s 未完成（B 因子范围/高柔性残基仍为「—」）"
echo "  回填完成（B 因子范围 + 高柔性残基均为实测数值）"
sleep 2  # busy 沉降保险

# —— 12. show putty 执行旁证：putty 图例卡在场（B 因子 (Å²) + putty 管径副标）——
g1_wait_state "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; const t = lg.textContent || ''; const putty = /putty 管径|putty tube/i.test(t); const bf = /B 因子|B-factor/.test(t); return putty && bf ? 'OK::putty-bf' : 'MISS::' + (putty ? 'no-bf' : 'no-putty') })()" 'OK::' 15 0.5 || g1_fail "putty/B 因子图例卡未在场（show putty 或 color bfactor 未执行）"
echo "  putty 卡 + B 因子卡在场（show putty + color bfactor 已执行）"

# —— 13. 报告节跳转环：B 因子范围节 → color bfactor（静态命令重放——稳态断言）——
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /(Jump|跳转)[：:]\\s*▌?(B 因子范围|B-factor range)/i.test(x.getAttribute('aria-label') || '')); if (!b) return 'NOBTN'; b.click(); return 'OK::jump-brange' })()" 'OK::' >/dev/null || g1_fail "B 因子范围节跳转按钮未找到（报告节交互缺失）"
sleep 1.5
g1_wait_state "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; const t = lg.textContent || ''; return /putty 管径|putty tube/i.test(t) ? 'OK::putty-stable' : 'MISS::gone' })()" 'OK::' 10 0.5 || g1_fail "跳转后 putty 卡消失（color bfactor 重放破坏 putty rep？）"
echo "  跳转环：B 因子范围 → color bfactor 重放 → putty 卡稳态在场"

# —— 14. 截图存证（技能报告卡全链）——
bash .zscripts/wait-stable-frame.sh 4 2 0.15 >/dev/null 2>&1
agent-browser screenshot shots/r123-flex-skill.png >/dev/null 2>&1 && echo "  存证 shots/r123-flex-skill.png"
echo "== G1b 柔性技能链 PASS（报告 + 回填双数值域 + putty 旁证 + 跳转环）=="

echo "== G1c 图例折叠收纳链 =="

# —— 15. 双卡直显负向断言（≤2 卡不折叠——r122-b 双卡并置特性回归保护；
# aria-expanded 限定图例容器内查询——全文档实测 11 个其它 aria-expanded 下拉触发器，宽查询误报）——
g1_eval "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; const fold = lg.querySelector('[aria-expanded]'); return fold ? 'FAIL::folded-at-2' : 'OK::direct-2cards' })()" 'OK::' >/dev/null || g1_fail "双卡态误折叠或图例缺席（≤2 卡直显回归破坏——r122-b 特性回归）"
echo "  双卡直显（≤COLLAPSE_THRESHOLD 不折叠——r122-b 特性保护）"

# —— 16. Reps 面板 + 添加 spheres rep（radix DropdownMenu pointer 三连）——
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^(表示法|Representations)$/.test((x.getAttribute('aria-label') || '').trim())); if (!b) return 'NOBTN'; b.click(); return 'OK::reps' })()" 'OK::' >/dev/null || g1_fail "Reps 轨道按钮未找到"
sleep 1
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /^添加$|^Add$/.test((x.textContent || '').trim()) && x.offsetParent !== null); if (!b) return 'NOBTN'; b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); return 'OK::add-menu' })()" 'OK::' >/dev/null || g1_fail "添加 rep 按钮未找到"
sleep 0.8
g1_eval "(() => { const wrap = document.querySelector('[data-radix-popper-content-wrapper]'); if (!wrap) return 'NOBTN'; const items = Array.from(wrap.querySelectorAll('[role=\"menuitem\"]')); const it = items.find(x => /Space fill|Spacefill|空间填充/i.test(x.textContent || '')); if (!it) return 'NOBTN'; it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); it.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); it.click(); return 'OK::spheres-added' })()" 'OK::' >/dev/null || g1_fail "Space fill（球表示）菜单项未找到或点击失败（radix portal——实测菜单项为 Space fill 非 Spheres）"
echo "  spheres rep 已添加（colorScheme 默认 element）"

# —— 17. spheres rep 配色 Select → hydrophobicity（radix Select 单 rep 改色——3 卡唯一路径）——
g1_eval "(() => { const trigs = Array.from(document.querySelectorAll('button[title*=\"配色方案\"], button[title*=\"Color scheme\"]')).filter(x => x.offsetParent !== null); const tr = trigs[trigs.length - 1]; if (!tr) return 'NOBTN'; tr.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); tr.click(); return 'OK::scheme-menu' })()" 'OK::' >/dev/null || g1_fail "spheres rep 配色 Select trigger 未找到"
sleep 0.8
g1_eval "(() => { const wrap = document.querySelector('[data-radix-popper-content-wrapper]'); if (!wrap) return 'NOBTN'; const opts = Array.from(wrap.querySelectorAll('[role=\"option\"]')); const it = opts.find(x => /Hydrophobicity|疏水性/i.test(x.textContent || '')); if (!it) return 'NOBTN'; it.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); it.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); it.click(); return 'OK::hydro-selected' })()" 'OK::' >/dev/null || g1_fail "Hydrophobicity 选项未找到或点击失败（radix Select option）"
echo "  spheres rep 配色已切 hydrophobicity"

# —— 18. 三卡折叠态断言（≥3 卡触发折叠——r123-b 本体）——
g1_wait_state "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; const fold = lg.querySelector('[aria-expanded]'); if (!fold) return 'MISS::nofold'; const t = fold.textContent || ''; const cnt = /×3|×\\s*3/.test(t) || /3 个颜色标尺|3 color scales/.test(t); return cnt ? 'OK::folded-3' : 'MISS::' + t.slice(0, 50) })()" 'OK::' 15 0.5 || g1_fail "三卡折叠态未触发（颜色标尺 ×3 折叠卡缺失）"
echo "  三卡折叠态在场（颜色标尺 ×3 + aria-expanded=false）"

# —— 19. 点击展开 → 三卡全显 + 收起按钮 ——
g1_eval "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; const fold = lg.querySelector('[aria-expanded]'); if (!fold) return 'NOBTN'; fold.click(); return 'OK::expanded' })()" 'OK::' >/dev/null || g1_fail "折叠卡点击展开失败"
g1_wait_state "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; const t = lg.textContent || ''; const putty = /putty 管径|putty tube/i.test(t); const bf = /B 因子|B-factor/.test(t); const hydro = /Hydrophobicity|疏水性/.test(t); const collapseBtn = Array.from(lg.querySelectorAll('button')).some(b => /收起标尺|Collapse legends/i.test(b.textContent || '')); return putty && bf && hydro && collapseBtn ? 'OK::3cards' : 'MISS::' + [putty ? '' : 'no-putty', bf ? '' : 'no-bf', hydro ? '' : 'no-hydro', collapseBtn ? '' : 'no-collapsebtn'].join('') })()" 'OK::' 10 0.5 || g1_fail "展开态三卡/收起按钮缺失"
echo "  展开态三卡全显（putty + B 因子 + 疏水性）+ 收起按钮在场"

# —— 20. 收起回折叠 + 截图存证 ——
g1_eval "(() => { const b = Array.from(document.querySelectorAll('button')).find(x => /收起标尺|Collapse legends/i.test(x.textContent || '')); if (!b) return 'NOBTN'; b.click(); return 'OK::collapsed' })()" 'OK::' >/dev/null || g1_fail "收起标尺按钮未找到"
g1_wait_state "(() => { const lg = document.querySelector('[aria-label*=\"Color scale\"], [aria-label*=\"颜色标尺\"]'); if (!lg) return 'MISS::nolegend'; const fold = lg.querySelector('[aria-expanded]'); return fold ? 'OK::back-to-fold' : 'MISS::nofold' })()" 'OK::' 8 0.5 || g1_fail "收起后折叠态未回归"
bash .zscripts/wait-stable-frame.sh 4 2 0.15 >/dev/null 2>&1
agent-browser screenshot shots/r123-legend-fold.png >/dev/null 2>&1 && echo "  存证 shots/r123-legend-fold.png"
echo "== G1c 图例折叠链 PASS（2 卡直显负向 + 3 卡折叠/展开/收起全周期）=="

echo "== G1d CommandPalette Tab 填充链（r122 建议①收口）=="

# —— 21. 控制台跑 orient（进历史——反引号开关 + input + Enter）——
g1_eval "(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '\`', bubbles: true })); return 'OK::console-open' })()" 'OK::' >/dev/null || g1_fail "控制台开关（反引号）派发失败"
sleep 0.8
g1_eval "(() => { const i = document.querySelector('input[placeholder*=\"load 4hhb\"]'); if (!i) return 'NOINPUT'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, 'orient'); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })); return 'OK::orient-run' })()" 'OK::' >/dev/null || g1_fail "控制台 orient 命令执行失败（input 缺失或 Enter 未派发）"
sleep 1
hist=$(g1_eval "(() => { const raw = localStorage.getItem('molvision-cmd-history'); return raw && raw.includes('orient') ? 'OK::in-history' : 'MISS::' + (raw ? raw.slice(0, 60) : 'empty') })()" 'OK::') || g1_fail "orient 未入历史（${hist}）"
echo "  orient 已入命令历史"

# —— 22. Ctrl+K → palette 开 → 搜 orient → Tab 派发（dispatchFillCmd 键盘流）——
g1_eval "(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true })); return 'OK::ctrlk' })()" 'OK::' >/dev/null || g1_fail "Ctrl+K 派发失败"
sleep 1.5
g1_wait_state "(() => { const dlg = document.querySelector('[cmdk-root], [role=\"dialog\"]'); return dlg ? 'OK::palette-open' : 'MISS::waiting' })()" 'OK::' 8 0.5 || g1_fail "Ctrl+K 后 cmdk 面板未开"
g1_eval "(() => { const i = document.querySelector('[cmdk-input]'); if (!i) return 'NOINPUT'; const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; s.call(i, 'orient'); i.dispatchEvent(new Event('input', { bubbles: true })); return 'OK::typed' })()" 'OK::' >/dev/null || g1_fail "palette 输入 orient 失败"
sleep 1

# —— 23. Tab 键派发（本轮核心——onInputKeyDown 的 Tab 分支 → fillConsole → dispatchFillCmd）——
g1_eval "(() => { const i = document.querySelector('[cmdk-input]'); if (!i) return 'NOINPUT'; const sel = document.querySelector('[cmdk-item][aria-selected=\"true\"]'); if (!sel) return 'NOSEL'; i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true })); return 'OK::tab-dispatched' })()" 'OK::' >/dev/null || g1_fail "Tab 派发失败（cmdk input 缺失或无选中项）"
sleep 1.2

# —— 24. ConsoleBar input 填充断言（dispatchFillCmd → FILL_CMD_EVENT → input.value）——
filled=$(g1_eval "(() => { const i = document.querySelector('input[placeholder*=\"load 4hhb\"]'); if (!i) return 'MISS::noinput'; return i.value === 'orient' ? 'OK::filled' : 'MISS::' + JSON.stringify(i.value) })()" 'OK::') || g1_fail "Tab 填充失败（ConsoleBar input 值非 orient：${filled}）"
echo "  Tab 填充闭环（palette Tab → ConsoleBar input='orient'）"
echo "== G1d Tab 填充链 PASS =="

# —— 25. console 错误检查（全程零新错）——
errs=$(agent-browser errors 2>/dev/null | tr -d '\n')
if [ -n "$errs" ] && [ "$errs" != "[]" ]; then
  echo "  console errors 非空：${errs:0:200}"
  g1_fail "G1 全程出现 console 错误"
fi
echo "  console 零错误"

# —— 26. 现场恢复：provider 默认回 zai + pins/历史清空 + 浏览器关闭 ——
curl -s --max-time 5 -X POST http://localhost:3000/api/agent/providers -H 'Content-Type: application/json' \
  -d '{"providerId":"zai","setDefault":true}' >/dev/null
prov2=$(curl -s --max-time 5 http://localhost:3000/api/agent/providers | python3 -c "import json,sys; print(json.load(sys.stdin).get('defaultProvider','?'))" 2>/dev/null)
[ "$prov2" = "zai" ] || g1_fail "现场恢复失败（defaultProvider=$prov2，应为 zai）"
agent-browser eval "(() => { localStorage.removeItem('molvision-pinned-jumps'); localStorage.removeItem('molvision-cmd-history'); return 'CLEARED' })()" >/dev/null 2>&1
agent-browser close >/dev/null 2>&1
echo "  现场恢复完成（provider=zai · pins/历史清空 · 浏览器关闭）"

echo "== G1 PASS（试穿 + 柔性技能 + 折叠收纳 + Tab 填充 四链全过）=="
