// ATM-GOV-0180 / ATM-BUG-2026-07-16-010
// Repeated `--add` flags on `tasks scope add` must accumulate every path.
//
//   node --strip-types tests/cli/tasks-scope-add-multi-flag.test.ts

import assert from 'node:assert/strict';
import {
  parseScopeAddOptions,
  parseScopeRepairOptions
} from '../../packages/cli/src/commands/tasks/task-option-parsers.ts';

{
  const options = parseScopeAddOptions([
    '--task', 'TASK-RFT-0063',
    '--actor', 'codex-task-rft-0063',
    '--add', 'scripts/validate-police-family/a.ts',
    '--add', 'scripts/validate-police-family/b.ts',
    '--add', 'scripts/validate-police-family/c.ts'
  ]);
  assert.deepEqual(options.addPaths, [
    'scripts/validate-police-family/a.ts',
    'scripts/validate-police-family/b.ts',
    'scripts/validate-police-family/c.ts'
  ]);
  console.log('Test A repeated --add accumulates: PASS');
}

{
  const options = parseScopeAddOptions([
    '--task', 'TASK-RFT-0063',
    '--actor', 'codex-task-rft-0063',
    '--add', 'scripts/a.ts,scripts/b.ts',
    '--add', 'scripts/c.ts'
  ]);
  assert.deepEqual(options.addPaths, [
    'scripts/a.ts',
    'scripts/b.ts',
    'scripts/c.ts'
  ]);
  console.log('Test B CSV --add plus repeated --add accumulates: PASS');
}

{
  const options = parseScopeAddOptions([
    '--task', 'TASK-RFT-0063',
    '--actor', 'codex-task-rft-0063',
    '--paths', 'docs/a.md',
    '--add', 'docs/b.md'
  ]);
  assert.deepEqual(options.addPaths, ['docs/a.md', 'docs/b.md']);
  console.log('Test C --paths then --add accumulates: PASS');
}

{
  const options = parseScopeRepairOptions([
    '--task', 'TASK-RFT-0063',
    '--actor', 'codex-task-rft-0063',
    '--emergency-approval', 'EMG-test',
    '--reason', 'accumulate repair paths',
    '--add', 'src/one.ts',
    '--add', 'src/two.ts'
  ]);
  assert.deepEqual(options.addPaths, ['src/one.ts', 'src/two.ts']);
  console.log('Test D scope repair repeated --add accumulates: PASS');
}

console.log(JSON.stringify({ ok: true, suite: 'tasks-scope-add-multi-flag' }, null, 2));
