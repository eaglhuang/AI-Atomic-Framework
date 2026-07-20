import { CliError, makeResult, message, parseArgsForCommand, quoteCliValue } from './shared.js';
import { computeMissingValidatorReport } from './evidence.js';
import { buildCloseCompletionChecklist } from './taskflow/close-orchestration.js';
import { buildResidueDiagnosisEvidence, loadTaskDocumentOrThrow } from './tasks/public-surface.js';
import taskViewSpec from './command-specs/task-view.spec.js';
export const TASK_VIEW_DASHBOARD_SCHEMA_ID = 'atm.taskViewDashboard.v1';
function parseTaskViewOptions(argv) {
    const { options, positional } = parseArgsForCommand(taskViewSpec, argv);
    const cwd = typeof options.cwd === 'string' ? options.cwd : process.cwd();
    const taskId = typeof options.task === 'string' ? options.task.trim() : positional[0]?.trim() ?? '';
    if (!taskId) {
        throw new CliError('ATM_CLI_USAGE', 'task-view requires --task <work-item-id>.', { exitCode: 2 });
    }
    const actorId = typeof options.actor === 'string' ? options.actor.trim() : '';
    return {
        cwd,
        taskId,
        actorId: actorId || null
    };
}
function buildOperatorSummary(input) {
    if (input.partialClose) {
        return `Task ${input.taskId} ledger is done, but close completion is only partial; inspect closeCompletionChecklist before assuming closeback finished.`;
    }
    if (input.evidenceBlockerCount > 0) {
        return `Task ${input.taskId} (${input.liveStatus ?? 'unknown'}) has ${input.evidenceBlockerCount} evidence blocker(s); run the suggested validator commands before close.`;
    }
    if (input.residueBucket !== 'no-residue') {
        return `Task ${input.taskId} (${input.liveStatus ?? 'unknown'}) residue bucket is ${input.residueBucket}; follow nextSafeCommand.`;
    }
    return `Task ${input.taskId} (${input.liveStatus ?? 'unknown'}) is read-only healthy from task-view; use next for routing, not task-view.`;
}
function materializeCommandTemplate(command, taskId, planningCardPath) {
    return command
        .replaceAll('<id>', taskId)
        .replaceAll('<plan.md>', planningCardPath ?? '<plan.md>');
}
function resolveNextSafeCommand(input) {
    if (input.residueNextCommand) {
        return materializeCommandTemplate(input.residueNextCommand, input.taskId, input.planningCardPath);
    }
    if (input.evidenceBlockers[0]?.requiredCommand)
        return input.evidenceBlockers[0].requiredCommand;
    const actorFlag = input.actorId ? `--actor ${quoteCliValue(input.actorId)}` : '--actor <actor>';
    if (input.partialClose) {
        return `node atm.mjs tasks status --task ${input.taskId} --json`;
    }
    const status = String(input.liveStatus ?? '').trim().toLowerCase();
    if (status === 'done') {
        return `node atm.mjs tasks status --task ${input.taskId} --json`;
    }
    if (status === 'running' || status === 'review') {
        if (input.claimState === 'active') {
            return `node atm.mjs taskflow pre-close --task ${input.taskId} ${actorFlag} --json`;
        }
        return `node atm.mjs tasks status --task ${input.taskId} --json`;
    }
    if (status === 'ready' || status === 'open' || status === 'planned') {
        return `node atm.mjs taskflow open --task ${input.taskId} --write --json`;
    }
    return `node atm.mjs tasks status --task ${input.taskId} --json`;
}
export function buildTaskViewDashboard(input) {
    const { taskDocument } = loadTaskDocumentOrThrow(input.cwd, input.taskId);
    const residue = buildResidueDiagnosisEvidence(input.cwd, input.taskId, taskDocument);
    const triangulation = residue.triangulation;
    const missingValidators = input.actorId
        ? computeMissingValidatorReport(input.cwd, input.taskId, input.actorId)
        : null;
    const evidenceBlockers = (missingValidators?.blockingFindings ?? []).map((entry) => ({
        validator: entry.validator,
        category: entry.category,
        summary: entry.summary,
        requiredCommand: entry.requiredCommand ?? null
    }));
    const closeCompletionChecklist = buildCloseCompletionChecklist({
        cwd: input.cwd,
        taskId: input.taskId,
        taskDocument,
        triangulation: {
            liveLedger: triangulation.liveLedger,
            planningFrontmatter: triangulation.planningFrontmatter,
            lastTransitionEvent: triangulation.lastTransitionEvent
        }
    });
    const liveStatus = triangulation.liveLedger.status;
    const nextSafeCommand = resolveNextSafeCommand({
        taskId: input.taskId,
        actorId: input.actorId,
        liveStatus,
        claimState: triangulation.liveLedger.claimState,
        planningCardPath: triangulation.planningFrontmatter.source,
        residueNextCommand: residue.nextCommand,
        evidenceBlockers,
        partialClose: closeCompletionChecklist.partialClose
    });
    const operatorSummary = buildOperatorSummary({
        taskId: input.taskId,
        liveStatus,
        residueBucket: residue.bucket,
        partialClose: closeCompletionChecklist.partialClose,
        evidenceBlockerCount: evidenceBlockers.length
    });
    return {
        schemaId: TASK_VIEW_DASHBOARD_SCHEMA_ID,
        taskId: input.taskId,
        generatedAt: new Date().toISOString(),
        readOnly: true,
        operatorSummary,
        statusSummary: `${liveStatus ?? 'unknown'} / residue=${residue.bucket}`,
        liveStatus,
        planningStatus: triangulation.planningFrontmatter.status,
        claimState: triangulation.liveLedger.claimState,
        residueBucket: residue.bucket,
        lastEvent: {
            action: triangulation.lastTransitionEvent?.action ?? null,
            actorId: triangulation.lastTransitionEvent?.actorId ?? null,
            createdAt: triangulation.lastTransitionEvent?.createdAt ?? null
        },
        evidenceBlockers,
        closeCompletionChecklist,
        partialClose: closeCompletionChecklist.partialClose,
        nextSafeCommand
    };
}
export function runTaskView(argv) {
    const options = parseTaskViewOptions(argv);
    const { taskDocument } = loadTaskDocumentOrThrow(options.cwd, options.taskId);
    const dashboard = buildTaskViewDashboard(options);
    return makeResult({
        ok: true,
        command: 'task-view',
        cwd: options.cwd,
        messages: [
            message('info', 'ATM_TASK_VIEW_DASHBOARD', dashboard.operatorSummary, {
                taskId: options.taskId,
                partialClose: dashboard.partialClose,
                nextSafeCommand: dashboard.nextSafeCommand
            })
        ],
        evidence: {
            dashboard,
            triangulation: buildResidueDiagnosisEvidence(options.cwd, options.taskId, taskDocument)
        }
    });
}
