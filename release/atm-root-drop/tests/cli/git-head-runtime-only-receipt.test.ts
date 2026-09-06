import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendGitHeadEvidenceJsonl } from '../../packages/cli/src/commands/git-governance/implementation/git-head-evidence-transaction.ts';
import { gitHeadEvidencePaths } from '../../packages/cli/src/commands/git-head-evidence.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-head-runtime-only-'));
try {
  const trackedReceipt = path.join(repo, gitHeadEvidencePaths.trackedReceipt);
  appendGitHeadEvidenceJsonl(trackedReceipt, {
    schemaVersion: 'atm.gitHeadEvidence.v0.1',
    evidence: [{
      evidenceKind: 'validation',
      details: {
        actorId: 'fixture-agent',
        taskId: 'TASK-GIT-HEAD-0416',
        git: {
          commitSha: 'a'.repeat(40),
          treeSha: 'b'.repeat(40),
          parentCommitShas: ['c'.repeat(40)]
        }
      }
    }]
  });

  const runtimePath = path.join(repo, gitHeadEvidencePaths.runtimeJsonl);
  assert.equal(existsSync(runtimePath), true, 'raw journal must be written to runtime storage');
  assert.equal(existsSync(trackedReceipt), true, 'compact acceptance receipt must be written to tracked storage');

  const compact = JSON.parse(readFileSync(trackedReceipt, 'utf8')) as Record<string, any>;
  assert.equal(compact.schemaVersion, 'atm.gitHeadAcceptance.v1');
  assert.equal(compact.storagePolicy, 'runtime-raw-tracked-digest');
  assert.equal(compact.source.availability, 'runtime-local');
  assert.equal(compact.source.rawJournalPath, gitHeadEvidencePaths.runtimeJsonl);
  assert.match(compact.source.rawEventDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(compact.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(compact.evidence[0].details.taskId, 'TASK-GIT-HEAD-0416');

  const rawLines = readFileSync(runtimePath, 'utf8').trim().split(/\r?\n/);
  assert.equal(rawLines.length, 1, 'raw journal must retain the complete event separately');
  assert.equal(JSON.parse(rawLines[0]).evidence[0].details.git.treeSha, 'b'.repeat(40));
  console.log('[git-head-runtime-only-receipt] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
