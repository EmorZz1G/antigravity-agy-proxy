# 架构原理与代理模式详解

[English](architecture-and-modes.md) | 简体中文 | [← 返回 README](../README.md)

本文档详细介绍 **Antigravity AGY Proxy** 的端到端工作链路、新旧 Antigravity 后端兼容机制、三种代理拦截策略以及无 Root Crontab FD 守护。

---

## 1. 端到端架构

```text
┌─────────────────────────────────────┐         SSH 隧道            ┌──────────────────────────────────────────────┐
│             本地机器                │   ~/.ssh/config.antigravity │               远程 Linux 服务器              │
│                                     │                             │                                              │
│  Clash / V2Ray / Mihomo (:7890) ◄───┼── RemoteForward 7890 ◄──────┼─── 127.0.0.1:7890                            │
│                                     │   ServerAliveInterval 30    │        ▲                                     │
│  Antigravity IDE (本地窗口)          │   ServerAliveCountMax 3     │        │ (http / socks5 / socks5h)          │
│                                     │                             │  ┌─────┴──────────────────────────────────┐  │
│                                     │                             │  │ 包装脚本: ~/.gemini/bin/agy             │  │
│                                     │                             │  │      或: language_server_linux_{x64,arm} │  │
│                                     │                             │  │  • mgraftcp-no-fakedns (默认)            │  │
│                                     │                             │  │  • env-only                             │  │
│                                     │                             │  │  • mgraftcp-fakedns                     │  │
│                                     │                             │  └─────┬──────────────────────────────────┘  │
│                                     │                             │        ▼                                     │
│                                     │                             │  原生二进制: agy.bak / *.bak                 │
└─────────────────────────────────────┘                             └──────────────────────────────────────────────┘
```

### 工作流程

1. **本地 SSH 反向隧道与保活**：
   - 本地插件自动维护 `~/.ssh/config.antigravity`，配置 `RemoteForward <remotePort> 127.0.0.1:<localPort>`。
   - 自动写入 `ServerAliveInterval 30` 与 `ServerAliveCountMax 3`，及时清理断连的僵尸 `sshd` 隧道，避免端口被占死。
2. **远程后端包装（兼容 v2.6.0+ 与旧版本）**：
   - **Antigravity IDE v2.6.0+**：自动识别并包装 `~/.gemini/bin/agy`，原子保留原生二进制 `agy.bak`，同时对 `--version` / `-v` 探针做零延迟直通。
   - **旧版本（pre-v2.6.0）**：继续兼容 `~/.antigravity-ide-server` 与 `~/.antigravity-server` 下的 `language_server_linux_*`（支持 `x86_64` 与 `arm64`）。
   - **平滑迁移**：自动识别旧版 `dinobot22/antigravity-ssh-proxy` 留下的 `ANTIGRAVITY_SSH_PROXY_WRAPPER` 与 `ANTIGRAVITY_SSH_PROXY_FD_GUARD`，保留原有 `.bak` 二进制并无感升级。

---

## 2. 三种代理拦截策略（`proxyMode`）

| 模式 | 机制与原理 | 优势 | 适用场景 |
|---|---|---|---|
| **`mgraftcp-no-fakedns`** *（默认 · 推荐）* | 使用 `mgraftcp-fakedns --disable-fakedns` 保留 TCP `ptrace` 透明代理，同时注入标准代理环境变量。 | 既能接管不读取环境变量的子进程，又**彻底消除** FakeDNS UDP `:0` 监听带来的端口与 FD 泄漏。 | **绝大多数远程服务器首选**：兼顾兼容性与长时间运行稳定性。 |
| **`env-only`** | 纯环境变量模式（`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` + `NO_PROXY`），不启动 `mgraftcp`。 | 零 `ptrace` 性能损耗、零 FakeDNS/UDP 风险；在限制 `ptrace` 的 Docker/容器中也能正常工作。 | 受限容器环境，或 `http` / `socks5h` 环境变量已能完全接管流量的服务器。 |
| **`mgraftcp-fakedns`** | `mgraftcp` TCP 拦截 + `libdnsredir`（`LD_PRELOAD`）FakeDNS（`198.18.0.0/15`）+ `GODEBUG=netdns=cgo`。 | 即使服务器本地 DNS 被严重污染，也能通过代理远端解析域名。 | **仅限**远程主机本地 DNS 完全被污染、直连域名解析失败时使用（建议配合 FD 守护）。 |

### 为什么将 `mgraftcp-no-fakedns` 设为默认策略？

传统的 `mgraftcp-fakedns` 会通过 `libdnsredir` 与 FakeDNS 不断创建 UDP `:0` 套接字。在 `agy --hub` 或 `language_server` 长时间、高并发运行场景下，异常累积的 UDP 句柄会耗尽 `ip_local_port_range` 或进程文件描述符（报错 `Failed to start FakeDNS` / `too many open files`），甚至拖垮整台机器的 SSH 连接。

`mgraftcp-no-fakedns` 保留了 `mgraftcp` 的 TCP 透明接管能力，同时通过 `--disable-fakedns` 关闭 FakeDNS UDP 绑定，从根源消除该类泄漏。

---

## 3. 支持的代理协议（`proxyType`）

- **`http`** *（默认）* — 推荐 Clash、Mihomo、V2Ray 等常见代理软件使用。
- **`socks5`** — SOCKS5 协议，在远端服务器本地解析 DNS。
- **`socks5h`** — SOCKS5 协议并通过代理**远端解析 DNS**，无需开启 FakeDNS 即可绕过远程主机 DNS 污染。

---

## 4. 无 Root 权限 Crontab FD 守护

针对开启 `mgraftcp-fakedns` 等极端场景可能出现的句柄异常飙升，插件提供无需 `root` 权限的幂等 `crontab` 守护任务（`enableFdGuard`、`fdGuardIntervalMinutes`、`fdGuardThreshold`）：

```bash
*/15 * * * * for pid in $(pgrep -f "(agy\.bak|language_server_linux.*\.bak)"); do cnt=$(ls -f /proc/$pid/fd 2>/dev/null | wc -l); [ "${cnt:-0}" -gt 10000 ] && echo "$(date): killed pid=$pid fds=$cnt" >> $HOME/agy_guard.log && kill -9 $pid; done # ANTIGRAVITY_AGY_PROXY_FD_GUARD
```

- **无需 `root` 权限**：基于当前用户 `crontab` 运行。
- **双端覆盖**：同时巡检 `agy.bak` 与旧版 `language_server_linux*.bak`。
- **日志可查**：触发强杀时记录时间、PID 与 FD 数量到 `$HOME/agy_guard.log`。
- **一键开关**：可在 **AGY Proxy 状态面板** 中直接切换，或执行命令 `Antigravity AGY Proxy: Install / Remove FD Guard (Cron)`。

