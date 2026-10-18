import { readFileSync, writeFileSync } from 'node:fs';
import { createAtomicMapSemanticFingerprint } from '../registry/semantic-fingerprint.js';
export async function checkMapFingerprint(mapId, mapSpecPath) {
    const mapSpec = readMapSpec(mapSpecPath);
    if (!mapSpec.semanticFingerprint) {
        return {
            mapId,
            currentFingerprint: '',
            recordedFingerprint: '',
            driftDetected: true,
            delta: {
                reason: 'No recorded fingerprint found in map.spec.json'
            },
            checkTime: new Date().toISOString()
        };
    }
    const currentFingerprint = computeCurrentFingerprint(mapSpec);
    const recordedFingerprint = mapSpec.semanticFingerprint;
    const driftDetected = currentFingerprint !== recordedFingerprint;
    return {
        mapId,
        currentFingerprint,
        recordedFingerprint,
        driftDetected,
        delta: driftDetected
            ? {
                reason: 'Semantic fingerprint mismatch detected',
                changedFields: detectChangedFields(mapSpec)
            }
            : undefined,
        checkTime: new Date().toISOString()
    };
}
export async function recordFingerprintCheck(mapId, lineageLogPath, checkResult) {
    const lineageLog = readLineageLog(lineageLogPath);
    if (!lineageLog.transitions) {
        lineageLog.transitions = [];
    }
    const entry = {
        type: 'fingerprint-check',
        timestamp: checkResult.checkTime,
        result: checkResult
    };
    lineageLog.transitions.push(entry);
    writeFileSync(lineageLogPath, JSON.stringify(lineageLog, null, 2) + '\n');
}
function readMapSpec(mapSpecPath) {
    const content = readFileSync(mapSpecPath, 'utf-8');
    return JSON.parse(content);
}
function readLineageLog(lineageLogPath) {
    try {
        const content = readFileSync(lineageLogPath, 'utf-8');
        return JSON.parse(content);
    }
    catch {
        return {
            schemaId: 'atm.mapLineageLog',
            specVersion: '0.1.0',
            sourceMapId: '',
            canonicalMapId: '',
            transitions: []
        };
    }
}
function computeCurrentFingerprint(mapSpec) {
    return createAtomicMapSemanticFingerprint({
        entrypoints: mapSpec.entrypoints,
        qualityTargets: mapSpec.qualityTargets
    });
}
function detectChangedFields(mapSpec) {
    const changed = [];
    if (mapSpec.entrypoints) {
        changed.push('entrypoints');
    }
    if (mapSpec.qualityTargets) {
        changed.push('qualityTargets');
    }
    return changed;
}
