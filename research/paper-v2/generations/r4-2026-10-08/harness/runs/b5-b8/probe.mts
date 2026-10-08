/**
 * B5–B8 acceptance probes against ATM pin 5692474f… (#198 merge).
 * Harness-only; does not edit ATM sources.
 *
 * Run:
 *   export ATM_MONOREPO=/workspace/atm-main-5692474f/AI-Atomic-Framework-5692474f7db70ab52a7a71c8af4867609e7e4b43
 *   NODE=/home/box/.local/node24/bin/node
 *   "$NODE" --experimental-strip-types probe.mts | tee probe.out
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const ATM = process.env.ATM_MONOREPO ?? process.env.ATM;
if (!ATM) throw new Error('Set ATM_MONOREPO to the 5692474f pin tree');

const { composeBrokerProposals } = await import(ATM + '/packages/core/src/broker/compose.ts');
const { applyStewardPlan } = await import(ATM + '/packages/core/src/broker/steward.ts');
const {
  buildPatchProposalComposition,
  applyTransactionalStewardPlan,
  buildStewardSemanticValidationReceipt
} = await import(ATM + '/packages/core/src/broker/steward-transactional-apply.ts');
const { composeTextPatchesAgainstBase } = await import(ATM + '/packages/core/src/broker/steward-base-composer.ts');
const { composeTransactionalMutations } = await import(ATM + '/packages/core/src/broker/transactional-composer.ts');
const { brokerAdapterMigration } = await import(ATM + '/packages/core/src/broker/types.ts');

const TARGET = 'src/shared.txt';
const BASE_LINES = Array.from({ length: 10 }, (_, i) => `line-${i + 1}`);
const BASE = `${BASE_LINES.join('\n')}\n`;

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function emit(row: Record<string, unknown>) {
  console.log(JSON.stringify(row));
}

function git(cwd: string, ...args: string[]) {
  return spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
}

function repo(content: string, fileRel = TARGET) {
  const d = mkdtempSync(path.join(os.tmpdir(), 'b5b8-'));
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
  proposalId: string;
  actorId: string;
  anchor: string;
  patch: string;
  baseCommit: string;
  fileBeforeHash: string;
  targetFile?: string;
}) {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'b5-b8-probe' },
    proposalId: input.proposalId,
    taskId: `TASK-${input.proposalId}`,
    actorId: input.actorId,
    baseCommit: input.baseCommit,
    fileBeforeHash: input.fileBeforeHash,
    targetFile: input.targetFile ?? TARGET,
    atomRefs: [{ atomId: `atom.${input.proposalId}`, atomCid: `cid.${input.proposalId}` }],
    anchors: [{ kind: 'line', hint: input.anchor }],
    intent: `probe ${input.proposalId}`,
    patch: input.patch,
    validators: [],
    rollback: 'discard'
  };
}

/** One-edit unified diff against BASE with one line of context (cowrite style). */
function editPatch(input: { line: number; remove: number; add: readonly string[]; baseLines?: readonly string[] }): string {
  const lines = input.baseLines ?? BASE_LINES;
  const start = input.line - 1;
  const contextStart = Math.max(0, start - 1);
  const contextEnd = Math.min(lines.length, start + input.remove + 1);
  const before = lines.slice(contextStart, start).map((l) => ` ${l}`);
  const removed = lines.slice(start, start + input.remove).map((l) => `-${l}`);
  const added = input.add.map((l) => `+${l}`);
  const after = lines.slice(start + input.remove, contextEnd).map((l) => ` ${l}`);
  const oldLength = contextEnd - contextStart;
  const newLength = oldLength - input.remove + input.add.length;
  return [
    `--- a/${TARGET}`,
    `+++ b/${TARGET}`,
    `@@ -${contextStart + 1},${oldLength} +${contextStart + 1},${newLength} @@`,
    ...before, ...removed, ...added, ...after, ''
  ].join('\n');
}

function passFail(ok: boolean): 'pass' | 'fail' {
  return ok ? 'pass' : 'fail';
}

// ───────────────────────────── B5: S4 stale after compose ─────────────────────────────
function runB5() {
  const r = repo(BASE);
  const A = prop({
    proposalId: 'b5-a', actorId: 'agent-a', anchor: 'line-02',
    patch: editPatch({ line: 2, remove: 1, add: ['line-2-by-a'] }),
    baseCommit: r.head, fileBeforeHash: r.hash
  });
  const B = prop({
    proposalId: 'b5-b', actorId: 'agent-b', anchor: 'line-08',
    patch: editPatch({ line: 8, remove: 1, add: ['line-8-by-b'] }),
    baseCommit: r.head, fileBeforeHash: r.hash
  });
  const composed = composeBrokerProposals([A, B]);
  const transactional = buildPatchProposalComposition({
    cwd: r.d, mergePlan: composed.mergePlan, proposals: [A, B]
  });
  if (transactional.blocked) {
    emit({ id: 'B5', case: 'precondition-compose', pass: false, detail: transactional.blocked });
    rmSync(r.d, { recursive: true, force: true });
    return { b5_true_s4: false, b5_plan_drift: false, b5_repropose: false };
  }
  const receipt = buildStewardSemanticValidationReceipt({
    plan: transactional.plan, outputFiles: transactional.outputFiles
  });
  const baseHashAtCompose = hashText(readFileSync(r.fp, 'utf8'));

  // Mutate canonical AFTER compose/plan materialization.
  const MUTATED = BASE.replace('line-5', 'line-5-MUTATED-EXTERNALLY');
  writeFileSync(r.fp, MUTATED, 'utf8');
  const mutatedHash = hashText(MUTATED);

  // True S4: apply pre-built composition → canonical base hash stale; no write.
  let threw: string | null = null;
  let applyRes: any = null;
  try {
    applyRes = applyTransactionalStewardPlan({
      cwd: r.d,
      stewardId: 'neutral-write-steward',
      writerRole: 'neutral-steward',
      plan: transactional.plan,
      outputFiles: transactional.outputFiles,
      scopeFiles: [TARGET],
      semanticValidation: receipt
    });
  } catch (e: any) {
    threw = `${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`;
  }
  const afterTrue = readFileSync(r.fp, 'utf8');
  const reasonsTrue: string[] = applyRes?.receipt?.blockedReasons ?? [];
  const trueS4 =
    threw === null &&
    applyRes?.ok === false &&
    applyRes?.receipt?.verdict === 'blocked' &&
    reasonsTrue.some((x) => x.includes('canonical target base hash is stale') || x.startsWith('file-hash-drift')) &&
    hashText(afterTrue) === mutatedHash;
  emit({
    id: 'B5', case: 'true-s4-mutate-after-compose',
    pass: trueS4,
    ok: applyRes?.ok ?? null,
    verdict: applyRes?.receipt?.verdict ?? null,
    threw,
    reasons: reasonsTrue,
    baseHashAtCompose,
    mutatedHash,
    afterHash: hashText(afterTrue),
    fileUnchangedFromMutated: hashText(afterTrue) === mutatedHash,
    note: '例外路徑：compose 後改 canonical；apply 拒寫；檔＝突變後內容'
  });

  // Plan-time path via applyStewardPlan (fileBeforeHash vs disk).
  let planThrew: string | null = null;
  let planRes: any = null;
  try {
    planRes = applyStewardPlan({
      cwd: r.d,
      stewardId: 'neutral-write-steward',
      mergePlan: composed.mergePlan,
      proposals: [A, B],
      scopeFiles: [TARGET]
    });
  } catch (e: any) {
    planThrew = `${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`;
  }
  const afterPlan = readFileSync(r.fp, 'utf8');
  const planReasons: string[] = planRes?.evidence?.blockedReasons ?? [];
  const planDrift =
    planThrew === null &&
    planRes?.ok === false &&
    planRes?.evidence?.verdict === 'blocked' &&
    planReasons.some((x) => x.startsWith('file-hash-drift') || x.includes('canonical target base hash is stale')) &&
    hashText(afterPlan) === mutatedHash;
  emit({
    id: 'B5', case: 'applyStewardPlan-after-mutate',
    pass: planDrift,
    ok: planRes?.ok ?? null,
    verdict: planRes?.evidence?.verdict ?? null,
    threw: planThrew,
    reasons: planReasons,
    fileUnchangedFromMutated: hashText(afterPlan) === mutatedHash
  });

  // Re-propose against mutated base → apply OK.
  const mutLines = MUTATED.replace(/\n$/, '').split('\n');
  const A2 = prop({
    proposalId: 'b5-re-a', actorId: 'agent-a', anchor: 'line-02',
    patch: editPatch({ line: 2, remove: 1, add: ['line-2-by-a'], baseLines: mutLines }),
    baseCommit: r.head, fileBeforeHash: mutatedHash
  });
  const B2 = prop({
    proposalId: 'b5-re-b', actorId: 'agent-b', anchor: 'line-08',
    patch: editPatch({ line: 8, remove: 1, add: ['line-8-by-b'], baseLines: mutLines }),
    baseCommit: r.head, fileBeforeHash: mutatedHash
  });
  // Keep stale baseCommit (HEAD unchanged) — fileBeforeHash is the gate we care about for re-propose.
  // If plan also checks baseCommit vs HEAD and they still match, OK.
  const reCompose = composeBrokerProposals([A2, B2]);
  let reThrew: string | null = null;
  let reRes: any = null;
  try {
    reRes = applyStewardPlan({
      cwd: r.d,
      stewardId: 'neutral-write-steward',
      mergePlan: reCompose.mergePlan,
      proposals: [A2, B2],
      scopeFiles: [TARGET]
    });
  } catch (e: any) {
    reThrew = `${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`;
  }
  const afterRe = readFileSync(r.fp, 'utf8');
  const repropose =
    reThrew === null &&
    reRes?.ok === true &&
    reRes?.evidence?.verdict === 'applied' &&
    afterRe.includes('line-2-by-a') &&
    afterRe.includes('line-8-by-b') &&
    afterRe.includes('line-5-MUTATED-EXTERNALLY');
  emit({
    id: 'B5', case: 'repropose-fresh-fileBeforeHash',
    pass: repropose,
    ok: reRes?.ok ?? null,
    verdict: reRes?.evidence?.verdict ?? null,
    threw: reThrew,
    reasons: reRes?.evidence?.blockedReasons ?? [],
    hasA: afterRe.includes('line-2-by-a'),
    hasB: afterRe.includes('line-8-by-b'),
    keepsExternalMutation: afterRe.includes('line-5-MUTATED-EXTERNALLY')
  });

  rmSync(r.d, { recursive: true, force: true });
  return { b5_true_s4: trueS4, b5_plan_drift: planDrift, b5_repropose: repropose };
}

// ───────────────────────────── B6: boundary matrix ─────────────────────────────
function runB6() {
  const fixture = (id: string, patch: string) => prop({
    proposalId: id, actorId: `actor-${id}`, anchor: id, patch,
    baseCommit: 'base', fileBeforeHash: hashText(BASE)
  });

  type Cell = {
    case: string;
    contract: 'block' | 'allow';
    contractReason: string;
    observed: 'block' | 'allow' | 'error';
    blockCode?: string | null;
    detail?: string | null;
    pass: boolean;
  };
  const cells: Cell[] = [];

  function observe(label: string, contract: 'block' | 'allow', contractReason: string, proposals: any[]) {
    const result = composeTextPatchesAgainstBase(TARGET, BASE, proposals);
    let observed: 'block' | 'allow' | 'error' = 'error';
    let blockCode: string | null = null;
    let detail: string | null = null;
    if (result.ok) {
      observed = 'allow';
    } else {
      observed = 'block';
      blockCode = result.block.code;
      detail = result.block.detail;
    }
    const pass = observed === contract && (contract === 'allow' || blockCode === 'steward-final-patch-required' || blockCode === 'compose-context-mismatch' || blockCode === 'compose-permutation-unstable');
    // For allow, also require checkedPermutationCount > 0
    const pass2 = contract === 'allow'
      ? (result.ok === true && result.checkedPermutationCount > 0)
      : (observed === 'block' && (blockCode === 'steward-final-patch-required' || (label.includes('stale') && blockCode === 'compose-context-mismatch')));
    const cell: Cell = {
      case: label, contract, contractReason, observed, blockCode, detail, pass: pass2
    };
    cells.push(cell);
    emit({ id: 'B6', ...cell, checkedPermutationCount: result.ok ? result.checkedPermutationCount : 0 });
  }

  // Frozen #198 contract documented in EXPECTED.md / B6.md
  observe(
    'same-gap-dual-insert',
    'block',
    '兩插入同一 gap → steward-final-patch-required',
    [
      fixture('gap-a', '@@ -4,1 +4,2 @@\n line-4\n+from-a\n'),
      fixture('gap-b', '@@ -4,1 +4,2 @@\n line-4\n+from-b\n')
    ]
  );

  // Adjacent endpoints: edit line 4 and line 5 with standard 1-line context → change touches other's span
  observe(
    'adjacent-endpoints',
    'block',
    '相鄰端點：變更落在對方 hunk（含 context）覆蓋範圍 → block',
    [
      fixture('adj-a', editPatch({ line: 4, remove: 1, add: ['line-4-a'] })),
      fixture('adj-b', editPatch({ line: 5, remove: 1, add: ['line-5-b'] }))
    ]
  );

  // Context-overlap-only: share unchanged context line-3; changes on line-2 and line-4 do not touch each other's span
  // A: edit line 2, ctx 1,2,3 → span={0,1,2} deleted={1}
  // B: edit line 4, ctx 3,4,5 → span={2,3,4} deleted={3}
  // Shared context index 2 (line-3); neither deleted in other's span → ALLOW per #198
  observe(
    'context-overlap-only',
    'allow',
    '僅共享未變更 context（line-3）；變更不交疊 → allow（類 git merge-file）',
    [
      fixture('ctx-a', editPatch({ line: 2, remove: 1, add: ['line-2-a'] })),
      fixture('ctx-b', editPatch({ line: 4, remove: 1, add: ['line-4-b'] }))
    ]
  );

  observe(
    'file-head',
    'allow',
    '檔首編輯＋遠端不相交編輯 → allow',
    [
      fixture('head', editPatch({ line: 1, remove: 1, add: ['HEAD-EDIT'] })),
      fixture('far', editPatch({ line: 9, remove: 1, add: ['FAR-EDIT'] }))
    ]
  );

  observe(
    'file-tail',
    'allow',
    '檔尾編輯＋遠端不相交編輯 → allow',
    [
      fixture('near', editPatch({ line: 2, remove: 1, add: ['NEAR-EDIT'] })),
      fixture('tail', editPatch({ line: 10, remove: 1, add: ['TAIL-EDIT', 'AFTER-TAIL'] }))
    ]
  );

  // Multi-hunk single proposal + second disjoint proposal
  const multiHunk = [
    '--- a/' + TARGET,
    '+++ b/' + TARGET,
    '@@ -2,1 +2,1 @@',
    '-line-2',
    '+MULTI-2',
    '@@ -6,1 +6,1 @@',
    '-line-6',
    '+MULTI-6',
    ''
  ].join('\n');
  observe(
    'multi-hunk-plus-disjoint',
    'allow',
    '單一 proposal 多 hunk＋另一不相交 proposal → allow',
    [
      fixture('multi', multiHunk),
      fixture('other', editPatch({ line: 9, remove: 1, add: ['OTHER-9'] }))
    ]
  );

  const allPass = cells.every((c) => c.pass);
  emit({ id: 'B6', case: 'summary', pass: allPass, cells: cells.map((c) => ({ case: c.case, contract: c.contract, observed: c.observed, pass: c.pass, blockCode: c.blockCode })) });
  return { b6_all: allPass, cells };
}

// ───────────────────────────── B7: permutation / property ─────────────────────────────
function runB7() {
  const results: Record<string, boolean> = {};

  // Reorder proposals → identical output hash (3 disjoint)
  const patches = [1, 5, 9].map((line) => ({
    line,
    patch: editPatch({ line, remove: 1, add: [`edited-${line}`] })
  }));
  const mk = (order: number[]) => order.map((line, i) => prop({
    proposalId: `p${line}`, actorId: `a${line}`, anchor: `anchor-${String.fromCharCode(97 + i)}-${line}`,
    patch: patches.find((p) => p.line === line)!.patch,
    baseCommit: 'base', fileBeforeHash: hashText(BASE)
  }));
  const orders = [
    [1, 5, 9],
    [9, 1, 5],
    [5, 9, 1],
    [9, 5, 1]
  ];
  const hashes: string[] = [];
  const counts: number[] = [];
  let allOk = true;
  for (const ord of orders) {
    const r = composeTextPatchesAgainstBase(TARGET, BASE, mk(ord));
    if (!r.ok) { allOk = false; hashes.push('BLOCKED'); counts.push(0); continue; }
    hashes.push(hashText(r.content));
    counts.push(r.checkedPermutationCount);
  }
  const reorderStable = allOk && new Set(hashes).size === 1 && counts.every((c) => c > 0);
  results.reorder_stable = reorderStable;
  emit({
    id: 'B7', case: 'reorder-proposals-identical-hash',
    pass: reorderStable, hashes, checkedPermutationCounts: counts
  });

  // Five disjoint → bounded path, permutationStable via count=6
  const fiveProps = [1, 3, 5, 7, 9].map((line) => prop({
    proposalId: `five-${line}`, actorId: `a${line}`, anchor: `f${line}`,
    patch: `@@ -${line},1 +${line},1 @@\n-line-${line}\n+edited-${line}\n`,
    baseCommit: 'base', fileBeforeHash: hashText(BASE)
  }));
  const five = composeTextPatchesAgainstBase(TARGET, BASE, fiveProps);
  const fiveOk = five.ok === true && five.checkedPermutationCount === 6 &&
    [1, 3, 5, 7, 9].every((line) => five.content.includes(`edited-${line}`));
  results.five_bounded = fiveOk;
  emit({
    id: 'B7', case: 'five-disjoint-bounded-permutation',
    pass: fiveOk,
    ok: five.ok,
    checkedPermutationCount: five.ok ? five.checkedPermutationCount : 0,
    note: 'count must be real (>0), not hard-coded 0'
  });

  // Through buildPatchProposalComposition: permutationStable true + count > 0
  const r = repo(BASE);
  const A = prop({
    proposalId: 'b7-a', actorId: 'agent-a', anchor: 'aa',
    patch: editPatch({ line: 2, remove: 1, add: ['A'] }),
    baseCommit: r.head, fileBeforeHash: r.hash
  });
  const B = prop({
    proposalId: 'b7-b', actorId: 'agent-b', anchor: 'bb',
    patch: editPatch({ line: 8, remove: 1, add: ['B'] }),
    baseCommit: r.head, fileBeforeHash: r.hash
  });
  const merge = composeBrokerProposals([A, B]);
  const tx = buildPatchProposalComposition({ cwd: r.d, mergePlan: merge.mergePlan, proposals: [A, B] });
  const proof = tx.plan.serializabilityProof;
  const proofOk = tx.blocked === null && proof.permutationStable === true && proof.checkedPermutationCount > 0;
  results.frame_property = proofOk;
  emit({
    id: 'B7', case: 'serializabilityProof-frame',
    pass: proofOk,
    permutationStable: proof.permutationStable,
    checkedPermutationCount: proof.checkedPermutationCount,
    equivalentOutputHash: proof.equivalentOutputHash
  });

  // Blocked case: hash before === hash after (overlap)
  writeFileSync(r.fp, BASE, 'utf8');
  const beforeHash = hashText(readFileSync(r.fp, 'utf8'));
  const OA = prop({
    proposalId: 'ov-a', actorId: 'agent-a', anchor: 'x',
    patch: editPatch({ line: 5, remove: 1, add: ['A5'] }),
    baseCommit: r.head, fileBeforeHash: r.hash
  });
  const OB = prop({
    proposalId: 'ov-b', actorId: 'agent-b', anchor: 'y',
    patch: editPatch({ line: 5, remove: 1, add: ['B5'] }),
    baseCommit: r.head, fileBeforeHash: r.hash
  });
  const oMerge = composeBrokerProposals([OA, OB]);
  let oRes: any = null;
  let oThrew: string | null = null;
  try {
    oRes = applyStewardPlan({
      cwd: r.d, stewardId: 'neutral-write-steward',
      mergePlan: oMerge.mergePlan, proposals: [OA, OB], scopeFiles: [TARGET]
    });
  } catch (e: any) {
    oThrew = `${e?.name}: ${e?.message}`;
  }
  const afterHash = hashText(readFileSync(r.fp, 'utf8'));
  const blockedHashStable =
    oThrew === null &&
    oRes?.ok === false &&
    oRes?.evidence?.verdict === 'blocked' &&
    beforeHash === afterHash;
  results.blocked_hash_stable = blockedHashStable;
  emit({
    id: 'B7', case: 'blocked-before-after-hash-equal',
    pass: blockedHashStable,
    beforeHash, afterHash, threw: oThrew,
    reasons: oRes?.evidence?.blockedReasons ?? []
  });

  rmSync(r.d, { recursive: true, force: true });
  const all = Object.values(results).every(Boolean);
  emit({ id: 'B7', case: 'summary', pass: all, results });
  return { b7_all: all, results };
}

// ───────────────────────────── B8: failAfterWrites rollback ─────────────────────────────
function runB8() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'b8-rollback-'));
  const firstPath = path.join(cwd, 'a.json');
  const secondPath = path.join(cwd, 'b.json');
  const firstBefore = '{\n  "records": {}\n}\n';
  const secondBefore = '{\n  "records": {}\n}\n';
  writeFileSync(firstPath, firstBefore, 'utf8');
  writeFileSync(secondPath, secondBefore, 'utf8');

  function mutation(requestId: string, filePath: string, target: string, value: unknown) {
    return {
      schemaId: 'atm.mutationRequest.v1',
      specVersion: '0.1.0',
      migration: brokerAdapterMigration(),
      requestId,
      actorId: `actor-${requestId}`,
      taskId: 'ATM-B8',
      filePath,
      op: 'upsert',
      target,
      value
    };
  }

  const composition = composeTransactionalMutations({
    files: [
      { filePath: 'a.json', content: firstBefore },
      { filePath: 'b.json', content: secondBefore }
    ],
    requests: [
      mutation('req-a', 'a.json', '/records/a', 1),
      mutation('req-b', 'b.json', '/records/b', 2)
    ]
  });

  let threw: string | null = null;
  let apply: any = null;
  try {
    if (!composition.ok) throw new Error('composition failed');
    const receipt = buildStewardSemanticValidationReceipt({
      plan: composition.plan,
      outputFiles: composition.outputFiles
    });
    apply = applyTransactionalStewardPlan({
      cwd,
      stewardId: 'neutral-write-steward',
      writerRole: 'neutral-steward',
      plan: composition.plan,
      outputFiles: composition.outputFiles,
      scopeFiles: ['a.json', 'b.json'],
      semanticValidation: receipt,
      failAfterWrites: 1
    });
  } catch (e: any) {
    threw = `${e?.name}: ${e?.message}`;
  }

  const aAfter = readFileSync(firstPath, 'utf8');
  const bAfter = readFileSync(secondPath, 'utf8');
  const restored = aAfter === firstBefore && bAfter === secondBefore;
  const pass =
    threw === null &&
    apply?.ok === false &&
    apply?.receipt?.verdict === 'rolled-back' &&
    restored &&
    Array.isArray(apply?.receipt?.compensation?.restoredFiles) &&
    apply.receipt.compensation.restoredFiles.includes('a.json') &&
    apply.receipt.compensation.restoredFiles.includes('b.json');

  emit({
    id: 'B8',
    case: 'failAfterWrites-multi-file',
    pass,
    ok: apply?.ok ?? null,
    verdict: apply?.receipt?.verdict ?? null,
    threw,
    restoredFiles: apply?.receipt?.compensation?.restoredFiles ?? null,
    aRestored: aAfter === firstBefore,
    bRestored: bAfter === secondBefore,
    label: '例外補償／注入 failAfterWrites，非 crash atomicity'
  });

  rmSync(cwd, { recursive: true, force: true });
  return { b8: pass };
}

// ── main ──
const b5 = runB5();
const b6 = runB6();
const b7 = runB7();
const b8 = runB8();

const summary = {
  id: 'SUMMARY',
  pin: '5692474f7db70ab52a7a71c8af4867609e7e4b43',
  B5: b5.b5_true_s4 && b5.b5_plan_drift && b5.b5_repropose ? 'pass' : 'fail',
  B5_detail: b5,
  B6: b6.b6_all ? 'pass' : 'fail',
  B7: b7.b7_all ? 'pass' : 'fail',
  B8: b8.b8 ? 'pass' : 'fail',
  allPass: b5.b5_true_s4 && b5.b5_plan_drift && b5.b5_repropose && b6.b6_all && b7.b7_all && b8.b8
};
emit(summary);
process.exitCode = summary.allPass ? 0 : 1;
