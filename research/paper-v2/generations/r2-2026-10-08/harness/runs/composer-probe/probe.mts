import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os'; import path from 'node:path';
const ATM = process.env.ATM!;
const { composeBrokerProposals } = await import(ATM + '/packages/core/src/broker/compose.ts');
const { applyStewardPlan } = await import(ATM + '/packages/core/src/broker/steward.ts');
function repo(content: string) {
  const d = mkdtempSync(path.join(os.tmpdir(), 'csp-'));
  const g = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 'x@x'); g('config', 'user.name', 'x');
  writeFileSync(path.join(d, 'f.ts'), content); g('add', '.'); g('commit', '-qm', 'b');
  return { d, head: g('rev-parse', 'HEAD').stdout.trim(), hash: 'sha256:' + createHash('sha256').update(content).digest('hex') };
}
function prop(id: string, actor: string, r: any, anchor: string, atom: string, patch: string) {
  return { schemaId: 'atm.patchProposal.v1', specVersion: '0.1.0', migration: { strategy: 'none', fromVersion: null, notes: 'p' },
    proposalId: id, taskId: 'T-' + id, actorId: actor, baseCommit: r.head, fileBeforeHash: r.hash, targetFile: 'f.ts',
    atomRefs: [{ atomId: atom, atomCid: 'cid-' + atom }], anchors: [{ kind: 'symbol', hint: anchor }], intent: 'i', patch, validators: [], rollback: 'r' };
}
const base = Array.from({ length: 10 }, (_, i) => `line${i + 1}`).join('\n') + '\n';
function run(label: string, pa: string, pb: string, anchorA = 'a', anchorB = 'b') {
  const r = repo(base);
  const A = prop('pA', 'agentA', r, anchorA, 'atomA', pa), B = prop('pB', 'agentB', r, anchorB, 'atomB', pb);
  const c = composeBrokerProposals([A, B]);
  let out: any;
  try {
    const res = applyStewardPlan({ cwd: r.d, stewardId: 'neutral-write-steward', mergePlan: c.mergePlan, proposals: [A, B], scopeFiles: ['f.ts'] });
    out = { ok: res.ok, verdict: res.evidence.verdict, reasons: res.evidence.blockedReasons };
  } catch (e: any) { out = { threw: e?.name + ': ' + e?.message }; }
  const final = readFileSync(path.join(r.d, 'f.ts'), 'utf8');
  console.log(JSON.stringify({ label, composeVerdict: c.mergePlan.verdict, applyMethod: c.mergePlan.applyMethod, ...out, hasA: final.includes('A_EDIT'), hasB: final.includes('B_EDIT') }));
}
// 1. disjoint, equal-length replacements
run('disjoint-replace', '@@ -2,1 +2,1 @@\n-line2\n+A_EDIT\n', '@@ -8,1 +8,1 @@\n-line8\n+B_EDIT\n');
// 2. disjoint, A (top, sorted first) inserts a line
run('disjoint-insert-top-first', '@@ -2,1 +2,2 @@\n line2\n+A_EDIT\n', '@@ -8,1 +8,2 @@\n line8\n+B_EDIT\n');
// 3. disjoint, sort puts bottom patch first (anchor order)
run('disjoint-insert-bottom-first', '@@ -2,1 +2,2 @@\n line2\n+A_EDIT\n', '@@ -8,1 +8,2 @@\n line8\n+B_EDIT\n', 'z', 'b');
// 4. overlapping same line
run('overlap-same-line', '@@ -5,1 +5,1 @@\n-line5\n+A_EDIT\n', '@@ -5,1 +5,1 @@\n-line5\n+B_EDIT\n');
// 5. proposer acts as steward
{
  const r = repo(base);
  const A = prop('pA', 'agentA', r, 'a', 'atomA', '@@ -2,1 +2,1 @@\n-line2\n+A_EDIT\n');
  const c = composeBrokerProposals([A]);
  const res = applyStewardPlan({ cwd: r.d, stewardId: 'agentA', mergePlan: c.mergePlan, proposals: [A], scopeFiles: ['f.ts'] });
  console.log(JSON.stringify({ label: 'proposer-as-steward', ok: res.ok, verdict: res.evidence.verdict, stewardId: res.evidence.stewardId }));
}
