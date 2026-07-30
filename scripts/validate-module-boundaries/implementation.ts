import crypto from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  evaluateModuleBoundaries,
  normalizePath,
  type ModuleBoundaryDependencyEdge,
  type ModuleBoundaryDependencyGraph,
  type ModuleBoundaryPolicy,
  type ModuleBoundaryValidationReceipt
} from '../../packages/core/src/architecture/index.ts';

const IMPORT_PATTERNS = [
  /(from\s+['"])([^'"]+)(['"])/g,
  /(import\s+['"])([^'"]+)(['"])/g,
  /(import\(\s*['"])([^'"]+)(['"]\s*\))/g
];

export function scanTypeScriptDependencyGraph(input: {
  readonly root: string;
  readonly policy: ModuleBoundaryPolicy;
  readonly adapterId?: string;
}): ModuleBoundaryDependencyGraph {
  const adapterId = input.adapterId ?? 'typescript-static-imports';
  const adapter = input.policy.sourceDiscovery.find((entry) => entry.adapterId === adapterId);
  if (!adapter) {
    return {
      schemaId: 'atm.moduleBoundaryDependencyGraph.v1',
      specVersion: '0.1.0',
      adapterId,
      language: 'unsupported',
      sourceRoot: normalizePath(input.root),
      edges: []
    };
  }
  const rootAbs = path.resolve(input.root);
  const files = adapter.roots.flatMap((sourceRoot) => walk(path.join(rootAbs, sourceRoot), adapter.extensions));
  const edges: ModuleBoundaryDependencyEdge[] = [];
  for (const file of files) {
    const from = normalizePath(path.relative(rootAbs, file));
    const content = readFileSync(file, 'utf8');
    for (const specifier of extractSpecifiers(content)) {
      const resolved = resolveTypeScriptSpecifier(rootAbs, file, specifier, adapter.extensions);
      if (!resolved) continue;
      edges.push({
        from,
        to: normalizePath(path.relative(rootAbs, resolved)),
        specifier,
        kind: specifier.includes('export') ? 're-export' : 'static-import',
        adapterId
      });
    }
  }
  return {
    schemaId: 'atm.moduleBoundaryDependencyGraph.v1',
    specVersion: '0.1.0',
    adapterId,
    language: adapter.language,
    sourceRoot: normalizePath(input.root),
    edges
  };
}

export function validateModuleBoundaryPolicy(input: {
  readonly root: string;
  readonly policyPath: string;
  readonly adapterId?: string;
  readonly today?: string;
}): ModuleBoundaryValidationReceipt {
  const policy = JSON.parse(readFileSync(path.resolve(input.root, input.policyPath), 'utf8')) as ModuleBoundaryPolicy;
  const graph = scanTypeScriptDependencyGraph({ root: input.root, policy, adapterId: input.adapterId });
  return evaluateModuleBoundaries({
    policy,
    graph,
    today: input.today,
    sourceDigest: digestFiles(input.root, graph.edges.flatMap((edge) => [edge.from, edge.to])),
    configDigest: digestFile(path.resolve(input.root, input.policyPath)),
    candidateDigest: digestJson({ policy, graph })
  });
}

function walk(directory: string, extensions: readonly string[], output: string[] = []): string[] {
  if (!existsSync(directory)) return output;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(fullPath, extensions, output);
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      output.push(fullPath);
    }
  }
  return output;
}

function extractSpecifiers(content: string): string[] {
  const specifiers: string[] = [];
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) specifiers.push(match[2]);
  }
  return specifiers;
}

function resolveTypeScriptSpecifier(
  rootAbs: string,
  fromFile: string,
  specifier: string,
  extensions: readonly string[]
): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [
    base,
    ...extensions.map((extension) => `${base}${extension}`),
    ...extensions.map((extension) => path.join(base, `index${extension}`))
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
  if (!resolved) return null;
  const relative = path.relative(rootAbs, resolved);
  return relative.startsWith('..') ? null : resolved;
}

function digestFile(filePath: string): string {
  return `sha256:${crypto.createHash('sha256').update(readFileSync(filePath)).digest('hex')}`;
}

function digestFiles(root: string, files: readonly string[]): string {
  const hash = crypto.createHash('sha256');
  for (const file of [...new Set(files)].sort()) {
    const fullPath = path.resolve(root, file);
    if (!existsSync(fullPath)) continue;
    hash.update(file);
    hash.update(readFileSync(fullPath));
  }
  return `sha256:${hash.digest('hex')}`;
}

function digestJson(value: unknown): string {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
