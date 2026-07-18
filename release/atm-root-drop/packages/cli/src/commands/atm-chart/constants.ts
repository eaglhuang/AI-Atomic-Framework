import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompatibilityMatrixDocument, LegacyCompatibilityMatrixDocument } from './types.ts';

export const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
export const defaultATMChartRelativePath = path.join('.atm', 'memory', 'atm-chart.md');
export const atmChartFrontmatterSchemaVersion = 'atm.atmChart.v0.1' as const;
export const atmChartSourceSchemas = Object.freeze({
  'governance/default-guards': 'schemas/governance/default-guards.schema.json',
  'charter/charter-invariants': 'schemas/charter/charter-invariants.schema.json',
  'integrations/install-manifest': 'schemas/integrations/install-manifest.schema.json',
  'agent-prompt': 'schemas/agent-prompt.schema.json',
  'upgrade/upgrade-proposal': 'schemas/upgrade/upgrade-proposal.schema.json'
});

export const fallbackCompatibilityMatrix = Object.freeze<CompatibilityMatrixDocument>({
  schemaVersion: 'atm.compatibilityMatrix.v0.1',
  lastUpdated: '2026-05-18',
  releaseTrain: {
    frameworkVersion: '0.0.0',
    defaultChartVersion: '0.1.0',
    defaultTemplateVersion: '0.1.0',
    minimumSupportedChartVersion: '0.1.0',
    minimumSupportedTemplateVersion: '0.1.0'
  },
  atmChartVersions: [
    {
      version: '0.1.0',
      status: 'supported',
      sourceSchemaVersion: 'atm.defaultGuards.v0.1',
      minFrameworkVersion: '0.0.0',
      maxFrameworkVersion: null,
      migrationGuide: null
    }
  ],
  agentTemplateVersions: [
    {
      version: '0.1.0',
      status: 'supported',
      minFrameworkVersion: '0.0.0',
      maxFrameworkVersion: null,
      migrationGuide: null
    }
  ]
});

export const fallbackLegacyCompatibilityMatrix = Object.freeze<LegacyCompatibilityMatrixDocument>({
  schemaVersion: 'atm.compatibilityMatrixLegacy.v0.1',
  lastUpdated: '2026-05-18',
  atmChartVersions: [
    {
      version: '0.0.1',
      status: 'unsupported',
      sourceSchemaVersion: 'atm.defaultGuards.v0.1',
      minFrameworkVersion: '0.0.0',
      maxFrameworkVersion: null,
      removedFromActiveSupportAt: '2026-05-18',
      migrationGuide: 'Run `node atm.mjs upgrade plan --allow-unknown-chart --json` only after reviewing the dry-run file list, then apply with an explicit backup/rollback path.',
      reason: 'Pre-M9 chart baseline retained for offline self-diagnosis only.'
    }
  ],
  agentTemplateVersions: []
});

export const versionCacheRelativePath = path.join('.atm', 'runtime', 'version-cache.json');
