# 9-Point Diagnostics & One-Click Auto Fix

English | [简体中文](diagnostics-and-autofix.zh-CN.md) | [← Back to README](../README.md)

**Antigravity AGY Proxy** includes a refactored 9-point end-to-end diagnostic suite and an automated remediation engine (`antigravity-agy-proxy.autoFix`), supporting bilingual (`zh` / `en`) reports.

---

## 1. The 9 Real-Time Diagnostic Checks

| # | Check ID | Name | What It Verifies |
|---|---|---|---|
| 1 | `local-proxy` | Local Proxy Service | Checks local proxy port reachability on your workstation. |
| 2 | `ssh-config` | SSH Configuration | Verifies `~/.ssh/config.antigravity` `RemoteForward` and `ServerAliveInterval` / `ServerAliveCountMax` keepalive rules. |
| 3 | `remote-forward` | Remote Port Forwarding | Tests remote tunnel listener and gateway connectivity (`remoteProxyHost:remoteProxyPort`). |
| 4 | `mgraftcp` | `mgraftcp-fakedns` | Mode-aware verification of `mgraftcp-fakedns` and `libdnsredir` availability for the configured architecture. |
| 5 | `ls-wrapper` | Backend Wrapper (`agy` / LS) | Verifies wrapper scripts and `.bak` backups across `~/.gemini/bin/agy` and legacy `language_server_linux_*`, checking version, host/port, protocol, and mode. |
| 6 | `ls-process` | Backend Process (`agy` / LS) | Inspects live PIDs, `--persistent_mode`, duplicate/zombie processes, `PPID=1` orphan `mgraftcp` processes, active FD counts, and whether proxy is actually active. |
| 7 | `fd-udp-health` | FD & UDP Port Health | Measures per-process `/proc/<pid>/fd`, system `/proc/net/udp` & `/proc/net/udp6` utilization against `ip_local_port_range`, scans recent logs for `Failed to start FakeDNS` / `too many open files` / `Temporary failure in name resolution`, and checks FD Guard cron status. |
| 8 | `dns-resolution` | DNS Resolution Health | Directly tests remote host DNS resolution for `oauth2.googleapis.com` and `daily-cloudcode-pa.googleapis.com`, recommending strategy changes if DNS is polluted. |
| 9 | `external-connectivity` | External Connectivity | Runs parallel connectivity probes across `http`, `socks5`, and `socks5h` to detect working protocols. |

---

## 2. One-Click Auto Fix (`antigravity-agy-proxy.autoFix`)

Trigger Auto Fix from the **AGY Proxy Status Panel** or Command Palette (`Antigravity AGY Proxy: Auto Fix / Troubleshoot`), or enable `antigravity-agy-proxy.autoFixOnStartup` for automatic startup remediation.

### Automated Remediation Actions

1. **Targeted Orphan & Leak Cleanup**:
   - Distinguishes active backend processes from `PPID=1` orphaned processes, duplicate processes, and runaway high-FD processes so stale/leaking processes are terminated without needlessly disrupting healthy main sessions.
2. **FakeDNS / UDP Exhaustion Mitigation**:
   - When `Failed to start FakeDNS`, UDP port exhaustion, or runaway FD leaks are detected under `mgraftcp-fakedns`, automatically switches `proxyMode` to `mgraftcp-no-fakedns` (or `env-only`) and enables the rootless **FD Guard** cron job.
3. **Smart Protocol Switching**:
   - If the currently configured `proxyType` fails external connectivity while another protocol (`http`, `socks5h`, or `socks5`) succeeds, automatically switches to the working protocol.
4. **Wrapper Resync & Reload Prompt**:
   - Re-syncs remote wrapper scripts (`~/.gemini/bin/agy` / `language_server_linux_*`) with the updated settings and prompts you to reload the window when needed.

