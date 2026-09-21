export function runnerPublicationEvidencePath(taskId: string, schemaId: unknown): string | null {
  if (schemaId === 'atm.runnerSyncReceipt.v1') {
    return `.atm/history/evidence/${taskId}.runner-sync-receipt.json`;
  }
  if (schemaId === 'atm.runnerPublicationTakeoverPlan.v1') {
    return `.atm/history/evidence/${taskId}.runner-publication-takeover.json`;
  }
  return null;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

export function isLockBackedRunnerPublicationEvidence(file: string, evidence: Record<string, unknown> | null | undefined, taskId: string): boolean {
  const expectedPath = runnerPublicationEvidencePath(taskId, evidence?.schemaId);
  if (!expectedPath || normalizeRelativePath(file) !== expectedPath) return false;
  if (evidence?.schemaId === 'atm.runnerSyncReceipt.v1') {
    return typeof evidence.actorId === 'string' && evidence.actorId.trim().length > 0;
  }
  if (typeof evidence?.sealedSourceSha !== 'string' || !/^[0-9a-f]{40}$/i.test(evidence.sealedSourceSha)) return false;
  if (typeof evidence.snapshotDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(evidence.snapshotDigest)) return false;
  if (typeof evidence.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(evidence.digest)) return false;
  return Array.isArray(evidence.entries)
    && evidence.entries.length > 0
    && evidence.entries.every((entry) => typeof entry?.path === 'string'
      && typeof entry?.observedDigest === 'string'
      && /^(packages\/cli\/dist|release\/atm-root-drop|release\/atm-onefile)\//.test(normalizeRelativePath(entry.path)));
}

export function isFreshFrameworkTempLock(lock: Record<string, unknown> | null | undefined, now = Date.now()): boolean {
  const heartbeatMs = typeof lock?.heartbeatAt === 'string' ? Date.parse(lock.heartbeatAt) : Number.NaN;
  const ttlSeconds = typeof lock?.ttlSeconds === 'number'
    ? lock.ttlSeconds
    : typeof lock?.ttlSeconds === 'string' ? Number(lock.ttlSeconds) : Number.NaN;
  return typeof lock?.workItemId === 'string'
    && lock.workItemId.startsWith('ATM-FRAMEWORK-TEMP-')
    && Number.isFinite(heartbeatMs)
    && Number.isFinite(ttlSeconds)
    && ttlSeconds > 0
    && now - heartbeatMs <= ttlSeconds * 1000;
}
