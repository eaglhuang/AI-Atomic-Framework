export const atomMetadata = Object.freeze({
  "atomId": "ATM-GOV-0001",
  "logicalName": "atom.work-coordination-authority-planning-source-seal",
  "title": "PlanningSourceSealPolicy",
  "generatedBy": "atom.core-atom-generator",
  "atomizedFrom": "packages/cli/src/commands/tasks/planning-source-seal-policy.ts#classifyPlanningSourceSeal"
});

import { classifyPlanningSourceSeal } from "../../../packages/cli/src/commands/tasks/planning-source-seal-policy.ts";

/**
 * Readable atom wrapper around the planning-source seal classifier.
 *
 * The atom takes two seal identities — the one sealed at import time and the one
 * read from the card now — and reports which of the four outcomes applies:
 * `match`, `benign-seal-upgrade`, `governed-amendment`, or `drift`.
 */
export function runAtom(input = {}) {
  const classification = classifyPlanningSourceSeal({
    sealed: input.sealed,
    current: input.current,
    sourcePlanPath: input.sourcePlanPath ?? null
  });
  return {
    ok: true,
    atomId: atomMetadata.atomId,
    logicalName: atomMetadata.logicalName,
    sourceSymbol: atomMetadata.atomizedFrom,
    classification
  };
}

function identity(overrides = {}) {
  return {
    repoIdentity: "atom://planning-repo",
    taskCardPath: "tasks/example.task.md",
    planningCommitSha: null,
    contentDigest: "sha256:atom-fixture-digest",
    amendmentEpoch: 0,
    ...overrides
  };
}

export function selfCheck() {
  if (atomMetadata.atomId !== "ATM-GOV-0001") return false;
  if (atomMetadata.logicalName !== "atom.work-coordination-authority-planning-source-seal") return false;

  const unchanged = runAtom({ sealed: identity(), current: identity() }).classification;
  if (unchanged.status !== "match" || unchanged.ok !== true) return false;

  // An untracked card that was later committed unchanged is a storage-identity
  // upgrade, not a planning amendment.
  const benign = runAtom({
    sealed: identity(),
    current: identity({ planningCommitSha: "0".repeat(40) })
  }).classification;
  if (benign.status !== "benign-seal-upgrade" || benign.ok !== true) return false;
  if (benign.driftKinds.length !== 0) return false;

  // The same sha delta with changed content must stay blocking.
  const drifted = runAtom({
    sealed: identity(),
    current: identity({ planningCommitSha: "0".repeat(40), contentDigest: "sha256:atom-fixture-digest-moved" })
  }).classification;
  if (drifted.status !== "drift" || drifted.ok !== false) return false;

  const amended = runAtom({
    sealed: identity(),
    current: identity({
      planningCommitSha: "0".repeat(40),
      contentDigest: "sha256:atom-fixture-digest-moved",
      amendmentEpoch: 1
    })
  }).classification;
  if (amended.status !== "governed-amendment" || amended.ok !== true) return false;

  return true;
}

if (process.argv.includes('--self-check')) {
  if (!selfCheck()) {
    console.error(atomMetadata.atomId + ' source self-check failed');
    process.exit(1);
  }
  console.log(atomMetadata.atomId + ' source self-check ok');
}
