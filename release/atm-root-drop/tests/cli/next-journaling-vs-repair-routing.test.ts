// `atm next` must tell a request to record backlog work apart from a request to
// repair it. Two substring rules blurred that line: "backlog" contains "log",
// and a bug id alone counted as journaling even with an explicit repair intent.
// Both sent framework maintenance prompts to the first-layer backlog contract.
import assert from 'node:assert/strict';
import { isJournalingPrompt } from '../../packages/cli/src/commands/next/intent-normalizers.ts';

const journaling = [
  '記一筆 backlog：runner-sync 逾時',
  'log this backlog item for later',
  'record the bug backlog entry',
  'append ATM-BUG-2026-07-07-048 to the backlog',
  'ATM-BUG-2026-07-07-048',
];
const repair = [
  '修正 ATM backlog 中最嚴重卡住治理的 bug',
  'fix the worst backlog bug blocking governance',
  'Resolve ATM-BUG-2026-07-07-048 and push the fix',
  '處理 ATM-BUG-2026-07-07-048',
];

for (const prompt of journaling) {
  assert.equal(isJournalingPrompt(prompt), true, `recording request must route to journaling: ${prompt}`);
}
for (const prompt of repair) {
  assert.equal(isJournalingPrompt(prompt), false, `repair request must not route to journaling: ${prompt}`);
}

// The specific substring traps, asserted directly so a future regex edit that
// drops the word boundaries fails here rather than in a routing scenario.
assert.equal(isJournalingPrompt('修正 backlog 裡的 bug'), false, '"log" inside "backlog" is not a write intent');
assert.equal(isJournalingPrompt('address the backlog'), false, '"add" inside "address" is not a write intent');

console.log('[next-journaling-vs-repair-routing.test] ok');
