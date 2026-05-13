#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const distEntrypoint = path.join(root, 'packages', 'cli', 'dist', 'atm.js');
const sourceEntrypoint = path.join(root, 'packages', 'cli', 'src', 'atm.ts');

if (existsSync(sourceEntrypoint)) {
  const child = spawnSync(process.execPath, ['--experimental-strip-types', sourceEntrypoint, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
    windowsHide: true
  });
  if (child.error) {
    throw child.error;
  }
  process.exitCode = child.status ?? 1;
} else {
  const { runCli } = await import(pathToFileURL(distEntrypoint).href);
  process.exitCode = await runCli(process.argv.slice(2));
}
