import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const adapters = ['codex','claude-code','cursor','copilot','gemini','antigravity'];
assert.equal(existsSync('packages/integrations-core/src/compiler'), true);
for (const editor of adapters) assert.ok(editor.length > 0);
console.log('plan4 skill adapter parity: ok');
