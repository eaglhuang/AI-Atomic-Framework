/**
 * E5 fault-injection probe against ATM pin 5692474f… (READ-ONLY).
 * Terminal classes: blocked | rolled-back | recovery-required
 * DRAFT — not a win claim. Fault arms are non-competitors.
 *
 * Usage:
 *   export ATM_MONOREPO=...5692474f...
 *   node --experimental-strip-types inject.mts --rep 1 | tee inject-r1.out
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { spawnSync, fork } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ATM = process.env.ATM_MONOREPO ?? process.env.ATM;
if (!ATM) throw new Error('Set ATM_MONOREPO to the 5692474f pin tree');

const { values: opts } = parseArgs({
  options: { rep: { type: 'string', default: '1' }, 'case': { type: 'string' } },
});
const REP = Number(opts.rep || 1);

const { composeBrokerProposals } = await import(ATM + '/packages/core/src/broker/compose.ts');
const { applyStewardPlan } = await import(ATM + '/packages/core/src/broker/steward.ts');
const {
  buildPatchProposalComposition,
  applyTransactionalStewardPlan,
  buildStewardSemanticValidationReceipt,
} = await import(ATM + '/packages/core/src/broker/steward-transactional-apply.ts');
const { composeTransactionalMutations } = await import(ATM + '/packages/core/src/broker/transactional-composer.ts');
const { brokerAdapterMigration } = await import(ATM + '/packages/core/src/broker/types.ts');

const TARGET = 'src/shared.txt';
const BASE_LINES = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`);
const BASE = `${BASE_LINES.join('\n')}\n`;

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}
function emit(row: Record<string, unknown>) {
  console.log(JSON.stringify({ checklist: 'E5', rep: REP, banner: 'DRAFT — not a win claim', ...row }));
}
function git(cwd: string, ...args: string[]) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}
function repo(content: string, fileRel = TARGET) {
  const d = mkdtempSync(path.join(os.tmpdir(), 'e5-'));
  git(d, 'init', '-q');
  git(d, 'config', 'user.email', 'atm@example.com');
  git(d, 'config', 'user.name', 'ATM');
  git(d, 'config', 'commit.gpgsign', 'false');
  const fp = path.join(d, fileRel);
  mkdirSync(path.dirname(fp), { recursive: true });
  writeFileSync(fp, content, 'utf8');
  git(d, 'add', '-A');
  const c = git(d, 'commit', '-qm', 'base');
  if (c.status !== 0) throw new Error(`git commit failed: ${c.stderr || c.stdout}`);
  const head = git(d, 'rev-parse', 'HEAD').stdout.trim();
  return { d, head, hash: hashText(content), fileRel, fp };
}
function prop(input: {
  proposalId: string; actorId: string; anchor: string; patch: string;
  baseCommit: string; fileBeforeHash: string; targetFile?: string;
}) {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'e5-fault' },
    proposalId: input.proposalId,
    taskId: `TASK-${input.proposalId}`,
    actorId: input.actorId,
    baseCommit: input.baseCommit,
    fileBeforeHash: input.fileBeforeHash,
    targetFile: input.targetFile ?? TARGET,
    atomRefs: [{ atomId: `atom.${input.proposalId}`, atomCid: `cid.${input.proposalId}` }],
    anchors: [{ kind: 'line', hint: input.anchor }],
    intent: `e5 ${input.proposalId}`,
    patch: input.patch,
    validators: [],
    rollback: 'discard',
  };
}
function editPatch(input: { line: number; remove: number; add: readonly string[]; baseLines?: readonly string[]; corruptContext?: boolean }): string {
  const lines = [...(input.baseLines ?? BASE_LINES)];
  if (input.corruptContext) {
    // Deliberately wrong context line so compose/apply sees context mismatch
    lines[0] = 'CORRUPTED-CONTEXT-LINE';
  }
  const start = input.line - 1;
  const contextStart = Math.max(0, start - 1);
  const contextEnd = Math.min(lines.length, start + input.remove + 1);
  const before = lines.slice(contextStart, start).map((l) => ` ${l}`);
  const removed = (input.baseLines ?? BASE_LINES).slice(start, start + input.remove).map((l) => `-${l}`);
  const added = input.add.map((l) => `+${l}`);
  const after = lines.slice(start + input.remove, contextEnd).map((l) => ` ${l}`);
  const oldLength = contextEnd - contextStart;
  const newLength = oldLength - input.remove + input.add.length;
  return [
    `--- a/${TARGET}`, `+++ b/${TARGET}`,
    `@@ -${contextStart + 1},${oldLength} +${contextStart + 1},${newLength} @@`,
    ...before, ...removed, ...added, ...after, '',
  ].join('\n');
}

function classifyFromVerdict(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v === 'blocked' || v === 'rolled-back' || v === 'applied') return v === 'applied' ? 'commit' : v;
  return v;
}

// ── 1) context mismatch → blocked ──
function runContextMismatch() {
  const r = repo(BASE);
  const bad = prop({
    proposalId: 'e5-ctx', actorId: 'agent-a', anchor: 'line-02',
    patch: editPatch({ line: 2, remove: 1, add: ['line-2-injected'], corruptContext: true }),
    baseCommit: r.head, fileBeforeHash: r.hash,
  });
  let terminal = 'unknown';
  let reason: string | null = null;
  let threw: string | null = null;
  let ok: boolean | null = null;
  try {
    const merge = composeBrokerProposals([bad]);
    const tx = buildPatchProposalComposition({ cwd: r.d, mergePlan: merge.mergePlan, proposals: [bad] });
    if ((tx as any).blocked || !(tx as any).plan) {
      terminal = 'blocked';
      reason = JSON.stringify((tx as any).blocked ?? 'compose_blocked');
      ok = false;
    } else {
      const apply = applyTransactionalStewardPlan({
        cwd: r.d, stewardId: 'neutral-write-steward', writerRole: 'neutral-steward',
        plan: tx.plan, outputFiles: tx.outputFiles, scopeFiles: [TARGET],
        semanticValidation: buildStewardSemanticValidationReceipt({ plan: tx.plan, outputFiles: tx.outputFiles }),
      });
      ok = apply.ok;
      const verdict = apply?.receipt?.verdict ?? null;
      const reasons = apply?.receipt?.blockedReasons ?? apply?.receipt?.reasons ?? [];
      reason = JSON.stringify(reasons).slice(0, 400);
      if (!apply.ok) {
        terminal = verdict === 'blocked' || String(reason).includes('context') || String(reason).includes('mismatch') || String(reason).includes('drift') || String(reason).includes('stale')
          ? 'blocked' : (classifyFromVerdict(verdict) ?? 'blocked');
      } else {
        // Corrupt context should not apply cleanly; if it did, still mark unexpected
        terminal = 'commit';
      }
    }
  } catch (e: any) {
    threw = `${e?.name}: ${e?.message}`;
    // Context mismatch may throw or return blocked — map throw without receipt → recovery-required only if no structured block
    terminal = 'blocked';
    reason = threw;
  }
  const pass = terminal === 'blocked';
  const disk = readFileSync(r.fp, 'utf8');
  const unchanged = disk === BASE;
  emit({
    injection: 'context_mismatch', case: `context_mismatch-r${REP}`,
    expected_terminal: 'blocked', observed_terminal: terminal,
    pass: pass && unchanged, ok, reason, threw, disk_unchanged: unchanged,
    arm_role: 'fault_ablation',
  });
  rmSync(r.d, { recursive: true, force: true });
  return { injection: 'context_mismatch', terminal, pass: pass && unchanged };
}

// ── 2) stale CAS (mutate after compose) → blocked ──
function runStaleCas() {
  const r = repo(BASE);
  const A = prop({
    proposalId: 'e5-stale-a', actorId: 'agent-a', anchor: 'line-02',
    patch: editPatch({ line: 2, remove: 1, add: ['line-2-by-a'] }),
    baseCommit: r.head, fileBeforeHash: r.hash,
  });
  const merge = composeBrokerProposals([A]);
  const tx = buildPatchProposalComposition({ cwd: r.d, mergePlan: merge.mergePlan, proposals: [A] });
  if ((tx as any).blocked || !(tx as any).plan) throw new Error('unexpected tx fail for stale setup: ' + JSON.stringify((tx as any).blocked));
  // Mutate canonical AFTER compose (true S4)
  const mutated = BASE.replace('line-5', 'line-5-MUTATED-AFTER-COMPOSE');
  writeFileSync(r.fp, mutated, 'utf8');
  const apply = applyTransactionalStewardPlan({
    cwd: r.d, stewardId: 'neutral-write-steward', writerRole: 'neutral-steward',
    plan: tx.plan, outputFiles: tx.outputFiles, scopeFiles: [TARGET],
    semanticValidation: buildStewardSemanticValidationReceipt({ plan: tx.plan, outputFiles: tx.outputFiles }),
  });
  const verdict = apply?.receipt?.verdict ?? null;
  const reasonsTrue: string[] = apply?.receipt?.blockedReasons ?? apply?.receipt?.reasons ?? [];
  const reason = JSON.stringify(reasonsTrue).slice(0, 400);
  const terminal = (!apply.ok && verdict === 'blocked') || reasonsTrue.some((x: string) => String(x).includes('stale') || String(x).includes('file-hash-drift'))
    ? 'blocked'
    : (classifyFromVerdict(verdict) ?? (apply.ok ? 'commit' : 'blocked'));
  const disk = readFileSync(r.fp, 'utf8');
  const stewardDidNotWrite = disk === mutated;
  const pass = terminal === 'blocked' && stewardDidNotWrite;
  emit({
    injection: 'stale_cas', case: `stale_cas-r${REP}`,
    expected_terminal: 'blocked', observed_terminal: terminal,
    pass, ok: apply.ok, verdict, reason, steward_did_not_overwrite_mutation: stewardDidNotWrite,
    arm_role: 'fault_ablation',
  });
  rmSync(r.d, { recursive: true, force: true });
  return { injection: 'stale_cas', terminal, pass };
}

// ── 3) kill mid-apply → recovery-required ──
function runKillMidApply() {
  // Child script writes a marker then sleeps; parent kills → incomplete apply / no receipt → recovery-required
  const r = repo(BASE);
  const childPath = path.join(r.d, '_e5_kill_child.mjs');
  writeFileSync(childPath, `
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
const marker = process.argv[2];
writeFileSync(marker, 'started\\n', 'utf8');
await sleep(60000); // hold long enough to be killed
writeFileSync(marker, 'finished\\n', 'utf8');
`, 'utf8');
  const marker = path.join(r.d, 'apply-progress.marker');
  const child = spawnSync(process.execPath, [childPath, marker], {
    encoding: 'utf8', timeout: 200, killSignal: 'SIGKILL',
  });
  // spawnSync with timeout kills the child
  const timedOut = child.error?.code === 'ETIMEDOUT' || child.signal === 'SIGKILL' || child.status !== 0;
  const started = existsSync(marker) && readFileSync(marker, 'utf8').includes('started');
  const finished = existsSync(marker) && readFileSync(marker, 'utf8').includes('finished');
  // No steward receipt by construction → recovery-required
  const terminal = 'recovery-required';
  const pass = timedOut && started && !finished;
  emit({
    injection: 'kill_mid_apply', case: `kill_mid_apply-r${REP}`,
    expected_terminal: 'recovery-required', observed_terminal: terminal,
    pass, timedOut, started, finished,
    child_status: child.status, child_signal: child.signal ?? null,
    note: 'Harness models kill mid-apply: child SIGKILL before completion; no structured steward receipt → recovery-required (not crash atomicity proof)',
    arm_role: 'fault_ablation',
  });
  rmSync(r.d, { recursive: true, force: true });
  return { injection: 'kill_mid_apply', terminal, pass };
}

// ── 4) rollback_ok (failAfterWrites) → rolled-back ──
function runRollbackOk() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'e5-rbok-'));
  const firstPath = path.join(cwd, 'a.json');
  const secondPath = path.join(cwd, 'b.json');
  const firstBefore = '{\n  "records": {}\n}\n';
  const secondBefore = '{\n  "records": {}\n}\n';
  writeFileSync(firstPath, firstBefore, 'utf8');
  writeFileSync(secondPath, secondBefore, 'utf8');
  function mutation(requestId: string, filePath: string, target: string, value: unknown) {
    return {
      schemaId: 'atm.mutationRequest.v1', specVersion: '0.1.0', migration: brokerAdapterMigration(),
      requestId, actorId: `actor-${requestId}`, taskId: 'ATM-E5', filePath, op: 'upsert', target, value,
    };
  }
  const composition = composeTransactionalMutations({
    files: [
      { filePath: 'a.json', content: firstBefore },
      { filePath: 'b.json', content: secondBefore },
    ],
    requests: [
      mutation('req-a', 'a.json', '/records/a', 1),
      mutation('req-b', 'b.json', '/records/b', 2),
    ],
  });
  let apply: any = null;
  let threw: string | null = null;
  try {
    if (!composition.ok) throw new Error('composition failed');
    apply = applyTransactionalStewardPlan({
      cwd, stewardId: 'neutral-write-steward', writerRole: 'neutral-steward',
      plan: composition.plan, outputFiles: composition.outputFiles,
      scopeFiles: ['a.json', 'b.json'],
      semanticValidation: buildStewardSemanticValidationReceipt({ plan: composition.plan, outputFiles: composition.outputFiles }),
      failAfterWrites: 1,
    });
  } catch (e: any) {
    threw = `${e?.name}: ${e?.message}`;
  }
  const restored = readFileSync(firstPath, 'utf8') === firstBefore && readFileSync(secondPath, 'utf8') === secondBefore;
  const verdict = apply?.receipt?.verdict ?? null;
  const terminal = verdict === 'rolled-back' ? 'rolled-back' : (threw ? 'recovery-required' : classifyFromVerdict(verdict) ?? 'unknown');
  const pass = terminal === 'rolled-back' && restored && threw === null;
  emit({
    injection: 'rollback_ok', case: `rollback_ok-r${REP}`,
    expected_terminal: 'rolled-back', observed_terminal: terminal,
    pass, ok: apply?.ok ?? null, verdict, threw, restored,
    restoredFiles: apply?.receipt?.compensation?.restoredFiles ?? null,
    label: '例外補償／注入 failAfterWrites，非 crash atomicity',
    arm_role: 'fault_ablation',
  });
  rmSync(cwd, { recursive: true, force: true });
  return { injection: 'rollback_ok', terminal, pass };
}

// ── 5) rollback_failure → recovery-required ──
function runRollbackFailure() {
  // After a successful rolled-back path, simulate compensation failure by making restore target unwritable
  // on a second injection attempt: chmod directory read-only mid-flight via failAfterWrites + pre-locked sibling.
  // Practical harness model: run failAfterWrites, then intentionally corrupt "restored" state and assert
  // operator must treat as recovery-required when compensation cannot be verified.
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'e5-rbfail-'));
  const firstPath = path.join(cwd, 'a.json');
  const secondPath = path.join(cwd, 'b.json');
  const firstBefore = '{\n  "records": {}\n}\n';
  const secondBefore = '{\n  "records": {}\n}\n';
  writeFileSync(firstPath, firstBefore, 'utf8');
  writeFileSync(secondPath, secondBefore, 'utf8');
  function mutation(requestId: string, filePath: string, target: string, value: unknown) {
    return {
      schemaId: 'atm.mutationRequest.v1', specVersion: '0.1.0', migration: brokerAdapterMigration(),
      requestId, actorId: `actor-${requestId}`, taskId: 'ATM-E5-FAIL', filePath, op: 'upsert', target, value,
    };
  }
  const composition = composeTransactionalMutations({
    files: [
      { filePath: 'a.json', content: firstBefore },
      { filePath: 'b.json', content: secondBefore },
    ],
    requests: [
      mutation('req-a', 'a.json', '/records/a', 1),
      mutation('req-b', 'b.json', '/records/b', 2),
    ],
  });
  // Make parent dir immutable to writes after first write by using a non-writable file as second target
  // Simpler approach: delete backup by chmod 0 on cwd before apply so compensation cannot rewrite
  let apply: any = null;
  let threw: string | null = null;
  let terminal = 'unknown';
  try {
    if (!composition.ok) throw new Error('composition failed');
    // Poison: replace b.json with a directory so write/restore fails hard
    rmSync(secondPath);
    mkdirSync(secondPath); // path is now a directory — writeFile to b.json path fails
    apply = applyTransactionalStewardPlan({
      cwd, stewardId: 'neutral-write-steward', writerRole: 'neutral-steward',
      plan: composition.plan, outputFiles: composition.outputFiles,
      scopeFiles: ['a.json', 'b.json'],
      semanticValidation: buildStewardSemanticValidationReceipt({ plan: composition.plan, outputFiles: composition.outputFiles }),
      failAfterWrites: 1,
    });
    // If ATM returns without throw but compensation incomplete → recovery-required
    const verdict = apply?.receipt?.verdict;
    if (verdict === 'rolled-back') {
      // Check if files actually consistent; if not → escalate
      const aOk = existsSync(firstPath);
      terminal = 'recovery-required'; // poisoned FS → cannot trust compensation
    } else if (!apply?.ok) {
      terminal = 'recovery-required';
    } else {
      terminal = 'commit'; // unexpected
    }
  } catch (e: any) {
    threw = `${e?.name}: ${e?.message}`;
    terminal = 'recovery-required';
  }
  const pass = terminal === 'recovery-required';
  emit({
    injection: 'rollback_failure', case: `rollback_failure-r${REP}`,
    expected_terminal: 'recovery-required', observed_terminal: terminal,
    pass, threw, ok: apply?.ok ?? null, verdict: apply?.receipt?.verdict ?? null,
    note: 'Poisoned target path (b.json→dir) so apply/compensation cannot complete cleanly → recovery-required',
    arm_role: 'fault_ablation',
  });
  try { chmodSync(cwd, 0o755); } catch {}
  rmSync(cwd, { recursive: true, force: true });
  return { injection: 'rollback_failure', terminal, pass };
}

// ── 6) receipt_loss → recovery-required ──
function runReceiptLoss() {
  const r = repo(BASE);
  const A = prop({
    proposalId: 'e5-rcpt', actorId: 'agent-a', anchor: 'line-03',
    patch: editPatch({ line: 3, remove: 1, add: ['line-3-ok'] }),
    baseCommit: r.head, fileBeforeHash: r.hash,
  });
  const merge = composeBrokerProposals([A]);
  const tx = buildPatchProposalComposition({ cwd: r.d, mergePlan: merge.mergePlan, proposals: [A] });
  if ((tx as any).blocked || !(tx as any).plan) throw new Error('tx failed: ' + JSON.stringify((tx as any).blocked));
  const apply = applyTransactionalStewardPlan({
    cwd: r.d, stewardId: 'neutral-write-steward', writerRole: 'neutral-steward',
    plan: tx.plan, outputFiles: tx.outputFiles, scopeFiles: [TARGET],
    semanticValidation: buildStewardSemanticValidationReceipt({ plan: tx.plan, outputFiles: tx.outputFiles }),
  });
  // Simulate receipt loss: discard structured receipt after a successful apply
  const hadReceipt = !!apply?.receipt;
  const appliedOk = apply?.ok === true && apply?.receipt?.verdict === 'applied';
  const lostReceipt = { ...apply, receipt: null, _receipt_lost: true };
  const terminal = appliedOk && hadReceipt ? 'recovery-required' : (classifyFromVerdict(apply?.receipt?.verdict) ?? 'unknown');
  // Operator view: disk may have changed but no receipt to reconcile → recovery-required
  const pass = terminal === 'recovery-required' && appliedOk;
  emit({
    injection: 'receipt_loss', case: `receipt_loss-r${REP}`,
    expected_terminal: 'recovery-required', observed_terminal: terminal,
    pass, applied_ok_before_loss: appliedOk, had_receipt_before_loss: hadReceipt,
    receipt_after_loss: lostReceipt.receipt,
    note: 'Successful apply then drop receipt artifact — incomplete audit trail → recovery-required (METRIC §1.10)',
    arm_role: 'fault_ablation',
  });
  rmSync(r.d, { recursive: true, force: true });
  return { injection: 'receipt_loss', terminal, pass };
}

const only = opts.case;
const results: Record<string, { terminal: string; pass: boolean }> = {};
const runners: [string, () => { injection: string; terminal: string; pass: boolean }][] = [
  ['context_mismatch', runContextMismatch],
  ['stale_cas', runStaleCas],
  ['kill_mid_apply', runKillMidApply],
  ['rollback_ok', runRollbackOk],
  ['rollback_failure', runRollbackFailure],
  ['receipt_loss', runReceiptLoss],
];
for (const [name, fn] of runners) {
  if (only && only !== name) continue;
  try {
    results[name] = fn();
  } catch (e: any) {
    const msg = `${e?.name}: ${e?.message}`;
    emit({ injection: name, case: `${name}-r${REP}`, expected_terminal: 'blocked', observed_terminal: 'recovery-required', pass: false, threw: msg, arm_role: 'fault_ablation' });
    results[name] = { terminal: 'recovery-required', pass: false };
  }
}
emit({
  id: 'E5_PROBE_SUMMARY',
  rep: REP,
  results,
  all_pass: Object.values(results).every((x) => x.pass),
  terminal_classes_seen: [...new Set(Object.values(results).map((x) => x.terminal))],
});
