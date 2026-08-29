import { existsSync, readFileSync, } from "node:fs";
import path from "node:path";
import { assertEmergencyApproval, } from "../../emergency/gate.js";
import { detectCrossTaskMutation, recordIncidentFlag, } from "../../../_vendor/core/dist/broker/cross-task-mutation-guard.js";
import { CliError, relativePathFrom, } from "../../shared.js";
export function readBrokerConflictResolutionArtifact(input) {
    if (!input.artifactPath?.trim()) {
        throw new CliError("ATM_GIT_COMMIT_BROKER_CONFLICT_RESOLUTION_REQUIRED", "Team Broker conflict override requires --broker-conflict-resolution <artifact.json> before commit.", {
            exitCode: 1,
            details: {
                conflictTaskId: input.conflictTaskId,
                conflictFiles: input.conflictFiles,
                requiredArtifact: {
                    schemaId: "atm.brokerConflictResolution.v1",
                    conflictTaskId: input.conflictTaskId,
                    conflictFiles: input.conflictFiles,
                    resolutionOrder: [
                        "<task-id-that-commits-first>",
                        "<task-id-that-rebases-or-revalidates>",
                    ],
                    validatorPlan: ["<focused validator command>"],
                },
            },
        });
    }
    const artifactPath = path.resolve(input.cwd, input.artifactPath);
    if (!existsSync(artifactPath)) {
        throw new CliError("ATM_GIT_COMMIT_BROKER_CONFLICT_RESOLUTION_NOT_FOUND", `Broker conflict resolution artifact not found: ${input.artifactPath}`, {
            exitCode: 1,
            details: {
                artifactPath: input.artifactPath,
                conflictTaskId: input.conflictTaskId,
                conflictFiles: input.conflictFiles,
            },
        });
    }
    let artifact;
    try {
        artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    }
    catch (error) {
        throw new CliError("ATM_GIT_COMMIT_BROKER_CONFLICT_RESOLUTION_INVALID", "Broker conflict resolution artifact must be valid JSON.", {
            exitCode: 1,
            details: {
                artifactPath: input.artifactPath,
                error: error instanceof Error ? error.message : String(error),
            },
        });
    }
    const artifactConflictTaskIds = Array.isArray(artifact.conflictingTaskIds)
        ? artifact.conflictingTaskIds
        : [artifact.conflictTaskId];
    const artifactConflictTaskId = artifactConflictTaskIds
        .map((entry) => String(entry ?? "").trim().toUpperCase())
        .includes(String(input.conflictTaskId).trim().toUpperCase())
        ? String(input.conflictTaskId).trim().toUpperCase()
        : "";
    const artifactConflictFiles = Array.isArray(artifact.conflictFiles)
        ? artifact.conflictFiles
        : Array.isArray(artifact.sharedPaths)
            ? artifact.sharedPaths
            : [];
    const normalizedArtifactConflictFiles = artifactConflictFiles
        .map((entry) => String(entry).replace(/\\/g, "/"))
        .filter(Boolean)
        .sort();
    const expectedFiles = [...input.conflictFiles]
        .map((entry) => String(entry).replace(/\\/g, "/"))
        .sort();
    const resolutionOrder = Array.isArray(artifact.resolutionOrder)
        ? artifact.resolutionOrder
        : Array.isArray(artifact.releaseOrder)
            ? artifact.releaseOrder
            : [];
    const normalizedResolutionOrder = resolutionOrder
        .map((entry) => String(entry).trim())
        .filter(Boolean);
    const validatorPlan = Array.isArray(artifact.validatorPlan)
        ? artifact.validatorPlan
            .map((entry) => String(entry).trim())
            .filter(Boolean)
        : [];
    const decisionClass = String(artifact.decisionClass ?? "").trim();
    const decisionReason = String(artifact.decisionReason ?? "").trim();
    const violationStatus = String(artifact.violationStatus ?? "").trim();
    if (artifact.schemaId !== "atm.brokerConflictResolution.v1" ||
        artifactConflictTaskId !== input.conflictTaskId ||
        JSON.stringify(normalizedArtifactConflictFiles) !== JSON.stringify(expectedFiles) ||
        normalizedResolutionOrder.length < 2 ||
        validatorPlan.length === 0 ||
        ![
            "serial-release",
            "human-signoff-required",
            "adr-required",
            "blocked",
        ].includes(decisionClass) ||
        decisionReason.length === 0 ||
        !["broker-conflict-blocked", "resolution-issued", "resolved"].includes(violationStatus)) {
        throw new CliError("ATM_GIT_COMMIT_BROKER_CONFLICT_RESOLUTION_INVALID", "Broker conflict resolution artifact is missing required paper-style conflict metadata.", {
            exitCode: 1,
            details: {
                artifactPath: input.artifactPath,
                requiredSchemaId: "atm.brokerConflictResolution.v1",
                expectedConflictTaskId: input.conflictTaskId,
                expectedConflictFiles: expectedFiles,
                requiredFields: [
                    "schemaId",
                    "conflictTaskId",
                    "conflictFiles",
                    "decisionClass",
                    "decisionReason",
                    "violationStatus",
                    "resolutionOrder[2+]",
                    "validatorPlan[1+]",
                ],
            },
        });
    }
    return { artifactPath: relativePathFrom(input.cwd, artifactPath), artifact };
}
export function assertNoBrokerConflictBeforeHookBypass(options) {
    // A deferred transaction commits through an isolated index. Foreign live
    // entries therefore cannot cross the bypass boundary; evaluating them here
    // would reject the preservation mechanism rather than protect ownership.
    if (options.deferForeignStaged === true)
        return;
    const { cwd, taskId } = options;
    const crossTaskBlock = detectCrossTaskMutation(cwd, taskId, "git commit --no-verify", Array.isArray(options.candidateFiles) && options.candidateFiles.length > 0
        ? options.candidateFiles
        : undefined);
    if (!crossTaskBlock)
        return;
    recordIncidentFlag(cwd, crossTaskBlock);
    if (options.brokerConflictOverrideApproval) {
        const resolutionArtifact = readBrokerConflictResolutionArtifact({
            cwd,
            artifactPath: options.brokerConflictResolutionPath,
            conflictTaskId: crossTaskBlock.conflictTaskId,
            conflictFiles: crossTaskBlock.conflictFiles,
        });
        assertEmergencyApproval({
            cwd,
            surface: "git commit broker-conflict override",
            permission: "backend.brokerConflictOverride",
            taskId,
            actorId: options.actorId,
            emergencyApproval: options.brokerConflictOverrideApproval,
            flags: ["--broker-conflict-override"],
            reason: options.reason ??
                "High-authority Team Broker conflict override after recorded parallel conflict resolution.",
            command: options.command,
        });
        return { crossTaskBlock, resolutionArtifact };
    }
    throw new CliError("ATM_GIT_COMMIT_BROKER_CONFLICT_OVERRIDE_REQUIRED", `git commit --no-verify cannot bypass a Team Broker cross-task mutation block for ${crossTaskBlock.conflictTaskId}.`, {
        exitCode: 1,
        details: {
            conflictTaskId: crossTaskBlock.conflictTaskId,
            conflictFiles: crossTaskBlock.conflictFiles,
            conflicts: crossTaskBlock.conflicts,
            recoveryLane: crossTaskBlock.recoveryLane,
            decisionClass: "blocked",
            decisionReason: "broker-conflict-blocked because git commit --no-verify would bypass an active Team Broker ownership conflict.",
            violationStatus: "broker-conflict-blocked",
            statusCode: "broker-conflict-blocked",
            requiredAction: "Resolve the active task ownership conflict through a paper-style Team Broker conflict-resolution artifact before retrying the commit.",
            hookBypassPermission: "backend.gitHookBypass",
            brokerConflictOverridePermission: "backend.brokerConflictOverride",
            requiredCommand: 'node atm.mjs emergency approve --permission backend.brokerConflictOverride --actor <actor> --allowed-flag --broker-conflict-override --approval-text "<human approval sentence>" --reason "<why the recorded conflict resolution must override serialization>" --json',
        },
    });
}
/**
 * Prove that a bypass lease is eligible without consuming its one-use capability.
 *
 * This deliberately stays outside the branch commit queue: candidate and broker
 * rejection are retryable preparation failures, not protected writes.
 */
export function preflightHookBypassEligibility(options) {
    assertNoBrokerConflictBeforeHookBypass(options);
    return assertEmergencyApproval({
        cwd: options.cwd,
        surface: "git commit --no-verify",
        permission: "backend.gitHookBypass",
        taskId: options.taskId,
        actorId: options.actorId,
        emergencyApproval: options.emergencyApproval,
        flags: ["--no-verify"],
        reason: options.reason ?? "Governed git hook bypass for emergency recovery.",
        command: options.command,
        consume: false,
    });
}
/** Build the immutable request consumed only by the protected write boundary. */
export function prepareHookBypassRequest(options) {
    preflightHookBypassEligibility(options);
    return {
        cwd: options.cwd,
        taskId: options.taskId,
        actorId: options.actorId,
        deferForeignStaged: options.deferForeignStaged,
        candidateFiles: options.candidateFiles,
        brokerConflictOverrideApproval: options.brokerConflictOverrideApproval,
        brokerConflictResolutionPath: options.brokerConflictResolutionPath,
        reason: options.reason,
        command: options.command,
        emergencyApproval: options.emergencyApproval,
    };
}
/**
 * Consume the bypass capability only at the protected-write boundary. Callers
 * must invoke this after branch-queue admission and immediately before Git.
 */
export function consumeHookBypassAtProtectedWrite(options) {
    assertNoBrokerConflictBeforeHookBypass(options);
    return assertEmergencyApproval({
        cwd: options.cwd,
        surface: "git commit --no-verify",
        permission: "backend.gitHookBypass",
        taskId: options.taskId,
        actorId: options.actorId,
        emergencyApproval: options.emergencyApproval,
        flags: ["--no-verify"],
        reason: options.reason ?? "Governed git hook bypass for emergency recovery.",
        command: options.command,
    });
}
