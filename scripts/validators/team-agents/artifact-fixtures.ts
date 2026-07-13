import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function listRelativeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const relative = path.relative(root, fullPath).replace(/\\/g, '/');
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        visit(fullPath);
      } else {
        files.push(relative);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

export function writeTeamRunForHandoffGate(cwd: string, taskId: string, teamRunId: string): void {
  const directory = path.join(cwd, '.atm', 'runtime', 'team-runs');
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, `${teamRunId}.json`), `${JSON.stringify({
    schemaId: 'atm.teamRun.v1',
    taskId,
    teamRunId,
    actorId: 'bound-captain',
    status: 'active',
    roles: [{ agentId: 'coordinator', role: 'coordinator', permissions: ['handoff.read', 'handoff.materialize'] }],
    permissionLeases: [
      { permission: 'handoff.read', agentId: 'coordinator', paths: ['packages/core/src/team-runtime/handoff-ledger.ts'] },
      { permission: 'handoff.materialize', agentId: 'coordinator', paths: ['packages/core/src/team-runtime/handoff-ledger.ts'] }
    ]
  }, null, 2)}\n`, 'utf8');
}

export function snapshotSourceTeamRunFiles(cwd: string): Set<string> {
  const directory = path.join(cwd, '.atm', 'runtime', 'team-runs');
  if (!existsSync(directory)) return new Set();
  return new Set(readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .map((entry) => path.join(directory, entry)));
}

export function cleanupNewSourceTeamRunFiles(cwd: string, before: Set<string>): void {
  const directory = path.join(cwd, '.atm', 'runtime', 'team-runs');
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory)) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(directory, entry);
    if (before.has(filePath)) continue;
    rmSync(filePath, { force: true });
  }
}
