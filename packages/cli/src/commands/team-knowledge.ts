import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, parseArgsForCommand, readJsonFile } from './shared.ts';
import { defineCommandSpec } from './shared.ts';

type KnowledgeMetadata = {
  repo?: string;
  channel?: string;
  domain?: string;
  paths: string[];
  atoms: string[];
  validators: string[];
};

type KnowledgeIndexEntry = {
  id: string;
  path: string;
  title: string;
  metadata: KnowledgeMetadata;
  searchText: string;
  bodySha256?: string;
};

type KnowledgeIndex = {
  schemaId: 'atm.teamKnowledgeIndex.v1';
  generatedAt: string;
  scope: string;
  advisoryOnly: true;
  canonicalRoot: string;
  entries: KnowledgeIndexEntry[];
};

const teamKnowledgeSpec = defineCommandSpec({
  name: 'team knowledge',
  summary: 'Build or query the advisory Team Agents knowledge index.',
  positional: [
    { name: 'action', summary: 'Knowledge action. Supports: build, query.' }
  ],
  options: [
    { flag: '--cwd', value: 'path', summary: 'Repository root.' },
    { flag: '--scope', value: 'name', summary: 'Build scope. Currently project.' },
    { flag: '--dry-run', summary: 'Report planned build outputs without writing runtime cache files.' },
    { flag: '--write', summary: 'Write generated runtime cache files under .atm/runtime/knowledge.' },
    { flag: '--task', value: 'id', summary: 'Task id used to derive query text.' },
    { flag: '--query', value: 'text', summary: 'Literal query text.' },
    { flag: '--top', value: 'n', summary: 'Maximum query hits to return.' },
    { flag: '--repo', value: 'name', summary: 'Metadata filter.' },
    { flag: '--channel', value: 'name', summary: 'Metadata filter.' },
    { flag: '--domain', value: 'name', summary: 'Metadata filter.' },
    { flag: '--path', value: 'glob', summary: 'Metadata path filter.' },
    { flag: '--atom', value: 'id', summary: 'Metadata atom filter.' },
    { flag: '--validator', value: 'command', summary: 'Metadata validator filter.' },
    { flag: '--json', summary: 'Return JSON output.' },
    { flag: '--pretty', summary: 'Return pretty JSON output.' },
    { flag: '--help', summary: 'Show help.' }
  ]
});

export async function runTeamKnowledge(argv: string[], inheritedCwd?: string) {
  const parsed = parseArgsForCommand(teamKnowledgeSpec, argv);
  const action = String(parsed.positional[0] ?? 'build').toLowerCase();
  const cwd = path.resolve(String(parsed.options.cwd ?? inheritedCwd ?? process.cwd()));

  if (action === 'build') {
    return runKnowledgeBuild(parsed.options, cwd);
  }
  if (action === 'query') {
    return runKnowledgeQuery(parsed.options, cwd);
  }
  throw new CliError('ATM_CLI_USAGE', 'team knowledge supports: build, query', { exitCode: 2 });
}

function runKnowledgeBuild(options: Record<string, unknown>, cwd: string) {
  const scope = String(options.scope ?? 'project').trim() || 'project';
  if (scope !== 'project') {
    throw new CliError('ATM_TEAM_KNOWLEDGE_SCOPE_UNSUPPORTED', 'team knowledge build currently supports --scope project only.', {
      exitCode: 2,
      details: { scope }
    });
  }
  const dryRun = Boolean(options['dry-run']) || !Boolean(options.write);
  const index = buildKnowledgeIndex(cwd, scope);
  const outputs = resolveKnowledgeOutputs(cwd);

  if (!dryRun) {
    mkdirSync(path.dirname(outputs.indexPath), { recursive: true });
    writeFileSync(outputs.indexPath, `${JSON.stringify(index, null, 2)}\n`, 'utf8');
    writeFileSync(outputs.manifestPath, `${JSON.stringify(buildManifest(index, outputs), null, 2)}\n`, 'utf8');
  }

  return makeResult({
    ok: true,
    command: 'team',
    cwd,
    messages: [
      message('info', dryRun ? 'ATM_TEAM_KNOWLEDGE_BUILD_DRY_RUN' : 'ATM_TEAM_KNOWLEDGE_BUILD_WRITTEN', dryRun
        ? 'Team knowledge build dry-run completed. No runtime cache files were written.'
        : 'Team knowledge runtime cache files were written.', {
        shardCount: index.entries.length,
        scope
      })
    ],
    evidence: {
      action: 'knowledge.build',
      advisoryOnly: true,
      dryRun,
      scope,
      canonicalRoot: outputs.canonicalRootRelative,
      plannedOutputs: {
        manifest: outputs.manifestRelative,
        lexicalIndex: outputs.indexRelative
      },
      shardCount: index.entries.length,
      shards: index.entries.map((entry) => ({
        id: entry.id,
        path: entry.path,
        title: entry.title,
        metadata: entry.metadata
      }))
    }
  });
}

function runKnowledgeQuery(options: Record<string, unknown>, cwd: string) {
  const outputs = resolveKnowledgeOutputs(cwd);
  const top = parsePositiveInteger(options.top, 5, 20);
  const query = deriveQueryText(cwd, options);
  const filters = buildFilters(options);

  if (!existsSync(outputs.indexPath)) {
    return makeResult({
      ok: true,
      command: 'team',
      cwd,
      messages: [
        message('warn', 'ATM_TEAM_KNOWLEDGE_INDEX_MISSING', 'Team knowledge index is missing. Run the advisory build command before query ranking.', {
          buildCommand: 'node atm.mjs team knowledge build --scope project --dry-run --json'
        })
      ],
      evidence: {
        action: 'knowledge.query',
        advisoryOnly: true,
        indexStatus: 'missing',
        buildCommand: 'node atm.mjs team knowledge build --scope project --dry-run --json',
        query,
        filters,
        top,
        hits: []
      }
    });
  }

  const index = readJsonFile(outputs.indexPath) as KnowledgeIndex | null;
  if (!index || !Array.isArray(index.entries)) {
    throw new CliError('ATM_TEAM_KNOWLEDGE_INDEX_INVALID', 'Team knowledge index is malformed; rebuild the runtime cache.', {
      details: { indexPath: outputs.indexRelative }
    });
  }
  const hits = rankKnowledgeHits(index.entries, query, filters, top, cwd);
  return makeResult({
    ok: true,
    command: 'team',
    cwd,
    messages: [
      message('info', 'ATM_TEAM_KNOWLEDGE_QUERY_READY', 'Team knowledge query completed with advisory-only ranked hits.', {
        hitCount: hits.length,
        top
      })
    ],
    evidence: {
      action: 'knowledge.query',
      advisoryOnly: true,
      indexStatus: 'ready',
      query,
      filters,
      top,
      hits
    }
  });
}

function buildKnowledgeIndex(cwd: string, scope: string): KnowledgeIndex {
  const root = path.join(cwd, '.atm', 'knowledge');
  const files = existsSync(root) ? walkFiles(root).filter((file) => /\.(md|json)$/i.test(file)) : [];
  const entries = files.map((file) => buildIndexEntry(cwd, file));
  return {
    schemaId: 'atm.teamKnowledgeIndex.v1',
    generatedAt: new Date().toISOString(),
    scope,
    advisoryOnly: true,
    canonicalRoot: '.atm/knowledge',
    entries
  };
}

function buildIndexEntry(cwd: string, file: string): KnowledgeIndexEntry {
  const relativePath = normalizePath(path.relative(cwd, file));
  const body = readFileSync(file, 'utf8');
  const parsed = extractMetadata(body, relativePath);
  return {
    id: relativePath,
    path: relativePath,
    title: parsed.title,
    metadata: parsed.metadata,
    searchText: normalizeWhitespace(`${parsed.title} ${relativePath} ${JSON.stringify(parsed.metadata)} ${stripMarkdown(body)}`).slice(0, 12000)
  };
}

function extractMetadata(body: string, relativePath: string): { title: string; metadata: KnowledgeMetadata } {
  const title = body.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(relativePath);
  const metadata: KnowledgeMetadata = {
    repo: extractField(body, ['repo', 'repository']),
    channel: extractField(body, ['channel']),
    domain: extractField(body, ['domain']),
    paths: extractListField(body, ['paths', 'path']),
    atoms: extractListField(body, ['atoms', 'atom']),
    validators: extractListField(body, ['validators', 'validator'])
  };
  return { title, metadata };
}

function extractField(body: string, names: string[]): string | undefined {
  for (const name of names) {
    const match = body.match(new RegExp(`^\\s*${name}\\s*[:=]\\s*(.+)$`, 'im'));
    if (match?.[1]) {
      return cleanScalar(match[1]);
    }
  }
  return undefined;
}

function extractListField(body: string, names: string[]): string[] {
  const raw = extractField(body, names);
  if (!raw) {
    return [];
  }
  return raw.split(/[,;]/).map(cleanScalar).filter(Boolean);
}

function cleanScalar(value: string): string {
  return value.trim().replace(/^["'\[]+|["'\]]+$/g, '').trim();
}

function buildFilters(options: Record<string, unknown>) {
  return {
    repo: stringOption(options.repo),
    channel: stringOption(options.channel),
    domain: stringOption(options.domain),
    path: stringOption(options.path),
    atom: stringOption(options.atom),
    validator: stringOption(options.validator)
  };
}

function rankKnowledgeHits(
  entries: KnowledgeIndexEntry[],
  query: string,
  filters: ReturnType<typeof buildFilters>,
  top: number,
  cwd: string
) {
  const tokens = tokenize(query);
  return entries
    .filter((entry) => metadataMatches(entry.metadata, filters))
    .map((entry) => ({ entry, score: scoreEntry(entry, tokens, query) }))
    .filter((hit) => hit.score > 0 || tokens.length === 0)
    .sort((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path))
    .slice(0, top)
    .map((hit) => ({
      path: hit.entry.path,
      title: hit.entry.title,
      score: hit.score,
      metadata: hit.entry.metadata,
      snippet: readSnippet(path.join(cwd, hit.entry.path), tokens)
    }));
}

function metadataMatches(metadata: KnowledgeMetadata, filters: ReturnType<typeof buildFilters>): boolean {
  if (filters.repo && metadata.repo !== filters.repo) return false;
  if (filters.channel && metadata.channel !== filters.channel) return false;
  if (filters.domain && metadata.domain !== filters.domain) return false;
  if (filters.path && !metadata.paths.some((entry) => entry.includes(filters.path as string))) return false;
  if (filters.atom && !metadata.atoms.includes(filters.atom)) return false;
  if (filters.validator && !metadata.validators.some((entry) => entry.includes(filters.validator as string))) return false;
  return true;
}

function scoreEntry(entry: KnowledgeIndexEntry, tokens: string[], query: string): number {
  const text = entry.searchText.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (entry.path.toLowerCase().includes(token)) score += 5;
    if (entry.title.toLowerCase().includes(token)) score += 4;
    if (text.includes(token)) score += 1;
  }
  if (query && text.includes(query.toLowerCase())) {
    score += 10;
  }
  return score;
}

function deriveQueryText(cwd: string, options: Record<string, unknown>): string {
  const explicit = stringOption(options.query);
  if (explicit) {
    return explicit;
  }
  const taskId = stringOption(options.task);
  if (!taskId) {
    throw new CliError('ATM_TEAM_KNOWLEDGE_QUERY_REQUIRED', 'team knowledge query requires --query <text> or --task <id>.', { exitCode: 2 });
  }
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  const task = existsSync(taskPath) ? readJsonFile(taskPath) as Record<string, unknown> : null;
  if (!task) {
    return taskId;
  }
  return normalizeWhitespace([
    taskId,
    task.title,
    task.summary,
    task.acceptance,
    task.scopePaths,
    task.deliverables,
    task.validators
  ].map((value) => Array.isArray(value) ? value.join(' ') : String(value ?? '')).join(' '));
}

function parsePositiveInteger(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(parsed, max);
}

function stringOption(value: unknown): string | undefined {
  const text = String(value ?? '').trim();
  return text || undefined;
}

function resolveKnowledgeOutputs(cwd: string) {
  const canonicalRoot = path.join(cwd, '.atm', 'knowledge');
  const runtimeRoot = path.join(cwd, '.atm', 'runtime', 'knowledge');
  const manifestPath = path.join(runtimeRoot, 'team-knowledge-manifest.json');
  const indexPath = path.join(runtimeRoot, 'team-knowledge-index.json');
  return {
    canonicalRoot,
    canonicalRootRelative: '.atm/knowledge',
    runtimeRoot,
    manifestPath,
    indexPath,
    manifestRelative: '.atm/runtime/knowledge/team-knowledge-manifest.json',
    indexRelative: '.atm/runtime/knowledge/team-knowledge-index.json'
  };
}

function buildManifest(index: KnowledgeIndex, outputs: ReturnType<typeof resolveKnowledgeOutputs>) {
  return {
    schemaId: 'atm.teamKnowledgeManifest.v1',
    advisoryOnly: true,
    generatedAt: index.generatedAt,
    shardCount: index.entries.length,
    canonicalRoot: outputs.canonicalRootRelative,
    lexicalIndex: outputs.indexRelative
  };
}

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function tokenize(value: string): string[] {
  return Array.from(new Set(value.toLowerCase().split(/[^a-z0-9_.-]+/).map((entry) => entry.trim()).filter((entry) => entry.length >= 2)));
}

function readSnippet(filePath: string, tokens: string[]): string {
  if (!existsSync(filePath)) {
    return '';
  }
  const body = normalizeWhitespace(stripMarkdown(readFileSync(filePath, 'utf8')));
  if (tokens.length === 0) {
    return body.slice(0, 180);
  }
  const lower = body.toLowerCase();
  const first = tokens.map((token) => lower.indexOf(token)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? 0;
  return body.slice(Math.max(0, first - 60), first + 180).trim();
}

function stripMarkdown(value: string): string {
  return value.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`[\]()]/g, ' ');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
