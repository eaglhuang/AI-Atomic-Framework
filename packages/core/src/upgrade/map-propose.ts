import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CANONICAL_MAP_ID_PATTERN = /^ATM-MAP-\d{4}$/;
const LEGACY_MAP_ID_PATTERN = /^map[./:_-]/i;

export function buildMapProposalContext({ repositoryRoot, mapId, atomId, fromVersion, toVersion }: any) {
  const canonicalMapId = normalizeMapId(mapId);
  const mapSpecPath = `atomic_workbench/maps/${canonicalMapId}/map.spec.json`;
  const absoluteMapSpecPath = path.join(repositoryRoot, mapSpecPath);

  if (!existsSync(absoluteMapSpecPath)) {
    throw new Error(`map-propose could not find canonical map spec at ${mapSpecPath}.`);
  }

  const mapSpec = parseJsonFile(absoluteMapSpecPath, mapSpecPath);
  if (mapSpec.mapId !== canonicalMapId) {
    throw new Error(`map-propose mapId mismatch: expected ${canonicalMapId} but received ${mapSpec.mapId}.`);
  }

  const members = buildMemberUpgradeMapping({
    members: mapSpec.members,
    atomId,
    fromVersion,
    toVersion
  });

  return {
    mapId: canonicalMapId,
    mapSpecPath,
    members,
    generatorProvenance: resolveMapGeneratorProvenance(repositoryRoot, canonicalMapId, mapSpec)
  };
}

export function normalizeMapId(mapId: any) {
  if (typeof mapId !== 'string' || mapId.length === 0) {
    throw new Error('map-propose requires target.mapId.');
  }

  if (LEGACY_MAP_ID_PATTERN.test(mapId)) {
    throw new Error(`Legacy mapId ${mapId} is not allowed. Use canonical ATM-MAP-{NNNN}.`);
  }

  if (!CANONICAL_MAP_ID_PATTERN.test(mapId)) {
    throw new Error(`Invalid mapId ${mapId}. Expected ATM-MAP-{NNNN}.`);
  }

  return mapId;
}

function buildMemberUpgradeMapping({ members, atomId, fromVersion, toVersion }: any) {
  const safeMembers = Array.isArray(members) ? members : [];
  const mapping = safeMembers.map((member) => {
    const memberAtomId = String(member?.atomId ?? '').trim();
    const memberVersion = String(member?.version ?? '').trim();
    const nextVersion = memberAtomId === atomId && memberVersion === fromVersion
      ? toVersion
      : memberVersion;

    return {
      from: `${memberAtomId}@${memberVersion}`,
      to: `${memberAtomId}@${nextVersion}`
    };
  });

  const touched = mapping.some((entry) => entry.from.startsWith(`${atomId}@`));
  if (!touched) {
    mapping.push({
      from: `${atomId}@${fromVersion}`,
      to: `${atomId}@${toVersion}`
    });
  }

  return mapping;
}

function resolveMapGeneratorProvenance(repositoryRoot: any, mapId: any, mapSpec: any) {
  const registryPath = path.join(repositoryRoot, 'atomic-registry.json');
  if (!existsSync(registryPath)) {
    return inferProvenanceFromSpec(mapSpec);
  }

  const registry = parseJsonFile(registryPath, 'atomic-registry.json');
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const mapEntry = entries.find((entry: any) => entry?.schemaId === 'atm.atomicMap' && entry?.mapId === mapId);
  if (!mapEntry) {
    return inferProvenanceFromSpec(mapSpec);
  }

  const evidence = Array.isArray(mapEntry.evidence) ? mapEntry.evidence : [];
  const marker = evidence.find((value: any) => typeof value === 'string' && value.startsWith('generator-provenance:'));
  if (marker) {
    return marker.slice('generator-provenance:'.length);
  }

  return inferProvenanceFromSpec(mapSpec);
}

function inferProvenanceFromSpec(mapSpec: any) {
  if (mapSpec?.qualityTargets?.migrationBackfilled === true) {
    return 'backfilled';
  }
  return 'generated';
}

function parseJsonFile(absolutePath: any, relativePath: any) {
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
