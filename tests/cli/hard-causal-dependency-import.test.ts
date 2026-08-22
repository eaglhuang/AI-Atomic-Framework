import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  HARD_CAUSAL_DEPENDENCY_SEMANTICS,
  TASK_DEPENDENCY_HARD_PROOF_CONTRADICTORY_CODE,
  TASK_DEPENDENCY_HARD_PROOF_INCOMPLETE_CODE,
  TASK_DEPENDENCY_RELATION_UNKNOWN_CODE,
  TASK_DEPENDENCY_UNTYPED_IN_TYPED_CARD_CODE,
  classifyTaskDependencyEdges,
  validateHardCausalDependencyImport
} from '../../packages/cli/src/commands/tasks/dependency-gate.ts';
import { applySingleCardContractValidation } from '../../packages/cli/src/commands/tasks/import-card-contract-validation.ts';

/**
 * ATM-GOV-0406 — Plan 4.1 hard-causal dependency contract, import boundary.
 *
 * A declared dependency freezes another lane, so the declaration itself has to
 * carry proof. This file pins the import half of the contract: a card that opts
 * into typed semantics must state all six hard-causal facts for every blocking
 * edge, and a card that states a fact it then denies must be refused rather
 * than admitted with a reduced meaning.
 */

function fail(message: string): never {
  console.error(`[hard-causal-dependency-import.test] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-hard-causal-import-'));

function writeProducerOutput(relativePath: string) {
  const absolute = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, '{"sealed":true}\n', 'utf8');
}

function completeProof(overrides: Record<string, unknown> = {}) {
  return {
    producerOutput: 'docs/reports/producer-output.json',
    consumerOperation: 'atm.tasks.claim',
    outputValueChangesConsumerResult: true,
    substitutesAvailable: {
      stableInterface: false,
      fixture: false,
      proposalFirst: false,
      lateBinding: false,
      deferredCompose: false
    },
    resultUndefinedWithoutOutput: true,
    negativeControl: {
      command: 'node --strip-types tests/cli/hard-causal-dependency-import.test.ts',
      blocksBeforeProducerOutput: true,
      admitsAfterProducerOutput: true
    },
    ...overrides
  };
}

function typedCard(dependencies: readonly unknown[]) {
  return {
    workItemId: 'ATM-GOV-9406',
    dependencySemantics: HARD_CAUSAL_DEPENDENCY_SEMANTICS,
    dependencies: [...dependencies]
  };
}

// caseId: test_gov_hard_causal_contract_0406
// A complete six-fact declaration is admitted, and every one of the six facts
// is reported as proven by name. The contract has to be able to say which
// facts it checked, or "proven" is just a word in a summary.
{
  const validation = validateHardCausalDependencyImport({
    taskId: 'ATM-GOV-9406',
    taskDocument: typedCard([{ taskId: 'ATM-GOV-9400', relation: 'hard-causal', hardCausalProof: completeProof() }])
  });
  assert(validation.ok, `a complete six-fact declaration must import: ${JSON.stringify(validation.diagnostics)}`);
  const edge = validation.edges[0];
  assert(edge?.relation === 'hard-causal', 'the edge must keep its declared relation');
  assert(edge?.provenFacts.length === 6, `all six facts must be reported proven, got ${edge?.provenFacts.length}`);
  assert(edge?.missingFacts.length === 0, 'a complete declaration must report no missing facts');
  assert(edge?.contradictions.length === 0, 'a complete declaration must report no contradictions');
}

// caseId: test_gov_hard_causal_contract_0406
// Each fact is load-bearing on its own: dropping any single one must refuse the
// import and name the fact that is missing, so the recovery is actionable
// without reading the source.
{
  const droppedKeys = [
    'producerOutput',
    'consumerOperation',
    'outputValueChangesConsumerResult',
    'substitutesAvailable',
    'resultUndefinedWithoutOutput',
    'negativeControl'
  ] as const;
  for (const dropped of droppedKeys) {
    const proof = completeProof();
    delete (proof as Record<string, unknown>)[dropped];
    const validation = validateHardCausalDependencyImport({
      taskId: 'ATM-GOV-9406',
      taskDocument: typedCard([{ taskId: 'ATM-GOV-9400', relation: 'hard-causal', hardCausalProof: proof }])
    });
    assert(!validation.ok, `dropping ${dropped} must refuse the import`);
    assert(
      validation.edges[0]?.missingFacts.length === 1,
      `dropping ${dropped} must name exactly one missing fact, got ${JSON.stringify(validation.edges[0]?.missingFacts)}`
    );
    assert(
      typeof validation.diagnostics[0]?.requiredCommand === 'string' && validation.diagnostics[0].requiredCommand.length > 0,
      `dropping ${dropped} must return an executable recovery command`
    );
  }
}

// caseId: test_gov_hard_causal_contract_0406
// A stated-then-denied fact is a contradiction, not an omission. The two are
// reported apart because they need different repairs: one card forgot to prove
// something, the other proved that the edge is not hard-causal at all.
{
  const contradictions: readonly Record<string, unknown>[] = [
    { outputValueChangesConsumerResult: false },
    { resultUndefinedWithoutOutput: false },
    { substitutesAvailable: { stableInterface: true, fixture: false, proposalFirst: false, lateBinding: false, deferredCompose: false } },
    { negativeControl: { command: 'node --strip-types tests/cli/hard-causal-dependency-import.test.ts', blocksBeforeProducerOutput: false, admitsAfterProducerOutput: true } },
    { negativeControl: { command: '', blocksBeforeProducerOutput: true, admitsAfterProducerOutput: true } }
  ];
  for (const override of contradictions) {
    const validation = validateHardCausalDependencyImport({
      taskId: 'ATM-GOV-9406',
      taskDocument: typedCard([{ taskId: 'ATM-GOV-9400', relation: 'hard-causal', hardCausalProof: completeProof(override) }])
    });
    assert(!validation.ok, `a contradicted fact must refuse the import: ${JSON.stringify(override)}`);
    assert(
      (validation.edges[0]?.contradictions.length ?? 0) > 0,
      `a contradicted fact must be reported as a contradiction, not a missing fact: ${JSON.stringify(override)}`
    );
    assert(
      validation.edges[0]?.missingFacts.length === 0,
      `a stated-then-denied fact must not also be reported missing: ${JSON.stringify(override)}`
    );
  }
}

// caseId: test_gov_nonhard_claim_admission_0406
// A non-hard relation carries no proof obligation and never becomes blocking.
// This is the half of the contract that keeps a census honest: relations stay
// declarable without being promoted to a freeze.
{
  const nonHardRelations = ['validation', 'publication', 'observation', 'soft-order', 'file-overlap', 'atom-overlap'] as const;
  for (const relation of nonHardRelations) {
    const validation = validateHardCausalDependencyImport({
      taskId: 'ATM-GOV-9406',
      taskDocument: typedCard([{ taskId: 'ATM-GOV-9400', relation }])
    });
    assert(validation.ok, `${relation} must import without a hard-causal proof`);
    assert(validation.edges[0]?.blockingCandidate === false, `${relation} must never be a blocking candidate`);
  }
}

// caseId: test_gov_nonhard_claim_admission_0406
// A non-hard relation that nevertheless carries hard-causal proof is a
// contradiction: the declaration says two different things about the same edge
// and import must not pick one silently.
{
  const validation = validateHardCausalDependencyImport({
    taskId: 'ATM-GOV-9406',
    taskDocument: typedCard([{ taskId: 'ATM-GOV-9400', relation: 'observation', hardCausalProof: completeProof() }])
  });
  assert(!validation.ok, 'a non-hard relation carrying hard-causal proof must be refused');
  assert((validation.edges[0]?.contradictions.length ?? 0) > 0, 'the relation/proof disagreement must be reported as a contradiction');
}

// caseId: test_gov_legacy_boundary_0406
// A card that has not opted in keeps legacy semantics untouched, and a card
// that has opted in cannot fall back to a bare task id. Silence must not be
// readable as either answer.
{
  const legacy = validateHardCausalDependencyImport({
    taskId: 'ATM-GOV-9406',
    taskDocument: { workItemId: 'ATM-GOV-9406', dependencies: ['ATM-GOV-9400'] }
  });
  assert(legacy.ok, 'an unaudited legacy card must import unchanged');
  assert(legacy.semantics === 'legacy', 'an unaudited card must be reported as legacy semantics');
  assert(legacy.edges[0]?.relation === 'legacy-untyped', 'a legacy edge must be reported as untyped rather than assumed hard-causal');

  const optedInFallback = validateHardCausalDependencyImport({
    taskId: 'ATM-GOV-9406',
    taskDocument: typedCard(['ATM-GOV-9400'])
  });
  assert(!optedInFallback.ok, 'an opted-in card must not silently accept an untyped dependency');
  assert(optedInFallback.semantics === HARD_CAUSAL_DEPENDENCY_SEMANTICS, 'an opted-in card must report typed semantics even when it fails');
}

// caseId: test_gov_legacy_boundary_0406
// Classification is field-driven. The same declaration classifies identically
// whatever the task id, the actor, the date, or the paths involved are.
{
  const proof = completeProof();
  const first = classifyTaskDependencyEdges({
    workItemId: 'ATM-GOV-0001',
    dependencySemantics: HARD_CAUSAL_DEPENDENCY_SEMANTICS,
    dependencies: [{ taskId: 'TASK-OTHER-0002', relation: 'hard-causal', hardCausalProof: proof }]
  });
  const second = classifyTaskDependencyEdges({
    workItemId: 'TASK-SKL-9999',
    dependencySemantics: HARD_CAUSAL_DEPENDENCY_SEMANTICS,
    dependencies: [{ taskId: 'ATM-BUG-2026-08-22-001', relation: 'hard-causal', hardCausalProof: proof }]
  });
  assert(
    JSON.stringify(first.edges.map((edge) => ({ ...edge, taskId: null })))
    === JSON.stringify(second.edges.map((edge) => ({ ...edge, taskId: null }))),
    'classification must not vary with task id, family, or date'
  );
}

// caseId: test_gov_hard_causal_contract_0406
// The negative control, executed. Before the producer output exists the edge
// blocks; once the sealed output is on disk the same declaration admits. This
// is what separates a proven hard dependency from an asserted one.
{
  const proof = completeProof({ producerOutput: 'docs/reports/atm-gov-9400-sealed-output.json' });
  const document = typedCard([{ taskId: 'ATM-GOV-9400', relation: 'hard-causal', hardCausalProof: proof }]);
  const before = classifyTaskDependencyEdges(document, { cwd: repo });
  assert(before.edges[0]?.producerOutputSatisfied === false, 'the producer output must be unsatisfied before it exists');
  assert(before.edges[0]?.blockingCandidate === true, 'a proven hard-causal edge must block before its producer output exists');

  writeProducerOutput('docs/reports/atm-gov-9400-sealed-output.json');
  const after = classifyTaskDependencyEdges(document, { cwd: repo });
  assert(after.edges[0]?.producerOutputSatisfied === true, 'the producer output must be satisfied once the sealed output exists');
  assert(after.edges[0]?.blockingCandidate === false, 'the same declaration must admit once the sealed producer output exists');
}

// caseId: test_gov_hard_causal_contract_0406
// ACC-2 — the contract is wired into the product import path, not only callable
// from a test. A card whose hard-causal edge is missing a fact must reach the
// import diagnostics as an error, which is what makes tasks import fail closed
// before any ledger file is written.
{
  const proof = completeProof();
  delete (proof as Record<string, unknown>).negativeControl;
  const parsed = {
    tasks: [{
      workItemId: 'ATM-GOV-9406',
      dependencySemantics: HARD_CAUSAL_DEPENDENCY_SEMANTICS,
      dependencies: [{ taskId: 'ATM-GOV-9400', relation: 'hard-causal', hardCausalProof: proof }]
    }],
    diagnostics: [] as Record<string, unknown>[]
  };
  const result = applySingleCardContractValidation({
    cwd: repo,
    parsed: parsed as never,
    causalFrontmatter: null,
    planText: '',
    planPath: 'docs/plans/atm-gov-9406.md'
  });
  const dependencyErrors = result.parsed.diagnostics.filter(
    (entry) => String(entry.code ?? '').startsWith('ATM_TASK_DEPENDENCY_')
  );
  assert(
    dependencyErrors.length === 1,
    `the import path must surface the incomplete proof as one dependency diagnostic, got ${JSON.stringify(result.parsed.diagnostics)}`
  );
  assert(
    dependencyErrors[0]?.code === 'ATM_TASK_DEPENDENCY_HARD_PROOF_INCOMPLETE',
    'the import diagnostic must carry the canonical incomplete-proof code'
  );
  assert(
    dependencyErrors[0]?.level === 'error',
    'an unproven hard-causal edge must fail import closed, not warn'
  );
  assert(
    String(dependencyErrors[0]?.text ?? '').includes('Recovery:'),
    'the import diagnostic must carry an executable recovery command'
  );
}

// caseId: test_gov_nonhard_claim_admission_0406
// The same wiring must stay silent for a card that declares nothing typed and
// for a non-hard relation, so adding the contract to the import path does not
// change what already-valid cards mean.
{
  for (const document of [
    { workItemId: 'ATM-GOV-9406', dependencies: ['ATM-GOV-9400'] },
    {
      workItemId: 'ATM-GOV-9406',
      dependencySemantics: HARD_CAUSAL_DEPENDENCY_SEMANTICS,
      dependencies: [{ taskId: 'ATM-GOV-9400', relation: 'soft-order' }]
    }
  ]) {
    const result = applySingleCardContractValidation({
      cwd: repo,
      parsed: { tasks: [document], diagnostics: [] } as never,
      causalFrontmatter: null,
      planText: '',
      planPath: 'docs/plans/atm-gov-9406.md'
    });
    const dependencyErrors = result.parsed.diagnostics.filter(
      (entry) => String(entry.code ?? '').startsWith('ATM_TASK_DEPENDENCY_')
    );
    assert(
      dependencyErrors.length === 0,
      `${JSON.stringify(document.dependencies)} must import without a dependency diagnostic, got ${JSON.stringify(dependencyErrors)}`
    );
  }
}

// caseId: test_gov_hard_causal_contract_0406
// Every code this contract can emit is registered in the canonical error-code
// registry. A code a user can hit without a registry entry has no shared
// operator meaning and no recovery an agent can resolve.
{
  const registry = JSON.parse(readFileSync('docs/governance/error-code-registry.json', 'utf8')) as {
    entries: readonly { code: string; remediation: readonly string[]; sourceOwner: string }[];
  };
  const registered = new Map(registry.entries.map((entry) => [entry.code, entry]));
  for (const code of [
    TASK_DEPENDENCY_HARD_PROOF_INCOMPLETE_CODE,
    TASK_DEPENDENCY_HARD_PROOF_CONTRADICTORY_CODE,
    TASK_DEPENDENCY_UNTYPED_IN_TYPED_CARD_CODE,
    TASK_DEPENDENCY_RELATION_UNKNOWN_CODE
  ]) {
    const entry = registered.get(code);
    assert(entry, `${code} must have a canonical error-code registry entry`);
    assert((entry?.remediation.length ?? 0) > 0, `${code} must carry an operator remediation path`);
    assert(
      entry?.sourceOwner === 'packages/cli/src/commands/tasks/dependency-gate.ts',
      `${code} must name the module that owns it`
    );
  }
}

console.log('[hard-causal-dependency-import.test] ok');
