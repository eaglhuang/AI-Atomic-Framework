import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliCommandRunners } from '../../packages/cli/src/atm.ts';
import { getCommandSpec, listCommandSpecs } from '../../packages/cli/src/commands/command-specs.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const atmEntrypoint = path.join(root, 'packages/cli/src/atm.ts');

assert.equal(typeof cliCommandRunners['write-ticket'], 'function');
assert.equal(getCommandSpec('write-ticket')?.name, 'write-ticket');
assert.equal(listCommandSpecs().some((spec) => spec.name === 'write-ticket'), true);

const help = JSON.parse(execFileSync(process.execPath, ['--strip-types', atmEntrypoint, 'write-ticket', '--help', '--json'], {
  cwd: root,
  encoding: 'utf8'
})) as Record<string, any>;
assert.equal(help.ok, true);
assert.equal(help.evidence.usage.command, 'write-ticket');
assert.match(JSON.stringify(help.evidence), /acquire/);
assert.match(JSON.stringify(help.evidence), /record-touch/);

for (const adapterPath of [
  'templates/skills/atm-governance-router.skill.md',
  'integrations/codex-skills/atm-governance-router/SKILL.md',
  '.claude/skills/atm-governance-router/SKILL.md',
  '.cursor/rules/skills/atm-governance-router/SKILL.md',
  '.gemini/commands/atm-governance-router.toml',
  'GEMINI.md'
]) {
  const text = readFileSync(path.join(root, adapterPath), 'utf8');
  assert.match(text, /write-ticket/);
  assert.doesNotMatch(text, /guard mutation/);
}

console.log('[write-ticket-command-registration.test] ok');
