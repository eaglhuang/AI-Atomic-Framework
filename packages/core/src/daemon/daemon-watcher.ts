/**
 * ATM Daemon Watcher Process
 *
 * This module is designed to run as a detached child process.
 * Entry point: node atm.mjs daemon _watcher <repositoryRoot>
 *
 * Constraints:
 * - NEVER mutates registry, map.spec, or evidence directly
 * - All findings are advisory (written to notifications.jsonl)
 * - Single instance enforced by PID file
 * - Kill switch respected on every tick
 */

import { existsSync, mkdirSync, watch } from 'node:fs';
import path from 'node:path';
import {
  isDaemonEnabled,
  appendDaemonNotification,
  writeDaemonPid,
  getDaemonDir
} from './daemon-config.ts';

export interface DaemonWatcherConfig {
  repositoryRoot: string;
  watchPaths: string[];
  debounceMs?: number;
}

export function buildDefaultWatchPaths(repositoryRoot: string): string[] {
  const paths: string[] = [];

  const candidates = [
    path.join(repositoryRoot, 'atomic_workbench', 'maps'),
    path.join(repositoryRoot, 'atomic_workbench', 'atoms'),
    path.join(repositoryRoot, '.atm', 'runtime')
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      paths.push(p);
    }
  }

  return paths;
}

export function startDaemonWatcher(config: DaemonWatcherConfig): void {
  const { repositoryRoot, watchPaths, debounceMs = 2000 } = config;

  // Ensure daemon dir exists
  mkdirSync(getDaemonDir(repositoryRoot), { recursive: true });

  // Write PID
  writeDaemonPid(repositoryRoot, {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    repositoryRoot,
    watchPaths
  });

  appendDaemonNotification(repositoryRoot, {
    event: 'daemon-started',
    pid: process.pid,
    watchPaths,
    action: 'advisory'
  });

  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  for (const watchPath of watchPaths) {
    if (!existsSync(watchPath)) continue;

    try {
      const watcher = watch(watchPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        const fullPath = path.join(watchPath, filename);
        const key = fullPath;

        // Debounce rapid changes
        if (debounceTimers.has(key)) {
          clearTimeout(debounceTimers.get(key)!);
        }

        debounceTimers.set(key, setTimeout(() => {
          debounceTimers.delete(key);
          handleFileChange(repositoryRoot, fullPath, filename, eventType);
        }, debounceMs));
      });

      watcher.on('error', (err) => {
        appendDaemonNotification(repositoryRoot, {
          event: 'watcher-error',
          path: watchPath,
          error: String(err),
          action: 'advisory'
        });
      });
    } catch (err) {
      appendDaemonNotification(repositoryRoot, {
        event: 'watcher-setup-failed',
        path: watchPath,
        error: String(err),
        action: 'advisory'
      });
    }
  }

  // Heartbeat every 60 seconds; check kill switch
  const heartbeatInterval = setInterval(() => {
    if (!isDaemonEnabled(repositoryRoot)) {
      appendDaemonNotification(repositoryRoot, {
        event: 'daemon-kill-switch-triggered',
        action: 'advisory'
      });
      process.exit(0);
    }
    appendDaemonNotification(repositoryRoot, {
      event: 'daemon-heartbeat',
      pid: process.pid,
      action: 'advisory'
    });
  }, 60_000);

  process.on('SIGTERM', () => {
    clearInterval(heartbeatInterval);
    appendDaemonNotification(repositoryRoot, {
      event: 'daemon-stopped',
      pid: process.pid,
      reason: 'SIGTERM',
      action: 'advisory'
    });
    process.exit(0);
  });

  process.on('SIGINT', () => {
    clearInterval(heartbeatInterval);
    appendDaemonNotification(repositoryRoot, {
      event: 'daemon-stopped',
      pid: process.pid,
      reason: 'SIGINT',
      action: 'advisory'
    });
    process.exit(0);
  });
}

function handleFileChange(
  repositoryRoot: string,
  fullPath: string,
  filename: string,
  eventType: string
): void {
  // Check kill switch on every event
  if (!isDaemonEnabled(repositoryRoot)) {
    process.exit(0);
  }

  const notification: Record<string, unknown> = {
    event: 'file-changed',
    path: fullPath,
    filename,
    eventType,
    action: 'advisory'
  };

  // Classify change type
  if (filename.includes('map.spec.json')) {
    notification.checkType = 'fingerprint-check';
    notification.hint = `Run: node atm.mjs test --map <mapId> --fingerprint-check --json`;
  } else if (filename.includes('lineage-log.json')) {
    notification.checkType = 'lineage-monotonicity';
    notification.hint = `Run: node atm.mjs rescue police --json`;
  } else if (filename.endsWith('.ts') || filename.endsWith('.py')) {
    notification.checkType = 'police-gate';
    notification.hint = `Run: node atm.mjs police run --json`;
  } else if (filename.includes('feature-flags.json') || filename.includes('policy.json')) {
    notification.checkType = 'policy-reload';
    notification.hint = `Policy changed — daemon will apply on next event.`;
  }

  appendDaemonNotification(repositoryRoot, notification);
}
