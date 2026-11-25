# Antigravity AGY Proxy

[English](README.en.md) | 简体中文

面向 Antigravity Remote-SSH 环境的独立增强型代理与稳定性保障插件，全面兼容 **Antigravity IDE v2.6.0+（`~/.gemini/bin/agy --hub`）** 与**旧版本（`language_server_linux_*`）**，重点解决 **FakeDNS UDP 句柄泄漏导致服务器无法连接、SSH 隧道僵死、DNS 污染及无交互自动排错** 等核心痛点。

---

## 核心特性

### 1. 兼容新旧版本 Antigravity 后端
- **Antigravity IDE v2.6.0+**：自动识别并包装 `~/.gemini/bin/agy`（保留 `--version` / `-v` 快速直通以及原生二进制原子备份 `agy.bak`）。
- **旧版本（pre-v2.6.0）**：自动兼容 `~/.antigravity-ide-server` 与 `~/.antigravity-server` 下的 `language_server_linux_*`（支持 `x86_64` / `arm64`）。
- **无缝平滑迁移**：自动识别旧版 `ANTIGRAVITY_SSH_PROXY_WRAPPER` 包装脚本与 `ANTIGRAVITY_SSH_PROXY_FD_GUARD` cron 规则，保留原始 `.bak` 二进制并无感升级为 `antigravity-agy-proxy`。

### 2. 三种代理拦截策略（`antigravity-agy-proxy.proxyMode`）
针对不同服务器网络环境以及高并发长连接下的 UDP/FD 稳定性问题，提供三种可切换模式：

| 模式 (`proxyMode`) | 原理与机制 | 适用场景 |
|---|---|---|
| **`mgraftcp-no-fakedns`（默认·推荐）** | 保留 `mgraftcp-fakedns` 的 TCP `ptrace` 透明代理，同时注入 `--disable-fakedns` 与标准代理环境变量 | **绝大多数服务器首选**：既能接管不读取环境变量的子进程，又彻底消除 FakeDNS UDP `:0` 监听引起的句柄/临时端口耗尽 |
| **`env-only`** | 纯环境变量模式（`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` + `NO_PROXY`），不启动 `mgraftcp` | 零 `ptrace` 性能损耗、零 FakeDNS/UDP 风险；搭配 `http` 或 `socks5h` 使用效果极佳 |
| **`mgraftcp-fakedns`** | `mgraftcp` TCP 拦截 + `libdnsredir` FakeDNS + `GODEBUG=netdns=cgo` | 仅限远程服务器本地 DNS 完全被污染、直连域名解析失败时使用（建议同时开启 FD 守护） |

### 3. 全协议支持（`http` / `socks5` / `socks5h`）
- **`http`**（默认，推荐 Clash/V2Ray 等客户端）
- **`socks5`**（本地 DNS 解析）
- **`socks5h`**（通过代理远端解析 DNS，避免远程主机 DNS 污染）

### 4. SSH 隧道保活与防假死
本地端自动生成 `~/.ssh/config.antigravity`，配置：
- `RemoteForward <remotePort> 127.0.0.1:<localPort>`
- `ServerAliveInterval 30` & `ServerAliveCountMax 3`：自动清理断开的 SSH 隧道，降低僵尸 `sshd` 占住转发端口导致的端口冲突概率。

### 5. Crontab FD 守护（极端泄漏兜底防护）
针对长期运行场景可能出现的 FD/UDP 句柄异常增长，插件支持一键管理无 `root` 权限的 `crontab` 守护任务：
- 配置项：`antigravity-agy-proxy.enableFdGuard`（默认 `false`）、`fdGuardIntervalMinutes`（默认 `15`）、`fdGuardThreshold`（默认 `10000`）。
- 也可在状态面板中直接开关，或执行命令 `Antigravity AGY Proxy: Install / Remove FD Guard (Cron)`。
- 实际注入的定时规则：
  ```bash
  */15 * * * * for pid in $(pgrep -f "(agy\.bak|language_server_linux.*\.bak)"); do cnt=$(ls -f /proc/$pid/fd 2>/dev/null | wc -l); [ "${cnt:-0}" -gt 10000 ] && echo "$(date): killed pid=$pid fds=$cnt" >> $HOME/agy_guard.log && kill -9 $pid; done # ANTIGRAVITY_AGY_PROXY_FD_GUARD
  ```

### 6. 重构诊断系统与一键自动排错（Auto Fix）
状态面板内置 **9 项全链路诊断** 与 **一键排错（Auto Fix）**：
1. **本地代理服务** (`local-proxy`)：本地端口可达性
2. **SSH 配置** (`ssh-config`)：`config.antigravity`、`RemoteForward` 及 `ServerAliveInterval` 保活配置
3. **远程端口转发** (`remote-forward`)：远端网关连通性与监听检查
4. **mgraftcp-fakedns** (`mgraftcp`)：按当前 `proxyMode` 智能检查二进制及 `libdnsredir` 状态
5. **后端包装 (agy / LS)** (`ls-wrapper`)：同时校验 `~/.gemini/bin/agy` 与旧版 `language_server_linux_*` 的 `.bak`、版本、地址、协议、模式
6. **后端进程 (agy / LS)** (`ls-process`)：检测真实运行 PID、持久模式、重复/僵尸进程、孤儿 `mgraftcp` 与实际运行模式
7. **FD 与 UDP 句柄健康** (`fd-udp-health`)：实时统计进程 `/proc/<pid>/fd`、系统 `/proc/net/udp{,6}` 与 `ip_local_port_range` 占用率、扫描最近日志中的 `Failed to start FakeDNS` / `too many open files` / `Temporary failure in name resolution`，并显示 FD Guard 状态
8. **DNS 解析健康** (`dns-resolution`)：直接测试远程服务器对 `oauth2.googleapis.com` 与 `daily-cloudcode-pa.googleapis.com` 的解析能力并给出模式建议
9. **外部连接** (`external-connectivity`)：并行测试 `HTTP`、`SOCKS5`、`SOCKS5H` 三种协议的外部连通性

**Auto Fix（一键排错 / `antigravity-agy-proxy.autoFix`）** 会自动执行：
- 终止高 FD、重复运行或孤儿 `agy --hub` / `language_server_linux` / `mgraftcp` 进程；
- 检测到 FakeDNS 绑定失败或 UDP/FD 耗尽时，自动从 `mgraftcp-fakedns` 切换至 `mgraftcp-no-fakedns`（或 `env-only`）并启用 FD Guard；
- 当前代理协议不可用但其他协议（如 `HTTP` / `SOCKS5H`）可用时自动切换配置；
- 同步包装脚本并提示重载窗口。

---

## 快速使用

1. **在本地机器**：启动 Clash/V2Ray 等代理软件（确认端口，默认 `7890`），先打开一个本地 Antigravity 窗口，插件会自动配置 `~/.ssh/config.antigravity` SSH 反向端口转发与保活。
2. **连接远程服务器**：从本地窗口发起 Remote-SSH 连接（不要直接从空窗口的历史记录跳过本地直连）。
3. **远程配置**：插件自动在远端配置 `agy` / `language_server_linux_*` 包装脚本（默认 `mgraftcp-no-fakedns`）。
4. **打开状态面板**：点击左下角状态栏 `AGY Proxy` 图标，可查看流量、切换协议与策略、开关 Cron FD Guard、运行 9 项诊断或点击「一键排错」。

---

## 配置项一览

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `antigravity-agy-proxy.enableLocalForwarding` | `true` | 是否由本地插件管理 `~/.ssh/config.antigravity` 端口转发与保活 |
| `antigravity-agy-proxy.localProxyPort` | `7890` | 本地代理软件监听端口 |
| `antigravity-agy-proxy.remoteProxyHost` | `127.0.0.1` | 远端代理地址 |
| `antigravity-agy-proxy.remoteProxyPort` | `7890` | 远端转发或网关端口 |
| `antigravity-agy-proxy.proxyType` | `http` | 代理协议：`http`、`socks5`、`socks5h` |
| `antigravity-agy-proxy.proxyMode` | `mgraftcp-no-fakedns` | 拦截模式：`mgraftcp-no-fakedns`、`env-only`、`mgraftcp-fakedns` |
| `antigravity-agy-proxy.enableFdGuard` | `false` | 是否启用远端 rootless `crontab` FD 守护任务 |
| `antigravity-agy-proxy.fdGuardThreshold` | `10000` | FD 守护触发 `kill -9` 的文件描述符阈值 |
| `antigravity-agy-proxy.fdGuardIntervalMinutes` | `15` | FD 守护巡检间隔（分钟，1–59） |
| `antigravity-agy-proxy.autoFixOnStartup` | `false` | 启动检测发现严重 FD/UDP/FakeDNS 异常时是否自动执行修复 |
| `antigravity-agy-proxy.showStatusOnStartup` | `true` | 连接远程后是否显示启动自检状态通知 |

---

## 常用命令

- `Antigravity AGY Proxy: Show Status Panel` — 打开统一管理/诊断/流量面板
- `Antigravity AGY Proxy: Run Diagnostics` — 运行 9 项链路诊断
- `Antigravity AGY Proxy: Auto Fix / Troubleshoot` — 自动诊断并修复进程/FakeDNS/协议/FD 问题
- `Antigravity AGY Proxy: Install / Remove FD Guard (Cron)` — 安装或移除 Crontab FD 守护任务
- `Antigravity AGY Proxy: Setup Remote Environment` — 在终端手动安装或更新包装脚本
- `Antigravity AGY Proxy: Rollback Remote Environment` — 恢复原始 `agy` / `language_server_linux_*` 二进制并清理 FD Guard
- `Antigravity AGY Proxy: Enable Port Forwarding` / `Disable Port Forwarding` — 启用或停用 SSH 转发配置

---

## 开源协议与致谢

- 本项目基于 MIT 协议开源（见 [LICENSE](LICENSE)）。
- 本项目基于 **dinobot22/antigravity-ssh-proxy** 与 **mgraftcp** 进行独立增强与重构开发。
