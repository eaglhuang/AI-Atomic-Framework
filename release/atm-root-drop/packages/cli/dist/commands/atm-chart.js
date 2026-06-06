import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSha256ForContent, computeSha256ForFile } from '../../../core/dist/hash-lock/hash-lock.js';
import { detectGovernanceRuntime, relativePathFrom } from './governance-runtime.js';
import { CliError, makeResult, message, parseArgsForCommand, readFrameworkVersion } from './shared.js';
import { getCommandSpec } from './command-specs.js';
import { asOptionalVersion, compareSemver, higherVersion, highestVersion, isSemver } from './atm-chart/semver.js';
const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
export const defaultATMChartRelativePath = path.join('.atm', 'memory', 'atm-chart.md');
export const atmChartFrontmatterSchemaVersion = 'atm.atmChart.v0.1';
export const atmChartSourceSchemas = Object.freeze({
    'governance/default-guards': 'schemas/governance/default-guards.schema.json',
    'charter/charter-invariants': 'schemas/charter/charter-invariants.schema.json',
    'integrations/install-manifest': 'schemas/integrations/install-manifest.schema.json',
    'agent-prompt': 'schemas/agent-prompt.schema.json',
    'upgrade/upgrade-proposal': 'schemas/upgrade/upgrade-proposal.schema.json'
});
const fallbackCompatibilityMatrix = Object.freeze({
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
const fallbackLegacyCompatibilityMatrix = Object.freeze({
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
const versionCacheRelativePath = path.join('.atm', 'runtime', 'version-cache.json');
export async function runATMChart(argv) {
    const spec = getCommandSpec('atm-chart');
    if (!spec) {
        throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for atm-chart.', { exitCode: 2 });
    }
    const parsed = parseArgsForCommand(spec, argv);
    const [action = 'render'] = parsed.positional;
    const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
    // M19: Mermaid auto-gen from map.spec.json
    if (parsed.options.mermaid === true || action === 'mermaid') {
        const mapId = String(parsed.options.map ?? '');
        if (!mapId) {
            throw new CliError('ATM_CLI_USAGE', 'atm-chart --mermaid requires --map <mapId>', { exitCode: 2 });
        }
        const { generateMermaidFromMapSpec } = await import('../../../core/dist/maps/mermaid-gen.js');
        const result = generateMermaidFromMapSpec(cwd, mapId);
        return makeResult({
            ok: true,
            command: 'atm-chart',
            cwd,
            messages: [
                message('info', 'ATM_CHART_MERMAID_GENERATED', `Mermaid diagram generated for map ${mapId}: ${result.nodeCount} nodes, ${result.edgeCount} edges.`, { mapId, nodeCount: result.nodeCount, edgeCount: result.edgeCount })
            ],
            evidence: { mermaidSource: result.mermaidSource, result }
        });
    }
    const atmChartAbsolutePath = resolveATMChartPath(cwd, parsed.options.out);
    const versionCheck = parsed.options.versionCheck === true;
    if (action === 'render') {
        return renderATMChart(cwd, atmChartAbsolutePath);
    }
    if (action === 'verify') {
        return verifyATMChart(cwd, atmChartAbsolutePath, { versionCheck });
    }
    throw new CliError('ATM_CLI_USAGE', `atm-chart does not support action ${action}`, {
        exitCode: 2,
        details: {
            supportedActions: ['render', 'verify', 'mermaid']
        }
    });
}
function renderATMChart(cwd, atmChartAbsolutePath) {
    const sources = collectATMChartSources(cwd);
    const compatibilityMatrix = loadCompatibilityMatrix();
    const frameworkVersion = readFrameworkPackageVersion();
    const chartVersion = compatibilityMatrix.releaseTrain.defaultChartVersion;
    const chartRecord = findChartRecord(compatibilityMatrix, chartVersion);
    const markdown = createATMChartMarkdown({
        sourceGuardsPath: sources.sourceGuardsPath,
        sourceGuardsSha256: sources.sourceGuardsSha256,
        sourceSchemaSha256s: sources.sourceSchemaSha256s,
        guardDocument: sources.guardDocument,
        atmChartVersion: chartVersion,
        frameworkVersion,
        templateVersion: compatibilityMatrix.releaseTrain.defaultTemplateVersion,
        minFrameworkVersion: chartRecord?.minFrameworkVersion ?? frameworkVersion
    });
    mkdirSync(path.dirname(atmChartAbsolutePath), { recursive: true });
    writeFileSync(atmChartAbsolutePath, markdown, 'utf8');
    return makeResult({
        ok: true,
        command: 'atm-chart',
        cwd,
        messages: [message('info', 'ATM_CHART_RENDERED', 'ATMChart markdown rendered from current ATM guard sources.')],
        evidence: {
            action: 'render',
            atmChartPath: relativePathFrom(cwd, atmChartAbsolutePath),
            sourceGuardsPath: sources.sourceGuardsPath,
            sourceGuardsSha256: sources.sourceGuardsSha256,
            sourceSchemaSha256s: sources.sourceSchemaSha256s,
            guardCount: sources.guardDocument.guards.length,
            versionCompatibility: createVersionCompatibilityReport({
                frontmatter: readATMChartFrontmatter(atmChartAbsolutePath),
                matrix: compatibilityMatrix,
                frameworkVersion
            }),
            atmChartSha256: computeSha256ForContent(markdown)
        }
    });
}
function verifyATMChart(cwd, atmChartAbsolutePath, options = {}) {
    if (!existsSync(atmChartAbsolutePath)) {
        throw new CliError('ATM_CHART_MISSING', 'ATMChart markdown was not found. Run `node atm.mjs atm-chart render` first.', {
            exitCode: 2,
            details: {
                atmChartPath: relativePathFrom(cwd, atmChartAbsolutePath)
            }
        });
    }
    const sources = collectATMChartSources(cwd);
    const recorded = readATMChartFrontmatter(atmChartAbsolutePath);
    const schemaDrift = collectSchemaDrift(recorded.source_schema_sha256s, sources.sourceSchemaSha256s);
    const guardsDrifted = recorded.source_guards_sha256 !== sources.sourceGuardsSha256;
    const versionCompatibility = createVersionCompatibilityReport({
        frontmatter: recorded,
        matrix: loadCompatibilityMatrix(),
        frameworkVersion: readFrameworkPackageVersion()
    });
    if (guardsDrifted || schemaDrift.length > 0) {
        throw new CliError('ATM_CHART_STALE', 'ATMChart markdown is stale. Re-run `node atm.mjs atm-chart render`.', {
            exitCode: 2,
            details: {
                atmChartPath: relativePathFrom(cwd, atmChartAbsolutePath),
                sourceGuardsPath: sources.sourceGuardsPath,
                recordedSourceGuardsSha256: recorded.source_guards_sha256,
                currentSourceGuardsSha256: sources.sourceGuardsSha256,
                schemaDrift
            }
        });
    }
    if (options.versionCheck === true && !versionCompatibility.ok) {
        throw new CliError('ATM_CHART_VERSION_UNSUPPORTED', 'ATMChart version is not supported by the current framework release train.', {
            exitCode: 2,
            details: { versionCompatibility }
        });
    }
    return makeResult({
        ok: true,
        command: 'atm-chart',
        cwd,
        messages: [
            message('info', 'ATM_CHART_VERIFY_OK', 'ATMChart markdown matches the current ATM guard sources.'),
            ...(options.versionCheck === true
                ? [message(versionCompatibility.status === 'deprecated' ? 'warning' : 'info', 'ATM_CHART_VERSION_CHECK_OK', 'ATMChart version compatibility check completed.', versionCompatibility)]
                : [])
        ],
        evidence: {
            action: 'verify',
            atmChartPath: relativePathFrom(cwd, atmChartAbsolutePath),
            sourceGuardsPath: sources.sourceGuardsPath,
            sourceGuardsSha256: sources.sourceGuardsSha256,
            sourceSchemaSha256s: sources.sourceSchemaSha256s,
            guardCount: sources.guardDocument.guards.length,
            versionCompatibility
        }
    });
}
export function collectATMChartSources(cwd) {
    const runtime = detectGovernanceRuntime(cwd);
    const sourceGuardsAbsolutePath = path.join(cwd, runtime.paths.defaultGuardsPath);
    if (!existsSync(sourceGuardsAbsolutePath)) {
        throw new CliError('ATM_CHART_GUARDS_MISSING', 'Default guards were not found. Run `node atm.mjs bootstrap` or `node atm.mjs init --adopt default` first.', {
            exitCode: 2,
            details: {
                sourceGuardsPath: runtime.paths.defaultGuardsPath
            }
        });
    }
    const sourceSchemaSha256s = Object.fromEntries(Object.entries(atmChartSourceSchemas).map(([schemaId, relativeSchemaPath]) => {
        const absoluteSchemaPath = path.join(frameworkRoot, relativeSchemaPath);
        if (!existsSync(absoluteSchemaPath)) {
            throw new CliError('ATM_CHART_SCHEMA_SOURCE_MISSING', `Schema source was not found for ${schemaId}.`, {
                exitCode: 2,
                details: {
                    schemaId,
                    schemaPath: normalizePath(relativeSchemaPath)
                }
            });
        }
        return [schemaId, computeSha256ForFile(absoluteSchemaPath)];
    }));
    return {
        sourceGuardsPath: normalizePath(runtime.paths.defaultGuardsPath),
        sourceGuardsSha256: computeSha256ForFile(sourceGuardsAbsolutePath),
        sourceSchemaSha256s,
        guardDocument: readDefaultGuards(sourceGuardsAbsolutePath)
    };
}
function createATMChartMarkdown(input) {
    const guardLines = input.guardDocument.guards
        .map((guard) => `- \`${guard.id}\`: ${guard.summary}`)
        .join('\n');
    const schemaLines = Object.entries(atmChartSourceSchemas)
        .map(([schemaId, relativeSchemaPath]) => `- \`${schemaId}\` -> \`${normalizePath(relativeSchemaPath)}\` (${input.sourceSchemaSha256s[schemaId]})`)
        .join('\n');
    return [
        '---',
        `schema_version: ${atmChartFrontmatterSchemaVersion}`,
        `atm_chart_version: ${input.atmChartVersion}`,
        `framework_version: ${input.frameworkVersion}`,
        `template_version: ${input.templateVersion}`,
        `min_framework_version: ${input.minFrameworkVersion}`,
        `source_guards_path: ${input.sourceGuardsPath}`,
        `source_guards_sha256: ${input.sourceGuardsSha256}`,
        `source_schema_sha256s: ${JSON.stringify(input.sourceSchemaSha256s)}`,
        '---',
        '# ATMChart',
        '',
        '## Core Guard Summary',
        guardLines,
        '',
        '## Source of Truth',
        `- Guards: \`${input.sourceGuardsPath}\``,
        schemaLines,
        '',
        '## Official Entry Route',
        '- Run `node atm.mjs next --json` and follow the returned action.',
        ''
    ].join('\n');
}
function readDefaultGuards(filePath) {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    if (!Array.isArray(parsed.guards)) {
        throw new CliError('ATM_CHART_GUARDS_INVALID', 'Default guards file is missing the guards array.', {
            exitCode: 2,
            details: {
                sourceGuardsPath: normalizePath(filePath)
            }
        });
    }
    return parsed;
}
function readATMChartFrontmatter(filePath) {
    const content = readFileSync(filePath, 'utf8');
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    if (!match) {
        throw new CliError('ATM_CHART_FRONTMATTER_INVALID', 'ATMChart markdown is missing its frontmatter block.', {
            exitCode: 2,
            details: {
                atmChartPath: normalizePath(filePath)
            }
        });
    }
    const frontmatter = Object.fromEntries(match[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
        const separatorIndex = line.indexOf(':');
        if (separatorIndex <= 0) {
            throw new CliError('ATM_CHART_FRONTMATTER_INVALID', `Invalid ATMChart frontmatter line: ${line}`, { exitCode: 2 });
        }
        const key = line.slice(0, separatorIndex).trim();
        const rawValue = line.slice(separatorIndex + 1).trim();
        return [key, parseFrontmatterValue(rawValue)];
    }));
    if (typeof frontmatter.source_guards_path !== 'string' || typeof frontmatter.source_guards_sha256 !== 'string' || !frontmatter.source_schema_sha256s || typeof frontmatter.source_schema_sha256s !== 'object') {
        throw new CliError('ATM_CHART_FRONTMATTER_INVALID', 'ATMChart frontmatter is missing one or more required fields.', {
            exitCode: 2,
            details: {
                atmChartPath: normalizePath(filePath)
            }
        });
    }
    return frontmatter;
}
function parseFrontmatterValue(rawValue) {
    if (rawValue.startsWith('{') || rawValue.startsWith('[')) {
        return JSON.parse(rawValue);
    }
    return rawValue;
}
export function collectSchemaDrift(recorded, current) {
    const drift = Object.entries(current)
        .filter(([schemaId, digest]) => recorded[schemaId] !== digest)
        .map(([schemaId, digest]) => ({
        schemaId,
        recorded: recorded[schemaId] ?? null,
        current: digest
    }));
    const removed = Object.keys(recorded)
        .filter((schemaId) => !Object.hasOwn(current, schemaId))
        .map((schemaId) => ({
        schemaId,
        recorded: recorded[schemaId],
        current: null
    }));
    return [...drift, ...removed];
}
function resolveATMChartPath(cwd, outOption) {
    if (typeof outOption !== 'string' || outOption.trim().length === 0) {
        return path.join(cwd, defaultATMChartRelativePath);
    }
    return path.isAbsolute(outOption)
        ? path.resolve(outOption)
        : path.join(cwd, outOption);
}
function normalizePath(filePath) {
    return filePath.replace(/\\/g, '/');
}
export function loadATMChartSummary(cwd, outOption) {
    const atmChartAbsolutePath = resolveATMChartPath(cwd, outOption);
    if (!existsSync(atmChartAbsolutePath)) {
        throw new CliError('ATM_CHART_MISSING', 'ATMChart markdown was not found. Run `node atm.mjs atm-chart render` first.', {
            exitCode: 2,
            details: {
                atmChartPath: relativePathFrom(cwd, atmChartAbsolutePath)
            }
        });
    }
    const content = readFileSync(atmChartAbsolutePath, 'utf8');
    const frontmatter = readATMChartFrontmatter(atmChartAbsolutePath);
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
    return {
        atmChartPath: relativePathFrom(cwd, atmChartAbsolutePath),
        frontmatter,
        body,
        guardSummary: extractGuardSummary(body)
    };
}
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
function createVersionReport(matrix, frameworkVersion, chartVersion, templateVersion, status, code, minFrameworkVersion, migrationGuide, reason) {
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
function normalizeCompatibilityMatrix(candidate) {
    if (candidate?.schemaVersion !== 'atm.compatibilityMatrix.v0.1' || !candidate.releaseTrain || !Array.isArray(candidate.atmChartVersions) || !Array.isArray(candidate.agentTemplateVersions)) {
        throw new CliError('ATM_COMPATIBILITY_MATRIX_INVALID', 'compatibility-matrix.json is missing required release train fields.', { exitCode: 2 });
    }
    return candidate;
}
function loadLegacyCompatibilityMatrix(root = frameworkRoot) {
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
function normalizeLegacyCompatibilityMatrix(candidate) {
    if (candidate?.schemaVersion !== 'atm.compatibilityMatrixLegacy.v0.1' || typeof candidate.lastUpdated !== 'string' || !Array.isArray(candidate.atmChartVersions) || !Array.isArray(candidate.agentTemplateVersions)) {
        throw new CliError('ATM_COMPATIBILITY_LEGACY_MATRIX_INVALID', 'compatibility-matrix.legacy.json is missing required legacy fields.', { exitCode: 2 });
    }
    return candidate;
}
function mergeCompatibilityMatrices(activeMatrix, legacyMatrix) {
    if (!legacyMatrix)
        return activeMatrix;
    return {
        ...activeMatrix,
        atmChartVersions: mergeVersionEntries(activeMatrix.atmChartVersions, legacyMatrix.atmChartVersions),
        agentTemplateVersions: mergeVersionEntries(activeMatrix.agentTemplateVersions, legacyMatrix.agentTemplateVersions)
    };
}
function mergeVersionEntries(activeEntries, legacyEntries) {
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
function detectFrameworkDowngrade(cwd, frameworkVersion) {
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
function readVersionCache(cachePath) {
    if (!existsSync(cachePath))
        return null;
    try {
        return JSON.parse(readFileSync(cachePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function writeVersionCache(cachePath, cache) {
    mkdirSync(path.dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
}
function createDowngradeCompatibilityReport(report, downgrade) {
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
function isFrameworkRepositoryRoot(cwd) {
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
function findChartRecord(matrix, version) {
    return matrix.atmChartVersions.find((entry) => entry.version === version) ?? null;
}
// Semver helpers extracted to ./atm-chart/semver.ts (see imports at top).
// `compareSemver` is re-exported for backward compatibility with any external caller.
export { compareSemver } from './atm-chart/semver.js';
function extractGuardSummary(body) {
    const sectionMatch = body.match(/## Core Guard Summary\r?\n([\s\S]*?)(?:\r?\n## |$)/);
    if (!sectionMatch) {
        return [];
    }
    return sectionMatch[1]
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- `'));
}
