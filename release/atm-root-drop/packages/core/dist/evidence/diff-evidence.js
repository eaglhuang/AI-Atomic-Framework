import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
const DEFAULT_MAX_PATCH_LINES = 50;
export function generateDiffEvidence(options) {
    const { taskId, repositoryRoot, staged, from, to } = options;
    const maxPatchLines = options.maxPatchLines ?? DEFAULT_MAX_PATCH_LINES;
    const diffRange = resolveDiffRange({ staged, from, to });
    const diffArgs = staged ? '--cached' : diffRange;
    const changedFiles = getChangedFiles(repositoryRoot, diffArgs);
    const { linesAdded, linesDeleted } = getDiffStats(repositoryRoot, diffArgs);
    const patchSummary = getPatchSummary(repositoryRoot, diffArgs, maxPatchLines);
    const { affectedAtoms, unknownFiles } = resolveAffectedAtoms(repositoryRoot, changedFiles);
    return {
        taskId,
        evidenceType: 'diff-as-evidence',
        generatedAt: new Date().toISOString(),
        diffSource: staged ? 'staged' : diffRange,
        changedFiles,
        linesAdded,
        linesDeleted,
        patchSummary,
        affectedAtoms,
        _unknownFiles: unknownFiles,
        intent: '',
        impact: '',
        testCoverage: '',
        _isValid: false
    };
}
export function validateDiffEvidence(draft) {
    const reasons = [];
    if (!draft.intent || draft.intent.trim().length < 10) {
        reasons.push('intent must be at least 10 characters');
    }
    if (!draft.impact || draft.impact.trim().length < 10) {
        reasons.push('impact must be at least 10 characters');
    }
    if (!draft.testCoverage || draft.testCoverage.trim().length < 5) {
        reasons.push('testCoverage must be at least 5 characters');
    }
    return { valid: reasons.length === 0, reasons };
}
export function mergeDiffEvidenceWithExisting(existing, fresh) {
    // Preserve human-written fields, update auto-generated diff fields
    return {
        ...fresh,
        intent: existing.intent || fresh.intent,
        impact: existing.impact || fresh.impact,
        testCoverage: existing.testCoverage || fresh.testCoverage,
        _isValid: validateDiffEvidence({
            ...fresh,
            intent: existing.intent || fresh.intent,
            impact: existing.impact || fresh.impact,
            testCoverage: existing.testCoverage || fresh.testCoverage
        }).valid
    };
}
function resolveDiffRange(opts) {
    if (opts.staged)
        return '--cached';
    if (opts.from && opts.to)
        return `${opts.from}..${opts.to}`;
    if (opts.from)
        return `${opts.from}..HEAD`;
    return 'HEAD~1..HEAD';
}
function getChangedFiles(repositoryRoot, diffArgs) {
    try {
        const output = execSync(`git diff --name-only ${diffArgs}`, {
            cwd: repositoryRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        return output ? output.split('\n').filter(Boolean) : [];
    }
    catch {
        return [];
    }
}
function getDiffStats(repositoryRoot, diffArgs) {
    try {
        const output = execSync(`git diff --numstat ${diffArgs}`, {
            cwd: repositoryRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        if (!output)
            return { linesAdded: 0, linesDeleted: 0 };
        let linesAdded = 0;
        let linesDeleted = 0;
        for (const line of output.split('\n')) {
            const parts = line.split('\t');
            if (parts.length >= 2) {
                const added = parseInt(parts[0], 10);
                const deleted = parseInt(parts[1], 10);
                if (!isNaN(added))
                    linesAdded += added;
                if (!isNaN(deleted))
                    linesDeleted += deleted;
            }
        }
        return { linesAdded, linesDeleted };
    }
    catch {
        return { linesAdded: 0, linesDeleted: 0 };
    }
}
function getPatchSummary(repositoryRoot, diffArgs, maxLines) {
    try {
        const output = execSync(`git diff --stat ${diffArgs}`, {
            cwd: repositoryRoot,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        if (!output)
            return '(no diff)';
        const lines = output.split('\n');
        if (lines.length <= maxLines)
            return output;
        return lines.slice(0, maxLines).join('\n') + `\n... (${lines.length - maxLines} more lines truncated)`;
    }
    catch {
        return '(failed to get diff summary)';
    }
}
function resolveAffectedAtoms(repositoryRoot, changedFiles) {
    const atomSourceMap = buildAtomSourceMap(repositoryRoot);
    const affectedAtoms = new Set();
    const unknownFiles = [];
    for (const file of changedFiles) {
        const absFile = path.resolve(repositoryRoot, file);
        const normFile = absFile.replace(/\\/g, '/');
        let matched = false;
        for (const [atomId, sourcePaths] of Object.entries(atomSourceMap)) {
            for (const srcPath of sourcePaths) {
                const normSrc = path.resolve(repositoryRoot, srcPath).replace(/\\/g, '/');
                if (normFile === normSrc || normFile.includes(normSrc) || normSrc.includes(normFile)) {
                    affectedAtoms.add(atomId);
                    matched = true;
                }
            }
        }
        if (!matched) {
            unknownFiles.push(file);
        }
    }
    return { affectedAtoms: [...affectedAtoms].sort(), unknownFiles };
}
function buildAtomSourceMap(repositoryRoot) {
    const map = {};
    // Source 1: atomic-registry.json
    const registryPath = path.join(repositoryRoot, 'atomic-registry.json');
    if (existsSync(registryPath)) {
        try {
            const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
            for (const [atomId, entry] of Object.entries(registry.entries ?? {})) {
                const e = entry;
                const selfVerification = e.selfVerification && typeof e.selfVerification === 'object'
                    ? e.selfVerification
                    : null;
                const sourcePaths = selfVerification?.sourcePaths && typeof selfVerification.sourcePaths === 'object'
                    ? selfVerification.sourcePaths
                    : null;
                const codePaths = Array.isArray(sourcePaths?.code)
                    ? sourcePaths.code.filter((value) => typeof value === 'string')
                    : [];
                if (codePaths.length > 0) {
                    map[atomId] = codePaths;
                }
            }
        }
        catch {
            // ignore parse errors
        }
    }
    // Source 2: atomic_workbench/maps/*/map.spec.json
    const mapsDir = path.join(repositoryRoot, 'atomic_workbench', 'maps');
    if (existsSync(mapsDir)) {
        for (const mapId of readdirSync(mapsDir)) {
            const specPath = path.join(mapsDir, mapId, 'map.spec.json');
            if (!existsSync(specPath))
                continue;
            try {
                const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
                for (const member of spec.members ?? []) {
                    const atomId = member.atomId ?? member.id;
                    const src = member.sourcePath ?? member.source ?? '';
                    if (atomId && src && !map[atomId]) {
                        map[atomId] = [src];
                    }
                }
            }
            catch {
                // ignore
            }
        }
    }
    return map;
}
