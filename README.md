# Antigravity AGY Proxy

![Antigravity AGY Proxy Banner](resources/banner.png)

<p align="center">
  <a href="https://emorzz1g.github.io/antigravity-agy-proxy/">
    <img src="https://img.shields.io/badge/Website-emorzz1g.github.io-38bdf8?style=for-the-badge&logo=githubpages&logoColor=white" alt="Official Website" />
  </a>
  <a href="https://open-vsx.org/extension/EmorZz1G/antigravity-agy-proxy">
    <img src="https://img.shields.io/open-vsx/v/EmorZz1G/antigravity-agy-proxy?style=for-the-badge&label=Open%20VSX&color=a855f7" alt="Open VSX Version" />
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=EmorZz1G.antigravity-agy-proxy">
    <img src="https://img.shields.io/visual-studio-marketplace/v/EmorZz1G.antigravity-agy-proxy?style=for-the-badge&label=VS%20Code%20Marketplace&color=2563eb" alt="VS Code Marketplace Version" />
  </a>
  <a href="https://emorzz1g.github.io/antigravity-agy-proxy/stats.html">
    <img src="https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FEmorZz1G%2Fantigravity-agy-proxy%2Fmain%2Fsite%2Fdata%2Fbadge.json&style=for-the-badge&color=0284c7" alt="Total Downloads" />
  </a>
  <a href="https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-10b981?style=for-the-badge" alt="MIT License" />
  </a>
</p>

<p align="center">
  <a href="#简体中文">简体中文</a> · <a href="#english">English</a>
</p>

<p align="center">
  <strong>面向 Antigravity IDE Remote-SSH 的高稳定性代理与自愈扩展：兼容 v2.6.0+ <code>agy</code> 与旧版服务端，彻底解决 FakeDNS UDP 句柄泄漏、SSH 假死断连与 DNS 污染问题。</strong><br/>
  Zero-leak Remote-SSH proxy, keepalive, and auto-healing toolkit for Antigravity IDE (v2.6.0+ <code>agy</code> &amp; legacy servers).
</p>

---

<h2 id="简体中文">简体中文</h2>

### 立即安装

| 平台 | 安装入口 |
|---|---|
| **官网介绍** | [**emorzz1g.github.io/antigravity-agy-proxy**](https://emorzz1g.github.io/antigravity-agy-proxy/) |
| **Open VSX Registry** *（Antigravity IDE 推荐）* | [**从 Open VSX 安装**](https://open-vsx.org/extension/EmorZz1G/antigravity-agy-proxy) |
| **VS Code Marketplace** | [**从 VS Code Marketplace 安装**](https://marketplace.visualstudio.com/items?itemName=EmorZz1G.antigravity-agy-proxy) |
| **GitHub Releases (`.vsix`)** | [**下载最新发行版**](https://github.com/EmorZz1G/antigravity-agy-proxy/releases) |

### 核心亮点

- **全面兼容新旧后端（v2.6.0+ `agy` & 旧版）**：自动包装 `~/.gemini/bin/agy`（`agy --hub`、原子保留 `agy.bak`、`--version` 零延迟直通）与旧版 `language_server_linux_x64` / `arm64`，支持从 `dinobot22/antigravity-ssh-proxy` 无痛迁移。
- **彻底消除 FakeDNS UDP 句柄泄漏**：默认启用 `mgraftcp-no-fakedns`（`--disable-fakedns`），在保留 TCP 透明代理的同时消除 UDP `:0` 临时端口/FD 泄漏导致的断连；同时支持 `env-only` 与 `mgraftcp-fakedns`。
- **全协议支持与防 DNS 污染**：支持 `http`（推荐 Clash / V2Ray / Mihomo）、`socks5` 以及 `socks5h`（通过代理远端解析 DNS，无需开启 FakeDNS）。
- **SSH 保活与无 Root FD 守护**：自动配置 `~/.ssh/config.antigravity`（`RemoteForward` + `ServerAliveInterval 30` / `ServerAliveCountMax 3`），并支持无 `root` 权限的 `crontab` FD 守护任务。
- **9 项全链路诊断与一键排错（Auto Fix）**：覆盖本地代理、SSH 隧道、包装脚本、孤儿 `PPID=1` 进程、`/proc/<pid>/fd` 与 UDP 占用、DNS 解析及多协议并行测速，支持一键自动修复。

### 三步快速上手

1. **启动本地代理并先开本地窗口**：本地启动 Clash / V2Ray / Mihomo（默认端口 `7890`），先打开一个**本地** Antigravity 窗口，等待左下角 `AGY Proxy` 指示灯变绿（自动写入 `~/.ssh/config.antigravity`）。
2. **以新窗口连接远程服务器**：通过 Remote-SSH 选择 **`Connect SSH Host in New Window`** 连接远端主机，插件会自动配置远程 `agy` / `language_server_linux_*` 包装脚本。
3. **打开状态面板管理与排错**：点击左下角 **`AGY Proxy`**，即可随时切换协议（`http` / `socks5` / `socks5h`）与代理模式、开关 Crontab FD Guard、查看流量、运行 9 项诊断或点击「一键排错」。

### 详细技术文档索引

所有深入的原理说明、配置全表与排错手册均归档在 [`docs/`](https://github.com/EmorZz1G/antigravity-agy-proxy/tree/main/docs)：

| 主题 | 简体中文 | English |
|---|---|---|
| **架构原理与三种代理模式**（SSH 隧道、`agy` 包装、模式对比、FD Guard） | [architecture-and-modes.zh-CN.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/architecture-and-modes.zh-CN.md) | [architecture-and-modes.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/architecture-and-modes.md) |
| **配置项与命令全表**（全部设置项与命令面板指令） | [configuration-and-commands.zh-CN.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/configuration-and-commands.zh-CN.md) | [configuration-and-commands.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/configuration-and-commands.md) |
| **9 项诊断与一键排错**（全链路检查逻辑与 Auto Fix） | [diagnostics-and-autofix.zh-CN.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/diagnostics-and-autofix.zh-CN.md) | [diagnostics-and-autofix.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/diagnostics-and-autofix.md) |
| **故障排查与 Issue 指南**（DNS 污染、Docker `ptrace`、日志收集清单） | [troubleshooting.zh-CN.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/troubleshooting.zh-CN.md) | [troubleshooting.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/troubleshooting.md) |
| **更新日志** | [CHANGELOG.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/CHANGELOG.md) | [CHANGELOG.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/CHANGELOG.md) |

### 开源协议与致谢

- 本项目基于 [MIT 协议](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/LICENSE) 开源。
- 基于 **dinobot22/antigravity-ssh-proxy** 与 **mgraftcp** 独立增强重构。

---

<h2 id="english">English</h2>

### Install

| Platform | Link |
|---|---|
| **Project Website** | [**emorzz1g.github.io/antigravity-agy-proxy**](https://emorzz1g.github.io/antigravity-agy-proxy/) |
| **Open VSX Registry** *(Recommended for Antigravity IDE)* | [**Install from Open VSX**](https://open-vsx.org/extension/EmorZz1G/antigravity-agy-proxy) |
| **VS Code Marketplace** | [**Install from VS Code Marketplace**](https://marketplace.visualstudio.com/items?itemName=EmorZz1G.antigravity-agy-proxy) |
| **GitHub Releases (`.vsix`)** | [**Download Latest Release**](https://github.com/EmorZz1G/antigravity-agy-proxy/releases) |

### Why Antigravity AGY Proxy?

- **v2.6.0+ `agy` & Legacy Compatibility**: Automatically wraps `~/.gemini/bin/agy` (`agy --hub`, atomic `agy.bak` backup, fast `--version` bypass) as well as legacy `language_server_linux_x64` / `arm64`, with seamless migration from `dinobot22/antigravity-ssh-proxy`.
- **Zero FakeDNS UDP/FD Leaks**: Defaults to `mgraftcp-no-fakedns` (`--disable-fakedns`), keeping transparent TCP interception without leaking UDP `:0` ephemeral ports that crash remote SSH hosts. Also supports `env-only` and `mgraftcp-fakedns`.
- **Full Protocols & DNS Resilience**: Supports `http` (Clash / V2Ray / Mihomo), `socks5`, and `socks5h` (remote DNS resolution via proxy without FakeDNS overhead).
- **SSH Keepalive & Rootless FD Guard**: Manages `~/.ssh/config.antigravity` (`RemoteForward` + `ServerAliveInterval 30` / `ServerAliveCountMax 3`) and an optional rootless `crontab` FD Guard.
- **9-Point Diagnostics & One-Click Auto Fix**: Real-time checks across local proxy, SSH tunnel, wrapper sync, orphan `PPID=1` processes, `/proc/<pid>/fd` & UDP health, DNS resolution, and parallel protocol probes—with automated remediation.

### 3-Step Quick Start

1. **Start Local Proxy & Open Local Window**: Run Clash / V2Ray / Mihomo locally (default port `7890`), open a **local** Antigravity IDE window first, and wait until the bottom-left `AGY Proxy` indicator turns green (auto-writes `~/.ssh/config.antigravity`).
2. **Connect Remote Host in a New Window**: Connect via Remote-SSH using **`Connect SSH Host in New Window`**. The extension automatically wraps remote `agy` / `language_server_linux_*` binaries.
3. **Manage & Troubleshoot**: Click **`AGY Proxy`** in the status bar to switch protocols (`http` / `socks5` / `socks5h`) or modes, toggle FD Guard, monitor traffic, run 9-point diagnostics, or trigger **Auto Fix**.

### Documentation Index

All in-depth technical documentation is maintained in [`docs/`](https://github.com/EmorZz1G/antigravity-agy-proxy/tree/main/docs):

| Topic | English | 简体中文 |
|---|---|---|
| **Architecture & Proxy Modes** *(SSH tunnel, `agy` wrapping, 3 modes, FD Guard)* | [architecture-and-modes.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/architecture-and-modes.md) | [architecture-and-modes.zh-CN.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/architecture-and-modes.zh-CN.md) |
| **Configuration & Commands** *(All settings & command palette actions)* | [configuration-and-commands.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/configuration-and-commands.md) | [configuration-and-commands.zh-CN.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/configuration-and-commands.zh-CN.md) |
| **Diagnostics & Auto Fix** *(9-point checks & automated remediation)* | [diagnostics-and-autofix.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/diagnostics-and-autofix.md) | [diagnostics-and-autofix.zh-CN.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/diagnostics-and-autofix.zh-CN.md) |
| **Troubleshooting & Issue Guide** *(DNS pollution, Docker `ptrace`, bug report checklist)* | [troubleshooting.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/troubleshooting.md) | [troubleshooting.zh-CN.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/troubleshooting.zh-CN.md) |
| **Changelog** | [CHANGELOG.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/CHANGELOG.md) | [CHANGELOG.md](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/CHANGELOG.md) |

### License & Acknowledgments

- Licensed under the [MIT License](https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/LICENSE).
- Independently enhanced and refactored based on **dinobot22/antigravity-ssh-proxy** and **mgraftcp**.
