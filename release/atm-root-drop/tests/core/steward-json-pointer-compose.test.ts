import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPatchProposalComposition } from '../../packages/core/src/broker/steward-transactional-apply.ts';
import { brokerAdapterMigration, type MergePlan, type PatchProposal } from '../../packages/core/src/broker/types.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-steward-json-pointer-'));
const before = '{\n  "files": ["dist", "src"],\n  "dependencies": {}\n}\n';
const proposal = (id: string, actorId: string, anchor: string, patch: string): PatchProposal => ({
  schemaId: 'atm.patchProposal.v1', specVersion: '0.1.0', migration: brokerAdapterMigration(),
  proposalId: id, taskId: id, actorId, baseCommit: 'base', fileBeforeHash: 'sha256:base',
  targetFile: 'package.json', atomRefs: [{ atomId: `atom.${id}`, atomCid: `cid:${id}` }],
  anchors: [{ kind: 'json-pointer', hint: anchor }], intent: id, patch, validators: [], rollback: 'discard'
});
const budget = proposal('budget', 'cursor', '/atmArtifactBudget', [
  'diff --git a/package.json b/package.json', '--- a/package.json', '+++ b/package.json',
  '@@ -1,4 +1,5 @@', ' {', '   "files": ["dist", "src"],', '+  "atmArtifactBudget": { "maxPackedEntries": 1 },', '   "dependencies": {}', ' }', ''
].join('\n'));
const files = proposal('files', 'claude', '/files', [
  'diff --git a/package.json b/package.json', '--- a/package.json', '+++ b/package.json',
  '@@ -1,4 +1,4 @@', ' {', '-  "files": ["dist", "src"],', '+  "files": ["dist"],', '   "dependencies": {}', ' }', ''
].join('\n'));
const mergePlan: MergePlan = {
  schemaId: 'atm.mergePlan.v1', specVersion: '0.1.0', migration: brokerAdapterMigration(), mergePlanId: 'json-pointer-compose',
  inputProposals: ['budget', 'files'], verdict: 'needs-steward', conflicts: [], applyMethod: 'steward-authored-final-patch', requiredEvidence: []
};
try {
  writeFileSync(path.join(cwd, 'package.json'), before, 'utf8');
  const result = buildPatchProposalComposition({ cwd, mergePlan, proposals: [budget, files] });
  assert.equal(result.outputFiles.length, 1);
  assert.deepEqual(JSON.parse(result.outputFiles[0].content), {
    files: ['dist'], atmArtifactBudget: { maxPackedEntries: 1 }, dependencies: {}
  });
  assert.deepEqual(result.plan.memberAttribution.map((entry) => entry.actorId), ['cursor', 'claude']);
  assert.equal(readFileSync(path.join(cwd, 'package.json'), 'utf8'), before, 'composition must remain in-memory');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}
console.log('[steward-json-pointer-compose] ok');
