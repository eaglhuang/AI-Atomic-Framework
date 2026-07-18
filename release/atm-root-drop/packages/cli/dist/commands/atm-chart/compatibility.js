import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { relativePathFrom } from '../governance-runtime.js';
import { CliError, readFrameworkVersion } from '../shared.js';
import { defaultATMChartRelativePath, fallbackCompatibilityMatrix, fallbackLegacyCompatibilityMatrix, frameworkRoot, versionCacheRelativePath } from './constants.js';
import { loadATMChartSummary } from './render-verify.js';
import { asOptionalVersion, compareSemver, higherVersion, highestVersion, isSemver } from './semver.js';
export function loadCompatibilityMatrix(root = frameworkRoot) {
    return loadCompatibilityMatrixBundle(root).matrix;
}
export function loadCompatibilityMatrixBundle(root = frameworkRoot) {
    const overridePath = process.env.ATM_COMPATIBILITY_MATRIX_PATH;
    const matrixPath = overridePath
        ? path.resolve(overridePath)
        : path.join(root, 'compatibility-matrix.json');
    if (!existsSync(matrixPath)) {
        const matrix = mergeCompatibilityMatrices(fallbackCompatibilityMatrix, fallbackLegacyCompatibilityMatrix);
        const lastUpdated = matrix.lastUpdated ?? fallbackLegacyCompatibilityMatrix.lastUpdated ?? null;
        return {
            matrix,
            source: 'bundled-snapshot',
            matrixPath: null,
            legacyMatrixPath: null,
            lastUpdated,
            legacyEntriesLoaded: fallbackLegacyCompatibilityMatrix.atmChartVersions.length + fallbackLegacyCompatibilityMatrix.agentTemplateVersions.length,
            warnings: [{
                    code: 'ATM_COMPATIBILITY_BUNDLED_SNAPSHOT',
                    text: `Using bundled compatibility matrix snapshot, last updated ${lastUpdated ?? 'unknown'}.`,
                    lastUpdated
                }]
        };
    }
    const parsed = JSON.parse(readFileSync(matrixPath, 'utf8'));
    const activeMatrix = normalizeCompatibilityMatrix(parsed);
    const legacyMatrix = loadLegacyCompatibilityMatrix(root);
    const matrix = mergeCompatibilityMatrices(activeMatrix, legacyMatrix.document);
    return {
        matrix,
        source: 'filesystem',
        matrixPath,
        legacyMatrixPath: legacyMatrix.path,
        lastUpdated: activeMatrix.lastUpdated ?? legacyMatrix.document?.lastUpdated ?? null,
        legacyEntriesLoaded: legacyMatrix.entryCount,
        warnings: []
    };
}
export function readFrameworkPackageVersion(root = frameworkRoot) {
    return readFrameworkVersion(root);
}
export function createATMVersionSummary(cwd, outOption) {
    const matrixBundle = loadCompatibilityMatrixBundle();
    const matrix = matrixBundle.matrix;
    const frameworkVersion = readFrameworkPackageVersion();
    const downgrade = detectFrameworkDowngrade(cwd, frameworkVersion);
    let chartSummary = null;
    let versionCompatibility = {
        ok: false,
        status: 'unknown',
        code: 'chart-missing',
        frameworkVersion,
        chartVersion: null,
        templateVersion: matrix.releaseTrain.defaultTemplateVersion,
        defaultChartVersion: matrix.releaseTrain.defaultChartVersion,
        defaultTemplateVersion: matrix.releaseTrain.defaultTemplateVersion,
        minFrameworkVersion: null,
        migrationGuide: null,
        readOnlyDiagnostic: true,
        reason: 'ATMChart is missing; render or upgrade before applying onboarding mutations.'
    };
    try {
        chartSummary = loadATMChartSummary(cwd, outOption);
        versionCompatibility = createVersionCompatibilityReport({
            frontmatter: chartSummary.frontmatter,
            matrix,
            frameworkVersion
        });
    }
    catch (error) {
        if (!(error instanceof CliError) || error.code !== 'ATM_CHART_MISSING') {
            throw error;
        }
    }
    if (downgrade.detected) {
        versionCompatibility = createDowngradeCompatibilityReport(versionCompatibility, downgrade);
    }
    return {
        frameworkVersion,
        chartVersion: versionCompatibility.chartVersion,
        templateVersion: versionCompatibility.templateVersion,
        defaultChartVersion: matrix.releaseTrain.defaultChartVersion,
        defaultTemplateVersion: matrix.releaseTrain.defaultTemplateVersion,
        releaseTrain: matrix.releaseTrain,
        compatibility: versionCompatibility,
        compatibilityMatrix: {
            source: matrixBundle.source,
            matrixPath: matrixBundle.matrixPath,
            legacyMatrixPath: matrixBundle.legacyMatrixPath,
            lastUpdated: matrixBundle.lastUpdated,
            legacyEntriesLoaded: matrixBundle.legacyEntriesLoaded,
            warnings: matrixBundle.warnings
        },
        downgrade,
        atmChartPath: chartSummary?.atmChartPath ?? defaultATMChartRelativePath
    };
}
export function createVersionCompatibilityReport(input) {
    const chartVersion = typeof input.frontmatter.atm_chart_version === 'string' && input.frontmatter.atm_chart_version.trim().length > 0
        ? input.frontmatter.atm_chart_version.trim()
        : null;
    const templateVersion = typeof input.frontmatter.template_version === 'string' && input.frontmatter.template_version.trim().length > 0
        ? input.frontmatter.template_version.trim()
        : input.matrix.releaseTrain.defaultTemplateVersion;
    if (!chartVersion) {
        return createVersionReport(input.matrix, input.frameworkVersion, null, templateVersion, 'unknown', 'unknown-chart-version', null, null, 'ATMChart frontmatter does not declare atm_chart_version.');
    }
    const chartRecord = findChartRecord(input.matrix, chartVersion);
    if (!chartRecord) {
        return createVersionReport(input.matrix, input.frameworkVersion, chartVersion, templateVersion, 'unknown', 'unknown-chart-version', null, null, `ATMChart version ${chartVersion} is not present in compatibility-matrix.json.`);
    }
    const chartMinimum = higherVersion(chartRecord.minFrameworkVersion, asOptionalVersion(input.frontmatter.min_framework_version));
    const belowMinimumFramework = compareSemver(input.frameworkVersion, chartMinimum) < 0;
    const belowMinimumChart = typeof input.matrix.releaseTrain.minimumSupportedChartVersion === 'string'
        && compareSemver(chartVersion, input.matrix.releaseTrain.minimumSupportedChartVersion) < 0;
    const aboveMaximumFramework = typeof chartRecord.maxFrameworkVersion === 'string'
        && compareSemver(input.frameworkVersion, chartRecord.maxFrameworkVersion) > 0;
    if (belowMinimumFramework) {
        return createVersionReport(input.matrix, input.frameworkVersion, chartVersion, templateVersion, 'unsupported', 'unsupported-chart-version', chartMinimum, chartRecord.migrationGuide ?? null, `Framework ${input.frameworkVersion} is below ATMChart ${chartVersion} minimum ${chartMinimum}.`);
    }
    if (aboveMaximumFramework) {
        return createVersionReport(input.matrix, input.frameworkVersion, chartVersion, templateVersion, 'unsupported', 'unsupported-chart-version', chartMinimum, chartRecord.migrationGuide ?? null, `Framework ${input.frameworkVersion} is above ATMChart ${chartVersion} maximum ${chartRecord.maxFrameworkVersion}.`);
    }
    if (belowMinimumChart || chartRecord.status === 'unsupported') {
        return createVersionReport(input.matrix, input.frameworkVersion, chartVersion, templateVersion, 'unsupported', 'unsupported-chart-version', chartMinimum, chartRecord.migrationGuide ?? null, `ATMChart ${chartVersion} is outside the supported release train.`);
    }
    if (chartRecord.status === 'deprecated') {
        return createVersionReport(input.matrix, input.frameworkVersion, chartVersion, templateVersion, 'deprecated', 'deprecated-chart-version', chartMinimum, chartRecord.migrationGuide ?? null, `ATMChart ${chartVersion} is deprecated but still readable.`);
    }
    return createVersionReport(input.matrix, input.frameworkVersion, chartVersion, templateVersion, 'supported', 'supported-chart-version', chartMinimum, chartRecord.migrationGuide ?? null, `ATMChart ${chartVersion} is supported by framework ${input.frameworkVersion}.`);
}
export function createVersionReport(matrix, frameworkVersion, chartVersion, templateVersion, status, code, minFrameworkVersion, migrationGuide, reason) {
    return {
        ok: status === 'supported' || status === 'deprecated',
        status,
        code,
        frameworkVersion,
        chartVersion,
        templateVersion,
        defaultChartVersion: matrix.releaseTrain.defaultChartVersion,
        defaultTemplateVersion: matrix.releaseTrain.defaultTemplateVersion,
        minFrameworkVersion,
        migrationGuide,
        readOnlyDiagnostic: status === 'unsupported' || status === 'unknown',
        reason
    };
}
export function normalizeCompatibilityMatrix(candidate) {
    if (candidate?.schemaVersion !== 'atm.compatibilityMatrix.v0.1' || !candidate.releaseTrain || !Array.isArray(candidate.atmChartVersions) || !Array.isArray(candidate.agentTemplateVersions)) {
        throw new CliError('ATM_COMPATIBILITY_MATRIX_INVALID', 'compatibility-matrix.json is missing required release train fields.', { exitCode: 2 });
    }
    return candidate;
}
export function loadLegacyCompatibilityMatrix(root = frameworkRoot) {
    const overridePath = process.env.ATM_COMPATIBILITY_LEGACY_MATRIX_PATH;
    const legacyPath = overridePath
        ? path.resolve(overridePath)
        : path.join(root, 'compatibility-matrix.legacy.json');
    if (!existsSync(legacyPath)) {
        return { document: null, path: null, entryCount: 0 };
    }
    const document = normalizeLegacyCompatibilityMatrix(JSON.parse(readFileSync(legacyPath, 'utf8')));
    return {
        document,
        path: legacyPath,
        entryCount: document.atmChartVersions.length + document.agentTemplateVersions.length
    };
}
export function normalizeLegacyCompatibilityMatrix(candidate) {
    if (candidate?.schemaVersion !== 'atm.compatibilityMatrixLegacy.v0.1' || typeof candidate.lastUpdated !== 'string' || !Array.isArray(candidate.atmChartVersions) || !Array.isArray(candidate.agentTemplateVersions)) {
        throw new CliError('ATM_COMPATIBILITY_LEGACY_MATRIX_INVALID', 'compatibility-matrix.legacy.json is missing required legacy fields.', { exitCode: 2 });
    }
    return candidate;
}
export function mergeCompatibilityMatrices(activeMatrix, legacyMatrix) {
    if (!legacyMatrix)
        return activeMatrix;
    return {
        ...activeMatrix,
        atmChartVersions: mergeVersionEntries(activeMatrix.atmChartVersions, legacyMatrix.atmChartVersions),
        agentTemplateVersions: mergeVersionEntries(activeMatrix.agentTemplateVersions, legacyMatrix.agentTemplateVersions)
    };
}
export function mergeVersionEntries(activeEntries, legacyEntries) {
    const seen = new Set(activeEntries.map((entry) => entry.version));
    const merged = [...activeEntries];
    for (const legacyEntry of legacyEntries) {
        if (seen.has(legacyEntry.version))
            continue;
        merged.push(legacyEntry);
        seen.add(legacyEntry.version);
    }
    return merged;
}
export function detectFrameworkDowngrade(cwd, frameworkVersion) {
    const cachePath = path.join(cwd, versionCacheRelativePath);
    const relativeCachePath = relativePathFrom(cwd, cachePath);
    const atmRoot = path.join(cwd, '.atm');
    if (!existsSync(atmRoot) || isFrameworkRepositoryRoot(cwd)) {
        return {
            checked: false,
            detected: false,
            cachePath: relativeCachePath,
            currentFrameworkVersion: frameworkVersion,
            lastSeenFrameworkVersion: null,
            readOnlyDiagnostic: false,
            reason: isFrameworkRepositoryRoot(cwd) ? 'Framework repository roots do not persist adopter downgrade cache.' : null
        };
    }
    const previous = readVersionCache(cachePath);
    const cachedFrameworkVersion = typeof previous?.lastSeenFrameworkVersion === 'string'
        ? previous.lastSeenFrameworkVersion
        : null;
    const lastSeenFrameworkVersion = cachedFrameworkVersion && isSemver(cachedFrameworkVersion)
        ? cachedFrameworkVersion
        : null;
    const detected = Boolean(lastSeenFrameworkVersion && compareSemver(frameworkVersion, lastSeenFrameworkVersion) < 0);
    if (!detected) {
        writeVersionCache(cachePath, {
            schemaId: 'atm.frameworkVersionCache',
            specVersion: '0.1.0',
            lastSeenFrameworkVersion: highestVersion(frameworkVersion, lastSeenFrameworkVersion),
            lastSeenAt: new Date().toISOString()
        });
    }
    return {
        checked: true,
        detected,
        cachePath: relativeCachePath,
        currentFrameworkVersion: frameworkVersion,
        lastSeenFrameworkVersion,
        readOnlyDiagnostic: detected,
        reason: detected
            ? `Framework downgrade detected: last seen ${lastSeenFrameworkVersion}, current ${frameworkVersion}. Write-oriented onboarding commands must stay read-only until the user reviews the downgrade.`
            : null
    };
}
export function readVersionCache(cachePath) {
    if (!existsSync(cachePath))
        return null;
    try {
        return JSON.parse(readFileSync(cachePath, 'utf8'));
    }
    catch {
        return null;
    }
}
export function writeVersionCache(cachePath, cache) {
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}
export function createDowngradeCompatibilityReport(report, downgrade) {
    return {
        ...report,
        ok: false,
        status: 'unsupported',
        code: 'framework-downgrade-detected',
        compatibilityBaseCode: report.code,
        readOnlyDiagnostic: true,
        reason: downgrade.reason ?? report.reason,
        downgradeDetected: true,
        lastSeenFrameworkVersion: downgrade.lastSeenFrameworkVersion
    };
}
export function isFrameworkRepositoryRoot(cwd) {
    const packagePath = path.join(cwd, 'package.json');
    if (!existsSync(packagePath))
        return false;
    try {
        const parsed = JSON.parse(readFileSync(packagePath, 'utf8'));
        return parsed.name === 'ai-atomic-framework';
    }
    catch {
        return false;
    }
}
export function findChartRecord(matrix, version) {
    return matrix.atmChartVersions.find((entry) => entry.version === version) ?? null;
}
