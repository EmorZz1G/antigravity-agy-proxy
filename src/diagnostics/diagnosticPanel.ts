import * as vscode from 'vscode';
import { runAllDiagnostics, DiagnosticReport, generateReportText } from './diagnosticRunner';

/**
 * DiagnosticPanel - Wrapper for backwards compatibility
 * The main functionality is now integrated into the unified StatusManager panel.
 * This class redirects to the main status panel when show() is called.
 */
export class DiagnosticPanel {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Show diagnostics - redirects to main status panel
     */
    async show(): Promise<void> {
        // Redirect to the main unified status panel
        await vscode.commands.executeCommand('antigravity-agy-proxy.showStatusPanel');
    }

    /**
     * Run diagnostics and return report
     */
    async runDiagnostics(): Promise<DiagnosticReport> {
        const config = vscode.workspace.getConfiguration('antigravity-agy-proxy');
        return await runAllDiagnostics(
            Boolean(vscode.env.remoteName),
            config.get<boolean>('enableLocalForwarding', true),
            config.get<number>('localProxyPort', 7890),
            config.get<string>('remoteProxyHost', '127.0.0.1'),
            config.get<number>('remoteProxyPort', 7890),
            config.get<string>('proxyType', 'http'),
            config.get<string>('proxyMode', 'mgraftcp-no-fakedns'),
            this.context.extensionUri.fsPath,
            config.get<number>('fdGuardThreshold', 10000)
        );
    }

    /**
     * Generate text report for copying
     */
    generateReportText(report: DiagnosticReport): string {
        return generateReportText(report);
    }

    dispose(): void {
        // Nothing to dispose - the main panel handles everything
    }
}

