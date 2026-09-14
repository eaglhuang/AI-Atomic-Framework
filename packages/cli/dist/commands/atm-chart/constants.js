import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolveFrameworkRoot } from '../shared.js';
export const frameworkRoot = resolveFrameworkRoot();
export const defaultATMChartRelativePath = path.join('.atm', 'memory', 'atm-chart.md');
export const atmChartFrontmatterSchemaVersion = 'atm.atmChart.v0.1';
export const atmChartSourceSchemas = Object.freeze({
    'governance/default-guards': 'schemas/governance/default-guards.schema.json',
    'charter/charter-invariants': 'schemas/charter/charter-invariants.schema.json',
    'integrations/install-manifest': 'schemas/integrations/install-manifest.schema.json',
    'agent-prompt': 'schemas/agent-prompt.schema.json',
    'upgrade/upgrade-proposal': 'schemas/upgrade/upgrade-proposal.schema.json'
});
// These schemas are only used by the public chart lifecycle as immutable
// source fingerprints. Keeping their logical path and digest in the bundled
// runtime removes three data files without weakening drift detection.
export const embeddedATMChartSchemaAssets = Object.freeze({
    'schemas/agent-prompt.schema.json': {
        sha256: 'sha256:1ff8806e3c104f17a0d7d8bbf6b436fffa0200357c8434896665fc208bfb7028'
    },
    'schemas/charter/charter-invariants.schema.json': {
        sha256: 'sha256:8a13fd5393cf16312494cc75e0990836eb5a2102046449983f574015e6304a15'
    },
    'schemas/governance/default-guards.schema.json': {
        sha256: 'sha256:8d3a6d2b99a51890653ab36669cb725dc4cec7c914abd4145794861a7841d888'
    },
    'schemas/integrations/install-manifest.schema.json': {
        sha256: 'sha256:85cf9bd1441f598bbd53dc0b322daaf5ae0ef862b14aaa70b22b8a943b584ff4'
    },
    'schemas/upgrade/upgrade-proposal.schema.json': {
        sha256: 'sha256:971755cd4e3262c488a2ba7c98e6ddb2640a90686b960de8e167a0854953ed87'
    }
});
export function resolveATMChartSchemaSource(relativeSchemaPath) {
    const absolutePath = resolveATMChartSchemaPath(relativeSchemaPath);
    if (existsSync(absolutePath)) {
        return { kind: 'filesystem', path: absolutePath };
    }
    const embedded = embeddedATMChartSchemaAssets[relativeSchemaPath];
    return embedded ? { kind: 'bundled', path: relativeSchemaPath, sha256: embedded.sha256 } : null;
}
export function resolveATMChartSchemaPath(relativeSchemaPath) {
    const candidates = [
        path.join(frameworkRoot, relativeSchemaPath),
        path.join(frameworkRoot, 'dist', 'npm-runtime', 'layout', relativeSchemaPath),
        path.join(frameworkRoot, 'layout', relativeSchemaPath)
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}
export const fallbackCompatibilityMatrix = Object.freeze({
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
export const fallbackLegacyCompatibilityMatrix = Object.freeze({
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
