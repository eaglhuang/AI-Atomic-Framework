import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), 'self-host-alpha', '--verify', '--agent', 'openai-assistants-api', '--json'], {
  cwd: root,
  encoding: 'utf8'
});

const payload = (result.stdout || result.stderr || '').trim();
if ((result.status ?? 1) !== 0) {
  process.stderr.write(`${payload}\n`);
  process.exitCode = result.status ?? 1;
} else {
  process.stdout.write(`${payload}\n`);
}
