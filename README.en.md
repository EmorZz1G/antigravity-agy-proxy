# Antigravity AGY Proxy

English | [简体中文](README.md)

An independently enhanced proxy & resilience extension for Antigravity IDE Remote-SSH environments, supporting both **Antigravity IDE v2.6.0+ (`~/.gemini/bin/agy --hub`)** and **legacy `language_server_linux_*` servers**, with **FakeDNS UDP/FD leak prevention, SSH keepalive hardening, rootless Crontab FD Guard, refactored 9-point diagnostics, and automated troubleshooting**.

---

## Key Features

### 1. Backward Compatibility & Seamless Migration (`agy` v2.6.0+ & Legacy)
- **Antigravity IDE v2.6.0+**: Automatically wraps `~/.gemini/bin/agy` with atomic `.bak` preservation and fast-path bypass for `--version` / `-v`.
- **Legacy servers (pre-v2.6.0)**: Continues supporting `~/.antigravity-ide-server` and `~/.antigravity-server` `language_server_linux_*` (`x86_64` and `arm64`).
- **Seamless Upgrade**: Recognizes legacy `ANTIGRAVITY_SSH_PROXY_WRAPPER` wrappers and `ANTIGRAVITY_SSH_PROXY_FD_GUARD` cron rules, upgrading them cleanly without losing original `.bak` binaries.

### 2. Three Proxy & Resilience Strategies (`antigravity-agy-proxy.proxyMode`)

| Mode (`proxyMode`) | Mechanism | Best For |
|---|---|---|
| **`mgraftcp-no-fakedns` (Default · Recommended)** | `mgraftcp-fakedns` TCP `ptrace` redirection with `--disable-fakedns` + standard proxy env vars | Most servers: intercepts non-proxy-aware subprocesses while completely eliminating FakeDNS UDP `:0` ephemeral port/FD exhaustion |
| **`env-only`** | Pure `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` + `NO_PROXY` env vars without `mgraftcp` | Zero `ptrace` overhead and zero FakeDNS UDP sockets; works well with `http` or `socks5h` |
| **`mgraftcp-fakedns`** | `mgraftcp` TCP proxy + `libdnsredir` FakeDNS + `GODEBUG=netdns=cgo` | Servers with broken/polluted local DNS (recommended to pair with FD Guard) |

### 3. Protocol Support (`http`, `socks5`, `socks5h`)
- **`http`** (default, recommended for Clash/V2Ray)
- **`socks5`** (local DNS)
- **`socks5h`** (remote DNS resolution through the SOCKS5 proxy)

### 4. SSH Tunnel Keepalive
Automatically manages `~/.ssh/config.antigravity` with:
- `RemoteForward <remotePort> 127.0.0.1:<localPort>`
- `ServerAliveInterval 30` & `ServerAliveCountMax 3` to recycle dead tunnels and avoid stale `sshd` port conflicts.

### 5. Rootless Crontab FD Guard
Protects remote hosts against extreme FD or UDP exhaustion via an optional user-level cron job (`enableFdGuard`, `fdGuardIntervalMinutes`, `fdGuardThreshold`):
- Toggle directly in the AGY Proxy panel or via `Antigravity AGY Proxy: Install / Remove FD Guard (Cron)`.
- Installs an idempotent cron rule guarding both `agy.bak` and `language_server_linux*.bak`, logging kills to `$HOME/agy_guard.log`:
  ```bash
  */15 * * * * for pid in $(pgrep -f "(agy\.bak|language_server_linux.*\.bak)"); do cnt=$(ls -f /proc/$pid/fd 2>/dev/null | wc -l); [ "${cnt:-0}" -gt 10000 ] && echo "$(date): killed pid=$pid fds=$cnt" >> $HOME/agy_guard.log && kill -9 $pid; done # ANTIGRAVITY_AGY_PROXY_FD_GUARD
  ```

### 6. Refactored Diagnostics & One-Click Auto Fix
The status panel provides 9 real-time checks:
1. `local-proxy`: Local proxy port reachability
2. `ssh-config`: `~/.ssh/config.antigravity` `RemoteForward` and `ServerAlive*` keepalive rules
3. `remote-forward`: Remote forwarding reachability and listener status
4. `mgraftcp`: Mode-aware `mgraftcp-fakedns` & `libdnsredir` availability
5. `ls-wrapper`: Wrapper & `.bak` sync for `~/.gemini/bin/agy` and legacy `language_server_linux_*`
6. `ls-process`: Active backend PID, persistent mode, duplicate/zombie detection, orphan `mgraftcp` detection, and live FD count
7. `fd-udp-health`: Per-process `/proc/<pid>/fd`, system `/proc/net/udp{,6}` vs `ip_local_port_range`, recent log scanning (`Failed to start FakeDNS`, `too many open files`, `Temporary failure in name resolution`), and FD Guard cron status
8. `dns-resolution`: Direct remote DNS check on Google endpoints with strategy recommendations
9. `external-connectivity`: Parallel tests across `http`, `socks5`, and `socks5h`

**Auto Fix (`antigravity-agy-proxy.autoFix`)**:
- Terminates runaway FD, duplicate, or orphan backend / `mgraftcp` processes
- Switches away from `mgraftcp-fakedns` when FakeDNS/UDP exhaustion is detected
- Auto-switches failing protocols when an alternative (`HTTP`, `SOCKS5H`, `SOCKS5`) succeeds
- Installs FD Guard cron when enabled or after leak remediation and re-syncs wrappers

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `antigravity-agy-proxy.enableLocalForwarding` | `true` | Manage SSH `RemoteForward` and keepalive in `~/.ssh/config.antigravity` |
| `antigravity-agy-proxy.localProxyPort` | `7890` | Local proxy port on your workstation |
| `antigravity-agy-proxy.remoteProxyHost` | `127.0.0.1` | Proxy host reachable on the remote server |
| `antigravity-agy-proxy.remoteProxyPort` | `7890` | Proxy port on the remote server |
| `antigravity-agy-proxy.proxyType` | `http` | `http`, `socks5`, or `socks5h` |
| `antigravity-agy-proxy.proxyMode` | `mgraftcp-no-fakedns` | `mgraftcp-no-fakedns`, `env-only`, or `mgraftcp-fakedns` |
| `antigravity-agy-proxy.enableFdGuard` | `false` | Manage rootless crontab FD guard automatically |
| `antigravity-agy-proxy.fdGuardThreshold` | `10000` | Open FD threshold above which FD Guard kills runaway backend processes |
| `antigravity-agy-proxy.fdGuardIntervalMinutes` | `15` | FD Guard cron interval in minutes (1–59) |
| `antigravity-agy-proxy.autoFixOnStartup` | `false` | Automatically run Auto Fix on startup if critical FD/UDP/FakeDNS issues are detected |
| `antigravity-agy-proxy.showStatusOnStartup` | `true` | Show startup connectivity & health summary |

---

## License & Acknowledgments

- Licensed under the MIT License (see [LICENSE](LICENSE)).
- Independently enhanced and refactored based on **dinobot22/antigravity-ssh-proxy** and **mgraftcp**.
