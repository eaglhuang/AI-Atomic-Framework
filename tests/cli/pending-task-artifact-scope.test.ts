import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkPendingTaskArtifactScopeExpansion } from '../../packages/cli/src/commands/next/route-resolution/pending-worktree.ts';

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-pending-scope-'));
const git = (...args: string[]) => {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
};
mkdirSync(path.join(cwd, 'docs', 'governance'), { recursive: true });
git('init');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'ATM test');
writeFileSync(path.join(cwd, 'docs/governance/error-code-registry.json'), '{"baseline":true}\n');
git('add', '.');
git('commit', '-m', 'fixture');
writeFileSync(path.join(cwd, 'docs/governance/error-code-registry.json'), '{"foreign":true}\n');

const report = checkPendingTaskArtifactScopeExpansion({
  cwd,
  task: {
    workItemId: 'TASK-ERR-0011', title: 'fixture', status: 'planned', closedAt: null,
    closedByActor: null, closurePacket: null, lastTransitionId: null, lastTransitionAt: null,
    milestone: null, dependencies: [], taskPath: '.atm/history/tasks/TASK-ERR-0011.json',
    format: 'json', sourcePlanPath: null, nearbyPlanPaths: [],
    scopePaths: [
      'packages/core/src/broker/runner-build-output-inventory.ts',
      'packages/core/src/error-code-registry.generated.ts'
    ],
    targetRepo: null, planningRepo: null, allowPlanningMirror: false,
    planningReadOnlyPaths: [], planningMirrorPaths: [], targetAllowedFiles: [],
    closureAuthority: null, activeClaimActorId: null, activeClaimLaneSessionId: null,
    activeClaimIntent: null
  } as never
});
assert.deepEqual(report.scopeExpansionRequiredFiles, []);
assert.deepEqual(report.advisoryTrackedFiles, ['docs/governance/error-code-registry.json']);

mkdirSync(path.join(cwd, '.github', 'instructions'), { recursive: true });
writeFileSync(path.join(cwd, '.github', 'instructions', 'adapter-projection.instructions.md'), 'baseline\n');
git('add', '.github');
git('commit', '-m', 'add projection fixture');
writeFileSync(path.join(cwd, '.github', 'instructions', 'adapter-projection.instructions.md'), 'foreign projection drift\n');

const fuzzyProjectionReport = checkPendingTaskArtifactScopeExpansion({
  cwd,
  task: {
    workItemId: 'TASK-SKL-0040', title: 'Refresh sealed adapter projection parity', status: 'planned', closedAt: null,
    closedByActor: null, closurePacket: null, lastTransitionId: null, lastTransitionAt: null,
    milestone: null, dependencies: [], taskPath: '.atm/history/tasks/TASK-SKL-0040.json',
    format: 'json', sourcePlanPath: 'docs/ai_atomic_framework/skl-tool-first-upgrade/SKL-validator-governance-test-case-catalog-plan.md', nearbyPlanPaths: [],
    scopePaths: ['packages/integrations-core/src/compiler/skill-projection-parity.ts'],
    targetRepo: null, planningRepo: null, allowPlanningMirror: false,
    planningReadOnlyPaths: [], planningMirrorPaths: [], targetAllowedFiles: [],
    closureAuthority: null, activeClaimActorId: null, activeClaimLaneSessionId: null,
    activeClaimIntent: null
  } as never
});
assert.deepEqual(fuzzyProjectionReport.scopeExpansionRequiredFiles, []);
assert.deepEqual(fuzzyProjectionReport.advisoryTrackedFiles, [
  '.github/instructions/adapter-projection.instructions.md'
]);
console.log('[pending-task-artifact-scope.test] ok');
