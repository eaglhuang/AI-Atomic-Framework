export {
  runTasks,
  runTasksClose,
  runTasksImport,
  runTasksVerify,
  runTasksClaimLifecycle,
  recordStaleRunnerOverride,
  isCliErrorWithCode,
  recordFailedEmergencyUseAttempt,
  loadTaskDocumentOrThrow,
  buildResidueDiagnosisEvidence,
  prepareTaskForClaim,
  readDeferredForeignStagedFilesForActiveCloseWindow,
  evaluateFrameworkDeliveryWindow,
  evaluateTaskDeliverableGate,
  taskDeliveryPrincipleText,
  loadHistoricalBatchCloseSlice,
  extractTaskCloseDeclaredFiles,
  extractTaskDeliverableFiles,
  assertLocalTaskLedgerEnabled,
  writeTaskDocumentWithTransition,
  stageTaskCloseArtifacts,
  existingTaskCloseArtifacts,
  createClosureTransitionMetadata,
  inspectTaskVerifyStatus,
  inspectTaskSourceTrace,
  classifyResetOpenImportForOptions,
  parseImportOptions,
  parseVerifyOptions,
  uniqueStrings,
  parseSingleCardFromPlugin,
  runTasksRosterUpdate,
  generateTaskCard
  ,
  collectActiveClaimImportSkips,
  enrichParsedTasksFromSiblingTaskCards,
  findTaskClaimDependencyBlockers,
  validStatuses
} from './tasks/legacy-impl.ts';

export {
  parsePlanMarkdown,
  detectPlanHeadings
} from '../../../atm-markdown-task-source/src/task-card-parser.ts';

export {
  writeTaskFiles,
  writeImportEvidence
} from './tasks/task-card-writer.ts';

export type {
  TaskClaimPreparationStep,
  TaskClaimPreparationResult
} from './tasks/claim-preparation.ts';

export type {
  TaskClaimDependencyBlocker
} from './tasks/dependency-gates.ts';

export type {
  TaskResidueBucket,
  TaskResidueClassification
} from './tasks/residue-diagnostics.ts';

export type {
  TaskImportSource,
  TaskCardImportDiagnostic,
  TaskImportRecord,
  TaskImportStatus,
  TaskImportManifest,
  TaskDeliverableGateReport,
  TaskImportDiagnostic,
  TaskVerifyReport,
  TaskLegacyLedgerMigrationReport,
  TaskLegacyLedgerMigrationEntry,
  TaskLegacyLedgerMigrationSkip,
  HistoricalBatchCloseSlice,
  EmergencyUseEvidence
  ,
  ParsedPlanResult
} from './tasks/legacy-impl.ts';

export {
  parseReconcileOptions,
  parseDeliverAndCloseOptions,
  parseCreateOptions,
  parseMirrorOptions,
  parseCloseOptions,
  parseStatusOptions,
  parseFinalizeDiagnoseOptions,
  parseResetOptions,
  parseLockCleanupOptions,
  parseClaimLifecycleOptions,
  parseHistoricalDeliveryRefs,
  parseScopeAddOptions,
  parseScopeRepairOptions,
  parseQueueOptions,
  parseAuditOptions,
  parseLegacyLedgerMigrationOptions,
  parseAllowStaleRunnerFlag
} from './tasks/task-option-parsers.ts';

export {
  safeTaskFileReadDir,
  safeTaskFileStat,
  readJsonRecord,
  taskPathFor,
  collectTaskFileValues,
  normalizeRelativePath,
  legacyTaskRequiresBaseline
} from './tasks/task-file-io-helpers.ts';
