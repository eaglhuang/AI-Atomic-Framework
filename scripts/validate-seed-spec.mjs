import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const requiredFiles = [
  'packages/core/seed.js',
  'specs/atom-seed-spec.json',
  'packages/cli/src/commands/spec.mjs',
  'packages/cli/src/commands/spec-shared.mjs'
];

const bannedTerms = [
  ['3K', 'Life'].join(''),
  ['Co', 'cos'].join(''),
  ['html', '-to-', 'ucuf'].join('')
];

function fail(message) {
  console.error(`[seed-spec:${mode}] ${message}`);
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

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

for (const relativePath of requiredFiles) {
  assert(existsSync(path.join(root, relativePath)), `missing required seed file: ${relativePath}`);
}

const { createSeedAtomSpec, seedAtomId, seedLegacyPlanningId, seedSourcePath, seedSpecPath } = await import(pathToFileURL(path.join(root, 'packages/core/seed.js')).href);
const expectedSpec = createSeedAtomSpec();
const actualSpec = JSON.parse(readFileSync(path.join(root, seedSpecPath), 'utf8'));

assert(seedLegacyPlanningId === 'ATM-CORE-0001', 'seed legacy planning ID must stay ATM-CORE-0001');
assert(seedAtomId === 'atom.core-seed', 'seed atom ID must stay atom.core-seed under current schema vocabulary');
assert(seedSourcePath === 'packages/core/seed.js', 'seed source path must remain packages/core/seed.js');
assert(seedSpecPath === 'specs/atom-seed-spec.json', 'seed spec path must remain specs/atom-seed-spec.json');
assert(stableStringify(actualSpec) === stableStringify(expectedSpec), 'atom-seed-spec.json must match packages/core/seed.js seed spec template');

for (const relativePath of [seedSourcePath, seedSpecPath]) {
  const content = readFileSync(path.join(root, relativePath), 'utf8');
  for (const term of bannedTerms) {
    assert(!content.includes(term), `${relativePath} contains downstream-only term: ${term}`);
  }
}

const specValidate = runAtm(['spec', '--validate', 'specs/atom-seed-spec.json']);
assert(specValidate.exitCode === 0, 'atm spec --validate specs/atom-seed-spec.json must exit 0');
assert(specValidate.parsed.ok === true, 'atm spec --validate must report ok=true');
assert(specValidate.parsed.command === 'spec', 'atm spec --validate must report command=spec');

const validateAlias = runAtm(['validate', '--spec', 'specs/atom-seed-spec.json']);
assert(validateAlias.exitCode === 0, 'atm validate --spec specs/atom-seed-spec.json must exit 0');
assert(validateAlias.parsed.ok === true, 'atm validate --spec seed spec must report ok=true');

if (!process.exitCode) {
  console.log('[seed-spec:' + mode + '] ok (seed self-description and spec validation verified)');
}