import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createAtomicMapSemanticFingerprint } from '../registry/semantic-fingerprint.ts';

export interface FingerprintCheckResult {
  mapId: string;
  currentFingerprint: string;
  recordedFingerprint: string;
  driftDetected: boolean;
  delta?: {
    reason: string;
    changedFields?: string[];
  };
  checkTime: string;
}

export interface MapSpecStructure {
  mapId: string;
  entrypoints?: string[];
  qualityTargets?: Record<string, string | number | boolean>;
  semanticFingerprint?: string;
}

interface LineageLogEntry {
  type: 'fingerprint-check';
  timestamp: string;
  result: FingerprintCheckResult;
}

interface LineageLog {
  schemaId: string;
  specVersion: string;
  sourceMapId: string;
  canonicalMapId: string;
  transitions?: LineageLogEntry[];
}

export async function checkMapFingerprint(
  mapId: string,
  mapSpecPath: string
): Promise<FingerprintCheckResult> {
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

export async function recordFingerprintCheck(
  mapId: string,
  lineageLogPath: string,
  checkResult: FingerprintCheckResult
): Promise<void> {
  const lineageLog = readLineageLog(lineageLogPath);

  if (!lineageLog.transitions) {
    lineageLog.transitions = [];
  }

  const entry: LineageLogEntry = {
    type: 'fingerprint-check',
    timestamp: checkResult.checkTime,
    result: checkResult
  };

  lineageLog.transitions.push(entry);
  writeFileSync(lineageLogPath, JSON.stringify(lineageLog, null, 2) + '\n');
}

function readMapSpec(mapSpecPath: string): MapSpecStructure {
  const content = readFileSync(mapSpecPath, 'utf-8');
  return JSON.parse(content);
}

function readLineageLog(lineageLogPath: string): LineageLog {
  try {
    const content = readFileSync(lineageLogPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      schemaId: 'atm.mapLineageLog',
      specVersion: '0.1.0',
      sourceMapId: '',
      canonicalMapId: '',
      transitions: []
    };
  }
}

function computeCurrentFingerprint(mapSpec: MapSpecStructure): string {
  return createAtomicMapSemanticFingerprint({
    entrypoints: mapSpec.entrypoints,
    qualityTargets: mapSpec.qualityTargets
  });
}

function detectChangedFields(mapSpec: MapSpecStructure): string[] {
  const changed: string[] = [];

  if (mapSpec.entrypoints) {
    changed.push('entrypoints');
  }
  if (mapSpec.qualityTargets) {
    changed.push('qualityTargets');
  }

  return changed;
}
