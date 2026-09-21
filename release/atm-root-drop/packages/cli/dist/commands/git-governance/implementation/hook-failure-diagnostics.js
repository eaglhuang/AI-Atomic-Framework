import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { summarizePreCommitFailureEnvelope } from '../../hook/pre-commit/failure-envelope.js';
export function createHookFailureDiagnosticReport(input) {
    const failureEnvelope = findFailureEnvelope(input.stdout) ?? findFailureEnvelope(input.stderr);
    if (!failureEnvelope)
        return null;
    const summary = summarizePreCommitFailureEnvelope(failureEnvelope);
    const reportPath = `${input.commitAttemptStatusPath}.hook-failure.json`;
    const bytes = `${JSON.stringify({
        schemaId: 'atm.governedHookFailureDiagnostic.v1',
        failureEnvelope,
        summary
    }, null, 2)}\n`;
    const absolutePath = path.join(input.cwd, reportPath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, bytes, 'utf8');
    return {
        summary,
        reference: {
            reportPath,
            reportSha256: `sha256:${createHash('sha256').update(bytes, 'utf8').digest('hex')}`
        }
    };
}
export function summarizeHookFailure(input) {
    const failureEnvelope = findFailureEnvelope(input.stdout) ?? findFailureEnvelope(input.stderr);
    return failureEnvelope ? summarizePreCommitFailureEnvelope(failureEnvelope) : null;
}
function findFailureEnvelope(text) {
    if (!text.trim())
        return null;
    try {
        return findFailureEnvelopeInValue(JSON.parse(text));
    }
    catch {
        return null;
    }
}
function findFailureEnvelopeInValue(value) {
    if (!value || typeof value !== 'object')
        return null;
    const record = value;
    if (record.schemaId === 'atm.validatorFailureEnvelope.v1' && record.ok === false) {
        return record;
    }
    if (record.failureEnvelope) {
        const explicit = findFailureEnvelopeInValue(record.failureEnvelope);
        if (explicit)
            return explicit;
    }
    for (const child of Object.values(record)) {
        const found = findFailureEnvelopeInValue(child);
        if (found)
            return found;
    }
    return null;
}
