import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  createContentAnchor,
  resolveContentAnchor
} from '../packages/core/src/broker/boundaries/index.ts';

const root = process.cwd();
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const contentAnchorSchema = readJson('schemas/governance/content-anchor.schema.json');
const writeIntentSchema = readJson('schemas/governance/write-intent.schema.json');
const patchProposalSchema = readJson('schemas/governance/patch-proposal.schema.json');
ajv.addSchema(contentAnchorSchema);
ajv.addSchema(writeIntentSchema, 'write-intent');
ajv.addSchema(patchProposalSchema, 'patch-proposal');

const sourceText = ['one', 'two', 'three'].join('\n');
const anchor = createContentAnchor({
  baseDigest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  filePath: 'docs/example.md',
  sourceText,
  kind: 'text-context',
  lineStart: 2,
  lineEnd: 2,
  provenance: { adapterId: 'text-range', adapterVersion: '0.1.0', createdAt: '2026-07-20T00:00:00.000Z' },
  confidence: 'medium'
});

assert.ok(ajv.validate(contentAnchorSchema, anchor), formatErrors(ajv.errors));
assert.equal(resolveContentAnchor({
  anchor,
  currentFilePath: 'docs/example.md',
  currentSourceText: ['zero', 'one', 'two', 'three'].join('\n')
}).status, 'resolved');

const writeIntent = {
  schemaId: 'atm.writeIntent.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'content anchor schema fixture' },
  taskId: 'ATM-GOV-0208',
  actorId: 'schema-validator',
  baseCommit: 'abc123',
  targetFiles: ['docs/example.md'],
  atomRefs: [{ atomId: 'docs/example.md::line::two', atomCid: 'cid-two', operation: 'modify', contentAnchors: [anchor] }],
  sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
  requestedLane: 'auto'
};
assert.ok(ajv.getSchema('write-intent')?.(writeIntent), formatErrors(ajv.errors));

const patchProposal = {
  schemaId: 'atm.patchProposal.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'content anchor schema fixture' },
  proposalId: 'proposal-0208',
  taskId: 'ATM-GOV-0208',
  actorId: 'schema-validator',
  baseCommit: 'abc123',
  fileBeforeHash: anchor.fileDigest,
  targetFile: 'docs/example.md',
  atomRefs: [{ atomId: 'docs/example.md::line::two', atomCid: 'cid-two' }],
  anchors: [{ kind: 'content-anchor', hint: anchor.anchorId, contentAnchor: anchor }],
  intent: 'replace line two',
  patch: '@@ -2 +2 @@\n-two\n+two updated',
  validators: ['node --strip-types scripts/validate-content-anchor.ts'],
  rollback: 'revert proposal-0208'
};
assert.ok(ajv.getSchema('patch-proposal')?.(patchProposal), formatErrors(ajv.errors));

console.log('content anchor schema validator passed');

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function formatErrors(errors: unknown) {
  return JSON.stringify(errors, null, 2);
}
