import { resolveGitExecutable, runGitCommand } from './git-process-port.js';
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, } from "node:fs";
import os from "node:os";
import path from "node:path";
import { actorIdEnvVar, } from "../../actor-registry.js";
import { evaluateGitAdmission } from "../../../_vendor/core/dist/git/admission.js";
import { composeBrokerProposals } from "../../../_vendor/core/dist/broker/compose.js";
import { applyStewardPlan, planStewardApply, } from "../../../_vendor/core/dist/broker/steward.js";
import { jsonRecordAdapter } from "../../../_vendor/core/dist/broker/adapters/index.js";
import { buildGitBoundaryEvidenceEnvelope } from "../../../_vendor/core/dist/evidence/index.js";
import { CliError, makeResult, message, quoteCliValue, } from "../../shared.js";
import { readHeadCommitSha } from './push-command.js';
export function runGitAdmission(options) {
    if (!options.actorId?.trim()) {
        throw new CliError("ATM_ACTOR_ID_MISSING", `git admit requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
    }
    const result = evaluateGitAdmission({
        cwd: options.cwd,
        actorId: options.actorId,
        taskId: options.taskId,
        branch: options.branch,
        remote: options.remote,
        fetch: !options.noFetch,
        gitExecutable: resolveGitExecutable(),
    });
    const gitBoundaryEvidence = buildGitBoundaryEvidenceEnvelope({
        actorId: options.actorId,
        taskId: options.taskId,
        result,
    });
    const topology = result.topology;
    const humanSummary = [
        `remote branch=${topology.remoteRef}`,
        `base commit=${topology.mergeBaseSha}`,
        `local commit=${topology.headSha}`,
        `remote commit=${topology.remoteSha}`,
        `conflicting files=${result.conflictingFiles.length > 0 ? result.conflictingFiles.join(", ") : "none"}`,
        `recommended next step=${result.recommendedNextStep}`,
    ].join("; ");
    const ok = result.outcome === "allow" || result.outcome === "no-op";
    const stewardAction = resolveGitAdmissionStewardAction(options, result);
    const evidence = {
        action: "admit",
        outcome: result.outcome,
        topology,
        brokerRegistryPath: path.relative(options.cwd, result.brokerRegistryPath) ||
            path.basename(result.brokerRegistryPath),
        conflictingFiles: result.conflictingFiles,
        recommendedNextStep: result.recommendedNextStep,
        brokerDecision: result.brokerDecision,
        diagnostics: result.diagnostics,
        local: result.local,
        remote: result.remote,
        gitBoundaryEvidence,
        ...(stewardAction ? { steward: stewardAction } : {}),
    };
    return makeResult({
        ok: ok || Boolean(stewardAction?.ok),
        command: "git",
        cwd: options.cwd,
        messages: [
            message(result.outcome === "internal-error" || result.outcome === "block"
                ? "error"
                : result.outcome === "composer-routed"
                    ? "warn"
                    : "info", `ATM_GIT_ADMISSION_${result.outcome.toUpperCase().replace(/-/g, "_")}`, `Git admission outcome '${result.outcome}': ${humanSummary}`, {
                outcome: result.outcome,
                topology,
                conflictingFiles: result.conflictingFiles,
                recommendedNextStep: stewardAction?.recommendedNextStep ?? result.recommendedNextStep,
            }),
        ],
        evidence,
    });
}
export function resolveGitAdmissionStewardAction(options, result) {
    if (!options.stewardPlan && !options.applyToWorkingTree) {
        return null;
    }
    if (result.outcome !== "composer-routed") {
        throw new CliError("ATM_GIT_ADMISSION_STEWARD_NOT_APPLICABLE", "Steward planning/apply is only available for git admit composer-routed outcomes.", {
            exitCode: 1,
            details: {
                outcome: result.outcome,
                requiredOutcome: "composer-routed",
            },
        });
    }
    const composerInput = buildGitAdmissionComposerInput(options, result);
    const composeResult = composeBrokerProposals([composerInput.proposal]);
    const planResult = planStewardApply({
        cwd: options.cwd,
        stewardId: "neutral-write-steward",
        mergePlan: composeResult.mergePlan,
        proposals: [composerInput.proposal],
        scopeFiles: [composerInput.proposal.targetFile],
    });
    if (options.applyToWorkingTree) {
        const applyResult = applyStewardPlan({
            cwd: options.cwd,
            stewardId: "neutral-write-steward",
            mergePlan: composeResult.mergePlan,
            proposals: [composerInput.proposal],
            scopeFiles: [composerInput.proposal.targetFile],
        });
        return {
            ok: applyResult.ok,
            mode: "apply-to-working-tree",
            mergePlan: composeResult.mergePlan,
            plan: planResult.plan,
            proposal: composerInput.proposal,
            applyEvidence: applyResult.evidence,
            recommendedNextStep: applyResult.ok
                ? "Steward apply updated the scoped working-tree file. Review the diff, run validators, and create the commit manually."
                : "Steward apply was blocked; inspect the steward evidence and resolve the scoped conflict before pushing.",
        };
    }
    return {
        ok: planResult.ok,
        mode: "steward-plan",
        mergePlan: composeResult.mergePlan,
        plan: planResult.plan,
        proposal: composerInput.proposal,
        applyEvidence: null,
        recommendedNextStep: planResult.ok
            ? "Steward dry-run produced a merge plan. Re-run with --apply-to-working-tree to apply it, then validate and commit manually."
            : "Steward dry-run found a blocked merge plan; inspect the issues before attempting apply.",
    };
}
export function buildGitAdmissionComposerInput(options, result) {
    const filePath = result.conflictingFiles[0];
    if (!filePath) {
        throw new CliError("ATM_GIT_ADMISSION_COMPOSER_INPUT_MISSING", "Composer-routed admission did not expose a conflicting file to steward.", { exitCode: 1, details: { conflictingFiles: result.conflictingFiles } });
    }
    const localBridge = result.local.bridged.find((entry) => entry.filePath === filePath);
    const remoteBridge = result.remote.bridged.find((entry) => entry.filePath === filePath);
    if (!localBridge ||
        !remoteBridge ||
        localBridge.adapterId !== jsonRecordAdapter.id ||
        remoteBridge.adapterId !== jsonRecordAdapter.id) {
        throw new CliError("ATM_GIT_ADMISSION_STEWARD_UNSUPPORTED", "Current steward apply support is limited to composer-routed JSON-record conflicts.", {
            exitCode: 1,
            details: {
                filePath,
                localAdapterId: localBridge?.adapterId ?? null,
                remoteAdapterId: remoteBridge?.adapterId ?? null,
            },
        });
    }
    const absolutePath = path.join(options.cwd, filePath);
    const currentContent = readFileSync(absolutePath, "utf8");
    const currentParsed = jsonRecordAdapter.parse({
        filePath,
        content: currentContent,
    });
    const remoteRequests = remoteBridge.requests.map((request) => jsonRecordAdapter.normalize(request));
    const merged = jsonRecordAdapter.merge(remoteRequests, currentParsed);
    const mergedContent = jsonRecordAdapter.serialize(merged);
    const baseCommit = readHeadCommitSha(options.cwd);
    if (!baseCommit) {
        throw new CliError("ATM_GIT_ADMISSION_STEWARD_HEAD_MISSING", "Unable to resolve HEAD for steward proposal generation.", { exitCode: 1 });
    }
    const patch = buildUnifiedPatch(filePath, currentContent, mergedContent);
    const fileBeforeHash = hashBuffer(readFileSync(absolutePath));
    const proposal = {
        schemaId: "atm.patchProposal.v1",
        specVersion: "0.1.0",
        migration: {
            strategy: "none",
            fromVersion: null,
            notes: "git-admission composer-routed steward apply",
        },
        proposalId: `proposal.git-admit.${shortHash(`${baseCommit}:${filePath}`)}`,
        taskId: options.taskId ?? `git-admit-${result.topology.branch}`,
        actorId: options.actorId,
        baseCommit,
        fileBeforeHash,
        targetFile: filePath,
        atomRefs: remoteBridge.conflictKeys.length > 0
            ? remoteBridge.conflictKeys.map((key) => ({
                atomId: `${filePath}::${key.scope}::${key.key}`,
                atomCid: shortHash(`${filePath}::${key.scope}::${key.key}`),
            }))
            : [
                {
                    atomId: `${filePath}::file`,
                    atomCid: shortHash(`${filePath}::file`),
                },
            ],
        anchors: [{ kind: "file", hint: filePath }],
        intent: `Merge remote composer-routed JSON mutations for ${filePath} into the local working tree without auto-commit.`,
        patch,
        validators: [],
        rollback: `node atm.mjs git lease destructive-override --task ${quoteCliValue(options.taskId ?? `git-admit-${result.topology.branch}`)} --actor ${quoteCliValue(options.actorId)} --paths ${quoteCliValue(filePath)} --reason "<human-approved rollback reason>" --json`,
    };
    return { proposal };
}
export function buildUnifiedPatch(filePath, beforeContent, afterContent) {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "atm-git-admit-steward-"));
    try {
        const beforePath = path.join(tempDir, "before");
        const afterPath = path.join(tempDir, "after");
        writeFileSync(beforePath, beforeContent, "utf8");
        writeFileSync(afterPath, afterContent, "utf8");
        try {
            return runGitCommand(tempDir, ["diff", "--no-index", "--no-prefix", "--", beforePath, afterPath], ["ignore", "pipe", "pipe"])
                .replaceAll(beforePath.replace(/\\/g, "/"), `a/${filePath}`)
                .replaceAll(afterPath.replace(/\\/g, "/"), `b/${filePath}`);
        }
        catch (error) {
            const nodeError = error;
            const stdout = String(nodeError.stdout ?? "");
            if (stdout.trim()) {
                return stdout
                    .replaceAll(beforePath.replace(/\\/g, "/"), `a/${filePath}`)
                    .replaceAll(afterPath.replace(/\\/g, "/"), `b/${filePath}`);
            }
            throw error;
        }
    }
    finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
export function hashBuffer(buffer) {
    return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}
export function shortHash(value) {
    return createHash("sha256").update(value).digest("hex").slice(0, 16);
}
