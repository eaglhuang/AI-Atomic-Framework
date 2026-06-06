export interface GuardViolation {
  readonly guardId: string;
  readonly justification?: string;
}

export interface GuardJustificationInput {
  readonly violations: readonly GuardViolation[];
}

export interface RequiredJustification {
  readonly requiredGuardIds: readonly string[];
  readonly requiredEvidenceKinds: readonly string[];
  readonly humanReviewRequired: boolean;
  readonly rationale: string;
}

export interface GuardJustificationResult {
  readonly ok: boolean;
  readonly checkedViolations: number;
  readonly missingJustifications: readonly string[];
  readonly requiredJustification: RequiredJustification | null;
}

export function checkGuardJustification(input: GuardJustificationInput): GuardJustificationResult {
  const missingJustifications: string[] = [];

  for (const violation of input.violations) {
    if (!violation.justification || violation.justification.trim().length === 0) {
      missingJustifications.push(violation.guardId);
    }
  }

  if (missingJustifications.length === 0) {
    return {
      ok: true,
      checkedViolations: input.violations.length,
      missingJustifications: [],
      requiredJustification: null
    };
  }

  return {
    ok: false,
    checkedViolations: input.violations.length,
    missingJustifications,
    requiredJustification: {
      requiredGuardIds: missingJustifications,
      requiredEvidenceKinds: ['justification'],
      humanReviewRequired: true,
      rationale: `Guard violations require a non-empty justification field: ${missingJustifications.join(', ')}`
    }
  };
}
