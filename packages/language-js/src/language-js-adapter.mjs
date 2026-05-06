import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const defaultJavaScriptImportPolicy = Object.freeze({
  forbiddenSpecifiers: ['fs', 'node:fs', 'child_process', 'node:child_process'],
  allowedSpecifiers: []
});

export function createJavaScriptLanguageAdapter(policyOverrides = {}) {
  const defaultPolicy = mergePolicy(defaultJavaScriptImportPolicy, policyOverrides);
  return {
    adapterName: '@ai-atomic-framework/language-js',
    languageIds: ['javascript', 'typescript'],
    detectProjectProfile,
    scanImports,
    validateComputeAtom: (request, profile = createUnknownProfile()) => validateComputeAtom(request, profile, defaultPolicy),
    createCommandRunnerContract
  };
}

export function detectProjectProfile(repositoryRoot) {
  const packageJsonPath = path.join(repositoryRoot, 'package.json');
  const packageJson = existsSync(packageJsonPath)
    ? JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    : {};
  const scripts = packageJson.scripts || {};
  return {
    packageManager: detectPackageManager(repositoryRoot),
    testCommand: scripts.test ? createPackageManagerCommand(repositoryRoot, 'test') : null,
    typecheckCommand: scripts.typecheck ? createPackageManagerCommand(repositoryRoot, 'typecheck') : null,
    lintCommand: scripts.lint ? createPackageManagerCommand(repositoryRoot, 'lint') : null
  };
}

export function validateComputeAtom(request, profile = createUnknownProfile(), basePolicy = defaultJavaScriptImportPolicy) {
  const policy = mergePolicy(basePolicy, request.importPolicy);
  const imports = request.sourceFiles.flatMap((sourceFile) => scanImports(sourceFile));
  const messages = [];
  const entrypointFile = request.sourceFiles.find((sourceFile) => normalizePath(sourceFile.filePath) === normalizePath(request.entrypoint));

  if (!entrypointFile) {
    messages.push(createMessage('error', 'ATM_JS_ENTRYPOINT_MISSING', 'Entrypoint source file was not provided.', request.entrypoint));
  } else if (!hasEntrypointExport(entrypointFile.sourceText)) {
    messages.push(createMessage('error', 'ATM_JS_ENTRYPOINT_EXPORT_MISSING', 'Entrypoint must export a run function or a default function.', entrypointFile.filePath));
  }

  for (const importRecord of imports) {
    if (policy.forbiddenSpecifiers.includes(importRecord.specifier)) {
      messages.push(createMessage('error', 'ATM_JS_FORBIDDEN_IMPORT', `Forbidden import: ${importRecord.specifier}`, importRecord.filePath, importRecord.line));
    }
  }

  if (messages.length === 0) {
    messages.push(createMessage('info', 'ATM_JS_VALIDATE_OK', 'JavaScript/TypeScript compute atom passed adapter checks.'));
  }

  const ok = messages.every((entry) => entry.level !== 'error');
  return {
    ok,
    profile,
    imports,
    messages,
    commandRunnerContract: createCommandRunnerContract(profile),
    evidence: [
      {
        evidenceKind: 'validation',
        summary: ok
          ? `Language adapter validated compute atom ${request.atomId}.`
          : `Language adapter rejected compute atom ${request.atomId}.`,
        artifactPaths: request.sourceFiles.map((sourceFile) => sourceFile.filePath)
      }
    ]
  };
}

export function scanImports(sourceFile) {
  const records = [];
  const lines = sourceFile.sourceText.split(/\r?\n/);
  const patterns = [
    { kind: 'static-import', pattern: /\bimport\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g },
    { kind: 're-export', pattern: /\bexport\s+[^'";]*\s+from\s+['"]([^'"]+)['"]/g },
    { kind: 'dynamic-import', pattern: /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g },
    { kind: 'require', pattern: /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g }
  ];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    for (const { kind, pattern } of patterns) {
      pattern.lastIndex = 0;
      let match = pattern.exec(line);
      while (match) {
        records.push({
          filePath: sourceFile.filePath,
          specifier: match[1],
          statementKind: kind,
          line: lineIndex + 1
        });
        match = pattern.exec(line);
      }
    }
  }

  return records;
}

export function createCommandRunnerContract(profile) {
  const commands = [
    createCommand('test', profile.testCommand, true),
    createCommand('typecheck', profile.typecheckCommand, false),
    createCommand('lint', profile.lintCommand, false)
  ].filter(Boolean);

  return {
    executionMode: 'delegated',
    packageManager: profile.packageManager,
    commands
  };
}

function createPackageManagerCommand(repositoryRoot, scriptName) {
  const manager = detectPackageManager(repositoryRoot);
  if (manager === 'pnpm') {
    return `pnpm run ${scriptName}`;
  }
  if (manager === 'yarn') {
    return `yarn ${scriptName}`;
  }
  return `npm run ${scriptName}`;
}

function detectPackageManager(repositoryRoot) {
  if (existsSync(path.join(repositoryRoot, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(path.join(repositoryRoot, 'yarn.lock'))) {
    return 'yarn';
  }
  if (existsSync(path.join(repositoryRoot, 'package-lock.json'))) {
    return 'npm';
  }
  return 'unknown';
}

function hasEntrypointExport(sourceText) {
  return /\bexport\s+(?:async\s+)?function\s+run\s*\(/.test(sourceText)
    || /\bexport\s+default\s+(?:async\s+)?function\b/.test(sourceText)
    || /\bexport\s+default\s+(?:async\s+)?\(/.test(sourceText);
}

function createUnknownProfile() {
  return {
    packageManager: 'unknown',
    testCommand: null,
    typecheckCommand: null,
    lintCommand: null
  };
}

function createCommand(commandKind, command, required) {
  return command
    ? { commandKind, command, required }
    : null;
}

function createMessage(level, code, text, filePath, line) {
  const message = { level, code, text };
  if (filePath) {
    message.filePath = filePath;
  }
  if (line) {
    message.line = line;
  }
  return message;
}

function mergePolicy(...policies) {
  return Object.freeze({
    forbiddenSpecifiers: unique(policies.flatMap((policy) => policy?.forbiddenSpecifiers || [])),
    allowedSpecifiers: unique(policies.flatMap((policy) => policy?.allowedSpecifiers || []))
  });
}

function unique(values) {
  return Array.from(new Set(values));
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/');
}