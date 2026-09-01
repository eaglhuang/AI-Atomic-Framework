import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { actorIdEnvVar, resolveActorId, } from "../../actor-registry.js";
import { assertRecordCommitPayloadPresent } from "../record-commit-payload-assertion.js";
import { classifyBlockLifecycleRecordBundle, RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV, RECORD_COMMIT_BLOCK_BRIDGE_AUTH_DIR, RECORD_COMMIT_BLOCK_BRIDGE_DEFAULT_TTL_MS, } from "../record-only-block-lifecycle-bridge.js";
import { CliError, makeResult, message, } from "../../shared.js";
import { runGitCommit } from './commit-command.js';
import { buildCopyableGitCommitCommand, readStagedFiles } from './git-index-transaction.js';
import { runGitCommand } from './git-process-port.js';
import { forEachPathspecBatch } from './pathspec-argv-batching.js';
import { requireExplicitGitActor } from './identity-check-command.js';
import { assertRecordCommitSingleTaskOwner, isRecordCommitAllowedPath } from './record-bundle-inspection.js';
export function runGitRecordCommit(options) {
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError("ATM_ACTOR_ID_MISSING", `git record-commit requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
    }
    requireExplicitGitActor(resolvedActor, "git record-commit");
    if (!options.message) {
        throw new CliError("ATM_CLI_USAGE", "git record-commit requires --message <summary>.", { exitCode: 2 });
    }
    if (options.taskId) {
        throw new CliError("ATM_GIT_RECORD_COMMIT_TASK_FORBIDDEN", "git record-commit is task-session-free and does not accept --task; use git commit for task-bound delivery commits.", { exitCode: 2 });
    }
    if (options.autoStage || options.deferForeignStaged || options.noVerify) {
        throw new CliError("ATM_GIT_RECORD_COMMIT_UNSUPPORTED_FLAG", "git record-commit requires explicit staged record files and does not support --auto-stage, --defer-foreign-staged, or --no-verify.", {
            exitCode: 2,
            details: {
                autoStage: options.autoStage,
                deferForeignStaged: options.deferForeignStaged,
                noVerify: options.noVerify,
            },
        });
    }
    const explicitPaths = resolveExplicitRecordPaths(options.cwd, options.paths ?? []);
    let stagedFiles = readStagedFiles(options.cwd);
    if (explicitPaths.length > 0 && stagedFiles.length > 0) {
        throw new CliError("ATM_GIT_RECORD_COMMIT_STAGING_AMBIGUOUS", "git record-commit --paths requires an empty index so it cannot absorb pre-existing staged work.", { exitCode: 1, details: { stagedFiles, explicitPaths } });
    }
    if (explicitPaths.length > 0) {
        assertExplicitRecordPathsAreDirty(options.cwd, explicitPaths);
        if (!options.dryRun) {
            stageExplicitRecordPaths(options.cwd, explicitPaths);
            stagedFiles = readStagedFiles(options.cwd);
        }
        else {
            stagedFiles = [...explicitPaths];
        }
    }
    if (stagedFiles.length === 0) {
        throw new CliError("ATM_GIT_RECORD_COMMIT_EMPTY_INDEX", "git record-commit requires explicitly staged .atm/history record files.", {
            exitCode: 1,
            details: {
                allowedPrefixes: [
                    ".atm/history/tasks/",
                    ".atm/history/task-events/",
                    ".atm/history/evidence/",
                    ".atm/history/reports/task-import/",
                ],
            },
        });
    }
    const blockedFiles = stagedFiles.filter((filePath) => !isRecordCommitAllowedPath(filePath));
    if (blockedFiles.length > 0) {
        throw new CliError("ATM_GIT_RECORD_COMMIT_SCOPE_VIOLATION", "git record-commit only accepts low-risk .atm/history record files; use the dedicated governed lane for source, closure, repair, or protected override bundles.", {
            exitCode: 1,
            details: {
                blockedFiles,
                stagedFiles,
                highRiskBoundaries: [
                    "closure packets",
                    "protected override audit",
                    "repair metadata",
                    "source or docs deliverables",
                ],
            },
        });
    }
    assertRecordCommitSingleTaskOwner(options.cwd, stagedFiles);
    const blockBridge = classifyBlockLifecycleRecordBundle({
        stagedFiles,
        readLedgerRecord: (bridgeTaskId) => {
            const ledgerPath = path.join(options.cwd, ".atm", "history", "tasks", `${bridgeTaskId}.json`);
            if (!existsSync(ledgerPath))
                return null;
            try {
                const ledgerDoc = JSON.parse(readFileSync(ledgerPath, "utf8"));
                const claim = ledgerDoc.claim && typeof ledgerDoc.claim === "object"
                    ? ledgerDoc.claim
                    : null;
                return {
                    workItemId: typeof ledgerDoc.workItemId === "string"
                        ? ledgerDoc.workItemId
                        : typeof ledgerDoc.id === "string"
                            ? ledgerDoc.id
                            : null,
                    status: typeof ledgerDoc.status === "string" ? ledgerDoc.status : "",
                    claimState: claim && typeof claim.state === "string" ? claim.state : null,
                    claimActorId: claim && typeof claim.actorId === "string" ? claim.actorId : null,
                    claimLeaseId: claim && typeof claim.leaseId === "string" ? claim.leaseId : null,
                };
            }
            catch {
                return null;
            }
        },
        readEventRecord: (eventPath) => {
            const eventAbs = path.join(options.cwd, eventPath);
            if (!existsSync(eventAbs))
                return null;
            try {
                const eventDoc = JSON.parse(readFileSync(eventAbs, "utf8"));
                return {
                    taskId: typeof eventDoc.taskId === "string" ? eventDoc.taskId : null,
                    action: typeof eventDoc.action === "string" ? eventDoc.action : null,
                    toStatus: typeof eventDoc.toStatus === "string" ? eventDoc.toStatus : null,
                    actorId: typeof eventDoc.actorId === "string" ? eventDoc.actorId : null,
                    taskPath: typeof eventDoc.taskPath === "string" ? eventDoc.taskPath : null,
                };
            }
            catch {
                return null;
            }
        },
    });
    if (blockBridge.kind === "ineligible") {
        throw new CliError("ATM_GIT_RECORD_COMMIT_BLOCK_BRIDGE_INELIGIBLE", blockBridge.reason, {
            exitCode: 1,
            details: {
                reasonCode: blockBridge.reasonCode,
                taskId: blockBridge.taskId,
                stagedFiles: blockBridge.stagedFiles,
                policy: "record-only-block-lifecycle-bridge",
            },
        });
    }
    const recordOnlyClaimScopeExemptPaths = blockBridge.kind === "eligible" ? blockBridge.exemptPaths : [];
    const recordOnlyBlockBridgeAuth = blockBridge.kind === "eligible"
        ? (() => {
            const nonce = createHash("sha256")
                .update(`${blockBridge.taskId}\n${Date.now()}\n${process.pid}\n${Math.random()}`)
                .digest("hex")
                .slice(0, 24);
            return {
                nonce,
                actorId: blockBridge.actorId,
                taskId: blockBridge.taskId,
                exemptPaths: blockBridge.exemptPaths,
                ledgerPath: blockBridge.ledgerPath,
                ledgerSha256: createHash("sha256")
                    .update(readFileSync(path.join(options.cwd, blockBridge.ledgerPath)))
                    .digest("hex"),
                eventPath: blockBridge.eventPath,
                eventSha256: createHash("sha256")
                    .update(readFileSync(path.join(options.cwd, blockBridge.eventPath)))
                    .digest("hex"),
                createdAtMs: Date.now(),
                ttlMs: RECORD_COMMIT_BLOCK_BRIDGE_DEFAULT_TTL_MS,
            };
        })()
        : null;
    const actorId = resolvedActor.actorId;
    const trailers = [
        `ATM-Actor: ${actorId}`,
        "ATM-Record-Commit: true",
        ...options.extraTrailers,
    ];
    if (options.dryRun) {
        return makeResult({
            ok: true,
            command: "git",
            cwd: options.cwd,
            messages: [
                message("info", "ATM_GIT_RECORD_COMMIT_DRY_RUN", "git record-commit dry-run accepted the staged low-risk record files without mutating HEAD.", { actorId, stagedFiles }),
            ],
            evidence: {
                action: "record-commit",
                dryRun: true,
                actorId,
                taskId: null,
                stagedFiles,
                trailers,
                blockBridge: {
                    kind: blockBridge.kind,
                    taskId: blockBridge.kind === "not-block-lifecycle"
                        ? null
                        : (blockBridge.taskId ?? null),
                    exemptPaths: blockBridge.kind === "eligible" ? blockBridge.exemptPaths : [],
                },
                copyableCommitCommand: buildCopyableGitCommitCommand({
                    cwd: options.cwd,
                    message: options.message,
                    trailers,
                }),
            },
        });
    }
    let result;
    {
        const bridgeAuthDir = path.join(options.cwd, RECORD_COMMIT_BLOCK_BRIDGE_AUTH_DIR);
        const bridgeAuthPath = recordOnlyBlockBridgeAuth
            ? path.join(bridgeAuthDir, `${recordOnlyBlockBridgeAuth.nonce}.json`)
            : null;
        const previousBridgeAuthEnv = process.env[RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV];
        try {
            if (recordOnlyBlockBridgeAuth && bridgeAuthPath) {
                mkdirSync(bridgeAuthDir, { recursive: true });
                writeFileSync(bridgeAuthPath, `${JSON.stringify(recordOnlyBlockBridgeAuth, null, 2)}\n`, "utf8");
                process.env[RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV] =
                    recordOnlyBlockBridgeAuth.nonce;
            }
            result = runGitCommit({
                ...options,
                action: "commit",
                taskId: null,
                recordOnlyCommit: true,
                autoStage: false,
                deferForeignStaged: false,
                noVerify: false,
                extraTrailers: trailers.slice(1),
                recordOnlyClaimScopeExemptPaths,
            });
        }
        finally {
            if (previousBridgeAuthEnv === undefined) {
                delete process.env[RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV];
            }
            else {
                process.env[RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV] =
                    previousBridgeAuthEnv;
            }
            if (bridgeAuthPath) {
                try {
                    rmSync(bridgeAuthPath, { force: true });
                }
                catch {
                    /* best-effort cleanup of single-use bridge authorization */
                }
            }
        }
    }
    const commitSha = typeof result.evidence?.commitSha === "string"
        ? result.evidence.commitSha
        : typeof result.evidence?.sha === "string"
            ? result.evidence.sha
            : runGitCommand(options.cwd, ["rev-parse", "HEAD"]).trim() || null;
    if (!commitSha) {
        throw new CliError("ATM_GIT_RECORD_COMMIT_PAYLOAD_DROPPED", "git record-commit could not resolve the created commit SHA for payload assertion.", { exitCode: 1, details: { stagedFiles } });
    }
    const payloadAssertion = assertRecordCommitPayloadPresent({
        cwd: options.cwd,
        commitSha,
        expectedStagedFiles: stagedFiles,
    });
    return {
        ...result,
        messages: [
            message("info", "ATM_GIT_RECORD_COMMIT_OK", "Created a governed record-only commit for low-risk .atm/history maintenance.", { actorId, stagedFiles, commitSha }),
            ...result.messages,
        ],
        evidence: {
            ...(result.evidence && typeof result.evidence === "object"
                ? result.evidence
                : {}),
            action: "record-commit",
            actorId,
            taskId: null,
            commitSha,
            recordCommit: {
                stagedFiles,
                policy: "low-risk-atm-history-records-only",
                highRiskBoundariesRejected: true,
                payloadAssertion,
            },
        },
    };
}
function resolveExplicitRecordPaths(cwd, paths) {
    const normalized = Array.from(new Set(paths.map((entry) => entry.trim().replace(/\\/g, "/")).filter(Boolean))).sort();
    const invalidPaths = normalized.filter((entry) => {
        const absolute = path.resolve(cwd, entry);
        const relative = path.relative(cwd, absolute).replace(/\\/g, "/");
        return path.isAbsolute(entry) || relative === ".." || relative.startsWith("../") || !isRecordCommitAllowedPath(relative);
    });
    if (invalidPaths.length > 0) {
        throw new CliError("ATM_GIT_RECORD_COMMIT_SCOPE_VIOLATION", "git record-commit --paths only accepts low-risk .atm/history record files.", { exitCode: 1, details: { invalidPaths, allowedPrefixes: [".atm/history/tasks/", ".atm/history/task-events/", ".atm/history/evidence/", ".atm/history/reports/task-import/"] } });
    }
    return normalized.map((entry) => path.relative(cwd, path.resolve(cwd, entry)).replace(/\\/g, "/"));
}
function assertExplicitRecordPathsAreDirty(cwd, paths) {
    const changed = new Set();
    for (const args of [
        ["diff", "--name-only", "--", ...paths],
        ["ls-files", "--others", "--exclude-standard", "--", ...paths],
    ]) {
        for (const entry of runGitCommand(cwd, args).split(/\r?\n/)) {
            const normalized = entry.trim().replace(/\\/g, "/");
            if (normalized)
                changed.add(normalized);
        }
    }
    const unchangedPaths = paths.filter((entry) => !changed.has(entry));
    if (unchangedPaths.length > 0) {
        throw new CliError("ATM_GIT_RECORD_COMMIT_PATH_NOT_DIRTY", "git record-commit --paths requires every declared record path to be currently dirty or untracked.", { exitCode: 1, details: { unchangedPaths, paths } });
    }
}
function stageExplicitRecordPaths(cwd, paths) {
    forEachPathspecBatch({ paths, fixedArgs: ["add", "-A", "-f", "--"] }, (batch) => runGitCommand(cwd, ["add", "-A", "-f", "--", ...batch], ["ignore", "pipe", "pipe"]));
}
