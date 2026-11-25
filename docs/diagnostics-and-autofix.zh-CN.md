# 9 项全链路诊断与一键自动排错（Auto Fix）

[English](diagnostics-and-autofix.md) | 简体中文 | [← 返回 README](../README.md)

**Antigravity AGY Proxy** 内置重构后的 **9 项端到端诊断系统** 与 **一键自动排错引擎（Auto Fix）**，支持完整中英文诊断界面与可导出报告。

---

## 1. 九项实时诊断检查

| # | Check ID | 诊断项 | 检查内容 |
|---|---|---|---|
| 1 | `local-proxy` | 本地代理服务 | 检测本地电脑代理端口（如 `7890`）的可达性。 |
| 2 | `ssh-config` | SSH 配置 | 检查 `~/.ssh/config.antigravity` 中的 `RemoteForward` 与 `ServerAliveInterval` / `ServerAliveCountMax` 保活配置。 |
| 3 | `remote-forward` | 远程端口转发 | 检查远端转发端口监听状态与网关连通性（`remoteProxyHost:remoteProxyPort`）。 |
| 4 | `mgraftcp` | `mgraftcp-fakedns` | 按当前 `proxyMode` 智能检查对应架构的 `mgraftcp-fakedns` 与 `libdnsredir` 二进制状态。 |
| 5 | `ls-wrapper` | 后端包装 (`agy` / LS) | 同时校验 `~/.gemini/bin/agy` 与旧版 `language_server_linux_*` 的 `.bak` 备份、插件版本、代理地址、协议与模式一致性。 |
| 6 | `ls-process` | 后端进程 (`agy` / LS) | 检测真实运行 PID、`--persistent_mode` 持久模式、重复/僵尸进程、`PPID=1` 孤儿 `mgraftcp` 进程、实时 FD 数量及代理是否真正生效。 |
| 7 | `fd-udp-health` | FD 与 UDP 句柄健康 | 实时统计进程 `/proc/<pid>/fd`、系统 `/proc/net/udp{,6}` 相对 `ip_local_port_range` 的占用率，扫描最近日志中的 `Failed to start FakeDNS` / `too many open files` / `Temporary failure in name resolution`，并显示 FD Guard 状态。 |
| 8 | `dns-resolution` | DNS 解析健康 | 直接测试远程主机对 `oauth2.googleapis.com` 与 `daily-cloudcode-pa.googleapis.com` 的解析情况，识别 DNS 污染并给出模式建议。 |
| 9 | `external-connectivity` | 外部连接 | 并行测试 `http`、`socks5`、`socks5h` 三种协议的外部连通性，识别当前可用协议。 |

---

## 2. 一键自动排错（`antigravity-agy-proxy.autoFix`）

可在 **AGY Proxy 状态面板** 点击「一键排错」，或在命令面板运行 `Antigravity AGY Proxy: Auto Fix / Troubleshoot`；也可开启 `antigravity-agy-proxy.autoFixOnStartup` 在连接远程时自动修复严重异常。

### 自动执行动作

1. **精准清理孤儿与泄漏进程**：
   - 区分活跃主进程与 `PPID=1` 孤儿进程、重复进程及高 FD 泄漏进程，只清理异常/孤儿 `agy --hub`、`language_server_linux` 与 `mgraftcp`，尽量避免误伤正常活跃会话。
2. **FakeDNS / UDP 耗尽降级保护**：
   - 一旦检测到 `Failed to start FakeDNS` 绑定失败、UDP 端口耗尽或 FD 异常增长，自动将 `proxyMode` 从 `mgraftcp-fakedns` 切换为 `mgraftcp-no-fakedns`（或 `env-only`），并启用无 root 的 **FD Guard** 定时防护。
3. **协议智能切换**：
   - 当当前配置的 `proxyType` 不可用，但测试发现其他协议（如 `http` / `socks5h` / `socks5`）可正常连通时，自动切换至可用协议。
4. **同步包装脚本并提示重载**：
   - 将最新配置同步写入远端包装脚本，并在需要时提示重新加载窗口使进程通过新包装重启。

