// ATM-GOV-0180 / ATM-BUG-2026-07-16-006/008/009
// Untracked new files under allowed `**/*.ext` globs must match for pre-close /
// commit-bundle classification and auto-stage scope gating.
//
//   node --strip-types tests/cli/taskflow-scope-untracked-glob.test.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathMatchesTaskScope as gitPathMatches } from '../../packages/cli/src/commands/git-governance/commit-scope-policy.ts';
import { isPathAllowedByScope } from '../../packages/cli/src/commands/work-channels.ts';
import { pathMatchesTaskScope as historicalPathMatches } from '../../packages/cli/src/commands/tasks/historical-delivery.ts';
import { buildTaskflowCommitBundle } from '../../packages/cli/src/commands/taskflow/commit-bundle-assembly.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const glob = 'packages/cli/src/commands/next/playbook-projection/**/*.ts';
const directChild = 'packages/cli/src/commands/next/playbook-projection/alpha.ts';
const nestedChild = 'packages/cli/src/commands/next/playbook-projection/nested/beta.ts';
const outside = 'packages/cli/src/commands/next/other.ts';

{
  assert.equal(gitPathMatches(directChild, glob), true, 'git matcher: direct child under **/');
  assert.equal(gitPathMatches(nestedChild, glob), true, 'git matcher: nested child under **/');
  assert.equal(gitPathMatches(outside, glob), false, 'git matcher: outside glob');
  assert.equal(historicalPathMatches(directChild, glob), true, 'historical matcher: direct child');
  assert.equal(isPathAllowedByScope(directChild, [glob]), true, 'work-channels matcher: direct child');
  assert.equal(isPathAllowedByScope(nestedChild, [glob]), true, 'work-channels matcher: nested child');
  console.log('Test A matcher parity for untracked-style paths: PASS');
}

{
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-scope-untracked-glob-'));
  const repo = path.join(tempRoot, 'target');
  const planning = path.join(tempRoot, 'planning');
  try {
    for (const root of [repo, planning]) {
      mkdirSync(root, { recursive: true });
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.name', 'test'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root, stdio: 'ignore' });
    }
    const planPath = path.join(planning, 'docs/tasks/TASK-GLOB-0001.task.md');
    mkdirSync(path.dirname(planPath), { recursive: true });
    writeFileSync(planPath, '# TASK-GLOB-0001\n', 'utf8');
    writeJson(path.join(repo, '.atm/history/tasks/TASK-GLOB-0001.json'), {
      workItemId: 'TASK-GLOB-0001',
      deliverables: [glob],
      scopePaths: [glob],
      targetAllowedFiles: [glob],
      source: { planPath }
    });
    mkdirSync(path.join(repo, 'packages/cli/src/commands/next/playbook-projection'), { recursive: true });
    writeFileSync(path.join(repo, directChild), 'export const alpha = 1;\n', 'utf8');
    writeFileSync(path.join(repo, outside), 'export const other = 1;\n', 'utf8');

    const bundle = buildTaskflowCommitBundle({
      cwd: repo,
      taskId: 'TASK-GLOB-0001',
      actorId: 'test-actor',
      commitMode: 'dry-run',
      planningMirrorPath: planPath,
      rosterIndexPath: null,
      planningAuthorityDeliveryOk: false
    });

    assert.equal(bundle.failClosed, false, `glob-matched untracked deliverable must not fail-close: ${bundle.targetRepo.reason ?? ''}`);
    assert.ok(bundle.targetDeliveryFiles.includes(directChild), `targetDeliveryFiles must include ${directChild}`);
    assert.equal(bundle.excludedDirtyFiles.includes(directChild), false, 'in-scope untracked glob match must not be excludedDirty');
    assert.ok(bundle.excludedDirtyFiles.includes(outside), 'out-of-scope dirty remains excluded');
    console.log('Test B taskflow commit bundle includes untracked glob match: PASS');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

console.log(JSON.stringify({ ok: true, suite: 'taskflow-scope-untracked-glob' }, null, 2));
