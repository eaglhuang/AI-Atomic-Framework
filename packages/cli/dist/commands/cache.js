import { enableGuideCache, disableGuideCache, clearCache, getCacheStatus } from '../../../core/dist/cache/guide-cache.js';
import { CliError, makeResult, message } from './shared.js';
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const KNOWN_CACHE_ACTIONS = ['enable', 'disable', 'clear', 'status', 'prune'];
function parseCacheArgs(argv) {
    let cwd = process.cwd();
    let goalFilter;
    let keep;
    let runtime;
    let dryRun = false;
    const positionals = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--goal' && argv[i + 1]) {
            goalFilter = argv[++i];
        }
        else if (arg === '--cwd' && argv[i + 1]) {
            cwd = path.resolve(argv[++i]);
        }
        else if (arg === '--keep' && argv[i + 1]) {
            keep = Number(argv[++i]);
        }
        else if (arg === '--runtime' && argv[i + 1]) {
            runtime = argv[++i];
        }
        else if (arg === '--dry-run') {
            dryRun = true;
        }
        else if (!arg.startsWith('-')) {
            positionals.push(arg);
        }
    }
    return { cwd, action: positionals[0] ?? 'status', goalFilter, keep, dryRun, runtime };
}
export async function runCache(argv) {
    const options = parseCacheArgs(argv);
    if (!KNOWN_CACHE_ACTIONS.includes(options.action)) {
        throw new CliError('ATM_CLI_USAGE', `cache subcommand "${options.action}" not recognized. Valid: ${KNOWN_CACHE_ACTIONS.join(', ')}`, { exitCode: 2 });
    }
    switch (options.action) {
        case 'enable':
            return runCacheEnable(options);
        case 'disable':
            return runCacheDisable(options);
        case 'clear':
            return runCacheClear(options);
        case 'status':
            return runCacheStatus(options);
        case 'prune':
            return runCachePrune(options);
        default:
            throw new CliError('ATM_CLI_USAGE', `Unhandled cache action: ${options.action}`, { exitCode: 2 });
    }
}
function runCacheEnable(options) {
    enableGuideCache(options.cwd);
    return makeResult({
        ok: true,
        command: 'cache',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_CACHE_ENABLED', 'Guide Cache enabled. candidates rank will now use the cache.', {
                enabled: true,
                warning: 'Guide Cache is opt-in due to AI-drift risk. Dirty working tree will always bypass cache. Use --no-cache to skip per-call.'
            })
        ],
        evidence: { enabled: true }
    });
}
function runCacheDisable(options) {
    disableGuideCache(options.cwd);
    return makeResult({
        ok: true,
        command: 'cache',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_CACHE_DISABLED', 'Guide Cache disabled. Cache files are preserved and can be re-enabled.', { enabled: false })
        ],
        evidence: { enabled: false }
    });
}
function runCacheClear(options) {
    const result = clearCache(options.cwd, { goalFilter: options.goalFilter });
    return makeResult({
        ok: true,
        command: 'cache',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_CACHE_CLEARED', `Cleared ${result.clearedEntries} cache entry(ies), freed ${result.freedBytes} bytes.`, {
                clearedEntries: result.clearedEntries,
                freedBytes: result.freedBytes,
                goalFilter: options.goalFilter ?? null
            })
        ],
        evidence: { result }
    });
}
function runCacheStatus(options) {
    const status = getCacheStatus(options.cwd);
    const onefileCache = options.runtime === 'onefile' ? getOnefileCacheStatus() : null;
    return makeResult({
        ok: true,
        command: 'cache',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_CACHE_STATUS', onefileCache
                ? `One-file cache: ${onefileCache.entryCount} entry(ies), ${onefileCache.totalBytes} bytes.`
                : status.enabled
                    ? `Guide Cache enabled. ${status.entryCount} entry(ies), ${status.totalBytes} bytes.`
                    : 'Guide Cache disabled (run `atm cache enable` to opt in).', onefileCache ? { onefileCache } : status)
        ],
        evidence: onefileCache ? { onefileCache } : { status }
    });
}
function runCachePrune(options) {
    const runtime = options.runtime ?? 'onefile';
    if (runtime !== 'onefile') {
        throw new CliError('ATM_CLI_USAGE', 'cache prune currently supports only --runtime onefile.', { exitCode: 2 });
    }
    const keep = Number.isFinite(options.keep) && Number(options.keep) >= 0
        ? Math.floor(Number(options.keep))
        : 3;
    const result = pruneOnefileCache({
        keep,
        dryRun: options.dryRun === true,
        currentPayloadSha256: process.env.ATM_ONEFILE_PAYLOAD_SHA256 ?? null
    });
    return makeResult({
        ok: true,
        command: 'cache',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_CACHE_PRUNED', options.dryRun
                ? `Dry-run: would prune ${result.prunedCount} one-file cache entr${result.prunedCount === 1 ? 'y' : 'ies'}, freeing ${result.freedBytes} bytes.`
                : `Pruned ${result.prunedCount} one-file cache entr${result.prunedCount === 1 ? 'y' : 'ies'}, freed ${result.freedBytes} bytes.`, result)
        ],
        evidence: { result }
    });
}
function getOnefileCacheStatus() {
    const cacheRoot = getOnefileCacheRoot();
    const entries = listOnefileCacheEntries(cacheRoot);
    return {
        schemaId: 'atm.onefileCacheStatus.v1',
        cacheRoot,
        entryCount: entries.length,
        totalBytes: entries.reduce((sum, entry) => sum + entry.totalBytes, 0),
        entries
    };
}
function pruneOnefileCache(options) {
    const cacheRoot = getOnefileCacheRoot();
    const entries = listOnefileCacheEntries(cacheRoot);
    const protectedNames = new Set();
    if (options.currentPayloadSha256) {
        protectedNames.add(options.currentPayloadSha256);
    }
    for (const entry of entries.slice(0, options.keep)) {
        protectedNames.add(entry.name);
    }
    const pruneCandidates = entries.filter((entry) => !protectedNames.has(entry.name));
    const pruned = [];
    const errors = [];
    let freedBytes = 0;
    for (const entry of pruneCandidates) {
        if (!options.dryRun) {
            try {
                rmSync(entry.path, { recursive: true, force: true });
            }
            catch (error) {
                errors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
                continue;
            }
        }
        pruned.push(entry.name);
        freedBytes += entry.totalBytes;
    }
    return {
        schemaId: 'atm.onefileCachePruneReport.v1',
        cacheRoot,
        keep: options.keep,
        dryRun: options.dryRun,
        protectedEntries: [...protectedNames],
        beforeEntryCount: entries.length,
        prunedCount: pruned.length,
        pruned,
        freedBytes,
        errors,
        ok: errors.length === 0
    };
}
function getOnefileCacheRoot() {
    return process.env.ATM_ONEFILE_CACHE_ROOT
        ? path.resolve(process.env.ATM_ONEFILE_CACHE_ROOT)
        : path.join(os.tmpdir(), 'atm-onefile-cache');
}
function listOnefileCacheEntries(cacheRoot) {
    if (!existsSync(cacheRoot)) {
        return [];
    }
    return readdirSync(cacheRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
        const absolutePath = path.join(cacheRoot, entry.name);
        const stats = statSync(absolutePath);
        const summary = summarizeDirectory(absolutePath);
        return {
            name: entry.name,
            path: absolutePath,
            lastWriteTimeMs: stats.mtimeMs,
            fileCount: summary.fileCount,
            totalBytes: summary.totalBytes
        };
    })
        .sort((left, right) => right.lastWriteTimeMs - left.lastWriteTimeMs);
}
function summarizeDirectory(directory) {
    let fileCount = 0;
    let totalBytes = 0;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            const nested = summarizeDirectory(absolutePath);
            fileCount += nested.fileCount;
            totalBytes += nested.totalBytes;
            continue;
        }
        const stats = statSync(absolutePath);
        fileCount += 1;
        totalBytes += stats.size;
    }
    return { fileCount, totalBytes };
}
