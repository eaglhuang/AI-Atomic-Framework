import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
export function writeTakeoverEvidence(cwd, taskId, actorId, previousClaim, newClaim) {
    const evidencePath = path.join(cwd, '.atm', 'history', 'evidence', `${taskId}.json`);
    mkdirSync(path.dirname(evidencePath), { recursive: true });
    const current = existsSync(evidencePath)
        ? JSON.parse(readFileSync(evidencePath, 'utf8'))
        : {};
    const evidenceArray = Array.isArray(current.evidence) ? current.evidence : [];
    evidenceArray.push({
        evidenceKind: 'validation',
        summary: `Takeover recorded for ${taskId}: ${previousClaim.actorId} -> ${actorId}.`,
        artifactPaths: [`.atm/history/tasks/${taskId}.json`],
        producedBy: actorId,
        createdAt: new Date().toISOString(),
        details: {
            action: 'takeover',
            previousClaim,
            newClaim
        }
    });
    const envelope = {
        ...current,
        taskId,
        updatedAt: new Date().toISOString(),
        evidence: evidenceArray
    };
    writeFileSync(evidencePath, `${JSON.stringify(envelope, null, 2)}\n`, 'utf8');
}
