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
export interface DaemonWatcherConfig {
    repositoryRoot: string;
    watchPaths: string[];
    debounceMs?: number;
}
export declare function buildDefaultWatchPaths(repositoryRoot: string): string[];
export declare function startDaemonWatcher(config: DaemonWatcherConfig): void;
