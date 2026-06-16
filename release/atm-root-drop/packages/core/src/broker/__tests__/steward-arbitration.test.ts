import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  planStewardApply,
  applyStewardPlan,
  readGitHeadCommit,
  checkStewardPermission,
  arbitrateStewardRequest
} from '../steward.ts';
import type { StewardIdentity } from '../steward.ts';
import type { MergePlan, PatchProposal } from '../types.ts';

const tempFilePath = 'temp-steward-test-file.txt';

function hashText(value: string): string {
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}

function setupTempFile(content: string) {
  writeFileSync(tempFilePath, content, 'utf8');
}

function cleanupTempFile() {
  if (existsSync(tempFilePath)) {
    rmSync(tempFilePath);
  }
}

function makeProposal(overrides: Partial<PatchProposal> & { proposalId: string; targetFile: string; patch: string }): PatchProposal {
  const headCommit = readGitHeadCommit(process.cwd()) ?? '0000000000000000000000000000000000000000';
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'test' },
    taskId: overrides.taskId ?? 'TASK-TEST',
    actorId: overrides.actorId ?? 'agent-test',
    baseCommit: overrides.baseCommit ?? headCommit,
    fileBeforeHash: overrides.fileBeforeHash ?? hashText(''),
    atomRefs: overrides.atomRefs ?? [{ atomId: 'atom-1', atomCid: 'cid-1' }],
    anchors: overrides.anchors ?? [{ kind: 'line', hint: 'content' }],
    intent: overrides.intent ?? 'test intent',
    validators: overrides.validators ?? [],
    rollback: overrides.rollback ?? 'revert',
    ...overrides
  };
}

function makeMergePlan(overrides: Partial<MergePlan> & { mergePlanId: string; inputProposals: readonly string[] }): MergePlan {
  return {
    schemaId: 'atm.mergePlan.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'test' },
    verdict: 'needs-steward',
    conflicts: [],
    applyMethod: 'patch-apply',
    requiredEvidence: [],
    ...overrides
  };
}

function runTests() {
  console.log('Running steward arbitration tests...');
  const headCommit = readGitHeadCommit(process.cwd()) ?? '0000000000000000000000000000000000000000';

  // Test Case 1: Safe merge plan apply should succeed
  try {
    const originalContent = 'original content\nline2\n';
    setupTempFile(originalContent);
    const originalHash = hashText(originalContent);

    const proposal = makeProposal({
      proposalId: 'prop-1',
      targetFile: tempFilePath,
      fileBeforeHash: originalHash,
      patch: '@@ -1,2 +1,2 @@\n-original content\n+modified content\n line2'
    });

    const mergePlan = makeMergePlan({
      mergePlanId: 'mp-1',
      inputProposals: ['prop-1'],
      verdict: 'needs-steward'
    });

    const planRes = planStewardApply({
      cwd: process.cwd(),
      stewardId: 'test-steward',
      mergePlan,
      proposals: [proposal],
      scopeFiles: [tempFilePath]
    });

    assert.equal(planRes.ok, true, 'Plan should be ok for needs-steward');
    assert.equal(planRes.plan.issues.length, 0, 'No issues expected');

    const applyRes = applyStewardPlan({
      cwd: process.cwd(),
      stewardId: 'test-steward',
      mergePlan,
      proposals: [proposal],
      scopeFiles: [tempFilePath]
    });

    assert.equal(applyRes.ok, true, 'Apply should succeed');
    const newContent = readFileSync(tempFilePath, 'utf8');
    assert.equal(newContent.includes('modified content'), true, 'Content should be modified');
    assert.equal(newContent.includes('line2'), true, 'Unchanged line should be preserved');

    console.log('  ✅ Test Case 1: Safe merge plan apply - PASSED');
  } finally {
    cleanupTempFile();
  }

  // Test Case 2: Blocked/Unsafe merge plan should be rejected by planStewardApply
  try {
    setupTempFile('some content');
    const originalHash = hashText('some content');

    const proposal = makeProposal({
      proposalId: 'prop-2',
      targetFile: tempFilePath,
      fileBeforeHash: originalHash,
      patch: '@@ -1,1 +1,1 @@\n-some content\n+unsafe content'
    });

    const mergePlan = makeMergePlan({
      mergePlanId: 'mp-2',
      inputProposals: ['prop-2'],
      verdict: 'blocked-cid-conflict',
      conflicts: [{ kind: 'cid', detail: 'conflict detail' }]
    });

    const planRes = planStewardApply({
      cwd: process.cwd(),
      stewardId: 'test-steward',
      mergePlan,
      proposals: [proposal],
      scopeFiles: [tempFilePath]
    });

    assert.equal(planRes.ok, false, 'Plan should be blocked for blocked-cid-conflict');
    assert.equal(planRes.plan.issues.some((issue) => issue.code === 'blocked-merge-plan'), true, 'Blocked merge plan issue expected');

    const applyRes = applyStewardPlan({
      cwd: process.cwd(),
      stewardId: 'test-steward',
      mergePlan,
      proposals: [proposal],
      scopeFiles: [tempFilePath]
    });

    assert.equal(applyRes.ok, false, 'Apply should be blocked');

    console.log('  ✅ Test Case 2: Unsafe merge plan rejection - PASSED');
  } finally {
    cleanupTempFile();
  }

  // Test Case 3: Out of scope lock proposal should be blocked
  try {
    setupTempFile('some content');
    const originalHash = hashText('some content');

    const proposal = makeProposal({
      proposalId: 'prop-3',
      targetFile: tempFilePath,
      fileBeforeHash: originalHash,
      patch: '@@ -1,1 +1,1 @@\n-some content\n+out of scope content'
    });

    const mergePlan = makeMergePlan({
      mergePlanId: 'mp-3',
      inputProposals: ['prop-3'],
      verdict: 'needs-steward'
    });

    // scopeFiles explicitly does NOT include tempFilePath
    const planRes = planStewardApply({
      cwd: process.cwd(),
      stewardId: 'test-steward',
      mergePlan,
      proposals: [proposal],
      scopeFiles: ['some-other-file.txt']
    });

    assert.equal(planRes.ok, false, 'Plan should be blocked due to scope mismatch');
    assert.equal(planRes.plan.issues.some((issue) => issue.code === 'scope-lock-mismatch'), true, 'Scope lock mismatch issue expected');

    console.log('  ✅ Test Case 3: Scope lock mismatch protection - PASSED');
  } finally {
    cleanupTempFile();
  }

  // ---------------------------------------------------------------------------
  // Test Case 4: human-required verdict is fail-closed at planStewardApply
  // ---------------------------------------------------------------------------
  try {
    setupTempFile('human content');
    const originalHash = hashText('human content');

    const proposal = makeProposal({
      proposalId: 'prop-4',
      targetFile: tempFilePath,
      fileBeforeHash: originalHash,
      patch: '@@ -1,1 +1,1 @@\n-human content\n+auto content'
    });

    const mergePlan = makeMergePlan({
      mergePlanId: 'mp-4',
      inputProposals: ['prop-4'],
      verdict: 'human-required'
    });

    const planRes = planStewardApply({
      cwd: process.cwd(),
      stewardId: 'test-steward',
      mergePlan,
      proposals: [proposal],
      scopeFiles: [tempFilePath]
    });

    assert.equal(planRes.ok, false, 'Plan should be blocked for human-required');
    assert.equal(planRes.plan.issues.some((issue) => issue.code === 'human-review-required'), true, 'human-review-required issue expected');

    console.log('  ✅ Test Case 4: human-required verdict fail-closed - PASSED');
  } finally {
    cleanupTempFile();
  }

  // ---------------------------------------------------------------------------
  // Test Case 5: checkStewardPermission - valid neutral steward
  // ---------------------------------------------------------------------------
  {
    const identity: StewardIdentity = { stewardId: 'neutral-write-steward', kind: 'neutral' };
    const result = checkStewardPermission(identity);
    assert.equal(result.ok, true, 'Neutral steward should be valid');
    assert.equal(result.issues.length, 0);
    console.log('  ✅ Test Case 5: Valid neutral steward identity - PASSED');
  }

  // ---------------------------------------------------------------------------
  // Test Case 6: checkStewardPermission - empty stewardId
  // ---------------------------------------------------------------------------
  {
    const identity: StewardIdentity = { stewardId: '', kind: 'neutral' };
    const result = checkStewardPermission(identity);
    assert.equal(result.ok, false, 'Empty stewardId should be invalid');
    assert.equal(result.issues.some((i) => i.code === 'invalid-steward-identity'), true);
    console.log('  ✅ Test Case 6: Empty stewardId blocked - PASSED');
  }

  // ---------------------------------------------------------------------------
  // Test Case 7: checkStewardPermission - derived-artifact-writer without auth
  // ---------------------------------------------------------------------------
  {
    const identity: StewardIdentity = { stewardId: 'runner-broker', kind: 'derived-artifact-writer' };
    const result = checkStewardPermission(identity);
    assert.equal(result.ok, false, 'Derived-artifact writer without route/task should be invalid');
    assert.equal(result.issues.some((i) => i.detail.includes('authorisedByRouteId')), true);
    console.log('  ✅ Test Case 7: Derived-artifact writer requires auth - PASSED');
  }

  // ---------------------------------------------------------------------------
  // Test Case 8: checkStewardPermission - derived-artifact-writer with taskId
  // ---------------------------------------------------------------------------
  {
    const identity: StewardIdentity = {
      stewardId: 'runner-broker',
      kind: 'derived-artifact-writer',
      authorisedByTaskId: 'TASK-MAO-0009'
    };
    const result = checkStewardPermission(identity);
    assert.equal(result.ok, true, 'Derived-artifact writer with taskId should be valid');
    console.log('  ✅ Test Case 8: Derived-artifact writer with taskId - PASSED');
  }

  // ---------------------------------------------------------------------------
  // Test Case 9: arbitrateStewardRequest - successful apply with route/task links
  // ---------------------------------------------------------------------------
  try {
    const originalContent = 'line A\nline B\n';
    setupTempFile(originalContent);
    const originalHash = hashText(originalContent);

    const proposal = makeProposal({
      proposalId: 'prop-9',
      targetFile: tempFilePath,
      fileBeforeHash: originalHash,
      patch: '@@ -1,2 +1,2 @@\n-line A\n+line A modified\n line B'
    });

    const mergePlan = makeMergePlan({
      mergePlanId: 'mp-9',
      inputProposals: ['prop-9'],
      verdict: 'needs-steward'
    });

    const result = arbitrateStewardRequest({
      cwd: process.cwd(),
      identity: {
        stewardId: 'neutral-write-steward',
        kind: 'neutral',
        authorisedByRouteId: 'route-TASK-MAO-0009-agent-007'
      },
      mergePlan,
      proposals: [proposal],
      scopeFiles: [tempFilePath],
      owningTaskId: 'TASK-MAO-0009'
    });

    assert.equal(result.schemaId, 'atm.stewardArbitrationResult.v1');
    assert.equal(result.verdict, 'apply', 'Should produce apply verdict');
    assert.equal(result.owningRouteId, 'route-TASK-MAO-0009-agent-007', 'owningRouteId should be recorded');
    assert.equal(result.owningTaskId, 'TASK-MAO-0009', 'owningTaskId should be recorded');
    assert.ok(result.plan, 'plan should be present');
    assert.ok(result.applyEvidence, 'applyEvidence should be present');
    assert.equal(result.issues.length, 0);

    console.log('  ✅ Test Case 9: arbitrateStewardRequest apply with links - PASSED');
  } finally {
    cleanupTempFile();
  }

  // ---------------------------------------------------------------------------
  // Test Case 10: arbitrateStewardRequest - human-required verdict
  // ---------------------------------------------------------------------------
  try {
    setupTempFile('hr content');
    const proposal = makeProposal({
      proposalId: 'prop-10',
      targetFile: tempFilePath,
      fileBeforeHash: hashText('hr content'),
      patch: '@@ -1,1 +1,1 @@\n-hr content\n+auto content'
    });

    const mergePlan = makeMergePlan({
      mergePlanId: 'mp-10',
      inputProposals: ['prop-10'],
      verdict: 'human-required'
    });

    const result = arbitrateStewardRequest({
      cwd: process.cwd(),
      identity: { stewardId: 'neutral-write-steward', kind: 'neutral' },
      mergePlan,
      proposals: [proposal],
      scopeFiles: [tempFilePath]
    });

    assert.equal(result.verdict, 'human-required', 'Should produce human-required verdict');
    assert.equal(result.plan, null, 'No plan for human-required');
    assert.equal(result.applyEvidence, null, 'No applyEvidence for human-required');
    assert.equal(result.issues.some((i) => i.code === 'human-review-required'), true);

    console.log('  ✅ Test Case 10: arbitrateStewardRequest human-required - PASSED');
  } finally {
    cleanupTempFile();
  }

  // ---------------------------------------------------------------------------
  // Test Case 11: arbitrateStewardRequest - blocked by identity
  // ---------------------------------------------------------------------------
  {
    const result = arbitrateStewardRequest({
      cwd: process.cwd(),
      identity: { stewardId: '', kind: 'neutral' },
      mergePlan: makeMergePlan({ mergePlanId: 'mp-11', inputProposals: [] }),
      proposals: [],
      scopeFiles: []
    });

    assert.equal(result.verdict, 'blocked', 'Should be blocked due to identity');
    assert.equal(result.issues.some((i) => i.code === 'invalid-steward-identity'), true);

    console.log('  ✅ Test Case 11: arbitrateStewardRequest blocked by identity - PASSED');
  }

  // ---------------------------------------------------------------------------
  // Test Case 12: arbitrateStewardRequest - merge-required (non-blocking issue)
  // ---------------------------------------------------------------------------
  try {
    setupTempFile('merge content');
    const originalHash = hashText('merge content');

    const proposal = makeProposal({
      proposalId: 'prop-12',
      targetFile: tempFilePath,
      fileBeforeHash: originalHash,
      patch: '@@ -1,1 +1,1 @@\n-merge content\n+merged content'
    });

    // Plan references an extra proposal that doesn't exist → missing-proposal → merge-required
    const mergePlan = makeMergePlan({
      mergePlanId: 'mp-12',
      inputProposals: ['prop-12', 'prop-12-missing'],
      verdict: 'needs-steward'
    });

    const result = arbitrateStewardRequest({
      cwd: process.cwd(),
      identity: { stewardId: 'neutral-write-steward', kind: 'neutral' },
      mergePlan,
      proposals: [proposal],
      scopeFiles: [tempFilePath]
    });

    assert.equal(result.verdict, 'merge-required', 'Should produce merge-required when plan has non-blocking issues');
    assert.ok(result.plan, 'Plan should be present');
    assert.equal(result.applyEvidence, null, 'No apply evidence when merge-required');

    console.log('  ✅ Test Case 12: arbitrateStewardRequest merge-required - PASSED');
  } finally {
    cleanupTempFile();
  }

  // ---------------------------------------------------------------------------
  // Test Case 13: blocked-shared-surface produces blocked verdict
  // ---------------------------------------------------------------------------
  try {
    setupTempFile('surface content');
    const originalHash = hashText('surface content');

    const proposal = makeProposal({
      proposalId: 'prop-13',
      targetFile: tempFilePath,
      fileBeforeHash: originalHash,
      patch: '@@ -1,1 +1,1 @@\n-surface content\n+changed'
    });

    const mergePlan = makeMergePlan({
      mergePlanId: 'mp-13',
      inputProposals: ['prop-13'],
      verdict: 'blocked-shared-surface',
      conflicts: [{ kind: 'artifact', detail: 'shared surface conflict' }]
    });

    const result = arbitrateStewardRequest({
      cwd: process.cwd(),
      identity: { stewardId: 'neutral-write-steward', kind: 'neutral' },
      mergePlan,
      proposals: [proposal],
      scopeFiles: [tempFilePath]
    });

    assert.equal(result.verdict, 'blocked', 'Should produce blocked for blocked-shared-surface');
    assert.ok(result.plan);
    assert.equal(result.plan.issues.some((i) => i.code === 'blocked-merge-plan'), true);

    console.log('  ✅ Test Case 13: blocked-shared-surface produces blocked verdict - PASSED');
  } finally {
    cleanupTempFile();
  }

  console.log('All steward arbitration tests completed successfully.');
}

runTests();
