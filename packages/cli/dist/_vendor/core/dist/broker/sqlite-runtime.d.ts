import type { DatabaseSync } from 'node:sqlite';
/**
 * Load node:sqlite on first use instead of at import time. A static import
 * made every ATM command print Node's "SQLite is an experimental feature"
 * warning on supported Node 24 releases, and agents that read ATM's JSON
 * from stdout and stderr together failed to parse it. Only that one warning
 * is filtered, and only while the module loads.
 */
export declare function loadDatabaseSync(): typeof DatabaseSync;
