import {
  evaluateAcceptanceEvidenceMap,
  type AcceptanceEvidenceMap,
  type AcceptanceEvidenceMapResult,
  type AcceptancePredicateObservation
} from '../../../../../core/src/evidence/index.ts';
import { CliError } from '../../shared.ts';
import { parseAcceptanceEvidenceMap } from '../acceptance-evidence-import.ts';

export interface AcceptanceEvidenceClosureGateReport {
  readonly schemaId: 'atm.acceptanceEvidenceClosureGate.v1';
  readonly status: 'not-required' | 'pass' | 'blocked';
  readonly verdict: 'pass' | 'fail' | 'inconclusive' | 'not-required';
  readonly closureReady: boolean;
  readonly blockers: readonly AcceptanceEvidenceClosureGateBlocker[];
  readonly result: AcceptanceEvidenceMapResult | null;
}

export interface AcceptanceEvidenceClosureGateBlocker {
  readonly code:
    | 'ATM_TASK_CLOSE_ACCEPTANCE_EVIDENCE_INSUFFICIENT'
    | 'ATM_TASK_CLOSE_INDEPENDENT_VERIFIER_REQUIRED';
  readonly predicateId: string;
  readonly verdict: 'fail' | 'inconclusive';
  readonly reasons: readonly string[];
}

/** CLI adapter for the core acceptance predicate evaluator; it owns no second acceptance algorithm. */
export function evaluateAcceptanceEvidenceClosureGate(input: {
  readonly taskDocument: Record<string, unknown>;
}): AcceptanceEvidenceClosureGateReport {
  const parsed = parseAcceptanceEvidenceMap(input.taskDocument.acceptanceEvidence);
  if (parsed.errors.length > 0) {
    return blocked(null, parsed.errors.map((reason) => ({
      code: 'ATM_TASK_CLOSE_ACCEPTANCE_EVIDENCE_INSUFFICIENT' as const,
      predicateId: '<invalid-acceptance-evidence>',
      verdict: 'inconclusive' as const,
      reasons: [reason]
    })));
  }
  if (!parsed.value) {
    return {
      schemaId: 'atm.acceptanceEvidenceClosureGate.v1',
      status: 'not-required',
      verdict: 'not-required',
      closureReady: true,
      blockers: [],
      result: null
    };
  }

  const observations = readAcceptanceEvidenceObservations(input.taskDocument);
  const result = evaluateAcceptanceEvidenceMap(parsed.value, observations);
  const blockers = result.results
    .filter((entry) => !entry.closureReady)
    .map((entry): AcceptanceEvidenceClosureGateBlocker => ({
      code: entry.reasons.some((reason) =>
        reason === 'producer-self-verification'
        || reason === 'separate-actor-identity-missing'
        || reason === 'verifier-actor-mismatch'
        || reason === 'verifier-mode-mismatch'
        || reason === 'verifier-rejected'
        || reason === 'locked-policy-digest-mismatch'
        || reason === 'locked-policy-not-presealed'
      )
        ? 'ATM_TASK_CLOSE_INDEPENDENT_VERIFIER_REQUIRED'
        : 'ATM_TASK_CLOSE_ACCEPTANCE_EVIDENCE_INSUFFICIENT',
      predicateId: entry.predicateId,
      verdict: entry.verdict === 'fail' ? 'fail' : 'inconclusive',
      reasons: entry.reasons
    }));

  return blockers.length === 0
    ? {
      schemaId: 'atm.acceptanceEvidenceClosureGate.v1',
      status: 'pass',
      verdict: result.verdict,
      closureReady: true,
      blockers: [],
      result
    }
    : blocked(result, blockers);
}

export function assertAcceptanceEvidenceClosureGate(input: {
  readonly taskId: string;
  readonly taskDocument: Record<string, unknown>;
}): AcceptanceEvidenceClosureGateReport {
  const report = evaluateAcceptanceEvidenceClosureGate({ taskDocument: input.taskDocument });
  if (report.closureReady) return report;
  const first = report.blockers[0];
  throw new CliError(
    first?.code ?? 'ATM_TASK_CLOSE_ACCEPTANCE_EVIDENCE_INSUFFICIENT',
    `Task ${input.taskId} has closure-critical acceptance evidence that is not independently verified.`,
    {
      details: {
        taskId: input.taskId,
        acceptanceEvidenceGate: report
      }
    }
  );
}

function blocked(
  result: AcceptanceEvidenceMapResult | null,
  blockers: readonly AcceptanceEvidenceClosureGateBlocker[]
): AcceptanceEvidenceClosureGateReport {
  return {
    schemaId: 'atm.acceptanceEvidenceClosureGate.v1',
    status: 'blocked',
    verdict: result?.verdict ?? 'inconclusive',
    closureReady: false,
    blockers,
    result
  };
}

function readAcceptanceEvidenceObservations(
  taskDocument: Record<string, unknown>
): Readonly<Record<string, AcceptancePredicateObservation | null | undefined>> {
  const value = taskDocument.acceptanceEvidenceObservations
    ?? taskDocument.acceptance_evidence_observations
    ?? taskDocument.acceptanceEvidenceResults
    ?? taskDocument.acceptance_evidence_results;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Readonly<Record<string, AcceptancePredicateObservation | null | undefined>>;
}
