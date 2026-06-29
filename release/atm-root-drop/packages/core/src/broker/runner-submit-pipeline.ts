// TASK-MAO-0016: runner submit-patch pipeline. Receives an ATM-core-annotated
// patch envelope (TASK-MAO-0015), checks it against the runner ref store
// (TASK-MAO-0014), and emits a submit decision. The actual rebuild happens in
// the Runner Sync Steward (TASK-MAO-0013); this pipeline is the admission /
// freeze / route layer that decides whether the patch may be applied at all.
import { validateAtmCorePatchEnvelope, type AtmCorePatchEnvelope } from './patch-envelope-atm-core.ts';
import { resolveRunnerRef, type RunnerRefStore } from './runner-ref-store.ts';

export type RunnerSubmitVerdict =
  | 'accept'
  | 'reject-malformed'
  | 'reject-conflict'
  | 'reject-stale-base'
  | 'freeze-await-rebase';

export interface RunnerSubmitDecision {
  readonly schemaId: 'atm.runnerSubmitDecision.v1';
  readonly verdict: RunnerSubmitVerdict;
  readonly reason: string;
  readonly envelopeId: string;
  readonly resolvedTargetRefHead: string | null;
  readonly suggestedNextAction: string;
}

export interface RunnerSubmitInput {
  readonly envelope: AtmCorePatchEnvelope;
  readonly refStore: RunnerRefStore;
  /** Optional set of currently-frozen ref names; submits to a frozen ref freeze-await. */
  readonly frozenRefs?: readonly string[];
}

export function submitRunnerPatch(input: RunnerSubmitInput): RunnerSubmitDecision {
  const base = {
    schemaId: 'atm.runnerSubmitDecision.v1' as const,
    envelopeId: input.envelope.base.envelopeId
  };

  const structural = validateAtmCorePatchEnvelope(input.envelope);
  if (!structural.ok) {
    return {
      ...base,
      verdict: 'reject-malformed',
      reason: structural.reason,
      resolvedTargetRefHead: null,
      suggestedNextAction: 'fix the patch envelope and resubmit'
    };
  }

  const target = input.envelope.atmCore.targetRunnerRef;
  const frozen = new Set(input.frozenRefs ?? []);
  if (target && frozen.has(target)) {
    return {
      ...base,
      verdict: 'freeze-await-rebase',
      reason: `target ref ${target} is currently frozen`,
      resolvedTargetRefHead: null,
      suggestedNextAction: 'await freeze release; rebase onto new target head when resumed'
    };
  }

  // Stale-base check: declared source commit (if any) must equal the current
  // resolved head of the target ref, otherwise the agent has been working off
  // an older base and the patch may not apply cleanly.
  if (target) {
    const kind = target.startsWith('in-dev/') ? 'control' : 'version';
    const head = resolveRunnerRef(input.refStore, target, kind);
    const resolvedHead = head?.sourceCommit ?? null;
    const declared = input.envelope.atmCore.declaredSourceCommit;
    if (declared && resolvedHead && declared !== resolvedHead) {
      return {
        ...base,
        verdict: 'reject-stale-base',
        reason: `declared source commit ${declared} is behind target ref head ${resolvedHead}`,
        resolvedTargetRefHead: resolvedHead,
        suggestedNextAction: 'rebase patch envelope on the latest target head and resubmit'
      };
    }
    return {
      ...base,
      verdict: 'accept',
      reason: 'patch envelope passes admission',
      resolvedTargetRefHead: resolvedHead,
      suggestedNextAction: 'forward to steward rebuild lane'
    };
  }

  // No target ref — patch is a non-publishing patch-only submit; allow.
  return {
    ...base,
    verdict: 'accept',
    reason: 'non-publishing patch admitted',
    resolvedTargetRefHead: null,
    suggestedNextAction: 'forward to steward rebuild lane'
  };
}
