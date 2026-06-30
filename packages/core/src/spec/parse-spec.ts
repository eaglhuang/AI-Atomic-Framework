import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atomicSpecSemanticFingerprintAtom, runAtm } from '../registry/atom-runtime.ts';
import { normalizeSemanticFingerprint } from '../registry/semantic-fingerprint.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const require = createRequire(import.meta.url);

export const defaultAtomicSpecSchemaPath = path.join(repoRoot, 'schemas', 'atomic-spec.schema.json');

interface ParseAtomicSpecOptions {
  readonly cwd?: string;
  readonly specPath?: string;
  readonly schemaPath?: string;
}

interface PromptIssue {
  readonly code: string;
  readonly keyword: string;
  readonly path: string;
  readonly text: string;
  readonly prompt: string;
}

interface FailureOptions {
  readonly code: string;
  readonly specPath: string | null;
  readonly schemaPath: string | null;
  readonly summary: string;
  readonly issues: readonly PromptIssue[];
}

interface ParsePromptReport {
  readonly code: string;
  readonly summary: string;
  readonly issues: PromptIssue[];
}

interface ParseAtomicSpecSuccess {
  readonly ok: true;
  readonly specPath: string | null;
  readonly schemaPath: string;
  readonly normalizedModel: NormalizedAtomicSpecModel;
  readonly promptReport: ParsePromptReport;
}

interface ParseAtomicSpecFailure {
  readonly ok: false;
  readonly specPath: string | null;
  readonly schemaPath: string | null;
  readonly normalizedModel: null;
  readonly promptReport: ParsePromptReport;
}

interface JsonReadSuccess {
  readonly ok: true;
  readonly document: unknown;
}

interface JsonReadFailure {
  readonly ok: false;
  readonly issue: PromptIssue;
}

interface AtomicSpecPortRecord {
  readonly name: string;
  readonly kind: string;
  readonly required: boolean;
}

interface AtomicSpecDocument {
  readonly id: string;
  readonly schemaId: string;
  readonly specVersion: string;
  readonly title: string;
  readonly description?: string;
  readonly logicalName?: string | null;
  readonly tags?: readonly string[];
  readonly migration: {
    readonly strategy: string;
    readonly fromVersion?: string | null;
    readonly notes: string;
  };
  readonly language: {
    readonly primary: string;
    readonly sourceExtensions?: readonly string[];
    readonly tooling?: readonly string[];
  };
  readonly runtime: {
    readonly kind: string;
    readonly versionRange: string;
    readonly environment: string;
  };
  readonly adapterRequirements: {
    readonly projectAdapter: string;
    readonly storage: string;
    readonly capabilities?: readonly string[];
  };
  readonly compatibility: {
    readonly coreVersion: string;
    readonly registryVersion: string;
    readonly pluginApiVersion?: string | null;
    readonly languageAdapter?: string | null;
    readonly lifecycleMode?: string | null;
  };
  readonly dependencyPolicy?: {
    readonly external?: string;
    readonly hostCoupling?: string;
  };
  readonly validation?: {
    readonly commands?: readonly string[];
    readonly evidenceRequired?: boolean;
  };
  readonly performanceBudget?: {
    readonly hotPath?: boolean;
    readonly inputMutation?: string;
    readonly maxDurationMs?: number;
  };
  readonly semanticFingerprint?: unknown;
  readonly lineage?: {
    readonly bornBy?: string;
    readonly parentRefs?: readonly string[];
    readonly bornAt?: string;
  } | null;
  readonly ttl?: {
    readonly expiresAt?: string;
  } | null;
  readonly deployScope?: string;
  readonly mutabilityPolicy?: string;
  readonly pendingSfCalculation?: boolean;
  readonly hashLock: {
    readonly algorithm: string;
    readonly digest: string;
    readonly canonicalization: string;
  };
  readonly inputs?: readonly AtomicSpecPortRecord[];
  readonly outputs?: readonly AtomicSpecPortRecord[];
}

interface NormalizedAtomicSpecModel {
  readonly source: {
    readonly specPath: string | null;
    readonly schemaPath: string;
  };
  readonly schema: {
    readonly schemaId: string;
    readonly specVersion: string;
    readonly migration: {
      readonly strategy: string;
      readonly fromVersion: string | null;
      readonly notes: string;
    };
  };
  readonly identity: {
    readonly atomId: string;
    readonly logicalName?: string;
    readonly title: string;
    readonly description: string;
    readonly tags: string[];
  };
  readonly execution: {
    readonly language: {
      readonly primary: string;
      readonly sourceExtensions: string[];
      readonly tooling: string[];
    };
    readonly runtime: {
      readonly kind: string;
      readonly versionRange: string;
      readonly environment: string;
    };
    readonly adapterRequirements: {
      readonly projectAdapter: string;
      readonly storage: string;
      readonly capabilities: string[];
    };
    readonly compatibility: {
      readonly coreVersion: string;
      readonly registryVersion: string;
      readonly pluginApiVersion: string;
      readonly languageAdapter: string;
      readonly lifecycleMode: string;
    };
    readonly dependencyPolicy: {
      readonly external: string;
      readonly hostCoupling: string;
    };
    readonly validation: {
      readonly commands: string[];
      readonly evidenceRequired: boolean;
    };
    readonly performanceBudget: {
      readonly hotPath: boolean;
      readonly inputMutation: string;
      readonly maxDurationMs: number | null;
    };
  };
  readonly governance: {
    readonly semanticFingerprint: unknown;
    readonly lineage: {
      readonly bornBy?: string;
      readonly parentRefs: string[];
      readonly bornAt?: string;
    } | null;
    readonly ttl: {
      readonly expiresAt: string | null;
    } | null;
    readonly deployScope: string | null;
    readonly mutabilityPolicy: string | null;
    readonly pendingSfCalculation: boolean;
  };
  readonly hashLock: {
    readonly algorithm: string;
    readonly digest: string;
    readonly canonicalization: string;
  };
  readonly ports: {
    readonly inputs: AtomicSpecPortRecord[];
    readonly outputs: AtomicSpecPortRecord[];
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function asAtomicSpecDocument(value: unknown): AtomicSpecDocument {
  return value as AtomicSpecDocument;
}

export function parseAtomicSpecFile(specOption: string, options: ParseAtomicSpecOptions = {}): ParseAtomicSpecSuccess | ParseAtomicSpecFailure {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const specPath = path.resolve(cwd, specOption);
  const schemaPath = path.resolve(options.schemaPath ?? defaultAtomicSpecSchemaPath);

  if (!existsSync(specPath)) {
    return createFailure({
      code: 'ATM_SPEC_NOT_FOUND',
      specPath,
      schemaPath,
      summary: 'Atomic spec file was not found.',
      issues: [
        {
          code: 'ATM_SPEC_NOT_FOUND',
          keyword: 'exists',
          path: toPortablePath(specPath),
          text: 'Atomic spec file was not found.',
          prompt: `Create or point to an existing atomic spec file at ${toPortablePath(specPath)}.`
        }
      ]
    });
  }

  const specDocument = readJsonDocument(specPath);
  if (!specDocument.ok) {
    const issue = specDocument.issue!;
    return createFailure({
      code: issue.code,
      specPath,
      schemaPath,
      summary: issue.text,
      issues: [issue]
    });
  }

  return parseAtomicSpecDocument(specDocument.document, {
    ...options,
    cwd,
    specPath,
    schemaPath
  });
}

export function parseAtomicSpecDocument(specDocument: unknown, options: ParseAtomicSpecOptions = {}): ParseAtomicSpecSuccess | ParseAtomicSpecFailure {
  const specPath = options.specPath ? path.resolve(options.specPath) : null;
  const schemaPath = path.resolve(options.schemaPath ?? defaultAtomicSpecSchemaPath);

  if (!existsSync(schemaPath)) {
    return createFailure({
      code: 'ATM_SPEC_SCHEMA_NOT_FOUND',
      specPath,
      schemaPath,
      summary: 'Atomic spec schema file was not found.',
      issues: [
        {
          code: 'ATM_SPEC_SCHEMA_NOT_FOUND',
          keyword: 'exists',
          path: toPortablePath(schemaPath),
          text: 'Atomic spec schema file was not found.',
          prompt: `Restore the atomic spec schema file at ${toPortablePath(schemaPath)}.`
        }
      ]
    });
  }

  const schemaDocument = readJsonDocument(schemaPath);
  if (!schemaDocument.ok) {
    const issue = schemaDocument.issue!;
    return createFailure({
      code: issue.code,
      specPath,
      schemaPath,
      summary: issue.text,
      issues: [issue]
    });
  }

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
    return createFailure({
      code: 'ATM_SPEC_VALIDATOR_UNAVAILABLE',
      specPath,
      schemaPath,
      summary: 'AJV validator is not available in this environment.',
      issues: [
        {
          code: 'ATM_SPEC_VALIDATOR_UNAVAILABLE',
          keyword: 'runtime',
          path: toPortablePath(schemaPath),
          text: 'AJV validator is not available in this environment.',
          prompt: `Install the validator dependency or restore the AJV runtime. Reason: ${error instanceof Error ? error.message : String(error)}`
        }
      ]
    });
  }

  const validate = ajv.compile(schemaDocument.document);
  const valid = validate(specDocument);
  if (!valid) {
    const issues = (validate.errors || []).map((error: unknown) => translateAjvIssue(error));
    return createFailure({
      code: 'ATM_SPEC_PARSE_INVALID',
      specPath,
      schemaPath,
      summary: `Atomic spec validation failed with ${issues.length} issue(s).`,
      issues
    });
  }

  const normalizedSpecDocument = asAtomicSpecDocument(specDocument);
  return {
    ok: true,
    specPath: specPath ? toPortablePath(specPath) : null,
    schemaPath: toPortablePath(schemaPath),
    normalizedModel: normalizeAtomicSpecModel(normalizedSpecDocument, { specPath: specPath ?? undefined, schemaPath }),
    promptReport: {
      code: 'ATM_SPEC_PARSE_OK',
      summary: `Atomic spec ${normalizedSpecDocument.id} parsed successfully.`,
      issues: []
    }
  };
}

export function normalizeAtomicSpecModel(specDocument: AtomicSpecDocument, options: ParseAtomicSpecOptions = {}): NormalizedAtomicSpecModel {
  const specPath = options.specPath ? toPortablePath(path.resolve(options.specPath)) : null;
  const schemaPath = toPortablePath(path.resolve(options.schemaPath ?? defaultAtomicSpecSchemaPath));
  const performanceBudget = specDocument.performanceBudget;
  const maxDurationMs = performanceBudget?.maxDurationMs;
  const normalizedMaxDurationMs = typeof maxDurationMs === 'number' && Number.isInteger(maxDurationMs)
    ? maxDurationMs
    : null;

  return {
    source: {
      specPath,
      schemaPath
    },
    schema: {
      schemaId: specDocument.schemaId,
      specVersion: specDocument.specVersion,
      migration: {
        strategy: specDocument.migration.strategy,
        fromVersion: specDocument.migration.fromVersion ?? null,
        notes: specDocument.migration.notes
      }
    },
    identity: {
      atomId: specDocument.id,
      logicalName: normalizeOptionalText(specDocument.logicalName) ?? undefined,
      title: specDocument.title,
      description: specDocument.description ?? '',
      tags: normalizeStringList(specDocument.tags ?? [])
    },
    execution: {
      language: {
        primary: specDocument.language.primary,
        sourceExtensions: normalizeStringList(specDocument.language.sourceExtensions ?? []),
        tooling: normalizeStringList(specDocument.language.tooling ?? [])
      },
      runtime: {
        kind: specDocument.runtime.kind,
        versionRange: specDocument.runtime.versionRange,
        environment: specDocument.runtime.environment
      },
      adapterRequirements: {
        projectAdapter: specDocument.adapterRequirements.projectAdapter,
        storage: specDocument.adapterRequirements.storage,
        capabilities: normalizeStringList(specDocument.adapterRequirements.capabilities ?? [])
      },
      compatibility: {
        coreVersion: specDocument.compatibility.coreVersion,
        registryVersion: specDocument.compatibility.registryVersion,
        pluginApiVersion: normalizeOptionalText(specDocument.compatibility.pluginApiVersion) ?? '',
        languageAdapter: normalizeOptionalText(specDocument.compatibility.languageAdapter) ?? '',
        lifecycleMode: normalizeOptionalText(specDocument.compatibility.lifecycleMode) ?? ''
      },
      dependencyPolicy: {
        external: specDocument.dependencyPolicy?.external ?? 'none',
        hostCoupling: specDocument.dependencyPolicy?.hostCoupling ?? 'forbidden'
      },
      validation: {
        commands: [...(specDocument.validation?.commands ?? [])],
        evidenceRequired: specDocument.validation?.evidenceRequired === true
      },
      performanceBudget: {
        hotPath: performanceBudget?.hotPath === true,
        inputMutation: performanceBudget?.inputMutation ?? 'forbidden',
        maxDurationMs: normalizedMaxDurationMs
      }
    },
    governance: {
      semanticFingerprint: normalizeSemanticFingerprint(
        specDocument.semanticFingerprint ?? runAtm(atomicSpecSemanticFingerprintAtom, specDocument)
      ),
      lineage: normalizeLineage(specDocument.lineage ?? null),
      ttl: normalizeTtl(specDocument.ttl ?? null),
      deployScope: normalizeOptionalText(specDocument.deployScope),
      mutabilityPolicy: normalizeOptionalText(specDocument.mutabilityPolicy),
      pendingSfCalculation: specDocument.pendingSfCalculation === true
    },
    hashLock: {
      algorithm: specDocument.hashLock.algorithm,
      digest: specDocument.hashLock.digest,
      canonicalization: specDocument.hashLock.canonicalization
    },
    ports: {
      inputs: normalizePorts(specDocument.inputs ?? []),
      outputs: normalizePorts(specDocument.outputs ?? [])
    }
  };
}

function readJsonDocument(filePath: string): JsonReadSuccess | JsonReadFailure {
  try {
    return {
      ok: true,
      document: JSON.parse(readFileSync(filePath, 'utf8'))
    };
  } catch (error) {
    return {
      ok: false,
      issue: {
        code: 'ATM_JSON_INVALID',
        keyword: 'json',
        path: toPortablePath(filePath),
        text: `JSON file is invalid: ${toPortablePath(filePath)}.`,
        prompt: `Fix the JSON syntax in ${toPortablePath(filePath)}. Reason: ${error instanceof Error ? error.message : String(error)}`
      }
    };
  }
}

function normalizePorts(ports: readonly AtomicSpecPortRecord[]) {
  return ports.map((port) => ({
    name: port.name,
    kind: port.kind,
    required: port.required === true
  }));
}

function normalizeLineage(lineage: AtomicSpecDocument['lineage']) {
  const record = asRecord(lineage);
  if (!record) {
    return null;
  }

  const parentRefs = Array.isArray(record.parentRefs)
    ? normalizeStringList(record.parentRefs)
    : [];

  return {
    bornBy: normalizeOptionalText(record.bornBy) ?? undefined,
    parentRefs,
    bornAt: normalizeOptionalText(record.bornAt) ?? undefined
  };
}

function normalizeTtl(ttl: AtomicSpecDocument['ttl']) {
  const record = asRecord(ttl);
  if (!record) {
    return null;
  }

  return {
    expiresAt: normalizeOptionalText(record.expiresAt)
  };
}

function normalizeOptionalText(value: unknown) {
  const text = asString(value)?.trim() ?? '';
  return text.length > 0 ? text : null;
}

function normalizeStringList(values: unknown) {
  return [...new Set(asStringArray(values))].sort();
}

function createFailure({ code, specPath, schemaPath, summary, issues }: FailureOptions): ParseAtomicSpecFailure {
  return {
    ok: false,
    specPath: specPath ? toPortablePath(specPath) : null,
    schemaPath: schemaPath ? toPortablePath(schemaPath) : null,
    normalizedModel: null,
    promptReport: {
      code,
      summary,
      issues: [...issues]
    }
  };
}

function translateAjvIssue(error: unknown): PromptIssue {
  const issue = asRecord(error);
  const instancePathValue = asString(issue?.instancePath);
  const instancePath = instancePathValue && instancePathValue.length > 0 ? instancePathValue : '/';
  const params = asRecord(issue?.params);

  if (issue?.keyword === 'required') {
    const missingProperty = asString(params?.missingProperty) ?? '[unknown]';
    const missingPath = instancePath === '/'
      ? `/${missingProperty}`
      : `${instancePath}/${missingProperty}`;
    return {
      code: 'ATM_SPEC_REQUIRED_FIELD',
      keyword: 'required',
      path: missingPath,
      text: `Atomic spec is missing required field: ${missingProperty}`,
      prompt: `Add required field "${missingProperty}" at "${instancePath}".`
    };
  }

  if (issue?.keyword === 'const') {
    const allowedValue = String(params?.allowedValue ?? '[unknown]');
    return {
      code: 'ATM_SPEC_CONST_MISMATCH',
      keyword: 'const',
      path: instancePath,
      text: `${instancePath} must be ${allowedValue}.`,
      prompt: `Set "${instancePath}" to "${allowedValue}".`
    };
  }

  if (issue?.keyword === 'enum') {
    const allowedValues = Array.isArray(params?.allowedValues)
      ? params.allowedValues.map((value) => String(value)).join(', ')
      : '';
    return {
      code: 'ATM_SPEC_ENUM_MISMATCH',
      keyword: 'enum',
      path: instancePath,
      text: `${instancePath} must be one of: ${allowedValues}.`,
      prompt: `Change "${instancePath}" to one of: ${allowedValues}.`
    };
  }

  if (issue?.keyword === 'pattern') {
    return {
      code: patternCodeFor(instancePath),
      keyword: 'pattern',
      path: instancePath,
      text: `${instancePath} does not match the required pattern.`,
      prompt: `Rewrite "${instancePath}" so it matches the required pattern.`
    };
  }

  if (issue?.keyword === 'type') {
    const typeName = String(params?.type ?? '[unknown]');
    return {
      code: 'ATM_SPEC_TYPE_MISMATCH',
      keyword: 'type',
      path: instancePath,
      text: `${instancePath} must be of type ${typeName}.`,
      prompt: `Change "${instancePath}" to type ${typeName}.`
    };
  }

  if (issue?.keyword === 'additionalProperties') {
    const additionalProperty = asString(params?.additionalProperty) ?? '[unknown]';
    const additionalPath = instancePath === '/'
      ? `/${additionalProperty}`
      : `${instancePath}/${additionalProperty}`;
    return {
      code: 'ATM_SPEC_ADDITIONAL_PROPERTY',
      keyword: 'additionalProperties',
      path: additionalPath,
      text: `${instancePath} contains unsupported property: ${additionalProperty}.`,
      prompt: `Remove unsupported property "${additionalProperty}" from "${instancePath}".`
    };
  }

  return {
    code: 'ATM_SPEC_SCHEMA_ERROR',
    keyword: asString(issue?.keyword) ?? 'schema',
    path: instancePath,
    text: `${instancePath} ${asString(issue?.message) ?? 'schema validation failed'}.`,
    prompt: `Fix the schema error at "${instancePath}": ${asString(issue?.message) ?? 'schema validation failed'}.`
  };
}

function patternCodeFor(instancePath: string) {
  if (instancePath.endsWith('/id')) {
    return 'ATM_SPEC_ID_PATTERN';
  }
  if (instancePath.endsWith('/hashLock/digest')) {
    return 'ATM_SPEC_HASH_PATTERN';
  }
  if (instancePath.endsWith('/compatibility/coreVersion') || instancePath.endsWith('/compatibility/registryVersion') || instancePath.endsWith('/compatibility/pluginApiVersion')) {
    return 'ATM_SPEC_VERSION_PATTERN';
  }
  return 'ATM_SPEC_PATTERN_MISMATCH';
}

function toPortablePath(value: string) {
  return value.replace(/\\/g, '/');
}
