export function isLegacyRoutePlan(value) {
    const candidate = value;
    return Boolean(candidate
        && candidate.schemaId === 'atm.legacyRoutePlan'
        && typeof candidate.targetFile === 'string'
        && Array.isArray(candidate.segments));
}
export function hasTrunkSegments(plan) {
    return plan.segments.some((segment) => segment.role === 'trunk');
}
export async function buildLegacyRoutePlan(input) {
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
        };
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
function normalizeCallerDistribution(input) {
    if (Array.isArray(input)) {
        return new Map(input.map((entry) => [entry.symbolName, entry.callerCount]));
    }
    return new Map(Object.entries(input).map(([symbolName, callerCount]) => [symbolName, Number(callerCount) || 0]));
}
async function parseFunctionSymbols(sourceText, targetFile) {
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
async function tryLoadTypescript() {
    try {
        return await import('typescript');
    }
    catch {
        return null;
    }
}
function prefersTypescriptParser(targetFile) {
    return /\.(?:[cm]?js|[cm]?ts|tsx|jsx)$/i.test(targetFile);
}
function isPythonLikeFile(targetFile) {
    return /\.py(?:i)?$/i.test(targetFile);
}
function isBraceLanguageFile(targetFile) {
    return /\.(?:java|kt|kts|scala|groovy|go|rs|cs|php|swift|c|cc|cpp|cxx|h|hpp|m|mm)$/i.test(targetFile);
}
function parseTypescriptFunctionSymbols(ts, sourceText, targetFile) {
    const scriptKind = targetFile.endsWith('.js') || targetFile.endsWith('.mjs') || targetFile.endsWith('.cjs')
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(targetFile, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
    const symbols = [];
    function visit(node) {
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
function countTypescriptFanOut(ts, node) {
    const callees = new Set();
    function visit(child) {
        if (ts.isCallExpression(child)) {
            const expression = child.expression;
            if (ts.isIdentifier(expression)) {
                callees.add(expression.text);
            }
            else if (ts.isPropertyAccessExpression(expression)) {
                callees.add(expression.name.text);
            }
        }
        ts.forEachChild(child, visit);
    }
    visit(node);
    return callees.size;
}
function parsePythonFunctionSymbols(sourceText) {
    const lines = sourceText.split(/\r?\n/);
    const symbols = [];
    const seen = new Set();
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
function parseBraceFunctionSymbols(sourceText) {
    const lines = sourceText.split(/\r?\n/);
    const symbols = [];
    const seen = new Set();
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
function matchBraceFunctionDeclaration(line) {
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
function parseGenericFunctionSymbols(sourceText) {
    const merged = [...parsePythonFunctionSymbols(sourceText), ...parseBraceFunctionSymbols(sourceText)];
    const seen = new Set();
    return merged.filter((entry) => {
        if (seen.has(entry.symbolName)) {
            return false;
        }
        seen.add(entry.symbolName);
        return true;
    });
}
function collectIndentedBody(lines, startIndex, parentIndent) {
    const body = [];
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
function collectBraceBody(lines, startIndex) {
    let braceDepth = 0;
    let sawOpeningBrace = false;
    const body = [];
    for (let index = startIndex; index < lines.length; index += 1) {
        const line = lines[index];
        body.push(line);
        for (const char of line) {
            if (char === '{') {
                braceDepth += 1;
                sawOpeningBrace = true;
            }
            else if (char === '}') {
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
function countTextFanOut(sourceText) {
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
    const callees = new Set();
    const identifierCallPattern = /\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    const propertyCallPattern = /\.([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    let match;
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
function classifyRole(entry, releaseBlockerSymbols, fanOutThreshold) {
    if (releaseBlockerSymbols.has(entry.symbolName) || entry.fanOut >= fanOutThreshold) {
        return 'trunk';
    }
    if (/adapter|boundary|bridge|mount|hydrate|emit|render/i.test(entry.symbolName)) {
        return 'adapter-boundary';
    }
    return 'leaf';
}
function classifyRisk(role, callerDemand, demandThreshold) {
    if (role === 'trunk') {
        return 'high';
    }
    if (role === 'adapter-boundary' || callerDemand >= demandThreshold) {
        return 'medium';
    }
    return 'low';
}
function chooseRecommendedBehavior(input) {
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
