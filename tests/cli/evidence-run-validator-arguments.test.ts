import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { looksLikeLiteralValidatorCommand } from '../../packages/cli/src/commands/evidence/validator-classification.ts';

// Exercise the production parser without spawning commands or creating ledgers.
// Its containing module has unrelated framework/runtime dependencies.
const source = readFileSync(new URL('../../packages/cli/src/commands/evidence/bundle-io/implementation.ts', import.meta.url), 'utf8');
const start = source.indexOf('function parseEvidenceRunOptions(');
const end = source.indexOf('export function runEvidenceDiff', start);
assert.ok(start >= 0 && end > start, 'production parser must be found');
class UsageError extends Error {
  constructor(_code: string, message: string) { super(message); }
}
const parser = new Function('requireValue', 'CliError', 'looksLikeLiteralValidatorCommand',
  stripTypeScriptTypes(source.slice(start, end)) + '; return parseEvidenceRunOptions;')(
    (argv: string[], index: number) => argv[index + 1], UsageError, looksLikeLiteralValidatorCommand);

for (const command of [
  'npm run check:encoding:touched -- --files alpha.ts,beta.ts',
  'node validate.mjs --files alpha.ts,beta.ts',
  'git diff -- alpha.ts,beta.ts'
]) {
  const result = parser(['--task', 'TASK-FIX-0001', '--command', command, '--validators', command]);
  assert.deepEqual(result.validators, [command], 'literal commands must preserve comma arguments');
}
const gates = parser(['--task', 'TASK-FIX-0001', '--command', 'node validate.mjs', '--validators', 'typecheck,test']);
assert.deepEqual(gates.validators, ['typecheck', 'test'], 'gate CSV remains supported');
assert.throws(() => parser(['--validators', 'test']), /requires --task/);
console.log('[evidence-run-validator-arguments] ok');
