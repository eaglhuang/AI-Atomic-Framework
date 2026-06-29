import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type {
  CSharpCommandRunnerContract,
  CSharpEntrypointRecord,
  CSharpImportPolicy,
  CSharpImportRecord,
  CSharpLanguageAdapter,
  CSharpLanguageAdapterManifest,
  CSharpLanguageAdapterMessage,
  CSharpLanguageAdapterValidationReport,
  CSharpLanguageAdapterValidationRequest,
  CSharpProjectProfile,
  CSharpSourceFile,
  CSharpStaticCheckPlan,
  CSharpValidationCommand
} from './index.ts';

export const defaultCSharpLanguageAdapterManifest: CSharpLanguageAdapterManifest = {
  symbolCanonicalization: {
    policy: 'declaration-name',
    reExportAliasBehavior: 'not-supported',
    decoratorResolutionStance: 'not-supported'
  },
  notes: [
    'The C# adapter canonicalizes declared symbol names and does not resolve alias or attribute semantics semantically.',
    'Static-check plans assume dotnet-native command surfaces.'
  ]
};

export function createCSharpLanguageAdapter(
  policyOverrides: Partial<CSharpImportPolicy> = {}
): CSharpLanguageAdapter {
  const basePolicy = mergePolicy({ forbiddenSpecifiers: [] }, policyOverrides);
  return {
    adapterName: '@ai-atomic-framework/language-csharp',
    languageIds: ['csharp'],
    manifest: defaultCSharpLanguageAdapterManifest,
    detectProjectProfile: detectCSharpProjectProfile,
    getFastStaticCheck: createFastCSharpStaticCheck,
    getDefaultStaticCheck: createDefaultCSharpStaticCheck,
    getAllStaticCheck: createAllCSharpStaticCheck,
    validateComputeAtom(request: CSharpLanguageAdapterValidationRequest) {
      return validateCSharpComputeAtom(request, detectCSharpProjectProfile(process.cwd()), basePolicy);
    },
    scanImports: scanCSharpImports,
    scanEntrypoints: scanCSharpEntrypoints,
    createCommandRunnerContract: createCSharpCommandRunnerContract
  };
}

export function detectCSharpProjectProfile(repositoryRoot: string): CSharpProjectProfile {
  const hasSolutionFile = listFilesByExtension(repositoryRoot, '.sln').length > 0;
  const projectFiles = listFilesByExtension(repositoryRoot, '.csproj');
  const hasProjectFile = projectFiles.length > 0;
  const hasTestProject = projectFiles.some((filePath) => /(?:test|tests)\.csproj$/i.test(filePath));
  const packageManager: CSharpProjectProfile['packageManager'] = hasSolutionFile || hasProjectFile ? 'dotnet' : 'unknown';
  return {
    packageManager,
    hasSolutionFile,
    hasProjectFile,
    testCommand: hasTestProject ? 'dotnet test --no-build' : null,
    typecheckCommand: hasProjectFile || hasSolutionFile ? 'dotnet build --no-restore' : null,
    lintCommand: hasProjectFile || hasSolutionFile ? 'dotnet format --verify-no-changes' : null
  };
}

export function validateCSharpComputeAtom(
  request: CSharpLanguageAdapterValidationRequest,
  profile: CSharpProjectProfile = createUnknownProfile(),
  basePolicy: CSharpImportPolicy = { forbiddenSpecifiers: [] }
): CSharpLanguageAdapterValidationReport {
  const policy = mergePolicy(basePolicy, request.importPolicy);
  const imports = request.sourceFiles.flatMap((sourceFile) => scanCSharpImports(sourceFile));
  const entrypoints = request.sourceFiles.flatMap((sourceFile) => scanCSharpEntrypoints(sourceFile));
  const messages: CSharpLanguageAdapterMessage[] = [];
  const entrypointFile = request.sourceFiles.find((sourceFile) => normalizePath(sourceFile.filePath) === normalizePath(request.entrypoint));

  if (!entrypointFile) {
    messages.push(message('error', 'ATM_CS_ENTRYPOINT_MISSING', 'Entrypoint source file was not provided.', request.entrypoint));
  } else if (!entrypoints.some((entry) => normalizePath(entry.filePath) === normalizePath(request.entrypoint))) {
    messages.push(message('error', 'ATM_CS_ENTRYPOINT_SIGNATURE_MISSING', 'Entrypoint must declare a static Main method.', entrypointFile.filePath));
  }

  for (const importRecord of imports) {
    if (policy.forbiddenSpecifiers.includes(importRecord.specifier)) {
      messages.push(message('error', 'ATM_CS_FORBIDDEN_IMPORT', `Forbidden import: ${importRecord.specifier}`, importRecord.filePath, importRecord.line));
    }
  }

  if (messages.length === 0) {
    messages.push(message('info', 'ATM_CS_VALIDATE_OK', 'C# compute atom passed adapter checks.'));
  }

  const ok = messages.every((entry) => entry.level !== 'error');
  return {
    ok,
    profile,
    imports,
    entrypoints,
    messages,
    commandRunnerContract: createCSharpCommandRunnerContract(profile),
    evidence: [
      {
        evidenceKind: 'validation',
        summary: ok
          ? `C# language adapter validated compute atom ${request.atomId}.`
          : `C# language adapter rejected compute atom ${request.atomId}.`,
        artifactPaths: request.sourceFiles.map((sourceFile) => sourceFile.filePath)
      }
    ]
  };
}

export function scanCSharpImports(sourceFile: CSharpSourceFile): readonly CSharpImportRecord[] {
  const records: CSharpImportRecord[] = [];
  const lines = sourceFile.sourceText.split(/\r?\n/);
  const usingPattern = /^\s*(global\s+)?using\s+([A-Za-z_][\w.]*)\s*;/;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const match = usingPattern.exec(lines[lineIndex]);
    if (!match) continue;
    records.push({
      filePath: sourceFile.filePath,
      specifier: match[2],
      statementKind: match[1] ? 'global-using' : 'using',
      line: lineIndex + 1
    });
  }
  return records;
}

export function scanCSharpEntrypoints(sourceFile: CSharpSourceFile): readonly CSharpEntrypointRecord[] {
  const records: CSharpEntrypointRecord[] = [];
  const lines = sourceFile.sourceText.split(/\r?\n/);
  const mainPattern = /\b(?:public|private|internal|protected)?\s*static\s+(?:async\s+)?(?:void|int|Task|Task<int>)\s+Main\s*\(/;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    if (!mainPattern.test(lines[lineIndex])) continue;
    records.push({
      filePath: sourceFile.filePath,
      kind: 'static-main',
      line: lineIndex + 1,
      symbol: 'Main'
    });
  }
  return records;
}

export function createCSharpCommandRunnerContract(profile: CSharpProjectProfile): CSharpCommandRunnerContract {
  const commands: CSharpValidationCommand[] = [];
  if (profile.testCommand) {
    commands.push({ commandKind: 'test', command: profile.testCommand, required: false });
  }
  if (profile.typecheckCommand) {
    commands.push({ commandKind: 'typecheck', command: profile.typecheckCommand, required: true });
  }
  if (profile.lintCommand) {
    commands.push({ commandKind: 'lint', command: profile.lintCommand, required: false });
  }
  return {
    executionMode: 'delegated',
    packageManager: profile.packageManager,
    commands
  };
}

export function createFastCSharpStaticCheck(profile: CSharpProjectProfile): CSharpStaticCheckPlan {
  const commands = profile.typecheckCommand ? [profile.typecheckCommand] : [];
  return createStaticCheckPlan('fast', commands, commands.length > 0
    ? {
      source: 'package-manager-default',
      kinds: ['syntax', 'imports', 'typecheck', 'build'],
      guidance: 'Run dotnet build --no-restore as the fastest broad C# static gate before the next phase.'
    }
    : {
      source: 'unavailable',
      kinds: [],
      guidance: 'No C# fast static command is available yet. Add a dotnet project or solution so ATM can surface a fast static path.'
    });
}

export function createDefaultCSharpStaticCheck(profile: CSharpProjectProfile): CSharpStaticCheckPlan {
  const commands = unique([profile.typecheckCommand, profile.lintCommand].filter(Boolean) as string[]);
  return createStaticCheckPlan('default', commands, commands.length > 0
    ? {
      source: 'adapter-composed',
      kinds: ['syntax', 'imports', 'typecheck', 'build', 'format'],
      guidance: 'Default C# static pass should cover build and format verification before heavier execution tests.'
    }
    : {
      source: 'unavailable',
      kinds: [],
      guidance: 'No C# default static commands are available yet. Add dotnet build/format surfaces before relying on adapter-native guidance.'
    });
}

export function createAllCSharpStaticCheck(profile: CSharpProjectProfile): CSharpStaticCheckPlan {
  const commands = unique([profile.typecheckCommand, profile.lintCommand].filter(Boolean) as string[]);
  return createStaticCheckPlan('all', commands, commands.length > 0
    ? {
      source: 'adapter-composed',
      kinds: ['syntax', 'imports', 'typecheck', 'build', 'format'],
      guidance: 'C# all-static currently runs the full declared static set. Keep dotnet test in later validation lanes, not in the static contract.'
    }
    : {
      source: 'unavailable',
      kinds: [],
      guidance: 'No C# all-static commands are available yet. Add dotnet-native static surfaces before expecting adapter-aware governance hints.'
    });
}

function createStaticCheckPlan(
  tier: CSharpStaticCheckPlan['tier'],
  commands: readonly string[],
  input: {
    readonly source: CSharpStaticCheckPlan['source'];
    readonly kinds: CSharpStaticCheckPlan['kinds'];
    readonly guidance: string;
  }
): CSharpStaticCheckPlan {
  return {
    tier,
    commands,
    source: input.source,
    scope: 'repository',
    estimatedCost: tier === 'fast' ? 'fast' : tier === 'default' ? 'medium' : 'slow',
    kinds: input.kinds,
    guidance: input.guidance
  };
}

function mergePolicy(base: CSharpImportPolicy, overrides: Partial<CSharpImportPolicy> | undefined): CSharpImportPolicy {
  const forbidden = new Set<string>([...base.forbiddenSpecifiers, ...(overrides?.forbiddenSpecifiers ?? [])]);
  const allowed = new Set<string>([...(base.allowedSpecifiers ?? []), ...(overrides?.allowedSpecifiers ?? [])]);
  return Object.freeze({
    forbiddenSpecifiers: [...forbidden],
    allowedSpecifiers: [...allowed]
  });
}

function createUnknownProfile(): CSharpProjectProfile {
  return {
    packageManager: 'unknown',
    hasSolutionFile: false,
    hasProjectFile: false,
    testCommand: null,
    typecheckCommand: null,
    lintCommand: null
  };
}

function listFilesByExtension(repositoryRoot: string, extension: string): readonly string[] {
  const results: string[] = [];
  const stack = [repositoryRoot];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.atm') continue;
        stack.push(absolutePath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(extension.toLowerCase())) {
        results.push(absolutePath);
      }
    }
  }
  return results;
}

function message(
  level: CSharpLanguageAdapterMessage['level'],
  code: string,
  text: string,
  filePath?: string,
  line?: number
): CSharpLanguageAdapterMessage {
  const result: CSharpLanguageAdapterMessage = { level, code, text };
  if (filePath) (result as { filePath?: string }).filePath = filePath;
  if (typeof line === 'number') (result as { line?: number }).line = line;
  return result;
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
