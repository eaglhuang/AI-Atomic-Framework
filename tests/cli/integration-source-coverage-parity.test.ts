import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createStaticIntegrationAdapter } from '../../packages/integrations-core/src/index.ts';
import { verifyInstalledManifest } from '../../packages/cli/src/commands/integration/health.ts';

const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-integration-source-coverage-'));
try {
  const sourceFiles = [
    {
      relativePath: 'one.md',
      content: 'one\n',
      source: 'template' as const,
      fileFormat: 'markdown' as const
    }
  ];
  const adapter = {
    ...createStaticIntegrationAdapter({
      id: 'coverage-fixture',
      displayName: 'Coverage fixture',
      adapterVersion: '1.0.0',
      targetDir: '.atm/fixture',
      fileFormat: 'markdown',
      placeholderStyle: 'none',
      sourceFiles
    }),
    sourceCoverage: () => ({
      sourceFileCount: 2,
      sourceCatalogDigest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    })
  } as any;

  const installed = adapter.install({
    repositoryRoot,
    dryRun: false,
    manifestPath: '.atm/integrations/coverage-fixture.manifest.json'
  });
  const report = await verifyInstalledManifest(
    repositoryRoot,
    '.atm/integrations/coverage-fixture.manifest.json',
    adapter,
    installed.manifest
  );

  assert.equal(report.ok, false, 'verify must fail when source corpus count exceeds projected files');
  assert.equal(report.status, 'stale');
  assert.equal(report.findings.some((finding: any) => finding.code === 'source-coverage-mismatch'), true);

  const projectedWithReference = {
    ...createStaticIntegrationAdapter({
      id: 'coverage-reference-fixture',
      displayName: 'Coverage reference fixture',
      adapterVersion: '1.0.0',
      targetDir: '.atm/reference-fixture',
      fileFormat: 'markdown',
      placeholderStyle: 'none',
      sourceFiles: [
        { relativePath: 'one.md', content: 'one\n', source: 'template' as const, fileFormat: 'markdown' as const },
        { relativePath: 'references/detail.md', content: 'detail\n', source: 'template' as const, fileFormat: 'markdown' as const }
      ]
    }),
    sourceCoverage: () => ({ sourceFileCount: 2 })
  } as any;
  const projectedInstall = projectedWithReference.install({
    repositoryRoot,
    dryRun: false,
    manifestPath: '.atm/integrations/coverage-reference-fixture.manifest.json'
  });
  const projectedReport = await verifyInstalledManifest(
    repositoryRoot,
    '.atm/integrations/coverage-reference-fixture.manifest.json',
    projectedWithReference,
    projectedInstall.manifest
  );
  assert.equal(projectedReport.ok, true, 'references must not count as source-coverage drift');
  console.log('[integration-source-coverage-parity] ok');
} finally {
  rmSync(repositoryRoot, { recursive: true, force: true });
}
