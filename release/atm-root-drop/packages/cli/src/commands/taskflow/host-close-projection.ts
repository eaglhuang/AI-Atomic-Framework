import { existsSync, lstatSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { CliError } from '../shared.ts';
import { checkWorkAdmissionTicket, type WorkAdmissionTicket } from '../../../../core/src/broker/work-admission-ticket.ts';

type Scalar = string | number | boolean | null;
export type CloseValue = { value: Scalar } | { source: 'status' | 'completedAt' | 'actorId' | 'taskId' };
export interface HostCloseProjection {
  file: string;
  kind: 'json' | 'markdown';
  array?: string[];
  idField?: string;
  fields?: Record<string, CloseValue>;
  summary?: { path: string[]; totalField: string; statusField: string; buckets: Record<string, string[]>; fallbackBucket: string };
  section?: string;
  headers?: string[];
  labelColumn?: string;
  valueColumn?: string;
  rows?: Record<string, CloseValue>;
}
export interface CloseProjectionValues { taskId: string; actorId: string; status: string; completedAt: string }
export interface ProjectionPatch { file: string; absolutePath: string; before: string; after: string; stagedContent: string }
function invalid(reason: string): never {
  throw new CliError('ATM_TASKFLOW_PROFILE_SCHEMA_INVALID', `Host close projection: ${reason}`, { exitCode: 1 });
}
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(x => typeof x === 'string' && x.length > 0); }
function exactKeys(value: Record<string, unknown>, keys: string[]) { for (const key of Object.keys(value)) if (!keys.includes(key)) invalid(`unsupported option ${key}`); }
function mapping(value: unknown) {
  if (!record(value) || !Object.keys(value).length) invalid('field/row mappings must be nonempty objects');
  for (const [key, entry] of Object.entries(value)) {
    if (!key || !record(entry) || Object.keys(entry).length !== 1) invalid(`invalid mapping ${key}`);
    if ('source' in entry && !['status', 'completedAt', 'actorId', 'taskId'].includes(String(entry.source))) invalid(`unsupported source ${key}`);
    if (!('source' in entry) && !('value' in entry)) invalid(`missing value/source ${key}`);
    if ('value' in entry && entry.value !== null && !['string', 'number', 'boolean'].includes(typeof entry.value)) invalid(`non-scalar value ${key}`);
  }
}
export function validateHostCloseProjections(value: unknown): asserts value is HostCloseProjection[] {
  if (!Array.isArray(value) || !value.length) invalid('expected a nonempty array');
  const files = new Set<string>();
  for (const item of value) {
    if (!record(item)) invalid('expected projection object');
    if (typeof item.file !== 'string' || !item.file || path.isAbsolute(item.file) || /^[a-z]:/i.test(item.file) || item.file.includes('\\') || item.file.split('/').some(x => !x || x === '.' || x === '..') || /^\.(git|atm)(\/|$)/i.test(item.file)) invalid('file must be a bounded repository-relative host path');
    if (files.has(item.file)) invalid(`duplicate file ${item.file}`);
    files.add(item.file);
    if (item.kind === 'json') {
      exactKeys(item, ['file', 'kind', 'array', 'idField', 'fields', 'summary']);
      if (!strings(item.array) || typeof item.idField !== 'string' || !item.idField) invalid('JSON array and exact idField required');
      mapping(item.fields);
      if (Object.hasOwn(item.fields as object, item.idField)) invalid('idField cannot be mutated');
      if (item.summary !== undefined) {
        const s = item.summary;
        if (!record(s)) invalid('invalid summary');
        exactKeys(s, ['path', 'totalField', 'statusField', 'buckets', 'fallbackBucket']);
        if (!strings(s.path) || typeof s.totalField !== 'string' || !s.totalField || typeof s.statusField !== 'string' || !s.statusField || !record(s.buckets) || !Object.keys(s.buckets).length || typeof s.fallbackBucket !== 'string' || !Object.hasOwn(s.buckets, s.fallbackBucket) || Object.hasOwn(s.buckets, s.totalField)) invalid('invalid summary counters');
        const seen = new Set<string>();
        for (const statuses of Object.values(s.buckets)) {
          if (!strings(statuses)) invalid('summary bucket values must be string arrays');
          for (const status of statuses) { if (seen.has(status)) invalid(`ambiguous summary status ${status}`); seen.add(status); }
        }
      }
    } else if (item.kind === 'markdown') {
      exactKeys(item, ['file', 'kind', 'section', 'headers', 'labelColumn', 'valueColumn', 'rows']);
      if (typeof item.section !== 'string' || !/^#{1,6} .+/.test(item.section) || !strings(item.headers) || new Set(item.headers).size !== item.headers.length || !item.headers.includes(String(item.labelColumn)) || !item.headers.includes(String(item.valueColumn)) || item.labelColumn === item.valueColumn) invalid('unique section, headers and distinct label/value columns required');
      mapping(item.rows);
    } else invalid('unsupported kind');
  }
}

interface JsonNode { start: number; end: number; value: unknown; props?: Map<string, JsonNode>; items?: JsonNode[] }
// JSON.parse validates syntax; this bounded scanner retains every original byte outside selected values.
function jsonTree(text: string): JsonNode {
  try { JSON.parse(text); } catch { invalid('malformed JSON'); }
  let pos = 0;
  const ws = () => { while (/\s/.test(text[pos] ?? '') && pos < text.length) pos++; };
  const quoted = () => { const start = pos++; while (pos < text.length) { if (text[pos++] === '"') break; if (text[pos - 1] === '\\') pos++; } return JSON.parse(text.slice(start, pos)) as string; };
  const read = (): JsonNode => {
    ws(); const start = pos; const props = new Map<string, JsonNode>(); const items: JsonNode[] = [];
    if (text[pos] === '{') {
      pos++; ws();
      while (text[pos] !== '}') {
        const key = quoted(); ws(); pos++; const child = read();
        if (props.has(key)) invalid(`duplicate JSON key ${key}`);
        props.set(key, child); ws(); if (text[pos] !== ',') break; pos++; ws();
      }
      pos++;
    } else if (text[pos] === '[') {
      pos++; ws(); while (text[pos] !== ']') { items.push(read()); ws(); if (text[pos] !== ',') break; pos++; } pos++;
    } else if (text[pos] === '"') quoted();
    else while (pos < text.length && !/[\s,\]}]/.test(text[pos])) pos++;
    return { start, end: pos, value: JSON.parse(text.slice(start, pos)), ...(text[start] === '{' ? { props } : {}), ...(text[start] === '[' ? { items } : {}) };
  };
  return read();
}
function at(root: JsonNode, keys: string[]): JsonNode { let n = root; for (const key of keys) { const next = n.props?.get(key); if (!next) invalid(`missing JSON selector ${keys.join('.')}`); n = next; } return n; }
function resolveValue(value: CloseValue, values: CloseProjectionValues): Scalar { return 'value' in value ? value.value : values[value.source]; }
interface Edit { start: number; end: number; value: string }
function edits(text: string, changes: Edit[]): string {
  changes.sort((a, b) => b.start - a.start);
  for (let i = 1; i < changes.length; i++) if (changes[i].end > changes[i - 1].start) invalid('overlapping projection selectors');
  for (const e of changes) text = text.slice(0, e.start) + e.value + text.slice(e.end);
  return text;
}
export function projectHostContent(text: string, config: HostCloseProjection, values: CloseProjectionValues): string {
  if (text.charCodeAt(0) === 0xfeff) invalid(`UTF-8 BOM is unsupported in ${config.file}`);
  const changes: Edit[] = [];
  if (config.kind === 'json') {
    const root = jsonTree(text); const array = at(root, config.array!);
    if (!array.items) invalid('task selector must be an array');
    const matches = array.items.filter(n => n.props?.get(config.idField!)?.value === values.taskId);
    if (matches.length !== 1) invalid(`expected exactly one task ID ${values.taskId}, found ${matches.length}`);
    const task = matches[0];
    for (const [field, value] of Object.entries(config.fields!)) {
      const node = task.props?.get(field); if (!node) invalid(`missing task field ${field}`);
      changes.push({ start: node.start, end: node.end, value: JSON.stringify(resolveValue(value, values)) });
    }
    if (config.summary) {
      const s = config.summary; const counts: Record<string, number> = Object.fromEntries(Object.keys(s.buckets).map(k => [k, 0]));
      for (const node of array.items) {
        const field = node.props?.get(s.statusField); if (!field || typeof field.value !== 'string') invalid(`missing/string status field ${s.statusField}`);
        const mapped = node === task && config.fields![s.statusField] ? resolveValue(config.fields![s.statusField], values) : field.value;
        const bucket = Object.keys(s.buckets).find(k => s.buckets[k].includes(String(mapped))) ?? s.fallbackBucket;
        counts[bucket]++;
      }
      for (const [key, count] of Object.entries({ ...counts, [s.totalField]: array.items.length })) {
        const node = at(root, [...s.path, key]); changes.push({ start: node.start, end: node.end, value: String(count) });
      }
    }
  } else {
    const lines = [...text.matchAll(/[^\r\n]*(?:\r\n|\n|$)/g)].filter(m => m[0]);
    const heads = lines.map((m, i) => m[0].trimEnd() === config.section ? i : -1).filter(i => i >= 0);
    if (heads.length !== 1) invalid(`expected unique section ${config.section}`);
    const begin = heads[0]; const level = config.section!.match(/^#+/)![0].length;
    let end = lines.length; for (let i = begin + 1; i < lines.length; i++) { const h = lines[i][0].match(/^(#{1,6}) /); if (h && h[1].length <= level) { end = i; break; } }
    const cells = (line: string) => line.trim().replace(/^\||\|$/g, '').split('|').map(x => x.trim());
    const tables: number[] = [];
    for (let i = begin + 1; i + 1 < end; i++) if (JSON.stringify(cells(lines[i][0])) === JSON.stringify(config.headers) && cells(lines[i + 1][0]).every(c => /^:?-{3,}:?$/.test(c))) tables.push(i);
    if (tables.length !== 1) invalid('expected unique selected Markdown table');
    const labelIndex = config.headers!.indexOf(config.labelColumn!); const valueIndex = config.headers!.indexOf(config.valueColumn!);
    for (const [label, value] of Object.entries(config.rows!)) {
      const matches: number[] = [];
      for (let i = tables[0] + 2; i < end && lines[i][0].trim().startsWith('|'); i++) if (cells(lines[i][0])[labelIndex] === label) matches.push(i);
      if (matches.length !== 1) invalid(`expected unique Markdown row ${label}`);
      const line = lines[matches[0]]; const spans = [...line[0].matchAll(/\|([^|\r\n]*)/g)].filter(m => m.index !== line[0].lastIndexOf('|'));
      if (spans.length !== config.headers!.length) invalid(`ambiguous Markdown cells ${label}`);
      const span = spans[valueIndex]; const raw = span[1]; const replacement = String(resolveValue(value, values));
      if (/[|\r\n]/.test(replacement)) invalid(`unsupported Markdown cell value ${label}`);
      const start = line.index! + span.index! + 1; const leading = raw.match(/^\s*/)![0]; const trailing = raw.match(/\s*$/)![0];
      changes.push({ start, end: start + raw.length, value: leading + replacement + trailing });
    }
  }
  return edits(text, changes);
}
export function prepareHostCloseProjections(input: { root: string; configs?: HostCloseProjection[]; values: CloseProjectionValues; allowedFiles: readonly string[]; baseline: (file: string) => string }): ProjectionPatch[] {
  if (!input.configs) return [];
  validateHostCloseProjections(input.configs);
  const root = realpathSync(input.root);
  const canonicalFiles = new Set<string>();
  return input.configs.map(config => {
    if (!input.allowedFiles.includes(config.file)) invalid(`path lacks exact task write authority: ${config.file}; amend scope and renew the write ticket`);
    if (lstatSync(path.resolve(root, config.file), { throwIfNoEntry: false })?.isSymbolicLink()) invalid(`symlink projection is unsupported: ${config.file}`);
    let absolutePath: string;
    try { absolutePath = realpathSync(path.resolve(root, config.file)); } catch { invalid(`missing projection file ${config.file}`); }
    if (path.relative(root, absolutePath!).startsWith('..') || path.isAbsolute(path.relative(root, absolutePath!))) invalid(`projection escapes repository: ${config.file}`);
    const physicalRelative = path.relative(root, absolutePath!).replace(/\\/g, '/');
    const comparable = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value;
    if (comparable(physicalRelative) !== comparable(config.file)) invalid(`projection path aliases another physical path: ${config.file}`);
    const canonical = process.platform === 'win32' ? absolutePath!.toLowerCase() : absolutePath!;
    if (canonicalFiles.has(canonical)) invalid(`duplicate canonical projection file: ${config.file}`);
    canonicalFiles.add(canonical);
    const before = readFileSync(absolutePath!, 'utf8'); const baseline = input.baseline(config.file);
    return { file: config.file, absolutePath: absolutePath!, before, after: projectHostContent(before, config, input.values), stagedContent: projectHostContent(baseline, config, input.values) };
  });
}
export function applyHostCloseProjections(patches: readonly ProjectionPatch[]) {
  assertHostProjectionCas(patches);
  for (const patch of patches) writeFileSync(patch.absolutePath, patch.after, 'utf8');
}
export function assertHostProjectionCas(patches: readonly ProjectionPatch[]) {
  for (const patch of patches) if (readFileSync(patch.absolutePath, 'utf8') !== patch.before) invalid(`CAS drift at ${patch.file}; prepare again`);
}

export function authorizeHostProjectionWrite(taskDocument: Record<string, unknown>, values: CloseProjectionValues, patches: readonly ProjectionPatch[]) {
  if (!patches.length) return;
  const ticket = taskDocument.workAdmissionTicket as WorkAdmissionTicket | undefined;
  const claim = taskDocument.claim as { laneSession?: { laneSessionId?: string }; leaseId?: string } | undefined;
  const decision = checkWorkAdmissionTicket({ ticket, taskId: values.taskId, actorId: values.actorId, laneSessionId: claim?.laneSession?.laneSessionId ?? process.env.ATM_LANE_SESSION_ID ?? null, files: patches.map(p => p.file), operation: 'write' });
  if (!decision.ok) throw new CliError(decision.code, decision.reason, { exitCode: 1, details: { files: patches.map(p => p.file) } });
}

export function captureProjectionTransaction(root: string, patches: readonly ProjectionPatch[], extraFiles: readonly string[] = []) {
  const files = [...new Set([...patches.map(p => p.absolutePath), ...extraFiles])].map(file => ({ file, bytes: existsSync(file) ? readFileSync(file) : null }));
  const indexPath = path.resolve(root, execFileSync('git', ['rev-parse', '--git-path', 'index'], { cwd: root, encoding: 'utf8' }).trim());
  const index = existsSync(indexPath) ? readFileSync(indexPath) : null;
  const staged = execFileSync('git', ['diff', '--cached', '--name-only', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  const stagedProjections = patches.filter(p => staged.includes(p.file)).map(p => ({ file: p.file, content: execFileSync('git', ['show', `:${p.file}`], { cwd: root, encoding: 'utf8' }), mode: execFileSync('git', ['ls-files', '-s', '--', p.file], { cwd: root, encoding: 'utf8' }).split(' ')[0] }));
  return {
    finish(configs: readonly HostCloseProjection[], values: CloseProjectionValues, rebasePlanning: (file: string, content: string) => string = (_file, content) => content) {
      for (const entry of stagedProjections) {
        const content = projectHostContent(rebasePlanning(entry.file, entry.content), configs.find(c => c.file === entry.file)!, values);
        const blob = execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: root, input: content, encoding: 'utf8' }).trim();
        execFileSync('git', ['update-index', '--cacheinfo', `${entry.mode},${blob},${entry.file}`], { cwd: root });
      }
    },
    restore() { for (const entry of files) { if (entry.bytes) writeFileSync(entry.file, entry.bytes); else if (existsSync(entry.file)) unlinkSync(entry.file); } if (index) writeFileSync(indexPath, index); else if (existsSync(indexPath)) unlinkSync(indexPath); }
  };
}
