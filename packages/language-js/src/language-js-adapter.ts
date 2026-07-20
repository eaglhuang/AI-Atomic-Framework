import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  AtomCandidate,
  AtomCandidateConfidence,
  AtomCandidateDiscoveryRequest,
  AtomCandidateKind,
  AtomizationPlanningAdapter
} from '@ai-atomic-framework/plugin-sdk';
import type {
  JavaScriptLanguageAdapter,
  JavaScriptLanguageAdapterManifest,
  JavaScriptImportRecord,
  JavaScriptImportPolicy,
  JavaScriptProjectProfile,
  JavaScriptSourceFile,
  JavaScriptStaticCheckPlan,
  JavaScriptValidationCommand,
  JavaScriptValidationMessage,
  JavaScriptValidationReport,
  LanguageAdapterValidationRequest,
  TestCommandRunnerContract
} from './index.ts';

export const defaultJavaScriptImportPolicy: Readonly<{ forbiddenSpecifiers: string[]; allowedSpecifiers: string[] }> = Object.freeze({
  forbiddenSpecifiers: ['fs', 'node:fs', 'child_process', 'node:child_process'],
  allowedSpecifiers: []
});

export const defaultJavaScriptLanguageAdapterManifest: JavaScriptLanguageAdapterManifest = {
  symbolCanonicalization: {
    policy: 'declaration-name',
    reExportAliasBehavior: 'syntactic-only',
    decoratorResolutionStance: 'not-supported'
  },
  notes: [
    'The JS adapter canonicalizes by declared symbol name and inspects re-export syntax, but it does not resolve alias provenance semantically.',
    'Decorator semantics are not resolved by this adapter.'
  ]
};

export function createJavaScriptLanguageAdapter(
  policyOverrides: Partial<{ forbiddenSpecifiers: string[]; allowedSpecifiers: string[] }> = {}
): JavaScriptLanguageAdapter {
  const defaultPolicy = mergePolicy(defaultJavaScriptImportPolicy, policyOverrides);
  return {
    adapterName: '@ai-atomic-framework/language-js',
    languageIds: ['javascript', 'typescript'],
    manifest: defaultJavaScriptLanguageAdapterManifest,
    detectProjectProfile,
    getFastStaticCheck: createFastJavaScriptStaticCheck,
    getDefaultStaticCheck: createDefaultJavaScriptStaticCheck,
    getAllStaticCheck: createAllJavaScriptStaticCheck,
    scanImports,
    validateComputeAtom: (
      request: LanguageAdapterValidationRequest,
      profile = createUnknownProfile()
    ) => validateComputeAtom(request, profile, defaultPolicy),
    createCommandRunnerContract,
    findSymbolAnchors: findJavaScriptSymbolAnchors
  };
}

export function detectProjectProfile(repositoryRoot: string): JavaScriptProjectProfile {
  const packageJsonPath = path.join(repositoryRoot, 'package.json');
  const packageJson = existsSync(packageJsonPath)
    ? JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      readonly scripts?: Partial<Record<'test' | 'typecheck' | 'lint', string>>;
    }
    : {};
  const scripts = packageJson.scripts ?? {};
  return {
    packageManager: detectPackageManager(repositoryRoot) as JavaScriptProjectProfile['packageManager'],
    testCommand: scripts.test ? createPackageManagerCommand(repositoryRoot, 'test') : null,
    typecheckCommand: scripts.typecheck ? createPackageManagerCommand(repositoryRoot, 'typecheck') : null,
    lintCommand: scripts.lint ? createPackageManagerCommand(repositoryRoot, 'lint') : null
  };
}

export function validateComputeAtom(
  request: LanguageAdapterValidationRequest,
  profile: JavaScriptProjectProfile = createUnknownProfile(),
  basePolicy: JavaScriptImportPolicy = defaultJavaScriptImportPolicy
): JavaScriptValidationReport {
  const policy = mergePolicy(basePolicy, request.importPolicy);
  const imports = request.sourceFiles.flatMap((sourceFile) => scanImports(sourceFile));
  const messages: JavaScriptValidationMessage[] = [];
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

const confidenceRank: Record<AtomCandidateConfidence, number> = { high: 3, medium: 2, low: 1 };

interface JsCandidatePattern {
  readonly pattern: RegExp;
  readonly kind: AtomCandidateKind;
  readonly confidence: AtomCandidateConfidence;
  readonly note: string;
}

/**
 * Line-scanner detection patterns (TASK-ASP-0002). Intentionally regex-only:
 * no AST, compiler API, or LSP dependency. Order matters — the first match
 * on a line wins, so more specific exported forms come first.
 */
const jsCandidatePatterns: readonly JsCandidatePattern[] = [
  {
    pattern: /^export\s+default\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/,
    kind: 'function',
    confidence: 'high',
    note: 'export default function'
  },
  {
    pattern: /^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/,
    kind: 'function',
    confidence: 'high',
    note: 'export function'
  },
  {
    pattern: /^export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    kind: 'class',
    confidence: 'high',
    note: 'export class'
  },
  {
    pattern: /^export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=>/,
    kind: 'function',
    confidence: 'medium',
    note: 'export const arrow function'
  },
  {
    pattern: /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*[(<]/,
    kind: 'function',
    confidence: 'low',
    note: 'top-level non-exported function'
  },
  {
    pattern: /^module\.exports\.([A-Za-z_$][\w$]*)\s*=/,
    kind: 'module',
    confidence: 'medium',
    note: 'CommonJS named export'
  },
  {
    pattern: /^exports\.([A-Za-z_$][\w$]*)\s*=/,
    kind: 'module',
    confidence: 'medium',
    note: 'CommonJS named export'
  }
];

export function discoverJavaScriptAtomCandidates(
  request: AtomCandidateDiscoveryRequest
): readonly AtomCandidate[] {
  const candidates: AtomCandidate[] = [];

  for (const sourceFile of request.sourceFiles) {
    const filePath = normalizePath(sourceFile.filePath);
    const lines = sourceFile.sourceText.split(/\r?\n/);

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      if (!line || !/^\S/.test(line)) continue;

      for (const { pattern, kind, confidence, note } of jsCandidatePatterns) {
        const match = pattern.exec(line);
        if (!match) continue;
        candidates.push(createJsCandidate({
          kind,
          symbol: match[1],
          filePath,
          lineStart: lineIndex + 1,
          lineEnd: findJsBlockEnd(lines, lineIndex),
          confidence,
          note
        }));
        break;
      }
    }
  }

  return applyJsCandidateFilters(candidates, request);
}

export function findJavaScriptSymbolAnchors(
  sourceFile: JavaScriptSourceFile,
  symbolName: string
): readonly { readonly filePath: string; readonly lineStart: number; readonly lineEnd: number }[] {
  const normalizedName = symbolName.trim();
  if (!normalizedName) return [];
  return discoverJavaScriptAtomCandidates({
    sourceFiles: [{ ...sourceFile, languageId: sourceFile.filePath.endsWith('.ts') ? 'typescript' : 'javascript' }],
    filters: { minConfidence: 'low' }
  })
    .filter((candidate): candidate is typeof candidate & { lineStart: number; lineEnd: number } =>
      candidate.symbol === normalizedName
      && typeof candidate.lineStart === 'number'
      && typeof candidate.lineEnd === 'number')
    .map((candidate) => ({
      filePath: normalizePath(candidate.filePath),
      lineStart: candidate.lineStart,
      lineEnd: candidate.lineEnd
    }));
}

/**
 * Optional SDK capability for the JS/TS adapter. `planAtomize` is
 * intentionally deferred (TASK-ASP-0004 covers the broker bridge), so it
 * throws an explicit not-implemented error instead of guessing a plan.
 */
export function createJavaScriptAtomizationPlanningAdapter(): AtomizationPlanningAdapter {
  return {
    discoverAtomCandidates(request: AtomCandidateDiscoveryRequest) {
      return discoverJavaScriptAtomCandidates(request);
    },
    planAtomize() {
      throw new Error(
        'ATM_JS_PLAN_ATOMIZE_NOT_IMPLEMENTED: the JS adapter only implements discoverAtomCandidates; planAtomize is deferred to the broker candidate-to-WriteIntent bridge (TASK-ASP-0004).'
      );
    }
  };
}

function createJsCandidate(input: {
  readonly kind: AtomCandidateKind;
  readonly symbol: string;
  readonly filePath: string;
  readonly lineStart: number;
  readonly lineEnd: number | null;
  readonly confidence: AtomCandidateConfidence;
  readonly note: string;
}): AtomCandidate {
  const contract = `${input.filePath}:${input.kind}:${input.symbol}`;
  const shortHash = createHash('sha256').update(contract).digest('hex').slice(0, 8);
  return {
    candidateId: `js:${input.kind}:${input.symbol}:${shortHash}`,
    kind: input.kind,
    symbol: input.symbol,
    filePath: input.filePath,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    confidence: input.confidence,
    detectionMethod: 'scanner',
    suggestedAtomId: `ATM-JS-${shortHash}`,
    suggestedSourcePaths: [input.filePath],
    notes: [input.note]
  };
}

/**
 * Best-effort block-end detection: balance curly braces starting from the
 * declaration line. Single-expression arrow consts without braces end on the
 * line that closes the statement (best effort: first line whose brace depth
 * returns to zero, or the declaration line itself when no brace opens).
 */
function findJsBlockEnd(lines: readonly string[], startIndex: number): number | null {
  let depth = 0;
  let sawOpeningBrace = false;
  for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
    const line = stripJsLineNoise(lines[lineIndex]);
    for (const character of line) {
      if (character === '{') {
        depth += 1;
        sawOpeningBrace = true;
      } else if (character === '}') {
        depth -= 1;
      }
    }
    if (sawOpeningBrace && depth <= 0) {
      return lineIndex + 1;
    }
    if (!sawOpeningBrace && /;\s*$/.test(line)) {
      return lineIndex + 1;
    }
  }
  return sawOpeningBrace ? null : startIndex + 1;
}

/** Remove string literals and line comments so braces inside them do not skew the balance counter. */
function stripJsLineNoise(line: string): string {
  return line
    .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''")
    .replace(/\/\/.*$/, '');
}

function applyJsCandidateFilters(
  candidates: readonly AtomCandidate[],
  request: AtomCandidateDiscoveryRequest
): readonly AtomCandidate[] {
  const filters = request.filters;
  if (!filters) return candidates;
  return candidates.filter((candidate) => {
    if (filters.kinds && !filters.kinds.includes(candidate.kind)) return false;
    if (filters.minConfidence && confidenceRank[candidate.confidence] < confidenceRank[filters.minConfidence]) {
      return false;
    }
    if (
      filters.filePathPrefixes
      && !filters.filePathPrefixes.some((prefix) => candidate.filePath.startsWith(normalizePath(prefix)))
    ) {
      return false;
    }
    return true;
  });
}

export function scanImports(sourceFile: JavaScriptSourceFile): readonly JavaScriptImportRecord[] {
  const records: JavaScriptImportRecord[] = [];
  const lines = sourceFile.sourceText.split(/\r?\n/);
  const patterns: ReadonlyArray<{ readonly kind: JavaScriptImportRecord['statementKind']; readonly pattern: RegExp }> = [
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

export function createCommandRunnerContract(profile: JavaScriptProjectProfile): TestCommandRunnerContract {
  const commands = [
    createCommand('test', profile.testCommand, true),
    createCommand('typecheck', profile.typecheckCommand, false),
    createCommand('lint', profile.lintCommand, false)
  ].filter(Boolean) as { commandKind: 'test' | 'typecheck' | 'lint'; command: string; required: boolean }[];

  return {
    executionMode: 'delegated',
    packageManager: profile.packageManager,
    commands
  };
}

export function createFastJavaScriptStaticCheck(profile: JavaScriptProjectProfile): JavaScriptStaticCheckPlan {
  const commands = profile.typecheckCommand
    ? [profile.typecheckCommand]
    : profile.lintCommand
      ? [profile.lintCommand]
      : [];
  return createStaticCheckPlan('fast', commands, commands.length > 0
    ? {
      source: profile.typecheckCommand ? 'declared-script' : 'declared-script',
      kinds: profile.typecheckCommand ? ['syntax', 'imports', 'typecheck'] : ['syntax', 'imports', 'lint'],
      guidance: profile.typecheckCommand
        ? 'Run the fastest JS/TS static gate first: typecheck catches syntax, import, and type drift quickly.'
        : 'Run lint as the fastest available JS/TS static gate because no typecheck command is declared.'
    }
    : {
      source: 'unavailable',
      kinds: [],
      guidance: 'No JS/TS fast static command is declared yet. Add typecheck or lint so ATM can gate touched-scope static hygiene early.'
    });
}

export function createDefaultJavaScriptStaticCheck(profile: JavaScriptProjectProfile): JavaScriptStaticCheckPlan {
  const commands = unique([profile.typecheckCommand, profile.lintCommand].filter(Boolean) as string[]);
  return createStaticCheckPlan('default', commands, commands.length > 0
    ? {
      source: 'adapter-composed',
      kinds: ['syntax', 'imports', 'typecheck', 'lint'],
      guidance: 'Default JS/TS static pass should cover both typecheck and lint before moving to heavier validation.'
    }
    : {
      source: 'unavailable',
      kinds: [],
      guidance: 'No JS/TS default static commands are declared yet. Add typecheck and lint scripts so ATM can offer a normal static path.'
    });
}

export function createAllJavaScriptStaticCheck(profile: JavaScriptProjectProfile): JavaScriptStaticCheckPlan {
  const commands = unique([profile.typecheckCommand, profile.lintCommand].filter(Boolean) as string[]);
  return createStaticCheckPlan('all', commands, commands.length > 0
    ? {
      source: 'adapter-composed',
      kinds: ['syntax', 'imports', 'typecheck', 'lint'],
      guidance: 'JS/TS all-static currently runs the full declared static set. Keep test/build in later validation lanes, not in the static contract.'
    }
    : {
      source: 'unavailable',
      kinds: [],
      guidance: 'No JS/TS all-static commands are declared yet. Add static scripts before expecting adapter-aware governance hints.'
    });
}

function createPackageManagerCommand(repositoryRoot: string, scriptName: string) {
  const manager = detectPackageManager(repositoryRoot);
  if (manager === 'pnpm') {
    return `pnpm run ${scriptName}`;
  }
  if (manager === 'yarn') {
    return `yarn ${scriptName}`;
  }
  return `npm run ${scriptName}`;
}

function detectPackageManager(repositoryRoot: string): JavaScriptProjectProfile['packageManager'] {
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

function hasEntrypointExport(sourceText: string) {
  return /\bexport\s+(?:async\s+)?function\s+run\s*\(/.test(sourceText)
    || /\bexport\s+default\s+(?:async\s+)?function\b/.test(sourceText)
    || /\bexport\s+default\s+(?:async\s+)?\(/.test(sourceText);
}

function createUnknownProfile(): JavaScriptProjectProfile {
  return {
    packageManager: 'unknown',
    testCommand: null,
    typecheckCommand: null,
    lintCommand: null
  };
}

function createStaticCheckPlan(
  tier: JavaScriptStaticCheckPlan['tier'],
  commands: readonly string[],
  input: {
    readonly source: JavaScriptStaticCheckPlan['source'];
    readonly kinds: JavaScriptStaticCheckPlan['kinds'];
    readonly guidance: string;
  }
): JavaScriptStaticCheckPlan {
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

function createCommand(
  commandKind: JavaScriptValidationCommand['commandKind'],
  command: string | null,
  required: boolean
): JavaScriptValidationCommand | null {
  return command
    ? { commandKind, command, required }
    : null;
}

function createMessage(
  level: JavaScriptValidationMessage['level'],
  code: string,
  text: string,
  filePath?: string,
  line?: number
): JavaScriptValidationMessage {
  const message: JavaScriptValidationMessage = { level, code, text };
  if (filePath) {
    (message as JavaScriptValidationMessage & { filePath?: string }).filePath = filePath;
  }
  if (typeof line === 'number') {
    (message as JavaScriptValidationMessage & { line?: number }).line = line;
  }
  return message;
}

function mergePolicy(
  ...policies: ReadonlyArray<Partial<JavaScriptImportPolicy> | undefined>
): Readonly<{ forbiddenSpecifiers: string[]; allowedSpecifiers: string[] }> {
  return Object.freeze({
    forbiddenSpecifiers: unique(policies.flatMap((policy) => policy?.forbiddenSpecifiers || [])),
    allowedSpecifiers: unique(policies.flatMap((policy) => policy?.allowedSpecifiers || []))
  });
}

function unique(values: readonly string[] | undefined): string[] {
  return Array.from(new Set((values ?? []).map((value) => String(value))));
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/');
}
