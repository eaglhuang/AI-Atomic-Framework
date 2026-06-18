import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const stableRunner: string = readFileSync('atm.mjs', 'utf8');
const devRunner: string = readFileSync('atm.dev.mjs', 'utf8');
const frameworkDevelopment: string = [
  readFileSync('packages/cli/src/commands/framework-development.ts', 'utf8'),
  readFileSync('packages/cli/src/commands/framework-development/closure-packet-schema.ts', 'utf8')
].join('\n');
const cliFixture: { entrypoint?: string } = JSON.parse(readFileSync('tests/cli-fixtures/cli-mvp.fixture.json', 'utf8')) as { entrypoint?: string };

assert.match(stableRunner, /release['"], ['"]atm-onefile['"], ['"]atm\.mjs/, 'atm.mjs should prefer the frozen onefile release runner.');
assert.match(stableRunner, /packages['"], ['"]cli['"], ['"]dist['"], ['"]atm\.js/, 'atm.mjs should allow the built dist runner.');
assert.doesNotMatch(stableRunner, /packages['"], ['"]cli['"], ['"]src['"], ['"]atm\.ts/, 'atm.mjs must not load source-first.');
assert.match(stableRunner, /npm run build/, 'atm.mjs should tell contributors how to create the frozen runner.');
assert.match(stableRunner, /atm\.dev\.mjs/, 'atm.mjs should point source-development users to atm.dev.mjs.');
assert.doesNotMatch(stableRunner, /cliArgs\.includes\(['"]--json['"]\)/, 'atm.mjs stale-runner warning must still be visible to JSON-mode agents via stderr.');

assert.match(devRunner, /packages['"], ['"]cli['"], ['"]src['"], ['"]atm\.ts/, 'atm.dev.mjs should load source-first for framework development.');
assert.match(devRunner, /packages['"], ['"]cli['"], ['"]dist['"], ['"]atm\.js/, 'atm.dev.mjs should fall back to the built dist runner.');
assert.equal(cliFixture.entrypoint, 'atm.dev.mjs', 'source CLI validation should use the source-first development runner.');

assert.match(frameworkDevelopment, /runner-build-scope\.json/, 'stale-runner detection should consume the runner build scope manifest.');
assert.match(frameworkDevelopment, /runnerAffectingPatterns/, 'stale-runner detection should use the ATM core scope classifier patterns.');
assert.doesNotMatch(
  frameworkDevelopment,
  /path\.join\(rootDir, 'packages', 'cli', 'src'\)[\s\S]*path\.join\(rootDir, 'scripts'\)/,
  'stale-runner detection must not be limited to packages/cli/src and scripts.'
);

console.log('[runner-entrypoints] ok');
