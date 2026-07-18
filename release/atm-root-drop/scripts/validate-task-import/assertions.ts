import { fail } from './context.ts';

export function assertImportedTaskContract(task: {
  readonly deliverables?: readonly string[];
  readonly scopePaths?: readonly string[];
  readonly validators?: readonly string[];
  readonly planningRepo?: string | null;
  readonly targetRepo?: string | null;
  readonly closureAuthority?: string | null;
  readonly planningReadOnlyPaths?: readonly string[];
  readonly planningMirrorPaths?: readonly string[];
  readonly outOfScope?: readonly string[];
  readonly nonGoals?: readonly string[];
  readonly evidenceRequired?: string | null;
  readonly rollbackStrategy?: string | null;
  readonly atomizationImpact?: { ownerAtomOrMap?: string | null; mapUpdates?: readonly string[] };
}, label: string) {
  const scopePaths = task.scopePaths ?? [];
  const deliverables = task.deliverables ?? [];
  if (!scopePaths.includes('packages/cli/src/commands/tasks.ts') || !scopePaths.includes('packages/cli/src/commands/next.ts')) {
    fail(`${label} must preserve frontmatter scopePaths, got ${JSON.stringify(scopePaths)}.`);
  }
  if (!deliverables.includes('packages/cli/src/commands/tasks.ts') || !deliverables.includes('scripts/validate-task-import.ts')) {
    fail(`${label} must preserve deliverable file paths, got ${JSON.stringify(deliverables)}.`);
  }
  if (task.planningRepo !== '3KLife' || task.targetRepo !== 'AI-Atomic-Framework' || task.closureAuthority !== 'target_repo') {
    fail(`${label} must preserve planning/target/closure authority, got ${JSON.stringify({
      planningRepo: task.planningRepo,
      targetRepo: task.targetRepo,
      closureAuthority: task.closureAuthority
    })}.`);
  }
  if (!(task.planningReadOnlyPaths ?? []).some((entry) => entry.includes('../3KLife/docs/ai_atomic_framework/example/tasks/TASK-FIXTURE-0001.task.md'))) {
    fail(`${label} must preserve planningReadOnlyPaths.`);
  }
  if (!(task.planningMirrorPaths ?? []).includes('docs/ai_atomic_framework/example/tasks/TASK-FIXTURE-0001.task.md')) {
    fail(`${label} must preserve planningMirrorPaths.`);
  }
  if (!(task.outOfScope ?? []).includes('.atm/runtime/**') || !(task.nonGoals ?? []).includes('Rewrite the task lifecycle engine.')) {
    fail(`${label} must preserve outOfScope and nonGoals.`);
  }
  if (!(task.validators ?? []).includes('npm run validate:task-import')) {
    fail(`${label} must preserve validators.`);
  }
  if (task.evidenceRequired !== 'command-backed' || task.rollbackStrategy !== 'revert-commit') {
    fail(`${label} must preserve evidence and rollback metadata.`);
  }
  if (task.atomizationImpact?.ownerAtomOrMap !== 'atm.task-ledger-governance-map'
    || !(task.atomizationImpact?.mapUpdates ?? []).includes('atomic_workbench/atomization-coverage/path-to-atom-map.json')) {
    fail(`${label} must preserve atomizationImpact metadata from camelCase or snake_case frontmatter.`);
  }
}

