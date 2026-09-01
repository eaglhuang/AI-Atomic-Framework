import { writeFileSync } from 'node:fs';

const RETRY_DELAY_MS = 40;
const MAX_ATTEMPTS = 4;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

type WriteText = (filePath: string, content: string) => void;

function isTransientWindowsWriteError(error: unknown): boolean {
  if (process.platform !== 'win32' || !error || typeof error !== 'object') return false;
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'UNKNOWN' || code === 'EBUSY' || code === 'EPERM';
}

function sleep(milliseconds: number): void {
  Atomics.wait(sleepBuffer, 0, 0, milliseconds);
}

/** Write generated text with a bounded retry for transient Windows file contention. */
export function writeTextWithRetry(filePath: string, content: string, writeText: WriteText = (target, value) => {
  writeFileSync(target, value, 'utf8');
}): void {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      writeText(filePath, content);
      return;
    } catch (error) {
      if (!isTransientWindowsWriteError(error) || attempt === MAX_ATTEMPTS) throw error;
      sleep(RETRY_DELAY_MS * attempt);
    }
  }
}
