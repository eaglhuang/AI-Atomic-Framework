import { runDedupPolice } from './roles/dedup.ts';
import { runDemandPolice } from './roles/demand.ts';
import { runQualityPolice } from './roles/quality.ts';
import { runMapIntegrationPolice } from './roles/map-integration.ts';
import { runAtomizationPolice } from './roles/atomization.ts';
import { runDecompositionPolice } from './roles/decomposition.ts';
import { runEvolutionPolice } from './roles/evolution.ts';
import { runPolymorphPolice } from './roles/polymorph.ts';
import { runRollbackPolice } from './roles/rollback.ts';
import { runEvidenceIntegrityGate } from './roles/evidence-integrity.ts';
import { runReversibilityGate } from './roles/reversibility.ts';
import { runNoiseControlGate } from './roles/noise-control.ts';
import { runAdopterNeutralityCheck } from './roles/adopter-neutrality.ts';
export declare const POLICE_ROLE_REGISTRY: readonly [{
    readonly id: "dedup";
    readonly run: typeof runDedupPolice;
}, {
    readonly id: "demand";
    readonly run: typeof runDemandPolice;
}, {
    readonly id: "quality";
    readonly run: typeof runQualityPolice;
}, {
    readonly id: "map-integration";
    readonly run: typeof runMapIntegrationPolice;
}, {
    readonly id: "atomization";
    readonly run: typeof runAtomizationPolice;
}, {
    readonly id: "decomposition";
    readonly run: typeof runDecompositionPolice;
}, {
    readonly id: "evolution";
    readonly run: typeof runEvolutionPolice;
}, {
    readonly id: "polymorph";
    readonly run: typeof runPolymorphPolice;
}, {
    readonly id: "rollback";
    readonly run: typeof runRollbackPolice;
}, {
    readonly id: "evidence-integrity";
    readonly run: typeof runEvidenceIntegrityGate;
}, {
    readonly id: "reversibility";
    readonly run: typeof runReversibilityGate;
}, {
    readonly id: "noise-control";
    readonly run: typeof runNoiseControlGate;
}, {
    readonly id: "adopter-neutrality";
    readonly run: typeof runAdopterNeutralityCheck;
}];
export declare const POLICE_ROLE_IDS: ("evolution" | "rollback" | "atomization" | "reversibility" | "dedup" | "demand" | "quality" | "map-integration" | "decomposition" | "polymorph" | "evidence-integrity" | "noise-control" | "adopter-neutrality")[];
