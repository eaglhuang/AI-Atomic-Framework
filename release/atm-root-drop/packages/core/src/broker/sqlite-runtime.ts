import { createRequire } from 'node:module';
import type { DatabaseSync } from 'node:sqlite';

const requireBuiltin = createRequire(import.meta.url);
let databaseSync: typeof DatabaseSync | null = null;

/**
 * Load node:sqlite on first use instead of at import time. A static import
 * made every ATM command print Node's "SQLite is an experimental feature"
 * warning on supported Node 24 releases, and agents that read ATM's JSON
 * from stdout and stderr together failed to parse it. Only that one warning
 * is filtered, and only while the module loads.
 */
export function loadDatabaseSync(): typeof DatabaseSync {
  if (databaseSync) return databaseSync;
  const emitWarning = process.emitWarning;
  process.emitWarning = function filteredEmitWarning(this: unknown, warning: string | Error, ...rest: unknown[]) {
    const text = typeof warning === 'string' ? warning : warning?.message;
    if (/SQLite is an experimental feature/i.test(String(text ?? ''))) return;
    return (emitWarning as (...args: unknown[]) => void).call(process, warning, ...rest);
  } as typeof process.emitWarning;
  try {
    databaseSync = (requireBuiltin('node:sqlite') as { DatabaseSync: typeof DatabaseSync }).DatabaseSync;
  } finally {
    process.emitWarning = emitWarning;
  }
  return databaseSync;
}
