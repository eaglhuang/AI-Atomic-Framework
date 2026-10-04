import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createDefaultContextBudgetPolicy, estimateContextBudgetTokens, evaluateContextBudget } from '../../_vendor/plugin-governance-local/dist/bootstrap/budget.js';
import { createContinuationRunReport } from '../../_vendor/plugin-governance-local/dist/bootstrap/prompt.js';
export function isGeneratedReportPath(file) {
    return /^\.atm\/history\/reports\/.+\.json$/.test(file);
}
/** Historical bootstrap outputs are retained, never auto-cleaned. This proves
 * producer consistency, not authenticity of arbitrary user-authored files. */
export function verifiedBootstrapReportOwner(cwd, file) {
    const match = file.match(/^\.atm\/history\/reports\/(?:context-budget\/bootstrap-bootstrap-([A-Za-z0-9_-]+)|continuation\/([A-Za-z0-9_-]+))\.json$/);
    if (!cwd || !match)
        return null;
    const owner = match[1] ?? match[2];
    const budgetPath = `.atm/history/reports/context-budget/bootstrap-bootstrap-${owner}.json`;
    const continuationPath = `.atm/history/reports/continuation/${owner}.json`;
    const evidencePath = `.atm/runtime/evidence-ledger/bundles/${owner}.json`;
    try {
        const read = (relative) => {
            let current = path.resolve(cwd);
            for (const part of relative.split('/')) {
                current = path.join(current, part);
                if (lstatSync(current).isSymbolicLink())
                    throw new Error('symlink');
            }
            const value = JSON.parse(readFileSync(current, 'utf8'));
            if (!value || typeof value !== 'object' || Array.isArray(value))
                throw new Error('record');
            return value;
        };
        const task = read(`.atm/history/tasks/${owner}.json`);
        const evidence = read(evidencePath);
        const summary = read(`.atm/history/handoff/${owner}.json`);
        const probe = read('.atm/runtime/project-probe.json');
        const guards = read('.atm/runtime/default-guards.json');
        const policy = read('.atm/runtime/budget/default-policy.json');
        const budget = read(budgetPath), continuation = read(continuationPath);
        if (task.schemaVersion !== 'atm.workItem.v0.1' || task.id !== owner || task.taskKind !== 'bootstrap'
            || task.evidencePath !== evidencePath || evidence.schemaVersion !== 'atm.evidence.v0.1'
            || evidence.taskId !== owner || evidence.status !== 'seeded'
            || evidence.contextBudgetReportPath !== budgetPath || evidence.continuationReportPath !== continuationPath
            || evidence.contextSummaryPath !== `.atm/history/handoff/${owner}.json`
            || summary.workItemId !== owner || summary.handoffKind !== 'bootstrap'
            || summary.authoredBy !== '@ai-atomic-framework/plugin-governance-local'
            || typeof probe.generatedAt !== 'string' || summary.generatedAt !== probe.generatedAt
            || summary.resumePrompt !== evidence.recommendedPrompt
            || !isDeepStrictEqual(summary.evidencePaths, [evidencePath])
            || !isDeepStrictEqual(summary.reportPaths, [budgetPath, continuationPath]))
            return null;
        // Store initialization may create the same default policy milliseconds
        // before the bootstrap probe. Its timestamp is not the report timestamp.
        if (typeof policy.generatedAt !== 'string' || !Number.isFinite(Date.parse(policy.generatedAt)))
            return null;
        const expectedPolicy = createDefaultContextBudgetPolicy(policy.generatedAt);
        if (!isDeepStrictEqual(policy, expectedPolicy))
            return null;
        const estimatedTokens = estimateContextBudgetTokens(probe, guards, evidence.recommendedPrompt, ['AGENTS.md', path.join('.atm', 'runtime', 'profile', 'default.md'), path.join('.atm', 'history', 'handoff', 'INITIAL_SUMMARY.md')]);
        const evaluation = evaluateContextBudget(expectedPolicy, { budgetId: `bootstrap/${owner}`, workItemId: owner, estimatedTokens, inlineArtifacts: 0 }, probe.generatedAt);
        const expectedBudget = { budgetId: `bootstrap/${owner}`, workItemId: owner, policyId: expectedPolicy.policyId, ...evaluation };
        if (!isDeepStrictEqual(budget, expectedBudget) || evidence.budgetDecision !== evaluation.decision
            || summary.budgetDecision !== evaluation.decision || summary.hardStop !== (evaluation.decision === 'hard-stop'))
            return null;
        if (!isDeepStrictEqual(continuation, createContinuationRunReport(`continuation/${owner}`, summary)))
            return null;
        return owner;
    }
    catch {
        return null;
    }
}
export function isPreservedForeignBootstrapReport(cwd, taskId, file) {
    const owner = verifiedBootstrapReportOwner(cwd, file);
    return owner !== null && owner.toUpperCase() !== taskId?.trim().toUpperCase();
}
