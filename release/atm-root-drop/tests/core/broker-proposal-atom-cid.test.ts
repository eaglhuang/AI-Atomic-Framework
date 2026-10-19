import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeAtomCid, createAtomBundle } from '../../packages/core/src/registry/atom-capsule.ts';
import { fillProposalAtomCids } from '../../packages/core/src/broker/proposal-atom-cid.ts';

// Regression: a proposal that names an atom by atomId must carry the atom's CID
// without a hand-written placeholder. The CID comes from the registry entry's
// source file, using the same formula atm create records.
const sourcePath = 'atomic_workbench/atoms/ATM-CORE-0001/atom.source.mjs';
const source = 'export function greet(name) { return `hi ${name}`; }\n';
const expectedCid = computeAtomCid(createAtomBundle(source));

const repo = mkdtempSync(path.join(tmpdir(), 'atm-proposal-cid-'));
try {
  mkdirSync(path.dirname(path.join(repo, sourcePath)), { recursive: true });
  writeFileSync(path.join(repo, sourcePath), source, 'utf8');
  writeFileSync(
    path.join(repo, 'atomic-registry.json'),
    JSON.stringify({
      entries: [{ atomId: 'ATM-CORE-0001', location: { codePaths: [sourcePath] } }]
    }),
    'utf8'
  );

  const baseProposal = {
    proposalId: 'P-1',
    targetFile: 'src/greet.ts',
    atomRefs: [{ atomId: 'ATM-CORE-0001' }],
    anchors: []
  } as any;

  // Missing atomCid is filled from the registry source.
  const filled = fillProposalAtomCids(baseProposal, repo);
  assert.equal(filled.atomRefs[0].atomId, 'ATM-CORE-0001');
  assert.equal(filled.atomRefs[0].atomCid, expectedCid);
  assert.ok(filled.atomRefs[0].atomCid.startsWith('atom:cid:'));

  // The input proposal object is not mutated.
  assert.equal(baseProposal.atomRefs[0].atomCid, undefined);

  // An explicit atomCid is kept as written.
  const explicit = fillProposalAtomCids(
    { ...baseProposal, atomRefs: [{ atomId: 'ATM-CORE-0001', atomCid: 'atom:cid:explicit' }] },
    repo
  );
  assert.equal(explicit.atomRefs[0].atomCid, 'atom:cid:explicit');

  // An unknown atomId is left unchanged so schema validation still reports it.
  const unknown = fillProposalAtomCids({ ...baseProposal, atomRefs: [{ atomId: 'ATM-NOPE-0001' }] }, repo);
  assert.equal(unknown.atomRefs[0].atomCid, undefined);

  // A registry entry whose source is missing stays unresolved rather than failing.
  rmSync(path.join(repo, sourcePath));
  const missingSource = fillProposalAtomCids(baseProposal, repo);
  assert.equal(missingSource.atomRefs[0].atomCid, undefined);
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('broker-proposal-atom-cid: ok');
