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
  console.log('[integration-source-coverage-parity] ok');
} finally {
  rmSync(repositoryRoot, { recursive: true, force: true });
}
