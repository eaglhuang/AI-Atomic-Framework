import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { composeBrokerProposals } from '../packages/core/src/broker/compose.ts';
import { applyStewardPlan } from '../packages/core/src/broker/steward.ts';
import { composeTextPatchesAgainstBase } from '../packages/core/src/broker/steward-base-composer.ts';
import { applyUnifiedPatch } from '../packages/core/src/broker/unified-patch.ts';
import { runBroker } from '../packages/cli/src/commands/broker.ts';
import type { MergePlan, PatchProposal } from '../packages/core/src/broker/types.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';

// Composer + steward co-write acceptance (issue #196): same-file disjoint
// patches compose against one immutable base, overlap fails closed with a
// receipt, and a proposer can never act as its own steward.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const TARGET = 'src/shared.txt';
const BASE_LINES = Array.from({ length: 10 }, (_, index) => `line-${index + 1}`);
const BASE = `${BASE_LINES.join('\n')}\n`;

function check(condition: unknown, message: string): asserts condition {
  assert.ok(condition, `[broker-cowrite:${mode}] ${message}`);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function hashText(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** A one-edit unified diff against BASE with one line of context. */
function editPatch(input: { readonly line: number; readonly remove: number; readonly add: readonly string[] }): string {
  const start = input.line - 1;
  const contextStart = Math.max(0, start - 1);
  const contextEnd = Math.min(BASE_LINES.length, start + input.remove + 1);
  const before = BASE_LINES.slice(contextStart, start).map((line) => ` ${line}`);
  const removed = BASE_LINES.slice(start, start + input.remove).map((line) => `-${line}`);
  const added = input.add.map((line) => `+${line}`);
  const after = BASE_LINES.slice(start + input.remove, contextEnd).map((line) => ` ${line}`);
  const oldLength = contextEnd - contextStart;
  const newLength = oldLength - input.remove + input.add.length;
  return [
    `--- a/${TARGET}`,
    `+++ b/${TARGET}`,
    `@@ -${contextStart + 1},${oldLength} +${contextStart + 1},${newLength} @@`,
    ...before, ...removed, ...added, ...after, ''
  ].join('\n');
}

function makeProposal(input: {
  readonly proposalId: string;
  readonly actorId: string;
  readonly anchor: string;
  readonly patch: string;
  readonly baseCommit: string;
}): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'cowrite-fixture' },
    proposalId: input.proposalId,
    taskId: `TASK-${input.proposalId}`,
    actorId: input.actorId,
    baseCommit: input.baseCommit,
    fileBeforeHash: hashText(BASE),
    targetFile: TARGET,
    atomRefs: [{ atomId: `atom.${input.proposalId}`, atomCid: `cid.${input.proposalId}` }],
    anchors: [{ kind: 'line', hint: input.anchor }],
    intent: `cowrite fixture ${input.proposalId}`,
    patch: input.patch,
    validators: [],
    rollback: 'discard'
  };
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function commitAll(cwd: string, messageText: string): string {
  const add = spawnSync('git', ['-C', cwd, 'add', '-A'], { encoding: 'utf8' });
  check(add.status === 0, `git add failed: ${add.stderr || add.stdout}`);
  const commit = spawnSync('git', ['-C', cwd, '-c', 'user.name=ATM', '-c', 'user.email=atm@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', messageText], { encoding: 'utf8' });
  check(commit.status === 0, `git commit failed: ${commit.stderr || commit.stdout}`);
  return String(spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout ?? '').trim();
}

function ensureConfigWiring() {
  const packageJson = readJson('package.json');
  check(
    packageJson.scripts?.['validate:broker-cowrite'] === 'node --strip-types scripts/validate-broker-cowrite.ts --mode validate',
    'package.json must expose validate:broker-cowrite'
  );
  const validatorsConfig = readJson('scripts/validators.config.json');
  const validatorDef = validatorsConfig.validators?.find((entry: { name?: string }) => entry.name === 'validate-broker-cowrite');
  check(validatorDef?.entry === 'scripts/validate-broker-cowrite.ts', 'validators.config.json must register validate-broker-cowrite');
  check(validatorsConfig.profiles?.standard?.validators?.includes('validate-broker-cowrite') === true, 'standard profile must include validate-broker-cowrite');
}

async function runCli(args: readonly string[], cwd: string) {
  try {
    return { exitCode: 0, parsed: await runBroker([...args, '--cwd', cwd]) as { ok: boolean; evidence?: Record<string, any> } };
  } catch (error: any) {
    return { exitCode: typeof error?.exitCode === 'number' ? error.exitCode : 1, parsed: { ok: false, evidence: error?.details ?? {} } };
  }
}

function checkComposerUnits() {
  const fixture = (proposalId: string, patch: string) => makeProposal({ proposalId, actorId: `actor-${proposalId}`, anchor: proposalId, patch, baseCommit: 'base' });
  // A single proposal composes to exactly what strict unified-patch application produces.
  for (const patch of [
    editPatch({ line: 1, remove: 1, add: ['first'] }),
    editPatch({ line: 5, remove: 2, add: [] }),
    editPatch({ line: 10, remove: 1, add: ['last', 'after-last'] })
  ]) {
    const composed = composeTextPatchesAgainstBase(TARGET, BASE, [fixture('single', patch)]);
    check(composed.ok && composed.content === applyUnifiedPatch(BASE, patch), 'single-proposal composition must equal strict patch application');
  }
  // CRLF and a missing trailing newline survive composition.
  const crlf = BASE.replace(/\n/g, '\r\n').replace(/\r\n$/, '');
  const crlfResult = composeTextPatchesAgainstBase(TARGET, crlf, [fixture('crlf', editPatch({ line: 3, remove: 1, add: ['three'] }))]);
  check(crlfResult.ok && crlfResult.content.includes('\r\nthree\r\n') && !crlfResult.content.endsWith('\n'), 'composition must keep CRLF and the missing trailing newline');
  // Two inserts at the same gap are ambiguous and must fail closed.
  const sameGap = composeTextPatchesAgainstBase(TARGET, BASE, [
    fixture('gap-a', '@@ -4,1 +4,2 @@\n line-4\n+from-a\n'),
    fixture('gap-b', '@@ -4,1 +4,2 @@\n line-4\n+from-b\n')
  ]);
  check(!sameGap.ok && sameGap.block.code === 'steward-final-patch-required', 'two inserts at one gap must require a steward final patch');
  // A stale context line reports compose-context-mismatch for that proposal.
  const stale = composeTextPatchesAgainstBase(TARGET, BASE, [fixture('stale', '@@ -2,1 +2,1 @@\n-not-line-2\n+x\n')]);
  check(!stale.ok && stale.block.code === 'compose-context-mismatch' && stale.block.proposalIds[0] === 'stale', 'stale context must report compose-context-mismatch');
  // Five disjoint proposals take the bounded permutation path and stay stable.
  const five = composeTextPatchesAgainstBase(TARGET, BASE, [1, 3, 5, 7, 9].map((line) => fixture(`five-${line}`, `@@ -${line},1 +${line},1 @@\n-line-${line}\n+edited-${line}\n`)));
  check(five.ok && five.checkedPermutationCount === 6 && [1, 3, 5, 7, 9].every((line) => five.content.includes(`edited-${line}`)), 'five disjoint proposals must compose under every checked order');
}

ensureConfigWiring();
checkComposerUnits();

const tempRoot = createTempWorkspace('atm-broker-cowrite-');
const targetPath = path.join(tempRoot, TARGET);
try {
  initializeGitRepository(tempRoot);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, BASE, 'utf8');
  const baseCommit = commitAll(tempRoot, 'cowrite base');

  const apply = (input: { readonly proposals: readonly PatchProposal[]; readonly stewardId?: string; readonly mergePlan?: MergePlan }) => {
    writeFileSync(targetPath, BASE, 'utf8');
    const mergePlan = input.mergePlan ?? composeBrokerProposals(input.proposals).mergePlan;
    let result: ReturnType<typeof applyStewardPlan> | null = null;
    let thrown: unknown = null;
    try {
      result = applyStewardPlan({
        cwd: tempRoot,
        stewardId: input.stewardId ?? 'neutral-write-steward',
        mergePlan,
        proposals: input.proposals,
        scopeFiles: [TARGET]
      });
    } catch (error) {
      thrown = error;
    }
    return { mergePlan, result, thrown, after: readFileSync(targetPath, 'utf8') };
  };
  const proposal = (proposalId: string, actorId: string, anchor: string, patch: string) => makeProposal({ proposalId, actorId, anchor, patch, baseCommit });

  // S1a — disjoint same-length replacements.
  const s1a = apply({
    proposals: [
      proposal('s1a-top', 'agent-a', 'line-02', editPatch({ line: 2, remove: 1, add: ['line-2-by-a'] })),
      proposal('s1a-bottom', 'agent-b', 'line-08', editPatch({ line: 8, remove: 1, add: ['line-8-by-b'] }))
    ]
  });
  check(s1a.thrown === null, `S1a must not throw: ${String(s1a.thrown)}`);
  check(s1a.mergePlan.verdict === 'parallel-safe', `S1a compose verdict must be parallel-safe, got ${s1a.mergePlan.verdict}`);
  check(s1a.result?.ok === true && s1a.result.evidence.verdict === 'applied', `S1a must apply: ${JSON.stringify(s1a.result?.evidence.blockedReasons)}`);
  check(s1a.after.includes('line-2-by-a') && s1a.after.includes('line-8-by-b'), 'S1a must keep both changes');

  // S1b — the upper patch inserts a line; both anchor orders must apply to the same bytes.
  const upperInsert = editPatch({ line: 2, remove: 1, add: ['line-2-by-a', 'line-2b-inserted-by-a'] });
  const lowerReplace = editPatch({ line: 8, remove: 1, add: ['line-8-by-b'] });
  const s1bOutputs: string[] = [];
  for (const [upperAnchor, lowerAnchor] of [['aa-upper', 'zz-lower'], ['zz-upper', 'aa-lower']]) {
    const run = apply({
      proposals: [
        proposal('s1b-upper', 'agent-a', upperAnchor, upperInsert),
        proposal('s1b-lower', 'agent-b', lowerAnchor, lowerReplace)
      ]
    });
    check(run.thrown === null, `S1b (${upperAnchor}) must not throw: ${String(run.thrown)}`);
    check(run.mergePlan.verdict === 'parallel-safe', `S1b (${upperAnchor}) compose verdict must be parallel-safe, got ${run.mergePlan.verdict}`);
    check(run.result?.ok === true, `S1b (${upperAnchor}) must apply: ${JSON.stringify(run.result?.evidence.blockedReasons)}`);
    check(run.after.includes('line-2b-inserted-by-a') && run.after.includes('line-8-by-b'), `S1b (${upperAnchor}) must keep both changes`);
    check(run.after.split('\n').length === BASE_LINES.length + 2, `S1b (${upperAnchor}) must add exactly one line`);
    s1bOutputs.push(hashText(run.after));
  }
  check(s1bOutputs[0] === s1bOutputs[1], 'S1b output hash must not depend on anchor order');

  // S2 — overlapping hunks fail closed with a receipt and no write.
  const s2 = apply({
    proposals: [
      proposal('s2-a', 'agent-a', 'line-05-a', editPatch({ line: 5, remove: 1, add: ['line-5-by-a'] })),
      proposal('s2-b', 'agent-b', 'line-05-b', editPatch({ line: 5, remove: 1, add: ['line-5-by-b'] }))
    ]
  });
  check(s2.thrown === null, `S2 must not throw: ${String(s2.thrown)}`);
  check(s2.mergePlan.verdict === 'needs-steward', `S2 compose verdict must be needs-steward, got ${s2.mergePlan.verdict}`);
  check(s2.result?.ok === false && s2.result.evidence.verdict === 'blocked', 'S2 must be blocked');
  const s2Reasons = (s2.result?.evidence.blockedReasons ?? []).join('\n');
  check(s2Reasons.includes('steward-final-patch-required'), `S2 must name steward-final-patch-required: ${s2Reasons}`);
  check(s2Reasons.includes('s2-a') && s2Reasons.includes('s2-b'), `S2 must list the conflicting proposals: ${s2Reasons}`);
  check(hashText(s2.after) === hashText(BASE), 'S2 must leave the canonical file unchanged');

  // S3 — a proposer can never be its own steward (API).
  const s3Proposals = [
    proposal('s3-a', 'agent-a', 'line-02', editPatch({ line: 2, remove: 1, add: ['line-2-by-a'] })),
    proposal('s3-b', 'agent-b', 'line-08', editPatch({ line: 8, remove: 1, add: ['line-8-by-b'] }))
  ];
  const s3 = apply({ proposals: s3Proposals, stewardId: 'agent-b' });
  check(s3.thrown === null, `S3 must not throw: ${String(s3.thrown)}`);
  check(s3.result?.ok === false && s3.result.evidence.verdict === 'blocked', 'S3 self-apply must be blocked');
  check((s3.result?.evidence.blockedReasons ?? []).some((reason) => reason.startsWith('invalid-steward-identity')), `S3 must name invalid-steward-identity: ${JSON.stringify(s3.result?.evidence.blockedReasons)}`);
  check(hashText(s3.after) === hashText(BASE), 'S3 must leave the canonical file unchanged');

  // S3 — same gate through the CLI.
  writeFileSync(targetPath, BASE, 'utf8');
  writeJson(path.join(tempRoot, 'cowrite-merge-plan.json'), composeBrokerProposals(s3Proposals).mergePlan);
  writeJson(path.join(tempRoot, 'cowrite-proposal-a.json'), s3Proposals[0]);
  writeJson(path.join(tempRoot, 'cowrite-proposal-b.json'), s3Proposals[1]);
  const cli = await runCli([
    'steward', 'apply',
    '--steward-id', 'agent-a',
    '--merge-plan-file', 'cowrite-merge-plan.json',
    '--proposal-file', 'cowrite-proposal-a.json',
    '--proposal-file', 'cowrite-proposal-b.json',
    '--scope-file', TARGET
  ], tempRoot);
  check(cli.parsed.ok === false, 'S3 CLI self-apply must be blocked');
  const cliReasons: string[] = cli.parsed.evidence?.applyEvidence?.blockedReasons ?? [];
  check(cliReasons.some((reason) => reason.startsWith('invalid-steward-identity')), `S3 CLI must name invalid-steward-identity: ${JSON.stringify(cliReasons)}`);
  check(hashText(readFileSync(targetPath, 'utf8')) === hashText(BASE), 'S3 CLI must leave the canonical file unchanged');

  // Regression — a stale fileBeforeHash is still blocked as file-hash drift.
  const stale = { ...s3Proposals[0], fileBeforeHash: hashText('stale') };
  const staleRun = apply({ proposals: [stale, s3Proposals[1]] });
  check(staleRun.result?.ok === false, 'stale file hash must stay blocked');
  check((staleRun.result?.evidence.blockedReasons ?? []).some((reason) => reason.startsWith('file-hash-drift')), 'stale file hash must report file-hash-drift');
  check(hashText(staleRun.after) === hashText(BASE), 'stale file hash must leave the canonical file unchanged');

  console.log(`[broker-cowrite:${mode}] ok (S1a, S1b order-stable, S2 fail-closed, S3 identity gate API+CLI, stale-hash regression)`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
