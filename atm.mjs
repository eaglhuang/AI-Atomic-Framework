#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const onefileEntrypoint = path.join(root, 'release', 'atm-onefile', 'atm.mjs');
const distEntrypoint = path.join(root, 'packages', 'cli', 'dist', 'atm.js');

if (existsSync(onefileEntrypoint)) {
  const result = spawnSync(process.execPath, [onefileEntrypoint, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  });
  process.exit(result.status ?? 1);
}

if (!existsSync(distEntrypoint)) {
  console.error([
    'ATM stable runner is not built.',
    'Run `npm run build` to refresh the frozen runner, or use `node atm.dev.mjs ...` for source-first framework development.'
  ].join('\n'));
  process.exit(1);
}

const { runCli } = await import(pathToFileURL(distEntrypoint).href);
process.exitCode = await runCli(process.argv.slice(2));
