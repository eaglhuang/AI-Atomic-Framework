export type RescueInvariantId = 'INV-RESCUE-001' | 'INV-RESCUE-002' | 'INV-RESCUE-003' | 'INV-RESCUE-004' | 'INV-RESCUE-005' | 'INV-RESCUE-006' | 'INV-RESCUE-007' | 'INV-RESCUE-008' | 'INV-RESCUE-009' | 'INV-RESCUE-010';
export type RescueSeverity = 'blocker' | 'warning' | 'info';
export type RescueFindingAction = 'block-all-mutations' | 'advisory' | 'skip' | 'report-only';
export interface RescueFinding {
    policeFamily: 'rescue';
    invariantId: RescueInvariantId;
    severity: RescueSeverity;
    action: RescueFindingAction;
    affectedFile?: string;
    recoveryHint: string;
    description: string;
    skippedReason?: string;
}
export interface RescueReport {
    schemaId: 'atm.rescuePoliceReport';
    checkedAt: string;
    repositoryRoot: string;
    healthy: boolean;
    blockingFindings: RescueFinding[];
    warnings: RescueFinding[];
    skipped: RescueFinding[];
    findings: RescueFinding[];
}
export declare function runRescuePolice(repositoryRoot: string): RescueReport;
