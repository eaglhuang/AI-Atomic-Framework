import {
  createRunnerVersionRegistry,
  selectRunnerVersionWithReceipt,
  type PublishedRunnerVersion
} from '../../../../core/src/broker/runner-version-registry.ts';
import {
  RUNNER_SYNC_ERROR_CODES,
  type RunnerVersionRequirement,
  type RunnerVersionSelectionReceipt
} from '../../../../core/src/broker/runner-version-contract.ts';

/**
 * Taskflow adapter: turn a runner version requirement + the published runner set
 * into a selection receipt that close-readiness can consume (ATM-GOV-0266
 * Phase A). Pure and deterministic; the caller supplies the published versions
 * (read from durable receipts) and the requirement (from the closing task).
 */

export interface RunnerSelectionEvidenceInput {
  readonly taskId: string;
  readonly requirement: RunnerVersionRequirement;
  readonly publishedVersions: readonly PublishedRunnerVersion[];
  readonly issuedAt: string;
}

export interface RunnerSelectionEvidence {
  readonly schemaId: 'atm.runnerSelectionEvidence.v1';
  readonly taskId: string;
  readonly receipt: RunnerVersionSelectionReceipt;
  readonly closeReady: boolean;
  readonly errorCode: string | null;
  readonly requiredCommand: string | null;
  readonly reason: string;
}

export function buildRunnerSelectionEvidence(input: RunnerSelectionEvidenceInput): RunnerSelectionEvidence {
  const registry = createRunnerVersionRegistry(input.publishedVersions);
  const receipt = selectRunnerVersionWithReceipt(registry, input.requirement, input.issuedAt);
  const selection = receipt.selection;
  const closeReady = selection.errorCode === null && (selection.outcome === 'exact-seal-match' || selection.outcome === 'aggregate-hash-match');
  const requiredCommand = closeReady
    ? null
    : `node atm.mjs broker runner-sync enqueue --task ${JSON.stringify(input.taskId)} --sealed-source-sha ${JSON.stringify(input.requirement.sealedSourceSha)} --json`;
  return {
    schemaId: 'atm.runnerSelectionEvidence.v1',
    taskId: input.taskId,
    receipt,
    closeReady,
    errorCode: selection.errorCode,
    requiredCommand,
    reason: closeReady
      ? `Runner version selected (${selection.outcome}); close-readiness satisfied.`
      : `${selection.errorCode ?? RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired}: ${selection.reason}`
  };
}
