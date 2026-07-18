/**
 * ATM-GOV-0167 — dual-lane end-to-end acceptance (fixture + spawn CLI).
 * Asserts post-0168 behavior: same-actor different-lane LOCK_CONFLICT,
 * TTL adopt rebind with preserved lease, and analyzer laneEvidence concurrency.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const atmCliEntrypoint = path.join(root, 'packages/cli/src/atm.ts');
const analyzeScript = path.join(root, 'scripts/analyze-captain-parallel-ledger.ts');
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-lane-dual-e2e-'));
const actor = 'fixture-dual-captain';

type AtmJson = {
  ok?: boolean;
  messages?: Array<{ code?: string; data?: Record<string, unknown> }>;
  evidence?: Record<string, unknown>;
  diagnostics?: { errorCodes?: string[] };
};

function runAtm(args: string[], env: NodeJS.ProcessEnv = {}): {
  status: number | null;
  json: AtmJson | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    process.execPath,
    ['--strip-types', atmCliEntrypoint, ...args, '--cwd', repo, '--json'],
    {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, ATM_ACTOR_ID: actor, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  const payload = (result.stdout || '').trim() || (result.stderr || '').trim();
  let json: AtmJson | null = null;
  try {
    json = JSON.parse(payload) as AtmJson;
  } catch {
    json = null;
  }
  return { status: result.status, json, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function writeJson(relativePath: string, value: unknown): void {
  const absolutePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeTask(taskId: string): void {
  writeJson(`.atm/history/tasks/${taskId}.json`, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: taskId,
    status: 'ready',
    owner: actor,
    scopePaths: [`.atm/history/tasks/${taskId}.json`],
    deliverables: [`.atm/history/tasks/${taskId}.json`]
  });
}

function firstCode(json: AtmJson | null): string | null {
  return json?.messages?.[0]?.code
    ?? json?.diagnostics?.errorCodes?.[0]
    ?? null;
}

function messageData(json: AtmJson | null, code: string): Record<string, unknown> | null {
  const hit = json?.messages?.find((message) => message.code === code);
  return hit?.data ?? null;
}

try {
  mkdirSync(path.join(repo, '.atm/runtime/identity/actors'), { recursive: true });
  writeJson(`.atm/runtime/identity/actors/${actor}.json`, {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: actor,
    editor: 'cursor',
    gitName: 'Fixture Dual',
    gitEmail: 'fixture-dual@example.invalid',
    provider: 'cursor',
    activeSessionId: null,
    updatedAt: '2026-07-18T00:00:00.000Z'
  });
  writeJson('.atm/config.json', {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: {
      enabled: true,
      mode: 'auto',
      mirrorExternalTasks: true,
      requireCliTransitions: true,
      provider: 'atm-local'
    }
  });
  writeTask('TASK-DUAL-T1');
  writeTask('TASK-DUAL-T2');

  // Step 1 — two environments mint distinct lane ids
  const laneAStatus = runAtm(['lane', 'status', '--actor', actor], { ATM_LANE_SESSION_ID: '' });
  const laneBStatus = runAtm(['lane', 'status', '--actor', actor], { ATM_LANE_SESSION_ID: '' });
  const laneA = String(
    (laneAStatus.json?.evidence?.session as { laneId?: string } | undefined)?.laneId
      ?? messageData(laneAStatus.json, 'ATM_LANE_SESSION_STATUS')?.laneSessionId
      ?? messageData(laneAStatus.json, 'ATM_LANE_SESSION_MINTED')?.laneSessionId
      ?? ''
  );
  const laneB = String(
    (laneBStatus.json?.evidence?.session as { laneId?: string } | undefined)?.laneId
      ?? messageData(laneBStatus.json, 'ATM_LANE_SESSION_STATUS')?.laneSessionId
      ?? messageData(laneBStatus.json, 'ATM_LANE_SESSION_MINTED')?.laneSessionId
      ?? ''
  );
  const step1 = {
    laneA,
    laneB,
    distinct: Boolean(laneA && laneB && laneA !== laneB),
    codesA: (laneAStatus.json?.messages || []).map((message) => message.code),
    codesB: (laneBStatus.json?.messages || []).map((message) => message.code)
  };
  console.log('STEP1', JSON.stringify(step1, null, 2));
  assert.ok(step1.distinct, `expected distinct lane ids, got ${laneA} / ${laneB}`);

  // Step 2 — lane A claims T1, lane B claims T2
  const claimT1 = runAtm(
    ['tasks', 'claim', '--task', 'TASK-DUAL-T1', '--actor', actor],
    { ATM_LANE_SESSION_ID: laneA }
  );
  const claimT2 = runAtm(
    ['tasks', 'claim', '--task', 'TASK-DUAL-T2', '--actor', actor],
    { ATM_LANE_SESSION_ID: laneB }
  );
  const t1LeaseBefore = (
    JSON.parse(readFileSync(path.join(repo, '.atm/history/tasks/TASK-DUAL-T1.json'), 'utf8')) as {
      claim?: { leaseId?: string };
    }
  ).claim?.leaseId ?? null;
  const step2 = {
    t1Ok: claimT1.json?.ok === true,
    t2Ok: claimT2.json?.ok === true,
    t1Codes: (claimT1.json?.messages || []).map((message) => message.code),
    t2Codes: (claimT2.json?.messages || []).map((message) => message.code),
    t1LeaseBefore
  };
  console.log('STEP2', JSON.stringify(step2, null, 2));
  assert.equal(claimT1.json?.ok, true, `T1 claim failed: ${firstCode(claimT1.json)}`);
  assert.equal(claimT2.json?.ok, true, `T2 claim failed: ${firstCode(claimT2.json)}`);
  assert.ok(t1LeaseBefore, 'T1 claim must stamp a leaseId');

  // Overlapping lane activity (CLI-emitted session-events). Mint does not append
  // session-events today; heartbeat does. Two heartbeats per lane create a
  // non-zero window so analyzer laneEvidence can measure concurrency.
  const heartbeat = (laneId: string) => {
    const result = runAtm(['lane', 'heartbeat', laneId, '--actor', actor], {
      ATM_LANE_SESSION_ID: laneId
    });
    assert.equal(result.json?.ok, true, `heartbeat ${laneId} failed: ${firstCode(result.json)}`);
  };
  heartbeat(laneA);
  heartbeat(laneB);
  const waitUntil = Date.now() + 50;
  while (Date.now() < waitUntil) {
    /* ensure distinct heartbeat timestamps across lanes */
  }
  heartbeat(laneA);
  heartbeat(laneB);

  // Step 3 — lane B steals T1 → LOCK_CONFLICT + holdingLaneSessionId + adopt hint
  const conflict = runAtm(
    ['tasks', 'claim', '--task', 'TASK-DUAL-T1', '--actor', actor],
    { ATM_LANE_SESSION_ID: laneB }
  );
  const conflictCode = firstCode(conflict.json);
  const conflictData = messageData(conflict.json, 'ATM_LOCK_CONFLICT')
    ?? (conflict.json?.messages?.[0]?.data ?? null);
  const step3 = {
    ok: conflict.json?.ok,
    code: conflictCode,
    holdingLaneSessionId: conflictData?.holdingLaneSessionId ?? null,
    requestedLaneSessionId: conflictData?.requestedLaneSessionId ?? null,
    laneAdoptCommand: conflictData?.laneAdoptCommand ?? null,
    recoveryHint: conflictData?.recoveryHint ?? null
  };
  console.log('STEP3', JSON.stringify(step3, null, 2));
  assert.equal(conflict.json?.ok, false);
  assert.equal(conflictCode, 'ATM_LOCK_CONFLICT');
  assert.equal(conflictData?.holdingLaneSessionId, laneA);
  assert.equal(conflictData?.requestedLaneSessionId, laneB);
  assert.match(String(conflictData?.laneAdoptCommand ?? ''), new RegExp(`lane adopt ${laneA}`));
  assert.match(String(conflictData?.recoveryHint ?? ''), /adopt|handoff/i);

  // Step 4 — expire lane A TTL → lane B adopt; work session/claim rebind; lease unchanged
  const laneAPath = path.join(repo, '.atm/runtime/lane-sessions', `${laneA}.json`);
  assert.ok(existsSync(laneAPath), `missing lane session file ${laneAPath}`);
  const laneADoc = JSON.parse(readFileSync(laneAPath, 'utf8')) as Record<string, unknown>;
  laneADoc.expiresAt = '2020-01-01T00:00:00.000Z';
  writeFileSync(laneAPath, `${JSON.stringify(laneADoc, null, 2)}\n`, 'utf8');

  const adopt = runAtm(
    ['lane', 'adopt', laneA, '--actor', actor, '--reason', 'ttl-death-e2e'],
    { ATM_LANE_SESSION_ID: laneB }
  );
  const adoptData = messageData(adopt.json, 'ATM_LANE_SESSION_ADOPTED');
  const rebind = (adopt.json?.evidence?.rebind ?? adoptData) as {
    preservedLeaseIds?: string[];
    reboundTaskIds?: string[];
    reboundSessionIds?: string[];
  } | null;
  const taskAfter = JSON.parse(readFileSync(path.join(repo, '.atm/history/tasks/TASK-DUAL-T1.json'), 'utf8')) as {
    claim?: {
      leaseId?: string;
      actorId?: string;
      laneSession?: { laneSessionId?: string; status?: string };
    };
  };
  const step4 = {
    ok: adopt.json?.ok === true,
    codes: (adopt.json?.messages || []).map((message) => message.code),
    authorization: adopt.json?.evidence?.authorization ?? adoptData?.authorization ?? null,
    preservedLeaseIds: rebind?.preservedLeaseIds ?? null,
    reboundTaskIds: rebind?.reboundTaskIds ?? null,
    reboundSessionIds: rebind?.reboundSessionIds ?? null,
    claimLeaseAfter: taskAfter.claim?.leaseId ?? null,
    claimLaneAfter: taskAfter.claim?.laneSession ?? null
  };
  console.log('STEP4', JSON.stringify(step4, null, 2));
  assert.equal(adopt.json?.ok, true, `adopt failed: ${firstCode(adopt.json)}`);
  assert.ok((adopt.json?.messages || []).some((message) => message.code === 'ATM_LANE_SESSION_ADOPTED'));
  assert.deepEqual(rebind?.preservedLeaseIds, [t1LeaseBefore]);
  assert.ok(rebind?.reboundTaskIds?.includes('TASK-DUAL-T1'));
  assert.ok(Array.isArray(rebind?.reboundSessionIds) && rebind!.reboundSessionIds!.length > 0);
  assert.equal(taskAfter.claim?.leaseId, t1LeaseBefore);
  assert.equal(taskAfter.claim?.laneSession?.laneSessionId, laneA);
  assert.equal(taskAfter.claim?.laneSession?.status, 'adopted');

  // Step 5 — analyzer laneEvidence.maxConcurrency from lane-session overlap (not wave pattern)
  const eventsRoot = path.join(repo, '.atm/history/session-events');
  const analyze = spawnSync(
    process.execPath,
    [
      '--strip-types',
      analyzeScript,
      '--event-root', path.join(repo, '.atm/history/task-events'),
      '--session-event-root', eventsRoot,
      '--lock-root', path.join(repo, '.atm/runtime/locks')
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  assert.equal(analyze.status, 0, analyze.stderr || analyze.stdout);
  const analyzed = JSON.parse(analyze.stdout) as {
    laneEvidence?: { maxConcurrency?: number; overlapMs?: number; laneCount?: number };
    parallel?: { maxConcurrency?: number };
  };
  const step5 = {
    eventsRootExists: existsSync(eventsRoot),
    laneDirs: existsSync(eventsRoot) ? readdirSync(eventsRoot) : [],
    laneEvidence: analyzed.laneEvidence ?? null,
    waveMaxConcurrency: analyzed.parallel?.maxConcurrency ?? null
  };
  console.log('STEP5', JSON.stringify(step5, null, 2));
  assert.ok(analyzed.laneEvidence, 'missing laneEvidence');
  assert.equal(analyzed.laneEvidence!.laneCount, 2);
  assert.equal(analyzed.laneEvidence!.maxConcurrency, 2);
  assert.ok((analyzed.laneEvidence!.overlapMs ?? 0) > 0);

  console.log('[lane-dual-session-e2e] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
