// TASK-MAO-0024: `team wave` CLI surface. Computes a Team Agents Wave Mode plan
// from declared task-ledger metadata using the broker wave planner. This is the
// planning/dispatch entry point; the broker admission deep-check (TASK-MAO-0026)
// and runtime wave record (TASK-MAO-0027) layer on top of this surface.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message } from './shared.js';
import { validateStrictPathHeuristic } from './tasks/task-import-validators.js';
import { planWaves } from '../../../core/dist/broker/team-wave-planner.js';
import { admitWave } from '../../../core/dist/broker/team-wave-admission.js';
import { createTeamWaveEnvelope } from '../../../core/dist/broker/team-wave-envelope.js';
const TASKS_DIR = '.atm/history/tasks';
function readLedgerTask(cwd, taskId) {
    const file = path.join(cwd, TASKS_DIR, `${taskId}.json`);
    if (!existsSync(file))
        return null;
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
function toCandidate(task) {
    return {
        taskId: task.workItemId,
        dependencies: task.dependencies ?? [],
        scopePaths: normalizeTaskPathArray(task.scopePaths),
        deliverables: normalizeTaskPathArray(task.deliverables),
        validators: task.validators ?? [],
        targetRepo: task.targetRepo ?? null,
        closureAuthority: task.closureAuthority ?? null,
        ownerAtomOrMap: task.atomizationImpact?.ownerAtomOrMap ?? null
    };
}
function normalizeTaskPathArray(value) {
    return uniqueStrings(normalizeStringArray(value)
        .map((entry) => entry.replace(/\\/g, '/').trim().replace(/^\.\//, ''))
        .filter((entry) => Boolean(entry) && validateStrictPathHeuristic(entry) === null));
}
function normalizeStringArray(value) {
    return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}
function uniqueStrings(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function closedTaskIds(cwd) {
    const dir = path.join(cwd, TASKS_DIR);
    if (!existsSync(dir))
        return [];
    const out = [];
    for (const entry of readdirSync(dir)) {
        if (!entry.endsWith('.json'))
            continue;
        try {
            const t = JSON.parse(readFileSync(path.join(dir, entry), 'utf8'));
            if ((t.status ?? '').toLowerCase() === 'done')
                out.push(t.workItemId);
        }
        catch {
            // skip unreadable ledger files
        }
    }
    return out;
}
/**
 * Build a wave plan for an explicit set of task ids, reading their declared
 * metadata from the ledger. Append-safe paths default to the coverage map,
 * which uses an owner-shard / union-merge strategy.
 */
export function buildWavePlanFromTaskIds(cwd, taskIds, appendSafePaths = ['atomic_workbench/atomization-coverage/path-to-atom-map.json']) {
    const cards = [];
    const missing = [];
    for (const id of taskIds) {
        const task = readLedgerTask(cwd, id);
        if (!task) {
            missing.push(id);
            continue;
        }
        cards.push(toCandidate(task));
    }
    const plan = planWaves({ cards, closedTaskIds: closedTaskIds(cwd), appendSafePaths });
    return { plan, missing };
}
const WAVE_RUNTIME_DIR = '.atm/runtime/team-waves';
export function assertCoordinatorOnly(role, action) {
    if (role === 'coordinator') {
        return { allowed: true, reason: `coordinator may perform ${action}` };
    }
    return {
        allowed: false,
        reason: `role ${role} may not perform ${action}; Wave Mode reserves git writes and closeout for the coordinator`
    };
}
/**
 * Build admission decision + per-wave envelopes for the first planned wave.
 * TASK-MAO-0027: this is the dispatch surface that turns a metadata wave plan
 * into a coordinator-owned runtime record. Lifecycle authority remains with
 * batch checkpoint / taskflow close — this only records intent.
 */
export function buildWaveRuntimeRecord(cwd, taskIds, coordinatorActorId) {
    const { plan, missing } = buildWavePlanFromTaskIds(cwd, taskIds);
    const firstWave = plan.waves[0];
    const cardsById = new Map();
    for (const id of taskIds) {
        const task = readLedgerTask(cwd, id);
        if (task)
            cardsById.set(task.workItemId, toCandidate(task));
    }
    const members = (firstWave?.members ?? [])
        .map((m) => cardsById.get(m.taskId))
        .filter((c) => Boolean(c))
        .map((card) => ({ card }));
    const admission = admitWave({ members, closedTaskIds: closedTaskIds(cwd) });
    let envelope = null;
    if (firstWave && admission.admitted.length > 0) {
        const admittedCards = admission.admitted
            .map((id) => cardsById.get(id))
            .filter((c) => Boolean(c));
        envelope = createTeamWaveEnvelope({
            coordinatorActorId,
            targetRepo: admittedCards[0]?.targetRepo ?? null,
            closureAuthority: admittedCards[0]?.closureAuthority ?? null,
            waveIndex: firstWave.waveIndex,
            members: admittedCards.map((card) => ({
                taskId: card.taskId,
                workerActorId: null,
                scopePaths: card.scopePaths,
                deliverables: card.deliverables,
                patchEnvelopeId: null,
                executionState: 'not-started'
            }))
        });
    }
    return { plan, admission, envelope, missing };
}
/**
 * Handle `team wave <plan|dispatch> <csv>`. Delegated to from the `team` command
 * so no new top-level command registration is required.
 */
export function runTeamWave(argv, cwd) {
    const action = String(argv[0] ?? 'plan').toLowerCase();
    if (action !== 'plan' && action !== 'dispatch') {
        throw new CliError('ATM_TEAM_WAVE_USAGE', 'team wave supports: plan, dispatch', { exitCode: 2 });
    }
    // Tasks are passed as a positional CSV (`team wave plan TASK-A,TASK-B`) so the
    // shared `team` command spec does not need a new `--tasks` flag. A `--tasks`
    // form is also accepted when present for convenience.
    const tasksFlagIndex = argv.indexOf('--tasks');
    const tasksCsv = tasksFlagIndex >= 0 ? String(argv[tasksFlagIndex + 1] ?? '') : String(argv[1] ?? '');
    const taskIds = tasksCsv
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    if (taskIds.length === 0) {
        throw new CliError('ATM_TEAM_WAVE_TASKS_REQUIRED', `team wave ${action} requires a task CSV.`, {
            exitCode: 2
        });
    }
    if (action === 'dispatch') {
        const actorFlagIndex = argv.indexOf('--actor');
        const coordinator = actorFlagIndex >= 0
            ? String(argv[actorFlagIndex + 1] ?? '')
            : String(process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? 'wave-coordinator');
        const record = buildWaveRuntimeRecord(cwd, taskIds, coordinator);
        const ok = record.missing.length === 0 && record.admission.ok;
        if (ok && record.envelope) {
            const dir = path.join(cwd, WAVE_RUNTIME_DIR);
            if (!existsSync(dir))
                mkdirSync(dir, { recursive: true });
            writeFileSync(path.join(dir, `${record.envelope.waveId}.json`), `${JSON.stringify(record.envelope, null, 2)}\n`, 'utf8');
        }
        return makeResult({
            ok,
            command: 'team',
            cwd,
            messages: [
                message(ok ? 'info' : 'error', ok ? 'ATM_TEAM_WAVE_DISPATCHED' : 'ATM_TEAM_WAVE_DISPATCH_BLOCKED', ok
                    ? `Dispatched wave with ${record.admission.admitted.length} admitted member(s).`
                    : `Wave dispatch blocked: ${record.missing.length} missing, ${record.admission.rejected.length} rejected.`, {
                    admitted: record.admission.admitted,
                    rejected: record.admission.rejected.map((r) => r.taskId),
                    waveId: record.envelope?.waveId ?? null
                })
            ],
            evidence: {
                wavePlan: record.plan,
                admission: record.admission,
                waveEnvelope: record.envelope,
                missing: record.missing
            }
        });
    }
    const { plan, missing } = buildWavePlanFromTaskIds(cwd, taskIds);
    const ok = missing.length === 0;
    return makeResult({
        ok,
        command: 'team',
        cwd,
        messages: [
            message(ok ? 'info' : 'error', ok ? 'ATM_TEAM_WAVE_PLANNED' : 'ATM_TEAM_WAVE_MISSING_TASKS', ok
                ? `Planned ${plan.waves.length} wave(s) for ${plan.totalCards} card(s).`
                : `Cannot plan: ${missing.length} task id(s) not found in ledger.`, { waveCount: plan.waves.length, unschedulable: plan.unschedulable.length, missing })
        ],
        evidence: { wavePlan: plan, missing }
    });
}
