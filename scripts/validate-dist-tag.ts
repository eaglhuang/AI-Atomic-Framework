import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = readArg('--mode') ?? 'validate';
const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

export type ReleaseTier = 'auto' | 'stable' | 'beta' | 'experimental' | 'lts';
export type NpmDistTag = 'latest' | 'next' | 'beta' | 'lts';

export interface DistTagPlan {
  readonly version: string;
  readonly tier: ReleaseTier;
  readonly prerelease: string | null;
  readonly distTag: NpmDistTag;
}

const failures: Array<{ code: string; message: string }> = [];

export function resolveNpmDistTag(version: string, tier: ReleaseTier = 'auto'): DistTagPlan {
  const parsed = parseVersion(version);
  if (!parsed) {
    throw new Error(`Invalid semver release version: ${version}`);
  }

  if (tier === 'stable') {
    if (parsed.prerelease) throw new Error(`stable tier cannot use prerelease version: ${version}`);
    return { version, tier, prerelease: null, distTag: 'latest' };
  }
  if (tier === 'beta') {
    if (parsed.prerelease !== 'beta') throw new Error(`beta tier requires x.y.z-beta.n version: ${version}`);
    return { version, tier, prerelease: parsed.prerelease, distTag: 'next' };
  }
  if (tier === 'experimental') {
    if (parsed.prerelease !== 'alpha') throw new Error(`experimental tier requires x.y.z-alpha.n version: ${version}`);
    return { version, tier, prerelease: parsed.prerelease, distTag: 'beta' };
  }
  if (tier === 'lts') {
    if (parsed.prerelease && parsed.prerelease !== 'lts') throw new Error(`lts tier cannot use ${parsed.prerelease} prerelease version: ${version}`);
    return { version, tier, prerelease: parsed.prerelease, distTag: 'lts' };
  }

  if (parsed.prerelease === 'alpha') return { version, tier, prerelease: 'alpha', distTag: 'beta' };
  if (parsed.prerelease === 'beta') return { version, tier, prerelease: 'beta', distTag: 'next' };
  if (parsed.prerelease === 'lts') return { version, tier, prerelease: 'lts', distTag: 'lts' };
  if (parsed.prerelease) throw new Error(`Unsupported prerelease segment: ${parsed.prerelease}`);
  return { version, tier, prerelease: null, distTag: 'latest' };
}

if (isDirectRun) {
  if (mode === 'resolve') {
    const version = readArg('--version') ?? '0.0.0-beta.0';
    const tier = parseTier(readArg('--tier') ?? 'auto');
    const plan = resolveNpmDistTag(version, tier);
    const githubEnv = readArg('--github-env');
    if (githubEnv) {
      writeFileSync(githubEnv, `NPM_DIST_TAG=${plan.distTag}\n`, { encoding: 'utf8', flag: 'a' });
    }
    console.log(JSON.stringify(plan, null, 2));
    process.exit(0);
  }

  validateDistTagPolicy();

  if (!process.exitCode) {
    console.log(`[dist-tag:${mode}] ok — dist-tag policy, release workflow, create-atm tag selection, and fixtures verified`);
  }
}

function validateDistTagPolicy() {
  for (const file of [
    'docs/DIST_TAGS.md',
    '.github/workflows/release-npm.yml',
    'packages/create-atm/src/index.ts',
    'packages/cli/src/commands/welcome.ts',
    'scripts/validate-dist-tag.ts',
    'tests/dist-tag/dist-tag-policy.test.ts',
    'scripts/validators.config.json'
  ]) {
    assert(existsSync(path.join(root, file)), 'DIST_TAG_FILE_MISSING', `${file} must exist`);
  }

  validateMappingFixtures();
  validateDocs(readText('docs/DIST_TAGS.md'));
  validateWorkflow(readText('.github/workflows/release-npm.yml'));
  validateCreateAtm(readText('packages/create-atm/src/index.ts'));
  validateWelcome(readText('packages/cli/src/commands/welcome.ts'));
  validateStandardProfile(JSON.parse(readText('scripts/validators.config.json')));

  if (!process.exitCode) {
    const testResult = spawnSync(process.execPath, ['--strip-types', path.join(root, 'tests', 'dist-tag', 'dist-tag-policy.test.ts')], {
      cwd: root,
      encoding: 'utf8'
    });
    if (testResult.status !== 0) {
      fail('DIST_TAG_TEST_FAILED', `tests/dist-tag/dist-tag-policy.test.ts failed stdout=${JSON.stringify(testResult.stdout)} stderr=${JSON.stringify(testResult.stderr)}`);
    }
  }
}

function validateMappingFixtures() {
  const cases: Array<[string, ReleaseTier, NpmDistTag]> = [
    ['1.2.3', 'auto', 'latest'],
    ['1.2.3-beta.0', 'auto', 'next'],
    ['1.2.3-alpha.0', 'auto', 'beta'],
    ['1.2.3', 'lts', 'lts'],
    ['1.2.3-lts.0', 'auto', 'lts']
  ];
  for (const [version, tier, expected] of cases) {
    const actual = resolveNpmDistTag(version, tier).distTag;
    assert(actual === expected, 'DIST_TAG_MAPPING_INVALID', `${version} tier=${tier} expected ${expected}, got ${actual}`);
  }
  assert(resolveNpmDistTag('1.2.3-beta.0', 'auto').distTag !== 'latest', 'DIST_TAG_BETA_LATEST_BLOCK_MISSING', 'beta prerelease must not resolve to latest');
}

function validateDocs(input: string) {
  for (const tag of ['`latest`', '`next`', '`beta`', '`lts`']) {
    assert(input.includes(tag), 'DIST_TAG_DOC_ROW_MISSING', `docs/DIST_TAGS.md must document ${tag}`);
  }
  assert(/create-atm[\s\S]*--tag next/.test(input), 'DIST_TAG_DOC_CREATE_ATM_MISSING', 'docs/DIST_TAGS.md must document create-atm --tag next');
}

function validateWorkflow(input: string) {
  assert(/release_version:/.test(input), 'DIST_TAG_WORKFLOW_VERSION_INPUT_MISSING', 'release workflow must expose release_version dry-run input');
  assert(/release_tier:/.test(input), 'DIST_TAG_WORKFLOW_TIER_INPUT_MISSING', 'release workflow must expose release_tier input');
  assert(/validate-dist-tag\.ts --mode resolve/.test(input), 'DIST_TAG_WORKFLOW_RESOLVE_MISSING', 'release workflow must resolve NPM_DIST_TAG with validate-dist-tag.ts');
  assert(/--tag "\$NPM_DIST_TAG"/.test(input), 'DIST_TAG_WORKFLOW_PUBLISH_TAG_MISSING', 'npm publish commands must pass --tag "$NPM_DIST_TAG"');
  assert(/alpha\|beta\|lts/.test(input), 'DIST_TAG_WORKFLOW_REGEX_MISSING', 'release tag regex must allow alpha, beta, and lts prerelease segments');
}

function validateCreateAtm(input: string) {
  assert(/--tag/.test(input), 'DIST_TAG_CREATE_ATM_TAG_OPTION_MISSING', 'create-atm must parse --tag');
  assert(/requestedTag/.test(input) && /expectedCliPrerelease/.test(input), 'DIST_TAG_CREATE_ATM_EVIDENCE_MISSING', 'create-atm evidence must include requested tag and expected prerelease');
  assert(/dist-tag\.json/.test(input), 'DIST_TAG_CREATE_ATM_RECORD_MISSING', 'create-atm must persist .atm/runtime/dist-tag.json');
}

function validateWelcome(input: string) {
  assert(/readDistTagSelection/.test(input), 'DIST_TAG_WELCOME_MISSING', 'welcome must read dist-tag selection');
  assert(/distTag/.test(input), 'DIST_TAG_WELCOME_EVIDENCE_MISSING', 'welcome evidence must include distTag');
}

function validateStandardProfile(input: any) {
  assert(input.profiles?.standard?.validators?.includes('validate-dist-tag'), 'DIST_TAG_STANDARD_PROFILE_MISSING', 'standard profile must include validate-dist-tag');
  const validator = input.validators?.find((entry: any) => entry?.name === 'validate-dist-tag');
  assert(validator?.entry === 'scripts/validate-dist-tag.ts', 'DIST_TAG_VALIDATOR_ENTRY_MISSING', 'validators.config.json must register scripts/validate-dist-tag.ts');
}

function parseVersion(version: string) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/);
  return match ? { prerelease: match[4] ?? null } : null;
}

function parseTier(value: string): ReleaseTier {
  if (value === 'auto' || value === 'stable' || value === 'beta' || value === 'experimental' || value === 'lts') {
    return value;
  }
  throw new Error(`Unsupported release tier: ${value}`);
}

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function readText(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(code: string, message: string) {
  failures.push({ code, message });
  console.error(`[dist-tag:${mode}] FAIL code=${code} message=${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, code: string, message: string) {
  if (!condition) fail(code, message);
}
