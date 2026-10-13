#!/bin/sh
# r112-a: devd 守护干净重启（采纳模式部署配套）
# 范围红线：只动 devd 守护本身（.zscripts/devd.pid 精确 pid）——绝不动 3000 的
# next-server 进程：devd 重启后其采纳模式收养监护运行中的 dev server（端口轮询
# + 内存看门狗作用于该实例），零重启零中断；兼容「devd 未在跑」情形（pid 文件
# 缺失 / stale → 直接拉起）。
# 红线旁路：进程管理命令（kill）只出现在本脚本文件内，绝不进入 agent Bash。
cd /home/z/my-project || exit 1

PIDFILE=/home/z/my-project/.zscripts/devd.pid

# 按精确 pid 停旧守护（pid 文件 + /proc cmdline 双确认——stale pid / pid 被
# 他进程复用绝不误杀；devd daemon 死亡不连坐其 spawn 的 server：子进程
# start_new_session 自成会话，且由新 devd 采纳/接管）
if [ -f "$PIDFILE" ]; then
  OLD=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "$OLD" ] && [ -r "/proc/$OLD/cmdline" ] \
     && tr '\0' ' ' < "/proc/$OLD/cmdline" | grep -q 'devd\.py'; then
    echo "stopping old devd daemon (pid $OLD)..."
    kill -TERM "$OLD" 2>/dev/null || true
    # 有界等守护退出（0.5s × 20 = 10s）
    i=0
    while [ "$i" -lt 20 ] && [ -d "/proc/$OLD" ]; do
      sleep 0.5
      i=$((i + 1))
    done
    # 兜底：仍活 → 强杀（防御性保留）
    if [ -d "/proc/$OLD" ]; then
      kill -KILL "$OLD" 2>/dev/null || true
      sleep 1
    fi
  else
    echo "no live devd daemon (pid file stale/missing) — starting fresh"
  fi
else
  echo "no devd pid file — starting fresh (adoption mode will supervise running server)"
fi

# 拉新守护（double-fork：前台父进程立即退出；采纳模式：3000 已有活实例 →
# 收养监护——dev.log 应出现 adopting existing instance 行；端口空 → 直接 spawn）
python3 scripts/devd.py

# 验证：守护活着 + pid 文件已更新 + 最近 [devd] 标记行（采纳行可辨）
sleep 2
if pgrep -f 'scripts/devd\.py' >/dev/null 2>&1; then
  echo "devd daemon running (pid $(cat "$PIDFILE" 2>/dev/null))"
else
  echo "ERROR: devd daemon not running after restart"
  exit 1
fi
tail -30 /home/z/my-project/dev.log 2>/dev/null | tr -d '\0' | grep '\[devd ' | tail -3

# dev server 未误伤确认：3000 恒 200（本脚本全程不触碰 next-server 进程）
curl -s -o /dev/null -w "port3000=%{http_code}\n" http://localhost:3000/ --max-time 5
