// ATM-GOV-0355 regression test.
//
// caseId: test_atm_gov_0355_unified_patch_application_is_real
// semanticKey: a_unified_diff_replaces_lines_in_place_instead_of_appending_additions
// coversAcceptance: ACC-1, ACC-2
// coversImpactEdges: stub-patch-apply-to-false-steward-evidence
// contractEdge: atm.unifiedPatchApplication.v1
//
// caseId: test_atm_gov_0355_patch_application_fails_closed
// semanticKey: a_patch_that_does_not_match_its_context_is_refused_not_silently_absorbed
// coversAcceptance: ACC-3, ACC-4
// coversImpactEdges: false-steward-evidence-to-shared-write-authority-loss
// contractEdge: atm.unifiedPatchApplication.v1
//
// caseId: test_atm_gov_0355_boundary_bytes_preserved
// semanticKey: line_endings_and_trailing_newline_state_survive_a_steward_apply
// coversAcceptance: ACC-4
// coversImpactEdges: stub-patch-apply-to-false-steward-evidence
// contractEdge: atm.unifiedPatchApplication.v1
//
// caseId: test_atm_gov_0355_shipped_broker_validators_green
// semanticKey: the_two_broker_write_validators_pass_with_unchanged_fixtures
// coversAcceptance: ACC-5
// coversImpactEdges: false-steward-evidence-to-shared-write-authority-loss
// contractEdge: atm.unifiedPatchApplication.v1
//
// Runnable directly via:
//   node --strip-types tests/cli/unified-patch-application.test.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UNIFIED_PATCH_APPLICATION_SCHEMA_ID,
  UnifiedPatchApplicationError,
  applyUnifiedPatch
} from '../../packages/core/src/broker/unified-patch.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

assert.equal(UNIFIED_PATCH_APPLICATION_SCHEMA_ID, 'atm.unifiedPatchApplication.v1');

// --- ACC-1: replacement happens in place. The behaviour being regressed
// against appended every added line to the end and left the original standing,
// which is why the shipped disjoint-same-file fixture produced duplicate
// declarations while reporting success.

{
  const before = "export const alpha = 'alpha';\nexport const beta = 'beta';\nexport const gamma = 'gamma';\n";
  const patch = "--- a/src/target.ts\n+++ b/src/target.ts\n@@ -1,1 +1,1 @@\n-export const alpha = 'alpha';\n+export const alpha = 'alpha-updated';\n";
  const after = applyUnifiedPatch(before, patch);
  assert.equal(after, "export const alpha = 'alpha-updated';\nexport const beta = 'beta';\nexport const gamma = 'gamma';\n");
  assert.equal(after.includes("export const alpha = 'alpha';"), false, 'the replaced line must not survive');
  assert.equal(after.split('\n').filter(Boolean).length, 3, 'replacement must not grow the file');
}

// --- ACC-2: several hunks, and several patches composed onto one file, land at
// their own positions with earlier edits already accounted for.

{
  const before = 'one\ntwo\nthree\nfour\nfive\n';
  const twoHunks = '@@ -1,1 +1,1 @@\n-one\n+ONE\n@@ -5,1 +5,1 @@\n-five\n+FIVE\n';
  assert.equal(applyUnifiedPatch(before, twoHunks), 'ONE\ntwo\nthree\nfour\nFIVE\n');

  // Sequential composition, the shape buildPatchProposalComposition uses.
  const first = applyUnifiedPatch(before, '@@ -2,1 +2,1 @@\n-two\n+TWO\n');
  const second = applyUnifiedPatch(first, '@@ -4,1 +4,1 @@\n-four\n+FOUR\n');
  assert.equal(second, 'one\nTWO\nthree\nFOUR\nfive\n');

  // Insertion and deletion, not just one-for-one replacement.
  assert.equal(applyUnifiedPatch(before, '@@ -2,1 +2,2 @@\n two\n+inserted\n'), 'one\ntwo\ninserted\nthree\nfour\nfive\n');
  assert.equal(applyUnifiedPatch(before, '@@ -3,1 +3,0 @@\n-three\n'), 'one\ntwo\nfour\nfive\n');
}

// --- ACC-3: a patch that does not match is refused, loudly. Silence here is
// what turned a failed write into an applied receipt.

{
  const before = 'one\ntwo\nthree\n';
  assert.throws(
    () => applyUnifiedPatch(before, '@@ -2,1 +2,1 @@\n-TWO\n+2\n'),
    (error: unknown) => error instanceof UnifiedPatchApplicationError
      && /context mismatch at line 2/.test((error as Error).message)
  );
  assert.throws(
    () => applyUnifiedPatch(before, '@@ -9,1 +9,1 @@\n-nine\n+9\n'),
    /starts past the end of a 3-line file/
  );
  assert.throws(
    () => applyUnifiedPatch(before, '@@ -2,1 +2,1 @@\n-two\n+2\n@@ -1,1 +1,1 @@\n-one\n+1\n'),
    /overlaps an earlier hunk/
  );
  // A patch with no hunks is a no-op, never an append.
  assert.equal(applyUnifiedPatch(before, '--- a/x\n+++ b/x\n'), before);
}

// --- ACC-4: boundary bytes. The composer feeds this output straight into
// canonical writes, so normalising here would surface as an unrelated
// whole-file diff in someone else's commit.

{
  assert.equal(applyUnifiedPatch('one\ntwo', '@@ -1,1 +1,1 @@\n-one\n+ONE\n'), 'ONE\ntwo', 'a file without a trailing newline must not gain one');
  assert.equal(applyUnifiedPatch('one\r\ntwo\r\n', '@@ -1,1 +1,1 @@\n-one\n+ONE\n'), 'ONE\r\ntwo\r\n', 'CRLF files must keep CRLF');
  assert.equal(applyUnifiedPatch('one\n\nthree\n', '@@ -3,1 +3,1 @@\n-three\n+THREE\n'), 'one\n\nTHREE\n', 'blank source lines must not shift the cursor');
}

// --- ACC-5: the shipped broker write validators pass with unchanged fixtures.

{
  for (const validator of ['validate-brokered-write.ts', 'validate-broker-steward.ts']) {
    execFileSync(process.execPath, ['--strip-types', path.join(repoRoot, 'scripts', validator), '--mode', 'validate'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }
}

console.log('[unified-patch-application] ok');
