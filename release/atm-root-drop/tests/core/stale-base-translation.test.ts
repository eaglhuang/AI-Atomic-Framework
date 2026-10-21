// #363: a write based on an older file version is placed by translating it from
// that base to the current file, never at its old line numbers. A line it
// deletes or modifies that changed since the base is rejected, never applied
// elsewhere. Live write (C1) and steward re-compose (C3) both use it.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashContent } from '../../packages/core/src/broker/adapters/cas.ts';
import { composeBrokerProposals } from '../../packages/core/src/broker/compose.ts';
import { diffLineBlocks, lineTokens, mapBaseLineForward, renderTranslatedPatch, translateStalePatch } from '../../packages/core/src/broker/stale-base-translation.ts';
import { applyStewardPlan } from '../../packages/core/src/broker/steward.ts';
import type { PatchProposal } from '../../packages/core/src/broker/types.ts';
import { applyUnifiedPatch, parseUnifiedPatchHunks } from '../../packages/core/src/broker/unified-patch.ts';
import { applyLiveQueuedWrites } from '../../packages/core/src/live-write/live-queued-write.ts';

const translate = (baseText: string, currentText: string, patch: string) =>
  translateStalePatch({ baseText, currentText, hunks: parseUnifiedPatchHunks(patch) });
const REPRO_BASE = 'a\nb\nb\nc\n';
const REPRO_CURRENT = 'Z\na\nb\nb\nc\n';
const B3 = '@@ -3 +3 @@\n-b\n+B3\n';

// --- unit: the issue repro and its neighbours -------------------------------
{
  const result = translate(REPRO_BASE, REPRO_CURRENT, B3);
  assert.ok(result.ok, JSON.stringify(result));
  assert.equal(result.text, 'Z\na\nb\nB3\nc\n', 'B3 lands on the second b');
  assert.deepEqual(result.hunkOffsets, [{ declaredOldStart: 3, appliedOldStart: 4, offset: 1 }]);
  assert.deepEqual(result.blocks.map(({ baseStart, baseEnd, currentStart, currentEnd }) => [baseStart, baseEnd, currentStart, currentEnd]), [[2, 3, 3, 4]]);
  // Re-reading the declared line in the current file would have edited the first b.
  assert.equal(applyUnifiedPatch(REPRO_CURRENT, B3), 'Z\na\nB3\nb\nc\n');
}
{
  // The second b itself changed since the base: rejected, never applied to the first b.
  const result = translate(REPRO_BASE, 'a\nb\nX\nc\n', B3);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === 'stale-base-conflict');
  assert.deepEqual(!result.ok && result.conflicts.map((c) => [c.ours.baseStart, c.theirs.currentStart]), [[2, 2]]);
  // Deleted since the base.
  assert.equal(translate(REPRO_BASE, 'a\nb\nc\n', B3).ok, false);
  // Touching changes conflict, as in git merge-file.
  assert.equal(translate(REPRO_BASE, 'a\nb\nb\nC\n', B3).ok, false);
  assert.equal(translate(REPRO_BASE, 'a\nB\nb\nc\n', B3).ok, false);
  // Changes one line apart are independent.
  const apart = translate('a\nb\nb\nc\nd\n', 'a\nb\nb\nc\nD\n', B3);
  assert.ok(apart.ok && apart.text === 'a\nb\nB3\nc\nD\n');
  // Context lines may change when the stale change itself does not touch them.
  const context = translate('w\nx\na\nb\nb\nc\ny\nz\n', 'W\nx\na\nb\nb\nc\ny\nZ\n', '@@ -3,5 +3,5 @@\n a\n b\n-b\n+B3\n c\n y\n');
  assert.ok(context.ok && context.text === 'W\nx\na\nb\nB3\nc\ny\nZ\n', JSON.stringify(context));
}
{
  // Repetitive context: blank lines and closing braces.
  const base = 'fn a() {\n}\n\nfn b() {\n}\n\nfn c() {\n}\n';
  const current = 'fn z() {\n}\n\nfn a() {\n}\n\nfn b() {\n}\n\nfn c() {\n}\n';
  const patch = '@@ -5 +5,2 @@\n-}\n+  b();\n+}\n';
  const result = translate(base, current, patch);
  assert.ok(result.ok);
  assert.equal(result.text, 'fn z() {\n}\n\nfn a() {\n}\n\nfn b() {\n  b();\n}\n\nfn c() {\n}\n');
  // An insertion between blank lines keeps its gap.
  const blanks = translate('x\n\n\ny\n', 'top\nx\n\n\ny\n', '@@ -2,0 +3 @@\n+mid\n');
  assert.ok(blanks.ok && blanks.text === 'top\nx\n\nmid\n\ny\n', JSON.stringify(blanks));
  // Ambiguous translation: someone duplicated the edited line, so either copy could be "the" b.
  // The insertion touches the edited line wherever the diff places it, so this is rejected.
  assert.equal(translate('a\nb\nc\n', 'a\nb\nb\nc\n', '@@ -2 +2 @@\n-b\n+B\n').ok, false);
  assert.equal(translate('a\nb\nc\n', 'a\nb\nb\nc\n', '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n').ok, false);
  // An insertion into the same gap as a change since the base is a conflict.
  assert.equal(translate('x\ny\n', 'x\nother\ny\n', '@@ -1,0 +2 @@\n+mine\n').ok, false);
}
{
  // A patch that does not fit its own declared base is a context mismatch, not a placement.
  const result = translate(REPRO_BASE, REPRO_CURRENT, '@@ -3 +3 @@\n-q\n+Q\n');
  assert.ok(!result.ok && result.reason === 'patch-context-mismatch');
}
{
  // EOL and end-of-file newline changes are changes like any other (#362).
  const crlf = translate('a\r\nb\r\nc\r\n', 'top\r\na\r\nb\r\nc\r\n', '@@ -2 +2 @@\n-b\r\n+B\r\n');
  assert.ok(crlf.ok && crlf.text === 'top\r\na\r\nB\r\nc\r\n');
  const noFinal = translate('a\nb', 'top\na\nb', '@@ -2 +2 @@\n-b\n\\ No newline at end of file\n+B\n\\ No newline at end of file\n');
  assert.ok(noFinal.ok && noFinal.text === 'top\na\nB');
  const eofInsert = translate('a\nb', 'top\na\nb', '@@ -2,0 +3 @@\n+c\n');
  assert.ok(eofInsert.ok && eofInsert.text === applyUnifiedPatch('top\na\nb', '@@ -3,0 +4 @@\n+c\n'), JSON.stringify(eofInsert));
  // Someone else added the final newline: the EOF line changed, a stale edit of it conflicts.
  assert.equal(translate('a\nb', 'a\nb\n', '@@ -2 +2 @@\n-b\n\\ No newline at end of file\n+B\n\\ No newline at end of file\n').ok, false);
}
{
  // Rendered zero-context patch round-trips on the current file.
  const result = translate(REPRO_BASE, REPRO_CURRENT, '@@ -1,4 +1,4 @@\n a\n-b\n+B2\n b\n-c\n+C\n');
  assert.ok(result.ok);
  const rendered = renderTranslatedPatch('f.txt', REPRO_CURRENT, result.blocks);
  assert.equal(applyUnifiedPatch(REPRO_CURRENT, rendered), result.text);
  assert.equal(result.text, 'Z\na\nB2\nb\nC\n');
}
{
  // Forward line map used by #360: unchanged lines map, changed ones do not.
  const theirs = diffLineBlocks(lineTokens('a\nb\nc\nd\n'), lineTokens('top\na\nB\nc\nd\n'));
  assert.deepEqual([0, 1, 2, 3].map((i) => mapBaseLineForward(i, theirs)), [1, null, 3, 4]);
}

// --- differential against git merge-file ------------------------------------
let seed = 363363;
const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
function mutate(lines: readonly string[], tag: string, vocab: readonly string[]): string[] {
  const out = [...lines];
  for (let edit = 0, count = 1 + random(3); edit < count; edit += 1) {
    const at = random(out.length + 1);
    const remove = at < out.length ? random(3) : 0;
    const added = Array.from({ length: random(3) }, (_, k) => (vocab.length > 0 && random(2) === 0 ? vocab[random(vocab.length)]! : `${tag}-${edit}-${k}`));
    out.splice(at, remove, ...added);
  }
  return out;
}
const directory = mkdtempSync(path.join(os.tmpdir(), 'atm-stale-translate-'));
const counts = { equal: 0, bothConflict: 0, oursStricter: 0 };
try {
  for (const [label, vocab] of [['unique', [] as string[]], ['repetitive', ['', '}', 'return x;', 'b']]] as const) {
    for (let sample = 0; sample < 150; sample += 1) {
      const baseLines = Array.from({ length: 4 + random(16) }, (_, i) => (vocab.length > 0 && random(3) === 0 ? vocab[random(vocab.length)]! : `s${sample}-l${i}`));
      const base = `${baseLines.join('\n')}\n`;
      const ours = `${mutate(baseLines, 'ours', vocab).join('\n')}\n`;
      const current = `${mutate(baseLines, 'theirs', vocab).join('\n')}\n`;
      if (ours === base) continue;
      writeFileSync(path.join(directory, 'base'), base);
      writeFileSync(path.join(directory, 'ours'), ours);
      writeFileSync(path.join(directory, 'current'), current);
      const merged = spawnSync('git', ['merge-file', '-p', 'current', 'base', 'ours'], { cwd: directory, encoding: 'utf8' });
      assert.ok(merged.status !== null && merged.status >= 0, merged.stderr);
      const gitClean = merged.status === 0;
      for (const context of [0, 1, 3]) {
        const diff = spawnSync('git', ['diff', '--no-index', '--no-color', `-U${context}`, '--', 'base', 'ours'], { cwd: directory, encoding: 'utf8' });
        const patch = diff.stdout.replaceAll('b/ours', 'b/base');
        const result = translateStalePatch({ baseText: base, currentText: current, hunks: parseUnifiedPatchHunks(patch) });
        const tag = `${label} sample ${sample} -U${context}`;
        assert.ok(result.ok || result.reason === 'stale-base-conflict', `${tag}: ${JSON.stringify(result)}`);
        if (result.ok) {
          // Whenever we apply, git merges cleanly to exactly the same bytes.
          assert.ok(gitClean, `${tag}: we applied where git conflicts\n${JSON.stringify({ base, ours, current, text: result.text })}`);
          assert.equal(result.text, merged.stdout, `${tag}\n${JSON.stringify({ base, ours, current })}`);
          counts.equal += 1;
        } else if (gitClean) {
          counts.oursStricter += 1;
        } else {
          counts.bothConflict += 1;
        }
      }
    }
  }
  assert.ok(counts.equal > 200, JSON.stringify(counts));
  assert.ok(counts.bothConflict > 50, JSON.stringify(counts));
} finally {
  rmSync(directory, { recursive: true, force: true });
}

// --- C1: live write ---------------------------------------------------------
function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function makeRepo(content: string, file = 'f.txt'): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-stale-repo-'));
  git(repo, ['init', '-q']);
  writeFileSync(path.join(repo, file), content);
  git(repo, ['add', '--', file]);
  git(repo, ['-c', 'user.name=atm', '-c', 'user.email=atm@example.com', 'commit', '-q', '-m', 'base']);
  return repo;
}
function proposal(input: { id: string; actor: string; hash: string; head: string; patch: string; file?: string; anchors?: PatchProposal['anchors'] }): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1', specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'stale-base translation fixture' },
    proposalId: input.id, taskId: `TASK-${input.id}`, actorId: input.actor, baseCommit: input.head,
    fileBeforeHash: input.hash, targetFile: input.file ?? 'f.txt',
    atomRefs: [{ atomId: `atom.${input.id}`, atomCid: `cid.${input.id}` }],
    anchors: input.anchors ?? [{ kind: 'line-range', hint: '3-3' }],
    intent: input.id, patch: input.patch, validators: [], rollback: 'discard'
  } as PatchProposal;
}
const repos: string[] = [];
try {
  {
    const repo = makeRepo(REPRO_BASE);
    repos.push(repo);
    const head = git(repo, ['rev-parse', 'HEAD']);
    const result = applyLiveQueuedWrites({ cwd: repo, scopeFiles: ['f.txt'], proposals: [
      proposal({ id: 'A-top', actor: 'A', hash: hashContent(REPRO_BASE), head, patch: '@@ -0,0 +1 @@\n+Z\n' }),
      proposal({ id: 'B-second-b', actor: 'B', hash: hashContent(REPRO_BASE), head, patch: B3 })
    ] });
    assert.deepEqual(result.writes.map((write) => write.decision), ['accepted', 'accepted'], JSON.stringify(result.writes));
    assert.equal(readFileSync(path.join(repo, 'f.txt'), 'utf8'), 'Z\na\nb\nB3\nc\n');
    assert.deepEqual(result.writes[1]?.hunkOffsets, [{ declaredOldStart: 3, appliedOldStart: 4, offset: 1 }]);
    const journal = readFileSync(path.join(repo, '.atm/runtime/live-write-journal.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).filter((entry) => !entry.kind || entry.kind === 'committed');
    assert.deepEqual(journal[1].changedLines, [3, 4], 'journal records current coordinates');
  }
  {
    // A changed the second b: B's stale edit of it is rejected, file untouched.
    const repo = makeRepo(REPRO_BASE);
    repos.push(repo);
    const head = git(repo, ['rev-parse', 'HEAD']);
    const result = applyLiveQueuedWrites({ cwd: repo, scopeFiles: ['f.txt'], proposals: [
      proposal({ id: 'A-second-b', actor: 'A', hash: hashContent(REPRO_BASE), head, patch: '@@ -3 +3 @@\n-b\n+A3\n' }),
      proposal({ id: 'B-second-b', actor: 'B', hash: hashContent(REPRO_BASE), head, patch: B3 })
    ] });
    assert.equal(result.writes[0]?.decision, 'accepted');
    assert.equal(result.writes[1]?.decision, 'rejected-by-design');
    assert.equal(result.writes[1]?.reasonCode, 'overlapping-write-queued');
    assert.equal(readFileSync(path.join(repo, 'f.txt'), 'utf8'), 'a\nb\nA3\nc\n');
  }
  {
    // A deleted the first b (line 2): B's stale edit of the second b is adjacent, so rejected
    // (git merge-file conflicts too), and never re-read onto the remaining b.
    const repo = makeRepo(REPRO_BASE);
    repos.push(repo);
    const head = git(repo, ['rev-parse', 'HEAD']);
    const result = applyLiveQueuedWrites({ cwd: repo, scopeFiles: ['f.txt'], proposals: [
      proposal({ id: 'A-del', actor: 'A', hash: hashContent(REPRO_BASE), head, patch: '@@ -2 +1,0 @@\n-b\n' }),
      proposal({ id: 'B-second-b', actor: 'B', hash: hashContent(REPRO_BASE), head, patch: B3 })
    ] });
    assert.equal(result.writes[0]?.decision, 'accepted');
    assert.equal(result.writes[1]?.decision, 'rejected-by-design');
    assert.equal(readFileSync(path.join(repo, 'f.txt'), 'utf8'), 'a\nb\nc\n');
  }
  {
    // A declared base that is not in history is stale-base.
    const repo = makeRepo(REPRO_BASE);
    repos.push(repo);
    const head = git(repo, ['rev-parse', 'HEAD']);
    const result = applyLiveQueuedWrites({ cwd: repo, scopeFiles: ['f.txt'], proposals: [
      proposal({ id: 'B-unknown', actor: 'B', hash: hashContent('never committed\n'), head, patch: B3 })
    ] });
    assert.equal(result.writes[0]?.reasonCode, 'stale-base');
    assert.equal(readFileSync(path.join(repo, 'f.txt'), 'utf8'), REPRO_BASE);
  }

  // --- C3: steward re-compose inside the apply queue -------------------------
  for (const [label, landed, expected] of [
    ['disjoint', REPRO_CURRENT, 'Z\na\nb\nB3\nc\n'],
    ['conflict', 'a\nb\nX\nc\n', null]
  ] as const) {
    const repo = makeRepo(REPRO_BASE);
    repos.push(repo);
    const head = git(repo, ['rev-parse', 'HEAD']);
    const B = proposal({ id: `B-steward-${label}`, actor: 'B', hash: hashContent(REPRO_BASE), head, patch: `--- a/f.txt\n+++ b/f.txt\n${B3}` });
    let landedA = false;
    const apply = applyStewardPlan({
      cwd: repo,
      stewardId: 'neutral-write-steward',
      mergePlan: composeBrokerProposals([B]).mergePlan,
      proposals: [B],
      scopeFiles: ['f.txt'],
      recomposePolicy: { maxRecomposeAttempts: 3, recomposeBackoffMs: 0, recomposeJitterMs: 0 },
      commitHooks: {
        beforePrecheck() {
          if (landedA) return;
          landedA = true;
          // A's commit lands between B's validation and B's commit.
          writeFileSync(path.join(repo, 'f.txt'), landed);
          git(repo, ['-c', 'user.name=atm', '-c', 'user.email=atm@example.com', 'commit', '-q', '-am', 'A']);
        }
      }
    });
    const final = readFileSync(path.join(repo, 'f.txt'), 'utf8');
    assert.ok(landedA, `${label}: hook ran`);
    if (expected === null) {
      assert.equal(apply.ok, false, `${label}: ${JSON.stringify(apply.evidence)}`);
      assert.equal(final, landed, `${label}: rejected, file keeps A's commit only`);
      assert.match(JSON.stringify(apply.evidence.blockedReasons), /stale-base-conflict/);
    } else {
      assert.equal(apply.ok, true, `${label}: ${JSON.stringify(apply.evidence.blockedReasons)}`);
      assert.equal(final, expected, `${label}: B3 on the second b`);
    }
    assert.notEqual(final, 'Z\na\nB3\nb\nc\n', `${label}: never the first b`);
  }
} finally {
  for (const repo of repos) rmSync(repo, { recursive: true, force: true });
}
console.log(`[stale-base-translation] ok ${JSON.stringify(counts)}`);
