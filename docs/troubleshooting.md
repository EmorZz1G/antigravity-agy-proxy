# Troubleshooting & Bug Report Guide

English | [简体中文](troubleshooting.zh-CN.md) | [← Back to README](../README.md)

Follow these steps before opening an issue or when diagnosing connection failures in **Antigravity IDE Remote-SSH**.

---

## Step 1 — Clean Retry Sequence (Try First)

Many Remote-SSH proxy issues happen when a remote window is opened directly from history before the local window creates `~/.ssh/config.antigravity`. Retry strictly in this order:

1. **Close all Antigravity windows** (both local and all Remote-SSH windows).
2. **Open a local Antigravity window first** and wait until the status bar `AGY Proxy` indicator turns **green**.
3. **Connect to the remote host in a New Window**:
   - Prefer `Connect SSH Host in New Window` instead of reusing the current window.
4. **If prompted to reload the window**, reload so the wrapper environment takes effect cleanly.

---

## Step 2 — Common Issues & Quick Fixes

### 1. FakeDNS UDP / FD Exhaustion (`Failed to start FakeDNS` / `too many open files`)

- **Symptom**: Remote SSH connection slows down, disconnects, or logs show `Failed to start FakeDNS` / `too many open files`.
- **Fix**:
  - Open the **AGY Proxy Status Panel** and click **Auto Fix**, or switch `antigravity-agy-proxy.proxyMode` to `mgraftcp-no-fakedns` (default) or `env-only`.
  - Optionally enable **FD Guard (Cron)** (`antigravity-agy-proxy.enableFdGuard: true`) to automatically kill runaway `agy.bak` / `language_server_linux*.bak` processes exceeding `10000` open FDs.

### 2. DNS Pollution / TLS Certificate Mismatch

- **Symptom**: Errors like:
  ```text
  tls: failed to verify certificate: x509: certificate is valid for antigravity-unleash.goog, not daily-cloudcode-pa.googleapis.com
  ```
- **Cause**: The remote server's local DNS returns a poisoned IP for Google API endpoints.
- **Fix**:
  - **Recommended**: Set `proxyType` to `socks5h` (remote DNS resolution via proxy) with `proxyMode` set to `mgraftcp-no-fakedns` or `env-only`.
  - **Alternative**: Switch `proxyMode` to `mgraftcp-fakedns` (uses `libdnsredir` `LD_PRELOAD` + `198.18.0.0/15` FakeDNS + `GODEBUG=netdns=cgo`) and enable **FD Guard**.

### 3. `ptrace` Restricted in Docker / Hardened Kernels

- **Symptom**: `mgraftcp` fails inside containers (`ptrace_scope` restricted or `CAP_SYS_PTRACE` missing).
- **Fix**: Switch `antigravity-agy-proxy.proxyMode` to `env-only`.

### 4. Legacy Persistent Mode Not Picking Up Proxy

- **Symptom**: `language_server_linux_*` or `agy` started in `--persistent_mode` before the wrapper was installed.
- **Fix**: Click **Run Diagnostics** → **Auto Fix** in the AGY Proxy panel, which detects active processes not using the proxy and restarts them cleanly.

---

## Step 3 — Information to Include When Filing an Issue

If the issue persists after completing Step 1 and running **Auto Fix**, please attach:

1. **Full Diagnostic Report**:
   - Open the remote **AGY Proxy Status Panel** → click **Run Diagnostics** → copy the exported report.
2. **Output Channel Logs**:
   - `Output` panel → `Antigravity`
   - `Output` panel → `Antigravity AGY Proxy`
3. **Remote Host Environment**:
   ```bash
   uname -a
   uname -m
   ps aux | grep -E "agy|language_server"
   cat /proc/sys/kernel/yama/ptrace_scope
   ls -la /.dockerenv 2>/dev/null || echo "not docker"
   ```

