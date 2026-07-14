import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearBrokerRuntimeState,
  prepareIsolatedFrameworkFixtureRepo,
  prepareIsolatedTaskLedgerFixtureRepo
} from '../../scripts/validators/task-ledger/suite-impl.ts';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-task-ledger-fixture-isolation-'));

const first = prepareIsolatedTaskLedgerFixtureRepo(tempRoot, 'fixture-a');
const second = prepareIsolatedTaskLedgerFixtureRepo(tempRoot, 'fixture-b');

assert.notEqual(first.repo, second.repo, 'fixture helper must allocate unique repo paths per fixture name');
assert.match(first.head, /^[0-9a-f]{40}$/i, 'first fixture must have a deterministic seed HEAD');
assert.match(second.head, /^[0-9a-f]{40}$/i, 'second fixture must have a deterministic seed HEAD');

for (const fixture of [first, second]) {
  const commitCount = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: fixture.repo, encoding: 'utf8' }).trim());
  assert.equal(commitCount, 1, 'fresh task-ledger fixture repo must start with exactly one seed commit');
  assert.ok(existsSync(path.join(fixture.repo, '.atm', 'validator-fixture-root.txt')), 'seed commit must include the validator root marker');
}

const brokerRuntimeDir = path.join(first.repo, '.atm', 'runtime');
mkdirSync(path.join(brokerRuntimeDir, 'broker-intents'), { recursive: true });
writeFileSync(path.join(brokerRuntimeDir, 'write-broker.registry.json'), '{"dirty":true}\n', 'utf8');
writeFileSync(path.join(brokerRuntimeDir, 'broker-shared-surface-queues.json'), '{"dirty":true}\n', 'utf8');
writeFileSync(path.join(brokerRuntimeDir, 'broker-shared-surface-freezes.json'), '{"dirty":true}\n', 'utf8');
writeFileSync(path.join(brokerRuntimeDir, 'broker-intents', 'TASK-DIRTY.json'), '{"dirty":true}\n', 'utf8');

clearBrokerRuntimeState(first.repo);

assert.equal(existsSync(path.join(brokerRuntimeDir, 'write-broker.registry.json')), false, 'fixture cleanup must remove inherited write broker registry');
assert.equal(existsSync(path.join(brokerRuntimeDir, 'broker-shared-surface-queues.json')), false, 'fixture cleanup must remove inherited shared queue state');
assert.equal(existsSync(path.join(brokerRuntimeDir, 'broker-shared-surface-freezes.json')), false, 'fixture cleanup must remove inherited shared freeze state');
assert.equal(existsSync(path.join(brokerRuntimeDir, 'broker-intents')), false, 'fixture cleanup must remove inherited broker intent directory');

const frameworkFixture = prepareIsolatedFrameworkFixtureRepo(tempRoot, 'framework-fixture-isolation');
const frameworkCommitCount = Number(execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: frameworkFixture.repo, encoding: 'utf8' }).trim());
assert.equal(frameworkCommitCount, 1, 'framework fixture repo must also start with exactly one seed commit');
assert.ok(existsSync(path.join(frameworkFixture.repo, '.atm', 'validator-fixture-root.txt')), 'framework seed commit must include the validator root marker');

console.log('task-ledger fixture isolation contract ok');
