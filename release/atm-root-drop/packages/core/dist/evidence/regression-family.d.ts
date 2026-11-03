export declare const CAUSAL_REGRESSION_FAMILY_SCHEMA_ID: "atm.causalRegressionFamily.v1";
export declare const REGRESSION_FAMILY_REVISION_SCHEMA_ID: "atm.regressionFamilyRevision.v1";
export declare const REGRESSION_FAMILY_CATALOG_SCHEMA_ID: "atm.regressionFamilyCatalogProjection.v1";
export declare const REGRESSION_FAMILY_SELECTION_SCHEMA_ID: "atm.regressionFamilySelection.v1";
export type RegressionFamilyStatus = 'proven' | 'blocked' | 'contradictory';
export interface RegressionFamily {
    readonly familyId: string;
    readonly fingerprint: string;
    readonly rootMechanism: string;
    readonly causalNeighborhood: readonly string[];
    readonly factorConstraints: readonly string[];
    readonly generatedCaseIds: readonly string[];
    readonly requiredCaseIds: readonly string[];
    readonly sourceIncidentRefs: readonly string[];
    readonly confidence: number;
    readonly parentRevision: string | null;
    readonly impactSignals: readonly string[];
    readonly digest: string;
}
export interface RegressionFamilyRevision {
    readonly schemaId: typeof REGRESSION_FAMILY_REVISION_SCHEMA_ID;
    readonly revisionId: string;
    readonly parentRevision: string | null;
    readonly family: RegressionFamily;
    readonly recurrence: boolean;
    readonly lineage: readonly string[];
    readonly observedIncidentRef: string;
    readonly digest: string;
}
export interface ObserveRegressionFamilyInput {
    readonly incidentRef: string;
    readonly fingerprint: string;
    readonly rootMechanism: string;
    readonly causalNeighborhood: readonly string[];
    readonly factorConstraints: readonly string[];
    readonly generatedCaseIds: readonly string[];
    readonly requiredCaseIds: readonly string[];
    readonly confidence: number;
    readonly impactSignals?: readonly string[];
    readonly existingRevisions?: readonly RegressionFamilyRevision[];
}
export interface RegressionFamilyRevisionResult {
    readonly schemaId: typeof REGRESSION_FAMILY_REVISION_SCHEMA_ID;
    readonly status: RegressionFamilyStatus;
    readonly revision: RegressionFamilyRevision | null;
    readonly revisions: readonly RegressionFamilyRevision[];
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly resultDigest: string;
}
export interface RegressionImpactCone {
    readonly publicSeams: readonly string[];
    readonly causalImpactEdges: readonly string[];
    readonly changedFiles: readonly string[];
    readonly validatorReferences: readonly string[];
    readonly testCaseIds: readonly string[];
}
export interface SelectRegressionFamiliesInput {
    readonly families?: readonly RegressionFamily[];
    readonly impactCone: RegressionImpactCone;
    readonly knownFamilyIds?: readonly string[];
    readonly mappingConflicts?: readonly string[];
}
export interface RegressionFamilySelectionResult {
    readonly schemaId: typeof REGRESSION_FAMILY_SELECTION_SCHEMA_ID;
    readonly status: RegressionFamilyStatus;
    readonly selectedFamilyIds: readonly string[];
    readonly omitted: readonly {
        readonly familyId: string;
        readonly reasonCode: string;
    }[];
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly selectionDigest: string;
}
export interface RegressionFamilyCatalogProjection {
    readonly schemaId: typeof REGRESSION_FAMILY_CATALOG_SCHEMA_ID;
    readonly status: RegressionFamilyStatus;
    readonly families: readonly RegressionFamily[];
    readonly revisions: readonly RegressionFamilyRevision[];
    readonly selection: RegressionFamilySelectionResult;
    readonly familyRevisionDigest: string;
    readonly selectionDigest: string;
    readonly diagnostics: readonly string[];
    readonly resultDigest: string;
}
export declare function observeRegressionFamily(input: ObserveRegressionFamilyInput): RegressionFamilyRevisionResult;
export declare function selectRegressionFamilies(input: SelectRegressionFamiliesInput): RegressionFamilySelectionResult;
export declare function projectRegressionFamilyCatalog(input: {
    readonly revisions: readonly RegressionFamilyRevision[];
    readonly selection: SelectRegressionFamiliesInput;
}): RegressionFamilyCatalogProjection;
export declare function replayRegressionFamilyRevision(result: RegressionFamilyRevisionResult): RegressionFamilyRevisionResult;
export declare function validateRegressionFamilyRevision(result: RegressionFamilyRevisionResult): {
    ok: boolean;
    diagnostics: string[];
};
