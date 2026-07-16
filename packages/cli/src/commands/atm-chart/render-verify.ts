import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { computeSha256ForContent, computeSha256ForFile } from '../../../../core/src/hash-lock/hash-lock.ts';
import type { DefaultGuardsDocument } from '../../../../plugin-governance-local/src/default-guards.ts';
import { detectGovernanceRuntime, relativePathFrom } from '../governance-runtime.ts';
import { CliError, makeResult, message } from '../shared.ts';
import {
  atmChartFrontmatterSchemaVersion,
  atmChartSourceSchemas,
  defaultATMChartRelativePath,
  frameworkRoot
} from './constants.ts';
import { createVersionCompatibilityReport, findChartRecord, loadCompatibilityMatrix, readFrameworkPackageVersion } from './compatibility.ts';
import type { ATMChartFrontmatter, ATMChartSourceSnapshot, ATMChartSummary } from './types.ts';

export function renderATMChart(cwd: string, atmChartAbsolutePath: string) {
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

export function verifyATMChart(cwd: string, atmChartAbsolutePath: string, options: { readonly versionCheck?: boolean } = {}) {
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

export function createATMChartMarkdown(input: {
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

export function readDefaultGuards(filePath: string): DefaultGuardsDocument {
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

export function readATMChartFrontmatter(filePath: string): ATMChartFrontmatter {
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

export function parseFrontmatterValue(rawValue: string) {
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

export function resolveATMChartPath(cwd: string, outOption: unknown) {
  if (typeof outOption !== 'string' || outOption.trim().length === 0) {
    return path.join(cwd, defaultATMChartRelativePath);
  }
  return path.isAbsolute(outOption)
    ? path.resolve(outOption)
    : path.join(cwd, outOption);
}

export function normalizePath(filePath: string) {
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

export function extractGuardSummary(body: string) {
  const sectionMatch = body.match(/## Core Guard Summary\r?\n([\s\S]*?)(?:\r?\n## |$)/);
  if (!sectionMatch) {
    return [];
  }
  return sectionMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- `'));
}
