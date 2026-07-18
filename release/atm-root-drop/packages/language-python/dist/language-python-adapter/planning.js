import { createHash } from 'node:crypto';
import path from 'node:path';
import { scanPythonEntrypoints, scanPythonImports } from './scanner.js';
import { mergePolicy, message, normalizePath } from './shared.js';
const confidenceRank = { high: 3, medium: 2, low: 1 };
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
