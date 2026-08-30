import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, canonicalJsonSha256, executeExternalBenchmark } from './lib/external-benchmark/runner.ts';
import { renderDecisionMarkdown } from './lib/external-benchmark/report.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argument = (name: string): string | null => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
};
const protocolPath = argument('--protocol') ?? path.join(root, 'scripts/fixtures/atm-external-benchmark/manifest.json');
const outputPath = argument('--output');
const rawRunsPath = argument('--raw-runs');
const adjudicationsPath = argument('--adjudications');
const hiddenCorpusAcceptancePath = argument('--hidden-corpus-acceptance');
const independentAdjudicationPath = argument('--independent-adjudication');
const providerTelemetryPath = argument('--provider-telemetry');
const providerRawExportPath = argument('--provider-raw-export');
const signingPayloadPath = argument('--print-signing-payload');
const canonicalDigestPath = argument('--print-canonical-digest');
if (signingPayloadPath || canonicalDigestPath) {
  const artifactPath = signingPayloadPath ?? canonicalDigestPath!;
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as Record<string, unknown>;
  if (signingPayloadPath) {
    const { signature: _signature, publicKeyPem: _publicKeyPem, ...payload } = artifact;
    process.stdout.write(`${canonicalJson(payload)}\n`);
  } else {
    process.stdout.write(`${canonicalJsonSha256(artifact)}\n`);
  }
  process.exit(0);
}
const protocol = JSON.parse(readFileSync(protocolPath, 'utf8'));
const rawRuns = rawRunsPath ? JSON.parse(readFileSync(rawRunsPath, 'utf8')) : [];
const adjudications = adjudicationsPath ? JSON.parse(readFileSync(adjudicationsPath, 'utf8')) : [];
const artifacts = hiddenCorpusAcceptancePath || independentAdjudicationPath || providerTelemetryPath || providerRawExportPath
  ? {
      hiddenCorpusAcceptance: hiddenCorpusAcceptancePath ? JSON.parse(readFileSync(hiddenCorpusAcceptancePath, 'utf8')) : undefined,
      independentAdjudication: independentAdjudicationPath ? JSON.parse(readFileSync(independentAdjudicationPath, 'utf8')) : undefined,
      providerTelemetry: providerTelemetryPath ? JSON.parse(readFileSync(providerTelemetryPath, 'utf8')) : undefined,
      providerRawExport: providerRawExportPath ? readFileSync(providerRawExportPath) : undefined
    }
  : undefined;
const decision = executeExternalBenchmark(protocol, rawRuns, adjudications, artifacts);
const markdown = renderDecisionMarkdown(decision);
if (outputPath) writeFileSync(outputPath, markdown, 'utf8');
process.stdout.write(`${JSON.stringify({ protocolPath, decision }, null, 2)}\n`);
