import { withStewardApplyQueue } from '/workspace/atm-main-b35a6141/AI-Atomic-Framework-b35a6141bd5bfbaec654f1cd3079323581b04074/packages/core/src/broker/steward-apply-queue.ts';
import { writeFileSync } from 'node:fs';
const dir = process.argv[2]; const n = +process.argv[3]; const errs = {}; let ok = 0;
writeFileSync(dir + '/f.txt', 'x', { flag: 'a' });
for (let i = 0; i < n; i++) {
  try { withStewardApplyQueue({ cwd: dir, targetPaths: [dir + '/f.txt'], enabled: true, waitMs: 10000, pollMs: 5 }, () => { const t = Date.now(); while (Date.now() - t < 1); }); ok++; }
  catch (e) { const fr = (e.stack || '').split('\n').find(l => l.includes('steward-apply-queue')) || ''; const k = (e.code||'') + ' ' + e.message + ' @' + fr.trim().replace(/.*steward-apply-queue.ts:/, 'L'); errs[k] = (errs[k] || 0) + 1; }
}
console.log(JSON.stringify({ pid: process.pid, ok, errs }));
