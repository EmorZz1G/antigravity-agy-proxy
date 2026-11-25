# 故障排查与 Issue 提交指南

[English](troubleshooting.md) | 简体中文 | [← 返回 README](../README.md)

当在 **Antigravity IDE Remote-SSH** 中遇到代理失效、断连或报错时，请按以下步骤排查；若仍无法解决，请按第 3 步附带诊断信息提交 Issue。

---

## Step 1 — 标准重试流程（请务必先完成）

很多远程代理不生效的原因，是直接从历史记录打开了远程窗口，导致本地窗口尚未生成 `~/.ssh/config.antigravity` 转发规则。请严格按以下顺序重试一次：

1. **关闭所有 Antigravity 窗口**（包括本地窗口与所有远程 SSH 窗口）。
2. **先打开一个本地 Antigravity 窗口**，等待左下角 **`AGY Proxy` 状态变为绿色**。
3. **以新窗口连接远程服务器**：
   - 点击 SSH 连接时，优先选择 **`Connect SSH Host in New Window`**（打开新窗口），避免在当前窗口直接切换。
4. **若提示需要重启/重载窗口**，请直接重载以刷新包装脚本与环境变量。

---

## Step 2 — 常见故障速查

### 1. FakeDNS UDP 泄漏或文件描述符耗尽

- **现象**：远程连接越用越卡、SSH 断连，或日志出现 `Failed to start FakeDNS`、`too many open files`。
- **解决**：
  - 打开左下角 **AGY Proxy 状态面板** → 点击 **一键排错（Auto Fix）**，或将 `antigravity-agy-proxy.proxyMode` 切换为 `mgraftcp-no-fakedns`（默认）或 `env-only`。
  - 如需使用 `mgraftcp-fakedns`，建议同时开启 **FD Guard (Cron)**（`enableFdGuard: true`）兜底清理异常句柄进程。

### 2. DNS 污染导致 TLS 证书校验失败

- **现象**：日志中出现类似报错：
  ```text
  tls: failed to verify certificate: x509: certificate is valid for antigravity-unleash.goog, not daily-cloudcode-pa.googleapis.com
  ```
- **原因**：远程主机本地 DNS 返回了被污染的 IP，导致 TLS 握手域名不匹配。
- **解决**：
  - **推荐方案**：将 `proxyType` 设为 `socks5h`（通过代理远端解析 DNS），`proxyMode` 保持 `mgraftcp-no-fakedns` 或 `env-only`。
  - **备选方案**：将 `proxyMode` 切换为 `mgraftcp-fakedns`（启用 `libdnsredir` `LD_PRELOAD` + `198.18.0.0/15` FakeDNS + `GODEBUG=netdns=cgo`），并建议开启 **FD Guard**。

> **历史背景（供开发者参考）**：早期 `antigravity-ssh-proxy` 在 `0.0.7` 之前曾存在三个缺陷导致 FakeDNS 失效：查找 `libdnsredir.so` 而非 `libdnsredir-linux-amd64.so`、`AutoSelectMode` 在 SOCKS5 失败后直接 `direct` 跳过 HTTP 代理、以及 wrapper 脚本错误调用不带 FakeDNS 的 `mgraftcp-linux-amd64`。这些问题在本项目中均已修复，且已扩展支持 `arm64` 与 Antigravity v2.6.0+ `agy --hub`。

### 3. Docker / 受限内核环境 `ptrace` 不可用

- **现象**：远程容器内缺少 `CAP_SYS_PTRACE` 或 `ptrace_scope` 受限导致 `mgraftcp` 无法拦截。
- **解决**：将 `antigravity-agy-proxy.proxyMode` 切换为 `env-only`。

### 4. `--persistent_mode` 进程未加载代理

- **现象**：安装或更新插件前，后端进程已以 `--persistent_mode` 常驻启动。
- **解决**：在状态面板运行 **诊断 (Diagnose)** → 点击 **一键排错 (Auto Fix)**，插件会自动识别未走代理的活跃或孤儿进程并安全重启。

---

## Step 3 — 提交 Bug 时请附带的信息

如果在完成 Step 1 并尝试 **一键排错（Auto Fix）** 后问题仍存在，请在 Issue 中提供：

1. **AGY Proxy 完整诊断报告**：
   - 打开远程窗口左下角 **AGY Proxy 面板** → 运行 **诊断 (Diagnose)** → 复制完整诊断结果。
2. **Antigravity Output 日志**：
   - Output 面板 → `Antigravity`
   - Output 面板 → `Antigravity AGY Proxy`
3. **远端系统环境输出**：
   ```bash
   uname -a                                 # 内核版本
   uname -m                                 # 架构 (x86_64 / aarch64)
   ps aux | grep -E "agy|language_server"   # 实际运行的后端进程
   cat /proc/sys/kernel/yama/ptrace_scope   # ptrace 权限限制
   ls -la /.dockerenv 2>/dev/null || echo "not docker"
   ```

