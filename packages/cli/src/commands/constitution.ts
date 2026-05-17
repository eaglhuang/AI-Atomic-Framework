import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSha256ForContent, computeSha256ForFile } from '../../../core/src/hash-lock/hash-lock.ts';
import type { DefaultGuardsDocument } from '../../../plugin-governance-local/src/default-guards.ts';
import { detectGovernanceRuntime, relativePathFrom } from './governance-runtime.ts';
import { CliError, makeResult, message, parseArgsForCommand } from './shared.ts';
import { getCommandSpec } from './command-specs.ts';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');
export const defaultConstitutionRelativePath = path.join('.atm', 'memory', 'constitution.md');
const constitutionSourceSchemas = Object.freeze({
  'governance/default-guards': 'schemas/governance/default-guards.schema.json',
  'charter/charter-invariants': 'schemas/charter/charter-invariants.schema.json',
  'integrations/install-manifest': 'schemas/integrations/install-manifest.schema.json',
  'agent-prompt': 'schemas/agent-prompt.schema.json',
  'upgrade/upgrade-proposal': 'schemas/upgrade/upgrade-proposal.schema.json'
});

type ConstitutionFrontmatter = {
  readonly generated_at: string;
  readonly source_guards_path: string;
  readonly source_guards_sha256: string;
  readonly source_schema_sha256s: Record<string, string>;
};

export interface ConstitutionSummary {
  readonly constitutionPath: string;
  readonly frontmatter: ConstitutionFrontmatter;
  readonly body: string;
  readonly guardSummary: readonly string[];
}

export async function runConstitution(argv: string[]) {
  const spec = getCommandSpec('constitution');
  if (!spec) {
    throw new CliError('ATM_CLI_HELP_NOT_FOUND', 'No help spec found for constitution.', { exitCode: 2 });
  }

  const parsed = parseArgsForCommand(spec, argv);
  const [action = 'render'] = parsed.positional;
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
  const constitutionAbsolutePath = resolveConstitutionPath(cwd, parsed.options.out);

  if (action === 'render') {
    return renderConstitution(cwd, constitutionAbsolutePath);
  }

  if (action === 'verify') {
    return verifyConstitution(cwd, constitutionAbsolutePath);
  }

  throw new CliError('ATM_CLI_USAGE', `constitution does not support action ${action}`, {
    exitCode: 2,
    details: {
      supportedActions: ['render', 'verify']
    }
  });
}

function renderConstitution(cwd: string, constitutionAbsolutePath: string) {
  const sources = collectConstitutionSources(cwd);
  const generatedAt = new Date().toISOString();
  const markdown = createConstitutionMarkdown({
    generatedAt,
    sourceGuardsPath: sources.sourceGuardsPath,
    sourceGuardsSha256: sources.sourceGuardsSha256,
    sourceSchemaSha256s: sources.sourceSchemaSha256s,
    guardDocument: sources.guardDocument
  });
  mkdirSync(path.dirname(constitutionAbsolutePath), { recursive: true });
  writeFileSync(constitutionAbsolutePath, markdown, 'utf8');

  return makeResult({
    ok: true,
    command: 'constitution',
    cwd,
    messages: [message('info', 'ATM_CONSTITUTION_RENDERED', 'Constitution markdown rendered from current ATM guard sources.')],
    evidence: {
      action: 'render',
      constitutionPath: relativePathFrom(cwd, constitutionAbsolutePath),
      sourceGuardsPath: sources.sourceGuardsPath,
      sourceGuardsSha256: sources.sourceGuardsSha256,
      sourceSchemaSha256s: sources.sourceSchemaSha256s,
      guardCount: sources.guardDocument.guards.length,
      constitutionSha256: computeSha256ForContent(markdown)
    }
  });
}

function verifyConstitution(cwd: string, constitutionAbsolutePath: string) {
  if (!existsSync(constitutionAbsolutePath)) {
    throw new CliError('ATM_CONSTITUTION_MISSING', 'Constitution markdown was not found. Run `node atm.mjs constitution render` first.', {
      exitCode: 2,
      details: {
        constitutionPath: relativePathFrom(cwd, constitutionAbsolutePath)
      }
    });
  }

  const sources = collectConstitutionSources(cwd);
  const recorded = readConstitutionFrontmatter(constitutionAbsolutePath);
  const schemaDrift = collectSchemaDrift(recorded.source_schema_sha256s, sources.sourceSchemaSha256s);
  const guardsDrifted = recorded.source_guards_sha256 !== sources.sourceGuardsSha256;

  if (guardsDrifted || schemaDrift.length > 0) {
    throw new CliError('ATM_CONSTITUTION_STALE', 'Constitution markdown is stale. Re-run `node atm.mjs constitution render`.', {
      exitCode: 2,
      details: {
        constitutionPath: relativePathFrom(cwd, constitutionAbsolutePath),
        sourceGuardsPath: sources.sourceGuardsPath,
        recordedSourceGuardsSha256: recorded.source_guards_sha256,
        currentSourceGuardsSha256: sources.sourceGuardsSha256,
        schemaDrift
      }
    });
  }

  return makeResult({
    ok: true,
    command: 'constitution',
    cwd,
    messages: [message('info', 'ATM_CONSTITUTION_VERIFY_OK', 'Constitution markdown matches the current ATM guard sources.')],
    evidence: {
      action: 'verify',
      constitutionPath: relativePathFrom(cwd, constitutionAbsolutePath),
      sourceGuardsPath: sources.sourceGuardsPath,
      sourceGuardsSha256: sources.sourceGuardsSha256,
      sourceSchemaSha256s: sources.sourceSchemaSha256s,
      guardCount: sources.guardDocument.guards.length
    }
  });
}

function collectConstitutionSources(cwd: string) {
  const runtime = detectGovernanceRuntime(cwd);
  const sourceGuardsAbsolutePath = path.join(cwd, runtime.paths.defaultGuardsPath);
  if (!existsSync(sourceGuardsAbsolutePath)) {
    throw new CliError('ATM_CONSTITUTION_GUARDS_MISSING', 'Default guards were not found. Run `node atm.mjs bootstrap` or `node atm.mjs init --adopt default` first.', {
      exitCode: 2,
      details: {
        sourceGuardsPath: runtime.paths.defaultGuardsPath
      }
    });
  }

  const sourceSchemaSha256s = Object.fromEntries(Object.entries(constitutionSourceSchemas).map(([schemaId, relativeSchemaPath]) => {
    const absoluteSchemaPath = path.join(frameworkRoot, relativeSchemaPath);
    if (!existsSync(absoluteSchemaPath)) {
      throw new CliError('ATM_CONSTITUTION_SCHEMA_SOURCE_MISSING', `Schema source was not found for ${schemaId}.`, {
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

function createConstitutionMarkdown(input: {
  readonly generatedAt: string;
  readonly sourceGuardsPath: string;
  readonly sourceGuardsSha256: string;
  readonly sourceSchemaSha256s: Record<string, string>;
  readonly guardDocument: DefaultGuardsDocument;
}) {
  const guardLines = input.guardDocument.guards
    .map((guard) => `- \`${guard.id}\`: ${guard.summary}`)
    .join('\n');
  const schemaLines = Object.entries(constitutionSourceSchemas)
    .map(([schemaId, relativeSchemaPath]) => `- \`${schemaId}\` -> \`${normalizePath(relativeSchemaPath)}\` (${input.sourceSchemaSha256s[schemaId]})`)
    .join('\n');

  return [
    '---',
    `generated_at: ${input.generatedAt}`,
    `source_guards_path: ${input.sourceGuardsPath}`,
    `source_guards_sha256: ${input.sourceGuardsSha256}`,
    `source_schema_sha256s: ${JSON.stringify(input.sourceSchemaSha256s)}`,
    '---',
    '# ATM Constitution',
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
    throw new CliError('ATM_CONSTITUTION_GUARDS_INVALID', 'Default guards file is missing the guards array.', {
      exitCode: 2,
      details: {
        sourceGuardsPath: normalizePath(filePath)
      }
    });
  }
  return parsed as DefaultGuardsDocument;
}

function readConstitutionFrontmatter(filePath: string): ConstitutionFrontmatter {
  const content = readFileSync(filePath, 'utf8');
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new CliError('ATM_CONSTITUTION_FRONTMATTER_INVALID', 'Constitution markdown is missing its frontmatter block.', {
      exitCode: 2,
      details: {
        constitutionPath: normalizePath(filePath)
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
        throw new CliError('ATM_CONSTITUTION_FRONTMATTER_INVALID', `Invalid constitution frontmatter line: ${line}`, { exitCode: 2 });
      }
      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      return [key, parseFrontmatterValue(rawValue)];
    })) as Partial<ConstitutionFrontmatter>;

  if (typeof frontmatter.generated_at !== 'string' || typeof frontmatter.source_guards_path !== 'string' || typeof frontmatter.source_guards_sha256 !== 'string' || !frontmatter.source_schema_sha256s || typeof frontmatter.source_schema_sha256s !== 'object') {
    throw new CliError('ATM_CONSTITUTION_FRONTMATTER_INVALID', 'Constitution frontmatter is missing one or more required fields.', {
      exitCode: 2,
      details: {
        constitutionPath: normalizePath(filePath)
      }
    });
  }

  return frontmatter as ConstitutionFrontmatter;
}

function parseFrontmatterValue(rawValue: string) {
  if (rawValue.startsWith('{') || rawValue.startsWith('[')) {
    return JSON.parse(rawValue);
  }
  return rawValue;
}

function collectSchemaDrift(recorded: Record<string, string>, current: Record<string, string>) {
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

function resolveConstitutionPath(cwd: string, outOption: unknown) {
  if (typeof outOption !== 'string' || outOption.trim().length === 0) {
    return path.join(cwd, defaultConstitutionRelativePath);
  }
  return path.isAbsolute(outOption)
    ? path.resolve(outOption)
    : path.join(cwd, outOption);
}

function normalizePath(filePath: string) {
  return filePath.replace(/\\/g, '/');
}

export function loadConstitutionSummary(cwd: string, outOption?: unknown): ConstitutionSummary {
  const constitutionAbsolutePath = resolveConstitutionPath(cwd, outOption);
  if (!existsSync(constitutionAbsolutePath)) {
    throw new CliError('ATM_CONSTITUTION_MISSING', 'Constitution markdown was not found. Run `node atm.mjs constitution render` first.', {
      exitCode: 2,
      details: {
        constitutionPath: relativePathFrom(cwd, constitutionAbsolutePath)
      }
    });
  }

  const content = readFileSync(constitutionAbsolutePath, 'utf8');
  const frontmatter = readConstitutionFrontmatter(constitutionAbsolutePath);
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  return {
    constitutionPath: relativePathFrom(cwd, constitutionAbsolutePath),
    frontmatter,
    body,
    guardSummary: extractGuardSummary(body)
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