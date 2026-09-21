import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeTextWithRetry } from '../../scripts/lib/windows-write-retry.ts';

const originalPlatform = process.platform;
Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

try {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-windows-write-retry-'));
  try {
    const target = path.join(tempRoot, 'generated.js');
    let attempts = 0;
    writeTextWithRetry(target, 'export const ready = true;\n', (filePath, content) => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('transient contention'), { code: 'UNKNOWN' });
      writeFileSync(filePath, content, 'utf8');
    });
    assert.equal(attempts, 3, 'transient Windows UNKNOWN writes must retry within the bounded budget');
    assert.equal(readFileSync(target, 'utf8'), 'export const ready = true;\n');

    let nonTransientAttempts = 0;
    assert.throws(() => writeTextWithRetry(target, 'unreachable', () => {
      nonTransientAttempts += 1;
      throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    }), /disk full/);
    assert.equal(nonTransientAttempts, 1, 'non-transient write failures must not be retried or hidden');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
} finally {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
}

console.log('[windows-write-retry] ok');
