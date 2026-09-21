import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type TakeoverRollbackSnapshot = Readonly<{
  readonly filePath: string;
  readonly existed: boolean;
  readonly content: string | null;
}>;

/**
 * Keep the task document and runtime authority surfaces as one rollback unit.
 * Takeover has to release the predecessor lock before it can acquire the
 * successor lock, so every later failure must restore the exact prior bytes.
 */
export async function withTakeoverAggregateRollback<T>(input: {
  readonly paths: readonly string[];
  readonly run: () => Promise<T> | T;
  readonly onRollback?: () => void | Promise<void>;
}): Promise<T> {
  const snapshots: TakeoverRollbackSnapshot[] = Array.from(new Set(input.paths.map((filePath) => path.resolve(filePath))))
    .map((filePath) => ({
      filePath,
      existed: existsSync(filePath),
      content: existsSync(filePath) ? readFileSync(filePath, 'utf8') : null
    }));
  try {
    return await input.run();
  } catch (error) {
    for (const snapshot of snapshots.slice().reverse()) {
      if (snapshot.existed) {
        writeFileSync(snapshot.filePath, snapshot.content ?? '', 'utf8');
      } else {
        rmSync(snapshot.filePath, { force: true });
      }
    }
    await input.onRollback?.();
    throw error;
  }
}
