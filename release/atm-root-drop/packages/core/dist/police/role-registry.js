import { runDedupPolice } from './roles/dedup.js';
import { runDemandPolice } from './roles/demand.js';
import { runQualityPolice } from './roles/quality.js';
import { runMapIntegrationPolice } from './roles/map-integration.js';
import { runAtomizationPolice } from './roles/atomization.js';
import { runDecompositionPolice } from './roles/decomposition.js';
import { runEvolutionPolice } from './roles/evolution.js';
import { runPolymorphPolice } from './roles/polymorph.js';
import { runRollbackPolice } from './roles/rollback.js';
import { runEvidenceIntegrityGate } from './roles/evidence-integrity.js';
import { runReversibilityGate } from './roles/reversibility.js';
import { runNoiseControlGate } from './roles/noise-control.js';
import { runAdopterNeutralityCheck } from './roles/adopter-neutrality.js';
export const POLICE_ROLE_REGISTRY = [
    { id: 'dedup', run: runDedupPolice },
    { id: 'demand', run: runDemandPolice },
    { id: 'quality', run: runQualityPolice },
    { id: 'map-integration', run: runMapIntegrationPolice },
    { id: 'atomization', run: runAtomizationPolice },
    { id: 'decomposition', run: runDecompositionPolice },
    { id: 'evolution', run: runEvolutionPolice },
    { id: 'polymorph', run: runPolymorphPolice },
    { id: 'rollback', run: runRollbackPolice },
    { id: 'evidence-integrity', run: runEvidenceIntegrityGate },
    { id: 'reversibility', run: runReversibilityGate },
    { id: 'noise-control', run: runNoiseControlGate },
    { id: 'adopter-neutrality', run: runAdopterNeutralityCheck }
];
export const POLICE_ROLE_IDS = POLICE_ROLE_REGISTRY.map((role) => role.id);
