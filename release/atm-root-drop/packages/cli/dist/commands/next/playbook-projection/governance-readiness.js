// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { buildGovernanceReadinessHintContract } from '../governance-readiness.js';
import { createFrameworkModeStatus } from '../../framework-development.js';
import { isFrameworkMaintenancePrompt } from '../route-predicates.js';
import { uniqueSorted } from '../view-projections.js';
import { parseJsonText } from '../../shared.js';
import { readStringArray } from '../intent-normalizers.js';
import { buildActiveWorkSummary, normalizeWorkPath } from './active-work-summary.js';
export function buildGovernanceReadinessHint(cwd, input) {
    return buildGovernanceReadinessHintContract({
        cwd,
        ...input,
        uniqueSorted,
        readTaskWorkFiles,
        buildActiveWorkSummary,
        createFrameworkModeStatus,
        isFrameworkMaintenancePrompt,
        isProtectedFrameworkBranchTarget
    });
}
function readTaskWorkFiles(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return [];
    try {
        const parsed = parseJsonText(readFileSync(taskPath, 'utf8'));
        const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
            ? parsed.claim
            : {};
        const directionLock = parsed.taskDirectionLock && typeof parsed.taskDirectionLock === 'object' && !Array.isArray(parsed.taskDirectionLock)
            ? parsed.taskDirectionLock
            : {};
        return uniqueSorted([
            ...readStringArray(parsed.scope),
            ...readStringArray(parsed.scopePaths),
            ...readStringArray(parsed.files),
            ...readStringArray(parsed.deliverables),
            ...readStringArray(claimRecord.files),
            ...readStringArray(directionLock.allowedFiles)
        ].map(normalizeWorkPath).filter(Boolean));
    }
    catch {
        return [];
    }
}
export function shouldInspectCrossRepoFrameworkStatus(cwd, targetRepo) {
    if (!targetRepo)
        return false;
    const normalizedTarget = targetRepo.replace(/\\/g, '/').trim();
    if (!normalizedTarget)
        return false;
    const currentRoot = path.resolve(cwd);
    const currentName = path.basename(currentRoot).toLowerCase();
    if (normalizedTarget.toLowerCase() === currentName)
        return false;
    if (path.isAbsolute(normalizedTarget) && path.resolve(normalizedTarget) === currentRoot)
        return false;
    return true;
}
function isProtectedFrameworkBranchTarget(branch) {
    return branch === 'main'
        || branch === 'master'
        || branch === 'trunk'
        || /^release\/.+/.test(branch);
}
