import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(code: string, message: string): never {
  console.error(`[tasks-surface-validator:${mode}] Error [${code}]: ${message}`);
  process.exitCode = 1;
  throw new Error(`[${code}] ${message}`);
}

// 1. Define the invariant public contract symbols
const REQUIRED_VALUES = new Set([
  'runTasks',
  'findTaskClaimDependencyBlockers',
  'buildResidueDiagnosisEvidence',
  'generateTaskCard',
  'loadTaskDocumentOrThrow',
  'runTasksRosterUpdate'
]);

const REQUIRED_TYPES = new Set([
  'TaskClaimDependencyBlocker',
  'TaskResidueBucket',
  'TaskResidueClassification'
]);

const ALL_REQUIRED_SYMBOLS = new Set([...REQUIRED_VALUES, ...REQUIRED_TYPES]);

// Helper to extract symbols from file content using regex
function extractExportedSymbols(content: string): { values: Set<string>; types: Set<string>; all: Set<string> } {
  const values = new Set<string>();
  const types = new Set<string>();
  const all = new Set<string>();

  // Matches: export { symbol1, symbol2 }
  const valueExportsRegex = /export\s+\{([^}]+)\}/g;
  // Matches: export type { symbol1, symbol2 }
  const typeExportsRegex = /export\s+type\s+\{([^}]+)\}/g;

  let match;
  while ((match = valueExportsRegex.exec(content)) !== null) {
    // Check if it's not "export type {"
    const matchIndex = match.index;
    const prefix = content.slice(Math.max(0, matchIndex - 10), matchIndex);
    if (prefix.includes('type')) {
      continue;
    }
    const symbols = match[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const sym of symbols) {
      values.add(sym);
      all.add(sym);
    }
  }

  // Reset regex
  valueExportsRegex.lastIndex = 0;

  while ((match = typeExportsRegex.exec(content)) !== null) {
    const symbols = match[1].split(',').map(s => s.trim()).filter(Boolean);
    for (const sym of symbols) {
      types.add(sym);
      all.add(sym);
    }
  }

  // Also support direct exports if anyone writes "export function symbol" or "export declare function symbol"
  const directExportRegex = /export\s+(?:declare\s+)?(?:async\s+)?(?:function|const|type|interface|class)\s+([a-zA-Z0-9_]+)/g;
  while ((match = directExportRegex.exec(content)) !== null) {
    const sym = match[1];
    all.add(sym);
    // Categorize
    if (content.includes(`interface ${sym}`) || content.includes(`type ${sym}`)) {
      types.add(sym);
    } else {
      values.add(sym);
    }
  }

  return { values, types, all };
}

function runValidation() {
  const sourcePath = path.join(root, 'packages', 'cli', 'src', 'commands', 'tasks', 'public-surface.ts');
  const releaseJsPath = path.join(root, 'release', 'atm-root-drop', 'packages/cli', 'dist', 'commands', 'tasks', 'public-surface.js');
  const releaseSourcePath = path.join(root, 'release', 'atm-root-drop', 'packages/cli', 'src', 'commands', 'tasks', 'public-surface.ts');

  // Check if source contract exists
  if (!existsSync(sourcePath)) {
    fail('ATM_TASKS_COMMAND_SURFACE_BREACH', `Source public contract file not found at ${sourcePath}`);
  }

  // A. Validate source-side against invariants
  const sourceContent = readFileSync(sourcePath, 'utf8');
  const sourceExports = extractExportedSymbols(sourceContent);

  const missingFromSource: string[] = [];
  for (const sym of ALL_REQUIRED_SYMBOLS) {
    if (!sourceExports.all.has(sym)) {
      missingFromSource.push(sym);
    }
  }

  if (missingFromSource.length > 0) {
    fail(
      'ATM_TASKS_COMMAND_SURFACE_BREACH',
      `Source public surface contract is missing required symbol(s): ${missingFromSource.join(', ')}`
    );
  }

  // B. Validate release-side files (Divergence / Drift Check)
  if (!existsSync(releaseJsPath) || !existsSync(releaseSourcePath)) {
    fail(
      'ATM_TASKS_COMMAND_SURFACE_DRIFT',
      `Release artifacts not built. Missing files: ${!existsSync(releaseJsPath) ? releaseJsPath : ''} ${!existsSync(releaseSourcePath) ? releaseSourcePath : ''}. Please run "npm run build" to synchronize.`
    );
  }

  const releaseJsContent = readFileSync(releaseJsPath, 'utf8');
  const releaseSourceContent = readFileSync(releaseSourcePath, 'utf8');

  const releaseJsExports = extractExportedSymbols(releaseJsContent);
  const releaseSourceExports = extractExportedSymbols(releaseSourceContent);

  // Divergence check for runtime values in JS
  const missingValuesInRelease: string[] = [];
  for (const val of REQUIRED_VALUES) {
    if (!releaseJsExports.all.has(val)) {
      missingValuesInRelease.push(val);
    }
  }

  if (missingValuesInRelease.length > 0) {
    fail(
      'ATM_TASKS_COMMAND_SURFACE_DRIFT',
      `Release-side JS drop has diverged from source. Missing values: ${missingValuesInRelease.join(', ')}. Run "npm run build".`
    );
  }

  // Divergence check for the root-drop TypeScript source contract. The current
  // CLI package build does not emit per-module .d.ts files, so the root-drop
  // source copy is the release-side type authority.
  const missingSymbolsInReleaseSource: string[] = [];
  for (const sym of ALL_REQUIRED_SYMBOLS) {
    if (!releaseSourceExports.all.has(sym)) {
      missingSymbolsInReleaseSource.push(sym);
    }
  }

  if (missingSymbolsInReleaseSource.length > 0) {
    fail(
      'ATM_TASKS_COMMAND_SURFACE_DRIFT',
      `Release-side TypeScript source drop has diverged from source. Missing symbols: ${missingSymbolsInReleaseSource.join(', ')}. Run "npm run build".`
    );
  }

  console.log(`[tasks-surface-validator:${mode}] PASS: Tasks command surface contract verified.`);
}

try {
  runValidation();
} catch (err) {
  if (process.exitCode !== 1) {
    console.error(err);
    process.exit(1);
  }
}
