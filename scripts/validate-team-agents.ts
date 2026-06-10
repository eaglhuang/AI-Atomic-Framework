import assert from 'node:assert/strict';
import { assessLieutenantEscalation, buildAtomizationChecklist } from '../packages/cli/src/commands/team.ts';

const taskCase = getArg('--case') ?? 'lieutenant-escalation';

if (taskCase !== 'lieutenant-escalation') {
  fail(`unsupported or missing --case value: ${taskCase}`);
}

const lowRiskTask = {
  workItemId: 'TASK-TEAM-0008-SMALL',
  title: 'Small task crew dry-run',
  planningRepo: 'AI-Atomic-Framework',
  targetRepo: 'AI-Atomic-Framework',
  scopePaths: ['packages/cli/src/commands/team.ts'],
  deliverables: ['packages/cli/src/commands/team.ts'],
  validators: ['npm run typecheck'],
  acceptance: ['Captain keeps the crew small.']
};

const highRiskTask = {
  workItemId: 'TASK-TEAM-0008',
  title: 'Task lieutenant escalation rules',
  planningRepo: 'AI-Atomic-Framework',
  targetRepo: 'AI-Atomic-Framework',
  scopePaths: [
    'packages/cli/src/commands/team.ts',
    'packages/cli/src/commands/command-specs/team.spec.ts',
    'scripts/validate-team-agents.ts',
    'atomic_workbench/atomization-coverage/path-to-atom-map.json'
  ],
  deliverables: [
    'packages/cli/src/commands/team.ts',
    'packages/cli/src/commands/command-specs/team.spec.ts',
    'scripts/validate-team-agents.ts',
    'atomic_workbench/atomization-coverage/path-to-atom-map.json'
  ],
  validators: [
    'npm run typecheck',
    'npm run validate:cli',
    'node --strip-types scripts/validate-team-agents.ts --case lieutenant-escalation',
    'node atm.mjs team plan --task TASK-TEAM-0008 --json',
    'git diff --check'
  ],
  acceptance: [
    'Tasks touching more than two core files recommend Task Lieutenant.',
    'The output includes escalationRequired, escalationReason, needLieutenant, and nextTeamShape.'
  ]
};

const lowRisk = assessLieutenantEscalation(
  lowRiskTask,
  lowRiskTask.deliverables,
  { ok: true, findings: [] },
  safeBrokerLane(),
  buildAtomizationChecklist(lowRiskTask, lowRiskTask.deliverables)
);

assert.equal(lowRisk.escalationRequired, false);
assert.equal(lowRisk.needLieutenant, false);
assert.equal(lowRisk.nextTeamShape.lieutenant.recommended, false);
assert.deepEqual(lowRisk.nextTeamShape.lieutenant.permissions, ['file.read', 'exec.validator']);
assert.deepEqual(lowRisk.nextTeamShape.lieutenant.forbiddenPermissions, ['task.lifecycle', 'git.write', 'evidence.write']);
assert.deepEqual(lowRisk.nextTeamShape.captain.permissions, ['task.lifecycle', 'git.write', 'evidence.write']);

const highRisk = assessLieutenantEscalation(
  highRiskTask,
  highRiskTask.deliverables,
  { ok: true, findings: [] },
  safeBrokerLane(),
  buildAtomizationChecklist(highRiskTask, highRiskTask.deliverables)
);

assert.equal(highRisk.escalationRequired, true);
assert.equal(highRisk.needLieutenant, true);
assert.equal(highRisk.nextTeamShape.lieutenant.recommended, true);
assert.equal(highRisk.nextTeamShape.coordinationBoundary, 'captain+lieutenant');
assert.ok(highRisk.escalationReason.includes('explicitly governs lieutenant escalation rules'));
assert.ok(highRisk.escalationReason.includes('Scope spans'));
assert.ok(highRisk.escalationReason.includes('Validator fan-out'));
assert.ok(highRisk.nextTeamShape.signals.largeScriptRisk);
assert.equal(highRisk.nextTeamShape.signals.scopeCount, 4);

console.log('[validate-team-agents] ok (lieutenant-escalation)');

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeBrokerLane(): any {
  return {
    decision: { verdict: 'safe-to-start' },
    chosenLane: 'direct-brokered',
    safeToStart: true,
    blockedReasons: [],
    stewardId: null,
    composerPath: null
  };
}

function fail(message: string): never {
  console.error(`[validate-team-agents] ${message}`);
  process.exit(1);
}
