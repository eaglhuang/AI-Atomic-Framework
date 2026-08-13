import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

export const RUNBOOK_RELATIVE_PATH = 'docs/ai_atomic_framework/governance-optimization/plan-3x-4x-false-green-correction-complete-closeout-runbook-2026-08-09.md';
export const DEFAULT_PLANNING_ROOT = process.env.ATM_PLANNING_REPO_ROOT
  ? resolve(process.env.ATM_PLANNING_REPO_ROOT)
  : resolve('..', '3KLife');
export const DEFAULT_OUTPUT = resolve('docs/reports/plan-3x-4x-runbook-completion-evidence.json');
export const DEFAULT_CERTIFICATE = resolve('docs/reports/plan-3x-4x-independent-certificate.json');

type EvidenceTuple = { command: string; exitCode: number; outputDigest: string; artifactPaths: string[]; observedAt: string; sourceCommit: string; evidenceOwner: string };
type CompletionRow = { itemId: string; sourceLine: number; section: string; wave: string | null; requirement: string; requirementDigest: string; status: 'proven' | 'unproven'; evidence: EvidenceTuple[]; diagnostics: string[]; coverageOwners?: string[] };

export const digestText = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

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

type CardContract = { taskId: string; wave: string | null; phase: string; validators: string[] };

function discoverCardContracts(runbookSource: string): CardContract[] {
  const taskDir = resolve(DEFAULT_PLANNING_ROOT, dirname(RUNBOOK_RELATIVE_PATH), 'tasks');
  if (!existsSync(taskDir)) return [];
  const registeredIds = new Set([...runbookSource.matchAll(/^\|\s*\d+\s*\|\s*`(ATM-GOV-\d+)`/gm)].map((match) => match[1]));
  return readdirSync(taskDir).filter((name) => /^ATM-GOV-\d+-.+\.task\.md$/.test(name)).flatMap((name) => {
    const source = readFileSync(resolve(taskDir, name), 'utf8');
    const taskId = /^task_id:\s*(\S+)/m.exec(source)?.[1];
    if (!taskId || !registeredIds.has(taskId) || !source.includes(`related_plan: governance-optimization/${basename(RUNBOOK_RELATIVE_PATH)}`)) return [];
    const phase = /^\s*phaseOwner:\s*(\S+)/m.exec(source)?.[1] ?? '';
    const waveNumber = /wave-(\d+)/i.exec(phase)?.[1];
    const block = /^validators:\s*\r?\n((?:\s+- .+\r?\n)+)/m.exec(source)?.[1] ?? '';
    const validators = [...block.matchAll(/^\s+-\s+(.+)$/gm)].map((match) => match[1].trim());
    return [{ taskId, wave: waveNumber ? `Wave ${Number(waveNumber)}` : null, phase, validators }];
  });
}

function contractsForRow(row: CompletionRow, contracts: CardContract[]): CardContract[] {
  if (row.wave) return contracts.filter((contract) => contract.wave === row.wave);
  const requirement = row.requirement;
  if (row.section === 'Authority and governance') return contracts.filter((contract) => /^correction-wave-[0-2]$/.test(contract.phase));
  if (row.section === 'Objective evidence') {
    if (/Plan 3\.0/.test(requirement)) return contracts.filter((contract) => contract.phase.endsWith('plan30'));
    if (/Plan 3\.1/.test(requirement)) return contracts.filter((contract) => contract.phase.endsWith('plan31'));
    if (/Plan 3\.2/.test(requirement)) return contracts.filter((contract) => contract.phase.endsWith('plan32'));
    if (/Plan 4\.0/.test(requirement)) return contracts.filter((contract) => contract.phase === 'closeout-wave-7');
    if (/86\/86/.test(requirement)) return contracts.filter((contract) => /^closeout-wave-6-|^correction-wave-5$|^closeout-wave-7$/.test(contract.phase));
    return contracts.filter((contract) => /^correction-wave-4-|^closeout-wave-7$/.test(contract.phase));
  }
  if (row.section === 'Real execution and dashboard') {
    if (/shadow/.test(requirement)) return contracts.filter((contract) => contract.phase.endsWith('shadow'));
    if (/六 adapter/.test(requirement)) return contracts.filter((contract) => contract.phase.endsWith('adapters'));
    if (/hostile|A\/A|AB\/BA/.test(requirement)) return contracts.filter((contract) => contract.phase.endsWith('dogfood'));
    return contracts.filter((contract) => contract.phase === 'correction-wave-5');
  }
  if (row.section === 'Tests, backlog and release') {
    if (/timeout|120 秒|hash-placeholder/.test(requirement)) return contracts.filter((contract) => contract.phase === 'correction-wave-3-performance');
    if (/catalog|neutrality|coverage/.test(requirement)) return contracts.filter((contract) => contract.phase === 'correction-wave-3-ci');
    if (/backlog|2026-/.test(requirement)) return contracts.filter((contract) => contract.phase === 'closeout-wave-9');
    return contracts.filter((contract) => contract.phase === 'closeout-wave-10');
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
  const expectedCommands = new Set(contracts.flatMap((contract) => contract.validators));
  const expectedOwners = new Set(contracts.map((contract) => contract.taskId));
  const cacheKey = `${targetHead}:${[...expectedCommands].sort().join('\u0000')}`;
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
        tuples.push({ command: run.command, exitCode: run.exitCode, outputDigest, artifactPaths: [evidencePath, ...(entry.artifactPaths ?? [])], observedAt: run.finishedAt ?? entry.createdAt, sourceCommit, evidenceOwner: owner });
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
  return tuple.evidenceOwner === contract.taskId && contract.validators.includes(tuple.command);
}

function hydrate(row: CompletionRow, contracts: CardContract[], targetHead: string): CompletionRow {
  const evidence = evidenceForContracts(contracts, targetHead);
  const owners = contracts.map((contract) => contract.taskId);
  const uncoveredOwners = contracts.filter((contract) => evidenceForContracts([contract], targetHead).length === 0).map((contract) => contract.taskId);
  const proven = contracts.length > 0 && uncoveredOwners.length === 0;
  return { ...row, coverageOwners: owners, evidence, status: proven ? 'proven' : 'unproven', diagnostics: proven ? [] : [`missing-command-backed-evidence:${uncoveredOwners.join(',') || 'no-contract'}`] };
}

function observeFinalCertificate(): { proven: boolean; diagnostics: string[] } {
  if (!existsSync(DEFAULT_CERTIFICATE)) return { proven: false, diagnostics: ['final-certificate-missing'] };
  try {
    const certificate = JSON.parse(readFileSync(DEFAULT_CERTIFICATE, 'utf8'));
    const pending = JSON.stringify(certificate).includes('pending-self-digest');
    const diagnostics = Array.isArray(certificate.diagnostics) ? certificate.diagnostics : ['final-certificate-diagnostics-invalid'];
    const proven = certificate.status === 'proven'
      && certificate.overallVerdict === 'complete'
      && certificate.releaseAuthorized === true
      && diagnostics.length === 0
      && !pending;
    return { proven, diagnostics: proven ? [] : ['final-certificate-not-proven', ...diagnostics] };
  } catch {
    return { proven: false, diagnostics: ['final-certificate-unreadable'] };
  }
}

function requiresFinalCertificate(row: CompletionRow): boolean {
  return row.wave === 'Wave 10'
    || (row.section === 'Tests, backlog and release' && /runner sync queue|remote-reachable|closeback receipt|final certificate/.test(row.requirement));
}

export function compileRunbookCompletion(
  source: string,
  planningHead: string,
  targetHead: string,
  originMain: string,
  finalCertificate = observeFinalCertificate(),
  generatedAt = new Date().toISOString(),
  authorityDiagnostics: string[] = []
) {
  const parsed = parseRunbook(source);
  const contracts = discoverCardContracts(source);
  parsed.rows = parsed.rows.map((row) => {
    const hydrated = hydrate(row, contractsForRow(row, contracts), targetHead);
    return requiresFinalCertificate(row) && !finalCertificate.proven
      ? { ...hydrated, status: 'unproven' as const, diagnostics: finalCertificate.diagnostics }
      : hydrated;
  });
  const rowsByWave = new Map<string, CompletionRow[]>();
  for (const row of parsed.rows) if (row.wave) rowsByWave.set(row.wave, [...(rowsByWave.get(row.wave) ?? []), row]);
  parsed.waveExits = parsed.waveExits.map((row) => {
    const basis = rowsByWave.get(row.wave ?? '') ?? [];
    const contractsForWave = contracts.filter((contract) => contract.wave === row.wave);
    const hydrated = hydrate(row, contractsForWave, targetHead);
    const basisKeys = new Set(basis.flatMap((item) => item.evidence).map(evidenceTupleKey));
    const independentEvidence = hydrated.evidence.filter((tuple) => !basisKeys.has(evidenceTupleKey(tuple)));
    const uncoveredOwners = contractsForWave
      .filter((contract) => !independentEvidence.some((tuple) => evidenceBelongsToContract(tuple, contract)))
      .map((contract) => contract.taskId);
    const independentlySatisfied = (basis.length === 0 || basis.every((item) => item.status === 'proven'))
      && contractsForWave.length > 0
      && uncoveredOwners.length === 0;
    return independentlySatisfied
      ? { ...hydrated, evidence: independentEvidence, diagnostics: [] }
      : { ...hydrated, evidence: independentEvidence, status: 'unproven' as const, diagnostics: [
          ...(basis.some((item) => item.status !== 'proven') ? ['wave-requirement-basis-not-proven'] : []),
          ...(uncoveredOwners.length ? [`missing-independent-wave-exit-evidence:${uncoveredOwners.join(',')}`] : [])
        ] };
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
    authority: { planningPath: RUNBOOK_RELATIVE_PATH, planningHead, targetHead, originMain, sourceDigest: digestText(source), diagnostics: authorityDiagnostics },
    expectedItemCount: parsed.rows.length, rows: parsed.rows, waveExits: parsed.waveExits,
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
  const planningHead = process.env.ATM_PLANNING_HEAD ?? git(DEFAULT_PLANNING_ROOT, ['rev-parse', 'HEAD']);
  const targetHead = process.env.ATM_TARGET_HEAD ?? git(resolve('.'), ['rev-parse', 'HEAD']);
  const originMain = process.env.ATM_ORIGIN_MAIN ?? git(resolve('.'), ['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] ?? 'unknown';
  const committed = mode === 'validate' && existsSync(DEFAULT_OUTPUT)
    ? JSON.parse(readFileSync(DEFAULT_OUTPUT, 'utf8'))
    : null;
  const generatedAt = mode === 'validate' ? String(committed?.generatedAt ?? '') : new Date().toISOString();
  const planningSourceAtHead = gitRaw(DEFAULT_PLANNING_ROOT, ['show', `${planningHead}:${RUNBOOK_RELATIVE_PATH}`]);
  const planningDirty = git(DEFAULT_PLANNING_ROOT, ['status', '--porcelain', '--', RUNBOOK_RELATIVE_PATH]);
  const authorityDiagnostics = [
    ...(planningDirty ? ['planning-runbook-dirty'] : []),
    ...(planningSourceAtHead === null || digestText(planningSourceAtHead) !== digestText(source)
      ? ['planning-runbook-head-digest-mismatch']
      : [])
  ];
  const report = compileRunbookCompletion(source, planningHead, targetHead, originMain, observeFinalCertificate(), generatedAt, authorityDiagnostics);
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
