import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export const defaultJavaScriptImportPolicy = Object.freeze({
    forbiddenSpecifiers: ['fs', 'node:fs', 'child_process', 'node:child_process'],
    allowedSpecifiers: []
});
export const defaultJavaScriptLanguageAdapterManifest = {
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
export function createJavaScriptLanguageAdapter(policyOverrides = {}) {
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
        validateComputeAtom: (request, profile = createUnknownProfile()) => validateComputeAtom(request, profile, defaultPolicy),
        createCommandRunnerContract,
        findSymbolAnchors: findJavaScriptSymbolAnchors
    };
}
export function detectProjectProfile(repositoryRoot) {
    const packageJsonPath = path.join(repositoryRoot, 'package.json');
    const packageJson = existsSync(packageJsonPath)
        ? JSON.parse(readFileSync(packageJsonPath, 'utf8'))
        : {};
    const scripts = packageJson.scripts ?? {};
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
    }
    else if (!hasEntrypointExport(entrypointFile.sourceText)) {
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
const confidenceRank = { high: 3, medium: 2, low: 1 };
/**
 * Line-scanner detection patterns (TASK-ASP-0002). Intentionally regex-only:
 * no AST, compiler API, or LSP dependency. Order matters — the first match
 * on a line wins, so more specific exported forms come first.
 */
const jsCandidatePatterns = [
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
export function discoverJavaScriptAtomCandidates(request) {
    const candidates = [];
    for (const sourceFile of request.sourceFiles) {
        const filePath = normalizePath(sourceFile.filePath);
        const lines = sourceFile.sourceText.split(/\r?\n/);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const line = lines[lineIndex];
            if (!line || !/^\S/.test(line))
                continue;
            for (const { pattern, kind, confidence, note } of jsCandidatePatterns) {
                const match = pattern.exec(line);
                if (!match)
                    continue;
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
export function findJavaScriptSymbolAnchors(sourceFile, symbolName) {
    const normalizedName = symbolName.trim();
    if (!normalizedName)
        return [];
    return discoverJavaScriptAtomCandidates({
        sourceFiles: [{ ...sourceFile, languageId: sourceFile.filePath.endsWith('.ts') ? 'typescript' : 'javascript' }],
        filters: { minConfidence: 'low' }
    })
        .filter((candidate) => candidate.symbol === normalizedName
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
export function createJavaScriptAtomizationPlanningAdapter() {
    return {
        discoverAtomCandidates(request) {
            return discoverJavaScriptAtomCandidates(request);
        },
        planAtomize() {
            throw new Error('ATM_JS_PLAN_ATOMIZE_NOT_IMPLEMENTED: the JS adapter only implements discoverAtomCandidates; planAtomize is deferred to the broker candidate-to-WriteIntent bridge (TASK-ASP-0004).');
        }
    };
}
function createJsCandidate(input) {
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
function findJsBlockEnd(lines, startIndex) {
    let depth = 0;
    let sawOpeningBrace = false;
    for (let lineIndex = startIndex; lineIndex < lines.length; lineIndex += 1) {
        const line = stripJsLineNoise(lines[lineIndex]);
        for (const character of line) {
            if (character === '{') {
                depth += 1;
                sawOpeningBrace = true;
            }
            else if (character === '}') {
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
function stripJsLineNoise(line) {
    return line
        .replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, "''")
        .replace(/\/\/.*$/, '');
}
function applyJsCandidateFilters(candidates, request) {
    const filters = request.filters;
    if (!filters)
        return candidates;
    return candidates.filter((candidate) => {
        if (filters.kinds && !filters.kinds.includes(candidate.kind))
            return false;
        if (filters.minConfidence && confidenceRank[candidate.confidence] < confidenceRank[filters.minConfidence]) {
            return false;
        }
        if (filters.filePathPrefixes
            && !filters.filePathPrefixes.some((prefix) => candidate.filePath.startsWith(normalizePath(prefix)))) {
            return false;
        }
        return true;
    });
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
export function createFastJavaScriptStaticCheck(profile) {
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
export function createDefaultJavaScriptStaticCheck(profile) {
    const commands = unique([profile.typecheckCommand, profile.lintCommand].filter(Boolean));
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
export function createAllJavaScriptStaticCheck(profile) {
    const commands = unique([profile.typecheckCommand, profile.lintCommand].filter(Boolean));
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
function createStaticCheckPlan(tier, commands, input) {
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
    if (typeof line === 'number') {
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
    return Array.from(new Set((values ?? []).map((value) => String(value))));
}
function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
