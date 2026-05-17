import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const requireFromDecompositionPlan = createRequire(import.meta.url);

export const defaultDecompositionPlanSchemaPath = path.join(frameworkRoot, 'schemas', 'governance', 'decomposition-plan.schema.json');

export function readDecompositionPlan(planPath: string, options: any = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const absolutePlanPath = path.resolve(cwd, planPath);
  if (!existsSync(absolutePlanPath)) {
    throw createDecompositionPlanError('ATM_DECOMP_PLAN_INVALID', 'Decomposition plan file was not found.', {
      planPath: toPortablePath(absolutePlanPath)
    });
  }

  let document;
  try {
    document = JSON.parse(readFileSync(absolutePlanPath, 'utf8'));
  } catch (error) {
    throw createDecompositionPlanError('ATM_DECOMP_PLAN_INVALID', 'Failed to parse decomposition plan JSON.', {
      planPath: toPortablePath(absolutePlanPath),
      reason: error instanceof Error ? error.message : String(error)
    });
  }

  const validation = validateDecompositionPlanDocument(document, {
    schemaPath: options.schemaPath ?? defaultDecompositionPlanSchemaPath
  });
  if (!validation.ok) {
    throw createDecompositionPlanError('ATM_DECOMP_PLAN_INVALID', 'Decomposition plan did not satisfy its schema contract.', {
      planPath: toPortablePath(absolutePlanPath),
      issues: validation.issues
    });
  }

  return {
    plan: document,
    absolutePlanPath,
    relativePlanPath: toPortablePath(path.relative(cwd, absolutePlanPath)),
    validation
  };
}

export function validateDecompositionPlanDocument(document: unknown, options: any = {}) {
  const schemaPath = path.resolve(options.schemaPath ?? defaultDecompositionPlanSchemaPath);
  const { Ajv2020, addFormats } = loadJsonSchemaValidatorModules();
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(readJson(schemaPath));
  const ok = validate(document) === true;

  return {
    ok,
    schemaPath: toPortablePath(schemaPath),
    issues: ok
      ? []
      : (validate.errors || []).map((error: any) => ({
          path: error.instancePath || '/',
          keyword: error.keyword,
          message: error.message ?? 'Schema validation failed.',
          params: error.params ?? {}
        }))
  };
}

export function createAtomicMapRequestFromDecompositionPlan(plan: any) {
  const qualityTargets = normalizeQualityTargets(plan?.qualityTargets);
  return {
    mapId: String(plan.proposedMapId || '').trim(),
    request: {
      mapVersion: String(plan.mapVersion || '0.1.0').trim(),
      specVersion: '0.2.0',
      members: Array.isArray(plan.proposedMembers) ? plan.proposedMembers.map((entry) => ({ ...entry })) : [],
      edges: Array.isArray(plan.proposedEdges) ? plan.proposedEdges.map((entry) => ({ ...entry })) : [],
      entrypoints: Array.isArray(plan.entrypoints) ? [...plan.entrypoints] : [],
      qualityTargets,
      replacement: {
        legacyUris: Array.isArray(plan.legacyUris) ? [...plan.legacyUris] : [],
        mode: 'draft',
        evidenceRefs: []
      }
    },
    defaultsUsed: plan?.qualityTargets ? [] : ['qualityTargets']
  };
}

function normalizeQualityTargets(value: unknown) {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, string | number | boolean>
    : {
        promoteGateRequired: true,
        requiredChecks: 1
      };

  return Object.fromEntries(Object.entries(source)
    .map(([key, entryValue]) => [String(key).trim(), typeof entryValue === 'string' ? entryValue.trim() : entryValue])
    .sort(([left], [right]) => left.localeCompare(right)));
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function createDecompositionPlanError(code: string, message: string, details: Record<string, unknown>) {
  const error = new Error(message) as Error & { code: string; details: Record<string, unknown> };
  error.name = 'DecompositionPlanError';
  error.code = code;
  error.details = details;
  return error;
}

function toPortablePath(filePath: string) {
  return filePath.replace(/\\/g, '/');
}

function loadJsonSchemaValidatorModules() {
  const ajvModule = requireFromDecompositionPlan('ajv/dist/2020.js');
  const formatsModule = requireFromDecompositionPlan('ajv-formats');
  return {
    Ajv2020: ajvModule.default ?? ajvModule,
    addFormats: formatsModule.default ?? formatsModule
  };
}