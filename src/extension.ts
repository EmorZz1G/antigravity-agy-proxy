import * as vscode from 'vscode';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import { generateSetupScript, generateRollbackScript } from './remoteSetup';
import { StatusManager } from './statusManager';
import { DiagnosticPanel } from './diagnostics/diagnosticPanel';
import { TrafficPanel } from './traffic/trafficPanel';
import {
	inspectAntigravityMgraftcpProcesses,
	inspectBackendProcesses,
	inspectUdpAndFdHealth,
	killBackendProcesses,
	ProxyMode,
	ProxyProtocol
} from './processUtils';
import { installFdGuard, removeFdGuard } from './fdGuard';
import { runAutoFix } from './diagnostics/diagnosticRunner';

const execAsync = promisify(exec);

let outputChannel: vscode.OutputChannel;
let statusManager: StatusManager;
let diagnosticPanel: DiagnosticPanel;
let trafficPanel: TrafficPanel;

function log(message: string): void {
	const timestamp = new Date().toISOString();
	const location = isRunningLocally() ? '[LOCAL]' : '[REMOTE]';
	outputChannel?.appendLine(`${timestamp} ${location} ${message}`);
}

function isRunningLocally(): boolean {
	return !vscode.env.remoteName;
}

function normalizeProxyType(raw: string): ProxyProtocol {
	if (raw === 'socks5' || raw === 'socks5h') {
		return raw;
	}
	return 'http';
}

function normalizeProxyMode(raw: string): ProxyMode {
	if (raw === 'env-only' || raw === 'mgraftcp-fakedns') {
		return raw;
	}
	return 'mgraftcp-no-fakedns';
}

async function checkPortAvailable(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = new net.Socket();
		socket.setTimeout(1000);
		socket.on('connect', () => { socket.destroy(); resolve(true); });
		socket.on('timeout', () => { socket.destroy(); resolve(false); });
		socket.on('error', () => { socket.destroy(); resolve(false); });
		socket.connect(port, host);
	});
}

/**
 * Check if mgraftcp-fakedns is currently running for Antigravity
 */
async function isMgraftcpRunning(): Promise<boolean> {
	const mgProcs = await inspectAntigravityMgraftcpProcesses();
	return mgProcs.length > 0;
}

/**
 * Get active Antigravity backend process info (`~/.gemini/bin/agy --hub` or legacy `language_server_linux_*`).
 */
async function getLanguageServerProcess(): Promise<{
	pid: number;
	isPersistent: boolean;
	isUsingProxy: boolean;
	targetType: 'agy' | 'language_server';
	fdCount: number;
	detectedMode: ProxyMode | 'unknown';
} | null> {
	const procs = await inspectBackendProcesses();
	if (procs.length === 0) {
		return null;
	}
	const primary = procs[0];
	return {
		pid: primary.pid,
		isPersistent: primary.isPersistent,
		isUsingProxy: primary.isUsingProxy,
		targetType: primary.targetType,
		fdCount: primary.fdCount,
		detectedMode: primary.detectedMode
	};
}

/**
 * Kill Antigravity backend processes (`agy --hub` / `language_server_linux`) and orphaned mgraftcp parents
 * so the IDE restarts them cleanly through the configured wrapper.
 */
async function killLanguageServer(): Promise<boolean> {
	const result = await killBackendProcesses();
	const totalKilled = result.killedPids.length + result.killedMgraftcpPids.length;
	if (totalKilled === 0) {
		log('No Antigravity backend process found to kill');
		return false;
	}
	log(`Killed backend process(es): ${result.killedPids.join(', ') || 'none'} (mgraftcp: ${result.killedMgraftcpPids.join(', ') || 'none'})`);
	return true;
}

/**
 * Show reload window prompt with optional auto-reload after timeout
 */
function promptReloadWindow(message: string): void {
	vscode.window.showInformationMessage(
		message,
		'Reload Now',
		'Later'
	).then(selection => {
		if (selection === 'Reload Now') {
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	});
}

const ANTIGRAVITY_FILENAME = 'config.antigravity';
const INCLUDE_LINE = `Include ${ANTIGRAVITY_FILENAME}`;

/**
 * Get path to SSH config directory based on platform
 */
function getSSHDir(): string {
	return path.join(os.homedir(), '.ssh');
}

/**
 * Get path to the main SSH config file
 */
function getSSHConfigPath(): string {
	return path.join(getSSHDir(), 'config');
}

/**
 * Get path to our custom SSH config file
 */
function getAntigravityConfigPath(): string {
	return path.join(getSSHDir(), ANTIGRAVITY_FILENAME);
}

/**
 * Update the SSH config files using the Include approach (with SSH keepalive for tunnel resilience)
 */
async function updateSSHConfigFile(remotePort: number, localPort: number, enable: boolean): Promise<void> {
	const mainConfigPath = getSSHConfigPath();
	const antiConfigPath = getAntigravityConfigPath();

	try {
		// Ensure .ssh directory exists
		await fs.mkdir(getSSHDir(), { recursive: true });

		if (enable) {
			// 1. Create/Update the config.antigravity file
			const antiContent = [
				'# Antigravity AGY Proxy Configuration',
				`# Generated at: ${new Date().toISOString()}`,
				'Match all',
				`    RemoteForward ${remotePort} 127.0.0.1:${localPort}`,
				'    ExitOnForwardFailure no',
				'    VisualHostKey no',
				'    ServerAliveInterval 30',
				'    ServerAliveCountMax 3',
				'',
			].join('\n');
			await fs.writeFile(antiConfigPath, antiContent, 'utf-8');
			log(`Updated ${antiConfigPath}`);

			// 2. Ensure Include line exists in main config
			let mainContent = '';
			try {
				mainContent = await fs.readFile(mainConfigPath, 'utf-8');
			} catch (e) { /* ignore if doesn't exist */ }

			if (!mainContent.includes(INCLUDE_LINE)) {
				// Prepend to the top for maximum compatibility
				mainContent = `${INCLUDE_LINE}\n${mainContent}`;
				await fs.writeFile(mainConfigPath, mainContent, 'utf-8');
				log(`Added Include line to ${mainConfigPath}`);
			}
		} else {
			// 1. Remove Include line from main config
			try {
				let mainContent = await fs.readFile(mainConfigPath, 'utf-8');
				if (mainContent.includes(INCLUDE_LINE)) {
					// Simply remove the Include line (we're the only one who writes it)
					mainContent = mainContent.replace(`${INCLUDE_LINE}\n`, '');
					mainContent = mainContent.replace(INCLUDE_LINE, ''); // fallback if no trailing newline
					await fs.writeFile(mainConfigPath, mainContent, 'utf-8');
					log(`Removed Include line from ${mainConfigPath}`);
				}
			} catch (e) { /* ignore */ }

			// 2. Delete the config.antigravity file
			try {
				await fs.unlink(antiConfigPath);
				log(`Deleted ${antiConfigPath}`);
			} catch (e) { /* ignore if already gone */ }
		}

		log(`SSH config updated (enable=${enable})`);
	} catch (error) {
		log(`SSH config update error: ${error}`);
		throw error;
	}
}

/**
 * Check if the forwarding is enabled by looking at the Include line and the sub-config
 */
async function getSSHConfigStatus(): Promise<{ enabled: boolean; port?: number }> {
	try {
		const mainContent = await fs.readFile(getSSHConfigPath(), 'utf-8');
		if (mainContent.includes(INCLUDE_LINE)) {
			const antiContent = await fs.readFile(getAntigravityConfigPath(), 'utf-8');
			const match = antiContent.match(/RemoteForward\s+(\d+)\s+(?:localhost|127\.0\.0\.1):/);
			if (match) {
				return { enabled: true, port: parseInt(match[1]) };
			}
		}
	} catch {
		// Files don't exist
	}
	return { enabled: false };
}

export function activate(context: vscode.ExtensionContext) {
	// 创建专用的 Output Channel
	outputChannel = vscode.window.createOutputChannel('Antigravity AGY Proxy');
	context.subscriptions.push(outputChannel);

	log(`Activating... isLocal=${isRunningLocally()}`);

	// 初始化状态管理器
	statusManager = new StatusManager(isRunningLocally(), context);
	context.subscriptions.push(statusManager);

	// 初始化诊断面板
	diagnosticPanel = new DiagnosticPanel(context);
	context.subscriptions.push({ dispose: () => diagnosticPanel.dispose() });

	// 初始化流量面板
	trafficPanel = new TrafficPanel(context);
	context.subscriptions.push({ dispose: () => trafficPanel.dispose() });

	// 注册显示输出窗口的命令
	context.subscriptions.push(
		vscode.commands.registerCommand('antigravity-agy-proxy.showOutput', () => {
			outputChannel.show();
		})
	);

	// 注册显示状态面板的命令
	context.subscriptions.push(
		vscode.commands.registerCommand('antigravity-agy-proxy.showStatusPanel', () => {
			statusManager.showStatusPanel();
		})
	);

	// 注册刷新状态的命令
	context.subscriptions.push(
		vscode.commands.registerCommand('antigravity-agy-proxy.refreshStatus', async () => {
			await statusManager.refreshStatus();
		})
	);

	// 注册诊断命令
	context.subscriptions.push(
		vscode.commands.registerCommand('antigravity-agy-proxy.diagnose', async () => {
			await diagnosticPanel.show();
		})
	);

	// 注册流量监控命令
	context.subscriptions.push(
		vscode.commands.registerCommand('antigravity-agy-proxy.showTrafficPanel', () => {
			trafficPanel.show();
		})
	);

	// 启动自动刷新状态
	statusManager.startAutoRefresh();

	if (isRunningLocally()) {
		activateLocal(context).catch(err => log(`activateLocal error: ${err}`));
	} else {
		activateRemote(context).catch(err => log(`activateRemote error: ${err}`));
	}
}

async function activateLocal(context: vscode.ExtensionContext) {
	// 设置配置变更回调（用于面板中修改配置时触发）
	statusManager.setConfigChangeCallback(async () => {
		const cfg = vscode.workspace.getConfiguration('antigravity-agy-proxy');
		const lp = cfg.get<number>('localProxyPort', 7890);
		const rp = cfg.get<number>('remoteProxyPort', 7890);
		const enabled = cfg.get<boolean>('enableLocalForwarding', true);
		await updateSSHConfigFile(rp, lp, enabled);
		statusManager.updateSSHConfigStatus(enabled, rp);
	});

	const config = vscode.workspace.getConfiguration('antigravity-agy-proxy');
	const enable = config.get<boolean>('enableLocalForwarding', true);
	const localPort = config.get<number>('localProxyPort', 7890);
	const remotePort = config.get<number>('remoteProxyPort', 7890);

	log(`Config: enable=${enable}, localPort=${localPort}, remotePort=${remotePort}`);

	// Auto-setup on activation
	if (enable) {
		await updateSSHConfigFile(remotePort, localPort, true);
		statusManager.updateSSHConfigStatus(true, remotePort);
		if (!await checkPortAvailable('127.0.0.1', localPort)) {
			vscode.window.showWarningMessage(
				`Local proxy at 127.0.0.1:${localPort} is not running. ` +
				`Also check if port ${remotePort} is occupied on the remote server before reconnecting.`
			);
		}
	}

	// 初始刷新状态
	await statusManager.refreshStatus();

	// 同步初始 SSH 配置状态
	const initialStatus = await getSSHConfigStatus();
	statusManager.updateSSHConfigStatus(initialStatus.enabled, initialStatus.port);

	// Watch config changes (from VS Code settings)
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (e: vscode.ConfigurationChangeEvent) => {
			if (e.affectsConfiguration('antigravity-agy-proxy')) {
				const cfg = vscode.workspace.getConfiguration('antigravity-agy-proxy');
				const lp = cfg.get<number>('localProxyPort', 7890);
				const rp = cfg.get<number>('remoteProxyPort', 7890);
				const enabled = cfg.get<boolean>('enableLocalForwarding', true);
				await updateSSHConfigFile(rp, lp, enabled);
				statusManager.updateSSHConfigStatus(enabled, rp);
				await statusManager.refreshStatus();
			}
		})
	);

	// Commands
	context.subscriptions.push(
		vscode.commands.registerCommand('antigravity-agy-proxy.enableForwarding', async () => {
			const cfg = vscode.workspace.getConfiguration('antigravity-agy-proxy');
			const lp = cfg.get<number>('localProxyPort', 7890);
			const rp = cfg.get<number>('remoteProxyPort', 7890);
			await updateSSHConfigFile(rp, lp, true);
			statusManager.updateSSHConfigStatus(true, rp);
			await statusManager.refreshStatus();
			vscode.window.showInformationMessage('SSH port forwarding enabled');
		}),

		vscode.commands.registerCommand('antigravity-agy-proxy.disableForwarding', async () => {
			await updateSSHConfigFile(0, 0, false);
			statusManager.updateSSHConfigStatus(false);
			await statusManager.refreshStatus();
			vscode.window.showInformationMessage('SSH port forwarding disabled');
		}),

		vscode.commands.registerCommand('antigravity-agy-proxy.tunnelStatus', async () => {
			const status = await getSSHConfigStatus();
			statusManager.updateSSHConfigStatus(status.enabled, status.port);
			vscode.window.showInformationMessage(
				status.enabled
					? `Forwarding configured on port: ${status.port}`
					: 'SSH port forwarding is not configured'
			);
		})
	);
}

/**
 * Ensure mgraftcp binary has execute permission
 */
async function ensureMgraftcpExecutable(extensionPath: string): Promise<void> {
	const arch = os.arch();
	let binaryName: string;

	switch (arch) {
		case 'x64':
		case 'amd64':
			binaryName = 'mgraftcp-fakedns-linux-amd64';
			break;
		case 'arm64':
		case 'aarch64':
			binaryName = 'mgraftcp-fakedns-linux-arm64';
			break;
		default:
			log(`Unsupported architecture: ${arch}`);
			return;
	}

	const mgraftcpPath = path.join(extensionPath, 'resources', 'bin', binaryName);

	try {
		await execAsync(`chmod +x "${mgraftcpPath}"`);
		log(`Set execute permission for ${mgraftcpPath}`);
	} catch (error) {
		log(`Failed to set execute permission for mgraftcp: ${error}`);
	}
}

async function syncFdGuardFromConfig(removeWhenDisabled: boolean): Promise<void> {
	const cfg = vscode.workspace.getConfiguration('antigravity-agy-proxy');
	const enabled = cfg.get<boolean>('enableFdGuard', false);
	const interval = cfg.get<number>('fdGuardIntervalMinutes', 15);
	const threshold = cfg.get<number>('fdGuardThreshold', 10000);

	if (enabled) {
		const res = await installFdGuard(interval, threshold);
		if (res.success) {
			log(`FD Guard cron active (*/${interval}m, threshold >${threshold})`);
		} else {
			log(`FD Guard cron install failed: ${res.error}`);
		}
	} else if (removeWhenDisabled) {
		const res = await removeFdGuard();
		if (res.success) {
			log('FD Guard cron removed');
		}
	}
}

async function executeAutoFixCommand(extensionPath: string, extensionVersion: string, silentIfHealthy = false): Promise<void> {
	const cfg = vscode.workspace.getConfiguration('antigravity-agy-proxy');
	const host = cfg.get<string>('remoteProxyHost', '127.0.0.1');
	const port = cfg.get<number>('remoteProxyPort', 7890);
	const type = normalizeProxyType(cfg.get<string>('proxyType', 'http'));
	const mode = normalizeProxyMode(cfg.get<string>('proxyMode', 'mgraftcp-no-fakedns'));
	const enableFdGuard = cfg.get<boolean>('enableFdGuard', false);
	const fdGuardIntervalMinutes = cfg.get<number>('fdGuardIntervalMinutes', 15);
	const fdGuardThreshold = cfg.get<number>('fdGuardThreshold', 10000);

	const runFix = async () => {
		const lang = statusManager.getLanguage();
		const isZh = lang === 'zh';
		const result = await runAutoFix({
			proxyHost: host,
			proxyPort: port,
			proxyType: type,
			proxyMode: mode,
			extensionPath,
			extensionVersion,
			enableFdGuard,
			fdGuardIntervalMinutes,
			fdGuardThreshold,
			lang,
			updateConfig: async (key, value) => {
				await vscode.workspace.getConfiguration('antigravity-agy-proxy').update(
					key,
					value,
					vscode.ConfigurationTarget.Global
				);
			},
			runSetup: async (h, p, t, m) => runSetupScriptSilently(h, p, t, m, extensionPath)
		});

		for (const act of result.actions) {
			log(`[AutoFix] ${act}`);
		}
		for (const rem of result.remainingIssues) {
			log(`[AutoFix][WARN] ${rem}`);
		}

		await statusManager.refreshStatus();

		if (silentIfHealthy && !result.changedConfig && !result.needsReload && result.remainingIssues.length === 0) {
			return;
		}

		const summary = result.actions.join(' | ');
		const runDiagLabel = isZh ? '运行诊断' : 'Run Diagnostics';
		const reloadLabel = isZh ? '立即重载' : 'Reload Now';
		const laterLabel = isZh ? '稍后' : 'Later';

		if (result.remainingIssues.length > 0) {
			const msg = isZh
				? `一键排错: ${summary}。待处理项: ${result.remainingIssues.join(' ')}`
				: `Auto Fix: ${summary}. Remaining: ${result.remainingIssues.join(' ')}`;
			vscode.window.showWarningMessage(
				msg,
				runDiagLabel,
				...(result.needsReload ? [reloadLabel] : [])
			).then(sel => {
				if (sel === runDiagLabel) {
					vscode.commands.executeCommand('antigravity-agy-proxy.diagnose');
				} else if (sel === reloadLabel) {
					vscode.commands.executeCommand('workbench.action.reloadWindow');
				}
			});
		} else if (result.needsReload) {
			const msg = isZh ? `一键排错已应用: ${summary}` : `Auto Fix applied: ${summary}`;
			vscode.window.showInformationMessage(
				msg,
				reloadLabel,
				laterLabel
			).then(sel => {
				if (sel === reloadLabel) {
					vscode.commands.executeCommand('workbench.action.reloadWindow');
				}
			});
		} else {
			vscode.window.showInformationMessage(isZh ? `一键排错: ${summary}` : `Auto Fix: ${summary}`);
		}
	};

	if (silentIfHealthy) {
		await runFix();
	} else {
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: statusManager.getLanguage() === 'zh'
					? 'Antigravity AGY Proxy: 正在执行一键排错...'
					: 'Antigravity AGY Proxy: Running Auto Fix...',
				cancellable: false
			},
			runFix
		);
	}
}

async function readExtensionVersion(extensionPath: string): Promise<string> {
	try {
		const packageJsonContent = await fs.readFile(path.join(extensionPath, 'package.json'), 'utf-8');
		const packageJson = JSON.parse(packageJsonContent) as { version?: string };
		return packageJson.version || 'unknown';
	} catch {
		return 'unknown';
	}
}

async function activateRemote(context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('antigravity-agy-proxy');
	const remoteHost = config.get<string>('remoteProxyHost', '127.0.0.1');
	const remotePort = config.get<number>('remoteProxyPort', 7890);
	const proxyType = normalizeProxyType(config.get<string>('proxyType', 'http'));
	const proxyMode = normalizeProxyMode(config.get<string>('proxyMode', 'mgraftcp-no-fakedns'));

	if (process.platform !== 'linux') {
		log(`Skipping setup: unsupported platform '${process.platform}' (only Linux is supported)`);
		return;
	}

	const extensionPath = context.extensionUri.fsPath;
	const extensionVersion = await readExtensionVersion(extensionPath);

	// Ensure mgraftcp binary has execute permission before setup
	await ensureMgraftcpExecutable(extensionPath);

	// Sync FD guard cron if enabled
	await syncFdGuardFromConfig(false);

	// Panel configuration callback
	statusManager.setConfigChangeCallback(async () => {
		const cfg = vscode.workspace.getConfiguration('antigravity-agy-proxy');
		const host = cfg.get<string>('remoteProxyHost', '127.0.0.1');
		const port = cfg.get<number>('remoteProxyPort', 7890);
		const type = normalizeProxyType(cfg.get<string>('proxyType', 'http'));
		const mode = normalizeProxyMode(cfg.get<string>('proxyMode', 'mgraftcp-no-fakedns'));
		log(`Config changed from panel, re-running setup: ${host}:${port} (${type}, ${mode})`);
		const success = await runSetupScriptSilently(host, port, type, mode, extensionPath);
		statusManager.updateLanguageServerStatus(success);
		await syncFdGuardFromConfig(true);
	});

	log(`Remote Proxy: ${remoteHost}:${remotePort} (${proxyType}, mode=${proxyMode})`);

	await statusManager.refreshStatus();

	// Auto-run setup script
	log(`Extension path: ${extensionPath}`);
	log('Auto-running setup script...');
	const setupSuccess = await runSetupScriptSilently(remoteHost, remotePort, proxyType, proxyMode, extensionPath);
	statusManager.updateLanguageServerStatus(setupSuccess);

	// Watch config changes (from VS Code settings)
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async (e: vscode.ConfigurationChangeEvent) => {
			if (
				e.affectsConfiguration('antigravity-agy-proxy.remoteProxyHost') ||
				e.affectsConfiguration('antigravity-agy-proxy.remoteProxyPort') ||
				e.affectsConfiguration('antigravity-agy-proxy.proxyType') ||
				e.affectsConfiguration('antigravity-agy-proxy.proxyMode')
			) {
				const cfg = vscode.workspace.getConfiguration('antigravity-agy-proxy');
				const host = cfg.get<string>('remoteProxyHost', '127.0.0.1');
				const port = cfg.get<number>('remoteProxyPort', 7890);
				const type = normalizeProxyType(cfg.get<string>('proxyType', 'http'));
				const mode = normalizeProxyMode(cfg.get<string>('proxyMode', 'mgraftcp-no-fakedns'));
				log(`Config changed, re-running setup: ${host}:${port} (${type}, ${mode})`);
				const success = await runSetupScriptSilently(host, port, type, mode, extensionPath);
				statusManager.updateLanguageServerStatus(success);
				await statusManager.refreshStatus();
			}
			if (
				e.affectsConfiguration('antigravity-agy-proxy.enableFdGuard') ||
				e.affectsConfiguration('antigravity-agy-proxy.fdGuardIntervalMinutes') ||
				e.affectsConfiguration('antigravity-agy-proxy.fdGuardThreshold')
			) {
				await syncFdGuardFromConfig(true);
			}
		})
	);

	// Remote commands
	context.subscriptions.push(
		vscode.commands.registerCommand('antigravity-agy-proxy.setup', () => {
			const cfg = vscode.workspace.getConfiguration('antigravity-agy-proxy');
			const host = cfg.get<string>('remoteProxyHost', '127.0.0.1');
			const port = cfg.get<number>('remoteProxyPort', 7890);
			const type = normalizeProxyType(cfg.get<string>('proxyType', 'http'));
			const mode = normalizeProxyMode(cfg.get<string>('proxyMode', 'mgraftcp-no-fakedns'));
			const terminal = vscode.window.createTerminal('Antigravity AGY Proxy Setup');
			terminal.show();
			const script = generateSetupScript(host, port, type, extensionPath, mode);
			terminal.sendText(`cat > /tmp/ag_setup.sh << 'EOF'\n${script}\nEOF`);
			terminal.sendText(`EXTENSION_PATH="${extensionPath}" EXTENSION_VERSION="${extensionVersion}" bash /tmp/ag_setup.sh`);
		}),

		vscode.commands.registerCommand('antigravity-agy-proxy.rollback', () => {
			const terminal = vscode.window.createTerminal('Antigravity AGY Proxy Rollback');
			terminal.show();
			terminal.sendText(generateRollbackScript(true));
			statusManager.updateLanguageServerStatus(false);
		}),

		vscode.commands.registerCommand('antigravity-agy-proxy.checkProxy', async () => {
			const cfg = vscode.workspace.getConfiguration('antigravity-agy-proxy');
			const host = cfg.get<string>('remoteProxyHost', '127.0.0.1');
			const port = cfg.get<number>('remoteProxyPort', 7890);
			const ok = await checkPortAvailable(host, port);
			await statusManager.refreshStatus();
			vscode.window.showInformationMessage(ok ? `Proxy OK (${host}:${port})` : `Proxy NOT reachable (${host}:${port})`);
		}),

		vscode.commands.registerCommand('antigravity-agy-proxy.autoFix', async () => {
			await executeAutoFixCommand(extensionPath, extensionVersion, false);
		}),

		vscode.commands.registerCommand('antigravity-agy-proxy.toggleFdGuard', async () => {
			const cfg = vscode.workspace.getConfiguration('antigravity-agy-proxy');
			const currentlyEnabled = cfg.get<boolean>('enableFdGuard', false);
			const nextEnabled = !currentlyEnabled;
			await cfg.update('enableFdGuard', nextEnabled, vscode.ConfigurationTarget.Global);
			await syncFdGuardFromConfig(true);
			await statusManager.refreshStatus();
			const interval = cfg.get<number>('fdGuardIntervalMinutes', 15);
			const threshold = cfg.get<number>('fdGuardThreshold', 10000);
			vscode.window.showInformationMessage(
				nextEnabled
					? `FD Guard crontab installed (every ${interval}m, threshold >${threshold}).`
					: 'FD Guard crontab removed.'
			);
		})
	);

	// Show startup status notification if enabled
	const showStatusOnStartup = config.get<boolean>('showStatusOnStartup', true);
	if (showStatusOnStartup) {
		setTimeout(async () => {
			await showStartupStatus(remoteHost, remotePort, extensionPath, extensionVersion);
		}, 2000);
	}
}

/**
 * Show detailed warning when proxy is not reachable on the remote side.
 * Covers three possible causes: SSH tunnel not established, port mismatch, local proxy not running.
 */
async function showSSHTunnelNotEstablishedWarning(proxyHost: string, proxyPort: number): Promise<void> {
	const detailMessage =
		`Proxy not reachable at ${proxyHost}:${proxyPort}\n\n` +
		`This can happen for several reasons. Please check each one:\n\n` +
		`─── Cause 1: SSH tunnel not established ───\n` +
		`You may have connected directly via Antigravity's "Recent Connections"\n` +
		`without opening a local window first.\n` +
		`Fix:\n` +
		`  1. Close this remote connection\n` +
		`  2. Open a new local window (File > New Window)\n` +
		`  3. Connect to the remote server from the local window\n\n` +
		`─── Cause 2: Port mismatch ───\n` +
		`The "Remote Port" in the Local AGY Proxy panel must equal\n` +
		`the "Proxy Port" in the Remote AGY Proxy panel.\n` +
		`Fix:\n` +
		`  1. Open the AGY Proxy panel (click the status bar item)\n` +
		`  2. In the Local window: note the "Remote Port" value\n` +
		`  3. In the Remote window: set "Proxy Port" to the same value\n` +
		`  4. Save and reconnect\n\n` +
		`─── Cause 3: Local proxy software not running ───\n` +
		`The local proxy (e.g., Clash, V2Ray) may not be started,\n` +
		`or its port does not match the "Local Port" in the AGY Proxy panel.\n` +
		`Fix:\n` +
		`  1. Start your local proxy software\n` +
		`  2. Open the AGY Proxy panel and confirm "Local Port" matches your proxy's port\n` +
		`  3. Save and reconnect`;

	log('Showing proxy not reachable warning dialog');

	const selection = await vscode.window.showWarningMessage(
		detailMessage,
		{ modal: true },
		'Open AGY Proxy Panel',
		'Run Diagnostics',
		'Close Remote Connection',
		'Dismiss'
	);

	if (selection === 'Open AGY Proxy Panel') {
		vscode.commands.executeCommand('antigravity-agy-proxy.showStatusPanel');
	} else if (selection === 'Run Diagnostics') {
		vscode.commands.executeCommand('antigravity-agy-proxy.diagnose');
	} else if (selection === 'Close Remote Connection') {
		vscode.window.showInformationMessage(
			'After closing: 1) Open a new local window  2) Connect to remote from there',
			'Got it'
		).then(() => {
			vscode.commands.executeCommand('workbench.action.remote.close');
		});
	}
}

/**
 * Show startup status notification with detailed diagnostics in output channel
 */
async function showStartupStatus(
	proxyHost: string,
	proxyPort: number,
	extensionPath: string,
	extensionVersion: string
): Promise<void> {
	try {
		const config = vscode.workspace.getConfiguration('antigravity-agy-proxy');
		const currentProxyType = normalizeProxyType(config.get<string>('proxyType', 'http'));
		const currentProxyMode = normalizeProxyMode(config.get<string>('proxyMode', 'mgraftcp-no-fakedns'));
		const fdGuardThreshold = config.get<number>('fdGuardThreshold', 10000);
		const autoFixOnStartup = config.get<boolean>('autoFixOnStartup', false);

		log('');
		log('========== Startup Status Check ==========');
		log(`Proxy endpoint: ${proxyHost}:${proxyPort} (${currentProxyType}, mode=${currentProxyMode})`);
		log('');

		// Test 1: Port connectivity
		log(`[Test 1] Checking port connectivity...`);
		const proxyReachable = await checkPortAvailable(proxyHost, proxyPort);
		log(`  Result: ${proxyReachable ? '✓ Port is reachable' : '✗ Port is NOT reachable'}`);
		log('');

		// Test 2: mgraftcp process (aware of env-only mode)
		log(`[Test 2] Checking mgraftcp process status...`);
		const proxyActive = await isMgraftcpRunning();
		if (currentProxyMode === 'env-only') {
			log(`  Result: ○ env-only mode configured (mgraftcp intentionally bypassed)`);
		} else {
			log(`  Result: ${proxyActive ? '✓ mgraftcp is running (proxy active)' : '✗ mgraftcp is NOT running'}`);
		}
		log('');

		// Test 2.5: Backend process status (agy --hub & legacy LS)
		log(`[Test 2.5] Checking Antigravity backend process status...`);
		const lsProcess = await getLanguageServerProcess();
		if (lsProcess) {
			const targetLabel = lsProcess.targetType === 'agy' ? 'agy --hub' : 'Language Server';
			const modeLabel = lsProcess.isPersistent ? 'persistent mode' : 'normal mode';
			const proxyLabel = lsProcess.isUsingProxy ? `using proxy (${lsProcess.detectedMode})` : 'NOT using proxy';
			const statusIcon = lsProcess.isUsingProxy ? '✓' : (lsProcess.isPersistent ? '✗' : '⚠');
			log(`  Result: ${statusIcon} ${targetLabel} (PID ${lsProcess.pid}, FDs ${lsProcess.fdCount}) is running in ${modeLabel}, ${proxyLabel}`);

			if (lsProcess.isPersistent && !lsProcess.isUsingProxy) {
				log(`  ⚠️ WARNING: Backend is in persistent mode without proxy! Will kill to apply wrapper...`);
			}
		} else {
			log(`  Result: ○ No backend process running yet (will start via wrapper on demand)`);
		}
		log('');

		// Test 2.6: UDP / FD health check
		const udpHealth = await inspectUdpAndFdHealth(undefined, Math.min(fdGuardThreshold, 2000));
		const udpPct = Math.round(udpHealth.udpUsageRatio * 100);
		log(`[Test 2.6] FD & UDP socket health: maxFDs=${udpHealth.maxBackendFdCount}, udp=${udpHealth.udpSocketsTotal}/${udpHealth.ephemeralCapacity} (${udpPct}%)`);
		const hasCriticalFdOrFakeDns =
			udpHealth.maxBackendFdCount >= fdGuardThreshold ||
			udpHealth.udpUsageRatio >= 0.7 ||
			udpHealth.recentLogErrors.fakednsBindFailed ||
			udpHealth.recentLogErrors.tooManyOpenFiles;
		if (hasCriticalFdOrFakeDns) {
			log(`  ⚠️ CRITICAL: Detected high FD count / UDP saturation / FakeDNS exhaustion!`);
			if (autoFixOnStartup) {
				log('  autoFixOnStartup=true: executing automatic remediation...');
				await executeAutoFixCommand(extensionPath, extensionVersion, true);
				return;
			}
		}
		log('');

		// Test 3..5: External connectivity (HTTP, SOCKS5, SOCKS5H)
		if (proxyReachable) {
			const testCurl = async (label: string, protoFlag: string, protoKey: ProxyProtocol) => {
				log(`[Test] Testing ${label} proxy connectivity...`);
				const cmd = `curl -s -o /dev/null -w "%{http_code}" --max-time 8 ${protoFlag} https://www.google.com/generate_204`;
				try {
					const { stdout } = await execAsync(cmd, { timeout: 10000 });
					const httpCode = stdout.trim();
					const ok = httpCode === '204' || httpCode === '200' || httpCode === '301' || httpCode === '302';
					const marker = currentProxyType === protoKey ? ' ← Current' : '';
					log(`  Result: HTTP ${httpCode} ${ok ? '✓ OK' : '✗ Failed'}${marker}`);
				} catch {
					const marker = currentProxyType === protoKey ? ' ← Current (⚠️ NOT WORKING)' : '';
					log(`  Result: ✗ Failed${marker}`);
				}
			};

			await testCurl('HTTP', `-x http://${proxyHost}:${proxyPort}`, 'http');
			await testCurl('SOCKS5', `--socks5 ${proxyHost}:${proxyPort}`, 'socks5');
			await testCurl('SOCKS5H (remote DNS)', `--socks5-hostname ${proxyHost}:${proxyPort}`, 'socks5h');
			log('');
		}

		log('==========================================');
		log('');

		let message: string;
		let actions: string[] = [];

		const lsProcessForDecision = await getLanguageServerProcess();
		const lsActuallyUsingProxy = lsProcessForDecision?.isUsingProxy ?? false;
		const lsIsPersistent = lsProcessForDecision?.isPersistent ?? false;
		const lsNeedsRestart = lsProcessForDecision && lsIsPersistent && !lsActuallyUsingProxy;

		if (hasCriticalFdOrFakeDns) {
			message = `⚠️ High FD/UDP usage detected (FDs=${udpHealth.maxBackendFdCount}, UDP=${udpPct}%).`;
			actions = ['Auto Fix', 'Run Diagnostics', 'Dismiss'];
		} else if (proxyReachable && lsActuallyUsingProxy) {
			message = `✅ Proxy active (${proxyHost}:${proxyPort}, ${currentProxyMode})`;
		} else if (proxyReachable && lsNeedsRestart) {
			log('Startup: Detected persistent backend not using proxy, auto-fixing...');
			const killed = await killLanguageServer();
			if (killed) {
				message = `🔄 Antigravity backend restarted to enable proxy. Reloading...`;
				actions = ['Reload Now'];
				setTimeout(() => {
					vscode.commands.executeCommand('workbench.action.reloadWindow');
				}, 2000);
			} else {
				message = `⚠️ Proxy configured but backend needs restart.`;
				actions = ['Auto Fix', 'Reload Now', 'Dismiss'];
			}
		} else if (proxyReachable) {
			message = lsProcessForDecision && !lsActuallyUsingProxy
				? `⚠️ Proxy configured but backend started before wrapper. Reload to enable.`
				: `⚠️ Proxy configured (${currentProxyMode}). Reload if backend just initialized.`;
			actions = ['Reload Now', 'Run Diagnostics', 'Dismiss'];
		} else {
			log('Proxy not reachable - SSH tunnel may not be established');
			await showSSHTunnelNotEstablishedWarning(proxyHost, proxyPort);
			return;
		}

		log(`Startup status: ${message}`);

		if (actions.length > 0) {
			const selection = await vscode.window.showInformationMessage(message, ...actions);
			if (selection === 'Reload Now') {
				vscode.commands.executeCommand('workbench.action.reloadWindow');
			} else if (selection === 'Auto Fix') {
				await vscode.commands.executeCommand('antigravity-agy-proxy.autoFix');
			} else if (selection === 'Run Diagnostics') {
				vscode.commands.executeCommand('antigravity-agy-proxy.diagnose');
			}
		} else {
			vscode.window.showInformationMessage(message);
		}
	} catch (error) {
		log(`Startup status check failed: ${error}`);
	}
}

/**
 * Run setup script silently in background (idempotent)
 * @returns true if setup was successful or already configured
 */
async function runSetupScriptSilently(
	proxyHost: string,
	proxyPort: number,
	proxyType: ProxyProtocol,
	proxyMode: ProxyMode,
	extensionPath: string
): Promise<boolean> {
	const scriptPath = path.join(extensionPath, 'scripts', 'setup-proxy.sh');

	try {
		await execAsync(`chmod +x "${scriptPath}"`);
		const extensionVersion = await readExtensionVersion(extensionPath);

		const env = {
			...process.env,
			PROXY_HOST: proxyHost,
			PROXY_PORT: String(proxyPort),
			PROXY_TYPE: proxyType,
			PROXY_MODE: proxyMode,
			EXTENSION_PATH: extensionPath,
			EXTENSION_VERSION: extensionVersion
		};

		const { stdout, stderr } = await execAsync(`bash "${scriptPath}" 2>&1`, { env });
		const output = stdout || stderr || '';

		log(`Setup output: ${output}`);

		const isNewConfig = output.includes('Setup complete') ||
			(output.includes('configured') && !output.includes('Already configured'));

		if (isNewConfig) {
			log('Setup: New configuration applied');
			const lsProcess = await getLanguageServerProcess();
			if (lsProcess && lsProcess.isPersistent) {
				log('Setup: Persistent backend detected, killing to apply new configuration');
				const killed = await killLanguageServer();
				if (killed) {
					promptReloadWindow(
						'Antigravity proxy updated. Backend restarted. Please reload the window to reconnect.'
					);
				} else {
					vscode.window.showWarningMessage(
						'Proxy updated but Antigravity backend needs restart. Please reload window.',
						'Reload Now'
					).then(selection => {
						if (selection === 'Reload Now') {
							vscode.commands.executeCommand('workbench.action.reloadWindow');
						}
					});
				}
			} else {
				promptReloadWindow(
					'Antigravity proxy configured. Reload window to apply changes.'
				);
			}
			return true;
		} else if (output.includes('Already configured')) {
			log('Setup: Already configured');

			const lsProcess = await getLanguageServerProcess();
			const lsActuallyUsingProxy = lsProcess?.isUsingProxy ?? false;
			const lsIsPersistent = lsProcess?.isPersistent ?? false;

			if (lsProcess && !lsActuallyUsingProxy) {
				log('Setup: Proxy configured but backend not using it');
				if (lsIsPersistent) {
					log('Setup: Killing unwrapped persistent backend to force restart through wrapper');
					const killed = await killLanguageServer();
					if (killed) {
						promptReloadWindow(
							'Antigravity backend restarted to enable proxy. Please reload the window to reconnect.'
						);
					} else {
						vscode.window.showWarningMessage(
							'Proxy configured but backend needs restart. Please reload window.',
							'Reload Now'
						).then(selection => {
							if (selection === 'Reload Now') {
								vscode.commands.executeCommand('workbench.action.reloadWindow');
							}
						});
					}
				} else {
					promptReloadWindow(
						'Proxy is configured but not active. Reload window to enable proxy.'
					);
				}
			} else if (lsActuallyUsingProxy) {
				log('Setup: Proxy is active, no reload needed');
			} else {
				log('Setup: Backend not running yet, will start with wrapper when needed');
			}
			return true;
		}
		return false;
	} catch (error: unknown) {
		const err = error as { message?: string; stdout?: string; stderr?: string };
		log(`Setup error: ${err.message || error}`);
		if (err.stdout) { log(`stdout: ${err.stdout}`); }
		if (err.stderr) { log(`stderr: ${err.stderr}`); }
		return false;
	}
}

export async function deactivate() {
	if (statusManager) {
		statusManager.stopAutoRefresh();
	}
	if (isRunningLocally()) {
		try {
			await updateSSHConfigFile(0, 0, false);
		} catch (e) {
			log(`Cleanup during deactivation failed: ${e}`);
		}
	}
}
