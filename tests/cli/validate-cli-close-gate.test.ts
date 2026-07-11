import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createTempWorkspace, initializeGitRepository } from '../../scripts/temp-root.ts';
import { runCli } from '../../packages/cli/src/atm.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function safeRmSync(targetPath: string) {
  try {
    rmSync(targetPath, { recursive: true, force: true });
  } catch {
    // best-effort cleanup for temp workspaces.
  }
}

function parseCliJsonFromStreams(stdout: string, stderr: string, args: readonly string[]) {
  const attempts = [stdout.trim(), stderr.trim(), `${stdout}\n${stderr}`.trim()].filter(Boolean);
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch {}
    const jsonStart = candidate.indexOf('{');
    const jsonEnd = candidate.lastIndexOf('}');
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      try {
        return JSON.parse(candidate.slice(jsonStart, jsonEnd + 1));
      } catch {}
    }
  }
  throw new Error(`CLI output is not valid JSON for args ${args.join(' ')}: ${(stdout || stderr).trim()}`);
}

async function runAtm(args: readonly string[], cwd: string) {
  const previousCwd = process.cwd();
  let stdout = '';
  let stderr = '';
  try {
    process.chdir(cwd);
    const exitCode = await runCli([...args], {
      stdout: { write(chunk: unknown) { stdout += String(chunk); return true; } } as any,
      stderr: { write(chunk: unknown) { stderr += String(chunk); return true; } } as any
    });
    return {
      exitCode,
      stdout,
      stderr,
      parsed: parseCliJsonFromStreams(stdout, stderr, args)
    };
  } finally {
    process.chdir(previousCwd);
  }
}

const closeGateWorkspace = createTempWorkspace('close-gate');
initializeGitRepository(closeGateWorkspace);
try {
  const taskAPath = path.join(closeGateWorkspace, '.atm', 'history', 'tasks', 'TASK-CLOSE-A.json');

  writeJson(taskAPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-CLOSE-A',
    status: 'planned',
    deliverableMode: 'ledger-only'
  });
  const closeAPlannedRes = await runAtm(['tasks', 'close', '--task', 'TASK-CLOSE-A', '--status', 'done', '--actor', 'Antigravity'], closeGateWorkspace);
  assert.notEqual(closeAPlannedRes.exitCode, 0, 'closing planned task directly to done must fail');
  assert.ok(closeAPlannedRes.parsed.messages.some((msg: any) => msg.code === 'ATM_TASK_CLOSE_INVALID_LIFECYCLE'), 'must report ATM_TASK_CLOSE_INVALID_LIFECYCLE');

  writeJson(taskAPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-CLOSE-A',
    status: 'ready',
    deliverableMode: 'ledger-only'
  });
  const closeAUnclaimedRes = await runAtm(['tasks', 'close', '--task', 'TASK-CLOSE-A', '--status', 'done', '--actor', 'Antigravity'], closeGateWorkspace);
  assert.notEqual(closeAUnclaimedRes.exitCode, 0, 'closing unclaimed task to done must fail');
  assert.ok(closeAUnclaimedRes.parsed.messages.some((msg: any) => msg.code === 'ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED'), 'must report ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED');

  writeJson(taskAPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-CLOSE-A',
    status: 'running',
    deliverableMode: 'ledger-only',
    claim: {
      state: 'active',
      actorId: 'Antigravity',
      leaseId: 'lease-123456',
      claimedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      files: ['scripts/validate-cli.ts']
    }
  });
  const closeANoSessionRes = await runAtm(['tasks', 'close', '--task', 'TASK-CLOSE-A', '--status', 'done', '--actor', 'Antigravity'], closeGateWorkspace);
  assert.notEqual(closeANoSessionRes.exitCode, 0, 'closing task without session must fail');
  assert.ok(closeANoSessionRes.parsed.messages.some((msg: any) => msg.code === 'ATM_TASK_CLOSE_SESSION_CONTEXT_REQUIRED'), 'must report ATM_TASK_CLOSE_SESSION_CONTEXT_REQUIRED');

  writeJson(taskAPath, {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-CLOSE-A',
    status: 'ready',
    deliverableMode: 'ledger-only'
  });
  const claimRes = await runAtm(['tasks', 'claim', '--task', 'TASK-CLOSE-A', '--actor', 'Antigravity'], closeGateWorkspace);
  assert.equal(claimRes.exitCode, 0, 'tasks claim close-gate task must succeed');

  const closeNoEvidenceRes = await runAtm(['tasks', 'close', '--task', 'TASK-CLOSE-A', '--status', 'done', '--actor', 'Antigravity'], closeGateWorkspace);
  assert.notEqual(closeNoEvidenceRes.exitCode, 0, 'closing task without evidence must fail');
  assert.ok(closeNoEvidenceRes.parsed.messages.some((msg: any) => msg.code === 'ATM_TASK_CLOSE_EVIDENCE_REQUIRED'), 'must report ATM_TASK_CLOSE_EVIDENCE_REQUIRED');

  const evidencePath = path.join(closeGateWorkspace, '.atm', 'history', 'evidence', 'TASK-CLOSE-A.json');
  writeJson(evidencePath, {
    schemaId: 'atm.taskEvidence.v1',
    specVersion: '0.1.0',
    taskId: 'TASK-CLOSE-A',
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'Auto-run: npm run typecheck',
        evidenceFreshness: 'fresh',
        details: {
          kind: 'test',
          freshness: 'fresh',
          validationPasses: ['typecheck'],
          commandRuns: [
            {
              command: 'npm run typecheck',
              exitCode: 0,
              stdoutSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
            }
          ]
        }
      },
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'Auto-run: npm run validate:cli',
        evidenceFreshness: 'fresh',
        details: {
          kind: 'test',
          freshness: 'fresh',
          validationPasses: ['validate:cli'],
          commandRuns: [
            {
              command: 'npm run validate:cli',
              exitCode: 0,
              stdoutSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
            }
          ]
        }
      },
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'Auto-run: npm run validate:git-head-evidence',
        evidenceFreshness: 'fresh',
        details: {
          kind: 'test',
          freshness: 'fresh',
          validationPasses: ['validate:git-head-evidence'],
          commandRuns: [
            {
              command: 'npm run validate:git-head-evidence',
              exitCode: 0,
              stdoutSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
              stderrSha256: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
            }
          ]
        }
      }
    ]
  });

  const closeSuccessRes = await runAtm(['tasks', 'close', '--task', 'TASK-CLOSE-A', '--status', 'done', '--actor', 'Antigravity'], closeGateWorkspace);
  assert.equal(closeSuccessRes.exitCode, 0, 'closing task with valid evidence and session must succeed');
  assert.equal(closeSuccessRes.parsed.ok, true, 'must report ok = true');

  assert.ok(readFileSync(evidencePath, 'utf8').includes('validate:cli'), 'evidence fixture must stay readable');
} finally {
  safeRmSync(closeGateWorkspace);
}

console.log('[validate-cli-close-gate:test] ok');
