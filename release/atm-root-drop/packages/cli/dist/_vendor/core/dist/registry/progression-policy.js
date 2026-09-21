import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const DEFAULT_POLICY = {
    schemaId: 'atm.progressionPolicy',
    automationLevel: 'off',
    gates: {
        'shadow->canary': {
            minOutputConsistencyRate: 0.99,
            minSampleSize: 5,
            minShadowDays: 1,
            requireEdgeContractPass: true,
            requireEvidenceDraft: true
        },
        'canary->active': {
            minOutputConsistencyRate: 0.999,
            minSampleSize: 20,
            requireEvidenceDraft: true
        }
    }
};
function policyPath(repositoryRoot, mapId) {
    return path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'replacement.progression-policy.json');
}
export function readProgressionPolicy(repositoryRoot, mapId) {
    const filePath = policyPath(repositoryRoot, mapId);
    if (!existsSync(filePath)) {
        return { ...DEFAULT_POLICY, mapId };
    }
    try {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
    catch {
        return { ...DEFAULT_POLICY, mapId };
    }
}
export function writeProgressionPolicy(repositoryRoot, policy) {
    const dir = path.join(repositoryRoot, 'atomic_workbench', 'maps', policy.mapId);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    writeFileSync(policyPath(repositoryRoot, policy.mapId), JSON.stringify(policy, null, 2), 'utf-8');
}
export function pauseProgression(repositoryRoot, mapId, pausedBy) {
    const policy = readProgressionPolicy(repositoryRoot, mapId);
    const updated = {
        ...policy,
        pausedAt: new Date().toISOString(),
        pausedBy: pausedBy ?? 'manual'
    };
    writeProgressionPolicy(repositoryRoot, updated);
    return updated;
}
export function resumeProgression(repositoryRoot, mapId) {
    const policy = readProgressionPolicy(repositoryRoot, mapId);
    const updated = { ...policy };
    delete updated.pausedAt;
    delete updated.pausedBy;
    writeProgressionPolicy(repositoryRoot, updated);
    return updated;
}
function mapSpecLane(repositoryRoot, mapId) {
    const specPath = path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'map.spec.json');
    if (!existsSync(specPath))
        return undefined;
    try {
        const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
        return spec.replacement?.mode ?? spec.replacementMode ?? undefined;
    }
    catch {
        return undefined;
    }
}
function hasEvidenceDraft(repositoryRoot, mapId) {
    const dir = path.join(repositoryRoot, '.atm', 'evidence');
    if (!existsSync(dir))
        return false;
    // Check for any evidence draft referencing this mapId
    try {
        for (const f of readdirSync(dir)) {
            if (!f.endsWith('.json'))
                continue;
            try {
                const content = JSON.parse(readFileSync(path.join(dir, f), 'utf-8'));
                if (content.mapId === mapId && content._isValid !== false)
                    return true;
            }
            catch { /* skip */ }
        }
    }
    catch { /* skip */ }
    return false;
}
function hasEdgeContractPass(repositoryRoot, mapId) {
    // Check .atm/history/reports for a passing edge contract report
    const reportsDir = path.join(repositoryRoot, '.atm', 'history', 'reports');
    if (!existsSync(reportsDir))
        return false;
    try {
        for (const f of readdirSync(reportsDir)) {
            if (!f.endsWith('.json'))
                continue;
            try {
                const content = JSON.parse(readFileSync(path.join(reportsDir, f), 'utf-8'));
                if (content.mapId === mapId &&
                    content.type === 'edge-contract' &&
                    content.failed === 0)
                    return true;
            }
            catch { /* skip */ }
        }
    }
    catch { /* skip */ }
    return false;
}
export function checkProgression(repositoryRoot, mapId, shadowReport) {
    const policy = readProgressionPolicy(repositoryRoot, mapId);
    const checkedAt = new Date().toISOString();
    const paused = Boolean(policy.pausedAt);
    if (paused) {
        return {
            mapId,
            checkedAt,
            canPromote: false,
            blockedReasons: [`progression paused at ${policy.pausedAt} by ${policy.pausedBy ?? 'unknown'}`],
            automationLevel: policy.automationLevel,
            paused: true
        };
    }
    if (policy.automationLevel === 'off') {
        return {
            mapId,
            checkedAt,
            canPromote: false,
            blockedReasons: ['automationLevel is "off" — manual promotion required'],
            automationLevel: 'off',
            paused: false
        };
    }
    const currentLane = mapSpecLane(repositoryRoot, mapId) ?? 'draft';
    const laneOrder = ['draft', 'shadow', 'canary', 'active', 'legacy-retired'];
    const currentIdx = laneOrder.indexOf(currentLane);
    const nextLane = currentIdx >= 0 && currentIdx < laneOrder.length - 1
        ? laneOrder[currentIdx + 1]
        : undefined;
    if (!nextLane) {
        return {
            mapId,
            checkedAt,
            canPromote: false,
            blockedReasons: [`map is already at lane "${currentLane}", no further auto-promotion possible`],
            currentLane,
            automationLevel: policy.automationLevel,
            paused: false
        };
    }
    const gateKey = `${currentLane}->${nextLane}`;
    const gate = policy.gates[gateKey];
    const blockedReasons = [];
    if (!shadowReport) {
        blockedReasons.push('no shadow comparison report found — M20 report required for progression');
    }
    else {
        if (gate?.minOutputConsistencyRate !== undefined) {
            if (shadowReport.outputConsistencyRate < gate.minOutputConsistencyRate) {
                blockedReasons.push(`outputConsistencyRate ${(shadowReport.outputConsistencyRate * 100).toFixed(2)}% < required ${(gate.minOutputConsistencyRate * 100).toFixed(2)}%`);
            }
        }
        if (gate?.minSampleSize !== undefined && shadowReport.sampleSize < gate.minSampleSize) {
            blockedReasons.push(`sampleSize ${shadowReport.sampleSize} < required ${gate.minSampleSize}`);
        }
        if (gate?.minShadowDays !== undefined && shadowReport.shadowPeriodDays < gate.minShadowDays) {
            blockedReasons.push(`shadowPeriodDays ${shadowReport.shadowPeriodDays} < required ${gate.minShadowDays}`);
        }
        if (shadowReport.divergences.some((d) => d.critical)) {
            blockedReasons.push('critical divergence detected in shadow comparison report');
        }
    }
    const edgeContractPass = hasEdgeContractPass(repositoryRoot, mapId);
    if (gate?.requireEdgeContractPass && !edgeContractPass) {
        blockedReasons.push('edge contract check pass required but not found in history');
    }
    const evidenceDraftExists = hasEvidenceDraft(repositoryRoot, mapId);
    if (gate?.requireEvidenceDraft && !evidenceDraftExists) {
        blockedReasons.push('valid evidence draft required but not found');
    }
    if (blockedReasons.length > 0) {
        return {
            mapId,
            checkedAt,
            canPromote: false,
            blockedReasons,
            currentLane,
            nextLane,
            automationLevel: policy.automationLevel,
            paused: false,
            nextProposalHint: `node atm.mjs replacement-lane transition --map ${mapId} --to ${nextLane} --json`
        };
    }
    // All gates pass — generate proposal (pending-human-approval, never direct mutation)
    const proposal = {
        schemaId: 'atm.progressionProposal',
        mapId,
        proposedAt: checkedAt,
        fromLane: currentLane,
        toLane: nextLane,
        status: 'pending-human-approval',
        canPromote: true,
        rollbackReadiness: 'rollback proof available via atm rollback --map',
        evidence: {
            outputConsistencyRate: shadowReport?.outputConsistencyRate,
            sampleSize: shadowReport?.sampleSize,
            shadowPeriodDays: shadowReport?.shadowPeriodDays,
            hasEdgeContractPass: edgeContractPass,
            hasEvidenceDraft: evidenceDraftExists
        }
    };
    return {
        mapId,
        checkedAt,
        canPromote: true,
        blockedReasons: [],
        currentLane,
        nextLane,
        proposal,
        nextProposalHint: `node atm.mjs replacement-lane transition --map ${mapId} --to ${nextLane} --json`,
        automationLevel: policy.automationLevel,
        paused: false
    };
}
