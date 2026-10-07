import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildFileHeatReceipt,
  coolTemperature,
  createEmptyFileHeatLedger,
  decideHotPath,
  EXPERIENCE_CANDIDATE_STREAK,
  heatBumpForGap,
  listHottestFiles,
  loadFileHeatLedger,
  readLearnedTemperature,
  recordFileTouch,
  resetFileHeat,
  resolveEffectiveTemperature,
  resolveFileHeatFrozen,
  resolveFileHeatMode,
  saveFileHeatLedger,
  type FileHeatLedger
} from '../file-heat.ts';
import { evaluateTeamBrokerLane } from '../team-lane.ts';

const T0 = Date.parse('2026-10-07T00:00:00.000Z');
const at = (offsetMs: number) => new Date(T0 + offsetMs);
const FILE = 'packages/core/src/cold-file.ts';

function touches(sequence: readonly { readonly actorId: string; readonly atMs: number; readonly taskId?: string }[]): FileHeatLedger {
  return sequence.reduce(
    (ledger, touch) => recordFileTouch(ledger, { path: FILE, actorId: touch.actorId, taskId: touch.taskId, now: at(touch.atMs) }),
    createEmptyFileHeatLedger()
  );
}

function testGapTableBumpsAndClamp() {
  assert.equal(heatBumpForGap(1_500), 100);
  assert.equal(heatBumpForGap(2_500), 50);
  assert.equal(heatBumpForGap(4_000), 20);
  assert.equal(heatBumpForGap(9_000), 10);
  assert.equal(heatBumpForGap(14_000), 5);
  assert.equal(heatBumpForGap(15_000), 0);
  assert.equal(heatBumpForGap(-1), 0);

  const ledger = touches([
    { actorId: 'a', atMs: 0 },
    { actorId: 'b', atMs: 1_000 },
    { actorId: 'a', atMs: 2_000 }
  ]);
  assert.equal(ledger.entries[FILE]?.temperature, 100);
  console.log('ok: gap table bumps and clamps to 100');
}

function testSameActorRapidEditsDoNotHeat() {
  const ledger = touches([
    { actorId: 'a', atMs: 0 },
    { actorId: 'a', atMs: 500 },
    { actorId: 'a', atMs: 1_000 },
    { actorId: 'a', atMs: 1_500 }
  ]);
  assert.equal(ledger.entries[FILE]?.temperature, 0);
  const receipt = buildFileHeatReceipt({ mode: 'hybrid', ledger, taskId: 'TASK-X', paths: [FILE], now: at(1_500) });
  assert.equal(receipt.files[0]?.hot, false);
  // One task re-evaluated under another actor label (planner, then coordinator) is not contention.
  const sameTask = touches([
    { actorId: 'team-planner', taskId: 'TASK-1', atMs: 0 },
    { actorId: 'coordinator-1', taskId: 'TASK-1', atMs: 500 }
  ]);
  assert.equal(sameTask.entries[FILE]?.temperature, 0);
  const distinctTasks = touches([
    { actorId: 'team-planner', taskId: 'TASK-1', atMs: 0 },
    { actorId: 'coordinator-1', taskId: 'TASK-2', atMs: 500 }
  ]);
  assert.equal(distinctTasks.entries[FILE]?.temperature, 100);
  console.log('ok: same-actor rapid edits and same-task re-evaluation stay cold');
}

function testCoolDownIsSlowerThanHeatUp() {
  // Heating from 0 to 100 takes about one second of distinct-actor contention.
  const hot = touches([{ actorId: 'a', atMs: 0 }, { actorId: 'b', atMs: 1_000 }]);
  assert.equal(hot.entries[FILE]?.temperature, 100);
  // The same short span of idle time does not cool at all.
  assert.equal(readLearnedTemperature(hot, FILE, at(2_000)), 100);
  assert.equal(coolTemperature(100, 60_000), 100);
  // Cooling is gradual and monotonic over minutes, not seconds.
  const afterSixMinutes = readLearnedTemperature(hot, FILE, at(1_000 + 6 * 60_000));
  const afterHour = readLearnedTemperature(hot, FILE, at(1_000 + 60 * 60_000));
  assert.ok(afterSixMinutes < 100 && afterSixMinutes > 80, `six-minute idle temperature ${afterSixMinutes}`);
  assert.ok(afterHour < afterSixMinutes && afterHour > 0, `one-hour idle temperature ${afterHour}`);
  console.log('ok: idle cool-down is slower than heat-up');
}

function testModes() {
  assert.equal(resolveFileHeatMode(undefined), 'static');
  assert.equal(resolveFileHeatMode('HYBRID'), 'hybrid');
  assert.equal(resolveFileHeatMode('learned'), 'learned');
  assert.equal(resolveFileHeatMode('bogus'), 'static');

  const contended = touches([{ actorId: 'a', atMs: 0 }, { actorId: 'b', atMs: 1_000 }]);
  const legacy = 'packages/cli/src/commands/broker.ts';
  const now = at(1_000);
  // static ignores the ledger entirely: legacy basename set only.
  assert.equal(resolveEffectiveTemperature({ mode: 'static', ledger: contended, path: legacy, now }), 100);
  assert.equal(resolveEffectiveTemperature({ mode: 'static', ledger: contended, path: FILE, now }), 0);
  // hybrid keeps legacy hot files hot and adds learned contention.
  assert.equal(resolveEffectiveTemperature({ mode: 'hybrid', ledger: contended, path: legacy, now }), 100);
  assert.equal(resolveEffectiveTemperature({ mode: 'hybrid', ledger: contended, path: FILE, now }), 100);
  // learned seeds legacy files with a prior and otherwise follows the ledger.
  assert.equal(resolveEffectiveTemperature({ mode: 'learned', ledger: createEmptyFileHeatLedger(), path: legacy, now }), 65);
  console.log('ok: static / hybrid / learned temperature resolution');
}

function testStableBernoulli() {
  assert.equal(decideHotPath({ temperature: 0, taskId: 't', path: FILE }), false);
  assert.equal(decideHotPath({ temperature: 100, taskId: 't', path: FILE }), true);
  const first = decideHotPath({ temperature: 50, taskId: 'TASK-1', path: FILE });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(decideHotPath({ temperature: 50, taskId: 'TASK-1', path: FILE }), first);
  }
  let hotCount = 0;
  for (let index = 0; index < 1_000; index += 1) {
    if (decideHotPath({ temperature: 80, taskId: `TASK-${index}`, path: FILE })) hotCount += 1;
  }
  assert.ok(hotCount > 740 && hotCount < 860, `80% draw produced ${hotCount}/1000`);
  console.log('ok: p_hot draw is stable and roughly proportional');
}

function testLedgerRoundTripAndCorruptFallback() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-file-heat-'));
  const ledgerPath = path.join(tempDir, 'nested', 'file-heat.json');
  const ledger = touches([{ actorId: 'a', atMs: 0 }, { actorId: 'b', atMs: 4_000 }]);
  saveFileHeatLedger(ledgerPath, ledger);
  assert.deepEqual(loadFileHeatLedger(ledgerPath), ledger);
  assert.deepEqual(loadFileHeatLedger(path.join(tempDir, 'missing.json')).entries, {});
  saveFileHeatLedger(ledgerPath, { schemaId: 'wrong' } as unknown as FileHeatLedger);
  assert.deepEqual(loadFileHeatLedger(ledgerPath).entries, {});
  rmSync(tempDir, { recursive: true, force: true });
  console.log('ok: ledger round-trips and ignores corrupt documents');
}

function testTeamLaneReceiptAndStaticParity() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-file-heat-lane-'));
  const registryPath = path.join(tempDir, 'write-broker.registry.json');
  const fileHeatPath = path.join(tempDir, 'file-heat.json');
  const task = { workItemId: 'TASK-HEAT', title: 'heat lane', atomizationImpact: { ownerAtomOrMap: 'atm.file-heat' } };
  const evaluate = (taskId: string, actorId: string, atMs: number, mode: 'static' | 'hybrid', readOnly = false) => evaluateTeamBrokerLane({
    cwd: tempDir,
    taskId,
    actorId,
    task,
    writePaths: [FILE],
    registryPath,
    fileHeatPath,
    fileHeatMode: mode,
    now: at(atMs),
    readOnly
  });

  // static: contention is observed, but routing keeps the basename behavior.
  evaluate('TASK-S1', 's1', 0, 'static');
  assert.equal(existsSync(fileHeatPath), true);
  const staticResult = evaluate('TASK-S2', 's2', 1_000, 'static');
  assert.equal(staticResult.evidence.fileHeat?.mode, 'static');
  assert.equal(staticResult.evidence.fileHeat?.files[0]?.temperature, 0);
  assert.equal(staticResult.evidence.fileHeat?.files[0]?.observedTemperature, 100);
  assert.equal(staticResult.evidence.fileHeat?.files[0]?.hot, false);
  assert.equal(staticResult.evidence.admission.trigger, 'not-required');
  rmSync(fileHeatPath, { force: true });

  // hybrid: two distinct actors one second apart heat the file to 100 → proposal-first.
  const first = evaluate('TASK-A', 'a', 0, 'hybrid');
  assert.equal(first.evidence.fileHeat?.files[0]?.hot, false);
  const second = evaluate('TASK-B', 'b', 1_000, 'hybrid');
  assert.equal(second.evidence.fileHeat?.files[0]?.temperature, 100);
  assert.equal(second.evidence.fileHeat?.files[0]?.pHot, 1);
  assert.equal(second.evidence.admission.trigger, 'hot-file');
  assert.deepEqual(second.evidence.writeIntent.proposalAdmission?.hotFiles, [FILE]);

  // read-only evaluation previews heat but does not persist the touch.
  const before = loadFileHeatLedger(fileHeatPath);
  evaluate('TASK-C', 'c', 1_500, 'hybrid', true);
  assert.deepEqual(loadFileHeatLedger(fileHeatPath), before);

  rmSync(tempDir, { recursive: true, force: true });
  console.log('ok: team lane emits heat receipt; static mode keeps basename behavior');
}

function testSustainedHotFlagsExperienceCandidate() {
  const sequence = [{ actorId: 'a', atMs: 0 }];
  for (let index = 1; index <= EXPERIENCE_CANDIDATE_STREAK; index += 1) {
    sequence.push({ actorId: index % 2 === 0 ? 'a' : 'b', atMs: index * 1_000 });
  }
  const ledger = touches(sequence);
  assert.equal(ledger.entries[FILE]?.hotStreak, EXPERIENCE_CANDIDATE_STREAK);
  const now = at(EXPERIENCE_CANDIDATE_STREAK * 1_000);
  assert.equal(buildFileHeatReceipt({ mode: 'hybrid', ledger, taskId: 'T', paths: [FILE], now }).files[0]?.experienceCandidate, true);
  // The candidate is a review nudge, not routing, so it is reported in static mode too.
  assert.equal(buildFileHeatReceipt({ mode: 'static', ledger, taskId: 'T', paths: [FILE], now }).files[0]?.experienceCandidate, true);
  // One cold same-actor touch after a long idle breaks the streak.
  const cooled = recordFileTouch(ledger, { path: FILE, actorId: 'a', now: at(10 * 60 * 60_000) });
  assert.equal(cooled.entries[FILE]?.hotStreak, 0);
  console.log('ok: sustained heat flags an experience-loop candidate');
}

function testStatusAndReset() {
  const other = 'packages/core/src/other.ts';
  let ledger = touches([{ actorId: 'a', atMs: 0 }, { actorId: 'b', atMs: 4_000 }]);
  ledger = recordFileTouch(ledger, { path: other, actorId: 'a', now: at(0) });
  ledger = recordFileTouch(ledger, { path: other, actorId: 'b', now: at(1_000) });
  const status = listHottestFiles(ledger, at(4_000));
  assert.deepEqual(status.map((entry) => [entry.path, entry.temperature]), [[other, 100], [FILE, 20]]);
  assert.equal(listHottestFiles(ledger, at(4_000), 1).length, 1);

  const partial = resetFileHeat(ledger, [other]);
  assert.deepEqual(partial.removed, [other]);
  assert.deepEqual(Object.keys(partial.ledger.entries), [FILE]);
  const all = resetFileHeat(ledger);
  assert.deepEqual(all.removed, [FILE, other].sort());
  assert.deepEqual(all.ledger.entries, {});
  console.log('ok: status lists hottest first and reset drops learned heat');
}

function testFrozenLedgerIsReplayStable() {
  assert.equal(resolveFileHeatFrozen('1'), true);
  assert.equal(resolveFileHeatFrozen(undefined), false);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-file-heat-frozen-'));
  const fileHeatPath = path.join(tempDir, 'file-heat.json');
  const registryPath = path.join(tempDir, 'write-broker.registry.json');
  saveFileHeatLedger(fileHeatPath, touches([{ actorId: 'a', atMs: 0 }, { actorId: 'b', atMs: 4_000 }]));
  const frozenLedger = loadFileHeatLedger(fileHeatPath);
  const replay = () => evaluateTeamBrokerLane({
    cwd: tempDir,
    taskId: 'TASK-REPLAY',
    actorId: 'c',
    task: { workItemId: 'TASK-REPLAY', title: 'replay' },
    writePaths: [FILE],
    registryPath,
    fileHeatPath,
    fileHeatMode: 'hybrid',
    fileHeatFrozen: true,
    now: at(5_000)
  }).evidence.fileHeat;
  const first = replay();
  assert.equal(first?.frozen, true);
  assert.equal(first?.files[0]?.temperature, 20);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.deepEqual(replay(), first);
  }
  assert.deepEqual(loadFileHeatLedger(fileHeatPath), frozenLedger);
  rmSync(tempDir, { recursive: true, force: true });
  console.log('ok: frozen ledger replays identically and is never written');
}

testGapTableBumpsAndClamp();
testSameActorRapidEditsDoNotHeat();
testCoolDownIsSlowerThanHeatUp();
testModes();
testStableBernoulli();
testLedgerRoundTripAndCorruptFallback();
testTeamLaneReceiptAndStaticParity();
testSustainedHotFlagsExperienceCandidate();
testStatusAndReset();
testFrozenLedgerIsReplayStable();
console.log('file heat tests: ok');
