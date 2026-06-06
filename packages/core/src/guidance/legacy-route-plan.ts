export type LegacySegmentRole = 'trunk' | 'leaf' | 'adapter-boundary';
export type LegacySegmentRiskLevel = 'low' | 'medium' | 'high';

export interface LegacyRoutePlanSegment {
  readonly symbolName: string;
  readonly role: LegacySegmentRole;
  readonly riskLevel: LegacySegmentRiskLevel;
  readonly fanOut: number;
  readonly callerDemand: number;
  readonly existingAtomMatch: string | null;
  readonly recommendedBehavior: 'atomize' | 'infect' | 'split' | 'leave-in-place';
}

export interface LegacyRoutePlan {
  readonly schemaId: 'atm.legacyRoutePlan';
  readonly specVersion: '0.1.0';
  readonly targetFile: string;
  readonly segments: readonly LegacyRoutePlanSegment[];
  readonly trunkFunctions: readonly string[];
  readonly leafFunctions: readonly string[];
  readonly adapterBoundaries: readonly string[];
  readonly existingAtomMatches: readonly string[];
  readonly releaseBlockers: readonly string[];
  readonly safeFirstAtoms: readonly string[];
  readonly noTouchZones: readonly string[];
  readonly requiredDryRunProposal: boolean;
}

export function isLegacyRoutePlan(value: unknown): value is LegacyRoutePlan {
  const candidate = value as Partial<LegacyRoutePlan> | null;
  return Boolean(
    candidate
    && candidate.schemaId === 'atm.legacyRoutePlan'
    && typeof candidate.targetFile === 'string'
    && Array.isArray(candidate.segments)
  );
}

export function hasTrunkSegments(plan: LegacyRoutePlan): boolean {
  return plan.segments.some((segment) => segment.role === 'trunk');
}

export interface ExistingAtomMatchInput {
  readonly symbolName: string;
  readonly atomId: string;
  readonly fingerprint?: string;
}

export interface CallerDistributionInput {
  readonly symbolName: string;
  readonly callerCount: number;
}

export interface BuildLegacyRoutePlanInput {
  readonly sourceText: string;
  readonly targetFile: string;
  readonly releaseBlockerSymbols?: readonly string[];
  readonly existingAtomMatches?: readonly ExistingAtomMatchInput[];
  readonly callerDistribution?: Readonly<Record<string, number>> | readonly CallerDistributionInput[];
  readonly noTouchZones?: readonly string[];
  readonly demandThreshold?: number;
  readonly fanOutThreshold?: number;
}

interface ParsedFunctionSymbol {
  readonly symbolName: string;
  readonly fanOut: number;
}

export async function buildLegacyRoutePlan(input: BuildLegacyRoutePlanInput): Promise<LegacyRoutePlan> {
  const releaseBlockerSymbols = new Set(input.releaseBlockerSymbols ?? []);
  const existingAtomMatches = new Map((input.existingAtomMatches ?? []).map((entry) => [entry.symbolName, entry.atomId]));
  const callerDistribution = normalizeCallerDistribution(input.callerDistribution ?? {});
  const demandThreshold = input.demandThreshold ?? 6;
  const fanOutThreshold = input.fanOutThreshold ?? 5;
  const parsedFunctions = await parseFunctionSymbols(input.sourceText, input.targetFile);
  const segments = parsedFunctions.map((entry) => {
    const callerDemand = callerDistribution.get(entry.symbolName) ?? 0;
    const role = classifyRole(entry, releaseBlockerSymbols, fanOutThreshold);
    const existingAtomMatch = existingAtomMatches.get(entry.symbolName) ?? null;
    const recommendedBehavior = chooseRecommendedBehavior({
      role,
      existingAtomMatch,
      callerDemand,
      demandThreshold
    });
    return {
      symbolName: entry.symbolName,
      role,
      riskLevel: classifyRisk(role, callerDemand, demandThreshold),
      fanOut: entry.fanOut,
      callerDemand,
      existingAtomMatch,
      recommendedBehavior
    } satisfies LegacyRoutePlanSegment;
  });
  const trunkFunctions = segments.filter((segment) => segment.role === 'trunk').map((segment) => segment.symbolName);
  const leafFunctions = segments.filter((segment) => segment.role === 'leaf').map((segment) => segment.symbolName);
  const adapterBoundaries = segments.filter((segment) => segment.role === 'adapter-boundary').map((segment) => segment.symbolName);
  const safeFirstAtoms = segments
    .filter((segment) => segment.role === 'leaf' && segment.recommendedBehavior !== 'leave-in-place')
    .map((segment) => segment.symbolName);
  const noTouchZones = Array.from(new Set([
    ...(input.noTouchZones ?? []),
    ...trunkFunctions.map((symbolName) => `${input.targetFile}#${symbolName}`)
  ]));

  return {
    schemaId: 'atm.legacyRoutePlan',
    specVersion: '0.1.0',
    targetFile: input.targetFile,
    segments,
    trunkFunctions,
    leafFunctions,
    adapterBoundaries,
    existingAtomMatches: Array.from(new Set([...existingAtomMatches.values()])),
    releaseBlockers: [...releaseBlockerSymbols],
    safeFirstAtoms,
    noTouchZones,
    requiredDryRunProposal: true
  };
}

function normalizeCallerDistribution(input: Readonly<Record<string, number>> | readonly CallerDistributionInput[]): Map<string, number> {
  if (Array.isArray(input)) {
    return new Map(input.map((entry) => [entry.symbolName, entry.callerCount]));
  }
  return new Map(Object.entries(input).map(([symbolName, callerCount]) => [symbolName, Number(callerCount) || 0]));
}

async function parseFunctionSymbols(sourceText: string, targetFile: string): Promise<readonly ParsedFunctionSymbol[]> {
  if (isPythonLikeFile(targetFile)) {
    return parsePythonFunctionSymbols(sourceText);
  }
  if (prefersTypescriptParser(targetFile)) {
    const ts = await tryLoadTypescript();
    if (ts) {
      return parseTypescriptFunctionSymbols(ts, sourceText, targetFile);
    }
    return parseBraceFunctionSymbols(sourceText);
  }
  if (isBraceLanguageFile(targetFile)) {
    return parseBraceFunctionSymbols(sourceText);
  }
  return parseGenericFunctionSymbols(sourceText);
}

async function tryLoadTypescript(): Promise<typeof import('typescript') | null> {
  try {
    return await import('typescript');
  } catch {
    return null;
  }
}

function prefersTypescriptParser(targetFile: string): boolean {
  return /\.(?:[cm]?js|[cm]?ts|tsx|jsx)$/i.test(targetFile);
}

function isPythonLikeFile(targetFile: string): boolean {
  return /\.py(?:i)?$/i.test(targetFile);
}

function isBraceLanguageFile(targetFile: string): boolean {
  return /\.(?:java|kt|kts|scala|groovy|go|rs|cs|php|swift|c|cc|cpp|cxx|h|hpp|m|mm)$/i.test(targetFile);
}

function parseTypescriptFunctionSymbols(ts: typeof import('typescript'), sourceText: string, targetFile: string): readonly ParsedFunctionSymbol[] {
  const scriptKind = targetFile.endsWith('.js') || targetFile.endsWith('.mjs') || targetFile.endsWith('.cjs')
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(targetFile, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols: ParsedFunctionSymbol[] = [];

  function visit(node: import('typescript').Node): void {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      symbols.push({ symbolName: node.name.text, fanOut: countTypescriptFanOut(ts, node.body) });
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer)) {
        symbols.push({ symbolName: node.name.text, fanOut: countTypescriptFanOut(ts, node.initializer.body) });
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return symbols;
}

function countTypescriptFanOut(ts: typeof import('typescript'), node: import('typescript').Node): number {
  const callees = new Set<string>();
  function visit(child: import('typescript').Node): void {
    if (ts.isCallExpression(child)) {
      const expression = child.expression;
      if (ts.isIdentifier(expression)) {
        callees.add(expression.text);
      } else if (ts.isPropertyAccessExpression(expression)) {
        callees.add(expression.name.text);
      }
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return callees.size;
}

function parsePythonFunctionSymbols(sourceText: string): readonly ParsedFunctionSymbol[] {
  const lines = sourceText.split(/\r?\n/);
  const symbols: ParsedFunctionSymbol[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^(\s*)(?:async\s+def|def)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (!match) {
      continue;
    }
    const symbolName = match[2];
    if (seen.has(symbolName)) {
      continue;
    }
    seen.add(symbolName);
    const indent = match[1].length;
    const bodyLines = collectIndentedBody(lines, index + 1, indent);
    symbols.push({ symbolName, fanOut: countTextFanOut(bodyLines.join('\n')) });
  }
  return symbols;
}

function parseBraceFunctionSymbols(sourceText: string): readonly ParsedFunctionSymbol[] {
  const lines = sourceText.split(/\r?\n/);
  const symbols: ParsedFunctionSymbol[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const declarationMatch = matchBraceFunctionDeclaration(line);
    if (!declarationMatch) {
      continue;
    }
    const symbolName = declarationMatch[1];
    if (seen.has(symbolName)) {
      continue;
    }
    seen.add(symbolName);
    const bodyText = collectBraceBody(lines, index);
    symbols.push({ symbolName, fanOut: countTextFanOut(bodyText) });
  }
  return symbols;
}

function matchBraceFunctionDeclaration(line: string): RegExpExecArray | null {
  const jsStyleDeclaration = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/.exec(line)
    ?? /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][A-Za-z0-9_$]*\s*=>)/.exec(line)
    ?? /^\s*(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line)
    ?? /^\s*func(?:\s*\([^)]*\))?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line)
    ?? /^\s*(?:public|private|protected|internal|override|open|final|abstract|suspend|async|\s)*fun\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
  if (jsStyleDeclaration) {
    return jsStyleDeclaration;
  }
  const javaLikeDeclaration = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|async|synchronized|virtual|override|sealed|readonly|native|extern|open|inline|unsafe|friend|constexpr)\s+)*(?:<[^>]+>\s*)?(?:[A-Za-z_$][A-Za-z0-9_$<>\[\],.?]*\s+)+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^;{}]*\)\s*(?:\{|$)/.exec(line);
  if (!javaLikeDeclaration) {
    return null;
  }
  const symbolName = javaLikeDeclaration[1];
  if (new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'class', 'interface']).has(symbolName)) {
    return null;
  }
  return javaLikeDeclaration;
}

function parseGenericFunctionSymbols(sourceText: string): readonly ParsedFunctionSymbol[] {
  const merged = [...parsePythonFunctionSymbols(sourceText), ...parseBraceFunctionSymbols(sourceText)];
  const seen = new Set<string>();
  return merged.filter((entry) => {
    if (seen.has(entry.symbolName)) {
      return false;
    }
    seen.add(entry.symbolName);
    return true;
  });
}

function collectIndentedBody(lines: readonly string[], startIndex: number, parentIndent: number): readonly string[] {
  const body: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim().length === 0) {
      body.push(line);
      continue;
    }
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= parentIndent) {
      break;
    }
    body.push(line);
  }
  return body;
}

function collectBraceBody(lines: readonly string[], startIndex: number): string {
  let braceDepth = 0;
  let sawOpeningBrace = false;
  const body: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index];
    body.push(line);
    for (const char of line) {
      if (char === '{') {
        braceDepth += 1;
        sawOpeningBrace = true;
      } else if (char === '}') {
        braceDepth = Math.max(0, braceDepth - 1);
      }
    }
    if (!sawOpeningBrace && line.includes('=>')) {
      break;
    }
    if (sawOpeningBrace && braceDepth === 0) {
      break;
    }
  }
  return body.join('\n');
}

function countTextFanOut(sourceText: string): number {
  const keywords = new Set([
    'if',
    'for',
    'while',
    'switch',
    'catch',
    'return',
    'function',
    'def',
    'class',
    'new',
    'await',
    'typeof',
    'elif',
    'print'
  ]);
  const callees = new Set<string>();
  const identifierCallPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  const propertyCallPattern = /\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = identifierCallPattern.exec(sourceText)) !== null) {
    const callee = match[1];
    if (!keywords.has(callee)) {
      callees.add(callee);
    }
  }
  while ((match = propertyCallPattern.exec(sourceText)) !== null) {
    const callee = match[1];
    if (!keywords.has(callee)) {
      callees.add(callee);
    }
  }
  return callees.size;
}

function classifyRole(entry: ParsedFunctionSymbol, releaseBlockerSymbols: ReadonlySet<string>, fanOutThreshold: number): LegacySegmentRole {
  if (releaseBlockerSymbols.has(entry.symbolName) || entry.fanOut >= fanOutThreshold) {
    return 'trunk';
  }
  if (/adapter|boundary|bridge|mount|hydrate|emit|render/i.test(entry.symbolName)) {
    return 'adapter-boundary';
  }
  return 'leaf';
}

function classifyRisk(role: LegacySegmentRole, callerDemand: number, demandThreshold: number): LegacySegmentRiskLevel {
  if (role === 'trunk') {
    return 'high';
  }
  if (role === 'adapter-boundary' || callerDemand >= demandThreshold) {
    return 'medium';
  }
  return 'low';
}

function chooseRecommendedBehavior(input: {
  readonly role: LegacySegmentRole;
  readonly existingAtomMatch: string | null;
  readonly callerDemand: number;
  readonly demandThreshold: number;
}): LegacyRoutePlanSegment['recommendedBehavior'] {
  if (input.role === 'trunk') {
    return 'leave-in-place';
  }
  if (input.existingAtomMatch) {
    return 'infect';
  }
  if (input.callerDemand >= input.demandThreshold) {
    return 'split';
  }
  return 'atomize';
}
