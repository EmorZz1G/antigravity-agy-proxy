import * as fs from 'fs';
import * as path from 'path';
import { FD_GUARD_MARKER, LEGACY_FD_GUARD_MARKER } from './fdGuard';
import type { ProxyMode } from './processUtils';

export function generateSetupScript(
    proxyHost: string,
    proxyPort: number,
    proxyType: string,
    extensionPath: string,
    proxyMode: ProxyMode = 'mgraftcp-no-fakedns'
): string {
    const scriptPath = path.join(extensionPath, 'scripts', 'setup-proxy.sh');
    let script = fs.readFileSync(scriptPath, 'utf-8');

    // Replace placeholders
    script = script.replace(/__PROXY_HOST__/g, proxyHost);
    script = script.replace(/__PROXY_PORT__/g, String(proxyPort));
    script = script.replace(/__PROXY_TYPE__/g, proxyType);
    script = script.replace(/__PROXY_MODE__/g, proxyMode);

    return script;
}

export function generateRollbackScript(removeFdGuard = false): string {
    const fdGuardCleanup = removeFdGuard
        ? `\nif command -v crontab >/dev/null 2>&1; then\n    (crontab -l 2>/dev/null | grep -v '${FD_GUARD_MARKER}' | grep -v '${LEGACY_FD_GUARD_MARKER}' | grep -v 'agy\\.bak' || true) | crontab - 2>/dev/null || true\nfi\n`
        : '';

    return `#!/bin/bash
echo "[INFO] Rolling back Antigravity AGY Proxy configuration..."

RESTORED_COUNT=0

# 1. Restore Antigravity IDE v2.6.0+ binary (~/.gemini/bin/agy)
AGY_BAK="$HOME/.gemini/bin/agy.bak"
if [ -f "$AGY_BAK" ]; then
    TARGET="$HOME/.gemini/bin/agy"
    echo "[INFO] Restoring: $TARGET"
    chmod +x "$AGY_BAK"
    mv -f "$AGY_BAK" "$TARGET"
    RESTORED_COUNT=$((RESTORED_COUNT + 1))
fi

# 2. Restore legacy language server binaries
for DIR in "$HOME/.antigravity-ide-server" "$HOME/.antigravity-server"; do
    if [ ! -d "$DIR" ]; then
        continue
    fi
    BACKUPS=$(find "$DIR" -path "*/extensions/antigravity/bin/language_server_[l]inux_*.bak" -type f 2>/dev/null)
    for BAK in $BACKUPS; do
        TARGET="\${BAK%.bak}"
        echo "[INFO] Restoring: $TARGET"
        chmod +x "$BAK"
        mv -f "$BAK" "$TARGET"
        RESTORED_COUNT=$((RESTORED_COUNT + 1))
    done
done

if [ $RESTORED_COUNT -eq 0 ]; then
    echo "[WARN] No backup files found. Antigravity may not have been wrapped or was already restored."
else
    echo "[INFO] Restored $RESTORED_COUNT binary/binaries."
fi
${fdGuardCleanup}
echo "[INFO] Terminating running language server, agy, and mgraftcp processes..."
pkill -9 -f "[.]gemini/bin/agy(\\.bak)?.*--hub" 2>/dev/null || true
pkill -9 -f "[l]anguage_server_linux.*\\.bak" 2>/dev/null || true
pkill -9 -f "[l]anguage_server_linux" 2>/dev/null || true
pkill -9 -f "[m]graftcp-fakedns.*(agy|language_server_linux)" 2>/dev/null || true

echo "[SUCCESS] Rollback complete. Please reload the Antigravity window."
`;
}
