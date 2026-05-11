import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { createLazyInstantiationContract, propagateTemplateUpgrade } from '../packages/core/src/polymorph/template.mjs';
import { detectPolymorphicDimensions } from '../packages/core/src/polymorph/dimension-detector.mjs';
import { compareQualityMetrics } from '../packages/core/src/police/regression-compare.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function check(condition, message) {
  if (!condition) {
    throw new Error(`[polymorph-template:${mode}] ${message}`);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

for (const relativePath of [
  'schemas/polymorphism/polymorphic-template.schema.json',
  'schemas/polymorphism/dimension-spec.schema.json',
  'packages/core/src/polymorph/template.mjs',
  'packages/core/src/polymorph/dimension-detector.mjs',
  'fixtures/polymorph/polymorphic-template-pass.json',
  'fixtures/polymorph/dimension-spec-pass.json',
  'fixtures/polymorph/dedup-polymorph-ignore-pass.json'
]) {
  check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const polymorphicTemplateSchema = readJson('schemas/polymorphism/polymorphic-template.schema.json');
const dimensionSpecSchema = readJson('schemas/polymorphism/dimension-spec.schema.json');

const validateTemplate = ajv.compile(polymorphicTemplateSchema);
const validateDimensionSpec = ajv.compile(dimensionSpecSchema);

const templateFixture = readJson('fixtures/polymorph/polymorphic-template-pass.json');
const dimensionFixture = readJson('fixtures/polymorph/dimension-spec-pass.json');

check(validateTemplate(templateFixture) === true, `polymorphic template fixture schema validation failed: ${JSON.stringify(validateTemplate.errors)}`);
check(validateDimensionSpec(dimensionFixture) === true, `dimension spec fixture schema validation failed: ${JSON.stringify(validateDimensionSpec.errors)}`);

const lazyContract = createLazyInstantiationContract(templateFixture, dimensionFixture);
check(lazyContract.registryExpansion === 'none', 'lazy contract must keep registryExpansion=none');
check(lazyContract.materializedInRegistry === false, 'lazy contract must not materialize instances in registry');

const propagation = propagateTemplateUpgrade({
  templateId: templateFixture.templateId,
  toVersion: '1.2.0',
  instances: [
    { runtimeInstanceId: 'ATM-CORE-0001@typescript.node' },
    { runtimeInstanceId: 'ATM-CORE-0001@javascript.node' }
  ]
});
check(propagation.propagatedCount === 2, 'propagation must cover all instances');
check(propagation.propagatedInstances.every((instance) => instance.inheritedBy === 'behavior.evolve'), 'propagation must mark inheritedBy=behavior.evolve');
check(propagation.propagatedInstances.every((instance) => instance.needsRegistryWrite === false), 'propagation must not write lazy instances into registry');

const detectorResult = detectPolymorphicDimensions(
  {
    dimensionValues: {
      parameter: { strict: true },
      language: { primary: 'typescript' }
    },
    staticContract: {
      atomId: 'ATM-CORE-0001',
      hashLockAlgorithm: 'sha256'
    }
  },
  {
    dimensionValues: {
      parameter: { strict: false },
      language: { primary: 'javascript' }
    },
    staticContract: {
      atomId: 'ATM-CORE-0001',
      hashLockAlgorithm: 'sha256'
    }
  }
);
check(detectorResult.explainable === true, 'dimension detector must treat pure dimension diffs as explainable');
check(detectorResult.matchedDimensions.includes('parameter'), 'dimension detector must report parameter dimension');
check(detectorResult.matchedDimensions.includes('language'), 'dimension detector must report language dimension');

const dedupFixture = readJson('fixtures/polymorph/dedup-polymorph-ignore-pass.json');
const dedupReport = compareQualityMetrics(dedupFixture);
check(Array.isArray(dedupReport.dedupCandidates), 'dedup report must contain dedupCandidates array');
check(dedupReport.dedupCandidates.length === 1, 'polymorph instance candidate must be filtered out from dedup candidates');
check(Array.isArray(dedupReport.dedupIgnoredAsPolymorph), 'dedup report must include dedupIgnoredAsPolymorph');
check(dedupReport.dedupIgnoredAsPolymorph.length === 1, 'dedup report must track ignored polymorph candidate count');

console.log('[polymorph-template:' + mode + '] ok (template schema, dimension schema, lazy instantiation, detector, and dedup integration verified)');
