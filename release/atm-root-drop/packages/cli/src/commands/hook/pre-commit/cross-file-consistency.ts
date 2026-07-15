import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { quoteCliValue, relativePathFrom } from '../../shared.ts';
import { readActiveTaskDirectionLocks } from '../../task-direction.ts';
import { readGitObjectText } from '../commit-range-guard.ts';
import { createSanitizedGitEnv, normalizeRelativePath, runGitLines } from '../git-index-diagnostics.ts';

export interface PreCommitBlockingFinding {
  readonly code: string;
  readonly source: string;
  readonly detail: string;
  readonly file?: string;
  readonly files?: readonly string[];
  readonly requiredCommand?: string | null;
  readonly classification?: 'environment' | 'baseline' | 'current-task' | 'blocking';
  readonly blockerKind?: 'governance-state' | 'content-validation' | 'environment' | 'baseline';
  readonly scope?: 'staged' | 'tree-wide';
  readonly data?: unknown;
}

export function checkStageTimeCrossFileConsistency(input: {
  readonly root: string;
  readonly stagedFiles: readonly string[];
  readonly isBrokerResolutionAuthorizedDependencyDeferral: (cwd: string, dependencyPath: string) => boolean;
}): PreCommitBlockingFinding[] {
  const { root, stagedFiles, isBrokerResolutionAuthorizedDependencyDeferral } = input;
  const findings: PreCommitBlockingFinding[] = [];
  const statusResult = spawnSync('git', ['status', '--short'], {
    cwd: root,
    encoding: 'utf8',
    env: createSanitizedGitEnv()
  });
  const statusLines = String(statusResult.stdout || '').split(/\r?\n/).filter(Boolean);
  const unstagedModified = new Set<string>();
  const untrackedFiles = new Set<string>();
  const deletedFiles = new Set<string>();

  for (const line of statusLines) {
    if (line.length < 3) continue;
    const xStatus = line[0];
    const yStatus = line[1];
    const filePath = normalizeRelativePath(line.slice(3).trim());
    if (!filePath) continue;

    if (xStatus === '?' && yStatus === '?') {
      untrackedFiles.add(filePath);
    } else if (yStatus === 'M') {
      unstagedModified.add(filePath);
    } else if (yStatus === 'D') {
      deletedFiles.add(filePath);
    }
  }

  const stagedTsJsFiles = stagedFiles.filter(f => /\.(ts|tsx|js|jsx)$/.test(f));

  for (const stagedFile of stagedTsJsFiles) {
    const content = readGitObjectText(root, `:${stagedFile}`);
    if (!content) continue;

    const imports = collectStaticImportSymbols(content)
      .filter((entry) => entry.path.startsWith('.'));
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    const dynamicImportRegex = /import\(['"]([^'"]+)['"]\)/g;

    let match;

    while ((match = requireRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.')) {
        imports.push({ path: importPath, symbols: ['*'] });
      }
    }

    while ((match = dynamicImportRegex.exec(content)) !== null) {
      const importPath = match[1];
      if (importPath.startsWith('.')) {
        imports.push({ path: importPath, symbols: ['*'] });
      }
    }

    for (const imp of imports) {
      const resolvedFile = resolveLocalImportFile(root, stagedFile, imp.path);
      if (!resolvedFile) {
        continue;
      }

      if (untrackedFiles.has(resolvedFile)) {
        findings.push({
          code: 'ATM_PRE_COMMIT_CROSS_FILE_INCONSISTENCY',
          source: 'cross-file-consistency',
          file: stagedFile,
          files: [resolvedFile],
          detail: `Stage-time cross-file consistency failure in ${stagedFile}: references untracked local file ${resolvedFile} which will not be committed. Please stage ${resolvedFile} first.`,
          requiredCommand: `git add -- ${quoteCliValue(resolvedFile)}`,
          classification: 'current-task'
        });
        continue;
      }

      if (deletedFiles.has(resolvedFile)) {
        findings.push({
          code: 'ATM_PRE_COMMIT_CROSS_FILE_INCONSISTENCY',
          source: 'cross-file-consistency',
          file: stagedFile,
          files: [resolvedFile],
          detail: `Stage-time cross-file consistency failure in ${stagedFile}: references deleted local file ${resolvedFile}.`,
          requiredCommand: `git add -- ${quoteCliValue(resolvedFile)}`,
          classification: 'current-task'
        });
        continue;
      }

      if (unstagedModified.has(resolvedFile)) {
        const diffLines = runGitLines(root, ['diff', '--', resolvedFile]);
        const changedLines = diffLines.filter(line => {
          return (line.startsWith('+') || line.startsWith('-')) && !line.startsWith('+++') && !line.startsWith('---');
        }).map(line => line.slice(1));

        const diffText = changedLines.join('\n');
        const missingSymbols: string[] = [];
        for (const sym of imp.symbols) {
          if (sym === '*') {
            missingSymbols.push('*');
            break;
          }

          const symbolRegex = new RegExp(`\\b${escapeRegExp(sym)}\\b`);
          if (symbolRegex.test(diffText)) {
            missingSymbols.push(sym);
          }
        }

        if (missingSymbols.length > 0 && !isBrokerResolutionAuthorizedDependencyDeferral(root, resolvedFile)) {
          findings.push({
            code: 'ATM_PRE_COMMIT_CROSS_FILE_INCONSISTENCY',
            source: 'cross-file-consistency',
            file: stagedFile,
            files: [resolvedFile],
            detail: `Stage-time cross-file consistency failure in ${stagedFile}: missing staged changes for symbol(s) "${missingSymbols.join(', ')}" imported from ${resolvedFile} (which has unstaged changes modifying these symbols). Please stage ${resolvedFile}.`,
            requiredCommand: `git add -- ${quoteCliValue(resolvedFile)}`,
            classification: 'current-task'
          });
        }
      }
    }
  }

  return findings;
}



function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLikelyImportSymbol(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value) || value === 'default' || value === '*';
}

function parseImportSymbols(symbolsStr: string | undefined): string[] {
  if (!symbolsStr) return ['*'];
  const trimmed = symbolsStr.trim();
  if (!trimmed) return ['*'];
  if (trimmed.startsWith('*')) return ['*'];

  const symbols: string[] = [];
  const bracesMatch = /\{([\s\S]*?)\}/.exec(trimmed);
  if (bracesMatch) {
    const namedParts = bracesMatch[1].split(',');
    for (const part of namedParts) {
      const cleanPart = part.trim();
      if (!cleanPart) continue;
      const sym = cleanPart.split(/\s+as\s+/)[0].trim();
      if (sym && isLikelyImportSymbol(sym)) symbols.push(sym);
    }
    const outside = trimmed.replace(/\{[\s\S]*?\}/, '').trim();
    if (outside) {
      const cleanOutside = outside.replace(/,$/, '').trim();
      if (cleanOutside) symbols.push('default');
    }
  } else if (trimmed) {
    if (trimmed.includes('*')) {
      symbols.push('*');
    } else {
      symbols.push('default');
    }
  }
  return symbols;
}

function collectStaticImportSymbols(content: string): { path: string; symbols: string[] }[] {
  const imports: { path: string; symbols: string[] }[] = [];
  const statementRegex = /^\s*import\s+(?:type\s+)?(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/;

  for (const statement of collectImportStatements(content)) {
    const match = statementRegex.exec(statement);
    if (!match) {
      continue;
    }
    imports.push({
      path: match[2],
      symbols: parseImportSymbols(match[1])
    });
  }

  return imports;
}

function collectImportStatements(content: string): string[] {
  const statements: string[] = [];
  const length = content.length;
  let index = 0;

  while (index < length) {
    const current = content[index];
    const next = content[index + 1];

    if (current === '/' && next === '/') {
      index += 2;
      while (index < length && content[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (current === '/' && next === '*') {
      index += 2;
      while (index < length && !(content[index] === '*' && content[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    if (current === '\'' || current === '"' || current === '`') {
      index = skipStringLiteral(content, index);
      continue;
    }

    if (isImportKeywordAt(content, index)) {
      const start = index;
      index += 'import'.length;
      index = skipImportStatementTail(content, index);
      statements.push(content.slice(start, index));
      continue;
    }

    index += 1;
  }

  return statements;
}

function skipImportStatementTail(content: string, startIndex: number): number {
  const length = content.length;
  let index = startIndex;
  let mode: 'normal' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' = 'normal';
  let templateDepth = 0;

  while (index < length) {
    const current = content[index];
    const next = content[index + 1];

    if (mode === 'normal') {
      if (current === '/' && next === '/') {
        mode = 'line-comment';
        index += 2;
        continue;
      }
      if (current === '/' && next === '*') {
        mode = 'block-comment';
        index += 2;
        continue;
      }
      if (current === '\'') {
        mode = 'single';
        index += 1;
        continue;
      }
      if (current === '"') {
        mode = 'double';
        index += 1;
        continue;
      }
      if (current === '`') {
        mode = 'template';
        templateDepth = 0;
        index += 1;
        continue;
      }
      if (current === ';') {
        return index + 1;
      }
    } else if (mode === 'single') {
      if (current === '\\') {
        index += 2;
        continue;
      }
      if (current === '\'') {
        mode = 'normal';
      }
    } else if (mode === 'double') {
      if (current === '\\') {
        index += 2;
        continue;
      }
      if (current === '"') {
        mode = 'normal';
      }
    } else if (mode === 'template') {
      if (current === '\\') {
        index += 2;
        continue;
      }
      if (current === '$' && next === '{') {
        templateDepth += 1;
        index += 2;
        continue;
      }
      if (current === '}' && templateDepth > 0) {
        templateDepth -= 1;
        index += 1;
        continue;
      }
      if (current === '`' && templateDepth === 0) {
        mode = 'normal';
      }
    } else if (mode === 'line-comment') {
      if (current === '\n') {
        mode = 'normal';
      }
    } else if (mode === 'block-comment') {
      if (current === '*' && next === '/') {
        mode = 'normal';
        index += 2;
        continue;
      }
    }

    index += 1;
  }

  return index;
}

function skipStringLiteral(content: string, startIndex: number): number {
  const quote = content[startIndex];
  let index = startIndex + 1;
  while (index < content.length) {
    const current = content[index];
    if (current === '\\') {
      index += 2;
      continue;
    }
    if (current === quote) {
      return index + 1;
    }
    index += 1;
  }
  return index;
}

function isImportKeywordAt(content: string, index: number): boolean {
  if (content.slice(index, index + 'import'.length) !== 'import') {
    return false;
  }
  const before = content[index - 1];
  const after = content[index + 'import'.length];
  if (before && /[A-Za-z0-9_$]/.test(before)) {
    return false;
  }
  if (after && /[A-Za-z0-9_$]/.test(after)) {
    return false;
  }
  return true;
}

function resolveLocalImportFile(root: string, stagedFile: string, importPath: string): string | null {
  const dir = path.dirname(path.join(root, stagedFile));
  const resolvedBase = path.resolve(dir, importPath);
  const extensions = ['.ts', '.tsx', '.d.ts', '.js', '.jsx', '/index.ts', '/index.js'];
  if (existsSync(resolvedBase) && statSync(resolvedBase).isFile()) {
    return normalizeRelativePath(relativePathFrom(root, resolvedBase));
  }
  for (const ext of extensions) {
    const candidate = resolvedBase + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return normalizeRelativePath(relativePathFrom(root, candidate));
    }
  }
  return null;
}
