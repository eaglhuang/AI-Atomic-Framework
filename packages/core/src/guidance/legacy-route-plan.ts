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
  const ts = await import('typescript');
  const releaseBlockerSymbols = new Set(input.releaseBlockerSymbols ?? []);
  const existingAtomMatches = new Map((input.existingAtomMatches ?? []).map((entry) => [entry.symbolName, entry.atomId]));
  const callerDistribution = normalizeCallerDistribution(input.callerDistribution ?? {});
  const demandThreshold = input.demandThreshold ?? 6;
  const fanOutThreshold = input.fanOutThreshold ?? 5;
  const parsedFunctions = parseFunctionSymbols(ts, input.sourceText, input.targetFile);
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

function parseFunctionSymbols(ts: typeof import('typescript'), sourceText: string, targetFile: string): readonly ParsedFunctionSymbol[] {
  const scriptKind = targetFile.endsWith('.js') || targetFile.endsWith('.mjs') || targetFile.endsWith('.cjs')
    ? ts.ScriptKind.JS
    : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(targetFile, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const symbols: ParsedFunctionSymbol[] = [];

  function visit(node: import('typescript').Node): void {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      symbols.push({ symbolName: node.name.text, fanOut: countFanOut(ts, node.body) });
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer)) {
        symbols.push({ symbolName: node.name.text, fanOut: countFanOut(ts, node.initializer.body) });
        return;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return symbols;
}

function countFanOut(ts: typeof import('typescript'), node: import('typescript').Node): number {
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
