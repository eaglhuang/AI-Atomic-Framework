import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const FEATURE_FLAGS_FILENAME = path.join('.atm', 'runtime', 'feature-flags.json');
const DAEMON_DISABLED_FLAG = path.join('.atm', 'runtime', 'daemon-disabled.flag');
const DAEMON_DIR = path.join('.atm', 'daemon');
const DAEMON_PID_FILE = path.join(DAEMON_DIR, 'daemon.pid');
const DAEMON_NOTIFICATIONS_FILE = path.join(DAEMON_DIR, 'notifications.jsonl');
export function getDaemonDir(repositoryRoot) {
    return path.join(repositoryRoot, DAEMON_DIR);
}
export function getDaemonPidPath(repositoryRoot) {
    return path.join(repositoryRoot, DAEMON_PID_FILE);
}
export function getDaemonNotificationsPath(repositoryRoot) {
    return path.join(repositoryRoot, DAEMON_NOTIFICATIONS_FILE);
}
export function isDaemonEnabled(repositoryRoot) {
    // Kill switch takes priority
    const disabledFlag = path.join(repositoryRoot, DAEMON_DISABLED_FLAG);
    if (existsSync(disabledFlag))
        return false;
    const flagsPath = path.join(repositoryRoot, FEATURE_FLAGS_FILENAME);
    if (!existsSync(flagsPath))
        return false;
    try {
        const flags = JSON.parse(readFileSync(flagsPath, 'utf-8'));
        return flags.daemonEnabled === true;
    }
    catch {
        return false;
    }
}
export function enableDaemon(repositoryRoot, enabledBy) {
    const flagsPath = path.join(repositoryRoot, FEATURE_FLAGS_FILENAME);
    mkdirSync(path.dirname(flagsPath), { recursive: true });
    let existing = {};
    if (existsSync(flagsPath)) {
        try {
            existing = JSON.parse(readFileSync(flagsPath, 'utf-8'));
        }
        catch {
            // start fresh
        }
    }
    const flags = {
        ...existing,
        daemonEnabled: true,
        enabledAt: new Date().toISOString(),
        enabledBy: enabledBy ?? 'unknown'
    };
    writeFileSync(flagsPath, JSON.stringify(flags, null, 2) + '\n');
    // Remove kill switch if present
    const disabledFlag = path.join(repositoryRoot, DAEMON_DISABLED_FLAG);
    if (existsSync(disabledFlag)) {
        const { unlinkSync } = require('node:fs');
        try {
            unlinkSync(disabledFlag);
        }
        catch { /* ignore */ }
    }
}
export function disableDaemon(repositoryRoot) {
    const flagsPath = path.join(repositoryRoot, FEATURE_FLAGS_FILENAME);
    if (existsSync(flagsPath)) {
        try {
            const flags = JSON.parse(readFileSync(flagsPath, 'utf-8'));
            flags.daemonEnabled = false;
            writeFileSync(flagsPath, JSON.stringify(flags, null, 2) + '\n');
        }
        catch {
            // ignore
        }
    }
    // Write kill switch flag
    const disabledFlag = path.join(repositoryRoot, DAEMON_DISABLED_FLAG);
    mkdirSync(path.dirname(disabledFlag), { recursive: true });
    writeFileSync(disabledFlag, `disabled at ${new Date().toISOString()}\n`);
}
export function readDaemonPid(repositoryRoot) {
    const pidPath = getDaemonPidPath(repositoryRoot);
    if (!existsSync(pidPath))
        return null;
    try {
        return JSON.parse(readFileSync(pidPath, 'utf-8'));
    }
    catch {
        return null;
    }
}
export function writeDaemonPid(repositoryRoot, record) {
    const pidPath = getDaemonPidPath(repositoryRoot);
    mkdirSync(path.dirname(pidPath), { recursive: true });
    writeFileSync(pidPath, JSON.stringify(record, null, 2) + '\n');
}
export function clearDaemonPid(repositoryRoot) {
    const pidPath = getDaemonPidPath(repositoryRoot);
    if (existsSync(pidPath)) {
        const { unlinkSync } = require('node:fs');
        try {
            unlinkSync(pidPath);
        }
        catch { /* ignore */ }
    }
}
export function isProcessRunning(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export function appendDaemonNotification(repositoryRoot, notification) {
    const notifPath = getDaemonNotificationsPath(repositoryRoot);
    mkdirSync(path.dirname(notifPath), { recursive: true });
    const line = JSON.stringify({ ...notification, timestamp: new Date().toISOString() }) + '\n';
    const { appendFileSync } = require('node:fs');
    appendFileSync(notifPath, line);
}
export function readDaemonNotifications(repositoryRoot, tail) {
    const notifPath = getDaemonNotificationsPath(repositoryRoot);
    if (!existsSync(notifPath))
        return [];
    try {
        const lines = readFileSync(notifPath, 'utf-8')
            .split('\n')
            .filter(Boolean)
            .map((line) => {
            try {
                return JSON.parse(line);
            }
            catch {
                return null;
            }
        })
            .filter(Boolean);
        return tail ? lines.slice(-tail) : lines;
    }
    catch {
        return [];
    }
}
