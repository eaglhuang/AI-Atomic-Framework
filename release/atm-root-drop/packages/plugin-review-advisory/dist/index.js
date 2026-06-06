import { mapConversationPatchDraftsToMachineFindings } from './conversation-machine-findings.js';
export { checkPromotionSafetyGates } from './promotion-gates.js';
export { mapConversationPatchDraftsToMachineFindings };
export const pluginReviewAdvisoryPackage = {
    packageName: '@ai-atomic-framework/plugin-review-advisory',
    packageRole: 'semantic-review-advisory-provider',
    packageVersion: '0.0.0'
};
export function createReviewAdvisoryReport(init) {
    const findings = Array.isArray(init.findings) ? [...init.findings] : [];
    const status = init.status ?? inferStatus(findings, init.unavailableReasons ?? []);
    const unavailableReasons = dedupeStrings(init.unavailableReasons ?? []);
    const advisoryUnavailable = status === 'advisory-unavailable' || unavailableReasons.length > 0;
    const needsReview = advisoryUnavailable || findings.some((finding) => finding.action === 'needs-review' || finding.action === 'request-human-review');
    return {
        schemaVersion: '1.0.0',
        reportId: init.reportId,
        status,
        provider: {
            mode: init.provider.mode,
            providerId: init.provider.providerId,
            providerVersion: init.provider.providerVersion,
            transport: init.provider.transport
        },
        generatedAt: init.generatedAt ?? new Date().toISOString(),
        target: {
            kind: init.target.kind,
            id: init.target.id,
            sourcePaths: init.target.sourcePaths ? dedupeStrings(init.target.sourcePaths) : undefined
        },
        summary: summarizeFindings(findings),
        findings,
        supplementalContext: {
            humanReviewQueue: {
                attachable: false
            }
        },
        advisoryUnavailable,
        needsReview,
        unavailableReasons
    };
}
export function createConversationPatchDraftAdvisoryReport(input) {
    return createReviewAdvisoryReport({
        reportId: input.reportId,
        provider: {
            mode: 'stub',
            providerId: 'conversation-patch-draft-machine-findings',
            providerVersion: '0.1.0',
            transport: 'inproc'
        },
        generatedAt: input.generatedAt ?? input.patchDraftReport.generatedAt,
        target: input.target ?? {
            kind: 'proposal',
            id: input.patchDraftReport.sourceFindingsReport.transcriptId,
            sourcePaths: input.patchDraftReport.sourceFindingsReport.artifactPath
                ? [input.patchDraftReport.sourceFindingsReport.artifactPath]
                : undefined
        },
        findings: mapConversationPatchDraftsToMachineFindings(input.patchDraftReport)
    });
}
export function createUnavailableAdvisoryReport(input) {
    return createReviewAdvisoryReport({
        reportId: input.reportId,
        status: 'advisory-unavailable',
        provider: input.provider,
        target: input.target,
        unavailableReasons: [input.reason],
        findings: [
            {
                id: 'finding.provider.unavailable',
                severity: 'info',
                trigger: 'provider-health',
                scope: 'runtime',
                action: 'needs-review',
                routeHint: 'advisory-unavailable',
                message: 'Advisory provider unavailable; deterministic gates remain authoritative.',
                evidenceRefs: ['review-advisory.provider-unavailable']
            }
        ]
    });
}
export function createStubReviewAdvisoryReport(input) {
    if (input.profile === 'unavailable') {
        return createUnavailableAdvisoryReport({
            reportId: input.reportId,
            provider: {
                mode: 'stub',
                providerId: 'stub-provider',
                providerVersion: '1.0.0',
                transport: 'inproc'
            },
            target: input.target,
            reason: 'stub-unavailable-profile'
        });
    }
    if (input.profile === 'warn') {
        return createReviewAdvisoryReport({
            reportId: input.reportId,
            status: 'warn',
            provider: {
                mode: 'stub',
                providerId: 'stub-provider',
                providerVersion: '1.0.0',
                transport: 'inproc'
            },
            target: input.target,
            findings: [
                {
                    id: 'finding.stub.warn.route-risk',
                    severity: 'high',
                    trigger: 'behavior-route-risk',
                    scope: 'proposal',
                    action: 'request-human-review',
                    routeHint: 'human-review.required',
                    message: 'Stub profile detected a potential behavior-route mismatch requiring human review.',
                    evidenceRefs: ['review-advisory.stub.warn']
                }
            ]
        });
    }
    return createReviewAdvisoryReport({
        reportId: input.reportId,
        status: 'ok',
        provider: {
            mode: 'stub',
            providerId: 'stub-provider',
            providerVersion: '1.0.0',
            transport: 'inproc'
        },
        target: input.target,
        findings: [
            {
                id: 'finding.stub.pass',
                severity: 'info',
                trigger: 'semantic-anomaly',
                scope: 'proposal',
                action: 'monitor',
                routeHint: 'human-review.supplemental',
                message: 'Stub profile found no actionable semantic risk.',
                evidenceRefs: ['review-advisory.stub.pass']
            }
        ]
    });
}
export function appendMachineFindings(report, machineFindings) {
    if (!Array.isArray(machineFindings) || machineFindings.length === 0) {
        return report;
    }
    const normalizedFindings = machineFindings.map((finding, index) => ({
        id: finding.id || `finding.machine.${index + 1}`,
        severity: finding.severity ?? 'low',
        trigger: 'machine-finding',
        scope: 'proposal',
        action: finding.severity === 'high' ? 'request-human-review' : 'needs-review',
        routeHint: finding.routeHint ?? 'human-review.supplemental',
        message: finding.message,
        evidenceRefs: normalizeEvidenceRefs(finding.evidenceRefs, finding.evidenceRef),
        metadata: {
            source: 'machine-finding-ingest',
            ...(finding.metadata ?? {})
        }
    }));
    const mergedFindings = [...report.findings, ...normalizedFindings];
    return {
        ...report,
        status: inferStatus(mergedFindings, report.unavailableReasons ?? []),
        summary: summarizeFindings(mergedFindings),
        findings: mergedFindings,
        needsReview: report.advisoryUnavailable
            || mergedFindings.some((finding) => finding.action === 'needs-review' || finding.action === 'request-human-review')
    };
}
export function normalizeProviderPayload(payload, fallback) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {
            ok: false,
            issues: ['provider-payload-not-object'],
            report: createUnavailableAdvisoryReport({
                reportId: fallback.reportId,
                provider: fallback.provider,
                target: fallback.target,
                reason: 'provider-payload-not-object'
            })
        };
    }
    const candidate = payload;
    if (!Array.isArray(candidate.findings)) {
        return {
            ok: false,
            issues: ['provider-findings-not-array'],
            report: createUnavailableAdvisoryReport({
                reportId: fallback.reportId,
                provider: fallback.provider,
                target: fallback.target,
                reason: 'provider-findings-not-array'
            })
        };
    }
    const findings = candidate.findings.filter((finding) => {
        if (!finding || typeof finding !== 'object') {
            return false;
        }
        const typed = finding;
        return typeof typed.id === 'string' && typed.id.length > 0 && typeof typed.message === 'string' && typed.message.length > 0;
    });
    const report = createReviewAdvisoryReport({
        reportId: candidate.reportId && typeof candidate.reportId === 'string' ? candidate.reportId : fallback.reportId,
        status: candidate.status,
        provider: {
            ...fallback.provider,
            ...(candidate.provider ?? {})
        },
        generatedAt: candidate.generatedAt,
        target: candidate.target && typeof candidate.target === 'object'
            ? {
                ...fallback.target,
                ...candidate.target
            }
            : fallback.target,
        findings,
        unavailableReasons: candidate.unavailableReasons
    });
    const issues = [];
    if (findings.length !== candidate.findings.length) {
        issues.push('provider-findings-filtered');
    }
    if (issues.length > 0) {
        return { ok: false, issues, report };
    }
    return { ok: true, report };
}
function inferStatus(findings, unavailableReasons) {
    if (unavailableReasons.length > 0) {
        return 'advisory-unavailable';
    }
    const hasWarn = findings.some((finding) => finding.severity === 'high' || finding.severity === 'medium');
    return hasWarn ? 'warn' : 'ok';
}
function summarizeFindings(findings) {
    return {
        high: findings.filter((finding) => finding.severity === 'high').length,
        medium: findings.filter((finding) => finding.severity === 'medium').length,
        low: findings.filter((finding) => finding.severity === 'low').length,
        info: findings.filter((finding) => finding.severity === 'info').length
    };
}
function dedupeStrings(input) {
    return Array.from(new Set(input.filter((item) => typeof item === 'string' && item.length > 0)));
}
function normalizeEvidenceRefs(evidenceRefs, evidenceRef) {
    const refs = dedupeStrings([
        ...(Array.isArray(evidenceRefs) ? evidenceRefs : []),
        ...(evidenceRef ? [evidenceRef] : [])
    ]);
    return refs.length > 0 ? refs : undefined;
}
export default {
    pluginReviewAdvisoryPackage,
    createReviewAdvisoryReport,
    createConversationPatchDraftAdvisoryReport,
    createUnavailableAdvisoryReport,
    createStubReviewAdvisoryReport,
    appendMachineFindings,
    mapConversationPatchDraftsToMachineFindings,
    normalizeProviderPayload
};
