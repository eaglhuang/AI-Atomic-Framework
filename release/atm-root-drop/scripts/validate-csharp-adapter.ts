import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCSharpLanguageAdapter,
  detectCSharpProjectProfile,
  scanCSharpEntrypoints,
  scanCSharpImports,
  validateCSharpComputeAtom
} from '../packages/language-csharp/src/index.ts';
import { inspectRuntimeAdapterReadiness } from '../packages/cli/src/commands/runtime-adapter-readiness.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string) {
  console.error(`[csharp-adapter:${mode}] ${message}`);
  process.exitCode = 1;
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-language-csharp-'));
try {
  const repositoryRoot = path.join(tempRoot, 'repo');
  mkdirSync(repositoryRoot, { recursive: true });
  writeFileSync(path.join(repositoryRoot, 'App.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>\n', 'utf8');
  writeFileSync(path.join(repositoryRoot, 'Program.cs'), [
    'using System;',
    'using System.Threading.Tasks;',
    '',
    'public static class Program',
    '{',
    '    public static int Main(string[] args)',
    '    {',
    '        return 0;',
    '    }',
    '}'
  ].join('\n'), 'utf8');

  const profile = detectCSharpProjectProfile(repositoryRoot);
  if (profile.packageManager !== 'dotnet') {
    fail(`C# profile must detect dotnet package manager (got ${profile.packageManager}).`);
  }
  if (profile.typecheckCommand !== 'dotnet build --no-restore') {
    fail(`C# profile must expose dotnet build --no-restore (got ${profile.typecheckCommand}).`);
  }
  if (profile.lintCommand !== 'dotnet format --verify-no-changes') {
    fail(`C# profile must expose dotnet format --verify-no-changes (got ${profile.lintCommand}).`);
  }

  const adapter = createCSharpLanguageAdapter();
  const fastStaticCheck = adapter.getFastStaticCheck(profile);
  if (fastStaticCheck.commands[0] !== 'dotnet build --no-restore') {
    fail(`C# fast static check must prefer dotnet build --no-restore (got ${fastStaticCheck.commands.join(', ')}).`);
  }
  const defaultStaticCheck = adapter.getDefaultStaticCheck(profile);
  if (!defaultStaticCheck.commands.includes('dotnet build --no-restore') || !defaultStaticCheck.commands.includes('dotnet format --verify-no-changes')) {
    fail('C# default static check must include dotnet build and dotnet format.');
  }
  const allStaticCheck = adapter.getAllStaticCheck(profile);
  if (!allStaticCheck.commands.includes('dotnet build --no-restore') || !allStaticCheck.commands.includes('dotnet format --verify-no-changes')) {
    fail('C# all static check must include the full declared static set.');
  }

  const sourceText = [
    'using System;',
    'using System.IO;',
    '',
    'public static class Program',
    '{',
    '    public static int Main(string[] args)',
    '    {',
    '        return 0;',
    '    }',
    '}'
  ].join('\n');
  const imports = scanCSharpImports({ filePath: 'Program.cs', sourceText });
  if (!imports.some((entry) => entry.specifier === 'System.IO')) {
    fail('scanCSharpImports must detect using System.IO;');
  }
  const entrypoints = scanCSharpEntrypoints({ filePath: 'Program.cs', sourceText });
  if (!entrypoints.some((entry) => entry.symbol === 'Main')) {
    fail('scanCSharpEntrypoints must detect static Main.');
  }

  const validReport = validateCSharpComputeAtom({
    atomId: 'ATM-CS-VALID',
    entrypoint: 'Program.cs',
    sourceFiles: [{ filePath: 'Program.cs', sourceText }]
  }, profile);
  if (!validReport.ok || !validReport.messages.some((entry) => entry.code === 'ATM_CS_VALIDATE_OK')) {
    fail('validateCSharpComputeAtom must pass valid Main entrypoint source.');
  }

  const forbiddenReport = validateCSharpComputeAtom({
    atomId: 'ATM-CS-FORBIDDEN',
    entrypoint: 'Program.cs',
    sourceFiles: [{ filePath: 'Program.cs', sourceText }],
    importPolicy: { forbiddenSpecifiers: ['System.IO'] }
  }, profile);
  if (forbiddenReport.ok || !forbiddenReport.messages.some((entry) => entry.code === 'ATM_CS_FORBIDDEN_IMPORT')) {
    fail('validateCSharpComputeAtom must fail when forbidden imports are present.');
  }

  const missingEntrypointReport = validateCSharpComputeAtom({
    atomId: 'ATM-CS-MISSING',
    entrypoint: 'Worker.cs',
    sourceFiles: [{ filePath: 'Worker.cs', sourceText: 'public class Worker { }\n' }]
  }, profile);
  if (missingEntrypointReport.ok || !missingEntrypointReport.messages.some((entry) => entry.code === 'ATM_CS_ENTRYPOINT_SIGNATURE_MISSING')) {
    fail('validateCSharpComputeAtom must fail when no static Main exists.');
  }

  const readiness = inspectRuntimeAdapterReadiness(repositoryRoot);
  if (!readiness.detectedLanguages.includes('C#')) {
    fail(`runtime readiness must detect C# (got ${JSON.stringify(readiness.detectedLanguages)}).`);
  }
  if (readiness.needsRuntimeAdapterHint) {
    fail('runtime readiness must clear the missing adapter hint once language-csharp is bundled.');
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[csharp-adapter:${mode}] ok (profile detection, static checks, imports, entrypoint validation, runtime readiness)`);
}
