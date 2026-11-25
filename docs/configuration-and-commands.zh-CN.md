# 配置项与命令全表

[English](configuration-and-commands.md) | 简体中文 | [← 返回 README](../README.md)

本文档列出 **Antigravity AGY Proxy** 的全部配置项与命令面板指令。

---

## 配置项一览（`antigravity-agy-proxy.*`）

| 配置项 | 类型 | 默认值 | 作用域 | 说明 |
|---|---|---|---|---|
| `antigravity-agy-proxy.enableLocalForwarding` | `boolean` | `true` | `application` | 是否由本地窗口管理 `~/.ssh/config.antigravity` 中的 `RemoteForward` 与 `ServerAlive*` 保活配置。 |
| `antigravity-agy-proxy.localProxyPort` | `number` | `7890` | `application` | 本地代理软件（如 Clash / V2Ray）监听端口。仅在 `enableLocalForwarding` 为 `true` 时使用。 |
| `antigravity-agy-proxy.remoteProxyHost` | `string` | `"127.0.0.1"` | `machine-overridable` | 远端服务器访问代理的主机地址。使用 SSH 反向转发时保持 `127.0.0.1`。 |
| `antigravity-agy-proxy.remoteProxyPort` | `number` | `7890` | `machine-overridable` | 远端代理网关端口（必须与本地 SSH 隧道转发的远程端口一致）。 |
| `antigravity-agy-proxy.proxyType` | `string` | `"http"` | `machine-overridable` | 代理协议：`http`、`socks5` 或 `socks5h`。 |
| `antigravity-agy-proxy.proxyMode` | `string` | `"mgraftcp-no-fakedns"` | `machine-overridable` | 流量拦截策略：`mgraftcp-no-fakedns`、`env-only` 或 `mgraftcp-fakedns`。 |
| `antigravity-agy-proxy.enableFdGuard` | `boolean` | `false` | `machine-overridable` | 是否自动维护无 root 权限的 `crontab` FD 守护任务，当 `agy.bak` / `language_server_linux*.bak` 打开句柄超过阈值时自动终止。 |
| `antigravity-agy-proxy.fdGuardThreshold` | `number` | `10000` | `machine-overridable` | FD 守护触发终止的文件描述符阈值（最小值 `500`）。 |
| `antigravity-agy-proxy.fdGuardIntervalMinutes` | `number` | `15` | `machine-overridable` | FD 守护定时巡检间隔（分钟，`1`–`59`）。 |
| `antigravity-agy-proxy.autoFixOnStartup` | `boolean` | `false` | `machine-overridable` | 连接远程时若检测到严重的 FD/UDP/FakeDNS 异常，是否自动执行一键修复。 |
| `antigravity-agy-proxy.showStatusOnStartup` | `boolean` | `true` | `machine-overridable` | 连接远程后是否弹出启动自检状态通知。 |

---

## 命令面板指令（`Ctrl+Shift+P` / `Cmd+Shift+P`）

| 命令名称 | 命令 ID | 用途 |
|---|---|---|
| `Antigravity AGY Proxy: Show Status Panel` | `antigravity-agy-proxy.showStatusPanel` | 打开统一状态、配置、诊断与流量面板。 |
| `Antigravity AGY Proxy: Run Diagnostics` | `antigravity-agy-proxy.diagnose` | 运行 9 项全链路诊断并生成可导出的双语诊断报告。 |
| `Antigravity AGY Proxy: Auto Fix / Troubleshoot` | `antigravity-agy-proxy.autoFix` | 一键自动排查并修复高 FD/孤儿进程、FakeDNS 报错、协议不匹配与包装脚本不同步问题。 |
| `Antigravity AGY Proxy: Install / Remove FD Guard (Cron)` | `antigravity-agy-proxy.toggleFdGuard` | 安装或移除无 root 权限的 Crontab FD 守护任务。 |
| `Antigravity AGY Proxy: Show Traffic Monitor` | `antigravity-agy-proxy.showTrafficPanel` | 打开流量监控面板。 |
| `Antigravity AGY Proxy: Setup Remote Environment` | `antigravity-agy-proxy.setup` | 在终端中手动运行 `setup-proxy.sh` 安装或更新远程包装脚本。 |
| `Antigravity AGY Proxy: Rollback Remote Environment` | `antigravity-agy-proxy.rollback` | 从 `.bak` 还原原始 `agy` / `language_server_linux_*` 二进制，并可选择清理 FD 守护。 |
| `Antigravity AGY Proxy: Enable Port Forwarding` | `antigravity-agy-proxy.enableForwarding` | 启用本地 `~/.ssh/config.antigravity` 端口转发配置。 |
| `Antigravity AGY Proxy: Disable Port Forwarding` | `antigravity-agy-proxy.disableForwarding` | 停用本地 SSH 端口转发配置。 |
| `Antigravity AGY Proxy: Show Status` | `antigravity-agy-proxy.tunnelStatus` | 显示当前隧道/代理状态摘要。 |
| `Antigravity AGY Proxy: Refresh Status` | `antigravity-agy-proxy.refreshStatus` | 立即刷新本地/远程代理与 SSH 状态。 |
| `Antigravity AGY Proxy: Check Proxy` | `antigravity-agy-proxy.checkProxy` | 检查代理连通性。 |
| `Antigravity AGY Proxy: Show Output` | `antigravity-agy-proxy.showOutput` | 跳转到 `Antigravity AGY Proxy` Output 日志频道。 |

