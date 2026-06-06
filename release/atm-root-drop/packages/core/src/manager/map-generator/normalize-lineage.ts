/**
 * Replacement / lineage normalizers for the map-generator request.
 *
 * Extracted from `packages/core/src/manager/map-generator.ts` per the
 * `map-generator.SPLIT_PLAN.md` Layer 2 split. These helpers coerce
 * the legacy replacement / lineage surface (introduced at specVersion
 * 0.2.0) into the canonical proposal shape.
 *
 * Surface contract: error codes (`ATM_MAP_GENERATOR_*`), the
 * `legacy://` URI pattern, and the `localeCompare` sort orders are
 * upgrade-proposal invariant (I2). Behavior preserved byte-for-byte.
 */
import { createGeneratorError } from './errors.ts';

const memberRoles = new Set(['entry-adapter', 'domain-step', 'validator', 'side-effect', 'rollback-adapter']);
const edgeKinds = new Set(['data-flow', 'control-flow', 'event-flow', 'validation', 'fallback', 'side-effect', 'rollback']);
const replacementModes = new Set(['draft', 'shadow', 'canary', 'active', 'legacy-retired']);

export function normalizeOptionalMemberRole(value: any) {
  if (value == null || String(value).trim() === '') {
    return {};
  }
  const role = String(value).trim();
  if (!memberRoles.has(role)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_MEMBER_ROLE_INVALID', 'members[].role is not a known atomic map member role.', { role });
  }
  return { role };
}

export function normalizeOptionalEdgeKind(value: any) {
  if (value == null || String(value).trim() === '') {
    return {};
  }
  const edgeKind = String(value).trim();
  if (!edgeKinds.has(edgeKind)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_EDGE_KIND_INVALID', 'edges[].edgeKind is not a known atomic map edge kind.', { edgeKind });
  }
  return { edgeKind };
}

export function normalizeReplacement(replacement: any) {
  if (replacement == null) {
    return null;
  }
  if (typeof replacement !== 'object' || Array.isArray(replacement)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REPLACEMENT_INVALID', 'replacement must be an object.', { fieldName: 'replacement' });
  }
  const legacyUris = normalizeLegacyUris(replacement.legacyUris);
  const mode = normalizeReplacementMode(replacement.mode ?? 'draft');
  const evidenceRefs = normalizeEvidenceRefs(replacement.evidenceRefs ?? []);
  return { legacyUris, mode, evidenceRefs };
}

export function normalizeLegacyUris(values: any) {
  if (!Array.isArray(values) || values.length === 0) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REPLACEMENT_INVALID', 'replacement.legacyUris must contain at least one legacy:// URI.', { fieldName: 'replacement.legacyUris' });
  }
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .map((legacyUri) => {
      if (!/^legacy:\/\/.+/.test(legacyUri)) {
        throw createGeneratorError('ATM_MAP_GENERATOR_REPLACEMENT_INVALID', 'replacement.legacyUris entries must start with legacy://.', { legacyUri });
      }
      return legacyUri;
    })
    .sort((left, right) => left.localeCompare(right));
}

export function normalizeReplacementMode(value: any) {
  const mode = String(value || '').trim();
  if (!replacementModes.has(mode)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REPLACEMENT_INVALID', 'replacement.mode is not a valid rollout mode.', { mode: value });
  }
  return mode;
}

export function normalizeEvidenceRefs(values: any) {
  if (!Array.isArray(values)) {
    throw createGeneratorError('ATM_MAP_GENERATOR_REPLACEMENT_INVALID', 'replacement.evidenceRefs must be an array.', { fieldName: 'replacement.evidenceRefs' });
  }
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}
