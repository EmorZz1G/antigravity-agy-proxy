# Architecture & Proxy Modes

English | [简体中文](architecture-and-modes.zh-CN.md) | [← Back to README](../README.md)

This document explains how **Antigravity AGY Proxy** works across local SSH forwarding, remote backend wrapping, proxy strategies, and rootless FD leak protection.

---

## 1. End-to-End Architecture

```text
┌─────────────────────────────────────┐         SSH Tunnel          ┌──────────────────────────────────────────────┐
│           Local Machine             │   ~/.ssh/config.antigravity │               Remote Linux Host              │
│                                     │                             │                                              │
│  Clash / V2Ray / Mihomo (:7890) ◄───┼── RemoteForward 7890 ◄──────┼─── 127.0.0.1:7890                            │
│                                     │   ServerAliveInterval 30    │        ▲                                     │
│  Antigravity IDE (Local Window)     │   ServerAliveCountMax 3     │        │ (http / socks5 / socks5h)          │
│                                     │                             │  ┌─────┴──────────────────────────────────┐  │
│                                     │                             │  │ Wrapper: ~/.gemini/bin/agy             │  │
│                                     │                             │  │     or: language_server_linux_{x64,arm} │  │
│                                     │                             │  │  • mgraftcp-no-fakedns (default)        │  │
│                                     │                             │  │  • env-only                             │  │
│                                     │                             │  │  • mgraftcp-fakedns                     │  │
│                                     │                             │  └─────┬──────────────────────────────────┘  │
│                                     │                             │        ▼                                     │
│                                     │                             │  Original Binary: agy.bak / *.bak            │
└─────────────────────────────────────┘                             └──────────────────────────────────────────────┘
```

### How It Works

1. **Local SSH Tunnel & Keepalive**:
   - The local extension generates `~/.ssh/config.antigravity` with `RemoteForward <remotePort> 127.0.0.1:<localPort>`.
   - Adds `ServerAliveInterval 30` and `ServerAliveCountMax 3` to detect and recycle broken SSH tunnels, preventing stale `sshd` processes from holding the forwarded port.
2. **Remote Backend Wrapping (v2.6.0+ & Legacy)**:
   - **Antigravity IDE v2.6.0+**: Wraps `~/.gemini/bin/agy` while preserving an atomic backup at `agy.bak`. CLI version probes (`--version` / `-v`) bypass proxy initialization for zero-latency startup checks.
   - **Legacy servers (pre-v2.6.0)**: Continues supporting `language_server_linux_*` (`x86_64` and `arm64`) under `~/.antigravity-ide-server` and `~/.antigravity-server`.
   - **Seamless Migration**: Automatically recognizes legacy `ANTIGRAVITY_SSH_PROXY_WRAPPER` wrappers and `ANTIGRAVITY_SSH_PROXY_FD_GUARD` crontab entries from `dinobot22/antigravity-ssh-proxy`, preserving original `.bak` binaries during upgrade.

---

## 2. Three Proxy & Resilience Strategies (`proxyMode`)

| Mode | Mechanism | Pros | Best For |
|---|---|---|---|
| **`mgraftcp-no-fakedns`** *(Default · Recommended)* | Runs `mgraftcp-fakedns` with `--disable-fakedns` for TCP `ptrace` interception, alongside standard proxy environment variables. | Intercepts subprocesses that ignore proxy env vars while **completely eliminating** FakeDNS UDP `:0` ephemeral port/FD leaks. | **Most remote servers** — best balance of compatibility and long-running stability. |
| **`env-only`** | Sets `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` + `NO_PROXY` without starting `mgraftcp`. | Zero `ptrace` overhead, zero FakeDNS/UDP sockets, works even when `ptrace_scope` is restricted or inside restrictive containers. | Restricted Docker/container environments, or servers where `http` / `socks5h` env vars work cleanly. |
| **`mgraftcp-fakedns`** | Runs `mgraftcp-fakedns` with `libdnsredir` (`LD_PRELOAD`) FakeDNS (`198.18.0.0/15`) + `GODEBUG=netdns=cgo`. | Resolves domains remotely via proxy even when the server's local DNS is poisoned. | **Only** when the remote host's local DNS is poisoned and direct DNS resolution fails (pair with FD Guard). |

### Why `mgraftcp-no-fakedns` is the New Default

In traditional `mgraftcp-fakedns` mode, `libdnsredir` + FakeDNS allocates UDP sockets (`:0`). Under high-concurrency or long-running `agy --hub` / `language_server` sessions, leaked UDP sockets can exhaust `ip_local_port_range` or process file descriptors (`too many open files` / `Failed to start FakeDNS`), eventually breaking SSH and server connectivity.

`mgraftcp-no-fakedns` keeps TCP `ptrace` interception via `mgraftcp-fakedns --disable-fakedns` while disabling FakeDNS UDP binding altogether.

---

## 3. Supported Proxy Protocols (`proxyType`)

- **`http`** *(Default)* — Recommended for Clash, Mihomo, V2Ray, and most HTTP/HTTPS proxy clients.
- **`socks5`** — SOCKS5 proxy with local DNS resolution on the remote host.
- **`socks5h`** — SOCKS5 proxy with **remote DNS resolution** through the proxy tunnel, avoiding remote host DNS pollution without needing FakeDNS.

---

## 4. Rootless Crontab FD Guard

For environments prone to runaway file descriptor growth (such as `mgraftcp-fakedns` under heavy load), the extension can manage an idempotent user-level `crontab` rule (`enableFdGuard`, `fdGuardIntervalMinutes`, `fdGuardThreshold`):

```bash
*/15 * * * * for pid in $(pgrep -f "(agy\.bak|language_server_linux.*\.bak)"); do cnt=$(ls -f /proc/$pid/fd 2>/dev/null | wc -l); [ "${cnt:-0}" -gt 10000 ] && echo "$(date): killed pid=$pid fds=$cnt" >> $HOME/agy_guard.log && kill -9 $pid; done # ANTIGRAVITY_AGY_PROXY_FD_GUARD
```

- Requires **no `root` privileges**.
- Guards both `agy.bak` and legacy `language_server_linux*.bak`.
- Logs terminated runaway PIDs and FD counts to `$HOME/agy_guard.log`.
- Toggleable from the **AGY Proxy Status Panel** or via `Antigravity AGY Proxy: Install / Remove FD Guard (Cron)`.

