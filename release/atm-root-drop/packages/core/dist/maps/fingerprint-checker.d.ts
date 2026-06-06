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
export declare function checkMapFingerprint(mapId: string, mapSpecPath: string): Promise<FingerprintCheckResult>;
export declare function recordFingerprintCheck(mapId: string, lineageLogPath: string, checkResult: FingerprintCheckResult): Promise<void>;
