import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BehaviorRegistry } from '../packages/plugin-sdk/src/behavior-registry.ts';
import { EVOLVE_DELEGATION_TARGET } from '../packages/plugin-sdk/src/behavior.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message) {
  console.error(`[behavior-sdk:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  assert(existsSync(filePath), `missing behavior SDK fixture: ${relativePath}`);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

// =================== Required files check ===================

const requiredFiles = [
  'packages/plugin-sdk/src/behavior.ts',
  'packages/plugin-sdk/src/behavior-registry.ts',
  'schemas/behavior/behavior-proposal.schema.json',
  'fixtures/behavior/mock-behaviors.json',
  'fixtures/behavior/resolve-missing-behavior.json',
  'fixtures/behavior/evolve-delegation-blocked.json'
];

for (const relativePath of requiredFiles) {
  assert(existsSync(path.join(root, relativePath)), `missing SDK file: ${relativePath}`);
}

// =================== Interface surface checks ===================

// Verify EVOLVE_DELEGATION_TARGET is the expected constant
assert(
  EVOLVE_DELEGATION_TARGET === 'ATM-2-0020:ProposeAtomicUpgrade',
  'EVOLVE_DELEGATION_TARGET must equal ATM-2-0020:ProposeAtomicUpgrade'
);

// Verify BehaviorRegistry is a constructable class
assert(typeof BehaviorRegistry === 'function', 'BehaviorRegistry must be a class/constructor');
const registry = new BehaviorRegistry();
assert(typeof registry.register === 'function', 'BehaviorRegistry must have register()');
assert(typeof registry.resolve === 'function', 'BehaviorRegistry must have resolve()');
assert(typeof registry.resolveOrThrow === 'function', 'BehaviorRegistry must have resolveOrThrow()');
assert(typeof registry.listRegisteredBehaviorIds === 'function', 'BehaviorRegistry must have listRegisteredBehaviorIds()');
assert(typeof registry.listActions === 'function', 'BehaviorRegistry must have listActions()');
assert(typeof registry.executeGuarded === 'function', 'BehaviorRegistry must have executeGuarded()');

// =================== Fixture helpers ===================

/**
 * Build a mock AtomBehavior object from a behaviorContract fixture entry.
 * The execute() method simply returns the given executeOutput, so the
 * validator can test the registry's guard logic in isolation.
 */
function buildMockBehavior(contract) {
  return {
    behaviorId: contract.behaviorId,
    actionCategories: contract.actionCategories,
    execute(_context, _input) {
      return contract.executeOutput;
    }
  };
}

// =================== mock-behaviors.json: contract-pass cases ===================

const mockFixture = readJson('fixtures/behavior/mock-behaviors.json');

const contractMap = Object.fromEntries(
  mockFixture.behaviorContracts.map((c) => [c.behaviorId, c])
);

for (const testCase of mockFixture.cases) {
  const reg = new BehaviorRegistry();

  // register only the behaviors listed in the test case
  for (const behaviorId of (testCase.register || [])) {
    const contract = contractMap[behaviorId];
    assert(contract !== undefined, `${testCase.name}: unknown behavior contract ${behaviorId}`);
    reg.register(buildMockBehavior(contract));
  }

  if (testCase.resolveAction) {
    // contract-pass: resolve by action
    const resolved = reg.resolve(testCase.resolveAction);
    const expectResolved = testCase.expect.resolved !== false;
    if (expectResolved) {
      assert(resolved !== null, `${testCase.name}: must resolve behavior for action ${testCase.resolveAction}`);
      if (testCase.expect.resolvedBehaviorId) {
        assert(
          resolved?.behaviorId === testCase.expect.resolvedBehaviorId,
          `${testCase.name}: resolvedBehaviorId must be ${testCase.expect.resolvedBehaviorId}, got ${resolved?.behaviorId}`
        );
      }
      if (typeof testCase.expect.registeredCount === 'number') {
        assert(
          reg.listRegisteredBehaviorIds().length === testCase.expect.registeredCount,
          `${testCase.name}: registered count must be ${testCase.expect.registeredCount}`
        );
      }
      if (Array.isArray(testCase.expect.listedActionsInclude)) {
        const listedActions = reg.listActions();
        for (const action of testCase.expect.listedActionsInclude) {
          assert(
            listedActions.includes(action),
            `${testCase.name}: listActions() must include ${action}`
          );
        }
      }
    } else {
      assert(resolved === null, `${testCase.name}: must return null for unregistered action ${testCase.resolveAction}`);
    }
  } else if (testCase.input) {
    // executeGuarded path
    const result = await reg.executeGuarded({ repositoryRoot: root }, testCase.input);
    assert(result.ok === testCase.expect.ok, `${testCase.name}: ok must be ${testCase.expect.ok}`);
    for (const issue of (testCase.expect.issues ?? [])) {
      assert(result.issues.includes(issue), `${testCase.name}: issues must include ${issue}`);
    }
    assert(
      result.issues.length === (testCase.expect.issues ?? []).length,
      `${testCase.name}: unexpected extra issues: ${JSON.stringify(result.issues)}`
    );
  }
}

// =================== resolve-missing-behavior.json ===================

const missingFixture = readJson('fixtures/behavior/resolve-missing-behavior.json');

for (const testCase of missingFixture.cases) {
  const reg = new BehaviorRegistry();
  // register nothing (or whatever the fixture asks for)

  if (testCase.resolveAction) {
    const resolved = reg.resolve(testCase.resolveAction);
    assert(resolved === null, `${testCase.name}: must return null for unregistered action`);
  } else if (testCase.input) {
    const result = await reg.executeGuarded({ repositoryRoot: root }, testCase.input);
    assert(result.ok === testCase.expect.ok, `${testCase.name}: ok must be ${testCase.expect.ok}`);
    for (const issue of (testCase.expect.issuesInclude ?? [])) {
      assert(result.issues.includes(issue), `${testCase.name}: issues must include ${issue}`);
    }
  }
}

// =================== evolve-delegation-blocked.json ===================

const evolveFixture = readJson('fixtures/behavior/evolve-delegation-blocked.json');

// Sanity check: fixture declares the correct delegation target
assert(
  evolveFixture.evolveDelegationTarget === EVOLVE_DELEGATION_TARGET,
  'evolve-delegation-blocked fixture evolveDelegationTarget must match EVOLVE_DELEGATION_TARGET'
);

for (const testCase of evolveFixture.cases) {
  const reg = new BehaviorRegistry();

  // Register a mock behavior that returns whatever mockOutput says
  reg.register({
    behaviorId: `mock-evolve-for-${testCase.name}`,
    actionCategories: [testCase.input.action],
    execute(_context, _input) {
      return testCase.mockOutput;
    }
  });

  const result = await reg.executeGuarded({ repositoryRoot: root }, testCase.input);
  assert(result.ok === testCase.expect.ok, `${testCase.name}: ok must be ${testCase.expect.ok}, got ${result.ok}`);
  for (const issue of (testCase.expect.issuesInclude ?? [])) {
    assert(result.issues.includes(issue), `${testCase.name}: issues must include "${issue}", got ${JSON.stringify(result.issues)}`);
  }
}

// =================== resolveOrThrow throws on missing ===================

{
  const emptyReg = new BehaviorRegistry();
  let threw = false;
  try {
    emptyReg.resolveOrThrow('behavior.split');
  } catch {
    threw = true;
  }
  assert(threw, 'resolveOrThrow must throw when no behavior is registered for action');
}

if (!process.exitCode) {
  const contractCases = mockFixture.cases.length;
  const missingCases = missingFixture.cases.length;
  const evolveCases = evolveFixture.cases.length;
  console.log(`[behavior-sdk:${mode}] ok (${contractCases} contract cases, ${missingCases} missing-behavior cases, ${evolveCases} evolve-delegation cases, 1 resolveOrThrow guard)`);
}
