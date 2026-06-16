// TASK-MAO-0004: Standard-suite regression entry point for the prompt-scoped
// `next` route selector. The detailed scenario coverage (no route, unique
// route, ambiguous route, blocked route, claim handshake, intent file, queue
// fan-out, etc.) lives in `scripts/validate-prompt-scoped-next.ts`, which
// imports `runNext` directly for source-first validation. This wrapper makes
// that validator runnable as part of the normal `tests/cli/*.test.ts` sweep
// and surfaces a clean assertion in `npm run validate:cli`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validatorPath = path.join(root, 'scripts', 'validate-prompt-scoped-next.ts');

const result = spawnSync(process.execPath, ['--strip-types', validatorPath], {
  encoding: 'utf8',
  stdio: 'pipe',
  shell: false,
  env: { ...process.env, NO_COLOR: '1' }
});

const combined = `${result.stdout ?? ''}\n--- STDERR ---\n${result.stderr ?? ''}`;
assert.equal(
  result.status,
  0,
  `validate-prompt-scoped-next.ts must exit 0 to cover the four route-selector acceptance scenarios (no route, unique route, ambiguous route, blocked route).\n${combined}`
);

// `validate-prompt-scoped-next.ts` is silent on success and throws on the
// first failing assertion. Treating a clean exit as the green signal is
// sufficient regression coverage for the four route-selector scenarios.

console.log('ok - tests/cli/next-route-selector.test.ts');
