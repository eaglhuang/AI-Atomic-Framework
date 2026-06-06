import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';

function fail(message: string) {
  console.error(`[migration-fixtures:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function runAtm(args: readonly string[], cwd = root) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed: any = {};
  try {
    parsed = payload ? JSON.parse(payload) : {};
  } catch (err: any) {
    fail(`CLI output is not JSON for ${args.join(' ')}: ${payload || err.message}`);
  }
  return { exitCode: result.status ?? 1, parsed, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// Load fixtures/migrations/migration-index.json
// ---------------------------------------------------------------------------

const fixtureIndexPath = path.join(root, 'fixtures', 'migrations', 'migration-index.json');
assert(existsSync(fixtureIndexPath), 'fixtures/migrations/migration-index.json must exist');

if (!existsSync(fixtureIndexPath)) {
  console.log(`[migration-fixtures:${mode}] ok — skipping (no migration-index.json)`);
  process.exit(0);
}

const fixtureIndex = JSON.parse(readFileSync(fixtureIndexPath, 'utf8'));
assert(Array.isArray(fixtureIndex.migrations), 'migration-index.json must have a migrations array');

// ---------------------------------------------------------------------------
// For each entry with breaking: true, validate guide + fixture
// ---------------------------------------------------------------------------

for (const entry of fixtureIndex.migrations ?? []) {
  const label = `migration ${entry.id ?? 'unknown'}`;

  assert(typeof entry.id === 'string' && entry.id.length > 0, `${label}: id must be a non-empty string`);
  assert(typeof entry.fromVersion === 'string', `${label}: fromVersion must be a string`);
  assert(typeof entry.toVersion === 'string', `${label}: toVersion must be a string`);

  if (!entry.breaking) {
    continue;
  }

  // Guide file must exist
  assert(
    typeof entry.guide === 'string' && entry.guide.length > 0,
    `${label}: breaking migration must declare a guide path`
  );
  const guideAbs = path.join(root, entry.guide);
  assert(existsSync(guideAbs), `${label}: guide file ${entry.guide} must exist`);

  // Fixture directory must exist with before/ and after/
  assert(
    typeof entry.fixture === 'string' && entry.fixture.length > 0,
    `${label}: breaking migration must declare a fixture path`
  );
  const fixtureAbs = path.join(root, entry.fixture);
  assert(existsSync(fixtureAbs), `${label}: fixture directory ${entry.fixture} must exist`);

  const beforeDir = path.join(fixtureAbs, 'before');
  const afterDir = path.join(fixtureAbs, 'after');
  assert(existsSync(beforeDir), `${label}: fixture must contain a before/ directory`);
  assert(existsSync(afterDir), `${label}: fixture must contain an after/ directory`);

  // before/ must have at least one file
  const beforeFiles = readdirSync(beforeDir);
  assert(beforeFiles.length > 0, `${label}: fixture before/ must contain at least one file`);

  // Run atm migrate verify --fixture <dir> --json and expect ok: true
  const verifyResult = runAtm(['migrate', 'verify', '--fixture', entry.fixture, '--json']);
  assert(verifyResult.exitCode === 0, `${label}: migrate verify must exit 0 for fixture ${entry.fixture} (exit: ${verifyResult.exitCode})`);
  assert(verifyResult.parsed.ok === true, `${label}: migrate verify must return ok: true for fixture ${entry.fixture}\n${verifyResult.stdout}${verifyResult.stderr}`);
  assert(
    verifyResult.parsed.evidence?.status === 'fixture-ok',
    `${label}: migrate verify evidence.status must be fixture-ok, got: ${verifyResult.parsed.evidence?.status}`
  );
}

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

const breakingCount = (fixtureIndex.migrations ?? []).filter((m: any) => m.breaking).length;
console.log(`[migration-fixtures:${mode}] ok — verified ${breakingCount} breaking migration(s)`);
