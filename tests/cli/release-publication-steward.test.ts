import assert from 'node:assert/strict';
import {
  createReleasePublicationReceipt,
  inspectReleasePublicationReadiness
} from '../../packages/cli/src/commands/internal-release.ts';
import { describeBuildReleaseHygienePolicy } from '../../packages/cli/src/commands/build-release-hygiene.ts';

{
  const receipt = createReleasePublicationReceipt({
    stewardActorId: 'release-captain',
    sealedSourceCommit: 'abcdef1234567890',
    artifactPath: 'release/atm-onefile/atm.mjs',
    artifactSha256: 'sha256-value',
    publicationReceipt: '.atm/history/reports/internal-release-sync/run/publication-receipt.json',
    generatedAt: '2026-07-14T00:00:00.000Z'
  });
  assert.equal(receipt.schemaId, 'atm.releasePublicationReceipt.v1');
  assert.equal(receipt.stewardActorId, 'release-captain');
  assert.equal(receipt.sealedSourceCommit, 'abcdef1234567890');
  assert.equal(receipt.artifactSha256, 'sha256-value');
  assert.match(receipt.publicationReceipt, /publication-receipt\.json$/);
}

{
  const ready = inspectReleasePublicationReadiness({
    cwd: process.cwd(),
    stewardActorId: 'release-captain',
    sealedSourceCommit: 'abcdef1234567890',
    artifactPath: 'release/atm-onefile/atm.mjs',
    artifactSha256: 'sha256-value',
    publicationReceipt: '.atm/history/reports/internal-release-sync/run/publication-receipt.json',
    dirtyFiles: []
  });
  assert.equal(ready.ok, true);
  assert.equal(ready.sealedSourceState.ok, true);
  assert.equal(ready.ownership.ok, true);
}

{
  const dirty = inspectReleasePublicationReadiness({
    cwd: process.cwd(),
    stewardActorId: 'release-captain',
    sealedSourceCommit: 'abcdef1234567890',
    artifactPath: 'release/atm-onefile/atm.mjs',
    artifactSha256: 'sha256-value',
    publicationReceipt: '.atm/history/reports/internal-release-sync/run/publication-receipt.json',
    dirtyFiles: ['packages/cli/src/commands/internal-release.ts']
  });
  assert.equal(dirty.ok, false);
  assert.equal(dirty.sealedSourceState.ok, false);
  assert.match(dirty.sealedSourceState.reason ?? '', /sealed source state/);
}

{
  const blocked = inspectReleasePublicationReadiness({
    cwd: process.cwd(),
    stewardActorId: 'release-captain',
    sealedSourceCommit: 'abcdef1234567890',
    artifactPath: 'release/atm-onefile/atm.mjs',
    artifactSha256: 'sha256-value',
    publicationReceipt: '.atm/history/reports/internal-release-sync/run/publication-receipt.json',
    dirtyFiles: [],
    activeCaptains: ['release-captain', 'other-captain']
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.ownership.ok, false);
  assert.match(blocked.ownership.reason ?? '', /agree on release artifact ownership/);

  const agreed = inspectReleasePublicationReadiness({
    cwd: process.cwd(),
    stewardActorId: 'release-captain',
    sealedSourceCommit: 'abcdef1234567890',
    artifactPath: 'release/atm-onefile/atm.mjs',
    artifactSha256: 'sha256-value',
    publicationReceipt: '.atm/history/reports/internal-release-sync/run/publication-receipt.json',
    dirtyFiles: [],
    activeCaptains: ['release-captain', 'other-captain'],
    ownershipAgreement: 'release-captain owns release/ for this sync window'
  });
  assert.equal(agreed.ok, true);
  assert.equal(agreed.ownership.agreement, 'release-captain owns release/ for this sync window');
}

{
  const policy = describeBuildReleaseHygienePolicy();
  assert.equal(policy.publicationReceiptRequired, true);
  assert.equal(policy.sealedSourceStateRequired, true);
  assert.match(policy.runnerSyncCommand, /ATM_RETAIN_RELEASE_ARTIFACTS=1/);
}

console.log('release publication steward: ok');
