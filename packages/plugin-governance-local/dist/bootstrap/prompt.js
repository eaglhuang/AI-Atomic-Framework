export function createContinuationSummaryRecord(input) {
    return {
        summaryId: input.summaryId,
        workItemId: input.workItemId,
        summary: input.summary,
        nextActions: [...input.nextActions],
        generatedAt: input.generatedAt,
        artifactPaths: uniqueNormalizedPaths(input.artifactPaths),
        evidencePaths: uniqueNormalizedPaths(input.evidencePaths),
        reportPaths: uniqueNormalizedPaths(input.reportPaths),
        authoredBy: input.authoredBy,
        handoffKind: input.handoffKind ?? 'continuation',
        continuationGoal: input.continuationGoal,
        resumePrompt: input.resumePrompt,
        resumeCommand: input.resumeCommand ? [...input.resumeCommand] : undefined,
        budgetDecision: input.budgetDecision,
        hardStop: input.hardStop
    };
}
export function createContinuationRunReport(reportId, input) {
    return {
        schemaVersion: 'atm.continuationContract.v0.1',
        reportId,
        generatedAt: input.generatedAt,
        workItemId: input.workItemId,
        handoffKind: input.handoffKind ?? 'continuation',
        summary: input.summary,
        nextActions: [...input.nextActions],
        artifactPaths: uniqueNormalizedPaths(input.artifactPaths),
        evidencePaths: uniqueNormalizedPaths(input.evidencePaths),
        reportPaths: uniqueNormalizedPaths(input.reportPaths),
        continuationGoal: input.continuationGoal ?? null,
        resumePrompt: input.resumePrompt ?? null,
        resumeCommand: input.resumeCommand ? [...input.resumeCommand] : [],
        budgetDecision: input.budgetDecision ?? 'pass',
        hardStop: input.hardStop === true,
        authoredBy: input.authoredBy ?? null
    };
}
export function renderContextSummaryMarkdown(summary) {
    const lines = [
        `# ${summary.workItemId} Continuation Summary`,
        '',
        summary.summary,
        ''
    ];
    if (summary.handoffKind) {
        lines.push(`- Handoff kind: ${summary.handoffKind}`);
    }
    if (summary.budgetDecision) {
        lines.push(`- Budget decision: ${summary.budgetDecision}`);
    }
    if (summary.continuationGoal) {
        lines.push(`- Goal: ${summary.continuationGoal}`);
    }
    if (summary.resumePrompt) {
        lines.push(`- Resume prompt: ${summary.resumePrompt}`);
    }
    if (summary.resumeCommand && summary.resumeCommand.length > 0) {
        lines.push(`- Resume command: ${summary.resumeCommand.join(' ')}`);
    }
    if (lines[lines.length - 1] !== '') {
        lines.push('');
    }
    lines.push('## Next Actions', '');
    for (const action of summary.nextActions) {
        lines.push(`- ${action}`);
    }
    lines.push('');
    if (summary.artifactPaths && summary.artifactPaths.length > 0) {
        lines.push('## Artifacts', '');
        for (const artifactPath of summary.artifactPaths) {
            lines.push(`- ${artifactPath}`);
        }
        lines.push('');
    }
    if (summary.evidencePaths && summary.evidencePaths.length > 0) {
        lines.push('## Evidence', '');
        for (const evidencePath of summary.evidencePaths) {
            lines.push(`- ${evidencePath}`);
        }
        lines.push('');
    }
    if (summary.reportPaths && summary.reportPaths.length > 0) {
        lines.push('## Reports', '');
        for (const reportPath of summary.reportPaths) {
            lines.push(`- ${reportPath}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}
function uniqueNormalizedPaths(paths) {
    if (!paths || paths.length === 0) {
        return undefined;
    }
    return [...new Set(paths.map((entry) => normalizeRelativePath(entry)).filter((entry) => entry.length > 0))];
}
function normalizeRelativePath(filePath) {
    return String(filePath || '').replace(/\\/g, '/');
}
