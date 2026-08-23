import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CENSUS_OUTPUT_RELATIVE,
  CENSUS_SCHEMA_ID,
  auditPrfDependencyCensus,
  resolvePlanningRoot,
  sealWithoutDigest,
  type Plan41Census
} from './audit-task-dependency-semantics.ts';
import {
  PROOF_OUTPUT_RELATIVE,
  PROOF_SCHEMA_ID,
  compileParallelProof,
  type ParallelProof
} from './compile-cross-editor-parallel-proof.ts';

function readDocument(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function fail(code: string, message: string): never {
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
  throw new Error(`${code}: ${message}`);
}

export function validateCensus(census: Plan41Census): string[] {
  const errors: string[] = [];
  if (census.schemaId !== CENSUS_SCHEMA_ID) errors.push('census schemaId mismatch');
  if (census.unclassifiedEdgeIds.length !== 0) errors.push('unclassified edges present');
  if (census.counts.unclassified !== 0) errors.push('unclassified count is not zero');
  if (census.counts.denominator !== census.edges.length) errors.push('denominator does not equal edge count');
  if (census.hardDependencyRate.numerator !== census.counts.hardCausal) errors.push('hard rate numerator mismatch');
  if (census.hardDependencyRate.quotaTargetRejected !== true) errors.push('quota gaming guard missing');
  if (census.digest !== sealWithoutDigest(census)) errors.push('census digest does not reproduce');
  for (const edge of census.edges) {
    if (edge.lifecycleType === 'hard-causal' && !edge.hardCausalProven) {
      errors.push(`${edge.edgeId} is hard-causal without six facts`);
    }
    if (edge.declaredAsHard && edge.hardCausalProven === false && edge.lifecycleType === 'hard-causal') {
      errors.push(`${edge.edgeId} treated unproven declaration as hard-causal`);
    }
    if (edge.planningAuthorityUnchanged !== true) errors.push(`${edge.edgeId} changed PRF planning authority`);
  }
  return errors;
}

export function validateProof(proof: ParallelProof, census: Plan41Census): string[] {
  const errors: string[] = [];
  if (proof.schemaId !== PROOF_SCHEMA_ID) errors.push('proof schemaId mismatch');
  if (proof.censusDigest !== census.digest) errors.push('proof censusDigest mismatch');
  if (!proof.timeWindow.startedAt || !proof.timeWindow.endedAt || !proof.timeWindow.watermark) {
    errors.push('proof time window incomplete');
  }
  if (proof.digest !== sealWithoutDigest(proof)) errors.push('proof digest does not reproduce');
  if (JSON.stringify(proof).includes('prop-0407-shared-dashboard-surface')) {
    errors.push('hardcoded false-green proposal id remains');
  }
  if (JSON.stringify(proof).includes('execute-now-on-0407-private-report-surface')) {
    errors.push('hardcoded false-green broker ticket remains');
  }
  const first = proof.proofWindows.find((window) => window.id === 'first-window');
  const second = proof.proofWindows.find((window) => window.id === 'second-window');
  if (!first || first.policyViolationCount !== 1 || first.foreignByteLoss !== 0 || first.cleanProofWindow !== false) {
    errors.push('first-window sealed safety counters are missing or mutated');
  }
  if (!second || second.source !== 'task-events-0406-0407-scan') {
    errors.push('second-window was not computed from task events');
  }
  if (proof.safetyEvents.policyViolationCount !== (first?.policyViolationCount ?? 0) + (second?.policyViolationCount ?? 0)) {
    errors.push('aggregated policyViolationCount does not equal window sum');
  }
  if (proof.broker.arbitration === 'broker-arbitration') {
    if (proof.acceptance.acc4.status !== 'met') errors.push('broker-arbitration requires ACC-4 met');
    if (!proof.broker.source.available) errors.push('broker-arbitration requires a validated source');
    if (proof.broker.source.schemaId !== 'atm.teamRun.v1') errors.push('arbitration schemaId mismatch');
    if (proof.broker.source.taskId !== 'ATM-GOV-0407') errors.push('arbitration taskId mismatch');
    if (proof.broker.source.verdict !== 'parallel-safe') errors.push('arbitration verdict mismatch');
    if (proof.broker.source.lane !== 'direct-brokered') errors.push('arbitration lane mismatch');
    if (!proof.broker.source.digest) errors.push('arbitration digest missing');
  } else if (proof.acceptance.acc4.status === 'met') {
    errors.push('ACC-4 cannot be met without validated Broker arbitration');
  }
  if (proof.hardCausalControls.beforeProducerOutput.claim !== 'blocked') {
    errors.push('hard-causal negative control did not block before producer output');
  }
  if (proof.hardCausalControls.afterProducerOutput.claim !== 'allowed') {
    errors.push('hard-causal negative control did not admit after producer output');
  }
  if (proof.hardCausalControls.nonHardClaimBeforeCompose !== 'allowed') {
    errors.push('non-hard control must start before compose/validation');
  }
  if (proof.lifecycle.frozenPublication.status !== 'not-started') {
    errors.push('frozen publication must remain not-started for this card');
  }
  if (proof.lifecycle.formalCloseout.status !== 'not-started') {
    errors.push('formal closeout must remain not-started for this card');
  }
  return errors;
}

export function validatePlan41Artifacts(targetRoot: string): { ok: true; census: Plan41Census; proof: ParallelProof } {
  const censusPath = resolve(targetRoot, CENSUS_OUTPUT_RELATIVE);
  const proofPath = resolve(targetRoot, PROOF_OUTPUT_RELATIVE);
  if (!existsSync(censusPath) || !existsSync(proofPath)) {
    fail('ATM_PARALLEL_PROOF_INPUT_INVALID', 'Census or proof report is missing. Run the compile script first.');
  }
  const census = readDocument(censusPath) as unknown as Plan41Census;
  const proof = readDocument(proofPath) as unknown as ParallelProof;
  const errors = [...validateCensus(census), ...validateProof(proof, census)];
  if (errors.length > 0) {
    fail('ATM_PARALLEL_PROOF_THRESHOLD_UNMET', errors.join('; '));
  }
  return { ok: true, census, proof };
}

const invoked = process.argv[1] && /validate-cross-editor-parallel-proof\.ts$/.test(process.argv[1].replace(/\\/g, '/'));
if (invoked) {
  const targetRoot = resolve(process.cwd());
  if (process.argv.includes('--rebuild')) {
    const planningRoot = resolvePlanningRoot();
    const census = auditPrfDependencyCensus({ planningRoot, targetRoot });
    const proof = compileParallelProof({ targetRoot, planningRoot, census });
    void proof;
  }
  const result = validatePlan41Artifacts(targetRoot);
  assert.equal(result.ok, true);
  process.stdout.write(`${JSON.stringify({ ok: true, censusDigest: result.census.digest, proofDigest: result.proof.digest }, null, 2)}\n`);
}
