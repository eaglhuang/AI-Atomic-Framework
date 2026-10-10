#!/usr/bin/env node
import { runCli } from './runtime.mjs';

process.exitCode = await runCli(process.argv.slice(2));
