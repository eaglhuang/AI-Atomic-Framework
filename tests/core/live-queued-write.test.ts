import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyLiveQueuedWrites } from '../../packages/core/src/live-write/live-queued-write.ts';
import type { PatchProposal } from '../../packages/core/src/broker/types.ts';
import { runBroker } from '../../packages/cli/src/commands/broker.ts';

const BASE = 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\n';

if (process.env.LIVE_WRITE_STRESS_WORKER === '1') {
  runStressWorker(process.env.LIVE_WRITE_WORKER_ID || '0', process.env.LIVE_WRITE_WORKDIR || '');
} else {
  await main();
}

async function main() {
  const repo = makeRepo(BASE);
  const head = git(repo, ['rev-parse', 'HEAD']);
  const originalHash = hashText(BASE);

  const first = proposal({ id: 'writer-1', actor: 'session-1', hash: originalHash, head, patch: replaceLine(BASE, 'beta', 'beta-one') });
  const overlapping = proposal({
    id: 'writer-2',
    actor: 'session-2',
    hash: originalHash,
    head,
    patch: overlappingDeltaPatch()
  });
  const together = applyLiveQueuedWrites({ cwd: repo, proposals: [first, overlapping], scopeFiles: ['shared.py'] });
  assert.equal(together.planRequired, false);
  assert.equal(together.writes[0]?.decision, 'accepted');
  assert.equal(together.writes[1]?.decision, 'rejected-by-design');
  assert.equal(together.writes[1]?.reasonCode, 'overlapping-write-queued');
  assert.equal(together.writes[1]?.queued, true);
  assert.equal(together.writes[1]?.currentFileText, readFileSync(path.join(repo, 'shared.py'), 'utf8'));
  const afterFirst = readFileSync(path.join(repo, 'shared.py'), 'utf8');
  assert.match(afterFirst, /beta-one/);
  assert.doesNotMatch(afterFirst, /delta-two/);

  const recomposed = proposal({
    id: 'writer-2-retry',
    actor: 'session-2',
    hash: hashText(afterFirst),
    head: git(repo, ['rev-parse', 'HEAD']),
    patch: replaceLine(afterFirst, 'delta', 'delta-two')
  });
  const second = applyLiveQueuedWrites({ cwd: repo, proposals: [recomposed], scopeFiles: ['shared.py'] });
  assert.equal(second.writes[0]?.decision, 'accepted');
  const finalText = readFileSync(path.join(repo, 'shared.py'), 'utf8');
  assert.match(finalText, /beta-one/);
  assert.match(finalText, /delta-two/);

  const disjointRepo = makeRepo(BASE);
  const disjointHash = hashText(BASE);
  const disjointHead = git(disjointRepo, ['rev-parse', 'HEAD']);
  const disjoint = applyLiveQueuedWrites({
    cwd: disjointRepo,
    scopeFiles: ['shared.py'],
    proposals: [
      proposal({ id: 'beta', actor: 'a', hash: disjointHash, head: disjointHead, patch: replaceLine(BASE, 'beta', 'beta-one') }),
      proposal({ id: 'zeta', actor: 'b', hash: disjointHash, head: disjointHead, patch: replaceLine(BASE, 'zeta', 'zeta-two') })
    ]
  });
  assert.deepEqual(disjoint.writes.map((write) => write.decision), ['accepted', 'accepted']);
  const disjointText = readFileSync(path.join(disjointRepo, 'shared.py'), 'utf8');
  assert.match(disjointText, /beta-one/);
  assert.match(disjointText, /zeta-two/);
  assert.equal(readQueue(disjointRepo).length, 0);

  const staleRepo = makeRepo(BASE);
  const staleHash = hashText(BASE);
  writeFileSync(path.join(staleRepo, 'shared.py'), 'alpha\nbeta\ngamma\ndelta\nepsilon\nzeta\nextra\n');
  git(staleRepo, ['add', '--', 'shared.py']);
  git(staleRepo, ['-c', 'user.name=atm', '-c', 'user.email=atm@example.com', 'commit', '-m', 'out of band']);
  const beforeStale = readFileSync(path.join(staleRepo, 'shared.py'), 'utf8');
  const stale = applyLiveQueuedWrites({
    cwd: staleRepo,
    scopeFiles: ['shared.py'],
    proposals: [proposal({
      id: 'stale',
      actor: 'stale',
      hash: staleHash,
      head: git(staleRepo, ['rev-parse', 'HEAD']),
      patch: replaceLine(BASE, 'beta', 'beta-stale')
    })]
  });
  assert.equal(stale.writes[0]?.decision, 'rejected-by-design');
  assert.equal(stale.writes[0]?.reasonCode, 'stale-base');
  assert.equal(stale.writes[0]?.queued, true);
  assert.equal(readFileSync(path.join(staleRepo, 'shared.py'), 'utf8'), beforeStale);
  assert.equal(stale.writes[0]?.currentFileText, beforeStale);

  const cliRepo = makeRepo(BASE);
  const cliHash = hashText(BASE);
  const cliHead = git(cliRepo, ['rev-parse', 'HEAD']);
  writeFileSync(path.join(cliRepo, 'proposal.json'), `${JSON.stringify(proposal({
    id: 'cli-1',
    actor: 'cli',
    hash: cliHash,
    head: cliHead,
    patch: replaceLine(BASE, 'beta', 'beta-cli')
  }))}\n`);
  const missingPlan = await runBroker(['steward', 'apply', '--cwd', cliRepo, '--proposal-file', 'proposal.json', '--scope-file', 'shared.py']).catch((error) => error);
  assert.match(String(missingPlan?.message ?? missingPlan), /merge-plan-file/);
  const live = await runBroker(['steward', 'apply-live', '--cwd', cliRepo, '--proposal-file', 'proposal.json', '--scope-file', 'shared.py']);
  const liveEvidence = live.evidence as { planRequired?: boolean; liveWrites?: { decision?: string }[] };
  assert.equal(live.ok, true);
  assert.equal(liveEvidence.planRequired, false);
  assert.equal(liveEvidence.liveWrites?.[0]?.decision, 'accepted');
  assert.match(readFileSync(path.join(cliRepo, 'shared.py'), 'utf8'), /beta-cli/);

  // Strict parser failures never write or queue a malformed proposal.
  for (const patch of [
    '@@ -1 +1 @@\n-alpha\nunprefixed\n+ALPHA\n',
    '', '--- a/shared.py\n+++ b/shared.py\n',
    '--- a/other.py\n+++ b/other.py\n@@ -1 +1 @@\n-alpha\n+ALPHA\n',
    replaceLine(BASE, 'alpha', 'ALPHA') + '--- a/second.py\n+++ b/second.py\n@@ -1 +1 @@\n-x\n+y\n'
  ]) {
    const malformedRepo = makeRepo(BASE);
    const result = applyLiveQueuedWrites({ cwd: malformedRepo, proposals: [proposal({
      id: 'malformed', actor: 'a', hash: hashText(BASE), head: git(malformedRepo, ['rev-parse', 'HEAD']), patch
    })] });
    assert.equal(result.writes[0]?.reasonCode, 'patch-malformed');
    assert.equal(result.writes[0]?.queued, false);
    assert.equal(result.writes[0]?.hunkOffsets, null);
    assert.equal(readFileSync(path.join(malformedRepo, 'shared.py'), 'utf8'), BASE);
  }
  {
    const noopRepo = makeRepo(BASE);
    const result = applyLiveQueuedWrites({ cwd: noopRepo, proposals: [proposal({
      id: 'noop', actor: 'a', hash: hashText(BASE), head: git(noopRepo, ['rev-parse', 'HEAD']), patch: '@@ -1 +1 @@\n alpha\n'
    })] });
    assert.equal(result.writes[0]?.reasonCode, 'no-op-patch');
    assert.equal(result.writes[0]?.decision, 'rejected-by-design');
    assert.equal(readFileSync(path.join(noopRepo, 'shared.py'), 'utf8'), BASE);
  }
  {
    const offsetRepo = makeRepo(BASE);
    const result = applyLiveQueuedWrites({ cwd: offsetRepo, proposals: [proposal({
      id: 'offset', actor: 'a', hash: hashText(BASE), head: git(offsetRepo, ['rev-parse', 'HEAD']),
      patch: replaceLine(BASE, 'beta', 'BETA').replace('@@ -2,1 +2,1 @@', '@@ -1,1 +1,1 @@')
    })] });
    assert.equal(result.writes[0]?.decision, 'accepted');
    assert.deepEqual(result.writes[0]?.hunkOffsets, [{ declaredOldStart: 1, appliedOldStart: 2, offset: 1 }]);
    const entry = JSON.parse(readFileSync(path.join(offsetRepo, '.atm/runtime/live-write-journal.jsonl'), 'utf8').trim());
    assert.deepEqual(entry.changedLines, [1, 2]);
  }
  {
    const repeated = 'a\nb\nb\nc\n';
    const repeatedRepo = makeRepo(repeated);
    const head = git(repeatedRepo, ['rev-parse', 'HEAD']);
    const result = applyLiveQueuedWrites({ cwd: repeatedRepo, proposals: [
      proposal({ id: 'top', actor: 'a', hash: hashText(repeated), head, patch: '@@ -0,0 +1 @@\n+top\n' }),
      proposal({ id: 'stale-repeated', actor: 'b', hash: hashText(repeated), head, patch: '@@ -2 +2 @@\n-b\n+B\n' })
    ] });
    assert.equal(result.writes[0]?.decision, 'accepted');
    assert.equal(result.writes[1]?.reasonCode, 'stale-base');
    assert.equal(result.writes[1]?.hunkOffsets, null);
    assert.equal(readFileSync(path.join(repeatedRepo, 'shared.py'), 'utf8'), `top\n${repeated}`);
  }

  {
    // Overlap is measured in the declared base after locating offset headers.
    const baseRepo = makeRepo(BASE);
    const head = git(baseRepo, ['rev-parse', 'HEAD']);
    const result = applyLiveQueuedWrites({ cwd: baseRepo, proposals: [
      proposal({ id: 'base-beta', actor: 'a', hash: hashText(BASE), head, patch: replaceLine(BASE, 'beta', 'BETA') }),
      proposal({ id: 'offset-delta', actor: 'b', hash: hashText(BASE), head,
        patch: replaceLine(BASE, 'delta', 'DELTA').replace('@@ -4,1 +4,1 @@', '@@ -2,1 +2,1 @@') })
    ] });
    assert.deepEqual(result.writes.map((write) => write.decision), ['accepted', 'accepted']);
    assert.equal(result.writes[1]?.hunkOffsets?.[0]?.offset, 2);
  }
  {
    // Stale overlap check: an offset header that really edits a committed line is
    // classified at its located base position, so it queues instead of stale-base.
    const overlapRepo = makeRepo(BASE);
    const head = git(overlapRepo, ['rev-parse', 'HEAD']);
    const result = applyLiveQueuedWrites({ cwd: overlapRepo, proposals: [
      proposal({ id: 'beta-one', actor: 'a', hash: hashText(BASE), head, patch: replaceLine(BASE, 'beta', 'beta-one') }),
      proposal({ id: 'beta-two-offset', actor: 'b', hash: hashText(BASE), head,
        patch: replaceLine(BASE, 'beta', 'beta-two').replace('@@ -2,1 +2,1 @@', '@@ -3,1 +3,1 @@') })
    ] });
    assert.equal(result.writes[0]?.decision, 'accepted');
    assert.equal(result.writes[1]?.reasonCode, 'overlapping-write-queued');
    assert.equal(result.writes[1]?.queued, true);
    assert.match(readFileSync(path.join(overlapRepo, 'shared.py'), 'utf8'), /beta-one/);
  }
  {
    // A stale write journals current coordinates and the current preimage hash.
    const shiftedRepo = makeRepo(BASE);
    const head = git(shiftedRepo, ['rev-parse', 'HEAD']);
    const result = applyLiveQueuedWrites({ cwd: shiftedRepo, proposals: [
      proposal({ id: 'insert-top', actor: 'a', hash: hashText(BASE), head, patch: '@@ -0,0 +1 @@\n+top\n' }),
      proposal({ id: 'shifted-beta', actor: 'b', hash: hashText(BASE), head, patch: replaceLine(BASE, 'beta', 'BETA') })
    ] });
    assert.deepEqual(result.writes.map((write) => write.decision), ['accepted', 'accepted']);
    assert.equal(result.writes[1]?.hunkOffsets?.[0]?.offset, 1);
    const entries = readFileSync(path.join(shiftedRepo, '.atm/runtime/live-write-journal.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(entries[1].changedLines, [2, 3]);
    assert.equal(entries[1].baseHash, hashText(`top\n${BASE}`));
  }

  const stress = await runStress();
  console.log(JSON.stringify({ overlap: 'writer-1 accepted, writer-2 queued then accepted', stale: 'stale-base', stress }, null, 2));
  console.log('live queued write ok');
}

function runStress() {
  const repo = makeRepo('seed\n');
  const workers = 4;
  const iterations = 50;
  const children: Promise<{ status: number | null; stdout: string; stderr: string }>[] = [];
  for (let worker = 0; worker < workers; worker += 1) {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      env: {
        ...process.env,
        LIVE_WRITE_STRESS_WORKER: '1',
        LIVE_WRITE_WORKER_ID: String(worker),
        LIVE_WRITE_WORKDIR: repo,
        LIVE_WRITE_ITERATIONS: String(iterations)
      }
    });
    children.push(new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    }));
  }
  return Promise.all(children).then((results) => {
    const failures = results.filter((child) => child.status !== 0);
    assert.equal(failures.length, 0, failures.map((child) => `${child.stdout}\n${child.stderr}`).join('\n'));
    const text = readFileSync(path.join(repo, 'shared.py'), 'utf8');
    const missing = [];
    for (let worker = 0; worker < workers; worker += 1) {
      for (let iteration = 0; iteration < iterations; iteration += 1) {
        const token = `w${worker}-i${iteration}`;
        if (!text.includes(token)) missing.push(token);
      }
    }
    assert.deepEqual(missing, []);
    const recomposes = results.reduce((sum, child) => sum + Number(child.stdout.trim().split('\n').pop()), 0);
    return { writers: workers, iterations, missing: missing.length, recomposes };
  });
}

function runStressWorker(workerId: string, cwd: string) {
  const iterations = Number(process.env.LIVE_WRITE_ITERATIONS || 50);
  let recomposes = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const token = `w${workerId}-i${iteration}`;
    const deadline = Date.now() + 45_000;
    let accepted = false;
    let attempts = 0;
    while (Date.now() < deadline) {
      attempts += 1;
      const text = readFileSync(path.join(cwd, 'shared.py'), 'utf8');
      const head = git(cwd, ['rev-parse', 'HEAD']);
      const result = applyLiveQueuedWrites({
        cwd,
        scopeFiles: ['shared.py'],
        proposals: [proposal({
          id: `${token}-a${attempts}`,
          actor: `worker-${workerId}`,
          hash: hashText(text),
          head,
          patch: appendLine(text, token)
        })]
      });
      const write = result.writes[0];
      if (write?.decision === 'accepted') {
        accepted = true;
        break;
      }
      recomposes += 1;
      assert.equal(write?.decision, 'rejected-by-design', JSON.stringify(write));
      assert.ok(write?.reasonCode === 'overlapping-write-queued' || write?.reasonCode === 'stale-base', String(write?.reasonCode ?? ''));
      assert.equal(write?.queued, true);
      assert.equal(typeof write?.currentFileText, 'string');
    }
    if (!accepted) throw new Error(`lost write ${token} after ${attempts} attempts`);
  }
  process.stdout.write(`${recomposes}\n`);
}

function makeRepo(text: string): string {
  const cwd = mkdtempSync(path.join(tmpdir(), 'live-write-'));
  writeFileSync(path.join(cwd, 'shared.py'), text);
  git(cwd, ['init', '-q']);
  git(cwd, ['add', '--', 'shared.py']);
  git(cwd, ['-c', 'user.name=atm', '-c', 'user.email=atm@example.com', 'commit', '-q', '-m', 'base']);
  return cwd;
}

function proposal(input: { id: string; actor: string; hash: string; head: string; patch: string }): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'live queued write test' },
    proposalId: input.id,
    taskId: input.id,
    actorId: input.actor,
    baseCommit: input.head,
    fileBeforeHash: input.hash,
    targetFile: 'shared.py',
    atomRefs: [{ atomId: `atom-${input.id}`, atomCid: `cid-${input.id}` }],
    anchors: [{ kind: 'line-range', hint: '1-1' }],
    intent: input.id,
    patch: input.patch,
    validators: ['live-queued-write'],
    rollback: 'restore'
  };
}

function replaceLine(text: string, before: string, after: string): string {
  const lines = text.split('\n');
  const index = lines.indexOf(before);
  if (index < 0) throw new Error(`missing ${before}`);
  const lineNo = index + 1;
  return `diff --git a/shared.py b/shared.py\n--- a/shared.py\n+++ b/shared.py\n@@ -${lineNo},1 +${lineNo},1 @@\n-${before}\n+${after}\n`;
}

function overlappingDeltaPatch(): string {
  return `diff --git a/shared.py b/shared.py\n--- a/shared.py\n+++ b/shared.py\n@@ -2,3 +2,3 @@\n beta\n gamma\n-delta\n+delta-two\n`;
}

function appendLine(text: string, line: string): string {
  const normalized = text.endsWith('\n') ? text.slice(0, -1) : text;
  const lines = normalized.split('\n');
  const lastNo = lines.length;
  const last = lines[lastNo - 1];
  return `diff --git a/shared.py b/shared.py\n--- a/shared.py\n+++ b/shared.py\n@@ -${lastNo},1 +${lastNo},2 @@\n ${last}\n+${line}\n`;
}

function hashText(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

function readQueue(cwd: string): unknown[] {
  const file = path.join(cwd, '.atm', 'runtime', 'live-write-queue.jsonl');
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}
