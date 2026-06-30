import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { atmReadableRefContractVersion } from './atom-runtime.ts';

export interface AtomRefSweepOptions {
  readonly repos: readonly string[];
  readonly apply: boolean;
  readonly generatedAt?: string;
}

interface InspectRepoOptions {
  readonly allowPlannedRewrites: boolean;
}

export interface AtomRefSweepResult {
  readonly schemaId: 'atm.atomRefSweep';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly apply: boolean;
  readonly repos: readonly RepoReadabilityReport[];
}

export interface RepoReadabilityReport {
  readonly repoPath: string;
  readonly ok: boolean;
  readonly registryPath: string | null;
  readonly atomCount: number;
  readonly mapCount: number;
  readonly memberAtomCount: number;
  readonly callsiteCount: number;
  readonly violationCount: number;
  readonly generatedRefPaths: readonly string[];
  readonly reportPaths: readonly string[];
  readonly violations: readonly AtomCallsiteViolation[];
  readonly rewrittenCallsites: readonly AtomCallsiteRewrite[];
  readonly skipped: readonly string[];
}

interface AtomCatalogEntry {
  readonly kind: 'atom' | 'map';
  readonly id: string;
  readonly refName: string;
  readonly logicalName: string;
  readonly purpose: string;
  readonly sourcePaths: readonly string[];
  readonly members: readonly string[];
  readonly entrypoints: readonly string[];
}

interface RegistryLocationRecord {
  readonly codePaths?: unknown;
  readonly specPath?: unknown;
  readonly reportPath?: unknown;
}

interface RegistrySelfVerificationRecord {
  readonly sourcePaths?: {
    readonly code?: unknown;
  };
}

interface RegistryEntryRecord {
  readonly atomId?: unknown;
  readonly mapId?: unknown;
  readonly logicalName?: unknown;
  readonly purpose?: unknown;
  readonly location?: RegistryLocationRecord;
  readonly selfVerification?: RegistrySelfVerificationRecord;
}

interface RegistryDocumentRecord {
  readonly entries?: unknown;
}

interface MapSpecMemberRecord {
  readonly atomId?: unknown;
}

interface MapSpecQualityTargetsRecord {
  readonly pilotName?: unknown;
  readonly equivalenceFixtures?: unknown;
}

interface MapSpecReplacementRecord {
  readonly legacyUris?: unknown;
}

interface MapSpecRecord {
  readonly description?: unknown;
  readonly logicalName?: unknown;
  readonly members?: unknown;
  readonly entrypoints?: unknown;
  readonly qualityTargets?: MapSpecQualityTargetsRecord;
  readonly replacement?: MapSpecReplacementRecord;
}

interface AtomCallsite {
  readonly file: string;
  readonly line: number;
  readonly callee: 'runAtm' | 'runAtmMap';
  readonly firstArgument: string;
}

export interface AtomCallsiteViolation extends AtomCallsite {
  readonly code: string;
  readonly detail: string;
}

export interface AtomCallsiteRewrite extends AtomCallsite {
  readonly from: string;
  readonly to: string;
}

function asRecord<T extends object>(value: unknown): T | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as T
    : null;
}

const atomIdPattern = /^ATM-[A-Z0-9]+-\d{4}$/;
const atomIdLikePattern = /ATM-[A-Z0-9]+-\d{4}/;
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py']);
const ignoredDirectoryNames = new Set([
  '.git',
  '.atm',
  '.atm-temp',
  'node_modules',
  'library',
  'Library',
  'temp',
  'Temp',
  'dist',
  'build',
  'release'
]);

export function sweepAtomRefReadability(options: AtomRefSweepOptions): AtomRefSweepResult {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const repos = options.repos.length > 0 ? options.repos : [process.cwd()];
  return {
    schemaId: 'atm.atomRefSweep',
    specVersion: '0.1.0',
    generatedAt,
    apply: options.apply,
    repos: repos.map((repoPath) => inspectRepo(path.resolve(repoPath), options.apply, generatedAt, {
      allowPlannedRewrites: true
    }))
  };
}

export function validateAtomRefReadability(repoPath: string): RepoReadabilityReport {
  return inspectRepo(path.resolve(repoPath), false, new Date().toISOString(), {
    allowPlannedRewrites: false
  });
}

function inspectRepo(repoPath: string, apply: boolean, generatedAt: string, options: InspectRepoOptions): RepoReadabilityReport {
  const registryPath = path.join(repoPath, 'atomic-registry.json');
  if (!existsSync(registryPath)) {
    return {
      repoPath,
      ok: false,
      registryPath: null,
      atomCount: 0,
      mapCount: 0,
      memberAtomCount: 0,
      callsiteCount: 0,
      violationCount: 1,
      generatedRefPaths: [],
      reportPaths: [],
      violations: [{
        file: 'atomic-registry.json',
        line: 1,
        callee: 'runAtm',
        firstArgument: '',
        code: 'registry-missing',
        detail: 'atomic-registry.json is required before readable refs can be generated.'
      }],
      rewrittenCallsites: [],
      skipped: ['registry-missing']
    };
  }

  const registry = asRecord<RegistryDocumentRecord>(readJson(registryPath));
  const catalog = buildCatalog(repoPath, registry);
  const callsites = scanCallsites(repoPath);
  const generatedRefNames = new Set(catalog.map((entry) => entry.refName));
  const existingRefNames = collectDefinedReadableRefs(repoPath);
  const knownRefNames = new Set([...generatedRefNames, ...existingRefNames]);
  const rewrites = planCallsiteRewrites(callsites, catalog);
  const violations = evaluateCallsites(callsites, knownRefNames, options.allowPlannedRewrites ? rewrites : []);
  const generatedRefPaths = generatedPathsForRepo(repoPath);
  const reportPaths = [
    'atomic_workbench/reports/atom-callsite-inventory.json',
    'atomic_workbench/reports/atom-ref-migration-report.json',
    'atomic_workbench/reports/atom-callsite-readability.report.json',
    'atomic_workbench/reports/atom-ref-rollback-instructions.md'
  ];

  if (apply) {
    writeGeneratedRefs(repoPath, catalog);
    applyCallsiteRewrites(repoPath, rewrites);
    writeReports(repoPath, generatedAt, catalog, callsites, violations, rewrites, generatedRefPaths, reportPaths);
  }

  const atomCount = catalog.filter((entry) => entry.kind === 'atom' && atomIdPattern.test(entry.id)).length;
  const mapCount = catalog.filter((entry) => entry.kind === 'map').length;
  const registryAtomIds = new Set(
    (Array.isArray(registry?.entries) ? registry.entries : [])
      .map((entry) => String(asRecord<RegistryEntryRecord>(entry)?.atomId ?? ''))
      .filter(Boolean)
  );
  const memberAtomCount = catalog.filter((entry) => entry.kind === 'atom' && !registryAtomIds.has(entry.id)).length;

  return {
    repoPath,
    ok: violations.length === 0,
    registryPath: 'atomic-registry.json',
    atomCount,
    mapCount,
    memberAtomCount,
    callsiteCount: callsites.length,
    violationCount: violations.length,
    generatedRefPaths,
    reportPaths: apply ? reportPaths : [],
    violations,
    rewrittenCallsites: rewrites,
    skipped: []
  };
}

function buildCatalog(repoPath: string, registry: unknown): AtomCatalogEntry[] {
  const entries: AtomCatalogEntry[] = [];
  const registryAtomIds = new Set<string>();
  const registryRecord = asRecord<RegistryDocumentRecord>(registry);
  const registryEntries = Array.isArray(registryRecord?.entries)
    ? registryRecord.entries
    : [];
  for (const rawEntry of registryEntries) {
    const entry = asRecord<RegistryEntryRecord>(rawEntry);
    const atomId = typeof entry?.atomId === 'string' ? entry.atomId : null;
    if (atomId) {
      registryAtomIds.add(atomId);
      entries.push({
        kind: 'atom',
        id: atomId,
        refName: ensureUniqueRefName(curatedRefName(repoPath, atomId, 'atom') ?? deriveRefName(String(entry?.logicalName ?? entry?.purpose ?? atomId), 'atom'), entries),
        logicalName: normalizeLogicalName(entry?.logicalName, atomId, 'atom'),
        purpose: normalizePurpose(entry?.purpose, atomId, entry?.location?.codePaths, 'atom'),
        sourcePaths: normalizeSourcePaths(entry?.location?.codePaths ?? entry?.selfVerification?.sourcePaths?.code ?? []),
        members: [],
        entrypoints: []
      });
      continue;
    }

    const mapId = typeof entry?.mapId === 'string' ? entry.mapId : null;
    if (mapId) {
      const mapSpec = readMapSpec(repoPath, mapId, entry?.location?.specPath);
      entries.push(mapCatalogEntry(repoPath, mapId, entry, mapSpec, entries));
    }
  }

  for (const entry of [...entries]) {
    if (entry.kind !== 'map') {
      continue;
    }
    for (const member of entry.members) {
      if (registryAtomIds.has(member) || entries.some((candidate) => candidate.kind === 'atom' && candidate.id === member)) {
        continue;
      }
      entries.push({
        kind: 'atom',
        id: member,
        refName: ensureUniqueRefName(curatedRefName(repoPath, member, 'atom') ?? deriveRefName(`${entry.logicalName} ${memberRoleName(entry, member)}`, 'atom'), entries),
        logicalName: `${entry.logicalName}.${member.toLowerCase()}`,
        purpose: `Member atom for ${entry.logicalName}: ${memberRoleName(entry, member)}.`,
        sourcePaths: entry.sourcePaths,
        members: [],
        entrypoints: []
      });
    }
  }

  return entries.sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}

function mapCatalogEntry(
  repoPath: string,
  mapId: string,
  entry: RegistryEntryRecord | null,
  mapSpec: MapSpecRecord,
  existing: readonly AtomCatalogEntry[]
): AtomCatalogEntry {
  const logicalName = normalizeLogicalName(selectMapSemanticHint(entry, mapSpec), mapId, 'map');
  const sourcePaths = normalizeSourcePaths([
    entry?.location?.specPath,
    `atomic_workbench/maps/${mapId}/map.spec.json`,
    entry?.location?.reportPath,
    `atomic_workbench/maps/${mapId}/map.test.report.json`
  ]);
  return {
    kind: 'map',
    id: mapId,
    refName: ensureUniqueRefName(curatedRefName(repoPath, mapId, 'map') ?? deriveRefName(logicalName, 'map'), existing),
    logicalName,
    purpose: normalizePurpose(entry?.purpose ?? mapSpec.description ?? mapSpec.qualityTargets?.pilotName, mapId, sourcePaths, 'map'),
    sourcePaths,
    members: normalizeStringArray(
      Array.isArray(mapSpec.members)
        ? mapSpec.members.map((member) => asRecord<MapSpecMemberRecord>(member)?.atomId)
        : []
    ),
    entrypoints: normalizeStringArray(mapSpec.entrypoints)
  };
}

function readMapSpec(repoPath: string, mapId: string, configuredPath: unknown): MapSpecRecord {
  const candidates = [
    typeof configuredPath === 'string' ? configuredPath : '',
    `atomic_workbench/maps/${mapId}/map.spec.json`
  ].filter(Boolean);
  for (const candidate of candidates) {
    const absolutePath = path.resolve(repoPath, candidate);
    if (existsSync(absolutePath)) {
      return asRecord<MapSpecRecord>(readJson(absolutePath)) ?? {};
    }
  }
  return {};
}

function scanCallsites(repoPath: string): AtomCallsite[] {
  const files = walkSourceFiles(repoPath);
  const callsites: AtomCallsite[] = [];
  const callPattern = /\b(runAtmMap|runAtm)\s*\(\s*([^,\r\n)]+)/g;
  for (const file of files) {
    const text = readFileSync(path.join(repoPath, file), 'utf8');
    const localRunAtm = definesLocalFunction(text, 'runAtm');
    const localRunAtmMap = definesLocalFunction(text, 'runAtmMap');
    for (const match of text.matchAll(callPattern)) {
      const callee = match[1] as 'runAtm' | 'runAtmMap';
      if ((callee === 'runAtm' && localRunAtm) || (callee === 'runAtmMap' && localRunAtmMap)) {
        continue;
      }
      callsites.push({
        file,
        line: lineNumberAt(text, match.index ?? 0),
        callee,
        firstArgument: match[2].trim()
      });
    }
  }
  return callsites;
}

function definesLocalFunction(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`).test(text)
    || new RegExp(`\\bconst\\s+${escaped}\\s*=`).test(text)
    || new RegExp(`\\blet\\s+${escaped}\\s*=`).test(text)
    || new RegExp(`\\bvar\\s+${escaped}\\s*=`).test(text);
}

function collectDefinedReadableRefs(repoPath: string): Set<string> {
  const names = new Set<string>();
  const refPattern = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\(\s*)?defineAtm(?:Atom|Map)Ref\s*\(/g;
  for (const file of walkSourceFiles(repoPath)) {
    const text = readFileSync(path.join(repoPath, file), 'utf8');
    for (const match of text.matchAll(refPattern)) {
      names.add(match[1]);
    }
  }
  return names;
}

function planCallsiteRewrites(callsites: readonly AtomCallsite[], catalog: readonly AtomCatalogEntry[]): AtomCallsiteRewrite[] {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const rewrites: AtomCallsiteRewrite[] = [];
  for (const callsite of callsites) {
    const id = extractRawIdArgument(callsite.firstArgument);
    if (!id) {
      continue;
    }
    const target = byId.get(id);
    if (!target) {
      continue;
    }
    rewrites.push({
      ...callsite,
      from: callsite.firstArgument,
      to: target.refName
    });
  }
  return rewrites;
}

function evaluateCallsites(
  callsites: readonly AtomCallsite[],
  knownRefNames: ReadonlySet<string>,
  plannedRewrites: readonly AtomCallsiteRewrite[]
): AtomCallsiteViolation[] {
  const rewriteKeys = new Set(plannedRewrites.map((rewrite) => `${rewrite.file}:${rewrite.line}:${rewrite.firstArgument}`));
  const violations: AtomCallsiteViolation[] = [];
  for (const callsite of callsites) {
    if (rewriteKeys.has(`${callsite.file}:${callsite.line}:${callsite.firstArgument}`)) {
      continue;
    }
    const argument = callsite.firstArgument;
    const rawId = extractRawIdArgument(argument);
    if (rawId) {
      violations.push({ ...callsite, code: 'raw-id-callsite', detail: `Replace raw ${rawId} with a semantic readable ref.` });
      continue;
    }
    if (argument.startsWith('{')) {
      violations.push({ ...callsite, code: 'inline-ref-object', detail: 'Inline atom/map objects hide reusable intent; use a named readable ref.' });
      continue;
    }
    if (/^\d/.test(argument)) {
      violations.push({ ...callsite, code: 'numeric-ref', detail: 'Numeric atom/map references are not readable to maintainers.' });
      continue;
    }
    if (/^(atm|ATM|map|MAP)[A-Za-z0-9_$]*\d/.test(argument)) {
      violations.push({ ...callsite, code: 'id-like-ref-name', detail: 'Readable refs must use domain intent, not an ID-shaped variable name.' });
      continue;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(argument) && !knownRefNames.has(argument)) {
      violations.push({ ...callsite, code: 'unknown-readable-ref', detail: `Readable ref ${argument} is not defined by defineAtmAtomRef or defineAtmMapRef.` });
    }
  }
  return violations;
}

function applyCallsiteRewrites(repoPath: string, rewrites: readonly AtomCallsiteRewrite[]) {
  const byFile = new Map<string, AtomCallsiteRewrite[]>();
  for (const rewrite of rewrites) {
    byFile.set(rewrite.file, [...(byFile.get(rewrite.file) ?? []), rewrite]);
  }
  for (const [file, fileRewrites] of byFile) {
    const absolutePath = path.join(repoPath, file);
    let text = readFileSync(absolutePath, 'utf8');
    for (const rewrite of fileRewrites) {
      text = text.replace(rewrite.from, rewrite.to);
    }
    writeFileSync(absolutePath, text, 'utf8');
  }
}

function writeGeneratedRefs(repoPath: string, catalog: readonly AtomCatalogEntry[]) {
  const generatedPaths = generatedPathsForRepo(repoPath);
  if (isFrameworkRepo(repoPath)) {
    const targetPath = path.join(repoPath, generatedPaths[0]);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, renderFrameworkGeneratedRefs(catalog), 'utf8');
    return;
  }

  const atomPath = path.join(repoPath, generatedPaths[0]);
  const mapPath = path.join(repoPath, generatedPaths[1]);
  mkdirSync(path.dirname(atomPath), { recursive: true });
  writeFileSync(atomPath, renderAdopterAtomRefs(catalog.filter((entry) => entry.kind === 'atom')), 'utf8');
  writeFileSync(mapPath, renderAdopterMapRefs(catalog.filter((entry) => entry.kind === 'map')), 'utf8');
}

function writeReports(
  repoPath: string,
  generatedAt: string,
  catalog: readonly AtomCatalogEntry[],
  callsites: readonly AtomCallsite[],
  violations: readonly AtomCallsiteViolation[],
  rewrites: readonly AtomCallsiteRewrite[],
  generatedRefPaths: readonly string[],
  reportPaths: readonly string[]
) {
  const reportDir = path.join(repoPath, 'atomic_workbench', 'reports');
  mkdirSync(reportDir, { recursive: true });
  writeJson(path.join(repoPath, reportPaths[0]), {
    schemaId: 'atm.atomCallsiteInventory',
    specVersion: '0.1.0',
    generatedAt,
    catalog,
    callsites
  });
  writeJson(path.join(repoPath, reportPaths[1]), {
    schemaId: 'atm.atomRefMigrationReport',
    specVersion: '0.1.0',
    generatedAt,
    generatedRefPaths,
    rewrittenCallsites: rewrites,
    skippedCallsites: callsites.filter((callsite) => !rewrites.some((rewrite) => rewrite.file === callsite.file && rewrite.line === callsite.line))
  });
  writeJson(path.join(repoPath, reportPaths[2]), {
    schemaId: 'atm.atomCallsiteReadabilityReport',
    specVersion: '0.1.0',
    generatedAt,
    ok: violations.length === 0,
    violationCount: violations.length,
    violations
  });
  writeFileSync(path.join(repoPath, reportPaths[3]), [
    '# Atom Ref Rollback Instructions',
    '',
    'This sweep only generated readable ref files, callsite replacements, and reports.',
    '',
    'Rollback by removing generated files listed in atom-ref-migration-report.json and reverting rewritten callsites listed in rewrittenCallsites.',
    'Do not edit .atm runtime state manually.'
  ].join('\n') + '\n', 'utf8');
}

function renderFrameworkGeneratedRefs(catalog: readonly AtomCatalogEntry[]): string {
  const sourceExtension = 't' + 's';
  return [
    `import { defineAtmAtomRef, defineAtmMapRef } from './atom-runtime.${sourceExtension}';`,
    '',
    '// Generated by `atm atom-ref sweep`; edit registry/workbench metadata, then regenerate.',
    ...catalog.map(renderFrameworkRef),
    ''
  ].join('\n');
}

function renderFrameworkRef(entry: AtomCatalogEntry): string {
  const defineName = entry.kind === 'atom' ? 'defineAtmAtomRef' : 'defineAtmMapRef';
  const idField = entry.kind === 'atom' ? 'atomId' : 'mapId';
  return [
    '',
    `export const ${entry.refName} = ${defineName}({`,
    `  ${idField}: '${entry.id}',`,
    `  logicalName: '${escapeSingle(entry.logicalName)}',`,
    `  purpose: '${escapeSingle(entry.purpose)}',`,
    `  sourcePaths: ${renderStringArray(entry.sourcePaths)},`,
    ...(entry.kind === 'map' ? [
      `  members: ${renderStringArray(entry.members)},`,
      `  entrypoints: ${renderStringArray(entry.entrypoints)}`
    ] : []),
    '});'
  ].join('\n');
}

function renderAdopterAtomRefs(atoms: readonly AtomCatalogEntry[]): string {
  return [
    `export const atmReadableRefContractVersion = '${atmReadableRefContractVersion}';`,
    '',
    'export function defineAtmAtomRef(ref) {',
    "  return Object.freeze({ ...ref, kind: 'atom', readabilityContractVersion: atmReadableRefContractVersion, sourcePaths: [...(ref.sourcePaths ?? [])] });",
    '}',
    '',
    '// Generated by `atm atom-ref sweep`; edit registry/workbench metadata, then regenerate.',
    ...atoms.map(renderAdopterAtomRef),
    ''
  ].join('\n');
}

function renderAdopterAtomRef(entry: AtomCatalogEntry): string {
  return [
    '',
    `export const ${entry.refName} = defineAtmAtomRef({`,
    `  atomId: '${entry.id}',`,
    `  logicalName: '${escapeSingle(entry.logicalName)}',`,
    `  purpose: '${escapeSingle(entry.purpose)}',`,
    `  sourcePaths: ${renderStringArray(entry.sourcePaths)}`,
    '});'
  ].join('\n');
}

function renderAdopterMapRefs(maps: readonly AtomCatalogEntry[]): string {
  return [
    `export const atmReadableRefContractVersion = '${atmReadableRefContractVersion}';`,
    '',
    'export function defineAtmMapRef(ref) {',
    "  return Object.freeze({ ...ref, kind: 'map', readabilityContractVersion: atmReadableRefContractVersion, sourcePaths: [...(ref.sourcePaths ?? [])], members: [...(ref.members ?? [])], entrypoints: [...(ref.entrypoints ?? [])] });",
    '}',
    '',
    '// Generated by `atm atom-ref sweep`; edit registry/workbench metadata, then regenerate.',
    ...maps.map(renderAdopterMapRef),
    ''
  ].join('\n');
}

function renderAdopterMapRef(entry: AtomCatalogEntry): string {
  return [
    '',
    `export const ${entry.refName} = defineAtmMapRef({`,
    `  mapId: '${entry.id}',`,
    `  logicalName: '${escapeSingle(entry.logicalName)}',`,
    `  purpose: '${escapeSingle(entry.purpose)}',`,
    `  sourcePaths: ${renderStringArray(entry.sourcePaths)},`,
    `  members: ${renderStringArray(entry.members)},`,
    `  entrypoints: ${renderStringArray(entry.entrypoints)}`,
    '});'
  ].join('\n');
}

function generatedPathsForRepo(repoPath: string): string[] {
  if (isFrameworkRepo(repoPath)) {
    return ['packages/core/src/registry/atom-runtime.generated.ts'];
  }
  return ['atomic_workbench/refs/atom-refs.ts', 'atomic_workbench/refs/map-refs.ts'];
}

function isFrameworkRepo(repoPath: string): boolean {
  return existsSync(path.join(repoPath, 'packages', 'core', 'src', 'registry'));
}

function walkSourceFiles(repoPath: string): string[] {
  const files: string[] = [];
  walk(repoPath, '');
  return files.sort();

  function walk(root: string, relativeDir: string) {
    const absoluteDir = path.join(root, relativeDir);
    for (const entry of safeReadDir(absoluteDir)) {
      if (ignoredDirectoryNames.has(entry)) {
        continue;
      }
      if (relativeDir === 'atomic_workbench' && (entry === 'reports' || entry === 'refs')) {
        continue;
      }
      const relativePath = path.join(relativeDir, entry);
      const absolutePath = path.join(root, relativePath);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        walk(root, relativePath);
        continue;
      }
      if (stats.isFile() && sourceExtensions.has(path.extname(entry))) {
        files.push(relativePath.replace(/\\/g, '/'));
      }
    }
  }
}

function safeReadDir(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

function extractRawIdArgument(argument: string): string | null {
  const stringMatch = argument.match(/^['"`](ATM-[A-Z0-9]+-\d{4})['"`]$/);
  if (stringMatch) {
    return stringMatch[1];
  }
  const objectMatch = argument.match(/(?:atomId|mapId)\s*:\s*['"`](ATM-[A-Z0-9]+-\d{4})['"`]/);
  if (objectMatch) {
    return objectMatch[1];
  }
  return null;
}

function curatedRefName(repoPath: string, id: string, kind: 'atom' | 'map'): string | null {
  const override = readableRefOverrides(repoPath)[id];
  if (typeof override === 'string' && override.trim().length > 0) {
    return override.trim();
  }
  const repoName = path.basename(repoPath).toLowerCase();
  const framework: Record<string, string> = {
    'ATM-CORE-0001': 'coreSeedAtom',
    'ATM-CORE-0003': 'protectedSurfaceNeutralityScannerAtom',
    'ATM-CORE-0004': 'atomProvisioningFacadeAtom',
    'ATM-CORE-0005': 'atomicSpecSemanticFingerprintAtom',
    'ATM-FIXTURE-0001': 'compliantGeneratedFixtureAtom',
    'ATM-MAP-0001': 'atomProvisioningFixtureMap',
    'ATM-MAP-0002': 'protectedSurfaceNeutralityMap'
  };
  if (repoName === 'ai-atomic-framework') {
    return framework[id] ?? null;
  }
  return kind === 'atom' ? null : null;
}

function readableRefOverrides(repoPath: string): Record<string, string> {
  const overridePath = path.join(repoPath, 'atomic_workbench', 'readable-ref-overrides.json');
  if (!existsSync(overridePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(overridePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

function selectMapSemanticHint(entry: unknown, mapSpec: unknown): unknown {
  const entryRecord = asRecord<RegistryEntryRecord>(entry);
  const mapSpecRecord = asRecord<MapSpecRecord>(mapSpec);
  return entryRecord?.logicalName
    ?? mapSpecRecord?.logicalName
    ?? mapSpecRecord?.qualityTargets?.pilotName
    ?? mapSpecRecord?.qualityTargets?.equivalenceFixtures
    ?? (Array.isArray(mapSpecRecord?.replacement?.legacyUris) ? mapSpecRecord.replacement.legacyUris[0] : undefined);
}

function deriveRefName(value: string, kind: 'atom' | 'map'): string {
  const tokens = (value.match(/[A-Za-z0-9]+/g) ?? [])
    .filter((token) => !/^ATM$/i.test(token) && !/^\d+$/.test(token))
    .slice(0, 6);
  const fallback = kind === 'atom' ? ['readable', 'atom'] : ['readable', 'map'];
  const usable = tokens.length > 0 ? tokens : fallback;
  const [first, ...rest] = usable.map((token) => token.toLowerCase());
  const base = [first, ...rest.map((token) => token.charAt(0).toUpperCase() + token.slice(1))].join('');
  const suffix = kind === 'atom' ? 'Atom' : 'Map';
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}

function ensureUniqueRefName(name: string, existing: readonly AtomCatalogEntry[]): string {
  const used = new Set(existing.map((entry) => entry.refName));
  if (!used.has(name)) {
    return name;
  }
  let counter = 2;
  while (used.has(`${name}${counter}`)) {
    counter += 1;
  }
  return `${name}${counter}`;
}

function normalizeLogicalName(value: unknown, id: string, kind: 'atom' | 'map'): string {
  if (typeof value === 'string' && value.trim().length > 0 && !atomIdPattern.test(value.trim())) {
    return value.trim();
  }
  return `${kind}.${id.toLowerCase()}`;
}

function normalizePurpose(value: unknown, id: string, sourcePaths: unknown, kind: 'atom' | 'map'): string {
  if (typeof value === 'string' && value.trim().length > 0 && !atomIdLikePattern.test(value.trim())) {
    return value.trim();
  }
  const paths = normalizeSourcePaths(sourcePaths);
  if (paths.length > 0) {
    return `Readable ${kind} ref for ${paths[0]}.`;
  }
  return `Readable ${kind} ref for ${id}.`;
}

function memberRoleName(mapEntry: AtomCatalogEntry, atomId: string): string {
  const index = mapEntry.members.indexOf(atomId);
  if (index === 0) {
    return 'entrypoint';
  }
  if (index === mapEntry.members.length - 1) {
    return 'final step';
  }
  return `step ${index + 1}`;
}

function normalizeSourcePaths(value: unknown): string[] {
  if (typeof value === 'string') {
    return value ? [value] : [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.flatMap((entry) => normalizeSourcePaths(entry)))].filter(Boolean).sort();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0))];
}

function renderStringArray(values: readonly string[]): string {
  return `[${values.map((value) => `'${escapeSingle(value)}'`).join(', ')}]`;
}

function escapeSingle(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}

function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
