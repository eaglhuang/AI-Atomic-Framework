import type {
  PermissionLease,
  TeamArtifactHandoffContract,
  TeamArtifactHandoffFinding,
  TeamRecipe,
  TeamRetryBudgetContract,
  TeamReworkFinding,
  TeamReworkRoute,
  TeamReworkRouteStatus,
  TeamReworkTransition,
  TeamRoleArtifactContract
} from './types.ts';

export function buildTeamArtifactHandoffContract(input: {
  recipe?: TeamRecipe;
  requiredRoles?: readonly string[];
  producedArtifacts?: readonly string[];
}): TeamArtifactHandoffContract {
  const requiredRoles = uniqueStrings((input.requiredRoles ?? ['implementer', 'reviewer', 'validator', 'evidence-collector'])
    .map((entry) => String(entry).trim())
    .filter(Boolean));
  const recipeAgents = input.recipe?.agents ?? [];
  const roleContracts = requiredRoles.map((role) => {
    const agent = recipeAgents.find((entry) => entry.role === role);
    return buildTeamRoleArtifactContract({
      agentId: agent?.agentId ?? role,
      role
    });
  });
  const findings = validateTeamArtifactHandoff({
    roleContracts,
    producedArtifacts: input.producedArtifacts ?? []
  });
  return {
    schemaId: 'atm.teamArtifactHandoffContract.v1',
    requiredRoles,
    roleContracts,
    findings,
    closeAllowed: findings.every((finding) => !finding.blocking)
  };
}

export function validateTeamArtifactHandoff(input: {
  roleContracts: readonly TeamRoleArtifactContract[];
  producedArtifacts?: readonly string[];
}): TeamArtifactHandoffFinding[] {
  const producedArtifacts = new Set((input.producedArtifacts ?? []).map((entry) => normalizeArtifactName(entry)).filter(Boolean));
  const findings: TeamArtifactHandoffFinding[] = [];
  for (const contract of input.roleContracts) {
    for (const artifact of contract.requiredArtifacts) {
      const normalizedArtifact = normalizeArtifactName(artifact);
      if (!producedArtifacts.has(normalizedArtifact)) {
        findings.push({
          level: 'error',
          code: 'missing-required-artifact',
          role: contract.role,
          agentId: contract.agentId,
          artifact,
          blocking: true,
          summary: `${contract.role} requires artifact '${artifact}' before close.`
        });
      }
    }
  }
  return findings;
}

export function buildTeamRetryBudgetContract(input: {
  maxReworkCycles?: unknown;
  maxValidatorReruns?: unknown;
  maxReviewerReturns?: unknown;
  usedReworkCycles?: unknown;
  usedValidatorReruns?: unknown;
  usedReviewerReturns?: unknown;
  escalationTarget?: unknown;
}): TeamRetryBudgetContract {
  const maxReworkCycles = normalizeRetryBudget(input.maxReworkCycles, 1);
  const maxValidatorReruns = normalizeRetryBudget(input.maxValidatorReruns, 1);
  const maxReviewerReturns = normalizeRetryBudget(input.maxReviewerReturns, 1);
  const usedReworkCycles = normalizeRetryBudget(input.usedReworkCycles, 0);
  const usedValidatorReruns = normalizeRetryBudget(input.usedValidatorReruns, 0);
  const usedReviewerReturns = normalizeRetryBudget(input.usedReviewerReturns, 0);
  const exhausted = usedReworkCycles >= maxReworkCycles
    || usedValidatorReruns >= maxValidatorReruns
    || usedReviewerReturns >= maxReviewerReturns;
  const escalationTarget = normalizeOptionalRuntimeString(input.escalationTarget) ?? 'captain';
  return {
    schemaId: 'atm.teamRetryBudgetContract.v1',
    maxReworkCycles,
    maxValidatorReruns,
    maxReviewerReturns,
    usedReworkCycles,
    usedValidatorReruns,
    usedReviewerReturns,
    exhausted,
    escalationTarget: exhausted ? escalationTarget : null,
    status: exhausted ? 'escalation-required' : 'within-budget'
  };
}

export function buildTeamReworkRouteStateMachine(input: {
  findings?: readonly TeamReworkFinding[];
  requiredChecksPassed?: boolean;
  retryBudgetMax?: number;
  retryBudgetUsed?: number;
  previousStatus?: TeamReworkRouteStatus;
}): TeamReworkRoute {
  const maxAttempts = normalizeRetryBudget(input.retryBudgetMax, 1);
  const used = normalizeRetryBudget(input.retryBudgetUsed, 0);
  const remaining = Math.max(0, maxAttempts - used);
  const findings = normalizeTeamReworkFindings(input.findings ?? []);
  const requiredChecksPassed = input.requiredChecksPassed === true;
  const startingStatus = input.previousStatus ?? 'work-in-progress';
  const blockingReviewerFindings = findings.filter((finding) => finding.source === 'reviewer' && isBlockingReworkFinding(finding));
  const failedValidatorFindings = findings.filter((finding) => finding.source === 'validator' && finding.passed === false);
  const blockingFindings = [...blockingReviewerFindings, ...failedValidatorFindings];
  const transitions: TeamReworkTransition[] = [];
  let status = startingStatus;

  if (blockingFindings.length > 0) {
    status = pushTeamReworkTransition({
      transitions,
      from: status,
      to: remaining <= 0 ? 'blocked' : 'needs-rework',
      reason: remaining <= 0
        ? 'retry budget exhausted while blocking reviewer or validator findings remain'
        : 'blocking reviewer or validator findings require implementation rework',
      findingIds: blockingFindings.map((finding) => finding.id)
    });
  } else if (status === 'needs-rework') {
    status = pushTeamReworkTransition({
      transitions,
      from: status,
      to: 'revalidate-pending',
      reason: 'rework completed; validation must rerun before close readiness',
      findingIds: []
    });
  }

  if ((status === 'work-in-progress' || status === 'revalidate-pending') && requiredChecksPassed) {
    status = pushTeamReworkTransition({
      transitions,
      from: status,
      to: 'ready-for-close',
      reason: 'required reviewer and validator checks passed',
      findingIds: []
    });
  } else if (status === 'revalidate-pending' && remaining <= 0) {
    status = pushTeamReworkTransition({
      transitions,
      from: status,
      to: 'escalated',
      reason: 'revalidation is pending but retry budget is exhausted',
      findingIds: []
    });
  }

  return {
    schemaId: 'atm.teamReworkRoute.v1',
    status,
    retryBudget: {
      maxAttempts,
      used,
      remaining,
      escalationTarget: remaining <= 0 ? 'captain' : null
    },
    requiredChecksPassed,
    findings,
    transitions
  };
}

export function buildTeamRoleArtifactContract(input: {
  agentId: string;
  role: string;
}): TeamRoleArtifactContract {
  const role = input.role;
  if (role === 'implementer') {
    return {
      schemaId: 'atm.teamRoleArtifactContract.v1',
      agentId: input.agentId,
      role,
      consumesFrom: ['task-card', 'team-plan', 'scope-locks'],
      producesTo: ['reviewer', 'validator', 'evidence-collector'],
      requiredArtifacts: ['implementation-diff', 'implementation-notes']
    };
  }
  if (role === 'reviewer') {
    return {
      schemaId: 'atm.teamRoleArtifactContract.v1',
      agentId: input.agentId,
      role,
      consumesFrom: ['implementation-diff', 'implementation-notes'],
      producesTo: ['implementer', 'evidence-collector'],
      requiredArtifacts: ['review-findings']
    };
  }
  if (role === 'validator') {
    return {
      schemaId: 'atm.teamRoleArtifactContract.v1',
      agentId: input.agentId,
      role,
      consumesFrom: ['implementation-diff', 'validator-commands'],
      producesTo: ['evidence-collector'],
      requiredArtifacts: ['validator-results']
    };
  }
  if (role === 'evidence-collector') {
    return {
      schemaId: 'atm.teamRoleArtifactContract.v1',
      agentId: input.agentId,
      role,
      consumesFrom: ['review-findings', 'validator-results'],
      producesTo: ['closure-packet'],
      requiredArtifacts: ['command-backed-evidence', 'closure-packet']
    };
  }
  return {
    schemaId: 'atm.teamRoleArtifactContract.v1',
    agentId: input.agentId,
    role,
    consumesFrom: ['team-plan'],
    producesTo: ['team-summary'],
    requiredArtifacts: ['role-report']
  };
}

export function transitionTeamReworkRoute(
  current: TeamReworkRoute,
  input: {
    findings?: readonly TeamReworkFinding[];
    requiredChecksPassed?: boolean;
    retryBudgetUsed?: number;
  }
): TeamReworkRoute {
  const next = buildTeamReworkRouteStateMachine({
    findings: input.findings ?? current.findings,
    requiredChecksPassed: input.requiredChecksPassed ?? current.requiredChecksPassed,
    retryBudgetMax: current.retryBudget.maxAttempts,
    retryBudgetUsed: input.retryBudgetUsed ?? current.retryBudget.used,
    previousStatus: current.status
  });
  return {
    ...next,
    transitions: [...current.transitions, ...next.transitions]
  };
}

function normalizeArtifactName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeTeamReworkFindings(findings: readonly TeamReworkFinding[]): TeamReworkFinding[] {
  return findings.map((finding, index) => ({
    source: finding.source === 'validator' ? 'validator' : 'reviewer',
    id: String(finding.id || `${finding.source || 'finding'}-${index + 1}`),
    blocking: finding.blocking === true,
    passed: typeof finding.passed === 'boolean' ? finding.passed : undefined,
    severity: normalizeFindingSeverity(finding.severity),
    summary: typeof finding.summary === 'string' ? finding.summary : undefined
  }));
}

function normalizeFindingSeverity(value: unknown): TeamReworkFinding['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' || value === 'blocker'
    ? value
    : undefined;
}

function isBlockingReworkFinding(finding: TeamReworkFinding): boolean {
  return finding.blocking === true || finding.severity === 'error' || finding.severity === 'blocker';
}

function normalizeRetryBudget(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function pushTeamReworkTransition(input: {
  transitions: TeamReworkTransition[];
  from: TeamReworkRouteStatus;
  to: TeamReworkRouteStatus;
  reason: string;
  findingIds: string[];
}): TeamReworkRouteStatus {
  if (input.from !== input.to) {
    input.transitions.push({
      from: input.from,
      to: input.to,
      reason: input.reason,
      findingIds: input.findingIds
    });
  }
  return input.to;
}

function normalizeOptionalRuntimeString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

export type RuntimeContractPermissionLease = PermissionLease;
