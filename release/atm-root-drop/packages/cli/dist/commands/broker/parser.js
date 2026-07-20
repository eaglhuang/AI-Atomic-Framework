// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.js';
import { defaultBrokerProposalStoreRelativePath, findBrokerProposal, loadBrokerProposalStore, readBrokerProposalFile } from '../../../../core/dist/broker/proposal.js';
const defaultFallbackBrokerRunEvidenceRelativeDir = path.join('.atm', 'runtime', 'broker-collision-evidence', 'runs');
export function parseBrokerArgs(argv) {
    const state = {
        cwd: process.cwd(),
        action: null,
        proposalAction: null,
        stewardAction: null,
        runtimeAction: null,
        runnerSyncAction: null,
        projectionAction: null,
        scheduleAction: null,
        batchAction: null,
        parallelAdmissionAction: null,
        policyMode: null,
        policyFallbackMode: null,
        policyCircuitBreaker: null,
        reason: null,
        task: null,
        actorId: null,
        sealedSourceSha: null,
        stewardWorkId: null,
        receiptRef: null,
        receiptDigest: null,
        projectionKey: null,
        waveId: null,
        surfaceKind: null,
        surfaceFamily: null,
        payloadDigest: null,
        manifestDigest: null,
        currentHeadSha: null,
        expectedHeadSha: null,
        expectedTasks: [],
        collectionTimeoutMs: 120000,
        intentFile: null,
        freezeId: null,
        ttlSeconds: 1800,
        surfaces: [],
        sourceItems: [],
        proposalFiles: [],
        proposalIds: [],
        proposalIdPositional: null,
        proposalStorePath: null,
        mergePlanFile: null,
        scopeFiles: [],
        claimedTasks: [],
        validatorTasks: [],
        fileSlices: [],
        commandManifestPath: null,
        runCommand: null,
        outputFiles: [],
        stewardId: null,
        evidenceOutPath: null,
        requestFiles: [],
        requestsDir: null,
        runEvidenceDir: null,
        apply: false
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--cwd') {
            state.cwd = requireValue(argv, index, '--cwd');
            index += 1;
            continue;
        }
        if (arg === '--task') {
            state.task = requireValue(argv, index, '--task');
            index += 1;
            continue;
        }
        if (arg === '--actor') {
            state.actorId = requireValue(argv, index, '--actor');
            index += 1;
            continue;
        }
        if (arg === '--sealed-source-sha') {
            state.sealedSourceSha = requireValue(argv, index, '--sealed-source-sha');
            index += 1;
            continue;
        }
        if (arg === '--steward-work-id') {
            state.stewardWorkId = requireValue(argv, index, '--steward-work-id');
            index += 1;
            continue;
        }
        if (arg === '--receipt-ref' || arg === '--receipt') {
            state.receiptRef = requireValue(argv, index, arg);
            index += 1;
            continue;
        }
        if (arg === '--receipt-digest') {
            state.receiptDigest = requireValue(argv, index, '--receipt-digest');
            index += 1;
            continue;
        }
        if (arg === '--projection-key') {
            state.projectionKey = requireValue(argv, index, '--projection-key');
            index += 1;
            continue;
        }
        if (arg === '--wave') {
            state.waveId = requireValue(argv, index, '--wave');
            index += 1;
            continue;
        }
        if (arg === '--surface-kind') {
            const surfaceKind = requireValue(argv, index, '--surface-kind');
            if (!['commit', 'build', 'runner-sync', 'projection', 'checkpoint'].includes(surfaceKind)) {
                throw new CliError('ATM_CLI_USAGE', `unsupported --surface-kind ${surfaceKind}`, { exitCode: 2 });
            }
            state.surfaceKind = surfaceKind;
            index += 1;
            continue;
        }
        if (arg === '--surface-family') {
            state.surfaceFamily = requireValue(argv, index, '--surface-family');
            index += 1;
            continue;
        }
        if (arg === '--payload-digest') {
            state.payloadDigest = requireValue(argv, index, '--payload-digest');
            index += 1;
            continue;
        }
        if (arg === '--manifest-digest') {
            state.manifestDigest = requireValue(argv, index, '--manifest-digest');
            index += 1;
            continue;
        }
        if (arg === '--current-head') {
            state.currentHeadSha = requireValue(argv, index, '--current-head');
            index += 1;
            continue;
        }
        if (arg === '--expected-head') {
            state.expectedHeadSha = requireValue(argv, index, '--expected-head');
            index += 1;
            continue;
        }
        if (arg === '--expected-task') {
            state.expectedTasks.push(requireValue(argv, index, '--expected-task'));
            index += 1;
            continue;
        }
        if (arg === '--collection-timeout-ms') {
            const parsed = Number.parseInt(requireValue(argv, index, '--collection-timeout-ms'), 10);
            state.collectionTimeoutMs = Number.isFinite(parsed) && parsed >= 0 ? parsed : 120000;
            index += 1;
            continue;
        }
        if (arg === '--surface') {
            state.surfaces.push(requireValue(argv, index, '--surface'));
            index += 1;
            continue;
        }
        if (arg === '--source-item') {
            state.sourceItems.push(requireValue(argv, index, '--source-item'));
            index += 1;
            continue;
        }
        if (arg === '--intent-file') {
            state.intentFile = requireValue(argv, index, '--intent-file');
            index += 1;
            continue;
        }
        if (arg === '--freeze-id') {
            state.freezeId = requireValue(argv, index, '--freeze-id');
            index += 1;
            continue;
        }
        if (arg === '--ttl-seconds') {
            const val = requireValue(argv, index, '--ttl-seconds');
            const parsed = parseInt(val, 10);
            state.ttlSeconds = !Number.isFinite(parsed) || parsed <= 0 ? 1800 : parsed;
            index += 1;
            continue;
        }
        if (arg === '--mode') {
            const mode = requireValue(argv, index, '--mode');
            if (!['enforce', 'observe'].includes(mode)) {
                throw new CliError('ATM_CLI_USAGE', `unsupported --mode ${mode}`, { exitCode: 2 });
            }
            state.policyMode = mode;
            index += 1;
            continue;
        }
        if (arg === '--fallback-mode') {
            const mode = requireValue(argv, index, '--fallback-mode');
            if (!['queue-only', 'fail-closed'].includes(mode)) {
                throw new CliError('ATM_CLI_USAGE', `unsupported --fallback-mode ${mode}`, { exitCode: 2 });
            }
            state.policyFallbackMode = mode;
            index += 1;
            continue;
        }
        if (arg === '--circuit-breaker') {
            const value = requireValue(argv, index, '--circuit-breaker').trim().toLowerCase();
            if (!['true', 'false'].includes(value)) {
                throw new CliError('ATM_CLI_USAGE', '--circuit-breaker requires true or false.', { exitCode: 2 });
            }
            state.policyCircuitBreaker = value === 'true';
            index += 1;
            continue;
        }
        if (arg === '--reason') {
            state.reason = requireValue(argv, index, '--reason');
            index += 1;
            continue;
        }
        if (arg === '--proposal-file') {
            state.proposalFiles.push(requireValue(argv, index, '--proposal-file'));
            index += 1;
            continue;
        }
        if (arg === '--proposal-id') {
            state.proposalIds.push(requireValue(argv, index, '--proposal-id').trim());
            index += 1;
            continue;
        }
        if (arg === '--store') {
            state.proposalStorePath = requireValue(argv, index, '--store');
            index += 1;
            continue;
        }
        if (arg === '--merge-plan-file') {
            state.mergePlanFile = requireValue(argv, index, '--merge-plan-file');
            index += 1;
            continue;
        }
        if (arg === '--scope-file') {
            state.scopeFiles.push(requireValue(argv, index, '--scope-file'));
            index += 1;
            continue;
        }
        if (arg === '--claimed-task') {
            state.claimedTasks.push(requireValue(argv, index, '--claimed-task'));
            index += 1;
            continue;
        }
        if (arg === '--validator-task') {
            state.validatorTasks.push(requireValue(argv, index, '--validator-task'));
            index += 1;
            continue;
        }
        if (arg === '--file-slice') {
            state.fileSlices.push(requireValue(argv, index, '--file-slice'));
            index += 1;
            continue;
        }
        if (arg === '--run-command') {
            state.runCommand = requireValue(argv, index, '--run-command');
            index += 1;
            continue;
        }
        if (arg === '--command-manifest') {
            state.commandManifestPath = requireValue(argv, index, '--command-manifest');
            index += 1;
            continue;
        }
        if (arg === '--output-file') {
            state.outputFiles.push(requireValue(argv, index, '--output-file'));
            index += 1;
            continue;
        }
        if (arg === '--steward-id') {
            state.stewardId = requireValue(argv, index, '--steward-id');
            index += 1;
            continue;
        }
        if (arg === '--evidence-out') {
            state.evidenceOutPath = requireValue(argv, index, '--evidence-out');
            index += 1;
            continue;
        }
        if (arg === '--run-evidence-dir') {
            state.runEvidenceDir = requireValue(argv, index, '--run-evidence-dir');
            index += 1;
            continue;
        }
        if (arg === '--request-file') {
            state.requestFiles.push(requireValue(argv, index, '--request-file'));
            index += 1;
            continue;
        }
        if (arg === '--requests-dir') {
            state.requestsDir = requireValue(argv, index, '--requests-dir');
            index += 1;
            continue;
        }
        if (arg === '--apply') {
            state.apply = true;
            continue;
        }
        if (arg.startsWith('--')) {
            throw new CliError('ATM_CLI_USAGE', `broker does not support option ${arg}`, { exitCode: 2 });
        }
        if (!state.action) {
            state.action = arg;
        }
        else if (state.action === 'proposal' && !state.proposalAction) {
            state.proposalAction = arg;
        }
        else if (state.action === 'proposal' && state.proposalAction && !state.proposalIdPositional) {
            state.proposalIdPositional = arg;
        }
        else if (state.action === 'steward' && !state.stewardAction) {
            state.stewardAction = arg;
        }
        else if (state.action === 'runtime' && !state.runtimeAction) {
            state.runtimeAction = arg;
        }
        else if (state.action === 'runner-sync' && !state.runnerSyncAction) {
            state.runnerSyncAction = arg;
        }
        else if (state.action === 'projection' && !state.projectionAction) {
            state.projectionAction = arg;
        }
        else if (state.action === 'schedule' && !state.scheduleAction) {
            state.scheduleAction = arg;
        }
        else if (state.action === 'batch' && !state.batchAction) {
            state.batchAction = arg;
        }
        else if (state.action === 'batch' && state.batchAction === 'execute' && arg === 'commit') {
            state.surfaces.push(arg);
        }
        else if (state.action === 'parallel-admission' && !state.parallelAdmissionAction) {
            state.parallelAdmissionAction = arg;
        }
        else {
            throw new CliError('ATM_CLI_USAGE', 'broker accepts only one action (and optional proposal subaction).', { exitCode: 2 });
        }
    }
    const proposalIds = state.proposalIds.length > 0
        ? state.proposalIds
        : state.proposalIdPositional
            ? [state.proposalIdPositional]
            : [];
    return {
        cwd: path.resolve(state.cwd),
        action: state.action,
        proposalAction: state.proposalAction,
        stewardAction: state.stewardAction,
        runtimeAction: state.runtimeAction,
        runnerSyncAction: state.runnerSyncAction,
        projectionAction: state.projectionAction,
        scheduleAction: state.scheduleAction,
        batchAction: state.batchAction,
        parallelAdmissionAction: state.parallelAdmissionAction,
        policyMode: state.policyMode,
        policyFallbackMode: state.policyFallbackMode,
        policyCircuitBreaker: state.policyCircuitBreaker,
        reason: state.reason,
        task: state.task,
        actorId: state.actorId,
        sealedSourceSha: state.sealedSourceSha,
        stewardWorkId: state.stewardWorkId,
        receiptRef: state.receiptRef,
        receiptDigest: state.receiptDigest,
        projectionKey: state.projectionKey,
        waveId: state.waveId,
        surfaceKind: state.surfaceKind,
        surfaceFamily: state.surfaceFamily,
        payloadDigest: state.payloadDigest,
        manifestDigest: state.manifestDigest,
        currentHeadSha: state.currentHeadSha,
        expectedHeadSha: state.expectedHeadSha,
        expectedTasks: state.expectedTasks,
        collectionTimeoutMs: state.collectionTimeoutMs,
        intentFile: state.intentFile,
        freezeId: state.freezeId,
        ttlSeconds: state.ttlSeconds,
        surfaces: state.surfaces,
        sourceItems: state.sourceItems,
        proposalFiles: state.proposalFiles,
        proposalIds,
        proposalStorePath: state.proposalStorePath,
        mergePlanFile: state.mergePlanFile,
        scopeFiles: state.scopeFiles,
        claimedTasks: state.claimedTasks,
        validatorTasks: state.validatorTasks,
        fileSlices: state.fileSlices,
        commandManifestPath: state.commandManifestPath,
        runCommand: state.runCommand,
        outputFiles: state.outputFiles,
        stewardId: state.stewardId,
        evidenceOutPath: state.evidenceOutPath,
        requestFiles: state.requestFiles,
        requestsDir: state.requestsDir,
        runEvidenceDir: state.runEvidenceDir,
        apply: state.apply
    };
}
function readConfiguredBrokerRunEvidenceDir(cwd) {
    try {
        const configPath = path.join(cwd, '.atm', 'config.json');
        if (!existsSync(configPath)) {
            return null;
        }
        const config = JSON.parse(readFileSync(configPath, 'utf8'));
        const broker = config && typeof config === 'object' ? config.broker : null;
        const brokerRecord = broker && typeof broker === 'object' && !Array.isArray(broker)
            ? broker
            : null;
        const dir = brokerRecord?.runEvidenceDir ?? null;
        return typeof dir === 'string' && dir.trim() ? dir.trim() : null;
    }
    catch {
        return null;
    }
}
export function resolveBrokerRunEvidenceDir(options) {
    const configuredDir = options.runEvidenceDir
        ?? process.env.ATM_BROKER_RUN_EVIDENCE_DIR
        ?? readConfiguredBrokerRunEvidenceDir(options.cwd)
        ?? null;
    if (configuredDir) {
        return path.resolve(options.cwd, configuredDir);
    }
    return path.resolve(options.cwd, defaultFallbackBrokerRunEvidenceRelativeDir);
}
export function normalizeEvidencePath(cwd, filePath) {
    const absolute = path.resolve(filePath);
    const relative = path.relative(cwd, absolute);
    return relative.startsWith('..') || path.isAbsolute(relative)
        ? absolute.replace(/\\/g, '/')
        : relative.replace(/\\/g, '/');
}
export function loadComposeProposals(options) {
    const proposals = [];
    const seen = new Set();
    for (const proposalFile of options.proposalFiles) {
        const proposal = readBrokerProposalFile(path.resolve(options.cwd, proposalFile));
        if (!seen.has(proposal.proposalId)) {
            seen.add(proposal.proposalId);
            proposals.push(proposal);
        }
    }
    if (options.proposalStorePath || options.proposalIds.length > 0) {
        const storePath = path.join(options.cwd, options.proposalStorePath ?? defaultBrokerProposalStoreRelativePath);
        const store = loadBrokerProposalStore(storePath);
        const ids = options.proposalIds.length > 0
            ? [...options.proposalIds].sort((left, right) => left.localeCompare(right))
            : [...store.proposals].map((proposal) => proposal.proposalId).sort((left, right) => left.localeCompare(right));
        for (const proposalId of ids) {
            const proposal = findBrokerProposal(store, proposalId);
            if (!proposal) {
                throw new CliError('ATM_BROKER_PROPOSAL_NOT_FOUND', `Broker proposal not found: ${proposalId}`, {
                    exitCode: 2,
                    details: { proposalId, storePath: relativeStorePath(options.cwd, storePath) }
                });
            }
            if (!seen.has(proposal.proposalId)) {
                seen.add(proposal.proposalId);
                proposals.push(proposal);
            }
        }
    }
    if (proposals.length === 0) {
        throw new CliError('ATM_CLI_USAGE', 'broker compose requires --proposal-file <path> and/or --store <path> with optional --proposal-id <id>.', { exitCode: 2 });
    }
    return proposals;
}
function requireValue(argv, optionIndex, optionName) {
    const value = argv[optionIndex + 1];
    if (!value || value.startsWith('--')) {
        throw new CliError('ATM_CLI_USAGE', `broker requires a value for ${optionName}`, { exitCode: 2 });
    }
    return value;
}
export function relativeStorePath(cwd, storePath) {
    return path.relative(cwd, storePath) || path.basename(storePath);
}
