import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const gitHeadEvidencePath = '.atm/history/evidence/git-head.json';

export function createGitHeadEvidenceCheck(cwd: any, runtime: any) {
  const workTree = readGitWorkTree(cwd);
  if (!workTree.ok) {
    return createGitEvidenceDetails('not-git', {
      reason: workTree.reason
    });
  }

  if (!hasAtmRuntime(cwd, runtime)) {
    return createGitEvidenceDetails('not-adopted', {
      workTreeRoot: workTree.root
    });
  }

  const head = runGit(cwd, ['rev-parse', '--verify', 'HEAD']);
  if (!head.ok) {
    return createGitEvidenceDetails('no-commits', {
      workTreeRoot: workTree.root,
      reason: head.stderr || head.stdout
    });
  }

  const commitSha = head.stdout.trim();
  const parentCommitShas = readParentCommitShas(cwd);
  const treeSha = readGitScalar(cwd, ['rev-parse', `${commitSha}^{tree}`]);
  const governedTreeSha = readGovernedHeadTreeSha(cwd, commitSha, gitHeadEvidencePath) ?? treeSha;
  const evidenceRecords = readEvidenceRecords(cwd, runtime);
  const commitMatch = evidenceRecords.find((entry: any) => entry.git.commitSha === commitSha);
  const treeMatch = commitMatch
    ? null
    : evidenceRecords.find((entry: any) => {
      const evidenceTreeSha = entry.git.treeSha;
      return Boolean(evidenceTreeSha)
        && (evidenceTreeSha === governedTreeSha || evidenceTreeSha === treeSha)
        && sameStringSet(entry.git.parentCommitShas, parentCommitShas);
    });
  const matchedRecord = commitMatch ?? treeMatch ?? null;
  const matchedBy = commitMatch ? 'commitSha' : treeMatch ? 'treeSha+parentCommitShas' : null;
  const ok = matchedRecord !== null;

  return createGitEvidenceDetails(ok ? 'matched' : 'missing', {
    workTreeRoot: workTree.root,
    commitSha,
    treeSha,
    governedTreeSha,
    parentCommitShas,
    expectedEvidencePath: gitHeadEvidencePath,
    evidenceRecordsScanned: evidenceRecords.length,
    matchedBy,
    matchedEvidencePath: matchedRecord?.path ?? null
  }, ok);
}

function createGitEvidenceDetails(status: any, details: any, ok = true) {
  return {
    name: 'git-head-evidence',
    ok,
    details: {
      status,
      ...details
    }
  };
}

function hasAtmRuntime(cwd: any, runtime: any) {
  return Boolean(runtime?.config)
    || existsSync(path.join(cwd, '.atm', 'config.json'))
    || existsSync(path.join(cwd, '.atm', 'runtime', 'current-task.json'));
}

function readGitWorkTree(cwd: any) {
  const inside = runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
  if (!inside.ok || inside.stdout.trim() !== 'true') {
    return { ok: false, reason: inside.stderr || inside.stdout || 'not a git worktree' };
  }
  const root = runGit(cwd, ['rev-parse', '--show-toplevel']);
  return {
    ok: true,
    root: root.ok ? toPortablePath(root.stdout.trim()) : toPortablePath(cwd)
  };
}

function readParentCommitShas(cwd: any) {
  const result = runGit(cwd, ['rev-list', '--parents', '-n', '1', 'HEAD']);
  if (!result.ok) {
    return [];
  }
  return result.stdout.trim().split(/\s+/).slice(1).filter(Boolean);
}

function readGitScalar(cwd: any, args: any) {
  const result = runGit(cwd, args);
  return result.ok ? result.stdout.trim() : null;
}

function readGovernedHeadTreeSha(cwd: any, commitSha: any, evidencePath: any) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-git-head-'));
  const tempIndex = path.join(tempDir, 'index');
  try {
    const readTree = runGit(cwd, ['read-tree', commitSha], {
      GIT_INDEX_FILE: tempIndex
    });
    if (!readTree.ok) {
      return null;
    }
    runGit(cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--', evidencePath], {
      GIT_INDEX_FILE: tempIndex
    });
    const writeTree = runGit(cwd, ['write-tree'], {
      GIT_INDEX_FILE: tempIndex
    });
    return writeTree.ok ? writeTree.stdout.trim() : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function readEvidenceRecords(cwd: any, runtime: any) {
  const evidenceRoot = runtime?.layoutVersion === 1
    ? path.join(cwd, '.atm', 'evidence')
    : path.join(cwd, '.atm', 'history', 'evidence');
  if (!existsSync(evidenceRoot)) {
    return [];
  }
  return listJsonFiles(evidenceRoot).flatMap((filePath: any) => {
    const records = extractEvidenceRecords(readJsonIfPossible(filePath));
    return records.map((record: any, index: any) => ({
      path: toPortablePath(path.relative(cwd, filePath)),
      index,
      git: normalizeGitDetails(record?.details?.git)
    })).filter((entry: any) => entry.git !== null);
  });
}

function extractEvidenceRecords(value: any) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry && typeof entry === 'object');
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value.evidence)) {
    return value.evidence.filter((entry: any) => entry && typeof entry === 'object');
  }
  if (value.evidenceKind || value.details) {
    return [value];
  }
  return [];
}

function normalizeGitDetails(value: any) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return {
    commitSha: typeof value.commitSha === 'string' ? value.commitSha.trim() : null,
    treeSha: typeof value.treeSha === 'string' ? value.treeSha.trim() : null,
    parentCommitShas: Array.isArray(value.parentCommitShas)
      ? value.parentCommitShas.map((entry: any) => String(entry).trim()).filter(Boolean)
      : []
  };
}

function listJsonFiles(directoryPath: any): string[] {
  return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      return listJsonFiles(absolutePath);
    }
    return entry.isFile() && entry.name.endsWith('.json') ? [absolutePath] : [];
  });
}

function readJsonIfPossible(filePath: any) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function sameStringSet(left: any, right: any) {
  const normalize = (values: any) => [...new Set((values ?? []).map((value: any) => String(value).trim()).filter(Boolean))].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function runGit(cwd: any, args: any, env = {}) {
  const result = spawnSync('git', args, {
    cwd,
    env: {
      ...process.env,
      ...env
    },
    encoding: 'utf8'
  });
  return {
    ok: !result.error && result.status === 0,
    stdout: result.stdout ?? '',
    stderr: [result.stderr ?? '', result.error?.message ?? ''].filter(Boolean).join('\n')
  };
}

function toPortablePath(value: any) {
  return String(value || '').replace(/\\/g, '/');
}
