#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSkillPath = path.join(root, '.agents/skills/atm-git-pathspec-emergency-commit/SKILL.md');

function parseArgs(argv: string[]) {
  const options = { json: false, input: defaultSkillPath };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') options.json = true;
    else if (arg === '--input') options.input = path.resolve(root, String(argv[++index] ?? ''));
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node --strip-types scripts/validate-plan32-legal-recovery-lane.ts [--input <SKILL.md>] [--json]');
      process.exit(0);
    }
  }
  return options;
}

function hasAll(text: string, needles: string[]): string[] {
  return needles.filter((needle) => !text.includes(needle));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.input)) throw new Error(`recovery lane skill missing: ${path.relative(root, options.input)}`);
  const text = readFileSync(options.input, 'utf8').replace(/^\uFEFF/, '');
  const normalizedText = text.replace(/\s+/g, ' ');
  const findings: string[] = [];

  const requiredAnchors = [
    'name: atm-git-pathspec-emergency-commit',
    'Emergency-only runbook',
    'emergency/anomaly repair runbook',
    'excluded from',
    'autonomous Plan 3.1 success metrics',
    'Authority preconditions',
    'explicitly grants emergency authority',
    'Normal ATM recovery was attempted or ruled out',
    'keep-list of paths',
    'Exact staged-set verification',
    'ATM-Emergency-Reason',
    'Post-commit verification',
    'create or reference a backlog/follow-up item',
    'close the underlying task as normal delivery',
    'Stop conditions'
  ];
  const missing = hasAll(normalizedText, requiredAnchors);
  for (const anchor of missing) findings.push(`missing anchor: ${anchor}`);

  const forbiddenOrdinaryDelivery = /ordinary delivery is a Plan 3\.1 \*\*failure signal\*\*, not a success pattern/.test(text);
  if (!forbiddenOrdinaryDelivery) findings.push('ordinary delivery must be explicitly classified as failure signal');
  const namedLane = /name:\s*atm-git-pathspec-emergency-commit/.test(text);
  if (!namedLane) findings.push('legal recovery lane must be named in skill frontmatter');
  const pathBounded = /path-bounded/.test(text) && /Exact staged-set verification/.test(text);
  if (!pathBounded) findings.push('legal recovery lane must remain path-bounded and exact-staged-set checked');
  const authorityBeforeUse = text.indexOf('Authority preconditions') < text.indexOf('Native commit command shape');
  if (!authorityBeforeUse) findings.push('authority preconditions must precede native commit command shape');

  const ok = findings.length === 0;
  const diagnostics = [
    'lane-named',
    'authority-preconditions-before-use',
    'emergency-not-success-metric',
    'exact-keep-list-required',
    'post-commit-and-backlog-required'
  ];
  const output = {
    schemaId: 'atm.plan32LegalRecoveryLaneValidation.v1',
    ok,
    findings,
    verdict: ok ? 'legal-recovery-lane-named' : 'legal-recovery-lane-not-proven',
    laneName: 'atm-git-pathspec-emergency-commit',
    diagnostics
  };

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else if (ok) console.log(`[validate-plan32-legal-recovery-lane] ok lane=${output.laneName} diagnostics=${diagnostics.join(',')}`);
  else console.error(`[validate-plan32-legal-recovery-lane] failed: ${findings.join('; ')}`);
  process.exit(ok ? 0 : 1);
}

main();
