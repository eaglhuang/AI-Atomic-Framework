import assert from 'node:assert/strict';
import { detectCurrentEditorIntegrationId } from '../../packages/cli/src/commands/integration/adapters.ts';

const legacyActorValues = [
  'codex-gpt-5.4-mini',
  'claude-opus-5',
  'cursor-captain',
  'Fable 5'
];

for (const value of legacyActorValues) {
  const detected = detectCurrentEditorIntegrationId({ AGENT_IDENTITY: value });
  assert.equal(detected.id, null, `${value} must not be inferred as an editor`);
  assert.equal(detected.source, null, `${value} must not become editor provenance`);
  assert.equal(detected.rawValue, null, `${value} must not be surfaced as editor raw value`);
}

const explicit = detectCurrentEditorIntegrationId({ ATM_EDITOR_ID: 'cursor', AGENT_IDENTITY: 'codex-gpt-5.4-mini' });
assert.deepEqual(explicit, { id: 'cursor', source: 'ATM_EDITOR_ID', rawValue: 'cursor' });

const codexHome = detectCurrentEditorIntegrationId({ CODEX_HOME: 'C:/Users/User/.codex', AGENT_IDENTITY: 'codex-gpt-5.4-mini' });
assert.deepEqual(codexHome, { id: 'codex', source: 'CODEX_HOME', rawValue: 'C:/Users/User/.codex' });

console.log('[integration-editor-detection] ok');
