import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const RELEASE_PREPUBLISH_PROFILE = "release-prepublish";
export const RELEASE_PREPUBLISH_EVIDENCE_SCHEMA_ID =
  "atm.releasePrepublishPriorEvidence.v1";
export const RELEASE_PREPUBLISH_BUDGET_MS = 180_000;

export const RELEASE_PREPUBLISH_CODES = {
  evidenceMissing: "ATM_RELEASE_PREPUBLISH_EVIDENCE_MISSING",
  evidenceUnreadable: "ATM_RELEASE_PREPUBLISH_EVIDENCE_UNREADABLE",
  evidenceSchema: "ATM_RELEASE_PREPUBLISH_EVIDENCE_SCHEMA_INVALID",
  evidenceMismatch: "ATM_RELEASE_PREPUBLISH_EVIDENCE_MISMATCH",
  headUnverifiable: "ATM_RELEASE_PREPUBLISH_HEAD_UNVERIFIABLE",
  requiredOmitted: "ATM_RELEASE_PREPUBLISH_REQUIRED_VALIDATOR_OMITTED",
  profileInvalid: "ATM_RELEASE_PREPUBLISH_PROFILE_INVALID",
  budgetExceeded: "ATM_RELEASE_PREPUBLISH_BUDGET_EXCEEDED",
} as const;

export type ReleasePrepublishObligationKind = "consume-prior" | "execute";

export interface ReleasePrepublishObligation {
  readonly id: string;
  readonly kind: ReleasePrepublishObligationKind;
  readonly commandIdentity: string;
  readonly validatorName?: string;
}

export interface ReleasePrepublishProfileConfig {
  readonly mode?: string;
  readonly parallelByDefault?: boolean;
  readonly performanceBudgetMs?: number;
  readonly budgetEnforcement?: string;
  readonly requiredObligations?: readonly ReleasePrepublishObligation[];
  readonly validators?: readonly string[];
}

export interface SealedPriorObligation {
  readonly id: string;
  readonly commandIdentity: string;
  readonly status: string;
  readonly digest: string;
}

export interface ReleasePrepublishPriorEvidence {
  readonly schemaId: string;
  readonly headCommit: string;
  readonly sealedAt?: string;
  readonly obligations: readonly SealedPriorObligation[];
}

export interface GateFailure {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
}

export interface GateSelectionSuccess {
  readonly ok: true;
  readonly executeValidatorNames: readonly string[];
  readonly consumedResults: readonly Record<string, unknown>[];
}

export type GateSelectionResult = GateSelectionSuccess | GateFailure;

export function computeReleasePrepublishObligationDigest(input: {
  readonly headCommit: string;
  readonly commandIdentity: string;
  readonly status: string;
}): string {
  const payload = JSON.stringify({
    schemaId: "atm.releasePrepublishObligationDigest.v1",
    headCommit: input.headCommit,
    commandIdentity: input.commandIdentity,
    status: input.status,
  });
  return `sha256:${createHash("sha256").update(payload).digest("hex")}`;
}

export function readReleasePrepublishProfile(
  profileConfig: ReleasePrepublishProfileConfig | null | undefined,
): { ok: true; profile: Required<Pick<ReleasePrepublishProfileConfig, "requiredObligations" | "validators" | "performanceBudgetMs" | "budgetEnforcement">> & { requiredObligations: ReleasePrepublishObligation[] } } | GateFailure {
  if (!profileConfig || typeof profileConfig !== "object") {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.profileInvalid,
      message: "release-prepublish profile is missing",
    };
  }
  const requiredObligations = Array.isArray(profileConfig.requiredObligations)
    ? profileConfig.requiredObligations.map(normalizeObligation)
    : [];
  if (requiredObligations.some((entry) => entry === null)) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.profileInvalid,
      message: "release-prepublish requiredObligations are malformed",
    };
  }
  const obligations = requiredObligations as ReleasePrepublishObligation[];
  const validators = Array.isArray(profileConfig.validators)
    ? profileConfig.validators.map(String)
    : [];
  const executeIds = obligations.filter((entry) => entry.kind === "execute");
  if (executeIds.length === 0) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.requiredOmitted,
      message: "release-prepublish must declare at least one execute package-safety obligation",
    };
  }
  for (const obligation of executeIds) {
    const validatorName = obligation.validatorName;
    if (!validatorName || !validators.includes(validatorName)) {
      return {
        ok: false,
        code: RELEASE_PREPUBLISH_CODES.requiredOmitted,
        message: `required package-safety validator omitted from execute list: ${obligation.id}`,
      };
    }
  }
  for (const validatorName of validators) {
    const matched = executeIds.some((entry) => entry.validatorName === validatorName);
    if (!matched) {
      return {
        ok: false,
        code: RELEASE_PREPUBLISH_CODES.profileInvalid,
        message: `profile validator ${validatorName} is not a declared execute obligation`,
      };
    }
  }
  const budgetMs = Number(profileConfig.performanceBudgetMs);
  const budgetEnforcement = String(profileConfig.budgetEnforcement ?? "");
  if (!Number.isFinite(budgetMs) || budgetMs !== RELEASE_PREPUBLISH_BUDGET_MS) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.profileInvalid,
      message: `release-prepublish performanceBudgetMs must be ${RELEASE_PREPUBLISH_BUDGET_MS}`,
    };
  }
  if (budgetEnforcement !== "fail-closed") {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.profileInvalid,
      message: "release-prepublish budgetEnforcement must be fail-closed",
    };
  }
  return {
    ok: true,
    profile: {
      requiredObligations: obligations,
      validators,
      performanceBudgetMs: budgetMs,
      budgetEnforcement,
    },
  };
}

export function loadPriorEvidenceFile(
  priorEvidencePath: string | null | undefined,
  repoRoot: string,
): { ok: true; evidence: ReleasePrepublishPriorEvidence } | GateFailure {
  const relative = String(priorEvidencePath ?? "").trim();
  if (!relative) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.evidenceMissing,
      message: "release-prepublish requires --prior-evidence <path>",
    };
  }
  const resolved = path.resolve(repoRoot, relative);
  if (!existsSync(resolved)) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.evidenceMissing,
      message: `prior evidence file is missing: ${relative}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.evidenceUnreadable,
      message: `prior evidence file is not valid JSON: ${relative}`,
    };
  }
  return parsePriorEvidence(parsed);
}

export function parsePriorEvidence(
  value: unknown,
): { ok: true; evidence: ReleasePrepublishPriorEvidence } | GateFailure {
  if (!value || typeof value !== "object") {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.evidenceSchema,
      message: "prior evidence must be an object",
    };
  }
  const record = value as Record<string, unknown>;
  if (record.schemaId !== RELEASE_PREPUBLISH_EVIDENCE_SCHEMA_ID) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.evidenceSchema,
      message: `prior evidence schemaId must be ${RELEASE_PREPUBLISH_EVIDENCE_SCHEMA_ID}`,
    };
  }
  const headCommit = String(record.headCommit ?? "").trim();
  if (!headCommit) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.evidenceSchema,
      message: "prior evidence is missing headCommit",
    };
  }
  if (!Array.isArray(record.obligations)) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.evidenceSchema,
      message: "prior evidence obligations must be an array",
    };
  }
  const obligations: SealedPriorObligation[] = [];
  for (const entry of record.obligations) {
    if (!entry || typeof entry !== "object") {
      return {
        ok: false,
        code: RELEASE_PREPUBLISH_CODES.evidenceSchema,
        message: "prior evidence obligation entries must be objects",
      };
    }
    const row = entry as Record<string, unknown>;
    const id = String(row.id ?? "").trim();
    const commandIdentity = String(row.commandIdentity ?? "").trim();
    const status = String(row.status ?? "").trim();
    const digest = String(row.digest ?? "").trim();
    if (!id || !commandIdentity || !status || !digest) {
      return {
        ok: false,
        code: RELEASE_PREPUBLISH_CODES.evidenceSchema,
        message: `prior evidence obligation ${id || "<missing-id>"} is incomplete`,
      };
    }
    obligations.push({ id, commandIdentity, status, digest });
  }
  return {
    ok: true,
    evidence: {
      schemaId: RELEASE_PREPUBLISH_EVIDENCE_SCHEMA_ID,
      headCommit,
      sealedAt: typeof record.sealedAt === "string" ? record.sealedAt : undefined,
      obligations,
    },
  };
}

export function applyReleasePrepublishSelection(input: {
  readonly profileConfig: ReleasePrepublishProfileConfig;
  readonly priorEvidencePath: string | null | undefined;
  readonly selectedValidatorNames: readonly string[];
  readonly headCommit: string | null;
  readonly repoRoot: string;
}): GateSelectionResult {
  const profile = readReleasePrepublishProfile(input.profileConfig);
  if (!profile.ok) return profile;
  if (!input.headCommit) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.headUnverifiable,
      message: "release-prepublish cannot verify git HEAD for prior-evidence identity",
    };
  }
  const loaded = loadPriorEvidenceFile(input.priorEvidencePath, input.repoRoot);
  if (!loaded.ok) return loaded;
  return consumePriorEvidence({
    profile: profile.profile,
    evidence: loaded.evidence,
    selectedValidatorNames: input.selectedValidatorNames,
    headCommit: input.headCommit,
  });
}

export function consumePriorEvidence(input: {
  readonly profile: {
    readonly requiredObligations: readonly ReleasePrepublishObligation[];
    readonly validators: readonly string[];
  };
  readonly evidence: ReleasePrepublishPriorEvidence;
  readonly selectedValidatorNames: readonly string[];
  readonly headCommit: string;
}): GateSelectionResult {
  if (input.evidence.headCommit !== input.headCommit) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.evidenceMismatch,
      message: `prior evidence headCommit ${input.evidence.headCommit} does not match ${input.headCommit}`,
    };
  }
  const byId = new Map(input.evidence.obligations.map((entry) => [entry.id, entry]));
  const consumedResults: Record<string, unknown>[] = [];
  for (const obligation of input.profile.requiredObligations) {
    if (obligation.kind !== "consume-prior") continue;
    const sealed = byId.get(obligation.id);
    if (!sealed) {
      return {
        ok: false,
        code: RELEASE_PREPUBLISH_CODES.evidenceMissing,
        message: `missing prior evidence for obligation ${obligation.id}`,
      };
    }
    if (sealed.commandIdentity !== obligation.commandIdentity) {
      return {
        ok: false,
        code: RELEASE_PREPUBLISH_CODES.evidenceMismatch,
        message: `command identity mismatch for obligation ${obligation.id}`,
      };
    }
    if (sealed.status !== "passed") {
      return {
        ok: false,
        code: RELEASE_PREPUBLISH_CODES.evidenceMismatch,
        message: `prior evidence for ${obligation.id} is not passed`,
      };
    }
    const expectedDigest = computeReleasePrepublishObligationDigest({
      headCommit: input.headCommit,
      commandIdentity: obligation.commandIdentity,
      status: "passed",
    });
    if (sealed.digest !== expectedDigest) {
      return {
        ok: false,
        code: RELEASE_PREPUBLISH_CODES.evidenceMismatch,
        message: `digest mismatch for obligation ${obligation.id}`,
      };
    }
    consumedResults.push(createConsumedResult(obligation, expectedDigest));
  }
  for (const validatorName of input.profile.validators) {
    if (!input.selectedValidatorNames.includes(validatorName)) {
      return {
        ok: false,
        code: RELEASE_PREPUBLISH_CODES.requiredOmitted,
        message: `required package-safety validator omitted from selection: ${validatorName}`,
      };
    }
  }
  return {
    ok: true,
    executeValidatorNames: [...input.profile.validators],
    consumedResults,
  };
}

export function enforceReleasePrepublishBudget(input: {
  readonly profile: string;
  readonly profileConfig: ReleasePrepublishProfileConfig;
  readonly durationMs: number;
}): { ok: true } | GateFailure {
  if (input.profile !== RELEASE_PREPUBLISH_PROFILE) {
    return { ok: true };
  }
  const profile = readReleasePrepublishProfile(input.profileConfig);
  if (!profile.ok) return profile;
  const durationMs = Number(input.durationMs);
  const budgetMs = profile.profile.performanceBudgetMs;
  if (!Number.isFinite(durationMs) || durationMs > budgetMs) {
    return {
      ok: false,
      code: RELEASE_PREPUBLISH_CODES.budgetExceeded,
      message: `profile ${input.profile} took ${durationMs}ms, over fail-closed budget ${budgetMs}ms`,
    };
  }
  return { ok: true };
}

export function buildSealedPriorEvidence(input: {
  readonly headCommit: string;
  readonly obligations: readonly ReleasePrepublishObligation[];
  readonly sealedAt?: string;
}): ReleasePrepublishPriorEvidence {
  const consume = input.obligations.filter((entry) => entry.kind === "consume-prior");
  return {
    schemaId: RELEASE_PREPUBLISH_EVIDENCE_SCHEMA_ID,
    headCommit: input.headCommit,
    sealedAt: input.sealedAt ?? new Date().toISOString(),
    obligations: consume.map((obligation) => ({
      id: obligation.id,
      commandIdentity: obligation.commandIdentity,
      status: "passed",
      digest: computeReleasePrepublishObligationDigest({
        headCommit: input.headCommit,
        commandIdentity: obligation.commandIdentity,
        status: "passed",
      }),
    })),
  };
}

function normalizeObligation(value: unknown): ReleasePrepublishObligation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = String(record.id ?? "").trim();
  const kind = String(record.kind ?? "").trim();
  const commandIdentity = String(record.commandIdentity ?? "").trim();
  if (!id || !commandIdentity) return null;
  if (kind !== "consume-prior" && kind !== "execute") return null;
  const validatorName = String(record.validatorName ?? "").trim();
  if (kind === "execute" && !validatorName) return null;
  return {
    id,
    kind,
    commandIdentity,
    ...(validatorName ? { validatorName } : {}),
  };
}

function createConsumedResult(
  obligation: ReleasePrepublishObligation,
  digest: string,
): Record<string, unknown> {
  return {
    name: obligation.id,
    entry: null,
    tags: ["prior-evidence"],
    slow: false,
    ok: true,
    exitCode: 0,
    durationMs: 0,
    cached: false,
    resumedFromReceipt: false,
    consumedPriorEvidence: true,
    command: obligation.commandIdentity,
    outputDigest: digest,
    cacheHit: 0,
    cacheMiss: 0,
    cacheBypass: 0,
    fanOutConsumerCount: 0,
  };
}
