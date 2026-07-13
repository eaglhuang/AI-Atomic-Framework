import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export interface CrossTaskMutationBlock {
  readonly conflictTaskId: string;
  readonly conflictFiles: readonly string[];
  readonly commandFamily: string;
  readonly recoveryLane: string;
  readonly conflicts: readonly CrossTaskMutationConflict[];
}

export interface CrossTaskMutationConflict {
  readonly conflictTaskId: string;
  readonly conflictFiles: readonly string[];
  readonly owner: string;
  readonly surface: 'task-history' | 'active-task-scope';
}

export interface ActiveTaskInfo {
  readonly taskId: string;
  readonly owner: string;
  readonly allowedFiles: readonly string[];
}

interface GitMutationEntry {
  readonly file: string;
  readonly staged: boolean;
  readonly unstaged: boolean;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function globLikeMatch(filePath: string, pattern: string): boolean {
  const fileNorm = normalizeRelativePath(filePath).toLowerCase();
  const patNorm = normalizeRelativePath(pattern).toLowerCase();
  
  if (patNorm.endsWith('/**')) {
    const prefix = patNorm.slice(0, -3);
    return fileNorm === prefix || fileNorm.startsWith(prefix + '/');
  }
  if (patNorm.endsWith('/*')) {
    const prefix = patNorm.slice(0, -2);
    if (fileNorm.startsWith(prefix + '/')) {
      const remaining = fileNorm.slice(prefix.length + 1);
      return !remaining.includes('/');
    }
    return false;
  }
  if (patNorm.endsWith('.*')) {
    const prefix = patNorm.slice(0, -2);
    if (fileNorm.startsWith(prefix + '.')) {
      const remaining = fileNorm.slice(prefix.length + 1);
      return !remaining.includes('/');
    }
    return false;
  }
  return fileNorm === patNorm;
}

function parseYamlList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('-')) {
          return trimmed.slice(1).trim();
        }
        return trimmed;
      })
      .filter(Boolean);
  }
  return [];
}

function shouldIncludeUnstaged(commandFamily: string): boolean {
  return /\b(?:restore|reset|remove|rm|clean|delete)\b/i.test(commandFamily);
}

function isKnownTaskId(cwd: string, taskId: string): boolean {
  return existsSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`));
}

function collectTaskFileValues(value: unknown, target: Set<string>) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string' && item.trim()) {
        target.add(normalizeRelativePath(item));
      }
    }
  } else if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      collectTaskFileValues(obj[key], target);
    }
  } else if (typeof value === 'string') {
    target.add(normalizeRelativePath(value));
  }
}

export function getActiveTasks(cwd: string): readonly ActiveTaskInfo[] {
  const tasksDir = path.join(cwd, '.atm', 'history', 'tasks');
  if (!existsSync(tasksDir)) return [];
  
  const activeTasks: ActiveTaskInfo[] = [];
  try {
    const files = readdirSync(tasksDir);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(tasksDir, file);
      try {
        const content = readFileSync(filePath, 'utf8');
        const doc = JSON.parse(content);
        const taskId = doc.workItemId || doc.taskId || file.replace(/\.json$/, '');
        const status = doc.status;
        const claim = doc.claim && typeof doc.claim === 'object' && !Array.isArray(doc.claim)
          ? doc.claim as Record<string, unknown>
          : null;
        const claimState = claim?.state;
        const owner = claim?.actorId || doc.owner || '';
        
        if (status === 'open' || claimState === 'active') {
          const allowedPathsSet = new Set<string>();
          collectTaskFileValues(doc.scopePaths, allowedPathsSet);
          collectTaskFileValues(doc.deliverables, allowedPathsSet);
          collectTaskFileValues(doc.targetAllowedFiles, allowedPathsSet);
          collectTaskFileValues(doc.planningMirrorPaths, allowedPathsSet);
          
          if (claim) {
            collectTaskFileValues(claim.files, allowedPathsSet);
          }
          const taskDirectionLock = doc.taskDirectionLock;
          if (taskDirectionLock && typeof taskDirectionLock === 'object' && !Array.isArray(taskDirectionLock)) {
            collectTaskFileValues((taskDirectionLock as Record<string, unknown>).allowedFiles, allowedPathsSet);
          }
          const targetWork = doc.targetWork;
          if (targetWork && typeof targetWork === 'object' && !Array.isArray(targetWork)) {
            collectTaskFileValues((targetWork as Record<string, unknown>).allowedFiles, allowedPathsSet);
          }
          
          activeTasks.push({
            taskId: String(taskId).toUpperCase(),
            owner: String(owner),
            allowedFiles: Array.from(allowedPathsSet)
          });
        }
      } catch {
        // ignore malformed task files
      }
    }
  } catch {
    // ignore directory read errors
  }
  return activeTasks;
}

export function detectCrossTaskMutation(
  cwd: string,
  currentTaskId: string | null,
  commandFamily: string
): CrossTaskMutationBlock | null {
  const normCurrentTaskId = currentTaskId?.trim().toUpperCase() ?? null;
  const activeTasks = getActiveTasks(cwd);
  const currentTask = normCurrentTaskId
    ? activeTasks.find((task) => task.taskId === normCurrentTaskId) ?? null
    : null;
  
  const includeUnstaged = shouldIncludeUnstaged(commandFamily);
  let modifiedFiles: string[] = [];
  try {
    const gitExec = process.env.ATM_GIT_EXECUTABLE || 'git';
    const nameStatusOutput = execFileSync(
      gitExec,
      ['-C', cwd, 'status', '--porcelain'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const mutationEntries: GitMutationEntry[] = nameStatusOutput
      .split('\n')
      .map((line) => {
        if (line.length < 4) return '';
        const stagedCode = line[0] ?? ' ';
        const unstagedCode = line[1] ?? ' ';
        const pathPart = line.slice(3).trim();
        const renameMatch = pathPart.match(/^(.+) -> (.+)$/);
        const file = renameMatch ? renameMatch[2] : pathPart;
        return {
          file: normalizeRelativePath(file),
          staged: stagedCode !== ' ' && stagedCode !== '?',
          unstaged: unstagedCode !== ' ' || stagedCode === '?'
        };
      })
      .filter((entry): entry is GitMutationEntry => typeof entry !== 'string' && Boolean(entry.file));
    modifiedFiles = mutationEntries
      .filter((entry) => entry.staged || (includeUnstaged && entry.unstaged))
      .map((entry) => entry.file);
  } catch {
    // Git not available or not a repo
    return null;
  }
  
  const conflicts = new Map<string, CrossTaskMutationConflict>();
  const addConflict = (conflict: CrossTaskMutationConflict) => {
    const key = `${conflict.conflictTaskId}\0${conflict.surface}\0${conflict.owner}`;
    const existing = conflicts.get(key);
    if (!existing) {
      conflicts.set(key, conflict);
      return;
    }
    conflicts.set(key, {
      ...existing,
      conflictFiles: Array.from(new Set([...existing.conflictFiles, ...conflict.conflictFiles])).sort()
    });
  };

  for (const file of modifiedFiles) {
    const evidenceMatch = file.match(/^\.atm\/history\/(?:evidence|task-events|tasks)\/([^/.]+)/i);
    let taskHistoryConflict = false;
    if (evidenceMatch) {
      const ownerTaskId = evidenceMatch[1].toUpperCase();
      if (isKnownTaskId(cwd, ownerTaskId) && normCurrentTaskId !== ownerTaskId) {
        taskHistoryConflict = true;
        addConflict({
          conflictTaskId: ownerTaskId,
          conflictFiles: [file],
          owner: ownerTaskId,
          surface: 'task-history'
        });
      }
    }
    if (taskHistoryConflict) continue;

    const currentTaskOwnsFile = currentTask?.allowedFiles.some((pattern) => globLikeMatch(file, pattern)) ?? false;
    for (const task of activeTasks) {
      if (task.taskId === normCurrentTaskId) continue;
      if (currentTaskOwnsFile) continue;
      const isMatch = task.allowedFiles.some((pattern) => globLikeMatch(file, pattern));
      if (isMatch) {
        addConflict({
          conflictTaskId: task.taskId,
          conflictFiles: [file],
          owner: task.owner,
          surface: 'active-task-scope'
        });
      }
    }
  }

  if (conflicts.size > 0) {
    const orderedConflicts = Array.from(conflicts.values()).sort((left, right) => left.conflictTaskId.localeCompare(right.conflictTaskId));
    return {
      conflictTaskId: orderedConflicts[0].conflictTaskId,
      conflictFiles: Array.from(new Set(orderedConflicts.flatMap((conflict) => conflict.conflictFiles))).sort(),
      commandFamily,
      recoveryLane: 'Stop write-path work, inspect the named task owners, and use task handoff, release, or repair-claim before mutating these files.',
      conflicts: orderedConflicts
    };
  }

  return null;
}

export function recordIncidentFlag(cwd: string, block: CrossTaskMutationBlock): void {
  const incidentsDir = path.join(cwd, '.atm', 'runtime', 'incidents');
  try {
    mkdirSync(incidentsDir, { recursive: true });
    
    const incidentPath = path.join(incidentsDir, `${Date.now()}-${block.conflictTaskId}-incident.json`);
    writeFileSync(
      incidentPath,
      JSON.stringify(
        {
          schemaId: 'atm.incidentReport.v1',
          timestamp: new Date().toISOString(),
          block
        },
        null,
        2
      ),
      'utf8'
    );
  } catch {
    // ignore write errors
  }
}

export function readIncidentFlag(cwd: string): CrossTaskMutationBlock | null {
  const incidentsDir = path.join(cwd, '.atm', 'runtime', 'incidents');
  if (!existsSync(incidentsDir)) return null;
  try {
    const files = readdirSync(incidentsDir);
    if (files.length === 0) return null;
    // Read the latest incident
    const sorted = files.filter(f => f.endsWith('.json')).sort();
    if (sorted.length === 0) return null;
    const latestFile = sorted[sorted.length - 1];
    const content = readFileSync(path.join(incidentsDir, latestFile), 'utf8');
    const parsed = JSON.parse(content);
    return parsed.block || null;
  } catch {
    return null;
  }
}

export function clearIncidentFlags(cwd: string): void {
  const incidentsDir = path.join(cwd, '.atm', 'runtime', 'incidents');
  if (!existsSync(incidentsDir)) return;
  try {
    const files = readdirSync(incidentsDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        unlinkSync(path.join(incidentsDir, file));
      }
    }
  } catch {
    // ignore
  }
}
