import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runTeam } from '../../../packages/cli/src/commands/team.ts';

export async function runKnowledgeRetentionBudgetValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'knowledge-retention-budget') return false;

  const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-knowledge-retention');
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(path.join(cwd, '.atm', 'knowledge', 'team'), { recursive: true });
  mkdirSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'embeddings'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'active.md'), [
    '# Active team lesson',
    'status: active',
    'domain: team-agents',
    '',
    'Retained advisory knowledge for active Team Agents work.'
  ].join('\n'), 'utf8');
  writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'old-superseded.md'), [
    '# Old team lesson',
    'status: superseded',
    'supersededBy: .atm/knowledge/team/active.md',
    '',
    'This shard remains canonical source and requires human review before archive.'
  ].join('\n'), 'utf8');
  writeFileSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-index.json'), '{"entries":[]}\n', 'utf8');
  writeFileSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'embeddings', 'lesson-cache.bin'), 'runtime embedding cache fixture', 'utf8');

  try {
    const stats = await runTeam(['knowledge', 'stats', '--cwd', cwd, '--warning-bytes', '1', '--budget-bytes', '10', '--json']);
    const statsEvidence = stats.evidence as any;
    assert.equal(stats.ok, true);
    assert.equal(statsEvidence?.action, 'knowledge.stats');
    assert.equal(statsEvidence?.schemaId, 'atm.teamKnowledgeStats.v1');
    assert.equal(statsEvidence?.advisoryOnly, true);
    assert.equal(statsEvidence?.shardCount, 2);
    assert.ok(statsEvidence?.runtimeIndexBytes > 0);
    assert.ok(statsEvidence?.runtimeCacheBytes > 0);
    assert.ok(statsEvidence?.embeddingCacheBytes > 0);
    assert.equal(statsEvidence?.supersededShardCount, 1);
    assert.equal(statsEvidence?.archiveCandidateCount, 1);
    assert.equal(statsEvidence?.budget?.status, 'hard-limit');

    const compact = await runTeam(['knowledge', 'compact', '--dry-run', '--actor', 'coordinator', '--cwd', cwd, '--json']);
    const compactEvidence = compact.evidence as any;
    assert.equal(compact.ok, true);
    assert.equal(compactEvidence?.action, 'knowledge.compact');
    assert.equal(compactEvidence?.dryRun, true);
    assert.equal(compactEvidence?.permission?.ok, true);
    assert.equal(compactEvidence?.permission?.actorId, 'coordinator');
    assert.equal(compactEvidence?.canonicalMutated, false);
    assert.equal(compactEvidence?.runtimeCacheMutated, false);
    assert.equal(compactEvidence?.archiveCandidates?.length, 1);
    assert.equal(compactEvidence?.archiveCandidates?.[0]?.path, '.atm/knowledge/team/old-superseded.md');
    assert.ok(compactEvidence?.runtimePrunableFiles?.some((entry: any) => entry.path === '.atm/runtime/knowledge/embeddings/lesson-cache.bin'));
    assert.equal(existsSync(path.join(cwd, '.atm', 'knowledge', 'team', 'old-superseded.md')), true);
    assert.equal(existsSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'embeddings', 'lesson-cache.bin')), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  console.log('[validate-team-agents] ok (knowledge-retention-budget)');
  return true;
}
