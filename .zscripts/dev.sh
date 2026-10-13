#!/bin/bash

set -euo pipefail

# 获取脚本所在目录（.zscripts）
# 使用 $0 获取脚本路径（与 build.sh 保持一致）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

log_step_start() {
        local step_name="$1"
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting: $step_name"
        echo "=========================================="
        export STEP_START_TIME
        STEP_START_TIME=$(date +%s)
}

log_step_end() {
        local step_name="${1:-Unknown step}"
        local end_time
        end_time=$(date +%s)
        local duration=$((end_time - STEP_START_TIME))
        echo "=========================================="
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Completed: $step_name"
        echo "[LOG] Step: $step_name | Duration: ${duration}s"
        echo "=========================================="
        echo ""
}

start_mini_services() {
        local mini_services_dir="$PROJECT_DIR/mini-services"
        local started_count=0

        log_step_start "Starting mini-services"
        if [ ! -d "$mini_services_dir" ]; then
                echo "Mini-services directory not found, skipping..."
                log_step_end "Starting mini-services"
                return 0
        fi

        echo "Found mini-services directory, scanning for sub-services..."

        for service_dir in "$mini_services_dir"/*; do
                if [ ! -d "$service_dir" ]; then
                        continue
                fi

                local service_name
                service_name=$(basename "$service_dir")
                echo "Checking service: $service_name"

                if [ ! -f "$service_dir/package.json" ]; then
                        echo "[$service_name] No package.json found, skipping..."
                        continue
                fi

                if ! grep -q '"dev"' "$service_dir/package.json"; then
                        echo "[$service_name] No dev script found, skipping..."
                        continue
                fi

                echo "Starting $service_name in background..."
                (
                        cd "$service_dir"
                        echo "[$service_name] Installing dependencies..."
                        bun install
                        echo "[$service_name] Running bun run dev..."
                        exec bun run dev
                ) >"$PROJECT_DIR/.zscripts/mini-service-${service_name}.log" 2>&1 &

                local service_pid=$!
                echo "[$service_name] Started in background (PID: $service_pid)"
                echo "[$service_name] Log: $PROJECT_DIR/.zscripts/mini-service-${service_name}.log"
                disown "$service_pid" 2>/dev/null || true
                started_count=$((started_count + 1))
        done

        echo "Mini-services startup completed. Started $started_count service(s)."
        log_step_end "Starting mini-services"
}

wait_for_service() {
        local host="$1"
        local port="$2"
        local service_name="$3"
        local max_attempts="${4:-60}"
        local attempt=1

        echo "Waiting for $service_name to be ready on $host:$port..."

        while [ "$attempt" -le "$max_attempts" ]; do
                if curl -s --connect-timeout 2 --max-time 5 "http://$host:$port" >/dev/null 2>&1; then
                        echo "$service_name is ready!"
                        return 0
                fi

                echo "Attempt $attempt/$max_attempts: $service_name not ready yet, waiting..."
                sleep 1
                attempt=$((attempt + 1))
        done

        echo "ERROR: $service_name failed to start within $max_attempts seconds"
        return 1
}

cleanup() {
        if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
                echo "Stopping Next.js dev server (PID: $DEV_PID)..."
                kill "$DEV_PID" >/dev/null 2>&1 || true
        fi
}

trap cleanup EXIT INT TERM

cd "$PROJECT_DIR"

if ! command -v bun >/dev/null 2>&1; then
        echo "ERROR: bun is not installed or not in PATH"
        exit 1
fi

log_step_start "bun install"
echo "[BUN] Installing dependencies..."
bun install
log_step_end "bun install"

log_step_start "bun run db:push"
echo "[BUN] Setting up database..."
bun run db:push
log_step_end "bun run db:push"

log_step_start "Starting Next.js dev server"
# r112-a：经 devd 守护启动（不再直接 bun run dev）——devd 自会 spawn
# `bunx next dev -p 3000` 并接管日志到 dev.log（spawn_server 不走 package.json
# 内嵌的 `| tee dev.log`，等价输出且避免 tee O_TRUNC 与守护 O_APPEND 双写交错）；
# devd 前台父进程 double-fork 后立即退出，无需 & ；若 3000 已有活实例
# （沙箱重启后环境先直起 dev server），devd 采纳模式收养监护零中断
python3 "$PROJECT_DIR/scripts/devd.py"
log_step_end "Starting Next.js dev server"

log_step_start "Waiting for Next.js dev server"
wait_for_service "localhost" "3000" "Next.js dev server"
log_step_end "Waiting for Next.js dev server"

log_step_start "Health check"
echo "[BUN] Performing health check..."
curl -fsS localhost:3000 >/dev/null
echo "[BUN] Health check passed"
log_step_end "Health check"

start_mini_services

log_step_start "Starting daemons"
# r112-a：启动链带起双守护——devd 已在上一步拉起；此处再显式拉起 mockd
# （幂等：mockd.py already_running 按 pid 文件 + /proc 双确认防重，重复执行
# 零副作用）。沙箱若走 dev.sh 链重启，双守护不再缺席（r110/r111 建议②）
python3 "$PROJECT_DIR/scripts/mockd.py"
log_step_end "Starting daemons"

echo "Next.js dev server is supervised by devd (see [devd] lines in dev.log)."
echo "mock-llm is supervised by mockd (see [mockd] lines in dev.log)."
