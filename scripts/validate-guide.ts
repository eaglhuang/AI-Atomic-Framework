import { createValidator } from './lib/validator-harness.ts';

const validator = createValidator('guide');
const { assert, requireFile, runAtmJson, ok } = validator;

for (const relativePath of [
  'atm.mjs',
  'packages/cli/src/commands/guide.ts',
  'packages/cli/src/commands/glossary-data.ts',
  'packages/cli/src/commands/command-specs.ts'
]) {
  requireFile(relativePath, `missing guide dependency: ${relativePath}`);
}

const glossary = runAtmJson(['guide', 'glossary', '--json']);
assert(glossary.exitCode === 0, 'guide glossary must exit 0');
assert(glossary.parsed.ok === true, 'guide glossary must report ok=true');
assert(Array.isArray(glossary.parsed.evidence?.terms), 'guide glossary must return evidence.terms array');
assert((glossary.parsed.evidence?.terms as unknown[]).length >= 10, 'guide glossary must expose at least 10 terms');

const guideHelp = runAtmJson(['guide', 'help', 'next', '--json']);
assert(guideHelp.exitCode === 0, 'guide help next must exit 0');
assert(guideHelp.parsed.ok === true, 'guide help next must report ok=true');
assert(guideHelp.parsed.evidence?.usage?.command === 'next', 'guide help next must target next command');

const commandHelp = runAtmJson(['next', '--help', '--json']);
assert(commandHelp.exitCode === 0, 'next --help must exit 0');
assert(commandHelp.parsed.ok === true, 'next --help must report ok=true');
assert(
  JSON.stringify(guideHelp.parsed.evidence?.usage ?? null) === JSON.stringify(commandHelp.parsed.evidence?.usage ?? null),
  'guide help next usage must equal next --help usage'
);

ok('glossary depth and guide help parity verified');
