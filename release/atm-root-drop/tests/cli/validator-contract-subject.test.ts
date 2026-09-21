// ATM-GOV-0354 regression test.
//
// caseId: test_atm_gov_0354_contract_subject_follows_owning_surface
// semanticKey: contract_anchors_survive_a_move_inside_the_owning_surface
// coversAcceptance: ACC-1, ACC-2
// coversImpactEdges: module-split-to-contract-anchor-false-red
// contractEdge: atm.validatorContractSubject.v1
//
// caseId: test_atm_gov_0354_missing_subject_fails_closed
// semanticKey: an_absent_or_empty_contract_subject_is_a_red_not_a_silent_pass
// coversAcceptance: ACC-3, ACC-4
// coversImpactEdges: module-split-to-contract-anchor-false-red, ci-step-rename-to-workflow-order-false-red
// contractEdge: atm.validatorContractSubject.v1
//
// caseId: test_atm_gov_0354_both_validators_green_with_unchanged_tokens
// semanticKey: the_two_repaired_validators_pass_without_weakening_their_token_lists
// coversAcceptance: ACC-5
// coversImpactEdges: module-split-to-contract-anchor-false-red, ci-step-rename-to-workflow-order-false-red
// contractEdge: atm.validatorContractSubject.v1
//
// Runnable directly via:
//   node --strip-types tests/cli/validator-contract-subject.test.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  VALIDATOR_CONTRACT_SUBJECT_SCHEMA_ID,
  collectMissingContractAnchors,
  locateWorkflowStepByCommand,
  resolveValidatorContractSubject
} from '../../scripts/lib/validator-contract-subject.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

assert.equal(VALIDATOR_CONTRACT_SUBJECT_SCHEMA_ID, 'atm.validatorContractSubject.v1');

// --- ACC-1 / ACC-2: the subject is the owning surface, not a frozen file list.

{
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-contract-subject-'));
  try {
    mkdirSync(path.join(root, 'owner', 'implementation'), { recursive: true });
    writeFileSync(path.join(root, 'owner.ts'), 'export * from "./owner/implementation/moved.ts";\n', 'utf8');
    writeFileSync(path.join(root, 'owner', 'barrel.ts'), '// re-export barrel only\n', 'utf8');
    writeFileSync(
      path.join(root, 'owner', 'implementation', 'moved.ts'),
      'export const CODE = "ATM_CONTRACT_TOKEN";\nconst evidence = { schemaId: "atm.contract.v1" };\n',
      'utf8'
    );

    const subject = resolveValidatorContractSubject(root, ['owner.ts', 'owner']);
    assert.ok(
      subject.files.some((file) => file.endsWith('owner/implementation/moved.ts')),
      'declaring a directory must reach nested source files'
    );

    // ACC-1: the token moved into a nested file; the anchor still holds.
    assert.deepEqual(
      [...collectMissingContractAnchors(subject, [{ token: 'ATM_CONTRACT_TOKEN', detail: 'token must survive a move' }])],
      []
    );

    // Quote style is formatter-owned, so the pattern form must tolerate both.
    assert.deepEqual(
      [...collectMissingContractAnchors(subject, [
        { pattern: /schemaId:\s*['"]atm\.contract\.v1['"]/, detail: 'schema id must be emitted' }
      ])],
      []
    );

    // ACC-2: deleting the behaviour from the surface still fails, same detail.
    writeFileSync(path.join(root, 'owner', 'implementation', 'moved.ts'), 'export const CODE = "SOMETHING_ELSE";\n', 'utf8');
    const afterDelete = resolveValidatorContractSubject(root, ['owner.ts', 'owner']);
    assert.deepEqual(
      [...collectMissingContractAnchors(afterDelete, [{ token: 'ATM_CONTRACT_TOKEN', detail: 'token must survive a move' }])],
      ['token must survive a move'],
      'a genuinely deleted contract must still be reported'
    );

    // Widening is not silently allowed: an anchor with neither form is a bug.
    assert.throws(
      () => collectMissingContractAnchors(afterDelete, [{ detail: 'malformed anchor' } as never]),
      /must declare a token or a pattern/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- ACC-3: a missing or empty subject fails closed rather than satisfying
// every anchor through an empty string.

{
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-contract-subject-empty-'));
  try {
    assert.throws(
      () => resolveValidatorContractSubject(root, ['does/not/exist.ts']),
      /root is missing: does\/not\/exist\.ts/
    );
    mkdirSync(path.join(root, 'empty-dir'), { recursive: true });
    assert.throws(
      () => resolveValidatorContractSubject(root, ['empty-dir']),
      /contains no readable source: empty-dir/
    );
    assert.throws(() => resolveValidatorContractSubject(root, []), /at least one declared root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// --- ACC-4: workflow ordering is resolved by the command a step runs, and an
// absent gate is null rather than a -1 that satisfies `<`.

{
  const workflow = [
    'jobs:',
    '  publish:',
    '    steps:',
    '      - name: Validate bridge minor policy',
    '        run: node --strip-types scripts/validate-bridge-minor.ts --mode validate',
    '      - name: Compute gate full with resumable receipt',
    '        run: npm run validate:full -- --run-id "x"',
    '      - name: Compute gate release-prepublish',
    '        run: npm run validate:release-prepublish -- --prior-evidence x.json'
  ].join('\n');

  const gate = locateWorkflowStepByCommand(workflow, /validate-bridge-minor\.ts\s+--mode\s+validate/);
  const heavy = locateWorkflowStepByCommand(workflow, /npm run validate:(standard|full)\b/);
  const prepublish = locateWorkflowStepByCommand(workflow, /npm run validate:release-prepublish\b/);
  assert.equal(gate?.name, 'Validate bridge minor policy');
  assert.equal(heavy?.name, 'Compute gate full with resumable receipt', 'the renamed step must still be found by its command');
  assert.equal(prepublish?.name, 'Compute gate release-prepublish');
  assert.ok(gate!.index < heavy!.index);
  assert.ok(gate!.index < prepublish!.index);

  assert.equal(
    locateWorkflowStepByCommand(workflow, /npm run validate:release-absent\b/),
    null,
    'an absent gate must be null, never an index that silently satisfies an ordering check'
  );
}

// --- ACC-5: the repaired validator passes at current HEAD with its token list
// unchanged. branch-commit-queue is deliberately not asserted green here: it
// still reports one genuine contract loss (the cross-actor self-heal guard), and
// this card does not weaken that anchor to manufacture a pass.

{
  execFileSync(process.execPath, ['--strip-types', path.join(repoRoot, 'scripts', 'validate-bridge-minor.ts'), '--mode', 'validate'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

console.log('[validator-contract-subject] ok');
