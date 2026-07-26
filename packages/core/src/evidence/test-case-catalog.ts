import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Decentralized test-case-group shard machinery (query-authority-only generated
// catalog) extracted from packages/cli/src/commands/test-catalog.ts. It resolves
// stable case IDs, aliases and lineage that the causal validator selector
// (packages/core/src/evidence/validation-contract.ts) consumes.

export type ValidatorResponsibility = 'task-required' | 'phase-suite' | 'advisory';

export const VALIDATOR_RESPONSIBILITIES: readonly ValidatorResponsibility[] = [
  'task-required',
  'phase-suite',
  'advisory'
] as const;

export type TestCaseIdKind = 'int' | 'task';

export interface TestCaseGroupCase {
  readonly caseId: string;
  readonly semanticKey: string;
  readonly command?: string | null;
  readonly responsibility?: ValidatorResponsibility;
  readonly coversAcceptance?: readonly string[];
  readonly coversImpactEdges?: readonly string[];
  readonly dependsOnCaseIds?: readonly string[];
}

export interface TestCaseGroupShard {
  readonly schemaId: 'atm.testCaseGroup.v1';
  readonly specVersion: string;
  readonly groupId: string;
  readonly theme: string;
  readonly resourceKey: string;
  readonly maintainers: readonly string[];
  readonly supportedSeams?: readonly string[];
  readonly dependencyEdges?: readonly string[];
  readonly cases: readonly TestCaseGroupCase[];
  readonly aliases?: readonly { readonly aliasId: string; readonly canonicalCaseId: string }[];
  readonly lineage?: readonly { readonly caseId: string; readonly promotedTo: string }[];
  readonly sourcePath?: string | null;
}

export interface TestCaseShardDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly groupId?: string;
  readonly caseId?: string;
}

export interface GeneratedTestCaseCatalog {
  readonly schemaId: 'atm.generatedTestCaseCatalog.v1';
  readonly queryAuthorityOnly: true;
  readonly mutableRegistry: false;
  readonly generatedAt: string;
  readonly groups: readonly {
    readonly groupId: string;
    readonly theme: string;
    readonly resourceKey: string;
    readonly caseIds: readonly string[];
  }[];
  readonly cases: readonly {
    readonly caseId: string;
    readonly groupId: string;
    readonly semanticKey: string;
    readonly aliases: readonly string[];
    readonly promotedTo: string | null;
  }[];
  readonly diagnostics: readonly TestCaseShardDiagnostic[];
}

interface CaseGroupShardsConfig {
  caseGroupShards?: {
    root?: string;
    queryAuthorityOnly?: boolean;
  };
}

export function normalizeValidatorResponsibility(value: unknown): ValidatorResponsibility | null {
  const text = String(value ?? '').trim().toLowerCase();
  return VALIDATOR_RESPONSIBILITIES.includes(text as ValidatorResponsibility)
    ? text as ValidatorResponsibility
    : null;
}

export function normalizeSemanticKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export function buildTestCaseId(input: {
  readonly kind: TestCaseIdKind;
  readonly namespace: string;
  readonly semanticKey: string;
}): string {
  const kind = input.kind === 'task' ? 'task' : 'int';
  const namespace = normalizeSemanticKey(input.namespace);
  const semanticKey = normalizeSemanticKey(input.semanticKey);
  if (!namespace || !semanticKey) {
    throw new Error('test case id requires non-empty namespace and semanticKey');
  }
  const digest8 = createHash('sha256')
    .update(`kind=${kind}\nnamespace=${namespace}\nsemanticKey=${semanticKey}`)
    .digest('hex')
    .slice(0, 8);
  return `test_${kind}_${namespace}_${semanticKey}_${digest8}`;
}

export function resolveCaseGroupShardsRoot(repositoryRoot: string): string {
  const catalogPath = path.join(repositoryRoot, 'scripts', 'test-catalog.config.json');
  const configured = existsSync(catalogPath)
    ? (JSON.parse(readFileSync(catalogPath, 'utf8')) as CaseGroupShardsConfig).caseGroupShards?.root
    : null;
  return path.join(repositoryRoot, configured || 'tests/catalog/groups');
}

export function loadTestCaseGroupShards(repositoryRoot: string, groupsRoot?: string): TestCaseGroupShard[] {
  const root = groupsRoot ? path.resolve(groupsRoot) : resolveCaseGroupShardsRoot(repositoryRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.shard.json'))
    .map((entry) => {
      const sourcePath = path.join(root, entry.name);
      const raw = JSON.parse(readFileSync(sourcePath, 'utf8')) as Record<string, unknown>;
      return normalizeGroupShard(raw, toPortablePath(sourcePath));
    })
    .filter((shard): shard is TestCaseGroupShard => Boolean(shard))
    .sort((left, right) => left.groupId.localeCompare(right.groupId));
}

export function validateTestCaseGroupShards(shards: readonly TestCaseGroupShard[]): TestCaseShardDiagnostic[] {
  const diagnostics: TestCaseShardDiagnostic[] = [];
  const caseOwners = new Map<string, string>();
  const allCaseIds = new Set<string>();
  const semanticOwners = new Map<string, string>();

  for (const shard of shards) {
    if (!shard.maintainers.length) {
      diagnostics.push({
        code: 'ATM_TEST_CASE_GROUP_MISSING_OWNER',
        severity: 'error',
        groupId: shard.groupId,
        message: `Group ${shard.groupId} has no maintainers/owners.`
      });
    }
    const localSemantic = new Map<string, string>();
    for (const entry of shard.cases) {
      allCaseIds.add(entry.caseId);
      const priorGroup = caseOwners.get(entry.caseId);
      if (priorGroup && priorGroup !== shard.groupId) {
        diagnostics.push({
          code: 'ATM_TEST_CASE_ID_NOT_UNIQUE',
          severity: 'error',
          groupId: shard.groupId,
          caseId: entry.caseId,
          message: `Case ${entry.caseId} appears in both ${priorGroup} and ${shard.groupId}.`
        });
      } else {
        caseOwners.set(entry.caseId, shard.groupId);
      }
      const priorSemantic = localSemantic.get(entry.semanticKey);
      if (priorSemantic && priorSemantic !== entry.caseId) {
        diagnostics.push({
          code: 'ATM_TEST_CASE_SEMANTIC_DUPLICATE',
          severity: 'error',
          groupId: shard.groupId,
          caseId: entry.caseId,
          message: `Semantic key ${entry.semanticKey} maps to both ${priorSemantic} and ${entry.caseId} in ${shard.groupId}.`
        });
      } else {
        localSemantic.set(entry.semanticKey, entry.caseId);
      }
      const globalSemanticOwner = semanticOwners.get(`${shard.groupId}:${entry.semanticKey}`);
      if (!globalSemanticOwner) semanticOwners.set(`${shard.groupId}:${entry.semanticKey}`, entry.caseId);
    }
  }

  for (const shard of shards) {
    for (const alias of shard.aliases ?? []) {
      if (!allCaseIds.has(alias.canonicalCaseId) && !(shard.lineage ?? []).some((entry) => entry.caseId === alias.canonicalCaseId)) {
        diagnostics.push({
          code: 'ATM_TEST_CASE_UNRESOLVED_ALIAS',
          severity: 'error',
          groupId: shard.groupId,
          caseId: alias.aliasId,
          message: `Alias ${alias.aliasId} points to unresolved canonical case ${alias.canonicalCaseId}.`
        });
      }
    }
    for (const entry of shard.cases) {
      for (const dep of entry.dependsOnCaseIds ?? []) {
        if (!allCaseIds.has(dep) && !(shard.aliases ?? []).some((alias) => alias.aliasId === dep)) {
          diagnostics.push({
            code: 'ATM_TEST_CASE_UNRESOLVED_REFERENCE',
            severity: 'error',
            groupId: shard.groupId,
            caseId: entry.caseId,
            message: `Case ${entry.caseId} depends on unresolved case ${dep}.`
          });
        }
      }
    }
    for (const edge of shard.lineage ?? []) {
      if (!allCaseIds.has(edge.promotedTo) && !(shard.aliases ?? []).some((alias) => alias.aliasId === edge.promotedTo || alias.canonicalCaseId === edge.promotedTo)) {
        diagnostics.push({
          code: 'ATM_TEST_CASE_ORPHAN_LINEAGE',
          severity: 'error',
          groupId: shard.groupId,
          caseId: edge.caseId,
          message: `Lineage for ${edge.caseId} promotes to unresolved case ${edge.promotedTo}.`
        });
      }
    }
    const cycle = detectLineageCycle(shard);
    if (cycle) {
      diagnostics.push({
        code: 'ATM_TEST_CASE_LINEAGE_CYCLE',
        severity: 'error',
        groupId: shard.groupId,
        message: `Lineage/alias cycle detected in ${shard.groupId}: ${cycle.join(' -> ')}.`
      });
    }
  }

  return diagnostics;
}

export function generateReadOnlyTestCaseCatalog(
  shards: readonly TestCaseGroupShard[],
  options: { generatedAt?: string } = {}
): GeneratedTestCaseCatalog {
  const diagnostics = validateTestCaseGroupShards(shards);
  const aliasIndex = new Map<string, string[]>();
  const promotedTo = new Map<string, string>();
  for (const shard of shards) {
    for (const alias of shard.aliases ?? []) {
      const list = aliasIndex.get(alias.canonicalCaseId) ?? [];
      list.push(alias.aliasId);
      aliasIndex.set(alias.canonicalCaseId, list);
    }
    for (const edge of shard.lineage ?? []) {
      promotedTo.set(edge.caseId, edge.promotedTo);
    }
  }
  return {
    schemaId: 'atm.generatedTestCaseCatalog.v1',
    queryAuthorityOnly: true,
    mutableRegistry: false,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    groups: shards.map((shard) => ({
      groupId: shard.groupId,
      theme: shard.theme,
      resourceKey: shard.resourceKey,
      caseIds: shard.cases.map((entry) => entry.caseId)
    })),
    cases: shards.flatMap((shard) => {
      const memberCases = shard.cases.map((entry) => ({
        caseId: entry.caseId,
        groupId: shard.groupId,
        semanticKey: entry.semanticKey,
        aliases: [...(aliasIndex.get(entry.caseId) ?? [])].sort(),
        promotedTo: promotedTo.get(entry.caseId) ?? null
      }));
      const historical = (shard.lineage ?? [])
        .filter((edge) => !shard.cases.some((entry) => entry.caseId === edge.caseId))
        .map((edge) => ({
          caseId: edge.caseId,
          groupId: shard.groupId,
          semanticKey: 'historical_lineage',
          aliases: [...(aliasIndex.get(edge.caseId) ?? [])].sort(),
          promotedTo: edge.promotedTo
        }));
      return [...memberCases, ...historical];
    }),
    diagnostics
  };
}

function normalizeGroupShard(raw: Record<string, unknown>, sourcePath: string): TestCaseGroupShard | null {
  const groupId = String(raw.groupId ?? '').trim();
  const theme = String(raw.theme ?? '').trim();
  const resourceKey = String(raw.resourceKey ?? '').trim();
  const maintainers = normalizeStringList(raw.maintainers);
  const casesRaw = Array.isArray(raw.cases) ? raw.cases : [];
  const cases = casesRaw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const caseId = String(entry.caseId ?? '').trim();
    const semanticKey = normalizeSemanticKey(String(entry.semanticKey ?? ''));
    if (!caseId || !semanticKey) return [];
    return [{
      caseId,
      semanticKey,
      command: typeof entry.command === 'string' ? entry.command : null,
      responsibility: normalizeValidatorResponsibility(entry.responsibility) ?? undefined,
      coversAcceptance: normalizeStringList(entry.coversAcceptance),
      coversImpactEdges: normalizeStringList(entry.coversImpactEdges),
      dependsOnCaseIds: normalizeStringList(entry.dependsOnCaseIds)
    } satisfies TestCaseGroupCase];
  });
  if (!groupId || !theme || !resourceKey || cases.length === 0) return null;
  return {
    schemaId: 'atm.testCaseGroup.v1',
    specVersion: String(raw.specVersion ?? '0.1.0'),
    groupId,
    theme,
    resourceKey,
    maintainers,
    supportedSeams: normalizeStringList(raw.supportedSeams),
    dependencyEdges: normalizeStringList(raw.dependencyEdges),
    cases,
    aliases: Array.isArray(raw.aliases)
      ? raw.aliases.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const aliasId = String(entry.aliasId ?? '').trim();
        const canonicalCaseId = String(entry.canonicalCaseId ?? '').trim();
        return aliasId && canonicalCaseId ? [{ aliasId, canonicalCaseId }] : [];
      })
      : [],
    lineage: Array.isArray(raw.lineage)
      ? raw.lineage.flatMap((entry) => {
        if (!isRecord(entry)) return [];
        const caseId = String(entry.caseId ?? '').trim();
        const next = String(entry.promotedTo ?? '').trim();
        return caseId && next ? [{ caseId, promotedTo: next }] : [];
      })
      : [],
    sourcePath
  };
}

function detectLineageCycle(shard: TestCaseGroupShard): string[] | null {
  const edges = new Map<string, string>();
  for (const alias of shard.aliases ?? []) edges.set(alias.aliasId, alias.canonicalCaseId);
  for (const edge of shard.lineage ?? []) edges.set(edge.caseId, edge.promotedTo);
  for (const start of edges.keys()) {
    const seen = new Set<string>();
    const pathIds: string[] = [];
    let current: string | undefined = start;
    while (current) {
      if (seen.has(current)) {
        const cycleStart = pathIds.indexOf(current);
        return [...pathIds.slice(cycleStart), current];
      }
      seen.add(current);
      pathIds.push(current);
      current = edges.get(current);
    }
  }
  return null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toPortablePath(value: string): string {
  return String(value || '').replace(/\\/g, '/');
}
