import { createHash } from 'node:crypto';
import {
  collectObservedEvidence,
  createReaderObservedEvidenceSource
} from '../../../../core/src/evidence/observed-source-adapters.ts';
import type { ObservedEvidenceSnapshot } from '../../../../core/src/evidence/observed-source.ts';
import type { ValidationContractEvidenceReceipt } from '../../../../core/src/evidence/validation-contract.ts';

export interface ObservedProcessExecution {
  readonly command: string;
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly processError: string | null;
}

export interface ObservedCommandRunRecord {
  readonly command: string;
  readonly exitCode: number;
  readonly stdoutSha256: string;
  readonly stderrSha256: string;
}

export interface ObservedValidationReceiptInput {
  readonly caseId: string;
  readonly run: ObservedCommandRunRecord;
  readonly gitHead?: string | null;
  readonly freshUntil?: string | null;
}

/**
 * The sole CLI adapter from a spawned process to the observed-evidence
 * contract.  Callers provide the process result, never a pass/fail claim.
 */
export function observeProcessExecution(input: ObservedProcessExecution): ObservedEvidenceSnapshot {
  return collectObservedEvidence([
    createReaderObservedEvidenceSource(
      {
        sourceId: 'evidence-run-process',
        kind: 'process',
        dependencyClass: 'in-process'
      },
      () => ({
        command: input.command,
        exitCode: input.exitCode,
        stdoutSha256: digest(input.stdout),
        stderrSha256: digest(input.stderr),
        processError: input.processError
      })
    )
  ]);
}

/** Convert persisted command-run facts into one observed snapshot per run. */
export function observeCommandRunRecords(runs: readonly ObservedCommandRunRecord[]): readonly ObservedEvidenceSnapshot[] {
  return runs.map((run, index) => collectObservedEvidence([
    createReaderObservedEvidenceSource(
      {
        sourceId: `evidence-command-run:${index}`,
        kind: 'process',
        dependencyClass: 'local-substitutable'
      },
      () => ({
        command: run.command,
        exitCode: run.exitCode,
        stdoutSha256: run.stdoutSha256,
        stderrSha256: run.stderrSha256
      })
    )
  ]));
}

/**
 * Adapts a persisted command run into validation-contract evidence.  It does
 * not accept a caller-supplied pass/fail value: the core evaluator derives the
 * result solely from this observed process snapshot.
 */
export function createObservedValidationReceipt(input: ObservedValidationReceiptInput): ValidationContractEvidenceReceipt {
  const observedOutcome = observeCommandRunRecords([input.run])[0] ?? null;
  return {
    caseId: input.caseId,
    gitHead: input.gitHead ?? null,
    observedAt: observedOutcome?.observedAt ?? null,
    freshUntil: input.freshUntil ?? null,
    observedOutcome
  };
}

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
