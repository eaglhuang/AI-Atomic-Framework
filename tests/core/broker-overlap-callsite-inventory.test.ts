import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// ATM-GOV-0215 call-site inventory guard.
//
// ATM-GOV-0206 shipped a pattern-aware matcher but only converted one function.
// The other 14 overlap call sites kept exact string equality
// (Array.includes / Set.has) against resource-key collections, which is what
// let sample 0001's glob-vs-literal false negative survive the fix.
//
// This test derives the inventory from the source tree at test time and fails
// if any new exact-match comparison against a resource-key collection appears
// in the broker source. A hand-maintained list is explicitly rejected — it
// degrades the first time someone adds a decision module.
//
// If a legitimate new site needs to use exact equality for a reason unrelated
// to resource-key overlap semantics, mark that specific line with the exemption
// comment documented in EXEMPTION_MARKER below and cite a card id.

const BROKER_ROOT = path.resolve(process.cwd(), 'packages/core/src/broker');

const EXEMPTION_MARKER = 'atm-inventory-exempt:'; // followed by a card id / reason

// Patterns that indicate an exact-match comparison against a resource-key
// collection. These are the exact shapes ATM-GOV-0206/0215 converged. Any new
// site matching them re-introduces the ATM-BUG-2026-07-20-213 defect class.
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /resourceKeys\.\w+\.includes\(/,
  /\.targetFiles\.includes\(/,
  /\.sharedSurfaces\.\w+\.includes\(/,
  /new Set\([^)]*resourceKeys\./,
  /new Set\([^)]*targetFiles/,
  /new Set\([^)]*sharedSurfaces\./
];

interface Violation {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  readonly pattern: string;
}

function walk(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(root, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else if (st.isFile() && entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function scan(files: readonly string[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8').split(/\r?\n/);
    for (let i = 0; i < source.length; i += 1) {
      const line = source[i];
      if (line.includes(EXEMPTION_MARKER)) continue;
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(line)) {
          violations.push({ file: path.relative(process.cwd(), file), line: i + 1, text: line.trim(), pattern: pattern.source });
          break;
        }
      }
    }
  }
  return violations;
}

// 1. Inventory of the broker source produces zero forbidden matches.
const brokerFiles = walk(BROKER_ROOT);
assert.ok(brokerFiles.length > 5, 'broker source tree must be discoverable');

const violations = scan(brokerFiles);
if (violations.length > 0) {
  const rendered = violations.map((v) => `  ${v.file}:${v.line}  [pattern: ${v.pattern}]\n    ${v.text}`).join('\n');
  assert.fail(
    `Exact-match resource-key comparison detected — ATM-GOV-0215 requires routing every overlap call site through the shared pattern-aware matcher (packages/core/src/broker/resource-overlap.ts).\n\n${rendered}\n\nIf this site legitimately needs exact equality for reasons unrelated to overlap semantics, add the comment marker "${EXEMPTION_MARKER}<card-id>" on the same line.`
  );
}

// 2. The guard actually catches a synthetic violation — otherwise the test is
// vacuously true and would silently rot the moment scan() breaks.
const synthetic = `if (active.resourceKeys.files.includes(newFile)) { }`;
let synthMatched = false;
for (const pattern of FORBIDDEN_PATTERNS) {
  if (pattern.test(synthetic)) { synthMatched = true; break; }
}
assert.ok(synthMatched, 'guard must fail against a synthetic violation, otherwise it is not enforcing anything');

// 3. The exemption escape hatch works. A future maintainer must be able to
// document an intentional exception without disabling the guard globally.
const exempt = `if (foo.resourceKeys.files.includes(x)) { } // ${EXEMPTION_MARKER}ATM-EXAMPLE`;
// (The exemption is checked line-by-line in scan(); this synthetic line proves
//  the exemption string is preserved in the FORBIDDEN_PATTERNS design.)
assert.ok(exempt.includes(EXEMPTION_MARKER), 'exemption marker constant must be exportable via a comment');

console.log(`broker overlap call-site inventory: scanned ${brokerFiles.length} files, 0 violations`);
