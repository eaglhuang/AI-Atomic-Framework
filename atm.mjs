#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const onefileEntrypoint = path.join(root, 'release', 'atm-onefile', 'atm.mjs');
const distEntrypoint = path.join(root, 'packages', 'cli', 'dist', 'atm.js');
const runnerSyncCommand = 'ATM_RETAIN_RELEASE_ARTIFACTS=1 npm run build';

if (existsSync(onefileEntrypoint)) {
  warnIfStableRunnerIsStale(root, onefileEntrypoint, process.argv.slice(2));
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
    `Run \`${runnerSyncCommand}\` to refresh the frozen runner, or use \`node atm.dev.mjs ...\` for source-first framework development.`
  ].join('\n'));
  process.exit(1);
}

const { runCli } = await import(pathToFileURL(distEntrypoint).href);
process.exitCode = await runCli(process.argv.slice(2));

function warnIfStableRunnerIsStale(rootDir, runnerPath, cliArgs) {
  const newestSourceMtime = newestMtime([
    path.join(rootDir, 'packages', 'cli', 'src'),
    path.join(rootDir, 'scripts')
  ]);
  const runnerMtime = safeMtime(runnerPath);
  if (!newestSourceMtime || !runnerMtime || newestSourceMtime <= runnerMtime) return;
  console.error([
    'ATM_RUNNER_SYNC_REQUIRED: stable atm.mjs is older than framework source files.',
    `Run \`${runnerSyncCommand}\` before using the frozen runner, or use \`node atm.dev.mjs ...\` for source-first framework validation.`
  ].join('\n'));
}

function newestMtime(paths) {
  let newest = 0;
  for (const entryPath of paths) {
    newest = Math.max(newest, newestMtimeInTree(entryPath));
  }
  return newest;
}

function newestMtimeInTree(entryPath) {
  const stat = safeStat(entryPath);
  if (!stat) return 0;
  if (stat.isFile()) return stat.mtimeMs;
  if (!stat.isDirectory()) return 0;
  let newest = 0;
  for (const child of readdirSync(entryPath, { withFileTypes: true })) {
    if (child.name === 'dist' || child.name === 'node_modules') continue;
    newest = Math.max(newest, newestMtimeInTree(path.join(entryPath, child.name)));
  }
  return newest;
}

function safeMtime(entryPath) {
  return safeStat(entryPath)?.mtimeMs ?? 0;
}

function safeStat(entryPath) {
  try {
    return statSync(entryPath);
  } catch {
    return null;
  }
}
