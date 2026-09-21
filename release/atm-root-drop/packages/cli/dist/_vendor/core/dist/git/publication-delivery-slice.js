import { evaluateRunnerPublicationDisposition, validateRunnerBuildOutputInventory, } from '../broker/runner-build-output-inventory.js';
export const PUBLICATION_DELIVERY_SLICE_MANIFEST_SCHEMA_ID = 'atm.publicationDeliverySliceManifest.v1';
function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function uniqueSorted(paths) {
    return [...new Set(paths.map(normalizePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
export function parsePublicationDeliverySliceManifest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const raw = value;
    if (raw.schemaId !== PUBLICATION_DELIVERY_SLICE_MANIFEST_SCHEMA_ID)
        return null;
    const receiptPath = typeof raw.receiptPath === 'string' ? normalizePath(raw.receiptPath) : '';
    const expectedSealedSourceSha = typeof raw.expectedSealedSourceSha === 'string' ? raw.expectedSealedSourceSha.trim() : '';
    const expectedInventoryDigest = typeof raw.expectedInventoryDigest === 'string' ? raw.expectedInventoryDigest.trim() : '';
    const expectedPublicationDisposition = raw.expectedPublicationDisposition === 'recovery-retained'
        ? 'recovery-retained'
        : raw.expectedPublicationDisposition === 'published'
            ? 'published'
            : null;
    if (!receiptPath || !expectedSealedSourceSha || !expectedInventoryDigest || !expectedPublicationDisposition)
        return null;
    return {
        schemaId: PUBLICATION_DELIVERY_SLICE_MANIFEST_SCHEMA_ID,
        receiptPath,
        expectedSealedSourceSha,
        expectedInventoryDigest,
        expectedPublicationDisposition,
    };
}
/**
 * Creates the narrow delivery selector from the immutable publication receipt
 * itself.  This removes an operator-maintained copy of the sealed SHA and
 * inventory digest while leaving the downstream resolver responsible for
 * validating the receipt and its inventory fail-closed.
 */
export function derivePublicationDeliverySliceManifest(input) {
    if (!input.receipt || typeof input.receipt !== 'object' || Array.isArray(input.receipt)) {
        return null;
    }
    const receipt = input.receipt;
    const sealedSourceSha = typeof receipt.sealedSourceSha === 'string' ? receipt.sealedSourceSha.trim() : '';
    const rawInventory = receipt.outputInventory;
    const expectedInventoryDigest = rawInventory && typeof rawInventory === 'object' && !Array.isArray(rawInventory)
        && typeof rawInventory.digest === 'string'
        ? String(rawInventory.digest).trim()
        : '';
    const receiptPath = normalizePath(input.receiptPath);
    const expectedPublicationDisposition = receipt.publicationDisposition === 'recovery-retained'
        ? 'recovery-retained'
        : receipt.publicationDisposition === 'published'
            ? 'published'
            : null;
    if (!receiptPath || !sealedSourceSha || !expectedInventoryDigest || !expectedPublicationDisposition)
        return null;
    return {
        schemaId: PUBLICATION_DELIVERY_SLICE_MANIFEST_SCHEMA_ID,
        receiptPath,
        expectedSealedSourceSha: sealedSourceSha,
        expectedInventoryDigest,
        expectedPublicationDisposition,
    };
}
function requiredRecordPaths(receiptPath, receiptTaskId) {
    const taskId = receiptTaskId.trim();
    if (!taskId)
        return [receiptPath];
    return uniqueSorted([
        receiptPath,
        `.atm/history/tasks/${taskId}.json`,
        `.atm/history/evidence/${taskId}.runner-sync-receipt.json`,
        `.atm/history/evidence/${taskId}.runner-publication-takeover.json`,
    ]);
}
function isRequiredRecord(filePath, receiptPath, receiptTaskId) {
    const normalized = normalizePath(filePath);
    const taskId = receiptTaskId.trim();
    if (requiredRecordPaths(receiptPath, taskId).includes(normalized))
        return true;
    return Boolean(taskId) && normalized.startsWith(`.atm/history/task-events/${taskId}/`);
}
export function resolvePublicationDeliverySlice(input) {
    const empty = {
        inventoryMembers: [],
        requiredRecords: [],
        stageFiles: [],
    };
    const fail = (code, reason, extra) => ({
        ok: false,
        code,
        reason,
        ...empty,
        ...extra,
    });
    const manifest = parsePublicationDeliverySliceManifest(input.manifest);
    if (!manifest) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', 'delivery-slice manifest must declare schemaId atm.publicationDeliverySliceManifest.v1 with receiptPath, expectedSealedSourceSha, expectedInventoryDigest, and expectedPublicationDisposition');
    }
    if (!input.receipt || typeof input.receipt !== 'object' || Array.isArray(input.receipt)) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', 'runner-sync receipt is missing or not an object');
    }
    const receipt = input.receipt;
    if (receipt.schemaId !== 'atm.runnerSyncReceipt.v1') {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', 'runner-sync receipt schemaId is invalid');
    }
    const receiptDisposition = String(receipt.publicationDisposition ?? '').trim();
    if (receiptDisposition !== manifest.expectedPublicationDisposition) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_NOT_PUBLISHED', `runner-sync receipt publicationDisposition must match the delivery-slice manifest: ${manifest.expectedPublicationDisposition}`);
    }
    const sealedSourceSha = typeof receipt.sealedSourceSha === 'string' ? receipt.sealedSourceSha.trim() : '';
    if (sealedSourceSha !== manifest.expectedSealedSourceSha) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_MANIFEST_MISMATCH', 'delivery-slice expectedSealedSourceSha does not match the receipt sealedSourceSha');
    }
    const validated = validateRunnerBuildOutputInventory(receipt.outputInventory);
    if (!validated.ok || !validated.inventory) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', validated.reason ?? 'runner-sync receipt output inventory is invalid');
    }
    if (validated.inventory.digest !== manifest.expectedInventoryDigest) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_MANIFEST_MISMATCH', 'delivery-slice expectedInventoryDigest does not match the receipt inventory digest');
    }
    if (validated.inventory.sealedSourceSha !== sealedSourceSha) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_MANIFEST_MISMATCH', 'receipt inventory sealedSourceSha does not match the receipt sealedSourceSha');
    }
    const dirtyPaths = uniqueSorted(input.dirtyPaths);
    const disposition = evaluateRunnerPublicationDisposition({
        inventory: validated.inventory,
        dirtyPaths,
        terminalDisposition: 'published',
    });
    if (disposition.extraOutputPaths.length > 0) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_FOREIGN_DIRTY', `publication dirty paths are not exact inventory members: ${disposition.extraOutputPaths.join(', ')}`);
    }
    const recoveryRetainedPaths = receiptDisposition === 'recovery-retained'
        ? uniqueSorted(Array.isArray(receipt.recoveryRetainedPaths)
            ? receipt.recoveryRetainedPaths.filter((value) => typeof value === 'string')
            : [])
        : [];
    if (receiptDisposition === 'recovery-retained' && recoveryRetainedPaths.length === 0) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', 'recovery-retained runner-sync receipts must declare non-empty recoveryRetainedPaths');
    }
    const inventoryPathSet = new Set(validated.inventory.entries.map((entry) => normalizePath(entry.path)));
    const nonInventoryRetainedPaths = recoveryRetainedPaths.filter((filePath) => !inventoryPathSet.has(filePath));
    if (nonInventoryRetainedPaths.length > 0) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', `recoveryRetainedPaths must be output inventory members: ${nonInventoryRetainedPaths.join(', ')}`);
    }
    const inventoryEntriesByPath = new Map(validated.inventory.entries.map((entry) => [normalizePath(entry.path), entry]));
    const retainedOwnedCurrentPaths = recoveryRetainedPaths.filter((filePath) => inventoryEntriesByPath.get(filePath)?.disposition === 'owned-current');
    if (retainedOwnedCurrentPaths.length > 0) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID', `recoveryRetainedPaths cannot suppress owned-current delivery members: ${retainedOwnedCurrentPaths.join(', ')}`);
    }
    const unreconciledForeignPaths = receiptDisposition === 'recovery-retained'
        ? disposition.dirtyInventoryPaths.filter((filePath) => (!recoveryRetainedPaths.includes(filePath)
            && inventoryEntriesByPath.get(filePath)?.disposition !== 'owned-current'))
        : [];
    if (unreconciledForeignPaths.length > 0) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_FOREIGN_DIRTY', `recovery-retained receipt leaves non-owned dirty inventory members without an explicit retention: ${unreconciledForeignPaths.join(', ')}`);
    }
    const inScope = (filePath) => input.allowedScope.some((scope) => input.pathMatchesScope(filePath, scope));
    const selectedInventoryMembers = receiptDisposition === 'recovery-retained'
        ? disposition.dirtyInventoryPaths.filter((filePath) => (!recoveryRetainedPaths.includes(filePath)
            && inventoryEntriesByPath.get(filePath)?.disposition === 'owned-current'))
        : disposition.dirtyInventoryPaths;
    const outOfScopeMembers = selectedInventoryMembers.filter((filePath) => !inScope(filePath));
    if (outOfScopeMembers.length > 0) {
        return fail('ATM_GIT_COMMIT_DELIVERY_SLICE_OUT_OF_SCOPE', `inventory dirty members are outside the active allowed scope: ${outOfScopeMembers.join(', ')}`, { inventoryMembers: [...selectedInventoryMembers] });
    }
    const receiptTaskId = typeof receipt.taskId === 'string' ? receipt.taskId.trim() : '';
    const requiredRecords = uniqueSorted(dirtyPaths.filter((filePath) => isRequiredRecord(filePath, manifest.receiptPath, receiptTaskId) && inScope(filePath)));
    const inventoryMembers = uniqueSorted(selectedInventoryMembers);
    return {
        ok: true,
        code: null,
        reason: null,
        inventoryMembers,
        requiredRecords,
        stageFiles: uniqueSorted([...inventoryMembers, ...requiredRecords]),
    };
}
