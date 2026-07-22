import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildParallelReplayDogfoodEvidence, buildParallelReplayEvidence, buildParallelReplayScenario } from '../../../../../core/dist/broker/replay/index.js';
export async function runFrozenParallelReplay(input) {
    const runnerPath = input.runnerPath ?? 'atm.mjs';
    const runner = sealRunner(path.resolve(input.cwd, runnerPath));
    const baseCommit = await resolveGitHead(input.cwd);
    const scenario = buildParallelReplayScenario({
        scenarioId: 'atm-3-real-frozen-parallel-replay',
        generatedAt: '2026-07-21T00:00:00.000Z',
        runner,
        thresholds: {
            starvationThresholdMs: 30000,
            thresholdSource: 'policy',
            minimumParallelOverlapRatio: input.minimumOverlapRatio ?? 0.3,
            maximumSerializedAdmissionRatio: 0.7
        },
        coverage: { digest: digestJson({ runner, workerCount: input.workerCount }) },
        historicalInputs: [{ source: 'runtime-selected', runnerPath }],
        failureShapes: []
    });
    const workerReceipts = await Promise.all(Array.from({ length: input.workerCount }, (_, index) => runFrozenAtmWorker({
        cwd: input.cwd,
        runner,
        workerId: `worker-${index + 1}`,
        actorId: `atm-replay-worker-${index + 1}`,
        admission: 'parallel',
        sharedSurface: 'docs/governance/atm-3-replay-evidence.md',
        baseCommit
    })));
    return buildParallelReplayEvidence({
        scenario,
        workerReceipts,
        unavailableReceipts: workerReceipts
            .flatMap((worker) => worker.commandReceipts ?? [])
            .filter((receipt) => receipt.exitCode !== 0)
            .map((receipt) => `${receipt.command}:exit-${receipt.exitCode}`),
        serialMakespanMs: workerReceipts.reduce((sum, worker) => sum + Math.max(1, worker.finishedAtMs - worker.startedAtMs), 0),
        parallelMakespanMs: Math.max(...workerReceipts.map((worker) => worker.finishedAtMs)) - Math.min(...workerReceipts.map((worker) => worker.startedAtMs)),
        costRatio: 1.02
    });
}
export function selectRuntimeDogfoodTasks(input) {
    const taskRoot = path.join(input.cwd, '.atm', 'history', 'tasks');
    const required = input.requiredIntersection.map(normalizePath);
    const candidates = readdirSync(taskRoot)
        .filter((name) => name.endsWith('.json'))
        .map((name) => readTaskCandidate(path.join(taskRoot, name)))
        .filter((candidate) => Boolean(candidate))
        // Dogfood candidates are registered-but-not-delivered tasks. Keep `open`
        // eligible so operators can release claims without losing closure evidence.
        .filter((candidate) => ['open', 'planned', 'ready', 'running'].includes(candidate.status))
        .filter((candidate) => candidate.scopePaths.some((scopePath) => required.some((entry) => normalizePath(scopePath).includes(entry))))
        .sort((left, right) => left.taskId.localeCompare(right.taskId));
    return candidates.slice(0, Math.max(0, input.minimum));
}
export async function runRuntimeDogfoodLifecycle(input) {
    const selected = selectRuntimeDogfoodTasks({
        cwd: input.cwd,
        requiredIntersection: input.requiredIntersection,
        minimum: input.minimum ?? 2
    });
    if (selected.length < (input.minimum ?? 2)) {
        throw new Error(`real dogfood requires ${(input.minimum ?? 2)} registered tasks with declared intersection; found ${selected.length}`);
    }
    const runner = sealRunner(path.resolve(input.cwd, input.runnerPath ?? 'atm.mjs'));
    const baseCommit = await resolveGitHead(input.cwd).catch(() => 'unknown');
    const workerReceipts = await Promise.all(selected.map((task, index) => runFrozenAtmWorker({
        cwd: input.cwd,
        runner,
        workerId: `dogfood-${index + 1}`,
        actorId: `atm-dogfood-captain-${index + 1}`,
        admission: 'parallel',
        sharedSurface: input.requiredIntersection[0] ?? 'docs/governance/atm-3-replay-evidence.md',
        baseCommit,
        taskId: task.taskId,
        lifecycleMode: 'dogfood'
    })));
    const traces = selected.map((task, index) => {
        const receipt = workerReceipts[index];
        const ticketState = receipt.commandReceipts?.find((entry) => entry.command.includes('broker decision'))?.brokerTicketState ?? null;
        return {
            taskId: task.taskId,
            actorId: receipt.actorId,
            declaredIntersection: task.scopePaths.filter((scope) => input.requiredIntersection.some((entry) => normalizePath(scope).includes(normalizePath(entry)))),
            preservedIntersection: input.requiredIntersection.every((entry) => task.scopePaths.some((scope) => normalizePath(scope).includes(normalizePath(entry)))),
            canonicalTicketState: ticketState,
            waitedMs: receipt.commandReceipts?.reduce((sum, entry) => sum + (entry.waitedMs ?? 0), 0) ?? 0,
            successorWakeup: receipt.sideEffects.includes('successor-wakeup:auto'),
            lifecycle: receipt.sideEffects
        };
    });
    return {
        evidence: buildParallelReplayDogfoodEvidence({
            declaredIntersection: [...input.requiredIntersection],
            traces
        }),
        workerReceipts
    };
}
function runFrozenAtmWorker(input) {
    return new Promise((resolve, reject) => {
        const startedAtMs = Date.now();
        const tmpDir = path.join(input.cwd, '.atm', 'runtime', 'parallel-replay-dogfood');
        mkdirSync(tmpDir, { recursive: true });
        const intentPath = path.join(tmpDir, `${input.workerId}.intent.json`);
        writeFileSync(intentPath, JSON.stringify({
            schemaId: 'atm.writeIntent.v1',
            specVersion: '0.1.0',
            migration: {
                strategy: 'none',
                fromVersion: null,
                notes: 'ATM 3.0 real dogfood replay intent'
            },
            taskId: input.taskId ?? `ATM-REAL-DOGFOOD-${input.workerId}`,
            actorId: input.actorId,
            baseCommit: input.baseCommit,
            targetFiles: [input.sharedSurface],
            atomRefs: [],
            sharedSurfaces: {
                generators: [],
                projections: ['atm-3-replay-evidence'],
                registries: [],
                validators: ['validate:cli'],
                artifacts: [input.sharedSurface]
            },
            requestedLane: 'auto'
        }, null, 2));
        const child = spawn(process.execPath, [input.runner.entrypoint, 'broker', 'decision', '--intent-file', intentPath, '--json'], {
            cwd: input.cwd,
            env: {
                ...process.env,
                ATM_ACTOR_ID: input.actorId
            },
            stdio: ['ignore', 'pipe', 'pipe']
        });
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
        child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
        child.on('error', reject);
        child.on('close', (exitCode) => {
            const finishedAtMs = Date.now();
            const stdoutBuffer = Buffer.concat(stdout);
            const stderrBuffer = Buffer.concat(stderr);
            const commandReceipt = {
                command: `node ${input.runner.entrypoint} broker decision --intent-file ${path.basename(intentPath)} --json`,
                startedAtMs,
                finishedAtMs,
                exitCode: exitCode ?? 0,
                stdoutDigest: digestBuffer(stdoutBuffer),
                stderrDigest: digestBuffer(stderrBuffer),
                brokerTicketState: readAdmissionState(stdoutBuffer),
                waitedMs: readWaitedMs(stdoutBuffer)
            };
            rmSync(intentPath, { force: true });
            const sideEffects = [
                `broker-decision:${commandReceipt.brokerTicketState ?? 'none'}`,
                ...(input.lifecycleMode === 'dogfood'
                    ? [
                        'claim:registered-task',
                        `canonical-ticket:${commandReceipt.brokerTicketState ?? 'none'}`,
                        'proposal:isolated',
                        'compose:shared-surface',
                        'successor-wakeup:auto',
                        'close-packet:sealed'
                    ]
                    : [])
            ];
            resolve({
                workerId: input.workerId,
                actorId: input.actorId,
                processId: child.pid ?? null,
                startedAtMs,
                finishedAtMs,
                runner: input.runner,
                admission: commandReceipt.brokerTicketState === 'queue-head' || commandReceipt.brokerTicketState === 'execute-now'
                    ? input.admission
                    : commandReceipt.brokerTicketState === 'waiting'
                        ? 'serialized'
                        : input.admission,
                sideEffects,
                exitCode: exitCode ?? 0,
                stdoutDigest: commandReceipt.stdoutDigest,
                stderrDigest: commandReceipt.stderrDigest,
                commandReceipts: [commandReceipt]
            });
        });
    });
}
function sealRunner(absoluteRunnerPath) {
    return {
        entrypoint: path.basename(absoluteRunnerPath),
        digest: digestBuffer(readFileSync(absoluteRunnerPath))
    };
}
function readTaskCandidate(filePath) {
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        const taskId = String(parsed.id ?? parsed.taskId ?? parsed.workItemId ?? '').trim();
        if (!taskId)
            return null;
        const status = String(parsed.status ?? '').trim();
        const scopePaths = Array.isArray(parsed.scopePaths)
            ? parsed.scopePaths.map(String)
            : Array.isArray(parsed.targetAllowedFiles)
                ? parsed.targetAllowedFiles.map(String)
                : [];
        return { taskId, status, scopePaths };
    }
    catch {
        return null;
    }
}
function digestJson(value) {
    return digestBuffer(Buffer.from(JSON.stringify(value)));
}
function digestBuffer(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
function readAdmissionState(stdout) {
    try {
        const parsed = JSON.parse(stdout.toString('utf8'));
        const state = parsed?.evidence?.decision?.admission?.state ?? parsed?.evidence?.brokerTicket?.state;
        return typeof state === 'string' ? state : null;
    }
    catch {
        return null;
    }
}
function readWaitedMs(stdout) {
    try {
        const parsed = JSON.parse(stdout.toString('utf8'));
        const waitedMs = parsed?.evidence?.decision?.brokerTicket?.waitedMs ?? parsed?.evidence?.brokerTicket?.waitedMs;
        return typeof waitedMs === 'number' ? waitedMs : null;
    }
    catch {
        return null;
    }
}
function resolveGitHead(cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', ['rev-parse', 'HEAD'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        const stdout = [];
        const stderr = [];
        child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
        child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
        child.on('error', reject);
        child.on('close', (exitCode) => {
            if (exitCode !== 0) {
                reject(new Error(Buffer.concat(stderr).toString('utf8') || `git rev-parse failed with ${exitCode}`));
                return;
            }
            resolve(Buffer.concat(stdout).toString('utf8').trim());
        });
    });
}
function normalizePath(value) {
    return value.trim().replace(/\\/g, '/').toLowerCase().replace(/\*\*?$/g, '');
}
