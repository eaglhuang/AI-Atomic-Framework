import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runTeam } from '../../../packages/cli/src/commands/team.ts';

export async function runKnowledgeBuildQueryValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'knowledge-build-query') return false;

  const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-knowledge');
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(path.join(cwd, '.atm', 'knowledge', 'team'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'routing.md'), [
    '# Team routing knowledge',
    'repo: AI-Atomic-Framework',
    'channel: normal',
    'domain: team-agents',
    'paths: packages/cli/src/commands/team.ts, scripts/validate-team-agents.ts',
    'atoms: team.knowledge-build-query',
    'validators: npm run validate:cli, node --strip-types scripts/validate-team-agents.ts',
    '',
    'Use this advisory shard when a Team Agents task needs metadata filtering before lexical ranking.'
  ].join('\n'), 'utf8');

  try {
    const dryRun = await runTeam(['knowledge', 'build', '--scope', 'project', '--dry-run', '--cwd', cwd, '--json']);
    const dryEvidence = dryRun.evidence as any;
    assert.equal(dryRun.ok, true);
    assert.equal(dryEvidence?.action, 'knowledge.build');
    assert.equal(dryEvidence?.advisoryOnly, true);
    assert.equal(dryEvidence?.dryRun, true);
    assert.equal(dryEvidence?.shardCount, 1);
    assert.equal(existsSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-index.json')), false);

    const missingQuery = await runTeam(['knowledge', 'query', '--query', 'metadata filtering lexical ranking', '--top', '5', '--cwd', cwd, '--json']);
    const missingEvidence = missingQuery.evidence as any;
    assert.equal(missingQuery.ok, true);
    assert.equal(missingEvidence?.indexStatus, 'missing');
    assert.ok(missingQuery.messages.some((entry: any) => entry.code === 'ATM_TEAM_KNOWLEDGE_INDEX_MISSING'));
    assert.ok(String(missingEvidence?.buildCommand).includes('team knowledge build'));

    const deniedBuild = await runTeam(['knowledge', 'build', '--scope', 'project', '--write', '--actor', 'knowledge-scout', '--cwd', cwd, '--json']);
    const deniedEvidence = deniedBuild.evidence as any;
    assert.equal(deniedBuild.ok, false);
    assert.equal(deniedEvidence?.permission?.permission, 'knowledge.index.write');
    assert.ok(deniedBuild.messages.some((entry: any) => entry.code === 'ATM_TEAM_KNOWLEDGE_INDEX_WRITE_FORBIDDEN'));

    const writeBuild = await runTeam(['knowledge', 'build', '--scope', 'project', '--write', '--actor', 'coordinator', '--cwd', cwd, '--json']);
    const writeEvidence = writeBuild.evidence as any;
    assert.equal(writeBuild.ok, true);
    assert.equal(writeEvidence?.permission?.permission, 'knowledge.index.write');
    assert.equal(existsSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-index.json')), true);

    const query = await runTeam([
      'knowledge',
      'query',
      '--query',
      'metadata filtering lexical ranking',
      '--domain',
      'team-agents',
      '--atom',
      'team.knowledge-build-query',
      '--top',
      '5',
      '--cwd',
      cwd,
      '--json'
    ]);
    const queryEvidence = query.evidence as any;
    assert.equal(query.ok, true);
    assert.equal(queryEvidence?.action, 'knowledge.query');
    assert.equal(queryEvidence?.advisoryOnly, true);
    assert.equal(queryEvidence?.indexStatus, 'ready');
    assert.equal(queryEvidence?.hits?.length, 1);
    assert.equal(queryEvidence?.hits?.[0]?.path, '.atm/knowledge/team/routing.md');
    assert.equal(typeof queryEvidence?.hits?.[0]?.snippet, 'string');
    assert.equal(Object.hasOwn(queryEvidence.hits[0], 'searchText'), false);

    mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-KNOW-0001.json'), `${JSON.stringify({
      schemaId: 'atm.taskLedger.v1',
      workItemId: 'TASK-KNOW-0001',
      title: 'Team routing knowledge task',
      status: 'ready',
      scopePaths: ['packages/cli/src/commands/team.ts'],
      deliverables: ['packages/cli/src/commands/team.ts'],
      validators: ['node --strip-types scripts/validate-team-agents.ts --case knowledge-build-query'],
      acceptance: ['Captain brief shows advisory knowledge hits.']
    }, null, 2)}\n`, 'utf8');
    const plan = await runTeam(['plan', '--task', 'TASK-KNOW-0001', '--cwd', cwd, '--json']);
    const planEvidence = plan.evidence as any;
    assert.equal(planEvidence?.teamPlan?.knowledgeSummary?.schemaId, 'atm.teamKnowledgeSummary.v1');
    assert.equal(planEvidence?.teamPlan?.knowledgeSummary?.advisoryOnly, true);
    assert.equal(planEvidence?.teamPlan?.knowledgeSummary?.top, 3);
    assert.ok(Array.isArray(planEvidence?.teamPlan?.knowledgeSummary?.hits));
    assert.ok(String(planEvidence?.teamPlan?.knowledgeSummary?.followUpCommand).includes('team knowledge query'));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  console.log('[validate-team-agents] ok (knowledge-build-query)');
  return true;
}
