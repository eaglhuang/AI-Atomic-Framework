import path from 'node:path';

export const DEFAULT_ROOT = path.join('.atm-temp', 'captain-dispatch-mailbox');
export const DEFAULT_CAPTAIN_MODEL = 'codex-5.4';
export const DEFAULT_WORKER_MODEL = 'gpt-5.4-mini';
export const DEFAULT_AGENTS = ['001', '002', '003'];
export const LOCK_STALE_MS = 15 * 60 * 1000;
export const DEFAULT_CAPTAIN_NO_REPORT_LIMIT = 5;
export const DEFAULT_CAPTAIN_NO_DISPATCH_MINUTES = 10;
export const DEFAULT_WORKER_NO_DISPATCH_LIMIT = 10;
export const DEFAULT_WORKER_NO_REPORT_MINUTES = 15;
