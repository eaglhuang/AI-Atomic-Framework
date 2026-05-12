import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message) {
  console.error(`[guide:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function runAtm(args, cwd = root) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
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

for (const relativePath of [
  'atm.mjs',
  'packages/cli/src/commands/guide.mjs',
  'packages/cli/src/commands/glossary-data.mjs',
  'packages/cli/src/commands/command-specs.mjs'
]) {
  check(existsSync(path.join(root, relativePath)), `missing guide dependency: ${relativePath}`);
}

const glossary = runAtm(['guide', 'glossary', '--json'], root);
check(glossary.exitCode === 0, 'guide glossary must exit 0');
check(glossary.parsed.ok === true, 'guide glossary must report ok=true');
check(Array.isArray(glossary.parsed.evidence?.terms), 'guide glossary must return evidence.terms array');
check(glossary.parsed.evidence.terms.length >= 10, 'guide glossary must expose at least 10 terms');

const guideHelp = runAtm(['guide', 'help', 'next', '--json'], root);
check(guideHelp.exitCode === 0, 'guide help next must exit 0');
check(guideHelp.parsed.ok === true, 'guide help next must report ok=true');
check(guideHelp.parsed.evidence?.usage?.command === 'next', 'guide help next must target next command');

const commandHelp = runAtm(['next', '--help', '--json'], root);
check(commandHelp.exitCode === 0, 'next --help must exit 0');
check(commandHelp.parsed.ok === true, 'next --help must report ok=true');
check(JSON.stringify(guideHelp.parsed.evidence?.usage ?? null) === JSON.stringify(commandHelp.parsed.evidence?.usage ?? null), 'guide help next usage must equal next --help usage');

if (!process.exitCode) {
  console.log(`[guide:${mode}] ok (glossary depth and guide help parity verified)`);
}

