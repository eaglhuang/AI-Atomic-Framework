import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDaemonEnabled, enableDaemon, disableDaemon, readDaemonPid, clearDaemonPid, isProcessRunning, readDaemonNotifications } from '../../../core/dist/daemon/daemon-config.js';
import { buildDefaultWatchPaths } from '../../../core/dist/daemon/daemon-watcher.js';
import { runRescuePolice } from '../../../core/dist/police/rescue-family.js';
import { CliError, makeResult, message } from './shared.js';
const KNOWN_DAEMON_ACTIONS = ['enable', 'disable', 'start', 'stop', 'status', 'log', '_watcher'];
function parseDaemonArgs(argv) {
    const cwd = process.cwd();
    let tail;
    let actor;
    const positionals = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--tail' && argv[i + 1]) {
            tail = parseInt(argv[++i], 10);
        }
        else if (arg === '--actor' && argv[i + 1]) {
            actor = argv[++i];
        }
        else if (!arg.startsWith('-')) {
            positionals.push(arg);
        }
    }
    return { cwd, action: positionals[0] ?? 'status', tail, actor };
}
export async function runDaemon(argv) {
    const options = parseDaemonArgs(argv);
    // Internal: _watcher is spawned as a child process
    if (options.action === '_watcher') {
        const { startDaemonWatcher, buildDefaultWatchPaths: bwp } = await import('../../../core/dist/daemon/daemon-watcher.js');
        const watchPaths = bwp(options.cwd);
        startDaemonWatcher({ repositoryRoot: options.cwd, watchPaths });
        return makeResult({
            ok: true,
            command: 'daemon',
            cwd: options.cwd,
            messages: [message('info', 'ATM_DAEMON_WATCHER_STARTED', 'Daemon watcher process started.', { pid: process.pid })],
            evidence: {}
        });
    }
    if (!KNOWN_DAEMON_ACTIONS.includes(options.action)) {
        throw new CliError('ATM_CLI_USAGE', `daemon subcommand "${options.action}" not recognized. Valid: ${KNOWN_DAEMON_ACTIONS.filter((a) => a !== '_watcher').join(', ')}`, { exitCode: 2 });
    }
    switch (options.action) {
        case 'enable':
            return runDaemonEnable(options);
        case 'disable':
            return runDaemonDisable(options);
        case 'start':
            return runDaemonStart(options);
        case 'stop':
            return runDaemonStop(options);
        case 'status':
            return runDaemonStatus(options);
        case 'log':
            return runDaemonLog(options);
        default:
            throw new CliError('ATM_CLI_USAGE', `Unhandled daemon action: ${options.action}`, { exitCode: 2 });
    }
}
function runDaemonEnable(options) {
    enableDaemon(options.cwd, options.actor);
    return makeResult({
        ok: true,
        command: 'daemon',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_DAEMON_ENABLED', 'Daemon enabled. Use `atm daemon start` to start the background watcher.', {
                enabled: true,
                warning: 'Daemon is opt-in for stability reasons. The daemon is advisory-only and will never mutate governed state.'
            })
        ],
        evidence: { enabled: true }
    });
}
function runDaemonDisable(options) {
    // Stop any running daemon first
    const pidRecord = readDaemonPid(options.cwd);
    if (pidRecord && isProcessRunning(pidRecord.pid)) {
        try {
            process.kill(pidRecord.pid, 'SIGTERM');
        }
        catch {
            // best effort
        }
        clearDaemonPid(options.cwd);
    }
    disableDaemon(options.cwd);
    return makeResult({
        ok: true,
        command: 'daemon',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_DAEMON_DISABLED', 'Daemon disabled and kill switch set. `atm daemon start` will be refused until re-enabled.', { enabled: false })
        ],
        evidence: { enabled: false }
    });
}
function runDaemonStart(options) {
    // Gate 1: Must be enabled
    if (!isDaemonEnabled(options.cwd)) {
        return makeResult({
            ok: false,
            command: 'daemon',
            cwd: options.cwd,
            messages: [
                message('error', 'ATM_DAEMON_NOT_ENABLED', 'Daemon is not enabled. Run `atm daemon enable` first.', { hint: 'Run `node atm.mjs daemon enable --json` to opt in.' })
            ],
            evidence: { enabled: false }
        });
    }
    // Gate 2: Rescue Police must pass
    const rescueReport = runRescuePolice(options.cwd);
    if (!rescueReport.healthy) {
        return makeResult({
            ok: false,
            command: 'daemon',
            cwd: options.cwd,
            messages: [
                message('error', 'ATM_DAEMON_RESCUE_BLOCKED', `Daemon start refused: ${rescueReport.blockingFindings.length} Rescue Police finding(s). Resolve with \`atm rescue police\` first.`, {
                    blockingFindings: rescueReport.blockingFindings.map((f) => ({
                        invariantId: f.invariantId,
                        description: f.description
                    }))
                })
            ],
            evidence: { rescueReport }
        });
    }
    // Gate 3: Single instance check
    const existingPid = readDaemonPid(options.cwd);
    if (existingPid && isProcessRunning(existingPid.pid)) {
        return makeResult({
            ok: false,
            command: 'daemon',
            cwd: options.cwd,
            messages: [
                message('error', 'ATM_DAEMON_ALREADY_RUNNING', `Daemon is already running with PID ${existingPid.pid}.`, { pid: existingPid.pid, startedAt: existingPid.startedAt })
            ],
            evidence: { pid: existingPid.pid, status: 'running' }
        });
    }
    // Clear stale PID
    if (existingPid) {
        clearDaemonPid(options.cwd);
    }
    const watchPaths = buildDefaultWatchPaths(options.cwd);
    // Spawn detached watcher process
    const atmEntry = resolveAtmEntry();
    if (!atmEntry) {
        throw new CliError('ATM_DAEMON_SPAWN_FAILED', 'Cannot locate atm.mjs entry point to spawn daemon process.', { exitCode: 1 });
    }
    const child = spawn(process.execPath, [atmEntry, 'daemon', '_watcher'], {
        cwd: options.cwd,
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, ATM_DAEMON_REPO_ROOT: options.cwd }
    });
    child.unref();
    return makeResult({
        ok: true,
        command: 'daemon',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_DAEMON_STARTED', `Daemon started (PID ${child.pid ?? 'unknown'}). Watching ${watchPaths.length} path(s).`, { pid: child.pid, watchPaths, status: 'running' })
        ],
        evidence: { pid: child.pid, watchPaths }
    });
}
function runDaemonStop(options) {
    const pidRecord = readDaemonPid(options.cwd);
    if (!pidRecord) {
        return makeResult({
            ok: true,
            command: 'daemon',
            cwd: options.cwd,
            messages: [message('info', 'ATM_DAEMON_NOT_RUNNING', 'No daemon PID file found — daemon is not running.', {})],
            evidence: { status: 'not-running' }
        });
    }
    if (!isProcessRunning(pidRecord.pid)) {
        clearDaemonPid(options.cwd);
        return makeResult({
            ok: true,
            command: 'daemon',
            cwd: options.cwd,
            messages: [message('info', 'ATM_DAEMON_STALE_PID', `Daemon PID ${pidRecord.pid} is not running. Cleared stale PID file.`, {})],
            evidence: { status: 'not-running', stalePid: pidRecord.pid }
        });
    }
    try {
        process.kill(pidRecord.pid, 'SIGTERM');
        clearDaemonPid(options.cwd);
        return makeResult({
            ok: true,
            command: 'daemon',
            cwd: options.cwd,
            messages: [
                message('info', 'ATM_DAEMON_STOPPED', `Daemon (PID ${pidRecord.pid}) stopped.`, { pid: pidRecord.pid })
            ],
            evidence: { pid: pidRecord.pid, status: 'stopped' }
        });
    }
    catch (err) {
        throw new CliError('ATM_DAEMON_STOP_FAILED', `Failed to stop daemon PID ${pidRecord.pid}: ${err}`, { exitCode: 1, details: { pid: pidRecord.pid } });
    }
}
function runDaemonStatus(options) {
    const enabled = isDaemonEnabled(options.cwd);
    const pidRecord = readDaemonPid(options.cwd);
    const isRunning = pidRecord ? isProcessRunning(pidRecord.pid) : false;
    const notifications = readDaemonNotifications(options.cwd, 5);
    const lastCheckAt = notifications.length > 0
        ? String(notifications[notifications.length - 1].timestamp ?? '')
        : null;
    const violationCount = notifications.filter((n) => n.event === 'file-changed').length;
    const uptimeMs = pidRecord && isRunning
        ? Date.now() - new Date(pidRecord.startedAt).getTime()
        : null;
    return makeResult({
        ok: true,
        command: 'daemon',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_DAEMON_STATUS', isRunning
                ? `Daemon running (PID ${pidRecord.pid}).`
                : enabled ? 'Daemon enabled but not running.' : 'Daemon is disabled.', {
                enabled,
                running: isRunning,
                pid: pidRecord?.pid ?? null,
                startedAt: pidRecord?.startedAt ?? null,
                uptimeSeconds: uptimeMs !== null ? Math.floor(uptimeMs / 1000) : null,
                lastCheckAt,
                violationCount
            })
        ],
        evidence: { enabled, running: isRunning, pid: pidRecord?.pid ?? null }
    });
}
function runDaemonLog(options) {
    const notifications = readDaemonNotifications(options.cwd, options.tail ?? 20);
    return makeResult({
        ok: true,
        command: 'daemon',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_DAEMON_LOG', `${notifications.length} notification(s) found.`, { count: notifications.length, tail: options.tail ?? 20 })
        ],
        evidence: { notifications }
    });
}
function resolveAtmEntry() {
    // Try to find atm.mjs relative to this module
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.resolve(__dirname, '..', '..', 'atm.mjs'),
        path.resolve(__dirname, '..', 'atm.ts'),
        path.resolve(process.cwd(), 'atm.mjs')
    ];
    for (const c of candidates) {
        if (existsSync(c))
            return c;
    }
    return null;
}
