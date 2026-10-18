/**
 * Per-field normalizers for the map-generator request.
 *
 * Extracted from `packages/core/src/manager/map-generator.ts` per the
 * `map-generator.SPLIT_PLAN.md` Layer 2 split. These helpers each
 * coerce / validate one input field and throw a `GeneratorError` with
 * a stable code on invalid input.
 *
 * Surface contract: error codes (`ATM_MAP_GENERATOR_*`) and the regex
 * shapes (`ATM-{BUCKET}-{NNNN}`, `x.y.z`) are part of the upgrade
 * proposal invariant (I2). Behavior is preserved byte-for-byte from
 * the original definitions.
 */
import { parseMapId } from '../map-id-allocator.js';
import { createGeneratorError } from './errors.js';
export function normalizeAtomId(value, fieldName) {
    const atomId = String(value || '').trim();
    if (!/^ATM-[A-Z][A-Z0-9]*-\d{4}$/.test(atomId)) {
        throw createGeneratorError('ATM_MAP_GENERATOR_ATOM_ID_INVALID', `${fieldName} must match ATM-{BUCKET}-{NNNN}.`, {
            fieldName,
            atomId: value
        });
    }
    return atomId;
}
export function normalizeMapId(value) {
    const parsed = parseMapId(value);
    if (!parsed) {
        throw createGeneratorError('ATM_MAP_GENERATOR_MAP_ID_INVALID', 'mapId must match ATM-MAP-{NNNN}.', { mapId: value });
    }
    return parsed.mapId;
}
export function normalizeSemver(value, fieldName) {
    const version = String(value || '').trim();
    if (!/^\d+\.\d+\.\d+$/.test(version)) {
        throw createGeneratorError('ATM_MAP_GENERATOR_VERSION_INVALID', `${fieldName} must match semver x.y.z.`, {
            fieldName,
            version: value
        });
    }
    return version;
}
export function normalizeRequiredText(value, fieldName) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw createGeneratorError('ATM_MAP_GENERATOR_REQUEST_INVALID', `Atomic map generator requires ${fieldName}.`, { fieldName });
    }
    return value.trim();
}
export function normalizeSpecVersion(value) {
    const specVersion = String(value || '').trim();
    if (!['0.1.0', '0.2.0'].includes(specVersion)) {
        throw createGeneratorError('ATM_MAP_GENERATOR_SPEC_VERSION_INVALID', 'Atomic map specVersion must be 0.1.0 or 0.2.0.', { specVersion: value });
    }
    return specVersion;
}
export function inferSpecVersion(input) {
    const hasMemberRoles = input.members.some((member) => Boolean(member.role));
    const hasEdgeKinds = input.edges.some((edge) => Boolean(edge.edgeKind));
    return hasMemberRoles || hasEdgeKinds || input.replacement ? '0.2.0' : '0.1.0';
}
export function assertSpecVersionSupportsMapSurface(specVersion, input) {
    if (specVersion !== '0.1.0') {
        return;
    }
    const hasMemberRoles = input.members.some((member) => Boolean(member.role));
    const hasEdgeKinds = input.edges.some((edge) => Boolean(edge.edgeKind));
    if (hasMemberRoles || hasEdgeKinds || input.replacement) {
        throw createGeneratorError('ATM_MAP_GENERATOR_SPEC_VERSION_INVALID', 'Atomic map replacement surface fields require specVersion 0.2.0.', { specVersion });
    }
}
