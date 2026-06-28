import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { operationalBenchScenarios, operationalBenchProfiles } from './lib/admission-bench/operational-scenarios.ts';
import { operationalBenchSpanNames } from './lib/admission-bench/operational-types.ts';
import type { OperationalBenchResultRow } from './lib/admission-bench/operational-types.ts';
import { createValidator } from './lib/validator-harness.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.join(root, 'artifacts', 'generated', 'atm-operational-bench', '20260627');

const harness = createValidator('operational-bench', {
  argv: process.argv.slice(2),
  defaultMode: 'validate'
});

function readJson<T = any>(relativePath: string): T {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8')) as T;
}

function readArtifact<T = any>(name: string): T {
  return JSON.parse(readFileSync(path.join(artifactDir, name), 'utf8')) as T;
}

function ensureWiring(): void {
  const packageJson = readJson<{ scripts?: Record<string, string> }>('package.json');
  harness.assert(
    packageJson.scripts?.['validate:operational-bench'] === 'node --strip-types scripts/validate-operational-bench.ts --mode validate',
    'package.json must expose validate:operational-bench'
  );
  for (const profile of ['smoke', 'paper', 'extended']) {
    harness.assert(
      packageJson.scripts?.[`bench:operational:${profile}`] === `node --strip-types scripts/run-atm-operational-bench.ts --profile ${profile}`,
      `package.json must expose bench:operational:${profile}`
    );
  }

  const validatorsConfig = readJson<{ validators?: Array<{ name: string; entry: string; slow?: boolean }>; profiles?: Record<string, { validators?: string[] }> }>(
    'scripts/validators.config.json'
  );
  const validatorDef = validatorsConfig.validators?.find((entry) => entry.name === 'validate-operational-bench');
  harness.assert(Boolean(validatorDef), 'validators.config.json must register validate-operational-bench');
  harness.assert(validatorDef?.entry === 'scripts/validate-operational-bench.ts', 'validate-operational-bench entry path mismatch');
  harness.assert(validatorDef?.slow === false, 'validate-operational-bench should be a fast validator');
  harness.assert(
    validatorsConfig.profiles?.standard?.validators?.includes('validate-operational-bench') === true,
    'standard profile must include validate-operational-bench'
  );

  harness.requireFile('scripts/lib/admission-bench/operational-runner.ts');
  harness.requireFile('scripts/lib/admission-bench/operational-scenarios.ts');
  harness.requireFile('scripts/lib/admission-bench/operational-types.ts');
  harness.requireFile('docs/bench/ATM-OperationalBench-CONTRACT.md');
  harness.requireFile('schemas/bench/atm-operational-bench.schema.json');
}

function ensureScenarioContract(): void {
  harness.assert(operationalBenchScenarios.length === 14, 'OperationalBench must define 14 scenarios');
  harness.assert(operationalBenchScenarios.filter((scenario) => scenario.track === 'broker-admission').length === 4, 'track A must define 4 broker admission scenarios');
  harness.assert(operationalBenchScenarios.filter((scenario) => scenario.track === 'git-boundary').length === 5, 'track B must define 5 git boundary scenarios');
  harness.assert(operationalBenchScenarios.filter((scenario) => scenario.track === 'recovery-routing').length === 5, 'track C must define 5 recovery routing scenarios');
  harness.assert(operationalBenchProfiles.paper.warmup >= 10, 'paper warmup must be >= 10');
  harness.assert(operationalBenchProfiles.paper.repeat >= 100, 'paper repeat must be >= 100');
  harness.assert(operationalBenchProfiles.paper.concurrency.join(',') === '1,5,10,20', 'paper concurrency must be 1/5/10/20');
  harness.assert(operationalBenchProfiles.extended.warmup >= 20, 'extended warmup must be >= 20');
  harness.assert(operationalBenchProfiles.extended.repeat >= 300, 'extended repeat must be >= 300');
  harness.assert(operationalBenchProfiles.extended.concurrency.join(',') === '1,5,10,20,50', 'extended concurrency must be 1/5/10/20/50');
}

function ensureSchema(): void {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = readJson('schemas/bench/atm-operational-bench.schema.json');
  harness.assert(Boolean(ajv.validateSchema(schema)), `OperationalBench schema must be valid JSON Schema: ${formatErrors(ajv.errors)}`);
  const validate = ajv.compile(schema);
  const summary = readArtifact('summary.json');
  harness.assert(Boolean(validate(summary)), `summary.json must match OperationalBench schema: ${formatErrors(validate.errors)}`);
}

function ensureArtifacts(): void {
  for (const name of ['summary.json', 'results.jsonl', 'paper-table.md', 'scenario-manifest.json', 'artifact-hash-manifest.sha256', 'README.md']) {
    harness.assert(existsSync(path.join(artifactDir, name)), `missing OperationalBench artifact: ${name}`);
  }

  const summary = readArtifact('summary.json');
  harness.assert(summary.profile === 'paper', 'official 20260627 artifact must use paper profile');
  harness.assert(summary.seed === 20260627, 'official 20260627 artifact must use seed 20260627');
  harness.assert(summary.scenarioCount === operationalBenchScenarios.length, 'summary scenario count must match scenario manifest');
  harness.assert(summary.resultRows === operationalBenchScenarios.length * operationalBenchProfiles.paper.repeat * operationalBenchProfiles.paper.concurrency.length, 'summary result row count must match paper profile denominator');
  harness.assert(summary.recoveryMetrics?.fullRegenerationRate === null, 'fullRegenerationRate must be null when unobserved');
  harness.assert(summary.recoveryMetrics?.fullRegenerationNote === 'not observed by this harness', 'fullRegenerationRate must record not-observed reason');

  const lines = readFileSync(path.join(artifactDir, 'results.jsonl'), 'utf8').trim().split(/\r?\n/);
  harness.assert(lines.length === summary.resultRows, 'results.jsonl line count must equal summary.resultRows');
  const firstRows = lines.slice(0, Math.min(lines.length, 50)).map((line) => JSON.parse(line) as OperationalBenchResultRow);
  for (const row of firstRows) {
    harness.assert(row.schemaId === 'atm.operationalBenchResult.v1', 'result row schemaId mismatch');
    for (const span of operationalBenchSpanNames) {
      harness.assert(Object.hasOwn(row.spans, span), `result row missing span: ${span}`);
      harness.assert(row.spans[span] === null || typeof row.spans[span] === 'number', `${span} must be number or null`);
    }
  }

  const readme = readFileSync(path.join(artifactDir, 'README.md'), 'utf8');
  for (const phrase of [
    'OperationalBench measures ATM-local operational overhead only',
    'Validator cost is listed independently',
    'Fail-closed means fail-closed to unsafe direct or parallel apply',
    'Blocked cases are reported separately',
    'not observed by this harness'
  ]) {
    harness.assert(readme.includes(phrase), `README.md must include phrase: ${phrase}`);
  }
  const table = readFileSync(path.join(artifactDir, 'paper-table.md'), 'utf8');
  harness.assert(table.includes('fullRegenerationRate | null | not observed by this harness'), 'paper-table.md must document null fullRegenerationRate');
}

function ensureHashManifest(): void {
  const manifest = readFileSync(path.join(artifactDir, 'artifact-hash-manifest.sha256'), 'utf8').trim().split(/\r?\n/);
  const actual = new Map<string, string>();
  for (const line of manifest) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    harness.assert(Boolean(match), `invalid hash manifest line: ${line}`);
    if (match) actual.set(match[2], match[1]);
  }
  for (const file of ['README.md', 'paper-table.md', 'results.jsonl', 'scenario-manifest.json', 'summary.json']) {
    const hash = createHash('sha256').update(readFileSync(path.join(artifactDir, file))).digest('hex');
    harness.assert(actual.get(file) === hash, `hash manifest mismatch for ${file}`);
  }
}

function formatErrors(errors: any): string {
  return (errors || []).map((error: any) => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

ensureWiring();
ensureScenarioContract();
ensureSchema();
ensureArtifacts();
ensureHashManifest();

harness.ok('OperationalBench v0.1 contract and 20260627 evidence artifacts validated');
