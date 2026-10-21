export interface LineageTransition {
    timestamp: string;
    fromState: string;
    toState: string;
    triggeredBy?: string;
    evidenceRef?: string;
    [key: string]: unknown;
}
export interface LineageLog {
    schemaId: 'atm.lineageLog';
    mapId: string;
    createdAt: string;
    transitions: LineageTransition[];
}
export interface ReplayLineageResult {
    dryRun: boolean;
    backedUpTo: string | null;
    mapId: string;
    transitionsFound: number;
    transitionsWritten: number;
    outOfOrderFixed: number;
    errors: string[];
}
export declare function replayLineageFromEvidence(repositoryRoot: string, mapId: string, options?: {
    dryRun?: boolean;
    backupDir?: string;
}): ReplayLineageResult;
