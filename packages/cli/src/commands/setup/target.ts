import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { assertNoSymlinkPath, losslessUtf8 } from '../../../../integrations-core/src/manifest/safe-install.ts';
import { CliError } from '../shared.ts';

const outputRoots = ['.atm', '.agents', '.claude', '.cursor', '.github', '.gemini', 'integrations', 'atm.mjs', 'AGENTS.md', 'README.md'];

/** Setup never turns the default project-local operation into a global write. */
export function validateSetupTarget(candidate: string, home = homedir(), env = process.env): string {
  const root = path.resolve(candidate);
  const configRoots = [
    ...['.atm', '.agents', '.claude', '.codex', '.cursor', '.copilot', '.gemini'].map(entry => path.join(home, entry)),
    ...['CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'COPILOT_HOME'].flatMap(key => env[key] ? [path.resolve(env[key]!)] : []),
    ...(env.GEMINI_CLI_HOME ? [path.join(env.GEMINI_CLI_HOME, '.gemini')] : [])];
  if (isSameOrWithin(root, path.parse(root).root, false) || isSameOrWithin(root, home, false)
    || configRoots.some(entry => isSameOrWithin(root, entry))) {
    throw new CliError('ATM_SETUP_UNSAFE_TARGET', 'Select a project directory, not a home, filesystem root, or global agent configuration directory.', { exitCode: 2 });
  }
  assertNoSymlinkPath(root);
  if (existsSync(root) && !lstatSync(root).isDirectory()) throw new CliError('ATM_SETUP_INVALID_TARGET', 'The setup target must be a directory.', { exitCode: 2 });
  for (const entry of outputRoots) inspect(path.join(root, entry));
  for (const entry of ['AGENTS.md', 'README.md']) {
    const file = path.join(root, entry);
    if (existsSync(file) && lstatSync(file).isFile()) losslessUtf8(readFileSync(file));
  }
  return root;
}

export function isSameOrWithin(candidate: string, parent: string, descendants = true, platform = process.platform): boolean {
  const paths = platform === 'win32' ? path.win32 : path;
  const canonical = (value: string) => platform === 'win32' ? paths.resolve(value).toLowerCase() : paths.resolve(value);
  const child = canonical(candidate), root = canonical(parent);
  const relative = paths.relative(root, child);
  return child === root || (descendants && !relative.startsWith(`..${paths.sep}`) && relative !== '..' && !paths.isAbsolute(relative));
}

function inspect(candidate: string): void {
  assertNoSymlinkPath(candidate);
  if (!existsSync(candidate)) return;
  const info = lstatSync(candidate);
  if (!info.isDirectory()) return;
  for (const child of readdirSync(candidate)) inspect(path.join(candidate, child));
}
