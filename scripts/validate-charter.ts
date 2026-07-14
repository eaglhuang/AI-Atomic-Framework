import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: any) {
  console.error(`[charter:${mode}] ${message}`);
  process.exitCode = 1;
}

function readJson(relativePath: any) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`missing file: ${relativePath}`);
    return null;
  }
  return JSON.parse(readFileSync(absolutePath, 'utf8'));
}

function readText(relativePath: any) {
  const absolutePath = path.join(root, relativePath);
  if (!existsSync(absolutePath)) {
    fail(`missing file: ${relativePath}`);
    return '';
  }
  return readFileSync(absolutePath, 'utf8');
}

function formatErrors(errors: any) {
  return (errors || [])
    .map((e: any) => `${e.instancePath || '/'} ${e.message}`)
    .join('; ');
}

const bannedTerms = [
  ['3K', 'Life'].join(''),
  ['Co', 'cos'].join(''),
  ['cocos', '-creator'].join(''),
  ['html', '-to-', 'ucuf'].join(''),
  ['ga', 'cha'].join(''),
  ['UC', 'UF'].join(''),
  ['draft', '-builder'].join(''),
  ['task', '-lock'].join(''),
  ['compute', '-gate'].join(''),
  ['doc', '-id-', 'registry'].join(''),
  ['tools', '_node/'].join(''),
  ['assets', '/scripts/'].join(''),
  ['docs', '/agent-', 'briefs/'].join('')
];

// --- Required file presence ---

const requiredFiles = [
  'schemas/charter/charter-invariants.schema.json',
  'schemas/charter/charter-bundle.schema.json',
  'templates/root-drop/.atm/charter/atomic-charter.template.md',
  'templates/root-drop/.atm/charter/atm-first-principles.template.md',
  'templates/root-drop/.atm/charter/charter-invariants.template.json',
  'fixtures/charter/default-charter.json',
  'fixtures/charter/charter-conflict.json'
];

for (const f of requiredFiles) {
  if (!existsSync(path.join(root, f))) {
    fail(`missing required file: ${f}`);
  }
}

// --- Banned terms in protected charter surfaces ---

const protectedFiles = [
  'schemas/charter/charter-invariants.schema.json',
  'schemas/charter/charter-bundle.schema.json',
  'templates/root-drop/.atm/charter/atomic-charter.template.md',
  'templates/root-drop/.atm/charter/atm-first-principles.template.md',
  'templates/root-drop/.atm/charter/charter-invariants.template.json',
  'fixtures/charter/default-charter.json',
  'fixtures/charter/charter-conflict.json',
  'scripts/validate-charter.ts'
];

for (const f of protectedFiles) {
  const content = readText(f);
  for (const term of bannedTerms) {
    if (content.includes(term)) {
      fail(`${f} contains downstream-only term: ${term}`);
    }
  }
}

// --- Schema self-validation ---

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const invariantsSchema = readJson('schemas/charter/charter-invariants.schema.json');
const bundleSchema = readJson('schemas/charter/charter-bundle.schema.json');
if (invariantsSchema) {
  if (!ajv.validateSchema(invariantsSchema)) {
    fail(`schemas/charter/charter-invariants.schema.json is not a valid JSON Schema: ${formatErrors(ajv.errors)}`);
  } else {
    ajv.addSchema(invariantsSchema, 'charter-invariants');
  }
}
if (bundleSchema) {
  if (!ajv.validateSchema(bundleSchema)) {
    fail(`schemas/charter/charter-bundle.schema.json is not a valid JSON Schema: ${formatErrors(ajv.errors)}`);
  } else {
    ajv.addSchema(bundleSchema, 'charter-bundle');
  }
}

// --- Schema metadata requirements ---

if (invariantsSchema) {
  if (!invariantsSchema.$id) fail('schemas/charter/charter-invariants.schema.json must define $id');
  if (!invariantsSchema.$schema) fail('schemas/charter/charter-invariants.schema.json must define $schema');
  if (!invariantsSchema.title) fail('schemas/charter/charter-invariants.schema.json must define title');
  if (!invariantsSchema.description) fail('schemas/charter/charter-invariants.schema.json must define description');
}
if (bundleSchema) {
  if (!bundleSchema.$id) fail('schemas/charter/charter-bundle.schema.json must define $id');
  if (!bundleSchema.$schema) fail('schemas/charter/charter-bundle.schema.json must define $schema');
  if (!bundleSchema.title) fail('schemas/charter/charter-bundle.schema.json must define title');
  if (!bundleSchema.description) fail('schemas/charter/charter-bundle.schema.json must define description');
}

// --- Positive fixture: default-charter.json must validate ---

if (!process.exitCode && invariantsSchema) {
  const validate = ajv.getSchema('charter-invariants');
  if (validate) {
    const defaultCharter = readJson('fixtures/charter/default-charter.json');
    if (defaultCharter && !validate(defaultCharter)) {
      fail(`fixtures/charter/default-charter.json failed schema validation: ${formatErrors(validate.errors)}`);
    }
    if (defaultCharter) {
      // Verify all seed invariants are present
      const ids: string[] = (defaultCharter as any).invariants?.map((inv: any) => inv.id) ?? [];
      for (const expected of ['INV-ATM-001', 'INV-ATM-002', 'INV-ATM-003', 'INV-ATM-004', 'INV-ATM-005', 'INV-ATM-006', 'INV-ATM-007']) {
        if (!ids.includes(expected)) {
          fail(`fixtures/charter/default-charter.json missing seed invariant: ${expected}`);
        }
      }
      if ((defaultCharter as any).scheduleA?.economicRatios?.production?.maxCostRatio !== 1.1) {
        fail('fixtures/charter/default-charter.json must expose Schedule A production maxCostRatio 1.1');
      }
      if ((defaultCharter as any).scheduleA?.tokenDiagnostics?.priceProxyAllowed !== false) {
        fail('fixtures/charter/default-charter.json must mark raw tokens as diagnostics, not a price proxy');
      }
    }
  }
}

if (!process.exitCode && bundleSchema) {
  const validateBundle = ajv.getSchema('charter-bundle');
  const bundleFixture = {
    schemaId: 'atm.charterAuthorityBundle',
    schemaVersion: 'atm.charterBundle.v0.1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'validator fixture' },
    charterVersion: '2.0.0',
    lastAmendedAt: '2026-05-17T00:00:00.000Z',
    atomicCharter: {
      path: '.atm/charter/atomic-charter.md',
      sha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    },
    firstPrinciples: {
      path: '.atm/charter/atm-first-principles.md',
      sha256: 'sha256:1111111111111111111111111111111111111111111111111111111111111111'
    },
    invariants: {
      path: '.atm/charter/charter-invariants.json',
      sha256: 'sha256:2222222222222222222222222222222222222222222222222222222222222222'
    },
    scheduleA: {
      scheduleId: 'schedule-a-economic-thresholds',
      economicRatios: {
        production: { maxCostRatio: 1.1, maxEndToEndTimeRatio: 1.1 },
        preferred: { maxCostRatio: 1.05, maxEndToEndTimeRatio: 1.05 },
        breakthrough: { maxCostRatio: 1.1, maxEndToEndTimeRatio: 0.8 }
      },
      tokenDiagnostics: {
        required: true,
        priceProxyAllowed: false,
        rationale: 'Raw token counts are diagnostics, not a price proxy.'
      },
      teamThresholds: {
        production: { maxCostRatio: 1.1, maxEndToEndTimeRatio: 1.0, requiresMeasuredAcceleration: true },
        preferred: { maxCostRatio: 1.05, maxEndToEndTimeRatio: 0.95, requiresMeasuredAcceleration: true },
        breakthrough: { maxCostRatio: 1.1, maxEndToEndTimeRatio: 0.8, requiresMeasuredAcceleration: true }
      }
    }
  };
  if (validateBundle && !validateBundle(bundleFixture)) {
    fail(`charter bundle fixture failed schema validation: ${formatErrors(validateBundle.errors)}`);
  }
}

// --- Negative fixture: charter-conflict.json must fail validation ---

if (!process.exitCode && invariantsSchema) {
  const validate = ajv.getSchema('charter-invariants');
  if (validate) {
    const conflictCharter = readJson('fixtures/charter/charter-conflict.json');
    if (conflictCharter) {
      const valid = validate(conflictCharter);
      if (valid) {
        fail('fixtures/charter/charter-conflict.json unexpectedly passed schema validation (expected failure)');
      } else {
        const hasEnumError = (validate.errors || []).some(
          (e: any) => e.keyword === 'enum' || e.instancePath.includes('enforcement')
        );
        if (!hasEnumError) {
          fail(`fixtures/charter/charter-conflict.json did not fail on the expected 'enum' keyword for enforcement; got: ${formatErrors(validate.errors)}`);
        }
      }
    }
  }
}

// --- Atomic charter template structure ---

const charterTemplate = readText('templates/root-drop/.atm/charter/atomic-charter.template.md');
const requiredTemplateSections = [
  '# AtomicCharter',
  'Authority Hierarchy',
  'Framework Invariants',
  'Schedule A',
  'Agent Entry Point',
  'node atm.mjs next --json',
  'Amending This Charter',
  '{{PROJECT_NAME}}',
  '{{CHARTER_VERSION}}',
  '{{LAST_AMENDED_DATE}}'
];
for (const section of requiredTemplateSections) {
  if (!charterTemplate.includes(section)) {
    fail(`templates/root-drop/.atm/charter/atomic-charter.template.md missing required content: ${section}`);
  }
}

const firstPrinciplesTemplate = readText('templates/root-drop/.atm/charter/atm-first-principles.template.md');
for (const section of [
  '# ATM First Principles',
  'Schedule A - Economic Thresholds',
  'actual monetary cost',
  'end-to-end time',
  'Raw token counts are mandatory diagnostics'
]) {
  if (!firstPrinciplesTemplate.includes(section)) {
    fail(`templates/root-drop/.atm/charter/atm-first-principles.template.md missing required content: ${section}`);
  }
}

// --- Charter invariants template is valid JSON and validates against schema ---
// Template uses {{PLACEHOLDER}} tokens so date-time format checks are skipped;
// use a format-free Ajv instance to validate structure only.

if (!process.exitCode && invariantsSchema) {
  const ajvNoFormats = new Ajv2020({ allErrors: true, strict: false });
  ajvNoFormats.addSchema(invariantsSchema, 'charter-invariants-no-fmt');
  const validateNoFmt = ajvNoFormats.getSchema('charter-invariants-no-fmt');
  const templateJson = readJson('templates/root-drop/.atm/charter/charter-invariants.template.json') as any;
  if (templateJson?.charterHash === '{{ATOMIC_CHARTER_SHA256}}') {
    templateJson.charterHash = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
  }
  if (templateJson?.firstPrinciplesHash === '{{ATM_FIRST_PRINCIPLES_SHA256}}') {
    templateJson.firstPrinciplesHash = 'sha256:1111111111111111111111111111111111111111111111111111111111111111';
  }
  if (validateNoFmt && templateJson) {
    const valid = validateNoFmt(templateJson);
    if (!valid) {
      fail(`templates/root-drop/.atm/charter/charter-invariants.template.json failed schema validation: ${formatErrors(validateNoFmt.errors)}`);
    }
  }
}

if (!process.exitCode) {
  console.log(`[charter:${mode}] ok (charter authority bundle, invariants schema, seed invariants, positive + negative fixtures, template structure)`);
}
