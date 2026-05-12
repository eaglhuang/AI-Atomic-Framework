#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const distEntrypoint = path.join(root, 'packages', 'cli', 'dist', 'atm.mjs');
const sourceEntrypoint = path.join(root, 'packages', 'cli', 'src', 'atm.mjs');
const entrypoint = existsSync(sourceEntrypoint) ? sourceEntrypoint : distEntrypoint;
const { runCli } = await import(pathToFileURL(entrypoint).href);

process.exitCode = await runCli(process.argv.slice(2));
