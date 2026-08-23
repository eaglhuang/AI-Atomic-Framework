/**
 * import-card-contract-validation.ts
 *
 * ATM-GOV-0406 bounded extraction from import-orchestrator.ts.
 *
 * One cohesive unit: everything the single-card import path checks about a
 * card's declared contracts before any ledger file is written — the causal
 * validator contract, the hard-causal dependency contract, and the frontmatter
 * fidelity round-trip. They run together on the same parsed card, share the
 * same frontmatter, and all three fail closed into the same diagnostics list,
 * so they belong in one module rather than inline in the orchestrator body.
 */
import { buildContractImportRecoveryManifest } from './contract-import-recovery.js';
import { validateHardCausalDependencyImport } from './dependency-gate.js';
import { buildTaskFrontmatterFidelityDiagnostics } from './task-frontmatter-fidelity.js';
import { normalizeTaskCausalGraphContract, validateCausalValidatorContractImport } from './task-import-validators.js';
/**
 * TASK-SKL-0029 — when a single card fails its validation contract, carry the
 * executable recovery manifest (missing contract/case/group fields + one
 * dry-run recovery command) into the structured import failure the caller
 * raises.
 */
export function applySingleCardContractValidation(input) {
    let parsed = input.parsed;
    if (parsed.tasks.length !== 1) {
        return { parsed, contractRecovery: null };
    }
    const causalFrontmatter = input.causalFrontmatter ?? null;
    const task = parsed.tasks[0];
    const causalGraph = normalizeTaskCausalGraphContract(causalFrontmatter?.causalGraph ?? causalFrontmatter?.causal_graph);
    const causalValidation = validateCausalValidatorContractImport({
        frontmatter: causalFrontmatter,
        validators: task.validators ?? [],
        acceptance: task.acceptance ?? [],
        causalImpactEdges: causalGraph.causalImpactEdges
    });
    const contractRecovery = buildContractImportRecoveryManifest({
        validation: causalValidation,
        taskId: task.workItemId,
        planPath: input.planPath
    });
    for (const diagnostic of causalValidation.diagnostics) {
        if (diagnostic.severity === 'error') {
            parsed.diagnostics.push({
                level: 'error',
                code: diagnostic.code,
                text: diagnostic.message,
                workItemId: task.workItemId
            });
        }
    }
    parsed = {
        ...parsed,
        tasks: parsed.tasks.map((entry) => ({
            ...entry,
            causalGraph,
            testContributions: causalValidation.fields.testContributions,
            requiredTestCaseIds: causalValidation.fields.requiredTestCaseIds,
            phaseTestCaseIds: causalValidation.fields.phaseTestCaseIds,
            advisoryTestCaseIds: causalValidation.fields.advisoryTestCaseIds,
            ...(causalValidation.fields.legacyProjection.length > 0
                ? { legacyValidatorProjection: causalValidation.fields.legacyProjection }
                : {}),
            importDiagnostics: [
                ...(entry.importDiagnostics ?? []),
                ...causalValidation.diagnostics
            ]
        }))
    };
    // ATM-GOV-0406: a declared dependency freezes another lane, so the
    // declaration carries its own proof. A card that opts into typed semantics
    // must state all six hard-causal facts for every edge it wants treated as
    // blocking; a stated-then-denied fact, an untyped fallback, and an unknown
    // relation each fail closed here rather than reaching the ledger with a
    // meaning nobody can reconstruct. Legacy cards are untouched.
    const dependencyValidation = validateHardCausalDependencyImport({
        taskId: task.workItemId,
        taskDocument: parsed.tasks[0],
        cwd: input.cwd
    });
    for (const diagnostic of dependencyValidation.diagnostics) {
        parsed.diagnostics.push({
            level: 'error',
            code: diagnostic.code,
            text: `${diagnostic.message} Recovery: ${diagnostic.requiredCommand}`,
            workItemId: diagnostic.taskId
        });
    }
    parsed = {
        ...parsed,
        tasks: parsed.tasks.map((entry) => ({
            ...entry,
            dependencyClassification: {
                schemaId: 'atm.taskDependencyClassification.v1',
                semantics: dependencyValidation.semantics,
                edges: dependencyValidation.edges
            }
        }))
    };
    // ATM-GOV-0276: a card's machine-readable declarations must round-trip into
    // the record both surfaces share, or import fails closed here — before the
    // dry-run manifest is reported and before any ledger file is written.
    const fidelity = buildTaskFrontmatterFidelityDiagnostics({
        frontmatter: causalFrontmatter,
        record: parsed.tasks[0],
        planText: input.planText,
        workItemId: task.workItemId
    });
    parsed.diagnostics.push(...fidelity.diagnostics);
    parsed = {
        ...parsed,
        tasks: parsed.tasks.map((entry) => ({ ...entry, frontmatterFidelity: fidelity.report }))
    };
    return { parsed, contractRecovery };
}
