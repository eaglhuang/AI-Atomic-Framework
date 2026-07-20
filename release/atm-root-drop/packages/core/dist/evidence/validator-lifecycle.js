import { createHash } from 'node:crypto';
export const VALIDATOR_LIFECYCLE_SUMMARY_SCHEMA_ID = 'atm.validatorLifecycleSummary.v1';
export function buildValidatorLifecycleSummary(input) {
    const usageEntries = (Array.isArray(input.usageTelemetry?.validators) ? input.usageTelemetry?.validators : [])
        .map((entry) => [String(entry.validatorId ?? entry.name ?? ''), entry])
        .filter(([key]) => Boolean(key));
    const usageById = new Map(usageEntries);
    const events = input.validators.flatMap((validator) => {
        const validatorId = String(validator.name ?? validator.validatorId ?? '');
        const usage = usageById.get(validatorId) ?? {};
        return lifecycleEventsForValidator(validatorId, validator, usage);
    });
    const eligibleCount = countEvents(events, 'eligible');
    const invokedCount = countEvents(events, 'invoked');
    const skippedCount = countEvents(events, 'skipped');
    const cacheHitCount = countEvents(events, 'cache-hit');
    const cacheMissCount = countEvents(events, 'cache-miss');
    const cacheBypassCount = countEvents(events, 'cache-bypass');
    const receiptReuseCount = countEvents(events, 'receipt-reuse');
    const fanOutEventCount = countEvents(events, 'fan-out');
    const blockedCount = countEvents(events, 'blocked') + countEvents(events, 'failed');
    const historyDigest = sha256Json({ events, profile: input.profile, mode: input.mode });
    const configDigest = sha256Json({ config: input.config ?? null, dag: input.dag ?? null });
    const orderingDigest = sha256Json({
        validators: input.validators.map((entry) => String(entry.name ?? entry.validatorId ?? ''))
    });
    const tierProposal = buildTierProposal(events);
    const insufficientObservation = tierProposal.insufficientObservation.length > 0;
    return {
        schemaId: VALIDATOR_LIFECYCLE_SUMMARY_SCHEMA_ID,
        profile: input.profile,
        mode: input.mode,
        optimizationId: 'ATM-GOV-0200',
        sourceTaskId: 'ATM-GOV-0200',
        dataDrivenDecision: insufficientObservation ? 'insufficient-observation' : 'sufficient-observation',
        historyDigest,
        configDigest,
        observedWindow: {
            eligibleCount,
            invokedCount,
            skippedCount,
            cacheHitCount,
            cacheMissCount,
            cacheBypassCount,
            receiptReuseCount,
            fanOutEventCount,
            blockedCount,
            durationMs: Number(input.durationMs ?? 0)
        },
        tierProposal,
        rollbackReceipt: {
            schemaId: 'atm.validatorTierRollbackReceipt.v1',
            optimizationId: 'ATM-GOV-0200',
            restoresConfigDigest: configDigest,
            restoresOrderingDigest: orderingDigest,
            invalidatesTreatmentCache: true,
            parityValidator: 'node --strip-types tests/cli/validator-observed-lifecycle.test.ts'
        },
        consumedReceipt: {
            schemaId: 'atm.validatorLifecycleConsumedReceipt.v1',
            producerTaskId: 'ATM-GOV-0200',
            historyDigest,
            configDigest,
            consumedBy: 'ATM-GOV-0202'
        },
        events
    };
}
function lifecycleEventsForValidator(validatorId, result, usage) {
    const cacheDecision = String(result.cacheDecision ?? usage.cacheDecision ?? 'cache-bypass');
    const fanOutConsumerCount = Number(usage.fanOutConsumerCount ?? 0);
    const blockingCount = Number(usage.blockingCount ?? 0);
    const invoked = Number(usage.invocationCount ?? 0) > 0;
    const skipped = Number(usage.skippedCount ?? 0) > 0;
    const reusedFromReceipt = result.resumedFromReceipt === true || result.reusedFromCanonicalReceipt === true || cacheDecision === 'receipt-reuse';
    const base = {
        schemaId: 'atm.validatorLifecycleEvent.v1',
        validatorId,
        validatorVersion: String(result.cacheKey ?? result.entry ?? usage.validatorVersion ?? '') || null,
        tier: normalizeLifecycleTier(result, usage),
        durationMs: Number(result.durationMs ?? usage.durationMs ?? 0),
        cacheDecision,
        fanOutConsumerCount,
        blockingCount,
        reusedFromReceipt,
        usedForDecision: usage.usedForDecision === true || blockingCount > 0 || fanOutConsumerCount > 0
    };
    const events = [{ ...base, event: 'eligible' }];
    events.push({ ...base, event: invoked ? 'invoked' : 'skipped' });
    if (cacheDecision === 'cache-hit')
        events.push({ ...base, event: 'cache-hit' });
    if (cacheDecision === 'cache-miss')
        events.push({ ...base, event: 'cache-miss' });
    if (cacheDecision === 'cache-bypass')
        events.push({ ...base, event: 'cache-bypass' });
    if (reusedFromReceipt)
        events.push({ ...base, event: 'receipt-reuse' });
    if (fanOutConsumerCount > 0)
        events.push({ ...base, event: 'fan-out' });
    if (result.ok === true)
        events.push({ ...base, event: 'passed' });
    if (result.ok !== true)
        events.push({ ...base, event: 'failed' });
    if (blockingCount > 0)
        events.push({ ...base, event: 'blocked' });
    return events;
}
function buildTierProposal(events) {
    const byValidator = new Map();
    for (const event of events) {
        byValidator.set(event.validatorId, [...(byValidator.get(event.validatorId) ?? []), event]);
    }
    const proposal = {
        fast: [],
        default: [],
        full: [],
        archiveCandidate: [],
        insufficientObservation: []
    };
    for (const [validatorId, validatorEvents] of byValidator) {
        const hasBlock = validatorEvents.some((event) => event.event === 'blocked' || event.event === 'failed');
        const hasFanOut = validatorEvents.some((event) => event.event === 'fan-out');
        const cacheOnly = validatorEvents.some((event) => event.event === 'cache-hit' || event.event === 'receipt-reuse')
            && !validatorEvents.some((event) => event.event === 'invoked');
        if (hasBlock)
            proposal.full.push(validatorId);
        else if (hasFanOut)
            proposal.fast.push(validatorId);
        else if (cacheOnly)
            proposal.archiveCandidate.push(validatorId);
        else
            proposal.default.push(validatorId);
        if (validatorEvents.filter((event) => event.event === 'eligible').length < 500) {
            proposal.insufficientObservation.push(validatorId);
        }
    }
    return {
        fast: proposal.fast.sort(),
        default: proposal.default.sort(),
        full: proposal.full.sort(),
        archiveCandidate: proposal.archiveCandidate.sort(),
        insufficientObservation: proposal.insufficientObservation.sort()
    };
}
function normalizeLifecycleTier(result, usage) {
    if (String(result.cacheDecision ?? usage.cacheDecision ?? '') === 'cache-hit')
        return 'archive-candidate';
    if (result.slow === true || usage.tier === 'full')
        return 'full';
    if (usage.tier === 'fast')
        return 'fast';
    return 'default';
}
function countEvents(events, event) {
    return events.filter((entry) => entry.event === event).length;
}
function sha256Json(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
