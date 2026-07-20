import { existsSync, readFileSync } from 'node:fs';
import { CliError } from '../shared.js';
export function evaluateOversizedExtractionClaimAdmission(input) {
    if (input.report.ok || input.report.context.gate !== 'claim') {
        return { allowed: false, reason: 'not-a-claim-line-budget-violation', metadata: {} };
    }
    const task = readTaskDocument(input.taskPath);
    const intent = classifyExtractionIntent(task);
    if (!intent.declared) {
        return {
            allowed: false,
            reason: 'task-does-not-declare-extraction-intent',
            metadata: { taskId: input.taskId, hardViolations: input.report.hardViolations }
        };
    }
    return {
        allowed: true,
        reason: 'claim-stage-extraction-pathway',
        metadata: {
            schemaId: 'atm.oversizedExtractionClaimAdmission.v1',
            taskId: input.taskId,
            declaration: intent.declaration,
            hardViolations: input.report.hardViolations,
            enforcementBoundary: 'claim-only; pre-close and commit line-budget gates remain enforced'
        }
    };
}
export function assertClaimLineBudgetOrExtractionAdmission(input) {
    const decision = evaluateOversizedExtractionClaimAdmission(input);
    if (!input.report.ok && !decision.allowed) {
        throw new CliError('ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED', `Claim blocked: touched files exceed the physical line budget for ${input.taskId}.`, { exitCode: 1, details: input.report });
    }
    return decision.allowed ? decision.metadata : null;
}
function readTaskDocument(taskPath) {
    if (!existsSync(taskPath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(taskPath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
function classifyExtractionIntent(task) {
    if (!task)
        return { declared: false, declaration: {} };
    const atomizationImpact = readRecord(task.atomizationImpact);
    const extractionCandidates = Array.isArray(atomizationImpact?.extractionCandidates)
        ? atomizationImpact.extractionCandidates.filter((entry) => readRecord(entry)?.disposition === 'extract')
        : [];
    if (extractionCandidates.length > 0) {
        return {
            declared: true,
            declaration: {
                source: 'atomizationImpact.extractionCandidates',
                extractionCandidateCount: extractionCandidates.length
            }
        };
    }
    const proposalAdmission = readRecord(task.proposalAdmission);
    const proposalNotes = typeof proposalAdmission?.notes === 'string' ? proposalAdmission.notes : '';
    const title = typeof task.title === 'string' ? task.title : '';
    const notes = typeof task.notes === 'string' ? task.notes : '';
    const text = `${title}\n${notes}\n${proposalNotes}`.toLowerCase();
    const declaredByText = /\b(extraction|extract|refactor|split|atomization|oversized-file|line-budget)\b/.test(text);
    return {
        declared: declaredByText,
        declaration: declaredByText ? { source: 'task-text', matchedTerms: true } : {}
    };
}
function readRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
