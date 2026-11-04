export interface AtomHealthEntry {
    atomId: string;
    gitEditCount: number;
    policeViolationCount: number;
    driftDetected: boolean;
    lastModified: string | null;
    risk: 'low' | 'medium' | 'high';
}
export interface MapHealthReport {
    schemaId: 'atm.mapHealthReport';
    mapId: string;
    generatedAt: string;
    atomCount: number;
    edgeCount: number;
    atoms: AtomHealthEntry[];
    topBottlenecks: string[];
    topUnstable: string[];
}
export declare function generateMapHealthReport(repositoryRoot: string, mapId: string): MapHealthReport;
