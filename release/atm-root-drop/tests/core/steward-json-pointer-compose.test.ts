import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPatchProposalComposition } from '../../packages/core/src/broker/steward-transactional-apply.ts';
import { composeJsonPointerPatches } from '../../packages/core/src/broker/steward-json-pointer-compose.ts';
import { brokerAdapterMigration, type MergePlan, type PatchProposal } from '../../packages/core/src/broker/types.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-steward-json-pointer-'));
const before = '{\n  "files": ["dist", "src"],\n  "dependencies": {}\n}\n';
const proposal = (id: string, actorId: string, anchor: string, patch: string): PatchProposal => ({
  schemaId: 'atm.patchProposal.v1', specVersion: '0.1.0', migration: brokerAdapterMigration(),
  proposalId: id, taskId: id, actorId, baseCommit: 'base', fileBeforeHash: `sha256:${createHash('sha256').update(before, 'utf8').digest('hex')}`,
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
  assert.equal(result.outputFiles[0].content, '{\n  "files": ["dist"],\n  "atmArtifactBudget": { "maxPackedEntries": 1 },\n  "dependencies": {}\n}\n');
  assert.deepEqual(JSON.parse(result.outputFiles[0].content), {
    files: ['dist'], atmArtifactBudget: { maxPackedEntries: 1 }, dependencies: {}
  });
  assert.deepEqual(result.plan.memberAttribution.map((entry) => entry.actorId), ['cursor', 'claude']);
  assert.equal(readFileSync(path.join(cwd, 'package.json'), 'utf8'), before, 'composition must remain in-memory');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}


// Independent sessions prepare against one immutable base; arrival order must
// neither lose a selected edit nor change the byte output or attribution.
function patchFor(base: string, after: string): string {
  const oldLines = (base.endsWith('\n') ? base.slice(0, -1) : base).split('\n');
  const newLines = (after.endsWith('\n') ? after.slice(0, -1) : after).split('\n');
  return ['--- a/package.json', '+++ b/package.json',
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`), ...(base.endsWith('\n') ? [] : ['\\ No newline at end of file']),
    ...newLines.map((line) => `+${line}`), ...(after.endsWith('\n') ? [] : ['\\ No newline at end of file']), ''].join('\n');
}

function composeFixture(base: string, sessions: readonly { pointer: string; after: string }[], expected: string | null): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-json-sessions-'));
  try {
    writeFileSync(path.join(root, 'package.json'), base);
    const proposals = sessions.map((session, index) => ({
      ...proposal(`session-${index}`, `actor-${index}`, session.pointer, patchFor(base, session.after)),
      fileBeforeHash: `sha256:${createHash('sha256').update(base).digest('hex')}`
    }));
    for (const order of [proposals, [...proposals].reverse()]) {
      const result = buildPatchProposalComposition({ cwd: root, mergePlan, proposals: order });
      if (expected === null) {
        assert.equal(result.blocked?.code, 'steward-final-patch-required');
        assert.deepEqual(result.outputFiles, []);
        assert.deepEqual(result.plan.selectedRequestIds, []);
        assert.equal(result.plan.memberAttribution.filter((member) => member.verdict === 'selected').length, 0);
        assert.deepEqual(result.plan.blockedRequestIds, proposals.map((p) => p.proposalId));
      } else {
        assert.equal(result.blocked, null);
        assert.equal(result.outputFiles[0]?.content, expected);
        assert.deepEqual(result.plan.selectedRequestIds, proposals.map((p) => p.proposalId));
        assert.deepEqual(result.plan.memberAttribution.map((p) => p.actorId), ['actor-0', 'actor-1']);
        assert.equal(result.plan.serializabilityProof.permutationStable, true);
      }
      assert.equal(readFileSync(path.join(root, 'package.json'), 'utf8'), base);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const nested = '{"a":{"b":1,"c":0}}\n';
// Conflicting /a and /a/b must fall back and block, without selected attribution.
composeFixture(nested, [
  { pointer: '/a', after: '{"a":{"b":3,"c":9}}\n' },
  { pointer: '/a/b', after: '{"a":{"b":2,"c":0}}\n' }
], null);
// Even semantically compatible nested edits are intentionally ineligible under
// AC1: /a still owns all of its subtree, so overlapping text requires a steward.
composeFixture(nested, [
  { pointer: '/a', after: '{"a":{"b":1,"c":9}}\n' },
  { pointer: '/a/b', after: '{"a":{"b":2,"c":0}}\n' }
], null);
const odd = '{"keep":   [1,2],\r\n "x": 1, "y" : 4}\r\n';
composeFixture(odd, [
  { pointer: '/x', after: odd.replace('"x": 1', '"x": 200') },
  { pointer: '/y', after: odd.replace('"y" : 4', '"y" : 50') }
], odd.replace('"x": 1', '"x": 200').replace('"y" : 4', '"y" : 50'));
const siblings = '{"a":1,"ab":2}\n';
composeFixture(siblings, [
  { pointer: '/a', after: '{"a":3,"ab":2}\n' },
  { pointer: '/ab', after: '{"a":1,"ab":4}\n' }
], '{"a":3,"ab":4}\n');
// Decoding ~1 and ~0 must recognize actual ancestors, and must not split an
// escaped slash into two path segments or decode ~01 twice.
for (const [key, pointer] of [['a/b', '/a~1b'], ['a~b', '/a~0b'], ['a~1b', '/a~01b']]) {
  const base = `{${JSON.stringify(key)}:{"b":1,"c":0}}\n`;
  composeFixture(base, [
    { pointer, after: base.replace('"c":0', '"c":9') },
    { pointer: `${pointer}/b`, after: base.replace('"b":1', '"b":2') }
  ], null);
}
const escaped = '{"a/b":1,"a":{"b":2}}\n';
composeFixture(escaped, [
  { pointer: '/a~1b', after: escaped.replace('"a/b":1', '"a/b":3') },
  { pointer: '/a/b', after: escaped.replace('"b":2', '"b":4') }
], '{"a/b":3,"a":{"b":4}}\n');
// Reformatting creates overlapping byte spans even for sibling semantic edits:
// fall back rather than invent a freshly serialized document.
composeFixture(siblings, [
  { pointer: '/a', after: '{ "a": 3, "ab": 2 }\n' },
  { pointer: '/ab', after: '{ "a": 1, "ab": 4 }\n' }
], null);
composeFixture(siblings, [
  { pointer: '/a', after: '{"a":3,"ab":9}\n' }, // hidden mutation
  { pointer: '/ab', after: '{"a":1,"ab":4}\n' }
], null);
composeFixture(siblings, [
  { pointer: '/a', after: '{"a":3,"ab":2}\n' },
  { pointer: '/a', after: '{"a":4,"ab":2}\n' }
], null);
// Independently valid deletions must not yield invalid JSON when combined.
composeFixture(siblings, [
  { pointer: '/a', after: '{"ab":2}\n' },
  { pointer: '/ab', after: '{"a":1}\n' }
], null);
// Invalid anchors and documents delegate to the immutable-base text route.
for (const pointer of ['', '/a~2', '/a~']) {
  assert.equal(composeJsonPointerPatches(siblings, [
    proposal('invalid', 'actor', pointer, patchFor(siblings, '{"a":3,"ab":2}\n'))
  ]), null);
}
assert.equal(composeJsonPointerPatches('invalid JSON', [files, budget]), null);
// EOF and multibyte characters also remain byte-for-byte unchanged.
const unicode = '{"keep":"雪😀", "a":1, "ab":2}';
composeFixture(unicode, [
  { pointer: '/a', after: unicode.replace('"a":1', '"a":3') },
  { pointer: '/ab', after: unicode.replace('"ab":2', '"ab":4') }
], unicode.replace('"a":1', '"a":3').replace('"ab":2', '"ab":4'));
console.log('[steward-json-pointer-compose] ok');
