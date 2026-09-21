import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The validator regenerates a tracked report, so point it somewhere else: a
// check that has to leave the worktree clean cannot rewrite docs/reports.
const scratch = mkdtempSync(join(tmpdir(), "atm-2-1-closure-"));
const reportPath = join(scratch, "atm-2-1-final-closure.md");
try {
  const result = spawnSync(
    process.execPath,
    ["--strip-types", "scripts/validate-atm-2-1-closure.ts", "--mode", "validate", "--output", reportPath],
    { cwd: process.cwd(), encoding: "utf8" },
  );

  assert.notEqual(result.status, 0, "closure validator must fail closed until validate:standard passes");

  const report = readFileSync(reportPath, "utf8");
  assert.match(report, /Verdict: fail/);

  // Assert the matrix contract, not a frozen verdict per row. The rows carry
  // live governance results: the paired A/B row was pinned here as `pass` and
  // has since legitimately moved to `fail`, so pinning made the test a record
  // of what was true once rather than a check of anything.
  const rows = report
    .split(/\r?\n/)
    .filter((line) => /^\| /.test(line) && / \| (pass|fail) \| /.test(line))
    .map((line) => {
      const cells = line.split("|").map((cell) => cell.trim());
      return { requirement: cells[1], status: cells[2], evidence: cells[3], recovery: cells[4] };
    });
  assert.ok(rows.length >= 6, `expected the closure matrix rows, got ${rows.length}`);
  for (const row of rows) {
    assert.ok(row.requirement.length > 0, "every row must name its requirement");
    assert.ok(row.evidence.length > 0, `row ${row.requirement} must cite evidence`);
    assert.ok(row.recovery.length > 0, `row ${row.requirement} must offer a recovery command`);
  }

  // Fail-closed is the property under test: a failing cell must not be able to
  // coexist with a passing verdict.
  const failing = rows.filter((row) => row.status === "fail");
  assert.ok(failing.length > 0, "a fail verdict must be explained by at least one failing row");
  assert.ok(
    failing.some((row) => /Standard validation profile/.test(row.requirement)),
    "the standard validation profile must be one of the failing rows while validate:standard has a failed cell",
  );
  assert.doesNotMatch(report, /Verdict: pass/);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log("atm-2-1-final-closure.test.ts: ok");
