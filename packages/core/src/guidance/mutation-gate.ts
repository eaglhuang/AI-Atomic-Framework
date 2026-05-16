import type { GuidanceSession } from './guidance-packet.ts';

export type MutationGateProfile = 'dev' | 'ci' | 'release';
export type MutationGateAction = string;

export interface MutationGateRequest {
  readonly action: MutationGateAction;
  readonly profile?: MutationGateProfile;
  readonly activeSession?: GuidanceSession | null;
  readonly isLegacyTarget?: boolean;
  readonly hasLegacyRoutePlan?: boolean;
  readonly hasDryRunProposal?: boolean;
  readonly hasRollbackProof?: boolean;
  readonly applyRequested?: boolean;
  readonly promoteRequested?: boolean;
  readonly reviewApproved?: boolean;
  readonly releaseBlockers?: readonly string[];
  readonly targetSegmentRole?: 'trunk' | 'leaf' | 'adapter-boundary' | 'unknown';
  readonly unguided?: boolean;
  readonly unguidedReason?: string | null;
}

export interface MutationGateIssue {
  readonly code: GuidanceMutationErrorCode;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface MutationGateResult {
  readonly allowed: boolean;
  readonly advisory: boolean;
  readonly auditRequired: boolean;
  readonly issues: readonly MutationGateIssue[];
}

export type GuidanceMutationErrorCode =
  | 'ATM_GUIDANCE_SESSION_REQUIRED'
  | 'ATM_GUIDANCE_LEGACY_PLAN_REQUIRED'
  | 'ATM_GUIDANCE_PROPOSAL_REQUIRED'
  | 'ATM_GUIDANCE_REVIEW_REQUIRED'
  | 'ATM_GUIDANCE_ROLLBACK_PROOF_REQUIRED'
  | 'ATM_GUIDANCE_RELEASE_BLOCKER'
  | 'ATM_GUIDANCE_TRUNK_MUTATION_BLOCKED'
  | 'ATM_GUIDANCE_UNGUIDED_FORBIDDEN'
  | 'ATM_GUIDANCE_NEXT_NOT_UNIQUE';

const guidedMutationActions = new Set([
  'behavior.atomize',
  'behavior.infect',
  'behavior.split'
]);

export function evaluateMutationGate(request: MutationGateRequest): MutationGateResult {
  const profile = request.profile ?? 'dev';
  const issues: MutationGateIssue[] = [];
  const isGuidedMutation = guidedMutationActions.has(request.action);

  if (request.unguided) {
    if (profile === 'dev' && request.unguidedReason) {
      return { allowed: true, advisory: true, auditRequired: true, issues: [] };
    }
    issues.push(issue('ATM_GUIDANCE_UNGUIDED_FORBIDDEN', {
      nextStep: 'Rerun with an active guidance session or provide --unguided --reason only in dev profile.',
      profile,
      action: request.action
    }));
  }

  if (isGuidedMutation && !request.activeSession) {
    issues.push(issue('ATM_GUIDANCE_SESSION_REQUIRED', {
      nextStep: 'Run `node atm.mjs guide --goal "<goal>" --cwd . --json`, then follow orient/start/next before mutation.',
      remediationCommand: 'node atm.mjs guide --goal "<goal>" --cwd . --json',
      action: request.action
    }));
  }

  if (isGuidedMutation && request.isLegacyTarget && !request.hasLegacyRoutePlan) {
    issues.push(issue('ATM_GUIDANCE_LEGACY_PLAN_REQUIRED', {
      nextStep: 'Run the legacy guidance flow until it produces a LegacyRoutePlan.',
      remediationCommand: 'node atm.mjs guide --goal "<goal>" --cwd . --json',
      action: request.action
    }));
  }

  if ((request.action === 'behavior.atomize' || request.action === 'behavior.infect') && !request.hasDryRunProposal) {
    issues.push(issue('ATM_GUIDANCE_PROPOSAL_REQUIRED', {
      nextStep: 'Generate the single dry-run proposal returned by `node atm.mjs next --cwd . --json` before apply.',
      action: request.action
    }));
  }

  if (request.applyRequested && !request.reviewApproved) {
    issues.push(issue('ATM_GUIDANCE_REVIEW_REQUIRED', {
      nextStep: 'Record a human review approval before apply.',
      action: request.action
    }));
  }

  if (request.applyRequested && !request.hasRollbackProof) {
    issues.push(issue('ATM_GUIDANCE_ROLLBACK_PROOF_REQUIRED', {
      nextStep: 'Attach rollback proof or rollback instructions before apply.',
      action: request.action
    }));
  }

  if (request.promoteRequested && (request.releaseBlockers?.length ?? 0) > 0) {
    issues.push(issue('ATM_GUIDANCE_RELEASE_BLOCKER', {
      nextStep: 'Resolve release blockers before promote.',
      releaseBlockers: request.releaseBlockers ?? []
    }));
  }

  if (request.targetSegmentRole === 'trunk') {
    issues.push(issue('ATM_GUIDANCE_TRUNK_MUTATION_BLOCKED', {
      nextStep: 'Use leaf-first proposal routing instead of directly rewriting trunk functions.',
      action: request.action
    }));
  }

  return {
    allowed: issues.length === 0,
    advisory: false,
    auditRequired: issues.length > 0 || request.unguided === true,
    issues
  };
}

export function assertUniqueNextAction(nextActions: readonly unknown[]): MutationGateResult {
  if (nextActions.length === 1) {
    return { allowed: true, advisory: false, auditRequired: false, issues: [] };
  }
  return {
    allowed: false,
    advisory: false,
    auditRequired: true,
    issues: [issue('ATM_GUIDANCE_NEXT_NOT_UNIQUE', {
      nextStep: 'Collapse route choices into one executable nextAction.command.',
      count: nextActions.length
    })]
  };
}

export function explainGuidanceIssue(code: GuidanceMutationErrorCode): MutationGateIssue {
  return issue(code, { nextStep: defaultNextStep(code) });
}

function issue(code: GuidanceMutationErrorCode, details: Readonly<Record<string, unknown>>): MutationGateIssue {
  return {
    code,
    message: messageFor(code),
    details
  };
}

function messageFor(code: GuidanceMutationErrorCode): string {
  switch (code) {
    case 'ATM_GUIDANCE_SESSION_REQUIRED': return 'Guidance session is required before host mutation.';
    case 'ATM_GUIDANCE_LEGACY_PLAN_REQUIRED': return 'Legacy target mutation requires a LegacyRoutePlan.';
    case 'ATM_GUIDANCE_PROPOSAL_REQUIRED': return 'Mutation requires a dry-run proposal first.';
    case 'ATM_GUIDANCE_REVIEW_REQUIRED': return 'Apply requires human review approval.';
    case 'ATM_GUIDANCE_ROLLBACK_PROOF_REQUIRED': return 'Apply requires rollback proof or rollback instructions.';
    case 'ATM_GUIDANCE_RELEASE_BLOCKER': return 'Release blockers prevent promotion.';
    case 'ATM_GUIDANCE_TRUNK_MUTATION_BLOCKED': return 'Direct trunk function mutation is blocked.';
    case 'ATM_GUIDANCE_UNGUIDED_FORBIDDEN': return 'Unguided mutation is forbidden in this profile.';
    case 'ATM_GUIDANCE_NEXT_NOT_UNIQUE': return 'Guidance next action must be unique.';
  }
}

function defaultNextStep(code: GuidanceMutationErrorCode): string {
  switch (code) {
    case 'ATM_GUIDANCE_SESSION_REQUIRED': return 'Run `node atm.mjs guide --goal "<goal>" --cwd . --json`.';
    case 'ATM_GUIDANCE_LEGACY_PLAN_REQUIRED': return 'Run legacy guidance until LegacyRoutePlan evidence exists.';
    case 'ATM_GUIDANCE_PROPOSAL_REQUIRED': return 'Generate a dry-run proposal.';
    case 'ATM_GUIDANCE_REVIEW_REQUIRED': return 'Record human review approval.';
    case 'ATM_GUIDANCE_ROLLBACK_PROOF_REQUIRED': return 'Attach rollback proof or rollback instructions.';
    case 'ATM_GUIDANCE_RELEASE_BLOCKER': return 'Resolve release blockers.';
    case 'ATM_GUIDANCE_TRUNK_MUTATION_BLOCKED': return 'Use leaf-first proposal routing.';
    case 'ATM_GUIDANCE_UNGUIDED_FORBIDDEN': return 'Use guided mode or dev advisory with reason.';
    case 'ATM_GUIDANCE_NEXT_NOT_UNIQUE': return 'Return exactly one next action.';
  }
}
