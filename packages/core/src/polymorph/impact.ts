import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeMapId } from '../upgrade/map-propose.ts';
import { propagateTemplateUpgrade } from './template.ts';

export function analyzePolymorphImpact(options: any) {
  const repositoryRoot = path.resolve(options?.repositoryRoot ?? process.cwd());
  const targetMapId = normalizeMapId(options?.mapId ?? options?.targetMapId);
  const toVersion = normalizeSemver(options?.toVersion ?? options?.nextVersion ?? '');
  const targetMap = readTargetMap(repositoryRoot, targetMapId);
  const registry = readRegistry(repositoryRoot);
  const specCache = new Map<string, any>();
  const templateHits = collectTemplateHits(repositoryRoot, registry.entries, targetMap.members, specCache);
  const impactedMaps = collectImpactedMaps(repositoryRoot, registry.entries, targetMapId, templateHits, specCache);
  const impactedMapIds = impactedMaps.map((entry) => entry.mapId);
  const propagation = [...new Set(templateHits.map((entry) => entry.templateId))]
    .sort()
    .map((templateId) => {
      const instances = impactedMaps.flatMap((impact) => impact.matchedMembers
        .filter((member: any) => member.templateId === templateId)
        .map((member: any) => ({
          mapId: impact.mapId,
          atomId: member.atomId,
          templateId: member.templateId,
          polymorphGroupId: member.polymorphGroupId,
          variantKey: `${impact.mapId}.${member.atomId}`
        })));
      return propagateTemplateUpgrade({
        templateId,
        toVersion,
        instances
      });
    });

  return {
    targetMapId,
    toVersion,
    templateHits,
    impactedMapIds,
    impactedMaps,
    propagation,
    reportRequired: templateHits.length > 0
  };
}

export function createPolymorphImpactReport(options: any) {
  const analysis = analyzePolymorphImpact(options);
  const generatedAt = String(options?.generatedAt ?? new Date().toISOString()).trim();
  const artifactPath = `atomic_workbench/maps/${analysis.targetMapId}/polymorph-impact-report.json`;
  const summary = analysis.reportRequired
    ? `Polymorph impact scan found ${analysis.impactedMapIds.length} impacted instance map(s).`
    : 'Polymorph impact scan found no template-bound members.';

  return {
    schemaId: 'atm.polymorphImpactReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial polymorph impact report contract.'
    },
    reportId: options?.reportId ?? `polymorph-impact.${analysis.targetMapId.toLowerCase()}.to-${analysis.toVersion.replace(/\./g, '-')}`,
    generatedAt,
    targetMapId: analysis.targetMapId,
    ...(options?.requestedReplacementMode ? { requestedReplacementMode: String(options.requestedReplacementMode).trim() } : {}),
    ...(options?.atomId ? { atomId: String(options.atomId).trim() } : {}),
    toVersion: analysis.toVersion,
    templateHits: analysis.templateHits,
    impactedMapIds: analysis.impactedMapIds,
    impactedMaps: analysis.impactedMaps,
    propagation: analysis.propagation,
    artifacts: [
      {
        artifactPath,
        artifactKind: 'report',
        producedBy: 'polymorph-impact-runner'
      }
    ],
    evidence: [
      {
        evidenceKind: 'validation',
        signalScope: 'atom-map',
        atomMapId: analysis.targetMapId,
        ...(options?.atomId ? { atomId: String(options.atomId).trim() } : {}),
        summary,
        artifactPaths: [artifactPath]
      }
    ],
    passed: true
  };
}

function readTargetMap(repositoryRoot: string, mapId: string) {
  const relativePath = `atomic_workbench/maps/${mapId}/map.spec.json`;
  const absolutePath = path.join(repositoryRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`polymorph-impact could not find target map spec at ${relativePath}.`);
  }
  const document = readJsonFile(absolutePath, relativePath);
  if (document?.mapId !== mapId) {
    throw new Error(`polymorph-impact mapId mismatch: expected ${mapId} but received ${String(document?.mapId ?? '')}.`);
  }
  return {
    mapId,
    members: Array.isArray(document?.members) ? document.members : []
  };
}

function readRegistry(repositoryRoot: string) {
  const relativePath = 'atomic-registry.json';
  const absolutePath = path.join(repositoryRoot, relativePath);
  if (!existsSync(absolutePath)) {
    return { entries: [] };
  }
  const document = readJsonFile(absolutePath, relativePath);
  return {
    entries: Array.isArray(document?.entries) ? document.entries : []
  };
}

function collectTemplateHits(repositoryRoot: string, registryEntries: any[], members: any[], specCache: Map<string, any>) {
  return normalizeMembers(members)
    .map((member) => {
      const metadata = resolveAtomPolymorphMetadata(repositoryRoot, registryEntries, member.atomId, specCache);
      if (!metadata) {
        return null;
      }
      return {
        atomId: member.atomId,
        version: member.version,
        templateId: metadata.templateId,
        polymorphGroupId: metadata.polymorphGroupId
      };
    })
    .filter(Boolean)
    .sort((left: any, right: any) => left.atomId.localeCompare(right.atomId));
}

function collectImpactedMaps(repositoryRoot: string, registryEntries: any[], targetMapId: string, templateHits: any[], specCache: Map<string, any>) {
  const targetTemplateIds = new Set(templateHits.map((entry) => entry.templateId));
  if (targetTemplateIds.size === 0) {
    return [];
  }

  return registryEntries
    .filter((entry) => entry?.schemaId === 'atm.atomicMap' && typeof entry?.mapId === 'string' && entry.mapId !== targetMapId)
    .map((entry) => {
      const matchedMembers = normalizeMembers(entry.members)
        .map((member) => {
          const metadata = resolveAtomPolymorphMetadata(repositoryRoot, registryEntries, member.atomId, specCache);
          if (!metadata || !targetTemplateIds.has(metadata.templateId)) {
            return null;
          }
          return {
            atomId: member.atomId,
            version: member.version,
            templateId: metadata.templateId,
            polymorphGroupId: metadata.polymorphGroupId
          };
        })
        .filter(Boolean);
      if (matchedMembers.length === 0) {
        return null;
      }
      return {
        mapId: String(entry.mapId).trim(),
        templateIds: [...new Set(matchedMembers.map((member: any) => member.templateId))].sort(),
        matchedMembers
      };
    })
    .filter(Boolean)
    .sort((left: any, right: any) => left.mapId.localeCompare(right.mapId));
}

function resolveAtomPolymorphMetadata(repositoryRoot: string, registryEntries: any[], atomId: string, specCache: Map<string, any>) {
  if (specCache.has(atomId)) {
    return specCache.get(atomId);
  }

  const entry = registryEntries.find((candidate) => candidate?.atomId === atomId);
  const specPath = String(entry?.location?.specPath ?? entry?.specPath ?? '').trim();
  if (!specPath) {
    specCache.set(atomId, null);
    return null;
  }

  const absolutePath = path.resolve(repositoryRoot, specPath);
  if (!existsSync(absolutePath)) {
    specCache.set(atomId, null);
    return null;
  }

  const document = readJsonFile(absolutePath, specPath);
  const templateId = normalizePolyId(document?.polymorphicTemplateRef ?? document?.polymorphGroupId);
  const polymorphGroupId = normalizePolyId(document?.polymorphGroupId ?? document?.polymorphicTemplateRef);
  const metadata = templateId && polymorphGroupId
    ? { templateId, polymorphGroupId }
    : null;
  specCache.set(atomId, metadata);
  return metadata;
}

function normalizeMembers(members: any[]) {
  return (Array.isArray(members) ? members : [])
    .map((member) => ({
      atomId: String(member?.atomId ?? '').trim(),
      version: String(member?.version ?? '').trim()
    }))
    .filter((member) => member.atomId.length > 0 && /^\d+\.\d+\.\d+$/.test(member.version));
}

function normalizePolyId(value: any) {
  const normalized = String(value ?? '').trim();
  return /^ATM-POLY-\d{4}$/.test(normalized) ? normalized : null;
}

function normalizeSemver(value: any) {
  const normalized = String(value ?? '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(normalized)) {
    throw new Error(`polymorph-impact requires a semver toVersion; received ${normalized || '[empty]'}.`);
  }
  return normalized;
}

function readJsonFile(absolutePath: string, relativePath: string) {
  try {
    return JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to parse ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}