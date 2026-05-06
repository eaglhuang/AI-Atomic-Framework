import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function createSchemaValidator() {
  const Ajv2020 = require('ajv/dist/2020.js');
  const addFormats = require('ajv-formats');
  const AjvConstructor = Ajv2020.default ?? Ajv2020;
  const addFormatsPlugin = addFormats.default ?? addFormats;
  const ajv = new AjvConstructor({ allErrors: true, strict: false });
  addFormatsPlugin(ajv);
  return ajv;
}

export function validateJsonDocument(document, schema, options = {}) {
  const ajv = options.ajv ?? createSchemaValidator();
  const validate = ajv.compile(schema);
  const ok = validate(document) === true;
  return {
    ok,
    errors: ok ? [] : formatAjvErrors(validate.errors),
    checkId: options.checkId ?? 'schema-validator'
  };
}

export function validateJsonFile(documentPath, schemaPath, options = {}) {
  const resolvedDocumentPath = path.resolve(options.repositoryRoot ?? process.cwd(), documentPath);
  const resolvedSchemaPath = path.resolve(options.repositoryRoot ?? process.cwd(), schemaPath);
  if (!existsSync(resolvedDocumentPath)) {
    return createFileFailure('ATM_SCHEMA_DOCUMENT_NOT_FOUND', resolvedDocumentPath, 'JSON document was not found.');
  }
  if (!existsSync(resolvedSchemaPath)) {
    return createFileFailure('ATM_SCHEMA_NOT_FOUND', resolvedSchemaPath, 'JSON schema was not found.');
  }
  try {
    return validateJsonDocument(
      JSON.parse(readFileSync(resolvedDocumentPath, 'utf8')),
      JSON.parse(readFileSync(resolvedSchemaPath, 'utf8')),
      options
    );
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      checkId: options.checkId ?? 'schema-validator'
    };
  }
}

export function createSchemaCheckResult(validations, options = {}) {
  const errors = validations.flatMap((validation) => validation.errors ?? []);
  return {
    checkId: options.checkId ?? 'schema-validator',
    kind: 'schema',
    required: true,
    description: options.description ?? 'Validate police documents against JSON Schema.',
    ok: errors.length === 0,
    violations: errors.map((message) => ({
      code: 'ATM_SCHEMA_INVALID',
      severity: 'error',
      message
    }))
  };
}

function createFileFailure(code, filePath, message) {
  return {
    ok: false,
    errors: [`${message} ${toPortablePath(filePath)}`],
    code
  };
}

function formatAjvErrors(errors) {
  return (errors ?? []).map((error) => {
    const location = error.instancePath && error.instancePath.length > 0 ? error.instancePath : '/';
    const detail = error.params?.missingProperty ? ` missing ${error.params.missingProperty}` : '';
    return `${location} ${error.message ?? 'is invalid'}${detail}`;
  });
}

function toPortablePath(value) {
  return String(value).replace(/\\/g, '/');
}
