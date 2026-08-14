import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED_RECEIPT_IDS = new Set([
  'target-head', 'origin-main-head', 'planning-head', 'target-status-porcelain',
  'planning-status-porcelain', 'worktree-registry', 'task-ledger-census',
  'protected-override-census', 'validate-test-facade', 'validate-module-boundaries',
  'validate-quick', 'validate-standard'
]);
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const digest = (value: string) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function validateFreezeArtifact(value: unknown): string[] {
  if (!isRecord(value)) return ['artifact must be an object'];
  const findings: string[] = [];
  if (value.schemaId !== 'atm.falseGreenEvidenceFreeze.v1') findings.push('schemaId must be atm.falseGreenEvidenceFreeze.v1');
  if (value.verdict !== 'remain-open') findings.push('verdict must remain-open; a freeze cannot certify completion');
  if (!isRecord(value.scope)) findings.push('scope must be an object');
  else {
    for (const key of ['targetHead', 'originMainHead', 'planningHead']) {
      if (typeof value.scope[key] !== 'string' || !GIT_SHA.test(value.scope[key])) findings.push(`scope.${key} must be a full Git SHA`);
    }
    if (value.scope.sourceDigestStatus !== 'present') findings.push('scope.sourceDigestStatus must be present');
    if (!['observed', 'unavailable'].includes(String(value.scope.rescueWorktreeAvailability))) findings.push('scope.rescueWorktreeAvailability must be observed or unavailable');
  }
  if (!Array.isArray(value.commandReceipts)) return [...findings, 'commandReceipts must be an array'];
  const seen = new Set<string>();
  for (const receipt of value.commandReceipts) {
    if (!isRecord(receipt)) { findings.push('commandReceipt must be an object'); continue; }
    const id = typeof receipt.id === 'string' ? receipt.id : '';
    if (!id) { findings.push('commandReceipt.id must be a string'); continue; }
    if (seen.has(id)) findings.push(`duplicate commandReceipt.id:${id}`);
    seen.add(id);
    if (!Array.isArray(receipt.command) || receipt.command.length === 0 || !receipt.command.every((part) => typeof part === 'string')) findings.push(`commandReceipt.command invalid:${id}`);
    if (typeof receipt.stdout !== 'string' || typeof receipt.stderr !== 'string') { findings.push(`commandReceipt streams invalid:${id}`); continue; }
    for (const [field, expected] of [
      ['stdoutDigest', digest(receipt.stdout)],
      ['stderrDigest', digest(receipt.stderr)],
      ['combinedDigest', digest(`${receipt.stdout}\u0000${receipt.stderr}`)]
    ] as const) {
      if (typeof receipt[field] !== 'string' || !SHA256.test(receipt[field]) || receipt[field] !== expected) findings.push(`commandReceipt.${field} mismatch:${id}`);
    }
    if (typeof receipt.timedOut !== 'boolean') findings.push(`commandReceipt.timedOut invalid:${id}`);
    if (!(typeof receipt.exitCode === 'number' || receipt.exitCode === null)) findings.push(`commandReceipt.exitCode invalid:${id}`);
  }
  for (const id of REQUIRED_RECEIPT_IDS) if (!seen.has(id)) findings.push(`missing required commandReceipt:${id}`);
  return findings;
}

function cli(): void {
  const fileIndex = process.argv.indexOf('--file');
  const file = fileIndex >= 0 ? process.argv[fileIndex + 1] : 'docs/reports/plan-3x-4x-false-green-evidence-freeze.json';
  if (!file) throw new Error('--file requires a path');
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`freeze artifact is missing: ${path}`);
  let artifact: unknown;
  try { artifact = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error(`freeze artifact is invalid JSON: ${path}`); }
  const findings = validateFreezeArtifact(artifact);
  if (findings.length) {
    console.error(`[false-green-freeze] invalid\n- ${findings.join('\n- ')}`);
    process.exitCode = 1;
    return;
  }
  console.log(`[false-green-freeze] ok ${path}`);
}

if (process.argv[1]?.endsWith('validate-false-green-evidence-freeze.ts')) cli();
