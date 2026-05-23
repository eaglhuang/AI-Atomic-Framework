#!/usr/bin/env node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const distEntrypoint = path.join(root, 'packages', 'cli', 'dist', 'atm.js');
const sourceEntrypoint = path.join(root, 'packages', 'cli', 'src', 'atm.ts');

const runtimeEntrypoint = existsSync(sourceEntrypoint) ? sourceEntrypoint : distEntrypoint;
const { runCli } = await import(pathToFileURL(runtimeEntrypoint).href);
process.exitCode = await runCli(process.argv.slice(2));
