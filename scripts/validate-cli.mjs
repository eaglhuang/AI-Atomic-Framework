import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/cli-fixtures/cli-mvp.fixture.json');

function fail(message) {
  console.error(`[cli:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function runAtm(args, cwd = root) {
  const result = spawnSync(process.execPath, [path.join(root, fixture.entrypoint), ...args], {
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
    stdout: result.stdout,
    stderr: result.stderr,
    parsed
  };
}

function assertReadable(result, commandName) {
  for (const field of fixture.agentReadableFields) {
    assert(Object.hasOwn(result.parsed, field), `${commandName} output missing field: ${field}`);
  }
  assert(Array.isArray(result.parsed.messages), `${commandName} messages must be an array`);
  assert(result.parsed.evidence && typeof result.parsed.evidence === 'object', `${commandName} evidence must be an object`);
}

function assertMessageCode(result, code) {
  assert(result.parsed.messages.some((entry) => entry.code === code), `expected message code ${code}`);
}

for (const relativePath of [fixture.entrypoint, 'packages/cli/src/commands/bootstrap-entry.mjs', 'packages/cli/src/commands/init.mjs', 'packages/cli/src/commands/spec.mjs', 'packages/cli/src/commands/status.mjs', 'packages/cli/src/commands/validate.mjs', fixture.validAtomicSpec]) {
  assert(existsSync(path.join(root, relativePath)), `missing CLI fixture dependency: ${relativePath}`);
}

const cliIndex = readFileSync(path.join(root, 'packages/cli/src/index.ts'), 'utf8');
for (const commandName of fixture.commands) {
  assert(cliIndex.includes(`commandName: '${commandName}'`), `index.ts missing command descriptor: ${commandName}`);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-cli-'));
try {
  const blankRepo = path.join(tempRoot, 'blank-repo');
  mkdirSync(blankRepo, { recursive: true });

  const missingStatus = runAtm(['status'], blankRepo);
  assert(missingStatus.exitCode === 1, 'status before init must exit 1');
  assertReadable(missingStatus, 'status');
  assert(missingStatus.parsed.ok === false, 'status before init must report ok=false');
  assertMessageCode(missingStatus, 'ATM_CONFIG_MISSING');

  const init = runAtm(['init'], blankRepo);
  assert(init.exitCode === 0, 'init must exit 0 in blank repo');
  assertReadable(init, 'init');
  assert(init.parsed.ok === true, 'init must report ok=true');
  assert(init.parsed.evidence.adapterMode === 'standalone', 'init must report standalone mode');
  assert(init.parsed.evidence.adapterImplemented === false, 'init must not require adapter implementation');
  assert(existsSync(path.join(blankRepo, fixture.configPath)), 'init must create config file');

  const status = runAtm(['status'], blankRepo);
  assert(status.exitCode === 0, 'status after init must exit 0');
  assertReadable(status, 'status');
  assert(status.parsed.ok === true, 'status after init must report ok=true');
  assert(status.parsed.evidence.standaloneMode === true, 'status must report standaloneMode=true');

  const validateRepo = runAtm(['validate'], blankRepo);
  assert(validateRepo.exitCode === 0, 'validate after init must exit 0');
  assertReadable(validateRepo, 'validate');
  assert(validateRepo.parsed.ok === true, 'validate after init must report ok=true');
  assertMessageCode(validateRepo, 'ATM_VALIDATE_REPOSITORY_OK');

  const validSpecPath = path.join(root, fixture.validAtomicSpec);
  const validateSpec = runAtm(['validate', '--spec', validSpecPath], blankRepo);
  assert(validateSpec.exitCode === 0, 'validate --spec valid fixture must exit 0');
  assertReadable(validateSpec, 'validate');
  assert(validateSpec.parsed.ok === true, 'validate --spec valid fixture must report ok=true');
  assertMessageCode(validateSpec, 'ATM_VALIDATE_SPEC_OK');

  const specValidate = runAtm(['spec', '--validate', validSpecPath], blankRepo);
  assert(specValidate.exitCode === 0, 'spec --validate valid fixture must exit 0');
  assertReadable(specValidate, 'spec');
  assert(specValidate.parsed.ok === true, 'spec --validate valid fixture must report ok=true');
  assertMessageCode(specValidate, 'ATM_SPEC_VALIDATE_OK');

  const invalidSpecPath = path.join(blankRepo, 'invalid.atom.json');
  writeFileSync(invalidSpecPath, JSON.stringify({ schemaId: 'atm.atomicSpec', specVersion: '0.1.0' }, null, 2), 'utf8');
  const validateInvalidSpec = runAtm(['validate', '--spec', invalidSpecPath], blankRepo);
  assert(validateInvalidSpec.exitCode === 1, 'validate --spec invalid fixture must exit 1');
  assertReadable(validateInvalidSpec, 'validate');
  assert(validateInvalidSpec.parsed.ok === false, 'validate --spec invalid fixture must report ok=false');
  assertMessageCode(validateInvalidSpec, 'ATM_SPEC_REQUIRED_FIELD');

  const specValidateInvalid = runAtm(['spec', '--validate', invalidSpecPath], blankRepo);
  assert(specValidateInvalid.exitCode === 1, 'spec --validate invalid fixture must exit 1');
  assertReadable(specValidateInvalid, 'spec');
  assert(specValidateInvalid.parsed.ok === false, 'spec --validate invalid fixture must report ok=false');
  assertMessageCode(specValidateInvalid, 'ATM_SPEC_REQUIRED_FIELD');

  const validateMissingSpec = runAtm(['validate', '--spec', path.join(blankRepo, 'missing.atom.json')], blankRepo);
  assert(validateMissingSpec.exitCode === 1, 'validate --spec missing fixture must exit 1');
  assertReadable(validateMissingSpec, 'validate');
  assert(validateMissingSpec.parsed.ok === false, 'validate --spec missing fixture must report ok=false');
  assertMessageCode(validateMissingSpec, 'ATM_SPEC_NOT_FOUND');

  const specValidateMissing = runAtm(['spec', '--validate', path.join(blankRepo, 'missing.atom.json')], blankRepo);
  assert(specValidateMissing.exitCode === 1, 'spec --validate missing fixture must exit 1');
  assertReadable(specValidateMissing, 'spec');
  assert(specValidateMissing.parsed.ok === false, 'spec --validate missing fixture must report ok=false');
  assertMessageCode(specValidateMissing, 'ATM_SPEC_NOT_FOUND');

  const bootstrapRepo = path.join(tempRoot, 'bootstrap-repo');
  mkdirSync(bootstrapRepo, { recursive: true });
  const bootstrap = runAtm(['bootstrap', '--cwd', bootstrapRepo, '--task', 'Bootstrap ATM self-hosting alpha'], bootstrapRepo);
  assert(bootstrap.exitCode === 0, 'bootstrap must exit 0 in blank repo');
  assertReadable(bootstrap, 'bootstrap');
  assert(bootstrap.parsed.ok === true, 'bootstrap must report ok=true');
  assert(bootstrap.parsed.evidence.adoptedProfile === 'default', 'bootstrap must adopt default profile');
  assert(existsSync(path.join(bootstrapRepo, 'AGENTS.md')), 'bootstrap must create AGENTS.md');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[cli:${mode}] ok (${fixture.commands.length} commands, standalone fixture verified)`);
}