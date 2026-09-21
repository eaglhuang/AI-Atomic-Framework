// TASK-ERR-0014 regression test.
//
// caseId: test_pathspec_argv_batching_0014
// semanticKey: oversized_path_bundles_split_into_budget_bounded_git_invocations
// coversAcceptance: ACC-4, ACC-5
// coversImpactEdges: oversized-path-bundle-to-bounded-git-invocations
// contractEdge: pathspec-argv-budget
//
// Batching is planning, not process work: the plan is a pure function of the
// path list, the fixed leading arguments, and a platform byte budget. That is
// what makes it testable for a Windows budget from a POSIX host and back.
//
// Runnable directly via:
//   node --strip-types packages/cli/src/commands/git-governance/implementation/pathspec-argv-batching.test.ts

import assert from 'node:assert/strict';

import {
  PATHSPEC_ARGV_BUDGET_SCHEMA_ID,
  estimateArgvBytes,
  planPathspecBatches,
  resolvePathspecArgvBudget
} from './pathspec-argv-batching.ts';

// --- ACC-4: the budget is a platform policy, not a caller decision.

const windows = resolvePathspecArgvBudget('win32');
const posix = resolvePathspecArgvBudget('linux');
assert.equal(windows.schemaId, PATHSPEC_ARGV_BUDGET_SCHEMA_ID);
assert.equal(posix.schemaId, PATHSPEC_ARGV_BUDGET_SCHEMA_ID);
assert.ok(
  windows.budgetBytes > 0 && windows.budgetBytes < 32_767,
  'the Windows budget must sit strictly below the CreateProcess command-line limit'
);
assert.ok(
  posix.budgetBytes > windows.budgetBytes,
  'POSIX allows a larger argv than Windows, and the policy must reflect that rather than flattening both'
);
assert.equal(
  resolvePathspecArgvBudget('win32').budgetBytes,
  windows.budgetBytes,
  'the budget must be a stable function of the platform'
);

// --- ACC-4: a release-style bundle is split, and every batch fits the budget.

const fixedArgs = ['ls-files', '-s', '--'];
const releaseBundle = [
  ...Array.from({ length: 400 }, (_, index) => `packages/cli/dist/commands/git-governance/implementation/chunk-${index}.js`),
  ...Array.from({ length: 400 }, (_, index) => `release/atm-onefile/vendor/module-${index}/index.mjs`)
];

const singleInvocationBytes = estimateArgvBytes([...fixedArgs, ...releaseBundle]);
assert.ok(
  singleInvocationBytes > windows.budgetBytes,
  'the fixture must actually exceed the Windows budget, otherwise it proves nothing'
);

const plan = planPathspecBatches({
  paths: releaseBundle,
  fixedArgs,
  budgetBytes: windows.budgetBytes
});

assert.equal(plan.schemaId, PATHSPEC_ARGV_BUDGET_SCHEMA_ID);
assert.ok(plan.batches.length > 1, 'an over-budget bundle must be split into more than one invocation');
for (const [index, batch] of plan.batches.entries()) {
  assert.ok(batch.length > 0, 'a planned batch must never be empty');
  assert.ok(
    estimateArgvBytes([...fixedArgs, ...batch]) <= windows.budgetBytes,
    `batch ${index} must fit the declared budget once the fixed arguments are charged to it`
  );
}

// --- ACC-4: sorting, dedupe, and coverage equivalence survive the split.

const flattened = plan.batches.flat();
assert.deepEqual(
  flattened,
  [...new Set(releaseBundle)].sort(),
  'concatenating the batches must reproduce the normalized path list exactly, in order'
);
assert.deepEqual(plan.paths, flattened, 'the plan must report the same normalized list it batched');

const duplicated = planPathspecBatches({
  paths: ['b.txt', 'a.txt', './a.txt', 'b.txt', '  ', 'c\\d.txt'],
  fixedArgs
});
assert.deepEqual(
  duplicated.paths,
  ['a.txt', 'b.txt', 'c/d.txt'],
  'the planner must normalize separators, drop blanks, dedupe, and sort before batching'
);

// An empty list plans no invocations at all, so callers can skip the spawn.
assert.deepEqual(planPathspecBatches({ paths: [], fixedArgs }).batches, []);

// --- ACC-5: a path that cannot fit alone fails closed with a diagnosis.

const oversizedPath = `${'deeply-nested-directory/'.repeat(60)}file.ts`;
assert.ok(
  estimateArgvBytes([...fixedArgs, oversizedPath]) > 512,
  'the oversized fixture must exceed the tiny budget used below'
);
assert.throws(
  () => planPathspecBatches({ paths: [oversizedPath], fixedArgs, budgetBytes: 512 }),
  (error: unknown) => {
    const cliError = error as { code?: string; details?: { path?: string; budgetBytes?: number } };
    assert.equal(
      cliError.code,
      'ATM_GIT_PATHSPEC_ARGV_BUDGET_EXCEEDED',
      'an unbatchable path must fail closed under its own error code'
    );
    assert.equal(cliError.details?.path, oversizedPath, 'the diagnosis must name the offending path');
    assert.equal(cliError.details?.budgetBytes, 512, 'the diagnosis must report the budget it was measured against');
    return true;
  },
  'a single path larger than the budget must never be silently dropped or truncated'
);

// Multi-byte paths are charged by UTF-8 bytes, not by code-unit count, because
// that is what the process boundary actually spends.
assert.ok(
  estimateArgvBytes(['配置檔案.ts']) > estimateArgvBytes(['config.ts']),
  'argv estimation must charge multi-byte paths their real byte cost'
);

console.log('[pathspec-argv-batching] ok');
