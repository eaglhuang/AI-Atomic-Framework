import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repairClosurePacketForTask } from '../../packages/cli/src/commands/framework-development/closure-packet-schema/implementation.ts';

const TASK = 'TASK-RC-0001';
const UPPER = `sha256:${'AB'.repeat(32)}`;
const LOWER = `sha256:${'ab'.repeat(32)}`;

function git(cwd: string, args: string[]) {
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function createRepo(): { cwd: string; evidencePath: string } {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-repair-closure-'));
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'rc-probe']);
  git(cwd, ['config', 'user.email', 'rc-probe@example.invalid']);
  writeFileSync(path.join(cwd, 'delivered.txt'), 'delivered\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '--no-verify', '-m', 'deliver']);
  const history = path.join(cwd, '.atm', 'history');
  mkdirSync(path.join(history, 'tasks'), { recursive: true });
  mkdirSync(path.join(history, 'evidence'), { recursive: true });
  writeFileSync(path.join(history, 'tasks', `${TASK}.json`), `${JSON.stringify({ taskId: TASK, status: 'done' }, null, 2)}\n`);
  writeFileSync(path.join(history, 'evidence', `${TASK}.closure-packet.json`), `${JSON.stringify({ schemaId: 'atm.closurePacket.v1', taskId: TASK }, null, 2)}\n`);
  const evidencePath = path.join(history, 'evidence', `${TASK}.json`);
  // Legitimate existing evidence whose digest only differs in case: normalization would rewrite it.
  writeFileSync(evidencePath, `${JSON.stringify({ taskId: TASK, evidence: [{ commandRuns: [{ command: 'npm test', exitCode: 0, stdoutSha256: UPPER, stderrSha256: UPPER }] }] }, null, 2)}\n`);
  return { cwd, evidencePath };
}

function attempt(run: () => unknown): Record<string, unknown> | null {
  try {
    return run() as Record<string, unknown>;
  } catch {
    // The fixture packet is incomplete, so repair may stop later; only file effects matter here.
    return null;
  }
}

// Preview: the evidence file is byte-for-byte unchanged, whether or not the preview succeeds.
{
  const { cwd, evidencePath } = createRepo();
  try {
    const before = readFileSync(evidencePath);
    const result = attempt(() => repairClosurePacketForTask({ cwd, taskId: TASK, dryRun: true }));
    assert.deepEqual(readFileSync(evidencePath), before, 'repair-closure --dry-run must not write normalized evidence');
    if (result) assert.equal(result.upstreamEvidenceNormalized, true, 'preview still reports that normalization would apply');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// Real repair still normalizes the evidence digest.
{
  const { cwd, evidencePath } = createRepo();
  try {
    attempt(() => repairClosurePacketForTask({ cwd, taskId: TASK, dryRun: false }));
    const after = readFileSync(evidencePath, 'utf8');
    assert.ok(after.includes(LOWER) && !after.includes(UPPER), 'write mode normalizes the evidence digest');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

console.log('ok: repair-closure preview leaves evidence untouched');
