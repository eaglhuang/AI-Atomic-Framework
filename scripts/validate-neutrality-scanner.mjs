import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseAtomicSpecFile } from '../packages/core/src/spec/parse-spec.mjs';
import { defaultNeutralityPolicyRelativePath, loadNeutralityPolicy, scanNeutralityRepository } from '../packages/plugin-rule-guard/src/neutrality-scanner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/neutrality.fixture.json');

function fail(message) {
  console.error(`[neutrality:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function runAtm(args, cwd = root) {
  const result = spawnSync(process.execPath, [path.join(root, 'packages/cli/src/atm.mjs'), ...args], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    fail(`CLI output is not valid JSON for args ${args.join(' ')}: ${payload || error.message}`);
    parsed = {};
  }
  return {
    exitCode: result.status ?? 0,
    parsed
  };
}

for (const relativePath of fixture.requiredFiles) {
  check(existsSync(path.join(root, relativePath)), `missing neutrality file: ${relativePath}`);
}

const policy = loadNeutralityPolicy({ repositoryRoot: root, policyPath: defaultNeutralityPolicyRelativePath });
check(policy.bannedTerms.includes('eaglhuang/3KLife'), 'neutrality policy must include the repository reference ban');
check(policy.bannedPathPatterns.includes('<non-ascii-filename>'), 'neutrality policy must include the non-ascii filename rule');

const parsedSpec = parseAtomicSpecFile('specs/neutrality-scanner.atom.json', { cwd: root });
check(parsedSpec.ok === true, 'neutrality atom spec must parse successfully');
if (parsedSpec.ok) {
  check(parsedSpec.normalizedModel.identity.atomId === 'atom.plugin-rule-guard.neutrality-scanner', 'neutrality atom spec must preserve the canonical atom id');
}

const workflow = readText('.github/workflows/neutrality.yml');
check(workflow.includes('verify --neutrality'), 'neutrality workflow must invoke verify --neutrality');
check(workflow.includes('pull_request'), 'neutrality workflow must run on pull requests');
check(workflow.includes('push'), 'neutrality workflow must run on push');

const registryDocument = readJson('atomic-registry.json');
const registryEntry = registryDocument.entries.find((entry) => entry.atomId === 'atom.plugin-rule-guard.neutrality-scanner');
check(Boolean(registryEntry), 'atomic-registry.json must contain the neutrality scanner entry');
if (registryEntry) {
  check(registryEntry.selfVerification?.legacyPlanningId === 'ATM-CORE-0003', 'registry entry must preserve legacyPlanningId=ATM-CORE-0003');
  check(registryEntry.location?.workbenchPath === 'atomic_workbench/atoms/atom.plugin-rule-guard.neutrality-scanner', 'registry entry must use the canonical workbench folder');
  check(registryEntry.location?.reportPath === 'atomic_workbench/atoms/atom.plugin-rule-guard.neutrality-scanner/atom.test.report.json', 'registry entry must point to the canonical neutrality report path');
  check(registryEntry.evidence?.includes('.github/workflows/neutrality.yml'), 'registry entry evidence must include the neutrality workflow');
}

for (const fixtureCase of fixture.cases) {
  const report = scanNeutralityRepository({
    repositoryRoot: path.join(root, fixtureCase.rootDir),
    policy
  });
  check(report.exitCode === fixtureCase.expectedExitCode, `${fixtureCase.name} exit code mismatch`);
  check(report.ok === fixtureCase.expectedOk, `${fixtureCase.name} ok mismatch`);
  for (const expectedType of fixtureCase.expectedViolationKinds || []) {
    check(report.violations.some((violation) => violation.kind === expectedType), `${fixtureCase.name} missing violation kind ${expectedType}`);
  }
}

const verifyNeutrality = runAtm(['verify', '--neutrality', '--cwd', root], root);
check(verifyNeutrality.exitCode === 0, 'verify --neutrality must exit 0 in the framework repository root');
check(verifyNeutrality.parsed.ok === true, 'verify --neutrality must report ok=true in the framework repository root');
check(verifyNeutrality.parsed.messages.some((entry) => entry.code === 'ATM_VERIFY_NEUTRALITY_OK'), 'verify --neutrality must emit ATM_VERIFY_NEUTRALITY_OK');

if (!process.exitCode) {
  console.log(`[neutrality:${mode}] ok (${fixture.acceptance.length} acceptance checks)`);
}