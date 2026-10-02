import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMapEquivalence } from '../../packages/core/src/equivalence/run-map-equivalence.ts';
import { createMinimalAtomicMapSpec } from '../../packages/core/src/manager/map-generator.ts';
import { resolveCanonicalMapPaths } from '../../packages/core/src/test-runner/map-integration.ts';

const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-equivalence-isolation-'));
const mapId = 'ATM-MAP-9402';
try {
  const paths = resolveCanonicalMapPaths(mapId);
  mkdirSync(path.join(repositoryRoot, paths.workbenchPath), { recursive: true });
  const spec = createMinimalAtomicMapSpec({
    mapId, mapVersion: '0.1.0',
    members: [{ atomId: 'ATM-FIXTURE-0001', version: '0.1.0', role: 'entry-adapter' }],
    edges: [], entrypoints: ['ATM-FIXTURE-0001'],
    qualityTargets: { requiredChecks: 1, promoteGateRequired: true },
    replacement: { legacyUris: ['legacy://isolation'], mode: 'draft', evidenceRefs: [] }
  });
  writeFileSync(path.join(repositoryRoot, paths.specPath), JSON.stringify(spec));
  writeFileSync(path.join(repositoryRoot, paths.testPath), 'export {};');
  writeFileSync(path.join(repositoryRoot, 'executors.mjs'), `
    const shared = globalThis.__atmEquivalenceAlias ??= { value: 0 };
    export function mutateInput(input) { input.nested.value = 2; return input; }
    export function identity(input) { return input; }
    export function mutateContext(input, context) { context.legacyUris.push('mutated'); return context; }
    export function contextOnly(input, context) { return context; }
    export function baselineAlias() { shared.value = 1; return shared; }
    export function currentAlias() { shared.value = 2; return shared; }
    export function mutateSame(input) { input.nested.value = 2; return input; }
  `);
  for (const [name, legacy, current, passed] of [
    ['input', 'mutateInput', 'identity', false],
    ['context', 'mutateContext', 'contextOnly', false],
    ['output', 'baselineAlias', 'currentAlias', false],
    ['equal-mutations', 'mutateInput', 'mutateSame', true]
  ] as const) {
    const fixturePath = `${name}.json`;
    writeFileSync(path.join(repositoryRoot, fixturePath), JSON.stringify({
      fixtureSetId: `fixture.${name}`,
      legacyExecutor: { modulePath: 'executors.mjs', exportName: legacy },
      mapExecutor: { modulePath: 'executors.mjs', exportName: current },
      cases: [{ caseId: name, input: { nested: { value: 1 } } }]
    }));
    const result = await runMapEquivalence(mapId, fixturePath, { repositoryRoot, writeReport: false });
    assert.equal(result.ok, passed, `${name}: executors must not share mutable observations`);
    assert.deepEqual(result.report.cases[0].input, { nested: { value: 1 } }, 'report must retain original fixture input');
    if (name === 'output') {
      assert.deepEqual(result.report.cases[0].expected, { value: 1 });
      assert.deepEqual(result.report.cases[0].actual, { value: 2 });
    }
  }
  console.log('[map-equivalence-isolation.test] ok');
} finally {
  delete (globalThis as any).__atmEquivalenceAlias;
  rmSync(repositoryRoot, { recursive: true, force: true });
}
