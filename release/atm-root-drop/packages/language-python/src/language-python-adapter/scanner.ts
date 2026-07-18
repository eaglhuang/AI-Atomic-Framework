import path from 'node:path';
import type {
  PythonEntrypointRecord,
  PythonImportRecord,
  PythonSourceFile
} from '../index.ts';
import { normalizePath } from './shared.ts';

export const PIPELINE_FOLDER_HINTS = ['pipelines', 'jobs', 'tasks', 'workflows', 'flows'];

export function scanPythonImports(sourceFile: PythonSourceFile): readonly PythonImportRecord[] {
  const records: PythonImportRecord[] = [];
  const lines = sourceFile.sourceText.split(/\r?\n/);
  const importPattern = /^\s*import\s+([A-Za-z_][\w.]*)(?:\s+as\s+[A-Za-z_]\w*)?/;
  const fromImportPattern = /^\s*from\s+([A-Za-z_.][\w.]*)\s+import\s+/;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    const directImport = importPattern.exec(line);
    if (directImport) {
      records.push({
        filePath: sourceFile.filePath,
        specifier: directImport[1],
        statementKind: 'import',
        line: lineIndex + 1
      });
      continue;
    }
    const fromImport = fromImportPattern.exec(line);
    if (fromImport) {
      records.push({
        filePath: sourceFile.filePath,
        specifier: fromImport[1],
        statementKind: 'from-import',
        line: lineIndex + 1
      });
    }
  }
  return records;
}

export function scanPythonEntrypoints(sourceFile: PythonSourceFile): readonly PythonEntrypointRecord[] {
  const records: PythonEntrypointRecord[] = [];
  const normalized = normalizePath(sourceFile.filePath);
  const baseName = path.basename(normalized);
  const lines = sourceFile.sourceText.split(/\r?\n/);

  const isPipelineFile = PIPELINE_FOLDER_HINTS.some((folder) => normalized.includes(`/${folder}/`));
  if (isPipelineFile) {
    records.push({
      filePath: sourceFile.filePath,
      kind: 'pipeline-script',
      line: 1
    });
  }

  if (baseName === '__main__.py') {
    records.push({
      filePath: sourceFile.filePath,
      kind: 'package-main',
      line: 1
    });
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    if (!line) continue;
    if (/^\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:\s*$/.test(line)) {
      records.push({
        filePath: sourceFile.filePath,
        kind: 'script-main',
        line: lineIndex + 1
      });
    }
    const mainFunctionMatch = /^\s*def\s+(main)\s*\(/.exec(line);
    if (mainFunctionMatch) {
      records.push({
        filePath: sourceFile.filePath,
        kind: 'declared-script',
        line: lineIndex + 1,
        symbol: mainFunctionMatch[1]
      });
    }
  }

  return records;
}
