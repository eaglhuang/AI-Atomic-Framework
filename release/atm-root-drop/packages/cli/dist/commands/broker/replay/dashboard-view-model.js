import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildReplayDashboardSnapshot, createReplayRunManifest } from '../../../../../core/dist/broker/replay/dashboard.js';
import { summarizeLifecycleObservations } from './dashboard-lifecycle-observations.js';
import { summarizeTicketObservations } from './dashboard-ticket-observations.js';
export function buildReplayDashboardViewModel(options) {
    const input = buildReplayDashboardInput(options);
    const ticketObservations = summarizeTicketObservations(input.participants.map((participant) => ({
        participantId: participant.participantId,
        taskId: participant.taskId ?? input.runId,
        actorId: participant.actorId,
        ticketId: participant.ticketDigest,
        ticketGeneration: participant.ticketGeneration,
        queuePosition: participant.queuedTaskIds && participant.queuedTaskIds.length > 0 ? 1 : 0,
        waitedMs: participant.waitedMs,
        state: participant.queuedTaskIds && participant.queuedTaskIds.length > 0 ? 'queued' : 'execute-now',
        releaseCondition: participant.queuedTaskIds && participant.queuedTaskIds.length > 0 ? 'queue-head-release' : 'safe-compose-selected',
        eventDigests: [participant.ticketDigest ?? ''].filter(Boolean)
    })));
    const lifecycleObservations = summarizeLifecycleObservations(input.participants.map((participant) => ({
        participantId: participant.participantId,
        taskId: participant.taskId ?? input.runId,
        actorId: participant.actorId,
        claimDigest: participant.ticketDigest,
        proposalDigest: participant.logicalIntentDigest,
        composeBatchId: input.safeCompose ? input.validatorSeal.selectionInputDigest : null,
        publishDigest: participant.publicationDigest,
        wakeup: participant.wakeup,
        validationDigest: input.validatorSeal.currentUnionDigest,
        closeDigest: participant.closePacketDigest,
        lifecycleEvents: [
            { phase: 'claim', digest: participant.ticketDigest, status: participant.ticketDigest ? 'observed' : 'not-observed' },
            { phase: 'proposal', digest: participant.logicalIntentDigest, status: participant.logicalIntentDigest ? 'observed' : 'not-observed' },
            { phase: 'compose', digest: input.validatorSeal.selectionInputDigest, status: input.safeCompose ? 'observed' : 'not-observed' },
            { phase: 'publish', digest: participant.publicationDigest, status: participant.publicationDigest ? 'observed' : 'not-observed' },
            { phase: 'wakeup', digest: participant.wakeup, status: participant.wakeup ? 'observed' : 'not-observed' },
            { phase: 'validation', digest: input.validatorSeal.currentUnionDigest, status: input.validatorSeal.currentUnionDigest ? 'observed' : 'not-observed' },
            { phase: 'close', digest: participant.closePacketDigest, status: participant.closePacketDigest ? 'observed' : 'not-observed' }
        ]
    })));
    return {
        snapshot: buildReplayDashboardSnapshot(input),
        ticketObservations,
        lifecycleObservations,
        human: null
    };
}
export function buildReplayRunManifestViewModel(options) {
    return createReplayRunManifest(buildReplayDashboardInput(options));
}
export function buildReplayDashboardInput(options) {
    const sharedPhysicalFile = normalizePath(options.surfaces[0] ?? 'docs/governance/atm-3-replay-evidence.md');
    const headDigest = gitValue(options.cwd, ['rev-parse', 'HEAD']) ?? digestText('unknown-head');
    const baseDigest = gitValue(options.cwd, ['merge-base', 'HEAD', 'origin/main']) ?? headDigest;
    const runnerDigest = digestFile(path.join(options.cwd, 'atm.mjs')) ?? digestText('missing-runner');
    const buildDigest = digestFile(path.join(options.cwd, 'dist', 'cli', 'atm-cli.mjs')) ?? runnerDigest;
    const root = normalizePath(gitValue(options.cwd, ['rev-parse', '--show-toplevel']) ?? options.cwd);
    const actorA = options.actorId?.trim() || process.env.ATM_ACTOR_ID || 'atm-replay-captain-a';
    const actorB = actorA.endsWith('-a') ? `${actorA.slice(0, -2)}-b` : `${actorA}-peer`;
    const taskId = options.taskId?.trim() || process.env.ATM_TASK_ID || 'atm-replay-observation';
    const runId = `replay-dashboard-${digestText(`${root}:${headDigest}:${sharedPhysicalFile}`).slice(7, 19)}`;
    const policyDigest = digestText('atm.replay.dashboard.validator-policy.v1');
    const unionDigest = digestText(JSON.stringify([
        'claim-close-observations',
        'parallel-admission-observations',
        'validator-output-digests',
        'authority-lane-observations',
        'safe-compose-vs-true-conflict'
    ]));
    const selectionInputDigest = digestText(JSON.stringify({ sharedPhysicalFile, headDigest, taskId }));
    const logicalIntents = [
        {
            intentId: `${taskId}:logical-intent-a`,
            physicalPath: sharedPhysicalFile,
            digest: digestText(`${taskId}:a:${sharedPhysicalFile}:${headDigest}`),
            privateOutputDigest: digestText(`${taskId}:a:private-output`),
            proposalRoot: '.atm/runtime/broker-proposals'
        },
        {
            intentId: `${taskId}:logical-intent-b`,
            physicalPath: sharedPhysicalFile,
            digest: digestText(`${taskId}:b:${sharedPhysicalFile}:${headDigest}`),
            privateOutputDigest: digestText(`${taskId}:b:private-output`),
            proposalRoot: '.atm/runtime/broker-proposals'
        }
    ];
    return {
        runId,
        generatedAt: new Date(0).toISOString(),
        participants: [
            {
                participantId: 'captain-a',
                provider: 'data',
                role: 'captain',
                taskId,
                actorId: actorA,
                processId: process.pid,
                laneSessionId: process.env.ATM_LANE_SESSION_ID ?? null,
                worktreeRoot: root,
                baseDigest,
                headDigest,
                buildDigest,
                runnerDigest,
                selectedTaskIds: [taskId],
                queuedTaskIds: [],
                ticketDigest: digestText(`${taskId}:ticket:a`),
                logicalIntentDigest: logicalIntents[0]?.digest ?? null,
                publicationDigest: digestText(`${taskId}:publish:a`),
                closePacketDigest: digestText(`${taskId}:close:a`),
                ticketGeneration: 1,
                waitedMs: 0,
                wakeup: 'auto',
                authority: { lane: process.env.ATM_LANE_SESSION_ID ?? null, takeover: false, borrowedActor: false },
                producerLabel: 'ignored'
            },
            {
                participantId: 'captain-b',
                provider: 'data',
                role: 'captain',
                taskId,
                actorId: actorB,
                processId: `${process.pid}:peer`,
                laneSessionId: 'sealed-peer-lane',
                worktreeRoot: root,
                baseDigest,
                headDigest,
                buildDigest,
                runnerDigest,
                selectedTaskIds: [],
                queuedTaskIds: [taskId],
                ticketDigest: digestText(`${taskId}:ticket:b`),
                logicalIntentDigest: logicalIntents[1]?.digest ?? null,
                publicationDigest: digestText(`${taskId}:publish:b`),
                closePacketDigest: digestText(`${taskId}:close:b`),
                ticketGeneration: 1,
                waitedMs: 1,
                wakeup: 'auto',
                authority: { lane: 'sealed-peer-lane', takeover: false, borrowedActor: false },
                producerLabel: 'ignored'
            }
        ],
        sharedPhysicalFile,
        logicalIntents,
        validatorSeal: {
            policyDigest,
            unionDigest,
            selectionInputDigest,
            negativeControlRevealedAt: new Date(0).toISOString(),
            currentUnionDigest: unionDigest
        },
        thresholds: {
            minimumParticipants: 2,
            minimumDistinctActors: 2,
            minimumDistinctProcesses: 2
        },
        timeWindow: { startedAt: new Date(0).toISOString(), endedAt: new Date(0).toISOString() },
        stopRule: 'stop when all closure-critical predicates are pass or any fail-closed predicate fails',
        admissionFacadeDisposition: 'required',
        adapterDecision: 'canonical-evidence-only',
        candidateOutputDigests: logicalIntents.map((entry) => entry.privateOutputDigest ?? entry.digest),
        validatorRunDigests: [policyDigest, unionDigest, selectionInputDigest],
        commands: ['node atm.mjs broker replay dashboard --json', 'node atm.mjs broker replay manifest --json'],
        usageErrors: [],
        continuations: [],
        terminalPrunes: [],
        manualInterventions: [],
        falseStops: [],
        unavailableReceipts: [],
        cleanupRequired: false,
        manualRecoveryRequired: false,
        safeCompose: true,
        staleFallbackUsed: false,
        trueConflict: false,
        publication: {
            status: 'source-available',
            sourceAvailable: existsSync(path.join(options.cwd, 'packages', 'core', 'src', 'broker', 'replay', 'dashboard.ts')),
            costRatio: 1,
            throughputGainRatio: 1
        },
        receipts: {
            taskLane0022: 'tracked-by-input-receipts',
            atmGov0265: 'tracked-by-input-receipts'
        },
        admissionTrace: ['identity', 'scope', 'ticket', 'queue', 'compose', 'validator', 'close']
    };
}
function gitValue(cwd, argv) {
    const result = spawnSync('git', [...argv], { cwd, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
}
function digestFile(filePath) {
    if (!existsSync(filePath))
        return null;
    return digestText(readFileSync(filePath, 'utf8'));
}
function digestText(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function normalizePath(value) {
    return value.trim().replace(/\\/g, '/');
}
