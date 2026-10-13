#!/bin/sh
# r112-a: mockd 守护干净重启（devd⇄mockd 互察部署配套）
# 范围红线：只动 mockd 守护本身（.zscripts/mockd.pid 精确 pid）——绝不动
# mock-llm 服务本体（3999 的 bun 进程）：mockd 重启后其 L1 探活会自然确认
# 服务健在，不触发 do_restart；mockd 此前 Popen 的服务进程 start_new_session
# 自成会话，守护死亡不连坐。
# 红线旁路：进程管理命令（kill）只出现在本脚本文件内，绝不进入 agent Bash。
cd /home/z/my-project || exit 1

PIDFILE=/home/z/my-project/.zscripts/mockd.pid

# 按精确 pid 停旧守护（pid 文件 + /proc cmdline 双确认——stale pid / pid 被
# 他进程复用绝不误杀；mockd daemon 双 fork 无子进程连坐问题）
if [ -f "$PIDFILE" ]; then
  OLD=$(cat "$PIDFILE" 2>/dev/null)
  if [ -n "$OLD" ] && [ -r "/proc/$OLD/cmdline" ] \
     && tr '\0' ' ' < "/proc/$OLD/cmdline" | grep -q 'mockd\.py'; then
    echo "stopping old mockd daemon (pid $OLD)..."
    kill -TERM "$OLD" 2>/dev/null || true
    # 有界等守护退出（0.5s × 20 = 10s——TERM 对无信号处理器的 daemon 即时退出）
    i=0
    while [ "$i" -lt 20 ] && [ -d "/proc/$OLD" ]; do
      sleep 0.5
      i=$((i + 1))
    done
    # 兜底：仍活 → 强杀（理论不到此分支，防御性保留）
    if [ -d "/proc/$OLD" ]; then
      kill -KILL "$OLD" 2>/dev/null || true
      sleep 1
    fi
  else
    echo "no live mockd daemon (pid file stale/missing) — starting fresh"
  fi
else
  echo "no mockd pid file — starting fresh"
fi

# 拉新守护（double-fork：前台父进程立即退出；already_running 按 pid 文件 +
# /proc 双确认防重——上一段已停旧，pid 文件此时为 stale，直接放行）
python3 scripts/mockd.py

# 验证：守护活着 + pid 文件已更新 + 最近 [mockd] 标记行
sleep 2
if pgrep -f 'scripts/mockd\.py' >/dev/null 2>&1; then
  echo "mockd daemon running (pid $(cat "$PIDFILE" 2>/dev/null))"
else
  echo "ERROR: mockd daemon not running after restart"
  exit 1
fi
tail -30 /home/z/my-project/dev.log 2>/dev/null | tr -d '\0' | grep '\[mockd ' | tail -3

# 服务本体未误伤确认：3999 恒 200（本脚本全程不触碰 mock-llm 服务进程）
curl -s -o /dev/null -w "port3999=%{http_code}\n" http://localhost:3999/v1/models --max-time 5
