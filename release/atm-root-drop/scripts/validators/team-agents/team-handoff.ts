import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CliError } from '../../../packages/cli/src/commands/shared.ts';
import { buildDirectTeamRoleInstructions, runTeam } from '../../../packages/cli/src/commands/team.ts';
import {
  buildTeamHandoffRetentionDecision,
  materializeTeamRoleHandoff,
  promoteTeamHandoffArchive,
  renderTeamHandoffIndex,
  teamHandoffHistoryDirectory,
  teamHandoffRuntimeDirectory,
  verifyTeamHandoffHistory,
  verifyTeamHandoffLedger
} from '../../../packages/core/src/team-runtime/handoff-ledger.ts';
import { createTempWorkspace } from '../../temp-root.ts';
import { writeTeamRunForHandoffGate } from './artifact-fixtures.ts';

export async function runTeamHandoffValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase === 'team-handoff-materialize') {
    const cwd = createTempWorkspace('atm-team-handoff-');
    const input = {
      cwd,
      taskId: 'TASK-TEAM-0072',
      teamRunId: 'handoff-test',
      fromRole: 'implementer',
      fromProviderId: 'openai',
      fromModelId: 'gpt-5-mini',
      toRole: 'reviewer',
      toProviderId: 'anthropic',
      sourceArtifactId: 'provider-session-1',
      redactedPreview: 'Implemented the runtime ledger. sk-live-secret-must-not-persist',
      leaseEpoch: 1,
      createdAt: '2026-07-11T00:00:00.000Z'
    } as const;
    const first = materializeTeamRoleHandoff(input);
    const second = materializeTeamRoleHandoff({ ...input, sourceArtifactId: 'provider-session-2', fromRole: 'reviewer', fromProviderId: 'anthropic', fromModelId: 'claude-haiku', toRole: 'validator', leaseEpoch: 2, createdAt: '2026-07-11T00:01:00.000Z' });
    const directory = teamHandoffRuntimeDirectory(cwd, input.taskId, input.teamRunId);
    const verified = verifyTeamHandoffLedger(cwd, input.taskId, input.teamRunId);
    assert.equal(verified.ok, true, verified.reason ?? 'handoff ledger must verify');
    assert.equal(second.artifact.previousHandoffSha256, first.manifest.rootHandoffSha256);
    const index = readFileSync(path.join(directory, 'index.md'), 'utf8');
    assert.equal(index, renderTeamHandoffIndex(second.manifest, [first.artifact, second.artifact]));
    assert.equal(index.includes('sk-live-secret-must-not-persist'), false);
    assert.equal(readFileSync(path.join(directory, '0001-implementer.json'), 'utf8').includes('sk-live-secret-must-not-persist'), false);
    writeFileSync(path.join(directory, '0001-implementer.json'), '{}\n', 'utf8');
    assert.equal(verifyTeamHandoffLedger(cwd, input.taskId, input.teamRunId).ok, false);
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-materialize)');
    return true;
  }

  if (taskCase === 'team-handoff-integrity') {
    const cwd = createTempWorkspace('atm-team-handoff-integrity-');
    const taskId = 'TASK-TEAM-0075';
    const teamRunId = 'integrity';
    materializeTeamRoleHandoff({ cwd, taskId, teamRunId, fromRole: 'implementer', fromProviderId: 'openai', fromModelId: 'gpt-5-mini', sourceArtifactId: 'source-1', redactedPreview: 'First.', leaseEpoch: 1 });
    materializeTeamRoleHandoff({ cwd, taskId, teamRunId, fromRole: 'reviewer', fromProviderId: 'anthropic', fromModelId: 'haiku', sourceArtifactId: 'source-2', redactedPreview: 'Second.', leaseEpoch: 2 });
    const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    manifest.artifacts[1].sequence = 4;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    assert.equal(verifyTeamHandoffLedger(cwd, taskId, teamRunId).ok, false, 'sequence gap must fail closed');
    const restoredManifest = { ...manifest, artifacts: manifest.artifacts.map((entry: any, index: number) => ({ ...entry, sequence: index + 1 })) };
    writeFileSync(manifestPath, `${JSON.stringify(restoredManifest, null, 2)}\n`, 'utf8');
    const secondPath = path.join(directory, restoredManifest.artifacts[1].file);
    const secondArtifact = JSON.parse(readFileSync(secondPath, 'utf8'));
    secondArtifact.previousHandoffSha256 = 'tampered-chain';
    const secondContent = `${JSON.stringify(secondArtifact, null, 2)}\n`;
    writeFileSync(secondPath, secondContent, 'utf8');
    const chainManifest = {
      ...restoredManifest,
      artifacts: restoredManifest.artifacts.map((entry: any, index: number) => index === 1 ? { ...entry, sha256: createHash('sha256').update(secondContent, 'utf8').digest('hex') } : entry)
    };
    chainManifest.rootHandoffSha256 = chainManifest.artifacts[1].sha256;
    writeFileSync(manifestPath, `${JSON.stringify(chainManifest, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(directory, 'index.md'), renderTeamHandoffIndex(chainManifest, [JSON.parse(readFileSync(path.join(directory, chainManifest.artifacts[0].file), 'utf8')), secondArtifact]), 'utf8');
    assert.equal(verifyTeamHandoffLedger(cwd, taskId, teamRunId).ok, false, 'hash-valid chain tamper must fail closed');
    assert.equal(verifyTeamHandoffLedger(cwd, 'TASK-TEAM-OTHER', teamRunId).ok, false, 'cross-task reads must fail closed');
    writeFileSync(path.join(directory, 'index.md'), '---\ntask_id: wrong\n---\n', 'utf8');
    assert.equal(verifyTeamHandoffLedger(cwd, taskId, teamRunId).ok, false, 'frontmatter drift must fail closed');
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-integrity)');
    return true;
  }

  if (taskCase === 'team-handoff-hard-gate') {
    const cwd = createTempWorkspace('atm-team-handoff-gate-');
    const taskId = 'TASK-TEAM-0075';
    const teamRunId = 'bound-coordinator';
    materializeTeamRoleHandoff({ cwd, taskId, teamRunId, fromRole: 'implementer', fromProviderId: 'openai', fromModelId: 'gpt-5-mini', sourceArtifactId: 'source', redactedPreview: 'Bound coordinator only.', leaseEpoch: 1 });
    writeTeamRunForHandoffGate(cwd, taskId, teamRunId);
    await assert.rejects(
      () => runTeam(['handoff', 'show', '--task', taskId, '--team', teamRunId, '--actor', 'coordinator', '--cwd', cwd]),
      (error: unknown) => error instanceof CliError && error.code === 'ATM_TEAM_PERMISSION_HARD_GATE_BLOCKED'
    );
    const authorized = await runTeam(['handoff', 'show', '--task', taskId, '--team', teamRunId, '--actor', 'bound-captain', '--cwd', cwd]) as any;
    assert.equal(authorized.ok, true);
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-hard-gate)');
    return true;
  }

  if (taskCase === 'team-handoff-continuation') {
    const cwd = createTempWorkspace('atm-team-handoff-continuation-');
    const taskId = 'TASK-TEAM-0075';
    materializeTeamRoleHandoff({ cwd, taskId, teamRunId: 'prior', fromRole: 'reviewer', fromProviderId: 'anthropic', fromModelId: 'claude-haiku', sourceArtifactId: 'prior-source', redactedPreview: 'Prior terminal review.', leaseEpoch: 1 });
    promoteTeamHandoffArchive({ cwd, taskId, teamRunId: 'prior', runOutcome: 'aborted' });
    assert.equal(verifyTeamHandoffHistory(cwd, taskId, 'prior').ok, true);
    materializeTeamRoleHandoff({ cwd, taskId, teamRunId: 'current', fromRole: 'implementer', fromProviderId: 'openai', fromModelId: 'gpt-5-mini', sourceArtifactId: 'current-source', redactedPreview: 'Current retry.', leaseEpoch: 1 });
    writeTeamRunForHandoffGate(cwd, taskId, 'current');
    const result = await runTeam(['handoff', 'context', '--task', taskId, '--team', 'current', '--actor', 'bound-captain', '--continuation-from', 'prior', '--cwd', cwd]) as any;
    assert.equal(result.ok, true);
    const events = readFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', 'current', 'observability-events.jsonl'), 'utf8');
    assert.ok(events.includes('handoff.consumed'));
    await assert.rejects(
      () => runTeam(['handoff', 'context', '--task', 'TASK-TEAM-OTHER', '--team', 'current', '--actor', 'bound-captain', '--continuation-from', 'prior', '--cwd', cwd]),
      (error: unknown) => error instanceof CliError && error.code === 'ATM_TEAM_PERMISSION_HARD_GATE_BLOCKED'
    );
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-continuation)');
    return true;
  }

  if (taskCase === 'team-handoff-retention') {
    assert.equal(buildTeamHandoffRetentionDecision({ transitionCount: 48, bytes: 1, softLimitReached: true, hardLimitReached: false }).statusCode, 'handoff-soft-limit-warning');
    assert.equal(buildTeamHandoffRetentionDecision({ transitionCount: 64, bytes: 1, softLimitReached: true, hardLimitReached: true }).decisionClass, 'human-signoff-required');
    console.log('[validate-team-agents] ok (team-handoff-retention)');
    return true;
  }

  if (taskCase === 'team-handoff-aborted-promotion') {
    const cwd = createTempWorkspace('atm-team-handoff-archive-');
    materializeTeamRoleHandoff({ cwd, taskId: 'TASK-TEAM-0072', teamRunId: 'aborted', fromRole: 'implementer', fromProviderId: 'openai', fromModelId: 'gpt-5-mini', sourceArtifactId: 'session', redactedPreview: 'Stopped after provider failure.', leaseEpoch: 1 });
    const archived = promoteTeamHandoffArchive({ cwd, taskId: 'TASK-TEAM-0072', teamRunId: 'aborted', runOutcome: 'aborted' });
    assert.equal(archived.manifest.runOutcome, 'aborted');
    assert.ok(existsSync(path.join(teamHandoffHistoryDirectory(cwd, 'TASK-TEAM-0072', 'aborted'), 'index.md')));
    assert.equal(verifyTeamHandoffLedger(cwd, 'TASK-TEAM-0072', 'aborted').ok, true);
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-aborted-promotion)');
    return true;
  }

  if (taskCase === 'team-handoff-context-budget') {
    const longSummary = Array.from({ length: 400 }, (_, index) => `token${index}`).join(' ');
    const context = buildDirectTeamRoleInstructions({
      taskId: 'TASK-TEAM-0073',
      role: 'reviewer',
      priorRoleArtifacts: Array.from({ length: 6 }, (_, index) => ({ role: `role${index}`, providerId: 'openai', outputTextPreview: longSummary }))
    });
    assert.equal(context.telemetry.priorArtifactCount, 4);
    assert.equal(context.telemetry.tokenEstimatorId, 'whitespace-v1');
    assert.ok(context.telemetry.actualTokenCount <= 1024 + 32, 'base instruction plus handoff must remain bounded');
    assert.equal(context.telemetry.consumedArtifactRefs[0], 'role2/openai');
    console.log('[validate-team-agents] ok (team-handoff-context-budget)');
    return true;
  }

  if (taskCase === 'team-handoff-narrative-whitelist') {
    const cwd = createTempWorkspace('atm-team-handoff-whitelist-');
    const first = materializeTeamRoleHandoff({
      cwd, taskId: 'TASK-TEAM-0074', teamRunId: 'whitelist', fromRole: 'implementer', fromProviderId: 'openai', fromModelId: 'gpt-5-mini', toRole: 'reviewer', sourceArtifactId: 'provider-artifact', redactedPreview: 'Implemented the bounded handoff. sk-hidden-secret', leaseEpoch: 1, routeNote: 'needs-rework -> implementer (round 1/2)'
    });
    const directory = teamHandoffRuntimeDirectory(cwd, 'TASK-TEAM-0074', 'whitelist');
    const index = readFileSync(path.join(directory, 'index.md'), 'utf8');
    assert.equal(index, renderTeamHandoffIndex(first.manifest, [first.artifact]));
    assert.equal(index.includes('sk-hidden-secret'), false);
    assert.ok(index.includes(first.artifact.humanSummary));
    assert.ok(index.includes(first.artifact.routeNote!));
    assert.equal(verifyTeamHandoffLedger(cwd, 'TASK-TEAM-0074', 'whitelist').ok, true);
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (team-handoff-narrative-whitelist)');
    return true;
  }

  return false;
}
