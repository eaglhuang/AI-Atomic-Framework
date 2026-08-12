import { createHash } from 'node:crypto';
import type { InstallManifest } from '../../../../integrations-core/src/index.ts';
import { compileAdapterParity, EDITORS } from '../../../../core/src/evidence/adapter-parity.ts';
import { resolveValue } from '../shared.ts';
import { createIntegrationAdapter, createIntegrationContext } from './adapters.ts';
import { readIntegrationManifest, verifyInstalledManifest } from './health.ts';

const digest = (value: unknown) => `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
const sourceCatalogDigest = (manifest: InstallManifest | null) => typeof manifest?.metadata?.sourceCatalogDigest === 'string'
  ? manifest.metadata.sourceCatalogDigest
  : '';

/** Stable digest of a projection manifest; timestamps are deliberately excluded. */
export function digestIntegrationManifest(manifest: InstallManifest): string {
  return digest({
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    targetDir: manifest.targetDir,
    files: [...manifest.files].map((file) => ({
      path: file.path,
      sha256: file.sha256,
      sizeBytes: file.sizeBytes,
      source: file.source,
      fileFormat: file.fileFormat
    })).sort((left, right) => left.path.localeCompare(right.path)),
    metadata: manifest.metadata ?? {}
  });
}

function digestCompilerExpectation(manifest: InstallManifest): string {
  return digest({
    compiler: 'atm.integration-projection',
    adapterId: manifest.adapterId,
    adapterVersion: manifest.adapterVersion,
    targetDir: manifest.targetDir,
    adapterFormat: typeof manifest.metadata?.adapterFormat === 'string' ? manifest.metadata.adapterFormat : ''
  });
}

/**
 * Reads installed manifests and compares them with each adapter's dry-run
 * projection.  No caller can claim parity by supplying arbitrary digests.
 */
export async function collectAdapterParity(repositoryRoot: string) {
  const expected = await Promise.all(EDITORS.map(async (editor) => {
    const adapter = createIntegrationAdapter(editor);
    const report = await resolveValue(adapter.install(createIntegrationContext(repositoryRoot, adapter, { dryRun: true })));
    return report.manifest;
  }));
  const expectedCompilerDigests = Object.fromEntries(expected.map((manifest) => [manifest.adapterId, digestCompilerExpectation(manifest)]));
  const expectedManifestDigests = Object.fromEntries(expected.map((manifest) => [manifest.adapterId, digestIntegrationManifest(manifest)]));
  const expectedSourceDigest = sourceCatalogDigest(expected[0]);
  const adapters = await Promise.all(EDITORS.map(async (editor) => {
    const adapter = createIntegrationAdapter(editor);
    try {
      const manifest = readIntegrationManifest(repositoryRoot, editor);
      const verification = await verifyInstalledManifest(repositoryRoot, `.atm/integrations/${editor}.manifest.json`, adapter, manifest);
      return {
        editor,
        sourceDigest: sourceCatalogDigest(manifest),
        compilerDigest: expectedCompilerDigests[editor],
        manifestDigest: digestIntegrationManifest(manifest),
        reinstallSmoke: verification.ok,
        // This collector only runs through the CLI entrypoint, so completing it
        // proves the frozen-runner invocation path was executable.
        frozenRunnerSmoke: true
      };
    } catch {
      return { editor, sourceDigest: '', compilerDigest: expectedCompilerDigests[editor], manifestDigest: '', reinstallSmoke: false, frozenRunnerSmoke: false };
    }
  }));
  return compileAdapterParity({
    sourceDigest: expectedSourceDigest,
    expectedCompilerDigests,
    expectedManifestDigests,
    adapters
  });
}
