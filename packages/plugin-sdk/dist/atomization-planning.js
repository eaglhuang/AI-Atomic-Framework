const atomCandidateKinds = [
    'function',
    'class',
    'module',
    'route',
    'command',
    'schema',
    'unknown'
];
const atomCandidateConfidences = ['high', 'medium', 'low'];
const atomCandidateDetectionMethods = [
    'regex',
    'scanner',
    'compiler-api',
    'ast',
    'lsp',
    'llm-assisted'
];
const enclosingUnitKinds = [
    'function',
    'var-decl',
    'statement',
    'class-method',
    'unknown'
];
const virtualAtomDetectionMethods = ['agr-layer1', 'agr-layer2'];
const virtualAtomLayers = [1, 2];
function isNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}
function isFileRange(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    if (!isNonEmptyString(record.file))
        return false;
    if (typeof record.lineStart !== 'number' || typeof record.lineEnd !== 'number')
        return false;
    if (!Number.isFinite(record.lineStart) || !Number.isFinite(record.lineEnd))
        return false;
    if (record.lineStart < 1 || record.lineEnd < record.lineStart)
        return false;
    return true;
}
export function isEnclosingUnit(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    if (!enclosingUnitKinds.includes(record.kind))
        return false;
    if (!isNonEmptyString(record.symbol))
        return false;
    if (!isFileRange(record.fileRange))
        return false;
    if (!atomCandidateConfidences.includes(record.confidenceClass)) {
        return false;
    }
    return true;
}
export function isVirtualAtom(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    if (!enclosingUnitKinds.includes(record.kind))
        return false;
    if (!isNonEmptyString(record.symbol))
        return false;
    if (!Array.isArray(record.sourcePaths)
        || record.sourcePaths.length === 0
        || record.sourcePaths.some((entry) => !isNonEmptyString(entry))) {
        return false;
    }
    if (!virtualAtomDetectionMethods.includes(record.detectionMethod)) {
        return false;
    }
    if (!virtualAtomLayers.includes(record.layer))
        return false;
    if (!atomCandidateConfidences.includes(record.confidenceClass)) {
        return false;
    }
    if (!isNonEmptyString(record.atomCid))
        return false;
    return true;
}
/**
 * Runtime schema guard for `AtomCandidate`, usable by adapters and tests to
 * validate candidate shapes crossing plugin boundaries.
 */
export function isAtomCandidate(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    if (typeof record.candidateId !== 'string' || record.candidateId.length === 0)
        return false;
    if (!atomCandidateKinds.includes(record.kind))
        return false;
    if (typeof record.symbol !== 'string')
        return false;
    if (typeof record.filePath !== 'string' || record.filePath.length === 0)
        return false;
    if (record.lineStart !== null && typeof record.lineStart !== 'number')
        return false;
    if (record.lineEnd !== null && typeof record.lineEnd !== 'number')
        return false;
    if (!atomCandidateConfidences.includes(record.confidence))
        return false;
    if (!atomCandidateDetectionMethods.includes(record.detectionMethod)) {
        return false;
    }
    if (record.suggestedAtomId !== undefined && typeof record.suggestedAtomId !== 'string')
        return false;
    if (record.suggestedSourcePaths !== undefined
        && (!Array.isArray(record.suggestedSourcePaths)
            || record.suggestedSourcePaths.some((entry) => typeof entry !== 'string'))) {
        return false;
    }
    if (record.notes !== undefined
        && (!Array.isArray(record.notes) || record.notes.some((entry) => typeof entry !== 'string'))) {
        return false;
    }
    return true;
}
/**
 * Runtime schema guard for `AtomizationPlan` dry-run envelopes.
 */
export function isAtomizationPlan(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    if (typeof record.atomId !== 'string' || record.atomId.length === 0)
        return false;
    if (record.dryRun !== true)
        return false;
    if (!isAtomCandidate(record.target))
        return false;
    if (!Array.isArray(record.patchFiles) || record.patchFiles.some((entry) => typeof entry !== 'string')) {
        return false;
    }
    if (!Array.isArray(record.steps)
        || record.steps.some((step) => {
            if (typeof step !== 'object' || step === null)
                return true;
            const stepRecord = step;
            return typeof stepRecord.stepKind !== 'string' || typeof stepRecord.description !== 'string';
        })) {
        return false;
    }
    if (!Array.isArray(record.evidenceRequired)
        || record.evidenceRequired.some((entry) => typeof entry !== 'string')) {
        return false;
    }
    if (typeof record.rollbackNotes !== 'string')
        return false;
    if (!Array.isArray(record.messages))
        return false;
    return true;
}
