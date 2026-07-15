import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { inspectTeamRuntimeBackendCapabilities } from '../../../packages/cli/src/commands/integration.ts';
import { runTeam } from '../../../packages/cli/src/commands/team.ts';
import { createTempWorkspace } from '../../temp-root.ts';

export async function runIntegrationCapabilityWiringValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'integration-capability-wiring') return false;

  const tempRoot = createTempWorkspace('atm-team-runtime-backend-');
  const manifestDir = path.join(tempRoot, '.atm', 'integrations');
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(path.join(manifestDir, 'codex.manifest.json'), JSON.stringify({
    schemaId: 'atm.integrationInstallManifest.v1',
    adapterId: 'codex',
    adapterVersion: '0.0.0-test',
    installedAt: '2026-07-10T00:00:00.000Z',
    installedBy: 'validator',
    targetDir: 'integrations/codex-skills',
    metadata: {},
    files: [],
    teamRuntimeCapabilities: [
      {
        providerId: 'claude-code',
        runtimeModes: ['editor-subagent'],
        executionSurfaces: ['editor-subagent'],
        roles: ['implementer', 'validator'],
        status: 'experimental',
        evidence: 'validator fixture declares editor-subagent backend capability'
      }
    ]
  }, null, 2));

  const declaredReadiness = inspectTeamRuntimeBackendCapabilities(tempRoot);
  assert.equal(declaredReadiness.schemaId, 'atm.integrationTeamRuntimeBackendReadiness.v1');
  assert.ok(declaredReadiness.declaredBackendCount >= 1);
  assert.equal(declaredReadiness.startReadiness, 'runtime-backend-declared');
  const declaredEditorBackend = declaredReadiness.capabilities.find((capability) => capability.providerId === 'claude-code');
  assert.equal(declaredEditorBackend?.adapterId, 'codex');
  assert.deepEqual(declaredEditorBackend?.runtimeModes, ['editor-subagent']);

  const repositoryReadiness = inspectTeamRuntimeBackendCapabilities(process.cwd());
  assert.equal(repositoryReadiness.schemaId, 'atm.integrationTeamRuntimeBackendReadiness.v1');
  const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0045', '--cwd', process.cwd(), '--runtime-mode', 'editor-subagent', '--provider', 'claude-code', '--json']);
  assert.equal((validateResult.evidence as any)?.runtimeBackendReadiness?.schemaId, 'atm.integrationTeamRuntimeBackendReadiness.v1');
  assert.equal((validateResult.evidence as any)?.runtimeContract?.runtimeMode, 'editor-subagent');
  assert.equal((validateResult.evidence as any)?.runtimeContract?.providerId, 'claude-code');

  const teamSource = readFileSync(path.join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'team.ts'), 'utf8');
  assert.ok(teamSource.includes('ATM_TEAM_RUNTIME_BACKEND_MISSING'));
  assert.ok(teamSource.includes('evaluateTeamRuntimeBackendAdmission'));

  const onboarding = readFileSync(path.join(process.cwd(), 'docs', 'AGENT_PACK_ONBOARDING.md'), 'utf8');
  assert.ok(onboarding.includes('teamRuntimeCapabilities'));
  assert.ok(onboarding.includes('ATM_TEAM_RUNTIME_BACKEND_MISSING'));

  const integrationSource = readFileSync(path.join(process.cwd(), 'packages', 'cli', 'src', 'commands', 'integration.ts'), 'utf8');
  assert.ok(integrationSource.includes('export function inspectTeamRuntimeBackendCapabilities'));

  console.log('[validate-team-agents] ok (integration-capability-wiring)');
  return true;
}
