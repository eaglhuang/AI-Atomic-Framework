import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  atomsTouchedByChange,
  findDerivedAtomConflicts,
  isAdditiveImportChange,
  isPreambleChangeAdditive,
  mergeIntentDerivedAtoms,
  parseUnifiedZeroDiff
} from '../../packages/core/src/broker/derived-atoms.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument } from '../../packages/core/src/broker/types.ts';
import { deriveAtomsFromText, inspectFormalAtomDrift, reserveDerivedAtoms } from '../../packages/cli/src/commands/shared/derived-atom-occupancy.ts';

// Derived atom occupancy rules (TASK-ASP-0007..0010) without a full CLI run.
const before = ["import a from 'a';", '', 'export function one() {', '  return 1;', '}', '', 'export function two() {', '  return 2;', '}', ''].join('\n');
const after = ["import a from 'a';", "import b from 'b';", '', 'export function one() {', '  return 1;', '}', '', 'export function two() {', '  return 22;', '}', '', 'export function three() {', '  return 3;', '}', ''].join('\n');
const oldAtoms = deriveAtomsFromText('src/m.ts', before);
const newAtoms = deriveAtomsFromText('src/m.ts', after);
assert.deepEqual(oldAtoms.map((atom) => atom.symbol), ['#preamble', 'one', 'two']);
assert.equal(oldAtoms.find((atom) => atom.symbol === 'one')!.atomCid, newAtoms.find((atom) => atom.symbol === 'one')!.atomCid, 'inserting a line above keeps the CID');
assert.equal(deriveAtomsFromText('README.md', before).length, 0, 'unsupported languages stay file-level');

const diff = [
  'diff --git a/src/m.ts b/src/m.ts', '--- a/src/m.ts', '+++ b/src/m.ts',
  '@@ -1,0 +2 @@', "+import b from 'b';",
  '@@ -8 +9 @@', '-  return 2;', '+  return 22;',
  '@@ -10,0 +12,4 @@', '+export function three() {', '+  return 3;', '+}', '+'
].join('\n');
const change = parseUnifiedZeroDiff(diff).get('src/m.ts')!;
assert.equal(change.hunks.length, 3);
const touched = atomsTouchedByChange({ oldAtoms, newAtoms, oldSpans: change.oldSpans, newSpans: change.newSpans, oldText: before, newText: after });
assert.deepEqual(touched.touched.map((atom) => atom.symbol).sort(), ['#preamble', 'three', 'two'], 'new atoms are confirmed from the diff');
assert.equal(touched.fileLevel, false);
assert.equal(isPreambleChangeAdditive({ hunks: change.hunks, oldAtoms, newAtoms }), true, 'a body edit elsewhere does not make the preamble exclusive');

assert.equal(isAdditiveImportChange([], ["import x from 'x';", '', "const y = require('y');"]), true);
assert.equal(isAdditiveImportChange(["import x from 'x';"], []), false, 'removing an import is not additive');
assert.equal(isAdditiveImportChange([], ['const flag = true;']), false, 'a top-level statement is not an import');

// A changed non-blank line outside every atom makes the change file-level.
const trailing = atomsTouchedByChange({ oldAtoms, newAtoms: oldAtoms, oldSpans: [], newSpans: [{ start: 10, end: 10 }], oldText: before, newText: `${before}console.log(1);\n` });
assert.equal(trailing.fileLevel, true);

function active(taskId: string, atomCids: string[], ranges: ActiveWriteIntent['resourceKeys']['atomRanges'] = []): ActiveWriteIntent {
  return {
    intentId: `intent-${taskId}`, taskId, teamRunId: null, actorId: taskId, baseCommit: 'abc',
    resourceKeys: { files: ['src/m.ts'], atomIds: atomCids, atomCids, generators: [], projections: [], registries: [], validators: [], artifacts: [], atomRanges: ranges },
    leaseEpoch: 1, leaseSeconds: 60, leaseMaxSeconds: 60, heartbeatAt: new Date().toISOString(), lane: 'direct-brokered'
  };
}
const two = newAtoms.find((atom) => atom.symbol === 'two')!;
const preamble = newAtoms.find((atom) => atom.region === 'preamble')!;
const file = { filePath: 'src/m.ts', touched: [two, preamble], fileLevel: false, preambleAdditive: true };
assert.deepEqual(findDerivedAtomConflicts({ taskId: 'MINE', files: [file], activeIntents: [active('OTHER', [two.atomCid])] }).map((conflict) => conflict.reason), ['same-atom']);
assert.equal(findDerivedAtomConflicts({ taskId: 'MINE', files: [file], activeIntents: [active('OTHER', [preamble.atomCid])] }).length, 0, 'additive imports commute');
assert.equal(findDerivedAtomConflicts({ taskId: 'MINE', files: [{ ...file, preambleAdditive: false }], activeIntents: [active('OTHER', [preamble.atomCid])] }).length, 1);
assert.equal(findDerivedAtomConflicts({ taskId: 'MINE', files: [file], activeIntents: [active('OTHER', [])] }).length, 0, 'an undeclared task is decided when it commits');
assert.equal(findDerivedAtomConflicts({ taskId: 'MINE', files: [file], activeIntents: [active('MINE', [two.atomCid])] }).length, 0, 'own atoms never conflict');
assert.equal(findDerivedAtomConflicts({ taskId: 'MINE', files: [{ ...file, fileLevel: true }], activeIntents: [active('OTHER', ['x'], [{ filePath: 'src/m.ts', lineStart: 1, lineEnd: 2, atomCid: 'x' }])] })[0].reason, 'file-level-change');

const registry = { activeIntents: [active('MINE', ['keep'])] } as unknown as WriteBrokerRegistryDocument;
const merged = mergeIntentDerivedAtoms(registry, 'MINE', [{ atomId: 'ATM-DERIVED-x', atomCid: two.atomCid, operation: 'modify', sourceRange: two.sourceRange }, { atomId: 'k', atomCid: 'keep', operation: 'modify' }]);
assert.deepEqual(merged.activeIntents[0].resourceKeys.atomCids, ['keep', two.atomCid], 'confirmation unions with earlier reservations without duplicates');
assert.equal(merged.activeIntents[0].resourceKeys.atomRanges?.length, 1);

// Formal atom drift (TASK-ASP-0010): a formal atom whose code path is gone is
// stale, and its files fall back to file-level reservations.
const root = mkdtempSync(path.join(os.tmpdir(), 'derived-occupancy-'));
try {
  const git = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.name', 'N']);
  git(['config', 'user.email', 'n@example.com']);
  mkdirSync(path.join(root, 'src'));
  writeFileSync(path.join(root, 'src', 'm.ts'), before);
  writeFileSync(path.join(root, 'atomic-registry.json'), JSON.stringify({ entries: [
    { atomId: 'ATM-OK-0001', status: 'active', location: { codePaths: ['src/m.ts'] } },
    { atomId: 'ATM-GONE-0001', status: 'active', location: { codePaths: ['src/gone.ts', 'src/m2.ts'] } }
  ] }));
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  const drift = inspectFormalAtomDrift(root);
  assert.deepEqual(drift.staleAtoms.map((atom) => atom.atomId), ['ATM-GONE-0001']);
  assert.deepEqual(drift.ownersByFile.get('src/m.ts'), ['ATM-OK-0001'], 'fresh formal atoms are ownership annotations');
  const reservation = reserveDerivedAtoms({ cwd: root, baseCommit: head, targetFiles: ['src/m.ts'], symbols: ['two', 'brandNew'] });
  assert.deepEqual(reservation.resolved.map((entry) => entry.symbol), ['two']);
  assert.deepEqual(reservation.unresolved, ['brandNew'], 'new symbols are confirmed at commit time');
  assert.equal(reservation.refs[0].operation, 'modify');
  writeFileSync(path.join(root, 'atomic-registry.json'), JSON.stringify({ entries: [{ atomId: 'ATM-GONE-0002', status: 'active', location: { codePaths: ['src/m.ts', 'src/missing.ts'] } }] }));
  const stale = reserveDerivedAtoms({ cwd: root, baseCommit: head, targetFiles: ['src/m.ts'], symbols: ['two'] });
  assert.deepEqual(stale.staleFormalFiles, ['src/m.ts']);
  assert.equal(stale.refs.length, 0, 'a stale formal atom downgrades its files to file-level');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('ok: derived atom occupancy rules (confirmation, preamble, conflicts, drift)');
