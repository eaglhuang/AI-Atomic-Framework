// End-of-file newline regression.
//
// git apply honors `\ No newline at end of file`. The steward applier, the
// base composer, and region re-compose must write those same bytes.
//
// caseId: test_unified_patch_eof_newline_matches_git_apply
// semanticKey: a_unified_diff_no_newline_marker_preserves_eof_newline_state
//
// Runnable directly via:
//   node --strip-types tests/cli/unified-patch-eof-newline.test.ts

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashContent } from '../../packages/core/src/broker/adapters/cas.ts';
import { composeBrokerProposals } from '../../packages/core/src/broker/compose.ts';
import { composeTextPatchesAgainstBase } from '../../packages/core/src/broker/steward-base-composer.ts';
import { applyStewardPlan } from '../../packages/core/src/broker/steward.ts';
import { applyUnifiedPatch } from '../../packages/core/src/broker/unified-patch.ts';
import type { PatchProposal } from '../../packages/core/src/broker/types.ts';

const MARKER = '\\ No newline at end of file';

function git(cwd: string, args: string[], input?: string): string {
  const result = spawnSync('git', ['-C', cwd, ...args], {
    input,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'ATM',
      GIT_AUTHOR_EMAIL: 'atm@example.com',
      GIT_COMMITTER_NAME: 'ATM',
      GIT_COMMITTER_EMAIL: 'atm@example.com'
    }
  });
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stderr || result.stdout}`);
  return String(result.stdout ?? '');
}

function initRepo(root: string): void {
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'atm@example.com']);
  git(root, ['config', 'user.name', 'ATM']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  git(root, ['config', 'core.autocrlf', 'false']);
}

function commitFile(root: string, relativePath: string, content: string): string {
  const absolute = path.join(root, relativePath);
  writeFileSync(absolute, content);
  git(root, ['add', '--', relativePath]);
  git(root, ['commit', '-q', '-m', 'base']);
  return git(root, ['rev-parse', 'HEAD']).trim();
}

function diffAgainstHead(root: string, relativePath: string, after: string): string {
  writeFileSync(path.join(root, relativePath), after);
  const patch = git(root, ['diff', '-U3', '--', relativePath]);
  git(root, ['checkout', '-q', '--', relativePath]);
  return patch;
}

function gitApply(root: string, relativePath: string, patch: string): Buffer {
  git(root, ['checkout', '-q', '--', relativePath]);
  const applied = spawnSync('git', ['-C', root, 'apply', '--whitespace=nowarn'], {
    input: patch,
    encoding: 'utf8'
  });
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  return readFileSync(path.join(root, relativePath));
}

function bytes(content: string): Buffer {
  return Buffer.from(content, 'utf8');
}

function assertGitRoundTrip(root: string, relativePath: string, before: string, after: string, label: string): string {
  const patch = diffAgainstHead(root, relativePath, after);
  const applied = applyUnifiedPatch(before, patch);
  const fromGit = gitApply(root, relativePath, patch);
  assert.equal(Buffer.compare(bytes(applied), fromGit), 0, `${label}: applyUnifiedPatch bytes differ from git apply`);
  assert.equal(Buffer.compare(bytes(after), fromGit), 0, `${label}: expected text differs from git apply`);
  const composed = composeTextPatchesAgainstBase(relativePath, before, [proposal({
    proposalId: `${label}-single`,
    actorId: 'writer-single',
    anchor: `L1:${label}`,
    patch,
    baseCommit: 'base',
    fileBeforeHash: hashContent(before),
    targetFile: relativePath
  })]);
  assert.equal(composed.ok, true, `${label}: composer blocked ${composed.ok ? '' : composed.block.detail}`);
  if (composed.ok) {
    assert.equal(Buffer.compare(bytes(composed.content), fromGit), 0, `${label}: composer bytes differ from git apply`);
  }
  return patch;
}

function proposal(input: {
  readonly proposalId: string;
  readonly actorId: string;
  readonly anchor: string;
  readonly patch: string;
  readonly baseCommit: string;
  readonly fileBeforeHash: string;
  readonly targetFile: string;
}): PatchProposal {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'eof-newline fixture' },
    proposalId: input.proposalId,
    taskId: `TASK-${input.proposalId}`,
    actorId: input.actorId,
    baseCommit: input.baseCommit,
    fileBeforeHash: input.fileBeforeHash,
    targetFile: input.targetFile,
    atomRefs: [{ atomId: `atom.${input.proposalId}`, atomCid: `cid.${input.proposalId}` }],
    anchors: [{ kind: 'line', hint: input.anchor }],
    intent: input.proposalId,
    patch: input.patch,
    validators: [],
    rollback: 'discard'
  };
}

function stewardBytes(root: string, relativePath: string, baseOnDisk: string, proposals: readonly PatchProposal[]): Buffer {
  writeFileSync(path.join(root, relativePath), baseOnDisk);
  const mergePlan = composeBrokerProposals(proposals).mergePlan;
  const result = applyStewardPlan({
    cwd: root,
    stewardId: 'neutral-write-steward',
    mergePlan,
    proposals,
    scopeFiles: [relativePath],
    applyQueue: false,
    recomposePolicy: { maxRecomposeAttempts: 0, recomposeBackoffMs: 0, recomposeJitterMs: 0 }
  });
  assert.equal(result.ok, true, `steward blocked: ${JSON.stringify(result.evidence.blockedReasons ?? result)}`);
  return readFileSync(path.join(root, relativePath));
}

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-eof-newline-'));
try {
  initRepo(root);

  // --- old no-EOL -> new no-EOL, edit on the last line ---
  {
    const relativePath = 'last.py';
    const before = 'alpha\nbeta';
    const after = 'alpha\nBETA';
    commitFile(root, relativePath, before);
    const patch = assertGitRoundTrip(root, relativePath, before, after, 'both-no-eol-last-line');
    assert.match(patch, /\\ No newline at end of file/);
    assert.equal(patch.split(MARKER).length - 1, 2, 'both sides of the last line must carry the marker');
  }

  // --- add a final newline ---
  {
    const relativePath = 'add-eol.py';
    const before = 'alpha\nbeta';
    const after = 'alpha\nbeta\n';
    commitFile(root, relativePath, before);
    const patch = assertGitRoundTrip(root, relativePath, before, after, 'add-eol');
    assert.match(patch, /\\ No newline at end of file/);
    assert.equal(after.endsWith('\n'), true);
  }

  // --- remove a final newline ---
  {
    const relativePath = 'remove-eol.py';
    const before = 'alpha\nbeta\n';
    const after = 'alpha\nbeta';
    commitFile(root, relativePath, before);
    const patch = assertGitRoundTrip(root, relativePath, before, after, 'remove-eol');
    assert.match(patch, /\\ No newline at end of file/);
    assert.equal(after.endsWith('\n'), false);
  }

  // --- edit that does not change the last line of a no-EOL file; the hunk still carries the marker ---
  {
    const relativePath = 'not-last.py';
    const before = 'alpha\nbeta\ngamma';
    const after = 'ALPHA\nbeta\ngamma';
    commitFile(root, relativePath, before);
    const patch = assertGitRoundTrip(root, relativePath, before, after, 'edit-not-last-line');
    assert.match(patch, /\\ No newline at end of file/);
    assert.equal(after.endsWith('\n'), false);
  }

  // --- deleting the no-EOL last line leaves the previous line's newline in place ---
  {
    const relativePath = 'delete-last.py';
    const before = 'alpha\nbeta';
    const after = 'alpha\n';
    commitFile(root, relativePath, before);
    assertGitRoundTrip(root, relativePath, before, after, 'delete-last-no-eol-line');
  }

  // --- CRLF file without a final newline, plus adding and removing that newline ---
  {
    const relativePath = 'crlf.py';
    const before = 'alpha\r\nbeta';
    const edited = 'alpha\r\nBETA';
    const withNewline = 'alpha\r\nbeta\r\n';
    const removed = 'alpha\r\nbeta';
    commitFile(root, relativePath, before);
    const keep = assertGitRoundTrip(root, relativePath, before, edited, 'crlf-no-final-newline');
    assert.match(keep, /\\ No newline at end of file/);
    assert.equal(edited.endsWith('\n'), false);
    commitFile(root, 'crlf-add.py', before);
    assertGitRoundTrip(root, 'crlf-add.py', before, withNewline, 'crlf-add-eol');
    commitFile(root, 'crlf-remove.py', withNewline);
    assertGitRoundTrip(root, 'crlf-remove.py', withNewline, removed, 'crlf-remove-eol');
  }

  // --- two disjoint writers on a no-EOL file, modeled on HIST sympy:26412_26438 actuator.py ---
  {
    const relativePath = 'actuator.py';
    const pad = Array.from({ length: 12 }, (_, index) => `# pad ${index}`).join('\n');
    const before = [
      '"""Synthetic force actuator."""',
      '',
      'class ForceActuator:',
      '    def force(self):',
      '        return 0  # force',
      '',
      pad,
      '',
      'class TorqueActuator:',
      '    def torque(self):',
      '        return 0  # torque',
      '# end'
    ].join('\n');
    assert.equal(before.endsWith('\n'), false);
    const afterForce = before.replace('return 0  # force', 'return self.mu  # force');
    const afterTorque = before.replace('return 0  # torque', 'return self.k  # torque');
    const afterBoth = afterForce.replace('return 0  # torque', 'return self.k  # torque');
    const head = commitFile(root, relativePath, before);
    const patchForce = diffAgainstHead(root, relativePath, afterForce);
    const patchTorque = diffAgainstHead(root, relativePath, afterTorque);
    const patchBoth = diffAgainstHead(root, relativePath, afterBoth);
    assert.match(patchTorque, /\\ No newline at end of file/);
    assert.equal(Buffer.compare(bytes(applyUnifiedPatch(before, patchForce)), gitApply(root, relativePath, patchForce)), 0, 'force writer apply');
    assert.equal(Buffer.compare(bytes(applyUnifiedPatch(before, patchTorque)), gitApply(root, relativePath, patchTorque)), 0, 'torque writer apply');
    const gitBoth = gitApply(root, relativePath, patchBoth);
    assert.equal(Buffer.compare(bytes(afterBoth), gitBoth), 0, 'combined git apply');
    const force = proposal({
      proposalId: 'sympy-26412-force',
      actorId: 'writer-force',
      anchor: 'L4:force',
      patch: patchForce,
      baseCommit: head,
      fileBeforeHash: hashContent(before),
      targetFile: relativePath
    });
    const torque = proposal({
      proposalId: 'sympy-26438-torque',
      actorId: 'writer-torque',
      anchor: 'L20:torque',
      patch: patchTorque,
      baseCommit: head,
      fileBeforeHash: hashContent(before),
      targetFile: relativePath
    });
    const composed = composeTextPatchesAgainstBase(relativePath, before, [force, torque]);
    assert.equal(composed.ok, true, `composer two-writer blocked ${composed.ok ? '' : composed.block.detail}`);
    if (composed.ok) {
      assert.equal(Buffer.compare(bytes(composed.content), gitBoth), 0, 'two-writers-composer');
    }
    const written = stewardBytes(root, relativePath, before, [force, torque]);
    assert.equal(Buffer.compare(written, gitBoth), 0, 'two-writers-steward');
    assert.equal(written.includes('return self.mu  # force'), true);
    assert.equal(written.includes('return self.k  # torque'), true);
    assert.equal(written.subarray(written.length - 1).toString(), 'd', 'actuator.py must not gain a trailing newline');
  }

  // --- two region writers, line numbers stale, file still has no trailing newline ---
  {
    const relativePath = 'regions.ts';
    const before = [
      '// <region:actions>',
      'export const beforeA = 1;',
      'export const actions = [];',
      'export const afterA = 1;',
      '// </region:actions>',
      ...Array.from({ length: 8 }, (_, index) => `// gap ${index}`),
      '// <region:reducers>',
      'export const beforeB = 2;',
      'export const reducers = [];',
      'export const afterB = 2;',
      '// </region:reducers>'
    ].join('\n');
    assert.equal(before.endsWith('\n'), false);
    const afterA = before.replace('export const actions = [];', 'export const actions = ["A"];');
    const afterB = before.replace('export const afterB = 2;', 'export const afterB = 3;');
    const afterBoth = afterA.replace('export const afterB = 2;', 'export const afterB = 3;');
    const head = commitFile(root, relativePath, before);
    const patchA = diffAgainstHead(root, relativePath, afterA);
    const patchB = diffAgainstHead(root, relativePath, afterB);
    assert.match(patchB, /\\ No newline at end of file/);
    assert.equal(Buffer.compare(bytes(applyUnifiedPatch(before, patchB)), gitApply(root, relativePath, patchB)), 0, 'reducer patch git apply');
    const shifted = `// shifted\n${before}`;
    const expected = `// shifted\n${afterBoth}`;
    const gitNet = oracleBytes(shifted, expected, relativePath);
    const writerA = proposal({
      proposalId: 'region-actions',
      actorId: 'writer-actions',
      anchor: 'L3:actions',
      patch: patchA,
      baseCommit: head,
      fileBeforeHash: hashContent(before),
      targetFile: relativePath
    });
    const writerB = proposal({
      proposalId: 'region-reducers',
      actorId: 'writer-reducers',
      anchor: 'L16:reducers',
      patch: patchB,
      baseCommit: head,
      fileBeforeHash: hashContent(before),
      targetFile: relativePath
    });
    const rebased = composeTextPatchesAgainstBase(relativePath, shifted, [writerA, writerB]);
    assert.equal(rebased.ok, true, `region re-compose blocked ${rebased.ok ? '' : rebased.block.detail}`);
    if (rebased.ok) {
      assert.equal(Buffer.compare(bytes(rebased.content), gitNet), 0, 'two-writers-region-recompose');
      assert.equal(rebased.content, expected);
    }
    const written = stewardBytes(root, relativePath, shifted, [writerA, writerB]);
    assert.equal(Buffer.compare(written, gitNet), 0, 'two-writers-region-steward');
  }

  console.log('[unified-patch-eof-newline] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}

function oracleBytes(before: string, after: string, relativePath: string): Buffer {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'atm-eof-oracle-'));
  try {
    initRepo(dir);
    commitFile(dir, relativePath, before);
    const patch = diffAgainstHead(dir, relativePath, after);
    return gitApply(dir, relativePath, patch);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
