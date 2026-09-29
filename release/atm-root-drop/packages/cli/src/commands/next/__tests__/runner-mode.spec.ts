import assert from 'node:assert/strict';
import {
  classifyRunnerMode,
  describeRunnerMode,
  governanceCommandPrefix,
  withRunnerMode
} from '../runner-mode.ts';

assert.equal(classifyRunnerMode('atm.mjs'), 'frozen');
assert.equal(classifyRunnerMode('atm.dev.mjs'), 'source-first');
assert.equal(classifyRunnerMode('node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs'), 'npm-package');
assert.equal(classifyRunnerMode('C:/consumer/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs'), 'npm-package');
assert.equal(governanceCommandPrefix('C:/consumer/node_modules/@ai-atomic-framework/cli/dist/npm-runtime/atm.mjs'), 'npm exec -- atm');
assert.equal(governanceCommandPrefix('atm.mjs'), 'node atm.mjs');
assert.equal(classifyRunnerMode(null), 'unknown');

const described = describeRunnerMode(process.cwd());
assert.equal(described.schemaId, 'atm.runnerMode.v1');
assert.ok(['frozen', 'npm-package', 'source-first', 'source-import', 'unknown'].includes(described.mode));

const base = {
  evidence: { nextAction: { status: 'ready' } } as any,
  messages: [] as unknown[]
};
const wrapped = withRunnerMode(structuredClone(base), process.cwd());
assert.equal(wrapped.evidence?.runnerMode?.schemaId, 'atm.runnerMode.v1');
assert.equal(base.evidence?.runnerMode, undefined, 'withRunnerMode must not mutate the original result object');

console.log('[runner-mode.spec] ok');
