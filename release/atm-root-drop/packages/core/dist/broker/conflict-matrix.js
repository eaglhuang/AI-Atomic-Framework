const conflictMatrixSchemaId = 'atm.brokerConflictMatrix.v1';
const conflictMatrixSpecVersion = '0.1.0';
export function evaluateConflictMatrix(newIntent, activeIntents, options = {}) {
    const conflicts = [];
    if (!isWellFormedIntent(newIntent)) {
        conflicts.push({
            kind: 'intent-shape',
            detail: 'Malformed intent shape: missing taskId / actorId / atomRefs / targetFiles.',
            blockingTask: 'self'
        });
    }
    const sharedSurfaceConflicts = detectSharedSurfaceConflicts(newIntent, activeIntents);
    conflicts.push(...sharedSurfaceConflicts);
    const cidConflicts = detectCidConflictClasses(newIntent, activeIntents);
    conflicts.push(...cidConflicts);
    const fileConflicts = detectFileRangeConflictClasses(newIntent, activeIntents);
    conflicts.push(...fileConflicts);
    const leaseConflicts = detectLeaseConflicts(newIntent, activeIntents, options.currentEpoch);
    conflicts.push(...leaseConflicts);
    const arbitrationVerdict = chooseArbitrationVerdict(conflicts);
    const dedupedConflicts = dedupeConflictResults(conflicts);
    return {
        schemaId: conflictMatrixSchemaId,
        specVersion: conflictMatrixSpecVersion,
        migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
        taskId: newIntent.taskId,
        arbitrationVerdict,
        conflicts: dedupedConflicts,
        gateResults: buildSevenLayerGateResults(dedupedConflicts)
    };
}
function buildSevenLayerGateResults(conflicts) {
    const gates = [
        { gate: 'intent-shape', kinds: ['intent-shape'], blocking: true, detail: 'Intent contains task, actor, targets, and well-formed atom references.' },
        { gate: 'lease-fencing', kinds: ['lease'], blocking: true, detail: 'Active lease epochs and ownership are valid.' },
        { gate: 'shared-surface', kinds: ['shared-surface'], blocking: true, detail: 'Shared generators, projections, registries, validators, and artifacts are exclusive.' },
        { gate: 'atom-id', kinds: ['cid'], blocking: true, detail: 'Atom IDs do not overlap an active write owner.' },
        { gate: 'atom-cid', kinds: ['cid'], blocking: true, detail: 'Atom CIDs do not overlap an active write owner.' },
        { gate: 'read-set', kinds: ['read-set'], blocking: false, detail: 'Read/write dependencies are visible before mutation.' },
        { gate: 'file-range', kinds: ['file-range'], blocking: true, detail: 'Same-file source ranges are either disjoint or routed to a bounded compose/steward lane.' }
    ];
    return gates.map(({ gate, kinds, blocking, detail }) => {
        const matching = conflicts.filter((conflict) => kinds.includes(conflict.kind));
        const taskNames = [...new Set(matching.map((conflict) => conflict.blockingTask))].sort();
        const hasOverlap = matching.some((conflict) => conflict.detail.includes('overlap'));
        return {
            gate,
            status: matching.length === 0 ? 'clear' : (blocking && (gate !== 'file-range' || hasOverlap) ? 'block' : 'watch'),
            detail: matching.length === 0 ? detail : matching.map((conflict) => conflict.detail).join(' '),
            blockingTasks: taskNames
        };
    });
}
function isWellFormedIntent(intent) {
    if (!intent.taskId || !intent.actorId || intent.targetFiles.length === 0) {
        return false;
    }
    for (const ref of intent.atomRefs) {
        if (!ref.atomId || !ref.atomCid) {
            return false;
        }
    }
    return true;
}
function chooseArbitrationVerdict(conflicts) {
    if (conflicts.some((item) => item.kind === 'intent-shape' || item.kind === 'lease')) {
        return 'takeover';
    }
    const hasHardConflict = conflicts.some((item) => item.kind === 'shared-surface' || item.kind === 'cid');
    if (hasHardConflict) {
        return 'freeze';
    }
    const hasFileConflict = conflicts.some((item) => item.kind === 'file-range');
    if (hasFileConflict) {
        return conflicts.some((item) => item.detail.includes('overlap')) ? 'freeze' : 'watch';
    }
    const hasReadConflict = conflicts.some((item) => item.kind === 'read-set');
    return hasReadConflict ? 'watch' : 'allow';
}
function detectSharedSurfaceConflicts(newIntent, activeIntents) {
    const conflicts = [];
    const newGenerators = new Set(newIntent.sharedSurfaces.generators);
    const newProjections = new Set(newIntent.sharedSurfaces.projections);
    const newRegistries = new Set(newIntent.sharedSurfaces.registries);
    const newValidators = new Set(newIntent.sharedSurfaces.validators);
    const newArtifacts = new Set(newIntent.sharedSurfaces.artifacts);
    for (const active of activeIntents) {
        if (active.taskId === newIntent.taskId)
            continue;
        for (const generator of active.resourceKeys.generators) {
            if (newGenerators.has(generator)) {
                conflicts.push({
                    kind: 'shared-surface',
                    detail: `Shared generator conflict: '${generator}' is in use by '${active.taskId}'.`,
                    blockingTask: active.taskId
                });
            }
        }
        for (const projection of newProjections) {
            if (active.resourceKeys.projections.includes(projection)) {
                conflicts.push({
                    kind: 'shared-surface',
                    detail: `Shared projection conflict: '${projection}' is in use by '${active.taskId}'.`,
                    blockingTask: active.taskId
                });
            }
        }
        for (const registry of newRegistries) {
            if (active.resourceKeys.registries.includes(registry)) {
                conflicts.push({
                    kind: 'shared-surface',
                    detail: `Shared registry conflict: '${registry}' is in use by '${active.taskId}'.`,
                    blockingTask: active.taskId
                });
            }
        }
        for (const validator of newValidators) {
            if (active.resourceKeys.validators.includes(validator)) {
                conflicts.push({
                    kind: 'shared-surface',
                    detail: `Shared validator conflict: '${validator}' is in use by '${active.taskId}'.`,
                    blockingTask: active.taskId
                });
            }
        }
        for (const artifact of newArtifacts) {
            if (active.resourceKeys.artifacts.includes(artifact)) {
                conflicts.push({
                    kind: 'shared-surface',
                    detail: `Shared artifact conflict: '${artifact}' is in use by '${active.taskId}'.`,
                    blockingTask: active.taskId
                });
            }
        }
    }
    return conflicts;
}
function detectCidConflictClasses(newIntent, activeIntents) {
    const conflicts = [];
    const newAtomIds = new Set(newIntent.atomRefs.map((ref) => ref.atomId));
    const newAtomCids = new Set(newIntent.atomRefs.map((ref) => ref.atomCid));
    const newReadAtomIds = new Set((newIntent.readAtoms ?? []).map((ref) => ref.atomId));
    const newReadAtomCids = new Set((newIntent.readAtoms ?? []).map((ref) => ref.atomCid));
    const seen = new Set();
    for (const active of activeIntents) {
        if (active.taskId === newIntent.taskId)
            continue;
        const materialCidWrite = hasSharedWriteSurface(newIntent, active);
        const activeReadAtomIds = active.resourceKeys.readAtomIds ?? [];
        const activeReadAtomCids = active.resourceKeys.readAtomCids ?? [];
        for (const activeAtomId of active.resourceKeys.atomIds) {
            if (materialCidWrite && newAtomIds.has(activeAtomId)) {
                const key = `cid:${active.taskId}:${activeAtomId}`;
                if (!seen.has(key)) {
                    conflicts.push({
                        kind: 'cid',
                        detail: `Write set overlap: atomId '${activeAtomId}' is held by '${active.taskId}'.`,
                        blockingTask: active.taskId
                    });
                    seen.add(key);
                }
            }
            if (newReadAtomIds.has(activeAtomId)) {
                const key = `read:${active.taskId}:${activeAtomId}`;
                if (!seen.has(key)) {
                    conflicts.push({
                        kind: 'read-set',
                        detail: `Read/write overlap: atomId '${activeAtomId}' is written by '${active.taskId}'.`,
                        blockingTask: active.taskId
                    });
                    seen.add(key);
                }
            }
        }
        for (const activeReadAtomId of activeReadAtomIds) {
            if (newAtomIds.has(activeReadAtomId)) {
                const key = `active-read:${active.taskId}:${activeReadAtomId}`;
                if (!seen.has(key)) {
                    conflicts.push({
                        kind: 'read-set',
                        detail: `Read/write overlap: atomId '${activeReadAtomId}' is read by active task '${active.taskId}'.`,
                        blockingTask: active.taskId
                    });
                    seen.add(key);
                }
            }
        }
        for (const activeAtomCid of active.resourceKeys.atomCids) {
            if (materialCidWrite && newAtomCids.has(activeAtomCid)) {
                const key = `cid-c:${active.taskId}:${activeAtomCid}`;
                if (!seen.has(key)) {
                    conflicts.push({
                        kind: 'cid',
                        detail: `Write set overlap: atomCid '${activeAtomCid}' is held by '${active.taskId}'.`,
                        blockingTask: active.taskId
                    });
                    seen.add(key);
                }
            }
            if (newReadAtomCids.has(activeAtomCid)) {
                const key = `read-c:${active.taskId}:${activeAtomCid}`;
                if (!seen.has(key)) {
                    conflicts.push({
                        kind: 'read-set',
                        detail: `Read/write overlap: atomCid '${activeAtomCid}' is written by '${active.taskId}'.`,
                        blockingTask: active.taskId
                    });
                    seen.add(key);
                }
            }
        }
        for (const activeReadAtomCid of activeReadAtomCids) {
            if (newAtomCids.has(activeReadAtomCid)) {
                const key = `active-read-c:${active.taskId}:${activeReadAtomCid}`;
                if (!seen.has(key)) {
                    conflicts.push({
                        kind: 'read-set',
                        detail: `Read/write overlap: atomCid '${activeReadAtomCid}' is read by active task '${active.taskId}'.`,
                        blockingTask: active.taskId
                    });
                    seen.add(key);
                }
            }
        }
    }
    return conflicts;
}
function hasSharedWriteSurface(intent, active) {
    const files = new Set(intent.targetFiles.map((file) => file.trim().replace(/\\/g, '/')));
    if (active.resourceKeys.files.some((file) => files.has(file.trim().replace(/\\/g, '/'))))
        return true;
    return intersects(intent.sharedSurfaces.generators, active.resourceKeys.generators)
        || intersects(intent.sharedSurfaces.projections, active.resourceKeys.projections)
        || intersects(intent.sharedSurfaces.registries, active.resourceKeys.registries)
        || intersects(intent.sharedSurfaces.validators, active.resourceKeys.validators)
        || intersects(intent.sharedSurfaces.artifacts, active.resourceKeys.artifacts);
}
function intersects(left, right) {
    const values = new Set(left);
    return right.some((value) => values.has(value));
}
function detectFileRangeConflictClasses(newIntent, activeIntents) {
    const conflicts = [];
    const seen = new Set();
    const activeRangesByFile = new Map();
    for (const active of activeIntents) {
        if (active.taskId === newIntent.taskId)
            continue;
        for (const atomRange of active.resourceKeys.atomRanges ?? []) {
            if (!atomRange.filePath || atomRange.lineStart <= 0 || atomRange.lineEnd <= 0)
                continue;
            const existing = activeRangesByFile.get(atomRange.filePath) ?? [];
            existing.push({ active, ref: { atomId: active.taskId, atomCid: atomRange.atomCid, operation: 'modify' }, range: atomRange });
            activeRangesByFile.set(atomRange.filePath, existing);
        }
    }
    for (const targetFile of newIntent.targetFiles) {
        const sourceRanges = newIntent.atomRefs
            .map((entry) => ({ entry, range: entry.sourceRange }))
            .filter((candidate) => {
            const range = candidate.range;
            return !!range && range.filePath === targetFile && range.lineStart > 0 && range.lineEnd > 0;
        });
        if (sourceRanges.length === 0)
            continue;
        const activeEntries = activeRangesByFile.get(targetFile) ?? [];
        if (activeEntries.length === 0)
            continue;
        for (const source of sourceRanges) {
            for (const active of activeEntries) {
                if (source.range.lineStart <= active.range.lineEnd && source.range.lineEnd >= active.range.lineStart) {
                    const overlapKey = `overlap:${targetFile}:${active.active.taskId}:${source.entry.atomCid}:${active.ref.atomCid}`;
                    if (!seen.has(overlapKey)) {
                        conflicts.push({
                            kind: 'file-range',
                            detail: `File overlap on '${targetFile}' between '${source.entry.atomCid}' and '${active.ref.atomCid}'.`,
                            blockingTask: active.active.taskId
                        });
                        seen.add(overlapKey);
                    }
                }
                else {
                    const watchKey = `disjoint:${targetFile}:${active.active.taskId}:${source.entry.atomCid}:${active.ref.atomCid}`;
                    if (!seen.has(watchKey)) {
                        conflicts.push({
                            kind: 'file-range',
                            detail: `Syntactically disjoint on '${targetFile}' with active task '${active.active.taskId}'.`,
                            blockingTask: active.active.taskId
                        });
                        seen.has(watchKey) || seen.add(watchKey);
                    }
                }
            }
        }
    }
    return conflicts;
}
function hasResourceOverlap(newIntent, active) {
    if (active.taskId === newIntent.taskId)
        return true;
    const activeFiles = new Set(active.resourceKeys.files);
    if (newIntent.targetFiles.some(file => activeFiles.has(file)))
        return true;
    const activeAtomIds = new Set(active.resourceKeys.atomIds);
    if (newIntent.atomRefs.some(ref => activeAtomIds.has(ref.atomId)))
        return true;
    const activeAtomCids = new Set(active.resourceKeys.atomCids);
    if (newIntent.atomRefs.some(ref => activeAtomCids.has(ref.atomCid)))
        return true;
    const activeGenerators = new Set(active.resourceKeys.generators);
    if (newIntent.sharedSurfaces.generators.some(gen => activeGenerators.has(gen)))
        return true;
    const activeProjections = new Set(active.resourceKeys.projections);
    if (newIntent.sharedSurfaces.projections.some(proj => activeProjections.has(proj)))
        return true;
    const activeRegistries = new Set(active.resourceKeys.registries);
    if (newIntent.sharedSurfaces.registries.some(reg => activeRegistries.has(reg)))
        return true;
    const activeValidators = new Set(active.resourceKeys.validators);
    if (newIntent.sharedSurfaces.validators.some(val => activeValidators.has(val)))
        return true;
    const activeArtifacts = new Set(active.resourceKeys.artifacts);
    if (newIntent.sharedSurfaces.artifacts.some(art => activeArtifacts.has(art)))
        return true;
    return false;
}
function detectLeaseConflicts(newIntent, activeIntents, currentEpoch) {
    const conflicts = [];
    const now = Date.now();
    for (const active of activeIntents) {
        if (!hasResourceOverlap(newIntent, active))
            continue;
        // `currentEpoch` is a registry watermark, not a global lease generation.
        // Independent active tasks naturally have different epochs; comparing each
        // one to the watermark would make every older, still-live task look stale.
        if (!Number.isInteger(active.leaseEpoch) || active.leaseEpoch < 1) {
            conflicts.push({
                kind: 'lease',
                detail: `Active lease epoch is invalid for '${active.taskId}'; explicit takeover is required.`,
                blockingTask: active.taskId
            });
            continue;
        }
        if (!active.expiresAt)
            continue;
        const expiresAt = Date.parse(active.expiresAt);
        if (Number.isNaN(expiresAt) || expiresAt <= now) {
            conflicts.push({
                kind: 'lease',
                detail: `Active lease expired for '${active.taskId}'; stale entry requires takeover.`,
                blockingTask: active.taskId
            });
        }
    }
    return dedupeConflictResults(conflicts);
}
function dedupeConflictResults(conflicts) {
    const seen = new Set();
    const unique = [];
    for (const conflict of conflicts) {
        const key = `${conflict.kind}::${conflict.blockingTask}::${conflict.detail}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        unique.push(conflict);
    }
    return unique.sort((left, right) => {
        const leftKey = `${left.kind}::${left.blockingTask}::${left.detail}`;
        const rightKey = `${right.kind}::${right.blockingTask}::${right.detail}`;
        return leftKey.localeCompare(rightKey);
    });
}
