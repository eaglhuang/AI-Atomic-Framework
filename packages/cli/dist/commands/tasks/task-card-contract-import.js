/**
 * task-card-contract-import.ts
 *
 * ATM-GOV-0406 bounded extraction from task-import-validators.ts.
 *
 * One cohesive unit: the two card-contract import validators that read a task
 * card's declared testing obligations — the causal validator contract
 * (TASK-SKL-0022) and the TDD card contract — together with the coverage-alias
 * helpers both of them share.
 *
 * The public surface is unchanged: task-import-validators.ts re-exports every
 * symbol below, so existing importers keep their import path.
 */
import { isTddMode, parseTddMode } from '../../../../core/dist/evidence/tdd-cycle.js';
import { isBroadSuiteCommandOrKey, projectLegacyCommandValidators } from '../test-catalog.js';
import { normalizeOptionalString, normalizeTaskCausalGraphContract, parseYamlList } from './task-import-validators.js';
export function parseCausalValidatorCardFields(input) {
    const data = input.frontmatter && typeof input.frontmatter === 'object' ? input.frontmatter : {};
    const testContributions = parseTestContributions(data.testContributions ?? data.test_contributions);
    const requiredTestCaseIds = uniqueStrings(parseYamlList(data.requiredTestCaseIds ?? data.required_test_case_ids));
    const phaseTestCaseIds = uniqueStrings(parseYamlList(data.phaseTestCaseIds ?? data.phase_test_case_ids));
    const advisoryTestCaseIds = uniqueStrings(parseYamlList(data.advisoryTestCaseIds ?? data.advisory_test_case_ids));
    const legacyValidators = uniqueStrings(input.validators ?? parseYamlList(data.validators));
    const usesCausalContract = testContributions.length > 0
        || requiredTestCaseIds.length > 0
        || phaseTestCaseIds.length > 0
        || advisoryTestCaseIds.length > 0;
    return {
        testContributions,
        requiredTestCaseIds,
        phaseTestCaseIds,
        advisoryTestCaseIds,
        legacyValidators,
        legacyProjection: usesCausalContract ? [] : projectLegacyCommandValidators(legacyValidators),
        usesCausalContract
    };
}
export function validateCausalValidatorContractImport(input) {
    const fields = parseCausalValidatorCardFields(input);
    const diagnostics = [];
    const errors = [];
    const acceptance = uniqueStrings(input.acceptance ?? []);
    const impactEdges = uniqueStrings(input.causalImpactEdges
        ?? normalizeTaskCausalGraphContract(input.frontmatter?.causalGraph ?? input.frontmatter?.causal_graph).causalImpactEdges);
    if (!fields.usesCausalContract) {
        if (fields.legacyProjection.length > 0) {
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_LEGACY_VALIDATOR_PROJECTION',
                severity: 'warning',
                field: 'validators',
                message: `Command-only validators were projected to ${fields.legacyProjection.length} advisory legacy case id(s) for migration. Prefer requiredTestCaseIds / testContributions for new cards.`
            });
        }
        return { fields, diagnostics, errors };
    }
    const contributionCaseIds = new Set(fields.testContributions.map((entry) => entry.caseId));
    const resolvableRequired = new Set([
        ...contributionCaseIds,
        ...fields.requiredTestCaseIds
    ]);
    for (const caseId of fields.requiredTestCaseIds) {
        if (!contributionCaseIds.has(caseId) && !looksLikeCaseId(caseId)) {
            const text = `requiredTestCaseIds entry "${caseId}" is not a resolvable case id`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_REQUIRED_CASE_UNRESOLVED',
                severity: 'error',
                field: 'requiredTestCaseIds',
                message: text
            });
        }
    }
    if (acceptance.length > 0 || impactEdges.length > 0) {
        if (fields.requiredTestCaseIds.length === 0 && fields.testContributions.length === 0) {
            const text = 'Acceptance criteria or causal impact edges require resolvable required test cases';
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_REQUIRED_CASE_MISSING',
                severity: 'error',
                field: 'requiredTestCaseIds',
                message: text
            });
        }
    }
    for (const [index, criterion] of acceptance.entries()) {
        const aliases = acceptanceAliases(criterion, index);
        const covered = fields.testContributions.some((entry) => entry.coversAcceptance.some((token) => aliases.has(normalizeCoverageToken(token)))) || (fields.requiredTestCaseIds.length > 0 && fields.testContributions.length === 0);
        if (!covered && fields.testContributions.length > 0) {
            const text = `Acceptance criterion "${criterion}" has no resolvable required case coverage`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_ACCEPTANCE_CASE_UNRESOLVED',
                severity: 'error',
                field: 'testContributions',
                message: text
            });
        }
    }
    for (const edge of impactEdges) {
        const covered = fields.testContributions.some((entry) => entry.coversImpactEdges.some((token) => normalizeCoverageToken(token) === normalizeCoverageToken(edge))) || (fields.requiredTestCaseIds.length > 0 && fields.testContributions.length === 0);
        if (!covered && fields.testContributions.length > 0) {
            const text = `Causal impact edge "${edge}" has no resolvable required case coverage`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_IMPACT_EDGE_CASE_UNRESOLVED',
                severity: 'error',
                field: 'testContributions',
                message: text
            });
        }
    }
    for (const contribution of fields.testContributions) {
        if (contribution.responsibility !== 'task-required')
            continue;
        const suiteLike = isBroadSuiteCommandOrKey(contribution.caseId)
            || (contribution.semanticKey ? isBroadSuiteCommandOrKey(contribution.semanticKey) : false);
        const hasEdge = Boolean(contribution.dependencyEdge || contribution.contractEdge || contribution.resourceKey || contribution.contributionResourceKey);
        if (suiteLike && !hasEdge) {
            const text = `Full-suite case "${contribution.caseId}" cannot be task-required without a dependency, contract, or resource edge`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_TASK_REQUIRED_FULL_SUITE_WITHOUT_EDGE',
                severity: 'error',
                field: 'testContributions',
                message: text
            });
        }
    }
    for (const caseId of fields.requiredTestCaseIds) {
        if (!isBroadSuiteCommandOrKey(caseId))
            continue;
        const contribution = fields.testContributions.find((entry) => entry.caseId === caseId);
        const hasEdge = Boolean(contribution?.dependencyEdge
            || contribution?.contractEdge
            || contribution?.resourceKey
            || contribution?.contributionResourceKey);
        if (!hasEdge) {
            const text = `Full-suite requiredTestCaseId "${caseId}" cannot be task-required without a dependency, contract, or resource edge`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_TASK_REQUIRED_FULL_SUITE_WITHOUT_EDGE',
                severity: 'error',
                field: 'requiredTestCaseIds',
                message: text
            });
        }
    }
    if (resolvableRequired.size === 0 && (acceptance.length > 0 || impactEdges.length > 0)) {
        const text = 'Declared acceptance or impact edges lack resolvable required case ids';
        if (!errors.includes(text)) {
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_REQUIRED_CASE_MISSING',
                severity: 'error',
                field: 'requiredTestCaseIds',
                message: text
            });
        }
    }
    return { fields, diagnostics, errors };
}
function parseTestContributions(raw) {
    let source = raw;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            source = JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(source))
        return [];
    const items = [];
    for (const entry of source) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            continue;
        const record = entry;
        const caseId = normalizeOptionalString(record.caseId ?? record.case_id);
        if (!caseId)
            continue;
        const responsibilityRaw = normalizeOptionalString(record.responsibility) ?? 'task-required';
        const responsibility = responsibilityRaw === 'phase-suite' || responsibilityRaw === 'advisory'
            ? responsibilityRaw
            : 'task-required';
        items.push({
            caseId,
            targetGroupId: normalizeOptionalString(record.targetGroupId ?? record.target_group_id),
            semanticKey: normalizeOptionalString(record.semanticKey ?? record.semantic_key),
            coversAcceptance: uniqueStrings(parseYamlList(record.coversAcceptance ?? record.covers_acceptance)),
            coversImpactEdges: uniqueStrings(parseYamlList(record.coversImpactEdges ?? record.covers_impact_edges)),
            expectedRedPredicate: normalizeOptionalString(record.expectedRedPredicate ?? record.expected_red_predicate),
            contributionResourceKey: normalizeOptionalString(record.contributionResourceKey ?? record.contribution_resource_key),
            responsibility,
            dependencyEdge: normalizeOptionalString(record.dependencyEdge ?? record.dependency_edge),
            contractEdge: normalizeOptionalString(record.contractEdge ?? record.contract_edge),
            resourceKey: normalizeOptionalString(record.resourceKey ?? record.resource_key)
        });
    }
    return items;
}
export function parseTddCardFields(input) {
    const data = input.frontmatter && typeof input.frontmatter === 'object' ? input.frontmatter : {};
    return {
        tddMode: parseTddMode(data.tddMode ?? data.tdd_mode),
        tddNotApplicableReason: normalizeOptionalString(data.tddNotApplicableReason ?? data.tdd_not_applicable_reason ?? data.tddNaReason),
        tddExemptions: parseTddExemptions(data.tddExemptions ?? data.tdd_exemptions)
    };
}
export function validateTddCardImport(input) {
    const fields = parseTddCardFields(input);
    const diagnostics = [];
    const errors = [];
    const rawMode = input.frontmatter?.tddMode ?? input.frontmatter?.tdd_mode;
    if (rawMode != null && rawMode !== '' && !fields.tddMode) {
        const text = `tddMode "${String(rawMode)}" is invalid; expected required|recommended|reasoned-not-applicable`;
        errors.push(text);
        diagnostics.push({
            code: 'ATM_TASK_IMPORT_TDD_MODE_INVALID',
            severity: 'error',
            field: 'tddMode',
            message: text
        });
    }
    if (fields.tddMode === 'reasoned-not-applicable' && !fields.tddNotApplicableReason) {
        const text = 'tddMode reasoned-not-applicable requires tddNotApplicableReason';
        errors.push(text);
        diagnostics.push({
            code: 'ATM_TASK_IMPORT_TDD_NA_REASON_REQUIRED',
            severity: 'error',
            field: 'tddNotApplicableReason',
            message: text
        });
    }
    for (const exemption of fields.tddExemptions) {
        if (!exemption.caseId) {
            const text = 'tddExemptions entry is missing caseId';
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_TDD_EXEMPTION_INVALID',
                severity: 'error',
                field: 'tddExemptions',
                message: text
            });
            continue;
        }
        if ((exemption.kind === 'mechanical' || exemption.kind === 'docs') && !exemption.reviewed) {
            const text = `tddExemption ${exemption.caseId} (${exemption.kind}) must be reviewed before import`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_TDD_EXEMPTION_UNREVIEWED',
                severity: 'error',
                field: 'tddExemptions',
                message: text
            });
        }
        if (!exemption.reason) {
            const text = `tddExemption ${exemption.caseId} requires a reason`;
            errors.push(text);
            diagnostics.push({
                code: 'ATM_TASK_IMPORT_TDD_EXEMPTION_INVALID',
                severity: 'error',
                field: 'tddExemptions',
                message: text
            });
        }
    }
    if (fields.tddMode && !isTddMode(fields.tddMode)) {
        const text = 'tddMode failed typed validation';
        errors.push(text);
        diagnostics.push({
            code: 'ATM_TASK_IMPORT_TDD_MODE_INVALID',
            severity: 'error',
            field: 'tddMode',
            message: text
        });
    }
    return { fields, diagnostics, errors };
}
function parseTddExemptions(raw) {
    let source = raw;
    if (typeof raw === 'string' && raw.trim()) {
        try {
            source = JSON.parse(raw);
        }
        catch {
            return [];
        }
    }
    if (!Array.isArray(source))
        return [];
    const items = [];
    for (const entry of source) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            continue;
        const record = entry;
        const caseId = normalizeOptionalString(record.caseId ?? record.case_id);
        const kindRaw = normalizeOptionalString(record.kind);
        const kind = (kindRaw === 'mechanical'
            || kindRaw === 'docs'
            || kindRaw === 'advisory'
            || kindRaw === 'quarantined')
            ? kindRaw
            : null;
        if (!caseId || !kind)
            continue;
        items.push({
            caseId,
            kind,
            reason: normalizeOptionalString(record.reason) ?? '',
            reviewed: record.reviewed === true || record.reviewed === 'true',
            reviewActorId: normalizeOptionalString(record.reviewActorId ?? record.review_actor_id)
        });
    }
    return items;
}
function uniqueStrings(values) {
    return [...new Set(values.map((entry) => String(entry ?? '').trim()).filter(Boolean))];
}
function looksLikeCaseId(value) {
    return /^(test_int_|test_task_|legacy_cmd_)[A-Za-z0-9_.:-]+$/.test(value);
}
function normalizeCoverageToken(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function acceptanceAliases(criterion, index) {
    const aliases = new Set([
        normalizeCoverageToken(criterion),
        `acc-${index + 1}`,
        `acceptance-${index + 1}`
    ]);
    const explicit = /^(ACC[-_ ]?\d+)\b/i.exec(criterion.trim());
    if (explicit)
        aliases.add(normalizeCoverageToken(explicit[1].replace(/\s+/g, '-')));
    return aliases;
}
