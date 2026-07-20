// @ts-nocheck
import { quoteCliValue } from '../view-projections.js';
function buildTaskflowCloseOperatorCommands(taskId, actor) {
    const id = taskId || '<task-id>';
    return {
        preClose: `node atm.mjs taskflow pre-close --task ${id} --actor ${actor} --json`,
        dryRun: `node atm.mjs taskflow close --task ${id} --actor ${actor} --json`,
        write: `node atm.mjs taskflow close --task ${id} --actor ${actor} --write --json`
    };
}
export function buildTaskDeliveryPrinciple(input) {
    return {
        schemaId: 'atm.taskDeliveryPrinciple.v1',
        taskId: input.taskId ?? null,
        channel: input.channel,
        principle: 'The goal is to deliver the requested task content, not to close task cards.',
        instruction: 'Implement or update the real non-.atm deliverables first; only close the task after those deliverables exist and validators/evidence pass.',
        doneMeans: 'done records completed delivery; it is not the objective itself.',
        notAllowedAsCompletion: [
            'changing only .atm/history task status or task events',
            'adding text-only evidence without real deliverable files',
            'replaying or cherry-picking old close commits',
            'batch-closing later tasks before the current queue head is delivered'
        ],
        nextStep: input.channel === 'batch'
            ? 'Work only on the current queue head, produce its real deliverables, then run node atm.mjs batch checkpoint --actor <id> --json.'
            : 'Run taskflow pre-close, then taskflow close dry-run (no --write), read evidence.writeReadinessHint.blockers[].requiredCommand, then taskflow close --write.'
    };
}
export function buildChannelPlaybook(input) {
    const actor = input.actorPlaceholder ?? '<id>';
    const prompt = input.originalPrompt?.trim() || '<current user prompt>';
    const taskId = input.taskId ?? '<task-id>';
    const defaultClaimCommand = input.fastClaimCommand?.trim()
        || `node atm.mjs next --claim --actor ${actor} --prompt ${quoteCliValue(prompt)} --auto-intent --json`;
    const fastClaimLabel = input.fastClaimLabel?.trim() || 'quickfix lock';
    const closeOps = buildTaskflowCloseOperatorCommands(taskId, actor);
    if (input.channel === 'fast') {
        return {
            schemaId: 'atm.channelPlaybook.v1',
            channel: 'fast',
            title: 'Fast quickfix playbook',
            mustFollow: true,
            summary: 'Use this only for small, low-risk edits. It is not a task-card closure path.',
            steps: [
                `Run: ${defaultClaimCommand}`,
                'Edit only the allowed files returned by ATM.',
                'Run the smallest relevant validator for the touched file.',
                'Commit only the real non-.atm diff and same-commit governed provenance staged by the ATM git wrapper.'
            ],
            doNot: [
                'Do not edit .atm/history/**.',
                'Do not close task cards.',
                `Do not expand the scope after the ${fastClaimLabel} is created.`
            ],
            commandSequence: [
                defaultClaimCommand,
                '<edit allowed files>',
                '<run focused validator>',
                'git add <changed files>',
                `node atm.mjs git commit --actor ${actor} --message "<message>" --json`
            ],
            commitTiming: 'Commit after the focused validator passes. Prefer `node atm.mjs git commit` for governed framework work; bare `git commit` is for read-only inspection or non-governed maintenance only.',
            governedGitEntrypoint: {
                preferredCommand: `node atm.mjs git commit --actor ${actor} --message "<message>" --json`,
                directGitPolicy: 'Direct git remains available for read-only commands and non-governed maintenance. When staging .atm/history/** task or evidence files, use the ATM wrapper so trailers and claim binding stay consistent.'
            }
        };
    }
    if (input.channel === 'batch') {
        const head = input.queueHeadTaskId ?? input.taskId ?? '<queue-head-task-id>';
        const batchState = input.batchState ?? 'queue-head-active';
        const batchLabel = input.batchId ? `batch ${input.batchId}` : 'this batch';
        const isRepairState = batchState === 'repair-required';
        const batchClaimCommand = defaultClaimCommand;
        const batchRepairCommand = `node atm.mjs batch repair --actor ${actor}${input.batchId ? ` --batch ${input.batchId}` : ''} --json`;
        const stateSummary = batchState === 'queue-preview'
            ? 'This is a batch preview. Claim the queue head, then work one task at a time.'
            : isRepairState
                ? `${batchLabel} is out of sync and needs repair before any task work continues.`
                : 'This is an active batch. Keep work on the current queue head and checkpoint before commit.';
        const commandSequence = isRepairState
            ? [
                batchRepairCommand,
                batchClaimCommand,
                '<implement queue-head deliverables>',
                'node atm.mjs evidence add --task <queue-head-task-id> --actor <id> --kind test --freshness fresh --summary "<what passed>" --artifacts <real-files> --validators <validator-name> --command "<command>" --exit-code 0 --stdout-sha256 sha256:<hash> --stderr-sha256 sha256:<hash> --json',
                'git add <deliverables> .atm/history/evidence/<queue-head-task-id>.json',
                `node atm.mjs batch checkpoint --actor ${actor} --json`,
                'git add .atm/history/tasks/<queue-head-task-id>.json .atm/history/task-events/<queue-head-task-id>/',
                `node atm.mjs git commit --actor ${actor} --task <queue-head-task-id> --message "<scope>: complete <queue-head-task-id>" --json`
            ]
            : [
                batchClaimCommand,
                '<implement queue-head deliverables>',
                'node atm.mjs evidence add --task <queue-head-task-id> --actor <id> --kind test --freshness fresh --summary "<what passed>" --artifacts <real-files> --validators <validator-name> --command "<command>" --exit-code 0 --stdout-sha256 sha256:<hash> --stderr-sha256 sha256:<hash> --json',
                'git add <deliverables> .atm/history/evidence/<queue-head-task-id>.json',
                `node atm.mjs batch checkpoint --actor ${actor} --json`,
                'git add .atm/history/tasks/<queue-head-task-id>.json .atm/history/task-events/<queue-head-task-id>/',
                `node atm.mjs git commit --actor ${actor} --task <queue-head-task-id> --message "<scope>: complete <queue-head-task-id>" --json`
            ];
        return {
            schemaId: 'atm.channelPlaybook.v1',
            channel: 'batch',
            title: 'Batch queue-head playbook',
            mustFollow: true,
            summary: stateSummary,
            state: batchState,
            steps: isRepairState
                ? [
                    `Run: ${batchRepairCommand}`,
                    `Then rerun: ${batchClaimCommand}`,
                    `Work only on the current queue head: ${head}.`,
                    'Read that task contract and implement the real non-.atm deliverables.',
                    'Run the required validator or a focused reproducible verification command.',
                    'Add command-backed evidence for the current queue head.',
                    'Stage the deliverables and evidence before checkpoint, but do not commit yet.',
                    `Run: node atm.mjs batch checkpoint --actor ${actor} --json`,
                    'After checkpoint succeeds, stage the updated .atm/history task/event files and create one commit that contains both deliverables and checkpoint state.',
                    'Continue with the next queue head returned by batch checkpoint.'
                ]
                : [
                    `Run: ${batchClaimCommand}`,
                    `Work only on the current queue head: ${head}.`,
                    'Read that task contract and implement the real non-.atm deliverables.',
                    'Run the required validator or a focused reproducible verification command.',
                    'Add command-backed evidence for the current queue head.',
                    'Stage the deliverables and evidence before checkpoint, but do not commit yet.',
                    `Run: node atm.mjs batch checkpoint --actor ${actor} --json`,
                    'After checkpoint succeeds, stage the updated .atm/history task/event files and create one commit that contains both deliverables and checkpoint state.',
                    'Continue with the next queue head returned by batch checkpoint.'
                ],
            doNot: [
                'Do not run tasks claim/close manually.',
                'Do not run next --prompt with a later single task id to leave batch.',
                'Do not commit before batch checkpoint succeeds.',
                'Do not close later tasks before the queue head is delivered.',
                'Do not use .atm/history/** changes as the deliverable.'
            ],
            commandSequence,
            commitTiming: isRepairState
                ? 'Repair the batch runtime first, then stage deliverables before checkpoint; commit once after batch checkpoint succeeds.'
                : 'Stage deliverables before checkpoint; commit once after batch checkpoint succeeds.',
            checkpointCommand: `node atm.mjs batch checkpoint --actor ${actor} --json`,
            repairCommand: batchRepairCommand,
            governedGitEntrypoint: {
                preferredCommand: `node atm.mjs git commit --actor ${actor} --task <queue-head-task-id> --message "<scope>: complete <queue-head-task-id>" --json`,
                directGitPolicy: 'Batch delivery commits must use the ATM wrapper after checkpoint; bare git commit is not banned for read-only inspection.'
            }
        };
    }
    return {
        schemaId: 'atm.channelPlaybook.v1',
        channel: 'normal',
        title: 'Single-task playbook',
        mustFollow: true,
        summary: 'Use this for one explicit task card. Preview close with taskflow pre-close and taskflow close dry-run before --write.',
        steps: [
            `Run: ${defaultClaimCommand}`,
            'Work only on the claimed task and its allowed files.',
            'Implement the real non-.atm deliverables.',
            'Run required validators or a focused reproducible verification command.',
            'Add command-backed evidence.',
            `Run: ${closeOps.preClose}`,
            `Run: ${closeOps.dryRun} and read evidence.writeReadinessHint.blockers[].requiredCommand`,
            `When ready: ${closeOps.write}`
        ],
        doNot: [
            'Do not manually claim before next --claim.',
            'Do not call tasks close directly for normal closeback; taskflow close owns the operator lane.',
            'Do not run taskflow close --write before dry-run/pre-close when blockers are unknown.',
            'Do not commit task closure separately from the deliverable it proves.'
        ],
        commandSequence: [
            defaultClaimCommand,
            '<implement task deliverables>',
            'node atm.mjs evidence run --task <task-id> --actor <id> --command "<validator>" --json',
            closeOps.preClose,
            closeOps.dryRun,
            closeOps.write,
            'git add <deliverables> .atm/history/tasks/<task-id>.json .atm/history/evidence/<task-id>.json .atm/history/task-events/<task-id>/',
            `node atm.mjs git commit --actor ${actor} --task <task-id> --message "<scope>: complete <task-id>" --json`
        ],
        closePreview: {
            schemaId: 'atm.taskflowClosePreviewPlaybook.v1',
            preCloseCommand: closeOps.preClose,
            dryRunCommand: closeOps.dryRun,
            writeCommand: closeOps.write,
            hintField: 'evidence.writeReadinessHint.blockers[].requiredCommand'
        },
        commitTiming: 'Commit only after taskflow close --write succeeds and the governed bundle is committed.',
        governedGitEntrypoint: {
            preferredCommand: `node atm.mjs git commit --actor ${actor} --task <task-id> --message "<scope>: complete <task-id>" --json`,
            directGitPolicy: 'Use taskflow close --write for normal closure. Bare git commit is not banned globally, but governed task/evidence bundles must use the ATM wrapper.',
            fallbackFields: ['copyableCommitCommand', 'hostGitCompatibilityGuidance']
        }
    };
}
