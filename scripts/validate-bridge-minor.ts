import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = readArg('--mode') ?? 'validate';

function fail(code: string, message: string) {
  console.error(`[bridge-minor:${mode}] FAIL code=${code} message=${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, code: string, message: string) {
  if (!condition) fail(code, message);
}

function readText(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function readJson(relativePath: string) {
  return JSON.parse(readText(relativePath));
}

const requiredFiles = [
  'docs/BRIDGE_MINOR.md',
  'docs/EXPERIMENTAL_API.md',
  'packages/agent-pack-sdk/src/experimental/index.ts',
  'packages/agent-pack-sdk/src/index.ts',
  'packages/cli/src/commands/upgrade.ts',
  'packages/cli/src/commands/welcome.ts',
  '.github/workflows/release-npm.yml',
  'scripts/validate-bridge-minor.ts',
  'tests/bridge-minor/major-without-bridge.json',
  'tests/bridge-minor/major-with-bridge.json',
  'tests/bridge-minor/bridge-minor.test.ts',
  'scripts/validators.config.json'
];

for (const file of requiredFiles) {
  assert(existsSync(path.join(root, file)), 'BRIDGE_MINOR_FILE_MISSING', `${file} must exist`);
}

const bridgeDocs = readText('docs/BRIDGE_MINOR.md');
assert(/mandatory/i.test(bridgeDocs) && /bridge minor/i.test(bridgeDocs), 'BRIDGE_MINOR_DOC_POLICY_MISSING', 'docs/BRIDGE_MINOR.md must declare mandatory bridge minor policy');
assert(/readsOldSchema/.test(bridgeDocs) && /writesNewSchema/.test(bridgeDocs), 'BRIDGE_MINOR_DOC_FIELDS_MISSING', 'docs/BRIDGE_MINOR.md must document readsOldSchema and writesNewSchema');

const experimentalDocs = readText('docs/EXPERIMENTAL_API.md');
assert(/--allow-experimental/.test(experimentalDocs), 'EXPERIMENTAL_API_DOC_FLAG_MISSING', 'docs/EXPERIMENTAL_API.md must document --allow-experimental');
assert(/agent-pack-preview/.test(experimentalDocs), 'EXPERIMENTAL_API_DOC_LIST_MISSING', 'docs/EXPERIMENTAL_API.md must list agent-pack-preview');

const sdkExperimental = readText('packages/agent-pack-sdk/src/experimental/index.ts');
assert(/@experimental/.test(sdkExperimental), 'EXPERIMENTAL_API_MARKER_MISSING', 'experimental SDK exports must carry @experimental markers');
assert(/ATM_EXPERIMENTAL_API_REQUIRES_OPT_IN/.test(sdkExperimental), 'EXPERIMENTAL_API_OPT_IN_ERROR_MISSING', 'experimental SDK must expose opt-in denial');
assert(/invokeExperimentalApi/.test(readText('packages/agent-pack-sdk/src/index.ts')), 'EXPERIMENTAL_API_SDK_EXPORT_MISSING', 'agent-pack-sdk index must export experimental API surface');

const upgradeSource = readText('packages/cli/src/commands/upgrade.ts');
assert(/--allow-experimental/.test(upgradeSource), 'EXPERIMENTAL_API_CLI_FLAG_MISSING', 'upgrade command must parse --allow-experimental');
assert(/invokeExperimentalApi/.test(upgradeSource), 'EXPERIMENTAL_API_CLI_INVOKE_MISSING', 'upgrade command must route through experimental SDK helper');

const welcomeSource = readText('packages/cli/src/commands/welcome.ts');
assert(/ATM_EXPERIMENTAL_API_NOTICE/.test(welcomeSource), 'EXPERIMENTAL_API_WELCOME_NOTICE_MISSING', 'welcome must display experimental channel notice');
assert(/listExperimentalApis/.test(welcomeSource), 'EXPERIMENTAL_API_WELCOME_LIST_MISSING', 'welcome evidence must list experimental APIs');

const workflow = readText('.github/workflows/release-npm.yml');
assert(/validate-bridge-minor\.ts --mode validate/.test(workflow), 'BRIDGE_MINOR_WORKFLOW_GATE_MISSING', 'release workflow must run validate-bridge-minor.ts before publish');
assert(workflow.indexOf('Validate bridge minor policy') < workflow.indexOf('Compute gate standard'), 'BRIDGE_MINOR_WORKFLOW_ORDER_INVALID', 'bridge minor gate must run before validate:standard');

const withoutBridge = evaluateBridgeFixture(readJson('tests/bridge-minor/major-without-bridge.json'));
assert(withoutBridge.ok === false && withoutBridge.code === 'BRIDGE_MINOR_REQUIRED', 'BRIDGE_MINOR_MISSING_FIXTURE_NOT_BLOCKED', 'major bump without bridge minor must be blocked');
const withBridge = evaluateBridgeFixture(readJson('tests/bridge-minor/major-with-bridge.json'));
assert(withBridge.ok === true, 'BRIDGE_MINOR_VALID_FIXTURE_BLOCKED', `major bump with bridge minor must pass, got ${withBridge.code}`);

const denied = runAtm(['upgrade', 'experimental-api', '--api', 'agent-pack-preview', '--json']);
assert(denied.exitCode === 2, 'EXPERIMENTAL_API_DEFAULT_NOT_DENIED', `experimental API without flag must exit 2, got ${denied.exitCode}`);
assert(denied.parsed?.messages?.[0]?.code === 'ATM_EXPERIMENTAL_API_REQUIRES_OPT_IN', 'EXPERIMENTAL_API_DEFAULT_DENIAL_CODE_MISSING', 'experimental API denial must be machine-readable');
const allowed = runAtm(['upgrade', 'experimental-api', '--api', 'agent-pack-preview', '--allow-experimental', '--json']);
assert(allowed.exitCode === 0, 'EXPERIMENTAL_API_ALLOW_FLAG_FAILED', `experimental API with flag must exit 0, got ${allowed.exitCode}`);
assert(allowed.parsed?.evidence?.experimental?.accepted === true, 'EXPERIMENTAL_API_ALLOW_EVIDENCE_MISSING', 'experimental API allowed call must report accepted=true');

const validatorsConfig = readJson('scripts/validators.config.json');
assert(validatorsConfig.profiles?.standard?.validators?.includes('validate-bridge-minor'), 'BRIDGE_MINOR_STANDARD_PROFILE_MISSING', 'standard profile must include validate-bridge-minor');
const validatorEntry = validatorsConfig.validators?.find((entry: any) => entry?.name === 'validate-bridge-minor');
assert(validatorEntry?.entry === 'scripts/validate-bridge-minor.ts', 'BRIDGE_MINOR_VALIDATOR_ENTRY_MISSING', 'validators.config.json must register scripts/validate-bridge-minor.ts');

if (!process.exitCode && mode !== 'test') {
  const testResult = spawnSync(process.execPath, ['--experimental-strip-types', path.join(root, 'tests/bridge-minor/bridge-minor.test.ts')], {
    cwd: root,
    encoding: 'utf8'
  });
  if (testResult.status !== 0) {
    fail('BRIDGE_MINOR_TEST_FAILED', `tests/bridge-minor/bridge-minor.test.ts failed stdout=${JSON.stringify(testResult.stdout)} stderr=${JSON.stringify(testResult.stderr)}`);
  }
}

if (!process.exitCode) {
  console.log(`[bridge-minor:${mode}] ok — bridge minor release gate, experimental SDK opt-in, CLI denial, welcome notice, and standard validator registration verified`);
}

function evaluateBridgeFixture(fixture: any) {
  const from = parseSemver(fixture.fromVersion);
  const to = parseSemver(fixture.toVersion);
  if (!from || !to) return { ok: false, code: 'BRIDGE_MINOR_INVALID_VERSION' };
  if (to.major <= from.major) return { ok: true, code: 'BRIDGE_MINOR_NOT_REQUIRED' };
  const previousMinor = fixture.previousMinor ?? {};
  const hasBridge = previousMinor.bridgeRelease === true
    && previousMinor.readsOldSchema === true
    && previousMinor.writesNewSchema === true
    && previousMinor.futureRemovalListed === true;
  return hasBridge
    ? { ok: true, code: 'BRIDGE_MINOR_READY' }
    : { ok: false, code: 'BRIDGE_MINOR_REQUIRED' };
}

function parseSemver(value: string) {
  const match = String(value ?? '').match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

function runAtm(args: readonly string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const output = (result.stdout || result.stderr || '').trim();
  let parsed: any = null;
  try {
    parsed = JSON.parse(output);
  } catch {
    parsed = null;
  }
  return {
    exitCode: result.status ?? 1,
    parsed,
    output
  };
}

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}
