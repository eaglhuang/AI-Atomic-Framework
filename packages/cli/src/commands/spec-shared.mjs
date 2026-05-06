import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeResult, message, readJsonFile, relativePathFrom } from './shared.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
const atomicSpecSchemaPath = path.join(repoRoot, 'schemas', 'atomic-spec.schema.json');
const require = createRequire(import.meta.url);

export function validateAtomicSpecFileAgainstSchema(cwd, specOption, options = {}) {
  const commandName = options.commandName ?? 'validate';
  const successCode = options.successCode ?? 'ATM_VALIDATE_SPEC_OK';
  const successText = options.successText ?? 'Atomic spec validated against JSON Schema.';
  const specPath = path.resolve(cwd, specOption);
  const relativeSpecPath = relativePathFrom(cwd, specPath);

  if (!existsSync(specPath)) {
    return makeResult({
      ok: false,
      command: commandName,
      cwd,
      messages: [message('error', 'ATM_SPEC_NOT_FOUND', 'Atomic spec file was not found.', { specPath: relativeSpecPath })],
      evidence: {
        specPath: relativeSpecPath,
        validated: []
      }
    });
  }

  if (!existsSync(atomicSpecSchemaPath)) {
    return makeResult({
      ok: false,
      command: commandName,
      cwd,
      messages: [message('error', 'ATM_SPEC_SCHEMA_NOT_FOUND', 'Atomic spec schema file was not found.', { schemaPath: relativePathFrom(cwd, atomicSpecSchemaPath) })],
      evidence: {
        specPath: relativeSpecPath,
        schemaPath: relativePathFrom(cwd, atomicSpecSchemaPath),
        validated: []
      }
    });
  }

  const spec = readJsonFile(specPath, 'ATM_SPEC_NOT_FOUND');
  const schema = JSON.parse(readFileSync(atomicSpecSchemaPath, 'utf8'));
  let ajv;
  try {
    const Ajv2020 = require('ajv/dist/2020.js');
    const addFormats = require('ajv-formats');
    const AjvConstructor = Ajv2020.default ?? Ajv2020;
    const addFormatsPlugin = addFormats.default ?? addFormats;
    ajv = new AjvConstructor({ allErrors: true, strict: false });
    addFormatsPlugin(ajv);
  } catch (error) {
    return makeResult({
      ok: false,
      command: commandName,
      cwd,
      messages: [message('error', 'ATM_SPEC_VALIDATOR_UNAVAILABLE', 'AJV validator is not available in this environment.', { reason: error instanceof Error ? error.message : String(error) })],
      evidence: {
        specPath: relativeSpecPath,
        schemaPath: relativePathFrom(cwd, atomicSpecSchemaPath),
        validated: []
      }
    });
  }

  const validate = ajv.compile(schema);
  const valid = validate(spec);
  const messages = valid
    ? [message('info', successCode, successText)]
    : (validate.errors || []).map((error) => {
        const translated = translateAjvError(error);
        return message('error', translated.code, translated.text, { path: translated.path });
      });

  return makeResult({
    ok: valid === true,
    command: commandName,
    cwd,
    messages,
    evidence: {
      specPath: relativeSpecPath,
      schemaPath: relativePathFrom(cwd, atomicSpecSchemaPath),
      schemaId: spec.schemaId,
      specVersion: spec.specVersion,
      atomId: spec.id,
      validated: valid ? [relativeSpecPath] : []
    }
  });
}

function translateAjvError(error) {
  const instancePath = error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/';

  if (error.keyword === 'required') {
    const missingPath = instancePath === '/'
      ? `/${error.params?.missingProperty}`
      : `${instancePath}/${error.params?.missingProperty}`;
    return {
      code: 'ATM_SPEC_REQUIRED_FIELD',
      path: missingPath,
      text: `Atomic spec is missing required field: ${error.params?.missingProperty}`
    };
  }

  if (error.keyword === 'const') {
    return {
      code: 'ATM_SPEC_CONST_MISMATCH',
      path: instancePath,
      text: `${instancePath} must be ${error.params?.allowedValue}.`
    };
  }

  if (error.keyword === 'enum') {
    return {
      code: 'ATM_SPEC_ENUM_MISMATCH',
      path: instancePath,
      text: `${instancePath} must be one of: ${(error.params?.allowedValues || []).join(', ')}.`
    };
  }

  if (error.keyword === 'pattern') {
    return {
      code: patternCodeFor(instancePath),
      path: instancePath,
      text: `${instancePath} does not match the required pattern.`
    };
  }

  if (error.keyword === 'type') {
    return {
      code: 'ATM_SPEC_TYPE_MISMATCH',
      path: instancePath,
      text: `${instancePath} must be of type ${error.params?.type}.`
    };
  }

  if (error.keyword === 'additionalProperties') {
    return {
      code: 'ATM_SPEC_ADDITIONAL_PROPERTY',
      path: instancePath,
      text: `${instancePath} contains unsupported property: ${error.params?.additionalProperty}.`
    };
  }

  return {
    code: 'ATM_SPEC_SCHEMA_ERROR',
    path: instancePath,
    text: `${instancePath} ${error.message}.`
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