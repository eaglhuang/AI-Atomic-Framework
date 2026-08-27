import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliRoot = path.join(root, 'packages', 'cli');
const distRoot = path.join(cliRoot, 'dist');
const packageJson = JSON.parse(readFileSync(path.join(cliRoot, 'package.json'), 'utf8')) as Record<string, any>;
const budget = packageJson.atmArtifactBudget;

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath];
  });
}

function fail(message: string): never {
  throw new Error(`[adopter-artifact-manifest] ${message}`);
}

if (!Array.isArray(packageJson.files) || packageJson.files.length !== 1 || packageJson.files[0] !== 'dist') {
  fail('CLI npm manifest must publish only dist.');
}
if (!budget || budget.schemaId !== 'atm.cliArtifactBudget.v1') {
  fail('CLI package must declare atm.cliArtifactBudget.v1.');
}
if (!budget.ownerApprovedDependencyRevision?.approvedBy || !budget.ownerApprovedDependencyRevision?.reason) {
  fail('A dependency-level budget revision requires explicit owner approval metadata.');
}
const files = filesUnder(distRoot);
if (files.length === 0) fail('CLI dist is missing; build packages before validating the artifact.');
const relative = files.map((file) => path.relative(distRoot, file).replace(/\\/g, '/'));
const forbidden = relative.filter((file) => /(^|\/)__tests__(\/|$)|\.test\.[cm]?[jt]s$|(^|\/)(fixtures)(\/|$)/.test(file));
if (forbidden.length > 0) fail(`CLI dist contains forbidden adopter files: ${forbidden.slice(0, 8).join(', ')}`);
if (!relative.includes('atm.mjs') || !relative.includes('atm.js')) {
  fail('CLI dist must contain the runtime bin and implementation entrypoints.');
}
const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
const cap = budget.ownerApprovedDependencyRevision.revisedBudget;
if (!cap || !Number.isInteger(cap.maxPackedEntries) || !Number.isInteger(cap.maxPackedBytes)) {
  fail('Owner-approved revision must provide integer byte and entry caps.');
}
if (files.length > cap.maxPackedEntries || bytes > cap.maxPackedBytes) {
  fail(`CLI dist exceeds approved budget: ${files.length}/${cap.maxPackedEntries} entries, ${bytes}/${cap.maxPackedBytes} bytes.`);
}
console.log(JSON.stringify({
  ok: true,
  schemaId: 'atm.adopterArtifactManifestValidation.v1',
  files: files.length,
  bytes,
  caps: cap,
  forbiddenCount: forbidden.length
}, null, 2));
