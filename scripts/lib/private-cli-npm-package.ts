import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildCliNpmRuntime } from '../build-cli-npm-runtime.ts';

/** Build from the caller's prepared dist; never rebuild or replace shared dist. */
export async function withPrivateCliNpmPackage<T>(repositoryRoot: string, use: (packageRoot: string) => Promise<T>): Promise<T> {
  const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-private-cli-package-'));
  const packageRoot = path.join(temporaryRoot, 'package');
  try {
    mkdirSync(packageRoot);
    const sourcePackage = path.join(repositoryRoot, 'packages/cli');
    // npm automatically includes root package metadata, README and LICENSE.
    // Keep their bytes rather than manufacturing a different package manifest.
    for (const entry of readdirSync(sourcePackage, { withFileTypes: true })) {
      if (entry.isFile() && /^(?:package\.json|readme(?:\..*)?|licen[cs]e(?:\..*)?|copying(?:\..*)?)$/i.test(entry.name)) {
        copyFileSync(path.join(sourcePackage, entry.name), path.join(packageRoot, entry.name));
      }
    }
    await buildCliNpmRuntime({ repositoryRoot, outputRoot: path.join(packageRoot, 'dist/npm-runtime') });
    return await use(packageRoot);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

