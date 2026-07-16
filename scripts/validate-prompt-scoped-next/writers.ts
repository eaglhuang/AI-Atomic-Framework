import { writeFileSync } from 'node:fs';

export function writeTaskCard(filePath: string, taskId: string, title: string, options: { readonly status?: string; readonly relatedPlan?: string; readonly files?: string } = {}) {
  writeFileSync(filePath, `---
task_id: ${taskId}
title: ${title}
status: ${options.status ?? 'planned'}
target_repo: AI-Atomic-Framework
closure_authority: target_repo
${options.relatedPlan ? `related_plan: ${options.relatedPlan}\n` : ''}
${options.files ? `files: ${options.files}\n` : ''}
---
# ${taskId}
`, 'utf8');
}

export function writeLedgerTask(filePath: string, taskId: string, title: string, scopePath: string, options: { readonly status?: string; readonly claimActorId?: string; readonly scopePaths?: readonly string[]; readonly sourcePlanPath?: string; readonly closedAt?: string; readonly closedByActor?: string; readonly closurePacket?: string; readonly dependencies?: readonly string[]; readonly targetRepo?: string; readonly closureAuthority?: string; readonly planningRepo?: string } = {}) {
  writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title,
    status: options.status ?? 'ready',
    dependencies: options.dependencies ?? [],
    acceptance: ['bootstrap output reviewed by human gate'],
    scope: options.scopePaths ?? [scopePath],
    scopePaths: options.scopePaths ?? [scopePath],
    deliverables: options.scopePaths ?? [scopePath],
    ...(options.closurePacket ? { closurePacket: options.closurePacket } : {}),
    ...(options.closedAt ? { closedAt: options.closedAt } : {}),
    ...(options.closedByActor ? { closedByActor: options.closedByActor } : {}),
    ...(options.targetRepo ? { targetRepo: options.targetRepo } : {}),
    ...(options.closureAuthority ? { closureAuthority: options.closureAuthority } : {}),
    ...(options.planningRepo ? { planningRepo: options.planningRepo } : {}),
    ...(options.claimActorId ? {
      claim: {
        actorId: options.claimActorId,
        leaseId: `lease-${taskId.toLowerCase()}`,
        claimedAt: '2026-05-24T00:00:00.000Z',
        heartbeatAt: '2026-05-24T00:00:00.000Z',
        ttlSeconds: 1800,
        files: [scopePath],
        state: 'active'
      }
    } : {}),
    source: {
      planPath: options.sourcePlanPath ?? 'docs/plan/PlanAlpha.md',
      sectionTitle: title,
      headingLine: 1,
      hash: taskId
    }
  }, null, 2)}\n`, 'utf8');
}
