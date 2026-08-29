import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createValidator } from './lib/validator-harness.ts';

const harness = createValidator('external-benchmark-protocol', { argv: process.argv.slice(2), defaultMode: 'validate' });
const manifestFlag = process.argv.indexOf('--manifest');
const manifestPath = manifestFlag >= 0 ? process.argv[manifestFlag + 1] : 'scripts/fixtures/atm-external-benchmark/manifest.json';

function failSchema(errors: unknown): never {
  return harness.fail(`manifest schema validation failed: ${JSON.stringify(errors)}`);
}

function validate(): void {
  harness.requireFile('schemas/evidence/external-benchmark-run.schema.json');
  const absoluteManifestPath = path.isAbsolute(manifestPath) ? manifestPath : harness.repoPath(manifestPath);
  const manifest = JSON.parse(readFileSync(absoluteManifestPath, 'utf8')) as Record<string, any>;
  const schemaValidator = harness.loadSchemaValidator('schemas/evidence/external-benchmark-run.schema.json');
  if (!schemaValidator(manifest)) failSchema((schemaValidator as any).errors);

  const repositories = manifest.externalRepositories as Array<Record<string, unknown>>;
  harness.assert(new Set(repositories.map((repository) => repository.repositoryUrl)).size === repositories.length, 'external repository URLs must be distinct');
  harness.assert(repositories.every((repository) => repository.nonAtmAuthored === true), 'all repositories must be declared non-ATM-authored');

  const baseline = manifest.arms.baseline;
  const atm = manifest.arms.atm;
  harness.assert(baseline.executionMode === 'real-git-worktree' && baseline.modeled === false && baseline.requiresPullRequest === true, 'baseline must use a real Git worktree and PR, never a model');
  harness.assert(atm.executionMode === 'published-npm' && atm.workspaceLink === false, 'ATM arm must install only a published npm artifact, never a workspace link');

  const roles = [manifest.oracle.hiddenCorpusOwner, manifest.oracle.adjudicator, manifest.oracle.baselineImplementer, manifest.oracle.atmImplementer];
  harness.assert(new Set(roles).size === roles.length, 'oracle, adjudicator, and both implementers must be distinct roles');
  harness.assert(manifest.oracle.visibilityBeforeSeal === 'oracle-only', 'hidden corpus must be oracle-only before seal');

  const requiredControls = ['positive-conflict', 'benign-concurrency', 'semantic-conflict', 'stale-base', 'recovery', 'negative-control'];
  harness.assert(requiredControls.every((control) => manifest.controls.includes(control)), 'all required positive, negative, conflict, stale-base and recovery controls must be sealed');
  harness.assert(manifest.counterbalancing.sequences.includes('AB') && manifest.counterbalancing.sequences.includes('BA'), 'both AB and BA counterbalancing sequences are required');
  harness.assert(manifest.counterbalancing.p95Source === 'raw-timestamps-only', 'p95 must be computed from raw timestamps only');

  const requiredMetrics = ['falseBlock', 'missedConflict', 'humanMinutes', 'tokens', 'billedCost', 'completion', 'retries', 'repairTime'];
  harness.assert(requiredMetrics.every((metric) => typeof manifest.metrics[metric] === 'string' && manifest.metrics[metric].length > 0), 'all product-proof metrics need executable definitions');

  const packageSealed = atm.packageAvailability === 'sealed' && typeof atm.packageVersion === 'string' && /^sha256:[a-f0-9]{64}$/.test(atm.packageTarballSha256 ?? '');
  const prerequisites = manifest.executionPrerequisites as Record<string, { sealed: boolean; evidenceDigest: string | null }>;
  const missingPrerequisites = Object.entries(prerequisites)
    .filter(([, prerequisite]) => !prerequisite.sealed || !/^sha256:[a-f0-9]{64}$/.test(prerequisite.evidenceDigest ?? ''))
    .map(([name]) => name);
  harness.assert(prerequisites.publicNpm.sealed === packageSealed, 'publicNpm prerequisite must exactly reflect the sealed public npm package state');
  const canExecute = packageSealed && missingPrerequisites.length === 0;
  harness.assert(manifest.runEligibility.eligible === canExecute, 'run eligibility must exactly reflect every sealed execution prerequisite');
  if (!canExecute) {
    harness.assert(manifest.runEligibility.blockingReasons.length > 0, 'a blocked preregistration must state blocking reasons');
  }
  harness.ok(`status=${manifest.status} repositories=${repositories.length} execution=${canExecute ? 'eligible' : `blocked:${missingPrerequisites.join(',')}`}`);
}

validate();
