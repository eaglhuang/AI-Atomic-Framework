// TASK-MAO-0020: broker bootstrap self-update recovery. If the runner ref store
// becomes inconsistent (e.g., a steward crashed mid-publish, an in-dev/HEAD
// control ref points at a commit no longer reachable in the source repo, or
// the runner version state machine is stranded in rc-frozen without a publish
// commit), this module produces a recovery plan that the operator lane can
// apply to restore a consistent baseline.
import {
  resolveRunnerRef,
  type RunnerRefStore
} from './runner-ref-store.ts';
import type { RunnerVersionStreamRecord } from './runner-version-state.ts';

export type RecoveryDecision =
  | 'no-recovery-needed'
  | 'reseed-from-version'
  | 'rollback-rc-to-in-dev'
  | 'quarantine';

export interface RecoveryFinding {
  readonly code:
    | 'in-dev-head-orphaned'
    | 'rc-frozen-with-no-publish'
    | 'no-version-ref-found'
    | 'lease-held-but-state-published';
  readonly detail: string;
}

export interface RunnerBootstrapInput {
  readonly refStore: RunnerRefStore;
  readonly stream: RunnerVersionStreamRecord;
  /** Source commits known to exist in the target repo (for orphan checks). */
  readonly reachableSourceCommits: ReadonlySet<string>;
}

export interface RunnerBootstrapPlan {
  readonly schemaId: 'atm.runnerBootstrapPlan.v1';
  readonly decision: RecoveryDecision;
  readonly findings: readonly RecoveryFinding[];
  readonly suggestedNextAction: string;
}

export function analyzeBootstrap(input: RunnerBootstrapInput): RunnerBootstrapPlan {
  const findings: RecoveryFinding[] = [];

  // 1. in-dev/HEAD points at an orphaned commit?
  const inDevHead = resolveRunnerRef(input.refStore, 'in-dev/HEAD', 'control');
  if (inDevHead && !input.reachableSourceCommits.has(inDevHead.sourceCommit)) {
    findings.push({
      code: 'in-dev-head-orphaned',
      detail: `in-dev/HEAD points at orphaned commit ${inDevHead.sourceCommit}`
    });
  }

  // 2. stream stranded in rc-frozen without a published version?
  if (input.stream.state === 'rc-frozen') {
    const everPublished = input.stream.history.some((h) => h.transition === 'publish');
    if (!everPublished) {
      findings.push({
        code: 'rc-frozen-with-no-publish',
        detail: `stream ${input.stream.streamId} is rc-frozen but never recorded a publish`
      });
    }
  }

  // 3. no version ref published at all
  const hasVersionRef = input.refStore.entries.some((e) => e.kind === 'version');
  if (!hasVersionRef) {
    findings.push({
      code: 'no-version-ref-found',
      detail: 'runner ref store has no published version refs'
    });
  }

  // 4. lease held but stream already published
  if (input.stream.state === 'published' && input.stream.lease.heldBy) {
    findings.push({
      code: 'lease-held-but-state-published',
      detail: `lease still held by ${input.stream.lease.heldBy} on a published stream`
    });
  }

  // Decide.
  let decision: RecoveryDecision = 'no-recovery-needed';
  let suggestedNextAction = 'broker is healthy; no recovery action needed';
  const codes = new Set(findings.map((f) => f.code));
  if (codes.has('in-dev-head-orphaned') || codes.has('rc-frozen-with-no-publish')) {
    decision = 'rollback-rc-to-in-dev';
    suggestedNextAction = 'transition the version stream rollback-rc → in-dev and republish in-dev/HEAD on a reachable commit';
  } else if (codes.has('no-version-ref-found')) {
    decision = 'reseed-from-version';
    suggestedNextAction = 'publish a baseline version ref from the latest known-good source commit';
  } else if (codes.has('lease-held-but-state-published')) {
    decision = 'quarantine';
    suggestedNextAction = 'release the stale lease and audit the publishing actor before resuming';
  }

  return {
    schemaId: 'atm.runnerBootstrapPlan.v1',
    decision,
    findings,
    suggestedNextAction
  };
}
