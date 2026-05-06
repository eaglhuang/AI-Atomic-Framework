import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const require = createRequire(import.meta.url);

export const defaultAtomicSpecSchemaPath = path.join(repoRoot, 'schemas', 'atomic-spec.schema.json');

export function parseAtomicSpecFile(specOption, options = {}) {
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
    return createFailure({
      code: specDocument.issue.code,
      specPath,
      schemaPath,
      summary: specDocument.issue.text,
      issues: [specDocument.issue]
    });
  }

  return parseAtomicSpecDocument(specDocument.document, {
    ...options,
    cwd,
    specPath,
    schemaPath
  });
}

export function parseAtomicSpecDocument(specDocument, options = {}) {
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
    return createFailure({
      code: schemaDocument.issue.code,
      specPath,
      schemaPath,
      summary: schemaDocument.issue.text,
      issues: [schemaDocument.issue]
    });
  }

  let ajv;
  try {
    const Ajv2020 = require('ajv/dist/2020.js');
    const addFormats = require('ajv-formats');
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
    const issues = (validate.errors || []).map((error) => translateAjvIssue(error));
    return createFailure({
      code: 'ATM_SPEC_PARSE_INVALID',
      specPath,
      schemaPath,
      summary: `Atomic spec validation failed with ${issues.length} issue(s).`,
      issues
    });
  }

  return {
    ok: true,
    specPath: specPath ? toPortablePath(specPath) : null,
    schemaPath: toPortablePath(schemaPath),
    normalizedModel: normalizeAtomicSpecModel(specDocument, { specPath, schemaPath }),
    promptReport: {
      code: 'ATM_SPEC_PARSE_OK',
      summary: `Atomic spec ${specDocument.id} parsed successfully.`,
      issues: []
    }
  };
}

export function normalizeAtomicSpecModel(specDocument, options = {}) {
  const specPath = options.specPath ? toPortablePath(path.resolve(options.specPath)) : null;
  const schemaPath = toPortablePath(path.resolve(options.schemaPath ?? defaultAtomicSpecSchemaPath));

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
        pluginApiVersion: specDocument.compatibility.pluginApiVersion ?? null,
        languageAdapter: specDocument.compatibility.languageAdapter ?? null
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
        hotPath: specDocument.performanceBudget?.hotPath === true,
        inputMutation: specDocument.performanceBudget?.inputMutation ?? 'forbidden',
        maxDurationMs: Number.isInteger(specDocument.performanceBudget?.maxDurationMs)
          ? specDocument.performanceBudget.maxDurationMs
          : null
      }
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

function readJsonDocument(filePath) {
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

function normalizePorts(ports) {
  return ports.map((port) => ({
    name: port.name,
    kind: port.kind,
    required: port.required === true
  }));
}

function normalizeStringList(values) {
  return [...new Set(values)].sort();
}

function createFailure({ code, specPath, schemaPath, summary, issues }) {
  return {
    ok: false,
    specPath: specPath ? toPortablePath(specPath) : null,
    schemaPath: schemaPath ? toPortablePath(schemaPath) : null,
    normalizedModel: null,
    promptReport: {
      code,
      summary,
      issues
    }
  };
}

function translateAjvIssue(error) {
  const instancePath = error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/';

  if (error.keyword === 'required') {
    const missingProperty = error.params?.missingProperty;
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

  if (error.keyword === 'const') {
    return {
      code: 'ATM_SPEC_CONST_MISMATCH',
      keyword: 'const',
      path: instancePath,
      text: `${instancePath} must be ${error.params?.allowedValue}.`,
      prompt: `Set "${instancePath}" to "${error.params?.allowedValue}".`
    };
  }

  if (error.keyword === 'enum') {
    const allowedValues = (error.params?.allowedValues || []).join(', ');
    return {
      code: 'ATM_SPEC_ENUM_MISMATCH',
      keyword: 'enum',
      path: instancePath,
      text: `${instancePath} must be one of: ${allowedValues}.`,
      prompt: `Change "${instancePath}" to one of: ${allowedValues}.`
    };
  }

  if (error.keyword === 'pattern') {
    return {
      code: patternCodeFor(instancePath),
      keyword: 'pattern',
      path: instancePath,
      text: `${instancePath} does not match the required pattern.`,
      prompt: `Rewrite "${instancePath}" so it matches the required pattern.`
    };
  }

  if (error.keyword === 'type') {
    return {
      code: 'ATM_SPEC_TYPE_MISMATCH',
      keyword: 'type',
      path: instancePath,
      text: `${instancePath} must be of type ${error.params?.type}.`,
      prompt: `Change "${instancePath}" to type ${error.params?.type}.`
    };
  }

  if (error.keyword === 'additionalProperties') {
    const additionalProperty = error.params?.additionalProperty;
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
    keyword: error.keyword,
    path: instancePath,
    text: `${instancePath} ${error.message}.`,
    prompt: `Fix the schema error at "${instancePath}": ${error.message}.`
  };
}

function patternCodeFor(instancePath) {
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

function toPortablePath(value) {
  return value.replace(/\\/g, '/');
}