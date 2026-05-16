import { computeSha256ForContent } from '../hash-lock/hash-lock.ts';
import type {
  RegistryMapEdgeRecord,
  RegistryMapMemberRecord,
  RegistryMapQualityTargetsRecord,
  AtomicMapReplacementRecord
} from '../index';
export { createAtomicMapSemanticFingerprint } from './semantic-fingerprint.ts';

export interface AtomicMapHashInput {
  readonly members: readonly RegistryMapMemberRecord[];
  readonly edges: readonly RegistryMapEdgeRecord[];
  readonly entrypoints: readonly string[];
  readonly qualityTargets?: RegistryMapQualityTargetsRecord;
  readonly replacement?: AtomicMapReplacementRecord;
}

export function createAtomicMapHashPayload(input: AtomicMapHashInput) {
  return {
    members: normalizeAtomicMapMembers(input.members),
    edges: normalizeAtomicMapEdges(input.edges),
    entrypoints: normalizeAtomicMapEntrypoints(input.entrypoints),
    ...(input.replacement ? { replacement: normalizeAtomicMapReplacement(input.replacement) } : {})
  };
}

export function computeAtomicMapHash(input: AtomicMapHashInput): string {
  return computeSha256ForContent(JSON.stringify(createAtomicMapHashPayload(input)));
}

function normalizeAtomicMapMembers(members: readonly RegistryMapMemberRecord[] = []) {
  return [...members]
    .map((member) => ({
      atomId: String(member.atomId).trim(),
      version: String(member.version).trim(),
      ...(member.role ? { role: String(member.role).trim() } : {})
    }))
    .sort((left, right) => left.atomId.localeCompare(right.atomId) || left.version.localeCompare(right.version) || String(left.role ?? '').localeCompare(String(right.role ?? '')));
}

function normalizeAtomicMapEdges(edges: readonly RegistryMapEdgeRecord[] = []) {
  return [...edges]
    .map((edge) => ({
      from: String(edge.from).trim(),
      to: String(edge.to).trim(),
      binding: String(edge.binding).trim(),
      ...(edge.edgeKind ? { edgeKind: String(edge.edgeKind).trim() } : {})
    }))
    .sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to) || left.binding.localeCompare(right.binding) || String(left.edgeKind ?? '').localeCompare(String(right.edgeKind ?? '')));
}

function normalizeAtomicMapEntrypoints(entrypoints: readonly string[] = []) {
  return [...entrypoints]
    .map((entrypoint) => String(entrypoint).trim())
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function normalizeAtomicMapQualityTargets(qualityTargets: RegistryMapQualityTargetsRecord = {}) {
  const normalizedEntries = Object.entries(qualityTargets)
    .map(([key, value]) => [String(key).trim(), typeof value === 'string' ? value.trim() : value] as const)
    .filter(([key]) => key.length > 0)
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
  return Object.fromEntries(normalizedEntries) as RegistryMapQualityTargetsRecord;
}

function normalizeAtomicMapReplacement(replacement: AtomicMapReplacementRecord) {
  return {
    legacyUris: [...replacement.legacyUris]
      .map((legacyUri) => String(legacyUri).trim())
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right))
  };
}
