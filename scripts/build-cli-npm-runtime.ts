import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';
import ts from 'typescript';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function buildCliNpmRuntime(options: { repositoryRoot?: string } = {}) {
  const root = path.resolve(options.repositoryRoot ?? repositoryRoot);
  const packageRoot = path.join(root, 'packages', 'cli');
  const sourceDistRoot = path.join(packageRoot, 'dist');
  const runtimeRoot = path.join(sourceDistRoot, 'npm-runtime');
  const entryPath = path.join(sourceDistRoot, '.npm-runtime-entry.mjs');
  try {
    rmSync(runtimeRoot, { recursive: true, force: true });
    mkdirSync(runtimeRoot, { recursive: true });
    writeFileSync(entryPath, [
      "export * from './index.js';",
      "export { runCli } from './atm.js';",
      ''
    ].join('\n'), 'utf8');

    await build({
      entryPoints: [entryPath],
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
    writeFileSync(path.join(runtimeRoot, 'index.js'), "export * from './runtime.mjs';\n", 'utf8');
    const declarationPath = path.join(root, '.types', 'packages', 'cli', 'src', 'index.d.ts');
    const declaration = existsSync(declarationPath)
      ? readFileSync(declarationPath, 'utf8')
      : emitDeclarationFromSource(path.join(packageRoot, 'src', 'index.ts'));
    writeFileSync(path.join(runtimeRoot, 'index.d.ts'), declaration, 'utf8');

    copyRuntimeAssets(sourceDistRoot, path.join(runtimeRoot, 'layout'), runtimeRoot);
    const files = listFiles(runtimeRoot)
      .map((file) => ({
        path: path.relative(runtimeRoot, file).replace(/\\/g, '/'),
        kind: path.relative(runtimeRoot, file).replace(/\\/g, '/').startsWith('layout/')
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
      files,
      fileCount: files.length + 1,
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0)
    };
    writeFileSync(path.join(runtimeRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`[build-cli-npm-runtime] built ${manifest.fileCount} files / ${manifest.totalBytes} bytes at ${path.relative(root, runtimeRoot)}`);
    return manifest;
  } finally {
    rmSync(entryPath, { force: true });
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
        const virtualModuleUrl = `./layout/${relativePath.replace(/\\/g, '/')}`;
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

function copyRuntimeAssets(sourceRoot: string, targetRoot: string, excludedRoot: string): void {
  for (const sourcePath of listFiles(sourceRoot)) {
    if (sourcePath.startsWith(`${excludedRoot}${path.sep}`)) continue;
    if (/\.(?:[cm]?js|d\.ts)$/i.test(sourcePath)) continue;
    const relativePath = path.relative(sourceRoot, sourcePath);
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
