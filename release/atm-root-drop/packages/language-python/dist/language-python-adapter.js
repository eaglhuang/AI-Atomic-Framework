import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
const PIPELINE_FOLDER_HINTS = ['pipelines', 'jobs', 'tasks', 'workflows', 'flows'];
export const defaultPythonLanguageAdapterManifest = {
    symbolCanonicalization: {
        policy: 'declaration-name',
        reExportAliasBehavior: 'not-supported',
        decoratorResolutionStance: 'not-supported'
    },
    notes: [
        'The Python adapter canonicalizes declared function/class/module symbols only; it does not resolve alias provenance semantically.',
        'Decorator semantics are not resolved by this adapter.'
    ]
};
export function createPythonLanguageAdapter(policyOverrides = {}) {
    const basePolicy = mergePolicy({ forbiddenSpecifiers: [] }, policyOverrides);
    return {
        adapterName: '@ai-atomic-framework/language-python',
        languageIds: ['python'],
        manifest: defaultPythonLanguageAdapterManifest,
        supportsAtomizeDryRun: true,
        supportsInfectDryRun: true,
        async detectProjectProfile(repositoryRoot) {
            return detectPythonProjectProfile(repositoryRoot);
        },
        async validateComputeAtom(request) {
            return validatePythonComputeAtom(request, detectPythonProjectProfile(process.cwd()), basePolicy);
        }
    };
}
export function detectPythonProjectProfile(repositoryRoot) {
    const hasPyprojectToml = existsSync(path.join(repositoryRoot, 'pyproject.toml'));
    const hasRequirementsTxt = existsSync(path.join(repositoryRoot, 'requirements.txt'));
    const hasSetupPy = existsSync(path.join(repositoryRoot, 'setup.py'));
    const hasSetupCfg = existsSync(path.join(repositoryRoot, 'setup.cfg'));
    const hasPipfile = existsSync(path.join(repositoryRoot, 'Pipfile'));
    const hasPoetryLock = existsSync(path.join(repositoryRoot, 'poetry.lock'));
    const packageManager = detectPackageManager(repositoryRoot, { hasPyprojectToml, hasPipfile, hasPoetryLock });
    const declaredScripts = collectDeclaredScripts(repositoryRoot, { hasPyprojectToml });
    const testCommand = pickFirstAvailableCommand([
        declaredScripts.includes('test') ? formatScriptCommand(packageManager, 'test') : null,
        hasPyprojectToml ? formatToolCommand(packageManager, 'pytest') : null,
        hasRequirementsTxt ? formatToolCommand(packageManager, 'pytest') : null
    ]);
    const typecheckCommand = pickFirstAvailableCommand([
        declaredScripts.includes('typecheck') ? formatScriptCommand(packageManager, 'typecheck') : null,
        hasPyprojectToml ? formatToolCommand(packageManager, 'mypy .') : null
    ]);
    const lintCommand = pickFirstAvailableCommand([
        declaredScripts.includes('lint') ? formatScriptCommand(packageManager, 'lint') : null,
        hasPyprojectToml ? formatToolCommand(packageManager, 'ruff check .') : null
    ]);
    return {
        packageManager,
        hasPyprojectToml,
        hasRequirementsTxt,
        hasSetupPy,
        hasSetupCfg,
        hasPipfile,
        hasPoetryLock,
        testCommand,
        typecheckCommand,
        lintCommand,
        declaredScripts
    };
}
export function validatePythonComputeAtom(request, profile = createUnknownProfile(), basePolicy = { forbiddenSpecifiers: [] }) {
    const policy = mergePolicy(basePolicy, request.importPolicy);
    const imports = request.sourceFiles.flatMap((sourceFile) => scanPythonImports(sourceFile));
    const entrypoints = request.sourceFiles.flatMap((sourceFile) => scanPythonEntrypoints(sourceFile));
    const messages = [];
    const entrypointFile = request.sourceFiles.find((sourceFile) => normalizePath(sourceFile.filePath) === normalizePath(request.entrypoint));
    if (!entrypointFile) {
        messages.push(message('error', 'ATM_PY_ENTRYPOINT_MISSING', 'Entrypoint source file was not provided.', request.entrypoint));
    }
    else if (!hasEntrypointSignature(entrypointFile.sourceText)) {
        messages.push(message('error', 'ATM_PY_ENTRYPOINT_SIGNATURE_MISSING', 'Entrypoint must declare def main(), a top-level if __name__ == "__main__" guard, or a [project.scripts] target.', entrypointFile.filePath));
    }
    for (const importRecord of imports) {
        if (policy.forbiddenSpecifiers.includes(importRecord.specifier)) {
            messages.push(message('error', 'ATM_PY_FORBIDDEN_IMPORT', `Forbidden import: ${importRecord.specifier}`, importRecord.filePath, importRecord.line));
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
export function scanPythonImports(sourceFile) {
    const records = [];
    const lines = sourceFile.sourceText.split(/\r?\n/);
    const importPattern = /^\s*import\s+([A-Za-z_][\w.]*)(?:\s+as\s+[A-Za-z_]\w*)?/;
    const fromImportPattern = /^\s*from\s+([A-Za-z_.][\w.]*)\s+import\s+/;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line)
            continue;
        const directImport = importPattern.exec(line);
        if (directImport) {
            records.push({
                filePath: sourceFile.filePath,
                specifier: directImport[1],
                statementKind: 'import',
                line: lineIndex + 1
            });
            continue;
        }
        const fromImport = fromImportPattern.exec(line);
        if (fromImport) {
            records.push({
                filePath: sourceFile.filePath,
                specifier: fromImport[1],
                statementKind: 'from-import',
                line: lineIndex + 1
            });
        }
    }
    return records;
}
export function scanPythonEntrypoints(sourceFile) {
    const records = [];
    const normalized = normalizePath(sourceFile.filePath);
    const baseName = path.basename(normalized);
    const lines = sourceFile.sourceText.split(/\r?\n/);
    const isPipelineFile = PIPELINE_FOLDER_HINTS.some((folder) => normalized.includes(`/${folder}/`));
    if (isPipelineFile) {
        records.push({
            filePath: sourceFile.filePath,
            kind: 'pipeline-script',
            line: 1
        });
    }
    if (baseName === '__main__.py') {
        records.push({
            filePath: sourceFile.filePath,
            kind: 'package-main',
            line: 1
        });
    }
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line)
            continue;
        if (/^\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:\s*$/.test(line)) {
            records.push({
                filePath: sourceFile.filePath,
                kind: 'script-main',
                line: lineIndex + 1
            });
        }
        const mainFunctionMatch = /^\s*def\s+(main)\s*\(/.exec(line);
        if (mainFunctionMatch) {
            records.push({
                filePath: sourceFile.filePath,
                kind: 'declared-script',
                line: lineIndex + 1,
                symbol: mainFunctionMatch[1]
            });
        }
    }
    return records;
}
export function planPythonAtomize(request) {
    const policy = mergePolicy({ forbiddenSpecifiers: [] }, request.importPolicy);
    const entrypoints = request.sourceFiles.flatMap((sourceFile) => scanPythonEntrypoints(sourceFile));
    const entrypointFile = request.sourceFiles.find((sourceFile) => normalizePath(sourceFile.filePath) === normalizePath(request.entrypoint));
    const messages = [];
    let entrypointKind = 'unknown';
    if (!entrypointFile) {
        messages.push(message('warning', 'ATM_PY_PLAN_ENTRYPOINT_MISSING', 'Entrypoint source not supplied; dry-run will return advisory steps only.', request.entrypoint));
    }
    else {
        const matched = entrypoints.find((entry) => normalizePath(entry.filePath) === normalizePath(request.entrypoint));
        entrypointKind = matched?.kind ?? 'unknown';
        if (!matched) {
            messages.push(message('warning', 'ATM_PY_PLAN_NO_ENTRYPOINT_SIGNATURE', 'Entrypoint file has no detectable Python entrypoint signature; consider adding def main() or an __name__ == "__main__" guard before apply.', entrypointFile.filePath));
        }
    }
    const imports = entrypointFile ? scanPythonImports(entrypointFile) : [];
    for (const importRecord of imports) {
        if (policy.forbiddenSpecifiers.includes(importRecord.specifier)) {
            messages.push(message('error', 'ATM_PY_PLAN_FORBIDDEN_IMPORT', `Forbidden import in entrypoint: ${importRecord.specifier}`, importRecord.filePath, importRecord.line));
        }
    }
    const steps = [
        {
            stepKind: 'extract-unit',
            description: `Extract a pure Python unit from ${request.entrypoint} into atomic_workbench/atoms/${request.atomId}.`,
            filePath: request.entrypoint
        },
        {
            stepKind: 'wire-host-shim',
            description: 'Add a host shim re-exporting the extracted unit so the legacy entrypoint stays callable.',
            filePath: request.entrypoint
        },
        {
            stepKind: 'evidence-required',
            description: 'Produce pytest evidence and import-graph evidence before promoting the dry-run to apply.'
        }
    ];
    return {
        atomId: request.atomId,
        executionMode: 'dry-run',
        entrypoint: request.entrypoint,
        entrypointKind,
        steps,
        mutates: [],
        evidenceRequired: ['pytest-report', 'python-import-graph'],
        messages
    };
}
const confidenceRank = { high: 3, medium: 2, low: 1 };
export function discoverPythonAtomCandidates(request) {
    const candidates = [];
    for (const sourceFile of request.sourceFiles) {
        const filePath = normalizePath(sourceFile.filePath);
        const lines = sourceFile.sourceText.split(/\r?\n/);
        const topLevelStarts = [];
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            if (/^\S/.test(lines[lineIndex])) {
                topLevelStarts.push(lineIndex);
            }
        }
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
            const line = lines[lineIndex];
            if (!line || !/^\S/.test(line))
                continue;
            const functionMatch = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(line);
            if (functionMatch) {
                candidates.push(createPythonCandidate({
                    kind: 'function',
                    symbol: functionMatch[1],
                    filePath,
                    lineStart: lineIndex + 1,
                    lineEnd: findBlockEnd(lines, lineIndex, topLevelStarts),
                    confidence: 'high'
                }));
                continue;
            }
            const classMatch = /^class\s+([A-Za-z_]\w*)\s*[(:]/.exec(line);
            if (classMatch) {
                candidates.push(createPythonCandidate({
                    kind: 'class',
                    symbol: classMatch[1],
                    filePath,
                    lineStart: lineIndex + 1,
                    lineEnd: findBlockEnd(lines, lineIndex, topLevelStarts),
                    confidence: 'high'
                }));
                continue;
            }
            if (/^if\s+__name__\s*==\s*['"]__main__['"]\s*:\s*$/.test(line)) {
                candidates.push(createPythonCandidate({
                    kind: 'command',
                    symbol: '__main__',
                    filePath,
                    lineStart: lineIndex + 1,
                    lineEnd: findBlockEnd(lines, lineIndex, topLevelStarts),
                    confidence: 'high'
                }));
            }
        }
        const moduleSymbol = path.basename(filePath).replace(/\.py$/i, '');
        candidates.push(createPythonCandidate({
            kind: 'module',
            symbol: moduleSymbol,
            filePath,
            lineStart: 1,
            lineEnd: lines.length,
            confidence: 'medium'
        }));
    }
    return applyCandidateFilters(candidates, request);
}
export function planPythonAtomizeFromCandidate(request) {
    const legacyPlan = planPythonAtomize({
        atomId: request.atomId,
        entrypoint: request.target.filePath,
        sourceFiles: request.sourceFiles.map((sourceFile) => ({
            filePath: sourceFile.filePath,
            sourceText: sourceFile.sourceText
        }))
    });
    const steps = legacyPlan.steps.map((step) => {
        const planStep = step.filePath
            ? { stepKind: step.stepKind, description: step.description, patchHint: step.filePath }
            : { stepKind: step.stepKind, description: step.description };
        return planStep;
    });
    const patchFiles = [...new Set([
            normalizePath(request.target.filePath),
            `atomic_workbench/atoms/${request.atomId}`
        ])];
    return {
        atomId: legacyPlan.atomId,
        dryRun: true,
        target: request.target,
        patchFiles,
        steps,
        evidenceRequired: legacyPlan.evidenceRequired,
        rollbackNotes: 'Dry-run plan produced no mutations; discard the plan output to roll back.',
        messages: legacyPlan.messages
    };
}
export function createPythonAtomizationPlanningAdapter() {
    return {
        discoverAtomCandidates(request) {
            return discoverPythonAtomCandidates(request);
        },
        planAtomize(request) {
            return planPythonAtomizeFromCandidate(request);
        }
    };
}
function createPythonCandidate(input) {
    const contract = `${input.kind}|${input.symbol}|${input.filePath}`;
    const shortHash = createHash('sha256').update(contract).digest('hex').slice(0, 8);
    return {
        candidateId: `py:${input.kind}:${input.symbol}:${shortHash}`,
        kind: input.kind,
        symbol: input.symbol,
        filePath: input.filePath,
        lineStart: input.lineStart,
        lineEnd: input.lineEnd,
        confidence: input.confidence,
        detectionMethod: 'scanner',
        suggestedAtomId: `ATM-PY-${shortHash}`,
        suggestedSourcePaths: [input.filePath]
    };
}
function findBlockEnd(lines, startIndex, topLevelStarts) {
    const nextTopLevel = topLevelStarts.find((candidate) => candidate > startIndex);
    let endIndex = (nextTopLevel ?? lines.length) - 1;
    while (endIndex > startIndex && lines[endIndex].trim().length === 0) {
        endIndex -= 1;
    }
    return endIndex + 1;
}
function applyCandidateFilters(candidates, request) {
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
export function createPythonCommandRunnerContract(profile) {
    const commands = [];
    if (profile.testCommand) {
        commands.push({ commandKind: 'test', command: profile.testCommand, required: true });
    }
    if (profile.typecheckCommand) {
        commands.push({ commandKind: 'typecheck', command: profile.typecheckCommand, required: false });
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
function collectDeclaredScripts(repositoryRoot, hints) {
    if (!hints.hasPyprojectToml)
        return [];
    try {
        const source = readFileSync(path.join(repositoryRoot, 'pyproject.toml'), 'utf8');
        const scriptsSection = /\[project\.scripts\]([\s\S]*?)(?:\n\[|$)/.exec(source);
        if (!scriptsSection)
            return [];
        const lines = scriptsSection[1].split(/\r?\n/);
        const scripts = [];
        for (const line of lines) {
            const match = /^\s*([A-Za-z_][\w-]*)\s*=/.exec(line);
            if (match) {
                scripts.push(match[1]);
            }
        }
        return scripts.sort();
    }
    catch {
        return [];
    }
}
function detectPackageManager(repositoryRoot, hints) {
    if (hints.hasPoetryLock)
        return 'poetry';
    if (hints.hasPipfile)
        return 'pipenv';
    if (existsSync(path.join(repositoryRoot, 'uv.lock')))
        return 'uv';
    if (hints.hasPyprojectToml) {
        const pyproject = safeRead(path.join(repositoryRoot, 'pyproject.toml'));
        if (pyproject.includes('[tool.poetry'))
            return 'poetry';
        if (pyproject.includes('[tool.hatch'))
            return 'hatch';
        if (pyproject.includes('[tool.uv'))
            return 'uv';
        return 'pip';
    }
    if (existsSync(path.join(repositoryRoot, 'requirements.txt')))
        return 'pip';
    return 'unknown';
}
function formatScriptCommand(packageManager, scriptName) {
    if (packageManager === 'poetry')
        return `poetry run ${scriptName}`;
    if (packageManager === 'pipenv')
        return `pipenv run ${scriptName}`;
    if (packageManager === 'uv')
        return `uv run ${scriptName}`;
    if (packageManager === 'hatch')
        return `hatch run ${scriptName}`;
    return scriptName;
}
function formatToolCommand(packageManager, command) {
    if (packageManager === 'poetry')
        return `poetry run ${command}`;
    if (packageManager === 'pipenv')
        return `pipenv run ${command}`;
    if (packageManager === 'uv')
        return `uv run ${command}`;
    if (packageManager === 'hatch')
        return `hatch run ${command}`;
    return command;
}
function pickFirstAvailableCommand(candidates) {
    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate.length > 0)
            return candidate;
    }
    return null;
}
function safeRead(filePath) {
    try {
        return readFileSync(filePath, 'utf8');
    }
    catch {
        return '';
    }
}
function hasEntrypointSignature(sourceText) {
    if (/^\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:\s*$/m.test(sourceText))
        return true;
    if (/^\s*def\s+main\s*\(/m.test(sourceText))
        return true;
    return false;
}
function createUnknownProfile() {
    return {
        packageManager: 'unknown',
        hasPyprojectToml: false,
        hasRequirementsTxt: false,
        hasSetupPy: false,
        hasSetupCfg: false,
        hasPipfile: false,
        hasPoetryLock: false,
        testCommand: null,
        typecheckCommand: null,
        lintCommand: null,
        declaredScripts: []
    };
}
function message(level, code, text, filePath, line) {
    const result = { level, code, text };
    if (filePath)
        result.filePath = filePath;
    if (typeof line === 'number')
        result.line = line;
    return result;
}
function mergePolicy(base, overrides) {
    const forbidden = new Set([...base.forbiddenSpecifiers, ...(overrides?.forbiddenSpecifiers ?? [])]);
    const allowed = new Set([...(base.allowedSpecifiers ?? []), ...(overrides?.allowedSpecifiers ?? [])]);
    return Object.freeze({
        forbiddenSpecifiers: [...forbidden],
        allowedSpecifiers: [...allowed]
    });
}
function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
