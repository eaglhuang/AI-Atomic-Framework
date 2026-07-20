import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const result = spawnSync(
  process.execPath,
  ["--strip-types", "scripts/cleanup-historical-governance-residue.ts", "--dry-run", "--json"],
  { cwd: root, encoding: "utf8" },
);

assert.equal(result.status, 0, result.stderr);

const summary = JSON.parse(result.stdout);
assert.equal(summary.schemaId, "atm.historicalResidueCleanup.v1");
assert.equal(summary.taskId, "TASK-TMP-0002");
assert.equal(summary.mode, "dry-run");
assert.equal(summary.mutationPolicy, "no-runtime-history-deletion");
assert.deepEqual(summary.mutations, []);
assert.ok(summary.totals.all > 0, "expected at least one governance residue receipt");
assert.equal(summary.totals.all, summary.receipts.length);

const dispositions = new Set(summary.receipts.map((receipt: any) => receipt.disposition));
assert.ok(dispositions.has("reachable"), "expected reachable governance history");
assert.ok(dispositions.has("quarantineable"), "expected quarantineable historical residue");
assert.equal(summary.totals.deletable, 0, "dry-run must not mark runtime/history files as deletable");

for (const receipt of summary.receipts) {
  assert.match(receipt.path, /^\.atm\//);
  assert.match(receipt.digest, /^sha256:[a-f0-9]{64}$/);
  assert.ok(receipt.reason.length > 20);
  assert.ok(receipt.command.length > 0);
  assert.ok(receipt.rollbackRef.length > 0);
}

const activeReceipts = summary.receipts.filter((receipt: any) => receipt.disposition === "active");
for (const receipt of activeReceipts) {
  assert.notEqual(receipt.disposition, "deletable");
}

const reportPath = join(root, summary.reportPath);
assert.ok(existsSync(reportPath), "expected report to be generated");
const report = readFileSync(reportPath, "utf8");
assert.match(report, /Historical Governance Residue Cleanup/);
assert.match(report, /no `\.atm` runtime or history file is deleted/);
