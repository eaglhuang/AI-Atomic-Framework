import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSha256ForContent, computeSha256ForFile } from '../../../core/src/hash-lock/hash-lock.ts';
import type { DefaultGuardsDocument } from '../../../plugin-governance-local/src/default-guards.ts';
import { detectGovernanceRuntime, relativePathFrom } from './governance-runtime.ts';
import { CliError, frameworkVersion as bundledFrameworkVersion, makeResult, message, parseArgsForCommand } from './shared.ts';
import { getCommandSpec } from './command-specs.ts';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
export const defaultATMChartRelativePath = path.join('.atm', 'memory', 'atm-chart.md');
export const atmChartSourceSchemas = Object.freeze({
  'governance/default-guards': 'schemas/governance/default-guards.schema.json',
  'charter/charter-invariants': 'schemas/charter/charter-invariants.schema.json',
  'integrations/install-manifest': 'schemas/integrations/install-manifest.schema.json',
  'agent-prompt': 'schemas/agent-prompt.schema.json',
  'upgrade/upgrade-proposal': 'schemas/upgrade/upgrade-proposal.schema.json'
});

const fallbackCompatibilityMatrix = Object.freeze<CompatibilityMatrixDocument>({
  schemaVersion: 'atm.compatibilityMatrix.v0.1',
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
    },
    {
      version: '0.0.1',
      status: 'unsupported',
      sourceSchemaVersion: 'atm.defaultGuards.v0.1',
      minFrameworkVersion: '0.0.0',
      maxFrameworkVersion: null,
      migrationGuide: 'Run `node atm.mjs upgrade plan --json`, review the dry-run file list, then apply with an explicit backup/rollback path.'
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

type ATMChartFrontmatter = {
  readonly atm_chart_version?: string;
  readonly framework_version?: string;
  readonly template_version?: string;
  readonly min_framework_version?: string;
  readonly source_guards_path: string;
  readonly source_guards_sha256: string;
  readonly source_schema_sha256s: Record<string, string>;
};

export type VersionLagStatus = 'supported' | 'deprecated' | 'unsupported' | 'unknown';

export interface CompatibilityMatrixDocument {
  readonly schemaVersion: 'atm.compatibilityMatrix.v0.1';
  readonly releaseTrain: {
    readonly frameworkVersion: string;
    readonly defaultChartVersion: string;
    readonly defaultTemplateVersion: string;
    readonly minimumSupportedChartVersion?: string;
    readonly minimumSupportedTemplateVersion?: string;
  };
  readonly atmChartVersions: readonly CompatibilityMatrixChartVersion[];
  readonly agentTemplateVersions: readonly CompatibilityMatrixTemplateVersion[];
}

export interface CompatibilityMatrixChartVersion {
  readonly version: string;
  readonly status: VersionLagStatus;
  readonly sourceSchemaVersion: string;
  readonly minFrameworkVersion: string;
  readonly maxFrameworkVersion?: string | null;
  readonly migrationGuide?: string | null;
}

export interface CompatibilityMatrixTemplateVersion {
  readonly version: string;
  readonly status: VersionLagStatus;
  readonly minFrameworkVersion: string;
  readonly maxFrameworkVersion?: string | null;
  readonly migrationGuide?: string | null;
}

export interface VersionCompatibilityReport {
  readonly ok: boolean;
  readonly status: VersionLagStatus;
  readonly code: string;
  readonly frameworkVersion: string;
  readonly chartVersion: string | null;
  readonly templateVersion: string;
  readonly defaultChartVersion: string;
  readonly defaultTemplateVersion: string;
  readonly minFrameworkVersion: string | null;
  readonly migrationGuide: string | null;
  readonly readOnlyDiagnostic: boolean;
  readonly reason: string;
}

export interface ATMChartSourceSnapshot {
  readonly sourceGuardsPath: string;
  readonly sourceGuardsSha256: string;
  readonly sourceSchemaSha256s: Record<string, string>;
  readonly guardDocument: DefaultGuardsDocument;
}

export interface ATMChartSummary {
  readonly atmChartPath: string;
  readonly frontmatter: ATMChartFrontmatter;
  readonly body: string;
  readonly guardSummary: readonly string[];
}

export async function runATMChart(argv: string[]) {
  const spec = getCommandSpec('atm-chart');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for atm-chart.', { exitCode: 2 });
  }

  const parsed = parseArgsForCommand(spec, argv);
  const [action = 'render'] = parsed.positional;
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
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
      supportedActions: ['render', 'verify']
    }
  });
}

function renderATMChart(cwd: string, atmChartAbsolutePath: string) {
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

function verifyATMChart(cwd: string, atmChartAbsolutePath: string, options: { readonly versionCheck?: boolean } = {}) {
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

export function collectATMChartSources(cwd: string): ATMChartSourceSnapshot {
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

function createATMChartMarkdown(input: {
  readonly sourceGuardsPath: string;
  readonly sourceGuardsSha256: string;
  readonly sourceSchemaSha256s: Record<string, string>;
  readonly guardDocument: DefaultGuardsDocument;
  readonly atmChartVersion: string;
  readonly frameworkVersion: string;
  readonly templateVersion: string;
  readonly minFrameworkVersion: string;
}) {
  const guardLines = input.guardDocument.guards
    .map((guard) => `- \`${guard.id}\`: ${guard.summary}`)
    .join('\n');
  const schemaLines = Object.entries(atmChartSourceSchemas)
    .map(([schemaId, relativeSchemaPath]) => `- \`${schemaId}\` -> \`${normalizePath(relativeSchemaPath)}\` (${input.sourceSchemaSha256s[schemaId]})`)
    .join('\n');

  return [
    '---',
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

function readDefaultGuards(filePath: string): DefaultGuardsDocument {
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<DefaultGuardsDocument>;
  if (!Array.isArray(parsed.guards)) {
    throw new CliError('ATM_CHART_GUARDS_INVALID', 'Default guards file is missing the guards array.', {
      exitCode: 2,
      details: {
        sourceGuardsPath: normalizePath(filePath)
      }
    });
  }
  return parsed as DefaultGuardsDocument;
}

function readATMChartFrontmatter(filePath: string): ATMChartFrontmatter {
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
    })) as Partial<ATMChartFrontmatter>;

  if (typeof frontmatter.source_guards_path !== 'string' || typeof frontmatter.source_guards_sha256 !== 'string' || !frontmatter.source_schema_sha256s || typeof frontmatter.source_schema_sha256s !== 'object') {
    throw new CliError('ATM_CHART_FRONTMATTER_INVALID', 'ATMChart frontmatter is missing one or more required fields.', {
      exitCode: 2,
      details: {
        atmChartPath: normalizePath(filePath)
      }
    });
  }

  return frontmatter as ATMChartFrontmatter;
}

function parseFrontmatterValue(rawValue: string) {
  if (rawValue.startsWith('{') || rawValue.startsWith('[')) {
    return JSON.parse(rawValue);
  }
  return rawValue;
}

export function collectSchemaDrift(recorded: Record<string, string>, current: Record<string, string>) {
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

function resolveATMChartPath(cwd: string, outOption: unknown) {
  if (typeof outOption !== 'string' || outOption.trim().length === 0) {
    return path.join(cwd, defaultATMChartRelativePath);
  }
  return path.isAbsolute(outOption)
    ? path.resolve(outOption)
    : path.join(cwd, outOption);
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/');
}

export function loadATMChartSummary(cwd: string, outOption?: unknown): ATMChartSummary {
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

export function loadCompatibilityMatrix(root = frameworkRoot): CompatibilityMatrixDocument {
  const overridePath = process.env.ATM_COMPATIBILITY_MATRIX_PATH;
  const matrixPath = overridePath
    ? path.resolve(overridePath)
    : path.join(root, 'compatibility-matrix.json');
  if (!existsSync(matrixPath)) {
    return fallbackCompatibilityMatrix;
  }
  const parsed = JSON.parse(readFileSync(matrixPath, 'utf8')) as CompatibilityMatrixDocument;
  return normalizeCompatibilityMatrix(parsed);
}

export function readFrameworkPackageVersion(root = frameworkRoot) {
  const packagePath = path.join(root, 'package.json');
  if (!existsSync(packagePath)) {
    return bundledFrameworkVersion;
  }
  try {
    const parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.trim().length > 0
      ? parsed.version
      : bundledFrameworkVersion;
  } catch {
    return bundledFrameworkVersion;
  }
}

export function createATMVersionSummary(cwd: string, outOption?: unknown) {
  const matrix = loadCompatibilityMatrix();
  const frameworkVersion = readFrameworkPackageVersion();
  let chartSummary: ATMChartSummary | null = null;
  let versionCompatibility: VersionCompatibilityReport = {
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
  } catch (error) {
    if (!(error instanceof CliError) || error.code !== 'ATM_CHART_MISSING') {
      throw error;
    }
  }

  return {
    frameworkVersion,
    chartVersion: versionCompatibility.chartVersion,
    templateVersion: versionCompatibility.templateVersion,
    defaultChartVersion: matrix.releaseTrain.defaultChartVersion,
    defaultTemplateVersion: matrix.releaseTrain.defaultTemplateVersion,
    releaseTrain: matrix.releaseTrain,
    compatibility: versionCompatibility,
    atmChartPath: chartSummary?.atmChartPath ?? defaultATMChartRelativePath
  };
}

export function createVersionCompatibilityReport(input: {
  readonly frontmatter: Partial<ATMChartFrontmatter>;
  readonly matrix: CompatibilityMatrixDocument;
  readonly frameworkVersion: string;
}): VersionCompatibilityReport {
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

function createVersionReport(matrix: CompatibilityMatrixDocument, frameworkVersion: string, chartVersion: string | null, templateVersion: string, status: VersionLagStatus, code: string, minFrameworkVersion: string | null, migrationGuide: string | null, reason: string): VersionCompatibilityReport {
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

function normalizeCompatibilityMatrix(candidate: CompatibilityMatrixDocument): CompatibilityMatrixDocument {
  if (candidate?.schemaVersion !== 'atm.compatibilityMatrix.v0.1' || !candidate.releaseTrain || !Array.isArray(candidate.atmChartVersions) || !Array.isArray(candidate.agentTemplateVersions)) {
    throw new CliError('ATM_COMPATIBILITY_MATRIX_INVALID', 'compatibility-matrix.json is missing required release train fields.', { exitCode: 2 });
  }
  return candidate;
}

function findChartRecord(matrix: CompatibilityMatrixDocument, version: string) {
  return matrix.atmChartVersions.find((entry) => entry.version === version) ?? null;
}

function asOptionalVersion(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function higherVersion(left: string, right: string | null) {
  if (!right) return left;
  return compareSemver(left, right) >= 0 ? left : right;
}

export function compareSemver(left: string, right: string) {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (parsedLeft[key] !== parsedRight[key]) {
      return parsedLeft[key] > parsedRight[key] ? 1 : -1;
    }
  }
  if (parsedLeft.prerelease === parsedRight.prerelease) return 0;
  if (!parsedLeft.prerelease) return 1;
  if (!parsedRight.prerelease) return -1;
  return parsedLeft.prerelease.localeCompare(parsedRight.prerelease);
}

function parseSemver(version: string) {
  const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    throw new CliError('ATM_VERSION_INVALID', `Invalid semver version: ${version}`, { exitCode: 2 });
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? ''
  };
}

function extractGuardSummary(body: string) {
  const sectionMatch = body.match(/## Core Guard Summary\r?\n([\s\S]*?)(?:\r?\n## |$)/);
  if (!sectionMatch) {
    return [];
  }
  return sectionMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- `'));
}