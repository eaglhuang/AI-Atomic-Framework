import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolveValidationObligations } from '../../packages/cli/src/commands/validation-obligations.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (relativePath: string): any => JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
const readText = (relativePath: string): string => readFileSync(path.join(root, relativePath), 'utf8');

const shard = readJson('tests/catalog/groups/test_group_plan_3x_4x_complete_closeout.shard.json');
assert.equal(shard.schemaId, 'atm.testCaseGroup.v1');
assert.ok(shard.supportedSeams.includes('atm.testCaseCatalog.v1'));
assert.ok(shard.supportedSeams.includes('atm.validatorProfileResponsibility.v1'));
const closureCase = shard.cases.find((entry: any) =>
  entry.caseId === 'test_task_atm_gov_0329_plan_3x_4x_catalog_profile_coverage_fad18eba'
);
assert.equal(closureCase?.responsibility, 'task-required');
assert.deepEqual([...closureCase.coversAcceptance].sort(), ['ACC-1', 'ACC-2', 'ACC-3', 'ACC-4', 'ACC-5']);
assert.ok(shard.legacyAliases.some((entry: any) =>
  entry.legacyCaseId === 'test_plan_3x_4x_catalog_profile_coverage_0329'
  && entry.canonicalCaseId === closureCase.caseId
));

const groupRoot = path.join(root, 'tests/catalog/groups');
const groupFiles = readFileSync(path.join(root, 'tests/cli/plan4-catalog-contract.test.ts'), 'utf8');
assert.match(groupFiles, /EXPECTED_HIDDEN_CASE_ID_TOTAL = 0/);
const requiredNegativeControls = new Set([
  'plan4_certificate_binding_stale_replay',
  'obligation_inventory_drift_detector',
  'plan4_hidden_negative_control_fail_closed',
  'plan4_exam_authority_separation'
]);
const allCases = readdirSync(groupRoot)
  .filter((name: string) => name.endsWith('.shard.json'))
  .map((name: string) => readJson(`tests/catalog/groups/${name}`))
  .flatMap((entry: any) => entry.cases ?? []);
assert.equal(new Set(allCases.map((entry: any) => entry.caseId)).size, allCases.length, 'catalog case ids must be unique');
assert.ok(allCases.length > 0 && allCases.every((entry: any) => entry.caseId && entry.semanticKey));
for (const semanticKey of requiredNegativeControls) {
  const control = allCases.find((entry: any) => entry.semanticKey === semanticKey);
  assert.equal(control?.responsibility, 'task-required', `${semanticKey} must be a required negative control`);
  assert.ok(control?.command, `${semanticKey} must be executable`);
}

const catalog = readJson('scripts/test-catalog.config.json');
assert.equal(catalog.schemaId, 'atm.testCatalog.v1');
assert.equal(catalog.caseGroupShards.root, 'tests/catalog/groups');
const profiles = readJson('scripts/validators.config.json').profiles;
assert.ok(profiles.standard.validators.includes('validate-module-boundaries'));
assert.ok(profiles.standard.validators.includes('validate-test-facade'));
assert.equal(profiles.full.extends, 'standard');

const obligation = resolveValidationObligations([
  'scripts/test-catalog.config.json',
  'scripts/validators.config.json',
  '.github/workflows/ci.yml',
  '.github/workflows/release-npm.yml'
]);
assert.ok(obligation.validators.includes('validate-test-facade'));
assert.ok(obligation.validators.includes('validate-module-boundaries'));

const ciWorkflow = readText('.github/workflows/ci.yml');
assert.match(ciWorkflow, /npm run typecheck/);
assert.match(ciWorkflow, /npm run lint/);
assert.match(ciWorkflow, /npm test/);
assert.match(ciWorkflow, /npm run validate:standard/);

const releaseWorkflow = readText('.github/workflows/release-npm.yml');
for (const expected of [
  'npm run validate:release-prepublish -- --run-id',
  'npm run validate:full -- --run-id',
  'npm run validate:root-drop-release',
  'npm run validate:onefile-release',
  'npm run validate:runner-reproducibility',
  'release/atm-onefile/atm.mjs --version',
  'release/atm-root-drop/atm.mjs --version',
  'release/sbom.json'
]) assert.ok(releaseWorkflow.includes(expected), `release workflow must include ${expected}`);
assert.match(releaseWorkflow, /Post-publish full validation/);

// Inspect executable steps: comments, echoes and optional gates cannot satisfy
// the immutable-artifact wiring contract. Dynamic release tests check contents.
type ReleaseStep = { run?: string; if?: unknown; 'continue-on-error'?: unknown };
type ReleaseWorkflow = { jobs: { publish: { steps: ReleaseStep[] } } };
const { load: loadYaml } = createRequire(import.meta.url)('js-yaml') as {
  load: (text: string) => ReleaseWorkflow;
};
const artifactScripts = [
  'build-release-artifacts', 'validate-adopter-artifact-manifest',
  'validate-npm-clean-install', 'release-candidate'
];
const shellLines = (run: string) => run.replace(/\\\r?\n\s*/g, ' ').split('\n').map(line => line.trim());
function verifyArtifactSteps(workflow: ReleaseWorkflow): void {
  const steps = workflow.jobs.publish.steps;
  assert.ok(Array.isArray(steps), 'publish steps must exist');
  let previous = -1;
  for (const [position, script] of artifactScripts.entries()) {
    const expression = new RegExp(`^node\\s+--(?:experimental-)?strip-types\\s+scripts/${script}\\.ts(?:\\s|$)`);
    const calls = steps.flatMap((step, index) => shellLines(step.run ?? '')
      .filter(line => expression.test(line)).map(line => ({ step, index, line })));
    assert.equal(calls.length, 1, `${script} must run exactly once as a direct node command`);
    const { step, index, line } = calls[0];
    assert.ok(index > previous, 'seal, budget, install and candidate must be distinct ordered steps');
    previous = index;
    assert.ok(step.if === undefined || step.if === 'success()', `${script} must not be conditionally skipped`);
    assert.ok(step['continue-on-error'] === undefined || step['continue-on-error'] === false,
      `${script} must fail the release on error`);
    assert.doesNotMatch(line, /[;&|]/, `${script} must not be an optional shell chain`);
    const option = position === 0 ? '--output' : position === 3 ? '--manifest' : '--artifact-manifest';
    const target = position === 0 ? 'release/npm-artifacts' : 'release/npm-artifacts/manifest.json';
    const commands = shellLines(step.run ?? '').filter(command => command && !command.startsWith('#'));
    if (position < 3) assert.deepEqual(commands, [line], `${script} must be one unconditional command`);
    else assert.deepEqual(commands, [
      'dry_run=()',
      'if [[ "$RELEASE_DRY_RUN" == "true" ]]; then dry_run=(--dry-run); fi',
      line
    ], 'candidate must use the supported dry-run setup followed by unconditional execution');
    assert.deepEqual(line.split(/\s+/).slice(2), [
      `scripts/${script}.ts`, option, target,
      ...(position === 3 ? ['--target-tag', '"$NPM_DIST_TAG"', '"${dry_run[@]}"'] : [])
    ], `${script} must use one exact artifact option without extra shell tokens`);
  }
  for (const step of steps) for (const line of shellLines(step.run ?? '')) {
    if (!/^npm\s/.test(line) || !/\b(?:pack|publish)\b/.test(line)) continue;
    assert.doesNotMatch(line, /(?:^|\s)(?:--workspaces?(?:=|\s|$)|-w\S*)/,
      'release must not repack or publish a workspace');
  }
}
const parsedRelease = loadYaml(releaseWorkflow);
verifyArtifactSteps(parsedRelease);
const candidateIndex = parsedRelease.jobs.publish.steps.findIndex(step => step.run?.includes('scripts/release-candidate.ts'));
const singleLine = structuredClone(parsedRelease);
singleLine.jobs.publish.steps[candidateIndex].run = shellLines(singleLine.jobs.publish.steps[candidateIndex].run ?? '').join('\n');
verifyArtifactSteps(singleLine);
function rejectMutation(name: string, mutate: (steps: ReleaseStep[]) => void): void {
  const changed = structuredClone(parsedRelease);
  mutate(changed.jobs.publish.steps);
  assert.throws(() => verifyArtifactSteps(changed), name);
}
for (const script of artifactScripts) {
  const find = (steps: ReleaseStep[]) => steps.find(step => step.run?.includes(`scripts/${script}.ts`))!;
  rejectMutation(`${script}: commented command`, steps => {
    find(steps).run = (find(steps).run ?? '').replace(/^\s*node /gm, '# node ');
  });
  rejectMutation(`${script}: echoed command`, steps => {
    find(steps).run = (find(steps).run ?? '').replace(/^\s*node /gm, 'echo node ');
  });
  rejectMutation(`${script}: disabled step`, steps => { find(steps).if = false; });
  rejectMutation(`${script}: optional failure`, steps => { find(steps)['continue-on-error'] = true; });
  rejectMutation(`${script}: wrong artifact location`, steps => {
    find(steps).run = (find(steps).run ?? '').replaceAll('release/npm-artifacts', 'release/wrong-artifacts');
  });
  rejectMutation(`${script}: fake artifact option in comment`, steps => {
    const step = find(steps);
    const expected = script === 'build-release-artifacts' ? '--output release/npm-artifacts'
      : script === 'release-candidate' ? '--manifest release/npm-artifacts/manifest.json'
      : '--artifact-manifest release/npm-artifacts/manifest.json';
    step.run = shellLines(step.run ?? '').map(line => line.startsWith('node ')
      ? line.replace(expected, expected.replace('release/npm-artifacts', 'release/wrong')) + ` # ${expected}` : line).join('\n');
  });
  rejectMutation(`${script}: conditional shell body`, steps => {
    find(steps).run = `if false; then\n${find(steps).run}\nfi`;
  });
}
rejectMutation('candidate before install gate', steps => {
  const install = steps.findIndex(step => step.run?.includes('scripts/validate-npm-clean-install.ts'));
  [steps[install], steps[candidateIndex]] = [steps[candidateIndex], steps[install]];
});
rejectMutation('candidate missing manifest', steps => {
  steps[candidateIndex].run = (steps[candidateIndex].run ?? '').replace('--manifest release/npm-artifacts/manifest.json', '');
});
for (const run of ['npm pack --workspaces --dry-run', 'npm publish \\\n  --workspace cli', 'npm -w cli publish', 'npm --workspace=cli pack']) {
  rejectMutation(`workspace command: ${run}`, steps => { steps.push({ run }); });
}


const runnerSource = readText('scripts/run-validators/implementation.ts');
for (const contractMarker of [
  '--run-id', '--resume', '--status', 'summary.partial.json', 'killAllRunningValidatorChildren',
  'atm.validatorDag.v1', 'atm.validatorSelectionReport.v1', 'cacheDecision', 'durationMs',
  'timedOut', 'outputDigest'
]) assert.ok(runnerSource.includes(contractMarker), `validator runner must expose ${contractMarker}`);

console.log('plan 3x/4x validator profile coverage: ok');
