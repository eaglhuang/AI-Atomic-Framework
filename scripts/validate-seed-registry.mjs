import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { computeSeedRegistrySnapshot, evaluateSeedSelfVerification, validateRegistryDocumentAgainstSchema } from '../packages/cli/src/commands/registry-shared.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const registryPath = path.join(root, 'atomic-registry.json');
const changelogPath = path.join(root, 'CHANGELOG.md');
const seedSourcePath = path.join(root, 'packages/core/seed.js');

function fail(message) {
  console.error(`[seed-registry:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runAtm(args) {
  const result = spawnSync(process.execPath, [path.join(root, 'packages/cli/src/atm.mjs'), ...args], {
    cwd: root,
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

assert(existsSync(registryPath), 'atomic-registry.json must exist');
const schemaResult = validateRegistryDocumentAgainstSchema(root, registryPath, {
  commandName: 'validate-seed-registry',
  successCode: 'ATM_SEED_REGISTRY_SCHEMA_OK',
  successText: 'Seed registry validated against JSON Schema.'
});
assert(schemaResult.ok === true, 'atomic-registry.json must pass registry schema validation');

const verification = evaluateSeedSelfVerification();
assert(verification.ok === true, 'seed self-verification hashes must match committed registry values');
assert(verification.entry.status === 'active', 'seed registry entry must be marked active');
assert(verification.entry.governance?.tier === 'governed', 'seed registry entry governance tier must be governed');
assert(verification.report.legacyPlanningId.ok === true, 'legacy planning ID must stay ATM-CORE-0001');
assert(verification.report.specHash.ok === true, 'specHash must match');
assert(verification.report.codeHash.ok === true, 'codeHash must match');
assert(verification.report.testHash.ok === true, 'testHash must match');

const seedSource = readFileSync(seedSourcePath, 'utf8');
assert(seedSource.includes('@deprecated since ATM-CORE-0002 governs this'), 'seed.js must mark the hand-written seed source as deprecated under ATM-CORE-0002');

assert(existsSync(changelogPath), 'CHANGELOG.md must exist');
const changelog = readFileSync(changelogPath, 'utf8');
assert(changelog.includes('Phase B1 complete'), 'CHANGELOG.md must record the Phase B1 completion milestone');
assert(changelog.includes('ATM-CORE-0002'), 'CHANGELOG.md must mention ATM-CORE-0002 as the governance successor');

const cliVerify = runAtm(['verify', '--self']);
assert(cliVerify.exitCode === 0, 'atm verify --self must exit 0');
assert(cliVerify.parsed.ok === true, 'atm verify --self must report ok=true');

const cliStatus = runAtm(['status']);
assert(cliStatus.exitCode === 0, 'atm status must exit 0 in framework repository root');
assert(cliStatus.parsed.ok === true, 'atm status must report ok=true in framework repository root');
assert(cliStatus.parsed.evidence.frameworkPhase === 'B1-complete', 'atm status must surface frameworkPhase=B1-complete');
assert(cliStatus.parsed.evidence.atomStatus === 'active', 'atm status must surface atomStatus=active');
assert(cliStatus.parsed.evidence.governanceTier === 'governed', 'atm status must surface governanceTier=governed');
assert(cliStatus.parsed.evidence.governedByLegacyPlanningId === 'ATM-CORE-0002', 'atm status must surface ATM-CORE-0002 as governance successor');

const expected = computeSeedRegistrySnapshot();
assert(verification.entry.selfVerification.specHash === expected.entry.selfVerification.specHash, 'registry specHash must equal computed specHash');
assert(verification.entry.selfVerification.codeHash === expected.entry.selfVerification.codeHash, 'registry codeHash must equal computed codeHash');
assert(verification.entry.selfVerification.testHash === expected.entry.selfVerification.testHash, 'registry testHash must equal computed testHash');

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-seed-drift-'));
try {
  const driftFile = path.join(tempRoot, 'seed-drift.js');
  copyFileSync(path.join(root, 'packages/core/seed.js'), driftFile);
  const original = readFileSync(driftFile, 'utf8');
  writeFileSync(driftFile, `${original}\n// drift probe\n`, 'utf8');

  const driftHash = computeFileHash(driftFile);
  assert(driftHash !== verification.entry.selfVerification.codeHash, 'editing seed.js must change codeHash');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log('[seed-registry:' + mode + '] ok (atomic-registry, governed status, status command, self verification, and drift detection verified)');
}

function computeFileHash(filePath) {
  return `sha256:${createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}