import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { calculateBrokerDecision } from '../packages/core/src/broker/decision.ts';
import { registerIntent } from '../packages/core/src/broker/registry.ts';
import type { BrokerDecision, WriteBrokerRegistryDocument, WriteIntent, WriteIntentAtomRef } from '../packages/core/src/broker/types.ts';

type CandidateSegment = {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  lineCount: number;
};

type FileCandidate = {
  path: string;
  score: number;
  reasons: string[];
  segments: CandidateSegment[];
  suggestedPair: [CandidateSegment, CandidateSegment] | null;
  brokerPreview: {
    positiveDecision: BrokerDecision;
    virtualAtomConflictDecision: BrokerDecision;
    activeSegment: CandidateSegment;
    candidateSegment: CandidateSegment;
    conflictSegment: CandidateSegment;
    activeAtom: WriteIntentAtomRef;
    candidateAtom: WriteIntentAtomRef;
    conflictAtom: WriteIntentAtomRef;
  } | null;
};

type CliOptions = {
  cwd: string;
  roots: string[];
  top: number;
  json: boolean;
  includeTests: boolean;
};

const DEFAULT_ROOTS = [
  'packages/cli/src/commands',
  'packages/core/src',
  'scripts'
];

const EXCLUDED_DIRECTORY_NAMES = new Set([
  'dist',
  'node_modules',
  'release',
  'fixtures',
  '__snapshots__'
]);

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    cwd: process.cwd(),
    roots: [...DEFAULT_ROOTS],
    top: 10,
    json: false,
    includeTests: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = path.resolve(String(argv[index + 1] ?? options.cwd));
      index += 1;
      continue;
    }
    if (arg === '--root') {
      options.roots.push(String(argv[index + 1] ?? ''));
      index += 1;
      continue;
    }
    if (arg === '--roots') {
      const raw = String(argv[index + 1] ?? '');
      options.roots = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
      index += 1;
      continue;
    }
    if (arg === '--top') {
      const parsed = Number.parseInt(String(argv[index + 1] ?? ''), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        options.top = parsed;
      }
      index += 1;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--include-tests') {
      options.includeTests = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  options.roots = [...new Set(options.roots.map((entry) => entry.trim()).filter(Boolean))];
  return options;
}

function printHelp() {
  console.log([
    'Usage: node --strip-types scripts/find-positive-merge-candidates.ts [options]',
    '',
    'Options:',
    '  --cwd <dir>            Repository root to scan.',
    '  --roots <a,b,c>        Comma-separated roots to scan.',
    '  --root <dir>           Add one more scan root.',
    '  --top <n>              Number of ranked files to print. Default: 10.',
    '  --json                 Emit JSON instead of Markdown-ish text.',
    '  --include-tests        Include *.spec.ts / *.test.ts files.',
    '  --help                 Show this message.'
  ].join('\n'));
}

function shouldSkipFile(filePath: string, includeTests: boolean): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  if (!normalized.endsWith('.ts')) return true;
  if (normalized.endsWith('.d.ts')) return true;
  if (!includeTests && /\.(spec|test)\.ts$/.test(normalized)) return true;
  if (normalized.includes('/__tests__/')) return true;
  if (normalized.includes('/temp/')) return true;
  return false;
}

function listTypeScriptFiles(root: string, includeTests: boolean): string[] {
  if (!path.isAbsolute(root) || !safeExists(root)) return [];
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORY_NAMES.has(entry.name)) {
          pending.push(absolutePath);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      if (!shouldSkipFile(absolutePath, includeTests)) {
        files.push(absolutePath);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function safeExists(targetPath: string): boolean {
  try {
    return statSync(targetPath).isDirectory() || statSync(targetPath).isFile();
  } catch {
    return false;
  }
}

function declarationName(node: ts.Node, sourceFile: ts.SourceFile): string {
  if (
    ts.isFunctionDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
  ) {
    return node.name?.getText(sourceFile) ?? '<anonymous>';
  }
  if (ts.isVariableStatement(node)) {
    const names = node.declarationList.declarations
      .map((entry) => entry.name.getText(sourceFile))
      .filter(Boolean);
    return names.join(', ');
  }
  if (ts.isExportDeclaration(node)) {
    return node.moduleSpecifier?.getText(sourceFile) ?? 'export-declaration';
  }
  return ts.SyntaxKind[node.kind] ?? 'Unknown';
}

function declarationKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isVariableStatement(node)) return 'variable';
  if (ts.isExportDeclaration(node)) return 'export';
  return 'other';
}

function topLevelDeclarations(sourceFile: ts.SourceFile): CandidateSegment[] {
  const declarations: CandidateSegment[] = [];
  for (const node of sourceFile.statements) {
    const supported = ts.isFunctionDeclaration(node)
      || ts.isClassDeclaration(node)
      || ts.isInterfaceDeclaration(node)
      || ts.isTypeAliasDeclaration(node)
      || ts.isEnumDeclaration(node)
      || ts.isVariableStatement(node)
      || ts.isExportDeclaration(node);
    if (!supported) continue;
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
    const lineCount = Math.max(1, end - start + 1);
    declarations.push({
      name: declarationName(node, sourceFile),
      kind: declarationKind(node),
      startLine: start,
      endLine: end,
      lineCount
    });
  }
  return declarations;
}

function chooseSuggestedPair(segments: CandidateSegment[]): [CandidateSegment, CandidateSegment] | null {
  const viable = segments.filter((segment) => segment.lineCount >= 8 && segment.lineCount <= 220);
  const functionFirst = viable.filter((segment) => segment.kind === 'function' || segment.kind === 'class');
  const pool = functionFirst.length >= 2 ? functionFirst : viable;
  let bestPair: [CandidateSegment, CandidateSegment] | null = null;
  let bestScore = -1;
  for (let leftIndex = 0; leftIndex < pool.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < pool.length; rightIndex += 1) {
      const left = pool[leftIndex];
      const right = pool[rightIndex];
      const distance = Math.abs(right.startLine - left.endLine);
      const sizeBalance = 1 - Math.min(1, Math.abs(left.lineCount - right.lineCount) / 120);
      const spacingScore = Math.min(1, distance / 200);
      const typeDiversity = left.kind === right.kind ? 0.1 : 0.3;
      const functionBonus = (left.kind === 'function' ? 1 : 0) + (right.kind === 'function' ? 1 : 0);
      const score = left.lineCount + right.lineCount + sizeBalance * 30 + spacingScore * 20 + typeDiversity * 10 + functionBonus * 12;
      if (score > bestScore) {
        bestScore = score;
        bestPair = [left, right];
      }
    }
  }
  return bestPair;
}

function makeAtomRef(filePath: string, segment: CandidateSegment, mode: 'self' | 'shared'): WriteIntentAtomRef {
  const baseName = `${filePath.replace(/[\\/]/g, '::')}#${segment.name}`.replace(/\s+/g, '-');
  const atomId = mode === 'shared' ? `shared:${baseName}` : `segment:${baseName}`;
  const atomCid = atomId.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    atomId,
    atomCid,
    operation: 'modify',
    sourceRange: {
      filePath,
      lineStart: segment.startLine,
      lineEnd: segment.endLine
    }
  };
}

function emptyRegistry(): WriteBrokerRegistryDocument {
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'local-repo',
    workspaceId: 'main',
    currentEpoch: Date.now(),
    activeIntents: []
  };
}

function makeIntent(input: {
  taskId: string;
  actorId: string;
  filePath: string;
  atomRef: WriteIntentAtomRef;
}): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'pre-patch broker simulation' },
    taskId: input.taskId,
    actorId: input.actorId,
    baseCommit: 'prepatch-scan',
    targetFiles: [input.filePath],
    atomRefs: [input.atomRef],
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: []
    },
    requestedLane: 'auto'
  };
}

function simulateBrokerPreview(
  filePath: string,
  activeSegment: CandidateSegment,
  candidateSegment: CandidateSegment
): FileCandidate['brokerPreview'] {
  const activeAtom = makeAtomRef(filePath, activeSegment, 'self');
  const candidateAtom = makeAtomRef(filePath, candidateSegment, 'self');
  const conflictAtom = makeAtomRef(filePath, activeSegment, 'shared');

  const activeIntent = makeIntent({
    taskId: 'TASK-PREPATCH-A',
    actorId: 'prepatch:a',
    filePath,
    atomRef: activeAtom
  });
  const positiveIntent = makeIntent({
    taskId: 'TASK-PREPATCH-B',
    actorId: 'prepatch:b',
    filePath,
    atomRef: candidateAtom
  });
  const conflictSeedIntent = makeIntent({
    taskId: 'TASK-PREPATCH-C',
    actorId: 'prepatch:c',
    filePath,
    atomRef: conflictAtom
  });
  const conflictFollowerIntent = makeIntent({
    taskId: 'TASK-PREPATCH-D',
    actorId: 'prepatch:d',
    filePath,
    atomRef: conflictAtom
  });

  const positiveRegistry = registerIntent(emptyRegistry(), activeIntent, 'direct-brokered');
  const conflictRegistry = registerIntent(emptyRegistry(), conflictSeedIntent, 'direct-brokered');

  return {
    positiveDecision: calculateBrokerDecision(positiveIntent, positiveRegistry),
    virtualAtomConflictDecision: calculateBrokerDecision(conflictFollowerIntent, conflictRegistry),
    activeSegment,
    candidateSegment,
    conflictSegment: activeSegment,
    activeAtom,
    candidateAtom,
    conflictAtom
  };
}

function scoreFile(relativePath: string, sourceText: string, segments: CandidateSegment[]): FileCandidate | null {
  const totalLines = sourceText.split(/\r?\n/).length;
  if (totalLines < 120 || totalLines > 1400) return null;
  if (segments.length < 4) return null;

  let score = 0;
  const reasons: string[] = [];
  const viableSegments = segments.filter((segment) => segment.lineCount >= 8 && segment.lineCount <= 220);
  const pair = chooseSuggestedPair(segments);
  if (!pair) return null;
  const brokerPreview = simulateBrokerPreview(relativePath, pair[0], pair[1]);
  if (brokerPreview.positiveDecision.verdict !== 'parallel-safe') {
    return null;
  }
  if (brokerPreview.virtualAtomConflictDecision.verdict !== 'blocked-cid-conflict') {
    return null;
  }

  score += Math.min(35, viableSegments.length * 4);
  reasons.push(`頂層宣告 ${segments.length} 個，可切成多個獨立修改面。`);

  if (totalLines >= 180 && totalLines <= 900) {
    score += 20;
    reasons.push(`檔案大小 ${totalLines} 行，介於中大型甜蜜區。`);
  } else if (totalLines <= 1200) {
    score += 10;
    reasons.push(`檔案大小 ${totalLines} 行，仍可控但需要較嚴格切段。`);
  }

  const [left, right] = pair;
  const separation = right.startLine - left.endLine;
  if (separation >= 20) {
    score += 18;
    reasons.push(`建議段落相距約 ${separation} 行，較容易形成非重疊 patch。`);
  } else {
    score += 8;
    reasons.push('可切雙段，但兩段距離較近，需要更小心挑 patch 邊界。');
  }

  const pathBonus = scorePathBonus(relativePath);
  score += pathBonus.score;
  reasons.push(...pathBonus.reasons);
  reasons.push(`broker 模擬: A 先 claim ${left.name}，B 改 ${right.name} => ${brokerPreview.positiveDecision.verdict}/${brokerPreview.positiveDecision.lane}。`);
  reasons.push(`broker 模擬: 若雙方都改 ${left.name} => ${brokerPreview.virtualAtomConflictDecision.verdict}/${brokerPreview.virtualAtomConflictDecision.lane}。`);

  return {
    path: relativePath,
    score,
    reasons,
    segments,
    suggestedPair: pair,
    brokerPreview
  };
}

function scorePathBonus(relativePath: string): { score: number; reasons: string[] } {
  const normalized = relativePath.replace(/\\/g, '/');
  const reasons: string[] = [];
  let score = 0;

  if (normalized.includes('/taskflow/')) {
    score += 10;
    reasons.push('taskflow 子域通常有明確 helper 與 orchestration 邊界。');
  }
  if (normalized.includes('/broker/')) {
    score += 9;
    reasons.push('broker 子域天然適合驗證多代理同檔協作語意。');
  }
  if (/close-orchestration\.ts$/.test(normalized)) {
    score += 18;
    reasons.push('此檔已接近真實 dogfood 熱區，論文說服力高。');
  }
  if (/team-lane\.ts$/.test(normalized)) {
    score += 16;
    reasons.push('此檔直接承接 broker lane/evidence，與論文主題高度對齊。');
  }
  if (/integration\.ts$/.test(normalized)) {
    score += 12;
    reasons.push('integration 主題真實、可拆面多，且比 team.ts 更容易做正向同檔 merge。');
  }
  if (/team\.ts$/.test(normalized)) {
    score -= 28;
    reasons.push('team.ts 過熱且過大，較適合衝突案例，不是第一個正向 merge 樣本。');
  }
  if (/validate-team-agents\.ts$/.test(normalized)) {
    score -= 22;
    reasons.push('validator 巨檔容易把 unrelated 測例一起捲進來。');
  }
  if (/index\.ts$/.test(normalized)) {
    score -= 12;
    reasons.push('index 聚合檔通常變更太薄，正向 merge 的技術含量不夠。');
  }

  return { score, reasons };
}

function analyzeFile(repoRoot: string, absolutePath: string): FileCandidate | null {
  const sourceText = readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(absolutePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/');
  const segments = topLevelDeclarations(sourceFile);
  return scoreFile(relativePath, sourceText, segments);
}

function formatTextReport(candidates: FileCandidate[]) {
  const lines: string[] = [];
  for (const [index, candidate] of candidates.entries()) {
    lines.push(`${index + 1}. ${candidate.path}`);
    lines.push(`   score: ${candidate.score}`);
    for (const reason of candidate.reasons.slice(0, 5)) {
      lines.push(`   - ${reason}`);
    }
    if (candidate.suggestedPair) {
      const [left, right] = candidate.suggestedPair;
      lines.push(`   - patch A: ${left.kind} ${left.name} (${left.startLine}-${left.endLine})`);
      lines.push(`   - patch B: ${right.kind} ${right.name} (${right.startLine}-${right.endLine})`);
    }
    if (candidate.brokerPreview) {
      lines.push(`   - broker positive: ${candidate.brokerPreview.positiveDecision.verdict} / ${candidate.brokerPreview.positiveDecision.lane}`);
      lines.push(`   - broker virtual-atom conflict: ${candidate.brokerPreview.virtualAtomConflictDecision.verdict} / ${candidate.brokerPreview.virtualAtomConflictDecision.lane}`);
    }
    lines.push('');
  }
  console.log(lines.join('\n').trimEnd());
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(options.cwd);
  const roots = options.roots.map((entry) => path.resolve(repoRoot, entry));
  const files = roots.flatMap((root) => listTypeScriptFiles(root, options.includeTests));
  const candidates = files
    .map((filePath) => analyzeFile(repoRoot, filePath))
    .filter((entry): entry is FileCandidate => entry !== null)
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, options.top);

  if (options.json) {
    console.log(JSON.stringify({
      schemaId: 'atm.prePatchPositiveMergeCandidates.v1',
      generatedAt: new Date().toISOString(),
      cwd: repoRoot.replace(/\\/g, '/'),
      roots: options.roots,
      candidates
    }, null, 2));
    return;
  }

  formatTextReport(candidates);
}

main();
