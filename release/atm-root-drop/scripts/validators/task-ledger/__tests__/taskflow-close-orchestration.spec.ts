import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTaskflowCloseOrchestration } from '../taskflow-close-orchestration.ts';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-close-orch-spec-'));
try {
  await validateTaskflowCloseOrchestration(tempRoot);
  assert.equal(typeof validateTaskflowCloseOrchestration, 'function');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[taskflow-close-orchestration.spec] ok');
