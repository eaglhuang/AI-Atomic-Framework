import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BehaviorRegistry } from '../packages/plugin-sdk/src/behavior-registry.ts';
import { EVOLVE_DELEGATION_TARGET } from '../packages/plugin-sdk/src/behavior.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

let failed = false;

function fail(message) {
  console.error(`[behavior-pack:${mode}] ${message}`);
  failed = true;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  assert(existsSync(filePath), `missing required JSON file: ${relativePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readText(relativePath) {
  const filePath = path.join(root, relativePath);
  assert(existsSync(filePath), `missing required file: ${relativePath}`);
  return readFileSync(filePath, 'utf8');
}

const manifestPath = 'fixtures/behaviors/behavior-pack.manifest.json';
const manifest = readJson(manifestPath);
const entries = Array.isArray(manifest.behaviors) ? manifest.behaviors : [];
assert(entries.length === 10, `behavior manifest must list exactly 10 behaviors, got ${entries.length}`);

const expectedActions = [
  'behavior.split',
  'behavior.merge',
  'behavior.compose',
  'behavior.dedup-merge',
  'behavior.sweep',
  'behavior.evolve',
  'behavior.expire',
  'behavior.polymorphize',
  'behavior.infect',
  'behavior.atomize'
];

const registry = new BehaviorRegistry();

for (const behaviorEntry of entries) {
  const action = behaviorEntry.action;
  const packageName = behaviorEntry.pluginPackage;
  const fixturePath = behaviorEntry.fixture;

  const packageDir = packageName.replace('@ai-atomic-framework/', 'packages/');
  const packageJsonPath = `${packageDir}/package.json`;
  const sourcePath = `${packageDir}/src/index.ts`;

  assert(existsSync(path.join(root, packageJsonPath)), `missing plugin package.json: ${packageJsonPath}`);
  assert(existsSync(path.join(root, sourcePath)), `missing plugin source file: ${sourcePath}`);
  assert(existsSync(path.join(root, fixturePath)), `missing behavior fixture: ${fixturePath}`);

  const source = readText(sourcePath);
  assert(!source.includes('@ai-atomic-framework/core'), `${sourcePath} must not import @ai-atomic-framework/core`);

  const loaded = await import(pathToFileURL(path.join(root, sourcePath)).href);
  const behavior = loaded.behavior ?? loaded.default;
  assert(Boolean(behavior), `${sourcePath} must export behavior object`);
  if (!behavior) {
    continue;
  }
  registry.register(behavior);

  const fixture = readJson(fixturePath);
  const input = JSON.parse(JSON.stringify(fixture.input || {}));
  const expect = fixture.expect || {};

  if (expect.delegatesMapGeneration === true) {
    input.payload = {
      ...(input.payload || {}),
      generateAtomicMap() {
        return {
          ok: true,
          mapId: 'ATM-MAP-0001'
        };
      }
    };
  }

  const output = await behavior.execute({ repositoryRoot: root }, input);
  assert(output.ok === expect.ok, `${action} expected ok=${expect.ok}, got ${output.ok}`);

  const expectedIssues = Array.isArray(expect.issues) ? expect.issues : [];
  assert(output.issues.length === expectedIssues.length, `${action} issues count mismatch`);
  for (const issue of expectedIssues) {
    assert(output.issues.includes(issue), `${action} expected issue missing: ${issue}`);
  }

  if (expect.mustDelegateTo) {
    assert(output.delegatedTo === expect.mustDelegateTo, `${action} must delegate to ${expect.mustDelegateTo}`);
  }

  if (action === 'behavior.evolve') {
    assert(output.delegatedTo === EVOLVE_DELEGATION_TARGET, 'behavior.evolve must delegate to EVOLVE_DELEGATION_TARGET');
  }

  if (expect.requiresProposalEnvelope === true) {
    const proposalEnvelope = output.evidence?.[0]?.details?.proposalEnvelope;
    assert(Boolean(proposalEnvelope), `${action} must include proposalEnvelope in evidence details`);
    if (proposalEnvelope) {
      assert(proposalEnvelope.proposalSource === 'ATM-2-0020', `${action} proposalSource must be ATM-2-0020`);
      assert(proposalEnvelope.patchMode === 'dry-run', `${action} patchMode must be dry-run`);
      assert(proposalEnvelope.applyToHostProject === false, `${action} must not apply to host project`);
      assert(proposalEnvelope.decompositionDecision === expect.decompositionDecision, `${action} decompositionDecision mismatch`);
    }
  }

  if (expect.canonicalMembershipMapId) {
    const canonicalMembershipMapId = output.evidence?.[0]?.details?.canonicalMembershipMapId;
    assert(canonicalMembershipMapId === expect.canonicalMembershipMapId, `${action} canonical membership map mismatch`);
    assert(/^ATM-MAP-\d{4}$/.test(canonicalMembershipMapId), `${action} canonical membership map must match ATM-MAP-{NNNN}`);
  }
}

for (const action of expectedActions) {
  const resolved = registry.resolve(action);
  assert(Boolean(resolved), `registry must resolve action: ${action}`);
}

const listedActions = registry.listActions();
for (const action of expectedActions) {
  assert(listedActions.includes(action), `registry listActions must include ${action}`);
}

if (failed) {
  process.exit(1);
}

console.log(`[behavior-pack:${mode}] ok (${entries.length} plugins, ${expectedActions.length} actions, fixture replay passed)`);
