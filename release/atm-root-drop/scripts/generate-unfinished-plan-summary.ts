import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  coerceStatus,
  extractFrontMatter,
  normalizeTaskId,
  parseMarkdownTableCells
} from '../packages/cli/src/commands/tasks/task-import-validators.ts';

type NormalizedTaskStatus = ReturnType<typeof coerceStatus>;

interface Options {
  readonly planningRoot: string;
  readonly handoffPath: string | null;
  readonly outPath: string;
  readonly overlayPath: string | null;
}

interface TaskCardEntry {
  readonly taskId: string;
  readonly title: string;
  readonly rawStatus: string;
  readonly normalizedStatus: NormalizedTaskStatus;
  readonly laneKey: string;
  readonly laneTitle: string;
  readonly filePath: string;
  readonly planningRepo: string | null;
  readonly targetRepo: string | null;
  readonly relatedPlan: string | null;
}

interface ReadmeRowEntry {
  readonly taskId: string;
  readonly laneKey: string;
  readonly laneTitle: string;
  readonly sourcePath: string;
  readonly rawStatus: string | null;
  readonly title: string | null;
  readonly notes: string | null;
  readonly rowKind: 'roster' | 'future-queue' | 'other';
  readonly relatedPlan: string | null;
}

interface LaneSummary {
  readonly laneKey: string;
  readonly laneTitle: string;
  readonly taskCards: readonly TaskCardEntry[];
  readonly readmeOnly: readonly ReadmeRowEntry[];
  readonly overlayItems: readonly OverlayEntry[];
}

interface LaneMetadata {
  readonly laneKey: string;
  readonly laneTitle: string;
  readonly relatedPlan: string | null;
}

interface OverlayEntry {
  readonly taskId: string;
  readonly laneKey: string;
  readonly laneTitle: string;
  readonly status: string | null;
  readonly title: string | null;
  readonly relatedPlan: string | null;
  readonly gapType: string | null;
  readonly notes: string | null;
  readonly sourceThreadId: string | null;
  readonly sourceThreadTitle: string | null;
}

interface OverlaySource {
  readonly threadId: string;
  readonly title: string;
  readonly status: string;
  readonly unfinishedTaskIds: readonly string[];
  readonly note: string | null;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultPlanningRoot = path.resolve(repoRoot, '..', '3KLife', 'docs', 'ai_atomic_framework');
const defaultHandoffPath = path.resolve(repoRoot, '.atm-temp', 'captain-dispatch-mailbox', 'captain', 'handoff', 'latest-handoff.md');
const defaultOutPath = path.resolve(repoRoot, '.atm-temp', 'reports', 'unfinished-plan-summary.md');
const defaultOverlayPath = path.resolve(repoRoot, '.atm-temp', 'reports', 'unfinished-plan-overlay.json');

function parseArgs(argv: readonly string[]): Options {
  let planningRoot = defaultPlanningRoot;
  let handoffPath: string | null = defaultHandoffPath;
  let outPath = defaultOutPath;
  let overlayPath: string | null = defaultOverlayPath;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--planning-root') {
      planningRoot = requireValue(argv, ++index, '--planning-root');
    } else if (arg === '--handoff') {
      handoffPath = requireValue(argv, ++index, '--handoff');
    } else if (arg === '--no-handoff') {
      handoffPath = null;
    } else if (arg === '--out') {
      outPath = requireValue(argv, ++index, '--out');
    } else if (arg === '--overlay') {
      overlayPath = requireValue(argv, ++index, '--overlay');
    } else if (arg === '--no-overlay') {
      overlayPath = null;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    planningRoot: path.resolve(planningRoot),
    handoffPath: handoffPath ? path.resolve(handoffPath) : null,
    outPath: path.resolve(outPath),
    overlayPath: overlayPath ? path.resolve(overlayPath) : null
  };
}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function walkFiles(root: string): string[] {
  const results: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }
  return results.sort((left, right) => left.localeCompare(right));
}

function cleanText(value: string): string {
  return value.replace(/\uFFFD/g, '?').replace(/\s+/g, ' ').trim();
}

function firstHeading(markdown: string): string | null {
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^#\s+(.+)$/.exec(line.trim());
    if (match) return cleanText(match[1]);
  }
  return null;
}

function laneKeyFromPath(filePath: string): string {
  const tasksDir = path.dirname(filePath);
  return path.basename(path.dirname(tasksDir));
}

function parseTaskCard(filePath: string, laneMetadataByKey: ReadonlyMap<string, LaneMetadata>): TaskCardEntry | null {
  const raw = readFileSync(filePath, 'utf8');
  const frontMatter = extractFrontMatter(raw);
  if (!frontMatter) return null;

  const rawTaskId = typeof frontMatter.data.task_id === 'string'
    ? frontMatter.data.task_id
    : typeof frontMatter.data.id === 'string'
      ? frontMatter.data.id
      : null;
  if (!rawTaskId) return null;

  const laneKey = laneKeyFromPath(filePath);
  const laneMetadata = laneMetadataByKey.get(laneKey);
  const rawStatus = typeof frontMatter.data.status === 'string' ? cleanText(frontMatter.data.status) : 'planned';

  return {
    taskId: normalizeTaskId(rawTaskId),
    title: typeof frontMatter.data.title === 'string' ? cleanText(frontMatter.data.title) : normalizeTaskId(rawTaskId),
    rawStatus,
    normalizedStatus: coerceStatus(rawStatus),
    laneKey,
    laneTitle: laneMetadata?.laneTitle ?? laneKey,
    filePath,
    planningRepo: typeof frontMatter.data.planning_repo === 'string' ? cleanText(frontMatter.data.planning_repo) : null,
    targetRepo: typeof frontMatter.data.target_repo === 'string' ? cleanText(frontMatter.data.target_repo) : null,
    relatedPlan: typeof frontMatter.data.related_plan === 'string'
      ? cleanText(frontMatter.data.related_plan)
      : laneMetadata?.relatedPlan ?? null
  };
}

function parseReadmeTables(filePath: string, laneMetadataByKey: ReadonlyMap<string, LaneMetadata>): ReadmeRowEntry[] {
  const markdown = readFileSync(filePath, 'utf8');
  const frontMatter = extractFrontMatter(markdown);
  const lines = markdown.split(/\r?\n/);
  const laneKey = laneKeyFromPath(filePath);
  const laneMetadata = laneMetadataByKey.get(laneKey);
  const laneTitle = laneMetadata?.laneTitle ?? firstHeading(markdown) ?? laneKey;
  const relatedPlan = typeof frontMatter?.data.related_plan === 'string'
    ? cleanText(frontMatter.data.related_plan)
    : laneMetadata?.relatedPlan ?? null;
  const rows: ReadmeRowEntry[] = [];
  let currentSection = '';

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const sectionMatch = /^##\s+(.+)$/.exec(trimmed);
    if (sectionMatch) {
      currentSection = cleanText(sectionMatch[1]);
      continue;
    }

    if (!trimmed.startsWith('|')) continue;
    const separator = lines[index + 1]?.trim() ?? '';
    if (!/^\|(?:\s*:?-+:?\s*\|)+$/.test(separator)) continue;

    const headers = parseMarkdownTableCells(trimmed).map((cell) => cleanText(cell).toLowerCase());
    const taskIdColumn = headers.findIndex((cell) => cell === 'task id' || cell === 'future task id');
    if (taskIdColumn === -1) continue;
    const statusColumn = headers.findIndex((cell) => cell === 'status');
    const titleColumn = headers.findIndex((cell) => cell === 'title' || cell === 'planned title');
    const notesColumn = headers.findIndex((cell) => cell === 'notes' || cell === 'reason');
    const lowerSection = currentSection.toLowerCase();
    const rowKind = lowerSection.includes('future queue')
      ? 'future-queue'
      : lowerSection.includes('task roster') || lowerSection.includes('pilot cards') || lowerSection.includes('formal cards')
        ? 'roster'
        : 'other';

    index += 2;
    while (index < lines.length) {
      const rowLine = lines[index].trim();
      if (!rowLine.startsWith('|')) {
        index -= 1;
        break;
      }
      if (/^\|(?:\s*:?-+:?\s*\|)+$/.test(rowLine)) {
        index += 1;
        continue;
      }

      const cells = parseMarkdownTableCells(rowLine).map((cell) => cleanText(cell));
      const taskIdMatch = /(?:TASK|ATM)-[A-Z0-9]+-\d{4,5}/i.exec(cells[taskIdColumn] ?? rowLine);
      if (taskIdMatch) {
        rows.push({
          taskId: normalizeTaskId(taskIdMatch[0]),
          laneKey,
          laneTitle,
          sourcePath: filePath,
          rawStatus: statusColumn >= 0 ? cells[statusColumn] || null : null,
          title: titleColumn >= 0 ? cells[titleColumn] || null : null,
          notes: notesColumn >= 0 ? cells[notesColumn] || null : null,
          rowKind,
          relatedPlan
        });
      }
      index += 1;
    }
  }

  return rows;
}

function buildLaneMetadata(planningRoot: string): Map<string, LaneMetadata> {
  const metadata = new Map<string, LaneMetadata>();
  for (const filePath of walkFiles(planningRoot)) {
    if (path.basename(filePath).toLowerCase() !== 'readme.md') continue;
    if (path.basename(path.dirname(filePath)).toLowerCase() !== 'tasks') continue;
    const markdown = readFileSync(filePath, 'utf8');
    const frontMatter = extractFrontMatter(markdown);
    const laneKey = laneKeyFromPath(filePath);
    metadata.set(laneKey, {
      laneKey,
      laneTitle: firstHeading(markdown) ?? laneKey,
      relatedPlan: typeof frontMatter?.data.related_plan === 'string'
        ? cleanText(frontMatter.data.related_plan)
        : null
    });
  }
  return metadata;
}

function isCompletedStatus(normalizedStatus: NormalizedTaskStatus): boolean {
  return normalizedStatus === 'done';
}

function statusWeight(status: string): number {
  switch (status.toLowerCase()) {
    case 'blocked': return 0;
    case 'review': return 1;
    case 'running': return 2;
    case 'in_progress': return 3;
    case 'ready': return 4;
    case 'reserved': return 5;
    case 'open': return 6;
    case 'draft': return 7;
    case 'planned': return 8;
    default: return 9;
  }
}

function compareTaskCards(left: TaskCardEntry, right: TaskCardEntry): number {
  const statusDelta = statusWeight(left.rawStatus) - statusWeight(right.rawStatus);
  if (statusDelta !== 0) return statusDelta;
  return left.taskId.localeCompare(right.taskId);
}

function compareReadmeRows(left: ReadmeRowEntry, right: ReadmeRowEntry): number {
  const leftStatus = left.rawStatus ?? 'planned';
  const rightStatus = right.rawStatus ?? 'planned';
  const statusDelta = statusWeight(leftStatus) - statusWeight(rightStatus);
  if (statusDelta !== 0) return statusDelta;
  return left.taskId.localeCompare(right.taskId);
}

function extractTaskIds(text: string): string[] {
  const matches = text.match(/(?:TASK|ATM)-[A-Z0-9]+-\d{4,5}/gi) ?? [];
  return [...new Set(matches.map((match) => normalizeTaskId(match)))];
}

function buildLaneSummariesWithOverlay(
  taskCards: readonly TaskCardEntry[],
  readmeRows: readonly ReadmeRowEntry[],
  overlayEntries: readonly OverlayEntry[]
): LaneSummary[] {
  const taskMap = new Map<string, TaskCardEntry[]>();
  for (const task of taskCards) {
    const bucket = taskMap.get(task.laneKey) ?? [];
    bucket.push(task);
    taskMap.set(task.laneKey, bucket);
  }

  const readmeMap = new Map<string, ReadmeRowEntry[]>();
  for (const row of readmeRows) {
    const bucket = readmeMap.get(row.laneKey) ?? [];
    bucket.push(row);
    readmeMap.set(row.laneKey, bucket);
  }

  const overlayMap = new Map<string, OverlayEntry[]>();
  for (const entry of overlayEntries) {
    const bucket = overlayMap.get(entry.laneKey) ?? [];
    bucket.push(entry);
    overlayMap.set(entry.laneKey, bucket);
  }

  const laneKeys = [...new Set([...taskMap.keys(), ...readmeMap.keys(), ...overlayMap.keys()])].sort((left, right) => left.localeCompare(right));
  return laneKeys.map((laneKey) => {
    const laneTasks = (taskMap.get(laneKey) ?? []).slice().sort(compareTaskCards);
    const laneReadme = (readmeMap.get(laneKey) ?? [])
      .filter((row) => !laneTasks.some((task) => task.taskId === row.taskId))
      .slice()
      .sort(compareReadmeRows);
    const laneOverlay = (overlayMap.get(laneKey) ?? []).slice().sort((left, right) => left.taskId.localeCompare(right.taskId));
    const laneTitle = laneTasks[0]?.laneTitle ?? laneReadme[0]?.laneTitle ?? laneOverlay[0]?.laneTitle ?? laneKey;
    return {
      laneKey,
      laneTitle,
      taskCards: laneTasks,
      readmeOnly: laneReadme,
      overlayItems: laneOverlay
    };
  });
}

function loadOverlay(overlayPath: string | null): { entries: OverlayEntry[]; sources: OverlaySource[] } {
  if (!overlayPath || !existsSync(overlayPath)) return { entries: [], sources: [] };
  const parsed = JSON.parse(readFileSync(overlayPath, 'utf8')) as { entries?: unknown; sources?: unknown };
  const rawEntries = Array.isArray(parsed.entries) ? parsed.entries : [];
  const rawSources = Array.isArray(parsed.sources) ? parsed.sources : [];

  const entries = rawEntries.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    const rawTaskId = typeof record.taskId === 'string' ? record.taskId : typeof record.task_id === 'string' ? record.task_id : null;
    const laneKey = typeof record.laneKey === 'string' ? cleanText(record.laneKey) : null;
    if (!rawTaskId || !laneKey) return [];
    return [{
      taskId: normalizeTaskId(rawTaskId),
      laneKey,
      laneTitle: typeof record.laneTitle === 'string' ? cleanText(record.laneTitle) : laneKey,
      status: typeof record.status === 'string' ? cleanText(record.status) : null,
      title: typeof record.title === 'string' ? cleanText(record.title) : null,
      relatedPlan: typeof record.relatedPlan === 'string' ? cleanText(record.relatedPlan) : null,
      gapType: typeof record.gapType === 'string' ? cleanText(record.gapType) : null,
      notes: typeof record.notes === 'string' ? cleanText(record.notes) : null,
      sourceThreadId: typeof record.sourceThreadId === 'string' ? cleanText(record.sourceThreadId) : null,
      sourceThreadTitle: typeof record.sourceThreadTitle === 'string' ? cleanText(record.sourceThreadTitle) : null
    } satisfies OverlayEntry];
  });

  const sources = rawSources.flatMap((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
    const record = raw as Record<string, unknown>;
    if (typeof record.threadId !== 'string' || typeof record.title !== 'string' || typeof record.status !== 'string') return [];
    return [{
      threadId: cleanText(record.threadId),
      title: cleanText(record.title),
      status: cleanText(record.status),
      unfinishedTaskIds: Array.isArray(record.unfinishedTaskIds)
        ? record.unfinishedTaskIds.filter((item): item is string => typeof item === 'string').map((item) => normalizeTaskId(item))
        : [],
      note: typeof record.note === 'string' ? cleanText(record.note) : null
    } satisfies OverlaySource];
  });

  return { entries, sources };
}

function buildOverlaySourceSummaries(lanes: readonly LaneSummary[], overlaySources: readonly OverlaySource[]): Array<{
  readonly label: string;
  readonly status: string;
  readonly taskIds: readonly string[];
  readonly note: string | null;
}> {
  if (overlaySources.length > 0) {
    return overlaySources.map((source) => ({
      label: source.title,
      status: source.status,
      taskIds: source.unfinishedTaskIds,
      note: source.note
    }));
  }

  const summaryMap = new Map<string, { label: string; taskIds: Set<string> }>();
  for (const lane of lanes) {
    for (const item of lane.overlayItems) {
      const label = item.sourceThreadTitle ?? item.sourceThreadId ?? '未命名 thread';
      const bucket = summaryMap.get(label) ?? { label, taskIds: new Set<string>() };
      bucket.taskIds.add(item.taskId);
      summaryMap.set(label, bucket);
    }
  }

  return [...summaryMap.values()].map((entry) => ({
    label: entry.label,
    status: 'included',
    taskIds: [...entry.taskIds].sort((left, right) => left.localeCompare(right)),
    note: null
  }));
}

function renderMarkdown(
  options: Options,
  lanes: readonly LaneSummary[],
  handoffTaskIds: readonly string[],
  overlaySources: readonly OverlaySource[]
): string {
  const generatedAt = new Date().toISOString();
  const unfinishedTaskCount = lanes.reduce((sum, lane) => sum + lane.taskCards.length, 0);
  const readmeOnlyCount = lanes.reduce((sum, lane) => sum + lane.readmeOnly.length, 0);
  const overlayCount = lanes.reduce((sum, lane) => sum + lane.overlayItems.length, 0);
  const activeLaneCount = lanes.filter((lane) => lane.taskCards.length > 0 || lane.readmeOnly.length > 0 || lane.overlayItems.length > 0).length;
  const topLanes = lanes
    .filter((lane) => lane.taskCards.length > 0 || lane.readmeOnly.length > 0 || lane.overlayItems.length > 0)
    .slice()
    .sort((left, right) => {
      const rightScore = right.overlayItems.length * 100 + right.taskCards.length * 10 + right.readmeOnly.length;
      const leftScore = left.overlayItems.length * 100 + left.taskCards.length * 10 + left.readmeOnly.length;
      if (rightScore !== leftScore) return rightScore - leftScore;
      return formatLaneLabel(left).localeCompare(formatLaneLabel(right));
    })
    .slice(0, 8);
  const overlaySourceSummaries = buildOverlaySourceSummaries(lanes, overlaySources);

  const lines: string[] = [
    '# 未完成計畫總表',
    '',
    `- 產生時間：${generatedAt}`,
    `- Planning root：${options.planningRoot}`,
    `- Captain handoff：${options.handoffPath ?? 'disabled'}`,
    `- Overlay：${options.overlayPath ?? 'disabled'}`,
    `- 未完成正式 task card：${unfinishedTaskCount}`,
    `- README / 索引已列但尚未 materialize：${readmeOnlyCount}`,
    `- Captain thread overlay 補充項：${overlayCount}`,
    `- 有未完成訊號的 lane：${activeLaneCount}`,
    '',
    '## 隊長摘要',
    ''
  ];

  if (topLanes.length === 0) {
    lines.push('- 目前沒有掃到未完成 lane。');
  } else {
    for (const lane of topLanes) {
      lines.push(`- ${formatLaneLabel(lane)}：正式卡 ${lane.taskCards.length}、README-only ${lane.readmeOnly.length}、overlay ${lane.overlayItems.length}`);
    }
  }

  if (handoffTaskIds.length > 0) {
    lines.push('', '## Captain Handoff Task IDs', '');
    for (const taskId of handoffTaskIds) {
      lines.push(`- ${taskId}`);
    }
  }

  if (overlaySourceSummaries.length > 0) {
    lines.push('', '## Overlay 來源摘要', '', '| Source Thread | Status | Task IDs | Note |', '|---|---|---|---|');
    for (const source of overlaySourceSummaries) {
      lines.push(`| ${escapeTable(source.label)} | ${source.status} | ${escapeTable(source.taskIds.join(', '))} | ${escapeTable(source.note ?? '')} |`);
    }
  }

  lines.push('', '## 總覽', '', '| Lane | 正式未完成 task card | README-only / 尚未 materialize | Overlay |', '|---|---:|---:|---:|');
  for (const lane of lanes) {
    if (lane.taskCards.length === 0 && lane.readmeOnly.length === 0 && lane.overlayItems.length === 0) continue;
    lines.push(`| ${formatLaneLabel(lane)} | ${lane.taskCards.length} | ${lane.readmeOnly.length} | ${lane.overlayItems.length} |`);
  }

  for (const lane of lanes) {
    if (lane.taskCards.length === 0 && lane.readmeOnly.length === 0 && lane.overlayItems.length === 0) continue;
    lines.push('', `## ${formatLaneLabel(lane)}`, '');

    if (lane.taskCards.length > 0) {
      lines.push('| Task ID | Status | Title | Plan | Planning Repo | Target Repo | Source |', '|---|---|---|---|---|---|---|');
      for (const task of lane.taskCards) {
        lines.push(
          `| ${task.taskId} | ${task.rawStatus} | ${escapeTable(task.title)} | ${escapeTable(task.relatedPlan ?? '')} | ${task.planningRepo ?? ''} | ${task.targetRepo ?? ''} | ${escapeTable(relativeToRepo(task.filePath))} |`
        );
      }
    }

    if (lane.readmeOnly.length > 0) {
      lines.push('', '### 索引有列，但目前沒有正式 task card', '', '| Task ID | Status | Title | Plan | Notes | Source |', '|---|---|---|---|---|---|');
      for (const row of lane.readmeOnly) {
        lines.push(
          `| ${row.taskId} | ${row.rawStatus ?? 'n/a'} | ${escapeTable(row.title ?? '')} | ${escapeTable(row.relatedPlan ?? '')} | ${escapeTable(row.notes ?? '')} | ${escapeTable(relativeToRepo(row.sourcePath))} |`
        );
      }
    }

    if (lane.overlayItems.length > 0) {
      lines.push('', '### Captain Thread Overlay', '', '| Task ID | Status | Title | Plan | Gap Type | Notes | Source Thread |', '|---|---|---|---|---|---|---|');
      for (const item of lane.overlayItems) {
        lines.push(
          `| ${item.taskId} | ${item.status ?? 'n/a'} | ${escapeTable(item.title ?? '')} | ${escapeTable(item.relatedPlan ?? '')} | ${escapeTable(item.gapType ?? '')} | ${escapeTable(item.notes ?? '')} | ${escapeTable(item.sourceThreadTitle ?? item.sourceThreadId ?? '')} |`
        );
      }
    }
  }

  lines.push(
    '',
    '## 產生規則',
    '',
    '- `*.task.md`：只要 frontmatter `status` 不是 `done/completed/closed`，就視為未完成。',
    '- `tasks/README.md`：若索引表格內出現 task id，但找不到對應 `.task.md`，會列為「索引有列，但目前沒有正式 task card」。這代表它可能是 future queue、README-only 規劃項，或尚未 materialize 的卡。',
    '- Captain handoff：只做 task id 摘取，不直接判定完成狀態。',
    '- Captain thread overlay：只收錄 thread 裡明確指向「尚未完成 / 尚未 materialize / 仍有 implementation gap」的結論，不把已完成修復重複列為未完成。'
  );

  return `${lines.join('\n')}\n`;
}

function formatLaneLabel(lane: LaneSummary): string {
  const title = cleanText(lane.laneTitle);
  return title && title !== lane.laneKey ? `${lane.laneKey} (${title})` : lane.laneKey;
}

function escapeTable(value: string): string {
  return cleanText(value).replace(/\|/g, '\\|');
}

function relativeToRepo(filePath: string): string {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.planningRoot) || !statSync(options.planningRoot).isDirectory()) {
    throw new Error(`Planning root does not exist: ${options.planningRoot}`);
  }

  const laneMetadataByKey = buildLaneMetadata(options.planningRoot);
  const allFiles = walkFiles(options.planningRoot);
  const taskCardPaths = allFiles.filter((filePath) => filePath.endsWith('.task.md'));
  const readmePaths = allFiles.filter((filePath) => path.basename(filePath).toLowerCase() === 'readme.md' && path.basename(path.dirname(filePath)).toLowerCase() === 'tasks');

  const taskCards = taskCardPaths
    .map((filePath) => parseTaskCard(filePath, laneMetadataByKey))
    .filter((entry): entry is TaskCardEntry => entry !== null)
    .filter((entry) => !isCompletedStatus(entry.normalizedStatus));

  const readmeRows = readmePaths.flatMap((filePath) => parseReadmeTables(filePath, laneMetadataByKey));
  const overlay = loadOverlay(options.overlayPath);
  const handoffTaskIds = options.handoffPath && existsSync(options.handoffPath)
    ? extractTaskIds(readFileSync(options.handoffPath, 'utf8'))
    : [];

  const lanes = buildLaneSummariesWithOverlay(taskCards, readmeRows, overlay.entries);
  const markdown = renderMarkdown(options, lanes, handoffTaskIds, overlay.sources);
  mkdirSync(path.dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, markdown, 'utf8');

  console.log(JSON.stringify({
    ok: true,
    outPath: options.outPath,
    planningRoot: options.planningRoot,
    handoffPath: options.handoffPath,
    overlayPath: options.overlayPath,
    taskCards: taskCards.length,
    readmeOnly: lanes.reduce((sum, lane) => sum + lane.readmeOnly.length, 0),
    overlay: lanes.reduce((sum, lane) => sum + lane.overlayItems.length, 0),
    overlaySources: overlay.sources.length,
    handoffTaskIds
  }, null, 2));
}

await main();
