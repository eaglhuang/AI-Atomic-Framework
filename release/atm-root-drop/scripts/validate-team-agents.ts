import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../packages/cli/src/commands/shared.ts';
import { verifyTaskEvidence } from '../packages/cli/src/commands/evidence.ts';
import { buildBrokerConflictUxProjection, buildTeamClosureAttestation, buildTeamPlan, buildTeamReworkRouteStateMachine, buildTeamRuntimeContract, evaluateReviewQuorum, runTeam, transitionTeamReworkRoute } from '../packages/cli/src/commands/team.ts';
import { inspectTeamRuntimeBackendCapabilities } from '../packages/cli/src/commands/integration.ts';
import { buildTeamObservabilityContract, createBrokerConflictObservabilityEvents, createTeamObservabilityEvent, queryTeamObservabilityEvents } from '../packages/core/src/team-runtime/observability.ts';
import { createTempWorkspace, initializeGitRepository } from './temp-root.ts';
import { runTeamHandoffValidatorCase } from './validators/team-agents/team-handoff.ts';
import { runBrokerSharedSurfaceValidatorCase } from './validators/team-agents/broker-shared-surface.ts';
import { runLieutenantEscalationValidatorCase } from './validators/team-agents/lieutenant-escalation.ts';
import { runTeamPlanSelectionValidatorCase } from './validators/team-agents/team-plan-selection.ts';
import { runCaptureBrokerEvidenceValidatorCase } from './validators/team-agents/capture-broker-evidence.ts';
import { runMicrosoftFoundryBridgeValidatorCase } from './validators/team-agents/microsoft-foundry-bridge.ts';
import { runTeamLifecycleVerbsValidatorCase } from './validators/team-agents/team-lifecycle-verbs.ts';
import { runPatrolReportValidatorCase } from './validators/team-agents/patrol-report.ts';
import { runSandboxAttestationValidatorCase } from './validators/team-agents/sandbox-attestation.ts';
import { runOpenAIAzureOpenAIBridgesValidatorCase } from './validators/team-agents/openai-azure-openai-bridges.ts';
import { runClaudeGeminiBridgesValidatorCase } from './validators/team-agents/claude-gemini-bridges.ts';
import { runHookTeamGateValidatorCase } from './validators/team-agents/hook-team-gate.ts';
import { runPermissionLeaseValidatorCase } from './validators/team-agents/permission-lease.ts';
import { runCrossVendorObservabilityValidatorCase } from './validators/team-agents/cross-vendor-observability.ts';
import { runPerRoleProviderSelectionConfigValidatorCase } from './validators/team-agents/per-role-provider-selection-config.ts';
import { runRuntimeModeContractValidatorCase } from './validators/team-agents/runtime-mode-contract.ts';
import { runNextClaimAtomizationValidatorCase } from './validators/team-agents/next-claim-atomization.ts';
import { runKnowledgeHybridRerankValidatorCase } from './validators/team-agents/knowledge-hybrid-rerank.ts';
import { runBrokerOverrideGateParityValidatorCase } from './validators/team-agents/broker-override-gate-parity.ts';
import { runArtifactHandoffRetryValidatorCase } from './validators/team-agents/artifact-handoff-retry.ts';
import { runKnowledgeBuildQueryValidatorCase } from './validators/team-agents/knowledge-build-query.ts';
import { runRealObservabilityQueryValidatorCase } from './validators/team-agents/real-observability-query.ts';
import { runBrokerConflictUxValidatorCase } from './validators/team-agents/broker-conflict-ux.ts';
import { runStartStatusValidatorCase } from './validators/team-agents/start-status.ts';
import { runReworkRouteStateMachineValidatorCase } from './validators/team-agents/rework-route-state-machine.ts';
import { runDirectProviderExecuteAdmissionValidatorCase } from './validators/team-agents/direct-provider-execute-admission.ts';
import { runClosureSummaryValidatorCase } from './validators/team-agents/closure-summary.ts';
import { runProviderNeutralRoleSkillPackManifestValidatorCase } from './validators/team-agents/provider-neutral-role-skill-pack-manifest.ts';
import { runEditorSubagentBridgeValidatorCase } from './validators/team-agents/editor-subagent-bridge.ts';
import { runTeamVendorLocalSecretsValidatorCase } from './validators/team-agents/team-vendor-local-secrets.ts';
import { runBrokerConflictResolutionValidatorCase } from './validators/team-agents/broker-conflict-resolution.ts';
import { runNodejsWorkerAdapterValidatorCase } from './validators/team-agents/nodejs-worker-adapter.ts';
import { runHeterogeneousMultiBotTeamRunValidatorCase } from './validators/team-agents/heterogeneous-multi-bot-team-run.ts';
import { runTeamRequiredCloseGateValidatorCase } from './validators/team-agents/team-required-close-gate.ts';
import { runAnthropicDirectBridgeValidatorCase } from './validators/team-agents/anthropic-direct-bridge.ts';
import { runTeamGovernanceRuntimeFieldsValidatorCase } from './validators/team-agents/team-governance-runtime-fields.ts';
import { runFileWriteScopeValidatorCase } from './validators/team-agents/file-write-scope.ts';
import { runKnowledgeRetentionBudgetValidatorCase } from './validators/team-agents/knowledge-retention-budget.ts';
import { runFencingDeadlockValidatorCase } from './validators/team-agents/fencing-deadlock.ts';
import { runIntegrationCapabilityWiringValidatorCase } from './validators/team-agents/integration-capability-wiring.ts';
import { runTeamStartExecutionWiringValidatorCase } from './validators/team-agents/team-start-execution-wiring.ts';
import { runClaimGateParityValidatorCase } from './validators/team-agents/claim-gate-parity.ts';
import { runProviderSelectionOverridesValidatorCase } from './validators/team-agents/provider-selection-overrides.ts';
import { runDirectProviderScopedPathForwardingValidatorCase } from './validators/team-agents/direct-provider-scoped-path-forwarding.ts';
import { runPlanningPathLeaseNormalizationValidatorCase } from './validators/team-agents/planning-path-lease-normalization.ts';
import { runMultiSignatureQuorumValidatorCase } from './validators/team-agents/multi-signature-quorum.ts';
import { runPolyglotWorkerExamplesValidatorCase } from './validators/team-agents/polyglot-worker-examples.ts';
import { runTeamPlanProposalParityValidatorCase } from './validators/team-agents/team-plan-proposal-parity.ts';
import { runReviewerIndependenceEarlyWarningValidatorCase } from './validators/team-agents/reviewer-independence-early-warning.ts';
import { runRuntimeTierContractValidatorCase } from './validators/team-agents/runtime-tier-contract.ts';
import { runBrokerConflictResolutionReplayValidatorCase } from './validators/team-agents/broker-conflict-resolution-replay.ts';
import { runReviewAgentSignatureValidatorCase } from './validators/team-agents/review-agent-signature.ts';
import { runVendorNeutralRuntimeContractValidatorCase } from './validators/team-agents/vendor-neutral-runtime-contract.ts';
import { runMinimalTeamAgentsExampleValidatorCase } from './validators/team-agents/minimal-team-agents-example.ts';
import { runActiveResourceIndexReadonlyValidatorCase } from './validators/team-agents/active-resource-index-readonly.ts';
import { runKnowledgeBoundaryValidatorCase } from './validators/team-agents/knowledge-boundary.ts';
import { runSourceRuntimeResidueCleanupValidatorCase } from './validators/team-agents/source-runtime-residue-cleanup.ts';
import { runProviderPermissionBrokerValidatorCase } from './validators/team-agents/provider-permission-broker.ts';
import { runThreeVendorDirectArtifactHandoffValidatorCase } from './validators/team-agents/three-vendor-direct-artifact-handoff.ts';
import { runGovernedRepoVendorConfigValidatorCase } from './validators/team-agents/governed-repo-vendor-config.ts';
import { runCommandSpecBrokerSurfaceValidatorCase } from './validators/team-agents/command-spec-broker-surface.ts';
import { assertRejectsCliError, fail } from './validators/team-agents/assertions.ts';
import { resolveAtomizationLinePolicy } from '../packages/cli/src/commands/tasks/task-import-validators.ts';
import {
  cleanupNewSourceTeamRunFiles,
  listRelativeFiles,
  snapshotSourceTeamRunFiles,
  writeTeamRunForHandoffGate
} from './validators/team-agents/artifact-fixtures.ts';
import { reportTeamAgentsCaseOk } from './validators/team-agents/reporter.ts';
import { runBrokerRunScanIndexValidatorCase } from './validators/team-agents/broker-run-scan-index.ts';
import { validateWaveMode } from './validators/team-agents/wave-mode.ts';

const taskCase = getArg('--case') ?? 'lieutenant-escalation';

const sourceTeamRunSnapshot = snapshotSourceTeamRunFiles(process.cwd());
try {
  await main();
} finally {
  cleanupNewSourceTeamRunFiles(process.cwd(), sourceTeamRunSnapshot);
}

async function main() {
  // TASK-MAO-0027: Team Agents Wave Mode runtime self-check. Runs on every
  // invocation so any caller of this validator also asserts wave behavior.
  validateWaveMode();

  if (await runNextClaimAtomizationValidatorCase(taskCase)) return;
  if (await runBrokerOverrideGateParityValidatorCase(taskCase)) return;
  if (await runArtifactHandoffRetryValidatorCase(taskCase)) return;
  if (await runKnowledgeBuildQueryValidatorCase(taskCase)) return;
  if (await runRealObservabilityQueryValidatorCase(taskCase)) return;
  if (await runBrokerConflictUxValidatorCase(taskCase)) return;
  if (await runStartStatusValidatorCase(taskCase)) return;
  if (await runReworkRouteStateMachineValidatorCase(taskCase)) return;
  if (await runDirectProviderExecuteAdmissionValidatorCase(taskCase)) return;
  if (await runClosureSummaryValidatorCase(taskCase)) return;
  if (await runProviderNeutralRoleSkillPackManifestValidatorCase(taskCase)) return;
  if (await runEditorSubagentBridgeValidatorCase(taskCase)) return;
  if (await runTeamVendorLocalSecretsValidatorCase(taskCase)) return;
  if (await runBrokerConflictResolutionValidatorCase(taskCase)) return;
  if (await runNodejsWorkerAdapterValidatorCase(taskCase)) return;
  if (await runHeterogeneousMultiBotTeamRunValidatorCase(taskCase)) return;
  if (await runTeamRequiredCloseGateValidatorCase(taskCase)) return;
  if (await runAnthropicDirectBridgeValidatorCase(taskCase)) return;
  if (await runTeamGovernanceRuntimeFieldsValidatorCase(taskCase)) return;
  if (await runFileWriteScopeValidatorCase(taskCase)) return;
  if (await runKnowledgeRetentionBudgetValidatorCase(taskCase)) return;
  if (await runFencingDeadlockValidatorCase(taskCase)) return;
  if (await runIntegrationCapabilityWiringValidatorCase(taskCase)) return;
  if (await runTeamStartExecutionWiringValidatorCase(taskCase)) return;
  if (await runClaimGateParityValidatorCase(taskCase)) return;
  if (runProviderSelectionOverridesValidatorCase(taskCase)) return;
  if (await runDirectProviderScopedPathForwardingValidatorCase(taskCase)) return;
  if (await runPlanningPathLeaseNormalizationValidatorCase(taskCase)) return;
  if (runMultiSignatureQuorumValidatorCase(taskCase)) return;
  if (runPolyglotWorkerExamplesValidatorCase(taskCase)) return;
  if (await runTeamPlanProposalParityValidatorCase(taskCase)) return;
  if (runReviewerIndependenceEarlyWarningValidatorCase(taskCase)) return;
  if (runRuntimeTierContractValidatorCase(taskCase)) return;
  if (runBrokerConflictResolutionReplayValidatorCase(taskCase)) return;
  if (runReviewAgentSignatureValidatorCase(taskCase)) return;
  if (await runVendorNeutralRuntimeContractValidatorCase(taskCase)) return;
  if (runMinimalTeamAgentsExampleValidatorCase(taskCase)) return;
  if (await runActiveResourceIndexReadonlyValidatorCase(taskCase)) return;
  if (runKnowledgeBoundaryValidatorCase(taskCase)) return;

  if (await runTeamHandoffValidatorCase(taskCase)) return;

  if (await runBrokerSharedSurfaceValidatorCase(taskCase)) return;

  if (runLieutenantEscalationValidatorCase(taskCase)) return;

  if (runSourceRuntimeResidueCleanupValidatorCase(taskCase)) return;

  if (await runTeamPlanSelectionValidatorCase(taskCase)) return;

  if (await runPermissionLeaseValidatorCase(taskCase)) return;

  if (runProviderPermissionBrokerValidatorCase(taskCase)) return;

  if (await runOpenAIAzureOpenAIBridgesValidatorCase(taskCase)) return;

  if (await runClaudeGeminiBridgesValidatorCase(taskCase)) return;

  if (await runMicrosoftFoundryBridgeValidatorCase(taskCase)) return;

  if (await runThreeVendorDirectArtifactHandoffValidatorCase(taskCase)) return;

  if (runGovernedRepoVendorConfigValidatorCase(taskCase)) return;

  if (await runPerRoleProviderSelectionConfigValidatorCase(taskCase)) return;

  if (await runCrossVendorObservabilityValidatorCase(taskCase)) return;

  if (runBrokerRunScanIndexValidatorCase(taskCase)) return;

  if (await runRuntimeModeContractValidatorCase(taskCase)) return;

  if (runCommandSpecBrokerSurfaceValidatorCase(taskCase)) return;

  if (await runSandboxAttestationValidatorCase(taskCase)) return;

  if (await runKnowledgeHybridRerankValidatorCase(taskCase)) return;

  if (await runPatrolReportValidatorCase(taskCase)) return;

  if (await runTeamLifecycleVerbsValidatorCase(taskCase)) return;

  if (await runHookTeamGateValidatorCase(taskCase)) return;

  if (await runCaptureBrokerEvidenceValidatorCase(taskCase)) return;

  fail(`unsupported or missing --case value: ${taskCase}`);
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function readRepoConfig(cwd: string): { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } } | null {
  const configPath = path.join(cwd, '.atm', 'config.json');
  if (!existsSync(configPath)) return null;
  return JSON.parse(readFileSync(configPath, 'utf8')) as { readonly atomization?: { readonly maxLines?: unknown; readonly waiver?: { readonly expiresAt?: unknown; readonly reason?: unknown } } };
}


function safeBrokerLane(): any {
  return {
    decision: { verdict: 'safe-to-start' },
    chosenLane: 'direct-brokered',
    safeToStart: true,
    blockedReasons: [],
    stewardId: null,
    composerPath: null
  };
}
