# Configuration & Commands Reference

English | [简体中文](configuration-and-commands.zh-CN.md) | [← Back to README](../README.md)

Complete reference for all settings and commands contributed by **Antigravity AGY Proxy**.

---

## Settings (`antigravity-agy-proxy.*`)

| Setting | Type | Default | Scope | Description |
|---|---|---|---|---|
| `antigravity-agy-proxy.enableLocalForwarding` | `boolean` | `true` | `application` | Manage `~/.ssh/config.antigravity` `RemoteForward` and `ServerAlive*` keepalive rules from the local IDE window. |
| `antigravity-agy-proxy.localProxyPort` | `number` | `7890` | `application` | Local proxy software listening port (e.g., Clash / V2Ray). Used when `enableLocalForwarding` is `true`. |
| `antigravity-agy-proxy.remoteProxyHost` | `string` | `"127.0.0.1"` | `machine-overridable` | Host address reachable on the remote server. Keep `127.0.0.1` when using SSH reverse forwarding. |
| `antigravity-agy-proxy.remoteProxyPort` | `number` | `7890` | `machine-overridable` | Port on the remote server used as the proxy gateway (must match the SSH tunnel remote port). |
| `antigravity-agy-proxy.proxyType` | `string` | `"http"` | `machine-overridable` | Proxy protocol: `http`, `socks5`, or `socks5h`. |
| `antigravity-agy-proxy.proxyMode` | `string` | `"mgraftcp-no-fakedns"` | `machine-overridable` | Traffic interception strategy: `mgraftcp-no-fakedns`, `env-only`, or `mgraftcp-fakedns`. |
| `antigravity-agy-proxy.enableFdGuard` | `boolean` | `false` | `machine-overridable` | Automatically maintain a rootless crontab guard that kills runaway `agy.bak` / `language_server_linux*.bak` processes exceeding `fdGuardThreshold`. |
| `antigravity-agy-proxy.fdGuardThreshold` | `number` | `10000` | `machine-overridable` | Open file descriptor threshold (minimum `500`) above which FD Guard terminates the runaway backend process. |
| `antigravity-agy-proxy.fdGuardIntervalMinutes` | `number` | `15` | `machine-overridable` | Inspection interval in minutes (`1`–`59`) for the FD Guard cron job. |
| `antigravity-agy-proxy.autoFixOnStartup` | `boolean` | `false` | `machine-overridable` | Automatically run Auto Fix on remote startup when critical FD/UDP/FakeDNS issues are detected. |
| `antigravity-agy-proxy.showStatusOnStartup` | `boolean` | `true` | `machine-overridable` | Show a startup connectivity & health summary notification after connecting to a remote host. |

---

## Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)

| Command Title | Command ID | Purpose |
|---|---|---|
| `Antigravity AGY Proxy: Show Status Panel` | `antigravity-agy-proxy.showStatusPanel` | Open the unified status, configuration, diagnostics, and traffic panel. |
| `Antigravity AGY Proxy: Run Diagnostics` | `antigravity-agy-proxy.diagnose` | Run the 9-point end-to-end diagnostic suite and open the report. |
| `Antigravity AGY Proxy: Auto Fix / Troubleshoot` | `antigravity-agy-proxy.autoFix` | Automatically remediate runaway/orphan processes, FakeDNS failures, protocol mismatches, and wrapper sync issues. |
| `Antigravity AGY Proxy: Install / Remove FD Guard (Cron)` | `antigravity-agy-proxy.toggleFdGuard` | Install or remove the rootless crontab FD Guard rule. |
| `Antigravity AGY Proxy: Show Traffic Monitor` | `antigravity-agy-proxy.showTrafficPanel` | Open the traffic monitor view. |
| `Antigravity AGY Proxy: Setup Remote Environment` | `antigravity-agy-proxy.setup` | Run `setup-proxy.sh` in a terminal to install or update remote wrappers manually. |
| `Antigravity AGY Proxy: Rollback Remote Environment` | `antigravity-agy-proxy.rollback` | Restore original `agy` / `language_server_linux_*` binaries from `.bak` and optionally clean up FD Guard. |
| `Antigravity AGY Proxy: Enable Port Forwarding` | `antigravity-agy-proxy.enableForwarding` | Enable local SSH tunnel management in `~/.ssh/config.antigravity`. |
| `Antigravity AGY Proxy: Disable Port Forwarding` | `antigravity-agy-proxy.disableForwarding` | Disable local SSH tunnel management. |
| `Antigravity AGY Proxy: Show Status` | `antigravity-agy-proxy.tunnelStatus` | Display current tunnel / proxy status summary. |
| `Antigravity AGY Proxy: Refresh Status` | `antigravity-agy-proxy.refreshStatus` | Re-check local/remote proxy and SSH status immediately. |
| `Antigravity AGY Proxy: Check Proxy` | `antigravity-agy-proxy.checkProxy` | Verify proxy reachability. |
| `Antigravity AGY Proxy: Show Output` | `antigravity-agy-proxy.showOutput` | Focus the `Antigravity AGY Proxy` Output channel. |

