export function checkGuardJustification(input) {
    const missingJustifications = [];
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
