import path from 'node:path';
import { makeResult, message, readJsonFile, relativePathFrom } from './shared.mjs';
import { defaultAtomicSpecSchemaPath, parseAtomicSpecFile } from '../../../core/src/spec/parse-spec.mjs';

const atomicSpecSchemaPath = defaultAtomicSpecSchemaPath;

export function validateAtomicSpecFileAgainstSchema(cwd, specOption, options = {}) {
  const commandName = options.commandName ?? 'validate';
  const successCode = options.successCode ?? 'ATM_VALIDATE_SPEC_OK';
  const successText = options.successText ?? 'Atomic spec validated against JSON Schema.';
  const specPath = path.resolve(cwd, specOption);
  const relativeSpecPath = relativePathFrom(cwd, specPath);
  const parsed = parseAtomicSpecFile(specOption, { cwd, schemaPath: atomicSpecSchemaPath });
  const messages = parsed.ok
    ? [message('info', successCode, successText)]
    : (parsed.promptReport.issues.length > 0
        ? parsed.promptReport.issues.map((issue) => message('error', issue.code, issue.text, { path: issue.path, prompt: issue.prompt }))
        : [message('error', parsed.promptReport.code, parsed.promptReport.summary)]);

  return makeResult({
    ok: parsed.ok === true,
    command: commandName,
    cwd,
    messages,
    evidence: {
      specPath: relativeSpecPath,
      schemaPath: relativePathFrom(cwd, atomicSpecSchemaPath),
      schemaId: parsed.ok ? parsed.normalizedModel.schema.schemaId : null,
      specVersion: parsed.ok ? parsed.normalizedModel.schema.specVersion : null,
      atomId: parsed.ok ? parsed.normalizedModel.identity.atomId : null,
      validated: parsed.ok ? [relativeSpecPath] : []
    }
  });
}
