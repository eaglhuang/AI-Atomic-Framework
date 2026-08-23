export {
  HARD_CAUSAL_DEPENDENCY_SEMANTICS,
  HARD_CAUSAL_FACT_IDS,
  HARD_CAUSAL_SUBSTITUTE_KINDS,
  TASK_DEPENDENCY_RELATIONS,
  TASK_DEPENDENCY_HARD_PROOF_CONTRADICTORY_CODE,
  TASK_DEPENDENCY_HARD_PROOF_INCOMPLETE_CODE,
  TASK_DEPENDENCY_RELATION_UNKNOWN_CODE,
  TASK_DEPENDENCY_UNTYPED_IN_TYPED_CARD_CODE,
  areTaskDependenciesSatisfied,
  classifyTaskDependencyEdges,
  findTaskClaimDependencyBlockers,
  validateHardCausalDependencyImport
} from './dependency-gate.ts';

export type {
  HardCausalDependencyDiagnostic,
  HardCausalDependencyImportValidation,
  HardCausalFactId,
  TaskClaimDependencyBlocker,
  TaskDependencyClassification,
  TaskDependencyEdge,
  TaskDependencyRelation,
  TaskDependencyRouteSummary
} from './dependency-gate.ts';
