import {
  isEvidenceRealness,
  type AcceptanceEvidenceMap,
  type AcceptanceEvidencePredicate
} from '../../../../core/src/evidence/index.ts';

export interface AcceptanceEvidenceImportResult {
  readonly value?: AcceptanceEvidenceMap;
  readonly errors: readonly string[];
}

/** Preserve an authored acceptance-evidence contract without inferring stronger evidence. */
export function parseAcceptanceEvidenceMap(value: unknown): AcceptanceEvidenceImportResult {
  if (value === undefined || value === null || value === '') return { errors: [] };
  let candidate = value;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate.trim().replace(/^['"`]|['"`]$/g, ''));
    } catch {
      return { errors: ['acceptanceEvidence must be an object or JSON object'] };
    }
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { errors: ['acceptanceEvidence must be an object map'] };
  }

  const output: Record<string, AcceptanceEvidencePredicate> = {};
  const errors: string[] = [];
  for (const [key, rawPredicate] of Object.entries(candidate as Record<string, unknown>)) {
    const predicate = parsePredicate(key, rawPredicate, errors);
    if (predicate) output[key] = predicate;
  }
  if (Object.keys(output).length === 0 && errors.length === 0) {
    errors.push('acceptanceEvidence must contain at least one predicate');
  }
  return errors.length > 0 ? { errors } : { value: output, errors: [] };
}

function parsePredicate(key: string, value: unknown, errors: string[]): AcceptanceEvidencePredicate | null {
  const prefix = `acceptanceEvidence.${key}`;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) errors.push(`${prefix} has an invalid predicate key`);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${prefix} must be an object`);
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = requiredString(record.id, `${prefix}.id`, errors);
  const claim = requiredString(record.claim, `${prefix}.claim`, errors);
  const authoritativeSources = requiredStringArray(record.authoritativeSources, `${prefix}.authoritativeSources`, errors);
  const derivationRule = requiredString(record.derivationRule, `${prefix}.derivationRule`, errors);
  const requiredRealness = record.requiredRealness;
  if (!isEvidenceRealness(requiredRealness)) errors.push(`${prefix}.requiredRealness is unknown`);
  const verifier = parseVerifier(record.verifier, `${prefix}.verifier`, errors);
  const negativeControls = parseNegativeControls(record.negativeControls, `${prefix}.negativeControls`, errors);
  if (record.missingDataVerdict !== 'inconclusive') errors.push(`${prefix}.missingDataVerdict must be inconclusive`);
  if (typeof record.closureCritical !== 'boolean') errors.push(`${prefix}.closureCritical must be boolean`);
  if (id && id !== key) errors.push(`${prefix}.id must match its map key`);
  if (!id || !claim || !derivationRule || !isEvidenceRealness(requiredRealness) || !verifier) return null;
  return {
    id,
    claim,
    authoritativeSources,
    derivationRule,
    requiredRealness,
    verifier,
    negativeControls,
    missingDataVerdict: 'inconclusive',
    closureCritical: record.closureCritical === true
  };
}

function parseVerifier(
  value: unknown,
  fieldPath: string,
  errors: string[]
): AcceptanceEvidencePredicate['verifier'] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${fieldPath} must be an object`);
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.mode === 'separate-actor') {
    const actorId = optionalString(record.actorId);
    return { mode: 'separate-actor', ...(actorId ? { actorId } : {}) };
  }
  if (record.mode === 'locked-policy') {
    const policyDigest = requiredString(record.policyDigest, `${fieldPath}.policyDigest`, errors);
    if (policyDigest && !/^sha256:[a-f0-9]{64}$/i.test(policyDigest)) {
      errors.push(`${fieldPath}.policyDigest must be a sha256 digest`);
    }
    return policyDigest ? { mode: 'locked-policy', policyDigest } : null;
  }
  errors.push(`${fieldPath}.mode must be separate-actor or locked-policy`);
  return null;
}

function parseNegativeControls(
  value: unknown,
  fieldPath: string,
  errors: string[]
): AcceptanceEvidencePredicate['negativeControls'] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${fieldPath} must contain at least one negative control`);
    return [];
  }
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`${fieldPath}[${index}] must be an object`);
      return [];
    }
    const record = entry as Record<string, unknown>;
    const id = requiredString(record.id, `${fieldPath}[${index}].id`, errors);
    const expectedFailureReason = requiredString(
      record.expectedFailureReason,
      `${fieldPath}[${index}].expectedFailureReason`,
      errors
    );
    return id && expectedFailureReason ? [{ id, expectedFailureReason }] : [];
  });
}

function requiredString(value: unknown, fieldPath: string, errors: string[]): string {
  const normalized = optionalString(value);
  if (!normalized) errors.push(`${fieldPath} must be a non-empty string`);
  return normalized ?? '';
}

function requiredStringArray(value: unknown, fieldPath: string, errors: string[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => !optionalString(entry))) {
    errors.push(`${fieldPath} must contain non-empty strings`);
    return [];
  }
  return value.map((entry) => String(entry).trim());
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
