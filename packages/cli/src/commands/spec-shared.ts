import path from 'node:path';
import { makeResult, message, readJsonFile, relativePathFrom } from './shared.ts';
import { defaultAtomicSpecSchemaPath, parseAtomicSpecFile } from '../../../core/src/spec/parse-spec.ts';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const atomicSpecSchemaPath = defaultAtomicSpecSchemaPath;
const frameworkRoot = path.resolve(path.dirname(atomicSpecSchemaPath), '..');
const supportedReportSchemas: Record<string, string> = {
  'atm.mapEquivalenceReport': 'schemas/governance/map-equivalence-report.schema.json'
};
const supportSchemaPaths = ['schemas/test-report/metrics.schema.json'];

export function validateAtomicSpecFileAgainstSchema(cwd: any, specOption: any, options: {
  commandName?: string;
  successCode?: string;
  successText?: string;
} = {}) {
  const commandName = options.commandName ?? 'validate';
  const successCode = options.successCode ?? 'ATM_VALIDATE_SPEC_OK';
  const successText = options.successText ?? 'Atomic spec validated against JSON Schema.';
  const specPath = path.resolve(cwd, specOption);
  const relativeSpecPath = relativePathFrom(cwd, specPath);
  const document = readJsonFile(specPath, 'ATM_SPEC_NOT_FOUND') as Record<string, any>;
  if (supportedReportSchemas[document?.schemaId]) {
    return validateSupportedReportAgainstSchema(document, {
      commandName,
      cwd,
      schemaRelativePath: supportedReportSchemas[document.schemaId],
      specPath,
      relativeSpecPath,
      successCode,
      successText: 'Report validated against JSON Schema.'
    });
  }

  const parsed = parseAtomicSpecFile(specOption, { cwd, schemaPath: atomicSpecSchemaPath });
  const messages = parsed.ok
    ? [message('info', successCode, successText)]
    : (parsed.promptReport.issues.length > 0
        ? parsed.promptReport.issues.map((issue: any) => message('error', issue.code, issue.text, { path: issue.path, prompt: issue.prompt }))
        : [message('error', parsed.promptReport.code, parsed.promptReport.summary)]);

  return makeResult({
    ok: parsed.ok === true,
    command: commandName,
    cwd,
    messages,
    evidence: {
      specPath: relativeSpecPath,
      schemaPath: relativePathFrom(cwd, atomicSpecSchemaPath),
      schemaId: parsed.ok ? parsed.normalizedModel!.schema.schemaId : null,
      specVersion: parsed.ok ? parsed.normalizedModel!.schema.specVersion : null,
      atomId: parsed.ok ? parsed.normalizedModel!.identity.atomId : null,
      validated: parsed.ok ? [relativeSpecPath] : []
    }
  });
}

function validateSupportedReportAgainstSchema(document: any, options: {
  commandName: string;
  cwd: string;
  schemaRelativePath: string;
  specPath: string;
  relativeSpecPath: string;
  successCode: string;
  successText: string;
}) {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  for (const supportSchemaPath of supportSchemaPaths) {
    ajv.addSchema(readJsonFile(path.join(frameworkRoot, supportSchemaPath)));
  }
  const schemaPath = path.join(frameworkRoot, options.schemaRelativePath);
  const validate = ajv.compile(readJsonFile(schemaPath));
  const report = document as Record<string, any>;
  const ok = validate(document) === true;
  const messages = ok
    ? [message('info', options.successCode, options.successText)]
    : (validate.errors || []).map((error: any) => message('error', 'ATM_SCHEMA_VALIDATION_ERROR', `${error.instancePath || '/'} ${error.message}`, {
        path: error.instancePath || '/',
        keyword: error.keyword,
        params: error.params
      }));

  return makeResult({
    ok,
    command: options.commandName,
    cwd: options.cwd,
    messages,
    evidence: {
      specPath: options.relativeSpecPath,
      schemaPath: relativePathFrom(options.cwd, schemaPath),
      schemaId: ok ? report.schemaId : null,
      specVersion: ok ? report.specVersion : null,
      atomId: null,
      mapId: ok ? report.mapId ?? null : null,
      validated: ok ? [options.relativeSpecPath] : []
    }
  });
}
