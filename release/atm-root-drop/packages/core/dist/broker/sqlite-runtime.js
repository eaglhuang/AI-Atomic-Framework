import { createRequire } from 'node:module';
const requireBuiltin = createRequire(import.meta.url);
let databaseSync = null;
/**
 * Load node:sqlite on first use instead of at import time. A static import
 * made every ATM command print Node's "SQLite is an experimental feature"
 * warning on supported Node 24 releases, and agents that read ATM's JSON
 * from stdout and stderr together failed to parse it. Only that one warning
 * is filtered, and only while the module loads.
 */
export function loadDatabaseSync() {
    if (databaseSync)
        return databaseSync;
    const emitWarning = process.emitWarning;
    process.emitWarning = function filteredEmitWarning(warning, ...rest) {
        const text = typeof warning === 'string' ? warning : warning?.message;
        if (/SQLite is an experimental feature/i.test(String(text ?? '')))
            return;
        return emitWarning.call(process, warning, ...rest);
    };
    try {
        databaseSync = requireBuiltin('node:sqlite').DatabaseSync;
    }
    finally {
        process.emitWarning = emitWarning;
    }
    return databaseSync;
}
