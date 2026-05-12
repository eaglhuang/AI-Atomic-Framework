import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message) {
  console.error(`[test-facade:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runFacade(args) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/run-validators.mjs'), ...args, '--json'], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch (error) {
    fail(`run-validators output is not valid JSON for args ${args.join(' ')}: ${payload || error.message}`);
    parsed = {};
  }
  return {
    exitCode: result.status ?? 0,
    parsed
  };
}

for (const relativePath of ['scripts/run-validators.mjs', 'scripts/validators.config.json']) {
  check(existsSync(path.join(root, relativePath)), `missing validator-facade dependency: ${relativePath}`);
}

const config = JSON.parse(readFileSync(path.join(root, 'scripts/validators.config.json'), 'utf8'));
check(Boolean(config?.profiles?.standard), 'validators.config.json must define standard profile');

const standard = runFacade(['standard']);
check(standard.exitCode === 0, 'run-validators standard must exit 0 on baseline');
check(standard.parsed.profile === 'standard', 'run-validators standard must report profile=standard');
check(Array.isArray(standard.parsed.validators), 'run-validators standard must return validators array');
check(standard.parsed.total === standard.parsed.validators.length, 'run-validators standard total must equal validators.length');
check(standard.parsed.failed === 0, 'run-validators standard failed count must be 0 on baseline');

const legacy = runFacade(['standard', '--legacy']);
check(legacy.exitCode === 0, 'run-validators standard --legacy must exit 0 on baseline');
check(legacy.parsed.legacy === true, 'legacy run must report legacy=true');
check(legacy.parsed.failed === 0, 'legacy run failed count must be 0 on baseline');
check(legacy.parsed.total === standard.parsed.total, 'legacy run total must match non-legacy total on baseline');
check(legacy.parsed.passed === standard.parsed.passed, 'legacy run passed count must match non-legacy total on baseline');

const filtered = runFacade(['standard', '--filter', 'tag:cli']);
check(filtered.exitCode === 0, 'run-validators filtered run must exit 0');
check(filtered.parsed.total > 0, 'filtered run must include at least one validator');
check(filtered.parsed.validators.every((entry) => Array.isArray(entry.tags) && entry.tags.some((tag) => String(tag).toLowerCase() === 'cli')), 'filtered run must keep only tag:cli validators');

const parallel = runFacade(['quick', '--parallel']);
check(parallel.exitCode === 0, 'run-validators parallel run must exit 0');
check(parallel.parsed.parallel === true, 'parallel run must report parallel=true');
check(parallel.parsed.total > 0, 'parallel run must execute at least one validator');

if (!process.exitCode) {
  console.log(`[test-facade:${mode}] ok (profile, filter, parallel, and legacy behaviors verified)`);
}

