import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  RELEASE_PREPUBLISH_BUDGET_MS,
  RELEASE_PREPUBLISH_CODES,
  RELEASE_PREPUBLISH_PROFILE,
  applyReleasePrepublishSelection,
  buildSealedPriorEvidence,
  consumePriorEvidence,
  enforceReleasePrepublishBudget,
  readReleasePrepublishProfile,
} from "../../scripts/lib/release-prepublish-gate.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const config = JSON.parse(
  readFileSync(path.join(repoRoot, "scripts", "validators.config.json"), "utf8"),
);
const profileConfig = config.profiles[RELEASE_PREPUBLISH_PROFILE];
const parsedProfile = readReleasePrepublishProfile(profileConfig);
assert.equal(parsedProfile.ok, true, "committed release-prepublish profile must be valid");
assert.equal(profileConfig.performanceBudgetMs, RELEASE_PREPUBLISH_BUDGET_MS);
assert.equal(profileConfig.budgetEnforcement, "fail-closed");

const executeNames = parsedProfile.ok ? parsedProfile.profile.validators : [];
assert.deepEqual(executeNames, [
  "validate-release-trust",
  "validate-known-bad-versions",
  "validate-security-policy",
  "validate-package-skeleton",
]);

const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" });
assert.equal(head.status, 0);
const headCommit = String(head.stdout ?? "").trim();
assert.ok(headCommit);

const obligations = parsedProfile.ok ? parsedProfile.profile.requiredObligations : [];
const matchingEvidence = buildSealedPriorEvidence({ headCommit, obligations });

{
  const omitted = structuredClone(profileConfig);
  omitted.validators = omitted.validators.filter(
    (name: string) => name !== "validate-release-trust",
  );
  const result = readReleasePrepublishProfile(omitted);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, RELEASE_PREPUBLISH_CODES.requiredOmitted);
  }
}

{
  const missing = applyReleasePrepublishSelection({
    profileConfig,
    priorEvidencePath: null,
    selectedValidatorNames: executeNames,
    headCommit,
    repoRoot,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.equal(missing.code, RELEASE_PREPUBLISH_CODES.evidenceMissing);
  }
}

{
  const tmp = mkdtempSync(path.join(os.tmpdir(), "atm-release-prepublish-"));
  const evidencePath = path.join(tmp, "missing.json");
  const missingFile = applyReleasePrepublishSelection({
    profileConfig,
    priorEvidencePath: evidencePath,
    selectedValidatorNames: executeNames,
    headCommit,
    repoRoot,
  });
  assert.equal(missingFile.ok, false);
  if (!missingFile.ok) {
    assert.equal(missingFile.code, RELEASE_PREPUBLISH_CODES.evidenceMissing);
  }
}

{
  const mismatchedHead = consumePriorEvidence({
    profile: parsedProfile.ok ? parsedProfile.profile : { requiredObligations: [], validators: [] },
    evidence: { ...matchingEvidence, headCommit: "0".repeat(40) },
    selectedValidatorNames: executeNames,
    headCommit,
  });
  assert.equal(mismatchedHead.ok, false);
  if (!mismatchedHead.ok) {
    assert.equal(mismatchedHead.code, RELEASE_PREPUBLISH_CODES.evidenceMismatch);
  }
}

{
  const digestMismatch = {
    ...matchingEvidence,
    obligations: matchingEvidence.obligations.map((entry) =>
      entry.id === "root-drop-release"
        ? { ...entry, digest: "sha256:deadbeef" }
        : entry,
    ),
  };
  const result = consumePriorEvidence({
    profile: parsedProfile.ok ? parsedProfile.profile : { requiredObligations: [], validators: [] },
    evidence: digestMismatch,
    selectedValidatorNames: executeNames,
    headCommit,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.code, RELEASE_PREPUBLISH_CODES.evidenceMismatch);
    assert.match(result.message, /root-drop-release/);
  }
}

{
  const matched = consumePriorEvidence({
    profile: parsedProfile.ok ? parsedProfile.profile : { requiredObligations: [], validators: [] },
    evidence: matchingEvidence,
    selectedValidatorNames: executeNames,
    headCommit,
  });
  assert.equal(matched.ok, true);
  if (matched.ok) {
    assert.deepEqual([...matched.executeValidatorNames], executeNames);
    const consumedIds = matched.consumedResults.map((entry) => String(entry.name));
    assert.ok(consumedIds.includes("root-drop-release"));
    assert.ok(consumedIds.includes("typecheck"));
    assert.equal(
      matched.consumedResults.every((entry) => entry.consumedPriorEvidence === true),
      true,
    );
  }
}

{
  const omittedSelection = consumePriorEvidence({
    profile: parsedProfile.ok ? parsedProfile.profile : { requiredObligations: [], validators: [] },
    evidence: matchingEvidence,
    selectedValidatorNames: executeNames.filter((name) => name !== "validate-package-skeleton"),
    headCommit,
  });
  assert.equal(omittedSelection.ok, false);
  if (!omittedSelection.ok) {
    assert.equal(omittedSelection.code, RELEASE_PREPUBLISH_CODES.requiredOmitted);
  }
}

{
  const over = enforceReleasePrepublishBudget({
    profile: RELEASE_PREPUBLISH_PROFILE,
    profileConfig,
    durationMs: RELEASE_PREPUBLISH_BUDGET_MS + 1,
  });
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.equal(over.code, RELEASE_PREPUBLISH_CODES.budgetExceeded);
  }
  const under = enforceReleasePrepublishBudget({
    profile: RELEASE_PREPUBLISH_PROFILE,
    profileConfig,
    durationMs: RELEASE_PREPUBLISH_BUDGET_MS,
  });
  assert.equal(under.ok, true);
}

{
  const tmp = mkdtempSync(path.join(os.tmpdir(), "atm-release-prepublish-"));
  const evidencePath = path.join(tmp, "prior-evidence.json");
  writeFileSync(evidencePath, `${JSON.stringify(matchingEvidence, null, 2)}\n`, "utf8");
  const started = Date.now();
  const run = spawnSync(
    process.execPath,
    [
      "--strip-types",
      path.join(repoRoot, "scripts", "run-validators.ts"),
      RELEASE_PREPUBLISH_PROFILE,
      "--parallel",
      "--json",
      "--prior-evidence",
      evidencePath,
    ],
    { cwd: repoRoot, encoding: "utf8", timeout: RELEASE_PREPUBLISH_BUDGET_MS + 30_000 },
  );
  const durationMs = Date.now() - started;
  assert.equal(run.status, 0, `measured prepublish gate failed: ${run.stderr}\n${run.stdout}`);
  const summary = JSON.parse(String(run.stdout ?? "").trim());
  assert.equal(summary.profile, RELEASE_PREPUBLISH_PROFILE);
  assert.ok(summary.durationMs <= RELEASE_PREPUBLISH_BUDGET_MS, `measured duration ${summary.durationMs}ms exceeds 180000ms`);
  assert.ok(durationMs <= RELEASE_PREPUBLISH_BUDGET_MS + 5_000, `wall clock ${durationMs}ms far above budget`);
  for (const name of executeNames) {
    assert.ok(
      summary.validators.some((entry: { name: string; ok: boolean }) => entry.name === name && entry.ok === true),
      `executed ${name} must pass`,
    );
  }
  assert.ok(
    summary.validators.some(
      (entry: { name: string; consumedPriorEvidence?: boolean }) =>
        entry.name === "root-drop-release" && entry.consumedPriorEvidence === true,
    ),
    "matching prior evidence for root-drop-release must be consumed, not re-executed",
  );
}

process.stdout.write("[release-prepublish-gate] ok\n");
