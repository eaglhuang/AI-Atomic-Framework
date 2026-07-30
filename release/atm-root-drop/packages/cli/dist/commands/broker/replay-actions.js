import { makeResult, message } from '../shared.js';
import { inspectCommandBackedMatrix } from './replay/command-backed-matrix.js';
import { evaluatePlan3SemanticClosure } from './replay/closure-policy.js';
import { runFrozenParallelReplay, runRuntimeDogfoodLifecycle, selectRuntimeDogfoodTasks } from './replay/implementation.js';
import { brokerReplayDashboard } from './replay/dashboard.js';
import { buildPlan3DogfoodOrchestratorEvidence } from './replay/dogfood-orchestrator.js';
import { buildPlan3FinalClosureVerdict, writePlan3FinalClosureVerdict } from './replay/final-closure-reader.js';
import { brokerReplayRunManifest } from './replay/run-manifest.js';
const defaultIntersection = ['docs/governance/atm-3-replay-evidence.md'];
export async function handleBrokerReplayActions(options) {
    if (options.action !== 'replay')
        return null;
    const action = options.replayAction ?? 'status';
    if (action === 'status')
        return brokerReplayStatus(options);
    if (action === 'run')
        return brokerReplayRun(options);
    if (action === 'dogfood')
        return brokerReplayDogfood(options);
    if (action === 'dashboard')
        return brokerReplayDashboard(options, requiredReplayIntersection(options));
    if (action === 'manifest')
        return brokerReplayRunManifest(options, requiredReplayIntersection(options));
    if (action === 'final-verdict')
        return brokerReplayFinalVerdict(options);
    return makeResult({
        ok: false,
        command: 'broker',
        cwd: options.cwd,
        messages: [
            message('error', 'ATM_CLI_USAGE', 'broker replay supports: status, run, dogfood, dashboard, manifest, final-verdict.', {
                supportedActions: ['status', 'run', 'dogfood', 'dashboard', 'manifest', 'final-verdict']
            })
        ],
        evidence: { action: 'replay-usage' }
    });
}
function brokerReplayFinalVerdict(options) {
    const verdict = buildPlan3FinalClosureVerdict({
        cwd: options.cwd,
        requiredIntersection: requiredReplayIntersection(options)
    });
    const outputPath = writePlan3FinalClosureVerdict({
        cwd: options.cwd,
        verdict,
        outputPath: options.evidenceOutPath
    });
    return makeResult({
        ok: verdict.verdict === 'close',
        command: 'broker',
        cwd: options.cwd,
        messages: [
            message(verdict.verdict === 'close' ? 'info' : 'warn', verdict.verdict === 'close' ? 'ATM_BROKER_REPLAY_FINAL_VERDICT_CLOSE' : 'ATM_BROKER_REPLAY_FINAL_VERDICT_REMAIN_OPEN', 'Plan 3.1 final verdict reconstructed canonical evidence sources.', {
                verdict: verdict.verdict,
                blockerCount: verdict.blockers.length,
                outputPath
            })
        ],
        evidence: {
            action: 'replay-final-verdict',
            outputPath,
            verdict
        }
    });
}
function brokerReplayStatus(options) {
    const requiredIntersection = requiredReplayIntersection(options);
    const dogfoodCandidates = selectRuntimeDogfoodTasks({
        cwd: options.cwd,
        requiredIntersection,
        minimum: 2
    });
    const matrix = inspectCommandBackedMatrix(options.cwd);
    const semantic = evaluatePlan3SemanticClosure({
        cwd: options.cwd,
        requiredIntersection,
        useLiveEvidence: true
    });
    const matrixReady = semantic.status.matchedPerformance === 'proven'
        || (matrix.cellCount === 420 && matrix.commandBackedCount === 420);
    const availabilityBlockers = [
        ...(dogfoodCandidates.length >= 2 ? [] : [`real-dogfood-registered-candidates: found ${dogfoodCandidates.length}/2 registered planned/ready/running task candidates with declared intersection`]),
        ...(matrixReady ? [] : [`command-backed-420-cell-matrix: ${matrix.cellCount} cells found, ${matrix.commandBackedCount}/420 include command/workload receipt evidence`])
    ];
    const blockers = [...new Set([...availabilityBlockers, ...semantic.blockers])];
    const remainOpen = blockers.length > 0 || semantic.verdict === 'remain-open';
    return makeResult({
        ok: !remainOpen,
        command: 'broker',
        cwd: options.cwd,
        messages: [
            message(remainOpen ? 'warn' : 'info', remainOpen ? 'ATM_BROKER_REPLAY_STATUS_REMAIN_OPEN' : 'ATM_BROKER_REPLAY_STATUS_READY', remainOpen
                ? 'Broker replay closure prerequisites are incomplete; Plan 3 remains open.'
                : 'Broker replay closure prerequisites are present.', {
                blockerCount: blockers.length
            })
        ],
        evidence: {
            schemaId: 'atm.brokerReplayStatus.v1',
            action: 'replay-status',
            verdict: remainOpen ? 'remain-open' : 'ready-to-close',
            blockers,
            missingLifecycleClasses: semantic.missingLifecycleClasses,
            invariantFindings: semantic.invariantFindings,
            status: semantic.status,
            requiredIntersection,
            realDogfood: {
                requiredTaskCount: 2,
                candidateCount: dogfoodCandidates.length,
                candidates: dogfoodCandidates
            },
            publicFrozenCliSurface: {
                command: 'node atm.mjs broker replay status --json',
                actions: ['status', 'run', 'dogfood', 'dashboard', 'manifest', 'final-verdict']
            },
            commandBackedMatrix: matrix,
            semanticClosure: semantic
        }
    });
}
async function brokerReplayRun(options) {
    const evidence = await runFrozenParallelReplay({
        cwd: options.cwd,
        workerCount: 3,
        runnerPath: 'atm.mjs'
    });
    return makeResult({
        ok: evidence.verdict === 'pass',
        command: 'broker',
        cwd: options.cwd,
        messages: [
            message(evidence.verdict === 'pass' ? 'info' : 'warn', 'ATM_BROKER_REPLAY_RUN_COMPLETE', 'Controlled frozen broker replay run completed.', {
                verdict: evidence.verdict,
                workerCount: evidence.workerCount,
                commandReceiptCount: evidence.workerReceipts.reduce((count, worker) => count + (worker.commandReceipts?.length ?? 0), 0)
            })
        ],
        evidence: {
            action: 'replay-run',
            replayEvidence: evidence,
            closureWarning: 'Controlled replay is not final Plan 3 closure evidence without real dogfood and command-backed 420-cell matrix.'
        }
    });
}
async function brokerReplayDogfood(options) {
    const requiredIntersection = requiredReplayIntersection(options);
    try {
        const orchestratorEvidence = buildPlan3DogfoodOrchestratorEvidence({
            cwd: options.cwd,
            requiredIntersection
        });
        const dogfood = await runRuntimeDogfoodLifecycle({
            cwd: options.cwd,
            requiredIntersection,
            runnerPath: 'atm.mjs',
            minimum: 2
        });
        return makeResult({
            ok: dogfood.evidence.terminalRefusalCount === 0 && dogfood.evidence.taskCount >= 2,
            command: 'broker',
            cwd: options.cwd,
            messages: [
                message('info', 'ATM_BROKER_REPLAY_DOGFOOD_COMPLETE', 'Runtime dogfood lifecycle replay completed.', {
                    taskCount: dogfood.evidence.taskCount,
                    actorCount: dogfood.evidence.actorCount
                })
            ],
            evidence: {
                action: 'replay-dogfood',
                orchestratorEvidence,
                dogfoodEvidence: dogfood.evidence,
                workerReceipts: dogfood.workerReceipts
            }
        });
    }
    catch (error) {
        return makeResult({
            ok: false,
            command: 'broker',
            cwd: options.cwd,
            messages: [
                message('error', 'ATM_BROKER_REPLAY_DOGFOOD_BLOCKED', error instanceof Error ? error.message : String(error), {
                    requiredIntersection
                })
            ],
            evidence: {
                action: 'replay-dogfood',
                verdict: 'remain-open',
                blockers: [error instanceof Error ? error.message : String(error)],
                requiredIntersection
            }
        });
    }
}
function requiredReplayIntersection(options) {
    const surfaces = options.surfaces.map((entry) => String(entry).trim()).filter(Boolean);
    return surfaces.length > 0 ? surfaces : defaultIntersection;
}
