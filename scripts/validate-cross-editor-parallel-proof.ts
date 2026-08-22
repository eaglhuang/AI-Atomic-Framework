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
  if (proof.safetyEvents.foreignOverwrite !== 0) errors.push('foreign overwrite is not zero');
  if (proof.safetyEvents.unauthorizedTakeover !== 0) errors.push('unauthorized takeover is not zero');
  if (proof.safetyEvents.bypass !== 0) errors.push('bypass is not zero');
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
  if (!proof.proposals.some((proposal) => proposal.state.includes('proposal'))) {
    errors.push('missing proposal-first surface');
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
