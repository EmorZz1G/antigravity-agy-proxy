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
async function checkLocalProxy(port: number, enableLocalForwarding: boolean): Promise<DiagnosticCheck> {
    if (!enableLocalForwarding) {
        return {
            id: 'local-proxy',
            name: 'Local Proxy Service',
            status: 'warning',
            message: 'Local port forwarding disabled (using remote proxy gateway)',
            suggestion: 'Enable "enableLocalForwarding" if you want SSH tunnel forwarding from localhost.'
        };
    }

    return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);

        socket.on('connect', () => {
            socket.destroy();
            resolve({
                id: 'local-proxy',
                name: 'Local Proxy Service',
                status: 'success',
                message: `Port ${port} is listening locally`
            });
        });

        socket.on('timeout', () => {
            socket.destroy();
            resolve({
                id: 'local-proxy',
                name: 'Local Proxy Service',
                status: 'error',
                message: `Port ${port} connection timeout`,
                suggestion: `Check if your proxy client (Clash/V2Ray/etc.) is running on local port ${port}.`
            });
        });

        socket.on('error', () => {
            socket.destroy();
            resolve({
                id: 'local-proxy',
                name: 'Local Proxy Service',
                status: 'error',
                message: `Port ${port} is not reachable locally`,
                suggestion: `Start your local proxy client on port ${port} or adjust "localProxyPort".`
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
    remotePort: number
): Promise<DiagnosticCheck> {
    if (!enableLocalForwarding) {
        return {
            id: 'ssh-config',
            name: 'SSH Configuration',
            status: 'warning',
            message: 'SSH forwarding skipped (local forwarding disabled)',
            suggestion: 'Not needed when using a proxy directly on the remote server.'
        };
    }

    const sshDir = path.join(os.homedir(), '.ssh');
    const mainConfigPath = path.join(sshDir, 'config');
    const antiConfigPath = path.join(sshDir, 'config.antigravity');

    try {
        if (!fs.existsSync(mainConfigPath)) {
            return {
                id: 'ssh-config',
                name: 'SSH Configuration',
                status: 'error',
                message: '~/.ssh/config not found',
                suggestion: 'Run "Antigravity AGY Proxy: Enable Port Forwarding" to create SSH config.'
            };
        }

        const mainConfig = fs.readFileSync(mainConfigPath, 'utf-8');
        if (!mainConfig.includes('config.antigravity')) {
            return {
                id: 'ssh-config',
                name: 'SSH Configuration',
                status: 'error',
                message: 'config.antigravity is not included in ~/.ssh/config',
                suggestion: 'Run "Antigravity AGY Proxy: Enable Port Forwarding" to inject Include config.antigravity.'
            };
        }

        if (!fs.existsSync(antiConfigPath)) {
            return {
                id: 'ssh-config',
                name: 'SSH Configuration',
                status: 'error',
                message: '~/.ssh/config.antigravity not found',
                suggestion: 'Run "Antigravity AGY Proxy: Enable Port Forwarding" to generate tunnel rules.'
            };
        }

        const antiConfig = fs.readFileSync(antiConfigPath, 'utf-8');
        const expectedForward = `RemoteForward ${remotePort} 127.0.0.1:${localPort}`;
        if (!antiConfig.includes(expectedForward)) {
            return {
                id: 'ssh-config',
                name: 'SSH Configuration',
                status: 'warning',
                message: `RemoteForward mismatch (expected ${remotePort} -> 127.0.0.1:${localPort})`,
                suggestion: 'Re-run "Enable Port Forwarding" to sync ~/.ssh/config.antigravity.'
            };
        }

        if (!antiConfig.includes('ServerAliveInterval')) {
            return {
                id: 'ssh-config',
                name: 'SSH Configuration',
                status: 'warning',
                message: `RemoteForward ${remotePort} -> 127.0.0.1:${localPort} OK (missing ServerAliveInterval keepalive)`,
                suggestion: 'Re-save settings or run "Enable Port Forwarding" to add ServerAliveInterval 30 & ServerAliveCountMax 3.'
            };
        }

        return {
            id: 'ssh-config',
            name: 'SSH Configuration',
            status: 'success',
            message: `RemoteForward ${remotePort} -> 127.0.0.1:${localPort} + SSH keepalive active`
        };
    } catch (err) {
        return {
            id: 'ssh-config',
            name: 'SSH Configuration',
            status: 'error',
            message: `Failed to inspect SSH config: ${err}`,
            suggestion: 'Check file permissions on ~/.ssh/config and ~/.ssh/config.antigravity.'
        };
    }
}

/**
 * Check remote port forwarding / proxy gateway reachability and inspect listener details.
 */
async function checkRemoteForward(host: string, port: number): Promise<DiagnosticCheck> {
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
        let listenerDetail = '';
        try {
            const { stdout } = await execAsync(`ss -ltn "sport = :${port}" 2>/dev/null | tail -n +2`, { timeout: 2000 });
            const line = stdout.trim();
            if (line) {
                listenerDetail = ` (listener active)`;
            }
        } catch {
            // ss optional
        }
        return {
            id: 'remote-forward',
            name: 'Remote Port Forwarding',
            status: 'success',
            message: `${host}:${port} is reachable on remote host${listenerDetail}`
        };
    }

    // Check if stale sshd sessions exist when forwarding failed
    let extraHint = 'Ensure local forwarding is enabled, local proxy is running, and reconnect SSH.';
    if (tcpReachable.error === 'timeout') {
        extraHint = `Connection to ${host}:${port} timed out. Check firewall or remote gateway availability.`;
    }
    return {
        id: 'remote-forward',
        name: 'Remote Port Forwarding',
        status: 'error',
        message: `${host}:${port} is not reachable (${tcpReachable.error})`,
        suggestion: extraHint
    };
}

/**
 * Check mgraftcp-fakedns & libdnsredir status in a proxyMode-aware manner.
 */
async function checkMgraftcp(extensionPath: string, proxyMode: ProxyMode): Promise<DiagnosticCheck> {
    const { binaryPath, libPath } = findMgraftcpBinary(extensionPath);

    if (proxyMode === 'env-only') {
        return {
            id: 'mgraftcp',
            name: 'mgraftcp-fakedns Binary',
            status: 'success',
            message: binaryPath
                ? `Mode is env-only (mgraftcp & FakeDNS bypassed; binary standby at ${path.basename(binaryPath)})`
                : 'Mode is env-only (mgraftcp bypassed; zero ptrace/UDP overhead)'
        };
    }

    if (!binaryPath) {
        return {
            id: 'mgraftcp',
            name: 'mgraftcp-fakedns Binary',
            status: 'error',
            message: `${getExpectedArchBinary().binaryName} not found`,
            suggestion: 'Reinstall extension or run "Setup Remote Environment", or switch proxyMode to "env-only".'
        };
    }

    try {
        fs.accessSync(binaryPath, fs.constants.X_OK);
    } catch {
        return {
            id: 'mgraftcp',
            name: 'mgraftcp-fakedns Binary',
            status: 'warning',
            message: `Binary found at ${binaryPath} but lacks +x permission`,
            suggestion: 'Run "Setup Remote Environment" or "Auto Fix" to restore permissions.'
        };
    }

    if (proxyMode === 'mgraftcp-fakedns' && !libPath) {
        return {
            id: 'mgraftcp',
            name: 'mgraftcp-fakedns Binary',
            status: 'warning',
            message: `${path.basename(binaryPath)} OK, but ${getExpectedArchBinary().libName} not found`,
            suggestion: 'FakeDNS LD_PRELOAD helper missing; switch to "mgraftcp-no-fakedns" or re-run Setup.'
        };
    }

    return {
        id: 'mgraftcp',
        name: 'mgraftcp-fakedns Binary',
        status: 'success',
        message: `${path.basename(binaryPath)} ready (mode: ${proxyMode})`
    };
}

/**
 * Check wrapper scripts and `.bak` binaries for both `~/.gemini/bin/agy` and legacy `language_server_linux_*`.
 */
async function checkLanguageServerWrapper(
    expectedHost: string,
    expectedPort: number,
    expectedType: ProxyProtocol,
    expectedMode: ProxyMode
): Promise<DiagnosticCheck> {
    const targets = discoverTargets();
    if (targets.length === 0) {
        return {
            id: 'ls-wrapper',
            name: 'Backend Wrapper (agy / LS)',
            status: 'error',
            message: 'Neither ~/.gemini/bin/agy nor legacy language_server_linux_* found',
            suggestion: 'Wait for Antigravity IDE server initialization or configure VS Code http.proxy first, then run Setup.'
        };
    }

    const expectedAddr = `${expectedHost}:${expectedPort}`;
    const issues: string[] = [];
    const warnings: string[] = [];
    const okLabels: string[] = [];

    for (const t of targets) {
        const label = t.targetType === 'agy' ? 'agy' : path.basename(t.targetPath);
        if (!t.isWrapper) {
            issues.push(`${label}: not wrapped (original binary)`);
            continue;
        }
        if (!t.hasBackup) {
            issues.push(`${label}: missing .bak original binary`);
            continue;
        }
        if (!t.hasMarker) {
            warnings.push(`${label}: legacy wrapper format (needs upgrade)`);
            continue;
        }
        if (t.proxyAddr !== expectedAddr) {
            warnings.push(`${label}: addr=${t.proxyAddr} (expected ${expectedAddr})`);
            continue;
        }
        if (t.proxyType !== expectedType) {
            warnings.push(`${label}: type=${t.proxyType} (expected ${expectedType})`);
            continue;
        }
        if (t.proxyMode !== expectedMode) {
            warnings.push(`${label}: mode=${t.proxyMode} (expected ${expectedMode})`);
            continue;
        }
        okLabels.push(`${label} (v${t.version}, ${t.proxyMode})`);
    }

    if (issues.length > 0 && okLabels.length === 0) {
        return {
            id: 'ls-wrapper',
            name: 'Backend Wrapper (agy / LS)',
            status: 'error',
            message: issues.join('; '),
            suggestion: 'Run "Setup Remote Environment" or "Auto Fix" to install wrappers cleanly.'
        };
    }

    if (issues.length > 0 || warnings.length > 0) {
        return {
            id: 'ls-wrapper',
            name: 'Backend Wrapper (agy / LS)',
            status: 'warning',
            message: [...okLabels, ...issues, ...warnings].join(' | '),
            suggestion: 'Run "Setup Remote Environment" or "Auto Fix" to sync wrappers with current settings.'
        };
    }

    return {
        id: 'ls-wrapper',
        name: 'Backend Wrapper (agy / LS)',
        status: 'success',
        message: `${okLabels.join(', ')} synced -> ${expectedAddr} (${expectedType})`
    };
}

/**
 * Check running backend processes (`agy --hub` and legacy `language_server_linux_*`).
 */
async function checkLanguageServerProcess(
    expectedMode: ProxyMode,
    processes?: BackendProcessInfo[]
): Promise<DiagnosticCheck> {
    const procs = processes ?? await inspectBackendProcesses();
    const mgProcs = await inspectAntigravityMgraftcpProcesses();

    if (procs.length === 0) {
        const orphanNote = mgProcs.length > 0
            ? ` (found ${mgProcs.length} orphan mgraftcp-fakedns process!)`
            : '';
        return {
            id: 'ls-process',
            name: 'Backend Process (agy / LS)',
            status: 'warning',
            message: `No running agy or language_server process found${orphanNote}`,
            suggestion: 'Trigger any AI completion/chat or run Auto Fix to clear orphans and reload.'
        };
    }

    const activeAgy = procs.filter(p => p.targetType === 'agy');
    const activeLs = procs.filter(p => p.targetType === 'language_server');
    const primary = procs[0];
    const modeNote = primary.detectedMode !== 'unknown'
        ? primary.detectedMode
        : (primary.isWrappedBak ? 'wrapped' : 'direct');

    const warnings: string[] = [];
    if (activeAgy.length > 1) {
        warnings.push(`${activeAgy.length} agy --hub processes running (duplicate/zombie)`);
    }
    if (activeLs.length > 1) {
        warnings.push(`${activeLs.length} language_server processes running`);
    }
    if (!primary.isWrappedBak) {
        warnings.push('running unwrapped binary (proxy not active)');
    } else if (primary.detectedMode !== 'unknown' && primary.detectedMode !== expectedMode) {
        warnings.push(`runtime mode is ${primary.detectedMode}, configured is ${expectedMode}`);
    }

    const targetLabel = primary.targetType === 'agy' ? 'agy --hub' : 'language_server';
    const summary = `${targetLabel} PID ${primary.pid} (${modeNote}, ${primary.fdCount >= 0 ? `${primary.fdCount} FDs` : 'FDs unknown'})`;

    if (warnings.length > 0) {
        return {
            id: 'ls-process',
            name: 'Backend Process (agy / LS)',
            status: !primary.isWrappedBak ? 'error' : 'warning',
            message: `${summary} — ${warnings.join('; ')}`,
            suggestion: 'Click "Auto Fix" or reload window to restart cleanly under the active wrapper.'
        };
    }

    return {
        id: 'ls-process',
        name: 'Backend Process (agy / LS)',
        status: 'success',
        message: `${summary} — active and healthy`
    };
}

/**
 * Inspect per-process FD counts, system UDP ephemeral port usage, server log errors,
 * and crontab FD Guard status.
 */
async function checkFdAndUdpHealth(
    expectedMode: ProxyMode,
    fdThreshold: number,
    processes?: BackendProcessInfo[],
    precomputedHealth?: UdpHealthInfo
): Promise<DiagnosticCheck> {
    const health = precomputedHealth ?? await inspectUdpAndFdHealth(processes, Math.min(fdThreshold, 2000));
    const guard = await getFdGuardStatus();

    const pct = Math.round(health.udpUsageRatio * 100);
    const guardText = guard.installed
        ? `FD Guard active (*/${guard.intervalMinutes ?? '?'}m >${guard.threshold ?? '?'})`
        : 'FD Guard not installed';

    const baseMsg = `Max backend FDs: ${health.maxBackendFdCount} | UDP sockets: ${health.udpSocketsTotal}/${health.ephemeralCapacity} (${pct}%) | ${guardText}`;

    if (
        health.maxBackendFdCount >= fdThreshold ||
        health.udpUsageRatio >= 0.7 ||
        health.recentLogErrors.tooManyOpenFiles ||
        health.recentLogErrors.fakednsBindFailed
    ) {
        const reasons: string[] = [];
        if (health.maxBackendFdCount >= fdThreshold) {
            reasons.push(`FD count >= ${fdThreshold}`);
        }
        if (health.udpUsageRatio >= 0.7) {
            reasons.push(`UDP ephemeral ports ${pct}% full`);
        }
        if (health.recentLogErrors.fakednsBindFailed) {
            reasons.push('FakeDNS UDP bind error in recent logs');
        }
        if (health.recentLogErrors.tooManyOpenFiles) {
            reasons.push('"too many open files" in recent logs');
        }
        return {
            id: 'fd-udp-health',
            name: 'FD & UDP Port Health',
            status: 'error',
            message: `${reasons.join(', ')} (${baseMsg})`,
            suggestion: 'Click "Auto Fix" to kill leaking processes, disable FakeDNS (--disable-fakedns / env-only), and enable FD Guard.'
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
            notes.push(`elevated FDs (${health.maxBackendFdCount})`);
        }
        if (health.recentLogErrors.dnsTempFailure) {
            notes.push('DNS resolution failures seen in logs');
        }
        if (expectedMode === 'mgraftcp-fakedns' && !guard.installed) {
            notes.push('FakeDNS active without FD Guard');
        }
        return {
            id: 'fd-udp-health',
            name: 'FD & UDP Port Health',
            status: 'warning',
            message: `${notes.join('; ')} — ${baseMsg}`,
            suggestion: 'Consider using "mgraftcp-no-fakedns" or "env-only" mode and enabling FD Guard.'
        };
    }

    return {
        id: 'fd-udp-health',
        name: 'FD & UDP Port Health',
        status: 'success',
        message: baseMsg
    };
}

/**
 * Test direct remote DNS resolution to advise whether FakeDNS is actually needed.
 */
async function checkDirectDnsResolution(proxyMode: ProxyMode): Promise<DiagnosticCheck> {
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
            ? 'Direct DNS works cleanly — recommend switching to "mgraftcp-no-fakedns" or "env-only" to prevent UDP leaks.'
            : 'Direct DNS works cleanly (--disable-fakedns / env-only safe).';
        return {
            id: 'dns-resolution',
            name: 'DNS Resolution Health',
            status: proxyMode === 'mgraftcp-fakedns' ? 'warning' : 'success',
            message: `Resolved ${okCount}/${testDomains.length} Google endpoints in ${elapsedMs}ms (${resolved[0]})`,
            suggestion: proxyMode === 'mgraftcp-fakedns' ? advice : undefined
        };
    }

    if (okCount > 0) {
        return {
            id: 'dns-resolution',
            name: 'DNS Resolution Health',
            status: 'warning',
            message: `Partial DNS resolution (${okCount}/${testDomains.length} resolved in ${elapsedMs}ms)`,
            suggestion: 'If connections fail, try "socks5h" protocol or enable FD Guard when using FakeDNS.'
        };
    }

    return {
        id: 'dns-resolution',
        name: 'DNS Resolution Health',
        status: 'warning',
        message: 'Direct server DNS lookup failed/timed out',
        suggestion: 'Use "http" or "socks5h" proxy protocol (remote DNS resolution via proxy) instead of relying on direct DNS.'
    };
}

/**
 * Test external connectivity through HTTP, SOCKS5, and SOCKS5H protocols.
 */
async function checkExternalConnectivity(
    host: string,
    port: number,
    currentProtocol: ProxyProtocol
): Promise<DiagnosticCheck> {
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
        message = `${currentProtocol.toUpperCase()} proxy connected to Google (HTTP ${currentResult.httpCode})`;
    } else if (workingOthers.length > 0) {
        status = 'warning';
        const workingNames = workingOthers.map(r => r.protocol.toUpperCase()).join(', ');
        message = `Current ${currentProtocol.toUpperCase()} failed, but ${workingNames} succeeded`;
        suggestion = `Click "Auto Fix" or switch Proxy Type to ${workingOthers[0].protocol.toUpperCase()}.`;
    } else if (allFailed) {
        status = 'error';
        message = 'All proxy protocols (HTTP, SOCKS5, SOCKS5H) failed to reach Google';
        suggestion = `Verify port forwarding (${host}:${port}), upstream proxy internet access, and firewall rules.`;
    } else {
        status = 'warning';
        message = 'External connectivity partially available';
    }

    return {
        id: 'external-connectivity',
        name: 'External Connectivity',
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
    onCheckUpdate?: (check: DiagnosticCheck) => void
): Promise<DiagnosticCheck[]> {
    const checks: DiagnosticCheck[] = [];

    const run = async (fn: () => Promise<DiagnosticCheck>, id: string, name: string) => {
        onCheckUpdate?.({ id, name, status: 'running' });
        const result = await fn();
        checks.push(result);
        onCheckUpdate?.(result);
    };

    await run(() => checkLocalProxy(localPort, enableLocalForwarding), 'local-proxy', 'Local Proxy Service');
    await run(() => checkSshConfig(enableLocalForwarding, localPort, remotePort), 'ssh-config', 'SSH Configuration');

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
    onCheckUpdate?: (check: DiagnosticCheck) => void
): Promise<DiagnosticCheck[]> {
    const normalizedType = normalizeProtocol(proxyType);
    const normalizedMode = normalizeProxyMode(proxyMode);
    const checks: DiagnosticCheck[] = [];

    // Pre-fetch process list once so ls-process and fd-udp-health share the snapshot
    const procs = await inspectBackendProcesses();

    const run = async (fn: () => Promise<DiagnosticCheck>, id: string, name: string) => {
        onCheckUpdate?.({ id, name, status: 'running' });
        const result = await fn();
        checks.push(result);
        onCheckUpdate?.(result);
    };

    await run(() => checkRemoteForward(remoteHost, remotePort), 'remote-forward', 'Remote Port Forwarding');
    await run(() => checkMgraftcp(extensionPath, normalizedMode), 'mgraftcp', 'mgraftcp-fakedns Binary');
    await run(
        () => checkLanguageServerWrapper(remoteHost, remotePort, normalizedType, normalizedMode),
        'ls-wrapper',
        'Backend Wrapper (agy / LS)'
    );
    await run(() => checkLanguageServerProcess(normalizedMode, procs), 'ls-process', 'Backend Process (agy / LS)');
    await run(
        () => checkFdAndUdpHealth(normalizedMode, fdGuardThreshold, procs),
        'fd-udp-health',
        'FD & UDP Port Health'
    );
    await run(() => checkDirectDnsResolution(normalizedMode), 'dns-resolution', 'DNS Resolution Health');
    await run(
        () => checkExternalConnectivity(remoteHost, remotePort, normalizedType),
        'external-connectivity',
        'External Connectivity'
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
    onProgress?: (checks: DiagnosticCheck[]) => void
): Promise<DiagnosticReport> {
    const checks: DiagnosticCheck[] = [
        { id: 'local-proxy', name: 'Local Proxy Service', status: 'pending' },
        { id: 'ssh-config', name: 'SSH Configuration', status: 'pending' },
        { id: 'remote-forward', name: 'Remote Port Forwarding', status: 'pending' },
        { id: 'mgraftcp', name: 'mgraftcp-fakedns Binary', status: 'pending' },
        { id: 'ls-wrapper', name: 'Backend Wrapper (agy / LS)', status: 'pending' },
        { id: 'ls-process', name: 'Backend Process (agy / LS)', status: 'pending' },
        { id: 'fd-udp-health', name: 'FD & UDP Port Health', status: 'pending' },
        { id: 'dns-resolution', name: 'DNS Resolution Health', status: 'pending' },
        { id: 'external-connectivity', name: 'External Connectivity', status: 'pending' }
    ];

    const updateCheck = (updated: DiagnosticCheck) => {
        const idx = checks.findIndex(c => c.id === updated.id);
        if (idx !== -1) {
            checks[idx] = updated;
        }
        onProgress?.([...checks]);
    };

    if (!isRemote) {
        await runLocalDiagnostics(enableLocalForwarding, localPort, remotePort, updateCheck);
    } else {
        await runRemoteDiagnostics(
            remoteHost,
            remotePort,
            proxyType,
            proxyMode,
            extensionPath,
            fdGuardThreshold,
            updateCheck
        );
    }

    const hasError = checks.some(c => c.status === 'error');
    const hasWarning = checks.some(c => c.status === 'warning');

    return {
        timestamp: new Date().toISOString(),
        environment: isRemote ? 'remote' : 'local',
        checks,
        overallStatus: hasError ? 'error' : (hasWarning ? 'warning' : 'healthy')
    };
}

/**
 * Automatic troubleshooting & remediation workflow for remote Antigravity proxy issues:
 * 1. Terminates leaking/high-FD, duplicate, or orphan backend processes.
 * 2. Switches off `mgraftcp-fakedns` automatically if UDP/FD/FakeDNS exhaustion is detected.
 * 3. Switches proxyType when current protocol fails and another (HTTP/SOCKS5/SOCKS5H) works.
 * 4. Installs/updates the rootless FD Guard cron when configured or after leak recovery.
 * 5. Syncs wrappers via `setup-proxy.sh`.
 */
export async function runAutoFix(input: AutoFixInput): Promise<AutoFixResult> {
    const actions: string[] = [];
    const remainingIssues: string[] = [];
    let changedConfig = false;
    let needsReload = false;

    let effectiveType: ProxyProtocol = normalizeProtocol(input.proxyType);
    let effectiveMode: ProxyMode = normalizeProxyMode(input.proxyMode);

    const [procs, mgOrphans, connCheck, dnsCheck] = await Promise.all([
        inspectBackendProcesses(),
        inspectAntigravityMgraftcpProcesses(),
        checkExternalConnectivity(input.proxyHost, input.proxyPort, effectiveType),
        checkDirectDnsResolution(effectiveMode)
    ]);

    const udpHealth = await inspectUdpAndFdHealth(procs, Math.min(input.fdGuardThreshold, 2000));
    const hasLeakOrBindCrash =
        udpHealth.maxBackendFdCount >= Math.min(input.fdGuardThreshold, 5000) ||
        udpHealth.udpUsageRatio >= 0.4 ||
        udpHealth.recentLogErrors.fakednsBindFailed ||
        udpHealth.recentLogErrors.tooManyOpenFiles;

    // 1. Mitigate FakeDNS UDP/FD exhaustion
    if (effectiveMode === 'mgraftcp-fakedns' && hasLeakOrBindCrash) {
        const directDnsHealthy = !dnsCheck.message?.includes('failed');
        if (directDnsHealthy) {
            effectiveMode = 'mgraftcp-no-fakedns';
            await input.updateConfig('proxyMode', effectiveMode);
            changedConfig = true;
            actions.push('Switched proxyMode from mgraftcp-fakedns to mgraftcp-no-fakedns to stop UDP/FD leaks');
        } else {
            effectiveMode = 'env-only';
            await input.updateConfig('proxyMode', effectiveMode);
            changedConfig = true;
            actions.push('Switched proxyMode from mgraftcp-fakedns to env-only after FakeDNS failure');
        }
    }

    // 2. Kill leaking, duplicate, or orphaned processes
    const agyProcs = procs.filter(p => p.targetType === 'agy');
    const lsProcs = procs.filter(p => p.targetType === 'language_server');
    const hasDuplicates = agyProcs.length > 1 || lsProcs.length > 1;
    const hasUnwrapped = procs.some(p => !p.isWrappedBak);

    if (hasLeakOrBindCrash || hasDuplicates || hasUnwrapped || (mgOrphans.length > 0 && procs.length === 0)) {
        const killResult = await killBackendProcesses();
        if (killResult.killedPids.length > 0 || killResult.killedMgraftcpPids.length > 0) {
            needsReload = true;
            actions.push(
                `Terminated ${killResult.killedPids.length} backend and ${killResult.killedMgraftcpPids.length} mgraftcp process(es)`
            );
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
            actions.push(`Switched proxyType to ${effectiveType.toUpperCase()} (verified reachable)`);
        } else if (!working) {
            remainingIssues.push(`Remote proxy ${input.proxyHost}:${input.proxyPort} failed HTTP/SOCKS5/SOCKS5H external tests.`);
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
                actions.push(`Installed crontab FD Guard (every ${input.fdGuardIntervalMinutes}m, threshold >${input.fdGuardThreshold})`);
            } else {
                actions.push(`Verified crontab FD Guard (threshold >${input.fdGuardThreshold})`);
            }
        } else if (installRes.error) {
            remainingIssues.push(`Could not install FD Guard cron: ${installRes.error}`);
        }
    }

    // 5. Ensure wrappers & mgraftcp binaries match final effective config
    const wrapperCheck = await checkLanguageServerWrapper(
        input.proxyHost,
        input.proxyPort,
        effectiveType,
        effectiveMode
    );
    if (changedConfig || wrapperCheck.status !== 'success') {
        const setupOk = await input.runSetup(input.proxyHost, input.proxyPort, effectiveType, effectiveMode);
        if (setupOk) {
            needsReload = true;
            actions.push(`Updated remote wrappers (${input.proxyHost}:${input.proxyPort}, ${effectiveType}, ${effectiveMode})`);
        } else {
            remainingIssues.push('Wrapper setup script reported a failure; inspect Antigravity AGY Proxy output channel.');
        }
    }

    if (actions.length === 0 && remainingIssues.length === 0) {
        actions.push('All checks look healthy; no remediation needed.');
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
export function generateReportText(report: DiagnosticReport): string {
    const statusEmoji: Record<string, string> = {
        success: '✅ PASS',
        warning: '⚠️ WARN',
        error: '❌ FAIL',
        pending: '⏳ PENDING',
        running: '🔄 RUNNING'
    };

    const lines: string[] = [
        '========================================',
        'Antigravity AGY Proxy Diagnostic Report',
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
