type LegacyValue = ReturnType<typeof JSON.parse>;

export function classifyPostPushRecoveryKind(input: LegacyValue) {
  if (input.outcome === "composer-routed") {
    return "steward-apply";
  }
  if (input.outcome === "block" || input.likelyNonFastForward) {
    return "rebase";
  }
  if (input.outcome === "allow" || input.outcome === "no-op") {
    return input.remoteChangedAfterFetch ? "rebase" : "retry-after-no-op";
  }
  return "inspect";
}

export function buildPostPushRecoveryRecommendation(input: LegacyValue) {
  const defaultRecommendation = String(input.defaultRecommendation ?? '').trim();
  if (
    /ATM_WRITE_TICKET_HISTORICAL_ATTESTATION_REQUIRED/i.test(defaultRecommendation) ||
    /\bnode\s+atm\.mjs\s+git\s+attest\b/i.test(defaultRecommendation)
  ) {
    return `Push recovery preserved the historical-attestation admission guidance. ${defaultRecommendation}`;
  }
  if (input.outcome === "composer-routed") {
    return input.conflictingFiles.length > 0
      ? `Push rejection recovery reran admission after fetch and found a mergeable same-file conflict in ${input.conflictingFiles.join(", ")}. Use git admit --steward-plan or --apply-to-working-tree, then validate and retry the push manually.`
      : "Push rejection recovery reran admission after fetch and found a mergeable same-file conflict. Use git admit --steward-plan or --apply-to-working-tree, then validate and retry the push manually.";
  }
  if (input.outcome === "block" || input.likelyNonFastForward) {
    return input.remoteChangedAfterFetch || input.likelyRemoteChanged
      ? `Push rejection likely came from a non-fast-forward remote change. Rebase or otherwise replay your local commits on top of the refreshed remote branch before retrying push. ${input.defaultRecommendation}`
      : `Push rejection still maps to a blocked admission lane. Rebase, split the work, or reroute through the governed conflict workflow before retrying push. ${defaultRecommendation}`;
  }
  if (input.outcome === "no-op") {
    return input.remoteChangedAfterFetch
      ? "After refresh, no local-only delta remains to admit. If the remote already contains the intended change, no retry is needed; otherwise inspect your local branch state before pushing again."
      : "After refresh, no local-only delta remains to admit and the remote did not move. Treat the failure as a likely transient/no-op rejection and retry the push if needed.";
  }
  if (input.outcome === "allow") {
    return input.remoteChangedAfterFetch
      ? "Admission is now clean, but the remote advanced during the failed push. Integrate the refreshed remote branch locally, then retry the push."
      : "Admission is clean after the failed push and the remote did not move during recovery. Retry the push if the previous rejection was transient.";
  }
  return `Post-push recovery could not classify the rejection cleanly. ${defaultRecommendation}`;
}

export function isHeadRaceCommitFailure(stderr: LegacyValue) {
  return (
    /cannot lock ref 'HEAD'/i.test(stderr) &&
    /expected /i.test(stderr) &&
    / is at /i.test(stderr)
  );
}
