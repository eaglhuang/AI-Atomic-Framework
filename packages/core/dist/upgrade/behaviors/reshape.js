import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
function loadMapSpec(repositoryRoot, mapId) {
    const specPath = path.join(repositoryRoot, 'atomic_workbench', 'maps', mapId, 'map.spec.json');
    if (!existsSync(specPath)) {
        return { members: [], edges: [] };
    }
    return JSON.parse(readFileSync(specPath, 'utf-8'));
}
function computeExternalBindingHash(edges, publicMemberIds) {
    // Only include edges where at least one endpoint is a public/external member
    const externalEdges = edges
        .filter((e) => !publicMemberIds.has(e.from) || !publicMemberIds.has(e.to))
        .map((e) => `${e.from}:${e.to}:${e.binding}`)
        .sort();
    // Hash all edges for full contract tracking
    const allEdges = edges
        .map((e) => `${e.from}:${e.to}:${e.binding}`)
        .sort();
    return createHash('sha256').update(JSON.stringify({ externalEdges, allEdges })).digest('hex').slice(0, 16);
}
function computeSplitEdgeRerouting(edges, split) {
    const rerouted = [];
    const [newAtom1, newAtom2] = split.newAtomIds;
    for (const edge of edges) {
        if (edge.from === split.sourceAtomId) {
            rerouted.push({
                originalFrom: edge.from,
                originalTo: edge.to,
                newFrom: newAtom2,
                newTo: edge.to,
                binding: edge.binding,
                reason: `split output from ${split.sourceAtomId} routes via ${newAtom2}`
            });
        }
        else if (edge.to === split.sourceAtomId) {
            rerouted.push({
                originalFrom: edge.from,
                originalTo: edge.to,
                newFrom: edge.from,
                newTo: newAtom1,
                binding: edge.binding,
                reason: `split input to ${split.sourceAtomId} routes to ${newAtom1}`
            });
        }
    }
    return rerouted;
}
function computeMergeEdgeRerouting(edges, merge) {
    const rerouted = [];
    const [sourceA, sourceB] = merge.sourceAtomIds;
    for (const edge of edges) {
        if (edge.from === sourceA || edge.from === sourceB) {
            rerouted.push({
                originalFrom: edge.from,
                originalTo: edge.to,
                newFrom: merge.newAtomId,
                newTo: edge.to,
                binding: edge.binding,
                reason: `merge output from ${edge.from} now routes from ${merge.newAtomId}`
            });
        }
        else if (edge.to === sourceA || edge.to === sourceB) {
            rerouted.push({
                originalFrom: edge.from,
                originalTo: edge.to,
                newFrom: edge.from,
                newTo: merge.newAtomId,
                binding: edge.binding,
                reason: `merge input to ${edge.to} now routes to ${merge.newAtomId}`
            });
        }
    }
    return rerouted;
}
export function dryRunReshape(repositoryRoot, mapId, mode, spec, proposedBy) {
    const mapSpec = loadMapSpec(repositoryRoot, mapId);
    const memberIds = new Set(mapSpec.members.map((m) => m.atomId ?? m.id ?? ''));
    const warnings = [];
    const externalBindingHashBefore = computeExternalBindingHash(mapSpec.edges, memberIds);
    let edgesRerouted;
    let atomsToDeprecate;
    let atomsToCreate;
    if (mode === 'split') {
        const splitSpec = spec;
        if (!memberIds.has(splitSpec.sourceAtomId)) {
            warnings.push(`sourceAtomId "${splitSpec.sourceAtomId}" not found in map`);
        }
        edgesRerouted = splitSpec.edgeRerouting.length > 0
            ? splitSpec.edgeRerouting
            : computeSplitEdgeRerouting(mapSpec.edges, splitSpec);
        atomsToDeprecate = [splitSpec.sourceAtomId];
        atomsToCreate = [...splitSpec.newAtomIds];
    }
    else {
        const mergeSpec = spec;
        for (const srcId of mergeSpec.sourceAtomIds) {
            if (!memberIds.has(srcId)) {
                warnings.push(`sourceAtomId "${srcId}" not found in map`);
            }
        }
        edgesRerouted = mergeSpec.edgeRerouting.length > 0
            ? mergeSpec.edgeRerouting
            : computeMergeEdgeRerouting(mapSpec.edges, mergeSpec);
        atomsToDeprecate = [...mergeSpec.sourceAtomIds];
        atomsToCreate = [mergeSpec.newAtomId];
    }
    // After rerouting, compute new external binding hash
    const reroutedEdges = mapSpec.edges.map((edge) => {
        const reroute = edgesRerouted.find((r) => r.originalFrom === edge.from && r.originalTo === edge.to);
        if (reroute) {
            return { ...edge, from: reroute.newFrom, to: reroute.newTo };
        }
        return edge;
    });
    const newMemberIds = new Set([
        ...memberIds,
        ...atomsToCreate,
        ...atomsToDeprecate.map((id) => `${id}:deprecated`)
    ]);
    const externalBindingHashAfter = computeExternalBindingHash(reroutedEdges, newMemberIds);
    const externalBindingUnchanged = externalBindingHashBefore === externalBindingHashAfter;
    if (!externalBindingUnchanged) {
        warnings.push('external edge binding schema hash changed — reshape would alter public contract');
    }
    const proposal = {
        schemaId: 'atm.reshapeProposal',
        proposalId: createHash('sha256')
            .update(`${mapId}:${mode}:${new Date().toISOString()}`)
            .digest('base64url')
            .slice(0, 12),
        mapId,
        mode,
        proposedAt: new Date().toISOString(),
        proposedBy: proposedBy ?? process.env.AGENT_IDENTITY ?? 'atm',
        [mode === 'split' ? 'split' : 'merge']: spec,
        dryRun: true,
        externalBindingSchemaHash: externalBindingHashAfter,
        status: 'pending-human-review'
    };
    return {
        ok: warnings.length === 0,
        proposal,
        warnings,
        plan: {
            atomsToDeprecate,
            atomsToCreate,
            edgesRerouted,
            externalBindingSchemaHash: externalBindingHashAfter,
            externalBindingUnchanged
        }
    };
}
export function applyReshape(repositoryRoot, proposal, humanReviewDecisionId) {
    if (!humanReviewDecisionId) {
        throw new Error('RESHAPE_HUMAN_REVIEW_REQUIRED: humanReviewDecisionId is required to apply reshape');
    }
    if (proposal.dryRun) {
        throw new Error('RESHAPE_DRY_RUN: cannot apply a dry-run proposal; re-generate with dryRun=false');
    }
    if (proposal.status !== 'approved') {
        throw new Error(`RESHAPE_NOT_APPROVED: proposal status is "${proposal.status}", must be "approved"`);
    }
    const mapSpec = loadMapSpec(repositoryRoot, proposal.mapId);
    const mode = proposal.mode;
    const appliedAt = new Date().toISOString();
    let atomsDeprecated;
    let atomsCreated;
    let edgesRerouted;
    if (mode === 'split' && proposal.split) {
        const splitSpec = proposal.split;
        atomsDeprecated = [splitSpec.sourceAtomId];
        atomsCreated = [...splitSpec.newAtomIds];
        edgesRerouted = splitSpec.edgeRerouting;
    }
    else if (mode === 'merge' && proposal.merge) {
        const mergeSpec = proposal.merge;
        atomsDeprecated = [...mergeSpec.sourceAtomIds];
        atomsCreated = [mergeSpec.newAtomId];
        edgesRerouted = mergeSpec.edgeRerouting;
    }
    else {
        throw new Error('RESHAPE_SPEC_MISSING: split or merge spec required');
    }
    // Update map.spec.json: mark deprecated atoms, apply edge rerouting
    const updatedMembers = mapSpec.members.map((m) => {
        const id = m.atomId ?? m.id ?? '';
        if (atomsDeprecated.includes(id)) {
            return { ...m, status: 'deprecated' };
        }
        return m;
    });
    for (const newId of atomsCreated) {
        updatedMembers.push({ atomId: newId, status: 'active' });
    }
    const updatedEdges = mapSpec.edges.map((edge) => {
        const reroute = edgesRerouted.find((r) => r.originalFrom === edge.from && r.originalTo === edge.to);
        if (reroute) {
            return { ...edge, from: reroute.newFrom, to: reroute.newTo };
        }
        return edge;
    });
    const updatedSpec = {
        ...mapSpec,
        members: updatedMembers,
        edges: updatedEdges,
        _lastReshape: { proposalId: proposal.proposalId, appliedAt, mode }
    };
    const specPath = path.join(repositoryRoot, 'atomic_workbench', 'maps', proposal.mapId, 'map.spec.json');
    writeFileSync(specPath, JSON.stringify(updatedSpec, null, 2), 'utf-8');
    // Append to lineage-log.json
    const lineageEvent = {
        eventType: 'reshape',
        mapId: proposal.mapId,
        mode,
        timestamp: appliedAt,
        sourceAtoms: atomsDeprecated,
        resultAtoms: atomsCreated,
        proposalId: proposal.proposalId
    };
    const lineageLogPath = path.join(repositoryRoot, 'atomic_workbench', 'maps', proposal.mapId, 'lineage-log.json');
    let lineageLog = [];
    if (existsSync(lineageLogPath)) {
        try {
            lineageLog = JSON.parse(readFileSync(lineageLogPath, 'utf-8'));
        }
        catch { /* start fresh */ }
    }
    lineageLog.push(lineageEvent);
    mkdirSync(path.dirname(lineageLogPath), { recursive: true });
    writeFileSync(lineageLogPath, JSON.stringify(lineageLog, null, 2), 'utf-8');
    const finalProposal = {
        ...proposal,
        status: 'applied',
        humanReviewDecisionId,
        appliedAt,
        dryRun: false
    };
    return {
        ok: true,
        proposal: finalProposal,
        appliedAt,
        atomsDeprecated,
        atomsCreated,
        lineageEvent
    };
}
