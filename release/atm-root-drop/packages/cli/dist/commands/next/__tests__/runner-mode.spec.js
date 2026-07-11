import assert from 'node:assert/strict';
import { classifyRunnerMode, describeRunnerMode, withRunnerMode } from '../runner-mode.js';
assert.equal(classifyRunnerMode('atm.mjs'), 'frozen');
assert.equal(classifyRunnerMode('atm.dev.mjs'), 'source-first');
assert.equal(classifyRunnerMode(null), 'unknown');
const described = describeRunnerMode(process.cwd());
assert.equal(described.schemaId, 'atm.runnerMode.v1');
assert.ok(['frozen', 'source-first', 'source-import', 'unknown'].includes(described.mode));
const base = {
    evidence: { nextAction: { status: 'ready' } },
    messages: []
};
const wrapped = withRunnerMode(structuredClone(base), process.cwd());
assert.equal(wrapped.evidence?.runnerMode?.schemaId, 'atm.runnerMode.v1');
assert.equal(base.evidence?.runnerMode, undefined, 'withRunnerMode must not mutate the original result object');
console.log('[runner-mode.spec] ok');
