import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isRegistryEntryStatus, isRegistryGovernanceTier, registryGovernanceTiers } from '../status-machine.ts';
import { defaultRegistrySchemaPath, toPortablePath } from './paths.ts';
import type { IssueReporter, ValidateRegistryDocumentOptions, ValidationIssue } from './types.ts';

const require = createRequire(import.meta.url);

export function validateRegistryDocument(registryDocument: unknown, options: ValidateRegistryDocumentOptions = {}) {
  const schemaPath = path.resolve(options.schemaPath ?? defaultRegistrySchemaPath);
  const validatorMode = normalizeValidatorMode(options.validatorMode);
  if (!existsSync(schemaPath)) {
    return createFailure(schemaPath, 'ATM_REGISTRY_SCHEMA_NOT_FOUND', [
      {
        code: 'ATM_REGISTRY_SCHEMA_NOT_FOUND',
        keyword: 'exists',
        path: toPortablePath(schemaPath),
        text: 'Registry schema file was not found.',
        prompt: `Restore the registry schema file at ${toPortablePath(schemaPath)}.`
      }
    ]);
  }

  if (validatorMode !== 'structural-only') {
    let ajv;
    try {
      let Ajv2020, addFormats;
      try {
        Ajv2020 = require('ajv/dist/2020.js');
        addFormats = require('ajv-formats');
      } catch {
        const cwdRequire = createRequire(path.join(process.cwd(), 'package.json'));
        Ajv2020 = cwdRequire('ajv/dist/2020.js');
        addFormats = cwdRequire('ajv-formats');
      }
      const AjvConstructor = Ajv2020.default ?? Ajv2020;
      const addFormatsPlugin = addFormats.default ?? addFormats;
      ajv = new AjvConstructor({ allErrors: true, strict: false });
      addFormatsPlugin(ajv);
    } catch (error) {
      if (validatorMode === 'schema') {
        return createFailure(schemaPath, 'ATM_REGISTRY_VALIDATOR_UNAVAILABLE', [
          {
            code: 'ATM_REGISTRY_VALIDATOR_UNAVAILABLE',
            keyword: 'runtime',
            path: toPortablePath(schemaPath),
            text: 'AJV validator is not available in this environment.',
            prompt: `Install the validator dependency or restore the AJV runtime. Reason: ${error instanceof Error ? error.message : String(error)}`
          }
        ]);
      }
      return validateRegistryDocumentStructurally(registryDocument, {
        schemaPath,
        validatorReason: error instanceof Error ? error.message : String(error)
      });
    }

    const validate = ajv.compile(JSON.parse(readFileSync(schemaPath, 'utf8')));
    const valid = validate(registryDocument);
    if (!valid) {
      return createFailure(schemaPath, 'ATM_REGISTRY_INVALID', (validate.errors || []).map((err: { keyword: string; instancePath: string; message?: string }) => ({
        code: 'ATM_REGISTRY_INVALID',
        keyword: err.keyword,
        path: err.instancePath && err.instancePath.length > 0 ? err.instancePath : '/',
        text: err.message ?? 'Invalid registry document.',
        prompt: `Fix the registry document field at ${err.instancePath && err.instancePath.length > 0 ? err.instancePath : '/'} (${err.keyword}).`
      })));
    }

    return {
      ok: true,
      schemaPath: toPortablePath(schemaPath),
      validationMode: 'schema',
      promptReport: {
        code: 'ATM_REGISTRY_OK',
        summary: `Registry document ${(registryDocument as Record<string, unknown>).registryId} validated successfully.`,
        issues: []
      }
    };
  }

  return validateRegistryDocumentStructurally(registryDocument, { schemaPath });
}

export function validateRegistryDocumentFile(registryPath: string, options: ValidateRegistryDocumentOptions = {}) {
  const resolvedPath = path.resolve(registryPath);
  if (!existsSync(resolvedPath)) {
    return {
      ok: false,
      registryPath: toPortablePath(resolvedPath),
      schemaPath: toPortablePath(path.resolve(options.schemaPath ?? defaultRegistrySchemaPath)),
      document: null,
      promptReport: {
        code: 'ATM_REGISTRY_NOT_FOUND',
        summary: 'Atomic registry file was not found.',
        issues: [
          {
            code: 'ATM_REGISTRY_NOT_FOUND',
            keyword: 'exists',
            path: toPortablePath(resolvedPath),
            text: 'Atomic registry file was not found.',
            prompt: `Restore the registry file at ${toPortablePath(resolvedPath)}.`
          }
        ]
      }
    };
  }

  let document;
  try {
    document = JSON.parse(readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      registryPath: toPortablePath(resolvedPath),
      schemaPath: toPortablePath(path.resolve(options.schemaPath ?? defaultRegistrySchemaPath)),
      document: null,
      promptReport: {
        code: 'ATM_JSON_INVALID',
        summary: 'Atomic registry JSON is invalid.',
        issues: [
          {
            code: 'ATM_JSON_INVALID',
            keyword: 'json',
            path: toPortablePath(resolvedPath),
            text: 'Atomic registry JSON is invalid.',
            prompt: `Fix the JSON syntax in ${toPortablePath(resolvedPath)}. Reason: ${error instanceof Error ? error.message : String(error)}`
          }
        ]
      }
    };
  }

  const validation = validateRegistryDocument(document, options);
  return {
    ...validation,
    registryPath: toPortablePath(resolvedPath),
    document
  };
}

function normalizeValidatorMode(value: string | undefined): 'auto' | 'schema' | 'structural-only' {
  const mode = String(value ?? 'auto').trim();
  if (mode === 'auto' || mode === 'schema' || mode === 'structural-only') {
    return mode as 'auto' | 'schema' | 'structural-only';
  }
  throw new Error(`Unsupported registry validator mode: ${mode || '<empty>'}`);
}

function validateRegistryDocumentStructurally(registryDocument: unknown, options: ValidateRegistryDocumentOptions = {}) {
  const schemaPath = toPortablePath(options.schemaPath ?? defaultRegistrySchemaPath);
  const issues: ValidationIssue[] = [];
  const doc = registryDocument as Record<string, unknown> | null | undefined;
  const registryId = typeof doc?.registryId === 'string' ? doc.registryId : '<unknown>';
  const issue: IssueReporter = (pathValue: string, keyword: string, text: string) => {
    issues.push({
      code: 'ATM_REGISTRY_INVALID',
      keyword,
      path: pathValue,
      text,
      prompt: `Fix the registry document field at ${pathValue} (${keyword}).`
    });
  };

  if (!isPlainObject(registryDocument)) {
    issue('/', 'type', 'Registry document must be an object.');
    return createFailure(schemaPath, 'ATM_REGISTRY_INVALID', issues);
  }

  if (doc!.schemaId !== 'atm.registry') {
    issue('/schemaId', 'const', 'Registry document schemaId must equal atm.registry.');
  }
  if (!isNonEmptyString(doc!.specVersion)) {
    issue('/specVersion', 'type', 'Registry document specVersion must be a non-empty string.');
  }
  if (!isNonEmptyString(doc!.registryId)) {
    issue('/registryId', 'type', 'Registry document registryId must be a non-empty string.');
  }
  if (!isNonEmptyString(doc!.generatedAt)) {
    issue('/generatedAt', 'type', 'Registry document generatedAt must be a non-empty string.');
  }
  if (!Array.isArray(doc!.entries)) {
    issue('/entries', 'type', 'Registry document entries must be an array.');
  } else {
    (doc!.entries as unknown[]).forEach((entry: unknown, index: number) => validateRegistryEntryStructurally(entry, `/entries/${index}`, issue));
  }

  if (isPlainObject(doc!.sharding)) {
    const sharding = doc!.sharding as Record<string, unknown>;
    if (!['single-document', 'external-parts'].includes(String(sharding.strategy ?? '').trim())) {
      issue('/sharding/strategy', 'enum', 'Registry sharding strategy must be single-document or external-parts.');
    }
    if (!Array.isArray(sharding.partPaths)) {
      issue('/sharding/partPaths', 'type', 'Registry sharding partPaths must be an array.');
    }
  }

  if (issues.length > 0) {
    return createFailure(schemaPath, 'ATM_REGISTRY_INVALID', issues);
  }

  const summarySuffix = options.validatorReason
    ? ` using structural fallback (${options.validatorReason}).`
    : ' using structural fallback.';
  return {
    ok: true,
    schemaPath,
    validationMode: 'structural',
    promptReport: {
      code: 'ATM_REGISTRY_OK',
      summary: `Registry document ${registryId} validated successfully${summarySuffix}`,
      issues: []
    }
  };
}

function validateRegistryEntryStructurally(entry: unknown, basePath: string, issue: IssueReporter): void {
  if (!isPlainObject(entry)) {
    issue(basePath, 'type', 'Registry entry must be an object.');
    return;
  }

  const e = entry as Record<string, unknown>;
  if (e.schemaId === 'atm.atomicMap') {
    validateAtomicMapRegistryEntryStructurally(e, basePath, issue);
    return;
  }
  if (e.schemaId === 'atm.atomicSpec') {
    validateAtomicSpecRegistryEntryStructurally(e, basePath, issue);
    return;
  }
  issue(`${basePath}/schemaId`, 'enum', 'Registry entry schemaId must be atm.atomicSpec or atm.atomicMap.');
}

function validateAtomicMapRegistryEntryStructurally(entry: Record<string, unknown>, basePath: string, issue: IssueReporter): void {
  requireString(entry.mapId, `${basePath}/mapId`, issue);
  requireString(entry.mapVersion, `${basePath}/mapVersion`, issue);
  requireString(entry.specVersion, `${basePath}/specVersion`, issue);
  requireString(entry.schemaPath, `${basePath}/schemaPath`, issue);
  requireString(entry.mapHash, `${basePath}/mapHash`, issue);
  requireRegistryStatus(entry.status, `${basePath}/status`, issue);
  requireGovernance(entry.governance, `${basePath}/governance`, issue);
  requireStringArray(entry.entrypoints, `${basePath}/entrypoints`, issue);
  requireMembers(entry.members, `${basePath}/members`, issue);
  requireEdges(entry.edges, `${basePath}/edges`, issue);
  requireQualityTargets(entry.qualityTargets, `${basePath}/qualityTargets`, issue);
  requireOptionalLocation(entry.location, `${basePath}/location`, issue);
  requireOptionalEvidence(entry.evidence, `${basePath}/evidence`, issue);

  if (entry.replacement !== undefined) {
    if (!isPlainObject(entry.replacement)) {
      issue(`${basePath}/replacement`, 'type', 'Atomic map replacement must be an object.');
    } else {
      const replacement = entry.replacement as Record<string, unknown>;
      requireStringArray(replacement.legacyUris, `${basePath}/replacement/legacyUris`, issue);
      requireStringArray(replacement.evidenceRefs, `${basePath}/replacement/evidenceRefs`, issue);
      const mode = String(replacement.mode ?? '').trim();
      if (!['draft', 'shadow', 'canary', 'active', 'legacy-retired'].includes(mode)) {
        issue(`${basePath}/replacement/mode`, 'enum', 'Atomic map replacement mode must be draft, shadow, canary, active, or legacy-retired.');
      }
    }
  }
}

function validateAtomicSpecRegistryEntryStructurally(entry: Record<string, unknown>, basePath: string, issue: IssueReporter): void {
  requireString(entry.atomId, `${basePath}/atomId`, issue);
  requireString(entry.specVersion, `${basePath}/specVersion`, issue);
  requireString(entry.schemaPath, `${basePath}/schemaPath`, issue);
  requireString(entry.specPath, `${basePath}/specPath`, issue);
  requireRegistryStatus(entry.status, `${basePath}/status`, issue);
  requireGovernance(entry.governance, `${basePath}/governance`, issue);
  requireOptionalLocation(entry.location, `${basePath}/location`, issue);
  requireOptionalEvidence(entry.evidence, `${basePath}/evidence`, issue);

  if (!isPlainObject(entry.hashLock) || !isNonEmptyString((entry.hashLock as Record<string, unknown>).digest)) {
    issue(`${basePath}/hashLock`, 'type', 'Atomic spec registry entry hashLock must include a digest.');
  }
  if (!isPlainObject(entry.owner) || !isNonEmptyString((entry.owner as Record<string, unknown>).name) || !isNonEmptyString((entry.owner as Record<string, unknown>).contact)) {
    issue(`${basePath}/owner`, 'type', 'Atomic spec registry entry owner must include name and contact.');
  }
  if (!isPlainObject(entry.compatibility) || !isNonEmptyString((entry.compatibility as Record<string, unknown>).coreVersion) || !isNonEmptyString((entry.compatibility as Record<string, unknown>).registryVersion)) {
    issue(`${basePath}/compatibility`, 'type', 'Atomic spec registry entry compatibility must include coreVersion and registryVersion.');
  }
  if (!isPlainObject(entry.selfVerification)) {
    issue(`${basePath}/selfVerification`, 'type', 'Atomic spec registry entry selfVerification must be an object.');
    return;
  }
  const sv = entry.selfVerification as Record<string, unknown>;
  requireString(sv.specHash, `${basePath}/selfVerification/specHash`, issue);
  requireString(sv.codeHash, `${basePath}/selfVerification/codeHash`, issue);
  requireString(sv.testHash, `${basePath}/selfVerification/testHash`, issue);
  if (!isPlainObject(sv.sourcePaths)) {
    issue(`${basePath}/selfVerification/sourcePaths`, 'type', 'Atomic spec registry entry selfVerification.sourcePaths must be an object.');
  } else {
    const sourcePaths = sv.sourcePaths as Record<string, unknown>;
    requireString(sourcePaths.spec, `${basePath}/selfVerification/sourcePaths/spec`, issue);
    const code = sourcePaths.code;
    if (!(isNonEmptyString(code) || Array.isArray(code))) {
      issue(`${basePath}/selfVerification/sourcePaths/code`, 'type', 'Atomic spec registry entry selfVerification.sourcePaths.code must be a string or array.');
    }
    requireStringArray(sourcePaths.tests, `${basePath}/selfVerification/sourcePaths/tests`, issue);
  }
}

function requireString(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!isNonEmptyString(value)) {
    issue(pathValue, 'type', 'Field must be a non-empty string.');
  }
}

function requireStringArray(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!Array.isArray(value)) {
    issue(pathValue, 'type', 'Field must be an array of non-empty strings.');
    return;
  }
  value.forEach((entry: unknown, index: number) => {
    if (!isNonEmptyString(entry)) {
      issue(`${pathValue}/${index}`, 'type', 'Array item must be a non-empty string.');
    }
  });
}

function requireMembers(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!Array.isArray(value)) {
    issue(pathValue, 'type', 'Atomic map members must be an array.');
    return;
  }
  value.forEach((member: unknown, index: number) => {
    if (!isPlainObject(member)) {
      issue(`${pathValue}/${index}`, 'type', 'Atomic map member must be an object.');
      return;
    }
    const m = member as Record<string, unknown>;
    requireString(m.atomId, `${pathValue}/${index}/atomId`, issue);
    requireString(m.version, `${pathValue}/${index}/version`, issue);
  });
}

function requireEdges(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!Array.isArray(value)) {
    issue(pathValue, 'type', 'Atomic map edges must be an array.');
    return;
  }
  value.forEach((edge: unknown, index: number) => {
    if (!isPlainObject(edge)) {
      issue(`${pathValue}/${index}`, 'type', 'Atomic map edge must be an object.');
      return;
    }
    const e = edge as Record<string, unknown>;
    requireString(e.from, `${pathValue}/${index}/from`, issue);
    requireString(e.to, `${pathValue}/${index}/to`, issue);
    requireString(e.binding, `${pathValue}/${index}/binding`, issue);
  });
}

function requireQualityTargets(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!isPlainObject(value)) {
    issue(pathValue, 'type', 'Atomic map qualityTargets must be an object.');
    return;
  }
  for (const [key, targetValue] of Object.entries(value as Record<string, unknown>)) {
    if (!['string', 'number', 'boolean'].includes(typeof targetValue)) {
      issue(`${pathValue}/${key}`, 'type', 'Atomic map quality target values must be string, number, or boolean.');
    }
  }
}

function requireRegistryStatus(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!isRegistryEntryStatus(value)) {
    issue(pathValue, 'enum', 'Registry status must be one of the supported registry entry statuses.');
  }
}

function requireGovernance(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (!isPlainObject(value)) {
    issue(pathValue, 'type', 'Governance must be an object.');
    return;
  }
  const gov = value as Record<string, unknown>;
  if (!isRegistryGovernanceTier(gov.tier)) {
    issue(`${pathValue}/tier`, 'enum', `Governance tier must be one of ${registryGovernanceTiers.join(', ')}.`);
  }
}

function requireOptionalLocation(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (value === undefined) {
    return;
  }
  if (!isPlainObject(value)) {
    issue(pathValue, 'type', 'Location must be an object.');
    return;
  }
  const loc = value as Record<string, unknown>;
  requireString(loc.specPath, `${pathValue}/specPath`, issue);
  if (!Array.isArray(loc.codePaths)) {
    issue(`${pathValue}/codePaths`, 'type', 'Location codePaths must be an array.');
  }
  if (!Array.isArray(loc.testPaths)) {
    issue(`${pathValue}/testPaths`, 'type', 'Location testPaths must be an array.');
  }
}

function requireOptionalEvidence(value: unknown, pathValue: string, issue: IssueReporter): void {
  if (value === undefined) {
    return;
  }
  requireStringArray(value, pathValue, issue);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function createFailure(schemaPath: string, code: string, issues: ValidationIssue[]) {
  return {
    ok: false,
    schemaPath: toPortablePath(schemaPath),
    promptReport: {
      code,
      summary: `Registry validation failed with ${issues.length} issue(s).`,
      issues
    }
  };
}
