import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';

const parser = readFileSync('packages/cli/src/commands/broker/parser.ts', 'utf8');
const actions = readFileSync('packages/cli/src/commands/broker/steward-runtime-actions.ts', 'utf8');
const commandSpec = readFileSync('packages/cli/src/commands/command-specs/broker.spec.ts', 'utf8');

assert.match(parser, /readonly persistMergePlan: boolean;/);
assert.match(parser, /arg === '--persist-merge-plan'/);
assert.match(commandSpec, /--persist-merge-plan/);
assert.match(actions, /broker-merge-plans/);
assert.match(actions, /options\.persistMergePlan && !blocked/);
assert.match(actions, /persistedMergePlan/);
assert.match(commandSpec, /compose is read-only unless this flag is present/);
assert.doesNotMatch(actions, /sha256:\$\{hashContent\(content\)\}/);

console.log('broker compose persistence contract passed');
