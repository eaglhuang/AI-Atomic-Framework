import { createHash } from 'node:crypto';
import { collectObservedEvidence, createReaderObservedEvidenceSource } from '../../_vendor/core/dist/evidence/observed-source-adapters.js';
/** Missing status is not a successful exit; retain termination facts. */
export function normalizeProcessOutcome(result) {
    const commandOk = result.status === 0 && !result.signal && !result.error;
    return {
        exitCode: commandOk ? 0 : result.status !== null && result.status !== 0 ? result.status : 1,
        commandOk,
        processExitStatus: result.status,
        processSignal: result.signal ?? null,
        processError: result.error?.message ?? null
    };
}
/**
 * The sole CLI adapter from a spawned process to the observed-evidence
 * contract.  Callers provide the process result, never a pass/fail claim.
 */
export function observeProcessExecution(input) {
    return collectObservedEvidence([
        createReaderObservedEvidenceSource({
            sourceId: 'evidence-run-process',
            kind: 'process',
            dependencyClass: 'in-process'
        }, () => ({
            command: input.command,
            exitCode: input.exitCode,
            stdoutSha256: digest(input.stdout),
            stderrSha256: digest(input.stderr),
            processError: input.processError
        }))
    ]);
}
/** Convert persisted command-run facts into one observed snapshot per run. */
export function observeCommandRunRecords(runs) {
    return runs.map((run, index) => collectObservedEvidence([
        createReaderObservedEvidenceSource({
            sourceId: `evidence-command-run:${index}`,
            kind: 'process',
            dependencyClass: 'local-substitutable'
        }, () => ({
            command: run.command,
            exitCode: run.exitCode,
            stdoutSha256: run.stdoutSha256,
            stderrSha256: run.stderrSha256
        }))
    ]));
}
/**
 * Adapts a persisted command run into validation-contract evidence.  It does
 * not accept a caller-supplied pass/fail value: the core evaluator derives the
 * result solely from this observed process snapshot.
 */
export function createObservedValidationReceipt(input) {
    const observedOutcome = observeCommandRunRecords([input.run])[0] ?? null;
    return {
        caseId: input.caseId,
        gitHead: input.gitHead ?? null,
        observedAt: observedOutcome?.observedAt ?? null,
        freshUntil: input.freshUntil ?? null,
        observedOutcome
    };
}
function digest(value) {
    return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
