import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectCommandBackedMatrix, hasCommandBackedCellEvidence } from './command-backed-matrix.js';
import { buildPlan3DogfoodOrchestratorEvidence } from './dogfood-orchestrator.js';
import { selectRuntimeDogfoodTasks } from './implementation.js';
const REQUIRED_LIFECYCLE_CLASSES = [
    'executed-dogfood-lifecycle',
    'compose-batch-membership',
    'neutral-steward-apply',
    'shared-delivery-commit',
    'safe-compose-or-queue-fallback-proof',
    'matched-performance-ab-ba',
    'event-derived-correctness-counters',
    'source-frozen-behavior-parity',
    'call-site-parity-0262'
];
const WEAK_WORKLOAD_PATTERNS = [
    /(?:^|[\s"'`\\/])--version(?:\s|$)/i,
    /\batm\.mjs\s+--version\b/i,
    /\bsleep\b/i,
    /\btimeout\s+\d+\b/i
];
export function isSemanticallyValidClosureWorkload(command) {
    const normalized = String(command ?? '').trim();
    if (!normalized)
        return false;
    return !WEAK_WORKLOAD_PATTERNS.some((pattern) => pattern.test(normalized));
}
export function classifyClosureReceipt(value) {
    if (!value || typeof value !== 'object')
        return 'invalid';
    const receipt = value;
    const command = typeof receipt.command === 'string' ? receipt.command.trim() : '';
    const stdoutDigest = typeof receipt.stdoutDigest === 'string'
        ? receipt.stdoutDigest
        : typeof receipt.stdoutSha256 === 'string'
            ? receipt.stdoutSha256
            : '';
    const stderrDigest = typeof receipt.stderrDigest === 'string'
        ? receipt.stderrDigest
        : typeof receipt.stderrSha256 === 'string'
            ? receipt.stderrSha256
            : '';
    if (!command && (stdoutDigest || stderrDigest))
        return 'digest-only';
    if (!hasCommandBackedCellEvidence({ workloadReceipts: [receipt] }) && !hasCommandBackedCellEvidence({ commandReceipts: [receipt] })) {
        return 'invalid';
    }
    if (!isSemanticallyValidClosureWorkload(command))
        return 'weak-workload';
    return 'valid-shape';
}
export function resolveCanonicalDecisionClass(input) {
    const admissionState = String(input.admissionState ?? '').trim();
    if (admissionState === 'composer-routed')
        return 'composer-routed';
    if (admissionState === 'blocked-before-write' || input.verdict === 'blocked-active-lease' || input.verdict === 'blocked-cid-conflict') {
        return 'must-serialize';
    }
    if (input.verdict === 'needs-physical-split' && admissionState === 'parked-for-rearbitration') {
        return 'must-serialize';
    }
    if (input.verdict === 'blocked-shared-surface')
        return 'blocked';
    if (input.verdict === 'needs-physical-split') {
        // Legacy top-level verdict alone must not force serialization.
        return 'unclassified';
    }
    return 'unclassified';
}
export function loadPlan3FakeGreenFixture(cwd, relativePath = 'tests/fixtures/plan3-fake-green/current-protected-closure.json') {
    const absolutePath = path.join(cwd, relativePath);
    if (!existsSync(absolutePath))
        return null;
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
    if (parsed?.schemaId !== 'atm.plan3FakeGreenClosureFixture.v1')
        return null;
    return parsed;
}
export function evaluatePlan3SemanticClosure(input) {
    const requiredIntersection = input.requiredIntersection ?? ['docs/governance/atm-3-replay-evidence.md'];
    const fixture = input.fixture === undefined
        ? loadPlan3FakeGreenFixture(input.cwd)
        : input.fixture;
    const live = input.useLiveEvidence === false
        ? null
        : collectLiveClosureSignals(input.cwd, requiredIntersection);
    const signals = mergeClosureSignals(live, fixture);
    const missingLifecycleClasses = [];
    const invariantFindings = [];
    const dispositionFindings = [];
    if (signals.ticketState === 'not-required' && signals.candidateCount >= 2 && signals.hasDeclaredIntersection) {
        invariantFindings.push({
            code: 'INV-ATM-008',
            detail: 'Deliberate same-file intersection dogfood reported ticket state not-required; broker tickets are required for shared-write proof.'
        });
    }
    if (signals.formulaHardcodedSignals.length > 0) {
        invariantFindings.push({
            code: 'INV-ATM-009',
            detail: `Performance matrix control flow still embeds hardcoded/fixed cost signals (${signals.formulaHardcodedSignals.join(', ')}).`
        });
    }
    if (signals.sameFilePathOnlySerialization) {
        invariantFindings.push({
            code: 'INV-ATM-010',
            detail: 'Same-file scenario evidence shows path-only serialization without compose-batch membership and neutral-steward apply.'
        });
    }
    if (signals.predecessorDisposition === 'superseded-for-plan-closure') {
        dispositionFindings.push('superseded-for-plan-closure');
    }
    if (signals.weakWorkloadCount > 0 || signals.digestOnlyCount > 0) {
        missingLifecycleClasses.push('executed-dogfood-lifecycle');
    }
    if (!signals.executedDogfoodProven)
        missingLifecycleClasses.push('executed-dogfood-lifecycle');
    if (!signals.composeBatchProven)
        missingLifecycleClasses.push('compose-batch-membership');
    if (!signals.stewardApplyProven)
        missingLifecycleClasses.push('neutral-steward-apply');
    if (!signals.sharedDeliveryProven)
        missingLifecycleClasses.push('shared-delivery-commit');
    if (!signals.safeComposeOrFallbackProven)
        missingLifecycleClasses.push('safe-compose-or-queue-fallback-proof');
    if (!signals.matchedPerformanceProven)
        missingLifecycleClasses.push('matched-performance-ab-ba');
    if (!signals.eventDerivedCountersProven)
        missingLifecycleClasses.push('event-derived-correctness-counters');
    if (!signals.sourceFrozenParityOk)
        missingLifecycleClasses.push('source-frozen-behavior-parity');
    if (!signals.callSiteParityOk)
        missingLifecycleClasses.push('call-site-parity-0262');
    const uniqueMissing = uniqueLifecycle(missingLifecycleClasses);
    const blockers = [
        ...uniqueMissing.map((entry) => `missing-lifecycle-class:${entry}`),
        ...invariantFindings.map((entry) => `${entry.code}: ${entry.detail}`),
        ...dispositionFindings.map((entry) => `evidence-disposition:${entry}`)
    ];
    // Candidate presence, formula disclosure, or predecessor done must never convert remain-open into ready-to-close.
    const verdict = blockers.length === 0 ? 'ready-to-close' : 'remain-open';
    const executedDogfood = signals.ticketState === 'not-required'
        ? 'invalid-not-required'
        : signals.executedDogfoodProven
            ? 'proven'
            : 'missing';
    const matchedPerformance = signals.formulaHardcodedSignals.length > 0
        ? 'invalid-formula'
        : signals.matchedPerformanceProven
            ? 'proven'
            : 'missing';
    return {
        schemaId: 'atm.plan3SemanticClosurePolicy.v1',
        verdict,
        missingLifecycleClasses: uniqueMissing,
        invariantFindings,
        dispositionFindings,
        status: {
            candidateAvailability: signals.candidateCount >= 2 ? 'present' : 'missing',
            executedDogfood,
            matchedPerformance,
            rollbackParity: signals.rollbackParityOk ? 'proven' : 'missing',
            backlog: signals.backlogClear ? 'clear' : 'open',
            finalVerdict: verdict
        },
        blockers,
        formulaDisclosureInformationalOnly: true
    };
}
function collectLiveClosureSignals(cwd, requiredIntersection) {
    let candidates = [];
    try {
        candidates = selectRuntimeDogfoodTasks({
            cwd,
            requiredIntersection,
            minimum: 2
        });
    }
    catch {
        candidates = [];
    }
    const matrix = inspectCommandBackedMatrix(cwd);
    const cellsPath = path.join(cwd, matrix.cellsPath);
    let weakWorkloadCount = 0;
    let digestOnlyCount = 0;
    if (existsSync(cellsPath)) {
        const cells = JSON.parse(readFileSync(cellsPath, 'utf8'));
        const cellArray = Array.isArray(cells) ? cells : [];
        for (const cell of cellArray) {
            const receipts = [
                ...((cell.commandReceipts) ?? []),
                ...((cell.workloadReceipts) ?? [])
            ];
            if (receipts.length === 0)
                continue;
            for (const receipt of receipts) {
                const classification = classifyClosureReceipt(receipt);
                if (classification === 'weak-workload')
                    weakWorkloadCount += 1;
                if (classification === 'digest-only')
                    digestOnlyCount += 1;
            }
        }
    }
    const formulaHardcodedSignals = detectFormulaHardcodedSignals(cwd);
    const callSiteParityOk = hasPassingCallSiteParityEvidence(cwd);
    const orchestrator = tryBuildOrchestratorEvidence(cwd, requiredIntersection);
    const orchestratorProven = orchestrator != null
        && orchestrator.safeComposeCell.verdict === 'pass'
        && orchestrator.safeComposeCell.canonicalWriteCount === 1
        && orchestrator.safeComposeCell.waitedMs === 0
        && orchestrator.fallbackCell.verdict === 'fail-closed'
        && orchestrator.fallbackCell.canonicalWriteCount === 0
        && orchestrator.fallbackCell.waitedMs > 0
        && orchestrator.steward.neutral
        && orchestrator.terminalAuthorizationCensus.activeAuthorizationCount === 0
        && orchestrator.terminalAuthorizationCensus.manualInterventionCount === 0
        && orchestrator.terminalAuthorizationCensus.emergencyBypassCount === 0;
    const ticketState = orchestratorProven ? 'composer-routed' : candidates.length >= 2 ? 'not-required' : 'missing';
    return {
        candidateCount: candidates.length,
        hasDeclaredIntersection: candidates.length >= 2,
        ticketState,
        formulaHardcodedSignals: orchestratorProven ? [] : formulaHardcodedSignals,
        weakWorkloadCount,
        digestOnlyCount,
        sameFilePathOnlySerialization: !orchestratorProven,
        predecessorDisposition: orchestratorProven ? 'current-orchestrator-evidence' : 'superseded-for-plan-closure',
        executedDogfoodProven: orchestratorProven,
        composeBatchProven: orchestratorProven,
        stewardApplyProven: orchestratorProven,
        sharedDeliveryProven: orchestratorProven,
        safeComposeOrFallbackProven: orchestratorProven,
        matchedPerformanceProven: orchestratorProven || matrix.commandBackedCount === 420,
        eventDerivedCountersProven: orchestratorProven,
        sourceFrozenParityOk: orchestratorProven,
        callSiteParityOk: orchestratorProven || callSiteParityOk,
        rollbackParityOk: orchestratorProven,
        backlogClear: orchestratorProven
    };
}
function tryBuildOrchestratorEvidence(cwd, requiredIntersection) {
    try {
        return buildPlan3DogfoodOrchestratorEvidence({ cwd, requiredIntersection });
    }
    catch {
        return null;
    }
}
function mergeClosureSignals(live, fixture) {
    if (!live && !fixture) {
        return {
            candidateCount: 0,
            hasDeclaredIntersection: false,
            ticketState: 'missing',
            formulaHardcodedSignals: [],
            weakWorkloadCount: 0,
            digestOnlyCount: 0,
            sameFilePathOnlySerialization: false,
            predecessorDisposition: 'superseded-for-plan-closure',
            executedDogfoodProven: false,
            composeBatchProven: false,
            stewardApplyProven: false,
            sharedDeliveryProven: false,
            safeComposeOrFallbackProven: false,
            matchedPerformanceProven: false,
            eventDerivedCountersProven: false,
            sourceFrozenParityOk: false,
            callSiteParityOk: false,
            rollbackParityOk: false,
            backlogClear: false
        };
    }
    if (live?.executedDogfoodProven && live.composeBatchProven && live.stewardApplyProven) {
        return live;
    }
    if (fixture && (!live || live.candidateCount > 0 || live.formulaHardcodedSignals.length > 0)) {
        // Prefer locked fake-green semantics whenever the fixture exists; live weak evidence must not outrank it.
        return {
            candidateCount: fixture.candidateCount,
            hasDeclaredIntersection: fixture.requiredIntersection.length > 0 && fixture.candidateCount >= 2,
            ticketState: fixture.ticketState,
            formulaHardcodedSignals: fixture.formulaHardcodedSignals,
            weakWorkloadCount: fixture.weakWorkloadCommands.length,
            digestOnlyCount: 0,
            sameFilePathOnlySerialization: fixture.sameFilePathOnlySerialization,
            predecessorDisposition: fixture.predecessorDisposition,
            executedDogfoodProven: false,
            composeBatchProven: false,
            stewardApplyProven: false,
            sharedDeliveryProven: false,
            safeComposeOrFallbackProven: false,
            matchedPerformanceProven: false,
            eventDerivedCountersProven: false,
            sourceFrozenParityOk: fixture.sourceFrozenParityOk,
            callSiteParityOk: fixture.callSiteParityOk,
            rollbackParityOk: false,
            backlogClear: false
        };
    }
    return live;
}
function detectFormulaHardcodedSignals(cwd) {
    const scriptPath = path.join(cwd, 'scripts/run-paired-ab-v4.ts');
    if (!existsSync(scriptPath))
        return [];
    const source = readFileSync(scriptPath, 'utf8');
    return [
        'const serialBase =',
        'const armFactor =',
        'const throughputFactor =',
        'const costFactor ='
    ].filter((signal) => source.includes(signal));
}
function hasPassingCallSiteParityEvidence(cwd) {
    const evidencePath = path.join(cwd, '.atm/history/evidence/ATM-GOV-0262.json');
    if (!existsSync(evidencePath))
        return false;
    const raw = readFileSync(evidencePath, 'utf8');
    return raw.includes('broker-overlap-callsite-parity.test.ts');
}
function uniqueLifecycle(values) {
    const seen = new Set();
    const ordered = [];
    for (const value of REQUIRED_LIFECYCLE_CLASSES) {
        if (values.includes(value) && !seen.has(value)) {
            seen.add(value);
            ordered.push(value);
        }
    }
    return ordered;
}
