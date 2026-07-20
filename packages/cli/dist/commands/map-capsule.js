import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { exportMapCapsule, importMapCapsule, convertSpecToMapBundle, validateMapCidFormat, mapCidToShortId, MapCapsuleError } from '../../../core/dist/registry/map-capsule.js';
import { loadMapRegistry, saveMapRegistry, upsertMapEntry, linkMapChain, markMapRolledBack, getGlobalMapRegistryPath, getRepoMapRegistryPath } from '../../../core/dist/registry/map-capsule-registry.js';
import { loadCapsuleRegistry, getGlobalRegistryPath } from '../../../core/dist/registry/capsule-registry.js';
import { CliError, makeResult, message } from './shared.js';
function parseMapCapsuleArgs(argv) {
    const options = { cwd: process.cwd(), vendor: true };
    let action = '';
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--') && !action) {
            action = arg;
            continue;
        }
        if (arg === '--cwd') {
            options.cwd = argv[++i];
            continue;
        }
        if (arg === '--map') {
            options.map = argv[++i];
            continue;
        }
        if (arg === '--cid') {
            options.cid = argv[++i];
            continue;
        }
        if (arg === '--payload') {
            options.payload = argv[++i];
            continue;
        }
        if (arg === '--no-vendor') {
            options.vendor = false;
            continue;
        }
        if (arg === '--previous-cid') {
            options.previousCid = argv[++i];
            continue;
        }
        if (arg === '--exported-by') {
            options.exportedBy = argv[++i];
            continue;
        }
        if (arg === '--name') {
            options.name = argv[++i];
            continue;
        }
    }
    if (!action) {
        throw new CliError('ATM_CLI_USAGE', 'Usage: atm map-capsule <export|import|rollback> [options]', { exitCode: 2 });
    }
    return { action, options };
}
export async function runMapCapsule(argv) {
    const { action, options } = parseMapCapsuleArgs(argv);
    const cwd = path.resolve(options.cwd);
    switch (action) {
        case 'export': return runMapExport(cwd, options);
        case 'import': return runMapImport(cwd, options);
        case 'rollback': return runMapRollback(cwd, options);
        default:
            throw new CliError('ATM_CLI_USAGE', `Unknown action "${action}". Usage: atm map-capsule <export|import|rollback>`, { exitCode: 2 });
    }
}
async function runMapExport(cwd, options) {
    const mapId = options.map ?? '';
    if (!mapId)
        throw new CliError('ATM_CLI_USAGE', 'map-capsule export requires --map <id>', { exitCode: 2 });
    // Read map.spec.json
    const mapSpecPath = path.join(cwd, 'atomic_workbench', 'maps', mapId, 'map.spec.json');
    if (!existsSync(mapSpecPath)) {
        throw new CliError('ATM_MAP_CAPSULE_NOT_FOUND', `map.spec.json not found for ${mapId}: ${mapSpecPath}`, { exitCode: 1 });
    }
    const mapSpec = JSON.parse(readFileSync(mapSpecPath, 'utf-8'));
    // Build atomId -> atomCid map from Capsule Registry
    const capsuleRegistry = loadCapsuleRegistry(getGlobalRegistryPath());
    const atomCidMap = {};
    for (const [cid, entry] of Object.entries(capsuleRegistry.entries)) {
        if (entry.atomId)
            atomCidMap[entry.atomId] = cid;
    }
    // Convert spec to bundle (using atomCids)
    let bundle;
    try {
        bundle = convertSpecToMapBundle(mapSpec, atomCidMap);
    }
    catch (err) {
        if (err instanceof MapCapsuleError) {
            throw new CliError(err.code, err.message, { details: err.details });
        }
        throw err;
    }
    const capsule = exportMapCapsule(bundle);
    const previousCid = options.previousCid ?? null;
    // Write to Map Registry
    const globalRegPath = getGlobalMapRegistryPath();
    const repoRegPath = getRepoMapRegistryPath(cwd);
    const globalReg = loadMapRegistry(globalRegPath);
    const repoReg = loadMapRegistry(repoRegPath);
    const entry = {
        mapId,
        humanName: options.name ?? mapId,
        memberAtomCids: bundle.members.map((m) => m.atomCid),
        exportedAt: new Date().toISOString(),
        exportedBy: options.exportedBy ?? 'unknown',
        previousMapCid: previousCid,
        storageLocations: []
    };
    upsertMapEntry(globalReg, capsule.mapCid, entry);
    upsertMapEntry(repoReg, capsule.mapCid, entry);
    if (previousCid) {
        linkMapChain(globalReg, previousCid, capsule.mapCid);
        linkMapChain(repoReg, previousCid, capsule.mapCid);
    }
    saveMapRegistry(globalReg, globalRegPath);
    saveMapRegistry(repoReg, repoRegPath);
    return makeResult({
        ok: true,
        command: 'map-capsule',
        cwd,
        messages: [message('info', 'ATM_MAP_CAPSULE_EXPORT_OK', 'Map capsule exported successfully.', {
                mapId, mapCid: capsule.mapCid
            })],
        evidence: {
            mapId,
            mapCid: capsule.mapCid,
            shortId: mapCidToShortId(capsule.mapCid),
            memberAtomCids: bundle.members.map((m) => m.atomCid),
            compressedPayload: capsule.compressedPayload,
            previousCid
        }
    });
}
async function runMapImport(cwd, options) {
    const mapCid = options.cid ?? '';
    const payload = options.payload ?? '';
    if (!mapCid)
        throw new CliError('ATM_CLI_USAGE', 'map-capsule import requires --cid <map:cid>', { exitCode: 2 });
    if (!payload)
        throw new CliError('ATM_CLI_USAGE', 'map-capsule import requires --payload <base64>', { exitCode: 2 });
    validateMapCidFormat(mapCid);
    let importResult;
    try {
        importResult = importMapCapsule(mapCid, payload, { repositoryRoot: cwd });
    }
    catch (err) {
        if (err instanceof MapCapsuleError) {
            throw new CliError(err.code, err.message, { details: err.details });
        }
        throw err;
    }
    return makeResult({
        ok: true,
        command: 'map-capsule',
        cwd,
        messages: [message('info', 'ATM_MAP_CAPSULE_IMPORT_OK', 'Map capsule imported and verified.', { mapCid })],
        evidence: {
            mapCid,
            bundlePath: importResult.bundlePath,
            verified: importResult.verified,
            memberCount: importResult.bundle.members.length
        }
    });
}
async function runMapRollback(cwd, options) {
    const mapCid = options.cid ?? '';
    if (!mapCid)
        throw new CliError('ATM_CLI_USAGE', 'map-capsule rollback requires --cid <map:cid>', { exitCode: 2 });
    validateMapCidFormat(mapCid);
    const globalRegPath = getGlobalMapRegistryPath();
    const globalReg = loadMapRegistry(globalRegPath);
    const entry = globalReg.entries[mapCid];
    if (!entry)
        throw new CliError('ATM_MAP_CAPSULE_NOT_FOUND', `No map registry entry found for: ${mapCid}`, { exitCode: 1 });
    if (!entry.previousMapCid)
        throw new CliError('ATM_MAP_CAPSULE_NO_PREVIOUS', `No previousMapCid for ${mapCid}`, { exitCode: 1 });
    markMapRolledBack(globalReg, mapCid);
    saveMapRegistry(globalReg, globalRegPath);
    const repoRegPath = getRepoMapRegistryPath(cwd);
    if (existsSync(repoRegPath)) {
        const repoReg = loadMapRegistry(repoRegPath);
        markMapRolledBack(repoReg, mapCid);
        saveMapRegistry(repoReg, repoRegPath);
    }
    return makeResult({
        ok: true,
        command: 'map-capsule',
        cwd,
        messages: [message('info', 'ATM_MAP_CAPSULE_ROLLBACK_OK', 'Map capsule rolled back.', {
                mapCid, previousMapCid: entry.previousMapCid
            })],
        evidence: { mapCid, previousMapCid: entry.previousMapCid, action: 'rolled-back' }
    });
}
