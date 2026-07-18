import type {
  PythonImportPolicy,
  PythonLanguageAdapterMessage,
  PythonLanguageAdapterValidationReport,
  PythonLanguageAdapterValidationRequest,
  PythonProjectProfile
} from '../index.ts';
import { createPythonCommandRunnerContract, createUnknownProfile } from './profile.ts';
import { scanPythonEntrypoints, scanPythonImports } from './scanner.ts';
import { hasEntrypointSignature, mergePolicy, message, normalizePath } from './shared.ts';

export function validatePythonComputeAtom(
  request: PythonLanguageAdapterValidationRequest,
  profile: PythonProjectProfile = createUnknownProfile(),
  basePolicy: PythonImportPolicy = { forbiddenSpecifiers: [] }
): PythonLanguageAdapterValidationReport {
  const policy = mergePolicy(basePolicy, request.importPolicy);
  const imports = request.sourceFiles.flatMap((sourceFile) => scanPythonImports(sourceFile));
  const entrypoints = request.sourceFiles.flatMap((sourceFile) => scanPythonEntrypoints(sourceFile));
  const messages: PythonLanguageAdapterMessage[] = [];
  const entrypointFile = request.sourceFiles.find(
    (sourceFile) => normalizePath(sourceFile.filePath) === normalizePath(request.entrypoint)
  );

  if (!entrypointFile) {
    messages.push(message('error', 'ATM_PY_ENTRYPOINT_MISSING', 'Entrypoint source file was not provided.', request.entrypoint));
  } else if (!hasEntrypointSignature(entrypointFile.sourceText)) {
    messages.push(
      message(
        'error',
        'ATM_PY_ENTRYPOINT_SIGNATURE_MISSING',
        'Entrypoint must declare def main(), a top-level if __name__ == "__main__" guard, or a [project.scripts] target.',
        entrypointFile.filePath
      )
    );
  }

  for (const importRecord of imports) {
    if (policy.forbiddenSpecifiers.includes(importRecord.specifier)) {
      messages.push(
        message('error', 'ATM_PY_FORBIDDEN_IMPORT', `Forbidden import: ${importRecord.specifier}`, importRecord.filePath, importRecord.line)
      );
    }
  }

  if (messages.length === 0) {
    messages.push(message('info', 'ATM_PY_VALIDATE_OK', 'Python compute atom passed adapter checks.'));
  }

  const ok = messages.every((entry) => entry.level !== 'error');
  return {
    ok,
    profile,
    imports,
    entrypoints,
    messages,
    commandRunnerContract: createPythonCommandRunnerContract(profile),
    evidence: [
      {
        evidenceKind: 'validation',
        summary: ok
          ? `Python language adapter validated compute atom ${request.atomId}.`
          : `Python language adapter rejected compute atom ${request.atomId}.`,
        artifactPaths: request.sourceFiles.map((sourceFile) => sourceFile.filePath)
      }
    ]
  };
}
