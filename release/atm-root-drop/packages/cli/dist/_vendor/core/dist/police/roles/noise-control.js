import { DEFAULT_POLICE_DAILY_CAP } from '../constants.js';
export function runNoiseControlGate(input = {}) {
    const dailyCap = input.dailyCap ?? DEFAULT_POLICE_DAILY_CAP;
    const confidenceThreshold = input.confidenceThreshold ?? 0;
    const suppressed = new Set(input.suppressedKeys ?? []);
    const findings = [];
    const filteredOut = [];
    let suppressedCount = 0;
    let bypassedCount = 0;
    let admitted = 0;
    for (const finding of input.findings ?? []) {
        const key = finding.metadata?.suppressionKey;
        const isHighSeverity = finding.severity === 'block' || finding.severity === 'error';
        if (typeof key === 'string' && suppressed.has(key)) {
            if (isHighSeverity) {
                bypassedCount += 1;
                findings.push(finding);
                continue;
            }
            suppressedCount += 1;
            filteredOut.push(finding);
            continue;
        }
        const confidence = Number(finding.metadata?.confidence ?? 1);
        if (Number.isFinite(confidence) && confidence < confidenceThreshold && !isHighSeverity) {
            suppressedCount += 1;
            filteredOut.push(finding);
            continue;
        }
        if (admitted >= dailyCap && !isHighSeverity) {
            suppressedCount += 1;
            filteredOut.push(finding);
            continue;
        }
        admitted += 1;
        findings.push(finding);
    }
    return {
        gate: 'noise-control',
        status: suppressedCount > 0 || bypassedCount > 0 ? 'advisory' : 'pass',
        findings,
        summary: { total: findings.length, suppressed: suppressedCount, bypassed: bypassedCount },
        sourceValidator: 'runNoiseControlGate'
    };
}
