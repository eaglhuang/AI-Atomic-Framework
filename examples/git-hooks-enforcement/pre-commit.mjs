import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

let repoRoot = process.cwd();
repoRoot = runGit(['rev-parse', '--show-toplevel']).stdout.trim();
const evidencePath = '.atm/history/evidence/git-head.json';

if (!existsSync(path.join(repoRoot, 'atm.mjs'))) {
  console.error('[atm-hooks] atm.mjs is missing; install ATM before enabling this hook.');
  process.exit(1);
}

if (!existsSync(path.join(repoRoot, '.atm', 'config.json'))) {
  console.error('[atm-hooks] .atm/config.json is missing; run ATM bootstrap before enabling this hook.');
  process.exit(1);
}

const doctor = runNode(['atm.mjs', 'doctor', '--json']);
const doctorPayload = parseJson(doctor.stdout || doctor.stderr || '{}');
if (doctor.status !== 0 || doctorPayload.ok !== true) {
  console.error('[atm-hooks] ATM doctor blocked this commit.');
  console.error(JSON.stringify(doctorPayload, null, 2));
  process.exit(1);
}

const stagedPaths = runGit(['diff', '--cached', '--name-only']).stdout
  .split(/\r?\n/)
  .map((entry) => entry.trim())
  .filter(Boolean)
  .filter((entry) => entry !== evidencePath);

if (stagedPaths.length === 0) {
  process.exit(0);
}

const parentCommitShas = readParentCommitShas();
const treeSha = readStagedTreeWithoutEvidence();
const generatedAt = new Date().toISOString();
const evidenceFilePath = path.join(repoRoot, evidencePath);
mkdirSync(path.dirname(evidenceFilePath), { recursive: true });
writeFileSync(evidenceFilePath, `${JSON.stringify({
  schemaVersion: 'atm.gitHeadEvidence.v0.1',
  evidence: [
    {
      evidenceKind: 'validation',
      summary: 'Git commit tree is covered by ATM evidence.',
      artifactPaths: [],
      createdAt: generatedAt,
      producedBy: 'examples/git-hooks-enforcement',
      details: {
        git: {
          treeSha,
          parentCommitShas,
          stagedPathCount: stagedPaths.length,
          evidencePath,
          generatedAt
        }
      }
    }
  ]
}, null, 2)}\n`, 'utf8');

runGit(['add', '--', evidencePath]);
console.log(`[atm-hooks] staged ATM git evidence for ${stagedPaths.length} path(s).`);

function readParentCommitShas() {
  const head = runGit(['rev-parse', '--verify', 'HEAD'], { allowFailure: true });
  return head.status === 0 ? [head.stdout.trim()].filter(Boolean) : [];
}

function readStagedTreeWithoutEvidence() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-index-'));
  const tempIndex = path.join(tempDir, 'index');
  try {
    const gitIndexPath = runGit(['rev-parse', '--git-path', 'index']).stdout.trim();
    if (existsSync(path.resolve(repoRoot, gitIndexPath))) {
      writeFileSync(tempIndex, readFileSync(path.resolve(repoRoot, gitIndexPath)));
    }
    runGit(['rm', '--cached', '--quiet', '--ignore-unmatch', '--', evidencePath], {
      env: { GIT_INDEX_FILE: tempIndex },
      allowFailure: true
    });
    return runGit(['write-tree'], {
      env: { GIT_INDEX_FILE: tempIndex }
    }).stdout.trim();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function runGit(args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      ...(options.env ?? {})
    },
    encoding: 'utf8'
  });
  if (!options.allowFailure && (result.error || result.status !== 0)) {
    console.error(`[atm-hooks] git ${args.join(' ')} failed`);
    console.error(result.stderr || result.error?.message || '');
    process.exit(1);
  }
  return result;
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return {};
  }
}
