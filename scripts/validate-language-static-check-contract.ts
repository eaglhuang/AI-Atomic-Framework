import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createJavaScriptLanguageAdapter, detectProjectProfile as detectJavaScriptProjectProfile } from '../packages/language-js/src/index.ts';
import { createPythonLanguageAdapter, detectPythonProjectProfile } from '../packages/language-python/src/index.ts';
import { createCSharpLanguageAdapter, detectCSharpProjectProfile } from '../packages/language-csharp/src/index.ts';
import { inspectRuntimeAdapterReadiness, type RuntimeLanguageAdapterStaticCheckHint } from '../packages/cli/src/commands/runtime-adapter-readiness.ts';

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const requestedSuite = process.argv.includes('--suite')
  ? process.argv[process.argv.indexOf('--suite') + 1]
  : 'all';

function fail(message: string) {
  console.error(`[language-static-check-contract:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function parseSuites(value: string): Set<string> {
  const normalized = (value || 'all')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0 || normalized.includes('all')) {
    return new Set(['js', 'python', 'csharp']);
  }
  return new Set(normalized);
}

function findStaticHint(
  hints: readonly RuntimeLanguageAdapterStaticCheckHint[],
  adapterPackage: string
): RuntimeLanguageAdapterStaticCheckHint | undefined {
  return hints.find((entry) => entry.adapterPackage === adapterPackage);
}

function assertPlanCommands(label: string, actual: readonly string[], expected: readonly string[]) {
  assert(actual.length === expected.length, `${label} must expose ${expected.length} commands (got ${actual.join(', ')}).`);
  for (const command of expected) {
    assert(actual.includes(command), `${label} missing command ${command}.`);
  }
}

const selectedSuites = parseSuites(requestedSuite);
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-language-static-contract-'));

try {
  if (selectedSuites.has('js')) {
    const repositoryRoot = path.join(tempRoot, 'js-repo');
    mkdirSync(path.join(repositoryRoot, 'src'), { recursive: true });
    writeFileSync(path.join(repositoryRoot, 'package.json'), JSON.stringify({
      name: 'fixture-js-repo',
      private: true,
      scripts: {
        test: 'vitest run',
        typecheck: 'tsc --noEmit',
        lint: 'eslint .'
      }
    }, null, 2));
    writeFileSync(path.join(repositoryRoot, 'package-lock.json'), '{}\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'src', 'index.ts'), 'export function run(): void {}\n', 'utf8');

    const adapter = createJavaScriptLanguageAdapter();
    const profile = detectJavaScriptProjectProfile(repositoryRoot);
    const fast = adapter.getFastStaticCheck(profile);
    const standard = adapter.getDefaultStaticCheck(profile);
    const all = adapter.getAllStaticCheck(profile);
    assert(fast.tier === 'fast', 'JS fast static tier must be fast.');
    assertPlanCommands('JS fast static plan', fast.commands, ['npm run typecheck']);
    assertPlanCommands('JS default static plan', standard.commands, ['npm run typecheck', 'npm run lint']);
    assertPlanCommands('JS all static plan', all.commands, ['npm run typecheck', 'npm run lint']);

    const readiness = inspectRuntimeAdapterReadiness(repositoryRoot);
    const hint = findStaticHint(readiness.staticCheckHints, '@ai-atomic-framework/language-js');
    assert(hint != null, 'runtime readiness must expose a JS static-check hint.');
    assert(hint?.fastStaticCheck.tier === 'fast', 'JS readiness fast tier must be fast.');
    assertPlanCommands('JS readiness fast static plan', hint?.fastStaticCheck.commands ?? [], ['npm run typecheck']);
    assertPlanCommands('JS readiness default static plan', hint?.defaultStaticCheck.commands ?? [], ['npm run typecheck', 'npm run lint']);
    assertPlanCommands('JS readiness all static plan', hint?.allStaticCheck.commands ?? [], ['npm run typecheck', 'npm run lint']);
  }

  if (selectedSuites.has('python')) {
    const repositoryRoot = path.join(tempRoot, 'python-repo');
    mkdirSync(path.join(repositoryRoot, 'pipelines'), { recursive: true });
    writeFileSync(path.join(repositoryRoot, 'pyproject.toml'), [
      '[tool.poetry]',
      'name = "fixture-python-repo"',
      'version = "0.1.0"',
      '',
      '[project]',
      'name = "fixture-python-repo"',
      'version = "0.1.0"'
    ].join('\n'), 'utf8');
    writeFileSync(path.join(repositoryRoot, 'poetry.lock'), '# fixture\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'requirements.txt'), 'pytest\nmypy\nruff\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'pipelines', 'main.py'), [
      'def main() -> int:',
      '    return 0',
      '',
      'if __name__ == "__main__":',
      '    raise SystemExit(main())'
    ].join('\n'), 'utf8');

    const adapter = createPythonLanguageAdapter();
    const profile = detectPythonProjectProfile(repositoryRoot);
    const fast = adapter.getFastStaticCheck(profile);
    const standard = adapter.getDefaultStaticCheck(profile);
    const all = adapter.getAllStaticCheck(profile);
    assert(fast.tier === 'fast', 'Python fast static tier must be fast.');
    assertPlanCommands('Python fast static plan', fast.commands, ['poetry run mypy .']);
    assertPlanCommands('Python default static plan', standard.commands, ['poetry run mypy .', 'poetry run ruff check .']);
    assertPlanCommands('Python all static plan', all.commands, ['poetry run mypy .', 'poetry run ruff check .']);

    const readiness = inspectRuntimeAdapterReadiness(repositoryRoot);
    const hint = findStaticHint(readiness.staticCheckHints, '@ai-atomic-framework/language-python');
    assert(hint != null, 'runtime readiness must expose a Python static-check hint.');
    assertPlanCommands('Python readiness fast static plan', hint?.fastStaticCheck.commands ?? [], ['poetry run mypy .']);
    assertPlanCommands('Python readiness default static plan', hint?.defaultStaticCheck.commands ?? [], ['poetry run mypy .', 'poetry run ruff check .']);
    assertPlanCommands('Python readiness all static plan', hint?.allStaticCheck.commands ?? [], ['poetry run mypy .', 'poetry run ruff check .']);
  }

  if (selectedSuites.has('csharp')) {
    const repositoryRoot = path.join(tempRoot, 'csharp-repo');
    mkdirSync(repositoryRoot, { recursive: true });
    writeFileSync(path.join(repositoryRoot, 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>\n', 'utf8');
    writeFileSync(path.join(repositoryRoot, 'Program.cs'), [
      'using System;',
      '',
      'public static class Program',
      '{',
      '    public static int Main(string[] args)',
      '    {',
      '        return 0;',
      '    }',
      '}'
    ].join('\n'), 'utf8');

    const adapter = createCSharpLanguageAdapter();
    const profile = detectCSharpProjectProfile(repositoryRoot);
    const fast = adapter.getFastStaticCheck(profile);
    const standard = adapter.getDefaultStaticCheck(profile);
    const all = adapter.getAllStaticCheck(profile);
    assert(fast.tier === 'fast', 'C# fast static tier must be fast.');
    assertPlanCommands('C# fast static plan', fast.commands, ['dotnet build --no-restore']);
    assertPlanCommands('C# default static plan', standard.commands, ['dotnet build --no-restore', 'dotnet format --verify-no-changes']);
    assertPlanCommands('C# all static plan', all.commands, ['dotnet build --no-restore', 'dotnet format --verify-no-changes']);

    const readiness = inspectRuntimeAdapterReadiness(repositoryRoot);
    const hint = findStaticHint(readiness.staticCheckHints, '@ai-atomic-framework/language-csharp');
    assert(hint != null, 'runtime readiness must expose a C# static-check hint.');
    assertPlanCommands('C# readiness fast static plan', hint?.fastStaticCheck.commands ?? [], ['dotnet build --no-restore']);
    assertPlanCommands('C# readiness default static plan', hint?.defaultStaticCheck.commands ?? [], ['dotnet build --no-restore', 'dotnet format --verify-no-changes']);
    assertPlanCommands('C# readiness all static plan', hint?.allStaticCheck.commands ?? [], ['dotnet build --no-restore', 'dotnet format --verify-no-changes']);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[language-static-check-contract:${mode}] ok (suite=${requestedSuite})`);
}
