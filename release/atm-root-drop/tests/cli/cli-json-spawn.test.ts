/**
 * Validators that JSON.parse CLI stdout must accept payloads larger than
 * spawnSync's 1 MiB default, and must fail closed when a caller-supplied
 * maxBuffer still truncates the stream.
 *
 * caseId: test_int_cli_json_spawn_large_stdout
 * semanticKey: cli_json_spawn_does_not_truncate_or_parse_partial_output
 * contractEdge: validator-cli-json-spawn
 */
import assert from 'node:assert/strict';

import { CliOutputTruncatedError, spawnCliCapture } from '../../scripts/lib/cli-json-spawn.ts';

const PATH_COUNT = 20_000;
const LARGE_JSON_SCRIPT = `
const paths = [];
for (let i = 0; i < ${PATH_COUNT}; i += 1) {
  paths.push('research/paper-v2/benchmark-main/2026-10-10-hist-main/' + 'x'.repeat(80) + '/' + i);
}
process.stdout.write(JSON.stringify({ ok: true, paths }));
`;

{
  const captured = spawnCliCapture(process.execPath, ['-e', LARGE_JSON_SCRIPT], {
    label: 'large-json-fixture'
  });
  assert.equal(captured.status, 0);
  assert.ok(Buffer.byteLength(captured.stdout, 'utf8') > 2_000_000);
  const parsed = JSON.parse(captured.stdout) as { ok?: boolean; paths?: string[] };
  assert.equal(parsed.ok, true);
  assert.equal(parsed.paths?.length, PATH_COUNT);
}

{
  assert.throws(
    () => spawnCliCapture(process.execPath, ['-e', LARGE_JSON_SCRIPT], {
      label: 'truncated-json-fixture',
      maxBuffer: 64 * 1024
    }),
    (error: unknown) => {
      assert.ok(error instanceof CliOutputTruncatedError);
      assert.match(error.message, /truncated/i);
      assert.match(error.message, /ENOBUFS|ERR_CHILD_PROCESS_STDIO_MAXBUFFER/);
      assert.equal(error.message.includes('frameworkPhase'), false);
      assert.equal(error.message.includes('TypeError'), false);
      return true;
    }
  );
}

console.log('[cli-json-spawn.test] ok');
