import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = readArg('--mode') ?? 'validate';
const fixturePath = readArg('--fixture');
const failures: Array<{ code: string; message: string }> = [];

const tierPolicy: Record<string, { days: number; minorLag: number }> = {
  alpha: { days: 30, minorLag: 1 },
  beta: { days: 90, minorLag: 2 },
  stable: { days: 180, minorLag: 3 },
  lts: { days: 365, minorLag: 4 }
};

if (mode === 'reminders') {
  const reminders = buildReminderPayload(readDeprecationMarkdown());
  const githubOutput = readArg('--github-output');
  if (githubOutput) {
    writeGitHubOutput(githubOutput, {
      has_reminders: String(reminders.hasReminders),
      issue_title: reminders.issueTitle,
      issue_body: reminders.issueBody
    });
  }
  console.log(JSON.stringify(reminders, null, 2));
  process.exit(0);
}

for (const file of [
  'docs/DEPRECATIONS.md',
  'docs/ai_atomic_framework/upstream-versioning-policy.md',
  'packages/cli/src/commands/upgrade.ts',
  '.github/workflows/release-npm.yml',
  'scripts/validate-deprecation-policy.ts',
  'tests/deprecation/deprecation-policy.test.ts',
  'tests/deprecation/valid-deprecations.json',
  'tests/deprecation/time-not-ready.json',
  'scripts/validators.config.json'
]) {
  assert(existsSync(resolveRootPath(file)), 'DEPRECATION_FILE_MISSING', `${file} must exist`);
}

const source = fixturePath ? readJson(fixturePath) : markdownToFixture(readDeprecationMarkdown());
const result = evaluateDeprecationPolicy(source);
for (const failure of result.failures) {
  fail(failure.code, failure.message);
}

const policy = readText('docs/ai_atomic_framework/upstream-versioning-policy.md');
assert(/alpha \| 30 days \| 1 minor/.test(policy), 'DEPRECATION_POLICY_ALPHA_GATE_MISSING', 'policy must document alpha 30d + 1 minor gate');
assert(/beta \| 90 days \| 2 minors/.test(policy), 'DEPRECATION_POLICY_BETA_GATE_MISSING', 'policy must document beta 90d + 2 minors gate');
assert(/stable \| 180 days \| 3 minors/.test(policy), 'DEPRECATION_POLICY_STABLE_GATE_MISSING', 'policy must document stable 180d + 3 minors gate');
assert(/lts \| 365 days \| 4 minors/.test(policy), 'DEPRECATION_POLICY_LTS_GATE_MISSING', 'policy must document lts 365d + 4 minors gate');
assert(/--canary <percent>/.test(policy), 'DEPRECATION_POLICY_CANARY_MISSING', 'policy must document upgrade apply --canary <percent>');

const upgradeSource = [
  readText('packages/cli/src/commands/upgrade.ts'),
  readText('packages/cli/src/commands/upgrade/safe-upgrade.ts')
].join('\n');
assert(/--canary/.test(upgradeSource), 'DEPRECATION_CANARY_CLI_FLAG_MISSING', 'upgrade command must parse --canary');
assert(/atm\.safeUpgradeCanaryState/.test(upgradeSource), 'DEPRECATION_CANARY_STATE_MISSING', 'upgrade apply must write canary state');

const workflow = readText('.github/workflows/release-npm.yml');
assert(/validate-deprecation-policy\.ts --mode reminders/.test(workflow), 'DEPRECATION_REMINDER_WORKFLOW_MISSING', 'release workflow must prepare deprecation reminders');
assert(/github\.rest\.issues\.create/.test(workflow), 'DEPRECATION_REMINDER_ISSUE_MISSING', 'release workflow must open reminder issues');

const validatorsConfig = JSON.parse(readText('scripts/validators.config.json'));
assert(validatorsConfig.profiles?.standard?.validators?.includes('validate-deprecation-policy'), 'DEPRECATION_STANDARD_PROFILE_MISSING', 'standard profile must include validate-deprecation-policy');
const validatorEntry = validatorsConfig.validators?.find((entry: any) => entry?.name === 'validate-deprecation-policy');
assert(validatorEntry?.entry === 'scripts/validate-deprecation-policy.ts', 'DEPRECATION_VALIDATOR_ENTRY_MISSING', 'validators.config.json must register scripts/validate-deprecation-policy.ts');

if (!process.exitCode && mode !== 'test' && !fixturePath) {
  const testResult = spawnSync(process.execPath, ['--strip-types', path.join(root, 'tests/deprecation/deprecation-policy.test.ts')], {
    cwd: root,
    encoding: 'utf8'
  });
  if (testResult.status !== 0) {
    fail('DEPRECATION_TEST_FAILED', `tests/deprecation/deprecation-policy.test.ts failed stdout=${JSON.stringify(testResult.stdout)} stderr=${JSON.stringify(testResult.stderr)}`);
  }
}

if (!process.exitCode) {
  console.log(`[deprecation-policy:${mode}] ok — time+minor gates, canary upgrade state, reminder workflow, and standard validator registration verified`);
}

export function evaluateDeprecationPolicy(input: any) {
  const asOf = parseDate(input.asOf ?? new Date().toISOString().slice(0, 10));
  const failures: Array<{ code: string; message: string }> = [];
  for (const entry of input.entries ?? []) {
    if (entry.surface === 'None') continue;
    const tier = tierPolicy[String(entry.tier ?? '')];
    if (!tier) {
      failures.push({ code: 'DEPRECATION_TIER_INVALID', message: `${entry.surface}: unsupported tier ${entry.tier}` });
      continue;
    }
    const deprecatedAt = parseDate(entry.deprecatedAt);
    const deprecatedIn = parseSemver(entry.deprecatedIn);
    const removalTarget = parseSemver(entry.removalTarget);
    if (!deprecatedAt || !deprecatedIn || !removalTarget || !asOf) {
      failures.push({ code: 'DEPRECATION_ENTRY_INVALID', message: `${entry.surface}: dates and versions must be parseable` });
      continue;
    }
    if (!shouldEnforceRemovalGate(entry.status)) {
      continue;
    }
    const elapsedDays = Math.floor((asOf.getTime() - deprecatedAt.getTime()) / 86_400_000);
    const elapsedMinor = (removalTarget.major - deprecatedIn.major) * 1000 + (removalTarget.minor - deprecatedIn.minor);
    if (elapsedDays < tier.days) {
      failures.push({ code: 'DEPRECATION_TIME_NOT_READY', message: `${entry.surface}: ${elapsedDays}d elapsed, requires ${tier.days}d for ${entry.tier}` });
    }
    if (elapsedMinor < tier.minorLag) {
      failures.push({ code: 'DEPRECATION_MINOR_NOT_READY', message: `${entry.surface}: ${elapsedMinor} minor(s) elapsed, requires ${tier.minorLag} for ${entry.tier}` });
    }
  }
  return { ok: failures.length === 0, failures };
}

function markdownToFixture(markdown: string) {
  const entries = [];
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => /^\| Surface \| Tier \| Deprecated at \|/.test(line));
  assert(headerIndex >= 0, 'DEPRECATIONS_TABLE_MISSING', 'docs/DEPRECATIONS.md must use the policy table columns');
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 9) continue;
    entries.push({
      surface: cells[0],
      tier: cells[1],
      deprecatedAt: cells[2],
      deprecatedIn: cells[3],
      removalTarget: cells[4],
      earliestRemovalDate: cells[5],
      requiredMinorLag: Number(cells[6]),
      replacement: cells[7],
      status: cells[8]
    });
  }
  return {
    asOf: new Date().toISOString().slice(0, 10),
    entries: entries.filter((entry) => entry.surface !== 'None')
  };
}

function buildReminderPayload(markdown: string) {
  const fixture = markdownToFixture(markdown);
  const asOf = parseDate(fixture.asOf)!;
  const reminders = [];
  for (const entry of fixture.entries ?? []) {
    const tier = tierPolicy[String(entry.tier ?? '')];
    const deprecatedAt = parseDate(entry.deprecatedAt);
    if (!tier || !deprecatedAt) continue;
    const elapsedDays = Math.floor((asOf.getTime() - deprecatedAt.getTime()) / 86_400_000);
    const daysRemaining = tier.days - elapsedDays;
    if (daysRemaining <= 14) reminders.push({ surface: entry.surface, tier: entry.tier, daysRemaining });
  }
  return {
    schemaVersion: 'atm.deprecationReminder.v0.1',
    hasReminders: reminders.length > 0,
    reminders,
    issueTitle: 'Deprecation removal window reminder',
    issueBody: reminders.length > 0
      ? `The following deprecations are approaching removal windows:\n\n${reminders.map((entry) => `- ${entry.surface} (${entry.tier}): ${entry.daysRemaining} day(s) remaining`).join('\n')}`
      : 'No deprecations are approaching removal windows.'
  };
}

function readDeprecationMarkdown() {
  return readText('docs/DEPRECATIONS.md');
}

function parseDate(value: string) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseSemver(value: string) {
  const match = String(value ?? '').match(/^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

function shouldEnforceRemovalGate(status: unknown): boolean {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return normalized === 'removal-ready'
    || normalized === 'removal-blocked'
    || normalized.startsWith('removal-')
    || normalized === 'scheduled-removal';
}

function readJson(relativePath: string) {
  return JSON.parse(readText(relativePath));
}

function readText(relativePath: string) {
  return readFileSync(resolveRootPath(relativePath), 'utf8');
}

function resolveRootPath(relativePath: string) {
  return path.isAbsolute(relativePath) ? relativePath : path.join(root, relativePath);
}

function writeGitHubOutput(filePath: string, values: Record<string, string>) {
  const chunks: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const delimiter = `ATM_${key.toUpperCase()}_${Date.now()}`;
    chunks.push(`${key}<<${delimiter}\n${value}\n${delimiter}`);
  }
  writeFileSync(filePath, `${chunks.join('\n')}\n`, { encoding: 'utf8', flag: 'a' });
}

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function fail(code: string, message: string) {
  failures.push({ code, message });
  console.error(`[deprecation-policy:${mode}] FAIL code=${code} message=${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, code: string, message: string) {
  if (!condition) fail(code, message);
}
