#!/usr/bin/env python3
"""devd.py — Next.js dev server 守护进程（r88 热修）

背景（r88 根因）：
  dmesg 实锤 next-server(pid 1535) 被 OOM-killer 静默击杀
  （anon-rss≈1.67GB，dev.log 无 error 直接停更）——3000 端口失守，
  用户页面加载不出来。此前已知：bash setsid/nohup 拉起的进程会被
  会话回收（worklog r8x 判例），故须 Python double-fork 脱离。

本守护进程解决两个问题：
  1) 脱离 agent bash 会话存活（double-fork + setsid）；
  2) 子进程死亡（含再次 OOM）后 3s 自动重启（dev.log 落 [devd] 标记行）。

防双实例：
  - 启动前若 3000 已被监听 → 守护静默退出（不与存量实例打架）；
  - 重启间隙若端口被其他实例抢占 → 守护退出（避免 EADDRINUSE 循环拉起）。

用法：python3 scripts/devd.py   （前台父进程立即退出，守护转入后台）
日志：/home/z/my-project/dev.log（追加；调用方可在启动前自行截断）
"""
import os
import sys
import time
import socket
import subprocess

PROJECT = "/home/z/my-project"
LOG = os.path.join(PROJECT, "dev.log")
PORT = 3000
RESTART_DELAY_S = 3


def port_alive(port: int) -> bool:
    """探测 127.0.0.1:port 是否可建立连接（即有活监听者）。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    try:
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def daemonize() -> None:
    """经典 double-fork 脱离：独立会话 + 无控制终端 + stdio 归 /dev/null。"""
    pid = os.fork()
    if pid > 0:
        sys.exit(0)  # 亲代退出，子代由 init 收养
    os.setsid()
    pid = os.fork()
    if pid > 0:
        sys.exit(0)  # 二次 fork 确保永远无法重获控制终端
    os.umask(0o022)
    fd = os.open(os.devnull, os.O_RDWR)
    for target in (0, 1, 2):
        os.dup2(fd, target)
    if fd > 2:
        os.close(fd)


def stamp() -> str:
    return time.strftime("%H:%M:%S")


def log_line(text: str) -> None:
    """以追加模式向 dev.log 落一行守护标记（每次独立打开，避免长持 fd）。"""
    with open(LOG, "ab", buffering=0) as lf:
        lf.write(f"\n[devd {stamp()}] {text}\n".encode())


def spawn_server() -> subprocess.Popen:
    """启动 next dev 并接管其 stdio → dev.log。

    注意：不走 `bun run dev`——其内嵌 `| tee dev.log` 会与本守护的
    重定向双写交错（tee O_TRUNC + 本方 O_APPEND 偏移漂移）。
    直接 bunx next dev 等价且日志单一路径。
    """
    lf = open(LOG, "ab", buffering=0)
    try:
        return subprocess.Popen(
            ["bunx", "next", "dev", "-p", str(PORT)],
            cwd=PROJECT,
            stdin=subprocess.DEVNULL,
            stdout=lf,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # 子进程自成会话，退出不连坐
        )
    finally:
        # Popen 已复制 fd，父侧描述符可安全关闭
        lf.close()


def main() -> None:
    if port_alive(PORT):
        # 已有实例在跑：绝不二次守护（防 EADDRINUSE 循环 + 双写日志）
        return
    daemonize()
    log_line("daemon up (double-fork); supervising next dev -p 3000")
    while True:
        proc = spawn_server()
        log_line(f"spawned next dev pid={proc.pid}")
        code = proc.wait()
        log_line(f"server exited code={code}; restart in {RESTART_DELAY_S}s")
        time.sleep(RESTART_DELAY_S)
        if port_alive(PORT):
            # 死亡间隙端口被外部实例抢占（如手动 next dev）——守护退位
            log_line("port 3000 taken over by external instance; devd exits")
            return
        # 端口空闲 → 循环拉起（OOM 再杀亦秒级自愈）


if __name__ == "__main__":
    main()
