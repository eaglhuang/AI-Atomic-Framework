import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { deriveAtmScopeClass } from '../../_vendor/core/dist/broker/atm-core-scope.js';
import { taskPathFor } from './task-file-io-helpers.js';
import { parseYamlList } from './task-import-validators.js';
import { normalizeWorkItemStatus } from './task-transition-helpers.js';
import { buildDependencyCloseoutBlocker, verifyCloseoutProvenance } from './closeout-provenance.js';
/**
 * ATM-GOV-0406 — Plan 4.1 proven hard-causal dependency contract.
 *
 * A declared dependency is expensive: it freezes a lane that could otherwise
 * run in parallel. The contract below exists so that cost is only paid where it
 * is earned. An edge blocks a claim when, and only when, six facts are all
 * stated about it — a named producer output, a named consumer operation, that
 * the output's *value* changes the consumer's correct result, that no
 * substitute (stable interface, fixture, proposal-first, late binding,
 * deferred compose) removes the need, that the consumer's result is undefined
 * without the output, and an executable negative control.
 *
 * Every other relation a card might want to record — validation, publication,
 * observation, ordering preference, file or atom overlap — stays declarable and
 * stays non-blocking. Overlap is the Broker's problem, handled proposal-first
 * at the write boundary; it is not a reason to freeze a whole task.
 *
 * Classification reads the declaration and nothing else: no task id, family,
 * actor, date, or path participates in the decision.
 */
export const HARD_CAUSAL_DEPENDENCY_SEMANTICS = 'hard-causal/v1';
export const HARD_CAUSAL_FACT_IDS = [
    'producer-output',
    'consumer-operation',
    'output-value-changes-consumer-result',
    'no-substitute-available',
    'result-undefined-without-output',
    'executable-negative-control'
];
export const TASK_DEPENDENCY_RELATIONS = [
    'hard-causal',
    'validation',
    'publication',
    'observation',
    'soft-order',
    'file-overlap',
    'atom-overlap'
];
/** The five substitutes that, if any is available, defeat fact four. */
export const HARD_CAUSAL_SUBSTITUTE_KINDS = [
    'stableInterface',
    'fixture',
    'proposalFirst',
    'lateBinding',
    'deferredCompose'
];
export const TASK_DEPENDENCY_HARD_PROOF_INCOMPLETE_CODE = 'ATM_TASK_DEPENDENCY_HARD_PROOF_INCOMPLETE';
export const TASK_DEPENDENCY_HARD_PROOF_CONTRADICTORY_CODE = 'ATM_TASK_DEPENDENCY_HARD_PROOF_CONTRADICTORY';
export const TASK_DEPENDENCY_UNTYPED_IN_TYPED_CARD_CODE = 'ATM_TASK_DEPENDENCY_UNTYPED_IN_TYPED_CARD';
export const TASK_DEPENDENCY_RELATION_UNKNOWN_CODE = 'ATM_TASK_DEPENDENCY_RELATION_UNKNOWN';
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
const PROVEN = { proven: true, missing: false, contradiction: null };
const MISSING = { proven: false, missing: true, contradiction: null };
function denied(contradiction) {
    return { proven: false, missing: false, contradiction };
}
/** A stated string fact: absent is missing, present but blank is a denial. */
function judgeStringFact(raw, field) {
    if (raw === undefined || raw === null)
        return MISSING;
    return nonEmptyString(raw) ? PROVEN : denied(`${field} is declared but empty`);
}
/** A stated boolean fact: absent is missing, present and false is a denial. */
function judgeAssertedFact(raw, field) {
    if (raw === undefined || raw === null)
        return MISSING;
    if (raw === true)
        return PROVEN;
    if (raw === false)
        return denied(`${field} is declared false, so this edge is not hard-causal`);
    return denied(`${field} must be a boolean`);
}
function judgeSubstitutesFact(raw) {
    const record = asRecord(raw);
    if (!record)
        return MISSING;
    const available = [];
    for (const kind of HARD_CAUSAL_SUBSTITUTE_KINDS) {
        const value = record[kind];
        if (value === undefined || value === null)
            return MISSING;
        if (value === true)
            available.push(kind);
        else if (value !== false)
            return denied(`substitutesAvailable.${kind} must be a boolean`);
    }
    return available.length === 0
        ? PROVEN
        : denied(`a substitute is available (${available.join(', ')}), so the dependency is not hard-causal`);
}
function judgeNegativeControlFact(raw) {
    const record = asRecord(raw);
    if (!record)
        return MISSING;
    if (!nonEmptyString(record.command))
        return denied('negativeControl.command is declared but empty');
    if (record.blocksBeforeProducerOutput !== true) {
        return denied('negativeControl must block before the producer output exists');
    }
    if (record.admitsAfterProducerOutput !== true) {
        return denied('negativeControl must admit once the producer output exists');
    }
    return PROVEN;
}
function judgeHardCausalProof(proof) {
    const provenFacts = [];
    const missingFacts = [];
    const contradictions = [];
    const verdicts = [
        ['producer-output', judgeStringFact(proof?.producerOutput, 'producerOutput')],
        ['consumer-operation', judgeStringFact(proof?.consumerOperation, 'consumerOperation')],
        [
            'output-value-changes-consumer-result',
            judgeAssertedFact(proof?.outputValueChangesConsumerResult, 'outputValueChangesConsumerResult')
        ],
        ['no-substitute-available', judgeSubstitutesFact(proof?.substitutesAvailable)],
        ['result-undefined-without-output', judgeAssertedFact(proof?.resultUndefinedWithoutOutput, 'resultUndefinedWithoutOutput')],
        ['executable-negative-control', judgeNegativeControlFact(proof?.negativeControl)]
    ];
    for (const [factId, verdict] of verdicts) {
        if (verdict.proven)
            provenFacts.push(factId);
        else if (verdict.missing)
            missingFacts.push(factId);
        else
            contradictions.push(`${factId}: ${verdict.contradiction}`);
    }
    return { provenFacts, missingFacts, contradictions };
}
/**
 * A hard-causal edge is answered by the producer's *output*, not by the
 * producer's card. Once the named output exists the consumer has what it needs,
 * which is what makes the negative control executable in both directions.
 */
function isProducerOutputSealed(cwd, producerOutput) {
    if (!producerOutput)
        return false;
    return existsSync(path.resolve(cwd, producerOutput));
}
function classifyDeclaredEdge(declaration, context) {
    const legacyId = nonEmptyString(declaration);
    if (legacyId) {
        const untypedInTypedCard = context.typed;
        return {
            taskId: legacyId,
            relation: 'legacy-untyped',
            admissionMode: 'legacy-status-gate',
            provenFacts: [],
            missingFacts: [],
            contradictions: untypedInTypedCard
                ? ['relation: a card on typed dependency semantics may not declare an untyped dependency']
                : [],
            producerOutput: null,
            producerOutputSatisfied: false,
            negativeControlCommand: null,
            blockingCandidate: false
        };
    }
    const record = asRecord(declaration);
    const taskId = nonEmptyString(record?.taskId ?? record?.workItemId ?? record?.id) ?? '';
    const declaredRelation = nonEmptyString(record?.relation);
    const known = TASK_DEPENDENCY_RELATIONS.find((entry) => entry === declaredRelation) ?? null;
    const proof = asRecord(record?.hardCausalProof);
    if (!known) {
        return {
            taskId,
            relation: 'unknown',
            admissionMode: 'typed-non-blocking',
            provenFacts: [],
            missingFacts: [],
            contradictions: [`relation: ${declaredRelation ?? '(absent)'} is not a declared dependency relation`],
            producerOutput: null,
            producerOutputSatisfied: false,
            negativeControlCommand: null,
            blockingCandidate: false
        };
    }
    if (known !== 'hard-causal') {
        return {
            taskId,
            relation: known,
            admissionMode: 'typed-non-blocking',
            provenFacts: [],
            missingFacts: [],
            contradictions: proof
                ? [`relation: ${known} carries a hard-causal proof, so the declaration states two different things about this edge`]
                : [],
            producerOutput: null,
            producerOutputSatisfied: false,
            negativeControlCommand: null,
            blockingCandidate: false
        };
    }
    const { provenFacts, missingFacts, contradictions } = judgeHardCausalProof(proof);
    const producerOutput = nonEmptyString(proof?.producerOutput);
    const producerOutputSatisfied = isProducerOutputSealed(context.cwd, producerOutput);
    const complete = provenFacts.length === HARD_CAUSAL_FACT_IDS.length && contradictions.length === 0;
    return {
        taskId,
        relation: 'hard-causal',
        admissionMode: 'typed-hard-causal',
        provenFacts,
        missingFacts,
        contradictions,
        producerOutput,
        producerOutputSatisfied,
        negativeControlCommand: nonEmptyString(asRecord(proof?.negativeControl)?.command),
        blockingCandidate: complete && !producerOutputSatisfied
    };
}
function readDeclaredDependencyEntries(taskDocument) {
    const raw = taskDocument.dependencies ?? taskDocument.depends_on ?? taskDocument.blocked_by;
    if (Array.isArray(raw))
        return raw;
    return parseYamlList(raw);
}
/**
 * Classify every declared dependency edge of one task document.
 *
 * Cards that have not opted into typed semantics classify as `legacy`, and the
 * legacy status gate keeps deciding them exactly as before — an audit has to
 * happen before behavior changes, not as a side effect of shipping this.
 */
export function classifyTaskDependencyEdges(taskDocument, options = {}) {
    const typed = nonEmptyString(taskDocument.dependencySemantics) === HARD_CAUSAL_DEPENDENCY_SEMANTICS;
    const cwd = options.cwd ?? process.cwd();
    return {
        schemaId: 'atm.taskDependencyClassification.v1',
        semantics: typed ? HARD_CAUSAL_DEPENDENCY_SEMANTICS : 'legacy',
        edges: readDeclaredDependencyEntries(taskDocument).map((declaration) => classifyDeclaredEdge(declaration, { typed, cwd }))
    };
}
function recoveryCommandFor(taskId) {
    return `node atm.mjs tasks show --task ${taskId} --json`;
}
/**
 * The import boundary for the contract.
 *
 * Import is where a declaration becomes authority, so an edge that cannot prove
 * itself must be refused here rather than admitted with a reduced meaning that
 * some later consumer reinterprets. Missing and contradicted facts are reported
 * apart because they need different repairs.
 */
export function validateHardCausalDependencyImport(input) {
    const classification = classifyTaskDependencyEdges(input.taskDocument, { cwd: input.cwd });
    const diagnostics = [];
    for (const edge of classification.edges) {
        const dependencyTaskId = edge.taskId || '(unnamed)';
        const base = {
            severity: 'error',
            taskId: input.taskId,
            dependencyTaskId,
            requiredCommand: recoveryCommandFor(input.taskId)
        };
        if (edge.relation === 'legacy-untyped' && edge.contradictions.length > 0) {
            diagnostics.push({
                ...base,
                code: TASK_DEPENDENCY_UNTYPED_IN_TYPED_CARD_CODE,
                field: 'dependencies[]',
                message: `Dependency ${dependencyTaskId} is untyped on a card declaring ${HARD_CAUSAL_DEPENDENCY_SEMANTICS}; type the edge instead of relying on legacy fallback.`
            });
            continue;
        }
        if (edge.relation === 'unknown') {
            diagnostics.push({
                ...base,
                code: TASK_DEPENDENCY_RELATION_UNKNOWN_CODE,
                field: 'dependencies[].relation',
                message: `Dependency ${dependencyTaskId} declares no known relation; use one of ${TASK_DEPENDENCY_RELATIONS.join(', ')}.`
            });
            continue;
        }
        if (edge.contradictions.length > 0) {
            diagnostics.push({
                ...base,
                code: TASK_DEPENDENCY_HARD_PROOF_CONTRADICTORY_CODE,
                field: 'dependencies[].hardCausalProof',
                message: `Dependency ${dependencyTaskId} contradicts its own declaration: ${edge.contradictions.join('; ')}.`
            });
            continue;
        }
        if (edge.missingFacts.length > 0) {
            diagnostics.push({
                ...base,
                code: TASK_DEPENDENCY_HARD_PROOF_INCOMPLETE_CODE,
                field: 'dependencies[].hardCausalProof',
                message: `Dependency ${dependencyTaskId} is declared hard-causal but does not state: ${edge.missingFacts.join(', ')}.`
            });
        }
    }
    return {
        schemaId: 'atm.hardCausalDependencyImportValidation.v1',
        ok: diagnostics.length === 0,
        semantics: classification.semantics,
        edges: classification.edges,
        diagnostics
    };
}
function readTaskDocument(filePath) {
    try {
        const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
function declaredDependenciesFor(taskDocument) {
    return Array.from(new Set(parseYamlList(taskDocument.dependencies ?? taskDocument.depends_on ?? taskDocument.blocked_by)));
}
function isDependencyStatusClosed(status) {
    const normalized = normalizeWorkItemStatus(status);
    return normalized === 'done' || normalized === 'verified';
}
/**
 * The claim gate for a card on typed semantics.
 *
 * Only a hard-causal edge can reach here as a blocker, and only while its
 * producer output is still unsealed. An edge that claims to be hard-causal but
 * cannot state all six facts fails closed rather than opening: import refuses
 * such a declaration, so one reaching a live ledger means the record was
 * written outside the contract and its meaning is unknown.
 */
function findTypedClaimDependencyBlockers(cwd, taskId, classification) {
    const blockers = [];
    for (const edge of classification.edges) {
        if (!edge.taskId || edge.taskId === taskId)
            continue;
        const unprovable = edge.relation === 'legacy-untyped'
            || (edge.relation === 'hard-causal' && (edge.missingFacts.length > 0 || edge.contradictions.length > 0));
        if (!edge.blockingCandidate && !unprovable)
            continue;
        blockers.push({
            taskId: edge.taskId,
            status: unprovable ? 'hard-causal-proof-unprovable' : 'hard-causal-producer-output-pending',
            taskPath: taskPathFor(cwd, edge.taskId),
            blockedByDependency: true,
            dependencyTaskIds: [edge.taskId],
            relation: edge.relation === 'unknown' ? 'legacy-untyped' : edge.relation,
            hardCausalEdge: edge,
            requiredCommand: unprovable
                ? `node atm.mjs tasks show --task ${taskId} --json`
                : edge.negativeControlCommand ?? `node atm.mjs tasks status --task ${edge.taskId} --json`
        });
    }
    return blockers;
}
export function findTaskClaimDependencyBlockers(cwd, taskId, taskDocument, options = {}) {
    const classification = classifyTaskDependencyEdges(taskDocument, { cwd });
    if (classification.semantics === HARD_CAUSAL_DEPENDENCY_SEMANTICS) {
        return findTypedClaimDependencyBlockers(cwd, taskId, classification);
    }
    const declaredDependencies = declaredDependenciesFor(taskDocument);
    if (declaredDependencies.length === 0) {
        return [];
    }
    const scopeClass = deriveAtmScopeClass(options.claimFiles ?? []);
    if (options.claimFiles && options.claimFiles.length > 0 && !scopeClass.hasCode) {
        return [];
    }
    const codeFilesBlocked = scopeClass.classifications
        .filter((classification) => classification.scopeClass.includes('code'))
        .map((classification) => classification.path);
    const blockers = [];
    const enrichBlocker = (blocker) => ({
        ...blocker,
        blockedByDependency: true,
        dependencyTaskIds: declaredDependencies,
        scopeClass,
        codeFilesBlocked,
        allowedDependencyBlockedRoute: 'docs-ledger-planning'
    });
    for (const dependencyTaskId of declaredDependencies) {
        if (dependencyTaskId === taskId) {
            continue;
        }
        const dependencyPath = taskPathFor(cwd, dependencyTaskId);
        if (!existsSync(dependencyPath)) {
            blockers.push(enrichBlocker({ taskId: dependencyTaskId, status: 'missing', taskPath: dependencyPath }));
            continue;
        }
        const dependencyDocument = readTaskDocument(dependencyPath);
        if (!dependencyDocument) {
            blockers.push(enrichBlocker({ taskId: dependencyTaskId, status: 'unreadable', taskPath: dependencyPath }));
            continue;
        }
        const dependencyStatus = normalizeWorkItemStatus(dependencyDocument.status);
        if (!isDependencyStatusClosed(dependencyStatus)) {
            blockers.push(enrichBlocker({ taskId: dependencyTaskId, status: dependencyStatus, taskPath: dependencyPath }));
            continue;
        }
        if (!verifyCloseoutProvenance(cwd, dependencyTaskId, dependencyDocument)) {
            blockers.push(enrichBlocker(buildDependencyCloseoutBlocker(cwd, dependencyTaskId, dependencyPath, dependencyDocument)));
        }
    }
    return blockers;
}
export function areTaskDependenciesSatisfied(task, statusById, cwd = process.cwd()) {
    return task.dependencies.every((dependencyTaskId) => {
        const status = statusById.get(dependencyTaskId);
        if (status !== 'done' && status !== 'verified') {
            return false;
        }
        const dependencyPath = taskPathFor(cwd, dependencyTaskId);
        if (!existsSync(dependencyPath)) {
            return false;
        }
        const dependencyDocument = readTaskDocument(dependencyPath);
        return Boolean(dependencyDocument
            && isDependencyStatusClosed(dependencyDocument.status)
            && verifyCloseoutProvenance(cwd, dependencyTaskId, dependencyDocument));
    });
}
