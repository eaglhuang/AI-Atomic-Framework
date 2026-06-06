import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
function loadRegistry(repositoryRoot) {
    const regPath = path.join(repositoryRoot, 'atomic_workbench', 'atomic-registry.json');
    if (!existsSync(regPath))
        return { entries: {} };
    try {
        return JSON.parse(readFileSync(regPath, 'utf-8'));
    }
    catch {
        return { entries: {} };
    }
}
function saveRegistry(repositoryRoot, registry) {
    const regPath = path.join(repositoryRoot, 'atomic_workbench', 'atomic-registry.json');
    mkdirSync(path.dirname(regPath), { recursive: true });
    writeFileSync(regPath, JSON.stringify(registry, null, 2), 'utf-8');
}
function findDownstreamRefs(repositoryRoot, atomId) {
    const refs = [];
    // Check map spec files
    const mapsDir = path.join(repositoryRoot, 'atomic_workbench', 'maps');
    if (existsSync(mapsDir)) {
        try {
            const { readdirSync } = require_fs();
            for (const mapId of readdirSync(mapsDir)) {
                const specPath = path.join(mapsDir, mapId, 'map.spec.json');
                if (!existsSync(specPath))
                    continue;
                try {
                    const spec = JSON.parse(readFileSync(specPath, 'utf-8'));
                    const members = spec.members ?? [];
                    for (const member of members) {
                        const id = member.atomId ?? member.id ?? '';
                        if (id === atomId && member.status !== 'deprecated' && member.status !== 'legacy-retired') {
                            refs.push({ refType: 'map-spec', sourceFile: specPath, mapId });
                        }
                    }
                }
                catch { /* skip */ }
            }
        }
        catch { /* skip */ }
    }
    // Check capsule registry
    const capsuleRegPath = path.join(repositoryRoot, 'vendor', 'capsule-registry.json');
    if (existsSync(capsuleRegPath)) {
        try {
            const reg = JSON.parse(readFileSync(capsuleRegPath, 'utf-8'));
            const entries = reg.entries ?? {};
            for (const [entryId, entry] of Object.entries(entries)) {
                if (entryId === atomId || entry.atomId === atomId) {
                    refs.push({ refType: 'capsule-registry', sourceFile: capsuleRegPath });
                }
            }
        }
        catch { /* skip */ }
    }
    return refs;
}
function require_fs() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:fs');
}
function getAtomCurrentStage(repositoryRoot, atomId) {
    const registry = loadRegistry(repositoryRoot);
    const entry = registry.entries[atomId];
    if (!entry)
        return undefined;
    const status = String(entry.status ?? 'active');
    if (status === 'deprecated')
        return 'deprecated';
    if (status === 'shadow-off')
        return 'shadow-off';
    if (status === 'legacy-retired')
        return 'legacy-retired';
    return undefined;
}
export function proposeRetire(repositoryRoot, atomId, options = {}) {
    const blockedReasons = [];
    const currentStage = getAtomCurrentStage(repositoryRoot, atomId);
    if (currentStage === 'legacy-retired') {
        return {
            ok: false,
            blockedReasons: [`atom "${atomId}" is already legacy-retired`],
            atomId,
            stage: 'legacy-retired',
            activeDownstreamRefs: []
        };
    }
    const activeDownstreamRefs = findDownstreamRefs(repositoryRoot, atomId);
    if (activeDownstreamRefs.length > 0) {
        blockedReasons.push(`atom "${atomId}" has ${activeDownstreamRefs.length} active downstream reference(s); resolve before retiring`);
        for (const ref of activeDownstreamRefs) {
            blockedReasons.push(`  - ${ref.refType} in ${ref.sourceFile}${ref.mapId ? ` (map: ${ref.mapId})` : ''}`);
        }
    }
    const targetStage = currentStage === 'shadow-off' && options.shadowOffConfirmed
        ? 'legacy-retired'
        : currentStage === 'deprecated'
            ? 'shadow-off'
            : 'deprecated';
    let proof;
    if (targetStage === 'legacy-retired' && blockedReasons.length === 0) {
        const proofId = createHash('sha256')
            .update(`${atomId}:${new Date().toISOString()}`)
            .digest('base64url')
            .slice(0, 12);
        proof = {
            schemaId: 'atm.atomRetirementProof',
            proofId,
            atomId,
            retiredAt: new Date().toISOString(),
            retiredBy: options.retiredBy ?? process.env.AGENT_IDENTITY ?? 'atm',
            stage: 'legacy-retired',
            activeDownstreamRefs: [],
            callerRiskCleared: true,
            shadowOffConfirmed: options.shadowOffConfirmed ?? false,
            verificationStatus: 'passed',
            lineageRef: `lineage-log.${atomId}.legacy-retired.${proofId}`
        };
    }
    return {
        ok: blockedReasons.length === 0,
        blockedReasons,
        atomId,
        stage: targetStage,
        activeDownstreamRefs,
        proof
    };
}
export function applyRetire(repositoryRoot, atomId, targetStage, proof) {
    const registry = loadRegistry(repositoryRoot);
    const entry = registry.entries[atomId];
    const previousStage = entry?.status ?? 'active';
    if (!entry) {
        registry.entries[atomId] = { atomId, status: targetStage };
    }
    else {
        registry.entries[atomId] = { ...entry, status: targetStage };
    }
    if (targetStage === 'legacy-retired' && proof) {
        registry.entries[atomId].retirementProofId = proof.proofId;
        registry.entries[atomId].retiredAt = proof.retiredAt;
    }
    saveRegistry(repositoryRoot, registry);
    // Write retirement proof if final stage
    if (targetStage === 'legacy-retired' && proof) {
        const proofsDir = path.join(repositoryRoot, '.atm', 'history', 'retirement-proofs');
        mkdirSync(proofsDir, { recursive: true });
        writeFileSync(path.join(proofsDir, `${atomId}.retirement-proof.json`), JSON.stringify(proof, null, 2), 'utf-8');
    }
    // Append to lineage-log
    const lineageEvent = {
        eventType: 'atom-retire',
        atomId,
        previousStage,
        newStage: targetStage,
        timestamp: new Date().toISOString(),
        proofId: proof?.proofId
    };
    const lineageLogPath = path.join(repositoryRoot, '.atm', 'history', 'atom-retirement-lineage.jsonl');
    mkdirSync(path.dirname(lineageLogPath), { recursive: true });
    const line = JSON.stringify(lineageEvent) + '\n';
    const { appendFileSync } = require_fs();
    appendFileSync(lineageLogPath, line, 'utf-8');
    return {
        ok: true,
        atomId,
        previousStage,
        newStage: targetStage,
        proof,
        lineageEvent
    };
}
