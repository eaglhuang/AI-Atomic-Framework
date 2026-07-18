import type {
  PythonImportPolicy,
  PythonLanguageAdapterMessage,
  PythonStaticCheckPlan
} from '../index.ts';

export function hasEntrypointSignature(sourceText: string): boolean {
  if (/^\s*if\s+__name__\s*==\s*['"]__main__['"]\s*:\s*$/m.test(sourceText)) return true;
  if (/^\s*def\s+main\s*\(/m.test(sourceText)) return true;
  return false;
}

export function message(
  level: PythonLanguageAdapterMessage['level'],
  code: string,
  text: string,
  filePath?: string,
  line?: number
): PythonLanguageAdapterMessage {
  const result: PythonLanguageAdapterMessage = { level, code, text };
  if (filePath) (result as { filePath?: string }).filePath = filePath;
  if (typeof line === 'number') (result as { line?: number }).line = line;
  return result;
}

export function mergePolicy(base: PythonImportPolicy, overrides: Partial<PythonImportPolicy> | undefined): PythonImportPolicy {
  const forbidden = new Set<string>([...base.forbiddenSpecifiers, ...(overrides?.forbiddenSpecifiers ?? [])]);
  const allowed = new Set<string>([...(base.allowedSpecifiers ?? []), ...(overrides?.allowedSpecifiers ?? [])]);
  return Object.freeze({
    forbiddenSpecifiers: [...forbidden],
    allowedSpecifiers: [...allowed]
  });
}

export function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

export function createStaticCheckPlan(
  tier: PythonStaticCheckPlan['tier'],
  commands: readonly string[],
  input: {
    readonly source: PythonStaticCheckPlan['source'];
    readonly kinds: PythonStaticCheckPlan['kinds'];
    readonly guidance: string;
  }
): PythonStaticCheckPlan {
  return {
    tier,
    commands,
    source: input.source,
    scope: 'repository',
    estimatedCost: tier === 'fast' ? 'fast' : tier === 'default' ? 'medium' : 'slow',
    kinds: input.kinds,
    guidance: input.guidance
  };
}
