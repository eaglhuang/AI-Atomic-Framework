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
] as const;

export const POLICE_ROLE_IDS = POLICE_ROLE_REGISTRY.map((role) => role.id);
