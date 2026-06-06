import { computeSha256ForContent } from '../hash-lock/hash-lock.js';
export function createAtomicSpecSemanticFingerprint(input) {
    return createSemanticFingerprint({
        inputs: normalizeSpecPorts(input.inputs),
        outputs: normalizeSpecPorts(input.outputs),
        language: {
            primary: normalizeRequiredText(input.language?.primary ?? '')
        },
        validation: {
            evidenceRequired: input.validation?.evidenceRequired === true
        },
        performanceBudget: normalizePerformanceBudget(input.performanceBudget)
    });
}
export function createAtomicMapSemanticFingerprint(input) {
    return createSemanticFingerprint({
        entrypoints: normalizeMapEntrypoints(input.entrypoints),
        qualityTargets: normalizeMapQualityTargets(input.qualityTargets)
    });
}
export function normalizeSemanticFingerprint(value) {
    if (value == null || value === '') {
        return null;
    }
    const text = String(value).trim().toLowerCase();
    const hex = text
        .replace(/^sf:sha256:/, '')
        .replace(/^sha256:/, '');
    if (/^[a-f0-9]{64}$/.test(hex)) {
        return `sf:sha256:${hex}`;
    }
    throw new SemanticFingerprintError('ATM_SEMANTIC_FINGERPRINT_INVALID', 'Semantic fingerprint must be sha256-like text.', { value });
}
export function semanticFingerprintPrefix(fingerprint, length = 16) {
    const normalized = normalizeSemanticFingerprint(fingerprint);
    if (!normalized) {
        return '';
    }
    return normalized.replace(/^sf:sha256:/, '').slice(0, length);
}
function createSemanticFingerprint(payload) {
    return `sf:${computeSha256ForContent(JSON.stringify(payload))}`;
}
function normalizeSpecPorts(ports = []) {
    return [...ports]
        .map((port) => ({
        name: String(port.name).trim(),
        kind: String(port.kind).trim(),
        required: port.required === true
    }))
        .sort((left, right) => left.name.localeCompare(right.name));
}
function normalizePerformanceBudget(performanceBudget) {
    if (!performanceBudget) {
        return null;
    }
    return {
        hotPath: performanceBudget.hotPath === true,
        inputMutation: normalizeRequiredText(String(performanceBudget.inputMutation ?? 'forbidden')),
        maxDurationMs: Number.isInteger(performanceBudget.maxDurationMs)
            ? Number(performanceBudget.maxDurationMs)
            : null
    };
}
function normalizeMapEntrypoints(entrypoints = []) {
    return [...entrypoints]
        .map((entrypoint) => String(entrypoint).trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
}
function normalizeMapQualityTargets(qualityTargets = {}) {
    const normalizedEntries = Object.entries(qualityTargets)
        .map(([key, value]) => [String(key).trim(), typeof value === 'string' ? value.trim() : value])
        .filter(([key]) => key.length > 0)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    return Object.fromEntries(normalizedEntries);
}
function normalizeRequiredText(value) {
    const text = String(value ?? '').trim();
    return text.length > 0 ? text : '';
}
export class SemanticFingerprintError extends Error {
    constructor(code, message, details = {}) {
        super(message);
        this.name = 'SemanticFingerprintError';
        this.code = code;
        this.details = details;
    }
    code;
    details;
}
