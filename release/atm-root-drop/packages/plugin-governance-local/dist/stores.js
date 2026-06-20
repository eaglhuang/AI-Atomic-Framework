import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { resolveLocalGovernanceLayout } from './layout.js';
import { isArtifactVersionKind, resolveDataAndArtifactVersions, isValidSemverVersionString } from './versioning.js';
const CANONICAL_KNOWLEDGE_ROOT = '.atm/knowledge';
const GENERATED_KNOWLEDGE_CACHE_ROOT = '.atm/runtime/knowledge';
export function createLocalGovernanceStores(config) {
    const repositoryRoot = path.resolve(config.repositoryRoot);
    const layout = resolveLocalGovernanceLayout(config.layout);
    const now = config.now ?? (() => new Date().toISOString());
    const absoluteLayout = createAbsoluteLayout(repositoryRoot, layout);
    function ensureAllDirectories() {
        for (const directoryPath of Object.values(absoluteLayout)) {
            mkdirSync(directoryPath, { recursive: true });
        }
    }
    function initializeStore(kind) {
        ensureAllDirectories();
        return capabilityResult(`Initialized ${kind}.`);
    }
    const taskStore = {
        initialize: () => initializeStore('task store'),
        healthCheck: () => capabilityResult(`Task store is ready at ${layout.taskStorePath}.`),
        createTask(workItem) {
            ensureAllDirectories();
            const filePath = path.join(absoluteLayout.taskStorePath, `${workItem.workItemId}.json`);
            writeJsonFile(filePath, {
                schemaVersion: 'atm.workItem.v0.1',
                id: workItem.workItemId,
                title: workItem.title,
                status: workItem.status
            });
            return workItem;
        },
        getTask(workItemId) {
            const filePath = path.join(absoluteLayout.taskStorePath, `${workItemId}.json`);
            return existsSync(filePath) ? normalizeWorkItem(readJsonFile(filePath)) : null;
        },
        updateTaskStatus(workItemId, status) {
            const filePath = path.join(absoluteLayout.taskStorePath, `${workItemId}.json`);
            if (!existsSync(filePath)) {
                throw new Error(`Task not found: ${workItemId}`);
            }
            const current = readJsonFile(filePath);
            const updated = { ...current, status };
            writeJsonFile(filePath, updated);
            const normalized = normalizeWorkItem(updated);
            if (!normalized) {
                throw new Error(`Task store generated an invalid work item record for ${workItemId}`);
            }
            return normalized;
        },
        listTasks() {
            if (!existsSync(absoluteLayout.taskStorePath)) {
                return [];
            }
            return readdirSync(absoluteLayout.taskStorePath)
                .filter((entry) => entry.endsWith('.json'))
                .map((entry) => normalizeWorkItem(readJsonFile(path.join(absoluteLayout.taskStorePath, entry))))
                .filter((entry) => entry !== null)
                .sort((left, right) => left.workItemId.localeCompare(right.workItemId));
        }
    };
    const lockStore = {
        initialize: () => initializeStore('lock store'),
        healthCheck: () => capabilityResult(`Lock store is ready at ${layout.lockStorePath}.`),
        acquireLock(workItem, files, actor) {
            ensureAllDirectories();
            const filePath = path.join(absoluteLayout.lockStorePath, `${workItem.workItemId}.lock.json`);
            const timestamp = now();
            const leaseEpoch = Date.parse(timestamp);
            const record = {
                schemaId: 'atm.governanceScopeLock',
                specVersion: '0.1.0',
                migration: {
                    strategy: 'none',
                    fromVersion: null,
                    notes: 'Scope lock baseline record.'
                },
                workItemId: workItem.workItemId,
                lockedBy: actor,
                lockedAt: timestamp,
                actorId: actor,
                leaseId: `lease-${timestamp.replace(/[:.]/g, '-')}`,
                leaseEpoch,
                heartbeatAt: timestamp,
                ttlSeconds: 1800,
                files: Array.from(new Set(files.map((filePath) => normalizeRelativePath(filePath)).filter(Boolean)))
            };
            if (existsSync(filePath)) {
                const existing = readJsonFile(filePath);
                if (isReleasedLockRecord(existing) || existing.lockedBy === actor || existing.actorId === actor) {
                    writeJsonFile(filePath, record);
                    return record;
                }
                throw createLockConflictError(workItem.workItemId, existing);
            }
            try {
                const descriptor = openSync(filePath, 'wx');
                try {
                    writeSync(descriptor, `${JSON.stringify(record, null, 2)}\n`, undefined, 'utf8');
                }
                finally {
                    closeSync(descriptor);
                }
            }
            catch (error) {
                const errorCode = extractFsErrorCode(error);
                if (errorCode === 'EEXIST') {
                    const existing = existsSync(filePath) ? readJsonFile(filePath) : null;
                    throw createLockConflictError(workItem.workItemId, existing);
                }
                throw error;
            }
            return record;
        },
        getLock(workItemId) {
            const filePath = path.join(absoluteLayout.lockStorePath, `${workItemId}.lock.json`);
            return existsSync(filePath) ? readJsonFile(filePath) : null;
        },
        releaseLock(workItemId, actor) {
            const filePath = path.join(absoluteLayout.lockStorePath, `${workItemId}.lock.json`);
            const timestamp = now();
            const current = existsSync(filePath)
                ? readJsonFile(filePath)
                : {
                    schemaId: 'atm.governanceScopeLock',
                    specVersion: '0.1.0',
                    migration: {
                        strategy: 'none',
                        fromVersion: null,
                        notes: 'Scope lock release marker.'
                    },
                    workItemId
                };
            writeJsonFile(filePath, {
                ...current,
                workItemId,
                released: true,
                status: 'released',
                releasedAt: timestamp,
                releasedBy: actor,
                releaseEpoch: Date.parse(timestamp)
            });
            return capabilityResult(`Released scope lock for ${workItemId}.`);
        }
    };
    const documentIndex = {
        initialize: () => initializeStore('document index'),
        healthCheck: () => capabilityResult(`Document index is ready at ${layout.documentIndexPath}.`),
        resolveDocumentId(documentId) {
            const exact = readDocumentIndex(absoluteLayout.documentIndexPath).find((entry) => entry.documentId === documentId || entry.path === documentId);
            return exact?.path ?? null;
        },
        searchDocuments(query) {
            const normalizedQuery = String(query || '').trim().toLowerCase();
            if (!normalizedQuery) {
                return [];
            }
            return readDocumentIndex(absoluteLayout.documentIndexPath)
                .filter((entry) => JSON.stringify(entry).toLowerCase().includes(normalizedQuery))
                .map((entry) => entry.path);
        },
        updateDocument(documentPath, metadata) {
            ensureAllDirectories();
            const indexPath = path.join(absoluteLayout.documentIndexPath, 'documents.json');
            const entries = readDocumentIndex(absoluteLayout.documentIndexPath).filter((entry) => entry.path !== documentPath);
            entries.push({
                documentId: String(metadata.documentId ?? documentPath),
                path: normalizeRelativePath(documentPath),
                metadata
            });
            writeJsonFile(indexPath, entries);
            return capabilityResult(`Indexed document ${documentPath}.`);
        }
    };
    const shardStore = {
        initialize: () => initializeStore('shard store'),
        healthCheck: () => capabilityResult(`Shard store is ready at ${layout.shardStorePath}.`),
        readShard(shardPath) {
            assertCanonicalShardInput(shardPath);
            const absolutePath = resolveRepoPath(repositoryRoot, shardPath);
            return existsSync(absolutePath) ? readUnknownFile(absolutePath) : null;
        },
        writeShard(shardPath, value) {
            assertCanonicalShardInput(shardPath);
            ensureAllDirectories();
            writeUnknownFile(resolveRepoPath(repositoryRoot, shardPath), value);
            return capabilityResult(`Wrote shard ${normalizeRelativePath(shardPath)}.`);
        },
        rebuildIndex(indexPath) {
            assertGeneratedKnowledgeCacheOutput(indexPath);
            ensureAllDirectories();
            const entries = listFilesRecursive(absoluteLayout.shardStorePath).map((filePath) => relativePathFrom(repositoryRoot, filePath));
            writeJsonFile(resolveRepoPath(repositoryRoot, indexPath), {
                updatedAt: now(),
                entries
            });
            return capabilityResult(`Rebuilt shard index ${normalizeRelativePath(indexPath)}.`);
        }
    };
    const artifactStore = {
        initialize: () => initializeStore('artifact store'),
        healthCheck: () => capabilityResult(`Artifact store is ready at ${layout.artifactStorePath}.`),
        writeArtifact(record, content) {
            ensureAllDirectories();
            const targetPath = resolveRepoPath(repositoryRoot, record.artifactPath);
            mkdirSync(path.dirname(targetPath), { recursive: true });
            writeContentFile(targetPath, content);
            appendManifestRecord(path.join(absoluteLayout.artifactStorePath, 'manifest.json'), record);
            return record;
        },
        listArtifacts(workItemId) {
            return readManifestRecords(path.join(absoluteLayout.artifactStorePath, 'manifest.json'))
                .filter((record) => record.artifactPath.includes(workItemId));
        }
    };
    const logStore = {
        initialize: () => initializeStore('log store'),
        healthCheck: () => capabilityResult(`Log store is ready at ${layout.logStorePath}.`),
        appendLog(workItemId, message) {
            ensureAllDirectories();
            const filePath = path.join(absoluteLayout.logStorePath, `${workItemId}.log`);
            writeFileSync(filePath, `${existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''}${message}\n`, 'utf8');
            return capabilityResult(`Appended log for ${workItemId}.`);
        },
        readLog(workItemId) {
            const filePath = path.join(absoluteLayout.logStorePath, `${workItemId}.log`);
            return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
        }
    };
    const runReportStore = {
        initialize: () => initializeStore('run report store'),
        healthCheck: () => capabilityResult(`Run report store is ready at ${layout.runReportStorePath}.`),
        writeRunReport(reportId, report) {
            ensureAllDirectories();
            writeJsonFile(path.join(absoluteLayout.runReportStorePath, withJsonExtension(reportId)), report);
            return capabilityResult(`Wrote run report ${reportId}.`);
        },
        readRunReport(reportId) {
            const filePath = path.join(absoluteLayout.runReportStorePath, withJsonExtension(reportId));
            return existsSync(filePath) ? readJsonFile(filePath) : null;
        }
    };
    const stateStore = {
        initialize: () => initializeStore('state store'),
        healthCheck: () => capabilityResult(`State store is ready at ${layout.stateStorePath}.`),
        readMarkdown(filePath) {
            const absolutePath = resolveRepoPath(repositoryRoot, filePath);
            return existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : '';
        },
        writeMarkdown(filePath, content) {
            const absolutePath = resolveRepoPath(repositoryRoot, filePath);
            mkdirSync(path.dirname(absolutePath), { recursive: true });
            writeFileSync(absolutePath, content, 'utf8');
            return capabilityResult(`Wrote markdown state ${normalizeRelativePath(filePath)}.`);
        },
        readJson(filePath) {
            const absolutePath = resolveRepoPath(repositoryRoot, filePath);
            return existsSync(absolutePath) ? readJsonFile(absolutePath) : null;
        },
        writeJson(filePath, value) {
            writeJsonFile(resolveRepoPath(repositoryRoot, filePath), value);
            return capabilityResult(`Wrote JSON state ${normalizeRelativePath(filePath)}.`);
        }
    };
    const ruleGuard = {
        initialize: () => initializeStore('rule guard'),
        healthCheck: () => capabilityResult(`Rule guard is ready at ${layout.ruleGuardPath}.`),
        runGuard(guardId, context) {
            ensureAllDirectories();
            const artifactPath = path.join(layout.ruleGuardPath, withJsonExtension(guardId));
            writeJsonFile(resolveRepoPath(repositoryRoot, artifactPath), {
                guardId,
                ok: true,
                generatedAt: now(),
                context
            });
            return capabilityResult(`Recorded rule guard result for ${guardId}.`, [{
                    artifactPath,
                    artifactKind: 'report',
                    producedBy: '@ai-atomic-framework/plugin-governance-local:rule-guard'
                }]);
        }
    };
    const evidenceStore = {
        initialize: () => initializeStore('evidence store'),
        healthCheck: () => capabilityResult(`Evidence store is ready at ${layout.evidenceStorePath}.`),
        writeEvidence(workItemId, evidence) {
            ensureAllDirectories();
            const filePath = path.join(absoluteLayout.evidenceStorePath, `${workItemId}.json`);
            const existing = readEvidenceDocument(filePath);
            const versionedEvidence = materializeEvidenceVersionMetadata(evidence, existing.wrapper);
            const nextEvidence = [...existing.evidence, versionedEvidence];
            writeJsonFile(filePath, createEvidenceDocument(existing.wrapper, nextEvidence));
            return versionedEvidence;
        },
        listEvidence(workItemId) {
            return readEvidenceDocument(path.join(absoluteLayout.evidenceStorePath, `${workItemId}.json`)).evidence;
        }
    };
    const registryStore = {
        initialize: () => initializeStore('registry store'),
        healthCheck: () => capabilityResult(`Registry store is ready at ${layout.registryStorePath ?? '.atm/catalog/registry'}.`),
        readRegistry() {
            ensureAllDirectories();
            const filePath = path.join(absoluteLayout.registryStorePath, 'registry.json');
            if (!existsSync(filePath)) {
                const emptyRegistry = createEmptyRegistry(now());
                writeJsonFile(filePath, emptyRegistry);
                return emptyRegistry;
            }
            return readJsonFile(filePath);
        },
        writeRegistryEntry(entry) {
            const filePath = path.join(absoluteLayout.registryStorePath, 'registry.json');
            const registry = existsSync(filePath)
                ? readJsonFile(filePath)
                : createEmptyRegistry(now());
            const nextEntries = registry.entries.filter((candidate) => ('atomId' in candidate ? candidate.atomId : candidate.mapId) !== entry.atomId);
            nextEntries.push(entry);
            writeJsonFile(filePath, {
                ...registry,
                generatedAt: now(),
                entries: nextEntries
            });
            return entry;
        }
    };
    const contextBudgetGuard = {
        initialize() {
            ensureAllDirectories();
            const defaultPolicy = createDefaultContextBudgetPolicy(now());
            const filePath = path.join(absoluteLayout.contextBudgetStorePath, `${defaultPolicy.policyId}.json`);
            if (!existsSync(filePath)) {
                writeJsonFile(filePath, defaultPolicy);
            }
            return capabilityResult(`Initialized context budget guard at ${layout.contextBudgetStorePath ?? '.atm/runtime/budget'}.`);
        },
        healthCheck: () => capabilityResult(`Context budget guard is ready at ${layout.contextBudgetStorePath ?? '.atm/runtime/budget'}.`),
        readPolicy(policyId = 'default-policy') {
            const filePath = path.join(absoluteLayout.contextBudgetStorePath, `${policyId}.json`);
            return existsSync(filePath) ? readJsonFile(filePath) : null;
        },
        writePolicy(policy) {
            ensureAllDirectories();
            writeJsonFile(path.join(absoluteLayout.contextBudgetStorePath, `${policy.policyId}.json`), policy);
            return policy;
        },
        evaluateBudget(input) {
            ensureAllDirectories();
            const defaultPolicyPath = path.join(absoluteLayout.contextBudgetStorePath, 'default-policy.json');
            const policy = existsSync(defaultPolicyPath)
                ? readJsonFile(defaultPolicyPath)
                : createDefaultContextBudgetPolicy(now());
            const evaluation = evaluateContextBudget(policy, input, now());
            const reportPath = path.join(layout.runReportStorePath, 'context-budget', `${sanitizeBudgetFileId(input.budgetId)}.json`);
            writeJsonFile(resolveRepoPath(repositoryRoot, reportPath), {
                budgetId: input.budgetId,
                workItemId: input.workItemId ?? null,
                policyId: policy.policyId,
                decision: evaluation.decision,
                estimatedTokens: evaluation.estimatedTokens,
                inlineArtifacts: evaluation.inlineArtifacts,
                generatedAt: evaluation.generatedAt,
                reason: evaluation.reason
            });
            let summaryPath;
            if (evaluation.decision !== 'pass') {
                summaryPath = path.join(layout.contextBudgetStorePath ?? '.atm/runtime/budget', `${sanitizeBudgetFileId(input.budgetId)}.md`);
                writeFileSync(resolveRepoPath(repositoryRoot, summaryPath), createContextBudgetSummary(policy, input, evaluation), 'utf8');
            }
            return {
                ...evaluation,
                policyId: policy.policyId,
                budgetId: input.budgetId,
                reportPath: normalizeRelativePath(reportPath),
                summaryPath: summaryPath ? normalizeRelativePath(summaryPath) : undefined
            };
        }
    };
    const contextSummaryStore = {
        initialize: () => initializeStore('context summary store'),
        healthCheck: () => capabilityResult(`Context summary store is ready at ${layout.contextSummaryStorePath ?? '.atm/history/handoff'}.`),
        writeSummary(summary) {
            ensureAllDirectories();
            const filePath = path.join(absoluteLayout.contextSummaryStorePath, `${summary.workItemId}.json`);
            const markdownPath = path.join(absoluteLayout.contextSummaryStorePath, `${summary.workItemId}.md`);
            const materializedSummary = {
                ...summary,
                summaryMarkdownPath: summary.summaryMarkdownPath ?? normalizeRelativePath(path.join(layout.contextSummaryStorePath ?? '.atm/history/handoff', `${summary.workItemId}.md`))
            };
            writeJsonFile(filePath, materializedSummary);
            writeFileSync(markdownPath, renderContextSummaryMarkdown(materializedSummary), 'utf8');
            return materializedSummary;
        },
        readSummary(workItemId) {
            const filePath = path.join(absoluteLayout.contextSummaryStorePath, `${workItemId}.json`);
            return existsSync(filePath) ? readJsonFile(filePath) : null;
        }
    };
    return {
        taskStore,
        lockStore,
        documentIndex,
        shardStore,
        artifactStore,
        logStore,
        runReportStore,
        stateStore,
        ruleGuard,
        evidenceStore,
        registryStore,
        contextBudgetGuard,
        contextSummaryStore
    };
}
function createAbsoluteLayout(repositoryRoot, layout) {
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
function capabilityResult(text, artifacts = [], evidence = []) {
    return { ok: true, messages: [text], artifacts, evidence };
}
function resolveRepoPath(repositoryRoot, filePath) {
    return path.isAbsolute(filePath) ? path.normalize(filePath) : path.resolve(repositoryRoot, filePath);
}
function relativePathFrom(repositoryRoot, filePath) {
    return path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
}
function normalizeRelativePath(filePath) {
    return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
function assertCanonicalShardInput(filePath) {
    const normalized = normalizeRelativePath(filePath);
    if (isInsideRelativeRoot(normalized, GENERATED_KNOWLEDGE_CACHE_ROOT)) {
        throw new Error(`Generated knowledge cache paths under ${GENERATED_KNOWLEDGE_CACHE_ROOT}/** cannot be used as canonical shard input. Use ${CANONICAL_KNOWLEDGE_ROOT}/** for canonical Team knowledge shards.`);
    }
}
function assertGeneratedKnowledgeCacheOutput(filePath) {
    const normalized = normalizeRelativePath(filePath);
    if (isInsideRelativeRoot(normalized, CANONICAL_KNOWLEDGE_ROOT)) {
        throw new Error(`Shard indexes are generated artifacts. Write Team knowledge indexes under ${GENERATED_KNOWLEDGE_CACHE_ROOT}/**, not canonical ${CANONICAL_KNOWLEDGE_ROOT}/**.`);
    }
}
function isInsideRelativeRoot(filePath, root) {
    return filePath === root || filePath.startsWith(`${root}/`);
}
function writeJsonFile(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function readJsonFile(filePath) {
    return JSON.parse(readFileSync(filePath, 'utf8'));
}
function readUnknownFile(filePath) {
    if (filePath.endsWith('.json')) {
        return readJsonFile(filePath);
    }
    return readFileSync(filePath, 'utf8');
}
function writeUnknownFile(filePath, value) {
    if (typeof value === 'string') {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, value, 'utf8');
        return;
    }
    writeJsonFile(filePath, value);
}
function writeContentFile(filePath, content) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
}
function withJsonExtension(name) {
    return name.endsWith('.json') ? name : `${name}.json`;
}
function appendManifestRecord(filePath, record) {
    const records = readManifestRecords(filePath).filter((entry) => entry.artifactPath !== record.artifactPath);
    records.push(record);
    writeJsonFile(filePath, records);
}
function readManifestRecords(filePath) {
    if (!existsSync(filePath)) {
        return [];
    }
    const parsed = readJsonFile(filePath);
    return Array.isArray(parsed) ? parsed : [];
}
function readDocumentIndex(documentIndexPath) {
    const filePath = path.join(documentIndexPath, 'documents.json');
    if (!existsSync(filePath)) {
        return [];
    }
    const parsed = readJsonFile(filePath);
    return Array.isArray(parsed) ? parsed : [];
}
function readEvidenceDocument(filePath) {
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
function isEvidenceRecord(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    return typeof candidate.evidenceKind === 'string'
        && typeof candidate.summary === 'string'
        && Array.isArray(candidate.artifactPaths);
}
function normalizeWorkItem(value) {
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
function listFilesRecursive(directoryPath) {
    if (!existsSync(directoryPath)) {
        return [];
    }
    return readdirSync(directoryPath, { withFileTypes: true }).flatMap((entry) => {
        const absolutePath = path.join(directoryPath, entry.name);
        return entry.isDirectory() ? listFilesRecursive(absolutePath) : [absolutePath];
    });
}
function createEmptyRegistry(timestamp) {
    return {
        schemaId: 'atm.registry',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'Local governance registry initialized.' },
        registryId: 'local-governance-registry',
        generatedAt: timestamp,
        entries: []
    };
}
function createDefaultContextBudgetPolicy(timestamp) {
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
function evaluateContextBudget(policy, input, generatedAt) {
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
function createContextBudgetSummary(policy, input, evaluation) {
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
function renderContextSummaryMarkdown(summary) {
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
function isReleasedLockRecord(value) {
    if (value.released === true) {
        return true;
    }
    if (value.claim && typeof value.claim === 'object') {
        const claimState = String(value.claim.state ?? '');
        return claimState === 'released';
    }
    return false;
}
function createLockConflictError(workItemId, existing) {
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
function extractFsErrorCode(error) {
    if (!error || typeof error !== 'object') {
        return null;
    }
    const code = error.code;
    return typeof code === 'string' && code.trim().length > 0 ? code : null;
}
function sanitizeBudgetFileId(budgetId) {
    return String(budgetId || 'context-budget').replace(/\\/g, '/').replace(/[/:]+/g, '-');
}
function materializeEvidenceVersionMetadata(evidence, wrapper) {
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
function createEvidenceDocument(wrapper, nextEvidence) {
    return wrapper ? { ...wrapper, evidence: nextEvidence } : nextEvidence;
}
