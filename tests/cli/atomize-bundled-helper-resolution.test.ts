import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveAtomizeHelperPath } from '../../packages/cli/src/commands/atomize.ts';

const scratch = mkdtempSync(path.join(os.tmpdir(), 'atm-atomize-helper-'));
try {
  const packageRoot = path.join(scratch, 'node_modules', '@ai-atomic-framework', 'cli');
  const commandDir = path.join(packageRoot, 'dist', 'commands');
  mkdirSync(commandDir, { recursive: true });
  mkdirSync(path.join(packageRoot, 'scripts', 'src'), { recursive: true });
  writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: '@ai-atomic-framework/cli' }));
  const moduleUrl = pathToFileURL(path.join(commandDir, 'atomize.js')).href;

  assert.equal(
    resolveAtomizeHelperPath(moduleUrl),
    path.join(packageRoot, 'scripts', 'src', 'atomization-register-receipt.js'),
    'bundled CLI helpers must resolve from the installed package root'
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log('ok: atomize bundled helper resolution spec passed');
