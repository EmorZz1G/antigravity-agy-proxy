import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export type ProxyMode = 'mgraftcp-no-fakedns' | 'env-only' | 'mgraftcp-fakedns';
export type ProxyProtocol = 'http' | 'socks5' | 'socks5h';

export interface BackendProcessInfo {
    pid: number;
    ppid: number;
    targetType: 'agy' | 'language_server';
    isWrappedBak: boolean;
    isPersistent: boolean;
    hasMgraftcpParent: boolean;
    mgraftcpHasDisableFakedns?: boolean;
    detectedMode: ProxyMode | 'unknown';
    hasProxyEnv: boolean;
    fdCount: number;
    cmdLine: string;
}

export interface LogErrorScan {
    fakednsBindFailed: boolean;
    tooManyOpenFiles: boolean;
    dnsTempFailure: boolean;
    samples: string[];
    logFilesChecked: number;
}

export interface UdpHealthInfo {
    udpSocketsTotal: number;
    ephemeralMin: number;
    ephemeralMax: number;
    ephemeralCapacity: number;
    udpUsageRatio: number;
    highFdProcesses: BackendProcessInfo[];
    maxBackendFdCount: number;
    recentLogErrors: LogErrorScan;
}

interface MgraftcpProcess {
    pid: number;
    ppid: number;
    cmdLine: string;
    disableFakeDns: boolean;
}

const PROC_READ_DELAY_DEFAULT_MIN = 32768;
const PROC_READ_DELAY_DEFAULT_MAX = 60999;

function parseCmdArgs(pid: string): string[] {
    try {
        const raw = fs.readFileSync(`/proc/${pid}/cmdline`);
        return raw.toString('utf8').split('\0').filter(Boolean);
    } catch {
        return [];
    }
}

function readPpid(pid: string): number {
    try {
        const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
        const rparen = stat.lastIndexOf(')');
        if (rparen === -1) {
            return 0;
        }
        const fields = stat.slice(rparen + 2).trim().split(/\s+/);
        return parseInt(fields[1] || '0', 10) || 0;
    } catch {
        return 0;
    }
}

function countOpenFds(pid: string): number {
    try {
        return fs.readdirSync(`/proc/${pid}/fd`).length;
    } catch {
        return -1;
    }
}

function readEnvironHasProxy(pid: string): boolean {
    try {
        const raw = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
        const vars = raw.split('\0');
        return vars.some(v =>
            v.startsWith('HTTP_PROXY=') ||
            v.startsWith('HTTPS_PROXY=') ||
            v.startsWith('ALL_PROXY=') ||
            v.startsWith('http_proxy=') ||
            v.startsWith('https_proxy=') ||
            v.startsWith('all_proxy=')
        );
    } catch {
        return false;
    }
}

function isAgyBinaryArg(arg0: string, cmdLine: string): boolean {
    if (!cmdLine.includes('--hub')) {
        return false;
    }
    return /(?:^|\/)\.gemini\/bin\/agy(?:\.bak)?$/.test(arg0);
}

function isLegacyLanguageServerArg(arg0: string): boolean {
    return /(?:^|\/)language_server_linux_[^/\s]+$/.test(arg0);
}

/**
 * Inspect running Antigravity backend processes (`~/.gemini/bin/agy --hub` and
 * legacy `language_server_linux_*`), their mgraftcp parents, FD counts, and active mode.
 */
export async function inspectBackendProcesses(): Promise<BackendProcessInfo[]> {
    let entries: string[] = [];
    try {
        entries = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name));
    } catch {
        return [];
    }

    const mgraftcpMap = new Map<number, MgraftcpProcess>();
    const rawCmds = new Map<string, string[]>();

    for (const pid of entries) {
        const args = parseCmdArgs(pid);
        if (args.length === 0) {
            continue;
        }
        rawCmds.set(pid, args);
        const arg0 = args[0] || '';
        const cmdLine = args.join(' ');
        if (arg0.includes('mgraftcp-fakedns')) {
            mgraftcpMap.set(Number(pid), {
                pid: Number(pid),
                ppid: readPpid(pid),
                cmdLine,
                disableFakeDns: args.includes('--disable-fakedns')
            });
        }
    }

    const results: BackendProcessInfo[] = [];

    for (const [pidStr, args] of rawCmds.entries()) {
        const arg0 = args[0] || '';
        const cmdLine = args.join(' ');
        const isAgy = isAgyBinaryArg(arg0, cmdLine);
        const isLegacy = !isAgy && isLegacyLanguageServerArg(arg0);

        if (!isAgy && !isLegacy) {
            continue;
        }

        const pid = Number(pidStr);
        const ppid = readPpid(pidStr);
        const isWrappedBak = /\.bak$/.test(arg0);
        const isPersistent = isAgy ? cmdLine.includes('--hub') : cmdLine.includes('--persistent_mode');
        const hasProxyEnv = readEnvironHasProxy(pidStr);
        const fdCount = countOpenFds(pidStr);

        // Trace immediate parent or grandparent (up to 2 hops) for mgraftcp-fakedns
        let mgParent = mgraftcpMap.get(ppid);
        if (!mgParent && ppid > 1) {
            const grandPpid = readPpid(String(ppid));
            mgParent = mgraftcpMap.get(grandPpid);
        }

        let detectedMode: ProxyMode | 'unknown' = 'unknown';
        if (mgParent) {
            detectedMode = mgParent.disableFakeDns ? 'mgraftcp-no-fakedns' : 'mgraftcp-fakedns';
        } else if (isWrappedBak && hasProxyEnv) {
            detectedMode = 'env-only';
        }

        results.push({
            pid,
            ppid,
            targetType: isAgy ? 'agy' : 'language_server',
            isWrappedBak,
            isPersistent,
            hasMgraftcpParent: Boolean(mgParent),
            mgraftcpHasDisableFakedns: mgParent?.disableFakeDns,
            detectedMode,
            hasProxyEnv,
            fdCount,
            cmdLine
        });
    }

    // Prefer agy first, then higher FD / wrapped processes
    results.sort((a, b) => {
        if (a.targetType !== b.targetType) {
            return a.targetType === 'agy' ? -1 : 1;
        }
        return b.pid - a.pid;
    });

    return results;
}

/**
 * Find any orphaned `mgraftcp-fakedns` processes wrapping Antigravity binaries.
 */
export async function inspectAntigravityMgraftcpProcesses(): Promise<MgraftcpProcess[]> {
    let entries: string[] = [];
    try {
        entries = fs.readdirSync('/proc').filter(name => /^\d+$/.test(name));
    } catch {
        return [];
    }

    const found: MgraftcpProcess[] = [];
    for (const pid of entries) {
        const args = parseCmdArgs(pid);
        if (args.length === 0) {
            continue;
        }
        const arg0 = args[0] || '';
        const cmdLine = args.join(' ');
        if (arg0.includes('mgraftcp-fakedns') && (cmdLine.includes('agy') || cmdLine.includes('language_server_linux'))) {
            found.push({
                pid: Number(pid),
                ppid: readPpid(pid),
                cmdLine,
                disableFakeDns: args.includes('--disable-fakedns')
            });
        }
    }
    return found;
}

function countProcNetLines(filePath: string): number {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(line => line.trim().length > 0);
        return Math.max(0, lines.length - 1);
    } catch {
        return 0;
    }
}

function readEphemeralPortRange(): [number, number] {
    try {
        const content = fs.readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim();
        const parts = content.split(/\s+/);
        const min = parseInt(parts[0] || '', 10);
        const max = parseInt(parts[1] || '', 10);
        if (!Number.isNaN(min) && !Number.isNaN(max) && max >= min) {
            return [min, max];
        }
    } catch {
        // Fallback to standard Linux defaults
    }
    return [PROC_READ_DELAY_DEFAULT_MIN, PROC_READ_DELAY_DEFAULT_MAX];
}

function collectRecentLogFiles(maxFiles: number): string[] {
    const home = os.homedir();
    const roots = [
        path.join(home, '.antigravity-ide-server', 'data', 'logs'),
        path.join(home, '.antigravity-server', 'data', 'logs')
    ];
    const candidates: Array<{ file: string; mtimeMs: number }> = [];
    const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;

    for (const root of roots) {
        if (!fs.existsSync(root)) {
            continue;
        }
        let sessionDirs: string[] = [];
        try {
            sessionDirs = fs.readdirSync(root)
                .map(name => path.join(root, name))
                .filter(p => {
                    try {
                        return fs.statSync(p).isDirectory();
                    } catch {
                        return false;
                    }
                })
                .sort((a, b) => {
                    try {
                        return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
                    } catch {
                        return 0;
                    }
                })
                .slice(0, 3);
        } catch {
            continue;
        }

        const walk = (dir: string, depth: number) => {
            if (depth > 4) {
                return;
            }
            let items: fs.Dirent[];
            try {
                items = fs.readdirSync(dir, { withFileTypes: true });
            } catch {
                return;
            }
            for (const item of items) {
                const full = path.join(dir, item.name);
                if (item.isDirectory()) {
                    walk(full, depth + 1);
                } else if (item.isFile() && item.name.endsWith('.log')) {
                    // Skip our own extension output log to prevent self-matching diagnostic messages
                    if (full.toLowerCase().includes('antigravity-agy-proxy')) {
                        continue;
                    }
                    if (!/antigravity|exthost|remoteagent|main/i.test(item.name)) {
                        continue;
                    }
                    try {
                        const st = fs.statSync(full);
                        if (st.mtimeMs >= cutoffMs && st.size > 0) {
                            candidates.push({ file: full, mtimeMs: st.mtimeMs });
                        }
                    } catch {
                        // ignore vanished files
                    }
                }
            }
        };

        for (const sDir of sessionDirs) {
            walk(sDir, 0);
        }
    }

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates.slice(0, maxFiles).map(c => c.file);
}

function readTail(filePath: string, maxBytes: number): string {
    try {
        const st = fs.statSync(filePath);
        const start = Math.max(0, st.size - maxBytes);
        const length = st.size - start;
        if (length <= 0) {
            return '';
        }
        const fd = fs.openSync(filePath, 'r');
        try {
            const buf = Buffer.alloc(length);
            fs.readSync(fd, buf, 0, length, start);
            return buf.toString('utf8');
        } finally {
            fs.closeSync(fd);
        }
    } catch {
        return '';
    }
}

export function scanRecentLogsForProxyErrors(): LogErrorScan {
    const files = collectRecentLogFiles(8);
    let fakednsBindFailed = false;
    let tooManyOpenFiles = false;
    let dnsTempFailure = false;
    const samples: string[] = [];

    for (const file of files) {
        const tail = readTail(file, 65536);
        if (!tail) {
            continue;
        }
        const lines = tail.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i];
            if (line.includes('Failed to start FakeDNS') || (line.includes('listen udp') && line.includes('address already in use'))) {
                fakednsBindFailed = true;
                if (samples.length < 3) {
                    samples.push(line.trim().slice(0, 180));
                }
            } else if (line.includes('too many open files')) {
                tooManyOpenFiles = true;
                if (samples.length < 3) {
                    samples.push(line.trim().slice(0, 180));
                }
            } else if (line.includes('Temporary failure in name resolution')) {
                dnsTempFailure = true;
                if (samples.length < 3) {
                    samples.push(line.trim().slice(0, 180));
                }
            }
        }
    }

    return {
        fakednsBindFailed,
        tooManyOpenFiles,
        dnsTempFailure,
        samples,
        logFilesChecked: files.length
    };
}

/**
 * Inspect system-wide UDP socket usage vs ephemeral port capacity, backend FD counts,
 * and recent server log indicators of FakeDNS/FD exhaustion.
 */
export async function inspectUdpAndFdHealth(
    processes?: BackendProcessInfo[],
    fdWarningThreshold = 2000
): Promise<UdpHealthInfo> {
    const procs = processes ?? await inspectBackendProcesses();
    const udp4 = countProcNetLines('/proc/net/udp');
    const udp6 = countProcNetLines('/proc/net/udp6');
    const udpSocketsTotal = udp4 + udp6;
    const [ephemeralMin, ephemeralMax] = readEphemeralPortRange();
    const ephemeralCapacity = Math.max(1, ephemeralMax - ephemeralMin + 1);
    const udpUsageRatio = udpSocketsTotal / ephemeralCapacity;

    const highFdProcesses = procs.filter(p => p.fdCount >= fdWarningThreshold);
    const maxBackendFdCount = procs.reduce((max, p) => Math.max(max, p.fdCount), 0);
    const recentLogErrors = scanRecentLogsForProxyErrors();

    return {
        udpSocketsTotal,
        ephemeralMin,
        ephemeralMax,
        ephemeralCapacity,
        udpUsageRatio,
        highFdProcesses,
        maxBackendFdCount,
        recentLogErrors
    };
}

/**
 * Kill Antigravity backend processes (and matching mgraftcp-fakedns parents).
 * When `minFdCount` is set, only kills processes exceeding that FD count.
 */
export async function killBackendProcesses(options?: {
    minFdCount?: number;
    pidsOnly?: number[];
}): Promise<{ killedPids: number[]; killedMgraftcpPids: number[] }> {
    const procs = await inspectBackendProcesses();
    const mgProcs = await inspectAntigravityMgraftcpProcesses();
    const killedPids: number[] = [];
    const killedMgraftcpPids: number[] = [];

    const targets = procs.filter(p => {
        if (options?.pidsOnly && !options.pidsOnly.includes(p.pid)) {
            return false;
        }
        if (options?.minFdCount !== undefined && p.fdCount < options.minFdCount) {
            return false;
        }
        return true;
    });

    for (const p of targets) {
        try {
            process.kill(p.pid, 'SIGKILL');
            killedPids.push(p.pid);
        } catch {
            // Process may have exited already
        }
    }

    // Also terminate associated mgraftcp-fakedns processes when killing all or targeting their child
    const killedChildPpids = new Set(targets.map(t => t.ppid));
    for (const mg of mgProcs) {
        if (options?.minFdCount === undefined && !options?.pidsOnly || killedChildPpids.has(mg.pid)) {
            try {
                process.kill(mg.pid, 'SIGKILL');
                killedMgraftcpPids.push(mg.pid);
            } catch {
                // ignore
            }
        }
    }

    return { killedPids, killedMgraftcpPids };
}

