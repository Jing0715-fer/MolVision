#!/usr/bin/env python3
"""mockd.py — mock-llm（mini-services/mock-llm :3999）守护进程（r110-a）

背景（r109 实测 40 分钟人工取证的教训）：
  mock-llm 经历编辑期 mid-write 热重载后进入「实例级损坏」态——非流式 200 正常、
  流式挂起只吐 1/3 内容无 [DONE] 尾。devd 看门狗只看 3000 端口 dev server，
  mock-llm 损坏/静默死亡无人自愈，r109 E2E 期两次 generation interrupted 全靠
  人工系统级取证 + 单例重启（.zscripts/restart-mock.sh）修复。

本守护解决四件事：
  1) 两级探活——L1 轻探（GET /v1/models：任何 HTTP 响应即活，含 404——探的是
     HTTP 层存活而非业务正确性；30s 周期）；L2 流式探针（POST /v1/chat/completions
     stream:true，断言响应流含 [DONE] 尾——正是 r109 损坏态「非流式正常流式挂起」
     的表形态探针；120s 周期，仅 L1 活时才跑——死了没意义，L1 路径自会处置）；
  2) 失败处置——L1 连续 3 败（死亡/僵死，90s 内发现）或 L2 连续 2 败（热重载损坏
     态，~4 分钟内发现）触发单例重启：lsof 端口反查清旧（r109 教训：进程命令行
     「bun --hot index.ts」不含目录名，按目录名 pkill -f 失配——端口反查最稳）
     → /proc cwd 兜底清残留 → 有界等端口释放（SIGKILL 兜底）→ Popen
     bun run dev（start_new_session 脱离会话回收）→ 有界等 L1 探活成功；
  3) 重启风暴防护——1 小时滚动窗内 ≥3 次重启则退避 30 分钟（退避期只探活记日志
     不重启；计数同时清零，防退避结束瞬间凭旧计数立即重启）；
  4) r111-a 源码变更即时验证——主循环从 30s 粗粒度改为 1s 小步进，每秒比对
     mini-services/mock-llm/index.ts 的 mtime：变更即立即 L2 探针（留 1s 热重载
     完成宽限）；失败再等 3s 复验一次（热重载可能仍在途）；仍失败才重启——
     mid-write 热重载损坏的自愈从「L2 周期发现」的 ~2min15s 缩到 ~5s（r110 两次
     实战自愈的响应加速；正常编辑 L2 通过零动作只记日志，不误杀）；
  5) r112-a 互察 devd——主循环每 60s 检查 devd 存活（.zscripts/devd.pid +
     /proc cmdline 双确认，pid 文件缺失/失效时回退 /proc 扫描）：死亡则日志
     报警 + Popen 拉起 devd.py（其采纳模式使这次拉起有实际意义——收养运行中
     的 dev server，零中断）；存活不打扰（devd 侧已有 mockd ok 低频汇总行，
     此处零日志防双倍噪音）——「守护的守护」盲区（r110/r111 建议②）闭环。

与 devd.py 的关系：独立守护而非 devd 增分支（对 r109 建议①的实现路径修正）——
  替换运行中的 devd 必须中断 dev server（守护链整体重启），独立进程零中断部署；
  职责分离（devd 管 next dev :3000，mockd 管 mock-llm :3999），double-fork
  范式与 devd.py 同源；r112-a 起两守护互察（devd 每 ≈5min 查 mockd 并低频
  汇总，mockd 每 60s 查 devd 只在死亡事件打点——频率不对称因 mockd 主循环
  本就是 1s 粒度，60s 检查零额外成本）。

用法：python3 scripts/mockd.py   （前台父进程立即退出，守护转入后台）
日志：/home/z/my-project/dev.log（[mockd HH:MM:SS] 标记行——与 [devd] 前缀区分）
      + mock 服务自身日志 .zscripts/mini-service-mock-llm.log（Popen 重定向）
pid：.zscripts/mockd.pid（防双实例：启动前发现活 mockd 进程即静默退出）
"""
import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

PROJECT = "/home/z/my-project"
MOCK_DIR = os.path.join(PROJECT, "mini-services", "mock-llm")
LOG = os.path.join(PROJECT, "dev.log")
MOCK_LOG = os.path.join(PROJECT, ".zscripts", "mini-service-mock-llm.log")
PID_FILE = os.path.join(PROJECT, ".zscripts", "mockd.pid")
BASE = "http://127.0.0.1:3999"

CHECK_S = 30          # L1 轻探周期（秒）
L2_EVERY = 120        # L2 流探周期（秒）——r111-a 起主循环 1s 粒度，改按秒数直接计量
L1_FAILS_RESTART = 3  # L1 连续 3 败 → 重启（90s 内发现死亡）
L2_FAILS_RESTART = 2  # L2 连续 2 败 → 重启（~4 分钟内发现损坏态）
L1_TIMEOUT_S = 4      # 轻探超时（正常毫秒级；4s 都不通 = HTTP 层死）
L2_TIMEOUT_S = 12     # 流探超时（正常 ~150ms；损坏态挂起 12s 判死——idleTimeout 30s 前）
RESTART_WINDOW_S = 3600  # 重启风暴防护：1 小时滚动窗
RESTART_MAX_IN_WINDOW = 3
BACKOFF_S = 1800      # 窗内达上限后的退避时长（30 分钟）
WATCH_TICK_S = 1      # r111-a：主循环粒度（源码 mtime 检测分辨率）
HOT_RELOAD_GRACE_S = 1.0  # r111-a：检测到变更后留给 bun --hot 完成热重载的宽限
EDIT_RETRY_S = 3.0    # r111-a：变更后首验失败到复验的间隔（热重载仍在途的窗口）
# r112-a 互察 devd：devd 的 pid 文件（读 pid + /proc cmdline 双确认；pid 文件
# 缺失/失效时回退 /proc 扫描——pid 文件丢失不能误判「devd 死亡」触发拉起）
DEVD_PID_FILE = os.path.join(PROJECT, ".zscripts", "devd.pid")
# r112-a 互察周期：主循环 1s 粒度下每 60s 查一次 devd 存活（devd 死亡 ≤60s
# 内发现并拉起；存活零动作零日志——防与 devd 侧 mockd ok 行双倍噪音）
DEVD_CHECK_S = 60


def stamp() -> str:
    return time.strftime("%H:%M:%S")


def log_line(text: str) -> None:
    """以追加模式向 dev.log 落一行 [mockd] 标记行（与 devd 的 [devd] 前缀区分）。"""
    with open(LOG, "ab", buffering=0) as lf:
        lf.write(f"\n[mockd {stamp()}] {text}\n".encode())


# ---------------- 探活（模块级函数——不启守护可单测） ----------------

def mock_l1_alive() -> bool:
    """L1 轻探：GET /v1/models——任何 HTTP 响应（含 404/401）都证明 HTTP 层活着。
    探的是「有活监听者且能应答」，业务正确性归 L2。连接层异常（拒绝/超时）才判死。"""
    try:
        with urllib.request.urlopen(f"{BASE}/v1/models", timeout=L1_TIMEOUT_S) as resp:
            resp.read(256)
            return True
    except urllib.error.HTTPError:
        return True  # 404 等非 2xx 也是活（r109 口径：404 是合法形态）
    except Exception:
        return False


def mock_l2_stream_ok() -> bool:
    """L2 流式探针：POST /v1/chat/completions stream:true，断言流尾含 [DONE]。
    r109 实测损坏态表形态：非流式 200 正常 + 流式挂起只吐部分内容无 [DONE]——
    该探针正是为这一形态设计的（L1 看不见它）。正常路径 ~150ms（1 role 帧 +
    3 内容帧 ×40ms + stop + [DONE]）。读上限 64KB（mock 决策 JSON 很短）。"""
    payload = json.dumps({
        "model": "mock-model",
        "messages": [{"role": "user", "content": "ping"}],
        "stream": True,
    }).encode()
    req = urllib.request.Request(
        f"{BASE}/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=L2_TIMEOUT_S) as resp:
            body = resp.read(65536).decode("utf-8", "replace")
            return "data: [DONE]" in body
    except Exception:
        return False


def mock_source_mtime() -> float | None:
    """r111-a：被守护源文件的 mtime（不存在/不可读返回 None——视为无可监听）。"""
    try:
        return os.stat(os.path.join(MOCK_DIR, "index.ts")).st_mtime
    except OSError:
        return None


# ---------------- 重启（复用 .zscripts/restart-mock.sh 的清理逻辑，移植为 Python） ----------------

def _port_pids(port: int) -> list[int]:
    """lsof 端口反查占者 pid（r109 教训：命令行「bun --hot index.ts」不含目录名，
    按目录名 pkill -f 失配——端口反查最稳）；lsof 缺失时 ss 兜底解析。"""
    pids: list[int] = []
    try:
        out = subprocess.run(
            ["lsof", "-t", "-i", f":{port}"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        pids = [int(x) for x in out.split() if x.isdigit()]
    except Exception:
        pass
    if not pids:
        try:
            out = subprocess.run(
                ["ss", "-tlnp"],
                capture_output=True, text=True, timeout=5,
            ).stdout
            for line in out.splitlines():
                if f":{port} " in line:
                    for tok in line.replace("=", " ").split():
                        if tok.startswith("pid") and tok[3:].isdigit():
                            pids.append(int(tok[3:]))
        except Exception:
            pass
    return sorted(set(pids))


def _cwd_pids() -> list[int]:
    """/proc cwd 兜底：cwd == MOCK_DIR 且 cmdline 含 bun 的进程（端口反查漏网者）。"""
    pids: list[int] = []
    try:
        for d in os.listdir("/proc"):
            if not d.isdigit():
                continue
            try:
                if os.readlink(f"/proc/{d}/cwd") != MOCK_DIR:
                    continue
                with open(f"/proc/{d}/cmdline", "rb") as f:
                    cmd = f.read().replace(b"\0", b" ").decode("utf-8", "replace")
                if "bun" in cmd:
                    pids.append(int(d))
            except OSError:
                continue
    except OSError:
        pass
    return pids


def _term(pids: list[int]) -> None:
    me = os.getpid()
    for pid in pids:
        if pid == me:
            continue
        try:
            os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            pass


def mock_restart() -> bool:
    """单例重启全流程：清旧（TERM → 有界等端口释放 → KILL 兜底）→ 拉起 → 等活。"""
    _term(_port_pids(3999))
    _term(_cwd_pids())
    time.sleep(2)
    # 有界等端口释放（0.5s × 30 ≈ 15s——devd r102-b 同款：D 态进程 socket 迟滞）
    for _ in range(30):
        if not _port_pids(3999):
            break
        time.sleep(0.5)
    else:
        # SIGKILL 兜底（TERM 挂起不退的顽固残留）+ 再等 10s
        for pid in _port_pids(3999):
            try:
                os.kill(pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                pass
        for _ in range(20):
            if not _port_pids(3999):
                break
            time.sleep(0.5)
    logf = open(MOCK_LOG, "ab", buffering=0)
    try:
        subprocess.Popen(
            ["bun", "run", "dev"],
            cwd=MOCK_DIR,
            stdin=subprocess.DEVNULL,
            stdout=logf,
            stderr=subprocess.STDOUT,
            start_new_session=True,  # 自成会话：守护死亡不连坐 mock 进程
        )
    finally:
        logf.close()
    # 有界等 L1 活（1s × 20 = 20s：bun 冷启 ~1s，留足余量）
    for _ in range(20):
        time.sleep(1)
        if mock_l1_alive():
            return True
    return False


# ---------------- 守护主体 ----------------

def daemonize() -> None:
    """经典 double-fork 脱离（devd.py 同源范式）：独立会话 + 无控制终端。"""
    pid = os.fork()
    if pid > 0:
        sys.exit(0)
    os.setsid()
    pid = os.fork()
    if pid > 0:
        sys.exit(0)
    os.umask(0o022)
    fd = os.open(os.devnull, os.O_RDWR)
    for target in (0, 1, 2):
        os.dup2(fd, target)
    if fd > 2:
        os.close(fd)


def already_running() -> bool:
    """pid 文件 + /proc cmdline 双确认的防双实例（pid 复用误判防护：cmdline 须含 mockd）。"""
    try:
        with open(PID_FILE) as f:
            pid = int(f.read().strip())
        if pid == os.getpid():
            return False
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read().replace(b"\0", b" ").decode("utf-8", "replace")
        return "mockd" in cmd
    except (OSError, ValueError):
        return False


def devd_pid() -> int | None:
    """r112-a 互察：查 devd 的 pid（pid 文件 + /proc cmdline 双确认优先，
    pid 文件缺失/失效时回退 /proc 扫描；None = 不在跑）。

    兜底理由与 mockd_pid 对称：pid 文件丢失不能误判「devd 死亡」——
    /proc cmdline 扫描是第二道事实源（devd 若真在跑必能扫到）。"""
    try:
        with open(DEVD_PID_FILE) as f:
            pid = int(f.read().strip())
        with open(f"/proc/{pid}/cmdline", "rb") as f:
            cmd = f.read().replace(b"\0", b" ").decode("utf-8", "replace")
        if "devd.py" in cmd:
            return pid
    except (OSError, ValueError):
        pass
    try:
        for d in os.listdir("/proc"):
            if not d.isdigit():
                continue
            try:
                with open(f"/proc/{d}/cmdline", "rb") as f:
                    cmd = f.read().replace(b"\0", b" ").decode("utf-8", "replace")
            except OSError:
                continue
            if "devd.py" in cmd:
                return int(d)
    except OSError:
        pass
    return None


_devd_child: subprocess.Popen | None = None


def check_devd() -> None:
    """r112-a 互察（主循环每 DEVD_CHECK_S 秒调用）：devd 死亡 → 日志报警 +
    Popen 拉起 devd.py——其采纳模式使这次拉起有实际意义（收养运行中的
    dev server，零中断；端口空则直接 spawn 自有实例）；存活不打扰（零日志
    ——devd 侧已有 mockd ok 低频汇总行，双份噪音无益）。

    直接子进程是 devd 的 double-fork 前台父进程（秒级退出）——保留 Popen
    句柄在下一次检查时 poll 收尸，避免僵尸累积。stdout 重定向到 dev.log
    （追加）：devd 启动期若崩溃，traceback 落 dev.log 可查。"""
    global _devd_child
    if _devd_child is not None:
        _devd_child.poll()  # 收上次拉起父进程的尸（若已退出）
    pid = devd_pid()
    if pid is None:
        log_line("devd dead; relaunching")
        logf = open(LOG, "ab", buffering=0)
        try:
            _devd_child = subprocess.Popen(
                ["python3", "scripts/devd.py"],
                cwd=PROJECT,
                stdin=subprocess.DEVNULL,
                stdout=logf,
                stderr=subprocess.STDOUT,
                start_new_session=True,  # 自成会话：本守护死亡不连坐 devd
            )
        finally:
            logf.close()
        log_line(f"devd relaunch child pid={_devd_child.pid}")


def main() -> None:
    if already_running():
        return  # 绝不双守护（双重启互踩 + 日志双写交错）
    daemonize()
    with open(PID_FILE, "w") as f:
        f.write(str(os.getpid()))
    log_line("daemon up (double-fork); supervising mock-llm :3999 (L1 30s / L2 120s / watch 1s)")

    def do_restart(reason: str, l1_streak: int, l2_streak: int,
                   restarts: list[float], backoff_until: float) -> float:
        """统一重启路径（周期性失败 / 编辑后验证失败共用）：返回新的 backoff_until。"""
        now = time.time()
        if now < backoff_until:
            log_line(f"unhealthy but in restart backoff (storm guard): {reason}; counters reset")
            return backoff_until
        log_line(f"restart triggered ({reason}; L1 streak {l1_streak} / L2 streak {l2_streak})")
        ok = mock_restart()
        restarts[:] = [t for t in restarts if t > now - RESTART_WINDOW_S]
        restarts.append(now)
        log_line(f"single-instance restart {'ok (L1 alive)' if ok else 'FAILED (L1 still dead)'}")
        if len(restarts) >= RESTART_MAX_IN_WINDOW:
            backoff_until = now + BACKOFF_S
            log_line(f"{len(restarts)} restarts within 1h window — backoff {BACKOFF_S}s (probe-only)")
        return backoff_until

    l1_fails = 0
    l2_fails = 0
    elapsed = 0  # r111-a：主循环秒数（1s 粒度小步进——mtime 检测分辨率）
    last_mtime = mock_source_mtime()
    restarts: list[float] = []  # 1h 滚动窗内的重启时间戳
    backoff_until = 0.0
    while True:
        time.sleep(WATCH_TICK_S)
        elapsed += WATCH_TICK_S
        # ---- r112-a 互察 devd（每 60s：死亡则拉起——其采纳模式收养运行中的
        #      dev server；存活零动作零日志，防与 devd 侧汇总行双倍噪音）----
        if elapsed % DEVD_CHECK_S == 0:
            check_devd()
        # ---- r111-a 源码变更即时验证（每秒比对 mtime）----
        mtime = mock_source_mtime()
        if mtime is not None and mtime != last_mtime:
            last_mtime = mtime
            log_line("source change detected — immediate L2 probe")
            time.sleep(HOT_RELOAD_GRACE_S)  # 留给 bun --hot 完成热重载
            if mock_l2_stream_ok():
                log_line("L2 ok after hot-reload — no action")
                l2_fails = 0
            else:
                time.sleep(EDIT_RETRY_S)  # 热重载可能仍在途——复验一次再定罪
                if mock_l2_stream_ok():
                    log_line("L2 recovered after edit retry — no action")
                    l2_fails = 0
                else:
                    log_line("L2 still failing after edit — treating as mid-write reload corruption")
                    backoff_until = do_restart(
                        "edit verify failed", l1_fails, l2_fails, restarts, backoff_until)
                    l1_fails = l2_fails = 0
                    continue
        # ---- 周期性探活（秒数计量——与原 tick 语义等价）----
        if elapsed % CHECK_S == 0:
            if mock_l1_alive():
                l1_fails = 0
                if elapsed % L2_EVERY == 0:
                    if mock_l2_stream_ok():
                        l2_fails = 0
                    else:
                        l2_fails += 1
                        log_line(f"L2 stream probe failed (streak {l2_fails}) — no [DONE] tail")
            else:
                l1_fails += 1
            if l1_fails >= L1_FAILS_RESTART or l2_fails >= L2_FAILS_RESTART:
                backoff_until = do_restart(
                    f"probe streaks (L1 {l1_fails}/L2 {l2_fails})", l1_fails, l2_fails,
                    restarts, backoff_until)
                l1_fails = l2_fails = 0


if __name__ == "__main__":
    main()
