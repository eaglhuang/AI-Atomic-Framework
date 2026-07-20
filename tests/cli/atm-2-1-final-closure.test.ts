import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const result = spawnSync(
  process.execPath,
  ["--strip-types", "scripts/validate-atm-2-1-closure.ts", "--mode", "validate"],
  { cwd: process.cwd(), encoding: "utf8" },
);

assert.notEqual(result.status, 0, "closure validator must fail closed until validate:standard passes");

const reportPath = join(process.cwd(), "docs/reports/atm-2-1-final-closure.md");
assert.ok(existsSync(reportPath), "expected final closure report");

const report = readFileSync(reportPath, "utf8");
assert.match(report, /Verdict: fail/);
assert.match(report, /All upstream task cards closed with released claims \| pass/);
assert.match(report, /420-cell paired A\/B v4 met rollout metrics and safety controller \| pass/);
assert.match(report, /Historical residue cleanup is non-destructive and consumable \| pass/);
assert.match(report, /Standard validation profile has no failed cells \| fail/);
