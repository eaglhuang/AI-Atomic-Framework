import { runRescuePolice } from '../../../core/dist/police/rescue-family.js';
import { diagnoseRecovery, clearCache, factoryReset, rebuildCapsuleRegistry, rebuildMapRegistry, reloadAtomsFromCapsules, replayLineageFromEvidence } from '../../../core/dist/rescue/disaster-recovery.js';
import { repairClosurePacketForTask } from './framework-development.js';
import { CliError, makeResult, message } from './shared.js';
function parseRescueArgs(argv) {
    let cwd = process.cwd();
    let dryRun = false;
    let confirm = false;
    let iUnderstandThisDeletesState = false;
    let map;
    let task;
    let amend = false;
    const positionals = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--dry-run') {
            dryRun = true;
        }
        else if (arg === '--confirm') {
            confirm = true;
        }
        else if (arg === '--i-understand-this-deletes-state') {
            iUnderstandThisDeletesState = true;
        }
        else if ((arg === '--cwd' || arg === '--repo') && argv[i + 1]) {
            cwd = argv[++i];
        }
        else if (arg === '--map' && argv[i + 1]) {
            map = argv[++i];
        }
        else if (arg === '--task' && argv[i + 1]) {
            task = argv[++i];
        }
        else if (arg === '--amend') {
            amend = true;
        }
        else if (arg === '--no-amend') {
            amend = false;
        }
        else if (!arg.startsWith('-')) {
            positionals.push(arg);
        }
    }
    const action = positionals[0] ?? 'police';
    return { cwd, action, dryRun, confirm, iUnderstandThisDeletesState, map, task, amend };
}
const KNOWN_ACTIONS = [
    'police',
    'diagnose',
    'rebuild-registry',
    'reload-atoms',
    'closure-packet',
    'rebuild-maps',
    'replay-lineage',
    'clear-cache',
    'factory-reset'
];
export async function runRescue(argv) {
    const options = parseRescueArgs(argv);
    if (!KNOWN_ACTIONS.includes(options.action)) {
        throw new CliError('ATM_CLI_USAGE', `rescue subcommand "${options.action}" not recognized. Valid: ${KNOWN_ACTIONS.join(', ')}`, { exitCode: 2 });
    }
    switch (options.action) {
        case 'police':
            return runRescuePoliceAction(options);
        case 'diagnose':
            return runDiagnoseAction(options);
        case 'rebuild-registry':
            return runRebuildRegistryAction(options);
        case 'reload-atoms':
            return runReloadAtomsAction(options);
        case 'closure-packet':
            return runClosurePacketAction(options);
        case 'rebuild-maps':
            return runRebuildMapsAction(options);
        case 'replay-lineage':
            return runReplayLineageAction(options);
        case 'clear-cache':
            return runClearCacheAction(options);
        case 'factory-reset':
            return runFactoryResetAction(options);
        default:
            throw new CliError('ATM_CLI_USAGE', `Unhandled rescue action: ${options.action}`, { exitCode: 2 });
    }
}
function runRescuePoliceAction(options) {
    const report = runRescuePolice(options.cwd);
    return makeResult({
        ok: report.healthy,
        command: 'rescue',
        cwd: options.cwd,
        messages: [
            message(report.healthy ? 'info' : 'error', report.healthy ? 'ATM_RESCUE_HEALTHY' : 'ATM_RESCUE_BLOCKED', report.healthy
                ? 'Rescue police: all invariants passed.'
                : `Rescue police: ${report.blockingFindings.length} blocking finding(s) detected.`, {
                healthy: report.healthy,
                blockingFindings: report.blockingFindings.length,
                warnings: report.warnings.length,
                skipped: report.skipped.length,
                total: report.findings.length
            })
        ],
        evidence: { report }
    });
}
function runDiagnoseAction(options) {
    const report = diagnoseRecovery(options.cwd);
    const healthy = report.criticalFindings.length === 0;
    return makeResult({
        ok: healthy,
        command: 'rescue',
        cwd: options.cwd,
        messages: [
            message(healthy ? 'info' : 'error', healthy ? 'ATM_RESCUE_DIAGNOSE_HEALTHY' : 'ATM_RESCUE_DIAGNOSE_ISSUES', healthy
                ? 'Rescue diagnose: ATM state is healthy.'
                : `Rescue diagnose: ${report.criticalFindings.length} critical finding(s).`, {
                healthScore: report.healthScore,
                criticalFindings: report.criticalFindings.length,
                recommendedActions: report.recommendedActions
            })
        ],
        evidence: { report }
    });
}
function runRebuildRegistryAction(options) {
    const dryRun = options.dryRun || !options.confirm;
    const result = rebuildCapsuleRegistry(options.cwd, { dryRun });
    const ok = result.errors.length === 0;
    return makeResult({
        ok,
        command: 'rescue',
        cwd: options.cwd,
        messages: [
            message(ok ? 'info' : 'error', ok ? 'ATM_RESCUE_REBUILD_REGISTRY_OK' : 'ATM_RESCUE_REBUILD_REGISTRY_ERRORS', dryRun
                ? `Dry-run: would rebuild ${result.rebuiltEntries} capsule registry entries.`
                : `Rebuilt capsule registry with ${result.rebuiltEntries} entries.`, {
                dryRun: result.dryRun,
                rebuiltEntries: result.rebuiltEntries,
                orphanedCapsules: result.orphanedCapsules.length,
                missingCapsules: result.missingCapsules.length,
                errors: result.errors.length
            })
        ],
        evidence: { result }
    });
}
function runReloadAtomsAction(options) {
    const dryRun = options.dryRun || !options.confirm;
    const result = reloadAtomsFromCapsules(options.cwd, { dryRun });
    const ok = result.errors.length === 0;
    return makeResult({
        ok,
        command: 'rescue',
        cwd: options.cwd,
        messages: [
            message(ok ? 'info' : 'error', ok ? 'ATM_RESCUE_RELOAD_ATOMS_OK' : 'ATM_RESCUE_RELOAD_ATOMS_ERRORS', dryRun
                ? `Dry-run: would restore ${result.restoredFiles.length} atom source file(s).`
                : `Restored ${result.restoredFiles.length} atom source file(s) from capsules.`, {
                dryRun: result.dryRun,
                restoredCount: result.restoredFiles.length,
                skipped: result.skippedCapsules.length,
                errors: result.errors.length
            })
        ],
        evidence: { result }
    });
}
function runClosurePacketAction(options) {
    if (!options.task) {
        throw new CliError('ATM_CLI_USAGE', 'rescue closure-packet requires --task <taskId>', { exitCode: 2 });
    }
    const result = repairClosurePacketForTask({
        cwd: options.cwd,
        taskId: options.task,
        dryRun: options.dryRun,
        amend: options.amend
    });
    const stagedOnly = !result.amended;
    return makeResult({
        ok: true,
        command: 'rescue',
        cwd: options.cwd,
        messages: [
            message('info', options.dryRun ? 'ATM_RESCUE_CLOSURE_PACKET_DRY_RUN' : 'ATM_RESCUE_CLOSURE_PACKET_OK', options.dryRun
                ? `Dry-run: closure packet ${options.task} can be repaired without rewriting HEAD.`
                : stagedOnly
                    ? `Repaired and staged closure packet follow-up changes for ${options.task}. HEAD was not rewritten.`
                    : `Repaired closure packet for ${options.task}.`, {
                taskId: options.task,
                packetPath: result.packetPath,
                targetCommit: result.targetCommit,
                governedTreeSha: result.governedTreeSha,
                amended: result.amended,
                previousHead: result.previousHead,
                repairedHead: result.repairedHead,
                upstreamStatus: result.upstreamStatus,
                nextActionCommand: result.nextActionCommand,
                remediation: result.remediation
            })
        ],
        evidence: {
            result,
            delegatedCommand: `node atm.mjs tasks repair-closure --task ${options.task} --json`,
            nextAction: !options.dryRun && stagedOnly ? {
                kind: 'governed-commit-required',
                command: result.nextActionCommand,
                reason: result.remediation,
                message: result.commitMessage
            } : null
        }
    });
}
function runRebuildMapsAction(options) {
    const dryRun = options.dryRun || !options.confirm;
    const result = rebuildMapRegistry(options.cwd, { dryRun });
    const ok = result.errors.length === 0 && result.merkleErrors.length === 0;
    return makeResult({
        ok,
        command: 'rescue',
        cwd: options.cwd,
        messages: [
            message(ok ? 'info' : 'error', ok ? 'ATM_RESCUE_REBUILD_MAPS_OK' : 'ATM_RESCUE_REBUILD_MAPS_ERRORS', dryRun
                ? `Dry-run: would rebuild map registry with ${result.rebuiltEntries} entries.`
                : `Rebuilt map registry with ${result.rebuiltEntries} entries.`, {
                dryRun: result.dryRun,
                rebuiltEntries: result.rebuiltEntries,
                merkleErrors: result.merkleErrors.length,
                errors: result.errors.length
            })
        ],
        evidence: { result }
    });
}
function runReplayLineageAction(options) {
    if (!options.map) {
        throw new CliError('ATM_CLI_USAGE', 'rescue replay-lineage requires --map <mapId>', { exitCode: 2 });
    }
    const dryRun = options.dryRun || !options.confirm;
    const result = replayLineageFromEvidence(options.cwd, options.map, { dryRun });
    const ok = result.errors.length === 0;
    return makeResult({
        ok,
        command: 'rescue',
        cwd: options.cwd,
        messages: [
            message(ok ? 'info' : 'error', ok ? 'ATM_RESCUE_REPLAY_LINEAGE_OK' : 'ATM_RESCUE_REPLAY_LINEAGE_ERRORS', dryRun
                ? `Dry-run: would replay ${result.transitionsFound} transition(s) for map ${options.map}.`
                : `Replayed ${result.transitionsWritten} transition(s) for map ${options.map}.`, {
                dryRun: result.dryRun,
                transitionsFound: result.transitionsFound,
                transitionsWritten: result.transitionsWritten,
                outOfOrderFixed: result.outOfOrderFixed,
                errors: result.errors.length
            })
        ],
        evidence: { result }
    });
}
function runClearCacheAction(options) {
    const dryRun = options.dryRun || !options.confirm;
    const result = clearCache(options.cwd, { dryRun });
    const ok = result.errors.length === 0;
    return makeResult({
        ok,
        command: 'rescue',
        cwd: options.cwd,
        messages: [
            message(ok ? 'info' : 'error', ok ? 'ATM_RESCUE_CLEAR_CACHE_OK' : 'ATM_RESCUE_CLEAR_CACHE_ERRORS', dryRun
                ? `Dry-run: would clear ${result.clearedPaths.length} cache path(s).`
                : `Cleared ${result.clearedPaths.length} cache path(s).`, {
                dryRun: result.dryRun,
                clearedCount: result.clearedPaths.length,
                errors: result.errors.length
            })
        ],
        evidence: { result }
    });
}
function runFactoryResetAction(options) {
    const dryRun = options.dryRun || !options.confirm || !options.iUnderstandThisDeletesState;
    const result = factoryReset(options.cwd, {
        dryRun,
        confirm: options.confirm,
        iUnderstandThisDeletesState: options.iUnderstandThisDeletesState
    });
    if (result.errors.length > 0 && result.errors.some((e) => e.includes('Refusing'))) {
        throw new CliError('ATM_RESCUE_FACTORY_RESET_REFUSED', result.errors[0], { exitCode: 2 });
    }
    const ok = result.errors.length === 0;
    return makeResult({
        ok,
        command: 'rescue',
        cwd: options.cwd,
        messages: [
            message(ok ? 'info' : 'error', ok ? 'ATM_RESCUE_FACTORY_RESET_OK' : 'ATM_RESCUE_FACTORY_RESET_ERRORS', dryRun
                ? `Dry-run: would clear ${result.clearedPaths.length} derived state path(s).`
                : `Factory reset complete. ${result.clearedPaths.length} derived state path(s) cleared. Backup at ${result.backedUpTo}.`, {
                dryRun: result.dryRun,
                clearedCount: result.clearedPaths.length,
                backedUpTo: result.backedUpTo || null,
                errors: result.errors.length
            })
        ],
        evidence: { result }
    });
}
