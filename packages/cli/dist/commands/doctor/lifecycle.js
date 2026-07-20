import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { computeSha256ForFile } from '../../../../core/dist/hash-lock/hash-lock.js';
import { message, relativePathFrom } from '../shared.js';
import { readJsonIfExists } from './utilities.js';
export function checkOnboardingLifecycle(root, runtime) {
    const configPresent = existsSync(path.join(root, '.atm', 'config.json'));
    const atmChartPath = path.join(root, '.atm', 'memory', 'atm-chart.md');
    const welcomeLineagePath = path.join(root, '.atm', 'runtime', 'welcome.lineage.json');
    if (!configPresent) {
        return {
            ok: true,
            stage: 'uninstalled',
            atmChartPath: relativePathFrom(root, atmChartPath),
            welcomeLineagePath: relativePathFrom(root, welcomeLineagePath),
            atmChartFreshness: 'not-applicable',
            welcomeRecorded: false,
            recommendedAction: 'node atm.mjs bootstrap --cwd . --task "Bootstrap ATM in this repository"'
        };
    }
    const defaultGuardsPath = path.join(root, runtime.paths.defaultGuardsPath);
    const defaultGuardsPresent = existsSync(defaultGuardsPath);
    const atmChartPresent = existsSync(atmChartPath);
    const welcomeLineage = readJsonIfExists(welcomeLineagePath);
    if (!defaultGuardsPresent) {
        return {
            ok: false,
            stage: 'installed',
            defaultGuardsPath: runtime.paths.defaultGuardsPath,
            atmChartPath: relativePathFrom(root, atmChartPath),
            welcomeLineagePath: relativePathFrom(root, welcomeLineagePath),
            atmChartFreshness: 'guards-missing',
            welcomeRecorded: Boolean(welcomeLineage),
            recommendedAction: 'node atm.mjs bootstrap --cwd . --force --task "Bootstrap ATM in this repository"'
        };
    }
    if (!atmChartPresent) {
        return {
            ok: false,
            stage: 'installed',
            defaultGuardsPath: runtime.paths.defaultGuardsPath,
            atmChartPath: relativePathFrom(root, atmChartPath),
            welcomeLineagePath: relativePathFrom(root, welcomeLineagePath),
            atmChartFreshness: 'missing',
            welcomeRecorded: Boolean(welcomeLineage),
            recommendedAction: 'node atm.mjs atm-chart render --cwd .'
        };
    }
    const atmChartFrontmatter = readATMChartFrontmatter(atmChartPath);
    const currentGuardsHash = computeSha256ForFile(defaultGuardsPath);
    const atmChartFresh = atmChartFrontmatter?.source_guards_sha256 === currentGuardsHash;
    const welcomeRecorded = Boolean(welcomeLineage && typeof welcomeLineage.firstWelcomedAt === 'string');
    return {
        ok: atmChartFresh,
        stage: welcomeRecorded ? 'welcomed' : 'atm-chart-rendered',
        defaultGuardsPath: runtime.paths.defaultGuardsPath,
        atmChartPath: relativePathFrom(root, atmChartPath),
        welcomeLineagePath: relativePathFrom(root, welcomeLineagePath),
        atmChartFreshness: atmChartFresh ? 'fresh' : 'stale',
        recordedSourceGuardsSha256: atmChartFrontmatter?.source_guards_sha256 ?? null,
        currentSourceGuardsSha256: currentGuardsHash,
        welcomeRecorded,
        welcomeCount: Number(welcomeLineage?.welcomeCount ?? 0),
        recommendedAction: atmChartFresh ? 'node atm.mjs welcome --cwd .' : 'node atm.mjs atm-chart render --cwd .'
    };
}
export function createVersionSummaryMessages(versionSummary) {
    const messages = [];
    for (const warning of versionSummary.compatibilityMatrix?.warnings ?? []) {
        messages.push(message('warning', warning.code, warning.text, {
            lastUpdated: warning.lastUpdated ?? undefined,
            matrixSource: versionSummary.compatibilityMatrix?.source ?? undefined
        }));
    }
    if (versionSummary.downgrade?.detected === true) {
        messages.push(message('warning', 'ATM_FRAMEWORK_DOWNGRADE_DETECTED', versionSummary.downgrade.reason ?? '', {
            currentFrameworkVersion: versionSummary.downgrade.currentFrameworkVersion,
            lastSeenFrameworkVersion: versionSummary.downgrade.lastSeenFrameworkVersion,
            readOnlyDiagnostic: true,
            cachePath: versionSummary.downgrade.cachePath
        }));
    }
    return messages;
}
export function readATMChartFrontmatter(filePath) {
    try {
        const content = readFileSync(filePath, 'utf8');
        const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
        if (!match) {
            return null;
        }
        return Object.fromEntries(match[1]
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
            const separatorIndex = line.indexOf(':');
            const key = line.slice(0, separatorIndex).trim();
            const value = line.slice(separatorIndex + 1).trim();
            return [key, value.startsWith('{') ? JSON.parse(value) : value];
        }));
    }
    catch {
        return null;
    }
}
