import type { OperationalBenchProfile, OperationalBenchProfileName, OperationalBenchScenario } from './operational-types.ts';

export const operationalBenchProfiles: Record<OperationalBenchProfileName, OperationalBenchProfile> = {
  smoke: { name: 'smoke', warmup: 2, repeat: 10, concurrency: [1, 5] },
  paper: { name: 'paper', warmup: 10, repeat: 100, concurrency: [1, 5, 10, 20] },
  extended: { name: 'extended', warmup: 20, repeat: 300, concurrency: [1, 5, 10, 20, 50] }
};

export const operationalBenchScenarios: readonly OperationalBenchScenario[] = [
  {
    id: 'different-file',
    track: 'broker-admission',
    blockedCase: 'none',
    expectedRoute: 'direct-brokered',
    notes: 'Two active intents touch different files and should remain parallel-safe.',
    recovery: { preservedIntentSalvage: null, terminalFailClosed: null, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'same-file-bounded-disjoint',
    track: 'broker-admission',
    blockedCase: 'none',
    expectedRoute: 'direct-brokered',
    notes: 'Same-file bounded ranges are disjoint, measuring bounded-region admission overhead.',
    recovery: { preservedIntentSalvage: null, terminalFailClosed: null, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'shared-surface-conflict',
    track: 'broker-admission',
    blockedCase: 'serialization',
    expectedRoute: 'blocked',
    notes: 'Shared generator surface conflict must fail closed before unsafe parallel apply.',
    recovery: { preservedIntentSalvage: null, terminalFailClosed: null, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'read-write-dependency',
    track: 'broker-admission',
    blockedCase: 'serialization',
    expectedRoute: 'blocked',
    notes: 'Read/write dependency fails closed before unsafe direct or parallel apply.',
    recovery: { preservedIntentSalvage: null, terminalFailClosed: null, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'allow-remote-local-disjoint',
    track: 'git-boundary',
    blockedCase: 'none',
    expectedRoute: 'allow',
    notes: 'Pre-push dry-run admits local and remote mutation surfaces on disjoint files.',
    recovery: { preservedIntentSalvage: true, terminalFailClosed: false, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'block-same-record-conflict',
    track: 'git-boundary',
    blockedCase: 'serialization',
    expectedRoute: 'block',
    notes: 'Pre-push dry-run blocks a same-record local/remote conflict.',
    recovery: { preservedIntentSalvage: true, terminalFailClosed: false, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'composer-disjoint-records',
    track: 'git-boundary',
    blockedCase: 'none',
    expectedRoute: 'composer',
    notes: 'Pre-push dry-run routes bounded same-file disjoint records through deterministic composer.',
    recovery: { preservedIntentSalvage: true, terminalFailClosed: false, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'recover-block-non-fast-forward',
    track: 'git-boundary',
    blockedCase: 'rebase-replay',
    expectedRoute: 'block-rebase-replay',
    notes: 'CAS mismatch recovery preserves intent and blocks unsafe direct apply after non-fast-forward drift.',
    recovery: { preservedIntentSalvage: true, terminalFailClosed: false, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'recover-composer-non-fast-forward',
    track: 'git-boundary',
    blockedCase: 'rebase-replay',
    expectedRoute: 'composer-rebase-replay',
    notes: 'CAS mismatch recovery preserves intent and replays composer routing after non-fast-forward drift.',
    recovery: { preservedIntentSalvage: true, terminalFailClosed: false, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'serial-queue',
    track: 'recovery-routing',
    blockedCase: 'queue',
    expectedRoute: 'serial',
    notes: 'Serial lane queue overhead with fail-closed parallel admission.',
    recovery: { preservedIntentSalvage: true, terminalFailClosed: false, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'steward-review',
    track: 'recovery-routing',
    blockedCase: 'steward-review',
    expectedRoute: 'neutral-steward',
    notes: 'Neutral steward dry-run/apply path for mergeable but steward-owned recovery.',
    recovery: { preservedIntentSalvage: true, terminalFailClosed: false, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'rebase-replay',
    track: 'recovery-routing',
    blockedCase: 'rebase-replay',
    expectedRoute: 'rebase-replay',
    notes: 'Recovered intent is replayed after base drift instead of being regenerated.',
    recovery: { preservedIntentSalvage: true, terminalFailClosed: false, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'refinement-needed',
    track: 'recovery-routing',
    blockedCase: 'refinement',
    expectedRoute: 'refinement-needed',
    notes: 'Insufficient bounded evidence requires refinement before applying.',
    recovery: { preservedIntentSalvage: true, terminalFailClosed: false, overSerialized: false, fullRegenerationObserved: null }
  },
  {
    id: 'terminal-insufficient-evidence',
    track: 'recovery-routing',
    blockedCase: 'terminal-fail-closed',
    expectedRoute: 'terminal-fail-closed',
    notes: 'Terminal fail-closed blocks unsafe direct or parallel apply while preserving the intent for human follow-up.',
    recovery: { preservedIntentSalvage: true, terminalFailClosed: true, overSerialized: false, fullRegenerationObserved: null }
  }
];

export function getOperationalBenchProfile(name: OperationalBenchProfileName): OperationalBenchProfile {
  return operationalBenchProfiles[name];
}
