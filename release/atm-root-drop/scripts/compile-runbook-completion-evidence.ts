import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  consumeWaveExitObserverReceiptCandidates,
  digestWaveExitObserverInputsAtCommit,
  digestWaveExitObserverPolicy,
  loadWaveExitObserverPolicy,
  loadWaveExitObserverPolicyAtCommit,
  readWaveExitReceiptCandidates,
  readWaveExitObserverPolicySourceAtCommit,
  type WaveExitObserverPolicy
} from '../packages/core/src/evidence/wave-exit-observer-receipt.ts';
import { observeSealedFinalCertificate } from './lib/final-certificate-observation.ts';
export { digestText, semanticTaskCardDigest } from './task-card-contract-digest.ts';
export { summarizeFinalCertificate } from './lib/final-certificate-observation.ts';
import { digestText, semanticTaskCardDigest } from './task-card-contract-digest.ts';

export const RUNBOOK_RELATIVE_PATH = 'docs/ai_atomic_framework/governance-optimization/plan-3x-4x-false-green-correction-complete-closeout-runbook-2026-08-09.md';
export const DEFAULT_PLANNING_ROOT = process.env.ATM_PLANNING_REPO_ROOT
  ? resolve(process.env.ATM_PLANNING_REPO_ROOT)
  : resolve('..', '3KLife');
export const DEFAULT_OUTPUT = resolve('docs/reports/plan-3x-4x-runbook-completion-evidence.json');
export const DEFAULT_CERTIFICATE = resolve('docs/reports/plan-3x-4x-independent-certificate.json');
const REPORT_ARTIFACT_PREFIX = 'docs/reports/';
const GOVERNANCE_PROJECTION_PREFIX = 'governance-optimization/';
const DURABLE_RECEIPT_PREFIX = '.atm/history/';

type ValidatorContract = { contractId: string; taskId: string; taskCardPath: string; taskCardDigest: string; command: string };
type WaveExitObserverValidatorContract = {
  kind: 'wave-exit-observer-receipt';
  contractId: string;
  exitItemId: string;
  evidenceOwner: string;
  command: string;
  policyDigest: string;
};
type EvidenceTuple = { command: string; exitCode: number; outputDigest: string; artifactPaths: string[]; observedAt: string; sourceCommit: string; evidenceOwner: string; validatorContractId?: string };
type CompletionRow = { itemId: string; sourceLine: number; section: string; wave: string | null; requirement: string; requirementDigest: string; status: 'proven' | 'unproven'; evidence: EvidenceTuple[]; diagnostics: string[]; coverageOwners?: string[]; validatorContractIds?: string[] };

export function sealValidatorContractIds(candidates: ReadonlyArray<string | undefined>, coverageOwners: readonly string[] = [], requireComplete = false) {
  const holes = candidates.some((id) => typeof id !== 'string' || id.length === 0);
  const validatorContractIds = [...new Set(candidates.filter((id): id is string => typeof id === 'string' && id.length > 0))];
  return { validatorContractIds, diagnostics: coverageOwners.length > 0 && (requireComplete ? holes : validatorContractIds.length === 0) ? ['missing-validator-contract-id'] : [] };
}

function normalizePublicationArtifacts(paths: string[]): string[] | null {
  const normalized = [...new Set(paths.map((path) => path.replace(/\\/g, '/').replace(/^\.\//, '')))].sort();
  return normalized.length > 0
    && normalized.every((path) => (
      (path.startsWith(REPORT_ARTIFACT_PREFIX) || path.startsWith(GOVERNANCE_PROJECTION_PREFIX))
      && path.endsWith('.json')
      && !path.includes('..')
      && !path.startsWith('/')
    ))
    ? normalized
    : null;
}

export function isDeclaredPublicationDelta(changedPaths: string[], declaredArtifacts: string[]): boolean {
  const allowedArtifacts = normalizePublicationArtifacts(declaredArtifacts);
  return allowedArtifacts !== null
    && changedPaths.every((path) => path.startsWith(DURABLE_RECEIPT_PREFIX) || allowedArtifacts.includes(path));
}

/**
 * A generated evidence artifact cannot bind to the commit that publishes the
 * artifact: that commit necessarily changes HEAD.  Freshness is therefore
 * measured against the observed input snapshot, while allowing only the
 * artifact itself and durable governance receipts in the publication delta.
 * Any source change still forces a fresh observation.
 */
export function isPublicationOnlyDelta(observedHead: string, currentHead: string, declaredArtifacts = [relative(resolve('.'), DEFAULT_OUTPUT).replace(/\\/g, '/')]): boolean {
  if (!/^[0-9a-f]{40}$/.test(observedHead) || !/^[0-9a-f]{40}$/.test(currentHead)) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', observedHead, currentHead], { stdio: 'ignore' });
    const changed = execFileSync('git', ['diff', '--name-only', `${observedHead}..${currentHead}`], { encoding: 'utf8' })
      .split(/\r?\n/).filter(Boolean);
    return isDeclaredPublicationDelta(changed, declaredArtifacts);
  } catch {
    return false;
  }
}

export function selectCompletionObservationOrigin(committedOrigin: string, liveOrigin: string, sealedTarget: string, committedSnapshot: string): string {
  return sealedTarget === committedSnapshot && /^[0-9a-f]{40}$/i.test(committedOrigin)
    ? committedOrigin
    : liveOrigin;
}

export function parseRunbook(source: string): { rows: CompletionRow[]; waveExits: CompletionRow[] } {
  const rows: CompletionRow[] = [];
  const waveExits: CompletionRow[] = [];
  let section = 'preamble';
  let wave: string | null = null;
  source.split(/\r?\n/).forEach((line, index) => {
    const heading = /^(#{2,4})\s+(.+)$/.exec(line);
    if (heading) {
      section = heading[2].trim();
      const match = /Wave\s+(\d+)/i.exec(section);
      wave = match ? `Wave ${match[1]}` : null;
    }
    const checkbox = /^- \[([ xX])\]\s+(.+)$/.exec(line);
    if (checkbox) {
      const requirement = checkbox[2].trim();
      rows.push({ itemId: `RB-${String(rows.length + 1).padStart(3, '0')}`, sourceLine: index + 1, section, wave, requirement, requirementDigest: digestText(requirement), status: 'unproven', evidence: [], diagnostics: ['missing-command-backed-evidence'] });
    }
    const exit = /^退出條件：\s*(.+)$/.exec(line);
    if (exit) {
      const requirement = exit[1].trim();
      waveExits.push({ itemId: `EXIT-${String(waveExits.length + 1).padStart(2, '0')}`, sourceLine: index + 1, section, wave, requirement, requirementDigest: digestText(requirement), status: 'unproven', evidence: [], diagnostics: ['missing-independent-wave-exit-evidence'] });
    }
  });
  return { rows, waveExits };
}

const NON_SEMANTIC_COMMANDS = new Set(['npm run typecheck', 'npm run validate:cli', 'npm run validate:git-head-evidence']);
const ancestryCache = new Map<string, boolean>();
const evidenceCache = new Map<string, EvidenceTuple[]>();

export type WaveExitObserverCompileOptions = {
  readonly receipts?: Readonly<Record<string, unknown>>;
  readonly policy?: WaveExitObserverPolicy;
  readonly currentInputDigests?: Readonly<Record<string, string>>;
  readonly policyDigestAtCompilationHead?: string;
  readonly basisActorsByWave?: Readonly<Record<string, readonly string[]>>;
  readonly repoRoot?: string;
  readonly isAncestor?: (ancestor: string, descendant: string) => boolean;
  readonly readPolicySourceAtCommit?: (commit: string) => string | null;
};

export type CardContract = {
  taskId: string;
  wave: string | null;
  phase: string;
  validators: ValidatorContract[];
  registered: boolean;
  publicSeams: string[];
  deliverables: string[];
  causalDependencies: string[];
  observationDependencies: string[];
};

function yamlInlineList(source: string, key: string): string[] {
  const match = new RegExp(`^\\s*${key}:\\s*\\[([^\\]]*)\\]`, 'm').exec(source);
  return match?.[1].split(',').map((value) => value.trim()).filter(Boolean) ?? [];
}

function yamlListBlock(source: string, key: string): string[] {
  const match = new RegExp(`^${key}:\\s*\\r?\\n((?:\\s+- .+\\r?\\n)+)`, 'm').exec(source);
  return [...(match?.[1].matchAll(/^\s+-\s+(.+)$/gm) ?? [])].map((entry) => entry[1].trim());
}

/** Test contribution dependency edges express evidence consumption without
 * imposing a lifecycle dependency, so independent observers may run in
 * parallel once their input artifact exists. */
function testContributionDependencies(source: string): string[] {
  return [...source.matchAll(/^\s+dependencyEdge:\s*(ATM-GOV-\d+)\s*$/gm)]
    .map((match) => match[1])
    .filter(Boolean);
}

function discoverCardContracts(runbookSource: string): CardContract[] {
  const taskDir = resolve(DEFAULT_PLANNING_ROOT, dirname(RUNBOOK_RELATIVE_PATH), 'tasks');
  if (!existsSync(taskDir)) return [];
  const registeredIds = new Set([...runbookSource.matchAll(/^\|\s*\d+\s*\|\s*`(ATM-GOV-\d+)`/gm)].map((match) => match[1]));
  return readdirSync(taskDir).filter((name) => /^ATM-GOV-\d+-.+\.task\.md$/.test(name)).flatMap((name) => {
    const source = readFileSync(resolve(taskDir, name), 'utf8');
    const taskId = /^task_id:\s*(\S+)/m.exec(source)?.[1];
    if (!taskId || !source.includes(`related_plan: governance-optimization/${basename(RUNBOOK_RELATIVE_PATH)}`)) return [];
    const phase = /^\s*phaseOwner:\s*(\S+)/m.exec(source)?.[1] ?? '';
    const waveNumber = /wave-(\d+)/i.exec(phase)?.[1];
    const block = /^validators:\s*\r?\n((?:\s+- .+\r?\n)+)/m.exec(source)?.[1] ?? '';
    const taskCardPath = resolve(taskDir, name);
    const taskCardDigest = semanticTaskCardDigest(source);
    const validators = [...block.matchAll(/^\s+-\s+(.+)$/gm)].map((match) => {
      const command = match[1].trim();
      return {
        contractId: `atm.taskCardValidator/${taskId}/${digestText(command).slice('sha256:'.length)}`,
        taskId,
        taskCardPath,
        taskCardDigest,
        command
      };
    });
    return [{
      taskId,
      wave: waveNumber ? `Wave ${Number(waveNumber)}` : null,
      phase,
      validators,
      registered: registeredIds.has(taskId),
      publicSeams: yamlInlineList(source, 'changedPublicSeams'),
      deliverables: yamlListBlock(source, 'deliverables'),
      causalDependencies: yamlInlineList(source, 'causalDependencies'),
      observationDependencies: testContributionDependencies(source)
    }];
  });
}

function sharesValue(left: string[], right: string[]): boolean {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

/** A replay replaces a primary only when its planning contract proves seam and artifact continuity. */
export function effectiveEvidenceContracts(primary: CardContract[], all: CardContract[]): CardContract[] {
  return primary.map((contract) => {
    const candidates = all.filter((candidate) => !candidate.registered
      && candidate.wave === contract.wave
      && sharesValue(candidate.publicSeams, contract.publicSeams)
      && sharesValue(candidate.deliverables, contract.deliverables)
      // Consumers may observe the same artifact but cannot replace its
      // producer contract. A replacement must continue at least one of the
      // primary validator contracts as well as the seam and deliverable.
      && sharesValue(candidate.validators.map((validator) => validator.command), contract.validators.map((validator) => validator.command)));
    // A replay chain may legitimately contain more than one candidate.  The
    // canonical replacement is its unique downstream leaf, never whichever
    // directory entry happens to be read first.  Branching remains ambiguous
    // and therefore preserves the original contract fail-closed.
    const leaves = candidates.filter((candidate) => !candidates.some((other) =>
      other.taskId !== candidate.taskId && other.causalDependencies.includes(candidate.taskId)
    ));
    return leaves.length === 1 ? leaves[0] : contract;
  });
}

/** A Wave exit needs a downstream observer, never a second use of basis receipts. */
export function independentExitContracts(effective: CardContract[], all: CardContract[], wave: string | null): CardContract[] {
  const effectiveIds = new Set(effective.map((contract) => contract.taskId));
  const seams = effective.flatMap((contract) => contract.publicSeams);
  return all.filter((candidate) => !candidate.registered
    && candidate.wave === wave
    && !effectiveIds.has(candidate.taskId)
    && sharesValue(candidate.publicSeams, seams)
    && [...candidate.causalDependencies, ...candidate.observationDependencies]
      .some((dependency) => effectiveIds.has(dependency)));
}

export function planningSemanticSnapshot(runbookSource: string) {
  const contracts = discoverCardContracts(runbookSource);
  const contractsDigest = digestText(JSON.stringify(contracts.map((contract) => ({
    taskId: contract.taskId,
    wave: contract.wave,
    phase: contract.phase,
    validators: contract.validators.map(({ contractId, taskCardDigest, command }) => ({ contractId, taskCardDigest, command })),
    registered: contract.registered,
    publicSeams: contract.publicSeams,
    deliverables: contract.deliverables,
    causalDependencies: contract.causalDependencies,
    observationDependencies: contract.observationDependencies
  })).sort((left, right) => left.taskId.localeCompare(right.taskId))));
  return {
    schemaId: 'atm.planningSemanticSnapshot.v1',
    runbookDigest: digestText(runbookSource),
    contractsDigest,
    digest: digestText(`${digestText(runbookSource)}\n${contractsDigest}`)
  };
}

function contractsForRow(row: CompletionRow, contracts: CardContract[]): CardContract[] {
  const registered = contracts.filter((contract) => contract.registered);
  if (row.wave) return registered.filter((contract) => contract.wave === row.wave);
  const requirement = row.requirement;
  if (row.section === 'Authority and governance') return registered.filter((contract) => /^correction-wave-[0-2]$/.test(contract.phase));
  if (row.section === 'Objective evidence') {
    if (/Plan 3\.0/.test(requirement)) return registered.filter((contract) => contract.phase.endsWith('plan30'));
    if (/Plan 3\.1/.test(requirement)) return registered.filter((contract) => contract.phase.endsWith('plan31'));
    if (/Plan 3\.2/.test(requirement)) return registered.filter((contract) => contract.phase.endsWith('plan32'));
    if (/Plan 4\.0/.test(requirement)) return registered.filter((contract) => contract.phase === 'closeout-wave-7');
    if (/86\/86/.test(requirement)) return registered.filter((contract) => /^closeout-wave-6-|^correction-wave-5$|^closeout-wave-7$/.test(contract.phase));
    return registered.filter((contract) => /^correction-wave-4-|^closeout-wave-7$/.test(contract.phase));
  }
  if (row.section === 'Real execution and dashboard') {
    if (/shadow/.test(requirement)) return registered.filter((contract) => contract.phase.endsWith('shadow'));
    if (/六 adapter/.test(requirement)) return registered.filter((contract) => contract.phase.endsWith('adapters'));
    if (/hostile|A\/A|AB\/BA/.test(requirement)) return registered.filter((contract) => contract.phase.endsWith('dogfood'));
    return registered.filter((contract) => contract.phase === 'correction-wave-5');
  }
  if (row.section === 'Tests, backlog and release') {
    if (/timeout|120 秒|hash-placeholder/.test(requirement)) return registered.filter((contract) => contract.phase === 'correction-wave-3-performance');
    if (/catalog|neutrality|coverage/.test(requirement)) return registered.filter((contract) => contract.phase === 'correction-wave-3-ci');
    if (/backlog|2026-/.test(requirement)) return registered.filter((contract) => contract.phase === 'closeout-wave-9');
    return registered.filter((contract) => contract.phase === 'closeout-wave-10');
  }
  return [];
}

function isAncestor(sourceCommit: string, targetHead: string): boolean {
  const key = `${sourceCommit}:${targetHead}`;
  const cached = ancestryCache.get(key);
  if (cached !== undefined) return cached;
  if (!/^[0-9a-f]{40}$/.test(targetHead)) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sourceCommit, targetHead], { stdio: 'ignore' });
    ancestryCache.set(key, true);
    return true;
  } catch {
    ancestryCache.set(key, false);
    return false;
  }
}

function evidenceForContracts(contracts: CardContract[], targetHead: string): EvidenceTuple[] {
  const tuples: EvidenceTuple[] = [];
  const expectedCommands = new Set(contracts.flatMap((contract) => contract.validators.map((validator) => validator.command)));
  const expectedOwners = new Set(contracts.map((contract) => contract.taskId));
  const cacheKey = `${targetHead}:${[...expectedOwners].sort().join('\u0000')}:${[...expectedCommands].sort().join('\u0000')}`;
  const cached = evidenceCache.get(cacheKey);
  if (cached) return cached;
  const evidenceDir = resolve('.atm/history/evidence');
  if (!existsSync(evidenceDir)) return tuples;
  for (const file of readdirSync(evidenceDir).filter((name) => /^ATM-GOV-\d+\.json$/.test(name))) {
    const owner = file.replace(/\.json$/, '');
    if (!expectedOwners.has(owner)) continue;
    const evidencePath = `.atm/history/evidence/${file}`;
    if (!existsSync(evidencePath)) continue;
    const record = JSON.parse(readFileSync(evidencePath, 'utf8'));
    for (const entry of record.evidence ?? []) {
      for (const run of entry.details?.commandRuns ?? []) {
        if (run.exitCode !== 0 || NON_SEMANTIC_COMMANDS.has(run.command) || !expectedCommands.has(run.command)) continue;
        const outputDigest = run.canonicalObservation?.outputDigest ?? run.stdoutSha256;
        if (!outputDigest) continue;
        const sourceCommit = run.sourceCommit ?? 'unknown';
        if (!/^[0-9a-f]{40}$/.test(sourceCommit) || !isAncestor(sourceCommit, targetHead)) continue;
        const validator = contracts.find((contract) => contract.taskId === owner)?.validators.find((candidate) => candidate.command === run.command);
        if (!validator) continue;
        tuples.push({ command: run.command, exitCode: run.exitCode, outputDigest, artifactPaths: [evidencePath, ...(entry.artifactPaths ?? [])], observedAt: run.finishedAt ?? entry.createdAt, sourceCommit, evidenceOwner: owner, validatorContractId: validator.contractId });
      }
    }
  }
  evidenceCache.set(cacheKey, tuples);
  return tuples;
}

export function evidenceTupleKey(tuple: EvidenceTuple): string {
  return [tuple.evidenceOwner, tuple.command, tuple.sourceCommit, tuple.outputDigest, ...tuple.artifactPaths].join('\u0000');
}

export function evidenceBelongsToContract(tuple: EvidenceTuple, contract: CardContract): boolean {
  return tuple.evidenceOwner === contract.taskId
    && contract.validators.some((validator) => validator.command === tuple.command && validator.contractId === tuple.validatorContractId);
}

function hydrate(row: CompletionRow, contracts: CardContract[], targetHead: string): CompletionRow {
  const evidence = evidenceForContracts(contracts, targetHead);
  const owners = contracts.map((contract) => contract.taskId);
  const uncoveredOwners = contracts.filter((contract) => evidenceForContracts([contract], targetHead).length === 0).map((contract) => contract.taskId);
  const proven = contracts.length > 0 && uncoveredOwners.length === 0;
  const sealed = sealValidatorContractIds(evidence.map((tuple) => tuple.validatorContractId), owners);
  return {
    ...row,
    coverageOwners: owners,
    validatorContractIds: sealed.validatorContractIds,
    evidence,
    status: proven && sealed.diagnostics.length === 0 ? 'proven' : 'unproven',
    diagnostics: [...(proven ? [] : [`missing-command-backed-evidence:${uncoveredOwners.join(',') || 'no-contract'}`]), ...sealed.diagnostics]
  };
}

function observeFinalCertificate(targetHead: string): { proven: boolean; diagnostics: string[] } {
  // Completion only consumes terminal authorization from the certificate
  // sealed at its target tree, never mutable worktree diagnostics.
  return observeSealedFinalCertificate(targetHead, DEFAULT_CERTIFICATE);
}

function requiresFinalCertificate(row: CompletionRow): boolean {
  return row.wave === 'Wave 10'
    || (row.section === 'Tests, backlog and release' && /runner sync queue|remote-reachable|closeback receipt|final certificate/.test(row.requirement));
}

function observerContracts(policy: WaveExitObserverPolicy, policyDigest: string): WaveExitObserverValidatorContract[] {
  return Object.entries(policy.exits)
    .map(([exitItemId, exit]) => ({
      kind: 'wave-exit-observer-receipt' as const,
      contractId: `atm.waveExitObserverReceipt/${exitItemId}`,
      exitItemId,
      evidenceOwner: `wave-exit-observer:${exitItemId}`,
      command: exit.command,
      policyDigest
    }))
    .sort((left, right) => left.contractId.localeCompare(right.contractId));
}

export function compileRunbookCompletion(
  source: string,
  planningHead: string,
  targetHead: string,
  originMain: string,
  finalCertificate = observeFinalCertificate(targetHead),
  generatedAt = new Date().toISOString(),
  authorityDiagnostics: string[] = [],
  publicationArtifacts = [relative(resolve('.'), DEFAULT_OUTPUT).replace(/\\/g, '/')],
  observerOptions: WaveExitObserverCompileOptions = {}
) {
  const normalizedPublicationArtifacts = normalizePublicationArtifacts(publicationArtifacts);
  if (normalizedPublicationArtifacts === null) throw new Error('publication artifacts must be non-empty project report paths');
  const parsed = parseRunbook(source);
  const contracts = discoverCardContracts(source);
  const planningSnapshot = planningSemanticSnapshot(source);
  parsed.rows = parsed.rows.map((row) => {
    const hydrated = hydrate(row, effectiveEvidenceContracts(contractsForRow(row, contracts), contracts), targetHead);
    return requiresFinalCertificate(row) && !finalCertificate.proven
      ? { ...hydrated, status: 'unproven' as const, diagnostics: finalCertificate.diagnostics }
      : hydrated;
  });
  const rowsByWave = new Map<string, CompletionRow[]>();
  for (const row of parsed.rows) if (row.wave) rowsByWave.set(row.wave, [...(rowsByWave.get(row.wave) ?? []), row]);
  const repoRoot = observerOptions.repoRoot ?? resolve('.');
  const observerPolicy = observerOptions.policy
    ?? loadWaveExitObserverPolicyAtCommit(repoRoot, targetHead)
    ?? (existsSync(resolve(repoRoot, 'schemas/evidence/wave-exit-observer-policy.json'))
      ? loadWaveExitObserverPolicy(repoRoot)
      : null);
  const observerPolicySourceAtTarget = readWaveExitObserverPolicySourceAtCommit(repoRoot, targetHead);
  const observerPolicyDigest = observerPolicy
    ? (observerOptions.policyDigestAtCompilationHead ?? digestWaveExitObserverPolicy(observerPolicy, observerPolicySourceAtTarget ?? undefined))
    : null;
  parsed.waveExits = parsed.waveExits.map((row) => {
    const basis = rowsByWave.get(row.wave ?? '') ?? [];
    const primaryForWave = contracts.filter((contract) => contract.registered && contract.wave === row.wave);
    const effectiveForWave = effectiveEvidenceContracts(primaryForWave, contracts);
    const contractsForWave = independentExitContracts(effectiveForWave, contracts, row.wave);
    const hydrated = hydrate(row, contractsForWave, targetHead);
    const basisKeys = new Set(basis.flatMap((item) => item.evidence).map(evidenceTupleKey));
    const independentEvidence = hydrated.evidence.filter((tuple) => !basisKeys.has(evidenceTupleKey(tuple)));
    const uncoveredOwners = contractsForWave
      .filter((contract) => !independentEvidence.some((tuple) => evidenceBelongsToContract(tuple, contract)))
      .map((contract) => contract.taskId);
    const basisProven = basis.length === 0 || basis.every((item) => item.status === 'proven');
    const independentlySatisfied = basisProven
      && contractsForWave.length > 0
      && uncoveredOwners.length === 0;
    const contractDiagnostics = independentlySatisfied
      ? []
      : [
          ...(basis.some((item) => item.status !== 'proven') ? ['wave-requirement-basis-not-proven'] : []),
          ...(uncoveredOwners.length ? [`missing-independent-wave-exit-evidence:${uncoveredOwners.join(',')}`] : ['missing-independent-wave-exit-contract'])
        ];
    const receiptSources = observerPolicy
      ? (observerOptions.receipts?.[row.itemId] != null
        ? [observerOptions.receipts[row.itemId]]
        : readWaveExitReceiptCandidates(repoRoot, observerPolicy, row.itemId))
      : [];
    if (receiptSources.length > 0 && observerPolicy && observerPolicyDigest) {
      const exitPolicy = observerPolicy.exits[row.itemId];
      const currentInputDigests = observerOptions.currentInputDigests
        ?? (exitPolicy ? digestWaveExitObserverInputsAtCommit(repoRoot, row.itemId, exitPolicy, targetHead) : {});
      const receiptVerdict = consumeWaveExitObserverReceiptCandidates({
        repoRoot,
        receipts: receiptSources,
        policy: observerPolicy,
        compilationHead: targetHead,
        currentInputDigests,
        policyDigestAtCompilationHead: observerPolicyDigest,
        isAncestor: observerOptions.isAncestor ?? isAncestor,
        basisActors: observerOptions.basisActorsByWave?.[row.wave ?? ''],
        readPolicySourceAtCommit: observerOptions.readPolicySourceAtCommit
      });
      const selectedReceipt = receiptVerdict.receipt;
      if (selectedReceipt && basisProven) {
        const receiptTuple: EvidenceTuple = {
          command: selectedReceipt.command,
          exitCode: selectedReceipt.exitCode,
          outputDigest: selectedReceipt.stdoutDigest,
          artifactPaths: [selectedReceipt.artifactPath],
          observedAt: selectedReceipt.observedAt,
          sourceCommit: selectedReceipt.observedHead,
          evidenceOwner: `wave-exit-observer:${row.itemId}`,
          validatorContractId: `atm.waveExitObserverReceipt/${row.itemId}`
        };
        const coverageOwners = [...new Set([...(hydrated.coverageOwners ?? []), receiptTuple.evidenceOwner])];
        const sealed = sealValidatorContractIds([...(hydrated.validatorContractIds ?? []), receiptTuple.validatorContractId], coverageOwners, true);
        const failClosed = sealed.diagnostics.length > 0;
        return {
          ...hydrated,
          evidence: failClosed ? independentEvidence : [...independentEvidence, receiptTuple],
          status: failClosed ? 'unproven' as const : 'proven' as const,
          diagnostics: failClosed ? [...new Set([...contractDiagnostics, ...sealed.diagnostics])] : [],
          coverageOwners,
          validatorContractIds: sealed.validatorContractIds
        };
      }
      return {
        ...hydrated,
        evidence: independentEvidence,
        status: 'unproven' as const,
        diagnostics: [...new Set([
          ...contractDiagnostics,
          ...receiptVerdict.diagnostics
        ])]
      };
    }
    return independentlySatisfied
      ? { ...hydrated, evidence: independentEvidence, diagnostics: [] }
      : { ...hydrated, evidence: independentEvidence, status: 'unproven' as const, diagnostics: contractDiagnostics };
  });
  if (authorityDiagnostics.length > 0) {
    parsed.rows = parsed.rows.map((row) => ({ ...row, status: 'unproven' as const, diagnostics: [...new Set([...row.diagnostics, ...authorityDiagnostics])] }));
    parsed.waveExits = parsed.waveExits.map((row) => ({ ...row, status: 'unproven' as const, diagnostics: [...new Set([...row.diagnostics, ...authorityDiagnostics])] }));
  }
  const allRows = [...parsed.rows, ...parsed.waveExits];
  const unresolved = allRows.filter((row) => row.status !== 'proven').map((row) => row.itemId);
  const unknown = allRows.filter((row) => row.coverageOwners?.length && row.evidence.length === 0).map((row) => row.itemId);
  return {
    schemaId: 'atm.runbookCompletionEvidence.v1', specVersion: '0.1.0', generatedAt,
    authority: {
      planningPath: RUNBOOK_RELATIVE_PATH, planningHead, targetHead, originMain, sourceDigest: digestText(source), diagnostics: authorityDiagnostics,
      planningSemanticSnapshot: planningSnapshot,
      publicationBundle: { schemaId: 'atm.sealedProjectionPublicationBundle.v1', artifactPaths: normalizedPublicationArtifacts }
    },
    expectedItemCount: parsed.rows.length,
    validatorContracts: [
      ...contracts.flatMap((contract) => contract.validators),
      ...(observerPolicy && observerPolicyDigest ? observerContracts(observerPolicy, observerPolicyDigest) : [])
    ],
    rows: parsed.rows, waveExits: parsed.waveExits,
    unresolvedIds: unresolved, deferredIds: [], unknownIds: unknown, overallVerdict: unresolved.length ? 'not-complete' : 'complete'
  };
}

if (process.argv[1]?.endsWith('compile-runbook-completion-evidence.ts')) {
  const modeIndex = process.argv.indexOf('--mode');
  const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : 'validate';
  if (mode !== 'validate' && mode !== 'write') {
    console.error(`[compile-runbook-completion-evidence] unknown --mode ${String(mode)}; expected validate or write`);
    process.exitCode = 2;
  } else {
  const source = readFileSync(resolve(DEFAULT_PLANNING_ROOT, RUNBOOK_RELATIVE_PATH), 'utf8');
  const git = (cwd: string, args: string[]): string => {
    try {
      return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
    } catch {
      return 'unknown';
    }
  };
  const gitRaw = (cwd: string, args: string[]): string | null => {
    try {
      return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
    } catch {
      return null;
    }
  };
  const observedPlanningHead = process.env.ATM_PLANNING_HEAD ?? git(DEFAULT_PLANNING_ROOT, ['rev-parse', 'HEAD']);
  const currentTargetHead = process.env.ATM_TARGET_HEAD ?? git(resolve('.'), ['rev-parse', 'HEAD']);
   const liveOriginMain = process.env.ATM_ORIGIN_MAIN ?? git(resolve('.'), ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] ?? 'unknown';
  const committed = mode === 'validate' && existsSync(DEFAULT_OUTPUT)
    ? JSON.parse(readFileSync(DEFAULT_OUTPUT, 'utf8'))
    : null;
  const committedSnapshot = String(committed?.authority?.targetHead ?? '');
  const currentPlanningSnapshot = planningSemanticSnapshot(source);
  const planningHead = mode === 'validate' && committed?.authority?.planningSemanticSnapshot?.digest === currentPlanningSnapshot.digest
    ? String(committed.authority.planningHead)
    : observedPlanningHead;
  const requestedPublicationArtifacts = process.argv.flatMap((arg, index) => arg === '--publication-artifact' ? [process.argv[index + 1] ?? ''] : []);
  const defaultPublicationArtifact = relative(resolve('.'), DEFAULT_OUTPUT).replace(/\\/g, '/');
  const publicationArtifacts = mode === 'validate'
    ? (committed?.authority?.publicationBundle?.artifactPaths ?? [defaultPublicationArtifact])
    : [defaultPublicationArtifact, ...requestedPublicationArtifacts];
   const targetHead = mode === 'validate' && isPublicationOnlyDelta(committedSnapshot, currentTargetHead, publicationArtifacts)
     ? committedSnapshot
     : currentTargetHead;
   const originMain = selectCompletionObservationOrigin(
     String(committed?.authority?.originMain ?? ''),
     liveOriginMain,
     targetHead,
     committedSnapshot
   );
  // A sealed evidence projection must be reproducible for an unchanged target
  // tree.  Wall-clock generation time would alter Reviewer B's input digest on
  // every write and create a matrix -> review -> certificate -> matrix loop.
  // Bind the observation timestamp to the sealed target commit instead.
  const generatedAt = mode === 'validate'
    ? String(committed?.generatedAt ?? '')
    : git(resolve('.'), ['show', '-s', '--format=%cI', currentTargetHead]);
  const planningSourceAtHead = gitRaw(DEFAULT_PLANNING_ROOT, ['show', `${planningHead}:${RUNBOOK_RELATIVE_PATH}`]);
  const planningDirty = git(DEFAULT_PLANNING_ROOT, ['status', '--porcelain', '--', RUNBOOK_RELATIVE_PATH]);
  const authorityDiagnostics = [
    ...(planningDirty ? ['planning-runbook-dirty'] : []),
    ...(planningSourceAtHead === null || digestText(planningSourceAtHead) !== digestText(source)
      ? ['planning-runbook-head-digest-mismatch']
      : [])
  ];
  const report = compileRunbookCompletion(source, planningHead, targetHead, originMain, observeFinalCertificate(targetHead), generatedAt, authorityDiagnostics, publicationArtifacts);
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (mode === 'write') {
    writeFileSync(DEFAULT_OUTPUT, serialized, 'utf8');
  } else if (committed === null || readFileSync(DEFAULT_OUTPUT, 'utf8') !== serialized) {
    console.error('[compile-runbook-completion-evidence] canonical report is stale; rerun with --mode write');
    process.exitCode = 1;
  }
  console.log(`[compile-runbook-completion-evidence] ${report.overallVerdict} rows=${report.rows.length} exits=${report.waveExits.length} unresolved=${report.unresolvedIds.length}`);
  }
}
