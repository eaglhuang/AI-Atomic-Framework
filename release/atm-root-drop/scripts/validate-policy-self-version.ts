import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = readArg('--mode') ?? 'validate';
const policyPath = readArg('--policy') ?? 'docs/ai_atomic_framework/upstream-versioning-policy.md';
const failures: Array<{ code: string; message: string }> = [];

for (const file of [
  policyPath,
  '.github/workflows/auto-matrix-pr.yml',
  'scripts/generate-matrix-pr.ts',
  'scripts/validate-policy-self-version.ts',
  'tests/policy-version/policy-self-version.test.ts',
  'tests/policy-version/invalid-policy.md',
  'tests/policy-version/compatibility-matrix.fixture.json',
  'README.md',
  'CONTRIBUTING.md',
  'scripts/validators.config.json'
]) {
  assert(existsSync(resolveRootPath(file)), 'POLICY_SELF_VERSION_FILE_MISSING', `${file} must exist`);
}

if (existsSync(resolveRootPath(policyPath))) {
  const policy = readText(policyPath);
  const frontmatter = parseFrontmatter(policy);
  assert(frontmatter.policy_version === '0.1', 'POLICY_VERSION_VALUE_INVALID', 'policy_version must currently be 0.1');
  assert(isPolicySemver(frontmatter.policy_version), 'POLICY_VERSION_SEMVER_INVALID', `policy_version must be major.minor semver, got ${frontmatter.policy_version ?? '<missing>'}`);
  assert(frontmatter.framework_version_range === '>=0.1.0 <1.0.0', 'POLICY_FRAMEWORK_RANGE_VALUE_INVALID', 'framework_version_range must currently be >=0.1.0 <1.0.0');
  const packageVersion = JSON.parse(readText('package.json')).version;
  assert(rangeOverlapsFrameworkTrain(frontmatter.framework_version_range, packageVersion), 'POLICY_FRAMEWORK_RANGE_NO_OVERLAP', `framework_version_range ${frontmatter.framework_version_range} must overlap the active framework train for ${packageVersion}`);
  assert(/## 11\. Policy Self-Versioning/.test(policy), 'POLICY_SELF_VERSION_SECTION_MISSING', 'policy must document section 11 self-versioning');
}

if (existsSync(resolveRootPath('.github/workflows/auto-matrix-pr.yml'))) {
  const workflow = readText('.github/workflows/auto-matrix-pr.yml');
  assert(/generate-matrix-pr\.ts/.test(workflow), 'AUTO_MATRIX_WORKFLOW_SCRIPT_MISSING', 'auto-matrix workflow must run scripts/generate-matrix-pr.ts');
  assert(/peter-evans\/create-pull-request/.test(workflow), 'AUTO_MATRIX_WORKFLOW_PR_ACTION_MISSING', 'auto-matrix workflow must open a pull request');
  assert(/compatibility-matrix\.diff\.json/.test(workflow), 'AUTO_MATRIX_WORKFLOW_DIFF_ARTIFACT_MISSING', 'auto-matrix workflow must write a machine-readable matrix diff');
}

assert(/policy_version/.test(readText('README.md')), 'POLICY_README_FLOW_MISSING', 'README must describe policy_version update flow');
assert(/framework_version_range/.test(readText('CONTRIBUTING.md')), 'POLICY_CONTRIBUTING_FLOW_MISSING', 'CONTRIBUTING must describe framework_version_range update flow');

const validatorsConfig = JSON.parse(readText('scripts/validators.config.json'));
assert(validatorsConfig.profiles?.standard?.validators?.includes('validate-policy-self-version'), 'POLICY_STANDARD_PROFILE_MISSING', 'standard profile must include validate-policy-self-version');
const validatorEntry = validatorsConfig.validators?.find((entry: any) => entry?.name === 'validate-policy-self-version');
assert(validatorEntry?.entry === 'scripts/validate-policy-self-version.ts', 'POLICY_VALIDATOR_ENTRY_MISSING', 'validators.config.json must register scripts/validate-policy-self-version.ts');

if (!process.exitCode && mode !== 'test' && !readArg('--policy')) {
  const testResult = spawnSync(process.execPath, ['--strip-types', path.join(root, 'tests/policy-version/policy-self-version.test.ts')], {
    cwd: root,
    encoding: 'utf8'
  });
  if (testResult.status !== 0) {
    fail('POLICY_SELF_VERSION_TEST_FAILED', `tests/policy-version/policy-self-version.test.ts failed stdout=${JSON.stringify(testResult.stdout)} stderr=${JSON.stringify(testResult.stderr)}`);
  }
}

if (!process.exitCode) {
  console.log(`[policy-self-version:${mode}] ok — policy frontmatter, matrix PR workflow, docs flow, generator, and standard validator registration verified`);
}

function parseFrontmatter(input: string) {
  const match = input.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter: Record<string, string> = {};
  if (!match) return frontmatter;
  for (const line of match[1].split(/\r?\n/)) {
    const lineMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!lineMatch) continue;
    frontmatter[lineMatch[1]] = lineMatch[2].trim().replace(/^"|"$/g, '');
  }
  return frontmatter;
}

function isPolicySemver(value: unknown) {
  return typeof value === 'string' && /^\d+\.\d+$/.test(value);
}

function rangeOverlapsFrameworkTrain(range: unknown, packageVersion: string) {
  if (typeof range !== 'string') return false;
  const policyRange = parseSimpleRange(range);
  const current = parseSemver(packageVersion);
  if (!policyRange || !current) return false;
  const trainRange = {
    min: { major: current.major, minor: 0, patch: 0 },
    max: { major: current.major + 1, minor: 0, patch: 0 }
  };
  return compareSemver(policyRange.min, trainRange.max) < 0 && compareSemver(trainRange.min, policyRange.max) < 0;
}

function parseSimpleRange(value: string) {
  const minMatch = value.match(/>=\s*(\d+\.\d+\.\d+)/);
  const maxMatch = value.match(/<\s*(\d+\.\d+\.\d+)/);
  const min = minMatch ? parseSemver(minMatch[1]) : null;
  const max = maxMatch ? parseSemver(maxMatch[1]) : null;
  return min && max ? { min, max } : null;
}

function parseSemver(value: string) {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

function compareSemver(left: { major: number; minor: number; patch: number }, right: { major: number; minor: number; patch: number }) {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

function readText(relativePath: string) {
  return readFileSync(resolveRootPath(relativePath), 'utf8');
}

function resolveRootPath(relativePath: string) {
  return path.isAbsolute(relativePath) ? relativePath : path.join(root, relativePath);
}

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(code: string, message: string) {
  failures.push({ code, message });
  console.error(`[policy-self-version:${mode}] FAIL code=${code} message=${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, code: string, message: string) {
  if (!condition) fail(code, message);
}