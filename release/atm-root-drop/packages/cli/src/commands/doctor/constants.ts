export const legacyBehaviorPackageNames = [
  'plugin-behavior-atomize',
  'plugin-behavior-compose',
  'plugin-behavior-dedup-merge',
  'plugin-behavior-evolve',
  'plugin-behavior-expire',
  'plugin-behavior-infect',
  'plugin-behavior-merge',
  'plugin-behavior-polymorphize',
  'plugin-behavior-split',
  'plugin-behavior-sweep',
  'plugin-police-lifecycle'
];

export const knownTsNoCheckBaseline = new Set([
  'packages/cli/src/commands/broker/implementation.ts',
  'packages/cli/src/commands/broker/mutation-helpers.ts',
  'packages/cli/src/commands/broker/parser.ts',
  'packages/cli/src/commands/broker/persistence.ts',
  'packages/cli/src/commands/broker/plan-batch-action.ts',
  'packages/cli/src/commands/broker/proposal-actions.ts',
  'packages/cli/src/commands/broker/registry-actions.ts',
  'packages/cli/src/commands/broker/shared-surface.ts',
  'packages/cli/src/commands/broker/steward-queues.ts',
  'packages/cli/src/commands/broker/steward-runtime-actions.ts',
  'packages/cli/src/commands/broker/types.ts',
  'packages/cli/src/commands/git-governance/implementation.ts',
  'packages/cli/src/commands/hook/pre-commit/failure-envelope.ts',
  'packages/cli/src/commands/hook/pre-commit/implementation.ts',
  'packages/cli/src/commands/hook/pre-commit/input-state.ts',
  'packages/cli/src/commands/hook/pre-commit/scope-ownership.ts',
  'packages/cli/src/commands/hook/pre-commit/support.ts',
  'packages/cli/src/commands/next/playbook-projection.ts',
  'packages/cli/src/commands/next/playbook-projection/active-work-summary.ts',
  'packages/cli/src/commands/next/playbook-projection/channel-playbook.ts',
  'packages/cli/src/commands/next/playbook-projection/governance-readiness.ts',
  'packages/cli/src/commands/next/playbook-projection/legacy-guidance.ts',
  'packages/cli/src/commands/next/playbook-projection/message-assembly.ts',
  'packages/cli/src/commands/next/playbook-projection/task-routing.ts',
  'packages/cli/src/commands/next/prompt-result-contracts.ts',
  'packages/cli/src/commands/next/prompt-results.ts',
  'packages/cli/src/commands/next/route-resolution/artifact-scope.ts',
  'packages/cli/src/commands/next/route-resolution/intent.ts',
  'packages/cli/src/commands/next/route-resolution/matching.ts',
  'packages/cli/src/commands/next/route-resolution/pending-worktree.ts',
  'packages/cli/src/commands/next/route-resolution/queue-inspection.ts',
  'packages/cli/src/commands/next/route-resolution/runtime.ts',
  'packages/cli/src/commands/next/route-resolution/task-card-discovery.ts'
]);

export interface TsNoCheckCleanupOwner {
  readonly ownerId: string;
  readonly title: string;
  readonly patterns: readonly string[];
  readonly followUp: string;
}

export const knownTsNoCheckCleanupOwners: readonly TsNoCheckCleanupOwner[] = [
  {
    ownerId: 'broker',
    title: 'Broker command transitional type cleanup',
    patterns: ['packages/cli/src/commands/broker/'],
    followUp: 'Open a focused broker cleanup card to remove @ts-nocheck from broker command modules and keep broker validators green.'
  },
  {
    ownerId: 'next',
    title: 'Next command route/projection transitional type cleanup',
    patterns: ['packages/cli/src/commands/next/'],
    followUp: 'Open a focused next cleanup card to type route-resolution, prompt-results, and playbook-projection modules.'
  },
  {
    ownerId: 'hook-pre-commit',
    title: 'Pre-commit hook transitional type cleanup',
    patterns: ['packages/cli/src/commands/hook/pre-commit/'],
    followUp: 'Open a focused pre-commit hook cleanup card to type hook input, ownership, support, and failure-envelope modules.'
  },
  {
    ownerId: 'git-governance',
    title: 'Git governance transitional type cleanup',
    patterns: ['packages/cli/src/commands/git-governance/'],
    followUp: 'Open a focused git-governance cleanup card to split and type the transitional implementation carrier.'
  }
];
