import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { InstallManifest, IntegrationAdapter } from '../../../../integrations-core/src/index.ts';
import { TEAM_DIRECT_API_PROVIDER_IDS } from '../../../../core/src/team-runtime/provider-contract.ts';
import { readJsonFile, CliError, resolveValue } from '../shared.ts';
import { createIntegrationAdapter, createIntegrationContext, isKnownIntegrationAdapter, manifestPathForIntegration } from './adapters.ts';
import type { InstallManifestWithTeamRuntimeCapabilities } from './types.ts';

export async function checkIntegrationHealth(repositoryRoot: string) {
  const manifestDirectory = path.join(repositoryRoot, '.atm', 'integrations');
  if (!existsSync(manifestDirectory)) {
    return {
      ok: true,
      manifestDir: '.atm/integrations',
      installed: [],
      manifests: [],
      failed: [],
      teamRuntimeBackends: inspectTeamRuntimeBackendCapabilities(repositoryRoot)
    };
  }

  const manifestReports = await Promise.all(readdirSync(manifestDirectory)
    .filter((entryName) => entryName.endsWith('.manifest.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((entryName) => verifyManifestFile(repositoryRoot, entryName)));

  const teamRuntimeBackends = inspectTeamRuntimeBackendCapabilities(repositoryRoot);
  return {
    ok: manifestReports.every((report) => report.ok),
    manifestDir: '.atm/integrations',
    installed: manifestReports.filter((report) => report.adapterId).map((report) => report.adapterId as string),
    manifests: manifestReports,
    failed: manifestReports.filter((report) => !report.ok),
    teamRuntimeBackends
  };
}

export function inspectTeamRuntimeBackendCapabilities(repositoryRoot: string) {
  const manifestDirectory = path.join(repositoryRoot, '.atm', 'integrations');
  const manifestCapabilities = existsSync(manifestDirectory) ? readdirSync(manifestDirectory)
    .filter((entryName) => entryName.endsWith('.manifest.json'))
    .sort((left, right) => left.localeCompare(right))
    .flatMap((entryName) => {
      const manifestPath = `.atm/integrations/${entryName}`;
      try {
        const manifest = JSON.parse(readFileSync(path.join(repositoryRoot, manifestPath), 'utf8')) as InstallManifestWithTeamRuntimeCapabilities;
        return normalizeTeamRuntimeCapabilities(manifest, manifestPath);
      } catch {
        return [];
      }
    }) : [];
  const builtInCapabilities = TEAM_DIRECT_API_PROVIDER_IDS.map((providerId) => ({
    manifestPath: 'builtin:team-provider-contract',
    adapterId: 'atm.builtin.direct-api',
    providerId,
    runtimeModes: ['real-agent'],
    executionSurfaces: ['agent-runtime'],
    roles: ['*'],
    status: 'supported' as const,
    evidence: `Canonical built-in direct API provider contract: ${providerId}`
  }));
  const capabilities = [...builtInCapabilities, ...manifestCapabilities];
  return {
    schemaId: 'atm.integrationTeamRuntimeBackendReadiness.v1',
    ok: true,
    manifestDir: '.atm/integrations',
    declaredBackendCount: capabilities.length,
    capabilities,
    missingBackendSummary: capabilities.length === 0
      ? 'No built-in direct provider or installed integration manifest declares Team runtime backend capability.'
      : null,
    startReadiness: capabilities.some((capability) => capability.status !== 'unavailable')
      ? 'runtime-backend-declared' as const
      : 'broker-only-only' as const
  };
}

export function normalizeTeamRuntimeCapabilities(
  manifest: InstallManifestWithTeamRuntimeCapabilities,
  manifestPath: string
) {
  const rawCapabilities = Array.isArray(manifest.teamRuntimeCapabilities)
    ? manifest.teamRuntimeCapabilities
    : [];
  return rawCapabilities
    .map((capability) => ({
      manifestPath,
      adapterId: manifest.adapterId ?? null,
      providerId: typeof capability.providerId === 'string' ? capability.providerId : '',
      runtimeModes: Array.isArray(capability.runtimeModes)
        ? capability.runtimeModes.filter((mode: unknown): mode is string => typeof mode === 'string' && mode.length > 0)
        : [],
      executionSurfaces: Array.isArray(capability.executionSurfaces)
        ? capability.executionSurfaces.filter((surface: unknown): surface is string => typeof surface === 'string' && surface.length > 0)
        : [],
      roles: Array.isArray(capability.roles)
        ? capability.roles.filter((role: unknown): role is string => typeof role === 'string' && role.length > 0)
        : [],
      status: capability.status,
      evidence: typeof capability.evidence === 'string' ? capability.evidence : ''
    }))
    .filter((capability) => capability.providerId.length > 0
      && capability.runtimeModes.length > 0
      && capability.executionSurfaces.length > 0
      && capability.roles.length > 0
      && ['supported', 'experimental', 'unavailable'].includes(capability.status)
      && capability.evidence.length > 0);
}

export async function verifyManifestFile(repositoryRoot: string, entryName: string) {
  const manifestPath = `.atm/integrations/${entryName}`;
  let manifest: InstallManifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(repositoryRoot, manifestPath), 'utf8')) as InstallManifest;
  } catch (error) {
    return createManifestHealthReport({
      ok: false,
      status: 'stale',
      manifestPath,
      adapterId: null,
      findings: [{ level: 'error', code: 'manifest-unreadable', path: manifestPath, message: error instanceof Error ? error.message : String(error) }],
      driftedFiles: []
    });
  }

  if (!isKnownIntegrationAdapter(manifest.adapterId)) {
    return createManifestHealthReport({
      ok: false,
      status: 'stale',
      manifestPath,
      adapterId: manifest.adapterId ?? null,
      findings: [{ level: 'error', code: 'adapter-unknown', path: manifestPath, message: `Unknown integration adapter in manifest: ${manifest.adapterId}` }],
      driftedFiles: []
    });
  }

  const expectedManifestPath = manifestPathForIntegration(manifest.adapterId);
  if (manifestPath !== expectedManifestPath) {
    return createManifestHealthReport({
      ok: false,
      status: 'stale',
      manifestPath,
      adapterId: manifest.adapterId,
      findings: [{ level: 'error', code: 'manifest-path-mismatch', path: manifestPath, message: `Manifest path should be ${expectedManifestPath}.` }],
      driftedFiles: []
    });
  }

  const adapter = createIntegrationAdapter(manifest.adapterId);
  return verifyInstalledManifest(repositoryRoot, manifestPath, adapter, manifest);
}

export async function verifyInstalledManifest(
  repositoryRoot: string,
  manifestPath: string,
  adapter: IntegrationAdapter,
  preloadedManifest?: InstallManifest
) {
  const manifest = preloadedManifest ?? readIntegrationManifest(repositoryRoot, adapter.id);
  const verifyReport = await resolveValue(adapter.verify(createIntegrationContext(repositoryRoot, adapter, {}), manifest));
  if (!verifyReport.ok) {
    return createManifestHealthReport({
      ok: false,
      status: 'drift',
      manifestPath,
      adapterId: adapter.id,
      findings: verifyReport.findings,
      driftedFiles: verifyReport.driftedFiles,
      staleFields: []
    });
  }
  const dryRunInstall = await resolveValue(adapter.install(createIntegrationContext(repositoryRoot, adapter, { dryRun: true })));
  const parity = compareManifestParity(manifest, dryRunInstall.manifest);
  if (!parity.ok) {
    return createManifestHealthReport({
      ok: false,
      status: 'stale',
      manifestPath,
      adapterId: adapter.id,
      findings: [
        ...verifyReport.findings,
        {
          level: 'error',
          code: 'source-parity-mismatch',
          path: manifestPath,
          message: 'Installed manifest is self-consistent but does not match the current integration source snapshot.'
        }
      ],
      driftedFiles: parity.changedFiles,
      staleFields: parity.changedFields
    });
  }
  return createManifestHealthReport({
    ok: true,
    status: 'ok',
    manifestPath,
    adapterId: adapter.id,
    findings: verifyReport.findings,
    driftedFiles: [],
    staleFields: [],
    teamRuntimeCapabilities: normalizeTeamRuntimeCapabilities(
      manifest as InstallManifestWithTeamRuntimeCapabilities,
      manifestPath
    )
  });
}

export function compareManifestParity(installed: InstallManifest, expected: InstallManifest) {
  const changedFiles = new Set<string>();
  const changedFields: string[] = [];
  if (installed.adapterVersion !== expected.adapterVersion) {
    changedFields.push('adapterVersion');
  }
  if (installed.targetDir !== expected.targetDir) {
    changedFields.push('targetDir');
  }
  const installedMetadata = JSON.stringify(installed.metadata ?? {});
  const expectedMetadata = JSON.stringify(expected.metadata ?? {});
  if (installedMetadata !== expectedMetadata) {
    changedFields.push('metadata');
  }
  const installedTeamRuntimeCapabilities = JSON.stringify((installed as InstallManifestWithTeamRuntimeCapabilities).teamRuntimeCapabilities ?? []);
  const expectedTeamRuntimeCapabilities = JSON.stringify((expected as InstallManifestWithTeamRuntimeCapabilities).teamRuntimeCapabilities ?? []);
  if (installedTeamRuntimeCapabilities !== expectedTeamRuntimeCapabilities) {
    changedFields.push('teamRuntimeCapabilities');
  }
  const installedFiles = new Map(installed.files.map((entry) => [entry.path, entry]));
  const expectedFiles = new Map(expected.files.map((entry) => [entry.path, entry]));
  for (const filePath of new Set([...installedFiles.keys(), ...expectedFiles.keys()])) {
    const installedFile = installedFiles.get(filePath) ?? null;
    const expectedFile = expectedFiles.get(filePath) ?? null;
    if (!installedFile || !expectedFile) {
      changedFiles.add(filePath);
      continue;
    }
    if (
      installedFile.sha256 !== expectedFile.sha256
      || installedFile.sizeBytes !== expectedFile.sizeBytes
      || installedFile.source !== expectedFile.source
      || installedFile.fileFormat !== expectedFile.fileFormat
    ) {
      changedFiles.add(filePath);
    }
  }
  return {
    ok: changedFields.length === 0 && changedFiles.size === 0,
    changedFields,
    changedFiles: [...changedFiles].sort((left, right) => left.localeCompare(right))
  };
}

interface ManifestHealthReportInput {
  ok: boolean;
  status: string;
  manifestPath: string;
  adapterId: string | null;
  findings: readonly unknown[];
  driftedFiles: readonly string[];
  staleFields?: readonly string[];
  teamRuntimeCapabilities?: readonly unknown[];
}

function createManifestHealthReport(input: ManifestHealthReportInput) {
  return {
    ok: input.ok === true,
    status: input.status,
    manifestPath: input.manifestPath,
    adapterId: input.adapterId,
    findings: input.findings,
    driftedFiles: input.driftedFiles,
    staleFields: Array.isArray(input.staleFields) ? input.staleFields : [],
    teamRuntimeCapabilities: Array.isArray(input.teamRuntimeCapabilities) ? input.teamRuntimeCapabilities : []
  };
}

export function readIntegrationManifest(repositoryRoot: string, adapterId: string): InstallManifest {
  const adapter = createIntegrationAdapter(adapterId);
  const manifestPath = manifestPathForIntegration(adapter.id);
  const manifest = readJsonFile(path.join(repositoryRoot, manifestPath), 'ATM_INTEGRATION_MANIFEST_MISSING') as InstallManifest;
  if (manifest.adapterId !== adapter.id) {
    throw new CliError('ATM_INTEGRATION_MANIFEST_ADAPTER_MISMATCH', `Integration manifest adapterId does not match ${adapter.id}.`, {
      details: {
        expectedAdapterId: adapter.id,
        actualAdapterId: manifest.adapterId,
        manifestPath
      }
    });
  }
  return manifest;
}
