import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseLiveWriteJournal as core } from '../../../../../packages/core/src/live-write/live-write-journal.ts';
import { parseLiveWriteJournal as kit } from '../bin/live-write-journal.generated.mjs';
const check = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/generate-live-write-journal.mjs', import.meta.url)), '--check'], { encoding: 'utf8' });
assert.equal(check.status, 0, check.stderr);
const good = '{"proposalId":"p"}\n';
for (const [name, text, expected] of [
  ['valid', good, [{ proposalId: 'p' }]],
  ['torn last', good + '{"torn":', [{ proposalId: 'p' }]],
  ['bad last with newline', good + 'bad\n', [{ proposalId: 'p' }]],
  ['torn middle', good + 'bad\n' + good, 'error'],
  ['empty', '', []],
  ['trailing blanks', good + '\n  \n', [{ proposalId: 'p' }]],
  ['unterminated valid last', good + '{"p":2}', [{ proposalId: 'p' }]]
]) {
  const result = (reader) => { try { return reader(text); } catch { return 'error'; } };
  assert.deepEqual(result(core), expected, name);
  assert.deepEqual(result(kit), result(core), name);
}
console.log('live-write journal parity ok');
