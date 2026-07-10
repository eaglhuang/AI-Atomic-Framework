export type * from './types.ts';
export {
  DEFAULT_POLYMORPH_VARIANT_THRESHOLD,
  buildPolymorphSuppressionKey,
  buildRollbackSuppressionKey,
  buildEvolutionSuppressionKey,
  buildDecompositionSuppressionKey
} from './suppression-keys.ts';
export {
  DEFAULT_EVIDENCE_MAX_AGE_MS,
  DEFAULT_POLICE_DAILY_CAP
} from './constants.ts';
export {
  makeEvidenceRef,
  makePoliceFinding,
  makePoliceFamilyReport,
  toReviewAdvisorySeverity,
  toReviewAdvisoryAction,
  toReviewAdvisoryMachineFinding
} from './shared.ts';
export {
  DEFAULT_EVOLUTION_RECURRENCE_THRESHOLD,
  DEFAULT_EVOLUTION_CONFIDENCE_THRESHOLD
} from './roles/evolution.ts';
export { runDedupPolice } from './roles/dedup.ts';
export { runDemandPolice } from './roles/demand.ts';
export { runQualityPolice, renderQualityPoliceMarkdown } from './roles/quality.ts';
export { runMapIntegrationPolice } from './roles/map-integration.ts';
export { runAtomizationPolice } from './roles/atomization.ts';
export { runDecompositionPolice, buildDecompositionPlanHintDraft } from './roles/decomposition.ts';
export { runEvolutionPolice } from './roles/evolution.ts';
export { runPolymorphPolice } from './roles/polymorph.ts';
export { runRollbackPolice } from './roles/rollback.ts';
export { runEvidenceIntegrityGate } from './roles/evidence-integrity.ts';
export { runReversibilityGate } from './roles/reversibility.ts';
export { runNoiseControlGate } from './roles/noise-control.ts';
export { runAdopterNeutralityCheck } from './roles/adopter-neutrality.ts';
export { POLICE_ROLE_REGISTRY, POLICE_ROLE_IDS } from './role-registry.ts';

import { makeEvidenceRef, makePoliceFinding, makePoliceFamilyReport, sanitizeId, classifyViolationFamily } from './shared.ts';
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
import type {
  AdvisoryOnlyHardeningInput,
  AdvisoryOnlyHardeningProbe,
  AdvisoryOnlyHardeningReport,
  AdvisoryOnlyHardeningResult,
  ContractDriftCheckInput,
  ContractDriftEntry,
  PoliceFamilyGateInput,
  PoliceFamilyGateReport,
  PoliceFamilyProfile,
  PoliceFamilyReport,
  PoliceFamilyStatus,
  PoliceFinding,
  SharedGateReport,
  ValidatorProfileNamingContract
} from './types.ts';

export function verifyAdvisoryOnlyHardening(input: AdvisoryOnlyHardeningInput = {}): AdvisoryOnlyHardeningReport {
  const results: AdvisoryOnlyHardeningResult[] = (input.probes ?? []).map((probe) => ({
    probeId: probe.probeId,
    attemptedAction: probe.attemptedAction,
    rejected: true as const,
    reason: advisoryRejectionReason(probe.attemptedAction)
  }));
  return {
    schemaId: 'atm.advisoryOnlyHardeningReport',
    specVersion: '0.1.0',
    results,
    ok: results.every((entry) => entry.rejected === true)
  };
}

function advisoryRejectionReason(action: AdvisoryOnlyHardeningProbe['attemptedAction']): string {
  switch (action) {
    case 'registry-mutation':
      return 'advisory police family cannot directly mutate registry; route through ReviewAdvisory + HumanReviewDecision';
    case 'auto-approve':
      return 'advisory finding cannot produce approved HumanReviewDecision; must route through human review';
    case 'direct-promotion':
      return 'advisory finding cannot directly promote registry lifecycle state';
    case 'bypass-review':
      return 'advisory finding cannot bypass ReviewAdvisory.machine-finding bridge';
    default:
      return 'unknown advisory action rejected by hardening contract';
  }
}

// ── Validator Profile Naming Contract (APF-0053) ───────────────────────────

export const VALIDATOR_PROFILE_NAMING_CONTRACT: ValidatorProfileNamingContract = {
  schemaId: 'atm.validatorProfileNamingContract',
  specVersion: '0.1.0',
  profiles: [
    {
      profile: 'validate:police-family',
      role: 'named police family gate runner producing PoliceFamilyGateReport',
      relatesTo: ['validate:standard', 'validate:full']
    },
    {
      profile: 'validate:police',
      role: 'legacy police validator suite; preserved for fixture deep-tests in validate:full',
      relatesTo: ['validate:full']
    },
    {
      profile: 'validate:standard',
      role: 'CI default gate; includes validate-police-family as advisory-by-default',
      relatesTo: ['validate:police-family']
    },
    {
      profile: 'validate:full',
      role: 'release gate; extends standard, includes validate:police and may promote stricter blocker assertions',
      relatesTo: ['validate:standard', 'validate:police', 'validate:police-family']
    }
  ]
};

// ── Contract Drift Check (APF-0048) ─────────────────────────────────────────

export function buildCorePoliceFamilies(input: {
  readonly policeReport?: Record<string, unknown>;
  readonly lifecycleReport?: Record<string, unknown>;
}): PoliceFamilyReport[] {
  const families: PoliceFamilyReport[] = [
    makePoliceFamilyReport({
      family: 'schema',
      mode: 'blocker',
      status: 'pass',
      findings: [],
      sourceValidator: 'schema-validator'
    })
  ];
  const coreFindings = ((input.policeReport?.violations ?? []) as Record<string, unknown>[]).map((violation, index: number) => {
    const family = classifyViolationFamily(String(violation.code ?? 'core'));
    return makePoliceFinding({
      findingId: `police.${family}.${sanitizeId(violation.code)}.${index}`,
      policeFamily: family,
      severity: violation.severity === 'error' ? 'error' : 'warning',
      trigger: String(violation.code ?? 'police-violation'),
      scope: (violation.path ?? violation.atomId) as string | undefined,
      action: violation.severity === 'error' ? 'hard-fail' : 'request-human-review',
      routeHint: family === 'registry-consistency' ? 'registry.review' : 'atm.police.core',
      readModel: 'runPoliceChecks.violations',
      message: String(violation.message ?? violation.code ?? 'Police violation detected.'),
      evidenceRefs: violation.path ? [makeEvidenceRef(String(violation.path), 'police-artifact')] : undefined,
      metadata: {
        violation
      }
    });
  });

  for (const familyName of ['dependency-graph', 'boundary', 'registry-consistency'] as const) {
    const findings = coreFindings.filter((finding: PoliceFinding) => finding.policeFamily === familyName);
    families.push(makePoliceFamilyReport({
      family: familyName,
      mode: 'blocker',
      status: findings.length > 0 ? 'fail' : 'pass',
      findings,
      sourceValidator: 'runPoliceChecks'
    }));
  }

  const lifecycleFindings = input.lifecycleReport?.hardFail
    ? ((input.lifecycleReport.findings ?? []) as Record<string, unknown>[])
      .filter((finding) => finding.action === 'hard-fail' || finding.action === 'quarantine')
      .map((finding, index: number) => makePoliceFinding({
        findingId: `police.lifecycle.${sanitizeId(finding.trigger)}.${index}`,
        policeFamily: 'lifecycle',
        severity: finding.severity === 'error' ? 'error' : 'warning',
        trigger: String(finding.trigger ?? ''),
        scope: finding.scope as string | undefined,
        action: finding.action === 'quarantine' ? 'quarantine' : 'hard-fail',
        routeHint: 'lifecycle-police',
        readModel: 'LifecyclePoliceFinding',
        message: String(finding.message ?? ''),
        evidenceRefs: ((finding.callerIds ?? []) as string[]).map((callerId) => makeEvidenceRef(callerId, 'read-model')),
        metadata: {
          lifecycleFinding: finding,
          writer: (input.lifecycleReport?.quarantineWriteGuard as Record<string, unknown> | undefined)?.writer ?? null
        }
      }))
    : [];

  families.push(makePoliceFamilyReport({
    family: 'lifecycle',
    mode: 'blocker',
    status: input.lifecycleReport?.hardFail ? 'fail' : 'pass',
    findings: lifecycleFindings,
    sourceValidator: 'runLifecyclePolice'
  }));

  return families;
}

export function runRegistryContractDriftCheck(input: ContractDriftCheckInput = {}): PoliceFamilyReport {
  const findings: PoliceFinding[] = [];
  for (const entry of input.entries ?? []) {
    const drifted = detectContractDrift(entry);
    if (!drifted) continue;
    findings.push(makePoliceFinding({
      findingId: `police.registry-consistency.${entry.trigger}.${sanitizeId(entry.atomId ?? entry.mapId ?? 'unknown')}`,
      policeFamily: 'registry-consistency',
      severity: 'warning',
      trigger: entry.trigger,
      scope: entry.atomId ?? entry.mapId ?? 'registry',
      action: 'request-human-review',
      routeHint: 'registry.review',
      readModel: 'RegistryConsistency.contractDrift',
      message: entry.message ?? `Contract drift detected: ${entry.trigger} for ${entry.atomId ?? entry.mapId ?? 'unknown'}.`,
      evidenceRefs: [makeEvidenceRef('contract-drift-record', 'police-artifact')],
      metadata: {
        atomId: entry.atomId,
        mapId: entry.mapId,
        specHash: entry.specHash,
        implementationHash: entry.implementationHash,
        testHash: entry.testHash,
        registryMetadataHash: entry.registryMetadataHash,
        mapMemberHash: entry.mapMemberHash,
        directApplyAllowed: false
      }
    }));
  }
  return makePoliceFamilyReport({
    family: 'registry-consistency',
    mode: 'blocker',
    status: findings.length > 0 ? 'fail' : 'pass',
    findings,
    sourceValidator: 'runRegistryContractDriftCheck'
  });
}

function detectContractDrift(entry: ContractDriftEntry): boolean {
  switch (entry.trigger) {
    case 'spec-implementation-drift':
      return Boolean(entry.specHash && entry.implementationHash && entry.specHash !== entry.implementationHash);
    case 'spec-test-drift':
      return Boolean(entry.specHash && entry.testHash && entry.specHash !== entry.testHash);
    case 'registry-metadata-drift':
      return Boolean(entry.registryMetadataHash && entry.specHash && entry.registryMetadataHash !== entry.specHash);
    case 'map-member-contract-drift':
      return Boolean(entry.mapMemberHash && entry.specHash && entry.mapMemberHash !== entry.specHash);
    default:
      return false;
  }
}

export async function runPoliceFamilyGate(input: PoliceFamilyGateInput = {}): Promise<PoliceFamilyGateReport> {
  const profile = input.profile ?? 'standard';
  const families = [
    ...(input.coreFamilies ?? []),
    runDedupPolice(input.dedup ?? {}),
    await runDemandPolice(input.demand ?? {}),
    runQualityPolice(input.quality ?? {}),
    runMapIntegrationPolice(input.mapIntegration ?? {}),
    runAtomizationPolice(input.atomization ?? {}),
    runDecompositionPolice(input.decomposition ?? {}),
    runEvolutionPolice(input.evolution ?? {}),
    runPolymorphPolice(input.polymorph ?? {}),
    runRollbackPolice(input.rollback ?? {})
  ];
  const sharedGates: SharedGateReport[] = [
    runEvidenceIntegrityGate(input.evidenceIntegrity ?? {}),
    runReversibilityGate(input.reversibility ?? {}),
    runNoiseControlGate(input.noiseControl ?? {})
  ];
  if (input.contractDrift) {
    const driftReport = runRegistryContractDriftCheck(input.contractDrift);
    const existingRegistryFamily = families.find((family) => family.family === 'registry-consistency');
    if (existingRegistryFamily) {
      const mergedFindings = [...existingRegistryFamily.findings, ...driftReport.findings];
      const mergedStatus: PoliceFamilyStatus = mergedFindings.some((finding) => finding.severity === 'block' || finding.severity === 'error') ? 'fail' : driftReport.findings.length > 0 ? 'fail' : existingRegistryFamily.status;
      const merged = makePoliceFamilyReport({
        family: 'registry-consistency',
        mode: 'blocker',
        status: mergedStatus,
        findings: mergedFindings,
        sourceValidator: `${existingRegistryFamily.sourceValidator}+runRegistryContractDriftCheck`
      });
      const index = families.indexOf(existingRegistryFamily);
      families.splice(index, 1, merged);
    } else {
      families.push(driftReport);
    }
  }
  return buildPoliceFamilyGateReport({
    profile,
    generatedAt: input.generatedAt,
    families,
    sharedGates
  });
}

export function buildPoliceFamilyGateReport(input: {
  readonly profile?: PoliceFamilyProfile;
  readonly generatedAt?: string;
  readonly families: readonly PoliceFamilyReport[];
  readonly sharedGates?: readonly SharedGateReport[];
}): PoliceFamilyGateReport {
  const profile = input.profile ?? 'standard';
  const findings = input.families.flatMap((family) => [...family.findings]);
  const blockingFindings = input.families.flatMap((family) => {
    if (family.mode !== 'blocker') {
      return [];
    }
    return family.findings.filter((finding) => finding.severity === 'block' || finding.severity === 'error');
  });
  const advisoryFindings = findings.filter((finding) => !blockingFindings.includes(finding));
  const blockerFamilyFailed = input.families.some((family) => family.mode === 'blocker' && (family.status === 'fail' || family.status === 'error'));

  return {
    schemaId: 'atm.policeFamilyGateReport',
    specVersion: '0.1.0',
    profile,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    families: [...input.families],
    findings,
    advisoryFindings,
    blockingFindings,
    ok: blockingFindings.length === 0 && !blockerFamilyFailed,
    canPromote: profile === 'full'
      ? blockingFindings.length === 0 && !blockerFamilyFailed
      : blockingFindings.length === 0 && !blockerFamilyFailed,
    sharedGates: input.sharedGates ? [...input.sharedGates] : undefined
  };
}

export function renderPoliceFamilyGateMarkdown(report: PoliceFamilyGateReport): string {
  const lines: string[] = [];
  lines.push('# Police Family Gate Report');
  lines.push('');
  lines.push(`- Profile: ${report.profile}`);
  lines.push(`- Result: ${report.ok ? 'PASS' : 'FAIL'}`);
  lines.push(`- Families: ${report.families.length}`);
  lines.push(`- Findings: ${report.findings.length}`);
  lines.push('');
  lines.push('| Family | Mode | Status | Findings | Source |');
  lines.push('|---|---|---|---:|---|');
  for (const family of report.families) {
    lines.push(`| ${family.family} | ${family.mode} | ${family.status} | ${family.findings.length} | ${family.sourceValidator} |`);
  }
  lines.push('');
  return lines.join('\n');
}
