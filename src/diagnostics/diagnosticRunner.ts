import { exec } from 'child_process';
import * as dns from 'dns';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { getFdGuardStatus, installFdGuard } from '../fdGuard';
import {
    BackendProcessInfo,
    inspectAntigravityMgraftcpProcesses,
    inspectBackendProcesses,
    inspectUdpAndFdHealth,
    killBackendProcesses,
    ProxyMode,
    ProxyProtocol,
    UdpHealthInfo
} from '../processUtils';

const execAsync = promisify(exec);

export type DiagnosticLang = 'zh' | 'en';

export interface DiagnosticCheck {
    id: string;
    name: string;
    status: 'pending' | 'running' | 'success' | 'warning' | 'error';
    message?: string;
    suggestion?: string;
    protocolResults?: ProtocolTestResult[];
    currentProtocol?: string;
}

export interface ProtocolTestResult {
    protocol: ProxyProtocol;
    success: boolean;
    httpCode?: string;
    error?: string;
    isCurrent: boolean;
}

export interface DiagnosticReport {
    timestamp: string;
    environment: 'local' | 'remote';
    checks: DiagnosticCheck[];
    overallStatus: 'healthy' | 'warning' | 'error';
    lang?: DiagnosticLang;
}

export interface AutoFixInput {
    proxyHost: string;
    proxyPort: number;
    proxyType: ProxyProtocol;
    proxyMode: ProxyMode;
    extensionPath: string;
    extensionVersion: string;
    enableFdGuard: boolean;
    fdGuardIntervalMinutes: number;
    fdGuardThreshold: number;
    lang?: DiagnosticLang;
    updateConfig: (key: string, value: unknown) => Promise<void>;
    runSetup: (host: string, port: number, type: ProxyProtocol, mode: ProxyMode) => Promise<boolean>;
}

export interface AutoFixResult {
    actions: string[];
    changedConfig: boolean;
    needsReload: boolean;
    remainingIssues: string[];
}

interface TargetInspectResult {
    targetPath: string;
    targetType: 'agy' | 'language_server';
    isWrapper: boolean;
    hasMarker: boolean;
    hasBackup: boolean;
    version: string;
    proxyAddr: string;
    proxyType: string;
    proxyMode: string;
}

const ALL_PROTOCOLS: ProxyProtocol[] = ['http', 'socks5', 'socks5h'];

function tr(lang: DiagnosticLang, zh: string, en: string): string {
    return lang === 'zh' ? zh : en;
}

function normalizeProtocol(val: string): ProxyProtocol {
    if (val === 'socks5' || val === 'socks5h') {
        return val;
    }
    return 'http';
}

function normalizeProxyMode(val: string): ProxyMode {
    if (val === 'env-only' || val === 'mgraftcp-fakedns') {
        return val;
    }
    return 'mgraftcp-no-fakedns';
}

function getExpectedArchBinary(): { binaryName: string; libName: string } {
    const arch = os.arch();
    if (arch === 'x64') {
        return {
            binaryName: 'mgraftcp-fakedns-linux-amd64',
            libName: 'libdnsredir-linux-amd64.so'
        };
    }
    if (arch === 'arm64') {
        return {
            binaryName: 'mgraftcp-fakedns-linux-arm64',
            libName: 'libdnsredir-linux-arm64.so'
        };
    }
    return {
        binaryName: `mgraftcp-fakedns-linux-${arch}`,
        libName: `libdnsredir-linux-${arch}.so`
    };
}

function findMgraftcpBinary(extensionPath: string): { binaryPath: string | null; libPath: string | null } {
    const { binaryName, libName } = getExpectedArchBinary();
    const homeDir = os.homedir();
    const searchDirs: string[] = [
        path.join(extensionPath, 'resources', 'bin'),
        path.join(homeDir, '.antigravity-ide-server', 'mgraftcp'),
        path.join(homeDir, '.antigravity-server', 'mgraftcp')
    ];

    for (const serverDir of ['.antigravity-ide-server', '.antigravity-server']) {
        const extDir = path.join(homeDir, serverDir, 'extensions');
        if (!fs.existsSync(extDir)) {
            continue;
        }
        try {
            const dirs = fs.readdirSync(extDir)
                .filter(d => d.includes('antigravity-agy-proxy'))
                .sort()
                .reverse();
            for (const d of dirs) {
                searchDirs.push(path.join(extDir, d, 'resources', 'bin'));
            }
        } catch {
            // ignore
        }
    }

    for (const dir of searchDirs) {
        const bin = path.join(dir, binaryName);
        if (fs.existsSync(bin)) {
            const lib = path.join(dir, libName);
            return {
                binaryPath: bin,
                libPath: fs.existsSync(lib) ? lib : null
            };
        }
    }
    return { binaryPath: null, libPath: null };
}

function inspectWrapperFile(targetPath: string, targetType: 'agy' | 'language_server'): TargetInspectResult {
    const hasBackup = fs.existsSync(`${targetPath}.bak`);
    let head = '';
    try {
        const fd = fs.openSync(targetPath, 'r');
        const buf = Buffer.alloc(4096);
        const bytesRead = fs.readSync(fd, buf, 0, 4096, 0);
        fs.closeSync(fd);
        head = buf.slice(0, bytesRead).toString('utf8');
    } catch {
        head = '';
    }

    const isWrapper =
        head.startsWith('#!/bin/bash') ||
        head.includes('ANTIGRAVITY_AGY_PROXY_WRAPPER') ||
        head.includes('ANTIGRAVITY_SSH_PROXY_WRAPPER') ||
        head.includes('WRAPPER_VERSION=');
    const hasMarker = head.includes('ANTIGRAVITY_AGY_PROXY_WRAPPER');

    const extract = (pattern: RegExp, fallback: string): string => {
        const m = head.match(pattern);
        return m ? m[1] : fallback;
    };

    return {
        targetPath,
        targetType,
        isWrapper,
        hasMarker,
        hasBackup,
        version: extract(/WRAPPER_VERSION="([^"]+)"/, 'none'),
        proxyAddr: extract(/PROXY_ADDR="([^"]+)"/, 'none'),
        proxyType: extract(/PROXY_TYPE="([^"]+)"/, 'none'),
        proxyMode: extract(/PROXY_MODE="([^"]+)"/, 'legacy')
    };
}

function discoverTargets(): TargetInspectResult[] {
    const homeDir = os.homedir();
    const results: TargetInspectResult[] = [];

    const agyPath = path.join(homeDir, '.gemini', 'bin', 'agy');
    if (fs.existsSync(agyPath) || fs.existsSync(`${agyPath}.bak`)) {
        results.push(inspectWrapperFile(agyPath, 'agy'));
    }

    const walkForLs = (dir: string, depth: number) => {
        if (depth > 5 || !fs.existsSync(dir)) {
            return;
        }
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walkForLs(full, depth + 1);
            } else if (
                entry.isFile() &&
                entry.name.startsWith('language_server_linux_') &&
                !entry.name.endsWith('.bak') &&
                full.includes(path.join('extensions', 'antigravity', 'bin'))
            ) {
                results.push(inspectWrapperFile(full, 'language_server'));
            }
        }
    };

    for (const serverDir of ['.antigravity-ide-server', '.antigravity-server']) {
        walkForLs(path.join(homeDir, serverDir, 'bin'), 0);
    }

    return results;
}

/**
 * Check if local proxy port is reachable.
 */
async function checkLocalProxy(port: number, enableLocalForwarding: boolean, lang: DiagnosticLang): Promise<DiagnosticCheck> {
    const name = tr(lang, '本地代理服务', 'Local Proxy Service');
    if (!enableLocalForwarding) {
        return {
            id: 'local-proxy',
            name,
            status: 'warning',
            message: tr(lang, '本地端口转发已关闭（当前使用远端代理网关）', 'Local port forwarding disabled (using remote proxy gateway)'),
            suggestion: tr(lang, '如需通过本机代理接入，请开启「启用转发」设置。', 'Enable "enableLocalForwarding" to tunnel from your local proxy.')
        };
    }

    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);

        socket.on('connect', () => {
            socket.destroy();
            resolve({
                id: 'local-proxy',
                name,
                status: 'success',
                message: tr(lang, `本地端口 ${port} 监听正常`, `Port ${port} is listening locally`)
            });
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve({
                id: 'local-proxy',
                name,
                status: 'error',
                message: tr(lang, `本地端口 ${port} 连接超时`, `Port ${port} connection timeout`),
                suggestion: tr(lang, `请检查本机代理客户端（Clash/V2Ray 等）是否在端口 ${port} 运行。`, `Check if your proxy client (Clash/V2Ray/etc.) is running on local port ${port}.`)
            });
        });

        socket.on('error', () => {
            socket.destroy();
            resolve({
                id: 'local-proxy',
                name,
                status: 'error',
                message: tr(lang, `本地端口 ${port} 不可达`, `Port ${port} is not reachable locally`),
                suggestion: tr(lang, `请启动本地代理软件（端口 ${port}）或调整「本地端口」配置。`, `Start your local proxy client on port ${port} or adjust "localProxyPort".`)
            });
        });

        socket.connect(port, '127.0.0.1');
    });
}

/**
 * Check SSH configuration (`~/.ssh/config`, `~/.ssh/config.antigravity`, and SSH keepalive).
 */
async function checkSshConfig(
    enableLocalForwarding: boolean,
    localPort: number,
    remotePort: number,
    lang: DiagnosticLang
): Promise<DiagnosticCheck> {
    const name = tr(lang, 'SSH 配置', 'SSH Configuration');
    if (!enableLocalForwarding) {
        return {
            id: 'ssh-config',
            name,
            status: 'warning',
            message: tr(lang, '已跳过 SSH 转发检查（未启用本地转发）', 'SSH forwarding skipped (local forwarding disabled)'),
            suggestion: tr(lang, '若直接使用远程端代理网关则无需配置。', 'Not needed when using a proxy directly on the remote server.')
        };
    }

    const sshDir = path.join(os.homedir(), '.ssh');
    const mainConfigPath = path.join(sshDir, 'config');
    const antiConfigPath = path.join(sshDir, 'config.antigravity');

    try {
        if (!fs.existsSync(mainConfigPath)) {
            return {
                id: 'ssh-config',
                name,
                status: 'error',
                message: tr(lang, '未找到 ~/.ssh/config', '~/.ssh/config not found'),
                suggestion: tr(lang, '请运行「Antigravity AGY Proxy: Enable Port Forwarding」生成 SSH 配置。', 'Run "Antigravity AGY Proxy: Enable Port Forwarding" to create SSH config.')
            };
        }

        const mainConfig = fs.readFileSync(mainConfigPath, 'utf-8');
        if (!mainConfig.includes('config.antigravity')) {
            return {
                id: 'ssh-config',
                name,
                status: 'error',
                message: tr(lang, '~/.ssh/config 中未引入 config.antigravity', 'config.antigravity is not included in ~/.ssh/config'),
                suggestion: tr(lang, '请运行「Antigravity AGY Proxy: Enable Port Forwarding」自动注入 Include 规则。', 'Run "Antigravity AGY Proxy: Enable Port Forwarding" to inject Include config.antigravity.')
            };
        }

        if (!fs.existsSync(antiConfigPath)) {
            return {
                id: 'ssh-config',
                name,
                status: 'error',
                message: tr(lang, '未找到 ~/.ssh/config.antigravity', '~/.ssh/config.antigravity not found'),
                suggestion: tr(lang, '请保存配置或运行「Enable Port Forwarding」生成隧道配置。', 'Save config or run "Enable Port Forwarding" to generate tunnel rules.')
            };
        }

        const antiConfig = fs.readFileSync(antiConfigPath, 'utf-8');
        const expectedForward = `RemoteForward ${remotePort} 127.0.0.1:${localPort}`;
        if (!antiConfig.includes(expectedForward)) {
            return {
                id: 'ssh-config',
                name,
                status: 'warning',
                message: tr(lang, `端口转发配置不匹配（期望 ${remotePort} -> 127.0.0.1:${localPort}）`, `RemoteForward mismatch (expected ${remotePort} -> 127.0.0.1:${localPort})`),
                suggestion: tr(lang, '请重新保存面板设置或执行「Enable Port Forwarding」同步。', 'Re-run "Enable Port Forwarding" to sync ~/.ssh/config.antigravity.')
            };
        }

        if (!antiConfig.includes('ServerAliveInterval')) {
            return {
                id: 'ssh-config',
                name,
                status: 'warning',
                message: tr(lang, `转发规则 ${remotePort} -> 127.0.0.1:${localPort} 正常（缺少 ServerAliveInterval 保活）`, `RemoteForward ${remotePort} -> 127.0.0.1:${localPort} OK (missing ServerAliveInterval keepalive)`),
                suggestion: tr(lang, '重新保存本地面板配置即可自动写入 ServerAliveInterval 30 与 ServerAliveCountMax 3。', 'Re-save settings or run "Enable Port Forwarding" to add ServerAliveInterval 30 & ServerAliveCountMax 3.')
            };
        }

        return {
            id: 'ssh-config',
            name,
            status: 'success',
            message: tr(lang, `RemoteForward ${remotePort} -> 127.0.0.1:${localPort} 且 SSH 保活已启用`, `RemoteForward ${remotePort} -> 127.0.0.1:${localPort} + SSH keepalive active`)
        };
    } catch (err) {
        return {
            id: 'ssh-config',
            name,
            status: 'error',
            message: tr(lang, `读取 SSH 配置失败: ${err}`, `Failed to inspect SSH config: ${err}`),
            suggestion: tr(lang, '请检查 ~/.ssh/config 与 ~/.ssh/config.antigravity 的文件权限。', 'Check file permissions on ~/.ssh/config and ~/.ssh/config.antigravity.')
        };
    }
}

/**
 * Check remote port forwarding / proxy gateway reachability and inspect listener details.
 */
async function checkRemoteForward(host: string, port: number, lang: DiagnosticLang): Promise<DiagnosticCheck> {
    const name = tr(lang, '远程端口转发', 'Remote Port Forwarding');
    const tcpReachable = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);

        socket.on('connect', () => {
            socket.destroy();
            resolve({ ok: true });
        });
        socket.on('timeout', () => {
            socket.destroy();
            resolve({ ok: false, error: 'timeout' });
        });
        socket.on('error', (err) => {
            socket.destroy();
            resolve({ ok: false, error: err.message });
        });

        socket.connect(port, host);
    });

    if (tcpReachable.ok) {
        let hasListener = false;
        try {
            const { stdout } = await execAsync(`ss -ltn "sport = :${port}" 2>/dev/null | tail -n +2`, { timeout: 2000 });
            hasListener = Boolean(stdout.trim());
        } catch {
            // ss optional
        }
        const listenerDetail = hasListener ? tr(lang, '（监听中）', ' (listener active)') : '';
        return {
            id: 'remote-forward',
            name,
            status: 'success',
            message: tr(lang, `${host}:${port} 远端连通正常${listenerDetail}`, `${host}:${port} is reachable on remote host${listenerDetail}`)
        };
    }

    const extraHint = tcpReachable.error === 'timeout'
        ? tr(lang, `连接 ${host}:${port} 超时，请检查防火墙或远端网关状态。`, `Connection to ${host}:${port} timed out. Check firewall or remote gateway availability.`)
        : tr(lang, '请确认已从本地窗口发起 SSH 连接、本地代理已启动且端口配置一致。', 'Ensure local forwarding is enabled, local proxy is running, and reconnect SSH from a local window.');

    return {
        id: 'remote-forward',
        name,
        status: 'error',
        message: tr(lang, `${host}:${port} 不可达 (${tcpReachable.error})`, `${host}:${port} is not reachable (${tcpReachable.error})`),
        suggestion: extraHint
    };
}

/**
 * Check mgraftcp-fakedns & libdnsredir status in a proxyMode-aware manner.
 */
async function checkMgraftcp(extensionPath: string, proxyMode: ProxyMode, lang: DiagnosticLang): Promise<DiagnosticCheck> {
    const name = tr(lang, 'mgraftcp-fakedns', 'mgraftcp-fakedns Binary');
    const { binaryPath, libPath } = findMgraftcpBinary(extensionPath);

    if (proxyMode === 'env-only') {
        return {
            id: 'mgraftcp',
            name,
            status: 'success',
            message: binaryPath
                ? tr(lang, `当前为 env-only 模式（已跳过 mgraftcp 与 FakeDNS，备选二进制就绪: ${path.basename(binaryPath)}）`, `Mode is env-only (mgraftcp & FakeDNS bypassed; binary standby: ${path.basename(binaryPath)})`)
                : tr(lang, '当前为 env-only 模式（已跳过 mgraftcp，零 ptrace/UDP 开销）', 'Mode is env-only (mgraftcp bypassed; zero ptrace/UDP overhead)')
        };
    }

    if (!binaryPath) {
        return {
            id: 'mgraftcp',
            name,
            status: 'error',
            message: tr(lang, `未找到 ${getExpectedArchBinary().binaryName}`, `${getExpectedArchBinary().binaryName} not found`),
            suggestion: tr(lang, '请重装扩展、运行「Setup Remote Environment」，或将代理模式切换为 env-only。', 'Reinstall extension, run "Setup Remote Environment", or switch proxyMode to "env-only".')
        };
    }

    try {
        fs.accessSync(binaryPath, fs.constants.X_OK);
    } catch {
        return {
            id: 'mgraftcp',
            name,
            status: 'warning',
            message: tr(lang, `已找到 ${binaryPath}，但缺少可执行权限`, `Binary found at ${binaryPath} but lacks +x permission`),
            suggestion: tr(lang, '请点击「一键排错」或运行 Setup 修复权限。', 'Run "Setup Remote Environment" or click "Auto Fix" to restore permissions.')
        };
    }

    if (proxyMode === 'mgraftcp-fakedns' && !libPath) {
        return {
            id: 'mgraftcp',
            name,
            status: 'warning',
            message: tr(lang, `${path.basename(binaryPath)} 就绪，但缺少 ${getExpectedArchBinary().libName}`, `${path.basename(binaryPath)} OK, but ${getExpectedArchBinary().libName} not found`),
            suggestion: tr(lang, '缺少 FakeDNS 依赖库，建议切换为 mgraftcp-no-fakedns。', 'FakeDNS LD_PRELOAD helper missing; switch to "mgraftcp-no-fakedns" or re-run Setup.')
        };
    }

    return {
        id: 'mgraftcp',
        name,
        status: 'success',
        message: tr(lang, `${path.basename(binaryPath)} 就绪（模式: ${proxyMode}）`, `${path.basename(binaryPath)} ready (mode: ${proxyMode})`)
    };
}

/**
 * Check wrapper scripts and `.bak` binaries for both `~/.gemini/bin/agy` and legacy `language_server_linux_*`.
 */
async function checkLanguageServerWrapper(
    expectedHost: string,
    expectedPort: number,
    expectedType: ProxyProtocol,
    expectedMode: ProxyMode,
    lang: DiagnosticLang
): Promise<DiagnosticCheck> {
    const name = tr(lang, '后端包装 (agy / LS)', 'Backend Wrapper (agy / LS)');
    const targets = discoverTargets();
    if (targets.length === 0) {
        return {
            id: 'ls-wrapper',
            name,
            status: 'error',
            message: tr(lang, '未找到 ~/.gemini/bin/agy 或旧版 language_server_linux_*', 'Neither ~/.gemini/bin/agy nor legacy language_server_linux_* found'),
            suggestion: tr(lang, '请等待 Antigravity 服务端初始化完成（或先配置 http.proxy 下载 agy）后再运行配置。', 'Wait for Antigravity server initialization or configure VS Code http.proxy first, then run Setup.')
        };
    }

    const expectedAddr = `${expectedHost}:${expectedPort}`;
    const issues: string[] = [];
    const warnings: string[] = [];
    const okLabels: string[] = [];

    for (const t of targets) {
        const label = t.targetType === 'agy' ? 'agy' : path.basename(t.targetPath);
        if (!t.isWrapper) {
            issues.push(tr(lang, `${label}: 尚未包装（原始二进制）`, `${label}: not wrapped (original binary)`));
            continue;
        }
        if (!t.hasBackup) {
            issues.push(tr(lang, `${label}: 缺少 .bak 原始备份`, `${label}: missing .bak original binary`));
            continue;
        }
        if (!t.hasMarker) {
            warnings.push(tr(lang, `${label}: 旧版包装脚本（待平滑升级）`, `${label}: legacy wrapper format (needs upgrade)`));
            continue;
        }
        if (t.proxyAddr !== expectedAddr) {
            warnings.push(tr(lang, `${label}: 地址=${t.proxyAddr}（期望 ${expectedAddr}）`, `${label}: addr=${t.proxyAddr} (expected ${expectedAddr})`));
            continue;
        }
        if (t.proxyType !== expectedType) {
            warnings.push(tr(lang, `${label}: 协议=${t.proxyType}（期望 ${expectedType}）`, `${label}: type=${t.proxyType} (expected ${expectedType})`));
            continue;
        }
        if (t.proxyMode !== expectedMode) {
            warnings.push(tr(lang, `${label}: 模式=${t.proxyMode}（期望 ${expectedMode}）`, `${label}: mode=${t.proxyMode} (expected ${expectedMode})`));
            continue;
        }
        okLabels.push(`${label} (v${t.version}, ${t.proxyMode})`);
    }

    if (issues.length > 0 && okLabels.length === 0) {
        return {
            id: 'ls-wrapper',
            name,
            status: 'error',
            message: issues.join('; '),
            suggestion: tr(lang, '请点击「一键排错」或运行 Setup 安装包装脚本。', 'Click "Auto Fix" or run "Setup Remote Environment" to install wrappers cleanly.')
        };
    }

    if (issues.length > 0 || warnings.length > 0) {
        return {
            id: 'ls-wrapper',
            name,
            status: 'warning',
            message: [...okLabels, ...issues, ...warnings].join(' | '),
            suggestion: tr(lang, '请点击「一键排错」同步最新包装配置。', 'Click "Auto Fix" or run Setup to sync wrappers with current settings.')
        };
    }

    return {
        id: 'ls-wrapper',
        name,
        status: 'success',
        message: tr(lang, `${okLabels.join(', ')} 已同步 -> ${expectedAddr} (${expectedType})`, `${okLabels.join(', ')} synced -> ${expectedAddr} (${expectedType})`)
    };
}

/**
 * Check running backend processes (`agy --hub` and legacy `language_server_linux_*`),
 * accurately distinguishing live active windows vs `PPID=1` orphaned processes.
 */
async function checkLanguageServerProcess(
    expectedMode: ProxyMode,
    processes: BackendProcessInfo[] | undefined,
    lang: DiagnosticLang
): Promise<DiagnosticCheck> {
    const name = tr(lang, '后端进程 (agy / LS)', 'Backend Process (agy / LS)');
    const procs = processes ?? await inspectBackendProcesses();
    const mgProcs = await inspectAntigravityMgraftcpProcesses();

    if (procs.length === 0) {
        const orphanNote = mgProcs.length > 0
            ? tr(lang, `（发现 ${mgProcs.length} 个孤立 mgraftcp-fakedns 进程）`, ` (found ${mgProcs.length} orphan mgraftcp-fakedns process!)`)
            : '';
        return {
            id: 'ls-process',
            name,
            status: 'warning',
            message: tr(lang, `未检测到运行中的 agy 或 language_server 进程${orphanNote}`, `No running agy or language_server process found${orphanNote}`),
            suggestion: tr(lang, '触发一次 AI 对话或补全后会自动拉起；如有残留孤儿可点击「一键排错」。', 'Trigger any AI completion/chat or click "Auto Fix" to clear orphans.')
        };
    }

    const primary = procs[0];
    const targetLabel = primary.targetType === 'agy' ? 'agy --hub' : 'language_server';
    const modeNote = primary.detectedMode !== 'unknown'
        ? primary.detectedMode
        : (primary.isWrappedBak ? tr(lang, '已包装', 'wrapped') : tr(lang, '直连未包装', 'direct'));
    const fdStr = primary.fdCount >= 0 ? `${primary.fdCount} FDs` : tr(lang, 'FDs 未知', 'FDs unknown');

    const orphans = procs.filter(p => p.isOrphan);
    const activeNonOrphans = procs.filter(p => !p.isOrphan && p.targetType === primary.targetType);
    const unwrappedActive = activeNonOrphans.filter(p => !p.isUsingProxy);
    const modeMismatchActive = activeNonOrphans.filter(p => p.detectedMode !== 'unknown' && p.detectedMode !== expectedMode);

    // 1. Active primary process itself is NOT wrapped or has mode mismatch
    if (!primary.isUsingProxy) {
        return {
            id: 'ls-process',
            name,
            status: 'error',
            message: tr(
                lang,
                `${targetLabel} PID ${primary.pid} (${modeNote}, ${fdStr}) — 未经包装器代理启动`,
                `${targetLabel} PID ${primary.pid} (${modeNote}, ${fdStr}) — running unwrapped without proxy`
            ),
            suggestion: tr(lang, '请点击「一键排错」清理并重启后端（或重载窗口）以激活代理。', 'Click "Auto Fix" or reload window to restart cleanly under the active wrapper.')
        };
    }

    if (unwrappedActive.length > 0 || modeMismatchActive.length > 0) {
        const detail = unwrappedActive.length > 0
            ? tr(lang, `${unwrappedActive.length} 个活动进程未走代理`, `${unwrappedActive.length} active process(es) not using proxy`)
            : tr(lang, `运行模式为 ${modeMismatchActive[0].detectedMode}，与当前配置 ${expectedMode} 不一致`, `runtime mode is ${modeMismatchActive[0].detectedMode}, configured is ${expectedMode}`);
        return {
            id: 'ls-process',
            name,
            status: 'warning',
            message: `${targetLabel} PID ${primary.pid} (${modeNote}, ${fdStr}) — ${detail}`,
            suggestion: tr(lang, '请点击「一键排错」或重载窗口，使所有后端切换到当前模式。', 'Click "Auto Fix" or reload window to sync backend processes.')
        };
    }

    // 2. Active primary process is healthy, but PPID=1 orphan(s) remain from earlier sessions/reloads
    if (orphans.length > 0) {
        const orphanPids = orphans.map(o => o.pid).join(', ');
        return {
            id: 'ls-process',
            name,
            status: 'warning',
            message: tr(
                lang,
                `主进程正常 (${targetLabel} PID ${primary.pid}, ${modeNote}, ${fdStr})，但有 ${orphans.length} 个 PPID=1 历史残留孤儿进程 (${orphanPids})`,
                `Active backend OK (${targetLabel} PID ${primary.pid}, ${modeNote}, ${fdStr}), plus ${orphans.length} orphaned PPID=1 process(es) (${orphanPids})`
            ),
            suggestion: tr(
                lang,
                '点击「一键排错」将仅清理上述 PPID=1 残留进程，不会中断当前窗口的正常服务。',
                'Click "Auto Fix" to clean up only the orphaned PPID=1 processes without restarting your active window.'
            )
        };
    }

    // 3. Multiple healthy non-orphan processes (multi-window)
    if (activeNonOrphans.length > 1) {
        return {
            id: 'ls-process',
            name,
            status: 'success',
            message: tr(
                lang,
                `${targetLabel} PID ${primary.pid} (${modeNote}, ${fdStr}) — 共 ${activeNonOrphans.length} 个活动窗口后端均正常走代理`,
                `${targetLabel} PID ${primary.pid} (${modeNote}, ${fdStr}) — ${activeNonOrphans.length} active window processes all proxied`
            )
        };
    }

    return {
        id: 'ls-process',
        name,
        status: 'success',
        message: tr(
            lang,
            `${targetLabel} PID ${primary.pid} (${modeNote}, ${fdStr}) — 运行正常`,
            `${targetLabel} PID ${primary.pid} (${modeNote}, ${fdStr}) — active and healthy`
        )
    };
}

/**
 * Inspect per-process FD counts, system UDP ephemeral port usage, server log errors,
 * and crontab FD Guard status.
 */
async function checkFdAndUdpHealth(
    expectedMode: ProxyMode,
    fdThreshold: number,
    processes: BackendProcessInfo[] | undefined,
    lang: DiagnosticLang,
    precomputedHealth?: UdpHealthInfo
): Promise<DiagnosticCheck> {
    const name = tr(lang, 'FD 与 UDP 句柄健康', 'FD & UDP Port Health');
    const health = precomputedHealth ?? await inspectUdpAndFdHealth(processes, Math.min(fdThreshold, 2000));
    const guard = await getFdGuardStatus();

    const pct = Math.round(health.udpUsageRatio * 100);
    const guardText = guard.installed
        ? tr(lang, `FD 守护运行中 (每${guard.intervalMinutes ?? '?'}分钟, >${guard.threshold ?? '?'})`, `FD Guard active (*/${guard.intervalMinutes ?? '?'}m >${guard.threshold ?? '?'})`)
        : tr(lang, 'FD 守护未启用', 'FD Guard not installed');

    const baseMsg = tr(
        lang,
        `最大进程 FD: ${health.maxBackendFdCount} | UDP 套接字: ${health.udpSocketsTotal}/${health.ephemeralCapacity} (${pct}%) | ${guardText}`,
        `Max backend FDs: ${health.maxBackendFdCount} | UDP sockets: ${health.udpSocketsTotal}/${health.ephemeralCapacity} (${pct}%) | ${guardText}`
    );

    if (
        health.maxBackendFdCount >= fdThreshold ||
        health.udpUsageRatio >= 0.7 ||
        health.recentLogErrors.tooManyOpenFiles ||
        health.recentLogErrors.fakednsBindFailed
    ) {
        const reasons: string[] = [];
        if (health.maxBackendFdCount >= fdThreshold) {
            reasons.push(tr(lang, `FD 数 >= ${fdThreshold}`, `FD count >= ${fdThreshold}`));
        }
        if (health.udpUsageRatio >= 0.7) {
            reasons.push(tr(lang, `UDP 临时端口占用 ${pct}%`, `UDP ephemeral ports ${pct}% full`));
        }
        if (health.recentLogErrors.fakednsBindFailed) {
            reasons.push(tr(lang, '日志出现 FakeDNS UDP 绑定失败', 'FakeDNS UDP bind error in recent logs'));
        }
        if (health.recentLogErrors.tooManyOpenFiles) {
            reasons.push(tr(lang, '日志出现 too many open files', '"too many open files" in recent logs'));
        }
        return {
            id: 'fd-udp-health',
            name,
            status: 'error',
            message: `${reasons.join('，')} (${baseMsg})`,
            suggestion: tr(lang, '请点击「一键排错」终止泄漏进程、禁用 FakeDNS 并启用 FD 守护。', 'Click "Auto Fix" to kill leaking processes, disable FakeDNS, and enable FD Guard.')
        };
    }

    if (
        health.highFdProcesses.length > 0 ||
        health.udpUsageRatio >= 0.3 ||
        health.recentLogErrors.dnsTempFailure ||
        (expectedMode === 'mgraftcp-fakedns' && !guard.installed)
    ) {
        const notes: string[] = [];
        if (health.highFdProcesses.length > 0) {
            notes.push(tr(lang, `FD 偏高 (${health.maxBackendFdCount})`, `elevated FDs (${health.maxBackendFdCount})`));
        }
        if (health.recentLogErrors.dnsTempFailure) {
            notes.push(tr(lang, '近期日志出现 DNS 解析失败', 'DNS resolution failures seen in logs'));
        }
        if (expectedMode === 'mgraftcp-fakedns' && !guard.installed) {
            notes.push(tr(lang, 'FakeDNS 模式未开启 FD 守护', 'FakeDNS active without FD Guard'));
        }
        return {
            id: 'fd-udp-health',
            name,
            status: 'warning',
            message: `${notes.join('；')} — ${baseMsg}`,
            suggestion: tr(lang, '推荐使用 mgraftcp-no-fakedns 或 env-only 模式，并开启 FD 守护兜底。', 'Consider using "mgraftcp-no-fakedns" or "env-only" mode and enabling FD Guard.')
        };
    }

    return {
        id: 'fd-udp-health',
        name,
        status: 'success',
        message: baseMsg
    };
}

/**
 * Test direct remote DNS resolution to advise whether FakeDNS is actually needed.
 */
async function checkDirectDnsResolution(proxyMode: ProxyMode, lang: DiagnosticLang): Promise<DiagnosticCheck> {
    const name = tr(lang, 'DNS 解析健康', 'DNS Resolution Health');
    const testDomains = ['oauth2.googleapis.com', 'daily-cloudcode-pa.googleapis.com'];
    const started = Date.now();

    const lookupWithTimeout = async (host: string): Promise<string | null> => {
        try {
            const res = await Promise.race([
                dns.promises.lookup(host),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
            ]);
            return res.address;
        } catch {
            return null;
        }
    };

    const resolved = await Promise.all(testDomains.map(d => lookupWithTimeout(d)));
    const elapsedMs = Date.now() - started;
    const okCount = resolved.filter(Boolean).length;

    if (okCount === testDomains.length) {
        const advice = proxyMode === 'mgraftcp-fakedns'
            ? tr(lang, '服务器直连 DNS 解析正常，建议改用 mgraftcp-no-fakedns 或 env-only 以防止 FakeDNS UDP 泄漏。', 'Direct DNS works cleanly — recommend switching to "mgraftcp-no-fakedns" or "env-only" to prevent UDP leaks.')
            : undefined;
        return {
            id: 'dns-resolution',
            name,
            status: proxyMode === 'mgraftcp-fakedns' ? 'warning' : 'success',
            message: tr(
                lang,
                `${okCount}/${testDomains.length} 个 Google 域名直连解析成功，耗时 ${elapsedMs}ms (${resolved[0]})`,
                `Resolved ${okCount}/${testDomains.length} Google endpoints in ${elapsedMs}ms (${resolved[0]})`
            ),
            suggestion: advice
        };
    }

    if (okCount > 0) {
        return {
            id: 'dns-resolution',
            name,
            status: 'warning',
            message: tr(
                lang,
                `部分域名直连解析成功 (${okCount}/${testDomains.length}，耗时 ${elapsedMs}ms)`,
                `Partial DNS resolution (${okCount}/${testDomains.length} resolved in ${elapsedMs}ms)`
            ),
            suggestion: tr(lang, '若遇到 TLS 或连接异常，建议改用 socks5h 协议由代理端解析 DNS。', 'If connections fail, try "socks5h" protocol or enable FD Guard when using FakeDNS.')
        };
    }

    return {
        id: 'dns-resolution',
        name,
        status: 'warning',
        message: tr(lang, '服务器直连 DNS 解析失败或超时', 'Direct server DNS lookup failed/timed out'),
        suggestion: tr(lang, '建议使用 http 或 socks5h 代理协议（由远端代理代为解析域名）。', 'Use "http" or "socks5h" proxy protocol (remote DNS resolution via proxy) instead of direct DNS.')
    };
}

/**
 * Test external connectivity through HTTP, SOCKS5, and SOCKS5H protocols.
 */
async function checkExternalConnectivity(
    host: string,
    port: number,
    currentProtocol: ProxyProtocol,
    lang: DiagnosticLang
): Promise<DiagnosticCheck> {
    const name = tr(lang, '外部连接', 'External Connectivity');
    const testProtocol = async (protocol: ProxyProtocol): Promise<ProtocolTestResult> => {
        const proxyFlag = protocol === 'http'
            ? `-x http://${host}:${port}`
            : protocol === 'socks5h'
                ? `--socks5-hostname ${host}:${port}`
                : `--socks5 ${host}:${port}`;

        const cmd = `curl -s -o /dev/null -w "%{http_code}" --max-time 8 ${proxyFlag} https://www.google.com/generate_204 2>&1`;

        try {
            const { stdout } = await execAsync(cmd, { timeout: 10000 });
            const code = stdout.trim();
            if (code === '204' || code === '200') {
                return { protocol, success: true, httpCode: code, isCurrent: protocol === currentProtocol };
            }
            return { protocol, success: false, httpCode: code, error: `HTTP ${code}`, isCurrent: protocol === currentProtocol };
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { protocol, success: false, error: message, isCurrent: protocol === currentProtocol };
        }
    };

    const results = await Promise.all(ALL_PROTOCOLS.map(p => testProtocol(p)));
    const currentResult = results.find(r => r.isCurrent);
    const workingOthers = results.filter(r => !r.isCurrent && r.success);
    const allFailed = results.every(r => !r.success);

    let status: 'success' | 'warning' | 'error';
    let message: string;
    let suggestion: string | undefined;

    if (currentResult?.success) {
        status = 'success';
        message = tr(lang, `${currentProtocol.toUpperCase()} 代理连通 Google 正常 (HTTP ${currentResult.httpCode})`, `${currentProtocol.toUpperCase()} proxy connected to Google (HTTP ${currentResult.httpCode})`);
    } else if (workingOthers.length > 0) {
        status = 'warning';
        const workingNames = workingOthers.map(r => r.protocol.toUpperCase()).join(', ');
        message = tr(lang, `当前 ${currentProtocol.toUpperCase()} 不通，但 ${workingNames} 可用`, `Current ${currentProtocol.toUpperCase()} failed, but ${workingNames} succeeded`);
        suggestion = tr(lang, `请点击「一键排错」或将代理类型切换为 ${workingOthers[0].protocol.toUpperCase()}。`, `Click "Auto Fix" or switch Proxy Type to ${workingOthers[0].protocol.toUpperCase()}.`);
    } else if (allFailed) {
        status = 'error';
        message = tr(lang, '所有代理协议 (HTTP / SOCKS5 / SOCKS5H) 均无法访问 Google', 'All proxy protocols (HTTP, SOCKS5, SOCKS5H) failed to reach Google');
        suggestion = tr(lang, `请检查端口转发 (${host}:${port})、本地代理外网连通性以及防火墙规则。`, `Verify port forwarding (${host}:${port}), upstream proxy internet access, and firewall rules.`);
    } else {
        status = 'warning';
        message = tr(lang, '外部连接状态异常', 'External connectivity partially available');
    }

    return {
        id: 'external-connectivity',
        name,
        status,
        message,
        suggestion,
        protocolResults: results,
        currentProtocol
    };
}

/**
 * Run all local diagnostics.
 */
export async function runLocalDiagnostics(
    enableLocalForwarding: boolean,
    localPort: number,
    remotePort: number,
    onCheckUpdate?: (check: DiagnosticCheck) => void,
    lang: DiagnosticLang = 'en'
): Promise<DiagnosticCheck[]> {
    const checks: DiagnosticCheck[] = [];

    const run = async (fn: () => Promise<DiagnosticCheck>, id: string, name: string) => {
        onCheckUpdate?.({ id, name, status: 'running' });
        const result = await fn();
        checks.push(result);
        onCheckUpdate?.(result);
    };

    await run(() => checkLocalProxy(localPort, enableLocalForwarding, lang), 'local-proxy', tr(lang, '本地代理服务', 'Local Proxy Service'));
    await run(() => checkSshConfig(enableLocalForwarding, localPort, remotePort, lang), 'ssh-config', tr(lang, 'SSH 配置', 'SSH Configuration'));

    return checks;
}

/**
 * Run all remote diagnostics cleanly across legacy and `agy` targets.
 */
export async function runRemoteDiagnostics(
    remoteHost: string,
    remotePort: number,
    proxyType: string,
    proxyMode: string,
    extensionPath: string,
    fdGuardThreshold = 10000,
    onCheckUpdate?: (check: DiagnosticCheck) => void,
    lang: DiagnosticLang = 'en'
): Promise<DiagnosticCheck[]> {
    const normalizedType = normalizeProtocol(proxyType);
    const normalizedMode = normalizeProxyMode(proxyMode);
    const checks: DiagnosticCheck[] = [];

    const procs = await inspectBackendProcesses();

    const run = async (fn: () => Promise<DiagnosticCheck>, id: string, name: string) => {
        onCheckUpdate?.({ id, name, status: 'running' });
        const result = await fn();
        checks.push(result);
        onCheckUpdate?.(result);
    };

    await run(() => checkRemoteForward(remoteHost, remotePort, lang), 'remote-forward', tr(lang, '远程端口转发', 'Remote Port Forwarding'));
    await run(() => checkMgraftcp(extensionPath, normalizedMode, lang), 'mgraftcp', 'mgraftcp-fakedns');
    await run(
        () => checkLanguageServerWrapper(remoteHost, remotePort, normalizedType, normalizedMode, lang),
        'ls-wrapper',
        tr(lang, '后端包装 (agy / LS)', 'Backend Wrapper (agy / LS)')
    );
    await run(() => checkLanguageServerProcess(normalizedMode, procs, lang), 'ls-process', tr(lang, '后端进程 (agy / LS)', 'Backend Process (agy / LS)'));
    await run(
        () => checkFdAndUdpHealth(normalizedMode, fdGuardThreshold, procs, lang),
        'fd-udp-health',
        tr(lang, 'FD 与 UDP 句柄健康', 'FD & UDP Port Health')
    );
    await run(() => checkDirectDnsResolution(normalizedMode, lang), 'dns-resolution', tr(lang, 'DNS 解析健康', 'DNS Resolution Health'));
    await run(
        () => checkExternalConnectivity(remoteHost, remotePort, normalizedType, lang),
        'external-connectivity',
        tr(lang, '外部连接', 'External Connectivity')
    );

    return checks;
}

/**
 * Run complete diagnostics (local + remote metadata structure).
 */
export async function runAllDiagnostics(
    isRemote: boolean,
    enableLocalForwarding: boolean,
    localPort: number,
    remoteHost: string,
    remotePort: number,
    proxyType: string,
    proxyMode: string,
    extensionPath: string,
    fdGuardThreshold = 10000,
    onProgress?: (checks: DiagnosticCheck[]) => void,
    lang: DiagnosticLang = 'en'
): Promise<DiagnosticReport> {
    const checks: DiagnosticCheck[] = [
        { id: 'local-proxy', name: tr(lang, '本地代理服务', 'Local Proxy Service'), status: 'pending' },
        { id: 'ssh-config', name: tr(lang, 'SSH 配置', 'SSH Configuration'), status: 'pending' },
        { id: 'remote-forward', name: tr(lang, '远程端口转发', 'Remote Port Forwarding'), status: 'pending' },
        { id: 'mgraftcp', name: 'mgraftcp-fakedns', status: 'pending' },
        { id: 'ls-wrapper', name: tr(lang, '后端包装 (agy / LS)', 'Backend Wrapper (agy / LS)'), status: 'pending' },
        { id: 'ls-process', name: tr(lang, '后端进程 (agy / LS)', 'Backend Process (agy / LS)'), status: 'pending' },
        { id: 'fd-udp-health', name: tr(lang, 'FD 与 UDP 句柄健康', 'FD & UDP Port Health'), status: 'pending' },
        { id: 'dns-resolution', name: tr(lang, 'DNS 解析健康', 'DNS Resolution Health'), status: 'pending' },
        { id: 'external-connectivity', name: tr(lang, '外部连接', 'External Connectivity'), status: 'pending' }
    ];

    const updateCheck = (updated: DiagnosticCheck) => {
        const idx = checks.findIndex(c => c.id === updated.id);
        if (idx !== -1) {
            checks[idx] = updated;
        }
        onProgress?.([...checks]);
    };

    if (!isRemote) {
        await runLocalDiagnostics(enableLocalForwarding, localPort, remotePort, updateCheck, lang);
    } else {
        await runRemoteDiagnostics(
            remoteHost,
            remotePort,
            proxyType,
            proxyMode,
            extensionPath,
            fdGuardThreshold,
            updateCheck,
            lang
        );
    }

    const hasError = checks.some(c => c.status === 'error');
    const hasWarning = checks.some(c => c.status === 'warning');

    return {
        timestamp: new Date().toISOString(),
        environment: isRemote ? 'remote' : 'local',
        checks,
        overallStatus: hasError ? 'error' : (hasWarning ? 'warning' : 'healthy'),
        lang
    };
}

/**
 * Automatic troubleshooting & remediation workflow for remote Antigravity proxy issues:
 * 1. Surgically terminates `PPID=1` orphaned processes without disrupting healthy active backends.
 * 2. Kills leaking/unwrapped backends or switches off `mgraftcp-fakedns` on UDP/FD crashes.
 * 3. Switches proxyType when current protocol fails and another (HTTP/SOCKS5/SOCKS5H) works.
 * 4. Installs/updates the rootless FD Guard cron when configured or after leak recovery.
 * 5. Syncs wrappers via `setup-proxy.sh`.
 */
export async function runAutoFix(input: AutoFixInput): Promise<AutoFixResult> {
    const lang: DiagnosticLang = input.lang ?? 'en';
    const actions: string[] = [];
    const remainingIssues: string[] = [];
    let changedConfig = false;
    let needsReload = false;

    let effectiveType: ProxyProtocol = normalizeProtocol(input.proxyType);
    let effectiveMode: ProxyMode = normalizeProxyMode(input.proxyMode);

    const [procs, mgOrphans, connCheck, dnsCheck] = await Promise.all([
        inspectBackendProcesses(),
        inspectAntigravityMgraftcpProcesses(),
        checkExternalConnectivity(input.proxyHost, input.proxyPort, effectiveType, lang),
        checkDirectDnsResolution(effectiveMode, lang)
    ]);

    const udpHealth = await inspectUdpAndFdHealth(procs, Math.min(input.fdGuardThreshold, 2000));
    const hasLeakOrBindCrash =
        udpHealth.maxBackendFdCount >= Math.min(input.fdGuardThreshold, 5000) ||
        udpHealth.udpUsageRatio >= 0.4 ||
        udpHealth.recentLogErrors.fakednsBindFailed ||
        udpHealth.recentLogErrors.tooManyOpenFiles;

    // 1. Mitigate FakeDNS UDP/FD exhaustion
    if (effectiveMode === 'mgraftcp-fakedns' && hasLeakOrBindCrash) {
        const directDnsHealthy = dnsCheck.status === 'success' || dnsCheck.status === 'warning' && !dnsCheck.message?.includes('失败') && !dnsCheck.message?.includes('failed');
        if (directDnsHealthy) {
            effectiveMode = 'mgraftcp-no-fakedns';
            await input.updateConfig('proxyMode', effectiveMode);
            changedConfig = true;
            actions.push(tr(lang, '已将代理模式从 mgraftcp-fakedns 切换为 mgraftcp-no-fakedns 以消除 UDP/FD 泄漏', 'Switched proxyMode from mgraftcp-fakedns to mgraftcp-no-fakedns to stop UDP/FD leaks'));
        } else {
            effectiveMode = 'env-only';
            await input.updateConfig('proxyMode', effectiveMode);
            changedConfig = true;
            actions.push(tr(lang, 'FakeDNS 异常，已切换为 env-only 纯环境变量模式', 'Switched proxyMode from mgraftcp-fakedns to env-only after FakeDNS failure'));
        }
    }

    // 2. Surgically clean up orphans first vs full restart when active backends are broken
    const orphans = procs.filter(p => p.isOrphan);
    const activeProcs = procs.filter(p => !p.isOrphan);
    const hasUnwrappedActive = activeProcs.some(p => !p.isUsingProxy);
    const hasModeMismatchActive = activeProcs.some(p => p.detectedMode !== 'unknown' && p.detectedMode !== effectiveMode);

    if (hasLeakOrBindCrash || hasUnwrappedActive || hasModeMismatchActive || (mgOrphans.length > 0 && activeProcs.length === 0)) {
        const killResult = await killBackendProcesses();
        if (killResult.killedPids.length > 0 || killResult.killedMgraftcpPids.length > 0) {
            needsReload = true;
            actions.push(tr(
                lang,
                `已终止 ${killResult.killedPids.length} 个后端进程与 ${killResult.killedMgraftcpPids.length} 个 mgraftcp 进程`,
                `Terminated ${killResult.killedPids.length} backend and ${killResult.killedMgraftcpPids.length} mgraftcp process(es)`
            ));
        }
    } else if (orphans.length > 0) {
        // Active process is healthy — surgically kill ONLY PPID=1 orphan processes without forcing window reload
        const orphanIds = orphans.map(o => o.pid);
        const killResult = await killBackendProcesses({ pidsOnly: orphanIds });
        if (killResult.killedPids.length > 0) {
            actions.push(tr(
                lang,
                `已清理 ${killResult.killedPids.length} 个 PPID=1 残留孤儿进程 (${killResult.killedPids.join(', ')})，当前活动后端保持运行`,
                `Cleaned up ${killResult.killedPids.length} orphaned PPID=1 process(es) (${killResult.killedPids.join(', ')}); active backend kept running`
            ));
        }
    }

    // 3. Auto-switch protocol if current fails and an alternative succeeds
    const currentProtoResult = connCheck.protocolResults?.find(r => r.protocol === effectiveType);
    if (currentProtoResult && !currentProtoResult.success && connCheck.protocolResults) {
        const preferredOrder: ProxyProtocol[] = ['http', 'socks5h', 'socks5'];
        const working = preferredOrder
            .map(proto => connCheck.protocolResults?.find(r => r.protocol === proto))
            .find(res => res && res.success);

        if (working && working.protocol !== effectiveType) {
            effectiveType = working.protocol;
            await input.updateConfig('proxyType', effectiveType);
            changedConfig = true;
            actions.push(tr(lang, `已自动将代理协议切换为验证可用的 ${effectiveType.toUpperCase()}`, `Switched proxyType to ${effectiveType.toUpperCase()} (verified reachable)`));
        } else if (!working) {
            remainingIssues.push(tr(lang, `远端代理 ${input.proxyHost}:${input.proxyPort} 的 HTTP/SOCKS5/SOCKS5H 测试均失败。`, `Remote proxy ${input.proxyHost}:${input.proxyPort} failed HTTP/SOCKS5/SOCKS5H external tests.`));
        }
    }

    // 4. Install or refresh FD Guard cron if enabled or after leak recovery
    const guardStatus = await getFdGuardStatus();
    if (input.enableFdGuard || hasLeakOrBindCrash) {
        if (!input.enableFdGuard && hasLeakOrBindCrash) {
            await input.updateConfig('enableFdGuard', true);
            changedConfig = true;
        }
        const installRes = await installFdGuard(input.fdGuardIntervalMinutes, input.fdGuardThreshold);
        if (installRes.success) {
            if (!guardStatus.installed) {
                actions.push(tr(lang, `已安装 Crontab FD 守护（每 ${input.fdGuardIntervalMinutes} 分钟，阈值 >${input.fdGuardThreshold}）`, `Installed crontab FD Guard (every ${input.fdGuardIntervalMinutes}m, threshold >${input.fdGuardThreshold})`));
            } else {
                actions.push(tr(lang, `已校验 Crontab FD 守护状态（阈值 >${input.fdGuardThreshold}）`, `Verified crontab FD Guard (threshold >${input.fdGuardThreshold})`));
            }
        } else if (installRes.error) {
            remainingIssues.push(tr(lang, `安装 FD 守护失败: ${installRes.error}`, `Could not install FD Guard cron: ${installRes.error}`));
        }
    }

    // 5. Ensure wrappers & mgraftcp binaries match final effective config
    const wrapperCheck = await checkLanguageServerWrapper(
        input.proxyHost,
        input.proxyPort,
        effectiveType,
        effectiveMode,
        lang
    );
    if (changedConfig || wrapperCheck.status !== 'success') {
        const setupOk = await input.runSetup(input.proxyHost, input.proxyPort, effectiveType, effectiveMode);
        if (setupOk) {
            needsReload = true;
            actions.push(tr(lang, `已更新远端包装脚本 (${input.proxyHost}:${input.proxyPort}, ${effectiveType}, ${effectiveMode})`, `Updated remote wrappers (${input.proxyHost}:${input.proxyPort}, ${effectiveType}, ${effectiveMode})`));
        } else {
            remainingIssues.push(tr(lang, '包装脚本安装失败，请查看 Output -> Antigravity AGY Proxy 日志。', 'Wrapper setup script reported a failure; inspect Antigravity AGY Proxy output channel.'));
        }
    }

    if (actions.length === 0 && remainingIssues.length === 0) {
        actions.push(tr(lang, '所有检查均健康，无需额外修复。', 'All checks look healthy; no remediation needed.'));
    }

    return {
        actions,
        changedConfig,
        needsReload,
        remainingIssues
    };
}

/**
 * Generate a plain-text / Markdown diagnostic report suitable for clipboard sharing.
 */
export function generateReportText(report: DiagnosticReport, langOverride?: DiagnosticLang): string {
    const lang: DiagnosticLang = langOverride ?? report.lang ?? 'en';
    const statusEmoji: Record<string, string> = {
        success: '✅ PASS',
        warning: '⚠️ WARN',
        error: '❌ FAIL',
        pending: '⏳ PENDING',
        running: '🔄 RUNNING'
    };

    const lines: string[] = [
        '========================================',
        tr(lang, 'Antigravity AGY Proxy 诊断报告', 'Antigravity AGY Proxy Diagnostic Report'),
        '========================================',
        `Timestamp   : ${report.timestamp}`,
        `Environment : ${report.environment}`,
        `Overall     : ${report.overallStatus.toUpperCase()}`,
        '----------------------------------------'
    ];

    for (const check of report.checks) {
        const badge = statusEmoji[check.status] || check.status.toUpperCase();
        lines.push(`[${badge}] ${check.name} (${check.id})`);
        if (check.message) {
            lines.push(`  Message   : ${check.message}`);
        }
        if (check.protocolResults && check.protocolResults.length > 0) {
            for (const p of check.protocolResults) {
                const okStr = p.success ? `OK (${p.httpCode || '204'})` : `FAIL (${p.error || p.httpCode || 'unknown'})`;
                lines.push(`  - ${p.protocol.toUpperCase()}: ${okStr}${p.isCurrent ? ' [current]' : ''}`);
            }
        }
        if (check.suggestion) {
            lines.push(`  Suggestion: ${check.suggestion}`);
        }
    }

    lines.push('========================================');
    return lines.join('\n');
}
