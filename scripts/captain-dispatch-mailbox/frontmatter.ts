import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type { FrontMatter, ParsedMarkdown, YamlRecord } from './types.ts';
import { escapeFrontMatterValue } from './fs-utils.ts';
export { escapeFrontMatterValue };

export function fmString(fm: FrontMatter, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = fm[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return normalizeYamlScalar(value);
    }
  }
  return undefined;
}

export function resolveDispatchId(fm: FrontMatter, fallback: string): string {
  return fmString(fm, 'dispatch_id', 'dispatchId') || fallback;
}

export function quoteYamlValue(value: unknown): string {
  return `"${escapeFrontMatterValue(value)}"`;
}

export function parseMarkdownFile(filePath: string): ParsedMarkdown {
  const text = readFileSync(filePath, 'utf8');
  const frontMatter = {};
  let rawFrontMatter = null;
  let body = text;

  const extracted = extractFrontMatter(text);
  if (extracted) {
    rawFrontMatter = extracted.raw;
    body = text.slice(extracted.endIndex).trimStart();
    Object.assign(frontMatter, extracted.data);
  }

  const heading = body.split(/\r?\n/).find((line) => line.startsWith('# '))?.replace(/^#\s+/, '').trim() || null;
  return { frontMatter, heading, body, rawFrontMatter };
}

export function extractFrontMatter(text: string): { data: FrontMatter; raw: string; endIndex: number } | null {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(text);
  if (!match) {
    return null;
  }

  const raw = match[1];
  const data: FrontMatter = {};
  let currentKey = null;
  let currentObjectKey = null;
  let currentObjectListKey = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine;
    if (/^[A-Za-z_][A-Za-z0-9_]*\s*:/.test(line)) {
      const colonIndex = line.indexOf(':');
      const key = line.slice(0, colonIndex).trim();
      const value = normalizeYamlScalar(line.slice(colonIndex + 1).trim());
      currentKey = key;
      currentObjectKey = value.length === 0 ? key : null;
      currentObjectListKey = null;
      data[key] = value;
      continue;
    }

    const objectFieldMatch = /^ {2}([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (currentObjectKey && objectFieldMatch) {
      const objectValue = data[currentObjectKey];
      const objectRecord: YamlRecord = objectValue && typeof objectValue === 'object' && !Array.isArray(objectValue)
        ? objectValue as YamlRecord
        : {};
      const key = objectFieldMatch[1];
      const value = normalizeYamlScalar(objectFieldMatch[2].trim());
      objectRecord[key] = value;
      data[currentObjectKey] = objectRecord;
      currentObjectListKey = value.length === 0 ? key : null;
      continue;
    }

    if (currentObjectKey && currentObjectListKey && /^ {4}-\s+/.test(line)) {
      const objectRecord = data[currentObjectKey] as YamlRecord;
      const value = normalizeYamlScalar(line.replace(/^ {4}-\s+/, '').trim());
      const existing = objectRecord[currentObjectListKey];
      objectRecord[currentObjectListKey] = Array.isArray(existing)
        ? [...existing, value]
        : typeof existing === 'string' && existing.length > 0
          ? [existing, value]
          : [value];
      data[currentObjectKey] = objectRecord;
      continue;
    }

    if (currentKey && /^\s*-\s+/.test(line)) {
      const value = normalizeYamlScalar(line.replace(/^\s*-\s+/, '').trim());
      const existing = data[currentKey];
      if (Array.isArray(existing)) {
        data[currentKey] = [...existing, value];
      } else if (typeof existing === 'string' && existing.length === 0) {
        data[currentKey] = [value];
      } else if (typeof existing === 'string') {
        data[currentKey] = [existing, value];
      } else {
        data[currentKey] = [value];
      }
    }
  }

  return {
    data,
    raw,
    endIndex: match.index + match[0].length
  };
}

export function normalizeYamlScalar(value: unknown): string {
  return String(value || '').trim().replace(/^['"`]|['"`]$/g, '');
}

export function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? normalizeYamlScalar(value) : null;
}

export function sanitizeFrontMatterBlock(rawFrontMatter: string | null | undefined, keysToRemove: Set<string>): string {
  const keptLines = [];
  let skipCurrentTopLevel = false;

  for (const line of String(rawFrontMatter || '').split(/\r?\n/)) {
    const topLevelMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
    if (topLevelMatch) {
      skipCurrentTopLevel = keysToRemove.has(topLevelMatch[1]);
      if (!skipCurrentTopLevel) {
        keptLines.push(line);
      }
      continue;
    }

    if (!skipCurrentTopLevel) {
      keptLines.push(line);
    }
  }

  return keptLines.join('\n').trim();
}

export function ensureDispatchBody(body: string | null | undefined, options: { fromAgent: string; toAgent: string; taskId: string; dispatchId: string; workModel: string }): string {
  const sections = [];
  const trimmed = String(body || '').trim();

  sections.push(`Dispatch: ${options.fromAgent} -> ${options.toAgent} | Task: ${options.taskId} | Dispatch: ${options.dispatchId}`);
  if (trimmed) {
    sections.push('');
    sections.push(trimmed);
  }

  if (!/^#{1,6}\s*Mailbox Routing\b/im.test(trimmed)) {
    sections.push('');
    sections.push('## Mailbox Routing');
    sections.push(`- From agent: ${options.fromAgent}`);
    sections.push(`- To agent: ${options.toAgent}`);
    sections.push(`- Reply to: ${options.fromAgent}`);
    sections.push(`- Dispatch ID: ${options.dispatchId}`);
    sections.push(`- Work model: ${options.workModel}`);
  }

  if (!/^#{1,6}\s*(Report Contract|Report Format)\b/im.test(trimmed)) {
    sections.push('');
    sections.push('## Report Contract');
    sections.push('- Write the report as Markdown and return it to `captain/inbox`.');
    sections.push(`- The report must say who is reporting: ${options.toAgent}.`);
    sections.push(`- The report must say who receives the report: ${options.fromAgent}.`);
    sections.push(`- The report must name the task: ${options.taskId}.`);
    sections.push(`- The report must include dispatch_id: ${options.dispatchId}.`);
    sections.push('');
    sections.push('## Report Format');
    sections.push(`Report: ${options.toAgent} -> ${options.fromAgent} | Task: ${options.taskId} | Dispatch: ${options.dispatchId}`);
    sections.push('');
    sections.push('1. Outcome: PASS / CONCERN / BLOCK');
    sections.push('2. Claim status or execution status');
    sections.push('3. Files changed / artifacts touched');
    sections.push('4. Work summary');
    sections.push('5. Validator results: PASS / FAIL');
    sections.push('6. Blockers / residual risk');
    sections.push('7. Next recommendation');
  }

  return sections.join('\n').trim();
}

export function ensureReportBody(body: string | null | undefined, options: { fromAgent: string; toAgent: string; taskId: string; dispatchId: string }): string {
  const sections = [];
  const trimmed = String(body || '').trim();

  sections.push(`Report: ${options.fromAgent} -> ${options.toAgent} | Task: ${options.taskId} | Dispatch: ${options.dispatchId}`);
  if (trimmed) {
    sections.push('');
    sections.push(trimmed);
  }

  if (!/^#{1,6}\s*Report Summary\b/im.test(trimmed)) {
    sections.push('');
    sections.push('## Report Summary');
    sections.push('- Outcome: PASS / CONCERN / BLOCK');
    sections.push('- Work performed');
    sections.push('- Files changed / artifacts touched');
    sections.push('- Validator results');
    sections.push('- Blockers / residual risk');
    sections.push('- Next recommendation');
  }

  return sections.join('\n').trim();
}

export function isThinReportBody(body: string | null | undefined): boolean {
  const normalized = String(body || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized.length < 40) {
    return true;
  }
  const compact = normalized.replace(/\s+/g, ' ');
  return ['ok', 'okay', 'done', 'completed', 'pass', 'looks good'].includes(compact);
}

export function loadWorkerReportFile(reportFilePath: string, options: { dispatchId: string; taskId: string; fromAgent: string; toAgent: string; agentModel: string; defaultStatus: string }): { status: string; markdown: string } | { error: string } {
  const resolvedPath = path.resolve(reportFilePath);
  if (!existsSync(resolvedPath)) {
    return { error: `Worker report file does not exist: ${resolvedPath}` };
  }

  const parsed = parseMarkdownFile(resolvedPath);
  const reportStatus = normalizeOptionalString(fmString(parsed.frontMatter, 'status')) || options.defaultStatus;
  const fromAgent = normalizeOptionalString(fmString(parsed.frontMatter, 'from_agent', 'agent')) || options.fromAgent;
  const toAgent = normalizeOptionalString(fmString(parsed.frontMatter, 'to_agent', 'reply_to')) || options.toAgent;
  const taskId = normalizeOptionalString(fmString(parsed.frontMatter, 'task_id', 'source_job_id')) || options.taskId;
  const dispatchId = normalizeOptionalString(fmString(parsed.frontMatter, 'dispatch_id')) || options.dispatchId;
  const reportBody = ensureReportBody(parsed.body, { fromAgent, toAgent, taskId, dispatchId });

  if (String(reportStatus).toLowerCase() === 'done' && isThinReportBody(reportBody)) {
    return { error: `Worker report file is too thin for status=done: ${resolvedPath}` };
  }

  const markdown = [
    '---',
    `type: ${quoteYamlValue('captain-dispatch-report')}`,
    `dispatch_id: ${quoteYamlValue(dispatchId)}`,
    `task_id: ${quoteYamlValue(taskId)}`,
    `agent: ${quoteYamlValue(fromAgent)}`,
    `from_agent: ${quoteYamlValue(fromAgent)}`,
    `to_agent: ${quoteYamlValue(toAgent)}`,
    `status: ${quoteYamlValue(reportStatus)}`,
    `completed_at: ${quoteYamlValue(new Date().toISOString())}`,
    '---',
    '',
    reportBody,
    ''
  ].join('\n');

  return {
    status: reportStatus,
    markdown
  };
}
