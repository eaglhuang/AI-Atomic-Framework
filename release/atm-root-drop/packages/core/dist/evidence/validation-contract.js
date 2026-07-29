// atm.causal-validator-selector — Selection Policy (the pure evaluator).
//
// evaluateValidationContract() is the single evaluator that decides the smallest
// sound task-required case set from explicit references and causal impact edges,
// plus the advisory and phase-suite sets, exact executable manifests,
// deterministic causal reasons for every selection and omission, phase owners,
// freshness inputs and unknown-boundary diagnostics. Runner and batch adapters
// delegate required-set computation here instead of each recomputing their own;
// a missing evaluator makes required validation fail closed rather than
// defaulting to a full run. It never executes commands and never mutates
// evidence. The decentralized shard machinery it can consume lives in
// packages/core/src/evidence/test-case-catalog.ts.
export const VALIDATION_CONTRACT_EVALUATION_SCHEMA_ID = 'atm.validationContractEvaluation.v1';
const BROAD_SUITE_PATTERN = /^(npm run )?(typecheck|lint|validate:cli|validate:schemas|test|validate:all)\b|\.static\.all\b|\btier[:=]full\b|^(language|integration)\.[a-z0-9_.-]+\.(all|full)$/;
function isBroadSuiteRef(value, broadSuite) {
    if (broadSuite === true)
        return true;
    const normalized = String(value || '').trim().toLowerCase().replace(/\\/g, '/');
    return normalized ? BROAD_SUITE_PATTERN.test(normalized) : false;
}
export function evaluateValidationContract(task, changeSet, catalog, evidence = {}) {
    const caseIndex = new Map();
    for (const entry of catalog.cases ?? []) {
        if (entry?.caseId)
            caseIndex.set(entry.caseId, entry);
    }
    const contributionIndex = new Map();
    for (const entry of task.testContributions ?? []) {
        if (entry?.caseId)
            contributionIndex.set(entry.caseId, entry);
    }
    const impactCone = new Set(normalizeStringList(task.causalGraph?.causalImpactEdges));
    const riskTier = changeSet.riskTier ?? 'low';
    const requiredIds = normalizeStringList(task.requiredTestCaseIds);
    const phaseIds = normalizeStringList(task.phaseTestCaseIds);
    const advisoryIds = normalizeStringList(task.advisoryTestCaseIds);
    const omissions = [];
    const diagnostics = [];
    const resolveSelection = (caseId, responsibility, deepenedFromCone = false) => {
        const catalogCase = caseIndex.get(caseId);
        const contribution = contributionIndex.get(caseId);
        const coversAcceptance = uniqueSorted([
            ...normalizeStringList(catalogCase?.coversAcceptance),
            ...normalizeStringList(contribution?.coversAcceptance)
        ]);
        const coversImpactEdges = uniqueSorted([
            ...normalizeStringList(catalogCase?.coversImpactEdges),
            ...normalizeStringList(contribution?.coversImpactEdges)
        ]);
        const command = firstNonEmpty([catalogCase?.command, contribution?.command]);
        const broad = isBroadSuiteRef(caseId, catalogCase?.broadSuite);
        const dependencyDeclared = Boolean(contribution?.dependencyEdge || contribution?.contractEdge);
        const withinImpactCone = coversImpactEdges.length === 0
            ? impactCone.size === 0
            : coversImpactEdges.some((edge) => impactCone.has(edge));
        const executable = Boolean(command) && (!broad || dependencyDeclared || responsibility !== 'task-required');
        if (responsibility === 'task-required' && broad && !dependencyDeclared) {
            diagnostics.push({
                code: 'ATM_VALIDATION_CONTRACT_TASK_REQUIRED_FULL_SUITE_WITHOUT_EDGE',
                severity: 'error',
                message: `Task-required case ${caseId} maps to a broad suite without a declared dependency/contract edge; required validation fails closed instead of running the full repository.`,
                needsClarification: true,
                ref: caseId
            });
        }
        if (!command) {
            diagnostics.push({
                code: 'ATM_VALIDATION_CONTRACT_CASE_MANIFEST_UNRESOLVED',
                severity: responsibility === 'task-required' ? 'error' : 'warning',
                message: `Case ${caseId} has no executable manifest in the resolved catalog or task contributions.`,
                needsClarification: responsibility === 'task-required',
                ref: caseId
            });
        }
        const reasonParts = [];
        reasonParts.push(`selected as ${responsibility}`);
        if (deepenedFromCone)
            reasonParts.push('deepened by high risk inside the proven impact cone');
        if (coversAcceptance.length > 0)
            reasonParts.push(`covers acceptance ${coversAcceptance.join(', ')}`);
        if (coversImpactEdges.length > 0)
            reasonParts.push(`covers impact edges ${coversImpactEdges.join(', ')}`);
        if (coversAcceptance.length === 0 && coversImpactEdges.length === 0) {
            reasonParts.push('explicitly referenced by the task contract');
        }
        return {
            caseId,
            responsibility,
            command: command ?? null,
            causalReason: reasonParts.join('; '),
            coversAcceptance,
            coversImpactEdges,
            phase: firstNonEmpty([contribution?.phase, catalogCase?.phase]) ?? null,
            withinImpactCone,
            executable
        };
    };
    const required = requiredIds.map((caseId) => resolveSelection(caseId, 'task-required'));
    const phaseSuite = phaseIds.map((caseId) => resolveSelection(caseId, 'phase-suite'));
    const advisory = advisoryIds.map((caseId) => resolveSelection(caseId, 'advisory'));
    // High risk deepens testing only inside the proven impact cone: promote
    // advisory cases whose impact edges fall within the cone to required, never
    // pulling in cases outside the cone.
    const requiredIdSet = new Set(requiredIds);
    if (riskTier === 'high' && impactCone.size > 0) {
        for (const candidate of advisory) {
            if (requiredIdSet.has(candidate.caseId))
                continue;
            if (candidate.withinImpactCone && candidate.coversImpactEdges.length > 0) {
                required.push(resolveSelection(candidate.caseId, 'task-required', true));
                requiredIdSet.add(candidate.caseId);
            }
            else {
                omissions.push({
                    ref: candidate.caseId,
                    kind: 'case',
                    reason: 'high-risk deepening skipped: case lies outside the proven impact cone'
                });
            }
        }
    }
    // Fail closed: a task with a change set but no resolvable required contract
    // must not default to a full-repository run.
    const hasChange = normalizeStringList(changeSet.changedFiles).length > 0;
    const executableRequired = required.filter((entry) => entry.executable);
    let failClosed = false;
    if (required.length === 0 && hasChange) {
        failClosed = true;
        diagnostics.push({
            code: 'ATM_VALIDATION_CONTRACT_MISSING_REQUIRED_SET',
            severity: 'error',
            message: 'Change set present but the task declares no resolvable required test cases; required validation fails closed rather than running the full repository.',
            needsClarification: true,
            ref: null
        });
    }
    if (required.length > 0 && executableRequired.length === 0) {
        failClosed = true;
    }
    // Unknown boundaries: changed files not mapped to any impact edge or case
    // path trigger request clarification instead of silently widening the run.
    const knownTriggers = [];
    for (const entry of catalog.cases ?? []) {
        for (const pattern of normalizeStringList(entry.pathTriggers)) {
            knownTriggers.push({ pattern, caseId: entry.caseId });
        }
    }
    const declaredEdges = new Set([...impactCone, ...normalizeStringList(changeSet.declaredImpactEdges)]);
    for (const changedFile of normalizeStringList(changeSet.changedFiles)) {
        const matched = knownTriggers.some((trigger) => matchesPattern(trigger.pattern, changedFile));
        if (!matched && declaredEdges.size === 0) {
            diagnostics.push({
                code: 'ATM_VALIDATION_CONTRACT_UNKNOWN_BOUNDARY',
                severity: 'warning',
                message: `Changed file ${changedFile} maps to no known impact edge or case path trigger; requesting scope/impact clarification instead of running the full repository.`,
                needsClarification: true,
                ref: changedFile
            });
            omissions.push({
                ref: changedFile,
                kind: 'changed-path',
                reason: 'no impact edge or case path trigger matched; clarification requested'
            });
        }
    }
    // Omissions with deterministic causal reasons for every catalog case that was
    // not selected as task-required.
    const selectedIds = new Set([
        ...required.map((entry) => entry.caseId),
        ...phaseSuite.map((entry) => entry.caseId),
        ...advisory.map((entry) => entry.caseId)
    ]);
    for (const entry of catalog.cases ?? []) {
        if (selectedIds.has(entry.caseId))
            continue;
        const edges = normalizeStringList(entry.coversImpactEdges);
        const inCone = edges.some((edge) => impactCone.has(edge));
        omissions.push({
            ref: entry.caseId,
            kind: 'case',
            reason: inCone
                ? 'within the impact cone but not referenced by the task-required contract'
                : 'no causal relationship to the declared impact edges or required contract'
        });
    }
    // Acceptance criteria not covered by any selected case are omissions too.
    const coveredAcceptance = new Set();
    for (const entry of [...required, ...phaseSuite]) {
        for (const acc of entry.coversAcceptance)
            coveredAcceptance.add(acc);
    }
    for (const acc of normalizeStringList(task.acceptance)) {
        const accId = acc.split(/\s+/)[0];
        if (accId && !coveredAcceptance.has(accId)) {
            omissions.push({
                ref: accId,
                kind: 'acceptance',
                reason: 'acceptance criterion not covered by any selected required or phase-suite case'
            });
        }
    }
    const freshnessInputs = computeFreshnessInputs([...required, ...phaseSuite], evidence);
    const phaseOwners = groupPhaseOwners(phaseSuite);
    const catalogCaseCount = (catalog.cases ?? []).length;
    const requiredCaseIds = uniqueSorted(required.map((entry) => entry.caseId));
    const advisoryCaseIds = uniqueSorted(advisory.map((entry) => entry.caseId));
    const phaseCaseIds = uniqueSorted(phaseSuite.map((entry) => entry.caseId));
    const executableManifests = [...required, ...phaseSuite, ...advisory]
        .filter((entry) => entry.command)
        .map((entry) => ({ caseId: entry.caseId, command: entry.command, responsibility: entry.responsibility }));
    return {
        schemaId: VALIDATION_CONTRACT_EVALUATION_SCHEMA_ID,
        specVersion: '0.1.0',
        evaluatorId: 'atm.causal-validator-selector',
        failClosed,
        required,
        advisory,
        phaseSuite,
        requiredCaseIds,
        advisoryCaseIds,
        phaseCaseIds,
        executableManifests,
        causalReasons: [...required, ...phaseSuite, ...advisory].map((entry) => ({ caseId: entry.caseId, reason: entry.causalReason })),
        omissions,
        phaseOwners,
        freshnessInputs,
        unknownBoundaryDiagnostics: diagnostics,
        metrics: {
            catalogCaseCount,
            requiredCount: required.length,
            advisoryCount: advisory.length,
            phaseCount: phaseSuite.length,
            selectionRatio: catalogCaseCount > 0 ? Number((required.length / catalogCaseCount).toFixed(4)) : 0,
            impactConeEdgeCount: impactCone.size,
            riskTier,
            unknownBoundaryCount: diagnostics.filter((entry) => entry.code === 'ATM_VALIDATION_CONTRACT_UNKNOWN_BOUNDARY').length,
            omittedCount: omissions.length
        }
    };
}
function computeFreshnessInputs(selections, evidence) {
    const receipts = new Map();
    for (const receipt of evidence.receipts ?? []) {
        if (receipt?.caseId)
            receipts.set(receipt.caseId, receipt);
    }
    const nowMs = evidence.now ? Date.parse(evidence.now) : Date.now();
    const expectedHead = evidence.gitHead ?? null;
    const seen = new Set();
    const inputs = [];
    for (const selection of selections) {
        if (seen.has(selection.caseId))
            continue;
        seen.add(selection.caseId);
        const receipt = receipts.get(selection.caseId);
        if (!receipt) {
            inputs.push({ caseId: selection.caseId, status: 'missing', reason: 'no validation receipt for this case', receiptGitHead: null });
            continue;
        }
        const receiptHead = receipt.gitHead ?? null;
        if (String(receipt.status ?? '').toLowerCase() === 'failed') {
            inputs.push({ caseId: selection.caseId, status: 'failed', reason: 'receipt records a failed result', receiptGitHead: receiptHead });
            continue;
        }
        if (expectedHead && receiptHead && expectedHead !== receiptHead) {
            inputs.push({ caseId: selection.caseId, status: 'stale', reason: `receipt git head ${receiptHead} differs from expected ${expectedHead}`, receiptGitHead: receiptHead });
            continue;
        }
        if (receipt.freshUntil && Number.isFinite(Date.parse(receipt.freshUntil)) && Date.parse(receipt.freshUntil) < nowMs) {
            inputs.push({ caseId: selection.caseId, status: 'stale', reason: `receipt freshness expired at ${receipt.freshUntil}`, receiptGitHead: receiptHead });
            continue;
        }
        inputs.push({ caseId: selection.caseId, status: 'fresh', reason: 'receipt passed and within freshness bounds', receiptGitHead: receiptHead });
    }
    return inputs;
}
function groupPhaseOwners(phaseSuite) {
    const byPhase = new Map();
    for (const selection of phaseSuite) {
        const phase = selection.phase ?? 'unassigned';
        byPhase.set(phase, [...(byPhase.get(phase) ?? []), selection.caseId]);
    }
    return [...byPhase.entries()]
        .map(([phase, caseIds]) => ({ phase, caseIds: uniqueSorted(caseIds) }))
        .sort((left, right) => left.phase.localeCompare(right.phase));
}
function normalizeStringList(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}
function normalizePath(value) {
    return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}
function matchesPattern(pattern, candidatePath) {
    const escaped = String(pattern || '')
        .replace(/\\/g, '/')
        .replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
        .replace(/\*\*/g, '::DOUBLE_STAR::')
        .replace(/\*/g, '[^/]*')
        .replace(/::DOUBLE_STAR::/g, '.*');
    return new RegExp(`^${escaped}$`, 'i').test(normalizePath(candidatePath));
}
function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort();
}
function firstNonEmpty(values) {
    for (const value of values) {
        const text = typeof value === 'string' ? value.trim() : '';
        if (text)
            return text;
    }
    return null;
}
