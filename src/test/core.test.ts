import * as assert from 'assert';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildFdGuardCronLine, FD_GUARD_MARKER } from '../fdGuard';
import { generateRollbackScript, generateSetupScript } from '../remoteSetup';
import { generateReportText } from '../diagnostics/diagnosticRunner';

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

describe('Antigravity AGY Proxy Core Modules', function () {
    this.timeout(15000);

    it('builds valid clamped FD guard crontab line for agy.bak and legacy LS', () => {
        const line = buildFdGuardCronLine(15, 10000);
        assert.ok(line.startsWith('*/15 * * * * '));
        assert.ok(line.includes('pgrep -f "(agy\\.bak|language_server_linux.*\\.bak)"'));
        assert.ok(line.includes('ls -f /proc/$pid/fd'));
        assert.ok(line.includes('-gt 10000'));
        assert.ok(line.includes('agy_guard.log'));
        assert.ok(line.includes('kill -9 $pid'));
        assert.ok(line.includes(FD_GUARD_MARKER));
        assert.strictEqual(FD_GUARD_MARKER, 'ANTIGRAVITY_AGY_PROXY_FD_GUARD');

        const clamped = buildFdGuardCronLine(0, 100);
        assert.ok(clamped.startsWith('*/1 * * * * '));
        assert.ok(clamped.includes('-gt 500'));
    });

    it('substitutes all placeholders in generated setup script and includes agy+LS rollback', () => {
        const setupScript = generateSetupScript('127.0.0.1', 17890, 'socks5h', PROJECT_ROOT, 'env-only');
        assert.ok(setupScript.includes('127.0.0.1'));
        assert.ok(setupScript.includes('17890'));
        assert.ok(setupScript.includes('socks5h'));
        assert.ok(setupScript.includes('env-only'));
        assert.ok(setupScript.includes('antigravity-agy-proxy'));
        assert.ok(setupScript.includes('ANTIGRAVITY_AGY_PROXY_WRAPPER'));
        assert.ok(!setupScript.includes('__PROXY_HOST__'));
        assert.ok(!setupScript.includes('__PROXY_PORT__'));
        assert.ok(!setupScript.includes('__PROXY_TYPE__'));
        assert.ok(!setupScript.includes('__PROXY_MODE__'));

        const rollbackWithGuard = generateRollbackScript(true);
        assert.ok(rollbackWithGuard.includes('$HOME/.gemini/bin/agy.bak'));
        assert.ok(rollbackWithGuard.includes('language_server_[l]inux_*.bak'));
        assert.ok(rollbackWithGuard.includes('ANTIGRAVITY_AGY_PROXY_FD_GUARD'));
        assert.ok(rollbackWithGuard.includes('ANTIGRAVITY_SSH_PROXY_FD_GUARD'));
    });

    it('formats full diagnostic reports cleanly', () => {
        const report = generateReportText({
            timestamp: '2026-11-25T00:00:00.000Z',
            environment: 'remote',
            overallStatus: 'warning',
            checks: [
                {
                    id: 'fd-udp-health',
                    name: 'FD & UDP Port Health',
                    status: 'success',
                    message: 'Max backend FDs: 85 | UDP sockets: 12/28232 (0%)'
                },
                {
                    id: 'external-connectivity',
                    name: 'External Connectivity',
                    status: 'warning',
                    message: 'SOCKS5H available',
                    protocolResults: [
                        { protocol: 'http', success: false, error: 'HTTP 000', isCurrent: true },
                        { protocol: 'socks5h', success: true, httpCode: '204', isCurrent: false }
                    ],
                    suggestion: 'Switch to SOCKS5H'
                }
            ]
        });
        assert.ok(report.includes('Antigravity AGY Proxy Diagnostic Report'));
        assert.ok(report.includes('FD & UDP Port Health'));
        assert.ok(report.includes('SOCKS5H: OK (204)'));
        assert.ok(report.includes('Switch to SOCKS5H'));
    });

    it('wraps, upgrades legacy ANTIGRAVITY_SSH_PROXY_WRAPPER, switches modes, and rolls back cleanly', () => {
        const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-proxy-test-'));
        try {
            const agyDir = path.join(tmpHome, '.gemini', 'bin');
            const lsDir = path.join(tmpHome, '.antigravity-ide-server', 'bin', 'v1', 'extensions', 'antigravity', 'bin');
            const extBinDir = path.join(tmpHome, '.antigravity-ide-server', 'extensions', 'emorzz1g.antigravity-agy-proxy-0.1.0', 'resources', 'bin');
            fs.mkdirSync(agyDir, { recursive: true });
            fs.mkdirSync(lsDir, { recursive: true });
            fs.mkdirSync(extBinDir, { recursive: true });

            // Copy real mgraftcp binaries into simulated antigravity-agy-proxy extension directory
            for (const f of fs.readdirSync(path.join(PROJECT_ROOT, 'resources', 'bin'))) {
                fs.copyFileSync(path.join(PROJECT_ROOT, 'resources', 'bin', f), path.join(extBinDir, f));
            }

            const agyBin = path.join(agyDir, 'agy');
            const lsBin = path.join(lsDir, 'language_server_linux_x64');
            // Seed agy with a pre-existing legacy ANTIGRAVITY_SSH_PROXY_WRAPPER + .bak to verify seamless migration
            fs.writeFileSync(`${agyBin}.bak`, '#!/bin/sh\necho "AGY_STUB:$1"\n', { mode: 0o755 });
            fs.writeFileSync(
                agyBin,
                '#!/bin/bash\n# ANTIGRAVITY_SSH_PROXY_WRAPPER\n# WRAPPER_VERSION="0.0.19"\nPROXY_ADDR="127.0.0.1:7890"\nPROXY_TYPE="http"\n',
                { mode: 0o755 }
            );
            fs.writeFileSync(lsBin, '#!/bin/sh\necho "LS_STUB:$1"\n', { mode: 0o755 });

            const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'setup-proxy.sh');
            const baseEnv = {
                ...process.env,
                HOME: tmpHome,
                PROXY_HOST: '127.0.0.1',
                PROXY_PORT: '7890',
                PROXY_TYPE: 'http',
                PROXY_MODE: 'mgraftcp-no-fakedns',
                EXTENSION_VERSION: '0.1.0',
                SKIP_PKILL: '1'
            };

            // 1. Seamless upgrade of legacy agy wrapper (preserving .bak) + fresh wrap of LS binary via *antigravity-agy-proxy* discovery
            const out1 = execSync(`bash "${scriptPath}"`, { env: baseEnv, encoding: 'utf8' });
            assert.ok(out1.includes('Configured: 2 wrapper(s)'), out1);
            assert.ok(out1.includes('upgrade_wrapper_format'), out1);
            assert.ok(fs.existsSync(`${agyBin}.bak`));
            assert.ok(fs.existsSync(`${lsBin}.bak`));

            const agyWrapper1 = fs.readFileSync(agyBin, 'utf8');
            assert.ok(agyWrapper1.includes('ANTIGRAVITY_AGY_PROXY_WRAPPER'));
            assert.ok(agyWrapper1.includes('PROXY_MODE="mgraftcp-no-fakedns"'));
            assert.ok(agyWrapper1.includes('--disable-fakedns'));
            assert.ok(agyWrapper1.includes('*antigravity-agy-proxy*'));

            // Verify --version bypass reaches preserved original .bak directly
            const verOut = execSync(`"${agyBin}" --version`, { env: { ...process.env, HOME: tmpHome }, encoding: 'utf8' });
            assert.strictEqual(verOut.trim(), 'AGY_STUB:--version');

            // 2. Idempotent re-run skips update
            const out2 = execSync(`bash "${scriptPath}"`, { env: baseEnv, encoding: 'utf8' });
            assert.ok(out2.includes('Already configured'), out2);

            // 2b. Switch to mgraftcp-no-fakedns + socks5 and confirm runtime wrapper avoids setting HTTP_PROXY/HTTPS_PROXY=socks5://
            const outSocks = execSync(`bash "${scriptPath}"`, {
                env: { ...baseEnv, PROXY_TYPE: 'socks5', PROXY_MODE: 'mgraftcp-no-fakedns' },
                encoding: 'utf8'
            });
            assert.ok(outSocks.includes('Configured: 2 wrapper(s)'), outSocks);
            const envCheckCmd = `bash -c 'unset HTTP_PROXY HTTPS_PROXY ALL_PROXY; eval "$(sed -n "/^PROXY_ADDR=/,/^# Strategy 1/p" "${agyBin}")"; echo "HTTP=\${HTTP_PROXY:-unset} HTTPS=\${HTTPS_PROXY:-unset} ALL=\${ALL_PROXY:-unset}"'`;
            const envCheckOut = execSync(envCheckCmd, { encoding: 'utf8' }).trim();
            assert.strictEqual(envCheckOut, 'HTTP=unset HTTPS=unset ALL=socks5://127.0.0.1:7890');

            // Verify Chinese diagnostic report localization
            const zhReport = generateReportText({
                timestamp: '2026-11-25T00:00:00.000Z',
                environment: 'remote',
                overallStatus: 'healthy',
                lang: 'zh',
                checks: []
            });
            assert.ok(zhReport.includes('Antigravity AGY Proxy 诊断报告'));

            // 3. Switch to env-only + socks5h
            const out3 = execSync(`bash "${scriptPath}"`, {
                env: { ...baseEnv, PROXY_TYPE: 'socks5h', PROXY_MODE: 'env-only' },
                encoding: 'utf8'
            });
            assert.ok(out3.includes('Configured: 2 wrapper(s)'), out3);
            const agyWrapper3 = fs.readFileSync(agyBin, 'utf8');
            assert.ok(agyWrapper3.includes('PROXY_MODE="env-only"'));
            assert.ok(agyWrapper3.includes('PROXY_TYPE="socks5h"'));
            const envRunOut = execSync(`"${agyBin}" --probe`, { env: { ...process.env, HOME: tmpHome }, encoding: 'utf8' });
            assert.strictEqual(envRunOut.trim(), 'AGY_STUB:--probe');

            // 4. Switch to mgraftcp-fakedns
            const out4 = execSync(`bash "${scriptPath}"`, {
                env: { ...baseEnv, PROXY_TYPE: 'http', PROXY_MODE: 'mgraftcp-fakedns' },
                encoding: 'utf8'
            });
            assert.ok(out4.includes('Configured: 2 wrapper(s)'), out4);
            const agyWrapper4 = fs.readFileSync(agyBin, 'utf8');
            assert.ok(agyWrapper4.includes('PROXY_MODE="mgraftcp-fakedns"'));
            assert.ok(agyWrapper4.includes('netdns=cgo'));

            // 5. Rollback restores both binaries cleanly
            const rollbackScript = generateRollbackScript(false).replace(/pkill -9[^\n]*/g, 'true');
            const rollbackFile = path.join(tmpHome, 'rollback.sh');
            fs.writeFileSync(rollbackFile, rollbackScript, { mode: 0o755 });
            execSync(`bash "${rollbackFile}"`, { env: { ...process.env, HOME: tmpHome }, encoding: 'utf8' });
            assert.ok(!fs.existsSync(`${agyBin}.bak`));
            assert.ok(!fs.existsSync(`${lsBin}.bak`));
            assert.ok(fs.readFileSync(agyBin, 'utf8').includes('AGY_STUB'));
        } finally {
            fs.rmSync(tmpHome, { recursive: true, force: true });
        }
    });
});
