import path from 'node:path';
import { readText, walkSourceFiles, writeText } from './files.ts';
import type { AtomCallsite, AtomCallsiteRewrite, AtomCallsiteViolation, AtomCatalogEntry } from './types.ts';

export function scanCallsites(repoPath: string): AtomCallsite[] {
  const files = walkSourceFiles(repoPath);
  const callsites: AtomCallsite[] = [];
  const callPattern = /\b(runAtmMap|runAtm)\s*\(\s*([^,\r\n)]+)/g;
  for (const file of files) {
    const text = readText(path.join(repoPath, file));
    const localRunAtm = definesLocalFunction(text, 'runAtm');
    const localRunAtmMap = definesLocalFunction(text, 'runAtmMap');
    for (const match of text.matchAll(callPattern)) {
      const callee = match[1] as 'runAtm' | 'runAtmMap';
      if ((callee === 'runAtm' && localRunAtm) || (callee === 'runAtmMap' && localRunAtmMap)) {
        continue;
      }
      callsites.push({
        file,
        line: lineNumberAt(text, match.index ?? 0),
        callee,
        firstArgument: match[2].trim()
      });
    }
  }
  return callsites;
}

export function collectDefinedReadableRefs(repoPath: string): Set<string> {
  const names = new Set<string>();
  const refPattern = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:Object\.freeze\(\s*)?defineAtm(?:Atom|Map)Ref\s*\(/g;
  for (const file of walkSourceFiles(repoPath)) {
    const text = readText(path.join(repoPath, file));
    for (const match of text.matchAll(refPattern)) {
      names.add(match[1]);
    }
  }
  return names;
}

export function planCallsiteRewrites(callsites: readonly AtomCallsite[], catalog: readonly AtomCatalogEntry[]): AtomCallsiteRewrite[] {
  const byId = new Map(catalog.map((entry) => [entry.id, entry]));
  const rewrites: AtomCallsiteRewrite[] = [];
  for (const callsite of callsites) {
    const id = extractRawIdArgument(callsite.firstArgument);
    if (!id) {
      continue;
    }
    const target = byId.get(id);
    if (!target) {
      continue;
    }
    rewrites.push({
      ...callsite,
      from: callsite.firstArgument,
      to: target.refName
    });
  }
  return rewrites;
}

export function evaluateCallsites(
  callsites: readonly AtomCallsite[],
  knownRefNames: ReadonlySet<string>,
  plannedRewrites: readonly AtomCallsiteRewrite[]
): AtomCallsiteViolation[] {
  const rewriteKeys = new Set(plannedRewrites.map((rewrite) => `${rewrite.file}:${rewrite.line}:${rewrite.firstArgument}`));
  const violations: AtomCallsiteViolation[] = [];
  for (const callsite of callsites) {
    const violation = evaluateOneCallsite(callsite, knownRefNames, rewriteKeys);
    if (violation) {
      violations.push(violation);
    }
  }
  return violations;
}

export function applyCallsiteRewrites(repoPath: string, rewrites: readonly AtomCallsiteRewrite[]) {
  const byFile = new Map<string, AtomCallsiteRewrite[]>();
  for (const rewrite of rewrites) {
    byFile.set(rewrite.file, [...(byFile.get(rewrite.file) ?? []), rewrite]);
  }
  for (const [file, fileRewrites] of byFile) {
    const absolutePath = path.join(repoPath, file);
    let text = readText(absolutePath);
    for (const rewrite of fileRewrites) {
      text = text.replace(rewrite.from, rewrite.to);
    }
    writeText(absolutePath, text);
  }
}

function evaluateOneCallsite(
  callsite: AtomCallsite,
  knownRefNames: ReadonlySet<string>,
  rewriteKeys: ReadonlySet<string>
): AtomCallsiteViolation | null {
  if (rewriteKeys.has(`${callsite.file}:${callsite.line}:${callsite.firstArgument}`)) {
    return null;
  }
  const argument = callsite.firstArgument;
  const rawId = extractRawIdArgument(argument);
  if (rawId) {
    return { ...callsite, code: 'raw-id-callsite', detail: `Replace raw ${rawId} with a semantic readable ref.` };
  }
  if (argument.startsWith('{')) {
    return { ...callsite, code: 'inline-ref-object', detail: 'Inline atom/map objects hide reusable intent; use a named readable ref.' };
  }
  if (/^\d/.test(argument)) {
    return { ...callsite, code: 'numeric-ref', detail: 'Numeric atom/map references are not readable to maintainers.' };
  }
  if (/^(atm|ATM|map|MAP)[A-Za-z0-9_$]*\d/.test(argument)) {
    return { ...callsite, code: 'id-like-ref-name', detail: 'Readable refs must use domain intent, not an ID-shaped variable name.' };
  }
  if (/^[A-Za-z_$][\w$]*$/.test(argument) && !knownRefNames.has(argument)) {
    return { ...callsite, code: 'unknown-readable-ref', detail: `Readable ref ${argument} is not defined by defineAtmAtomRef or defineAtmMapRef.` };
  }
  return null;
}

function definesLocalFunction(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\bfunction\\s+${escaped}\\s*\\(`).test(text)
    || new RegExp(`\\bconst\\s+${escaped}\\s*=`).test(text)
    || new RegExp(`\\blet\\s+${escaped}\\s*=`).test(text)
    || new RegExp(`\\bvar\\s+${escaped}\\s*=`).test(text);
}

function extractRawIdArgument(argument: string): string | null {
  const stringMatch = argument.match(/^['"`](ATM-[A-Z0-9]+-\d{4})['"`]$/);
  if (stringMatch) {
    return stringMatch[1];
  }
  const objectMatch = argument.match(/(?:atomId|mapId)\s*:\s*['"`](ATM-[A-Z0-9]+-\d{4})['"`]/);
  if (objectMatch) {
    return objectMatch[1];
  }
  return null;
}

function lineNumberAt(text: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (text.charCodeAt(index) === 10) {
      line += 1;
    }
  }
  return line;
}
