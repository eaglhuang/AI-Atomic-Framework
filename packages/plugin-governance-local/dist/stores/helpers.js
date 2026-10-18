import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { isArtifactVersionKind, resolveDataAndArtifactVersions, isValidSemverVersionString } from '../versioning.js';
const CANONICAL_KNOWLEDGE_ROOT = '.atm/knowledge';
const GENERATED_KNOWLEDGE_CACHE_ROOT = '.atm/runtime/knowledge';
export { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, writeSync, path };
export function createAbsoluteLayout(repositoryRoot, layout) {
    return {
        taskStorePath: resolveRepoPath(repositoryRoot, layout.taskStorePath),
        lockStorePath: resolveRepoPath(repositoryRoot, layout.lockStorePath),
        documentIndexPath: resolveRepoPath(repositoryRoot, layout.documentIndexPath),
        shardStorePath: resolveRepoPath(repositoryRoot, layout.shardStorePath),
        stateStorePath: resolveRepoPath(repositoryRoot, layout.stateStorePath),
        artifactStorePath: resolveRepoPath(repositoryRoot, layout.artifactStorePath),
        logStorePath: resolveRepoPath(repositoryRoot, layout.logStorePath),
        runReportStorePath: resolveRepoPath(repositoryRoot, layout.runReportStorePath),
        ruleGuardPath: resolveRepoPath(repositoryRoot, layout.ruleGuardPath),
        evidenceStorePath: resolveRepoPath(repositoryRoot, layout.evidenceStorePath),
        registryStorePath: resolveRepoPath(repositoryRoot, layout.registryStorePath ?? '.atm/catalog/registry'),
        contextBudgetStorePath: resolveRepoPath(repositoryRoot, layout.contextBudgetStorePath ?? '.atm/runtime/budget'),
        contextSummaryStorePath: resolveRepoPath(repositoryRoot, layout.contextSummaryStorePath ?? '.atm/history/handoff')
    };
}
export function capabilityResult(text, artifacts = [], evidence = []) {
    return { ok: true, messages: [text], artifacts, evidence };
}
export function resolveRepoPath(repositoryRoot, filePath) {
    return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(repositoryRoot, filePath);
}
export function relativePathFrom(repositoryRoot, filePath) {
    return path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
}
export function normalizeRelativePath(filePath) {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
export function assertCanonicalShardInput(filePath) {
    const normalized = normalizeRelativePath(filePath);
    if (isInsideRelativeRoot(normalized, GENERATED_KNOWLEDGE_CACHE_ROOT)) {
        throw new Error(`Generated knowledge cache paths under ${GENERATED_KNOWLEDGE_CACHE_ROOT}/** cannot be used as canonical shard input. Use ${CANONICAL_KNOWLEDGE_ROOT}/** for canonical Team knowledge shards.`);
    }
}
export function assertGeneratedKnowledgeCacheOutput(filePath) {
    const normalized = normalizeRelativePath(filePath);
    if (isInsideRelativeRoot(normalized, CANONICAL_KNOWLEDGE_ROOT)) {
        throw new Error(`Shard indexes are generated artifacts. Write Team knowledge indexes under ${GENERATED_KNOWLEDGE_CACHE_ROOT}/**, not canonical ${CANONICAL_KNOWLEDGE_ROOT}/**.`);
    }
}
export function isInsideRelativeRoot(filePath, root) {
    return filePath === root || filePath.startsWith(`${root}/`);
}
export function writeJsonFile(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
export function readJsonFile(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
export function readUnknownFile(filePath) {
    if (filePath.endsWith('.json')) {
        return readJsonFile(filePath);
    }
    return readFileSync(filePath, 'utf8');
}
export function writeUnknownFile(filePath, value) {
    if (typeof value === 'string') {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, value, 'utf8');
        return;
    }
    writeJsonFile(filePath, value);
}
export function writeContentFile(filePath, content) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
}
export function withJsonExtension(name) {
    return name.endsWith('.json') ? name : `${name}.json`;
}
export function appendManifestRecord(filePath, record) {
    const records = readManifestRecords(filePath).filter((entry) => entry.artifactPath !== record.artifactPath);
    records.push(record);
    writeJsonFile(filePath, records);
}
export function readManifestRecords(filePath) {
    if (!existsSync(filePath)) {
        return [];
    }
    const parsed = readJsonFile(filePath);
    return Array.isArray(parsed) ? parsed : [];
}
export function readDocumentIndex(documentIndexPath) {
    const filePath = path.join(documentIndexPath, 'documents.json');
    if (!existsSync(filePath)) {
        return [];
    }
    const parsed = readJsonFile(filePath);
    return Array.isArray(parsed) ? parsed : [];
}
export function readEvidenceDocument(filePath) {
    if (!existsSync(filePath)) {
        return { wrapper: null, evidence: [] };
    }
    const parsed = readJsonFile(filePath);
    if (Array.isArray(parsed)) {
        return { wrapper: null, evidence: parsed };
    }
    if (parsed && typeof parsed === 'object') {
        const wrapper = parsed;
        if (Array.isArray(wrapper.evidence)) {
            return { wrapper, evidence: wrapper.evidence };
        }
        if (isEvidenceRecord(wrapper)) {
            return { wrapper: null, evidence: [wrapper] };
        }
        return { wrapper, evidence: [] };
    }
    return { wrapper: null, evidence: [] };
}
export function isEvidenceRecord(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    return typeof candidate.evidenceKind === 'string'
        && typeof candidate.summary === 'string'
        && Array.isArray(candidate.artifactPaths);
}
export function normalizeWorkItem(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const candidate = value;
    const workItemId = String(candidate.workItemId ?? candidate.id ?? candidate.taskId ?? '').trim();
    const title = String(candidate.title ?? '').trim();
    const status = String(candidate.status ?? '').trim();
    if (!workItemId || !title || !status) {
        return null;
    }
    return { workItemId, title, status: status };
}
export function listFilesRecursive(directoryPath) {
    if (!existsSync(directoryPath)) {
        return [];
    }
    return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
        const absolutePath = path.join(directoryPath, entry.name);
        return entry.isDirectory() ? listFilesRecursive(absolutePath) : [absolutePath];
    });
}
export function createEmptyRegistry(timestamp) {
    return {
        schemaId: 'atm.registry',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'Local governance registry initialized.' },
        registryId: 'local-governance-registry',
        generatedAt: timestamp,
        entries: []
    };
}
export function createDefaultContextBudgetPolicy(timestamp) {
    return {
        policyId: 'default-policy',
        generatedAt: timestamp,
        unit: 'tokens',
        warningTokens: 12000,
        summarizeTokens: 20000,
        hardStopTokens: 28000,
        maxInlineArtifacts: 2,
        defaultSummary: 'Summarize large tool output before continuing.'
    };
}
export function evaluateContextBudget(policy, input, generatedAt) {
    const estimatedTokens = Math.max(0, Number(input.estimatedTokens ?? 0));
    const inlineArtifacts = Math.max(0, Number(input.inlineArtifacts ?? 0));
    const overInlineArtifacts = inlineArtifacts > policy.maxInlineArtifacts;
    const decision = estimatedTokens >= policy.hardStopTokens
        ? 'hard-stop'
        : estimatedTokens >= policy.summarizeTokens || overInlineArtifacts
            ? 'summarize-before-continue'
            : 'pass';
    const reason = decision === 'pass'
        ? `Estimated ${estimatedTokens} tokens is within the current context budget policy.`
        : overInlineArtifacts
            ? `Inline artifact count ${inlineArtifacts} exceeds maxInlineArtifacts ${policy.maxInlineArtifacts}.`
            : `Estimated ${estimatedTokens} tokens reached ${decision === 'hard-stop' ? 'hard-stop' : 'summarize'} threshold.`;
    return { decision, estimatedTokens, inlineArtifacts, generatedAt, reason };
}
export function createContextBudgetSummary(policy, input, evaluation) {
    return [
        '# ATM Context Budget Summary',
        '',
        `Decision: ${evaluation.decision}`,
        `Budget ID: ${input.budgetId}`,
        `Estimated tokens: ${evaluation.estimatedTokens}`,
        `Inline artifacts: ${evaluation.inlineArtifacts}`,
        `Policy: ${policy.policyId}`,
        '',
        evaluation.reason,
        '',
        input.requestedSummary ?? policy.defaultSummary
    ].join('\n');
}
export function renderContextSummaryMarkdown(summary) {
    const nextActions = summary.nextActions.map((entry) => `- ${entry}`).join('\n');
    const artifacts = (summary.artifactPaths ?? []).map((entry) => `- ${entry}`).join('\n') || '- none';
    const evidence = (summary.evidencePaths ?? []).map((entry) => `- ${entry}`).join('\n') || '- none';
    const reports = (summary.reportPaths ?? []).map((entry) => `- ${entry}`).join('\n') || '- none';
    return [
        `# ${summary.workItemId} Continuation Summary`,
        '',
        summary.summary,
        '',
        '## Next Actions',
        nextActions,
        '',
        '## Evidence',
        evidence,
        '',
        '## Artifacts',
        artifacts,
        '',
        '## Reports',
        reports,
        '',
        summary.resumePrompt ? `Resume prompt: ${summary.resumePrompt}` : ''
    ].filter((entry) => entry !== '').join('\n');
}
export function isReleasedLockRecord(value) {
    if (value.released === true) {
        return true;
    }
    if (value.status === 'released') {
        return true;
    }
    if (value.claim && typeof value.claim === 'object') {
        const claimState = String(value.claim.state ?? '');
        return claimState === 'released';
    }
    return false;
}
export function createLockConflictError(workItemId, existing) {
    const lockedBy = existing && typeof existing.lockedBy === 'string' ? existing.lockedBy : null;
    const error = new Error(`Active lock already exists for ${workItemId}${lockedBy ? ` (owner: ${lockedBy})` : ''}.`);
    error.code = 'ATM_LOCK_CONFLICT';
    error.details = {
        workItemId,
        lockedBy,
        existing
    };
    return error;
}
export function extractFsErrorCode(error) {
    if (!error || typeof error !== 'object') {
        return null;
    }
    const code = error.code;
    return typeof code === 'string' && code.trim().length > 0 ? code : null;
}
export function sanitizeBudgetFileId(budgetId) {
    return String(budgetId || 'context-budget').replace(/\\/g, '/').replace(/[/:]+/g, '-');
}
export function materializeEvidenceVersionMetadata(evidence, wrapper) {
    const specVersion = wrapper && typeof wrapper.specVersion === 'string' ? wrapper.specVersion : undefined;
    const versions = resolveDataAndArtifactVersions({
        specVersion,
        dataVersion: evidence.dataVersion,
        artifactVersion: evidence.artifactVersion
    });
    let artifactVersionKind = evidence.artifactVersionKind;
    if (artifactVersionKind !== undefined && artifactVersionKind !== null) {
        if (!isArtifactVersionKind(artifactVersionKind)) {
            throw new Error('invalid artifactVersionKind');
        }
    }
    else {
        if (versions.artifactVersion && isValidSemverVersionString(versions.artifactVersion)) {
            artifactVersionKind = 'semver';
        }
        else {
            artifactVersionKind = undefined;
        }
    }
    const result = {
        ...evidence,
        dataVersion: evidence.dataVersion || versions.dataVersion,
        artifactVersion: evidence.artifactVersion || versions.artifactVersion,
        ...(artifactVersionKind !== undefined ? { artifactVersionKind } : {})
    };
    return result;
}
export function createEvidenceDocument(wrapper, nextEvidence) {
    return wrapper ? { ...wrapper, evidence: nextEvidence } : nextEvidence;
}
