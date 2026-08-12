// ATM-GOV-0353 regression test.
//
// caseId: test_atm_gov_0353_planning_root_resolution_is_memoized
// semanticKey: planning_root_config_is_resolved_once_per_process_per_cwd
// coversAcceptance: ACC-1, ACC-2
// coversImpactEdges: repeated-planning-root-resolution-to-next-route-latency, next-route-latency-to-full-profile-red
// contractEdge: atm.planningRootResolutionCache.v1
//
// caseId: test_atm_gov_0353_cache_is_keyed_and_resettable
// semanticKey: cached_planning_roots_never_leak_across_cwd_or_env
// coversAcceptance: ACC-3, ACC-4
// coversImpactEdges: repeated-planning-root-resolution-to-next-route-latency
// contractEdge: atm.planningRootResolutionCache.v1
//
// caseId: test_atm_gov_0353_cached_result_equals_uncached_result
// semanticKey: memoized_planning_root_config_is_byte_identical_to_a_fresh_resolution
// coversAcceptance: ACC-5
// coversImpactEdges: repeated-planning-root-resolution-to-next-route-latency
// contractEdge: atm.planningRootResolutionCache.v1
//
// The proof of memoization here is reference identity, not elapsed time.
// `computePlanningRepoRootConfig` builds a fresh object on every call, so a
// second call that returns the *same* object cannot have recomputed anything.
// A timing assertion would be exactly the kind of margin flake this plan is
// correcting elsewhere.
//
// Runnable directly via:
//   node --strip-types tests/cli/planning-root-resolution-cache.test.ts

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  resolvePlanningRepoRootConfig,
  resetPlanningRootResolutionCache
} from '../../packages/cli/src/commands/planning-repo-root.ts';
import {
  PLANNING_ROOT_RESOLUTION_CACHE_SCHEMA_ID,
  readPlanningRootResolutionCacheSize
} from '../../packages/cli/src/commands/planning-root-resolution-cache.ts';

assert.equal(PLANNING_ROOT_RESOLUTION_CACHE_SCHEMA_ID, 'atm.planningRootResolutionCache.v1');

function makeRepo(configRoots: readonly string[]): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-planning-cache-'));
  mkdirSync(path.join(root, '.atm'), { recursive: true });
  writeFileSync(
    path.join(root, '.atm', 'config.json'),
    JSON.stringify({ taskLedger: { planningRoots: [...configRoots] } }),
    'utf8'
  );
  return root;
}

const originalEnv = process.env.ATM_PLANNING_REPO_ROOT;
const repos: string[] = [];

try {
  delete process.env.ATM_PLANNING_REPO_ROOT;

  // --- ACC-1: one resolution per cwd, no matter how many callers ask.

  const repoA = makeRepo([]);
  repos.push(repoA);
  resetPlanningRootResolutionCache();
  assert.equal(readPlanningRootResolutionCacheSize(), 0, 'reset must empty the cache');

  const first = resolvePlanningRepoRootConfig(repoA);
  assert.equal(readPlanningRootResolutionCacheSize(), 1);
  for (let call = 0; call < 25; call += 1) {
    assert.equal(
      resolvePlanningRepoRootConfig(repoA),
      first,
      'repeat resolution must return the memoized object, not a recomputed one'
    );
  }
  assert.equal(readPlanningRootResolutionCacheSize(), 1, 'repeat calls must not add cache entries');

  // A path spelling that resolves to the same directory is the same input.
  assert.equal(
    resolvePlanningRepoRootConfig(path.join(repoA, '.', '')),
    first,
    'the cache key must be the resolved path, not the literal argument'
  );

  // --- ACC-3: distinct repositories never share an entry.

  const repoB = makeRepo([]);
  repos.push(repoB);
  const fromB = resolvePlanningRepoRootConfig(repoB);
  assert.notEqual(fromB, first, 'a different repository must not receive the first repository cached roots');
  assert.equal(readPlanningRootResolutionCacheSize(), 2);

  // --- ACC-3: the planning-root environment variable is part of the input, so
  // changing it must not be served from the previous entry. A long-lived
  // validator process switches this between fixtures.

  const envRoot = makeRepo([]);
  repos.push(envRoot);
  process.env.ATM_PLANNING_REPO_ROOT = envRoot;
  const withEnv = resolvePlanningRepoRootConfig(repoA);
  assert.notEqual(withEnv, first, 'changing the planning-root env must not reuse the previous entry');
  assert.equal(withEnv.envRoot, path.resolve(envRoot));
  assert.equal(first.envRoot, null, 'the earlier cached value must remain untouched');
  delete process.env.ATM_PLANNING_REPO_ROOT;

  // --- ACC-4: an in-process config rewrite is observed.

  const beforeRewrite = resolvePlanningRepoRootConfig(repoA);
  writeFileSync(
    path.join(repoA, '.atm', 'config.json'),
    JSON.stringify({ taskLedger: { planningRoots: [repoB, envRoot] } }),
    'utf8'
  );
  const afterRewrite = resolvePlanningRepoRootConfig(repoA);
  assert.notEqual(afterRewrite, beforeRewrite, 'a rewritten .atm/config.json must not be served from cache');
  assert.deepEqual(
    [...afterRewrite.configRoots],
    [repoB, envRoot],
    'the post-rewrite resolution must reflect the new configured roots'
  );

  // --- ACC-4: reset drops everything, including entries under other keys.

  resetPlanningRootResolutionCache();
  assert.equal(readPlanningRootResolutionCacheSize(), 0);
  const afterReset = resolvePlanningRepoRootConfig(repoA);
  assert.notEqual(afterReset, afterRewrite, 'reset must force a fresh resolution');

  // --- ACC-5: memoizing changes timing only. Two independent fresh
  // resolutions, and the memoized one, must all carry the same value.

  resetPlanningRootResolutionCache();
  const fresh1 = resolvePlanningRepoRootConfig(repoA);
  resetPlanningRootResolutionCache();
  const fresh2 = resolvePlanningRepoRootConfig(repoA);
  assert.notEqual(fresh1, fresh2, 'the two fresh resolutions must be distinct objects for this to prove anything');
  assert.deepEqual(fresh2, fresh1, 'a fresh resolution must equal the value the cache would have returned');
  assert.deepEqual(resolvePlanningRepoRootConfig(repoA), fresh1);
} finally {
  resetPlanningRootResolutionCache();
  if (originalEnv === undefined) {
    delete process.env.ATM_PLANNING_REPO_ROOT;
  } else {
    process.env.ATM_PLANNING_REPO_ROOT = originalEnv;
  }
  for (const repo of repos) {
    rmSync(repo, { recursive: true, force: true });
  }
}

console.log('[planning-root-resolution-cache] ok');
