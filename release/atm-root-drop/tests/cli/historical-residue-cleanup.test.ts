import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const script = join(root, "scripts", "cleanup-historical-governance-residue.ts");

// The census counts dirty .atm files plus live locks and lane sessions, so a
// clean checkout legitimately reports nothing and asserting over the live
// repository only measured whichever residue the machine happened to carry.
// Build the three residue shapes it classifies and read them back.
const fixture = mkdtempSync(join(tmpdir(), "atm-residue-"));
try {
  const git = (...args: string[]) => {
    const out = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
    assert.equal(out.status, 0, out.stderr);
  };
  const write = (relativePath: string, body: unknown) => {
    const absolute = join(fixture, relativePath);
    mkdirSync(join(absolute, ".."), { recursive: true });
    writeFileSync(absolute, `${JSON.stringify(body, null, 2)}\n`, "utf8");
    return absolute;
  };

  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "fixture");
  write(".atm/history/tasks/TASK-FIXTURE-0001.json", { workItemId: "TASK-FIXTURE-0001", status: "closed" });
  git("add", "--all");
  git("commit", "--quiet", "--no-gpg-sign", "-m", "fixture baseline");

  // Tracked ledger, modified: reachable governance history.
  write(".atm/history/tasks/TASK-FIXTURE-0001.json", { workItemId: "TASK-FIXTURE-0001", status: "closed", note: "modified" });
  // Untracked runner-sync receipt, aged past the freshness window: quarantineable.
  const aged = write(".atm/history/evidence/TASK-FIXTURE-0001.runner-sync-receipt.json", { schemaId: "fixture" });
  const longAgo = new Date(Date.now() - 72 * 3_600_000);
  utimesSync(aged, longAgo, longAgo);
  // Live runtime lock: active, and never deletable.
  write(".atm/runtime/locks/TASK-FIXTURE-0001.lock.json", { workItemId: "TASK-FIXTURE-0001", actorId: "fixture" });

  const result = spawnSync(
    process.execPath,
    ["--strip-types", script, "--dry-run", "--json", "--no-report"],
    { cwd: fixture, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(result.status, 0, result.error ? String(result.error) : result.stderr);

  const summary = JSON.parse(result.stdout);
  assert.equal(summary.schemaId, "atm.historicalResidueCleanup.v1");
  assert.equal(summary.taskId, "TASK-TMP-0002");
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.mutationPolicy, "no-runtime-history-deletion");
  assert.deepEqual(summary.mutations, []);
  assert.equal(summary.totals.all, summary.receipts.length);
  assert.equal(summary.totals.deletable, 0, "dry-run must not mark runtime/history files as deletable");

  const byPath = new Map(summary.receipts.map((receipt: any) => [receipt.path, receipt]));
  assert.equal((byPath.get(".atm/history/tasks/TASK-FIXTURE-0001.json") as any)?.disposition, "reachable");
  assert.equal((byPath.get(".atm/history/evidence/TASK-FIXTURE-0001.runner-sync-receipt.json") as any)?.disposition, "quarantineable");
  assert.equal((byPath.get(".atm/runtime/locks/TASK-FIXTURE-0001.lock.json") as any)?.disposition, "active");

  for (const receipt of summary.receipts) {
    assert.match(receipt.path, /^\.atm\//);
    assert.match(receipt.digest, /^sha256:[a-f0-9]{64}$/);
    assert.ok(receipt.reason.length > 20);
    assert.ok(receipt.command.length > 0);
    assert.ok(receipt.rollbackRef.length > 0);
    assert.notEqual(receipt.disposition, "deletable");
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

// The tracked report is the published artifact of this census and states the
// no-deletion policy the receipts above encode.
const reportPath = join(root, "docs/reports/historical-governance-residue-cleanup.md");
assert.ok(existsSync(reportPath), "expected the tracked residue report to be present");
const report = readFileSync(reportPath, "utf8");
assert.match(report, /Historical Governance Residue Cleanup/);
assert.match(report, /no `\.atm` runtime or history file is deleted/);
console.log("historical-residue-cleanup.test.ts: ok");
