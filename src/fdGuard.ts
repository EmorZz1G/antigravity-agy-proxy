import { exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const FD_GUARD_MARKER = 'ANTIGRAVITY_AGY_PROXY_FD_GUARD';
export const LEGACY_FD_GUARD_MARKER = 'ANTIGRAVITY_SSH_PROXY_FD_GUARD';
export const FD_GUARD_LOG_NAME = 'agy_guard.log';

export interface FdGuardStatus {
    installed: boolean;
    cronAvailable: boolean;
    intervalMinutes?: number;
    threshold?: number;
    cronLine?: string;
    recentLogs: string[];
    error?: string;
}

export interface FdGuardInstallResult {
    success: boolean;
    cronLine: string;
    crontabOutput: string;
    error?: string;
}

export function buildFdGuardCronLine(intervalMinutes: number, threshold: number): string {
    const safeInterval = Math.min(59, Math.max(1, Math.floor(intervalMinutes)));
    const safeThreshold = Math.min(500000, Math.max(500, Math.floor(threshold)));
    // Match both agy.bak (v2.6.0+) and legacy language_server_linux*.bak; use ls -f for O(1)-sort FD counting
    return `*/${safeInterval} * * * * for pid in $(pgrep -f "(agy\\.bak|language_server_linux.*\\.bak)"); do cnt=$(ls -f /proc/$pid/fd 2>/dev/null | wc -l); [ "\${cnt:-0}" -gt ${safeThreshold} ] && echo "$(date): killed pid=$pid fds=$cnt" >> $HOME/${FD_GUARD_LOG_NAME} && kill -9 $pid; done # ${FD_GUARD_MARKER}`;
}

async function readCrontabLines(): Promise<{ available: boolean; lines: string[]; error?: string }> {
    try {
        await execAsync('command -v crontab', { timeout: 3000 });
    } catch {
        return { available: false, lines: [], error: 'crontab command not found' };
    }

    try {
        const { stdout } = await execAsync('crontab -l', { timeout: 5000 });
        return {
            available: true,
            lines: stdout.split('\n').filter(line => line.trim().length > 0)
        };
    } catch (error: unknown) {
        const err = error as { stderr?: string; message?: string };
        const msg = `${err.stderr || ''} ${err.message || ''}`.toLowerCase();
        // Empty crontab exits with 1 and says "no crontab for <user>"
        if (msg.includes('no crontab')) {
            return { available: true, lines: [] };
        }
        return { available: false, lines: [], error: err.message || String(error) };
    }
}

function readRecentGuardLogs(maxLines = 5): string[] {
    const logPath = path.join(os.homedir(), FD_GUARD_LOG_NAME);
    if (!fs.existsSync(logPath)) {
        return [];
    }
    try {
        const content = fs.readFileSync(logPath, 'utf8');
        return content
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean)
            .slice(-maxLines);
    } catch {
        return [];
    }
}

/**
 * Inspect whether the rootless crontab FD guard is installed on the remote host.
 */
export async function getFdGuardStatus(): Promise<FdGuardStatus> {
    const { available, lines, error } = await readCrontabLines();
    const recentLogs = readRecentGuardLogs(5);

    if (!available) {
        return {
            installed: false,
            cronAvailable: false,
            recentLogs,
            error
        };
    }

    const match = lines.find(l =>
        !l.trim().startsWith('#') &&
        (l.includes(FD_GUARD_MARKER) || l.includes(LEGACY_FD_GUARD_MARKER) || l.includes('agy.bak'))
    );

    if (!match) {
        return {
            installed: false,
            cronAvailable: true,
            recentLogs
        };
    }

    const intervalMatch = match.match(/^\*\/(\d+)\s+/);
    const thresholdMatch = match.match(/-gt\s+(\d+)/);

    return {
        installed: true,
        cronAvailable: true,
        intervalMinutes: intervalMatch ? parseInt(intervalMatch[1], 10) : undefined,
        threshold: thresholdMatch ? parseInt(thresholdMatch[1], 10) : undefined,
        cronLine: match,
        recentLogs
    };
}

/**
 * Install or update the rootless crontab FD guard that kills runaway `agy.bak` /
 * `language_server_linux*.bak` processes exceeding `threshold` open file descriptors.
 */
export async function installFdGuard(intervalMinutes = 15, threshold = 10000): Promise<FdGuardInstallResult> {
    const cronLine = buildFdGuardCronLine(intervalMinutes, threshold);
    const { available, error } = await readCrontabLines();
    if (!available) {
        return {
            success: false,
            cronLine,
            crontabOutput: '',
            error: error || 'crontab is not available on this host'
        };
    }

    // Use the exact idempotent crontab replacement pattern so repeated updates stay deduplicated
    const escapedLine = cronLine.replace(/'/g, `'\\''`);
    const cmd = `(crontab -l 2>/dev/null | grep -v '${FD_GUARD_MARKER}' | grep -v '${LEGACY_FD_GUARD_MARKER}' | grep -v 'agy\\.bak'; printf '%s\\n' '${escapedLine}') | crontab - && crontab -l`;

    try {
        const { stdout } = await execAsync(cmd, { shell: '/bin/bash', timeout: 8000 });
        return {
            success: true,
            cronLine,
            crontabOutput: stdout.trim()
        };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            success: false,
            cronLine,
            crontabOutput: '',
            error: message
        };
    }
}

/**
 * Remove the Antigravity FD guard cron job cleanly while preserving other crontab entries.
 */
export async function removeFdGuard(): Promise<{ success: boolean; error?: string }> {
    const { available, lines, error } = await readCrontabLines();
    if (!available) {
        return { success: false, error };
    }

    const remaining = lines.filter(l => !l.includes(FD_GUARD_MARKER) && !l.includes(LEGACY_FD_GUARD_MARKER) && !l.includes('agy.bak'));
    if (remaining.length === 0) {
        try {
            await execAsync('crontab -r 2>/dev/null || true', { shell: '/bin/bash', timeout: 5000 });
            return { success: true };
        } catch (err: unknown) {
            return { success: false, error: err instanceof Error ? err.message : String(err) };
        }
    }

    const payload = remaining.join('\n') + '\n';
    const escapedPayload = payload.replace(/'/g, `'\\''`);
    const cmd = `printf '%s' '${escapedPayload}' | crontab -`;
    try {
        await execAsync(cmd, { shell: '/bin/bash', timeout: 5000 });
        return { success: true };
    } catch (err: unknown) {
        return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
}
