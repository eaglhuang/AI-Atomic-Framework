const hashPattern = /^sha256:[a-f0-9]{64}$/;

export function normalizeVersionLineage(lineageLog: Record<string, unknown> | null | undefined, options: {
  atomId: string;
  mapId: string;
  fromVersion: string;
  toVersion: string;
  sourceRef: string;
  timestamp: string;
}) {
  const issues: string[] = [];
  const lineage = extractLineageCandidate(lineageLog, options.atomId);
  if (!isObject(lineage)) {
    return { ok: false as const, issues: ['lineage log must expose versionLineage, versionLineages[atomId], or members[].versionLineage.'] };
  }

  if (!lineageLogMatchesMap(lineageLog, options.mapId)) {
    issues.push(`lineage log does not identify target map ${options.mapId}.`);
  }

  const currentVersion = String(lineage.currentVersion ?? '').trim();
  if (currentVersion !== options.toVersion) {
    issues.push(`versionLineage.currentVersion must equal --to ${options.toVersion}.`);
  }

  const versions = lineage && Array.isArray((lineage as { versions?: unknown }).versions)
    ? ((lineage as { versions: unknown[] }).versions).map((version: unknown) => normalizeVersionRecord(version as Record<string, unknown> | null | undefined)).sort(compareVersionRecords)
    : [];
  if (versions.length === 0) {
    issues.push('versionLineage.versions must contain at least one version record.');
  }
  if (!versions.some((version) => version.version === options.fromVersion)) {
    issues.push(`versionLineage.versions must include --from ${options.fromVersion}.`);
  }
  if (!versions.some((version) => version.version === options.toVersion)) {
    issues.push(`versionLineage.versions must include --to ${options.toVersion}.`);
  }
  for (const version of versions) {
    if (!version.version) issues.push('version records require version.');
    if (!hashPattern.test(version.specHash)) issues.push(`version ${version.version || '<unknown>'} has invalid specHash.`);
    if (!hashPattern.test(version.codeHash)) issues.push(`version ${version.version || '<unknown>'} has invalid codeHash.`);
    if (!hashPattern.test(version.testHash)) issues.push(`version ${version.version || '<unknown>'} has invalid testHash.`);
    if (version.timestamp && !isIsoDate(version.timestamp)) issues.push(`version ${version.version || '<unknown>'} has invalid timestamp.`);
  }

  if (issues.length > 0) {
    return { ok: false as const, issues };
  }

  return {
    ok: true as const,
    lineage: {
      currentVersion: options.toVersion,
      versions,
      sourceRef: String((lineage as { sourceRef?: unknown })?.sourceRef ?? options.sourceRef).trim() || options.sourceRef,
      advisory: String((lineage as { advisory?: unknown })?.advisory ?? 'Backfilled from adopter lineage evidence.').trim(),
      updatedAt: options.timestamp
    }
  };
}

export function lineageLogMatchesMap(lineageLog: Record<string, unknown> | null | undefined, mapId: string) {
  return [lineageLog?.canonicalMapId, lineageLog?.mapId, (lineageLog?.target as { mapId?: unknown })?.mapId]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean)
    .includes(mapId);
}

export function resolveBackfillTimestamp(optionAt: unknown, lineageLog: Record<string, unknown> | null | undefined, atomId: string) {
  const candidates = [
    optionAt,
    (extractLineageCandidate(lineageLog, atomId) as Record<string, unknown> | null)?.updatedAt,
    lineageLog?.updatedAt,
    lineageLog?.generatedAt
  ];
  for (const candidate of candidates) {
    const value = String(candidate ?? '').trim();
    if (isIsoDate(value)) {
      return value;
    }
  }
  return new Date().toISOString();
}

function extractLineageCandidate(lineageLog: Record<string, unknown> | null | undefined, atomId: string) {
  if (lineageLog && isObject(lineageLog.versionLineage)) return lineageLog.versionLineage;
  if (lineageLog && isObject(lineageLog.memberVersionLineage)) return lineageLog.memberVersionLineage;
  if (lineageLog && isObject((lineageLog.versionLineages as Record<string, unknown>)?.[atomId])) return (lineageLog.versionLineages as Record<string, unknown>)[atomId];
  const member = lineageLog && Array.isArray(lineageLog.members)
    ? lineageLog.members.find((entry: unknown) => isObject(entry) && String((entry as Record<string, unknown>)?.atomId ?? '').trim() === atomId)
    : null;
  if (member && isObject((member as Record<string, unknown>).versionLineage)) return (member as Record<string, unknown>).versionLineage;
  const backfill = lineageLog && Array.isArray(lineageLog.versionBackfills)
    ? lineageLog.versionBackfills.find((entry: unknown) => isObject(entry) && String((entry as Record<string, unknown>)?.atomId ?? '').trim() === atomId && isObject((entry as Record<string, unknown>)?.versionLineage))
    : null;
  return (backfill as Record<string, unknown> | null)?.versionLineage ?? null;
}

function normalizeVersionRecord(version: Record<string, unknown> | null | undefined) {
  const normalized: { version: string; specHash: string; codeHash: string; testHash: string; timestamp: string; semanticFingerprint?: string | null } = {
    version: String(version?.version ?? '').trim(),
    specHash: String(version?.specHash ?? '').trim(),
    codeHash: String(version?.codeHash ?? '').trim(),
    testHash: String(version?.testHash ?? '').trim(),
    timestamp: String(version?.timestamp ?? '').trim()
  };
  if (version?.semanticFingerprint === null) {
    normalized.semanticFingerprint = null;
  } else if (typeof version?.semanticFingerprint === 'string' && version.semanticFingerprint.trim()) {
    normalized.semanticFingerprint = String(version.semanticFingerprint).trim();
  }
  return normalized;
}

function compareVersionRecords(left: { version: string }, right: { version: string }) {
  return compareVersionStrings(left.version, right.version);
}

function compareVersionStrings(left: string, right: string) {
  const leftParts = left.split('.').map((part) => Number(part));
  const rightParts = right.split('.').map((part) => Number(part));
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return left.localeCompare(right);
}

function isIsoDate(value: string) {
  return Boolean(value && !Number.isNaN(Date.parse(value)));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
