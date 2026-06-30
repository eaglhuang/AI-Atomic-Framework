import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface AjvErrorRecord {
  readonly instancePath?: string;
  readonly message?: string;
  readonly params?: {
    readonly missingProperty?: string;
  };
}

interface SchemaValidatorOptions {
  readonly ajv?: {
    compile: (schema: unknown) => {
      (document: unknown): boolean;
      errors?: unknown[];
    };
  };
  readonly checkId?: string;
  readonly description?: string;
  readonly repositoryRoot?: string;
}

interface SchemaValidationResult {
  readonly ok: boolean;
  readonly errors: string[];
  readonly checkId?: string;
}

export function createSchemaValidator() {
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
  const ajv = new AjvConstructor({ allErrors: true, strict: false });
  addFormatsPlugin(ajv);
  return ajv;
}

export function validateJsonDocument(document: unknown, schema: unknown, options: SchemaValidatorOptions = {}) {
  const ajv = options.ajv ?? createSchemaValidator();
  const validate = ajv.compile(schema);
  const ok = validate(document) === true;
  return {
    ok,
    errors: ok ? [] : formatAjvErrors(validate.errors),
    checkId: options.checkId ?? 'schema-validator'
  };
}

export function validateJsonFile(documentPath: string, schemaPath: string, options: SchemaValidatorOptions = {}) {
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

export function createSchemaCheckResult(validations: SchemaValidationResult[], options: SchemaValidatorOptions = {}) {
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

function createFileFailure(code: string, filePath: string, message: string) {
  return {
    ok: false,
    errors: [`${message} ${toPortablePath(filePath)}`],
    code
  };
}

function formatAjvErrors(errors: unknown[] | undefined) {
  return (errors ?? []).map((error) => {
    const errorRecord = (error && typeof error === 'object' && !Array.isArray(error) ? error : {}) as AjvErrorRecord;
    const location = errorRecord.instancePath && errorRecord.instancePath.length > 0 ? errorRecord.instancePath : '/';
    const detail = errorRecord.params?.missingProperty ? ` missing ${errorRecord.params.missingProperty}` : '';
    return `${location} ${errorRecord.message ?? 'is invalid'}${detail}`;
  });
}

function toPortablePath(value: string) {
  return String(value).replace(/\\/g, '/');
}
