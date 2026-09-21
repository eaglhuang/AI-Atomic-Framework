#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultFixturePath = path.join(root, 'tests/fixtures/plan3-fake-green/sealed-bundle-tree-subset.json');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultFixturePath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan32-sealed-bundle-tree-subset.ts [--input <fixture.json>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`fixture missing: ${path.relative(root, options.input)}`);
  const fixture = JSON.parse(readFileSync(options.input, 'utf8').replace(/^\uFEFF/, ''));
  const findings: string[] = [];

  const candidatePaths = new Set(asStrings(fixture.candidateTree?.paths));
  const sealedPaths = asStrings(fixture.sealedBundle?.paths);
  const residuePaths = new Set(asStrings(fixture.liveSurfaceResidue?.paths));
  const missingFromCandidate = sealedPaths.filter((entry) => !candidatePaths.has(entry));
  const residueIncluded = sealedPaths.filter((entry) => residuePaths.has(entry));

  if (fixture.schemaId !== 'atm.plan3SealedBundleTreeSubsetFixture.v1') findings.push('schemaId mismatch');
  if (fixture.specVersion !== '0.1.0') findings.push('specVersion mismatch');
  if (!String(fixture.candidateTree?.treeSha ?? '').startsWith('sha256:')) findings.push('candidate tree digest missing');
  if (candidatePaths.size === 0) findings.push('candidate tree paths missing');
  if (sealedPaths.length === 0) findings.push('sealed bundle paths missing');
  if (missingFromCandidate.length > 0) findings.push(`sealed paths missing from candidate tree: ${missingFromCandidate.join(',')}`);
  if (fixture.liveSurfaceResidue?.mustNotBeInSealedBundle !== true) findings.push('foreign live surface exclusion flag missing');
  if (residueIncluded.length > 0) findings.push(`foreign residue included in sealed bundle: ${residueIncluded.join(',')}`);
  if (fixture.expectedVerdict !== 'sealed-bundle-is-tree-subset') findings.push('expected verdict mismatch');

  const diagnostics = [
    'sealed-paths-subset-of-candidate-tree',
    'foreign-live-surface-excluded',
    'empty-missing-from-candidate'
  ];
  const ok = findings.length === 0;
  const output = {
    schemaId: 'atm.plan32SealedBundleTreeSubsetValidation.v1',
    ok,
    findings,
    verdict: ok ? 'sealed-bundle-is-tree-subset' : 'sealed-bundle-subset-not-proven',
    sealedPathCount: sealedPaths.length,
    candidatePathCount: candidatePaths.size,
    foreignResidueCount: residuePaths.size,
    diagnostics
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-sealed-bundle-tree-subset] ok sealed=${sealedPaths.length} candidate=${candidatePaths.size} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan32-sealed-bundle-tree-subset] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
