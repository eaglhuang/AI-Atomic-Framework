import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export function runKnowledgeBoundaryValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'knowledge-boundary') return false;

  const contract = readFileSync(path.join(process.cwd(), 'docs/governance/team-agents/knowledge-index-contract.md'), 'utf8');
  const shardTemplate = readFileSync(path.join(process.cwd(), 'docs/governance/team-agents/templates/team-memory-shard-template.md'), 'utf8');

  for (const content of [contract, shardTemplate]) {
    assert.ok(content.includes('.atm/knowledge/**'));
    assert.ok(content.includes('.atm/runtime/knowledge/**'));
    assert.match(content, /advisory/i);
  }

  assert.match(contract, /not a second task\s+registry|never a second task\s+registry/i);
  assert.match(contract, /promotion path/i);
  assert.match(contract, /closure authority/i);
  assert.match(contract, /cache-only/i);
  assert.match(shardTemplate, /Authority: advisory-only/);
  assert.match(shardTemplate, /not a registry, task store, promotion path, claim source, or closure authority/);

  console.log('[validate-team-agents] ok (knowledge-boundary)');
  return true;
}
