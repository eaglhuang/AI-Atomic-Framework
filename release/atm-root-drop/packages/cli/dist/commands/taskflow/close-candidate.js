import { createHash, randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, readlinkSync, rmSync } from 'node:fs';
import path from 'node:path';
import { candidateGit, nulPaths, resolveCandidateFiles } from '../git-governance/implementation/candidate-file-policy.js';
import { inspectGitIndexOwnership } from '../git-index-ownership.js';
import { CliError } from '../shared.js';
import { closeAttemptPaths, writeCloseAtomic } from './close-attempt.js';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const head = (root) => candidateGit(root, ['rev-parse', 'HEAD']).trim();
function generation(cwd, taskId) {
    const doc = JSON.parse(readFileSync(path.join(cwd, '.atm/history/tasks', `${taskId}.json`), 'utf8'));
    const claim = doc.claim ?? {}, direction = doc.taskDirectionLock ?? {};
    return hash(JSON.stringify({ status: doc.status, actor: claim.actorId, lease: claim.leaseId, claimedAt: claim.claimedAt,
        lane: claim.laneSession?.laneSessionId, scope: doc.scopePaths, deliverables: doc.deliverables, allowed: doc.targetAllowedFiles,
        direction: direction.allowedFiles, source: doc.source }));
}
function index(root, taskId) {
    const files = nulPaths(candidateGit(root, ['diff', '--cached', '--no-renames', '--name-only', '-z']));
    return [...inspectGitIndexOwnership({ cwd: root, taskId, stagedFiles: files }).entries].sort((a, b) => a.path.localeCompare(b.path));
}
function contents(root, file) {
    const absolute = path.join(root, file);
    try {
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink())
            return { file, digest: hash(readlinkSync(absolute)), mode: '120000' };
        if (!stat.isFile())
            throw new Error(`Unsafe close candidate: ${file}`);
        return { file, digest: hash(readFileSync(absolute)), mode: stat.mode & 0o111 ? '100755' : '100644' };
    }
    catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(String(error.code)))
            return { file, digest: 'deleted', mode: 'deleted' };
        throw error;
    }
}
function manifest(repo) {
    return resolveCandidateFiles(repo.root, repo.selectors, { declaredPaths: repo.declared }).sort().map((file) => contents(repo.root, file));
}
function changed(what) {
    throw new CliError('ATM_CLOSE_CANDIDATE_CHANGED', `Close preparation is stale (${what}); no close write is allowed. Rerun pre-close and retry.`, { exitCode: 1 });
}
export function readCloseCandidateAnchor(cwd, taskId) {
    return { head: head(cwd), generation: generation(cwd, taskId) };
}
/** Resolve exact candidates, hash their content/mode and inspect ownership before
 * acquiring any close-window lock. No validator or digest is omitted for speed. */
export function prepareCloseCandidate(input) {
    const current = readCloseCandidateAnchor(input.cwd, input.taskId);
    if (input.anchor && JSON.stringify(input.anchor) !== JSON.stringify(current))
        changed('HEAD or claim/task generation during preparation');
    const repositories = [];
    for (const part of [input.bundle.targetRepo, input.bundle.planningRepo]) {
        if (!part.repoRoot)
            continue;
        let repo = repositories.find((entry) => entry.root === part.repoRoot);
        if (!repo) {
            repo = { root: part.repoRoot, head: head(part.repoRoot), selectors: [], declared: [], files: [], index: index(part.repoRoot, input.taskId) };
            repositories.push(repo);
        }
        repo.selectors.push(...part.stageFiles, ...(part === input.bundle.targetRepo ? input.scopeFiles ?? [] : []));
        repo.declared.push(...part.declaredPaths ?? []);
        repo.selectors = [...new Set(repo.selectors)].sort();
        repo.declared = [...new Set(repo.declared)].sort();
    }
    for (const repo of repositories)
        repo.files = manifest(repo);
    const attemptId = process.env.ATM_CLOSE_ATTEMPT_TASK === input.taskId ? process.env.ATM_CLOSE_ATTEMPT_ID ?? randomUUID() : randomUUID();
    const snapshot = { schemaId: 'atm.closeCandidate.v1', taskId: input.taskId, cwd: input.cwd,
        generation: current.generation, attemptId, preparedAt: new Date().toISOString(), repositories };
    // The recovery lane can identify precisely what was prepared even if the
    // worker dies before taking the index window or writing the task ledger.
    const file = closeAttemptPaths(input.cwd, input.taskId, attemptId).record.replace(/\.json$/, '.candidate.json');
    writeCloseAtomic(file, `${JSON.stringify(snapshot, null, 2)}\n`);
    return snapshot;
}
export function assertCloseCandidate(snapshot, input = {}) {
    if (generation(snapshot.cwd, snapshot.taskId) !== snapshot.generation)
        changed('claim/task generation');
    const parked = new Set(input.parkedPaths ?? []), deferred = new Set(input.deferredFiles ?? []);
    for (const file of deferred)
        if (!file.startsWith('.atm/history/evidence/'))
            changed('unexpected deferred candidate');
    for (const repo of snapshot.repositories) {
        if (head(repo.root) !== repo.head)
            changed(`HEAD in ${repo.root}`);
        const filterFiles = (files) => files.filter((entry) => repo.root !== snapshot.cwd || !deferred.has(entry.file));
        if (JSON.stringify(filterFiles(manifest(repo))) !== JSON.stringify(filterFiles(repo.files)))
            changed(`candidate digest/mode in ${repo.root}`);
        const filterIndex = (entries) => entries.filter((entry) => repo.root !== snapshot.cwd || !parked.has(entry.path));
        if (JSON.stringify(filterIndex(index(repo.root, snapshot.taskId))) !== JSON.stringify(filterIndex(repo.index)))
            changed(`index ownership/content in ${repo.root}`);
    }
}
export function clearCloseCandidate(snapshot) {
    rmSync(closeAttemptPaths(snapshot.cwd, snapshot.taskId, snapshot.attemptId).record.replace(/\.json$/, '.candidate.json'), { force: true });
}
