import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const runFile = promisify(execFile);
const builder = fileURLToPath(new URL('../build-package-dist.ts', import.meta.url));

/** Use the existing full source builder with private outputs, never shared dist. */
export async function withPrivateCliNpmPackage<T>(repositoryRoot: string, use: (packageRoot: string) => Promise<T>): Promise<T> {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-private-cli-package-'));
  const packageRoot = path.join(temporaryRoot, 'packages/cli');
  try {
    await runFile(process.execPath, ['--strip-types', builder, '--repository-root', repositoryRoot, '--output-root', temporaryRoot],
      { cwd: repositoryRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    mkdirSync(packageRoot, { recursive: true });
    const sourcePackage = path.join(repositoryRoot, 'packages/cli');
    // npm automatically includes root package metadata, README and LICENSE.
    // Keep their bytes rather than manufacturing a different package manifest.
    for (const entry of readdirSync(sourcePackage, { withFileTypes: true })) {
      if (entry.isFile() && /^(?:package\.json|readme(?:\..*)?|licen[cs]e(?:\..*)?|copying(?:\..*)?)$/i.test(entry.name)) {
        copyFileSync(path.join(sourcePackage, entry.name), path.join(packageRoot, entry.name));
      }
    }
    return await use(packageRoot);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}
