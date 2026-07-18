import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export function readSessionId() {
    for (const key of ['ATM_SESSION_ID', 'CODEX_SESSION_ID', 'GITHUB_RUN_ID']) {
        const value = process.env[key]?.trim();
        if (value)
            return value;
    }
    return null;
}
export function readGitBranchRef(cwd) {
    const result = spawnSync('git', ['-C', cwd, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' });
    if (result.status !== 0)
        return null;
    const branch = String(result.stdout ?? '').trim();
    return branch || null;
}
export function normalizePathList(entries) {
    return normalizeStringList(entries.map((entry) => entry.replace(/\\/g, '/')));
}
export function normalizeStringList(entries) {
    return [...new Set(entries.map((entry) => entry.replace(/\\/g, '/').trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
export function buildFileHashesBefore(cwd, relativePaths) {
    const output = {};
    for (const relativePath of relativePaths) {
        const absolutePath = path.resolve(cwd, relativePath);
        output[relativePath] = existsSync(absolutePath)
            ? `sha256:${createHash('sha256').update(readFileSync(absolutePath)).digest('hex')}`
            : null;
    }
    return output;
}
export function deriveTeamAtomRefs(task, taskId) {
    const atomizationImpact = task?.atomizationImpact;
    const ownerAtom = String(atomizationImpact?.ownerAtomOrMap ?? atomizationImpact?.owner_atom_or_map ?? taskId).trim();
    const firstRegion = deriveBoundedRegions(task)[0];
    const atomCid = deriveTeamAtomCid(task, ownerAtom, taskId, firstRegion);
    return [{
            atomId: ownerAtom,
            atomCid,
            operation: 'modify',
            ...(firstRegion ? {
                sourceRange: {
                    filePath: firstRegion.filePath,
                    lineStart: firstRegion.lineStart,
                    lineEnd: firstRegion.lineEnd
                }
            } : {})
        }];
}
export function deriveTeamAtomCid(task, ownerAtom, taskId, firstRegion) {
    const atomizationImpact = task?.atomizationImpact;
    const proposalAdmission = asRecord(task?.proposalAdmission) ?? asRecord(task?.brokerProposalAdmission);
    const explicitAtomCid = normalizeOptionalString(atomizationImpact?.atomCid
        ?? atomizationImpact?.atom_cid
        ?? task?.atomCid
        ?? task?.atom_cid
        ?? proposalAdmission?.atomCid
        ?? proposalAdmission?.atom_cid);
    if (explicitAtomCid) {
        return explicitAtomCid;
    }
    const base = toSyntheticAtomSlug(ownerAtom || taskId);
    if (!firstRegion) {
        return base;
    }
    const fileComponent = path.posix.basename(firstRegion.filePath).replace(/\.[^.]+$/, '');
    return `${base}-${toSyntheticAtomSlug(fileComponent)}-${firstRegion.lineStart}-${firstRegion.lineEnd}`;
}
export function deriveTeamProposalAdmission(task, hotFiles) {
    const raw = asRecord(task?.proposalAdmission)
        ?? asRecord(task?.brokerProposalAdmission)
        ?? asRecord(task?.writeAdmission);
    const boundedRegions = deriveBoundedRegions(task);
    const configuredTrigger = normalizeProposalTrigger(raw?.trigger);
    const notes = typeof raw?.notes === 'string' && raw.notes.trim()
        ? raw.notes.trim()
        : hotFiles.length > 0
            ? 'Hot files require proposal-first admission before live write.'
            : boundedRegions.length > 0
                ? 'Bounded-region proposal admission metadata supplied by task.'
                : '';
    const trigger = configuredTrigger
        ?? (hotFiles.length > 0 ? 'hot-file' : boundedRegions.length > 0 ? 'shared-surface-risk' : null);
    if (!trigger) {
        return undefined;
    }
    return {
        trigger,
        summarySubmitted: raw?.summarySubmitted === true,
        hotFiles: normalizeStringList([...(hotFiles ?? []), ...normalizeStringArray(raw?.hotFiles)]),
        boundedRegions,
        notes
    };
}
export function deriveBoundedRegions(task) {
    const rawRegions = normalizeRegionArray(asArray(task?.proposalAdmission && asRecord(task.proposalAdmission)?.boundedRegions)
        ?? asArray(task?.brokerProposalAdmission && asRecord(task.brokerProposalAdmission)?.boundedRegions)
        ?? asArray(task?.writeBoundedRegions)
        ?? asArray(task?.boundedRegions)
        ?? []);
    return rawRegions;
}
export function normalizeRegionArray(value) {
    const regions = [];
    for (const entry of value) {
        const record = asRecord(entry);
        const filePath = typeof record?.filePath === 'string' ? record.filePath.replace(/\\/g, '/').trim() : '';
        const lineStart = normalizePositiveInteger(record?.lineStart);
        const lineEnd = normalizePositiveInteger(record?.lineEnd);
        if (!filePath || lineStart === null || lineEnd === null || lineEnd < lineStart) {
            continue;
        }
        regions.push({ filePath, lineStart, lineEnd });
    }
    return normalizeBoundedRegionList(regions);
}
export function normalizeBoundedRegionList(regions) {
    const seen = new Set();
    const output = [];
    for (const region of regions) {
        const key = `${region.filePath}:${region.lineStart}:${region.lineEnd}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        output.push(region);
    }
    return output.sort((left, right) => `${left.filePath}:${left.lineStart}:${left.lineEnd}`.localeCompare(`${right.filePath}:${right.lineStart}:${right.lineEnd}`));
}
export function normalizeProposalTrigger(value) {
    const trigger = typeof value === 'string' ? value.trim() : '';
    if (trigger === 'hot-file'
        || trigger === 'same-file-overlap-risk'
        || trigger === 'shared-surface-risk'
        || trigger === 'manual-review-surface') {
        return trigger;
    }
    return null;
}
export function normalizeStringArray(value) {
    return Array.isArray(value)
        ? value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
        : [];
}
export function normalizePositiveInteger(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value > 0)
        return value;
    if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
        const parsed = Number.parseInt(value.trim(), 10);
        return parsed > 0 ? parsed : null;
    }
    return null;
}
export function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim().length > 0
        ? value.trim()
        : null;
}
export function toSyntheticAtomSlug(value) {
    const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized || 'unknown-atom';
}
export function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function asArray(value) {
    return Array.isArray(value) ? value : null;
}
export function toProposalAdmissionRequest(admission) {
    if (!admission) {
        return undefined;
    }
    return {
        trigger: admission.trigger,
        summarySubmitted: admission.summarySubmitted,
        ...(admission.boundedRegions.length > 0 ? { boundedRegions: admission.boundedRegions } : {}),
        ...(admission.hotFiles.length > 0 ? { hotFiles: admission.hotFiles } : {}),
        ...(admission.reason ? { notes: admission.reason } : {})
    };
}
