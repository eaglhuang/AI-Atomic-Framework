/**
 * A framework temporary claim may legitimately declare a directory scope, but a
 * directory never transfers ownership of another task's governance history.
 * Before this contract existed, a claim such as `.atm/history/evidence/` swept a
 * foreign active task's receipt into the governed auto-stage candidate set; the
 * cross-task guard then refused the commit and named a path the operator had
 * never staged, which reads as a pre-commit defect instead of a staging one.
 *
 * Ownership is resolved through the single cross-task owner seam so staging and
 * the mutation guard can never disagree about who owns a history path.
 *
 * caseId: test_int_framework_auto_stage_rejects_foreign_task_history
 * semanticKey: framework_directory_claim_excludes_foreign_task_history
 * contractEdge: framework-commit-auto-stage
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  autoStageFrameworkClaimFiles,
  isFrameworkGeneratedArtifactAllowed
} from '../../packages/cli/src/commands/git-governance/implementation/task-scope-staging.ts';

const ACTOR = 'claude-008';
const TEMP_TASK = `ATM-FRAMEWORK-TEMP-${ACTOR}`;
const FOREIGN_TASK = 'TASK-FOREIGN-0001';
const FOREIGN_RECEIPT = `.atm/history/evidence/${FOREIGN_TASK}.runner-sync-receipt.json`;
const SELF_RECEIPT = `.atm/history/evidence/${TEMP_TASK}.runner-sync-receipt.json`;
const HOOK_FILE = '.atm/git-hooks/pre-commit';
const PINNED_RUNNER = '.atm/runtime/pinned-runner.json';

function buildFixture(claimedFiles: readonly string[]): string {
  const root = path.join(os.tmpdir(), `atm-foreign-history-${process.pid}-${Math.random().toString(16).slice(2)}`);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  const write = (relativePath: string, body: string) => {
    const full = path.join(root, relativePath);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body);
  };

  mkdirSync(root, { recursive: true });
  execFileSync('git', ['init', '-q', root], { stdio: ['ignore', 'pipe', 'pipe'] });
  git('config', 'user.name', 'fixture');
  git('config', 'user.email', 'fixture@local');

  write(HOOK_FILE, 'baseline\n');
  write(PINNED_RUNNER, '{"runner":"baseline"}\n');
  // A foreign task must be a *known* task before its history paths are owned.
  write(`.atm/history/tasks/${FOREIGN_TASK}.json`, JSON.stringify({
    workItemId: FOREIGN_TASK,
    status: 'running',
    claim: { state: 'active', actorId: 'other-actor' },
    allowedFiles: ['scripts/other-lane.ts']
  }));
  write(`.atm/history/tasks/${TEMP_TASK}.json`, JSON.stringify({
    workItemId: TEMP_TASK,
    status: 'running',
    claim: { state: 'active', actorId: ACTOR },
    allowedFiles: [...claimedFiles]
  }));
  git('add', '-A');
  git('commit', '-q', '-m', 'baseline');

  write(`.atm/runtime/locks/${TEMP_TASK}.lock.json`, JSON.stringify({
    schemaId: 'atm.governanceScopeLock',
    specVersion: '0.1.0',
    workItemId: TEMP_TASK,
    lockedBy: ACTOR,
    actorId: ACTOR,
    lockedAt: new Date().toISOString(),
    ttlSeconds: 1800,
    files: [...claimedFiles],
    released: false,
    status: 'active'
  }));

  write(HOOK_FILE, 'lane change\n');
  write(PINNED_RUNNER, '{"runner":"synced"}\n');
  write(FOREIGN_RECEIPT, JSON.stringify({ foreign: true }));
  write(SELF_RECEIPT, JSON.stringify({ self: true }));
  return root;
}

function candidatesFor(claimedFiles: readonly string[]): readonly string[] {
  const root = buildFixture(claimedFiles);
  try {
    // apply = false keeps this a pure candidate computation; nothing is staged.
    return autoStageFrameworkClaimFiles(root, ACTOR, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// A directory claim is the regression: it must reach its own history paths
// without inheriting another known task's.
const directoryClaim = candidatesFor(['.atm/history/evidence/', HOOK_FILE]);
assert.ok(
  !directoryClaim.includes(FOREIGN_RECEIPT),
  'a directory-scoped claim must not sweep a foreign task history path into the governed candidate set'
);
assert.ok(
  directoryClaim.includes(SELF_RECEIPT),
  'a directory-scoped claim must still reach the claiming task\'s own history path'
);
assert.ok(
  directoryClaim.includes(HOOK_FILE),
  'a directory-scoped claim must not disturb ordinary in-scope framework sources'
);

// The broadest possible claim must not become a cross-task escape hatch.
const rootClaim = candidatesFor(['.atm/']);
assert.ok(
  !rootClaim.includes(FOREIGN_RECEIPT),
  'a repository-wide .atm claim must not inherit foreign task history either'
);
assert.ok(
  rootClaim.includes(SELF_RECEIPT),
  'a repository-wide .atm claim must still reach the claiming task\'s own history path'
);
assert.ok(
  !rootClaim.includes(PINNED_RUNNER),
  'a directory-scoped .atm claim must not absorb runtime metadata'
);

const exactPinnedRunnerClaim = candidatesFor([PINNED_RUNNER]);
assert.deepEqual(
  [...exactPinnedRunnerClaim],
  [PINNED_RUNNER],
  'an exact runner-sync metadata claim must be stageable without widening runtime directory scope'
);

// Exact-path claims are unchanged: naming a path is a deliberate authority act.
const exactForeignClaim = candidatesFor([FOREIGN_RECEIPT]);
assert.ok(
  exactForeignClaim.includes(FOREIGN_RECEIPT),
  'an exact-path claim must remain able to name a foreign history path deliberately'
);

const exactFileClaim = candidatesFor([HOOK_FILE]);
assert.deepEqual(
  [...exactFileClaim],
  [HOOK_FILE],
  'an exact-file claim must keep its pre-existing candidate set'
);

// Generated release surfaces keep their directory semantics: they are not
// task-history paths, so nothing about their inheritance changes.
const releaseScopes = new Set(['release/', 'packages/cli/dist/']);
for (const generated of ['release/atm-onefile/atm.mjs', 'packages/cli/dist/atm.js']) {
  assert.equal(
    isFrameworkGeneratedArtifactAllowed(generated, releaseScopes, new Set(), { cwd: process.cwd(), currentTaskId: TEMP_TASK }),
    true,
    `directory claims over generated release surfaces must keep admitting ${generated}`
  );
}

// Without an owner context the predicate keeps its historical shape, so callers
// that cannot resolve a repository root are not silently changed.
assert.equal(
  isFrameworkGeneratedArtifactAllowed(FOREIGN_RECEIPT, new Set(['.atm/history/evidence/']), new Set()),
  true,
  'the predicate must stay backward compatible when no owner context is supplied'
);

console.log('[framework-auto-stage-foreign-task-history.test] ok');
