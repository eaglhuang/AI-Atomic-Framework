import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { currentHelpSnapshot, helpSnapshotCommands, helpSnapshotDirectory, helpUsageMatches, inspectHelpSnapshots } from '../../scripts/validate-cli/help-snapshots.ts';

const temp = mkdtempSync(path.join(os.tmpdir(), 'atm-help-snapshots-'));
try {
  mkdirSync(path.join(temp, helpSnapshotDirectory), { recursive: true });
  writeFileSync(path.join(temp, helpSnapshotDirectory, 'command-list.json'), JSON.stringify({ commands: ['z', 'a'] }));
  for (const command of helpSnapshotCommands) {
    writeFileSync(path.join(temp, helpSnapshotDirectory, `${command}.json`), JSON.stringify({ command, options: [] }));
  }
  let drifting = false;
  const run = async (args: string[]) => ({
    exitCode: 0,
    parsed: { evidence: args[0] === '--help'
      ? { commands: ['z', { command: 'a' }] }
      : { usage: { options: drifting && args[0] === 'broker' ? ['changed'] : [], command: args[0] } } }
  });
  assert.deepEqual(await currentHelpSnapshot('command-list', temp, run), { commands: ['a', 'z'] });
  const logs: string[] = [];
  assert.deepEqual(await inspectHelpSnapshots(temp, run, (message) => logs.push(message)), []);
  assert.equal(logs.length, helpSnapshotCommands.length + 1);
  drifting = true;
  assert.deepEqual(await inspectHelpSnapshots(temp, run, () => {}), ['broker']);
  assert.equal(helpUsageMatches({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
  assert.equal(helpUsageMatches(['a', 'b'], ['b', 'a']), false);
  await assert.rejects(currentHelpSnapshot('broker', temp, async () => ({ exitCode: 1, parsed: {} })), /broker --help failed/);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
console.log('[help-snapshots] ok');
