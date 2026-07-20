export function resolveSummaryFields() {
    return ['taskId', 'status', 'claimedByActor', 'allowedFilesCount', 'nextAction'];
}
export function projectFields(result, fields) {
    const projectedEvidence = {};
    if (result.evidence) {
        for (const field of fields) {
            const trimmed = field.trim();
            if (trimmed && trimmed in result.evidence) {
                projectedEvidence[trimmed] = result.evidence[trimmed];
            }
        }
    }
    const resultAny = result;
    return {
        ok: result.ok,
        command: result.command,
        mode: result.mode,
        cwd: result.cwd,
        messages: result.messages,
        ...(resultAny.warnings ? { warnings: resultAny.warnings } : {}),
        evidence: projectedEvidence
    };
}
export function projectSummary(result) {
    const summaryFields = resolveSummaryFields();
    const projected = projectFields(result, summaryFields);
    if (projected.evidence && projected.evidence.nextAction) {
        const nextAction = projected.evidence.nextAction;
        if (nextAction && typeof nextAction === 'object') {
            projected.evidence.nextAction = {
                code: nextAction.code ?? null
            };
        }
    }
    return projected;
}
