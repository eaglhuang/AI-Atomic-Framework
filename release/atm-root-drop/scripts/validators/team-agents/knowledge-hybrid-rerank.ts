import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runTeam } from '../../../packages/cli/src/commands/team.ts';

export async function runKnowledgeHybridRerankValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'knowledge-hybrid-rerank') return false;

  const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-knowledge-hybrid');
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(path.join(cwd, '.atm', 'knowledge', 'team'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'alpha.md'), [
    '# Alpha lexical note',
    'domain: team-agents',
    'atoms: team.knowledge-hybrid-rerank',
    '',
    'Lexical common routing alpha baseline note for Team knowledge retrieval.'
  ].join('\n'), 'utf8');
  writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'beta.md'), [
    '# Beta semantic note',
    'domain: team-agents',
    'atoms: team.knowledge-hybrid-rerank',
    '',
    'Lexical common semantic captain vector note for opt-in Team knowledge retrieval.'
  ].join('\n'), 'utf8');

  try {
    const writeBuild = await runTeam(['knowledge', 'build', '--scope', 'project', '--write', '--actor', 'coordinator', '--cwd', cwd, '--json']);
    assert.equal(writeBuild.ok, true);

    const lexicalOnly = await runTeam([
      'knowledge',
      'query',
      '--query',
      'lexical common captain vector',
      '--top',
      '2',
      '--cwd',
      cwd,
      '--json'
    ]);
    const lexicalEvidence = lexicalOnly.evidence as any;
    assert.equal(lexicalOnly.ok, true);
    assert.equal(lexicalEvidence?.hybridRetrieval?.requested, false);
    assert.equal(lexicalEvidence?.hybridRetrieval?.applied, false);

    const missingCache = await runTeam([
      'knowledge',
      'query',
      '--query',
      'lexical common captain vector',
      '--top',
      '2',
      '--vector-rerank',
      '--cwd',
      cwd,
      '--json'
    ]);
    const missingEvidence = missingCache.evidence as any;
    assert.equal(missingCache.ok, true);
    assert.equal(missingEvidence?.hybridRetrieval?.requested, true);
    assert.equal(missingEvidence?.hybridRetrieval?.applied, false);
    assert.equal(missingEvidence?.hybridRetrieval?.fallback, 'embedding-cache-missing-or-invalid');
    assert.equal(missingEvidence?.hybridRetrieval?.lexicalBaselineRequired, true);

    mkdirSync(path.join(cwd, '.atm', 'runtime', 'knowledge'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-embeddings.json'), `${JSON.stringify({
      schemaId: 'atm.teamKnowledgeEmbeddingCache.v1',
      advisoryOnly: true,
      entries: [
        { path: '.atm/knowledge/team/alpha.md', vector: { alpha: 4, baseline: 1 } },
        { path: '.atm/knowledge/team/beta.md', vector: { captain: 3, vector: 3, semantic: 1 } }
      ]
    }, null, 2)}\n`, 'utf8');

    const reranked = await runTeam([
      'knowledge',
      'query',
      '--query',
      'lexical common captain vector',
      '--top',
      '2',
      '--vector-rerank',
      '--cwd',
      cwd,
      '--json'
    ]);
    const rerankEvidence = reranked.evidence as any;
    assert.equal(reranked.ok, true);
    assert.equal(rerankEvidence?.hybridRetrieval?.requested, true);
    assert.equal(rerankEvidence?.hybridRetrieval?.applied, true);
    assert.equal(rerankEvidence?.hybridRetrieval?.lexicalBaselineRequired, true);
    assert.ok(rerankEvidence?.hybridRetrieval?.lexicalShortlistSize >= 2);
    assert.equal(rerankEvidence?.hits?.[0]?.path, '.atm/knowledge/team/beta.md');
    assert.equal(typeof rerankEvidence?.hits?.[0]?.semanticScore, 'number');
    assert.equal(Object.hasOwn(rerankEvidence.hits[0], 'searchText'), false);

    const stats = await runTeam(['knowledge', 'stats', '--cwd', cwd, '--json']);
    const statsEvidence = stats.evidence as any;
    assert.ok(statsEvidence?.embeddingCacheBytes > 0);
    assert.ok(statsEvidence?.runtimeFiles?.some((entry: any) => entry.path === '.atm/runtime/knowledge/team-knowledge-embeddings.json' && entry.prunable === true));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }

  console.log('[validate-team-agents] ok (knowledge-hybrid-rerank)');
  return true;
}
