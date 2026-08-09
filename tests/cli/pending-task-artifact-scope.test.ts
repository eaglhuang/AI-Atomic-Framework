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
assert.deepEqual(report.advisoryTrackedFiles, ['docs/governance/error-code-registry.json']);
console.log('[pending-task-artifact-scope.test] ok');
