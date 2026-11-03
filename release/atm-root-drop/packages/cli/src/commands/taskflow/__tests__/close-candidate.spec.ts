import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertCloseCandidate, prepareCloseCandidate, readCloseCandidateAnchor } from '../close-candidate.ts';
import type { TaskflowGovernedCommitBundle } from '../commit-bundle-assembly.ts';
import { withCloseTransactionMutex } from '../close-transaction-mutex.ts';
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-close-candidate-'));
function git(args: string[]) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }); }
const file = path.join(cwd, 'packages/cli/dist/file.js'), ledger = path.join(cwd, '.atm/history/tasks/TASK.json');
function writeLedger(lease = 'one') { writeFileSync(ledger, JSON.stringify({ status: 'running', claim: { actorId: 'owner', leaseId: lease, state: 'active' } })); }
try {
  git(['init']); git(['config','user.name','Fixture']); git(['config','user.email','fixture@example.invalid']);
  mkdirSync(path.dirname(file), { recursive: true }); mkdirSync(path.dirname(ledger), { recursive: true });
  writeFileSync(file, 'original'); writeFileSync(path.join(cwd, 'foreign'), 'base'); writeLedger();
  git(['add','.']); git(['commit','-m','base']);
  const bundle = { targetRepo: { repoRoot: cwd, stageFiles: ['packages/cli/dist'], declaredPaths: [] }, planningRepo: { repoRoot: null, stageFiles: [] } } as unknown as TaskflowGovernedCommitBundle;
  const prepare = () => prepareCloseCandidate({ cwd, taskId: 'TASK', bundle });
  const initial = prepare(); assertCloseCandidate(initial);
  writeFileSync(file, 'changed'); assert.throws(() => assertCloseCandidate(initial), /candidate digest/); writeFileSync(file, 'original');
  writeFileSync(path.join(cwd,'packages/cli/dist/new'), 'new'); assert.throws(() => assertCloseCandidate(initial), /candidate digest/); rmSync(path.join(cwd,'packages/cli/dist/new'));
  rmSync(file); assert.throws(() => assertCloseCandidate(initial), /candidate digest/); writeFileSync(file,'original');
  if (process.platform !== 'win32') { chmodSync(file, 0o755); assert.throws(() => assertCloseCandidate(initial), /candidate digest/); chmodSync(file, 0o644); }
  writeLedger('two'); assert.throws(() => assertCloseCandidate(initial), /generation/); writeLedger();
  writeFileSync(path.join(cwd,'foreign'), 'other staged bytes'); git(['add','foreign']);
  const staged = git(['ls-files','-s','--','foreign']);
  assert.throws(() => assertCloseCandidate(initial), /index ownership/);
  assert.equal(git(['ls-files','-s','--','foreign']), staged, 'failed verification preserves another writer\'s index');
  const parked = prepare(); git(['restore','--staged','--','foreign']);
  assert.throws(() => assertCloseCandidate(parked), /index ownership/);
  assertCloseCandidate(parked, { parkedPaths: ['foreign'] });
  const anchor = readCloseCandidateAnchor(cwd, 'TASK');
  git(['commit','--allow-empty','-m','advance']);
  assert.throws(() => prepareCloseCandidate({ cwd, taskId: 'TASK', bundle, anchor }), /HEAD or claim/);
  assert.throws(() => assertCloseCandidate(initial), /HEAD/);
  const fresh = prepare();
  await withCloseTransactionMutex({ repoRoot: cwd, taskId: 'TASK', actorId: 'owner' }, () => assertCloseCandidate(fresh));
  // Read-only dist validation dominates this performance fixture. The target
  // is fixture-specific; all digest and authority checks still run in lock.
  const started = Date.now();
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const distCandidate = prepare(); let lockedMs = 0;
  await withCloseTransactionMutex({ repoRoot: cwd, taskId: 'TASK', actorId: 'owner' }, () => { const lockStart = Date.now(); assertCloseCandidate(distCandidate); lockedMs = Date.now() - lockStart; });
  const totalMs = Date.now() - started;
  assert.ok(lockedMs / totalMs < 0.2, `fixture locked ratio ${lockedMs}/${totalMs}`);
  assert.equal(readFileSync(file,'utf8'), 'original');
  console.log(`close-candidate: HEAD/content/mode/add/delete/generation/index checks passed; fixture locked=${lockedMs}ms total=${totalMs}ms`);
} finally { rmSync(cwd, { recursive: true, force: true }); }
