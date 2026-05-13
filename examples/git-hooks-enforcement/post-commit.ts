import { spawnSync } from 'node:child_process';

const doctor = spawnSync(process.execPath, ['atm.mjs', 'doctor', '--json'], {
  cwd: process.cwd(),
  encoding: 'utf8'
});
const payload = parseJson(doctor.stdout || doctor.stderr || '{}');

if (doctor.status !== 0 || payload.ok !== true) {
  console.error('[atm-hooks] latest commit is not covered by ATM evidence.');
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
}

console.log('[atm-hooks] latest commit is covered by ATM evidence.');

function parseJson(value: any) {
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return {};
  }
}
