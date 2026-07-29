import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type ProposalWorkspaceProviderMode = 'bounded-proposal-tree';

export type ProposalWorkspaceProviderVersion = 'atm.teamProposalWorkspaceProvider.v1';

export type ProposalWorkspaceDeclaredIntent = {
  readonly file: string;
  readonly intent: 'read' | 'write';
  readonly atomId?: string | null;
  readonly anchor?: string | null;
  readonly range?: {
    readonly startLine: number;
    readonly endLine: number;
  } | null;
};

export type ProposalWorkspaceBaseBlob = {
  readonly path: string;
  readonly sha256: string;
  readonly byteLength: number;
  readonly materialized: boolean;
};

export type TeamProposalWorkspaceProviderPlan = {
  readonly schemaId: ProposalWorkspaceProviderVersion;
  readonly mode: ProposalWorkspaceProviderMode;
  readonly providerVersion: 1;
  readonly canonicalRoot: string;
  readonly baseCommit: string;
  readonly baseTreeDigest: string;
  readonly headDigest: string;
  readonly declaredFiles: readonly string[];
  readonly declaredIntents: readonly ProposalWorkspaceDeclaredIntent[];
  readonly immutableBaseBlobs: readonly ProposalWorkspaceBaseBlob[];
  readonly proposalRoot: string;
  readonly outputManifestPath: string;
  readonly cleanupRequired: true;
  readonly canMutateCanonicalWorktree: false;
  readonly stewardWritePath: true;
  readonly workerOutputSchemas: readonly ['atm.patchProposal.v1', 'atm.teamMutationRequest.v1'];
  readonly unsupportedGitTopology: readonly ['branch', 'worktree', 'merge', 'rebase', 'alternate-index'];
};

export type ProvisionedTeamProposalWorkspace = TeamProposalWorkspaceProviderPlan & {
  readonly repoRoot: string;
  readonly tempRoot: string;
  readonly workspacePath: string;
  readonly manifestPath: string;
  readonly env: Record<string, never>;
};

export type ProposalWorkspaceAccessCheck = {
  readonly ok: boolean;
  readonly undeclaredFiles: readonly string[];
  readonly allowedFiles: readonly string[];
  readonly queueOnlyRequired: boolean;
  readonly reason: string | null;
};

export function createTeamProposalWorkspaceProviderPlan(input: {
  readonly repoRoot?: string;
  readonly baseCommit: string;
  readonly declaredFiles?: readonly string[];
  readonly declaredIntents?: readonly ProposalWorkspaceDeclaredIntent[];
  readonly proposalRoot?: string;
  readonly baseTreeDigest?: string;
  readonly headDigest?: string;
}): TeamProposalWorkspaceProviderPlan {
  const canonicalRoot = normalizeHostPath(input.repoRoot ?? process.cwd());
  const declaredFiles = uniqueSorted([
    ...(input.declaredFiles ?? []),
    ...(input.declaredIntents ?? []).map((intent) => intent.file)
  ].map(normalizeRelativePath).filter(Boolean));
  const proposalRoot = normalizeHostPath(input.proposalRoot ?? path.join(os.tmpdir(), 'atm-team-proposal-unmaterialized'));
  const immutableBaseBlobs = collectImmutableBaseBlobs(canonicalRoot, declaredFiles);
  const baseTreeDigest = input.baseTreeDigest ?? digestJson({
    baseCommit: input.baseCommit,
    files: immutableBaseBlobs.map((blob) => ({ path: blob.path, sha256: blob.sha256, materialized: blob.materialized }))
  });
  const headDigest = input.headDigest ?? digestJson({
    canonicalRoot,
    baseCommit: input.baseCommit,
    declaredFiles,
    baseTreeDigest
  });

  return {
    schemaId: 'atm.teamProposalWorkspaceProvider.v1',
    mode: 'bounded-proposal-tree',
    providerVersion: 1,
    canonicalRoot,
    baseCommit: input.baseCommit,
    baseTreeDigest,
    headDigest,
    declaredFiles,
    declaredIntents: normalizeDeclaredIntents(input.declaredIntents ?? declaredFiles.map((file) => ({ file, intent: 'write' as const }))),
    immutableBaseBlobs,
    proposalRoot,
    outputManifestPath: path.join(proposalRoot, 'proposal-workspace.manifest.json'),
    cleanupRequired: true,
    canMutateCanonicalWorktree: false,
    stewardWritePath: true,
    workerOutputSchemas: ['atm.patchProposal.v1', 'atm.teamMutationRequest.v1'],
    unsupportedGitTopology: ['branch', 'worktree', 'merge', 'rebase', 'alternate-index']
  };
}

export function provisionTeamProposalWorkspace(input: {
  readonly repoRoot: string;
  readonly baseCommit: string;
  readonly declaredFiles: readonly string[];
  readonly declaredIntents?: readonly ProposalWorkspaceDeclaredIntent[];
  readonly tempRoot?: string;
}): ProvisionedTeamProposalWorkspace {
  const repoRoot = path.resolve(input.repoRoot);
  const tempRoot = input.tempRoot
    ? path.resolve(input.tempRoot)
    : mkdtempSync(path.join(os.tmpdir(), 'atm-team-proposal-'));
  const workspacePath = path.join(tempRoot, 'proposal');
  mkdirSync(workspacePath, { recursive: true });

  const plan = createTeamProposalWorkspaceProviderPlan({
    repoRoot,
    baseCommit: input.baseCommit,
    declaredFiles: input.declaredFiles,
    declaredIntents: input.declaredIntents,
    proposalRoot: workspacePath
  });

  // Workers receive immutable base blobs in an isolated proposal tree; the
  // canonical worktree remains steward-owned until composition succeeds.
  for (const blob of plan.immutableBaseBlobs) {
    if (!blob.materialized) continue;
    const source = path.join(repoRoot, blob.path);
    const target = path.join(workspacePath, blob.path);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  writeFileSync(plan.outputManifestPath, `${JSON.stringify(plan, null, 2)}\n`, 'utf8');

  return {
    ...plan,
    repoRoot,
    tempRoot,
    workspacePath,
    manifestPath: plan.outputManifestPath,
    env: {}
  };
}

export function cleanupTeamProposalWorkspace(workspace: Pick<ProvisionedTeamProposalWorkspace, 'tempRoot'>): void {
  rmSync(workspace.tempRoot, { recursive: true, force: true });
}

export function checkProposalWorkspaceAccess(input: {
  readonly declaredFiles: readonly string[];
  readonly requestedFiles: readonly string[];
}): ProposalWorkspaceAccessCheck {
  const allowed = new Set(input.declaredFiles.map(normalizeRelativePath).filter(Boolean));
  const requested = uniqueSorted(input.requestedFiles.map(normalizeRelativePath).filter(Boolean));
  const undeclaredFiles = requested.filter((file) => !allowed.has(file));
  return {
    ok: undeclaredFiles.length === 0,
    undeclaredFiles,
    allowedFiles: [...allowed].sort((left, right) => left.localeCompare(right)),
    queueOnlyRequired: undeclaredFiles.length > 0,
    reason: undeclaredFiles.length > 0
      ? 'proposal workspace requested files outside declared scope; broker re-arbitration is required'
      : null
  };
}

export function normalizeProposalWorkerOutput(input: {
  readonly taskId: string;
  readonly baseCommit: string;
  readonly declaredFiles: readonly string[];
  readonly changedFiles: readonly string[];
  readonly mutations?: readonly unknown[];
}): {
  readonly schemaId: 'atm.teamMutationRequest.v1';
  readonly taskId: string;
  readonly baseCommit: string;
  readonly changedFiles: readonly string[];
  readonly mutations: readonly unknown[];
  readonly access: ProposalWorkspaceAccessCheck;
  readonly stewardRequired: true;
} {
  const access = checkProposalWorkspaceAccess({
    declaredFiles: input.declaredFiles,
    requestedFiles: input.changedFiles
  });
  return {
    schemaId: 'atm.teamMutationRequest.v1',
    taskId: input.taskId,
    baseCommit: input.baseCommit,
    changedFiles: uniqueSorted(input.changedFiles.map(normalizeRelativePath).filter(Boolean)),
    mutations: input.mutations ?? [],
    access,
    stewardRequired: true
  };
}

function collectImmutableBaseBlobs(canonicalRoot: string, declaredFiles: readonly string[]): ProposalWorkspaceBaseBlob[] {
  return declaredFiles.map((relative) => {
    const filePath = path.join(canonicalRoot, relative);
    if (!existsSync(filePath)) {
      return { path: relative, sha256: digestBuffer(Buffer.alloc(0)), byteLength: 0, materialized: false };
    }
    const body = readFileSync(filePath);
    return { path: relative, sha256: digestBuffer(body), byteLength: body.byteLength, materialized: true };
  });
}

function normalizeDeclaredIntents(intents: readonly ProposalWorkspaceDeclaredIntent[]): ProposalWorkspaceDeclaredIntent[] {
  return intents
    .map((intent) => ({ ...intent, file: normalizeRelativePath(intent.file) }))
    .filter((intent) => intent.file.length > 0)
    .sort((left, right) => `${left.file}:${left.intent}`.localeCompare(`${right.file}:${right.intent}`));
}

function normalizeRelativePath(value: string): string {
  return String(value).replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function normalizeHostPath(value: string): string {
  return path.resolve(value).replace(/\\/g, '/');
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function digestJson(value: unknown): string {
  return digestBuffer(Buffer.from(JSON.stringify(value)));
}

function digestBuffer(value: Buffer): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
