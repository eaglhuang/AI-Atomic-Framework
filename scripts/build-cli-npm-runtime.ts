import { writeBuildIdentity, treeFiles, sourceIdentity } from './release-artifact-manifest.ts';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';
import ts from 'typescript';
import { embeddedATMChartSchemaAssets } from '../packages/cli/src/commands/atm-chart/constants.ts';

const OMITTED_PUBLIC_ASSETS = [
  /^_vendor\/agent-pack-claude-code\/templates\//
] as const;
// Keep the complete Skill reference closure within the installed path budget.
// Only the layout root is compacted; original dist-relative module paths stay intact.
const RUNTIME_LAYOUT_ROOT = 'data';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildCliNpmRuntime(options: { repositoryRoot?: string; sourceDistRoot?: string; outputRoot?: string } = {}) {
  const root = path.resolve(options.repositoryRoot ?? repositoryRoot);
  const buildSourceSnapshot = JSON.stringify(sourceIdentity(root));
  const packageRoot = path.join(root, 'packages', 'cli');
  const sourceDistRoot = path.resolve(options.sourceDistRoot ?? path.join(packageRoot, 'dist'));
  const defaultRuntimeRoot = path.join(sourceDistRoot, 'npm-runtime');
  const runtimeRoot = path.resolve(options.outputRoot ?? defaultRuntimeRoot);
  const contains = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };
  if (runtimeRoot !== defaultRuntimeRoot && (contains(runtimeRoot, sourceDistRoot) || contains(sourceDistRoot, runtimeRoot))) {
    throw new Error('Private npm runtime output must not overlap source dist');
  }
  {
    rmSync(runtimeRoot, { recursive: true, force: true });
    mkdirSync(runtimeRoot, { recursive: true });
    const entrySource = [
      "export * from './index.js';",
      "export { runPublicCli as runCli, publicCliCommandNames } from './atm-public.js';",
      ''
    ].join('\n');

    await build({
      stdin: { contents: entrySource, resolveDir: sourceDistRoot, sourcefile: '.npm-runtime-entry.mjs', loader: 'js' },
      outfile: path.join(runtimeRoot, 'runtime.mjs'),
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'node',
      target: 'node24',
      packages: 'external',
      plugins: [preserveModuleIdentityPlugin(sourceDistRoot)],
      legalComments: 'none',
      logLevel: 'silent'
    });

    writeFileSync(path.join(runtimeRoot, 'atm.mjs'), `${[
      '#!/usr/bin/env node',
      "import { runCli } from './runtime.mjs';",
      '',
      'process.exitCode = await runCli(process.argv.slice(2));'
    ].join('\n')}\n`, 'utf8');
    markExecutable(path.join(runtimeRoot, 'atm.mjs'));
    writeFileSync(path.join(runtimeRoot, 'index.js'), "export * from './runtime.mjs';\n", 'utf8');
    const declarationPath = path.join(root, '.types', 'packages', 'cli', 'src', 'index.d.ts');
    const declaration = existsSync(declarationPath)
      ? readFileSync(declarationPath, 'utf8')
      : emitDeclarationFromSource(path.join(packageRoot, 'src', 'index.ts'));
    writeFileSync(path.join(runtimeRoot, 'index.d.ts'), declaration, 'utf8');

    copyRuntimeAssets(sourceDistRoot, path.join(runtimeRoot, RUNTIME_LAYOUT_ROOT), defaultRuntimeRoot);
    copyAtomizeHelperClosure(root, runtimeRoot);
    if (JSON.stringify(sourceIdentity(root)) !== buildSourceSnapshot) throw new Error('Source inputs changed during npm runtime build');
    const packageVersion = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version as string;
    writeBuildIdentity(root, runtimeRoot, '@ai-atomic-framework/cli', packageVersion, treeFiles(runtimeRoot));
    const files = listFiles(runtimeRoot)
      .map((file) => ({
        path: path.relative(runtimeRoot, file).replace(/\\/g, '/'),
        kind: path.relative(runtimeRoot, file).replace(/\\/g, '/').startsWith(`${RUNTIME_LAYOUT_ROOT}/`)
          ? 'immutable-runtime-asset'
          : 'runtime-entrypoint',
        bytes: statSync(file).size,
        sha256: `sha256:${createHash('sha256').update(readFileSync(file)).digest('hex')}`
      }))
      .sort((left, right) => left.path.localeCompare(right.path));
    const manifest = {
      schemaId: 'atm.cliNpmRuntimeManifest.v1',
      specVersion: '0.1.0',
      entrypoints: {
        bin: 'atm.mjs',
        library: 'index.js',
        types: 'index.d.ts',
        runtime: 'runtime.mjs'
      },
      moduleIdentity: 'original-dist-relative-url',
      layoutRoot: RUNTIME_LAYOUT_ROOT,
      publicSurface: 'adopter-core',
      publicCommands: [
        'next', 'doctor', 'guide', 'init', 'create', 'taskflow', 'welcome',
        'status', 'verify', 'orient', 'evidence', 'lock', 'broker', 'git',
        'integration', 'plan', 'actor', 'identity', 'bootstrap', 'setup', 'start', 'tasks', 'atm-chart', 'atomize'
      ],
      omittedPublicAssets: OMITTED_PUBLIC_ASSETS.map((pattern) => pattern.source),
      embeddedRuntimeAssets: Object.entries(embeddedATMChartSchemaAssets)
        .map(([path, asset]) => ({ path, kind: 'bundled-logical-asset', sha256: asset.sha256 }))
        .sort((left, right) => left.path.localeCompare(right.path)),
      files,
      fileCount: files.length + 1,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0)
    };
    writeFileSync(path.join(runtimeRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`[build-cli-npm-runtime] built ${manifest.fileCount} files / ${manifest.totalBytes} bytes at ${path.relative(root, runtimeRoot)}`);
    return manifest;
  }
}

/** npm links a bin only when it is executable; a rewrite drops that mode. */
function markExecutable(filePath: string): void {
  if (process.platform === 'win32') return;
  try {
    chmodSync(filePath, 0o755);
  } catch {
    // a read-only checkout cannot regress the mode further
  }
}

function emitDeclarationFromSource(sourcePath: string): string {
  const result = ts.transpileDeclaration(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext
    },
    fileName: sourcePath,
    reportDiagnostics: true
  });
  const errors = result.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length > 0) {
    throw new Error(`CLI declaration generation failed: ${errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('; ')}`);
  }
  return result.outputText;
}


function preserveModuleIdentityPlugin(sourceDistRoot: string): Plugin {
  const normalizedRoot = path.resolve(sourceDistRoot);
  return {
    name: 'atm-preserve-module-identity',
    setup(buildApi) {
      buildApi.onLoad({ filter: /\.[cm]?js$/ }, async (args) => {
        const absolutePath = path.resolve(args.path);
        const relativePath = path.relative(normalizedRoot, absolutePath);
        if (relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return null;
        const source = readFileSync(absolutePath, 'utf8');
        if (!source.includes('import.meta.url')) return null;
        const virtualModuleUrl = `./${RUNTIME_LAYOUT_ROOT}/${relativePath.replace(/\\/g, '/')}`;
        return {
          contents: rewriteImportMetaUrls(source, absolutePath, virtualModuleUrl),
          loader: 'js'
        };
      });
    }
  };
}

function rewriteImportMetaUrls(source: string, sourcePath: string, virtualModuleUrl: string): string {
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const ranges: Array<{ start: number; end: number }> = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAccessExpression(node)
      && node.name.text === 'url'
      && ts.isMetaProperty(node.expression)
      && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
      && node.expression.name.text === 'meta') {
      ranges.push({ start: node.getStart(sourceFile), end: node.getEnd() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  const replacement = `new URL(${JSON.stringify(virtualModuleUrl)}, import.meta.url).href`;
  return ranges
    .sort((left, right) => right.start - left.start)
    .reduce((content, range) => `${content.slice(0, range.start)}${replacement}${content.slice(range.end)}`, source);
}

// atomize inventory/score/backfill run framework helper modules and read a
// framework-owned taxonomy. The npm package must carry them, or adopters fail
// before any scan starts. Layout mirrors the repository so relative imports hold.
// merge.js is the only shard module the helpers import; inventory and score read
// the adopter's own path map, so the framework shard data is not shipped.
const ATOMIZE_HELPER_FILES = [
  'atomic_workbench/atomization-coverage/path-to-atom-map-shards/merge.js',
  'docs/ATOMIZATION_COVERAGE_TAXONOMY.md',
  'scripts/src/atomization-register-receipt.js',
  'scripts/src/atomize-backfill.js',
  'scripts/src/atomize-inventory.js',
  'scripts/src/atomize-score.js'
] as const;

function copyAtomizeHelperClosure(repositoryRoot: string, runtimeRoot: string): void {
  const helperRoot = path.join(runtimeRoot, 'atomize-helpers');
  const copyRelative = (relativePath: string) => {
    const targetPath = path.join(helperRoot, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(path.join(repositoryRoot, relativePath), targetPath);
  };
  for (const file of ATOMIZE_HELPER_FILES) copyRelative(file);
}

function copyRuntimeAssets(sourceRoot: string, targetRoot: string, excludedRoot: string): void {
  for (const sourcePath of listFiles(sourceRoot)) {
    if (sourcePath.startsWith(`${excludedRoot}${path.sep}`)) continue;
    if (/\.(?:[cm]?js|d\.ts)$/i.test(sourcePath)) continue;
    const relativePath = path.relative(sourceRoot, sourcePath);
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');
    if (OMITTED_PUBLIC_ASSETS.some((pattern) => pattern.test(normalizedRelativePath))) continue;
    const targetPath = path.join(targetRoot, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
  }
}

function listFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(absolutePath) : [absolutePath];
  });
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  await buildCliNpmRuntime();
}
