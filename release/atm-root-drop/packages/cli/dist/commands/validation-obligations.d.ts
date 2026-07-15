export declare const VALIDATION_OBLIGATION_MAP_SCHEMA_ID: "atm.validationObligationMap.v1";
export declare const VALIDATION_OBLIGATION_MAP_VERSION: "2026-07-14.phase1";
export interface ValidationObligationRule {
    id: string;
    description: string;
    patterns: string[];
    validators: string[];
    rationale: string;
}
export interface ValidationObligationMatch {
    ruleId: string;
    pattern: string;
    path: string;
    validators: string[];
}
export interface ValidationObligationResolution {
    schemaId: typeof VALIDATION_OBLIGATION_MAP_SCHEMA_ID;
    mappingVersion: typeof VALIDATION_OBLIGATION_MAP_VERSION;
    changedPaths: string[];
    validators: string[];
    matchedRules: ValidationObligationMatch[];
    deferred: {
        symbolLevelMinimization: {
            status: 'deferred';
            reason: string;
            requiredEvidence: string[];
        };
    };
}
export interface SealedCommitCanaryPlan {
    schemaId: 'atm.sealedCommitCanaryPlan.v1';
    mappingVersion: typeof VALIDATION_OBLIGATION_MAP_VERSION;
    commitSha: string;
    mode: 'non-blocking';
    checkout: {
        cleanCheckoutRequired: true;
        exactCommitSha: string;
    };
    validators: string[];
    command: string;
    failureIncidentSchemaId: 'atm.mappingGapIncident.v1';
}
export interface MappingGapIncident {
    schemaId: 'atm.mappingGapIncident.v1';
    mappingVersion: typeof VALIDATION_OBLIGATION_MAP_VERSION;
    commitSha: string;
    changedPaths: string[];
    expectedValidators: string[];
    failedValidators: string[];
    severity: 'advisory';
    remediation: string;
}
export declare const VALIDATION_OBLIGATION_RULES: readonly ValidationObligationRule[];
export declare function resolveValidationObligations(changedPaths: readonly string[]): ValidationObligationResolution;
export declare function createSealedCommitCanaryPlan(options: {
    commitSha: string;
    validators?: readonly string[];
}): SealedCommitCanaryPlan;
export declare function createMappingGapIncident(options: {
    commitSha: string;
    changedPaths: readonly string[];
    expectedValidators: readonly string[];
    failedValidators: readonly string[];
}): MappingGapIncident;
