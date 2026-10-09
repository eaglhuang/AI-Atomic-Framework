import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// ISO8601 in Asia/Taipei (+08:00)
export function tsTaipei(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600e3).toISOString().replace('Z', '+08:00');
}

export function deferred() {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

// One JSONL file per agent => a single writer per file (process-safe append without locks).
export function jsonlSink(file) {
  mkdirSync(dirname(file), { recursive: true });
  let n = 0;
  return {
    file,
    write(obj) { appendFileSync(file, JSON.stringify(obj) + '\n'); n++; },
    get count() { return n; },
  };
}

export const markerFor = (intent_id) => `atm-edit ${intent_id}`;

// Pure text transform: insert one marker line just before the region's closing tag.
export function insertIntoRegion(content, region, line, prefix = '//') {
  const close = `${prefix} </region:${region}>`;
  const idx = content.indexOf(close);
  if (idx < 0) throw Object.assign(new Error(`region ${region} not found`), { code: 'REGION_MISSING' });
  return content.slice(0, idx) + `${prefix} ${line}\n` + content.slice(idx);
}

// Synchronous read-modify-write (atomic w.r.t. the JS event loop).
export function applyEditSync(absPath, region, line) {
  const before = readFileSync(absPath, 'utf8');
  writeFileSync(absPath, insertIntoRegion(before, region, line));
}

export function slug(s) { return s.replace(/[^a-zA-Z0-9_-]+/g, '_'); }
