import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gitHeadEvidencePath, gitHeadEvidencePaths } from '../../git-head-evidence.js';
import { readFrameworkVersion } from '../../shared.js';
import { hookProvider, hookContractVersion } from '../git-hooks-installer.js';
import { normalizeRelativePath, runGit, runGitLines } from '../git-index-diagnostics.js';
import { findFutureCommitEvidenceMatchInWorktree, normalizeOptionalText, readCurrentHeadForFutureCommit, readGitObjectText, readJsonText, readStagedTreeWithoutEvidence } from '../commit-range-guard.js';
const textFileExtensions = new Set([
    '.cjs', '.css', '.html', '.js', '.json', '.jsx', '.md', '.mjs', '.ps1', '.sh', '.ts', '.tsx', '.txt', '.yaml', '.yml'
]);
function uniqueSorted(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
export function readStagedFiles(cwd) {
    return uniqueSorted(runGitLines(cwd, ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'])
        .map(normalizeRelativePath)
        .filter(Boolean));
}
export function readStagedChangedLineCount(cwd, files) {
    if (files.length === 0)
        return 0;
    const lines = runGitLines(cwd, ['diff', '--cached', '--numstat', '--', ...files]);
    let total = 0;
    for (const line of lines) {
        const [added, deleted] = line.split('\t');
        const addedCount = Number.parseInt(added, 10);
        const deletedCount = Number.parseInt(deleted, 10);
        if (Number.isFinite(addedCount))
            total += addedCount;
        if (Number.isFinite(deletedCount))
            total += deletedCount;
    }
    return total;
}
export function scanEncoding(cwd, files) {
    const findings = [];
    for (const file of files) {
        if (!isTextFile(file))
            continue;
        const absolutePath = path.join(cwd, file);
        if (!existsSync(absolutePath))
            continue;
        const buffer = readFileSync(absolutePath);
        const text = buffer.toString('utf8');
        if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
            findings.push({ file, issue: 'utf8-bom' });
        }
        if (text.includes('\uFFFD')) {
            findings.push({ file, issue: 'replacement-character' });
        }
        if (/[\u00c3\u00e2\u00e5].|\u749d.|\u7587.|\u765f./.test(text)) {
            findings.push({ file, issue: 'possible-mojibake' });
        }
    }
    return {
        schemaId: 'atm.encodingHookReport.v1',
        inspectedFileCount: files.filter(isTextFile).length,
        findings,
        ok: findings.length === 0
    };
}
export function inspectTaskCardStatusChanges(cwd, stagedFiles) {
    const findings = [];
    for (const file of stagedFiles) {
        if (!isTaskCardMarkdownPath(file))
            continue;
        const stagedText = readGitObjectText(cwd, `:${file}`);
        if (!stagedText)
            continue;
        const nextStatus = parseMarkdownTaskCardStatus(stagedText);
        if (!isDoneLikeTaskCardStatus(nextStatus))
            continue;
        const headText = readGitObjectText(cwd, `HEAD:${file}`);
        const previousStatus = headText ? parseMarkdownTaskCardStatus(headText) : null;
        if (isDoneLikeTaskCardStatus(previousStatus))
            continue;
        const taskId = parseMarkdownTaskCardId(stagedText, file);
        if (hasLocalLedgerClosure(cwd, taskId) || hasClosureSyncAttestation(stagedText))
            continue;
        findings.push({
            file,
            taskId,
            previousStatus,
            nextStatus: nextStatus ?? 'done',
            reason: 'planning-card-done-without-ledger-closure',
            detail: `Task card ${file} changes status to done, but ATM could not verify a matching task ledger closure packet. Planning cards are mirrors; close the task through ATM before syncing status.`,
            requiredCommand: `node atm.mjs next --prompt ${JSON.stringify(taskId)} --json`
        });
    }
    return {
        schemaId: 'atm.taskCardStatusPreCommitReport.v1',
        inspectedFileCount: stagedFiles.filter(isTaskCardMarkdownPath).length,
        findings,
        ok: findings.length === 0
    };
}
function isTaskCardMarkdownPath(file) {
    return normalizeRelativePath(file).toLowerCase().endsWith('.task.md');
}
function parseMarkdownTaskCardStatus(text) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? text.slice(0, 2000);
    const match = /^status:\s*['"]?([^'"\r\n#]+)['"]?\s*$/im.exec(frontmatter);
    return match ? match[1].trim().toLowerCase() : null;
}
function parseMarkdownTaskCardId(text, file) {
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? text.slice(0, 2000);
    const match = /^(?:task_id|taskId|workItemId|id):\s*['"]?([^'"\r\n#]+)['"]?\s*$/im.exec(frontmatter);
    const fallback = path.basename(file).replace(/\.task\.md$/i, '');
    return (match?.[1]?.trim() || fallback).toUpperCase();
}
function isDoneLikeTaskCardStatus(status) {
    return status === 'done' || status === 'verified';
}
function hasLocalLedgerClosure(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return false;
    try {
        const parsed = readJsonText(readFileSync(taskPath, 'utf8'));
        if (!parsed || !isDoneLikeTaskCardStatus(normalizeOptionalText(parsed.status)?.toLowerCase() ?? null))
            return false;
        const closurePacket = normalizeOptionalText(parsed.closurePacket ?? parsed.closure_packet);
        if (!closurePacket)
            return false;
        return existsSync(path.join(cwd, closurePacket));
    }
    catch {
        return false;
    }
}
function hasClosureSyncAttestation(text) {
    return /Closure sync:/i.test(text)
        && /\.closure-packet\.json/i.test(text)
        && /\b[0-9a-f]{7,40}\b/i.test(text);
}
export function shouldWriteGitHeadEvidenceForStagedCommit(input) {
    if (input.stagedFiles.length === 0)
        return false;
    if (input.criticalChangedFiles.length > 0)
        return true;
    return input.stagedFiles.some((file) => isGovernedLedgerBoundaryPath(file));
}
function isGovernedLedgerBoundaryPath(filePath) {
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    if (normalized === gitHeadEvidencePaths.legacyJson || normalized === gitHeadEvidencePaths.jsonl) {
        return false;
    }
    return normalized.startsWith('.atm/history/tasks/')
        || normalized.startsWith('.atm/history/task-events/')
        || /^\.atm\/history\/evidence\/[^/]+\.(?:closure-packet|bundle-manifest)\.json$/.test(normalized);
}
export function writeStagedGitHeadEvidence(cwd, stagedFiles, commandRuns) {
    const treeSha = readStagedTreeWithoutEvidence(cwd);
    const parentCommitShas = readCurrentHeadForFutureCommit(cwd);
    const generatedAt = new Date().toISOString();
    const evidenceAbsolute = path.join(cwd, gitHeadEvidencePath);
    const existingMatch = findFutureCommitEvidenceMatchInWorktree(cwd, treeSha, parentCommitShas);
    if (existingMatch) {
        const addResult = runGit(cwd, ['add', '--', gitHeadEvidencePath]);
        return {
            evidencePath: gitHeadEvidencePath,
            treeSha,
            parentCommitShas,
            gitAddExitCode: addResult.exitCode,
            ok: addResult.exitCode === 0,
            reusedExisting: true
        };
    }
    mkdirSync(path.dirname(evidenceAbsolute), { recursive: true });
    const payload = {
        schemaVersion: 'atm.gitHeadEvidence.v0.1',
        evidence: [
            {
                evidenceKind: 'validation',
                summary: 'Git commit tree is covered by ATM Integration Hook Contract v1.',
                artifactPaths: [],
                createdAt: generatedAt,
                producedBy: hookProvider,
                commandRuns,
                details: {
                    git: {
                        treeSha,
                        parentCommitShas,
                        stagedPathCount: stagedFiles.length,
                        evidencePath: gitHeadEvidencePath,
                        generatedAt
                    },
                    hookContractVersion,
                    runnerVersion: readFrameworkVersion(cwd)
                }
            }
        ]
    };
    appendFileSync(evidenceAbsolute, `${JSON.stringify(payload)}\n`, 'utf8');
    const addResult = runGit(cwd, ['add', '--', gitHeadEvidencePath]);
    return {
        evidencePath: gitHeadEvidencePath,
        treeSha,
        parentCommitShas,
        gitAddExitCode: addResult.exitCode,
        ok: addResult.exitCode === 0
    };
}
function isTextFile(filePath) {
    return textFileExtensions.has(path.extname(filePath).toLowerCase())
        || path.basename(filePath).includes('AGENTS')
        || path.basename(filePath).includes('README');
}
