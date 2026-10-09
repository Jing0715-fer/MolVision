#!/usr/bin/env python3
"""devd.py — Next.js dev server 守护进程（r88 热修；r91 内存看门狗升级；r102-b 双竞态修复；r103-b 斜率检测）

背景（r88 根因）：
  dmesg 实锤 next-server(pid 1535) 被 OOM-killer 静默击杀
  （anon-rss≈1.67GB，dev.log 无 error 直接停更）——3000 端口失守，
  用户页面加载不出来。此前已知：bash setsid/nohup 拉起的进程会被
  会话回收（worklog r8x 判例），故须 Python double-fork 脱离。

本守护进程解决四个问题：
  1) 脱离 agent bash 会话存活（double-fork + setsid）；
  2) 子进程死亡（含再次 OOM）后 3s 自动重启（dev.log 落 [devd] 标记行）；
  3) r91 内存看门狗：next-server RSS 超阈值时主动优雅重启——r91 实测
     1.4GB 时已出现 HMR websocket 断连 → 客户端自发整页 reload →
     用户会话丢失被感知为「模板有问题」；提前在 1.3GB 线主动换血，
     避免 OOM 硬杀（SIGKILL 不留日志）与 reload 失稳两个故障态；
  4) r103-b 内存增长斜率检测：绝对阈值对「缓慢爬升」不敏感——r102 实测
     假死发生在 RSS 1259MB（远未触 1500MB 线，等触线时体验已受损）；
     4 分钟窗内 RSS 单调不减且总涨 ≥300MB 即判泄漏嫌疑提前换血，
     与绝对阈值双闸互补。

防双实例：
  - 启动前若 3000 已被监听 → 守护静默退出（不与存量实例打架）；
  - 重启间隙先有界等待旧端口释放（r102-b：SIGKILL 路径的进程可处不可中断
    D 态，监听 socket 内核侧迟滞数秒——单次探测会误判「外部接管」而过早
    退位；0.5s 间隔至多 30 次 ≈15s），仍被占用才判外部实例抢占 → 守护退出
    （避免 EADDRINUSE 循环拉起）。

用法：python3 scripts/devd.py   （前台父进程立即退出，守护转入后台）
日志：/home/z/my-project/dev.log（追加；调用方可在启动前自行截断）
"""
import os
import signal
import sys
import time
import socket
import subprocess

PROJECT = "/home/z/my-project"
LOG = os.path.join(PROJECT, "dev.log")
PORT = 3000
RESTART_DELAY_S = 3
# r91 内存看门狗：OOM 击杀线 ~1.67GB；r91 实测热身稳态 ~1.22GB（.next 热缓存）；
# 1.5GB 阈值 = 稳态 +280MB（异常增长才触发：泄漏/重编译风暴/SSR 洪峰），OOM 线 -170MB
MEM_LIMIT_MB = 1500
MEM_CHECK_S = 30
GRACEFUL_WAIT_S = 12
# r102-b 端口释放有界等待：SIGKILL 路径 stop_proc_group 的 wait 超时后，进程
# 可处不可中断 D 态（大堆内存回收慢），监听 socket 迟滞数秒才释放——重启前
# 轮询等待而非单次判定（0.5s 间隔 × 至多 30 次 ≈ 15s）
PORT_RELEASE_POLL_S = 0.5
PORT_RELEASE_POLLS = 30
# r103-b 斜率检测（r102 建议①的斜率方案）：绝对阈值对「缓慢爬升」不敏感——r102
# 实测假死时 RSS 1259MB 远未触 MEM_LIMIT_MB 线，等触线往往已影响体验；阈值直接
# 下调又有重启风暴风险（dev 编译缓存增长是正常行为）。数值依据：稳态 ~1.22GB +
# 300MB ≈ 1.5GB 与绝对阈值衔接（斜率先行换血、绝对阈值兜底）；4 分钟窗（8 采样
# × 30s 恒定间隔）避开单次路由编译尖峰——尖峰后必有回落，单调不减判定自动否决。
SLOPE_SAMPLES = 8
SLOPE_RISE_MB = 300
SLOPE_FLOOR_MB = 1000


def slope_restart_needed(samples: list[float]) -> tuple[bool, str | None]:
    """r103-b 斜率判定（模块级纯函数——不启进程可测，r102-b import 级测试先例）。

    四条全满足才触发：①窗口满 SLOPE_SAMPLES 个采样；②窗口内 RSS 单调不减
    （允许平顶；容忍 ≤1MB 量测抖动，更显著回落即否决——编译尖峰后的 GC 回落
    正是「正常缓存增长」与「泄漏」的分界）；③窗口总涨幅 ≥ SLOPE_RISE_MB；
    ④最新采样 ≥ SLOPE_FLOOR_MB（低基数噪声防护：热身期 600→950 的爬升属
    正常增长）。返回 (是否触发, 理由串)；理由串即日志行文本——与绝对阈值换血
    的「memory restart」用词区分，事后 grep dev.log 能分清两类换血。
    """
    if len(samples) < SLOPE_SAMPLES:
        return False, None
    window = samples[-SLOPE_SAMPLES:]
    for prev, cur in zip(window, window[1:]):
        if cur < prev - 1.0:  # >1MB 的回落即非单调（相等平顶合法）
            return False, None
    rise = window[-1] - window[0]
    if rise < SLOPE_RISE_MB:
        return False, None
    if window[-1] < SLOPE_FLOOR_MB:
        return False, None
    # 时跨推导：采样间隔恒为 MEM_CHECK_S，8 个采样首尾实际相距 (8-1)×30s=210s
    span_s = (SLOPE_SAMPLES - 1) * MEM_CHECK_S
    return True, (f"rss slope +{rise:.0f}MB over {span_s:.0f}s sustained "
                  "growth (leak suspect); slope restart")


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


def rss_mb(pid: int) -> float:
    """读 /proc/<pid>/status 的 VmRSS（kB→MB）；进程不在则 0。"""
    try:
        with open(f"/proc/{pid}/status", "r") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) / 1024
    except OSError:
        pass
    return 0.0


def server_rss_mb() -> float:
    """找属于本项目的 next-server 进程（bunx 包装器的孙进程）的 RSS。
    扫 /proc/*/comm 匹配 next-server，且要求 readlink /proc/<pid>/cwd ==
    PROJECT 才计入（r102-b cwd 归属过滤）——多项目沙箱下「端口防双实例保证
    全机至多一个」不成立（他项目根可各自跑 next dev），/proc 遍历序不确定时
    首中他项目进程：其 RSS 偏高 → 错杀本项目健康 server（杀完仍超限，重启
    风暴）；其 RSS 偏低 → 漏看本项目真凶（看门狗失明直至 OOM 硬杀）。同项目
    多匹配（罕见孤儿残留）取最大值——看门狗须对本项目任意内存大户敏感。"""
    best = 0.0
    try:
        for d in os.listdir("/proc"):
            if not d.isdigit():
                continue
            try:
                with open(f"/proc/{d}/comm", "r") as f:
                    if not f.read().strip().startswith("next-server"):
                        continue
                if os.readlink(f"/proc/{d}/cwd") != PROJECT:
                    continue  # 他项目 / 外来进程（cwd 不可读者同样跳过）——不计入
            except OSError:
                continue
            mb = rss_mb(int(d))
            if mb > best:
                best = mb
    except OSError:
        pass
    return best


def stop_proc_group(proc: subprocess.Popen) -> None:
    """进程组终止：SIGTERM → 有界等待 → SIGKILL 兕底。
    r91 实测 1.4GB 堆的 next-server 对 SIGTERM 可能挂起不退，必须 SIGKILL 兕底；
    spawn 时 start_new_session=True 使子进程自成进程组（PGID=pid），
    组杀同时清掉 bunx 包装器与 next-server 两个成员。"""
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.wait(timeout=GRACEFUL_WAIT_S)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        pass


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
        # r91 看门狗循环：轮询退出状态 + 周期性内存体检
        mem_restarted = False
        # r103-b 斜率采样窗：只存最近 SLOPE_SAMPLES 个 RSS 值——采样间隔恒为
        # MEM_CHECK_S（循环内 sleep 固定 30s），序列下标即等差时间轴，无需再存
        # 采样时刻；生命周期与 mem_restarted 同届：换血重启与进程死亡两路 break
        # 都回到外层循环，在这里重建空窗（新进程从零观察）。
        rss_window: list[float] = []
        while True:
            code = proc.poll()
            if code is not None:
                break
            time.sleep(MEM_CHECK_S)
            if proc.poll() is not None:
                break
            mb = server_rss_mb()
            rss_window.append(mb)
            del rss_window[:-SLOPE_SAMPLES]  # 滑窗：超出窗长的旧采样出队
            if mb > MEM_LIMIT_MB:
                log_line(f"rss {mb:.0f}MB > {MEM_LIMIT_MB}MB (HMR reload risk); memory restart")
                stop_proc_group(proc)
                mem_restarted = True
                break
            slope_hit, slope_reason = slope_restart_needed(rss_window)
            if slope_hit and slope_reason:
                log_line(slope_reason)
                stop_proc_group(proc)
                mem_restarted = True
                break
        code = proc.poll()
        if mem_restarted:
            log_line(f"memory restart done (code={code}); respawn in {RESTART_DELAY_S}s")
        else:
            log_line(f"server exited code={code}; restart in {RESTART_DELAY_S}s")
        time.sleep(RESTART_DELAY_S)
        # r102-b 端口释放有界等待：SIGKILL 路径 stop_proc_group 的 wait 超时后
        # 端口可能尚未释放（进程处不可中断 D 态，监听 socket 内核侧迟滞数秒）——
        # 旧版单次 port_alive 探测会把迟滞误判「外部接管」而退位（自杀式假阳性：
        # 端口转瞬即空，守护先弃，此后无人拉起）。0.5s 间隔至多 30 次（≈15s）
        # 仍占用才判真外部接管（如手动 next dev）。
        release_polls = 0
        while port_alive(PORT):
            release_polls += 1
            if release_polls > PORT_RELEASE_POLLS:
                log_line(f"port {PORT} still occupied after "
                         f"{PORT_RELEASE_POLLS * PORT_RELEASE_POLL_S:.0f}s "
                         "bounded wait; external takeover; devd exits")
                return
            time.sleep(PORT_RELEASE_POLL_S)
        if release_polls:
            log_line(f"port {PORT} released after "
                     f"{release_polls * PORT_RELEASE_POLL_S:.1f}s "
                     "bounded wait (slow exit path)")
        # 端口空闲 → 循环拉起（OOM 再杀亦秒级自愈；r91 起内存超限、
        # r103-b 起斜率持续增长亦主动换血）


if __name__ == "__main__":
    main()
