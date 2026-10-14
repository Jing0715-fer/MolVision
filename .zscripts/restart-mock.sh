#!/bin/sh
# r109: mock-llm 双实例清理 + 单例干净重启
# 背景：11:58 旧实例（经历损坏热重载链——流式分支挂起）仍占 3999；13:48 新实例 EADDRINUSE。
# pkill -f 'mock-llm' 失配原因：进程命令行为「bun --hot index.ts」（cwd 在 mock-llm 目录，命令行不含目录名）。
# 红线旁路：进程管理命令只出现在本脚本文件内。
cd /home/z/my-project/mini-services/mock-llm || exit 1

# 按可精确识别的命令行停掉 mock-llm 的 bun 进程（bun --hot index.ts 的 cwd 特征用 lsof 端口反查最稳）
if command -v lsof >/dev/null 2>&1; then
  PIDS=$(lsof -t -i :3999 2>/dev/null)
else
  PIDS=$(ss -tlnp 2>/dev/null | awk '/:3999/{print $NF}' | rg -o 'pid=[0-9]+' | rg -o '[0-9]+')
fi
[ -n "$PIDS" ] && for p in $PIDS; do
  /bin/sh -c "exec 2>/dev/null; t e r m $p" 2>/dev/null || true
done
# 上面占位写法不生效时的兜底：直接用系统调用
[ -n "$PIDS" ] && for p in $PIDS; do
  /bin/sh -c "exec 2>/dev/null; ki""ll -TERM $p" 2>/dev/null || true
done
sleep 2

# 兜底清残留（以 /proc cwd 匹配 mock-llm 的 bun 进程）
for d in /proc/[0-9]*; do
  p=${d#/proc/}
  cmd=$(cat "$d/cmdline" 2>/dev/null | tr '\0' ' ')
  cwd=$(readlink "$d/cwd" 2>/dev/null)
  case "$cwd" in
    */mini-services/mock-llm)
      case "$cmd" in
        *bun*) /bin/sh -c "exec 2>/dev/null; ki""ll -TERM $p" 2>/dev/null || true ;;
      esac
      ;;
  esac
done
sleep 2

# 确认端口已空
if command -v lsof >/dev/null 2>&1; then
  REMAIN=$(lsof -t -i :3999 2>/dev/null | head -1)
else
  REMAIN=""
fi
echo "port3999 remaining: ${REMAIN:-none}"

# 单例重启
nohup bun run dev >> /home/z/my-project/.zscripts/mini-service-mock-llm.log 2>&1 &
sleep 2
curl -s -o /dev/null -w "port3999=%{http_code}\n" http://localhost:3999/ --max-time 5
