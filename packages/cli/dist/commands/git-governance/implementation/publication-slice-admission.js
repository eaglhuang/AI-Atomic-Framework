import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { derivePublicationDeliverySliceManifest, resolvePublicationDeliverySlice } from '../../../_vendor/core/dist/git/publication-delivery-slice.js';
import { normalizeRelativePath, pathMatchesTaskScope, uniqueSorted } from '../commit-scope-policy.js';
import { runGitCommand } from './git-process-port.js';
function readHeadDirtyNames(cwd) {
    try {
        return runGitCommand(cwd, ['diff', 'HEAD', '--name-only']).split(/\r?\n/).map(normalizeRelativePath).filter(Boolean);
    }
    catch {
        return [];
    }
}
export function resolvePublicationSliceAdmission(input) {
    const manifestValue = typeof input.manifestPath === 'string' ? input.manifestPath.trim() : '';
    const receiptValue = typeof input.receiptPath === 'string' ? input.receiptPath.trim() : '';
    const hasManifest = Boolean(manifestValue);
    const hasReceipt = Boolean(receiptValue);
    let rejection = hasManifest && hasReceipt ? { code: 'ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', reason: '--delivery-slice-manifest and --delivery-slice-receipt are mutually exclusive' } : null;
    let stageFiles = null;
    if (!hasManifest && !hasReceipt)
        return { deliverySliceRejection: rejection, deliverySliceStageFiles: stageFiles };
    const manifestRel = hasManifest ? normalizeRelativePath(manifestValue) : '';
    const receiptRel = hasReceipt ? normalizeRelativePath(receiptValue) : '';
    const manifestAbsolute = manifestRel ? path.join(input.cwd, manifestRel) : '';
    let parsedManifest = null;
    let parsedReceipt = null;
    if (hasManifest && !existsSync(manifestAbsolute))
        rejection = { code: 'ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', reason: `delivery-slice manifest is missing: ${manifestRel}` };
    else if (hasManifest)
        try {
            parsedManifest = JSON.parse(readFileSync(manifestAbsolute, 'utf8'));
        }
        catch {
            rejection = { code: 'ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', reason: `delivery-slice manifest is not valid JSON: ${manifestRel}` };
        }
    const declaredReceiptRel = hasManifest && typeof parsedManifest?.receiptPath === 'string' ? normalizeRelativePath(parsedManifest.receiptPath) : receiptRel;
    const receiptAbsolute = declaredReceiptRel ? path.join(input.cwd, declaredReceiptRel) : '';
    if (!rejection && receiptAbsolute && existsSync(receiptAbsolute))
        try {
            parsedReceipt = JSON.parse(readFileSync(receiptAbsolute, 'utf8'));
        }
        catch {
            rejection = { code: 'ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', reason: `delivery-slice receipt is not valid JSON: ${declaredReceiptRel}` };
        }
    if (!rejection && hasReceipt) {
        const canonicalReceipt = `.atm/history/evidence/${input.taskId}.runner-sync-receipt.json`;
        if (declaredReceiptRel !== canonicalReceipt)
            rejection = { code: 'ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', reason: `delivery-slice receipt must be the current task canonical receipt: ${canonicalReceipt}` };
        else
            parsedManifest = derivePublicationDeliverySliceManifest({ receiptPath: declaredReceiptRel, receipt: parsedReceipt });
    }
    if (!rejection) {
        const slice = resolvePublicationDeliverySlice({ manifest: parsedManifest, receipt: parsedReceipt, dirtyPaths: uniqueSorted([...input.effectiveDirtyFiles, ...readHeadDirtyNames(input.cwd)]), allowedScope: input.declaredScope, pathMatchesScope: pathMatchesTaskScope });
        if (!slice.ok)
            rejection = { code: slice.code, reason: slice.reason };
        else
            stageFiles = slice.stageFiles;
    }
    return { deliverySliceRejection: rejection, deliverySliceStageFiles: stageFiles };
}
