#!/usr/bin/env node
import { runCli } from './atm.js';

process.exitCode = await runCli(process.argv.slice(2));
