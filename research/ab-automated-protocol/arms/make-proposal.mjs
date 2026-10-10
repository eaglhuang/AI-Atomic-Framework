#!/usr/bin/env node
// Builds an atm.patchProposal.v1 from a writer branch's diff against the base commit.
// Usage: node make-proposal.mjs <repoDir> <baseCommit> <branch> <targetFile> <taskId> <actorId> <outFile> [backfillFile]
// backfillFile (optional) is an atomize backfill proposal; its atomRefs for targetFile are copied in.
// The harness, not the agent, creates the proposal, so the ATM arm and the baseline see the same diff.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [repo, base, branch, target, taskId, actorId, outFile, backfillFile] = process.argv.slice(2);
const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
const before = git('show', `${base}:${target}`);
const patch = git('diff', base, branch, '--', target);
const hashContent = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

// atomRefs come from the atomize backfill (atomCid-bearing); without them validate reports missing-atom-refs.
function backfillRefs(file, targetFile) {
  if (!file) return [];
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entry = (doc.proposals || []).find((p) => p.path === targetFile);
  return entry ? entry.atomRefs || [] : [];
}

const proposal = {
  schemaId: 'atm.patchProposal.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'ab-preflight' },
  proposalId: `P-${taskId}-${actorId}`.replace(/[^A-Za-z0-9_.-]/g, '-'),
  taskId,
  actorId,
  baseCommit: base,
  fileBeforeHash: hashContent(before),
  targetFile: target,
  atomRefs: backfillRefs(backfillFile, target),
  anchors: [{ kind: 'line-range', hint: 'end-of-file', contentAnchor: undefined }],
  intent: `writer ${actorId} change for ${taskId}`,
  patch,
  validators: [],
  rollback: `revert the commit for ${branch}`,
};
fs.writeFileSync(outFile, JSON.stringify(proposal, null, 2));
console.log(outFile);
