(() => {
  const I18N = {
    zh: {
      'nav.features': '核心特性',
      'nav.install': '快速安装',
      'nav.modes': '代理策略',
      'nav.compatibility': '兼容矩阵',
      'nav.docs': '文档中心',
      'nav.stats': '下载统计',
      'nav.getExt': '获取扩展',

      'hero.badge': 'v0.1.2 · 已上架 Open VSX 与 VS Code Marketplace',
      'hero.title': '让 Antigravity Remote-SSH 代理<br /><span class="gradient-text">零泄漏、不掉线、可自愈</span>',
      'hero.desc': '专为 Antigravity IDE（全面兼容 v2.6.0+ <code>agy --hub</code> 与旧版 <code>language_server</code>）打造的增强型代理扩展。消除 FakeDNS UDP 句柄泄漏导致的服务器断连，自带 SSH 保活、无 Root FD 守护与 9 项一键排错。',
      'hero.ctaOpenVsx': '从 Open VSX 安装',
      'hero.ctaOpenVsxSub': 'Antigravity 推荐',
      'hero.ctaMarketplace': 'VS Code Marketplace',
      'hero.extIdLabel': '扩展 ID：',
      'common.copy': '复制',
      'common.copied': '已复制',

      'mock.connected': '已连接',
      'mock.tabStatus': '状态与策略',
      'mock.tabDiag': '9 项全链路诊断',
      'mock.backend': '远程后端',
      'mock.tunnel': 'SSH 隧道转发',
      'mock.protocol': '代理协议',
      'mock.strategy': '拦截模式',
      'mock.openFds': '进程 Open FDs',
      'mock.udpUsage': 'UDP 端口占用',
      'mock.keepalive': 'SSH 保活',
      'mock.noteNoFakedns': '当前采用 <code>mgraftcp-no-fakedns</code>：保留 TCP 透明代理能力，彻底关闭 FakeDNS UDP :0 绑定，长连接不泄漏句柄。',
      'mock.noteEnvOnly': '当前采用 <code>env-only</code>：零 <code>ptrace</code> 开销与零 UDP 风险，适用于容器或标准环境变量代理环境。',
      'mock.noteFakedns': '当前采用 <code>mgraftcp-fakedns</code>：启用 <code>libdnsredir</code> 绕过本地 DNS 污染，建议配合 Crontab FD Guard 使用。',
      'mock.udpHealthy': '0.4% (无泄漏)',
      'mock.udpWarn': '6.8% (FakeDNS 活跃)',
      'mock.simLeak': '模拟 FakeDNS 泄漏',
      'mock.autoFix': '⚡ 一键 Auto Fix',

      'diag.1': '1. 本地代理服务 (local-proxy)',
      'diag.2': '2. SSH 配置与保活 (ssh-config)',
      'diag.3': '3. 远程端口转发 (remote-forward)',
      'diag.5': '5. 后端包装 (ls-wrapper)',
      'diag.6': '6. 后端进程 (ls-process)',
      'diag.7': '7. FD 与 UDP 健康 (fd-udp-health)',
      'diag.8': '8. DNS 解析健康 (dns-resolution)',
      'diag.9': '9. 外部连接 (external-connectivity)',

      'features.eyebrow': '为什么需要独立增强版',
      'features.title': '直击 Remote-SSH 代理的三大真实痛点',
      'features.subtitle': '在原有代理方案基础上全面重构，专为高并发、长连接与 Antigravity v2.6.0+ 打造。',
      'features.c1Title': '根治 FakeDNS UDP 句柄泄漏',
      'features.c1Desc': '传统 FakeDNS 模式长期运行易产生大量 UDP <code>:0</code> 套接字泄漏，耗尽临时端口并拖垮 SSH。默认启用 <code>mgraftcp-no-fakedns</code>，并提供无 Root Crontab FD Guard 兜底。',
      'features.c2Title': 'v2.6.0+ agy 与旧版无缝兼容',
      'features.c2Desc': '自动包装 <code>~/.gemini/bin/agy</code>（<code>--version</code> 零延迟直通、原子保留 <code>agy.bak</code>），同时兼容旧版 <code>language_server_linux_*</code> 及历史包装脚本无感升级。',
      'features.c3Title': 'SSH 保活与 9 项一键排错',
      'features.c3Desc': '自动写入 <code>ServerAliveInterval 30</code> 清理僵尸隧道；状态面板集成 9 项端到端诊断，支持精准清理 <code>PPID=1</code> 孤儿进程并自动切换可用协议。',

      'install.eyebrow': '3 分钟快速开始',
      'install.title': '三步完成安装与配置',
      'install.subtitle': '无需在远程服务器上安装 root 依赖，本地和远程均开箱即用。',
      'install.s1Title': '安装扩展并启动本地窗口',
      'install.s1Desc': '在 Antigravity IDE 扩展市场搜索 <code>EmorZz1G.antigravity-agy-proxy</code> 安装。先启动本地 Clash / V2Ray（默认端口 <code>7890</code>），再打开一个<strong>本地窗口</strong>，等待左下角 <code>AGY Proxy</code> 变绿。',
      'install.s2Title': '以新窗口连接远程服务器',
      'install.s2Desc': '从本地窗口选择 <strong>Connect SSH Host in New Window</strong> 连接远端主机。扩展会自动配置 <code>~/.ssh/config.antigravity</code> 反向端口转发，并包装远程 <code>agy</code> / <code>language_server</code>。',
      'install.s3Title': '面板调优与一键排错',
      'install.s3Desc': '点击左下角 <code>AGY Proxy</code> 打开统一面板：随时切换 <code>http / socks5 / socks5h</code>、调整拦截模式、查看流量监控、开关 Crontab FD Guard，或运行 9 项诊断与 <strong>Auto Fix</strong>。',

      'modes.eyebrow': '按环境选择最佳策略',
      'modes.title': '三种代理拦截模式对比',
      'modes.subtitle': '支持在状态面板或设置项 <code>antigravity-agy-proxy.proxyMode</code> 中随时切换。',
      'modes.recommended': '默认 · 推荐',
      'modes.zeroOverhead': '零 ptrace 开销',
      'modes.dnsFallback': 'DNS 污染专用',
      'modes.m1Mech': 'TCP ptrace 透明拦截（禁用 FakeDNS）+ 标准代理环境变量',
      'modes.m1P1': '接管不读取环境变量的子进程',
      'modes.m1P2': '彻底消除 FakeDNS UDP :0 句柄泄漏',
      'modes.m1P3': '搭配 <code>http</code> 或 <code>socks5h</code> 稳定性最佳',
      'modes.m2Mech': '纯环境变量注入（HTTP_PROXY / HTTPS_PROXY / ALL_PROXY）',
      'modes.m2P1': '无 ptrace 性能开销，无 UDP 风险',
      'modes.m2P2': '兼容限制 ptrace 的 Docker / 容器环境',
      'modes.m2P3': '推荐配合 <code>http</code> 或 <code>socks5h</code> 使用',
      'modes.m3Mech': 'TCP ptrace + libdnsredir FakeDNS + GODEBUG=netdns=cgo',
      'modes.m3P1': '解决远端本地 DNS 污染导致的证书错误',
      'modes.m3P2': '仅建议在直连解析失败时开启',
      'modes.m3P3': '建议同时开启 Crontab FD Guard 防护',

      'compat.eyebrow': '版本与环境支持',
      'compat.title': '全版本兼容矩阵',
      'compat.subtitle': '覆盖最新 Antigravity IDE、历史版本与多架构 Linux 远程主机。',
      'compat.colDim': '兼容维度',
      'compat.colTarget': '支持目标',
      'compat.colDetail': '说明与特性',
      'compat.r1Dim': 'Antigravity v2.6.0+',
      'compat.r1Desc': '原生支持 <code>agy --hub</code>，保留 <code>agy.bak</code> 原子备份，<code>--version</code> / <code>-v</code> 零延迟直通',
      'compat.r2Dim': '旧版后端 (pre-v2.6.0)',
      'compat.r2Desc': '兼容 <code>~/.antigravity-ide-server</code> 与 <code>~/.antigravity-server</code>，支持 <code>--persistent_mode</code> 进程检测',
      'compat.r3Dim': '历史插件迁移',
      'compat.r3Desc': '自动识别旧版 <code>ANTIGRAVITY_SSH_PROXY_WRAPPER</code> 与 cron 规则，保留原 <code>.bak</code> 无痛升级',
      'compat.r4Dim': '服务器 CPU 架构',
      'compat.r4Desc': '内置双架构 <code>mgraftcp-fakedns</code> 与 <code>libdnsredir</code> 二进制；受限容器可选 <code>env-only</code>',
      'compat.r5Dim': '代理协议',
      'compat.r5Desc': '9 项诊断自动并行测速，支持 <code>socks5h</code> 远端代理 DNS 解析',

      'docs.eyebrow': '源文档索引',
      'docs.title': '深入了解技术细节与排错指南',
      'docs.subtitle': '所有技术文档均按主题归档在仓库 <code>docs/</code> 目录中，提供中英双语对照。',
      'docs.d1Title': '架构原理与代理模式 ↗',
      'docs.d1Desc': 'SSH 隧道保活、agy 包装机制、三种拦截策略与 Crontab FD Guard 原理。',
      'docs.d2Title': '配置项与命令全表 ↗',
      'docs.d2Desc': '所有 <code>antigravity-agy-proxy.*</code> 设置项默认值及命令面板操作指令。',
      'docs.d3Title': '9 项诊断与 Auto Fix ↗',
      'docs.d3Desc': '全链路检查逻辑、UDP/FD 监控指标与一键排错自动修复流程。',
      'docs.d4Title': '故障排查与 Issue 指南 ↗',
      'docs.d4Desc': 'DNS 污染、Docker ptrace 限制、常见连接异常与日志收集清单。',

      'footer.license': '基于 MIT 协议开源',
      'footer.ack': '基于 dinobot22/antigravity-ssh-proxy 与 mgraftcp 独立增强重构'
    },
    en: {
      'nav.features': 'Features',
      'nav.install': 'Quick Start',
      'nav.modes': 'Proxy Modes',
      'nav.compatibility': 'Compatibility',
      'nav.docs': 'Docs',
      'nav.stats': 'Stats',
      'nav.getExt': 'Get Extension',

      'hero.badge': 'v0.1.2 · Live on Open VSX & VS Code Marketplace',
      'hero.title': 'Zero-Leak Remote-SSH Proxy for <br /><span class="gradient-text">Antigravity IDE</span>',
      'hero.desc': 'An enhanced proxy & resilience extension for Antigravity IDE (v2.6.0+ <code>agy --hub</code> &amp; legacy <code>language_server</code>). Eliminates FakeDNS UDP socket leaks, adds SSH keepalive, rootless FD Guard, and 9-point Auto Fix.',
      'hero.ctaOpenVsx': 'Install on Open VSX',
      'hero.ctaOpenVsxSub': 'Recommended',
      'hero.ctaMarketplace': 'VS Code Marketplace',
      'hero.extIdLabel': 'Extension ID:',
      'common.copy': 'Copy',
      'common.copied': 'Copied',

      'mock.connected': 'Connected',
      'mock.tabStatus': 'Status & Strategy',
      'mock.tabDiag': '9-Point Diagnostics',
      'mock.backend': 'Remote Backend',
      'mock.tunnel': 'SSH Tunnel',
      'mock.protocol': 'Protocol',
      'mock.strategy': 'Proxy Mode',
      'mock.openFds': 'Open FDs',
      'mock.udpUsage': 'UDP Port Usage',
      'mock.keepalive': 'SSH Keepalive',
      'mock.noteNoFakedns': 'Using <code>mgraftcp-no-fakedns</code>: transparent TCP ptrace redirection with FakeDNS UDP :0 disabled for long-running stability.',
      'mock.noteEnvOnly': 'Using <code>env-only</code>: zero <code>ptrace</code> overhead and zero UDP sockets — ideal for containers and standard env-aware tooling.',
      'mock.noteFakedns': 'Using <code>mgraftcp-fakedns</code>: enables <code>libdnsredir</code> to bypass poisoned remote DNS. Recommended with Crontab FD Guard.',
      'mock.udpHealthy': '0.4% (Zero Leak)',
      'mock.udpWarn': '6.8% (FakeDNS Active)',
      'mock.simLeak': 'Simulate Leak',
      'mock.autoFix': '⚡ Run Auto Fix',

      'diag.1': '1. Local Proxy Service (local-proxy)',
      'diag.2': '2. SSH Configuration (ssh-config)',
      'diag.3': '3. Remote Port Forwarding (remote-forward)',
      'diag.5': '5. Backend Wrapper (ls-wrapper)',
      'diag.6': '6. Backend Process (ls-process)',
      'diag.7': '7. FD & UDP Port Health (fd-udp-health)',
      'diag.8': '8. DNS Resolution Health (dns-resolution)',
      'diag.9': '9. External Connectivity (external-connectivity)',

      'features.eyebrow': 'Why AGY Proxy',
      'features.title': 'Built to Solve Real Remote-SSH Failure Modes',
      'features.subtitle': 'Refactored from the ground up for long-lived sessions, high concurrency, and Antigravity v2.6.0+.',
      'features.c1Title': 'Eliminate FakeDNS UDP / FD Leaks',
      'features.c1Desc': 'Legacy FakeDNS setups can leak UDP <code>:0</code> sockets until ephemeral ports run out and SSH drops. <code>mgraftcp-no-fakedns</code> is enabled by default, backed by a rootless Crontab FD Guard.',
      'features.c2Title': 'v2.6.0+ agy & Legacy Compatibility',
      'features.c2Desc': 'Automatically wraps <code>~/.gemini/bin/agy</code> (fast <code>--version</code> bypass, atomic <code>agy.bak</code>) while supporting legacy <code>language_server_linux_*</code> and seamless migration.',
      'features.c3Title': 'SSH Keepalive & 9-Point Auto Fix',
      'features.c3Desc': 'Injects <code>ServerAliveInterval 30</code> to clear stale tunnels. Includes 9 real-time checks that isolate <code>PPID=1</code> orphans and auto-switch working protocols.',

      'install.eyebrow': '3-Minute Setup',
      'install.title': 'Up and Running in Three Steps',
      'install.subtitle': 'Zero root permissions required on your remote Linux host.',
      'install.s1Title': 'Install & Open a Local Window First',
      'install.s1Desc': 'Install <code>EmorZz1G.antigravity-agy-proxy</code> in Antigravity IDE. Start Clash / V2Ray locally (default port <code>7890</code>), open a <strong>local window</strong> first, and wait until <code>AGY Proxy</code> turns green.',
      'install.s2Title': 'Connect Remote Host in a New Window',
      'install.s2Desc': 'Choose <strong>Connect SSH Host in New Window</strong>. The extension configures <code>~/.ssh/config.antigravity</code> forwarding and wraps remote <code>agy</code> / <code>language_server</code> automatically.',
      'install.s3Title': 'Tune & Auto-Heal from Status Panel',
      'install.s3Desc': 'Click <code>AGY Proxy</code> in the status bar to switch <code>http / socks5 / socks5h</code>, change proxy modes, inspect traffic, toggle FD Guard, or run 9-point diagnostics and <strong>Auto Fix</strong>.',

      'modes.eyebrow': 'Choose Your Strategy',
      'modes.title': 'Three Proxy Interception Modes',
      'modes.subtitle': 'Switch anytime from the Status Panel or <code>antigravity-agy-proxy.proxyMode</code>.',
      'modes.recommended': 'Default · Recommended',
      'modes.zeroOverhead': 'Zero ptrace Overhead',
      'modes.dnsFallback': 'Poisoned DNS Only',
      'modes.m1Mech': 'TCP ptrace redirection (--disable-fakedns) + standard proxy env vars',
      'modes.m1P1': 'Intercepts subprocesses that ignore proxy env vars',
      'modes.m1P2': 'Completely eliminates FakeDNS UDP :0 socket leaks',
      'modes.m1P3': 'Pairs cleanly with <code>http</code> or <code>socks5h</code>',
      'modes.m2Mech': 'Pure environment variables (HTTP_PROXY / HTTPS_PROXY / ALL_PROXY)',
      'modes.m2P1': 'Zero ptrace overhead and zero UDP socket risk',
      'modes.m2P2': 'Works in Docker/containers with restricted ptrace',
      'modes.m2P3': 'Recommended with <code>http</code> or <code>socks5h</code>',
      'modes.m3Mech': 'TCP ptrace + libdnsredir FakeDNS + GODEBUG=netdns=cgo',
      'modes.m3P1': 'Bypasses poisoned local DNS causing TLS cert errors',
      'modes.m3P2': 'Use only when direct DNS resolution fails',
      'modes.m3P3': 'Recommended to pair with Crontab FD Guard',

      'compat.eyebrow': 'Environment Support',
      'compat.title': 'Full Compatibility Matrix',
      'compat.subtitle': 'Covers Antigravity IDE v2.6.0+, legacy servers, and multi-arch Linux hosts.',
      'compat.colDim': 'Dimension',
      'compat.colTarget': 'Supported Targets',
      'compat.colDetail': 'Notes & Capabilities',
      'compat.r1Dim': 'Antigravity v2.6.0+',
      'compat.r1Desc': 'Native <code>agy --hub</code> wrapping, atomic <code>agy.bak</code> backup, zero-latency <code>--version</code> / <code>-v</code> bypass',
      'compat.r2Dim': 'Legacy Servers (pre-v2.6.0)',
      'compat.r2Desc': 'Supports <code>~/.antigravity-ide-server</code> & <code>~/.antigravity-server</code> plus <code>--persistent_mode</code> detection',
      'compat.r3Dim': 'Legacy Extension Upgrade',
      'compat.r3Desc': 'Recognizes <code>ANTIGRAVITY_SSH_PROXY_WRAPPER</code> & legacy cron rules while preserving original <code>.bak</code>',
      'compat.r4Dim': 'Linux Architectures',
      'compat.r4Desc': 'Bundled <code>x86_64</code> & <code>arm64</code> binaries; <code>env-only</code> available for restricted containers',
      'compat.r5Dim': 'Proxy Protocols',
      'compat.r5Desc': 'Parallel probes across <code>http</code>, <code>socks5</code>, and remote-DNS <code>socks5h</code>',

      'docs.eyebrow': 'Source Documentation',
      'docs.title': 'Deep-Dive Guides & Reference',
      'docs.subtitle': 'All detailed technical documentation lives cleanly in the repository <code>docs/</code> folder.',
      'docs.d1Title': 'Architecture & Proxy Modes ↗',
      'docs.d1Desc': 'SSH keepalive, agy wrapping, three interception strategies, and rootless FD Guard.',
      'docs.d2Title': 'Configuration & Commands ↗',
      'docs.d2Desc': 'Complete reference for all <code>antigravity-agy-proxy.*</code> settings and commands.',
      'docs.d3Title': '9-Point Diagnostics & Auto Fix ↗',
      'docs.d3Desc': 'End-to-end checks, FD/UDP health thresholds, and automated remediation flow.',
      'docs.d4Title': 'Troubleshooting & Issue Guide ↗',
      'docs.d4Desc': 'DNS pollution fixes, Docker ptrace workarounds, and bug report checklist.',

      'footer.license': 'MIT Licensed Open Source',
      'footer.ack': 'Independently enhanced & refactored from dinobot22/antigravity-ssh-proxy and mgraftcp'
    }
  };

  const DOC_BASE_URL = 'https://github.com/EmorZz1G/antigravity-agy-proxy/blob/main/docs/';

  const detectInitialLang = () => {
    const params = new URLSearchParams(window.location.search);
    const paramLang = params.get('lang');
    if (paramLang === 'zh' || paramLang === 'en') return paramLang;
    const saved = localStorage.getItem('agy-site-lang');
    if (saved === 'zh' || saved === 'en') return saved;
    return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  };

  const detectInitialTheme = () => {
    const saved = localStorage.getItem('agy-site-theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };

  let currentLang = detectInitialLang();
  let currentTheme = detectInitialTheme();
  let currentMode = 'mgraftcp-no-fakedns';

  const applyTheme = (theme) => {
    currentTheme = theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('agy-site-theme', theme);
  };

  const updateModePreview = (mode) => {
    currentMode = mode;
    const noteEl = document.getElementById('mock-mode-note');
    const fdEl = document.getElementById('mock-fd-val');
    const udpEl = document.getElementById('mock-udp-val');
    const dict = I18N[currentLang];

    if (mode === 'mgraftcp-no-fakedns') {
      noteEl.innerHTML = dict['mock.noteNoFakedns'];
      fdEl.textContent = '142 / 10000';
      fdEl.className = 'tel-val ok-text';
      udpEl.textContent = dict['mock.udpHealthy'];
      udpEl.className = 'tel-val ok-text';
    } else if (mode === 'env-only') {
      noteEl.innerHTML = dict['mock.noteEnvOnly'];
      fdEl.textContent = '96 / 10000';
      fdEl.className = 'tel-val ok-text';
      udpEl.textContent = dict['mock.udpHealthy'];
      udpEl.className = 'tel-val ok-text';
    } else {
      noteEl.innerHTML = dict['mock.noteFakedns'];
      fdEl.textContent = '1,240 / 10000';
      fdEl.className = 'tel-val warn-text';
      udpEl.textContent = dict['mock.udpWarn'];
      udpEl.className = 'tel-val warn-text';
    }
  };

  const applyLang = (lang) => {
    currentLang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    localStorage.setItem('agy-site-lang', lang);

    const dict = I18N[lang];
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (dict[key] !== undefined) {
        el.innerHTML = dict[key];
      }
    });

    const suffix = lang === 'zh' ? '.zh-CN.md' : '.md';
    document.querySelectorAll('[data-doc-base]').forEach((el) => {
      const base = el.getAttribute('data-doc-base');
      el.setAttribute('href', `${DOC_BASE_URL}${base}${suffix}`);
    });

    document.getElementById('lang-toggle').textContent = lang === 'zh' ? 'EN' : '中文';
    updateModePreview(currentMode);
  };

  // Init
  applyTheme(currentTheme);
  applyLang(currentLang);

  // Toggles
  document.getElementById('lang-toggle').addEventListener('click', () => {
    applyLang(currentLang === 'zh' ? 'en' : 'zh');
  });

  document.getElementById('theme-toggle').addEventListener('click', () => {
    applyTheme(currentTheme === 'light' ? 'dark' : 'light');
  });

  // Copy Extension ID
  const copyBtn = document.getElementById('copy-ext-id');
  copyBtn.addEventListener('click', async () => {
    const extId = document.getElementById('ext-id-code').textContent.trim();
    try {
      await navigator.clipboard.writeText(extId);
      copyBtn.textContent = I18N[currentLang]['common.copied'];
      setTimeout(() => {
        copyBtn.textContent = I18N[currentLang]['common.copy'];
      }, 1600);
    } catch {
      // Fallback selection
      window.getSelection()?.selectAllChildren(document.getElementById('ext-id-code'));
    }
  });

  // Panel tabs
  document.querySelectorAll('.panel-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.getAttribute('data-tab');
      document.querySelectorAll('.panel-tab').forEach((t) => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.panel-body').forEach((b) => b.classList.remove('active'));
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      document.getElementById(`tab-${target}`).classList.add('active');
    });
  });

  // Protocol & Mode chips
  document.querySelectorAll('#mock-proto-group .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mock-proto-group .chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('#mock-mode-group .chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mock-mode-group .chip').forEach((c) => c.classList.remove('active'));
      btn.classList.add('active');
      updateModePreview(btn.getAttribute('data-mode'));
    });
  });

  // Diagnostic Leak / Auto-Fix simulation
  const fdRow = document.getElementById('diag-fd-row');
  const fdTag = document.getElementById('diag-fd-tag');
  const fdDot = fdRow.querySelector('.diag-dot');

  document.getElementById('simulate-leak-btn').addEventListener('click', () => {
    fdDot.className = 'diag-dot fail';
    fdTag.className = 'diag-tag fail';
    fdTag.textContent = 'FD 12,480';
  });

  document.getElementById('simulate-fix-btn').addEventListener('click', () => {
    fdDot.className = 'diag-dot pass';
    fdTag.className = 'diag-tag pass';
    fdTag.textContent = 'FIXED · OK';
    document.querySelectorAll('#mock-mode-group .chip').forEach((c) => {
      c.classList.toggle('active', c.getAttribute('data-mode') === 'mgraftcp-no-fakedns');
    });
    updateModePreview('mgraftcp-no-fakedns');
  });
})();

